#!/usr/bin/env python3
"""Build a canopy height model from the classified point cloud.

The pipeline's CHM is derived from LINZ's published 1 m DSM, which is a
smoothed surface product. Measured over a 34 ha tile, detecting on that DSM
finds 1,324 crown peaks where the same detection over a CHM gridded straight
from the returns finds 2,316. The difference is not resolution: the smoothing
merges adjacent crowns, which is the dominant cause of under-detection in dense
street planting.

Gridding raw maxima instead trades that for noise, so this does three things
the naive version does not:

- drops LAS noise classes 7 and 18, which are present in these tiles and put
  spurious returns above the canopy,
- despikes, removing cells that stand far above every neighbour and so cannot
  be part of a crown surface,
- fills small pits, the holes left where a laser pulse penetrated to the ground
  through a crown and the cell took a near-ground maximum.

Writes to its own directory and never touches the existing CHM, which another
project reads.

    python scripts/build_chm_from_pointcloud.py --tiles pc_BB32_1000_0149.laz
    python scripts/build_chm_from_pointcloud.py --bbox 1779000 5909000 1780000 5910000
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
LAZ_ROOT = Path("/data/alto/point_cloud_2024/auckland_metro_v1")
OUT_DIR = ROOT / "data" / "interim" / "auckland_metro_v1_chm_pc"

# LAS 1.4: 7 = low point (noise), 18 = high noise. Both are present in these
# tiles and both sit above the canopy surface if left in.
NOISE_CLASSES = (7, 18)
MAX_HEIGHT_M = 60.0
# A cell more than this far above the highest of its eight neighbours is not a
# crown surface. Real canopy is locally continuous at 1 m; a lone return is not.
SPIKE_MARGIN_M = 4.0
PIT_MAX_ITER = 2


def tile_bounds(name: str) -> tuple[float, float, float, float] | None:
    for line in (LAZ_ROOT / "manifest.jsonl").open(encoding="utf-8"):
        rec = json.loads(line)
        if rec.get("tile") == name:
            _, x0, y0, x1, y1 = rec["bbox_2193"]
            return x0, y0, x1, y1
    return None


def tiles_for_bbox(bbox) -> list[str]:
    left, bottom, right, top = bbox
    out = []
    for line in (LAZ_ROOT / "manifest.jsonl").open(encoding="utf-8"):
        rec = json.loads(line)
        _, x0, y0, x1, y1 = rec["bbox_2193"]
        if x1 > left and x0 < right and y1 > bottom and y0 < top:
            out.append(rec["tile"])
    return sorted(set(out))


def grid_tile(laz: Path, out_tif: Path, resolution: float) -> bool:
    """Grid height-above-ground maxima for one tile via PDAL."""
    ignore = "".join(f'{{"type":"filters.range","limits":"Classification![{c}:{c}]"}},'
                     for c in NOISE_CLASSES)
    pipeline = (
        '{"pipeline":['
        f'{{"type":"readers.las","filename":"{laz}"}},'
        f'{ignore}'
        '{"type":"filters.hag_nn"},'
        f'{{"type":"filters.range","limits":"HeightAboveGround[0:{MAX_HEIGHT_M}]"}},'
        f'{{"type":"writers.gdal","filename":"{out_tif}","dimension":"HeightAboveGround",'
        f'"output_type":"max","resolution":{resolution},"gdaldriver":"GTiff",'
        '"nodata":-9999,"window_size":3}]}'
    )
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        fh.write(pipeline)
        spec = fh.name
    try:
        result = subprocess.run(["pdal", "pipeline", spec], capture_output=True, text=True)
    finally:
        Path(spec).unlink(missing_ok=True)
    if result.returncode != 0:
        print(f"    pdal failed: {result.stderr.strip()[:160]}")
        return False
    return out_tif.exists()


def despike_and_fill(path: Path) -> dict:
    with rasterio.open(path) as src:
        chm = src.read(1).astype("float32")
        profile = src.profile
        nodata = src.nodata if src.nodata is not None else -9999
    data = np.where(chm == nodata, np.nan, chm)

    # Despike: compare each cell against the maximum of its eight neighbours.
    filled = np.nan_to_num(data, nan=-9999.0)
    footprint = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=bool)
    neighbour_max = ndimage.maximum_filter(filled, footprint=footprint, mode="nearest")
    spikes = np.isfinite(data) & (data - neighbour_max > SPIKE_MARGIN_M)
    data[spikes] = np.nan

    # Pit fill: a cell markedly lower than its surrounding canopy took a pulse
    # that reached through the crown. Raise it to the neighbourhood median.
    pits_filled = 0
    for _ in range(PIT_MAX_ITER):
        valid = np.isfinite(data)
        work = np.where(valid, data, np.nan)
        med = ndimage.generic_filter(
            np.nan_to_num(work, nan=0.0), np.median, size=3, mode="nearest")
        neighbours = ndimage.uniform_filter(valid.astype("float32"), size=3, mode="nearest")
        pit = valid & (med - data > SPIKE_MARGIN_M) & (neighbours > 0.8)
        if not pit.any():
            break
        data[pit] = med[pit]
        pits_filled += int(pit.sum())

    # PDAL writes untiled strips whose block size is not a multiple of 16, so
    # drop the inherited blocking before asking for a tiled output.
    profile.pop("blockxsize", None)
    profile.pop("blockysize", None)
    profile.update(dtype="float32", nodata=nodata, compress="deflate", tiled=False)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(np.where(np.isfinite(data), data, nodata).astype("float32"), 1)
    return {"spikes_removed": int(spikes.sum()), "pits_filled": pits_filled}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", nargs="*", help="LAZ file names")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("L", "B", "R", "T"))
    ap.add_argument("--resolution", type=float, default=1.0)
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR)
    ap.add_argument("--no-clean", action="store_true", help="skip despike and pit fill")
    args = ap.parse_args()

    if args.bbox:
        names = tiles_for_bbox(tuple(args.bbox))
    elif args.tiles:
        names = args.tiles
    else:
        ap.error("give --tiles or --bbox")
    if not names:
        print("no LAZ tiles cover that area")
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    print(f"{len(names)} tile(s) at {args.resolution} m -> {args.out_dir}")
    built, stats = [], {"spikes_removed": 0, "pits_filled": 0}
    for i, name in enumerate(names, 1):
        laz = LAZ_ROOT / name
        if not laz.exists():
            print(f"  [{i}/{len(names)}] {name}: missing")
            continue
        out_tif = args.out_dir / f"{Path(name).stem}.tif"
        if not grid_tile(laz, out_tif, args.resolution):
            continue
        if not args.no_clean:
            s = despike_and_fill(out_tif)
            stats["spikes_removed"] += s["spikes_removed"]
            stats["pits_filled"] += s["pits_filled"]
            print(f"  [{i}/{len(names)}] {name}  spikes {s['spikes_removed']:,} "
                  f"pits {s['pits_filled']:,}")
        else:
            print(f"  [{i}/{len(names)}] {name}")
        built.append(out_tif)

    if not built:
        print("nothing built")
        return 1
    vrt = args.out_dir / "chm.vrt"
    subprocess.run(["gdalbuildvrt", "-overwrite", str(vrt), *[str(p) for p in built]],
                   capture_output=True, check=False)
    print(f"\nbuilt {len(built)} tile(s); despiked {stats['spikes_removed']:,} cells, "
          f"filled {stats['pits_filled']:,} pits")
    print(f"VRT: {vrt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
