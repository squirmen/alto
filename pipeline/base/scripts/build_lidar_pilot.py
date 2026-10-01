#!/usr/bin/env python3
"""Build a LiDAR-derived canopy-height surface for the Waitemata pilot area.

This downloads 1 m Auckland Council DSM/DEM LERC tiles for the full bbox of
the canonical tree inventory (snapped to the LERC tile grid), computes a
canopy-height model in 1 km chunks to keep memory bounded, writes per-chunk
CHM GeoTIFFs that downstream tools can stream from, and samples per-tree
canopy heights into the project SQLite database.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import Affine, from_origin
from rasterio.windows import from_bounds


ROOT = Path(__file__).resolve().parents[1]
from _pilot_config import active_pilot_name  # noqa: E402
_PILOT_NAME = active_pilot_name()
_PILOT_SLUG = "waitemata_lidar_pilot" if _PILOT_NAME == "waitemata_v1" else f"{_PILOT_NAME}_lidar"
RAW_ROOT = ROOT / "data" / "raw" / "arcgis_image" / _PILOT_SLUG
INTERIM_ROOT = ROOT / "data" / "interim" / _PILOT_SLUG
CHM_TILE_ROOT = INTERIM_ROOT / "chm_tiles_1km"
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"

DSM_SERVICE = (
    "https://tiledimageservices1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/"
    "Auckland_DSM_2024/ImageServer"
)
DEM_SERVICE = (
    "https://tiledimageservices1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/"
    "Auckland_Region_Digital_Elevation_Model__DEM__2024/ImageServer"
)

LEVEL = 9
RESOLUTION_M = 1.0
TILE_SIZE = 256
ORIGIN_X = -4020763.26772284
ORIGIN_Y = 19997963.9429363
CHUNK_SIZE_M = 1024  # Process 1 km chunks (4 tiles × 4 tiles at LEVEL 9).
TREE_HEIGHT_SAMPLE_RADIUS_M = 2
TREE_CANOPY_MIN_HEIGHT_M = 3.0
DOWNLOAD_WORKERS = 16
DOWNLOAD_RETRIES = 4

# Default pilot bbox is loaded from ``config/pilots.json`` via the shared
# ``_pilot_config`` helper, so we can flip between Waitemata, Auckland
# Isthmus, and wider pilots without editing every script. Override via
# --bbox for smaller tests, or set AKL_TREES_PILOT to switch.
from _pilot_config import DEFAULT_PILOT_BBOX_2193  # noqa: E402


@dataclass(frozen=True)
class Tile:
    row: int
    col: int

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        xmin = ORIGIN_X + self.col * TILE_SIZE * RESOLUTION_M
        xmax = xmin + TILE_SIZE * RESOLUTION_M
        ymax = ORIGIN_Y - self.row * TILE_SIZE * RESOLUTION_M
        ymin = ymax - TILE_SIZE * RESOLUTION_M
        return xmin, ymin, xmax, ymax


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def tiles_for_bbox(bbox: tuple[float, float, float, float]) -> list[Tile]:
    xmin, ymin, xmax, ymax = bbox
    col_min = math.floor((xmin - ORIGIN_X) / (RESOLUTION_M * TILE_SIZE))
    col_max = math.floor((xmax - ORIGIN_X - 1e-9) / (RESOLUTION_M * TILE_SIZE))
    row_min = math.floor((ORIGIN_Y - ymax + 1e-9) / (RESOLUTION_M * TILE_SIZE))
    row_max = math.floor((ORIGIN_Y - ymin) / (RESOLUTION_M * TILE_SIZE))
    return [
        Tile(row=row, col=col)
        for row in range(row_min, row_max + 1)
        for col in range(col_min, col_max + 1)
    ]


def tile_path(layer_name: str, tile: Tile, raw_dir: Path) -> Path:
    return raw_dir / f"{layer_name}_{LEVEL}_{tile.row}_{tile.col}.lerc"


def download_one(service_url: str, layer_name: str, tile: Tile, raw_dir: Path) -> Path | None:
    path = tile_path(layer_name, tile, raw_dir)
    if path.exists() and path.stat().st_size > 0:
        return path
    url = f"{service_url}/tile/{LEVEL}/{tile.row}/{tile.col}"
    request = urllib.request.Request(url, headers={"User-Agent": "akl-trees-lidar/0.2"})
    last_error: Exception | None = None
    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                data = response.read()
            path.write_bytes(data)
            return path
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 410):
                # Tile not present in service (over water or out of coverage).
                return None
            last_error = exc
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(f"Failed to download {url}: {last_error}")


def download_layer(service_url: str, layer_name: str, tiles: list[Tile], raw_dir: Path) -> dict[Tile, Path]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    available: dict[Tile, Path] = {}
    missing: list[Tile] = []
    total = len(tiles)
    completed = 0
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
        futures = {executor.submit(download_one, service_url, layer_name, tile, raw_dir): tile for tile in tiles}
        for future in as_completed(futures):
            tile = futures[future]
            try:
                path = future.result()
            except Exception:
                raise
            if path is None:
                missing.append(tile)
            else:
                available[tile] = path
            completed += 1
            if completed % 200 == 0 or completed == total:
                print(f"  {layer_name}: {completed:,}/{total:,} tiles ({len(missing):,} missing)")
    if missing:
        print(f"  {layer_name}: {len(missing):,} tiles unavailable (likely off coverage)")
    return available


def read_lerc(path: Path) -> np.ndarray | None:
    try:
        with rasterio.open(path) as src:
            array = src.read(1).astype("float32")
    except Exception as exc:  # noqa: BLE001 - some service tiles fail to decode.
        print(f"  skip unreadable tile {path.name}: {exc}")
        return None
    array[~np.isfinite(array)] = np.nan
    return array


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


def write_geotiff(path: Path, array: np.ndarray, transform: Affine, nodata: float = -9999.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    output = np.where(np.isfinite(array), array, nodata).astype("float32")
    profile = {
        "driver": "GTiff",
        "height": output.shape[0],
        "width": output.shape[1],
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:2193",
        "transform": transform,
        "nodata": nodata,
        "compress": "deflate",
        "predictor": 3,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(output, 1)


def assemble_chunk(
    layer: str,
    chunk_bbox: tuple[float, float, float, float],
    tile_paths: dict[Tile, Path],
) -> tuple[np.ndarray, Affine]:
    xmin, ymin, xmax, ymax = chunk_bbox
    cols = round((xmax - xmin) / RESOLUTION_M)
    rows = round((ymax - ymin) / RESOLUTION_M)
    mosaic = np.full((rows, cols), np.nan, dtype="float32")
    chunk_tiles = tiles_for_bbox(chunk_bbox)
    for tile in chunk_tiles:
        path = tile_paths.get(tile)
        if path is None:
            continue
        tile_data = read_lerc(path)
        if tile_data is None:
            continue
        t_xmin, t_ymin, t_xmax, t_ymax = tile.bounds
        # Compute overlap with chunk in pixel coords.
        col_off = int(round((t_xmin - xmin) / RESOLUTION_M))
        row_off = int(round((ymax - t_ymax) / RESOLUTION_M))
        src_col0 = max(0, -col_off)
        src_row0 = max(0, -row_off)
        dst_col0 = max(0, col_off)
        dst_row0 = max(0, row_off)
        width = min(tile_data.shape[1] - src_col0, cols - dst_col0)
        height = min(tile_data.shape[0] - src_row0, rows - dst_row0)
        if width <= 0 or height <= 0:
            continue
        slab = tile_data[src_row0:src_row0 + height, src_col0:src_col0 + width]
        target = mosaic[dst_row0:dst_row0 + height, dst_col0:dst_col0 + width]
        mask = np.isfinite(slab)
        target[mask] = slab[mask]
        mosaic[dst_row0:dst_row0 + height, dst_col0:dst_col0 + width] = target
    transform = from_origin(xmin, ymax, RESOLUTION_M, RESOLUTION_M)
    return mosaic, transform


def chm_from_chunk(dsm: np.ndarray, dem: np.ndarray) -> np.ndarray:
    chm = dsm - dem
    chm[(chm < -1) | (chm > 80)] = np.nan
    chm = np.where(chm < 0, 0, chm)
    return chm.astype("float32")


def write_chunk_chm(chm: np.ndarray, transform: Affine, chunk_index: int) -> Path:
    name = f"chm_{chunk_index:05d}.tif"
    out_path = CHM_TILE_ROOT / name
    write_geotiff(out_path, chm, transform)
    return out_path


def build_vrt(chm_paths: list[Path], out_vrt: Path) -> None:
    if not chm_paths:
        return
    out_vrt.parent.mkdir(parents=True, exist_ok=True)
    bounds_per_path: list[tuple[float, float, float, float]] = []
    for path in chm_paths:
        with rasterio.open(path) as src:
            bounds_per_path.append((src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top))
    xmin = min(b[0] for b in bounds_per_path)
    ymin = min(b[1] for b in bounds_per_path)
    xmax = max(b[2] for b in bounds_per_path)
    ymax = max(b[3] for b in bounds_per_path)
    width = round((xmax - xmin) / RESOLUTION_M)
    height = round((ymax - ymin) / RESOLUTION_M)

    lines: list[str] = []
    lines.append(f'<VRTDataset rasterXSize="{width}" rasterYSize="{height}">')
    lines.append('  <SRS>EPSG:2193</SRS>')
    lines.append(f'  <GeoTransform>{xmin}, {RESOLUTION_M}, 0.0, {ymax}, 0.0, -{RESOLUTION_M}</GeoTransform>')
    lines.append('  <VRTRasterBand dataType="Float32" band="1">')
    lines.append('    <NoDataValue>-9999</NoDataValue>')
    for path, (px_xmin, px_ymin, px_xmax, px_ymax) in zip(chm_paths, bounds_per_path):
        tile_width = round((px_xmax - px_xmin) / RESOLUTION_M)
        tile_height = round((px_ymax - px_ymin) / RESOLUTION_M)
        dst_x = round((px_xmin - xmin) / RESOLUTION_M)
        dst_y = round((ymax - px_ymax) / RESOLUTION_M)
        rel = path.relative_to(out_vrt.parent).as_posix()
        lines.append('    <SimpleSource>')
        lines.append(f'      <SourceFilename relativeToVRT="1">{rel}</SourceFilename>')
        lines.append('      <SourceBand>1</SourceBand>')
        lines.append(f'      <SourceProperties RasterXSize="{tile_width}" RasterYSize="{tile_height}" DataType="Float32" BlockXSize="256" BlockYSize="256"/>')
        lines.append(f'      <SrcRect xOff="0" yOff="0" xSize="{tile_width}" ySize="{tile_height}"/>')
        lines.append(f'      <DstRect xOff="{dst_x}" yOff="{dst_y}" xSize="{tile_width}" ySize="{tile_height}"/>')
        lines.append('      <NODATA>-9999</NODATA>')
        lines.append('    </SimpleSource>')
    lines.append('  </VRTRasterBand>')
    lines.append('</VRTDataset>')
    out_vrt.write_text("\n".join(lines), encoding="utf-8")


def process_chunks(
    bbox: tuple[float, float, float, float],
    dsm_tiles: dict[Tile, Path],
    dem_tiles: dict[Tile, Path],
) -> tuple[list[Path], dict[str, Any]]:
    CHM_TILE_ROOT.mkdir(parents=True, exist_ok=True)
    chm_paths: list[Path] = []
    valid_pixels = 0
    canopy_pixels = 0
    height_sum = 0.0
    height_sq_sum = 0.0
    height_max = 0.0
    height_min: float | None = None
    height_samples: list[np.ndarray] = []
    chunks = chunk_bboxes(bbox, CHUNK_SIZE_M)
    total_chunks = len(chunks)
    print(f"Processing {total_chunks:,} chunks of {CHUNK_SIZE_M:.0f} m...")
    for index, chunk_bbox in enumerate(chunks):
        out_path = CHM_TILE_ROOT / f"chm_{index:05d}.tif"
        if out_path.exists() and out_path.stat().st_size > 0:
            chm_paths.append(out_path)
            with rasterio.open(out_path) as src:
                chm = src.read(1).astype("float32")
                nodata = src.nodata if src.nodata is not None else -9999
                chm[chm == nodata] = np.nan
            valid_mask = np.isfinite(chm)
            valid_pixels += int(valid_mask.sum())
            canopy_mask = valid_mask & (chm >= TREE_CANOPY_MIN_HEIGHT_M)
            canopy_pixels += int(canopy_mask.sum())
            flat = chm[valid_mask]
            if flat.size:
                height_sum += float(flat.sum())
                height_sq_sum += float((flat ** 2).sum())
                height_max = max(height_max, float(flat.max()))
                chunk_min = float(flat.min())
                height_min = chunk_min if height_min is None else min(height_min, chunk_min)
                if len(height_samples) < 200:
                    height_samples.append(flat[::max(1, flat.size // 5000)])
            if (index + 1) % 25 == 0 or index + 1 == total_chunks:
                print(f"  chunks {index + 1:,}/{total_chunks:,} (cached)")
            continue
        dsm, transform = assemble_chunk("dsm", chunk_bbox, dsm_tiles)
        dem, _ = assemble_chunk("dem", chunk_bbox, dem_tiles)
        if not np.isfinite(dsm).any():
            continue
        chm = chm_from_chunk(dsm, dem)
        out_path = write_chunk_chm(chm, transform, index)
        chm_paths.append(out_path)
        valid_mask = np.isfinite(chm)
        valid_pixels += int(valid_mask.sum())
        canopy_mask = valid_mask & (chm >= TREE_CANOPY_MIN_HEIGHT_M)
        canopy_pixels += int(canopy_mask.sum())
        flat = chm[valid_mask]
        if flat.size:
            height_sum += float(flat.sum())
            height_sq_sum += float((flat ** 2).sum())
            height_max = max(height_max, float(flat.max()))
            chunk_min = float(flat.min())
            height_min = chunk_min if height_min is None else min(height_min, chunk_min)
            if len(height_samples) < 200:
                # Reservoir of samples for percentiles.
                height_samples.append(flat[::max(1, flat.size // 5000)])
        if (index + 1) % 25 == 0 or index + 1 == total_chunks:
            print(f"  chunks {index + 1:,}/{total_chunks:,}")
    mean = height_sum / valid_pixels if valid_pixels else None
    variance = height_sq_sum / valid_pixels - (mean or 0) ** 2 if valid_pixels else None
    sample_stack = np.concatenate(height_samples) if height_samples else np.array([])
    metrics = {
        "valid_pixels": valid_pixels,
        "canopy_pixels_ge_3m": canopy_pixels,
        "canopy_area_m2_ge_3m": float(canopy_pixels * RESOLUTION_M * RESOLUTION_M),
        "canopy_cover_pct_ge_3m": float(canopy_pixels / valid_pixels * 100) if valid_pixels else None,
        "mean_chm_m": mean,
        "stddev_chm_m": math.sqrt(variance) if variance is not None and variance > 0 else None,
        "min_chm_m": height_min,
        "max_chm_m": height_max,
        "p95_chm_m": float(np.percentile(sample_stack, 95)) if sample_stack.size else None,
        "median_chm_m": float(np.percentile(sample_stack, 50)) if sample_stack.size else None,
    }
    return chm_paths, metrics


def sample_tree_chm(vrt_path: Path, bbox: tuple[float, float, float, float], sqlite_path: Path) -> dict[str, Any]:
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    conn = sqlite3.connect(sqlite_path)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_lidar_pilot")
        conn.execute(
            """
            CREATE TABLE tree_lidar_pilot (
                tree_id TEXT PRIMARY KEY,
                x_2193 REAL,
                y_2193 REAL,
                chm_at_point_m REAL,
                chm_local_max_2m_m REAL,
                likely_canopy_ge_3m INTEGER,
                method_id TEXT,
                created_at_utc TEXT
            )
            """
        )
        rows = conn.execute("SELECT tree_id, lon, lat FROM trees").fetchall()
        xmin, ymin, xmax, ymax = bbox
        coords: list[tuple[str, float, float]] = []
        for tree_id, lon, lat in rows:
            x, y = transformer.transform(lon, lat)
            if x < xmin or x >= xmax or y < ymin or y >= ymax:
                continue
            coords.append((tree_id, x, y))
        if not coords:
            return {"trees_in_pilot": 0}

        # Vectorised block sampling: read the CHM in blocks (+halo) and sample every tree in
        # a block at once — replaces ~1.6M per-tree windowed VRT reads (hours at metro scale)
        # with a few hundred block reads (minutes). Identical result: centre pixel at (x,y)
        # + 5×5 local max, via maximum_filter.
        from scipy.ndimage import maximum_filter
        created_at = utc_now()
        r = TREE_HEIGHT_SAMPLE_RADIUS_M
        ids = [c[0] for c in coords]
        cx = np.array([c[1] for c in coords], dtype="float64")
        cy = np.array([c[2] for c in coords], dtype="float64")
        sample_arr = np.full(len(coords), np.nan, dtype="float32")
        lmax_arr = np.full(len(coords), np.nan, dtype="float32")
        BLOCK_M, HALO_M = 2000.0, float(r + 1)
        with rasterio.open(vrt_path) as src:
            nd = src.nodata if src.nodata is not None else -9999.0
            bx = xmin
            while bx < xmax:
                by = ymin
                while by < ymax:
                    ix1, iy1 = min(bx + BLOCK_M, xmax), min(by + BLOCK_M, ymax)
                    in_blk = (cx >= bx) & (cx < ix1) & (cy >= by) & (cy < iy1)
                    if in_blk.any():
                        win = from_bounds(bx - HALO_M, by - HALO_M, ix1 + HALO_M, iy1 + HALO_M,
                                          transform=src.transform)
                        block = src.read(1, window=win, boundless=True, fill_value=nd).astype("float32")
                        tr = src.window_transform(win)
                        block[block == nd] = np.nan
                        lmaxg = maximum_filter(np.where(np.isfinite(block), block, -np.inf),
                                               size=2 * r + 1, mode="constant", cval=-np.inf)
                        idx = np.where(in_blk)[0]
                        rr, cc = rasterio.transform.rowcol(tr, cx[idx], cy[idx])
                        rr, cc = np.asarray(rr), np.asarray(cc)
                        h, w = block.shape
                        ok = (rr >= 0) & (rr < h) & (cc >= 0) & (cc < w)
                        gi = idx[ok]
                        sample_arr[gi] = block[rr[ok], cc[ok]]
                        lm = lmaxg[rr[ok], cc[ok]]
                        lm[~np.isfinite(lm)] = np.nan  # all-nan window -> None
                        lmax_arr[gi] = lm
                    by += BLOCK_M
                bx += BLOCK_M
        enriched: list[tuple[str, float, float, float | None, float | None, int, str, str]] = []
        for i, tid in enumerate(ids):
            s = float(sample_arr[i]) if np.isfinite(sample_arr[i]) else None
            lmx = float(lmax_arr[i]) if np.isfinite(lmax_arr[i]) else None
            enriched.append((tid, float(cx[i]), float(cy[i]), s, lmx,
                             int(lmx is not None and lmx >= TREE_CANOPY_MIN_HEIGHT_M),
                             "arcgis_dsm_dem_2024_chm_sample_2m", created_at))
        conn.executemany(
            """
            INSERT INTO tree_lidar_pilot (
                tree_id, x_2193, y_2193, chm_at_point_m, chm_local_max_2m_m,
                likely_canopy_ge_3m, method_id, created_at_utc
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            enriched,
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tree_lidar_pilot_canopy ON tree_lidar_pilot(likely_canopy_ge_3m)")
        conn.commit()
        values = [row[4] for row in enriched if row[4] is not None]
        return {
            "trees_in_pilot": len(enriched),
            "trees_with_lidar_height": len(values),
            "trees_likely_canopy_ge_3m": int(sum(1 for v in values if v >= TREE_CANOPY_MIN_HEIGHT_M)),
            "mean_tree_local_max_chm_m": float(np.mean(values)) if values else None,
            "median_tree_local_max_chm_m": float(np.median(values)) if values else None,
            "p95_tree_local_max_chm_m": float(np.percentile(values, 95)) if values else None,
        }
    finally:
        conn.close()


def write_web_outputs(sqlite_path: Path, bbox: tuple[float, float, float, float]) -> None:
    conn = sqlite3.connect(sqlite_path)
    try:
        rows = conn.execute(
            """
            SELECT
                t.tree_id,
                t.source_primary,
                t.source_tree_id,
                t.species_common,
                t.species_latin,
                t.species_confidence,
                t.owner_class,
                t.is_protected_notable,
                t.notable_point_spatial_candidate,
                t.notable_point_review_required,
                t.notable_point_name,
                t.notable_point_distance_m,
                t.notable_group_names,
                t.lon,
                t.lat,
                l.chm_at_point_m,
                l.chm_local_max_2m_m,
                l.likely_canopy_ge_3m
            FROM trees t
            LEFT JOIN tree_lidar_pilot l ON t.tree_id = l.tree_id
            """
        ).fetchall()
    finally:
        conn.close()

    features = []
    for row in rows:
        (
            tree_id,
            source_primary,
            source_tree_id,
            species_common,
            species_latin,
            species_confidence,
            owner_class,
            is_protected_notable,
            notable_point_spatial_candidate,
            notable_point_review_required,
            notable_point_name,
            notable_point_distance_m,
            notable_group_names,
            lon,
            lat,
            chm_at_point_m,
            chm_local_max_2m_m,
            likely_canopy_ge_3m,
        ) = row
        features.append(
            {
                "type": "Feature",
                "id": tree_id,
                "properties": {
                    "tree_id": tree_id,
                    "source_primary": source_primary,
                    "source_tree_id": source_tree_id,
                    "species_common": species_common,
                    "species_latin": species_latin,
                    "species_confidence": species_confidence,
                    "owner_class": owner_class,
                    "is_protected_notable": is_protected_notable,
                    "notable_point_spatial_candidate": notable_point_spatial_candidate,
                    "notable_point_review_required": notable_point_review_required,
                    "notable_point_name": notable_point_name,
                    "notable_point_distance_m": notable_point_distance_m,
                    "notable_group_names": notable_group_names,
                    "lidar_pilot": int(chm_local_max_2m_m is not None),
                    "chm_at_point_m": round(chm_at_point_m, 2) if chm_at_point_m is not None else None,
                    "chm_local_max_2m_m": (
                        round(chm_local_max_2m_m, 2)
                        if chm_local_max_2m_m is not None
                        else None
                    ),
                    "likely_canopy_ge_3m": likely_canopy_ge_3m,
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )

    out_points = PROCESSED_ROOT / "trees_map_points.geojson"
    out_points.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )

    transformer = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    xmin, ymin, xmax, ymax = bbox
    ring = [
        transformer.transform(xmin, ymin),
        transformer.transform(xmax, ymin),
        transformer.transform(xmax, ymax),
        transformer.transform(xmin, ymax),
        transformer.transform(xmin, ymin),
    ]
    extent = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Waitemata LiDAR pilot",
                    "bbox_2193": list(bbox),
                    "method": "2024 DSM - DEM canopy height model",
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        ],
    }
    (PROCESSED_ROOT / "lidar_pilot_extent.geojson").write_text(
        json.dumps(extent, separators=(",", ":")),
        encoding="utf-8",
    )


def write_report(
    metrics: dict[str, Any],
    tree_metrics: dict[str, Any],
    manifest: dict[str, Any],
) -> None:
    report = DOCS_ROOT / "waitemata_lidar_pilot.md"
    lines = [
        "# Waitemata LiDAR Pilot",
        "",
        f"Generated at: {manifest['created_at_utc']}",
        "",
        "## Pilot Area",
        "",
        f"- EPSG:2193 bbox: `{manifest['pilot_bbox_2193']}`.",
        f"- Area: {manifest['pilot_area_m2']:,.0f} m2 (~{manifest['pilot_area_m2'] / 1e6:,.1f} km2).",
        f"- LERC tile count per layer at level {LEVEL}: {manifest['tile_count']:,}.",
        f"- DSM tiles fetched: {manifest['dsm_tiles_fetched']:,}.",
        f"- DEM tiles fetched: {manifest['dem_tiles_fetched']:,}.",
        f"- 1 km CHM chunks written: {manifest['chunk_count']:,}.",
        "",
        "## Canopy Height Model",
        "",
        "CHM = `DSM - DEM` from the 2024 Auckland Council 1 m imagery service. "
        "Values >= 3 m are candidate above-ground canopy/structure pixels; "
        "buildings are removed by the downstream crown step, not here.",
        "",
        f"- Valid raster pixels: {metrics['valid_pixels']:,}.",
        f"- Candidate canopy/structure pixels >= 3 m: {metrics['canopy_pixels_ge_3m']:,}.",
        f"- Candidate canopy/structure area >= 3 m: {metrics['canopy_area_m2_ge_3m']:,.0f} m2.",
        f"- Candidate canopy/structure cover >= 3 m: {metrics['canopy_cover_pct_ge_3m']:.1f}%.",
        f"- Mean CHM: {metrics['mean_chm_m']:.2f} m (std {metrics['stddev_chm_m']:.2f} m).",
        f"- Median CHM (sample): {metrics['median_chm_m']:.2f} m.",
        f"- 95th percentile CHM (sample): {metrics['p95_chm_m']:.2f} m.",
        f"- Maximum CHM: {metrics['max_chm_m']:.2f} m.",
        "",
        "## Tree Inventory Join",
        "",
        f"- Canonical tree records sampled inside pilot bbox: {tree_metrics.get('trees_in_pilot', 0):,}.",
        f"- Trees with a LiDAR height sample: {tree_metrics.get('trees_with_lidar_height', 0):,}.",
        f"- Trees with local max CHM >= 3 m: {tree_metrics.get('trees_likely_canopy_ge_3m', 0):,}.",
        f"- Median local max CHM around known trees: {tree_metrics.get('median_tree_local_max_chm_m') or 0:.2f} m.",
        f"- 95th percentile local max CHM around known trees: {tree_metrics.get('p95_tree_local_max_chm_m') or 0:.2f} m.",
        "",
        "## Outputs",
        "",
        f"- `{CHM_TILE_ROOT.relative_to(ROOT)}` (1 km CHM tiles)",
        "- `data/interim/waitemata_lidar_pilot/chm.vrt` (full-pilot CHM mosaic VRT)",
        "- `data/processed/akl_trees.sqlite`, table `tree_lidar_pilot`",
        "- `data/processed/trees_map_points.geojson`, enriched with pilot LiDAR fields",
        "- `data/processed/lidar_pilot_extent.geojson`",
        "",
    ]
    report.write_text("\n".join(lines), encoding="utf-8")


def write_legacy_chm_extract(vrt_path: Path) -> None:
    """For backward compatibility, write a single-band CHM at the original
    1 km × 1 km extent so older tooling that points at `chm_1m.tif` still works.
    """
    bbox = (1_757_000.0, 5_917_000.0, 1_758_000.0, 5_918_000.0)
    with rasterio.open(vrt_path) as src:
        win = from_bounds(*bbox, transform=src.transform)
        data = src.read(1, window=win)
        transform = rasterio.windows.transform(win, src.transform)
    write_geotiff(INTERIM_ROOT / "chm_1m.tif", data, transform)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, default=list(DEFAULT_PILOT_BBOX_2193))
    args = parser.parse_args()
    bbox = tuple(float(v) for v in args.bbox)

    RAW_ROOT.mkdir(parents=True, exist_ok=True)
    INTERIM_ROOT.mkdir(parents=True, exist_ok=True)

    tiles = tiles_for_bbox(bbox)
    print(f"Pilot bbox 2193: {bbox}")
    print(f"Area: {(bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) / 1e6:.1f} km²")
    print(f"Downloading {len(tiles):,} DSM tiles...")
    dsm_tiles = download_layer(DSM_SERVICE, "dsm", tiles, RAW_ROOT / "dsm_tiles")
    print(f"Downloading {len(tiles):,} DEM tiles...")
    dem_tiles = download_layer(DEM_SERVICE, "dem", tiles, RAW_ROOT / "dem_tiles")

    chm_paths, metrics = process_chunks(bbox, dsm_tiles, dem_tiles)

    vrt_path = INTERIM_ROOT / "chm.vrt"
    build_vrt(chm_paths, vrt_path)
    write_legacy_chm_extract(vrt_path)

    tree_metrics = sample_tree_chm(vrt_path, bbox, PROCESSED_ROOT / "akl_trees.sqlite")
    write_web_outputs(PROCESSED_ROOT / "akl_trees.sqlite", bbox)

    manifest = {
        "created_at_utc": utc_now(),
        "pilot_bbox_2193": list(bbox),
        "pilot_area_m2": (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]),
        "tile_level": LEVEL,
        "tile_count": len(tiles),
        "dsm_tiles_fetched": len(dsm_tiles),
        "dem_tiles_fetched": len(dem_tiles),
        "chunk_size_m": CHUNK_SIZE_M,
        "chunk_count": len(chm_paths),
        "resolution_m": RESOLUTION_M,
        "dsm_service": DSM_SERVICE,
        "dem_service": DEM_SERVICE,
        "canopy_height_formula": "DSM - DEM",
        "canopy_threshold_m": TREE_CANOPY_MIN_HEIGHT_M,
        "metrics": metrics,
        "tree_metrics": tree_metrics,
        "vrt_path": str(vrt_path.relative_to(ROOT)),
    }
    (INTERIM_ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    write_report(metrics, tree_metrics, manifest)
    print(json.dumps({"metrics": metrics, "tree_metrics": tree_metrics}, indent=2, default=str))


if __name__ == "__main__":
    main()
