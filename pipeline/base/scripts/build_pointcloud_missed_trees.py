#!/usr/bin/env python3
"""Detect trees the CHM pipeline missed, directly from the classified point cloud.

The existing detector (`detect_inferred_trees.py`) runs on the 1 m DSM−DEM CHM
and only fires at ``DETECTION_MIN_HEIGHT_M = 5 m``. Two whole classes of real
tree slip through it:

  1. Small / young trees 2.5–5 m tall — below the CHM detector's threshold.
  2. Trees the 1 m DSM smeared into a taller neighbour — full-density returns
     resolve the separate apex the raster blurred away.

This script works tile-by-tile on the LINZ 2024 classified LAZ:

  * canopy-height grid (1 m) from the MAX vegetation-class (3/4/5) return Z,
    referenced to a coarse ground surface built from class-2/9 returns;
  * mask out everything already covered by an existing tree footprint (crown
    polygon or the no-crown buffer) dilated by COVER_DILATE_M;
  * variable-window non-max suppression on the uncovered canopy-height grid
    (same idea as the CHM detector but on sharper point-cloud heights and down
    to MISSED_MIN_HEIGHT_M);
  * keep apexes with enough vegetation returns and real canopy penetration
    (multi-return), dedup against existing trees and across tiles.

Output is a REVIEW layer, deliberately NOT inserted into the canonical `trees`
table: `data/processed/pointcloud_missed_trees_pilot.geojson` and table
`tree_pointcloud_missed_pilot`. These are candidates to confirm, not facts.

Reads LAZ from data/raw/point_cloud_2024/<pilot>/ (override AKL_TREES_PC_ROOT).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import laspy
import rasterio
from pyproj import Transformer
from rasterio import features as rio_features
from rasterio.transform import from_origin
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import shape, Point
from shapely.ops import transform as shapely_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402

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
GREENNESS_VRT = ROOT / "data" / "interim" / (
    "greenness" if _PILOT == "waitemata_v1" else f"greenness_{_PILOT}") / "greenness.vrt"
# Aerial greenness gate: the point-cloud vegetation class is the primary
# evidence, but a finite-and-clearly-non-green pixel (asphalt/roof read as
# class-1 then mislabelled) is rejected for consistency with the CHM detector.
# A non-finite sample (no imagery coverage) is kept — LiDAR class is authoritative.
GLI_GATE = 0.03

GRID_RES = 1.0
GROUND_RES = 10.0          # coarse ground surface cell
VEG = (3, 4, 5)
GROUND_WATER = (2, 9)
MISSED_MIN_HEIGHT_M = 2.5  # below the CHM detector's 5 m floor
MIN_VEG_AT_APEX = 4        # veg returns in the apex cell's 3x3 window
MIN_MULTIRETURN_FRAC = 0.20
COVER_DILATE_M = 3.0       # grow existing footprints so we don't re-find them
DEDUP_EXISTING_M = 6.0     # apex must be this far from any existing tree
DEDUP_CROSS_TILE_M = 3.0
EXISTING_NOCROWN_BUFFER_M = 3.0
# A useful "missed tree" is an ISOLATED, tree-sized patch of uncovered canopy —
# a yard/street tree the inventory lacks. Local maxima *inside* continuous bush
# or forest are not individually useful (and the area is already represented by
# inferred trees), so we keep only connected uncovered-canopy components whose
# area is tree-scale and reject big blobs (forest) and linear shapes (hedges /
# wall ivy / roof edges).
MIN_PATCH_AREA_M2 = 9.0    # ~1.7 m crown radius; smaller = shrub/fragment
MAX_PATCH_AREA_M2 = 150.0  # ~7 m crown radius; bigger = bush/forest, excluded
MAX_PATCH_ASPECT = 3.5
MIN_PATCH_FILL = 0.30


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_existing_footprints():
    """All current tree footprints (crown polygon where present, else a buffered
    point) in EPSG:2193, plus their bounds and the seed-point KDTree for dedup."""
    crown_geom: dict[str, object] = {}
    if CROWNS_GEOJSON.exists():
        data = json.loads(CROWNS_GEOJSON.read_text(encoding="utf-8"))
        for f in data.get("features", []):
            g = f.get("geometry")
            if not g:
                continue
            geom = shapely_transform(TO_2193.transform, shape(g))
            if not geom.is_empty:
                tid = f.get("id") or f["properties"].get("tree_id")
                crown_geom[tid] = geom

    conn = sqlite3.connect(SQLITE_PATH)
    try:
        rows = conn.execute(
            "SELECT tree_id, lon, lat FROM trees WHERE lon IS NOT NULL AND lat IS NOT NULL"
        ).fetchall()
    finally:
        conn.close()

    geoms, seed_xy = [], []
    for tid, lon, lat in rows:
        x, y = TO_2193.transform(lon, lat)
        seed_xy.append((x, y))
        g = crown_geom.get(tid)
        geoms.append(g if g is not None else Point(x, y).buffer(EXISTING_NOCROWN_BUFFER_M))
    bounds = np.array([g.bounds for g in geoms], dtype="float64")
    seed_xy = np.array(seed_xy, dtype="float64")
    print(f"  {len(geoms):,} existing footprints "
          f"({len(crown_geom):,} crowns) for coverage + dedup", flush=True)
    return geoms, bounds, cKDTree(seed_xy)


def ground_surface(px, py, pz, cls, tx0, ty1, w, h):
    """Coarse (GROUND_RES) ground grid from class-2/9 returns, gap-filled by
    nearest neighbour and upsampled to the 1 m tile grid."""
    gw = int(math.ceil(w * GRID_RES / GROUND_RES))
    gh = int(math.ceil(h * GRID_RES / GROUND_RES))
    gmin = np.full(gh * gw, np.inf, dtype="float64")
    gmask = np.isin(cls, GROUND_WATER)
    if gmask.any():
        gc = ((px[gmask] - tx0) / GROUND_RES).astype("int64")
        gr = ((ty1 - py[gmask]) / GROUND_RES).astype("int64")
        ok = (gc >= 0) & (gc < gw) & (gr >= 0) & (gr < gh)
        np.minimum.at(gmin, gr[ok] * gw + gc[ok], pz[gmask][ok])
    grid = gmin.reshape(gh, gw)
    valid = np.isfinite(grid)
    if not valid.any():
        return None
    # Fill empty coarse cells from the nearest filled one.
    idx = ndimage.distance_transform_edt(~valid, return_distances=False,
                                         return_indices=True)
    grid = grid[tuple(idx)]
    # Upsample coarse → 1 m by nearest (ground is smooth; this is plenty).
    up = np.repeat(np.repeat(grid, int(GROUND_RES), axis=0),
                   int(GROUND_RES), axis=1)[:h, :w]
    return up


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

    print("Loading existing footprints ...", flush=True)
    geoms, bnds, existing_kd = load_existing_footprints()

    candidates: list[dict] = []
    emitted_xy = np.empty((0, 2), dtype="float64")
    print(f"Scanning {len(tiles)} tiles for missed canopy ...", flush=True)
    t0 = time.time()
    for ti, tile in enumerate(tiles, 1):
        try:
            hdr = laspy.open(tile).header
            tx0, ty0, tx1, ty1 = (float(hdr.x_min), float(hdr.y_min),
                                  float(hdr.x_max), float(hdr.y_max))
        except Exception as e:  # noqa: BLE001
            print(f"  [{ti}/{len(tiles)}] {tile.name}: header error {e}", flush=True)
            continue
        try:
            las = laspy.read(tile)
        except Exception as e:  # noqa: BLE001
            print(f"  [{ti}/{len(tiles)}] {tile.name}: read error {e}", flush=True)
            continue
        px = np.asarray(las.x)
        py = np.asarray(las.y)
        pz = np.asarray(las.z)
        cls = np.asarray(las.classification)
        nret = np.asarray(las.number_of_returns)
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

        # Canopy-top grid: max veg Z per cell.
        vtop = np.full(h * w, -np.inf, dtype="float64")
        np.maximum.at(vtop, vpid, pz[veg])
        vcount = np.bincount(vpid, minlength=h * w)
        vmulti = np.bincount(vpid[nret[veg] > 1], minlength=h * w)

        vtop2d = vtop.reshape(h, w)
        height = np.where(np.isfinite(vtop2d), vtop2d - ground, np.nan)

        # Coverage mask from existing footprints overlapping this tile.
        sel = np.where((bnds[:, 0] <= tx1) & (bnds[:, 2] >= tx0) &
                       (bnds[:, 1] <= ty1) & (bnds[:, 3] >= ty0))[0]
        transform = from_origin(tx0, ty1, GRID_RES, GRID_RES)
        covered = np.zeros((h, w), dtype=bool)
        if sel.size:
            cov = rio_features.rasterize(
                [(geoms[i].buffer(COVER_DILATE_M), 1) for i in sel],
                out_shape=(h, w), transform=transform, fill=0,
                dtype="uint8", all_touched=True)
            covered = cov.astype(bool)

        vcount2d = vcount.reshape(h, w)
        vm2 = vmulti.reshape(h, w)
        uncovered = (np.isfinite(height) & (height >= MISSED_MIN_HEIGHT_M)
                     & (~covered) & (vcount2d >= 2))
        if not uncovered.any():
            continue

        # Connected components of uncovered canopy; keep only isolated,
        # tree-sized, compact patches.
        lab, nlab = ndimage.label(uncovered)
        if nlab == 0:
            continue
        comp_area = np.bincount(lab.ravel())
        slices = ndimage.find_objects(lab)
        for li in range(1, nlab + 1):
            area = float(comp_area[li])
            if area < MIN_PATCH_AREA_M2 or area > MAX_PATCH_AREA_M2:
                continue
            sl = slices[li - 1]
            if sl is None:
                continue
            sub = lab[sl] == li
            bh, bw = sub.shape
            aspect = max(bh, bw) / max(min(bh, bw), 1)
            if aspect > MAX_PATCH_ASPECT or area / (bh * bw) < MIN_PATCH_FILL:
                continue
            # Reject fringe fragments: a genuine missed tree is an island in
            # non-canopy. If the patch is adjacent to an already-covered crown
            # it's just the uncovered lip of a known tree, not a new one.
            slp = (slice(max(0, sl[0].start - 1), min(h, sl[0].stop + 1)),
                   slice(max(0, sl[1].start - 1), min(w, sl[1].stop + 1)))
            if (ndimage.binary_dilation(lab[slp] == li) & covered[slp]).any():
                continue
            # Apex = tallest cell in the patch.
            subh = np.where(sub, height[sl], -np.inf)
            ar, ac = np.unravel_index(int(np.argmax(subh)), subh.shape)
            r0, c0 = sl[0].start + ar, sl[1].start + ac
            hgt = float(height[r0, c0])
            x = tx0 + (c0 + 0.5) * GRID_RES
            y = ty1 - (r0 + 0.5) * GRID_RES
            win = (slice(max(0, r0 - 1), r0 + 2), slice(max(0, c0 - 1), c0 + 2))
            veg_here = int(vcount2d[win].sum())
            if veg_here < MIN_VEG_AT_APEX:
                continue
            multi_frac = (vm2[win].sum() / veg_here) if veg_here else 0.0
            if multi_frac < MIN_MULTIRETURN_FRAC:
                continue
            if existing_kd.query([[x, y]], k=1)[0][0] <= DEDUP_EXISTING_M:
                continue
            if emitted_xy.size:
                d2 = (emitted_xy[:, 0] - x) ** 2 + (emitted_xy[:, 1] - y) ** 2
                if np.any(d2 <= DEDUP_CROSS_TILE_M * DEDUP_CROSS_TILE_M):
                    continue
            emitted_xy = np.append(emitted_xy, [[x, y]], axis=0)
            lon, lat = TO_4326.transform(x, y)
            candidates.append({
                "x": round(x, 2), "y": round(y, 2),
                "lon": round(lon, 6), "lat": round(lat, 6),
                "canopy_height_m": round(hgt, 1),
                "patch_area_m2": round(area, 1),
                "veg_returns": veg_here,
                "multireturn_fraction": round(float(multi_frac), 3),
                "sub5m": int(hgt < 5.0),
            })
        if ti % 25 == 0 or ti == len(tiles):
            print(f"  [{ti}/{len(tiles)}] {tile.name}: {len(candidates):,} candidates "
                  f"({time.time()-t0:.0f}s)", flush=True)

    # ---- Aerial greenness gate (drop clearly non-green, keep no-imagery).
    if candidates and GREENNESS_VRT.exists():
        with rasterio.open(GREENNESS_VRT) as gsrc:
            xy = [(c["x"], c["y"]) for c in candidates]
            gli = np.array([v[0] for v in gsrc.sample(xy)], dtype="float64")
            nod = gsrc.nodata
        kept = []
        dropped = 0
        for c, g in zip(candidates, gli):
            finite = np.isfinite(g) and (nod is None or g != nod)
            c["gli"] = round(float(g), 3) if finite else None
            if finite and g < GLI_GATE:
                dropped += 1
                continue
            kept.append(c)
        print(f"  greenness gate: dropped {dropped:,} non-green, kept {len(kept):,}", flush=True)
        candidates = kept
    else:
        for c in candidates:
            c["gli"] = None

    # ---- Write outputs.
    print(f"Writing {len(candidates):,} missed-tree candidates ...", flush=True)
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_pointcloud_missed_pilot")
        conn.execute("""
            CREATE TABLE tree_pointcloud_missed_pilot (
                candidate_id TEXT PRIMARY KEY,
                lon REAL, lat REAL, x_2193 REAL, y_2193 REAL,
                canopy_height_m REAL, patch_area_m2 REAL, veg_returns INTEGER,
                multireturn_fraction REAL, gli REAL, sub5m INTEGER,
                created_at_utc TEXT
            )""")
        created = utc_now()
        conn.executemany(
            "INSERT INTO tree_pointcloud_missed_pilot VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [(f"pcmiss_{i+1:06d}", c["lon"], c["lat"], c["x"], c["y"],
              c["canopy_height_m"], c["patch_area_m2"], c["veg_returns"],
              c["multireturn_fraction"], c["gli"], c["sub5m"], created)
             for i, c in enumerate(candidates)])
        conn.commit()
    finally:
        conn.close()

    feats = [{
        "type": "Feature", "id": f"pcmiss_{i+1:06d}",
        "properties": {k: c[k] for k in ("canopy_height_m", "patch_area_m2",
                                         "veg_returns", "multireturn_fraction", "gli", "sub5m")},
        "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
    } for i, c in enumerate(candidates)]
    (PROCESSED / "pointcloud_missed_trees_pilot.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats},
                   separators=(",", ":")), encoding="utf-8")

    sub5 = sum(c["sub5m"] for c in candidates)
    print(json.dumps({
        "missed_candidates": len(candidates),
        "sub_5m": sub5,
        "ge_5m_chm_should_have_caught": len(candidates) - sub5,
        "tiles": len(tiles),
        "elapsed_s": round(time.time() - t0),
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
