#!/usr/bin/env python3
"""Enrich each tree with 3D structure, competition, and asset-register fields.

This turns the 2D crown inventory into a tree-level asset model. It runs
after crown segmentation + valuation and reads:

  - ``data/processed/tree_crowns_pilot.geojson`` (crown polygons + all the
    valuation / context properties already merged in)
  - the active pilot's CHM mosaic (``chm.vrt``) for under-crown height
    sampling

and writes a new SQLite table ``tree_assets_pilot`` plus an enriched
``tree_assets_pilot.geojson`` that downstream ``build_web_geojson`` merges
into the map.

Implemented (single-snapshot 2024 LiDAR — no multi-year data required):

  PRIORITY 1  Crown 3D structure
     height_p25/p50/p75/p95, mean_height, crown_volume_m3,
     canopy_density_proxy, crown_complexity_index, rugosity,
     vertical_ratio (P25/P95)

  PRIORITY 2  Context & competition
     nearest_tree_m, neighbours_25m, local_canopy_density_25m/50m,
     crown_overlap_index, cluster_id, cluster_size, growth_setting
     (standalone / cluster / forest), edge_tree, dominance_class
     (dominant / co-dominant / suppressed)

  PRIORITY 5  DBH (crown-informed estimate + confidence)
  PRIORITY 6  Life stage (juvenile … veteran)
  PRIORITY 7  Replacement time (years to regrow this canopy) + irreplaceability
  PRIORITY 8  Neighbourhood species/genus diversity + native/exotic share

Deferred (need multi-year LiDAR or extra layers): growth trajectory (P3),
change-based health (P4), full storm-exposure (P9). A single-snapshot
``condition_proxy`` is included but flagged low-confidence.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
import time
from collections import defaultdict, Counter
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio import features as rio_features
from rasterio.windows import from_bounds
from scipy.spatial import cKDTree
from shapely.geometry import shape
from shapely.ops import transform as shapely_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"
CROWNS_GEOJSON = PROCESSED_ROOT / "tree_crowns_pilot.geojson"
OUT_GEOJSON = PROCESSED_ROOT / "tree_assets_pilot.geojson"

_PILOT_NAME = active_pilot_name()
_PILOT_SLUG = "waitemata_lidar_pilot" if _PILOT_NAME == "waitemata_v1" else f"{_PILOT_NAME}_lidar"
CHM_VRT_PATH = ROOT / "data" / "interim" / _PILOT_SLUG / "chm.vrt"

TO_2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
CHUNK_SIZE_M = 1024.0

# Typical mature heights (m) by species class — used for life-stage scaling.
CLASS_MAX_HEIGHT_M = {
    "evergreen_broadleaf": 22.0,
    "deciduous_broadleaf": 25.0,
    "conifer": 35.0,
    "palm_other": 14.0,
}
# Annual crown-area growth (m²/yr) for an actively growing urban tree, by
# class. Planning-grade defaults; drives "years to regrow this canopy".
CLASS_CROWN_GROWTH_M2_Y = {
    "evergreen_broadleaf": 2.2,
    "deciduous_broadleaf": 2.6,
    "conifer": 2.0,
    "palm_other": 0.6,
}

# Native NZ genera (lowercase) for native/exotic share.
NATIVE_GENERA = {
    "metrosideros", "agathis", "podocarpus", "dacrydium", "prumnopitys",
    "vitex", "alectryon", "corynocarpus", "knightia", "griselinia",
    "pittosporum", "coprosma", "cordyline", "rhopalostylis", "kunzea",
    "leptospermum", "sophora", "dysoxylum", "beilschmiedia", "laurelia",
    "nestegis", "hoheria", "plagianthus", "fuchsia", "melicytus",
    "pseudopanax", "schefflera", "elaeocarpus", "hedycarya", "myrsine",
}


def utc_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_crowns() -> list[dict[str, Any]]:
    print(f"Loading crowns from {CROWNS_GEOJSON.name} ...")
    data = json.loads(CROWNS_GEOJSON.read_text(encoding="utf-8"))
    feats = data.get("features", [])
    out = []
    for f in feats:
        geom4326 = f.get("geometry")
        if not geom4326:
            continue
        geom2193 = shapely_transform(TO_2193.transform, shape(geom4326))
        if geom2193.is_empty:
            continue
        cx, cy = geom2193.centroid.x, geom2193.centroid.y
        out.append({
            "tree_id": f.get("id") or f["properties"].get("tree_id"),
            "props": f["properties"],
            "geom2193": geom2193,
            "cx": cx,
            "cy": cy,
        })
    print(f"  {len(out):,} crowns loaded")
    return out


# ----------------------------------------------------------------------------
# PRIORITY 1 — 3D structure via chunked CHM sampling
# ----------------------------------------------------------------------------
def compute_structure(crowns: list[dict[str, Any]]) -> None:
    if not CHM_VRT_PATH.exists():
        print(f"  WARNING: CHM not found at {CHM_VRT_PATH}; skipping 3D structure")
        return
    # Bucket crowns by 1 km chunk (keyed on centroid).
    by_chunk: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, c in enumerate(crowns):
        key = (int(c["cx"] // CHUNK_SIZE_M), int(c["cy"] // CHUNK_SIZE_M))
        by_chunk[key].append(i)

    print(f"  sampling CHM across {len(by_chunk):,} chunks ...")
    t0 = time.time()
    done = 0
    with rasterio.open(CHM_VRT_PATH) as src:
        nodata = src.nodata if src.nodata is not None else -9999
        for (gx, gy), idxs in by_chunk.items():
            # Bounding box of this chunk's crowns + small halo.
            xs0 = min(crowns[i].geom2193.bounds[0] if False else crowns[i]["geom2193"].bounds[0] for i in idxs)
            ys0 = min(crowns[i]["geom2193"].bounds[1] for i in idxs)
            xs1 = max(crowns[i]["geom2193"].bounds[2] for i in idxs)
            ys1 = max(crowns[i]["geom2193"].bounds[3] for i in idxs)
            halo = 2.0
            try:
                window = from_bounds(xs0 - halo, ys0 - halo, xs1 + halo, ys1 + halo, transform=src.transform)
                chm = src.read(1, window=window, boundless=True, fill_value=nodata).astype("float32")
                win_transform = rasterio.windows.transform(window, src.transform)
            except Exception:
                continue
            chm[chm == nodata] = np.nan
            h, w = chm.shape
            if h == 0 or w == 0:
                continue
            # Rasterize each crown in this chunk to a label id (1..N).
            shapes = [(crowns[i]["geom2193"], lbl) for lbl, i in enumerate(idxs, start=1)]
            labels = rio_features.rasterize(
                shapes, out_shape=(h, w), transform=win_transform,
                fill=0, dtype="int32", all_touched=False,
            )
            for lbl, i in enumerate(idxs, start=1):
                mask = labels == lbl
                if not mask.any():
                    # all_touched fallback for tiny crowns
                    labels2 = rio_features.rasterize(
                        [(crowns[i]["geom2193"], 1)], out_shape=(h, w),
                        transform=win_transform, fill=0, dtype="int32", all_touched=True,
                    )
                    mask = labels2 == 1
                heights = chm[mask]
                heights = heights[np.isfinite(heights)]
                if heights.size == 0:
                    continue
                p25, p50, p75, p95 = (float(v) for v in np.percentile(heights, [25, 50, 75, 95]))
                hmax = float(heights.max())
                hmean = float(heights.mean())
                hstd = float(heights.std())
                px_area = abs(win_transform.a * win_transform.e)  # m² per pixel
                volume = float(heights.sum() * px_area)  # canopy height volume m³
                # canopy density proxy: how "full" the vertical profile is
                density = float(hmean / hmax) if hmax > 0 else 0.0
                # complexity: coefficient of variation of heights
                complexity = float(hstd / hmean) if hmean > 0 else 0.0
                vertical_ratio = float(p25 / p95) if p95 > 0 else 0.0
                crowns[i]["structure"] = {
                    "height_p25_m": round(p25, 2),
                    "height_p50_m": round(p50, 2),
                    "height_p75_m": round(p75, 2),
                    "height_p95_m": round(p95, 2),
                    "height_max_m": round(hmax, 2),
                    "height_mean_m": round(hmean, 2),
                    "crown_volume_m3": round(volume, 1),
                    "canopy_density_proxy": round(density, 3),
                    "crown_complexity_index": round(complexity, 3),
                    "vertical_ratio": round(vertical_ratio, 3),
                    "n_canopy_pixels": int(heights.size),
                }
            done += 1
            if done % 25 == 0 or done == len(by_chunk):
                print(f"    chunk {done:,}/{len(by_chunk):,} ({time.time()-t0:.0f}s)")


# ----------------------------------------------------------------------------
# PRIORITY 2 — context & competition
# ----------------------------------------------------------------------------
def compute_competition(crowns: list[dict[str, Any]]) -> None:
    print("  computing competition metrics (KDTree) ...")
    xy = np.array([[c["cx"], c["cy"]] for c in crowns], dtype="float64")
    heights = np.array([
        float(c["props"].get("crown_max_chm_m") or 0.0) for c in crowns
    ], dtype="float64")
    areas = np.array([
        float(c["props"].get("crown_area_m2") or 0.0) for c in crowns
    ], dtype="float64")
    radii = np.sqrt(np.maximum(areas, 1e-6) / math.pi)
    tree = cKDTree(xy)

    # Nearest neighbour distance (k=2: itself + nearest other).
    dists, nbr = tree.query(xy, k=2, workers=-1)
    nearest_m = dists[:, 1]

    # Neighbour counts + local canopy density at 25 m and 50 m.
    pairs_25 = tree.query_ball_point(xy, r=25.0, workers=-1)
    pairs_50 = tree.query_ball_point(xy, r=50.0, workers=-1)

    # Cluster id via connected components at 12 m centroid spacing.
    cluster_id = _cluster_components(tree, n=len(crowns), link_m=12.0)
    cluster_sizes = Counter(cluster_id)

    for i, c in enumerate(crowns):
        n25 = [j for j in pairs_25[i] if j != i]
        n50 = [j for j in pairs_50[i] if j != i]
        # local canopy density = neighbour crown area / buffer area
        area25 = sum(areas[j] for j in n25)
        area50 = sum(areas[j] for j in n50)
        density25 = float(min(1.0, area25 / (math.pi * 25.0 ** 2)))
        density50 = float(min(1.0, area50 / (math.pi * 50.0 ** 2)))
        # crown overlap index: neighbours whose radii sum exceeds gap
        overlaps = 0
        for j in n25:
            d = math.hypot(xy[i, 0] - xy[j, 0], xy[i, 1] - xy[j, 1])
            if radii[i] + radii[j] > d:
                overlaps += 1
        overlap_index = float(overlaps / max(1, len(n25))) if n25 else 0.0
        # dominance: height percentile vs neighbours within 25 m
        if n25:
            local_h = heights[n25]
            taller = int((local_h > heights[i]).sum())
            frac_taller = taller / len(n25)
            if frac_taller <= 0.2:
                dominance = "dominant"
            elif frac_taller >= 0.7:
                dominance = "suppressed"
            else:
                dominance = "co-dominant"
        else:
            dominance = "dominant"  # standalone tree dominates its space
        # growth setting
        csize = cluster_sizes[cluster_id[i]]
        if len(n25) == 0:
            setting = "standalone"
        elif csize >= 12 or density50 >= 0.5:
            setting = "forest_patch"
        else:
            setting = "cluster"
        # edge tree: fewer than half the neighbours of a typical cluster member,
        # or directional gap. Cheap proxy: neighbour count in 25 m below the
        # cluster's median, AND part of a cluster.
        edge = bool(setting != "standalone" and len(n25) <= 2)

        c["competition"] = {
            "nearest_tree_m": round(float(nearest_m[i]), 1),
            "neighbours_25m": len(n25),
            "neighbours_50m": len(n50),
            "local_canopy_density_25m": round(density25, 3),
            "local_canopy_density_50m": round(density50, 3),
            "crown_overlap_index": round(overlap_index, 3),
            "cluster_id": int(cluster_id[i]),
            "cluster_size": int(csize),
            "growth_setting": setting,
            "edge_tree": edge,
            "dominance_class": dominance,
        }


def _cluster_components(tree: cKDTree, n: int, link_m: float) -> np.ndarray:
    """Union-find connected components: trees within link_m are connected."""
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    pairs = tree.query_pairs(r=link_m)
    for a, b in pairs:
        union(a, b)
    roots = np.array([find(i) for i in range(n)], dtype="int64")
    # Relabel to compact ids.
    _, inverse = np.unique(roots, return_inverse=True)
    return inverse.astype("int64")


# ----------------------------------------------------------------------------
# PRIORITY 5/6/7/8 — derived asset fields
# ----------------------------------------------------------------------------
def species_class_of(c: dict[str, Any]) -> str:
    sc = c["props"].get("species_class")
    return sc if sc in CLASS_MAX_HEIGHT_M else "evergreen_broadleaf"


def estimate_dbh_crown(height_m: float, crown_diam_m: float, klass: str) -> tuple[float, str]:
    """Crown-informed DBH (cm). Blends a height-based and a crown-diameter-based
    estimate. Returns (dbh_cm, confidence)."""
    height_m = max(0.0, height_m)
    crown_diam_m = max(0.0, crown_diam_m)
    # Height-driven (same family as valuation):
    if klass == "palm_other":
        dbh_h = 2.0 + 1.2 * height_m
    elif klass == "conifer":
        dbh_h = 1.5 * height_m + 0.02 * height_m * height_m
    else:
        dbh_h = 1.6 * height_m + 0.04 * height_m * height_m
    # Crown-diameter driven: urban open-grown trees ~ DBH(cm) ≈ 1.6 × crown_diam(m)...
    # use a broadleaf-ish ratio, lower for conifer/palm.
    ratio = {"conifer": 1.2, "palm_other": 0.8}.get(klass, 1.7)
    dbh_c = ratio * crown_diam_m
    if crown_diam_m > 0 and height_m > 0:
        dbh = 0.5 * dbh_h + 0.5 * dbh_c
        conf = "modelled_medium"
    elif height_m > 0:
        dbh = dbh_h
        conf = "modelled_low"
    else:
        dbh = dbh_c
        conf = "modelled_low"
    return max(3.0, dbh), conf


def life_stage(height_m: float, dbh_cm: float, klass: str) -> str:
    hmax = CLASS_MAX_HEIGHT_M.get(klass, 22.0)
    frac = height_m / hmax if hmax > 0 else 0.0
    if frac < 0.18:
        return "juvenile"
    if frac < 0.35:
        return "young"
    if frac < 0.60:
        return "semi-mature"
    if frac < 0.90:
        return "mature"
    return "veteran"


def replacement_years(crown_area_m2: float, klass: str) -> float:
    rate = CLASS_CROWN_GROWTH_M2_Y.get(klass, 2.2)
    return crown_area_m2 / rate if rate > 0 else 999.0


def irreplaceability(years: float, height_m: float) -> str:
    if years >= 80 or height_m >= 25:
        return "effectively_irreplaceable"
    if years >= 40:
        return "very_high"
    if years >= 15:
        return "high"
    if years >= 5:
        return "moderate"
    return "low"


def compute_derived(crowns: list[dict[str, Any]]) -> None:
    print("  computing DBH / life-stage / replacement / diversity ...")
    # Neighbourhood diversity on a 200 m grid.
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    GRID_M = 200.0
    for i, c in enumerate(crowns):
        grid[(int(c["cx"] // GRID_M), int(c["cy"] // GRID_M))].append(i)
    grid_div: dict[tuple[int, int], dict[str, float]] = {}
    for cell, idxs in grid.items():
        commons = [crowns[i]["props"].get("species_common") for i in idxs]
        classes = [species_class_of(crowns[i]) for i in idxs]
        genera = []
        natives = 0
        for i in idxs:
            sc = crowns[i]["props"].get("species_class")
            # genus from species_common is unreliable; use species_class as
            # coarse genus proxy plus latin first token if present
            g = None
            lat = crowns[i]["props"].get("species_latin") if "species_latin" in crowns[i]["props"] else None
            if lat:
                g = str(lat).split()[0].lower()
            genera.append(g or sc)
            if g and g in NATIVE_GENERA:
                natives += 1
        grid_div[cell] = {
            "neighbourhood_shannon": round(_shannon(commons), 3),
            "neighbourhood_class_simpson": round(_simpson(classes), 3),
            "neighbourhood_native_share": round(natives / len(idxs), 3) if idxs else 0.0,
            "neighbourhood_tree_count": len(idxs),
        }

    for c in crowns:
        klass = species_class_of(c)
        height = float(c["props"].get("crown_max_chm_m") or 0.0)
        crown_area = float(c["props"].get("crown_area_m2") or 0.0)
        crown_diam = float(c["props"].get("crown_diameter_m") or 0.0)
        dbh, dbh_conf = estimate_dbh_crown(height, crown_diam, klass)
        stage = life_stage(height, dbh, klass)
        years = replacement_years(crown_area, klass)
        irr = irreplaceability(years, height)
        cell = (int(c["cx"] // GRID_M), int(c["cy"] // GRID_M))
        div = grid_div.get(cell, {})
        # single-snapshot condition proxy (LOW confidence): a big crown that's
        # vertically sparse (low density) may be thinning. Flag, don't assert.
        density = (c.get("structure") or {}).get("canopy_density_proxy")
        if density is None:
            condition = "unknown"
        elif density >= 0.45:
            condition = "good"
        elif density >= 0.30:
            condition = "fair"
        else:
            condition = "sparse_review"
        c["derived"] = {
            "dbh_cm_crown_est": round(dbh, 1),
            "dbh_confidence": dbh_conf,
            "life_stage": stage,
            "replacement_years_canopy": round(years, 1),
            "irreplaceability_class": irr,
            "condition_proxy": condition,
            "condition_confidence": "single_snapshot_low",
            **div,
        }


def _shannon(values: list[Any]) -> float:
    vals = [v for v in values if v]
    if not vals:
        return 0.0
    counts = Counter(vals)
    total = sum(counts.values())
    return -sum((n / total) * math.log(n / total) for n in counts.values())


def _simpson(values: list[Any]) -> float:
    vals = [v for v in values if v]
    if not vals:
        return 0.0
    counts = Counter(vals)
    total = sum(counts.values())
    return 1.0 - sum((n / total) ** 2 for n in counts.values())


# ----------------------------------------------------------------------------
# Persist
# ----------------------------------------------------------------------------
ASSET_FIELDS = [
    # structure
    "height_p25_m", "height_p50_m", "height_p75_m", "height_p95_m",
    "height_max_m", "height_mean_m", "crown_volume_m3",
    "canopy_density_proxy", "crown_complexity_index", "vertical_ratio",
    "n_canopy_pixels",
    # competition
    "nearest_tree_m", "neighbours_25m", "neighbours_50m",
    "local_canopy_density_25m", "local_canopy_density_50m",
    "crown_overlap_index", "cluster_id", "cluster_size",
    "growth_setting", "edge_tree", "dominance_class",
    # derived
    "dbh_cm_crown_est", "dbh_confidence", "life_stage",
    "replacement_years_canopy", "irreplaceability_class",
    "condition_proxy", "condition_confidence",
    "neighbourhood_shannon", "neighbourhood_class_simpson",
    "neighbourhood_native_share", "neighbourhood_tree_count",
]


def merged_props(c: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for block in ("structure", "competition", "derived"):
        out.update(c.get(block) or {})
    return out


def persist(crowns: list[dict[str, Any]]) -> None:
    print("  writing SQLite + enriched geojson ...")
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        cols_sql = ", ".join(f'"{f}" {_sql_type(f)}' for f in ASSET_FIELDS)
        conn.execute("DROP TABLE IF EXISTS tree_assets_pilot")
        conn.execute(
            f"CREATE TABLE tree_assets_pilot (tree_id TEXT PRIMARY KEY, {cols_sql}, created_at_utc TEXT)"
        )
        created = utc_now()
        rows = []
        for c in crowns:
            m = merged_props(c)
            rows.append([c["tree_id"]] + [m.get(f) for f in ASSET_FIELDS] + [created])
        placeholders = ",".join("?" for _ in range(len(ASSET_FIELDS) + 2))
        conn.executemany(
            f"INSERT INTO tree_assets_pilot VALUES ({placeholders})", rows
        )
        conn.execute("CREATE INDEX idx_assets_stage ON tree_assets_pilot(life_stage)")
        conn.execute("CREATE INDEX idx_assets_dominance ON tree_assets_pilot(dominance_class)")
        conn.commit()
    finally:
        conn.close()

    # Lightweight geojson keyed by tree_id (points at centroid) for joining.
    to_4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    feats = []
    for c in crowns:
        lon, lat = to_4326.transform(c["cx"], c["cy"])
        feats.append({
            "type": "Feature",
            "id": c["tree_id"],
            "properties": {"tree_id": c["tree_id"], **merged_props(c)},
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        })
    OUT_GEOJSON.write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  wrote {len(feats):,} asset rows → {OUT_GEOJSON.name}")


def _sql_type(field: str) -> str:
    if field in {"growth_setting", "dominance_class", "dbh_confidence",
                 "life_stage", "irreplaceability_class", "condition_proxy",
                 "condition_confidence", "edge_tree"}:
        return "TEXT"
    if field in {"neighbours_25m", "neighbours_50m", "cluster_id",
                 "cluster_size", "n_canopy_pixels", "neighbourhood_tree_count"}:
        return "INTEGER"
    return "REAL"


def summary(crowns: list[dict[str, Any]]) -> None:
    stages = Counter(c.get("derived", {}).get("life_stage") for c in crowns)
    dom = Counter(c.get("competition", {}).get("dominance_class") for c in crowns)
    setting = Counter(c.get("competition", {}).get("growth_setting") for c in crowns)
    irr = Counter(c.get("derived", {}).get("irreplaceability_class") for c in crowns)
    have_struct = sum(1 for c in crowns if c.get("structure"))
    print(json.dumps({
        "crowns": len(crowns),
        "with_3d_structure": have_struct,
        "life_stage": dict(stages),
        "dominance": dict(dom),
        "growth_setting": dict(setting),
        "irreplaceability": dict(irr),
    }, indent=2, default=str))


def main() -> None:
    crowns = load_crowns()
    if not crowns:
        print("No crowns to enrich.")
        return
    compute_structure(crowns)
    compute_competition(crowns)
    compute_derived(crowns)
    persist(crowns)
    summary(crowns)


if __name__ == "__main__":
    main()
