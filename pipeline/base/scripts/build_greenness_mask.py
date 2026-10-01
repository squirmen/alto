#!/usr/bin/env python3
"""Build a 1 m greenness raster aligned to the CHM grid.

Used downstream by ``detect_inferred_trees.py`` and ``build_tree_crown_pilot.py``
to reject CHM-derived "trees" that fall on visibly non-green pixels (cargo
containers, ships, gravel, motorway carriageways, etc.) — false positives the
OSM mask cannot catch on its own.

Approach:
1. Walk WebMercator XYZ tiles at zoom ``Z`` covering the pilot bbox.
2. Download RGB JPEG tiles from the Esri World Imagery service (publicly
   accessible without an API key).
3. Reproject each tile into EPSG:2193 and resample to the CHM 1 m grid.
4. Compute a simple visible Green Leaf Index per pixel:
       GLI = (2G - R - B) / (2G + R + B + eps)
   Healthy vegetation lands in roughly 0.05–0.45; bare ground, asphalt,
   containers, ships, and water sit ≤ 0.0.
5. Write per-chunk GeoTIFFs + a VRT mosaic.

This script is idempotent: tiles and chunks already on disk are reused.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject


ROOT = Path(__file__).resolve().parents[1]
RAW_ROOT = ROOT / "data" / "raw" / "esri_world_imagery"
from _pilot_config import active_pilot_name as _active_pilot_name  # noqa: E402
_PILOT_NAME = _active_pilot_name()
INTERIM_ROOT = ROOT / "data" / "interim" / ("greenness" if _PILOT_NAME == "waitemata_v1" else f"greenness_{_PILOT_NAME}")
TILE_DIR = RAW_ROOT / "tiles_z18"
CHUNK_DIR = INTERIM_ROOT / "chunks_1m"
VRT_PATH = INTERIM_ROOT / "greenness.vrt"

# Esri World Imagery is publicly accessible. Attribution: Source: Esri,
# DigitalGlobe, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS,
# AeroGRID, IGN, and the GIS User Community.
ESRI_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

from _pilot_config import DEFAULT_PILOT_BBOX_2193  # noqa: E402
TILE_ZOOM = 18
CHUNK_SIZE_M = 1024.0
DOWNLOAD_WORKERS = 12
DOWNLOAD_RETRIES = 4
DOWNLOAD_POLITE_S = 0.05  # per-worker sleep between requests


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def lonlat_to_tile_xy(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    sin_lat = math.sin(math.radians(lat))
    y = int((1 - math.log((1 + sin_lat) / (1 - sin_lat)) / (2 * math.pi)) / 2 * n)
    return x, y


def tile_xy_to_lonlat(x: int, y: int, zoom: int) -> tuple[float, float]:
    n = 2 ** zoom
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def tiles_for_bbox_2193(bbox: tuple[float, float, float, float], zoom: int) -> list[tuple[int, int]]:
    transformer = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    xmin, ymin, xmax, ymax = bbox
    corners = [
        transformer.transform(xmin, ymin),
        transformer.transform(xmax, ymin),
        transformer.transform(xmin, ymax),
        transformer.transform(xmax, ymax),
    ]
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    tx_min, ty_max = lonlat_to_tile_xy(min(lons), min(lats), zoom)
    tx_max, ty_min = lonlat_to_tile_xy(max(lons), max(lats), zoom)
    tx_min, tx_max = sorted([tx_min, tx_max])
    ty_min, ty_max = sorted([ty_min, ty_max])
    return [(x, y) for y in range(ty_min, ty_max + 1) for x in range(tx_min, tx_max + 1)]


def download_tile(x: int, y: int, zoom: int, out_dir: Path) -> Path | None:
    path = out_dir / f"{zoom}_{x}_{y}.jpg"
    if path.exists() and path.stat().st_size > 0:
        return path
    url = ESRI_URL.format(z=zoom, x=x, y=y)
    last_error: Exception | None = None
    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "akl-trees-greenness/0.1"})
            with urllib.request.urlopen(req, timeout=60) as response:
                data = response.read()
            if not data:
                raise RuntimeError("empty response")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            time.sleep(DOWNLOAD_POLITE_S)
            return path
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 410):
                return None
            last_error = exc
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(0.5 * attempt)
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def download_all(tiles: list[tuple[int, int]], zoom: int, out_dir: Path) -> dict[tuple[int, int], Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[tuple[int, int], Path] = {}
    missing: list[tuple[int, int]] = []
    total = len(tiles)
    completed = 0
    print(f"Downloading {total:,} Esri World Imagery tiles at z={zoom}...")
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
        futures = {executor.submit(download_tile, x, y, zoom, out_dir): (x, y) for x, y in tiles}
        for future in as_completed(futures):
            key = futures[future]
            try:
                path = future.result()
            except Exception as exc:  # noqa: BLE001
                print(f"  tile {key} failed: {exc}")
                continue
            if path is None:
                missing.append(key)
            else:
                paths[key] = path
            completed += 1
            if completed % 500 == 0 or completed == total:
                print(f"  {completed:,}/{total:,} ({len(missing):,} missing)")
    return paths


def tile_to_array(path: Path) -> np.ndarray:
    """Return HxWx3 uint8 array."""
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        return np.array(rgb)


def chunk_bboxes(bbox: tuple[float, float, float, float], chunk_size_m: float) -> list[tuple[float, float, float, float]]:
    xmin, ymin, xmax, ymax = bbox
    out = []
    y = ymin
    while y < ymax:
        x = xmin
        y_top = min(y + chunk_size_m, ymax)
        while x < xmax:
            x_right = min(x + chunk_size_m, xmax)
            out.append((x, y, x_right, y_top))
            x = x_right
        y = y_top
    return out


def assemble_chunk_rgb(
    chunk_bbox: tuple[float, float, float, float],
    zoom: int,
    tile_paths: dict[tuple[int, int], Path],
) -> tuple[np.ndarray, dict[str, Any]] | None:
    """Stitch tiles covering the chunk + halo, return RGB array in EPSG:3857
    with its transform. Returns None if no usable tiles intersect.
    """
    # Convert chunk bbox 2193 to lon/lat to figure out which tiles to fetch.
    transformer_2193_to_4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    xmin, ymin, xmax, ymax = chunk_bbox
    halo = 50.0
    corners = [
        transformer_2193_to_4326.transform(xmin - halo, ymin - halo),
        transformer_2193_to_4326.transform(xmax + halo, ymin - halo),
        transformer_2193_to_4326.transform(xmin - halo, ymax + halo),
        transformer_2193_to_4326.transform(xmax + halo, ymax + halo),
    ]
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    tx_min, ty_max = lonlat_to_tile_xy(min(lons), min(lats), zoom)
    tx_max, ty_min = lonlat_to_tile_xy(max(lons), max(lats), zoom)
    tx_min, tx_max = sorted([tx_min, tx_max])
    ty_min, ty_max = sorted([ty_min, ty_max])
    tile_size = 256
    width = (tx_max - tx_min + 1) * tile_size
    height = (ty_max - ty_min + 1) * tile_size
    rgb = np.zeros((height, width, 3), dtype="uint8")
    have_any = False
    for ty in range(ty_min, ty_max + 1):
        for tx in range(tx_min, tx_max + 1):
            path = tile_paths.get((tx, ty))
            if path is None:
                continue
            tile = tile_to_array(path)
            if tile.shape[:2] != (tile_size, tile_size):
                tile_img = Image.fromarray(tile).resize((tile_size, tile_size))
                tile = np.array(tile_img)
            r0 = (ty - ty_min) * tile_size
            c0 = (tx - tx_min) * tile_size
            rgb[r0:r0 + tile_size, c0:c0 + tile_size, :] = tile
            have_any = True
    if not have_any:
        return None
    # Bounds of the mosaic in EPSG:3857.
    transformer_4326_to_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    nw_lon, nw_lat = tile_xy_to_lonlat(tx_min, ty_min, zoom)
    se_lon, se_lat = tile_xy_to_lonlat(tx_max + 1, ty_max + 1, zoom)
    left, top = transformer_4326_to_3857.transform(nw_lon, nw_lat)
    right, bottom = transformer_4326_to_3857.transform(se_lon, se_lat)
    pixel_size_x = (right - left) / width
    pixel_size_y = (top - bottom) / height
    transform_3857 = from_origin(left, top, pixel_size_x, pixel_size_y)
    return rgb, {"transform": transform_3857, "width": width, "height": height, "crs": "EPSG:3857"}


def reproject_rgb_to_2193(
    rgb_chw: np.ndarray,
    meta_3857: dict[str, Any],
    chunk_bbox: tuple[float, float, float, float],
) -> tuple[np.ndarray, Any]:
    """rgb_chw is (3, H, W) uint8 in EPSG:3857.
    Returns (3, H, W) uint8 in EPSG:2193 aligned to the chunk_bbox 1 m grid.
    """
    xmin, ymin, xmax, ymax = chunk_bbox
    width = int(round(xmax - xmin))
    height = int(round(ymax - ymin))
    dst = np.zeros((3, height, width), dtype="uint8")
    transform_2193 = from_origin(xmin, ymax, 1.0, 1.0)
    for band in range(3):
        reproject(
            source=rgb_chw[band],
            destination=dst[band],
            src_transform=meta_3857["transform"],
            src_crs=meta_3857["crs"],
            dst_transform=transform_2193,
            dst_crs="EPSG:2193",
            resampling=Resampling.average,
        )
    return dst, transform_2193


def green_leaf_index(rgb_2193: np.ndarray) -> np.ndarray:
    r = rgb_2193[0].astype("float32")
    g = rgb_2193[1].astype("float32")
    b = rgb_2193[2].astype("float32")
    eps = 1e-6
    gli = (2.0 * g - r - b) / (2.0 * g + r + b + eps)
    # Mask pixels where the RGB is essentially black (missing imagery).
    valid = (r + g + b) > 9
    gli = np.where(valid, gli, np.nan).astype("float32")
    return gli


def write_chunk_gli(gli: np.ndarray, transform: Any, chunk_index: int) -> Path:
    CHUNK_DIR.mkdir(parents=True, exist_ok=True)
    path = CHUNK_DIR / f"gli_{chunk_index:05d}.tif"
    profile = {
        "driver": "GTiff",
        "height": gli.shape[0],
        "width": gli.shape[1],
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:2193",
        "transform": transform,
        "nodata": -9999,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    out = np.where(np.isfinite(gli), gli, -9999).astype("float32")
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(out, 1)
    return path


def build_vrt(chunk_paths: list[Path]) -> None:
    if not chunk_paths:
        return
    VRT_PATH.parent.mkdir(parents=True, exist_ok=True)
    bounds = []
    for path in chunk_paths:
        with rasterio.open(path) as src:
            bounds.append((src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top))
    xmin = min(b[0] for b in bounds)
    ymin = min(b[1] for b in bounds)
    xmax = max(b[2] for b in bounds)
    ymax = max(b[3] for b in bounds)
    width = int(round(xmax - xmin))
    height = int(round(ymax - ymin))
    lines = [
        f'<VRTDataset rasterXSize="{width}" rasterYSize="{height}">',
        '  <SRS>EPSG:2193</SRS>',
        f'  <GeoTransform>{xmin}, 1.0, 0.0, {ymax}, 0.0, -1.0</GeoTransform>',
        '  <VRTRasterBand dataType="Float32" band="1">',
        '    <NoDataValue>-9999</NoDataValue>',
    ]
    for path, (pxmin, pymin, pxmax, pymax) in zip(chunk_paths, bounds):
        tile_w = int(round(pxmax - pxmin))
        tile_h = int(round(pymax - pymin))
        dst_x = int(round(pxmin - xmin))
        dst_y = int(round(ymax - pymax))
        rel = path.relative_to(VRT_PATH.parent).as_posix()
        lines.extend([
            '    <SimpleSource>',
            f'      <SourceFilename relativeToVRT="1">{rel}</SourceFilename>',
            '      <SourceBand>1</SourceBand>',
            f'      <SourceProperties RasterXSize="{tile_w}" RasterYSize="{tile_h}" DataType="Float32" BlockXSize="256" BlockYSize="256"/>',
            f'      <SrcRect xOff="0" yOff="0" xSize="{tile_w}" ySize="{tile_h}"/>',
            f'      <DstRect xOff="{dst_x}" yOff="{dst_y}" xSize="{tile_w}" ySize="{tile_h}"/>',
            '      <NODATA>-9999</NODATA>',
            '    </SimpleSource>',
        ])
    lines.append('  </VRTRasterBand>')
    lines.append('</VRTDataset>')
    VRT_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, default=list(DEFAULT_PILOT_BBOX_2193))
    args = parser.parse_args()
    bbox = tuple(float(v) for v in args.bbox)

    tiles = tiles_for_bbox_2193(bbox, TILE_ZOOM)
    print(f"Pilot bbox {bbox}")
    print(f"WebMercator tiles at z={TILE_ZOOM}: {len(tiles):,}")
    tile_paths = download_all(tiles, TILE_ZOOM, TILE_DIR)

    chunks = chunk_bboxes(bbox, CHUNK_SIZE_M)
    print(f"Building greenness for {len(chunks):,} chunks of {CHUNK_SIZE_M:.0f} m...")
    chunk_paths: list[Path] = []
    for index, chunk_bbox in enumerate(chunks):
        out_path = CHUNK_DIR / f"gli_{index:05d}.tif"
        if out_path.exists() and out_path.stat().st_size > 0:
            chunk_paths.append(out_path)
            if (index + 1) % 25 == 0 or index + 1 == len(chunks):
                print(f"  chunks {index + 1:,}/{len(chunks):,} (cached)")
            continue
        result = assemble_chunk_rgb(chunk_bbox, TILE_ZOOM, tile_paths)
        if result is None:
            continue
        rgb_3857_hwc, meta_3857 = result
        rgb_3857_chw = np.transpose(rgb_3857_hwc, (2, 0, 1))  # H,W,C → C,H,W for rasterio
        rgb_2193_chw, transform_2193 = reproject_rgb_to_2193(rgb_3857_chw, meta_3857, chunk_bbox)
        gli = green_leaf_index(rgb_2193_chw)
        path = write_chunk_gli(gli, transform_2193, index)
        chunk_paths.append(path)
        if (index + 1) % 10 == 0 or index + 1 == len(chunks):
            print(f"  chunks {index + 1:,}/{len(chunks):,}")

    build_vrt(chunk_paths)
    manifest = {
        "created_at_utc": utc_now(),
        "bbox_2193": list(bbox),
        "tile_zoom": TILE_ZOOM,
        "tile_count": len(tiles),
        "chunk_count": len(chunk_paths),
        "vrt": str(VRT_PATH.relative_to(ROOT)),
        "imagery_source": "Esri World Imagery (attribution required for public-facing use)",
        "metric": "GLI = (2G - R - B) / (2G + R + B + eps); vegetation typically > 0.05",
    }
    (INTERIM_ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"chunks": len(chunk_paths), "vrt": str(VRT_PATH)}, indent=2))


if __name__ == "__main__":
    main()
