#!/usr/bin/env python3
"""Detect urban hedgerows in the classified point cloud.

A hedge / screening row reads in LiDAR as a long, thin, continuous strip of
low vegetation (clipped 1.5-5 m) — quite unlike a tree crown, which is compact
and roughly circular. The CHM low-canopy detector (`build_tree_qa_layers.py`)
seeds a point on every local maximum along such a strip, so a single hedge
becomes a row of "low-canopy candidates". This step finds the underlying
strips so those candidates can be reclassified as `hedge` rather than treated
as individual trees.

Per native LAZ tile:
  * build a 1 m vegetation-canopy-height grid (max veg-class Z minus a coarse
    ground surface), keep cells in the hedge band [HEDGE_MIN_H, HEDGE_MAX_H];
  * drop cells already under an existing tree crown (so we trace hedges, not
    the linear edge of a tree canopy);
  * connected-component the strip mask; for each component run PCA on its cell
    coordinates and keep the long + thin + elongated ones;
  * emit the centreline (major axis) as a LineString with length + mean height.

Output: `tree_pointcloud_hedges_pilot` table + `pointcloud_hedges_pilot.geojson`
(LineStrings, EPSG:4326). A follow-up step tags low-canopy candidates that fall
on a hedge and values them as linear screening vegetation.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import laspy
from pyproj import Transformer
from rasterio import features as rio_features
from rasterio.transform import from_origin
from scipy import ndimage
from shapely.geometry import shape, LineString
from shapely.ops import transform as shapely_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402
from build_pointcloud_missed_trees import ground_surface  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
SQLITE_PATH = PROCESSED / "akl_trees.sqlite"
CROWNS_GEOJSON = PROCESSED / "tree_crowns_pilot.geojson"
_PILOT = active_pilot_name()
_PC_ROOT = Path(os.environ.get("AKL_TREES_PC_ROOT",
                               ROOT / "data" / "raw" / "point_cloud_2024"))
PC_DIR = _PC_ROOT / _PILOT

TO_2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
TO_4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)

GRID_RES = 1.0
VEG = (3, 4, 5)
HEDGE_MIN_H = 1.5
HEDGE_MAX_H = 5.0
HEDGE_MIN_LENGTH_M = 8.0     # a hedge is at least this long
HEDGE_MAX_WIDTH_M = 4.0      # ... and no wider than this
HEDGE_MIN_ELONGATION = 3.0   # length / width
HEDGE_MIN_AREA_M2 = 10.0
HEDGE_MAX_AREA_M2 = 3000.0   # guards against tracing a whole block of bush
COVER_DILATE_M = 1.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_crown_footprints():
    """Existing crown polygons (EPSG:2193) + bounds for coverage masking."""
    geoms = []
    if CROWNS_GEOJSON.exists():
        data = json.loads(CROWNS_GEOJSON.read_text(encoding="utf-8"))
        for f in data.get("features", []):
            g = f.get("geometry")
            if g:
                geom = shapely_transform(TO_2193.transform, shape(g))
                if not geom.is_empty:
                    geoms.append(geom)
    bounds = np.array([g.bounds for g in geoms], dtype="float64") if geoms else np.empty((0, 4))
    print(f"  {len(geoms):,} crown footprints for coverage", flush=True)
    return geoms, bounds


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-tiles", type=int, default=0)
    args = ap.parse_args()
    if not PC_DIR.exists():
        raise SystemExit(f"point cloud dir not found: {PC_DIR}")
    tiles = sorted(set(PC_DIR.glob("pc_*.laz")))
    if args.max_tiles:
        tiles = tiles[: args.max_tiles]
    if not tiles:
        raise SystemExit("no LAZ tiles present yet")

    print("Loading crown footprints ...", flush=True)
    geoms, bnds = load_crown_footprints()

    hedges: list[dict] = []
    print(f"Scanning {len(tiles)} tiles for hedgerows ...", flush=True)
    t0 = time.time()
    for ti, tile in enumerate(tiles, 1):
        try:
            hdr = laspy.open(tile).header
            tx0, ty0, tx1, ty1 = (float(hdr.x_min), float(hdr.y_min),
                                  float(hdr.x_max), float(hdr.y_max))
            las = laspy.read(tile)
        except Exception as e:  # noqa: BLE001
            print(f"  [{ti}/{len(tiles)}] {tile.name}: {e}", flush=True)
            continue
        px = np.asarray(las.x)
        py = np.asarray(las.y)
        pz = np.asarray(las.z)
        cls = np.asarray(las.classification)
        w = int(round((tx1 - tx0) / GRID_RES))
        h = int(round((ty1 - ty0) / GRID_RES))
        if w <= 0 or h <= 0:
            continue
        ground = ground_surface(px, py, pz, cls, tx0, ty1, w, h)
        if ground is None:
            continue
        col = ((px - tx0) / GRID_RES).astype("int64")
        row = ((ty1 - py) / GRID_RES).astype("int64")
        inb = (col >= 0) & (col < w) & (row >= 0) & (row < h)
        veg = np.isin(cls, VEG) & inb
        if not veg.any():
            continue
        vpid = row[veg] * w + col[veg]
        vtop = np.full(h * w, -np.inf, dtype="float64")
        np.maximum.at(vtop, vpid, pz[veg])
        vtop2d = vtop.reshape(h, w)
        height = np.where(np.isfinite(vtop2d), vtop2d - ground, np.nan)

        sel = np.where((bnds[:, 0] <= tx1) & (bnds[:, 2] >= tx0) &
                       (bnds[:, 1] <= ty1) & (bnds[:, 3] >= ty0))[0] if len(bnds) else np.array([], dtype=int)
        transform = from_origin(tx0, ty1, GRID_RES, GRID_RES)
        covered = np.zeros((h, w), dtype=bool)
        if sel.size:
            cov = rio_features.rasterize(
                [(geoms[i].buffer(COVER_DILATE_M), 1) for i in sel],
                out_shape=(h, w), transform=transform, fill=0, dtype="uint8", all_touched=True)
            covered = cov.astype(bool)

        strip = (np.isfinite(height) & (height >= HEDGE_MIN_H)
                 & (height <= HEDGE_MAX_H) & (~covered))
        if not strip.any():
            continue
        lab, nlab = ndimage.label(strip, structure=np.ones((3, 3)))
        if nlab == 0:
            continue
        comp_area = np.bincount(lab.ravel())
        objs = ndimage.find_objects(lab)
        for li in range(1, nlab + 1):
            area = float(comp_area[li])
            if area < HEDGE_MIN_AREA_M2 or area > HEDGE_MAX_AREA_M2:
                continue
            sl = objs[li - 1]
            if sl is None:
                continue
            rr, cc = np.nonzero(lab[sl] == li)
            rr = rr + sl[0].start
            cc = cc + sl[1].start
            # World coords of strip cells (cell centres).
            X = tx0 + (cc + 0.5) * GRID_RES
            Y = ty1 - (rr + 0.5) * GRID_RES
            pts = np.column_stack([X, Y])
            ctr = pts.mean(0)
            try:
                _, s, vt = np.linalg.svd(pts - ctr, full_matrices=False)
            except np.linalg.LinAlgError:
                continue
            if vt.shape[0] < 2 or not np.isfinite(vt).all():
                continue
            proj1 = (pts - ctr) @ vt[0]      # along major axis
            proj2 = (pts - ctr) @ vt[1]      # across
            length = float(proj1.max() - proj1.min())
            width = float(proj2.max() - proj2.min())
            if not (np.isfinite(length) and np.isfinite(width)):
                continue
            if length < HEDGE_MIN_LENGTH_M or width > HEDGE_MAX_WIDTH_M:
                continue
            if length / max(width, 1e-3) < HEDGE_MIN_ELONGATION:
                continue
            # Centreline endpoints along the major axis.
            p_lo = ctr + vt[0] * proj1.min()
            p_hi = ctr + vt[0] * proj1.max()
            mean_h = float(np.nanmean(height[rr, cc]))
            line_2193 = LineString([tuple(p_lo), tuple(p_hi)])
            line_4326 = shapely_transform(TO_4326.transform, line_2193)
            hedges.append({
                "geometry": line_4326,
                "length_m": round(length, 1),
                "width_m": round(width, 1),
                "mean_height_m": round(mean_h, 1),
                "area_m2": round(area, 1),
            })
        if ti % 25 == 0 or ti == len(tiles):
            print(f"  [{ti}/{len(tiles)}] {tile.name}: {len(hedges):,} hedges "
                  f"({time.time()-t0:.0f}s)", flush=True)

    print(f"Writing {len(hedges):,} hedge segments ...", flush=True)
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_pointcloud_hedges_pilot")
        conn.execute("""
            CREATE TABLE tree_pointcloud_hedges_pilot (
                hedge_id TEXT PRIMARY KEY, length_m REAL, width_m REAL,
                mean_height_m REAL, area_m2 REAL,
                lon1 REAL, lat1 REAL, lon2 REAL, lat2 REAL, created_at_utc TEXT
            )""")
        created = utc_now()
        rows = []
        for i, hd in enumerate(hedges):
            (lon1, lat1), (lon2, lat2) = list(hd["geometry"].coords)
            rows.append((f"hedge_{i+1:06d}", hd["length_m"], hd["width_m"],
                         hd["mean_height_m"], hd["area_m2"],
                         round(lon1, 6), round(lat1, 6), round(lon2, 6), round(lat2, 6), created))
        conn.executemany(
            "INSERT INTO tree_pointcloud_hedges_pilot VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
        conn.commit()
    finally:
        conn.close()

    feats = [{
        "type": "Feature", "id": f"hedge_{i+1:06d}",
        "properties": {k: hd[k] for k in ("length_m", "width_m", "mean_height_m", "area_m2")},
        "geometry": {"type": "LineString",
                     "coordinates": [list(c) for c in hd["geometry"].coords]},
    } for i, hd in enumerate(hedges)]
    (PROCESSED / "pointcloud_hedges_pilot.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")),
        encoding="utf-8")

    total_len = sum(hd["length_m"] for hd in hedges)
    print(json.dumps({
        "hedge_segments": len(hedges),
        "total_length_m": round(total_len),
        "median_length_m": round(float(np.median([hd["length_m"] for hd in hedges])), 1) if hedges else 0,
        "tiles": len(tiles),
        "elapsed_s": round(time.time() - t0),
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
