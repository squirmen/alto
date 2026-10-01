#!/usr/bin/env python3
"""Build tree crown polygons over the full pilot LiDAR area.

Pipeline:
1. Read the per-chunk CHM tiles produced by ``build_lidar_pilot.py``.
2. Fetch the LINZ NZ Building Outlines (cached) for the pilot bbox, fall
   back to OSM via Overpass when LINZ is unavailable.
3. For each 1 km × 1 km chunk (with a halo big enough for the max crown
   radius), assemble the CHM, mask buildings, then run point-constrained
   nearest-tree segmentation.
4. Polygonize crown labels per chunk and append to a single GeoJSON / SQLite
   table. No final dollar values are computed here — that happens in
   ``build_tree_valuation.py``.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio import features
from rasterio.windows import from_bounds
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Polygon, box, mapping, shape
from shapely.ops import transform as shapely_transform
from shapely.ops import polygonize, unary_union


ROOT = Path(__file__).resolve().parents[1]
RAW_OSM_ROOT = ROOT / "data" / "raw" / "osm"
RAW_LINZ_BUILDINGS = ROOT / "data" / "raw" / "linz_buildings"
from _pilot_config import active_pilot_name as _active_pilot_name  # noqa: E402
_PILOT_NAME = _active_pilot_name()
_PILOT_SLUG = "waitemata_lidar_pilot" if _PILOT_NAME == "waitemata_v1" else f"{_PILOT_NAME}_lidar"
INTERIM_ROOT = ROOT / "data" / "interim" / _PILOT_SLUG
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"

CHM_VRT_PATH = INTERIM_ROOT / "chm.vrt"
GREENNESS_VRT_PATH = ROOT / "data" / "interim" / ("greenness" if _PILOT_NAME == "waitemata_v1" else f"greenness_{_PILOT_NAME}") / "greenness.vrt"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"
from _pilot_config import DEFAULT_PILOT_BBOX_2193  # noqa: E402
CANOPY_MIN_HEIGHT_M = 3.0
MIN_CROWN_AREA_M2 = 4.0
CHUNK_SIZE_M = 1024.0
CROWN_HALO_M = 25.0  # > max crown radius
CROWN_GLI_THRESHOLD = 0.03  # crown pixels must be visibly green
CROWN_GLI_WINDOW_PX = 5

# Shape filter — reject elongated polygons that are almost certainly not
# trees (boats, container rows, vehicles, parked sailboat masts). Real tree
# crowns viewed from above are roughly circular: bbox aspect ratio < 2.5
# for the vast majority. Boats / cargo / vehicles have aspect ratios of
# 3 – 10. Threshold of 3.5 is conservative enough to keep wide oaks,
# spreading pohutukawa, and asymmetric crowns inside the keep set.
MAX_CROWN_ASPECT_RATIO = 3.5
# Minimum bbox fill ratio — crowns that fill < 30% of their own bounding
# box are very likely fragmented detections (e.g. roof edges, cargo lines,
# multiple disjoint pieces of a non-tree object). Real tree crowns usually
# fill 50%+ of their bounding box.
MIN_CROWN_BBOX_FILL = 0.30
MAX_OSM_BBOX_M = 4000.0
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
OVERPASS_POLITE_SLEEP_S = 2.0  # between successful tiles
OVERPASS_MAX_ATTEMPTS = 6
OSM_NONVEG_CACHE_VERSION = "v2"
LINZ_BUILDING_CANDIDATES = (
    RAW_LINZ_BUILDINGS / "nz_building_outlines_waitemata.gpkg",
    RAW_LINZ_BUILDINGS / "nz_building_outlines_pilot.gpkg",
    RAW_LINZ_BUILDINGS / "nz_building_outlines.gpkg",
)


def _overpass_get(query: str) -> dict[str, Any]:
    """Resilient Overpass call: rotates endpoints + exponential backoff on 429/5xx."""
    last_error: Exception | None = None
    for attempt in range(1, OVERPASS_MAX_ATTEMPTS + 1):
        endpoint = OVERPASS_ENDPOINTS[(attempt - 1) % len(OVERPASS_ENDPOINTS)]
        try:
            response = requests.get(
                endpoint,
                params={"data": query},
                headers={"User-Agent": "akl-trees-crown-pilot/0.4"},
                timeout=240,
            )
            if response.status_code == 429:
                wait = min(180, 30 * attempt + random.random() * 5)
                print(f"  Overpass 429 from {endpoint}; sleeping {wait:.0f}s and retrying")
                time.sleep(wait)
                continue
            if response.status_code >= 500:
                wait = min(120, 15 * attempt)
                print(f"  Overpass {response.status_code} from {endpoint}; sleeping {wait:.0f}s")
                time.sleep(wait)
                continue
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_error = exc
            wait = min(60, 10 * attempt)
            print(f"  Overpass attempt {attempt} failed: {exc}; sleeping {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Overpass repeatedly failed; last error: {last_error}")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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


def bbox_2193_to_4326(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    transformer = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    xmin, ymin, xmax, ymax = bbox
    corners = [
        transformer.transform(xmin, ymin),
        transformer.transform(xmin, ymax),
        transformer.transform(xmax, ymin),
        transformer.transform(xmax, ymax),
    ]
    lons = [lon for lon, _ in corners]
    lats = [lat for _, lat in corners]
    return min(lons), min(lats), max(lons), max(lats)


def fetch_osm_buildings_tile(bbox_2193_tile: tuple[float, float, float, float], cache_dir: Path) -> dict[str, Any]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    name = "osm_buildings_{:.0f}_{:.0f}_{:.0f}_{:.0f}.json".format(*bbox_2193_tile)
    out_path = cache_dir / name
    if out_path.exists() and out_path.stat().st_size > 0:
        return json.loads(out_path.read_text(encoding="utf-8"))
    min_lon, min_lat, max_lon, max_lat = bbox_2193_to_4326(bbox_2193_tile)
    bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    query = f"""[out:json][timeout:90];
(
  way["building"]({bbox});
  relation["building"]({bbox});
);
out geom;"""
    data = _overpass_get(query)
    out_path.write_text(json.dumps(data), encoding="utf-8")
    time.sleep(OVERPASS_POLITE_SLEEP_S)
    return data


def fetch_osm_non_vegetation_tile(bbox_2193_tile: tuple[float, float, float, float], cache_dir: Path) -> dict[str, Any]:
    """Fetch OSM features that should *not* be treated as canopy: water, bridges,
    motorways at elevation, industrial / port / harbour areas, piers, wharves,
    container terminals, cranes, etc.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    name = f"osm_nonveg_{OSM_NONVEG_CACHE_VERSION}_" + "{:.0f}_{:.0f}_{:.0f}_{:.0f}.json".format(*bbox_2193_tile)
    out_path = cache_dir / name
    if out_path.exists() and out_path.stat().st_size > 0:
        return json.loads(out_path.read_text(encoding="utf-8"))
    min_lon, min_lat, max_lon, max_lat = bbox_2193_to_4326(bbox_2193_tile)
    bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    # Mask non-vegetation features. Auckland Port is tagged as
    # ``landuse=industrial`` in OSM (not ``port``), so we explicitly query
    # industrial polygons too. We don't worry about masking legitimate
    # roadside trees in commercial areas because the greenness mask handles
    # that — anything green stays in even if the OSM polygon says
    # industrial.
    query = f"""[out:json][timeout:120];
(
  way["natural"="water"]({bbox});
  relation["natural"="water"]({bbox});
  way["waterway"~"river|canal|stream|riverbank"]({bbox});
  way["landuse"~"port|harbour|industrial|railway|brownfield|construction|quarry|landfill"]({bbox});
  relation["landuse"~"port|harbour|industrial|railway|brownfield|construction|quarry|landfill"]({bbox});
  way["man_made"~"pier|wharf|breakwater|crane|storage_tank|silo|bridge|works|gantry|tower|container_terminal"]({bbox});
  relation["man_made"~"pier|wharf|breakwater|crane|storage_tank|silo|bridge|works|gantry|tower|container_terminal"]({bbox});
  way["leisure"~"marina|slipway"]({bbox});
  relation["leisure"~"marina|slipway"]({bbox});
  way["amenity"="ferry_terminal"]({bbox});
  relation["amenity"="ferry_terminal"]({bbox});
  way["harbour"="yes"]({bbox});
  relation["harbour"="yes"]({bbox});
  way["bridge"="yes"]({bbox});
  way["bridge"="viaduct"]({bbox});
  way["highway"~"motorway|trunk|motorway_link|trunk_link"]["bridge"]({bbox});
  way["aeroway"]({bbox});
  way["railway"~"rail|light_rail|tram|yard|station|platform"]({bbox});
);
out geom;"""
    data = _overpass_get(query)
    out_path.write_text(json.dumps(data), encoding="utf-8")
    time.sleep(OVERPASS_POLITE_SLEEP_S)
    return data


def _sub_bboxes(bbox_2193: tuple[float, float, float, float]) -> list[tuple[float, float, float, float]]:
    xmin, ymin, xmax, ymax = bbox_2193
    out: list[tuple[float, float, float, float]] = []
    y = ymin
    while y < ymax:
        x = xmin
        y_top = min(y + MAX_OSM_BBOX_M, ymax)
        while x < xmax:
            x_right = min(x + MAX_OSM_BBOX_M, xmax)
            out.append((x, y, x_right, y_top))
            x = x_right
        y = y_top
    return out


def fetch_osm_buildings_tiled(bbox_2193: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    cache_dir = RAW_OSM_ROOT / "buildings_tiles"
    sub_bboxes = _sub_bboxes(bbox_2193)
    print(f"Fetching OSM buildings in {len(sub_bboxes)} tiles...")
    payloads: list[dict[str, Any]] = []
    for index, sub in enumerate(sub_bboxes, start=1):
        try:
            payload = fetch_osm_buildings_tile(sub, cache_dir)
            payloads.append(payload)
        except Exception as exc:  # noqa: BLE001
            print(f"  OSM building tile {index} failed: {exc}; retrying once")
            payload = fetch_osm_buildings_tile(sub, cache_dir)
            payloads.append(payload)
        print(f"  OSM building tile {index}/{len(sub_bboxes)}: {len(payload.get('elements', [])):,} elements")
    return payloads


def fetch_osm_non_vegetation_tiled(bbox_2193: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    cache_dir = RAW_OSM_ROOT / "nonveg_tiles"
    sub_bboxes = _sub_bboxes(bbox_2193)
    print(f"Fetching OSM water/bridge/industrial in {len(sub_bboxes)} tiles...")
    payloads: list[dict[str, Any]] = []
    for index, sub in enumerate(sub_bboxes, start=1):
        try:
            payload = fetch_osm_non_vegetation_tile(sub, cache_dir)
            payloads.append(payload)
        except Exception as exc:  # noqa: BLE001
            print(f"  OSM nonveg tile {index} failed: {exc}; retrying once")
            payload = fetch_osm_non_vegetation_tile(sub, cache_dir)
            payloads.append(payload)
        print(f"  OSM nonveg tile {index}/{len(sub_bboxes)}: {len(payload.get('elements', [])):,} elements")
    return payloads


def _clean_polygon(geometry: Any) -> Polygon | None:
    if geometry is None or geometry.is_empty:
        return None
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    if geometry.is_empty or geometry.area <= 1:
        return None
    return geometry


def load_linz_building_polygons(bbox_2193: tuple[float, float, float, float]) -> list[Polygon]:
    """Load local LINZ NZ Building Outlines clipped to the pilot bbox.

    The authoritative LINZ layer is too large to bundle by default. If a
    clipped GeoPackage/Shapefile/GeoJSON exists under data/raw/linz_buildings,
    prefer it over OSM. Otherwise return an empty list and the caller falls
    back to the cached Overpass building mask.
    """
    candidates = list(LINZ_BUILDING_CANDIDATES)
    candidates.extend(sorted(RAW_LINZ_BUILDINGS.glob("*.gpkg")))
    candidates.extend(sorted(RAW_LINZ_BUILDINGS.glob("*.shp")))
    candidates.extend(sorted(RAW_LINZ_BUILDINGS.glob("*.geojson")))
    candidates.extend(sorted(RAW_LINZ_BUILDINGS.glob("*.fgb")))

    seen_paths: set[Path] = set()
    bbox_with_halo = (
        bbox_2193[0] - CROWN_HALO_M,
        bbox_2193[1] - CROWN_HALO_M,
        bbox_2193[2] + CROWN_HALO_M,
        bbox_2193[3] + CROWN_HALO_M,
    )
    for path in candidates:
        if path in seen_paths or not path.exists():
            continue
        seen_paths.add(path)
        try:
            import geopandas as gpd
            import pyogrio

            layer = None
            if path.suffix.lower() == ".gpkg":
                layers = pyogrio.list_layers(str(path))
                layer_names = [row[0] for row in layers]
                layer = next((name for name in layer_names if "building" in name.lower()), layer_names[0] if layer_names else None)
            gdf = gpd.read_file(path, layer=layer, bbox=bbox_with_halo)
            if gdf.empty:
                continue
            if gdf.crs is None:
                gdf = gdf.set_crs("EPSG:2193")
            elif str(gdf.crs).upper() not in {"EPSG:2193", "2193"}:
                gdf = gdf.to_crs("EPSG:2193")
            polygons = []
            clip_box = box(*bbox_with_halo)
            for geometry in gdf.geometry:
                cleaned = _clean_polygon(geometry)
                if cleaned is None or not cleaned.intersects(clip_box):
                    continue
                polygons.append(cleaned)
            if polygons:
                print(f"  Loaded {len(polygons):,} LINZ building polygons from {path.relative_to(ROOT)}")
                return polygons
        except Exception as exc:  # noqa: BLE001
            print(f"  LINZ building load failed for {path}: {exc}")
    return []


def load_building_polygons(bbox_2193: tuple[float, float, float, float]) -> tuple[list[Polygon], str]:
    linz_polygons = load_linz_building_polygons(bbox_2193)
    if linz_polygons:
        return linz_polygons, "LINZ NZ Building Outlines"
    payloads = fetch_osm_buildings_tiled(bbox_2193)
    return osm_payloads_to_polygons(payloads), "OpenStreetMap buildings via Overpass"


def osm_payloads_to_polygons(payloads: list[dict[str, Any]]) -> list[Polygon]:
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    polygons: list[Polygon] = []
    seen_ids: set[tuple[str | None, int | None]] = set()
    for payload in payloads:
        for element in payload.get("elements", []):
            element_id = element.get("id")
            if element_id in seen_ids:
                continue
            seen_ids.add(element_id)
            if element.get("type") != "way" or "geometry" not in element:
                continue
            coords = [(node["lon"], node["lat"]) for node in element["geometry"]]
            if len(coords) < 4 or coords[0] != coords[-1]:
                continue
            projected = [transformer.transform(lon, lat) for lon, lat in coords]
            polygon = Polygon(projected)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            if polygon.is_empty or polygon.area <= 1:
                continue
            polygons.append(polygon)
    return polygons


def osm_payloads_to_exclusion_polygons(payloads: list[dict[str, Any]]) -> list[Polygon]:
    """Turn OSM water / bridge / industrial / motorway features into polygons
    in EPSG:2193. Closed ways become polygons directly; linear ways (highways,
    bridges, railways, waterways) get a buffer so they actually mask CHM
    pixels they sit above.
    """
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    polygons: list[Polygon] = []
    seen_ids: set[int] = set()
    LINE_BUFFER_BY_KIND = {
        "motorway": 15.0,
        "trunk": 12.0,
        "primary": 10.0,
        "motorway_link": 10.0,
        "trunk_link": 10.0,
        "rail": 6.0,
        "light_rail": 5.0,
        "bridge_way": 12.0,
        "waterway": 6.0,
        "default": 8.0,
    }
    def _valid_polygon(polygon: Polygon) -> Polygon | None:
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.is_empty or polygon.area <= 1:
            return None
        return polygon

    def _buffered_line(coords_2193: list[tuple[float, float]], tags: dict[str, Any]) -> Polygon | None:
        if len(coords_2193) < 2:
            return None
        buffer_m = LINE_BUFFER_BY_KIND["default"]
        highway = tags.get("highway")
        if highway and highway in LINE_BUFFER_BY_KIND:
            buffer_m = LINE_BUFFER_BY_KIND[highway]
        elif tags.get("waterway"):
            buffer_m = LINE_BUFFER_BY_KIND["waterway"]
        elif tags.get("railway") and tags["railway"] in LINE_BUFFER_BY_KIND:
            buffer_m = LINE_BUFFER_BY_KIND[tags["railway"]]
        elif tags.get("bridge") in ("yes", "viaduct"):
            buffer_m = LINE_BUFFER_BY_KIND["bridge_way"]
        line = LineString(coords_2193)
        if line.is_empty:
            return None
        polygon = line.buffer(buffer_m, cap_style=2, join_style=2)
        return _valid_polygon(polygon)

    for payload in payloads:
        for element in payload.get("elements", []):
            element_id = element.get("id")
            element_type = element.get("type")
            seen_key = (element_type, element_id)
            if seen_key in seen_ids:
                continue
            seen_ids.add(seen_key)
            if element_type not in {"way", "relation"}:
                continue
            tags = element.get("tags", {}) or {}
            if element_type == "way":
                coords = [(node["lon"], node["lat"]) for node in element.get("geometry", [])]
                if len(coords) < 2:
                    continue
                projected = [transformer.transform(lon, lat) for lon, lat in coords]
                is_closed = len(projected) >= 4 and projected[0] == projected[-1]
                polygon = _valid_polygon(Polygon(projected)) if is_closed else None
                if polygon is None:
                    polygon = _buffered_line(projected, tags)
                if polygon is not None:
                    polygons.append(polygon)
                continue

            # Multipolygon relations carry many of the important harbour and
            # port exclusions in Auckland. Overpass returns their member ways
            # with geometry, but the old parser ignored relation elements.
            # Keep outer member rings/lines, polygonize split rings where
            # necessary, and intentionally ignore inner holes for exclusion
            # masks: slight over-masking on water/port is better than keeping
            # moored boats, cargo lines, or ship superstructures as "canopy".
            relation_polygons: list[Polygon] = []
            relation_lines: list[LineString] = []
            for member in element.get("members", []):
                if member.get("role") == "inner":
                    continue
                coords = [(node["lon"], node["lat"]) for node in member.get("geometry", [])]
                if len(coords) < 2:
                    continue
                projected = [transformer.transform(lon, lat) for lon, lat in coords]
                is_closed = len(projected) >= 4 and projected[0] == projected[-1]
                if is_closed:
                    polygon = _valid_polygon(Polygon(projected))
                    if polygon is not None:
                        relation_polygons.append(polygon)
                else:
                    line = LineString(projected)
                    if not line.is_empty:
                        relation_lines.append(line)
            if relation_lines:
                try:
                    merged = unary_union(relation_lines)
                    for polygon in polygonize(merged):
                        valid = _valid_polygon(polygon)
                        if valid is not None:
                            relation_polygons.append(valid)
                except Exception:  # noqa: BLE001 - fall back to buffered lines
                    for line in relation_lines:
                        polygon = _buffered_line(list(line.coords), tags)
                        if polygon is not None:
                            relation_polygons.append(polygon)
            polygons.extend(relation_polygons)
    return polygons


def index_buildings_by_chunk(
    polygons: list[Polygon],
    chunk_size_m: float,
    bbox: tuple[float, float, float, float],
) -> dict[tuple[int, int], list[Polygon]]:
    xmin, ymin, _, _ = bbox
    index: dict[tuple[int, int], list[Polygon]] = defaultdict(list)
    for polygon in polygons:
        b_xmin, b_ymin, b_xmax, b_ymax = polygon.bounds
        cx0 = math.floor((b_xmin - xmin) / chunk_size_m)
        cx1 = math.floor((b_xmax - xmin) / chunk_size_m)
        cy0 = math.floor((b_ymin - ymin) / chunk_size_m)
        cy1 = math.floor((b_ymax - ymin) / chunk_size_m)
        for cx in range(cx0, cx1 + 1):
            for cy in range(cy0, cy1 + 1):
                index[(cx, cy)].append(polygon)
    return index


def buildings_for_chunk(
    chunk_bbox: tuple[float, float, float, float],
    building_index: dict[tuple[int, int], list[Polygon]],
    chunk_size_m: float,
    bbox: tuple[float, float, float, float],
) -> list[Polygon]:
    xmin, ymin, _, _ = bbox
    cx = math.floor((chunk_bbox[0] - xmin) / chunk_size_m)
    cy = math.floor((chunk_bbox[1] - ymin) / chunk_size_m)
    candidates: list[Polygon] = []
    seen: set[int] = set()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for polygon in building_index.get((cx + dx, cy + dy), []):
                if id(polygon) in seen:
                    continue
                seen.add(id(polygon))
                candidates.append(polygon)
    chunk_box = box(*chunk_bbox).buffer(CROWN_HALO_M)
    return [polygon for polygon in candidates if polygon.intersects(chunk_box)]


def load_pilot_trees(bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        rows = conn.execute(
            """
            SELECT
                t.tree_id,
                t.source_primary,
                t.source_tree_id,
                t.species_common,
                t.species_latin,
                t.owner_class,
                t.is_protected_notable,
                t.lon,
                t.lat,
                l.x_2193,
                l.y_2193,
                l.chm_local_max_2m_m
            FROM trees t
            JOIN tree_lidar_pilot l ON t.tree_id = l.tree_id
            WHERE l.chm_local_max_2m_m IS NOT NULL
            """
        ).fetchall()
    finally:
        conn.close()
    keys = [
        "tree_id",
        "source_primary",
        "source_tree_id",
        "species_common",
        "species_latin",
        "owner_class",
        "is_protected_notable",
        "lon",
        "lat",
        "x_2193",
        "y_2193",
        "chm_local_max_2m_m",
    ]
    out = []
    for row in rows:
        record = dict(zip(keys, row))
        if record["x_2193"] is None or record["y_2193"] is None:
            continue
        out.append(record)
    return out


def index_trees_by_chunk(
    trees: list[dict[str, Any]],
    chunk_size_m: float,
    bbox: tuple[float, float, float, float],
) -> dict[tuple[int, int], list[dict[str, Any]]]:
    xmin, ymin, _, _ = bbox
    index: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for tree in trees:
        cx = math.floor((tree["x_2193"] - xmin) / chunk_size_m)
        cy = math.floor((tree["y_2193"] - ymin) / chunk_size_m)
        index[(cx, cy)].append(tree)
    return index


def trees_for_chunk(
    chunk_bbox: tuple[float, float, float, float],
    tree_index: dict[tuple[int, int], list[dict[str, Any]]],
    chunk_size_m: float,
    bbox: tuple[float, float, float, float],
) -> list[dict[str, Any]]:
    xmin, ymin, _, _ = bbox
    cx = math.floor((chunk_bbox[0] - xmin) / chunk_size_m)
    cy = math.floor((chunk_bbox[1] - ymin) / chunk_size_m)
    seen: set[str] = set()
    candidates: list[dict[str, Any]] = []
    x_lo = chunk_bbox[0] - CROWN_HALO_M
    y_lo = chunk_bbox[1] - CROWN_HALO_M
    x_hi = chunk_bbox[2] + CROWN_HALO_M
    y_hi = chunk_bbox[3] + CROWN_HALO_M
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for tree in tree_index.get((cx + dx, cy + dy), []):
                if tree["tree_id"] in seen:
                    continue
                if not (x_lo <= tree["x_2193"] <= x_hi and y_lo <= tree["y_2193"] <= y_hi):
                    continue
                seen.add(tree["tree_id"])
                candidates.append(tree)
    return candidates


def crown_radius_for_tree(height_m: float | None) -> float:
    if height_m is None or not np.isfinite(height_m):
        return 7.0
    return float(np.clip(height_m * 0.65, 5.0, 14.0))


def read_chm_window(src: Any, chunk_bbox: tuple[float, float, float, float]) -> tuple[np.ndarray, Any]:
    xmin, ymin, xmax, ymax = chunk_bbox
    window = from_bounds(xmin - CROWN_HALO_M, ymin - CROWN_HALO_M, xmax + CROWN_HALO_M, ymax + CROWN_HALO_M, transform=src.transform)
    data = src.read(1, window=window, boundless=True, fill_value=src.nodata if src.nodata is not None else -9999)
    transform = rasterio.windows.transform(window, src.transform)
    data = data.astype("float32")
    nodata = src.nodata if src.nodata is not None else -9999
    data[data == nodata] = np.nan
    return data, transform


def read_gli_for_chunk(src: Any, chunk_bbox: tuple[float, float, float, float], chm_shape: tuple[int, int], chm_transform: Any) -> np.ndarray | None:
    """Read the GLI raster on the same pixel grid as the CHM chunk (with halo)."""
    del chunk_bbox  # destination transform is authoritative, including halo/edge clipping
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


def rasterize_buildings(polygons: list[Polygon], shape_hw: tuple[int, int], transform: Any) -> np.ndarray:
    if not polygons:
        return np.zeros(shape_hw, dtype=bool)
    buffered = [polygon.buffer(1.0) for polygon in polygons if not polygon.is_empty]
    mask = features.rasterize(
        [(geom, 1) for geom in buffered],
        out_shape=shape_hw,
        transform=transform,
        fill=0,
        dtype="uint8",
    )
    return mask.astype(bool)


def segment_chunk(
    chm: np.ndarray,
    transform: Any,
    building_polygons: list[Polygon],
    chunk_trees: list[dict[str, Any]],
    chunk_bbox: tuple[float, float, float, float],
    gli_chunk: np.ndarray | None = None,
) -> list[dict[str, Any]]:
    if not chunk_trees or chm.size == 0:
        return []
    building_mask = rasterize_buildings(building_polygons, chm.shape, transform)
    candidate_mask = np.isfinite(chm) & (chm >= CANOPY_MIN_HEIGHT_M) & (~building_mask)
    if gli_chunk is not None and np.isfinite(gli_chunk).any():
        smoothed = ndimage.uniform_filter(np.nan_to_num(gli_chunk, nan=-1), size=CROWN_GLI_WINDOW_PX)
        candidate_mask &= smoothed >= CROWN_GLI_THRESHOLD
    if not candidate_mask.any():
        return []
    structure_labels, _ = ndimage.label(candidate_mask)
    patch_sizes = np.bincount(structure_labels.ravel())
    keep_patch = patch_sizes >= MIN_CROWN_AREA_M2
    keep_patch[0] = False
    candidate_mask = keep_patch[structure_labels]
    if not candidate_mask.any():
        return []

    rows, cols = np.nonzero(candidate_mask)
    if rows.size == 0:
        return []
    xs = transform.c + (cols + 0.5) * transform.a
    ys = transform.f + (rows + 0.5) * transform.e
    pixel_xy = np.column_stack([xs, ys])

    tree_xy = np.array([[tree["x_2193"], tree["y_2193"]] for tree in chunk_trees], dtype="float64")
    tree_heights = np.array([tree["chm_local_max_2m_m"] for tree in chunk_trees], dtype="float64")
    tree_radii = np.array([crown_radius_for_tree(h) for h in tree_heights], dtype="float64")

    kd = cKDTree(tree_xy)
    distances, nearest = kd.query(pixel_xy, k=1, workers=-1)
    keep = distances <= tree_radii[nearest]
    if not keep.any():
        return []

    labels = np.zeros(chm.shape, dtype="int32")
    labels[rows[keep], cols[keep]] = nearest[keep].astype("int32") + 1

    by_label: dict[int, list[Polygon]] = defaultdict(list)
    for geom, value in features.shapes(labels, mask=labels > 0, transform=transform, connectivity=4):
        label = int(value)
        if label <= 0:
            continue
        polygon = shape(geom)
        if polygon.is_empty:
            continue
        by_label[label].append(polygon)

    xmin, ymin, xmax, ymax = chunk_bbox
    records: list[dict[str, Any]] = []
    for label, parts in by_label.items():
        tree = chunk_trees[label - 1]
        # Only emit crown for trees whose seed point falls inside the chunk's
        # strict interior — keeps halo-only trees for boundary use only.
        tx, ty = tree["x_2193"], tree["y_2193"]
        if not (xmin <= tx < xmax and ymin <= ty < ymax):
            continue
        try:
            union = unary_union(parts)
            if union.is_empty:
                continue
            union = union.buffer(0)
            if union.area < MIN_CROWN_AREA_M2:
                continue
            smoothed = union.buffer(0.65, join_style=1).buffer(-0.65, join_style=1)
            if not smoothed.is_empty and smoothed.area >= MIN_CROWN_AREA_M2:
                simplified = smoothed.simplify(0.45, preserve_topology=True)
                if not simplified.is_empty and simplified.is_valid:
                    union = simplified
                else:
                    union = smoothed
        except Exception:  # noqa: BLE001 - degenerate geometry fallback
            continue
        # Shape filter — boats / vehicles / cargo are elongated; tree crowns
        # are roughly circular when seen from above. Reject anything with
        # bbox aspect ratio > MAX_CROWN_ASPECT_RATIO or that fills < 30% of
        # its own bounding box (a sign of fragmented non-tree detections).
        bxmin, bymin, bxmax, bymax = union.bounds
        bbox_w = bxmax - bxmin
        bbox_h = bymax - bymin
        if bbox_w <= 0 or bbox_h <= 0:
            continue
        aspect = max(bbox_w, bbox_h) / max(min(bbox_w, bbox_h), 1e-3)
        if aspect > MAX_CROWN_ASPECT_RATIO:
            continue
        bbox_area = bbox_w * bbox_h
        if bbox_area > 0 and (union.area / bbox_area) < MIN_CROWN_BBOX_FILL:
            continue
        mask = labels == label
        heights = chm[mask]
        heights = heights[np.isfinite(heights)]
        if heights.size == 0:
            continue
        crown_area_m2 = float(mask.sum())
        records.append(
            {
                "tree": tree,
                "geometry_2193": union,
                "crown_area_m2": crown_area_m2,
                "crown_diameter_m": float(2 * math.sqrt(crown_area_m2 / math.pi)),
                "crown_mean_chm_m": float(np.mean(heights)),
                "crown_max_chm_m": float(np.max(heights)),
            }
        )
    return records


def write_sqlite(records: list[dict[str, Any]]) -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_crown_pilot")
        conn.execute(
            """
            CREATE TABLE tree_crown_pilot (
                tree_id TEXT PRIMARY KEY,
                crown_area_m2 REAL,
                crown_diameter_m REAL,
                crown_mean_chm_m REAL,
                crown_max_chm_m REAL,
                method_id TEXT,
                created_at_utc TEXT
            )
            """
        )
        created = utc_now()
        conn.executemany(
            """
            INSERT INTO tree_crown_pilot (
                tree_id, crown_area_m2, crown_diameter_m, crown_mean_chm_m,
                crown_max_chm_m, method_id, created_at_utc
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    record["tree"]["tree_id"],
                    record["crown_area_m2"],
                    record["crown_diameter_m"],
                    record["crown_mean_chm_m"],
                    record["crown_max_chm_m"],
                    "chm_point_constrained_chunked_v1",
                    created,
                )
                for record in records
            ],
        )
        conn.execute("CREATE INDEX idx_tree_crown_area ON tree_crown_pilot(crown_area_m2)")
        conn.commit()
    finally:
        conn.close()


def write_crown_geojson(records: list[dict[str, Any]]) -> None:
    transformer = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    features_out = []
    for record in records:
        tree = record["tree"]
        geom_4326 = shapely_transform(transformer.transform, record["geometry_2193"])
        properties = {
            "tree_id": tree["tree_id"],
            "source_primary": tree["source_primary"],
            "source_tree_id": tree["source_tree_id"],
            "species_common": tree["species_common"],
            "species_latin": tree["species_latin"],
            "owner_class": tree["owner_class"],
            "is_protected_notable": tree["is_protected_notable"],
            "crown_area_m2": round(record["crown_area_m2"], 1),
            "crown_diameter_m": round(record["crown_diameter_m"], 1),
            "crown_mean_chm_m": round(record["crown_mean_chm_m"], 2),
            "crown_max_chm_m": round(record["crown_max_chm_m"], 2),
        }
        features_out.append(
            {
                "type": "Feature",
                "id": tree["tree_id"],
                "properties": properties,
                "geometry": mapping(geom_4326),
            }
        )
    (PROCESSED_ROOT / "tree_crowns_pilot.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features_out}, separators=(",", ":")),
        encoding="utf-8",
    )


def update_points_geojson(records: list[dict[str, Any]]) -> None:
    points_path = PROCESSED_ROOT / "trees_map_points.geojson"
    if not points_path.exists():
        return
    by_tree = {record["tree"]["tree_id"]: record for record in records}
    data = json.loads(points_path.read_text(encoding="utf-8"))
    for feature in data.get("features", []):
        tree_id = feature.get("id") or feature.get("properties", {}).get("tree_id")
        record = by_tree.get(tree_id)
        props = feature.setdefault("properties", {})
        if record:
            props["crown_pilot"] = 1
            props["crown_area_m2"] = round(record["crown_area_m2"], 1)
            props["crown_diameter_m"] = round(record["crown_diameter_m"], 1)
            props["crown_mean_chm_m"] = round(record["crown_mean_chm_m"], 2)
            props["crown_max_chm_m"] = round(record["crown_max_chm_m"], 2)
        else:
            props["crown_pilot"] = 0
    points_path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def write_report(
    records: list[dict[str, Any]],
    building_count: int,
    building_source: str,
    nonveg_count: int,
    chunk_count: int,
    bbox: tuple[float, float, float, float],
) -> None:
    crown_count = len(records)
    crown_area = sum(record["crown_area_m2"] for record in records)
    max_height = max((record["crown_max_chm_m"] for record in records), default=0)
    median_area = float(np.median([record["crown_area_m2"] for record in records])) if records else 0

    lines = [
        "# Tree Crown Pilot",
        "",
        f"Generated at: {utc_now()}",
        f"Pilot bbox EPSG:2193: `{list(bbox)}` (~{(bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) / 1e6:.1f} km²).",
        "",
        "## What This Adds",
        "",
        "Each canonical tree point inside the pilot LiDAR area now has a derived crown polygon (where canopy structure is present) plus structural metrics. Dollar valuation is computed separately in `build_tree_valuation.py`.",
        "",
        "## Building Mask",
        "",
        f"- Building polygons used: {building_count:,}.",
        f"- Source: {building_source}.",
        "- Preferred source: LINZ NZ Building Outlines layer 101290. If no clipped local LINZ file is present, the script falls back to OpenStreetMap building footprints via Overpass API.",
        "",
        "## Non-Tree Exclusion Mask",
        "",
        f"- Water / bridge / port / industrial exclusion polygons used: {nonveg_count:,}.",
        "- Source: OpenStreetMap ways and relation members for water, harbour, port, industrial, piers, wharves, bridges, rail, marinas, and container-terminal features.",
        "",
        "## Crown Segmentation",
        "",
        f"- 1 km × 1 km processing chunks: {chunk_count:,}.",
        f"- Crown polygons generated: {crown_count:,}.",
        f"- Total crown area: {crown_area:,.0f} m².",
        f"- Median crown area: {median_area:,.1f} m².",
        f"- Maximum crown CHM height: {max_height:,.1f} m.",
        "",
        "Segmentation is point-constrained: known tree locations claim nearby CHM pixels after building and non-tree exclusion masks are applied. Each pixel goes to its nearest tree within a height-scaled radius (`min(0.65 × height, 14) m, ≥ 5 m`).",
        "",
        "## Outputs",
        "",
        "- `data/processed/tree_crowns_pilot.geojson`",
        "- `data/processed/akl_trees.sqlite`, table `tree_crown_pilot`",
        "",
    ]
    (DOCS_ROOT / "tree_crown_service_pilot.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, default=list(DEFAULT_PILOT_BBOX_2193))
    args = parser.parse_args()
    bbox = tuple(float(v) for v in args.bbox)

    print(f"Loading trees with LiDAR samples in bbox {bbox}...")
    trees = load_pilot_trees(bbox)
    print(f"  {len(trees):,} trees with LiDAR samples")

    building_polygons, building_source = load_building_polygons(bbox)
    print(f"  Built {len(building_polygons):,} unique building polygons")
    nonveg_payloads = fetch_osm_non_vegetation_tiled(bbox)
    nonveg_polygons = osm_payloads_to_exclusion_polygons(nonveg_payloads)
    print(f"  Built {len(nonveg_polygons):,} non-vegetation exclusion polygons (water, bridges, industrial)")
    exclusion_polygons = building_polygons + nonveg_polygons
    building_index = index_buildings_by_chunk(exclusion_polygons, CHUNK_SIZE_M, bbox)
    tree_index = index_trees_by_chunk(trees, CHUNK_SIZE_M, bbox)

    chunks = chunk_bboxes(bbox, CHUNK_SIZE_M)
    print(f"Processing {len(chunks):,} chunks for crowns...")
    all_records: list[dict[str, Any]] = []
    gli_src = None
    if GREENNESS_VRT_PATH.exists():
        print(f"Using greenness mask: {GREENNESS_VRT_PATH}")
        gli_src = rasterio.open(GREENNESS_VRT_PATH)
    try:
        with rasterio.open(CHM_VRT_PATH) as src:
            for index, chunk in enumerate(chunks, start=1):
                chunk_trees = trees_for_chunk(chunk, tree_index, CHUNK_SIZE_M, bbox)
                if not chunk_trees:
                    continue
                chunk_buildings = buildings_for_chunk(chunk, building_index, CHUNK_SIZE_M, bbox)
                try:
                    chm, transform = read_chm_window(src, chunk)
                except Exception as exc:  # noqa: BLE001
                    print(f"  chunk {index}/{len(chunks)} CHM read failed: {exc}")
                    continue
                if not np.isfinite(chm).any():
                    continue
                gli_chunk = None
                if gli_src is not None:
                    gli_chunk = read_gli_for_chunk(gli_src, chunk, chm.shape, transform)
                records = segment_chunk(chm, transform, chunk_buildings, chunk_trees, chunk, gli_chunk=gli_chunk)
                all_records.extend(records)
                if index % 20 == 0 or index == len(chunks):
                    print(f"  chunk {index:,}/{len(chunks):,}, crowns so far {len(all_records):,}")
    finally:
        if gli_src is not None:
            gli_src.close()

    write_sqlite(all_records)
    write_crown_geojson(all_records)
    update_points_geojson(all_records)
    write_report(all_records, len(building_polygons), building_source, len(nonveg_polygons), len(chunks), bbox)
    print(json.dumps({"crowns": len(all_records), "buildings": len(building_polygons)}, indent=2))


if __name__ == "__main__":
    main()
