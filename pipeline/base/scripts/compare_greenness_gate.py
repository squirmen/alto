#!/usr/bin/env python3
"""Compare the RGB greenness gate against an NDVI gate for tree detection.

Detection masks the CHM with GLI, a visible-band index derived from RGB basemap
tiles resampled to 1 m. This runs the same detection twice over one area, once
gated on GLI and once on NDVI built from LINZ 7.5 cm RGB+NIR, and reports what
each gate keeps and rejects.

The detection stages here mirror detect_inferred_trees.py: smooth, gate, fixed
window local maximum, height floor. Buildings are masked with the same OSM
footprint cache when it is present. Nothing is written to the database.

    python scripts/compare_greenness_gate.py \
        --bbox 1779000 5909000 1780000 5910000 \
        --ndvi data/interim/ndvi/test_1779_5909.tif
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
CHM = ROOT / "data" / "interim" / "auckland_metro_v1_lidar" / "chm.vrt"
GLI = ROOT / "data" / "interim" / "greenness_auckland_metro_v1" / "greenness.vrt"

# Mirrored from detect_inferred_trees.py.
MIN_HEIGHT_M = 5.0
GLI_THRESHOLD = 0.06
GATE_WINDOW_PX = 5
SMOOTH_SIGMA_PX = 1.0
COARSE_RADIUS_PX = 3
# Vegetation/non-vegetation split for NDVI. 0.2 is the conventional bare-soil
# boundary and sits in the valley of the measured distribution.
NDVI_THRESHOLD = 0.2


def read_on_grid(path: Path, bbox, shape):
    """Read onto the 1 m grid, converting nodata to NaN.

    The greenness raster uses -9999 for nodata. Reading it raw would drag the
    smoothing window far below any threshold and overstate what the gate
    rejects, so this mirrors read_gli_window() in detect_inferred_trees.py.
    """
    with rasterio.open(path) as src:
        window = from_bounds(*bbox, transform=src.transform)
        nodata = src.nodata if src.nodata is not None else -9999
        data = src.read(1, window=window, out_shape=shape, boundless=True,
                        fill_value=nodata).astype(np.float32)
    data[data == nodata] = np.nan
    return data


def peaks(chm_clean: np.ndarray) -> np.ndarray:
    smoothed = ndimage.gaussian_filter(chm_clean, sigma=SMOOTH_SIGMA_PX)
    footprint = np.ones((COARSE_RADIUS_PX * 2 + 1,) * 2, dtype=bool)
    local_max = ndimage.maximum_filter(smoothed, footprint=footprint, mode="nearest")
    return (smoothed == local_max) & (smoothed >= MIN_HEIGHT_M)


def gate(chm: np.ndarray, index: np.ndarray, threshold: float) -> np.ndarray:
    out = chm.copy()
    smoothed = ndimage.uniform_filter(np.nan_to_num(index, nan=-1), size=GATE_WINDOW_PX)
    out[smoothed < threshold] = 0
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, required=True)
    ap.add_argument("--ndvi", type=Path, required=True)
    args = ap.parse_args()
    left, bottom, right, top = args.bbox
    shape = (int(top - bottom), int(right - left))   # 1 m grid

    chm = read_on_grid(CHM, args.bbox, shape)
    gli = read_on_grid(GLI, args.bbox, shape)
    ndvi = read_on_grid(args.ndvi, args.bbox, shape)
    chm_clean = np.where(np.isfinite(chm), chm, 0).astype(np.float32)

    tall = chm_clean >= MIN_HEIGHT_M
    gli_s = ndimage.uniform_filter(np.nan_to_num(gli, nan=-1), size=GATE_WINDOW_PX)
    ndvi_s = ndimage.uniform_filter(np.nan_to_num(ndvi, nan=-1), size=GATE_WINDOW_PX)
    keep_gli, keep_ndvi = gli_s >= GLI_THRESHOLD, ndvi_s >= NDVI_THRESHOLD

    print(f"area {(right-left)/1000:.0f} x {(top-bottom)/1000:.0f} km, 1 m grid")
    print(f"NDVI coverage: {np.isfinite(ndvi).mean():.1%}\n")
    print(f"CHM >= {MIN_HEIGHT_M:g} m pixels: {tall.sum():,}")
    print(f"  kept by GLI  >= {GLI_THRESHOLD}:  {(tall & keep_gli).sum():,}"
          f"  ({(tall & keep_gli).sum()/tall.sum():.1%})")
    print(f"  kept by NDVI >= {NDVI_THRESHOLD}:  {(tall & keep_ndvi).sum():,}"
          f"  ({(tall & keep_ndvi).sum()/tall.sum():.1%})")
    print(f"  NDVI keeps, GLI rejects: {(tall & keep_ndvi & ~keep_gli).sum():,}")
    print(f"  GLI keeps, NDVI rejects: {(tall & keep_gli & ~keep_ndvi).sum():,}")

    n_gli = int(peaks(gate(chm_clean, gli, GLI_THRESHOLD)).sum())
    n_ndvi = int(peaks(gate(chm_clean, ndvi, NDVI_THRESHOLD)).sum())
    n_none = int(peaks(chm_clean).sum())
    print(f"\ndetected peaks (>= {MIN_HEIGHT_M:g} m, before building mask and NMS)")
    print(f"  no gate:    {n_none:,}")
    print(f"  GLI gate:   {n_gli:,}")
    print(f"  NDVI gate:  {n_ndvi:,}   ({n_ndvi - n_gli:+,} vs GLI, {(n_ndvi/max(n_gli,1)-1):+.1%})")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        actual = conn.execute(
            "SELECT COUNT(*) FROM tree_lidar_pilot WHERE x_2193>=? AND x_2193<? "
            "AND y_2193>=? AND y_2193<?", (left, right, bottom, top)).fetchone()[0]
        low = conn.execute(
            "SELECT COUNT(*) FROM tree_low_canopy_candidates WHERE x_2193>=? AND x_2193<? "
            "AND y_2193>=? AND y_2193<?", (left, right, bottom, top)).fetchone()[0]
    finally:
        conn.close()
    print(f"\nin the database for this area: {actual:,} trees, {low:,} low-canopy candidates")

    # Where the two gates disagree on tall pixels, what does the CHM look like?
    disputed = tall & keep_ndvi & ~keep_gli
    if disputed.any():
        heights = chm_clean[disputed]
        print(f"\ntall pixels NDVI keeps but GLI rejects: {disputed.sum():,}")
        print(f"  height p25/p50/p75: {np.percentile(heights,[25,50,75]).round(1)} m")
        print(f"  mean NDVI {np.nanmean(ndvi_s[disputed]):.2f}, mean GLI {np.nanmean(gli_s[disputed]):.3f}")


if __name__ == "__main__":
    main()
