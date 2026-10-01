#!/usr/bin/env python3
"""Build QA/training layers for false positives and missed small canopy.

Outputs are intentionally separate from the canonical ``trees`` table:

- hard-negative candidates: retained LiDAR-inferred trees whose points fall
  inside high-risk OSM water/marina/wharf/port/industrial exclusions.
- low-canopy candidates: green 2-5 m CHM local maxima that are not near any
  existing canonical tree. These are visual review candidates only and are
  excluded from valuation until a crown/inventory record accepts them.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from build_tree_crown_pilot import (  # type: ignore
    CHM_VRT_PATH,
    DEFAULT_PILOT_BBOX_2193,
    GREENNESS_VRT_PATH,
    chunk_bboxes,
    buildings_for_chunk,
    fetch_osm_non_vegetation_tiled,
    index_buildings_by_chunk,
    load_building_polygons,
    rasterize_buildings,
    read_chm_window,
    read_gli_for_chunk,
    osm_payloads_to_exclusion_polygons,
)


ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
# Overridable so a re-gate run can target a working copy; the shared database
# is read by another project.
SQLITE_PATH = Path(os.environ["AKL_TREES_DB"]) if os.environ.get("AKL_TREES_DB") \
    else PROCESSED_ROOT / "akl_trees.sqlite"

CHUNK_SIZE_M = 1024.0
LOW_MIN_HEIGHT_M = 2.0
LOW_MAX_HEIGHT_M = 5.0
LOW_GLI_THRESHOLD = 0.08
# NDVI equivalent. The visible-band gate for low canopy sits a third above the
# main detection gate (0.08 against 0.06); 0.25 keeps that same margin over the
# 0.2 bare-soil boundary. Measured NDVI at accepted candidates runs 0.46 to
# 0.65 between the tenth and ninetieth percentile, so this is well clear of it.
LOW_NDVI_THRESHOLD = 0.25
# Span over which the index contributes to the confidence score, from the
# threshold up to where the index saturates on dense healthy canopy. This is
# NOT interchangeable between indices: 0.2 was tuned to GLI, and reusing it for
# NDVI saturates the term for almost every candidate, which inflates the score
# and more than doubles the promotable set without detecting anything new.
LOW_GLI_SPAN = 0.2       # GLI 0.08 -> 0.28
LOW_NDVI_SPAN = 0.45     # NDVI 0.25 -> 0.70, where dense canopy tops out
LOW_INDEX_SPAN = LOW_GLI_SPAN
NDVI_VRT_PATH = ROOT / "data" / "interim" / "ndvi_auckland_metro_v1" / "ndvi.vrt"
# Set by main(); detection reads these so the gate can be swapped wholesale.
LOW_INDEX_PATH = None
LOW_INDEX_THRESHOLD = LOW_GLI_THRESHOLD
LOW_GLI_WINDOW_PX = 5
LOW_DEDUP_DISTANCE_M = 4.0
LOW_NMS_RADIUS_M = 3.0
LOW_MIN_PATCH_AREA_M2 = 3.0
LOW_METHOD_ID = "low_canopy_secondary_v1_not_valued"
HARD_NEG_METHOD_ID = "hard_negative_osm_nonveg_v1"
HIGH_RISK_CATEGORIES = {"water", "marina_harbour", "port_wharf_industrial"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def classify_nonveg(tags: dict[str, Any]) -> str:
    values = {str(v).lower() for v in tags.values() if v is not None}
    if tags.get("leisure") == "marina" or tags.get("harbour") == "yes" or tags.get("seamark:type") == "harbour":
        return "marina_harbour"
    if tags.get("natural") == "water" or tags.get("water") or tags.get("waterway"):
        return "water"
    if tags.get("man_made") in {"pier", "wharf", "breakwater", "container_terminal", "crane", "gantry"}:
        return "port_wharf_industrial"
    if tags.get("landuse") in {"port", "harbour", "industrial", "railway", "brownfield", "construction", "quarry", "landfill"}:
        return "port_wharf_industrial"
    if tags.get("bridge") or tags.get("highway") or tags.get("railway") or "bridge" in values:
        return "bridge_transport"
    return "nonvegetation"


def _valid_polygon(polygon: Polygon) -> Polygon | None:
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or polygon.area <= 1:
        return None
    return polygon


def _buffered_line(coords_2193: list[tuple[float, float]], tags: dict[str, Any]) -> Polygon | None:
    if len(coords_2193) < 2:
        return None
    category = classify_nonveg(tags)
    buffer_m = {
        "water": 6.0,
        "marina_harbour": 10.0,
        "port_wharf_industrial": 10.0,
        "bridge_transport": 10.0,
        "nonvegetation": 8.0,
    }[category]
    line = LineString(coords_2193)
    if line.is_empty:
        return None
    return _valid_polygon(line.buffer(buffer_m, cap_style=2, join_style=2))


def osm_payloads_to_qc_polygons(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    out: list[dict[str, Any]] = []
    seen: set[tuple[str | None, int | None]] = set()
    for payload in payloads:
        for element in payload.get("elements", []):
            element_type = element.get("type")
            element_id = element.get("id")
            seen_key = (element_type, element_id)
            if seen_key in seen or element_type not in {"way", "relation"}:
                continue
            seen.add(seen_key)
            tags = element.get("tags", {}) or {}
            category = classify_nonveg(tags)
            polygons: list[Polygon] = []
            if element_type == "way":
                coords = [(node["lon"], node["lat"]) for node in element.get("geometry", [])]
                if len(coords) >= 2:
                    projected = [transformer.transform(lon, lat) for lon, lat in coords]
                    is_closed = len(projected) >= 4 and projected[0] == projected[-1]
                    polygon = _valid_polygon(Polygon(projected)) if is_closed else _buffered_line(projected, tags)
                    if polygon is not None:
                        polygons.append(polygon)
            else:
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
                        relation_lines.append(LineString(projected))
                if relation_lines:
                    try:
                        for polygon in polygonize(unary_union(relation_lines)):
                            valid = _valid_polygon(polygon)
                            if valid is not None:
                                relation_polygons.append(valid)
                    except Exception:  # noqa: BLE001
                        for line in relation_lines:
                            polygon = _buffered_line(list(line.coords), tags)
                            if polygon is not None:
                                relation_polygons.append(polygon)
                polygons.extend(relation_polygons)
            for polygon in polygons:
                out.append(
                    {
                        "geometry": polygon,
                        "category": category,
                        "osm_type": element_type,
                        "osm_id": element_id,
                        "name": tags.get("name"),
                    }
                )
    return out


def load_lidar_crowned_trees() -> list[dict[str, Any]]:
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return [
            dict(row)
            for row in conn.execute(
                """
                SELECT
                    t.tree_id, t.source_primary, t.owner_class, t.species_common,
                    t.lon, t.lat, l.x_2193, l.y_2193,
                    c.crown_area_m2, c.crown_max_chm_m,
                    v.total_value_nzd_y
                FROM trees t
                JOIN tree_lidar_pilot l USING(tree_id)
                JOIN tree_crown_pilot c USING(tree_id)
                LEFT JOIN tree_valuation_pilot v USING(tree_id)
                """
            )
        ]
    finally:
        conn.close()


def build_hard_negative_candidates(qc_polygons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    trees = [row for row in load_lidar_crowned_trees() if row["source_primary"] == "lidar_inferred_canopy"]
    if not qc_polygons:
        return []
    geoms = [record["geometry"] for record in qc_polygons]
    tree = STRtree(geoms)
    out: dict[str, dict[str, Any]] = {}
    priority = {"marina_harbour": 0, "water": 1, "port_wharf_industrial": 2, "bridge_transport": 3, "nonvegetation": 4}
    for row in trees:
        point = Point(row["x_2193"], row["y_2193"])
        matches = []
        for idx in tree.query(point):
            idx = int(idx)
            record = qc_polygons[idx]
            if record["category"] not in HIGH_RISK_CATEGORIES:
                continue
            if geoms[idx].intersects(point):
                matches.append(record)
        if not matches:
            continue
        match = sorted(matches, key=lambda rec: priority.get(rec["category"], 99))[0]
        out[row["tree_id"]] = {
            **row,
            "candidate_type": "hard_negative",
            "suggested_label": "non_tree_review",
            "reason": match["category"],
            "osm_type": match["osm_type"],
            "osm_id": match["osm_id"],
            "osm_name": match["name"],
            "method_id": HARD_NEG_METHOD_ID,
        }
    return list(out.values())


def load_existing_tree_xy() -> np.ndarray:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        rows = conn.execute(
            """
            SELECT x_2193, y_2193
            FROM tree_lidar_pilot
            WHERE x_2193 IS NOT NULL AND y_2193 IS NOT NULL
            """
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        return np.empty((0, 2), dtype="float64")
    return np.array(rows, dtype="float64")


def detect_low_canopy_chunk(
    chm: np.ndarray,
    transform: Any,
    chunk_bbox: tuple[float, float, float, float],
    exclusion_polygons: list[Polygon],
    existing_tree: cKDTree | None,
    gli_chunk: np.ndarray | None,
) -> list[dict[str, Any]]:
    if chm.size == 0 or not np.isfinite(chm).any():
        return []
    chm_clean = np.where(np.isfinite(chm), chm, 0).astype("float32")
    exclusion_mask = rasterize_buildings(exclusion_polygons, chm_clean.shape, transform)
    smoothed_chm = ndimage.gaussian_filter(chm_clean, sigma=0.8)
    candidate_mask = (
        np.isfinite(chm)
        & (smoothed_chm >= LOW_MIN_HEIGHT_M)
        & (smoothed_chm < LOW_MAX_HEIGHT_M)
        & (~exclusion_mask)
    )
    smoothed_gli = None
    if gli_chunk is not None and np.isfinite(gli_chunk).any():
        smoothed_gli = ndimage.uniform_filter(np.nan_to_num(gli_chunk, nan=-1), size=LOW_GLI_WINDOW_PX)
        candidate_mask &= smoothed_gli >= LOW_INDEX_THRESHOLD
    if not candidate_mask.any():
        return []

    structure_labels, _ = ndimage.label(candidate_mask)
    patch_sizes = np.bincount(structure_labels.ravel())
    keep_patch = patch_sizes >= LOW_MIN_PATCH_AREA_M2
    keep_patch[0] = False
    candidate_mask &= keep_patch[structure_labels]
    if not candidate_mask.any():
        return []

    local_max = ndimage.maximum_filter(smoothed_chm, footprint=np.ones((5, 5), dtype=bool), mode="nearest")
    maxima = candidate_mask & (smoothed_chm == local_max)
    rows, cols = np.nonzero(maxima)
    if rows.size == 0:
        return []
    heights = smoothed_chm[rows, cols]
    order = np.argsort(-heights)
    rows, cols, heights = rows[order], cols[order], heights[order]
    xs = transform.c + (cols + 0.5) * transform.a
    ys = transform.f + (rows + 0.5) * transform.e
    xmin, ymin, xmax, ymax = chunk_bbox

    if existing_tree is not None:
        existing_distances, _ = existing_tree.query(np.column_stack([xs, ys]), k=1, workers=-1)
    else:
        existing_distances = np.full_like(heights, np.inf)

    accepted_xy = np.empty((0, 2), dtype="float64")
    out: list[dict[str, Any]] = []
    for i in range(len(heights)):
        x, y = float(xs[i]), float(ys[i])
        if not (xmin <= x < xmax and ymin <= y < ymax):
            continue
        if existing_distances[i] <= LOW_DEDUP_DISTANCE_M:
            continue
        if accepted_xy.size:
            dx = accepted_xy[:, 0] - x
            dy = accepted_xy[:, 1] - y
            if np.any(dx * dx + dy * dy <= LOW_NMS_RADIUS_M * LOW_NMS_RADIUS_M):
                continue
        gli = float(smoothed_gli[rows[i], cols[i]]) if smoothed_gli is not None else None
        score = min(1.0, max(0.0, (float(heights[i]) - LOW_MIN_HEIGHT_M) / (LOW_MAX_HEIGHT_M - LOW_MIN_HEIGHT_M)))
        if gli is not None:
            score = 0.6 * score + 0.4 * min(1.0, max(0.0, (gli - LOW_INDEX_THRESHOLD) / LOW_INDEX_SPAN))
        accepted_xy = np.append(accepted_xy, [[x, y]], axis=0)
        out.append(
            {
                "x_2193": x,
                "y_2193": y,
                "height_m": float(heights[i]),
                "gli": gli,
                "nearest_tree_m": float(existing_distances[i]),
                "confidence_score": float(score),
            }
        )
    return out


def build_low_canopy_candidates(bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    print("Loading exclusion polygons for low-canopy pass...")
    building_polygons, building_source = load_building_polygons(bbox)
    nonveg_payloads = fetch_osm_non_vegetation_tiled(bbox)
    nonveg_polygons = osm_payloads_to_exclusion_polygons(nonveg_payloads)
    exclusion_polygons = building_polygons + nonveg_polygons
    print(f"  low-canopy exclusions: {len(building_polygons):,} buildings ({building_source}) + {len(nonveg_polygons):,} nonveg polygons")
    exclusion_index = index_buildings_by_chunk(exclusion_polygons, CHUNK_SIZE_M, bbox)
    existing_xy = load_existing_tree_xy()
    existing_tree = cKDTree(existing_xy) if len(existing_xy) else None
    chunks = chunk_bboxes(bbox, CHUNK_SIZE_M)
    all_records: list[dict[str, Any]] = []
    transformer = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    index_path = LOW_INDEX_PATH or GREENNESS_VRT_PATH
    gli_src = rasterio.open(index_path) if index_path.exists() else None
    print(f'  low-canopy vegetation gate: {index_path.name} >= {LOW_INDEX_THRESHOLD}')
    try:
        with rasterio.open(CHM_VRT_PATH) as src:
            for index, chunk in enumerate(chunks, start=1):
                chunk_exclusions = buildings_for_chunk(chunk, exclusion_index, CHUNK_SIZE_M, bbox)
                chm, transform = read_chm_window(src, chunk)
                gli_chunk = read_gli_for_chunk(gli_src, chunk, chm.shape, transform) if gli_src is not None else None
                records = detect_low_canopy_chunk(chm, transform, chunk, chunk_exclusions, existing_tree, gli_chunk)
                next_id = len(all_records) + 1
                for offset, record in enumerate(records):
                    lon, lat = transformer.transform(record["x_2193"], record["y_2193"])
                    record["lon"] = lon
                    record["lat"] = lat
                    record["candidate_id"] = f"low_canopy_{next_id + offset:07d}"
                all_records.extend(records)
                if index % 20 == 0 or index == len(chunks):
                    print(f"  low-canopy chunk {index:,}/{len(chunks):,}, candidates so far {len(all_records):,}")
    finally:
        if gli_src is not None:
            gli_src.close()
    return all_records


def write_hard_negative_outputs(records: list[dict[str, Any]]) -> None:
    created = utc_now()
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_hard_negative_candidates")
        conn.execute(
            """
            CREATE TABLE tree_hard_negative_candidates (
                tree_id TEXT PRIMARY KEY,
                candidate_type TEXT,
                suggested_label TEXT,
                reason TEXT,
                osm_type TEXT,
                osm_id INTEGER,
                osm_name TEXT,
                lon REAL,
                lat REAL,
                crown_area_m2 REAL,
                crown_max_chm_m REAL,
                total_value_nzd_y REAL,
                method_id TEXT,
                created_at_utc TEXT
            )
            """
        )
        conn.executemany(
            """
            INSERT INTO tree_hard_negative_candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    r["tree_id"],
                    r["candidate_type"],
                    r["suggested_label"],
                    r["reason"],
                    r["osm_type"],
                    r["osm_id"],
                    r["osm_name"],
                    r["lon"],
                    r["lat"],
                    r["crown_area_m2"],
                    r["crown_max_chm_m"],
                    r["total_value_nzd_y"],
                    r["method_id"],
                    created,
                )
                for r in records
            ],
        )
        conn.commit()
    finally:
        conn.close()

    features = [
        {
            "type": "Feature",
            "id": r["tree_id"],
            "properties": {
                "tree_id": r["tree_id"],
                "candidate_type": r["candidate_type"],
                "suggested_label": r["suggested_label"],
                "reason": r["reason"],
                "osm_name": r["osm_name"],
                "crown_area_m2": round(float(r["crown_area_m2"] or 0), 1),
                "crown_max_chm_m": round(float(r["crown_max_chm_m"] or 0), 1),
                "method_id": r["method_id"],
            },
            "geometry": {"type": "Point", "coordinates": [round(r["lon"], 6), round(r["lat"], 6)]},
        }
        for r in records
    ]
    (PROCESSED_ROOT / "hard_negative_candidates.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )


def write_low_canopy_outputs(records: list[dict[str, Any]]) -> None:
    created = utc_now()
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_low_canopy_candidates")
        conn.execute(
            """
            CREATE TABLE tree_low_canopy_candidates (
                candidate_id TEXT PRIMARY KEY,
                lon REAL,
                lat REAL,
                x_2193 REAL,
                y_2193 REAL,
                height_m REAL,
                gli REAL,
                nearest_tree_m REAL,
                confidence_score REAL,
                valuation_excluded INTEGER,
                method_id TEXT,
                created_at_utc TEXT
            )
            """
        )
        conn.executemany(
            """
            INSERT INTO tree_low_canopy_candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    r["candidate_id"],
                    r["lon"],
                    r["lat"],
                    r["x_2193"],
                    r["y_2193"],
                    r["height_m"],
                    r["gli"],
                    r["nearest_tree_m"],
                    r["confidence_score"],
                    1,
                    LOW_METHOD_ID,
                    created,
                )
                for r in records
            ],
        )
        conn.commit()
    finally:
        conn.close()

    features = [
        {
            "type": "Feature",
            "id": r["candidate_id"],
            "properties": {
                "candidate_id": r["candidate_id"],
                "candidate_type": "low_canopy",
                "height_m": round(r["height_m"], 2),
                "gli": round(r["gli"], 3) if r["gli"] is not None else None,
                "nearest_tree_m": round(r["nearest_tree_m"], 1),
                "confidence_score": round(r["confidence_score"], 3),
                "valuation_excluded": 1,
                "method_id": LOW_METHOD_ID,
            },
            "geometry": {"type": "Point", "coordinates": [round(r["lon"], 6), round(r["lat"], 6)]},
        }
        for r in records
    ]
    (PROCESSED_ROOT / "low_canopy_candidates.slim.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )


def write_training_seed_outputs(hard_negative_records: list[dict[str, Any]]) -> None:
    positive_pool = []
    all_rows = load_lidar_crowned_trees()
    hard_ids = {r["tree_id"] for r in hard_negative_records}
    for row in all_rows:
        if row["tree_id"] in hard_ids:
            continue
        if row["source_primary"] == "lidar_inferred_canopy":
            continue
        if not row["crown_area_m2"] or row["crown_area_m2"] < 8:
            continue
        positive_pool.append(row)
    rng = random.Random(42)
    rng.shuffle(positive_pool)
    positive_records = positive_pool[: min(500, len(positive_pool))]

    features = []
    for r in hard_negative_records:
        features.append(
            {
                "type": "Feature",
                "id": f"neg_{r['tree_id']}",
                "properties": {
                    "tree_id": r["tree_id"],
                    "label_seed": "non_tree_hard_negative_seed",
                    "reason": r["reason"],
                    "method_id": HARD_NEG_METHOD_ID,
                },
                "geometry": {"type": "Point", "coordinates": [round(r["lon"], 6), round(r["lat"], 6)]},
            }
        )
    for r in positive_records:
        features.append(
            {
                "type": "Feature",
                "id": f"pos_{r['tree_id']}",
                "properties": {
                    "tree_id": r["tree_id"],
                    "label_seed": "tree_positive_seed",
                    "species_common": r["species_common"],
                    "source_primary": r["source_primary"],
                    "crown_area_m2": round(float(r["crown_area_m2"] or 0), 1),
                },
                "geometry": {"type": "Point", "coordinates": [round(r["lon"], 6), round(r["lat"], 6)]},
            }
        )
    (PROCESSED_ROOT / "crown_detector_training_seeds.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )


def write_report(hard_negative_count: int, low_candidate_count: int) -> None:
    lines = [
        "# Tree QA Layers",
        "",
        f"Generated at: {utc_now()}",
        "",
        "## Hard-Negative Candidates",
        "",
        f"- Candidate retained LiDAR trees inside high-risk water/marina/port/wharf OSM exclusions: {hard_negative_count:,}.",
        "- These are review/training seeds, not automatic deletions. They target the recurring boat, ship, container, wharf, and harbour false positives.",
        "",
        "## Low-Canopy Candidates",
        "",
        f"- Green 2-5 m CHM local maxima not near an existing canonical tree: {low_candidate_count:,}.",
        "- These are excluded from `trees`, crowns, context, and valuation until reviewed/accepted.",
        "",
        "## Outputs",
        "",
        "- `data/processed/hard_negative_candidates.geojson`",
        "- `data/processed/crown_detector_training_seeds.geojson`",
        "- `data/processed/low_canopy_candidates.slim.geojson`",
        "- `data/processed/low_canopy_candidates.pmtiles` after `make build-pmtiles`",
        "- `data/processed/akl_trees.sqlite`, tables `tree_hard_negative_candidates` and `tree_low_canopy_candidates`",
        "",
    ]
    (DOCS_ROOT / "tree_qa_layers.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, default=list(DEFAULT_PILOT_BBOX_2193))
    parser.add_argument("--skip-low-canopy", action="store_true")
    parser.add_argument("--index", choices=("gli", "ndvi"), default="gli",
                        help="vegetation index gating low-canopy detection")
    args = parser.parse_args()
    global LOW_INDEX_PATH, LOW_INDEX_THRESHOLD, LOW_INDEX_SPAN
    if args.index == 'ndvi':
        if not NDVI_VRT_PATH.exists():
            raise SystemExit(f'{NDVI_VRT_PATH} not found; build it first')
        LOW_INDEX_PATH, LOW_INDEX_THRESHOLD = NDVI_VRT_PATH, LOW_NDVI_THRESHOLD
        LOW_INDEX_SPAN = LOW_NDVI_SPAN
    else:
        LOW_INDEX_PATH, LOW_INDEX_THRESHOLD = GREENNESS_VRT_PATH, LOW_GLI_THRESHOLD
        LOW_INDEX_SPAN = LOW_GLI_SPAN
    bbox = tuple(float(v) for v in args.bbox)

    print("Building hard-negative candidates...")
    nonveg_payloads = fetch_osm_non_vegetation_tiled(bbox)
    qc_polygons = osm_payloads_to_qc_polygons(nonveg_payloads)
    hard_negative_records = build_hard_negative_candidates(qc_polygons)
    write_hard_negative_outputs(hard_negative_records)
    write_training_seed_outputs(hard_negative_records)
    print(f"  hard-negative candidates: {len(hard_negative_records):,}")

    low_records: list[dict[str, Any]] = []
    if not args.skip_low_canopy:
        print("Building low-canopy candidates...")
        low_records = build_low_canopy_candidates(bbox)
        write_low_canopy_outputs(low_records)
        print(f"  low-canopy candidates: {len(low_records):,}")
    write_report(len(hard_negative_records), len(low_records))
    print(json.dumps({"hard_negative_candidates": len(hard_negative_records), "low_canopy_candidates": len(low_records)}, indent=2))


if __name__ == "__main__":
    main()
