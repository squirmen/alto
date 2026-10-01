#!/usr/bin/env python3
"""Fetch historic Auckland LiDAR (DSM + DEM) via the LINZ Exports API and
build a historic CHM aligned to the current 2024 CHM grid.

Requires a LINZ API key with the "Query layer data and Exports API" scope.
Pass it via --key or the LINZ_API_KEY env var.

Historic layers (1 m, EPSG:2193):
  2013:  DSM layer-53406,  DEM layer-53405          (single, covers isthmus)
  2016:  DSM North layer-105089 + South layer-104382
         DEM North layer-106410 + South layer-104318  (mosaic N+S)

Flow per layer:
  1. POST /services/api/v1.x/exports/  (item + extent + GeoTIFF format)
  2. poll GET /exports/{id}/ until complete
  3. download the result zip, extract the GeoTIFF
Then: CHM_historic = DSM_historic - DEM_historic, reprojected/resampled onto
the exact grid of the current pilot CHM, written as a GeoTIFF + VRT.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.warp import Resampling, reproject

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name, active_pilot_bbox  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
_PILOT_NAME = active_pilot_name()
_PILOT_SLUG = "waitemata_lidar_pilot" if _PILOT_NAME == "waitemata_v1" else f"{_PILOT_NAME}_lidar"
CURRENT_CHM_VRT = ROOT / "data" / "interim" / _PILOT_SLUG / "chm.vrt"
RAW_ROOT = ROOT / "data" / "raw" / "linz_historic_lidar"
INTERIM_ROOT = ROOT / "data" / "interim" / f"historic_chm_{_PILOT_NAME}"

API_BASE = "https://data.linz.govt.nz/services/api/v1.x"

YEAR_LAYERS = {
    2013: {"dsm": [53406], "dem": [53405]},
    2016: {"dsm": [105089, 104382], "dem": [106410, 104318]},
}

POLL_INTERVAL_S = 10
POLL_MAX_MIN = 30


def headers(key: str) -> dict[str, str]:
    return {"Authorization": f"key {key}", "Content-Type": "application/json"}


def bbox_4326_polygon() -> dict[str, Any]:
    bb = active_pilot_bbox()
    tf = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    # full ring from the 4 corners
    corners = [tf.transform(bb[0], bb[1]), tf.transform(bb[2], bb[1]),
               tf.transform(bb[2], bb[3]), tf.transform(bb[0], bb[3]), tf.transform(bb[0], bb[1])]
    return {"type": "Polygon", "coordinates": [[[round(x, 6), round(y, 6)] for x, y in corners]]}


def request_export(key: str, layer_id: int, extent: dict[str, Any]) -> str:
    payload = {
        "crs": "EPSG:2193",
        "items": [{"item": f"{API_BASE}/layers/{layer_id}/"}],
        "extent": extent,
        "formats": {"grid": "image/tiff;subtype=geotiff"},
    }
    r = requests.post(f"{API_BASE}/exports/", headers=headers(key), data=json.dumps(payload), timeout=60)
    if r.status_code not in (200, 201, 202):
        raise RuntimeError(f"export request for layer {layer_id} failed: HTTP {r.status_code} {r.text[:300]}")
    data = r.json()
    export_id = data.get("id")
    print(f"    layer {layer_id}: export id {export_id} ({data.get('state','?')})")
    return str(export_id)


def poll_export(key: str, export_id: str) -> str:
    deadline = time.time() + POLL_MAX_MIN * 60
    while time.time() < deadline:
        r = requests.get(f"{API_BASE}/exports/{export_id}/", headers=headers(key), timeout=60)
        r.raise_for_status()
        d = r.json()
        state = d.get("state")
        if state == "complete":
            return d.get("download_url") or f"{API_BASE}/exports/{export_id}/download/"
        if state in ("cancelled", "error", "gone"):
            raise RuntimeError(f"export {export_id} ended in state {state}: {d}")
        print(f"      export {export_id}: {state} … waiting")
        time.sleep(POLL_INTERVAL_S)
    raise RuntimeError(f"export {export_id} did not complete within {POLL_MAX_MIN} min")


def download_geotiff(key: str, url: str, out_dir: Path, tag: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    r = requests.get(url, headers={"Authorization": f"key {key}"}, timeout=600)
    r.raise_for_status()
    # Result is usually a zip; sometimes a bare tiff.
    content = r.content
    if content[:2] == b"PK":
        zf = zipfile.ZipFile(io.BytesIO(content))
        tif_name = next((n for n in zf.namelist() if n.lower().endswith((".tif", ".tiff"))), None)
        if not tif_name:
            raise RuntimeError(f"no GeoTIFF inside export zip for {tag}: {zf.namelist()}")
        path = out_dir / f"{tag}.tif"
        path.write_bytes(zf.read(tif_name))
    else:
        path = out_dir / f"{tag}.tif"
        path.write_bytes(content)
    print(f"      saved {tag}: {path.stat().st_size/1e6:.1f} MB")
    return path


def fetch_layer_set(key: str, layer_ids: list[int], extent: dict[str, Any], tag: str) -> list[Path]:
    paths = []
    for lid in layer_ids:
        cached = RAW_ROOT / f"{tag}_{lid}.tif"
        if cached.exists() and cached.stat().st_size > 0:
            print(f"    layer {lid}: cached")
            paths.append(cached)
            continue
        eid = request_export(key, lid, extent)
        url = poll_export(key, eid)
        p = download_geotiff(key, url, RAW_ROOT, f"{tag}_{lid}")
        paths.append(p)
    return paths


def reproject_onto_current(src_paths: list[Path], dst_path: Path) -> None:
    """Mosaic the source GeoTIFFs and resample onto the current CHM grid."""
    with rasterio.open(CURRENT_CHM_VRT) as ref:
        dst_transform = ref.transform
        dst_crs = ref.crs
        dst_h, dst_w = ref.height, ref.width
    out = np.full((dst_h, dst_w), np.nan, dtype="float32")
    for sp in src_paths:
        with rasterio.open(sp) as src:
            band = src.read(1).astype("float32")
            nd = src.nodata
            if nd is not None:
                band[band == nd] = np.nan
            tmp = np.full((dst_h, dst_w), np.nan, dtype="float32")
            reproject(
                source=band, destination=tmp,
                src_transform=src.transform, src_crs=src.crs,
                dst_transform=dst_transform, dst_crs=dst_crs,
                resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan,
            )
        out = np.where(np.isfinite(out), out, tmp)
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        "driver": "GTiff", "height": dst_h, "width": dst_w, "count": 1,
        "dtype": "float32", "crs": dst_crs, "transform": dst_transform,
        "nodata": -9999, "compress": "deflate", "tiled": True,
        "blockxsize": 256, "blockysize": 256,
    }
    with rasterio.open(dst_path, "w", **profile) as d:
        d.write(np.where(np.isfinite(out), out, -9999).astype("float32"), 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2013, choices=sorted(YEAR_LAYERS))
    ap.add_argument("--key", default=os.environ.get("LINZ_API_KEY"))
    args = ap.parse_args()
    if not args.key:
        raise SystemExit("LINZ API key required (--key or LINZ_API_KEY)")
    if not CURRENT_CHM_VRT.exists():
        raise SystemExit(f"current CHM not found: {CURRENT_CHM_VRT} (run lidar-pilot first)")

    extent = bbox_4326_polygon()
    layers = YEAR_LAYERS[args.year]
    print(f"Fetching historic LiDAR {args.year} for pilot '{_PILOT_NAME}' ...")
    print("  DSM layers ...")
    dsm_paths = fetch_layer_set(args.key, layers["dsm"], extent, f"dsm_{args.year}")
    print("  DEM layers ...")
    dem_paths = fetch_layer_set(args.key, layers["dem"], extent, f"dem_{args.year}")

    print("  building aligned historic DSM / DEM mosaics ...")
    INTERIM_ROOT.mkdir(parents=True, exist_ok=True)
    dsm_aligned = INTERIM_ROOT / f"dsm_{args.year}_aligned.tif"
    dem_aligned = INTERIM_ROOT / f"dem_{args.year}_aligned.tif"
    reproject_onto_current(dsm_paths, dsm_aligned)
    reproject_onto_current(dem_paths, dem_aligned)

    print("  computing historic CHM = DSM - DEM ...")
    with rasterio.open(dsm_aligned) as ds, rasterio.open(dem_aligned) as de:
        dsm = ds.read(1).astype("float32")
        dsm[dsm == ds.nodata] = np.nan
        dem = de.read(1).astype("float32")
        dem[dem == de.nodata] = np.nan
        profile = ds.profile.copy()
    chm = dsm - dem
    chm[(chm < -1) | (chm > 80)] = np.nan
    chm = np.where(chm < 0, 0, chm)
    chm_path = INTERIM_ROOT / f"chm_{args.year}.tif"
    profile.update(nodata=-9999, compress="deflate")
    with rasterio.open(chm_path, "w", **profile) as d:
        d.write(np.where(np.isfinite(chm), chm, -9999).astype("float32"), 1)
    valid = int(np.isfinite(chm).sum())
    print(json.dumps({
        "year": args.year,
        "historic_chm": str(chm_path.relative_to(ROOT)),
        "valid_pixels": valid,
        "canopy_pixels_ge_3m": int((chm >= 3).sum()),
        "next": f"python scripts/build_growth_change.py --historic-chm {chm_path} --historic-year {args.year}",
    }, indent=2))


if __name__ == "__main__":
    main()
