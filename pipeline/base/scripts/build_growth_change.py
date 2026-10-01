#!/usr/bin/env python3
"""Multi-year canopy growth / change detection (Priorities 3 & 4).

Differences a historic CHM (built by ``fetch_historic_lidar.py``) against
the current 2024 CHM, per crown polygon, to derive longitudinal fields:

  PRIORITY 3 — Growth trajectory
     height_change_m, height_change_pct, annual_height_growth_m,
     crown_area_change_pct (where comparable), growth_velocity_class
     (expanding / stable / declining), historic_height_m

  PRIORITY 4 — Change-based vitality / status
     tree_status (existing / newly_established / likely_removed),
     canopy_change_class, vitality_change_score, structural_decline_flag

The historic CHM is aligned to the same 1 m EPSG:2193 grid as the 2024
CHM, so the comparison is a straight per-pixel difference inside each
crown footprint.

Writes ``tree_change_pilot`` (SQLite) + ``tree_change_pilot.geojson``,
merged into the web tiles by ``merge_assets_into_web`` / ``build_web_geojson``.

Inputs:
  --historic-chm   path to the aligned historic CHM VRT/GeoTIFF
  --historic-year  e.g. 2013 or 2016 (for annualised rates + labels)
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from collections import defaultdict, Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio import features as rio_features
from rasterio.windows import from_bounds
from shapely.geometry import shape
from shapely.ops import transform as shapely_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"
CROWNS_GEOJSON = PROCESSED_ROOT / "tree_crowns_pilot.geojson"
OUT_GEOJSON = PROCESSED_ROOT / "tree_change_pilot.geojson"

_PILOT_NAME = active_pilot_name()
_PILOT_SLUG = "waitemata_lidar_pilot" if _PILOT_NAME == "waitemata_v1" else f"{_PILOT_NAME}_lidar"
CURRENT_CHM_VRT = ROOT / "data" / "interim" / _PILOT_SLUG / "chm.vrt"

TO_2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
CURRENT_YEAR = 2024
CHUNK_SIZE_M = 1024.0
CANOPY_MIN_HEIGHT_M = 3.0  # what counts as canopy in the historic raster


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_crowns() -> list[dict[str, Any]]:
    print(f"Loading crowns from {CROWNS_GEOJSON.name} ...")
    data = json.loads(CROWNS_GEOJSON.read_text(encoding="utf-8"))
    out = []
    for f in data.get("features", []):
        g = f.get("geometry")
        if not g:
            continue
        geom = shapely_transform(TO_2193.transform, shape(g))
        if geom.is_empty:
            continue
        out.append({
            "tree_id": f.get("id") or f["properties"].get("tree_id"),
            "props": f["properties"],
            "geom": geom,
            "cx": geom.centroid.x,
            "cy": geom.centroid.y,
        })
    print(f"  {len(out):,} crowns")
    return out


def sample_pair(crowns: list[dict[str, Any]], historic_chm_path: Path, historic_year: int) -> None:
    """Per crown, read both CHMs over its footprint and compute change stats."""
    years = max(1, CURRENT_YEAR - historic_year)
    by_chunk: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, c in enumerate(crowns):
        by_chunk[(int(c["cx"] // CHUNK_SIZE_M), int(c["cy"] // CHUNK_SIZE_M))].append(i)

    print(f"  differencing {historic_year}→{CURRENT_YEAR} ({years} yr) over {len(by_chunk):,} chunks ...")
    t0 = time.time()
    done = 0
    with rasterio.open(CURRENT_CHM_VRT) as cur_src, rasterio.open(historic_chm_path) as his_src:
        cur_nd = cur_src.nodata if cur_src.nodata is not None else -9999
        his_nd = his_src.nodata if his_src.nodata is not None else -9999
        for idxs in by_chunk.values():
            xs0 = min(crowns[i]["geom"].bounds[0] for i in idxs) - 2
            ys0 = min(crowns[i]["geom"].bounds[1] for i in idxs) - 2
            xs1 = max(crowns[i]["geom"].bounds[2] for i in idxs) + 2
            ys1 = max(crowns[i]["geom"].bounds[3] for i in idxs) + 2
            try:
                cur_win = from_bounds(xs0, ys0, xs1, ys1, transform=cur_src.transform)
                cur = cur_src.read(1, window=cur_win, boundless=True, fill_value=cur_nd).astype("float32")
                tr = rasterio.windows.transform(cur_win, cur_src.transform)
                # read historic onto the SAME grid/shape
                his_win = from_bounds(xs0, ys0, xs1, ys1, transform=his_src.transform)
                his = his_src.read(1, window=his_win, boundless=True, fill_value=his_nd,
                                   out_shape=cur.shape).astype("float32")
            except Exception:
                continue
            cur[cur == cur_nd] = np.nan
            his[his == his_nd] = np.nan
            h, w = cur.shape
            shapes = [(crowns[i]["geom"], lbl) for lbl, i in enumerate(idxs, start=1)]
            labels = rio_features.rasterize(shapes, out_shape=(h, w), transform=tr,
                                            fill=0, dtype="int32", all_touched=False)
            for lbl, i in enumerate(idxs, start=1):
                mask = labels == lbl
                if not mask.any():
                    lab2 = rio_features.rasterize([(crowns[i]["geom"], 1)], out_shape=(h, w),
                                                  transform=tr, fill=0, dtype="int32", all_touched=True)
                    mask = lab2 == 1
                cur_h = cur[mask]
                his_h = his[mask]
                cur_valid = cur_h[np.isfinite(cur_h)]
                his_valid = his_h[np.isfinite(his_h)]
                if cur_valid.size == 0:
                    continue
                cur_max = float(np.nanmax(cur_valid))
                # Historic canopy presence within this footprint:
                his_canopy = his_valid[his_valid >= CANOPY_MIN_HEIGHT_M]
                his_cover_frac = float(his_canopy.size / max(1, cur_h.size))
                cur_cover_frac = float((cur_valid >= CANOPY_MIN_HEIGHT_M).sum() / max(1, cur_h.size))
                if his_canopy.size >= 3:
                    his_max = float(np.nanmax(his_canopy))
                    h_change = cur_max - his_max
                    h_change_pct = (h_change / his_max * 100.0) if his_max > 0 else None
                    annual = h_change / years
                    area_change_pct = ((cur_cover_frac - his_cover_frac) / his_cover_frac * 100.0) if his_cover_frac > 0 else None
                    status = "existing"
                else:
                    his_max = None
                    h_change = None
                    h_change_pct = None
                    annual = None
                    area_change_pct = None
                    status = "newly_established"  # canopy now, none in historic
                crowns[i]["change"] = {
                    "historic_year": historic_year,
                    "historic_height_m": round(his_max, 2) if his_max is not None else None,
                    "current_height_m": round(cur_max, 2),
                    "height_change_m": round(h_change, 2) if h_change is not None else None,
                    "height_change_pct": round(h_change_pct, 1) if h_change_pct is not None else None,
                    "annual_height_growth_m": round(annual, 3) if annual is not None else None,
                    "crown_area_change_pct": round(area_change_pct, 1) if area_change_pct is not None else None,
                    "historic_canopy_cover_frac": round(his_cover_frac, 3),
                    "tree_status": status,
                }
            done += 1
            if done % 25 == 0 or done == len(by_chunk):
                print(f"    chunk {done:,}/{len(by_chunk):,} ({time.time()-t0:.0f}s)")


def classify(crowns: list[dict[str, Any]], historic_year: int) -> None:
    """Derive growth_velocity_class, vitality_change, status refinements."""
    for c in crowns:
        ch = c.get("change")
        if not ch:
            continue
        annual = ch.get("annual_height_growth_m")
        status = ch.get("tree_status")
        # Growth velocity classification (height-based).
        if status == "newly_established":
            vel = "newly_established"
        elif annual is None:
            vel = "unknown"
        elif annual >= 0.25:
            vel = "expanding"
        elif annual <= -0.25:
            vel = "declining"
        else:
            vel = "stable"
        ch["growth_velocity_class"] = vel
        # Change-based vitality score (0..1; higher = healthier trend).
        # Positive growth → high; sharp decline → low. Single covariate proxy.
        if annual is None:
            ch["vitality_change_score"] = None
            ch["structural_decline_flag"] = 0
        else:
            score = float(np.clip(0.5 + annual, 0.0, 1.0))
            ch["vitality_change_score"] = round(score, 2)
            ch["structural_decline_flag"] = int(annual <= -0.30)
        # Canopy change class
        apct = ch.get("crown_area_change_pct")
        if status == "newly_established":
            ch["canopy_change_class"] = "new_canopy"
        elif apct is None:
            ch["canopy_change_class"] = "unknown"
        elif apct >= 15:
            ch["canopy_change_class"] = "expanded"
        elif apct <= -15:
            ch["canopy_change_class"] = "contracted"
        else:
            ch["canopy_change_class"] = "stable"


CHANGE_FIELDS = [
    "historic_year", "historic_height_m", "current_height_m",
    "height_change_m", "height_change_pct", "annual_height_growth_m",
    "crown_area_change_pct", "historic_canopy_cover_frac",
    "tree_status", "growth_velocity_class", "canopy_change_class",
    "vitality_change_score", "structural_decline_flag",
]


def persist(crowns: list[dict[str, Any]]) -> None:
    print("  writing tree_change_pilot ...")
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        cols = ", ".join(f'"{f}" {_t(f)}' for f in CHANGE_FIELDS)
        conn.execute("DROP TABLE IF EXISTS tree_change_pilot")
        conn.execute(f"CREATE TABLE tree_change_pilot (tree_id TEXT PRIMARY KEY, {cols}, created_at_utc TEXT)")
        created = utc_now()
        rows = []
        for c in crowns:
            ch = c.get("change")
            if not ch:
                continue
            rows.append([c["tree_id"]] + [ch.get(f) for f in CHANGE_FIELDS] + [created])
        ph = ",".join("?" for _ in range(len(CHANGE_FIELDS) + 2))
        conn.executemany(f"INSERT INTO tree_change_pilot VALUES ({ph})", rows)
        conn.execute("CREATE INDEX idx_change_status ON tree_change_pilot(tree_status)")
        conn.execute("CREATE INDEX idx_change_vel ON tree_change_pilot(growth_velocity_class)")
        conn.commit()
    finally:
        conn.close()

    to4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    feats = []
    for c in crowns:
        ch = c.get("change")
        if not ch:
            continue
        lon, lat = to4326.transform(c["cx"], c["cy"])
        feats.append({
            "type": "Feature", "id": c["tree_id"],
            "properties": {"tree_id": c["tree_id"], **{k: ch.get(k) for k in CHANGE_FIELDS}},
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        })
    OUT_GEOJSON.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {len(feats):,} change rows → {OUT_GEOJSON.name}")


def _t(f: str) -> str:
    if f in {"tree_status", "growth_velocity_class", "canopy_change_class"}:
        return "TEXT"
    if f in {"historic_year", "structural_decline_flag"}:
        return "INTEGER"
    return "REAL"


def summary(crowns: list[dict[str, Any]]) -> None:
    st = Counter(c.get("change", {}).get("tree_status") for c in crowns if c.get("change"))
    vel = Counter(c.get("change", {}).get("growth_velocity_class") for c in crowns if c.get("change"))
    annuals = [c["change"]["annual_height_growth_m"] for c in crowns
               if c.get("change") and c["change"].get("annual_height_growth_m") is not None]
    print(json.dumps({
        "crowns_with_change": sum(1 for c in crowns if c.get("change")),
        "tree_status": dict(st),
        "growth_velocity": dict(vel),
        "median_annual_height_growth_m": round(float(np.median(annuals)), 3) if annuals else None,
        "mean_annual_height_growth_m": round(float(np.mean(annuals)), 3) if annuals else None,
    }, indent=2, default=str))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--historic-chm", required=True, type=Path)
    ap.add_argument("--historic-year", required=True, type=int)
    args = ap.parse_args()
    if not args.historic_chm.exists():
        raise SystemExit(f"historic CHM not found: {args.historic_chm}")
    if not CURRENT_CHM_VRT.exists():
        raise SystemExit(f"current CHM not found: {CURRENT_CHM_VRT}")
    crowns = load_crowns()
    sample_pair(crowns, args.historic_chm, args.historic_year)
    classify(crowns, args.historic_year)
    persist(crowns)
    summary(crowns)


if __name__ == "__main__":
    main()
