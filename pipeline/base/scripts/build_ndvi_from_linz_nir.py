#!/usr/bin/env python3
"""Build an NDVI raster on the CHM grid from LINZ 7.5 cm RGB+NIR aerial imagery.

Detection currently gates the CHM with GLI, a visible-band greenness index
computed from RGB basemap tiles resampled to 1 m. GLI has to separate canopy
from roofs using red, green and blue alone, which it does poorly in shadow and
on green-grey roofing.

LINZ publishes a five-band (R, G, B, NIR, alpha) 7.5 cm product for Auckland as
Cloud Optimised GeoTIFFs on a public S3 bucket, so NDVI is available for the
same extent at no cost. The tiles are read as windows through /vsicurl and
averaged down to the CHM grid, so a run touches only the bytes it needs rather
than mirroring roughly three terabytes.

    python scripts/build_ndvi_from_linz_nir.py --bbox 1757000 5916000 1759000 5918000
    python scripts/build_ndvi_from_linz_nir.py --like-chm --out data/interim/ndvi/ndvi.tif
"""

from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window, from_bounds

# Read only the bytes each window needs; without this GDAL lists whole prefixes.
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tiff,.tif")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")

ROOT = Path(__file__).resolve().parents[1]
BUCKET = "https://nz-imagery.s3-ap-southeast-2.amazonaws.com"
SURVEY = "auckland/auckland_2024_0.075m/rgbnir/2193"

# LINZ Topo50 sheet lettering omits I and O.
LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
SHEET_W, SHEET_H = 24_000.0, 36_000.0      # metres, 1:50 000 sheet
TILE_W, TILE_H = 480.0, 720.0              # metres, 1:1 000 tile at 0.075 m
GRID_X0, GRID_Y0 = 988_000.0, 6_810_000.0  # NZTM origin of the sheet grid


def tile_name(x: float, y: float) -> str:
    """LINZ 1:1 000 tile name covering an NZTM (EPSG:2193) point."""
    col = int((x - GRID_X0) // SHEET_W)
    sheet_index = int((GRID_Y0 - y) // SHEET_H)
    sheet = LETTERS[sheet_index // 24] + LETTERS[sheet_index % 24] + f"{col:02d}"
    sx = GRID_X0 + col * SHEET_W
    sy = GRID_Y0 - sheet_index * SHEET_H
    c = int((x - sx) // TILE_W) + 1
    r = int((sy - y) // TILE_H) + 1
    return f"{sheet}_1000_{r:02d}{c:02d}"


def tiles_for_bbox(left: float, bottom: float, right: float, top: float) -> list[str]:
    names = []
    y = bottom
    while y < top + TILE_H:
        x = left
        while x < right + TILE_W:
            name = tile_name(x, y)
            if name not in names:
                names.append(name)
            x += TILE_W
        y += TILE_H
    return names


def ndvi_for_window(url: str, bounds, out_shape) -> tuple[np.ndarray, np.ndarray] | None:
    """Mean NDVI over `bounds`, averaged from 7.5 cm onto `out_shape`.

    Averaging the reflectance bands before the ratio, rather than averaging
    per-pixel NDVI, keeps the result consistent with how a coarser sensor would
    integrate the same ground area.
    """
    try:
        with rasterio.open(url) as src:
            window = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
            if window.width < 1 or window.height < 1:
                return None
            full = Window(0, 0, src.width, src.height)
            window = window.intersection(full)
            if window.width < 1 or window.height < 1:
                return None
            data = src.read(
                [1, 4, 5], window=window, out_shape=(3, out_shape[0], out_shape[1]),
                resampling=Resampling.average, boundless=False,
            ).astype(np.float32)
    except Exception as exc:  # missing tile, transient S3 error
        print(f"    skip {url.rsplit('/', 1)[-1]}: {str(exc)[:80]}")
        return None
    red, nir, alpha = data
    valid = alpha > 127
    denominator = nir + red
    ndvi = np.where(valid & (denominator > 0), (nir - red) / np.maximum(denominator, 1e-6), np.nan)
    return ndvi, valid


def build_tiled(bbox, out_dir: Path, resolution: float, skip_existing: bool = True) -> None:
    """Write one NDVI raster per source tile, then a VRT over them.

    A single metropolitan array at 1 m would be 42,000 x 40,000 float32, or
    6.7 GB resident before anything is written. Per-tile outputs keep the run
    to one tile in memory and make it resumable.
    """
    left, bottom, right, top = bbox
    names = tiles_for_bbox(left, bottom, right, top)
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"{len(names):,} LINZ tiles -> {out_dir}")
    written, skipped, missing = [], 0, 0
    failures: dict[str, list[str]] = {}
    for i, name in enumerate(names, 1):
        dest = out_dir / f"{name}.tif"
        if skip_existing and dest.exists() and dest.stat().st_size > 0:
            written.append(dest)
            skipped += 1
            continue
        url = f"/vsicurl/{BUCKET}/{SURVEY}/{name}.tiff"
        try:
            with rasterio.open(url) as src:
                tb = src.bounds
        except Exception as exc:
            # Distinguish a tile the survey does not contain from a transient
            # network failure. Counting both as "unavailable" once hid 1,376
            # sleep-induced dropouts behind a plausible-looking total.
            reason = "absent" if "404" in str(exc) else "error"
            failures.setdefault(reason, []).append(name)
            missing += 1
            continue
        # Clip to the requested bbox so edge tiles do not extend past it.
        ix0, iy0 = max(left, tb.left), max(bottom, tb.bottom)
        ix1, iy1 = min(right, tb.right), min(top, tb.top)
        if ix1 <= ix0 or iy1 <= iy0:
            continue
        width = int(round((ix1 - ix0) / resolution))
        height = int(round((iy1 - iy0) / resolution))
        if width < 1 or height < 1:
            continue
        result = ndvi_for_window(url, (ix0, iy0, ix1, iy1), (height, width))
        if result is None:
            missing += 1
            continue
        ndvi, _ = result
        transform = rasterio.transform.from_origin(ix0, iy1, resolution, resolution)
        with rasterio.open(dest, "w", driver="GTiff", height=height, width=width,
                           count=1, dtype="float32", crs="EPSG:2193",
                           transform=transform, nodata=-9999.0,
                           compress="deflate", tiled=True) as dst:
            dst.write(np.where(np.isfinite(ndvi), ndvi, -9999.0).astype("float32"), 1)
        written.append(dest)
        if i % 100 == 0 or i == len(names):
            print(f"  [{i:,}/{len(names):,}] {len(written):,} written, "
                  f"{skipped:,} already present, {missing:,} unavailable", flush=True)

    if not written:
        print("nothing written")
        return
    vrt = out_dir / "ndvi.vrt"
    listing = out_dir / "_tiles.txt"
    listing.write_text("\n".join(str(p) for p in written), encoding="utf-8")
    subprocess.run(["gdalbuildvrt", "-overwrite", "-input_file_list", str(listing), str(vrt)],
                   capture_output=True, check=False)
    if failures:
        print()
        for reason, names in sorted(failures.items()):
            label = ("not in the survey" if reason == "absent"
                     else "FAILED - transient, re-run to retry")
            print(f"  {len(names):,} tiles {label}; first: {', '.join(names[:3])}")
        if "error" in failures:
            unresolved = out_dir / "_failed_tiles.txt"
            unresolved.write_text("\n".join(failures["error"]), encoding="utf-8")
            print(f"  wrote {unresolved}")
    print(f"\n{len(written):,} tiles ({skipped:,} reused, {missing:,} unavailable)")
    print(f"VRT: {vrt}")


def build(bbox, out_path: Path, resolution: float) -> None:
    left, bottom, right, top = bbox
    width = int(round((right - left) / resolution))
    height = int(round((top - bottom) / resolution))
    transform = rasterio.transform.from_origin(left, top, resolution, resolution)
    out = np.full((height, width), np.nan, dtype=np.float32)

    names = tiles_for_bbox(left, bottom, right, top)
    print(f"bbox {left:.0f} {bottom:.0f} {right:.0f} {top:.0f}  ->  {len(names)} LINZ tiles")
    filled = 0
    for i, name in enumerate(names, 1):
        url = f"/vsicurl/{BUCKET}/{SURVEY}/{name}.tiff"
        # Destination sub-window this tile can contribute to.
        with_bounds = None
        try:
            with rasterio.open(url) as src:
                tb = src.bounds
        except Exception as exc:
            print(f"  [{i}/{len(names)}] {name}: unavailable ({str(exc)[:60]})")
            continue
        ix0, iy0 = max(left, tb.left), max(bottom, tb.bottom)
        ix1, iy1 = min(right, tb.right), min(top, tb.top)
        if ix1 <= ix0 or iy1 <= iy0:
            continue
        col0 = int(round((ix0 - left) / resolution))
        col1 = int(round((ix1 - left) / resolution))
        row0 = int(round((top - iy1) / resolution))
        row1 = int(round((top - iy0) / resolution))
        shape = (row1 - row0, col1 - col0)
        if shape[0] < 1 or shape[1] < 1:
            continue
        with_bounds = (ix0, iy0, ix1, iy1)
        result = ndvi_for_window(url, with_bounds, shape)
        if result is None:
            continue
        ndvi, valid = result
        target = out[row0:row1, col0:col1]
        out[row0:row1, col0:col1] = np.where(np.isfinite(ndvi), ndvi, target)
        filled += 1
        print(f"  [{i}/{len(names)}] {name}  {shape[1]}x{shape[0]} px")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        out_path, "w", driver="GTiff", height=height, width=width, count=1,
        dtype="float32", crs="EPSG:2193", transform=transform, nodata=np.nan,
        compress="deflate", tiled=True,
    ) as dst:
        dst.write(out, 1)
    coverage = float(np.isfinite(out).mean())
    print(f"\n{filled}/{len(names)} tiles read · coverage {coverage:.1%} · -> {out_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("LEFT", "BOTTOM", "RIGHT", "TOP"),
                    help="NZTM / EPSG:2193 bounds")
    ap.add_argument("--resolution", type=float, default=1.0,
                    help="output pixel size in metres (default 1.0, matching the CHM)")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "interim" / "ndvi" / "ndvi.tif")
    ap.add_argument("--tiled", action="store_true",
                    help="write one raster per source tile plus a VRT; required at "
                         "metropolitan extent, where a single array would not fit in memory")
    ap.add_argument("--out-dir", type=Path,
                    default=ROOT / "data" / "interim" / "ndvi_auckland_metro_v1")
    args = ap.parse_args()
    if not args.bbox:
        ap.error("--bbox is required")
    if args.tiled:
        build_tiled(tuple(args.bbox), args.out_dir, args.resolution)
    else:
        build(tuple(args.bbox), args.out, args.resolution)


if __name__ == "__main__":
    main()
