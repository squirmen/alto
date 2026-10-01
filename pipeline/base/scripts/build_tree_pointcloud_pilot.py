#!/usr/bin/env python3
"""Per-tree point-cloud attributes from the classified LiDAR LAZ tiles.

For **every** tree in the pilot — both those with a segmented crown polygon and
those flagged with no canopy — sample the LINZ 2024 classified point cloud over
its footprint and summarise the per-point signals the 1 m DSM/DEM raster throws
away:

  - class composition: ground / vegetation (3,4,5) / building (6) / water /
    noise / unclassified
  - return structure (NumberOfReturns > 1 = canopy penetration)
  - intensity
  - true 3-D canopy geometry: top height, base height, mean height, vertical
    spread and a relief ratio (vigour proxy), all above a local ground
    reference (the lowest non-noise return in the footprint)

From these we derive, per tree:
  pointcloud_class ∈ {vegetation, low_vegetation, building, structure,
                      mixed, sparse, no_data}
  is_vegetation / is_building flags
  pc_canopy_present  — real woody canopy ≥ PC_CANOPY_MIN_M above ground
  pc_false_positive  — high-confidence building/structure under a "tree"

These feed:
  * false-positive control — inferred "trees" that are really buildings, ships,
    cranes; and council/no-crown records whose footprint has no woody canopy
    ("trees flagged with no canopy" that the point cloud confirms or rejects);
  * rescue of small real trees the 1 m CHM missed;
  * better age/health/species inputs (canopy height, penetration, intensity);
  * the web tree profile.

Footprint per tree:
  * crown polygon (data/processed/tree_crowns_pilot.geojson) when present;
  * otherwise a PC_NOCROWN_BUFFER_M circular buffer around the tree point.

Tile-driven for speed: each LAZ tile is read once; footprints overlapping the
tile are rasterised to a 1 m label grid and every point is binned to its tree
via integer pixel lookup. A footprint straddling tiles accumulates from each.

Reads LAZ tiles from data/raw/point_cloud_2024/<pilot>/ (override the root with
AKL_TREES_PC_ROOT). Writes table tree_pointcloud_pilot + a JSON summary.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import laspy
from pyproj import Transformer
from rasterio import features as rio_features
from rasterio.transform import from_origin
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
GRID_RES = 1.0          # m label grid
PC_NOCROWN_BUFFER_M = 3.0   # footprint radius for trees with no crown polygon

# ASPRS classes
VEG = (3, 4, 5)         # low / medium / high vegetation
GROUND_CLS = 2
BUILDING_CLS = 6
WATER_CLS = 9
NOISE = (7, 18)         # low point + high noise
UNCLASS = (0, 1)

# Verdict thresholds
MIN_POINTS = 30          # below this -> sparse / no_data
VEG_DOMINANT = 0.60      # veg / (veg+building) >= -> vegetation-leaning
BUILDING_DOMINANT = 0.30 # veg / (veg+building) <= -> building/structure-leaning
PC_CANOPY_MIN_M = 2.5    # canopy top above ground to count as woody canopy
# Vegetation must also be a meaningful share of ALL returns. Ships/cranes have
# zero class-6 building points (hulls land in class 1 unclassified), so the
# veg/(veg+building) ratio reads 1.0 off a handful of misclassified points —
# observed at the port: 18 veg points among 2,912 returns on a moored vessel
# passing the old `veg >= 8` test. Any real tree dwarfs 5% cover.
PC_CANOPY_MIN_COVER = 0.05

# ---- Canopy-structure metrics (single pass) -------------------------------
# Vertical foliage profile: per-tree histogram of vegetation returns in 1 m
# bins of ABSOLUTE elevation, sliced to height-above-ground at the end (the
# ground reference is only final once every tile is read, but a fixed absolute
# grid is tile-independent so one pass suffices). Auckland isthmus ground runs
# 0–~200 m (Maungawhau) + up to ~40 m of canopy → 0–300 m covers it.
PROFILE_ABS_MAX_M = 300
PROFILE_BIN_M = 1.0
PROFILE_N_BINS = int(PROFILE_ABS_MAX_M / PROFILE_BIN_M)
PROFILE_STORE_MAX_M = 45    # height-above-ground bins persisted for the web
# Height-to-live-crown: lowest sustained foliage layer above this height (skip
# grass/shrub noise right at ground).
HLC_MIN_M = 1.0
HLC_DENSITY_FRAC = 0.10     # bin must hold >=10% of the peak bin's returns
# Understory: foliage below the live-crown base that is a real second layer.
UNDERSTORY_MIN_FRAC = 0.15  # >=15% of returns sit below the crown base
# Distinct canopy layers: peaks in the smoothed profile separated by a valley.
LAYER_VALLEY_FRAC = 0.30
MIN_PIXELS_FOR_RUGOSITY = 4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_geometries() -> tuple[list[str], list, np.ndarray, np.ndarray, np.ndarray]:
    """Return (tree_ids, geoms_2193, bounds, area_m2, has_crown) for every
    pilot tree: crown polygon where present, else a buffered point."""
    print(f"Loading crowns from {CROWNS_GEOJSON.name} ...", flush=True)
    crown_geom: dict[str, object] = {}
    if CROWNS_GEOJSON.exists():
        data = json.loads(CROWNS_GEOJSON.read_text(encoding="utf-8"))
        for f in data.get("features", []):
            g = f.get("geometry")
            if not g:
                continue
            geom = shapely_transform(TO_2193.transform, shape(g))
            if geom.is_empty:
                continue
            tid = f.get("id") or f["properties"].get("tree_id")
            if tid:
                crown_geom[tid] = geom
    print(f"  {len(crown_geom):,} crown polygons", flush=True)

    print("Loading tree points from SQLite ...", flush=True)
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        rows = conn.execute(
            "SELECT tree_id, lon, lat FROM trees WHERE lon IS NOT NULL AND lat IS NOT NULL"
        ).fetchall()
    finally:
        conn.close()

    ids: list[str] = []
    geoms: list = []
    has_crown: list[int] = []
    for tid, lon, lat in rows:
        g = crown_geom.get(tid)
        if g is not None:
            ids.append(tid)
            geoms.append(g)
            has_crown.append(1)
        else:
            x, y = TO_2193.transform(lon, lat)
            ids.append(tid)
            geoms.append(Point(x, y).buffer(PC_NOCROWN_BUFFER_M))
            has_crown.append(0)

    bounds = np.array([g.bounds for g in geoms], dtype="float64")
    area = np.array([g.area for g in geoms], dtype="float64")
    print(f"  {len(ids):,} tree footprints "
          f"({sum(has_crown):,} crowns + {len(ids)-sum(has_crown):,} buffered points)",
          flush=True)
    return ids, geoms, bounds, area, np.asarray(has_crown, dtype="int8")


def derive_canopy_structure(abs_hist: np.ndarray, ground_ref: float | None,
                            total_veg: int) -> dict:
    """From a tree's absolute-elevation veg histogram + ground reference,
    derive the vertical-structure metrics: height-to-live-crown, understory
    presence, distinct canopy layers, and a compact height-above-ground
    foliage profile (for the web mini-chart). Returns None values when there
    isn't enough signal."""
    out = {"hlc": None, "understory": 0, "layers": None, "profile": None}
    if ground_ref is None or total_veg < 8:
        return out
    g = int(math.floor(ground_ref / PROFILE_BIN_M))
    prof = abs_hist[g:]                       # height-above-ground bins
    prof = prof[:int(PROFILE_STORE_MAX_M / PROFILE_BIN_M) + 5]
    if prof.sum() <= 0:
        return out
    peak = int(prof.max())
    if peak <= 0:
        return out
    thresh = HLC_DENSITY_FRAC * peak
    hmin_bin = int(HLC_MIN_M / PROFILE_BIN_M)
    # HLC: lowest bin above HLC_MIN_M where density clears the threshold and
    # the bin above also does (sustained, not a single stray return).
    hlc = None
    for b in range(hmin_bin, len(prof) - 1):
        if prof[b] >= thresh and prof[b + 1] >= thresh:
            hlc = b * PROFILE_BIN_M
            break
    if hlc is not None:
        base_bin = int(hlc / PROFILE_BIN_M)
        below = int(prof[hmin_bin:base_bin].sum())
        out["understory"] = int(below >= UNDERSTORY_MIN_FRAC * prof.sum() and base_bin > hmin_bin + 1)
    out["hlc"] = round(float(hlc), 1) if hlc is not None else None
    # Distinct layers: peaks in a width-3 smoothed profile separated by a
    # valley dropping below LAYER_VALLEY_FRAC of the running peak.
    if len(prof) >= 3:
        k = np.ones(3) / 3.0
        sm = np.convolve(prof.astype("float64"), k, mode="same")
        smax = sm.max()
        if smax > 0:
            # Count foliage runs: a layer starts when density rises above 25%
            # of the smoothed peak and ends when it drops into a valley below
            # LAYER_VALLEY_FRAC of the peak.
            layers, in_run = 0, False
            for v in sm:
                if v >= 0.25 * smax and not in_run:
                    layers += 1
                    in_run = True
                elif in_run and v < LAYER_VALLEY_FRAC * smax:
                    in_run = False
            out["layers"] = int(max(1, layers))
    # Compact stored profile: 1 m bins of height-above-ground, trailing zeros
    # trimmed, capped at PROFILE_STORE_MAX_M.
    store = prof[:int(PROFILE_STORE_MAX_M / PROFILE_BIN_M)].astype("int64")
    nz = np.nonzero(store)[0]
    if nz.size:
        out["profile"] = store[: nz[-1] + 1].tolist()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-tiles", type=int, default=0)
    args = ap.parse_args()
    if not PC_DIR.exists():
        raise SystemExit(f"point cloud dir not found: {PC_DIR}")
    # set(): a corrupt directory b-tree can yield duplicate dirents from
    # readdir; processing a tile twice would double-count every point in it.
    tiles = sorted(set(PC_DIR.glob("pc_*.laz")))
    if args.max_tiles:
        tiles = tiles[: args.max_tiles]
    if not tiles:
        raise SystemExit("no LAZ tiles present yet")

    ids, geoms, bnds, area, has_crown = load_geometries()
    n = len(ids)

    # Per-tree integer/real accumulators (streamable across tiles).
    tot = np.zeros(n, dtype="int64")
    n_ground = np.zeros(n, dtype="int64")
    n_veg = np.zeros(n, dtype="int64")
    n_building = np.zeros(n, dtype="int64")
    n_water = np.zeros(n, dtype="int64")
    n_noise = np.zeros(n, dtype="int64")
    n_unclass = np.zeros(n, dtype="int64")
    n_multi = np.zeros(n, dtype="int64")
    inten_sum = np.zeros(n, dtype="float64")
    # Ground reference: lowest non-noise return anywhere in the footprint.
    allz_min = np.full(n, np.inf, dtype="float64")
    # Vegetation Z statistics (absolute elevation, m).
    vz_count = np.zeros(n, dtype="int64")
    vz_sum = np.zeros(n, dtype="float64")
    vz_sumsq = np.zeros(n, dtype="float64")
    vz_min = np.full(n, np.inf, dtype="float64")
    vz_max = np.full(n, -np.inf, dtype="float64")
    # Canopy cover / gap: first-return statistics (a first return that hits
    # vegetation = canopy closure; one that reaches ground = a gap).
    n_first = np.zeros(n, dtype="int64")
    n_first_veg = np.zeros(n, dtype="int64")
    # Vertical foliage profile: per-tree histogram of veg returns in 1 m bins
    # of absolute elevation (flattened tree*PROFILE_N_BINS + zbin).
    veg_abs_hist = np.zeros(n * PROFILE_N_BINS, dtype="int32")
    # Canopy rugosity: per-pixel canopy-top heights → std across the crown.
    # Accumulate sum / sumsq / count of per-pixel max veg elevations (std is
    # shift-invariant so absolute elevation is fine).
    top_sum = np.zeros(n, dtype="float64")
    top_sumsq = np.zeros(n, dtype="float64")
    top_cnt = np.zeros(n, dtype="int64")

    print(f"Processing {len(tiles)} tiles ...", flush=True)
    t0 = time.time()
    for ti, tile in enumerate(tiles, 1):
        # Tile bbox from the LAZ header (cheap, no point read) so this works
        # for any tiling — native 1:1,000 tiles, a custom grid, whatever.
        try:
            hdr = laspy.open(tile).header
            tx0, ty0 = float(hdr.x_min), float(hdr.y_min)
            tx1, ty1 = float(hdr.x_max), float(hdr.y_max)
        except Exception as e:  # noqa: BLE001 — keep going on a bad tile
            print(f"  [{ti}/{len(tiles)}] {tile.name}: header error {e}", flush=True)
            continue
        # Footprints whose bbox intersects this tile.
        sel = np.where((bnds[:, 0] <= tx1) & (bnds[:, 2] >= tx0) &
                       (bnds[:, 1] <= ty1) & (bnds[:, 3] >= ty0))[0]
        if sel.size == 0:
            continue
        try:
            las = laspy.read(tile)
        except Exception as e:  # noqa: BLE001 — keep going on a bad tile
            print(f"  [{ti}/{len(tiles)}] {tile.name}: read error {e}", flush=True)
            continue
        px = np.asarray(las.x)
        py = np.asarray(las.y)
        pz = np.asarray(las.z)
        cls = np.asarray(las.classification)
        nret = np.asarray(las.number_of_returns)
        rnum = np.asarray(las.return_number)
        inten = np.asarray(las.intensity).astype("float64")

        # Label grid over the tile (1 m); burn footprint index+1.
        w = int(round((tx1 - tx0) / GRID_RES))
        h = int(round((ty1 - ty0) / GRID_RES))
        transform = from_origin(tx0, ty1, GRID_RES, GRID_RES)
        shapes = [(geoms[i], i + 1) for i in sel]
        labels = rio_features.rasterize(
            shapes, out_shape=(h, w), transform=transform,
            fill=0, dtype="int32", all_touched=True)

        col = ((px - tx0) / GRID_RES).astype("int64")
        row = ((ty1 - py) / GRID_RES).astype("int64")
        inb = (col >= 0) & (col < w) & (row >= 0) & (row < h)
        if not inb.any():
            continue
        lab = labels[row[inb], col[inb]]
        hit = lab > 0
        if not hit.any():
            continue
        ci = lab[hit] - 1                 # footprint index per point
        pcls = cls[inb][hit]
        pz_h = pz[inb][hit]
        is_noise = np.isin(pcls, NOISE)
        keep = ~is_noise                  # exclude noise from all stats but n_noise

        np.add.at(n_noise, ci[is_noise], 1)

        ckeep = ci[keep]
        pcls_k = pcls[keep]
        pz_k = pz_h[keep]
        np.add.at(tot, ckeep, 1)
        np.add.at(n_ground, ckeep, (pcls_k == GROUND_CLS))
        veg_mask = np.isin(pcls_k, VEG)
        np.add.at(n_veg, ckeep, veg_mask)
        np.add.at(n_building, ckeep, (pcls_k == BUILDING_CLS))
        np.add.at(n_water, ckeep, (pcls_k == WATER_CLS))
        np.add.at(n_unclass, ckeep, np.isin(pcls_k, UNCLASS))
        np.add.at(n_multi, ckeep, (nret[inb][hit][keep] > 1))
        np.add.at(inten_sum, ckeep, inten[inb][hit][keep])
        np.minimum.at(allz_min, ckeep, pz_k)

        # Vegetation Z stats.
        cv = ckeep[veg_mask]
        zv = pz_k[veg_mask]
        np.add.at(vz_count, cv, 1)
        np.add.at(vz_sum, cv, zv)
        np.add.at(vz_sumsq, cv, zv * zv)
        np.minimum.at(vz_min, cv, zv)
        np.maximum.at(vz_max, cv, zv)

        # Canopy cover / gap from first returns.
        first_keep = rnum[inb][hit][keep] == 1
        np.add.at(n_first, ckeep, first_keep)
        np.add.at(n_first_veg, ckeep, first_keep & veg_mask)

        # Vertical foliage profile (absolute-Z histogram per tree).
        zbin = np.clip(np.floor(zv / PROFILE_BIN_M).astype("int64"),
                       0, PROFILE_N_BINS - 1)
        np.add.at(veg_abs_hist, cv * PROFILE_N_BINS + zbin, 1)

        # Canopy rugosity: max veg elevation per 1 m pixel, then sum/sumsq/count
        # per owning tree (labels grid is single-valued per pixel).
        vrow = row[inb][hit][keep][veg_mask]
        vcol = col[inb][hit][keep][veg_mask]
        pid = vrow * w + vcol
        pixmax = np.full(h * w, -np.inf, dtype="float64")
        np.maximum.at(pixmax, pid, zv)
        upid = np.unique(pid)
        ptree = labels.reshape(-1)[upid] - 1
        valid = ptree >= 0
        ptree = ptree[valid]
        ptop = pixmax[upid][valid]
        np.add.at(top_sum, ptree, ptop)
        np.add.at(top_sumsq, ptree, ptop * ptop)
        np.add.at(top_cnt, ptree, 1)

        if ti % 10 == 0 or ti == len(tiles):
            print(f"  [{ti}/{len(tiles)}] {tile.name}  ({time.time()-t0:.0f}s)", flush=True)

    # ---- Derive per-tree metrics + verdict.
    print("Deriving verdicts ...", flush=True)
    rows_out = []
    created = utc_now()
    counts: dict[str, int] = defaultdict(int)
    for i, tid in enumerate(ids):
        t = int(tot[i])
        veg = int(n_veg[i])
        bld = int(n_building[i])
        denom = veg + bld
        veg_frac = (veg / denom) if denom > 0 else None
        multi_frac = (n_multi[i] / t) if t > 0 else None
        inten_mean = (inten_sum[i] / t) if t > 0 else None
        veg_cover = (veg / t) if t > 0 else None
        pt_density = (t / area[i]) if area[i] > 0 else None

        ground_ref = allz_min[i] if np.isfinite(allz_min[i]) else None
        canopy_top = canopy_base = canopy_mean = canopy_std = relief = None
        if vz_count[i] > 0 and ground_ref is not None:
            vmean = vz_sum[i] / vz_count[i]
            var = max(0.0, vz_sumsq[i] / vz_count[i] - vmean * vmean)
            canopy_top = float(vz_max[i] - ground_ref)
            canopy_base = float(vz_min[i] - ground_ref)
            canopy_mean = float(vmean - ground_ref)
            canopy_std = float(math.sqrt(var))
            span = vz_max[i] - vz_min[i]
            relief = float((vmean - vz_min[i]) / span) if span > 1e-6 else None

        canopy_present = bool(
            canopy_top is not None and canopy_top >= PC_CANOPY_MIN_M and veg >= 8
            and veg_cover is not None and veg_cover >= PC_CANOPY_MIN_COVER)

        # Verdict.
        if t == 0:
            verdict = "no_data"
        elif t < MIN_POINTS:
            verdict = "sparse"
        elif veg_frac is None:
            verdict = "mixed"
        elif veg_frac >= VEG_DOMINANT:
            verdict = "vegetation" if canopy_present else "low_vegetation"
        elif veg_frac <= BUILDING_DOMINANT:
            verdict = "building" if bld >= veg else "structure"
        else:
            verdict = "mixed"
        counts[verdict] += 1

        # High-confidence false positive: enough returns, no woody canopy, and
        # the footprint is dominated by non-vegetation. The verdict catches the
        # classified-building/structure case; the veg_cover test also catches
        # unclassified rooftops (LINZ sometimes leaves building points class 1),
        # which would otherwise slip through as "mixed". Authoritative records
        # are never deleted on this flag — only inferred ones (see apply step).
        false_positive = bool(
            t >= MIN_POINTS and not canopy_present and (
                verdict in ("building", "structure")
                or (veg_cover is not None and veg_cover < 0.20)
            ))

        def r(v, d=2):
            return round(v, d) if v is not None else None

        # ---- Canopy-structure metrics.
        cover = (n_first_veg[i] / n_first[i]) if n_first[i] > 0 else None
        gap = (1.0 - cover) if cover is not None else None
        rugosity = None
        if top_cnt[i] >= MIN_PIXELS_FOR_RUGOSITY:
            tmean = top_sum[i] / top_cnt[i]
            tvar = max(0.0, top_sumsq[i] / top_cnt[i] - tmean * tmean)
            rugosity = math.sqrt(tvar)
        struct = derive_canopy_structure(
            veg_abs_hist[i * PROFILE_N_BINS:(i + 1) * PROFILE_N_BINS],
            ground_ref, veg)
        profile_json = json.dumps(struct["profile"]) if struct["profile"] else None

        rows_out.append((
            tid, t, int(n_ground[i]), veg, bld, int(n_water[i]),
            int(n_noise[i]), int(n_unclass[i]),
            r(veg_frac, 3), r(veg_cover, 3), r(multi_frac, 3),
            r(inten_mean, 1), r(pt_density, 2),
            r(canopy_top), r(canopy_base), r(canopy_mean), r(canopy_std),
            r(relief, 3),
            int(canopy_present), int(verdict == "vegetation"),
            int(verdict in ("building", "structure")), int(false_positive),
            verdict, created,
            r(cover, 3), r(gap, 3), struct["hlc"], int(struct["understory"]),
            struct["layers"], r(rugosity, 2), profile_json,
        ))

    print("Writing tree_pointcloud_pilot ...", flush=True)
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_pointcloud_pilot")
        conn.execute("""
            CREATE TABLE tree_pointcloud_pilot (
                tree_id TEXT PRIMARY KEY,
                n_points INTEGER, n_ground INTEGER, n_vegetation INTEGER,
                n_building INTEGER, n_water INTEGER, n_noise INTEGER,
                n_unclassified INTEGER,
                veg_fraction REAL, veg_cover REAL, multireturn_fraction REAL,
                intensity_mean REAL, point_density REAL,
                canopy_top_m REAL, canopy_base_m REAL, canopy_mean_m REAL,
                canopy_std_m REAL, canopy_relief_ratio REAL,
                pc_canopy_present INTEGER, is_vegetation INTEGER,
                is_building INTEGER, pc_false_positive INTEGER,
                pointcloud_class TEXT, created_at_utc TEXT,
                canopy_cover REAL, gap_fraction REAL,
                height_to_live_crown_m REAL, understory_present INTEGER,
                n_canopy_layers INTEGER, canopy_rugosity_m REAL,
                foliage_profile TEXT
            )""")
        conn.executemany(
            "INSERT INTO tree_pointcloud_pilot VALUES (" + ",".join("?" * 31) + ")",
            rows_out)
        conn.execute("CREATE INDEX idx_pc_class ON tree_pointcloud_pilot(pointcloud_class)")
        conn.execute("CREATE INDEX idx_pc_fp ON tree_pointcloud_pilot(pc_false_positive)")
        conn.commit()
    finally:
        conn.close()

    summary = {
        "trees": n,
        "crowns": int(has_crown.sum()),
        "buffered_points": int(n - has_crown.sum()),
        "tiles": len(tiles),
        "verdicts": dict(counts),
        "with_points": int((tot > 0).sum()),
        "canopy_present": int(sum(r[18] for r in rows_out)),
        "false_positive": int(sum(r[21] for r in rows_out)),
        "with_cover": int(sum(1 for r in rows_out if r[24] is not None)),
        "with_hlc": int(sum(1 for r in rows_out if r[26] is not None)),
        "understory": int(sum(r[27] for r in rows_out)),
        "multi_layer": int(sum(1 for r in rows_out if r[28] and r[28] > 1)),
        "elapsed_s": round(time.time() - t0),
    }
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
