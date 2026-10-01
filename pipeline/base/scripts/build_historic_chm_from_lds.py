#!/usr/bin/env python3
"""Build a historic CHM from manually-downloaded LINZ LDS GeoTIFF zips.

This replaces the Exports-API path in ``fetch_historic_lidar.py`` for cases
where the LINZ Exports API returns only a tiny clipped strip (it did for the
auckland_isthmus_v1 bbox). Instead we use the full LDS regional GeoTIFF
archives downloaded by hand into
``data/raw/linz_historic_lidar/DSM_manualDL/`` and read the per-tile TIFs
straight out of the zips with GDAL ``/vsizip/`` — no extraction, so we don't
need ~12 GB of scratch disk for the 3,800+ tiles per archive.

Flow per year:
  1. List the .tif members of each DSM / DEM zip.
  2. Build an in-place ``/vsizip/`` VRT mosaic for DSM and for DEM.
  3. ``gdalwarp`` each VRT onto the exact grid (extent, 1 m res, EPSG:2193)
     of the current pilot CHM (``chm.vrt``), clipping to the pilot bbox.
  4. CHM_historic = DSM_aligned - DEM_aligned, clamped to [0, 80] m, written
     as a tiled/compressed GeoTIFF: ``chm_<year>.tif``.

Output matches ``fetch_historic_lidar.py`` exactly, so the downstream
``build_growth_change.py --historic-chm ... --historic-year ...`` step is
unchanged.

LDS archives expected in DSM_manualDL/ (filenames as downloaded):
  2013: lds-auckland-lidar-1m-{dsm,dem}-2013-GTiff.zip
  2016: lds-auckland-north-lidar-1m-{dsm,dem}-2016-2018-GTiff.zip
      + lds-auckland-south-lidar-1m-{dsm,dem}-2016-2017-GTiff.zip
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np
import rasterio

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
_PILOT_NAME = active_pilot_name()
_PILOT_SLUG = "waitemata_lidar_pilot" if _PILOT_NAME == "waitemata_v1" else f"{_PILOT_NAME}_lidar"
CURRENT_CHM_VRT = ROOT / "data" / "interim" / _PILOT_SLUG / "chm.vrt"
LDS_ROOT = ROOT / "data" / "raw" / "linz_historic_lidar" / "DSM_manualDL"
INTERIM_ROOT = ROOT / "data" / "interim" / f"historic_chm_{_PILOT_NAME}"

GDALBUILDVRT = "gdalbuildvrt"
GDALWARP = "gdalwarp"

# Which LDS archive zips supply DSM / DEM for each historic year. Multiple
# entries are mosaicked together (e.g. 2016 = north + south collects).
YEAR_ARCHIVES: dict[int, dict[str, list[str]]] = {
    2013: {
        "dsm": ["lds-auckland-lidar-1m-dsm-2013-GTiff.zip"],
        "dem": ["lds-auckland-lidar-1m-dem-2013-GTiff.zip"],
    },
    2016: {
        "dsm": [
            "lds-auckland-north-lidar-1m-dsm-2016-2018-GTiff.zip",
            "lds-auckland-south-lidar-1m-dsm-2016-2017-GTiff.zip",
        ],
        "dem": [
            "lds-auckland-north-lidar-1m-dem-2016-2018-GTiff.zip",
            "lds-auckland-south-lidar-1m-dem-2016-2017-GTiff.zip",
        ],
    },
}


def vsizip_tifs(zip_path: Path) -> list[str]:
    """Return /vsizip/ paths for every .tif member of an LDS archive."""
    if not zip_path.exists():
        raise SystemExit(f"LDS archive not found: {zip_path}")
    names = [n for n in zipfile.ZipFile(zip_path).namelist() if n.lower().endswith(".tif")]
    if not names:
        raise SystemExit(f"no .tif members inside {zip_path.name}")
    return [f"/vsizip/{zip_path}/{n}" for n in names]


def build_vrt(zips: list[str], tag: str) -> Path:
    """Build a single VRT mosaic over the tiles inside the given zips."""
    INTERIM_ROOT.mkdir(parents=True, exist_ok=True)
    members: list[str] = []
    for z in zips:
        members.extend(vsizip_tifs(LDS_ROOT / z))
    print(f"  {tag}: {len(members):,} tiles across {len(zips)} archive(s)")
    list_path = INTERIM_ROOT / f"{tag}_tiles.txt"
    list_path.write_text("\n".join(members), encoding="utf-8")
    vrt_path = INTERIM_ROOT / f"{tag}.vrt"
    subprocess.run(
        [GDALBUILDVRT, "-overwrite", "-input_file_list", str(list_path), str(vrt_path)],
        check=True, capture_output=True, text=True,
    )
    return vrt_path


def warp_to_grid(src_vrt: Path, dst_path: Path) -> None:
    """gdalwarp a source VRT onto the current pilot CHM grid + bbox."""
    with rasterio.open(CURRENT_CHM_VRT) as ref:
        xmin, ymin, xmax, ymax = ref.bounds
        xres, yres = ref.res
    subprocess.run(
        [
            GDALWARP, "-overwrite",
            "-t_srs", "EPSG:2193",
            "-te", str(xmin), str(ymin), str(xmax), str(ymax),
            "-tr", str(xres), str(yres),
            "-r", "bilinear",
            "-dstnodata", "-9999",
            "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
            "-co", "BLOCKXSIZE=256", "-co", "BLOCKYSIZE=256",
            "-multi", "-wo", "NUM_THREADS=ALL_CPUS",
            str(src_vrt), str(dst_path),
        ],
        check=True, capture_output=True, text=True,
    )


def compute_chm(dsm_aligned: Path, dem_aligned: Path, chm_path: Path) -> dict:
    """CHM = DSM - DEM, block-windowed to keep memory bounded."""
    with rasterio.open(dsm_aligned) as ds:
        profile = ds.profile.copy()
    profile.update(nodata=-9999, compress="deflate", tiled=True,
                   blockxsize=256, blockysize=256, dtype="float32")
    valid = 0
    canopy = 0
    with rasterio.open(dsm_aligned) as ds, rasterio.open(dem_aligned) as de, \
            rasterio.open(chm_path, "w", **profile) as out:
        for _, win in ds.block_windows(1):
            dsm = ds.read(1, window=win).astype("float32")
            dem = de.read(1, window=win).astype("float32")
            dsm[dsm == ds.nodata] = np.nan
            dem[dem == de.nodata] = np.nan
            chm = dsm - dem
            chm[(chm < -1) | (chm > 80)] = np.nan
            chm = np.where(chm < 0, 0, chm)
            finite = np.isfinite(chm)
            valid += int(finite.sum())
            canopy += int((finite & (chm >= 3)).sum())
            out.write(np.where(finite, chm, -9999).astype("float32"), 1, window=win)
    return {"valid_pixels": valid, "canopy_pixels_ge_3m": canopy}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2016, choices=sorted(YEAR_ARCHIVES))
    args = ap.parse_args()
    if not CURRENT_CHM_VRT.exists():
        raise SystemExit(f"current CHM not found: {CURRENT_CHM_VRT} (run lidar-pilot first)")

    arc = YEAR_ARCHIVES[args.year]
    print(f"Building historic CHM {args.year} for pilot '{_PILOT_NAME}' from LDS zips ...")
    dsm_vrt = build_vrt(arc["dsm"], f"dsm_{args.year}_lds")
    dem_vrt = build_vrt(arc["dem"], f"dem_{args.year}_lds")

    print("  warping DSM / DEM onto current CHM grid ...")
    dsm_aligned = INTERIM_ROOT / f"dsm_{args.year}_aligned.tif"
    dem_aligned = INTERIM_ROOT / f"dem_{args.year}_aligned.tif"
    warp_to_grid(dsm_vrt, dsm_aligned)
    warp_to_grid(dem_vrt, dem_aligned)

    print("  computing historic CHM = DSM - DEM ...")
    chm_path = INTERIM_ROOT / f"chm_{args.year}.tif"
    stats = compute_chm(dsm_aligned, dem_aligned, chm_path)
    print(json.dumps({
        "year": args.year,
        "source": "LDS manual GeoTIFF archives",
        "historic_chm": str(chm_path.relative_to(ROOT)),
        **stats,
        "next": f"python scripts/build_growth_change.py --historic-chm {chm_path} --historic-year {args.year}",
    }, indent=2))


if __name__ == "__main__":
    main()
