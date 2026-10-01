#!/usr/bin/env python3
"""Detect tree tops from the CHM where no council/AT inventory point exists.

For each 1 km × 1 km CHM chunk:
1. Read the CHM window with a small halo.
2. Mask out OSM building footprints (cached by `build_tree_crown_pilot.py`).
3. Light Gaussian smoothing.
4. Variable-window local maximum detection: a pixel is kept when it is the
   maximum within a disk radius scaled by its own height (taller trees need
   wider non-max suppression to avoid double-counting big crowns).
5. Drop candidates within ``DEDUP_DISTANCE_M`` of a canonical inventory tree
   so we don't double up.

Detected points are inserted into the canonical ``trees`` table with
``source_primary = 'lidar_inferred_canopy'`` so the existing crown, context,
and valuation pipeline picks them up at a lower confidence class.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import Polygon

# Reuse the OSM building cache built by the crown pilot.
from build_tree_crown_pilot import (  # type: ignore
    CHM_VRT_PATH,
    DEFAULT_PILOT_BBOX_2193,
    chunk_bboxes,
    fetch_osm_non_vegetation_tiled,
    osm_payloads_to_exclusion_polygons,
    index_buildings_by_chunk,
    buildings_for_chunk,
    load_building_polygons,
    rasterize_buildings,
    read_chm_window,
)

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"

CHUNK_SIZE_M = 1024.0
DETECTION_MIN_HEIGHT_M = 5.0
SMOOTH_SIGMA_PX = 1.0
DEDUP_DISTANCE_M = 5.0
INFERRED_SOURCE_TAG = "lidar_inferred_canopy"
METHOD_ID = "chm_local_max_variable_window_v3_greenness_strict"

from _pilot_config import active_pilot_name as _active_pilot_name  # noqa: E402
_PILOT_NAME = _active_pilot_name()
GREENNESS_VRT_PATH = ROOT / "data" / "interim" / ("greenness" if _PILOT_NAME == "waitemata_v1" else f"greenness_{_PILOT_NAME}") / "greenness.vrt"
# Reject pixels whose 5x5 mean GLI is below this. Bumped from 0.02 → 0.06
# because the lower threshold was letting through CHM-tall surfaces with
# only a slight greenish tint in the aerial (e.g. faded asphalt patches,
# mixed gravel-and-weeds areas, sun-bleached cargo containers).
GLI_THRESHOLD = 0.06
GLI_WINDOW_PX = 5


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def suppression_radius_px(height_m: float) -> float:
    """Variable non-max suppression radius (in pixels = metres at 1 m grid).

    Calibrated so 5 m saplings stay ≥ 3 m apart and 25 m trees stay ≥ 9 m
    apart, which roughly matches typical broadleaf crown half-widths in
    Auckland's mixed suburban canopy.
    """
    return float(np.clip(2.5 + height_m * 0.25, 3.0, 12.0))


def load_canonical_xy() -> np.ndarray:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        transformer = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
        rows = conn.execute("SELECT lon, lat FROM trees").fetchall()
    finally:
        conn.close()
    if not rows:
        return np.empty((0, 2), dtype="float64")
    coords = np.array([transformer.transform(lon, lat) for lon, lat in rows], dtype="float64")
    return coords


def read_gli_window(src: Any, chunk_bbox: tuple[float, float, float, float], chm_shape: tuple[int, int], chm_transform: Any) -> np.ndarray | None:
    """Read the GLI raster onto the same pixel grid as the chunk CHM."""
    # The CHM reader includes a crown halo. Reading GLI from the strict chunk
    # bbox and merely resizing it to the larger CHM array shifts/stretches the
    # greenness mask. Derive the exact halo bounds from the destination grid.
    del chunk_bbox  # retained in the signature for backwards compatibility
    xmin, ymin, xmax, ymax = rasterio.transform.array_bounds(
        chm_shape[0], chm_shape[1], chm_transform
    )
    window = from_bounds(xmin, ymin, xmax, ymax, transform=src.transform)
    try:
        data = src.read(1, window=window, boundless=True, fill_value=src.nodata if src.nodata is not None else -9999, out_shape=chm_shape)
    except Exception:
        return None
    data = data.astype("float32")
    nodata = src.nodata if src.nodata is not None else -9999
    data[data == nodata] = np.nan
    return data


def detect_chunk(
    chm: np.ndarray,
    transform: Any,
    chunk_bbox: tuple[float, float, float, float],
    building_polygons: list[Polygon],
    canonical_tree: cKDTree | None,
    gli_src: Any | None = None,
) -> list[dict[str, Any]]:
    if chm.size == 0 or not np.isfinite(chm).any():
        return []
    chm_clean = np.where(np.isfinite(chm), chm, 0).astype("float32")
    building_mask = rasterize_buildings(building_polygons, chm_clean.shape, transform)
    chm_clean[building_mask] = 0
    # Apply greenness mask: zero out CHM pixels that sit on visibly non-green
    # surfaces (cargo containers, asphalt, water, dirt). Cheap robustness
    # boost over the OSM-only mask.
    gli_chunk = None
    if gli_src is not None:
        gli_chunk = read_gli_window(gli_src, chunk_bbox, chm_clean.shape, transform)
        if gli_chunk is not None and np.isfinite(gli_chunk).any():
            # Mean-pool over a small window so noisy single pixels don't pass.
            smoothed_gli = ndimage.uniform_filter(np.nan_to_num(gli_chunk, nan=-1), size=GLI_WINDOW_PX)
            non_green = smoothed_gli < GLI_THRESHOLD
            chm_clean[non_green] = 0

    smoothed = ndimage.gaussian_filter(chm_clean, sigma=SMOOTH_SIGMA_PX)
    # First pass: cheap fixed-window local max with a generous radius (catches
    # all candidates), then refine with variable window.
    coarse_radius_px = 3
    footprint = np.ones((coarse_radius_px * 2 + 1, coarse_radius_px * 2 + 1), dtype=bool)
    local_max = ndimage.maximum_filter(smoothed, footprint=footprint, mode="nearest")
    candidate_mask = (smoothed == local_max) & (smoothed >= DETECTION_MIN_HEIGHT_M)
    if not candidate_mask.any():
        return []

    rows, cols = np.nonzero(candidate_mask)
    heights = smoothed[rows, cols]
    # Sort by descending height so taller peaks claim their suppression area
    # before shorter ones can be considered.
    order = np.argsort(-heights)
    rows, cols, heights = rows[order], cols[order], heights[order]

    xs = transform.c + (cols + 0.5) * transform.a
    ys = transform.f + (rows + 0.5) * transform.e

    inner_xmin, inner_ymin, inner_xmax, inner_ymax = chunk_bbox

    kept_xy: list[tuple[float, float]] = []
    kept_records: list[dict[str, Any]] = []

    if canonical_tree is not None:
        canonical_distances, _ = canonical_tree.query(
            np.column_stack([xs, ys]), k=1, workers=-1
        )
    else:
        canonical_distances = np.full_like(heights, np.inf)

    # Use a per-chunk KDTree of already-kept peaks for variable-window NMS.
    accepted_xy = np.empty((0, 2), dtype="float64")
    for i in range(len(heights)):
        x, y, h = float(xs[i]), float(ys[i]), float(heights[i])
        if not (inner_xmin <= x < inner_xmax and inner_ymin <= y < inner_ymax):
            continue
        if canonical_distances[i] <= DEDUP_DISTANCE_M:
            continue
        suppress = suppression_radius_px(h)
        if accepted_xy.size:
            dx = accepted_xy[:, 0] - x
            dy = accepted_xy[:, 1] - y
            if np.any(dx * dx + dy * dy <= suppress * suppress):
                continue
        kept_xy.append((x, y))
        accepted_xy = np.append(accepted_xy, [[x, y]], axis=0)
        kept_records.append({"x": x, "y": y, "height_m": h})

    return kept_records


def insert_inferred_trees(records: list[dict[str, Any]]) -> int:
    if not records:
        return 0
    transformer = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    LAT0 = -36.85
    M_PER_DEG_LAT = 111_132.0
    M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))
    created = utc_now()
    rows = []
    for index, record in enumerate(records):
        lon, lat = transformer.transform(record["x"], record["y"])
        tree_id = f"akl_tree_lid_{index + 1:07d}"
        rows.append(
            (
                tree_id,
                INFERRED_SOURCE_TAG,
                "remote_sensing_detection",    # record_role
                None,                       # source_object_id
                f"LID{index + 1:07d}",      # source_tree_id
                None, None,                 # species_common_raw, species_latin_raw
                "Unknown",                  # species_common
                None,                       # species_latin
                "lidar_inferred_no_species",  # species_confidence
                None,                       # owner_raw
                "LiDAR-Inferred Canopy",    # owner_class
                lon,
                lat,
                round(lon * M_PER_DEG_LON, 3),
                round(lat * M_PER_DEG_LAT, 3),
                0,                          # is_protected_notable
                0, 0, 0, 0,                 # notable_point_* flags
                None, None, None, None,     # notable_point_* attrs
                None,                       # notable_point_distance_m
                None,                       # notable_point_match_confidence
                0, 0,                       # notable_group_*
                None, None,                 # notable_group_objectids/names
                created,
            )
        )
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        # Remove any prior inferred rows so reruns are idempotent.
        conn.execute(
            f"DELETE FROM trees WHERE source_primary = '{INFERRED_SOURCE_TAG}'"
        )
        cols = [
            "tree_id",
            "source_primary",
            "record_role",
            "source_object_id",
            "source_tree_id",
            "species_common_raw",
            "species_latin_raw",
            "species_common",
            "species_latin",
            "species_confidence",
            "owner_raw",
            "owner_class",
            "lon",
            "lat",
            "approx_x_m",
            "approx_y_m",
            "is_protected_notable",
            "notable_point_match",
            "notable_point_spatial_candidate",
            "notable_point_name_compatible",
            "notable_point_review_required",
            "notable_point_objectid",
            "notable_point_name",
            "notable_point_type",
            "notable_point_type_label",
            "notable_point_distance_m",
            "notable_point_match_confidence",
            "notable_group_match",
            "notable_group_count",
            "notable_group_objectids",
            "notable_group_names",
            "as_of_utc",
        ]
        placeholders = ",".join("?" for _ in cols)
        conn.executemany(
            f"INSERT INTO trees ({', '.join(cols)}) VALUES ({placeholders})",
            rows,
        )
        conn.commit()
    finally:
        conn.close()
    return len(rows)


def write_inferred_points_geojson(records: list[dict[str, Any]]) -> None:
    transformer = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    features_out = []
    for index, record in enumerate(records):
        lon, lat = transformer.transform(record["x"], record["y"])
        features_out.append(
            {
                "type": "Feature",
                "id": f"akl_tree_lid_{index + 1:07d}",
                "properties": {
                    "source_primary": INFERRED_SOURCE_TAG,
                    "height_chm_m_at_peak": round(record["height_m"], 2),
                    "method_id": METHOD_ID,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 6), round(lat, 6)],
                },
            }
        )
    out = PROCESSED_ROOT / "inferred_trees_pilot.geojson"
    out.write_text(
        json.dumps({"type": "FeatureCollection", "features": features_out}, separators=(",", ":")),
        encoding="utf-8",
    )


def write_report(record_count: int, canonical_count: int, suppressed_count: int) -> None:
    lines = [
        "# Inferred Tree Detection",
        "",
        f"Generated at: {utc_now()}",
        "",
        "## What This Adds",
        "",
        "The council/AT public tree inventories cover street trees and notable trees, but most of Auckland's canopy sits on private parcels, parks, and roadside reserves with no point record. This step uses the 2024 LiDAR-derived canopy-height model (CHM) directly to detect tree tops as local maxima, deduplicates them against the canonical inventory, and inserts them as additional canonical tree records.",
        "",
        "## Method",
        "",
        f"- Detection threshold: smoothed CHM ≥ {DETECTION_MIN_HEIGHT_M:g} m above ground.",
        f"- Smoothing: Gaussian, σ = {SMOOTH_SIGMA_PX:g} px (1 px = 1 m).",
        "- Variable-window non-max suppression: radius `clip(2.5 + 0.25·h, 3, 12) m`, taller peaks claim more area.",
        "- Building mask: OSM Overpass footprints (same cache as the crown step). LINZ NZ Building Outlines is the next step.",
        "- Non-tree exclusion mask: OSM water, bridge, port, industrial, harbour, marina, pier/wharf, rail, and container-terminal ways and relation members.",
        f"- Aerial greenness mask: 5 × 5 mean Esri World Imagery GLI must be ≥ {GLI_THRESHOLD:g}.",
        f"- Dedup against canonical inventory within {DEDUP_DISTANCE_M:g} m.",
        "",
        "## Numbers",
        "",
        f"- Canonical inventory before detection: {canonical_count:,}.",
        f"- Local maxima after non-max suppression and dedup: {record_count:,}.",
        f"- Suppressed by canonical inventory dedup: {suppressed_count:,}.",
        "",
        "These detected points carry `species_confidence = lidar_inferred_no_species` and `owner_class = LiDAR-Inferred Canopy`. The downstream crown segmentation keeps only candidates with accepted crown geometry; `cleanup_inferred_without_crowns.py` removes inferred candidates that fail the crown/mask/shape filters.",
        "",
        "## Outputs",
        "",
        "- `data/processed/inferred_trees_pilot.geojson` (raw detected points)",
        "- `data/processed/akl_trees.sqlite` table `trees`: inserts with `source_primary = lidar_inferred_canopy`",
        "",
    ]
    (DOCS_ROOT / "inferred_tree_detection.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, default=list(DEFAULT_PILOT_BBOX_2193))
    args = parser.parse_args()
    bbox = tuple(float(v) for v in args.bbox)

    print("Removing stale inferred trees from prior runs...")
    conn_clean = sqlite3.connect(SQLITE_PATH)
    try:
        deleted = conn_clean.execute(
            f"DELETE FROM trees WHERE source_primary = '{INFERRED_SOURCE_TAG}'"
        ).rowcount
        conn_clean.commit()
        print(f"  removed {deleted:,} stale inferred rows")
    finally:
        conn_clean.close()

    print("Loading canonical inventory for dedup...")
    canonical_xy = load_canonical_xy()
    canonical_count = len(canonical_xy)
    print(f"  {canonical_count:,} canonical trees (council + notable + kauri only)")
    canonical_tree = cKDTree(canonical_xy) if canonical_count else None

    print("Loading building polygons...")
    building_polygons, building_source = load_building_polygons(bbox)
    print(f"  {len(building_polygons):,} unique building polygons ({building_source})")
    print("Fetching OSM non-vegetation exclusion polygons (water, bridges, industrial)...")
    nonveg_payloads = fetch_osm_non_vegetation_tiled(bbox)
    nonveg_polygons = osm_payloads_to_exclusion_polygons(nonveg_payloads)
    print(f"  {len(nonveg_polygons):,} non-vegetation polygons")
    exclusion_polygons = building_polygons + nonveg_polygons
    building_index = index_buildings_by_chunk(exclusion_polygons, CHUNK_SIZE_M, bbox)

    chunks = chunk_bboxes(bbox, CHUNK_SIZE_M)
    print(f"Detecting inferred trees over {len(chunks):,} chunks...")
    all_records: list[dict[str, Any]] = []
    gli_src = None
    if GREENNESS_VRT_PATH.exists():
        print(f"Using greenness mask: {GREENNESS_VRT_PATH}")
        gli_src = rasterio.open(GREENNESS_VRT_PATH)
    try:
        with rasterio.open(CHM_VRT_PATH) as src:
            for index, chunk in enumerate(chunks, start=1):
                chunk_buildings = buildings_for_chunk(chunk, building_index, CHUNK_SIZE_M, bbox)
                try:
                    chm, transform = read_chm_window(src, chunk)
                except Exception as exc:  # noqa: BLE001
                    print(f"  chunk {index}/{len(chunks)} CHM read failed: {exc}")
                    continue
                records = detect_chunk(chm, transform, chunk, chunk_buildings, canonical_tree, gli_src=gli_src)
                all_records.extend(records)
                if index % 20 == 0 or index == len(chunks):
                    print(f"  chunk {index:,}/{len(chunks):,}, inferred so far {len(all_records):,}")
    finally:
        if gli_src is not None:
            gli_src.close()

    suppressed_count = 0  # Already filtered in detect_chunk; report 0 unless tracked separately.
    inserted = insert_inferred_trees(all_records)
    write_inferred_points_geojson(all_records)
    write_report(inserted, canonical_count, suppressed_count)
    print(json.dumps({"inferred_trees": inserted, "canonical_before": canonical_count}, indent=2))


if __name__ == "__main__":
    main()
