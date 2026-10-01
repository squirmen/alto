#!/usr/bin/env python3
"""Point-cloud-native individual tree detection (ITD) — prototype.

A real upgrade over the current 1 m DSM-DEM watershed, runnable on CPU (no GPU,
no deep learning). Uses the full-density classified returns directly:

  1. fine 0.5 m canopy-height model from the MAX vegetation-class (3/4/5) return
     minus a coarse ground surface — sharper than the 1 m DSM and free of
     buildings (class filtered), which is where the current method merges/splits;
  2. variable-window local maxima on the smoothed CHM = tree apexes (markers);
  3. marker-controlled watershed (scipy IFT) floods each crown to its apex,
     separating touching crowns the raster blob-watershed fused;
  4. polygonise each basin → crown.

This is the Dalponte/Li-style ITD that production ALS tools use. It does NOT
touch the inventory — it writes `itd_prototype_crowns.geojson` and prints a
comparison against the existing crowns in the same footprint so we can judge
whether to roll it out.

Run on a sample: AKL_TREES_PC_ROOT=... python pointcloud_itd_prototype.py --max-tiles 16
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
import laspy
from pyproj import Transformer
from rasterio import features as rio_features
from rasterio.transform import from_origin
from scipy import ndimage
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402
from build_pointcloud_missed_trees import ground_surface  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
SQLITE_PATH = PROCESSED / "akl_trees.sqlite"
_PILOT = active_pilot_name()
_PC_ROOT = Path(os.environ.get("AKL_TREES_PC_ROOT", ROOT / "data" / "raw" / "point_cloud_2024"))
PC_DIR = _PC_ROOT / _PILOT
TO_4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)

RES = 0.5                 # canopy model resolution (m) — finer than the 1 m DSM
VEG = (3, 4, 5)
MIN_TREE_HEIGHT_M = 3.0
SMOOTH_SIGMA = 1.0        # in cells (0.5 m) → ~0.5 m
MIN_CROWN_CELLS = 12      # 12 * 0.25 m² = 3 m² min crown
GROUND_RES = 10.0


def suppression_radius_cells(h: float) -> int:
    """Variable-window NMS radius in 0.5 m cells (taller apex → wider window)."""
    return int(round(np.clip(2.5 + 0.22 * h, 3.0, 12.0) / RES))


def detect_tile(las, tx0, ty0, tx1, ty1):
    px = np.asarray(las.x)
    py = np.asarray(las.y)
    pz = np.asarray(las.z)
    cls = np.asarray(las.classification)
    w = int(round((tx1 - tx0) / RES))
    h = int(round((ty1 - ty0) / RES))
    if w <= 0 or h <= 0:
        return [], 0
    # Coarse ground (reuse helper; it grids at GROUND_RES then upsamples to a
    # 1 m grid — resample to our 0.5 m grid by nearest).
    g1 = ground_surface(px, py, pz, cls, tx0, ty1,
                        int(round((tx1 - tx0))), int(round((ty1 - ty0))))
    if g1 is None:
        return [], 0
    ground = np.repeat(np.repeat(g1, 2, axis=0), 2, axis=1)[:h, :w]

    col = ((px - tx0) / RES).astype("int64")
    row = ((ty1 - py) / RES).astype("int64")
    inb = (col >= 0) & (col < w) & (row >= 0) & (row < h)
    veg = np.isin(cls, VEG) & inb
    if not veg.any():
        return [], 0
    vpid = row[veg] * w + col[veg]
    vtop = np.full(h * w, -np.inf)
    np.maximum.at(vtop, vpid, pz[veg])
    vtop = vtop.reshape(h, w)
    chm = np.where(np.isfinite(vtop), vtop - ground, 0.0)
    chm[chm < 0] = 0.0
    chm = ndimage.gaussian_filter(chm.astype("float32"), SMOOTH_SIGMA)

    canopy = chm >= MIN_TREE_HEIGHT_M
    if not canopy.any():
        return [], 0

    # Variable-window local maxima → apex markers (tall peaks claim first).
    coarse = ndimage.maximum_filter(chm, size=7, mode="nearest")
    cand = (chm == coarse) & canopy
    rr, cc = np.nonzero(cand)
    order = np.argsort(-chm[rr, cc])
    rr, cc = rr[order], cc[order]
    markers = np.zeros((h, w), dtype="int32")
    taken = np.zeros((h, w), dtype=bool)
    mid = 0
    for r0, c0 in zip(rr, cc):
        if taken[r0, c0]:
            continue
        srad = suppression_radius_cells(float(chm[r0, c0]))
        r1, r2 = max(0, r0 - srad), min(h, r0 + srad + 1)
        c1, c2 = max(0, c0 - srad), min(w, c0 + srad + 1)
        if taken[r1:r2, c1:c2].any():
            continue
        mid += 1
        markers[r0, c0] = mid
        taken[r1:r2, c1:c2] = True
    if mid == 0:
        return [], 0

    # Marker-controlled watershed on the inverted CHM (apexes = low cost basins).
    cost = (255 * (1 - chm / max(chm.max(), 1e-6))).astype("uint8")
    cost[~canopy] = 255
    labels = ndimage.watershed_ift(cost, markers)
    labels[~canopy] = 0

    sizes = np.bincount(labels.ravel())
    transform = from_origin(tx0, ty1, RES, RES)
    # Union polygon pieces per label so one crown = one tree (= one apex).
    pieces: dict[int, list] = {}
    for geom, val in rio_features.shapes(labels.astype("int32"),
                                         mask=labels > 0, transform=transform, connectivity=4):
        lbl = int(val)
        if lbl <= 0 or sizes[lbl] < MIN_CROWN_CELLS:
            continue
        poly = shape(geom)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if not poly.is_empty:
            pieces.setdefault(lbl, []).append(poly)
    crowns = []
    for parts in pieces.values():
        u = unary_union(parts) if len(parts) > 1 else parts[0]
        if not u.is_empty:
            crowns.append(u)
    # Apex world coords (tree tops) for recall scoring.
    ar, ac = np.nonzero(markers > 0)
    apex_xy = np.column_stack([tx0 + (ac + 0.5) * RES, ty1 - (ar + 0.5) * RES])
    return crowns, apex_xy


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-tiles", type=int, default=16)
    args = ap.parse_args()
    tiles = sorted(set(PC_DIR.glob("pc_*.laz")))
    # Pick a contiguous leafy sample from the middle of the set.
    if args.max_tiles and len(tiles) > args.max_tiles:
        mid = len(tiles) // 2
        tiles = tiles[mid: mid + args.max_tiles]
    print(f"ITD prototype on {len(tiles)} tiles", flush=True)

    all_crowns = []
    apexes = []
    footprints = []          # actual processed tile bounds (not the spanning bbox)
    bbox = [1e12, 1e12, -1e12, -1e12]
    t0 = time.time()
    for ti, tile in enumerate(tiles, 1):
        try:
            hdr = laspy.open(tile).header
            tx0, ty0, tx1, ty1 = float(hdr.x_min), float(hdr.y_min), float(hdr.x_max), float(hdr.y_max)
            las = laspy.read(tile)
        except Exception as e:  # noqa: BLE001
            print(f"  {tile.name}: {e}", flush=True)
            continue
        crowns, apex_xy = detect_tile(las, tx0, ty0, tx1, ty1)
        all_crowns.extend(crowns)
        if len(apex_xy):
            apexes.append(apex_xy)
        footprints.append((tx0, ty0, tx1, ty1))
        bbox = [min(bbox[0], tx0), min(bbox[1], ty0), max(bbox[2], tx1), max(bbox[3], ty1)]
        print(f"  [{ti}/{len(tiles)}] {tile.name}: {len(crowns)} crowns ({time.time()-t0:.0f}s)", flush=True)
    apexes = np.vstack(apexes) if apexes else np.empty((0, 2))
    n_apex = len(apexes)

    # Write prototype crowns (4326).
    feats = []
    for i, poly in enumerate(all_crowns):
        p4326 = shapely_transform(TO_4326.transform, poly)
        feats.append({"type": "Feature", "id": f"itd_{i+1}",
                      "properties": {"area_m2": round(poly.area, 1)},
                      "geometry": mapping(p4326)})
    (PROCESSED / "itd_prototype_crowns.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")),
        encoding="utf-8")

    # ---- Quality vs ground truth: recall against FIELD-VERIFIED council trees
    # that actually fall inside a PROCESSED tile footprint (not the spanning
    # rectangle, which would include unprocessed gaps when tiles aren't contiguous).
    from scipy.spatial import cKDTree
    def in_footprint(x, y):
        for fx0, fy0, fx1, fy1 in footprints:
            if fx0 <= x <= fx1 and fy0 <= y <= fy1:
                return True
        return False
    conn = sqlite3.connect(SQLITE_PATH)
    verified_all = conn.execute(f"""
        SELECT l.x_2193, l.y_2193 FROM trees t
        JOIN tree_lidar_pilot l ON l.tree_id = t.tree_id
        WHERE l.x_2193 BETWEEN {bbox[0]} AND {bbox[2]}
          AND l.y_2193 BETWEEN {bbox[1]} AND {bbox[3]}
          AND t.source_primary IN ('tree_register_points','notable_trees_overlay','ruru_obskauri_tiaki_public')
    """).fetchall()
    cur_rows = conn.execute(f"""
        SELECT l.x_2193, l.y_2193 FROM tree_crown_pilot c JOIN tree_lidar_pilot l ON l.tree_id=c.tree_id
        WHERE l.x_2193 BETWEEN {bbox[0]} AND {bbox[2]} AND l.y_2193 BETWEEN {bbox[1]} AND {bbox[3]}
    """).fetchall()
    conn.close()
    verified = [(x, y) for x, y in verified_all if in_footprint(x, y)]
    cur_all = sum(1 for x, y in cur_rows if in_footprint(x, y))

    recall = None
    if verified and n_apex:
        vxy = np.array(verified)
        kd = cKDTree(apexes)
        d, _ = kd.query(vxy, k=1)
        recall = round(100 * float((d <= 4.0).mean()), 1)

    areas = np.array([p.area for p in all_crowns]) if all_crowns else np.array([0])
    print(json.dumps({
        "tiles": len(tiles),
        "itd_trees_detected": n_apex,
        "itd_median_crown_m2": round(float(np.median(areas)), 1),
        "verified_council_trees_in_area": len(verified),
        "recall_pct_verified_with_apex_within_4m": recall,
        "current_crowns_in_area (all sources, incl sub-3m)": cur_all,
        "elapsed_s": round(time.time() - t0),
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
