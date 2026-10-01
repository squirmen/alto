#!/usr/bin/env python3
"""Normalize public tree sources into a canonical pilot inventory.

The script intentionally uses only the Python standard library. It can run in
the default system Python before the full geospatial stack is installed.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ARCGIS_ROOT = ROOT / "data" / "raw" / "arcgis"
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"

TREE_REGISTER = "tree_register_points"
NOTABLE_TREES = "notable_trees_overlay"
NOTABLE_GROUPS = "notable_group_trees_overlay"
KAURI_OBS = "ruru_obskauri_tiaki_public"
OSM_NATURAL_TREE = "osm_natural_tree"
OSM_TREE_GEOJSON = "../osm/natural_tree.geojson"  # relative to data/raw/arcgis/<slug>/features_4326.geojson convention; we'll resolve absolute below

# Dedup distance for notable / kauri points against existing canonical trees.
DEDUP_DISTANCE_M = 6.0

# Good enough for <10 m matching across the central Auckland pilot extent.
LAT0 = -36.85
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))

UNKNOWN_VALUES = {"", "unknown", "unk", "n/a", "na", "none", "null", "<blank>"}
GENUS_MARKERS = (" sp.", " spp.", " species")
NAME_STOPWORDS = {
    "a",
    "and",
    "mixed",
    "native",
    "of",
    "the",
    "tree",
    "trees",
}

NOTABLE_POINT_MATCH_M = 8.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_geojson(slug: str) -> dict[str, Any]:
    path = ARCGIS_ROOT / slug / "features_4326.geojson"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path}. Run scripts/fetch_arcgis_features.py first.")
    data = json.loads(path.read_text(encoding="utf-8"))
    if slug == NOTABLE_TREES:
        from notable_source_identity import resolve_for_import
        return resolve_for_import(data, ROOT / "config" / "notable_tree_identity_registry.json")
    return data


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if text.lower() in UNKNOWN_VALUES:
        return None
    return text


def normalize_species(common_raw: Any, latin_raw: Any) -> tuple[str | None, str | None, str]:
    common = clean_text(common_raw)
    latin = clean_text(latin_raw)
    latin_lower = latin.lower() if latin else ""
    common_lower = common.lower() if common else ""

    if not common and not latin:
        return common, latin, "unknown"

    if latin and any(marker in latin_lower for marker in GENUS_MARKERS):
        return common, latin, "source_genus"

    if latin and len(latin.split()) >= 2:
        return common, latin, "source_species"

    if latin and latin_lower not in UNKNOWN_VALUES:
        return common, latin, "source_taxon"

    if common and common_lower not in UNKNOWN_VALUES:
        return common, latin, "source_common_only"

    return common, latin, "unknown"


def normalize_owner(owner_raw: Any) -> tuple[str | None, str]:
    owner = clean_text(owner_raw)
    if owner == "AT":
        return owner, "Auckland Transport"
    if owner == "Parks":
        return owner, "Auckland Council Parks"
    if owner:
        return owner, owner
    return None, "Unknown"


def project_lonlat(lon: float, lat: float) -> tuple[float, float]:
    return lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT


def point_geometry(feature: dict[str, Any]) -> tuple[float, float]:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Point":
        raise ValueError("Expected Point geometry")
    lon, lat = geometry["coordinates"]
    return float(lon), float(lat)


def notable_type_label(value: Any) -> str | None:
    if str(value) == "1":
        return "Verified position of tree"
    if str(value) == "2":
        return "Unverified position of tree"
    return None


def name_tokens(value: Any) -> set[str]:
    text = clean_text(value)
    if not text:
        return set()
    text = re.sub(r"\([^)]*\)", " ", text.lower())
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return {token for token in text.split() if token and token not in NAME_STOPWORDS}


def comparable_phrase(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    text = text.lower().replace(" tree", "")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def notable_name_compatible(common: str | None, latin: str | None, notable_name: Any) -> bool:
    notable_phrase = comparable_phrase(notable_name)
    if not notable_phrase:
        return False

    common_phrase = comparable_phrase(common)
    if common_phrase and (common_phrase in notable_phrase or notable_phrase in common_phrase):
        return True

    common_tokens = name_tokens(common)
    notable_tokens = name_tokens(notable_name)
    if common_tokens and notable_tokens:
        overlap = common_tokens & notable_tokens
        if min(len(common_tokens), len(notable_tokens)) == 1 and overlap == common_tokens:
            return True
        if len(overlap) >= 2:
            return True

    latin_clean = clean_text(latin)
    if latin_clean:
        genus = latin_clean.split()[0].lower()
        if genus in notable_phrase.split():
            return True
    return False


def build_point_index(
    features: list[dict[str, Any]], cell_size_m: float
) -> tuple[dict[tuple[int, int], list[dict[str, Any]]], list[dict[str, Any]]]:
    index: dict[tuple[int, int], list[dict[str, Any]]] = {}
    records: list[dict[str, Any]] = []
    for feature in features:
        lon, lat = point_geometry(feature)
        x, y = project_lonlat(lon, lat)
        record = {
            "feature": feature,
            "lon": lon,
            "lat": lat,
            "x": x,
            "y": y,
            "cell": (math.floor(x / cell_size_m), math.floor(y / cell_size_m)),
        }
        records.append(record)
        index.setdefault(record["cell"], []).append(record)
    return index, records


def nearest_point_match(
    lon: float,
    lat: float,
    index: dict[tuple[int, int], list[dict[str, Any]]],
    max_distance_m: float,
) -> tuple[dict[str, Any] | None, float | None]:
    x, y = project_lonlat(lon, lat)
    cx = math.floor(x / max_distance_m)
    cy = math.floor(y / max_distance_m)
    best_record: dict[str, Any] | None = None
    best_distance: float | None = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for candidate in index.get((cx + dx, cy + dy), []):
                distance = math.hypot(x - candidate["x"], y - candidate["y"])
                if distance <= max_distance_m and (
                    best_distance is None or distance < best_distance
                ):
                    best_record = candidate
                    best_distance = distance
    return best_record, best_distance


def polygon_bounds(rings: list[list[list[float]]]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for ring in rings:
        for lon, lat in ring:
            xs.append(lon)
            ys.append(lat)
    return min(xs), min(ys), max(xs), max(ys)


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    if len(ring) < 3:
        return False
    x1, y1 = ring[-1]
    for x2, y2 in ring:
        intersects = ((y1 > lat) != (y2 > lat)) and (
            lon < (x2 - x1) * (lat - y1) / ((y2 - y1) or 1e-12) + x1
        )
        if intersects:
            inside = not inside
        x1, y1 = x2, y2
    return inside


def point_in_arcgis_polygon(lon: float, lat: float, rings: list[list[list[float]]]) -> bool:
    # ArcGIS polygon rings can include multiple outers and holes. Odd-even over
    # all rings is robust enough for these public overlay polygons.
    inside = False
    for ring in rings:
        if point_in_ring(lon, lat, ring):
            inside = not inside
    return inside


def build_polygon_records(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Polygon":
            continue
        rings = geometry.get("coordinates") or []
        if not rings:
            continue
        records.append(
            {
                "feature": feature,
                "rings": rings,
                "bounds": polygon_bounds(rings),
            }
        )
    return records


def polygon_matches(
    lon: float, lat: float, polygons: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    matches = []
    for polygon in polygons:
        minx, miny, maxx, maxy = polygon["bounds"]
        if lon < minx or lon > maxx or lat < miny or lat > maxy:
            continue
        if point_in_arcgis_polygon(lon, lat, polygon["rings"]):
            matches.append(polygon["feature"])
    return matches


def notable_match_confidence(
    distance_m: float | None, notable_type: Any, name_compatible: bool
) -> str | None:
    if distance_m is None:
        return None
    if str(notable_type) != "1":
        return "unverified"
    if name_compatible and distance_m <= 1:
        return "high"
    if name_compatible and distance_m <= 3:
        return "medium"
    if name_compatible and distance_m <= NOTABLE_POINT_MATCH_M:
        return "low"
    return "spatial_only_review"


def kauri_species_label(props: dict[str, Any]) -> tuple[str, str, str]:
    pa = props.get("PhytAgathidicida")
    pc = props.get("PhytCinnamomi")
    soil = props.get("SoilSampleResult")
    flags = []
    if pa not in (None, "", 0):
        flags.append("PA+")
    if pc not in (None, "", 0):
        flags.append("PC+")
    if soil not in (None, "", "Negative", "negative"):
        flags.append(f"soil:{soil}")
    confidence = "source_kauri_observation"
    common = "Kauri"
    if flags:
        common = f"Kauri ({' '.join(flags)})"
    return common, "Agathis australis", confidence


def add_canonical_record(
    records: list[dict[str, Any]],
    record: dict[str, Any],
    canonical_index: dict[tuple[int, int], list[dict[str, Any]]],
    cell_size_m: float,
) -> None:
    x, y = record["approx_x_m"], record["approx_y_m"]
    cell = (math.floor(x / cell_size_m), math.floor(y / cell_size_m))
    canonical_index.setdefault(cell, []).append({"x": x, "y": y, "record": record})
    records.append(record)


def has_nearby_canonical(
    x: float,
    y: float,
    canonical_index: dict[tuple[int, int], list[dict[str, Any]]],
    cell_size_m: float,
    max_distance_m: float,
) -> dict[str, Any] | None:
    cx = math.floor(x / cell_size_m)
    cy = math.floor(y / cell_size_m)
    best: dict[str, Any] | None = None
    best_distance: float | None = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for candidate in canonical_index.get((cx + dx, cy + dy), []):
                distance = math.hypot(x - candidate["x"], y - candidate["y"])
                if distance <= max_distance_m and (
                    best_distance is None or distance < best_distance
                ):
                    best = candidate["record"]
                    best_distance = distance
    return best


def build_canonical_records() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    tree_features = read_geojson(TREE_REGISTER)["features"]
    notable_features = read_geojson(NOTABLE_TREES)["features"]
    group_features = read_geojson(NOTABLE_GROUPS)["features"]
    kauri_features = read_geojson(KAURI_OBS)["features"]

    notable_index, _ = build_point_index(notable_features, NOTABLE_POINT_MATCH_M)
    notable_group_polygons = build_polygon_records(group_features)

    records: list[dict[str, Any]] = []
    canonical_index: dict[tuple[int, int], list[dict[str, Any]]] = {}

    for feature in tree_features:
        props = feature["properties"]
        lon, lat = point_geometry(feature)
        x_m, y_m = project_lonlat(lon, lat)
        common, latin, species_confidence = normalize_species(
            props.get("TreeCommon"), props.get("TreeLatin")
        )
        owner_raw, owner_class = normalize_owner(props.get("TreeOwner"))

        nearest_notable, notable_distance_m = nearest_point_match(
            lon, lat, notable_index, NOTABLE_POINT_MATCH_M
        )
        notable_props = nearest_notable["feature"]["properties"] if nearest_notable else {}
        name_compatible = (
            notable_name_compatible(common, latin, notable_props.get("NAME"))
            if nearest_notable
            else False
        )
        group_matches = polygon_matches(lon, lat, notable_group_polygons)
        group_objectids = [
            str(match["properties"].get("OBJECTID"))
            for match in group_matches
            if match["properties"].get("OBJECTID") is not None
        ]
        group_names = sorted(
            {
                clean_text(match["properties"].get("NAME")) or "Unnamed group"
                for match in group_matches
            }
        )

        is_notable_point_candidate = nearest_notable is not None
        is_notable_point = is_notable_point_candidate and name_compatible and str(notable_props.get("TYPE")) == "1"
        is_notable_group = bool(group_matches)
        is_protected_notable = is_notable_point or is_notable_group

        tree_id = f"akl_tree_trp_{props.get('TreeID')}"
        record = {
            "tree_id": tree_id,
            "source_primary": TREE_REGISTER,
            "record_role": "authoritative_inventory",
            "source_object_id": props.get("FID"),
            "source_tree_id": props.get("TreeID"),
            "species_common_raw": props.get("TreeCommon"),
            "species_latin_raw": props.get("TreeLatin"),
            "species_common": common,
            "species_latin": latin,
            "species_confidence": species_confidence,
            "owner_raw": owner_raw,
            "owner_class": owner_class,
            "lon": lon,
            "lat": lat,
            "approx_x_m": round(x_m, 3),
            "approx_y_m": round(y_m, 3),
            "is_protected_notable": int(is_protected_notable),
            "notable_point_match": int(is_notable_point),
            "notable_point_spatial_candidate": int(is_notable_point_candidate),
            "notable_point_name_compatible": int(name_compatible),
            "notable_point_review_required": int(
                is_notable_point_candidate and (not name_compatible or str(notable_props.get("TYPE")) != "1")
            ),
            "notable_point_objectid": notable_props.get("OBJECTID"),
            "notable_point_name": clean_text(notable_props.get("NAME")),
            "notable_point_type": notable_props.get("TYPE"),
            "notable_point_type_label": notable_type_label(notable_props.get("TYPE")),
            "notable_point_distance_m": (
                round(notable_distance_m, 2) if notable_distance_m is not None else None
            ),
            "notable_point_match_confidence": notable_match_confidence(
                notable_distance_m, notable_props.get("TYPE"), name_compatible
            ),
            "notable_group_match": int(is_notable_group),
            "notable_group_count": len(group_matches),
            "notable_group_objectids": ";".join(group_objectids) if group_objectids else None,
            "notable_group_names": "; ".join(group_names) if group_names else None,
            "as_of_utc": utc_now(),
        }
        add_canonical_record(records, record, canonical_index, DEDUP_DISTANCE_M)

    register_count = len(records)

    # Add notable trees that are NOT already represented by a register point.
    notable_added = 0
    for feature in notable_features:
        try:
            lon, lat = point_geometry(feature)
        except ValueError:
            continue
        x_m, y_m = project_lonlat(lon, lat)
        existing = has_nearby_canonical(x_m, y_m, canonical_index, DEDUP_DISTANCE_M, DEDUP_DISTANCE_M)
        if existing is not None and str(feature["properties"].get("TYPE")) == "1":
            continue
        props = feature["properties"]
        name = clean_text(props.get("NAME"))
        common = name
        latin = None
        species_confidence = "source_notable_name" if name else "unknown"
        group_matches = polygon_matches(lon, lat, notable_group_polygons)
        group_objectids = [
            str(match["properties"].get("OBJECTID"))
            for match in group_matches
            if match["properties"].get("OBJECTID") is not None
        ]
        group_names = sorted(
            {
                clean_text(match["properties"].get("NAME")) or "Unnamed group"
                for match in group_matches
            }
        )
        record = {
            "tree_id": props["ALTO_TREE_ID"],
            "source_primary": NOTABLE_TREES,
            "record_role": "authoritative_inventory",
            "source_object_id": props.get("OBJECTID"),
            "source_tree_id": str(props.get("SCHEDULE") or props.get("OBJECTID")),
            "species_common_raw": props.get("NAME"),
            "species_latin_raw": None,
            "species_common": common,
            "species_latin": latin,
            "species_confidence": species_confidence,
            "owner_raw": None,
            "owner_class": "Notable Tree (Council Schedule)",
            "lon": lon,
            "lat": lat,
            "approx_x_m": round(x_m, 3),
            "approx_y_m": round(y_m, 3),
            "is_protected_notable": 1,
            "notable_point_match": 1,
            "notable_point_spatial_candidate": 1,
            "notable_point_name_compatible": 1,
            "notable_point_review_required": int(str(props.get("TYPE")) != "1"),
            "notable_point_objectid": props.get("OBJECTID"),
            "notable_point_name": clean_text(props.get("NAME")),
            "notable_point_type": props.get("TYPE"),
            "notable_point_type_label": notable_type_label(props.get("TYPE")),
            "notable_point_distance_m": 0.0,
            "notable_point_match_confidence": "high" if str(props.get("TYPE")) == "1" else "unverified",
            "notable_group_match": int(bool(group_matches)),
            "notable_group_count": len(group_matches),
            "notable_group_objectids": ";".join(group_objectids) if group_objectids else None,
            "notable_group_names": "; ".join(group_names) if group_names else None,
            "as_of_utc": utc_now(),
        }
        add_canonical_record(records, record, canonical_index, DEDUP_DISTANCE_M)
        notable_added += 1

    # Add kauri obs that are NOT already represented.
    kauri_added = 0
    for feature in kauri_features:
        try:
            lon, lat = point_geometry(feature)
        except ValueError:
            continue
        x_m, y_m = project_lonlat(lon, lat)
        existing = has_nearby_canonical(x_m, y_m, canonical_index, DEDUP_DISTANCE_M, DEDUP_DISTANCE_M)
        if existing is not None:
            continue
        props = feature["properties"]
        # The public surveillance layer explicitly includes records classified
        # as "Not a kauri". They are observations, not tree evidence.
        if props.get("KDBFieldStatus") == 5:
            continue
        common, latin, species_confidence = kauri_species_label(props)
        record = {
            "tree_id": f"akl_tree_kau_{props.get('ShortID') or props.get('OBJECTID')}",
            "source_primary": KAURI_OBS,
            "record_role": "surveillance_observation",
            "source_object_id": props.get("OBJECTID"),
            "source_tree_id": props.get("ShortID") or str(props.get("OBJECTID")),
            "species_common_raw": "Kauri",
            "species_latin_raw": "Agathis australis",
            "species_common": common,
            "species_latin": latin,
            "species_confidence": species_confidence,
            "owner_raw": None,
            "owner_class": "Kauri Observation (Public Survey)",
            "lon": lon,
            "lat": lat,
            "approx_x_m": round(x_m, 3),
            "approx_y_m": round(y_m, 3),
            "is_protected_notable": 0,
            "notable_point_match": 0,
            "notable_point_spatial_candidate": 0,
            "notable_point_name_compatible": 0,
            "notable_point_review_required": 0,
            "notable_point_objectid": None,
            "notable_point_name": None,
            "notable_point_type": None,
            "notable_point_type_label": None,
            "notable_point_distance_m": None,
            "notable_point_match_confidence": None,
            "notable_group_match": 0,
            "notable_group_count": 0,
            "notable_group_objectids": None,
            "notable_group_names": None,
            "as_of_utc": utc_now(),
        }
        add_canonical_record(records, record, canonical_index, DEDUP_DISTANCE_M)
        kauri_added += 1

    # Add OSM natural=tree (and natural=tree_row) points that aren't already
    # represented. These are crowd-sourced gardens / street trees etc — they
    # fill the residential gap that the council inventory misses outside
    # Waitemata's street-tree set.
    osm_path = ROOT / "data" / "raw" / "osm" / "natural_tree.geojson"
    osm_features = []
    if osm_path.exists():
        osm_features = json.loads(osm_path.read_text(encoding="utf-8")).get("features", [])
    osm_added = 0
    for feature in osm_features:
        try:
            lon, lat = point_geometry(feature)
        except ValueError:
            continue
        x_m, y_m = project_lonlat(lon, lat)
        existing = has_nearby_canonical(x_m, y_m, canonical_index, DEDUP_DISTANCE_M, DEDUP_DISTANCE_M)
        if existing is not None:
            continue
        props = feature.get("properties") or {}
        # Derive species fields from the available tags.
        species_latin = clean_text(props.get("species"))
        species_common = clean_text(props.get("species_en") or props.get("name"))
        genus = clean_text(props.get("genus"))
        if not species_latin and genus:
            species_latin = f"{genus} sp."
        if species_latin and len(species_latin.split()) >= 2:
            species_confidence = "source_species"
        elif species_latin:
            species_confidence = "source_genus"
        elif species_common:
            species_confidence = "source_common_only"
        else:
            species_confidence = "unknown"
        osm_id = props.get("osm_id")
        osm_type = props.get("osm_type", "node")
        record = {
            "tree_id": f"akl_tree_osm_{osm_type}_{osm_id}",
            "source_primary": OSM_NATURAL_TREE,
            "record_role": "crowdsourced_candidate",
            "source_object_id": osm_id,
            "source_tree_id": f"{osm_type}/{osm_id}",
            "species_common_raw": props.get("species_en") or props.get("name"),
            "species_latin_raw": props.get("species") or props.get("genus"),
            "species_common": species_common,
            "species_latin": species_latin,
            "species_confidence": species_confidence,
            "owner_raw": None,
            "owner_class": "OSM Crowd-Sourced",
            "lon": lon,
            "lat": lat,
            "approx_x_m": round(x_m, 3),
            "approx_y_m": round(y_m, 3),
            "is_protected_notable": 0,
            "notable_point_match": 0,
            "notable_point_spatial_candidate": 0,
            "notable_point_name_compatible": 0,
            "notable_point_review_required": 0,
            "notable_point_objectid": None,
            "notable_point_name": None,
            "notable_point_type": None,
            "notable_point_type_label": None,
            "notable_point_distance_m": None,
            "notable_point_match_confidence": None,
            "notable_group_match": 0,
            "notable_group_count": 0,
            "notable_group_objectids": None,
            "notable_group_names": None,
            "as_of_utc": utc_now(),
        }
        add_canonical_record(records, record, canonical_index, DEDUP_DISTANCE_M)
        osm_added += 1

    metadata = {
        "tree_register_count": len(tree_features),
        "notable_tree_count": len(notable_features),
        "notable_group_count": len(group_features),
        "kauri_obs_count": len(kauri_features),
        "osm_natural_tree_count": len(osm_features),
        "register_records_kept": register_count,
        "notable_only_records_added": notable_added,
        "kauri_only_records_added": kauri_added,
        "osm_only_records_added": osm_added,
        "canonical_total": len(records),
        "dedup_distance_m": DEDUP_DISTANCE_M,
        "created_at_utc": utc_now(),
        "notable_point_match_threshold_m": NOTABLE_POINT_MATCH_M,
        "projection_note": "Local equirectangular approximation around Auckland; suitable for small-distance pilot joins.",
    }
    return records, metadata


def write_csv(records: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(records[0].keys()) if records else []
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def records_to_geojson(records: list[dict[str, Any]], minimal: bool = False) -> dict[str, Any]:
    features = []
    for record in records:
        if minimal:
            properties = {
                "tree_id": record["tree_id"],
                "source_tree_id": record["source_tree_id"],
                "species_common": record["species_common"],
                "species_latin": record["species_latin"],
                "species_confidence": record["species_confidence"],
                "owner_class": record["owner_class"],
                "is_protected_notable": record["is_protected_notable"],
                "notable_point_spatial_candidate": record["notable_point_spatial_candidate"],
                "notable_point_review_required": record["notable_point_review_required"],
                "notable_point_name": record["notable_point_name"],
                "notable_point_distance_m": record["notable_point_distance_m"],
                "notable_group_names": record["notable_group_names"],
            }
        else:
            properties = {k: v for k, v in record.items() if k not in {"lon", "lat"}}
        features.append(
            {
                "type": "Feature",
                "id": record["tree_id"],
                "properties": properties,
                "geometry": {
                    "type": "Point",
                    "coordinates": [record["lon"], record["lat"]],
                },
            }
        )
    return {
        "type": "FeatureCollection",
        "features": features,
    }


def write_geojson(records: list[dict[str, Any]], path: Path, minimal: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(records_to_geojson(records, minimal=minimal), separators=(",", ":")),
        encoding="utf-8",
    )


def write_sqlite(records: list[dict[str, Any]], metadata: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        columns = list(records[0].keys()) if records else []
        column_sql = ", ".join(f'"{column}"' for column in columns)
        placeholders = ", ".join("?" for _ in columns)
        conn.execute(
            """
            CREATE TABLE trees (
                tree_id TEXT PRIMARY KEY,
                source_primary TEXT,
                record_role TEXT,
                source_object_id INTEGER,
                source_tree_id TEXT,
                species_common_raw TEXT,
                species_latin_raw TEXT,
                species_common TEXT,
                species_latin TEXT,
                species_confidence TEXT,
                owner_raw TEXT,
                owner_class TEXT,
                lon REAL,
                lat REAL,
                approx_x_m REAL,
                approx_y_m REAL,
                is_protected_notable INTEGER,
                notable_point_match INTEGER,
                notable_point_spatial_candidate INTEGER,
                notable_point_name_compatible INTEGER,
                notable_point_review_required INTEGER,
                notable_point_objectid INTEGER,
                notable_point_name TEXT,
                notable_point_type TEXT,
                notable_point_type_label TEXT,
                notable_point_distance_m REAL,
                notable_point_match_confidence TEXT,
                notable_group_match INTEGER,
                notable_group_count INTEGER,
                notable_group_objectids TEXT,
                notable_group_names TEXT,
                as_of_utc TEXT
            )
            """
        )
        conn.executemany(
            f"INSERT INTO trees ({column_sql}) VALUES ({placeholders})",
            [[record.get(column) for column in columns] for record in records],
        )
        conn.execute("CREATE INDEX idx_trees_species_latin ON trees(species_latin)")
        conn.execute("CREATE INDEX idx_trees_species_common ON trees(species_common)")
        conn.execute("CREATE INDEX idx_trees_owner_class ON trees(owner_class)")
        conn.execute("CREATE INDEX idx_trees_notable ON trees(is_protected_notable)")
        conn.execute("CREATE INDEX idx_trees_lon_lat ON trees(lon, lat)")

        conn.execute("CREATE TABLE run_metadata (key TEXT PRIMARY KEY, value TEXT)")
        conn.executemany(
            "INSERT INTO run_metadata (key, value) VALUES (?, ?)",
            [(key, json.dumps(value) if isinstance(value, (dict, list)) else str(value))
             for key, value in metadata.items()],
        )
        conn.commit()
    finally:
        conn.close()


def count_field(records: list[dict[str, Any]], field: str) -> Counter[str]:
    counter: Counter[str] = Counter()
    for record in records:
        value = record.get(field)
        label = str(value).strip() if value is not None else "Unknown"
        counter[label or "Unknown"] += 1
    return counter


def markdown_counts(counter: Counter[str], n: int = 20) -> str:
    lines = ["| Value | Count |", "| --- | ---: |"]
    lines.extend(f"| {value} | {count:,} |" for value, count in counter.most_common(n))
    return "\n".join(lines)


def write_report(records: list[dict[str, Any]], metadata: dict[str, Any], path: Path) -> None:
    notable_point_matches = sum(record["notable_point_match"] for record in records)
    notable_point_spatial_candidates = sum(
        record["notable_point_spatial_candidate"] for record in records
    )
    notable_point_review_required = sum(
        record["notable_point_review_required"] for record in records
    )
    notable_group_matches = sum(record["notable_group_match"] for record in records)
    protected_matches = sum(record["is_protected_notable"] for record in records)
    unknown_species = sum(1 for record in records if record["species_confidence"] == "unknown")

    lines = [
        "# Normalized Public Tree Inventory",
        "",
        f"Generated at: {metadata['created_at_utc']}",
        "",
        "## Summary",
        "",
        f"- Canonical tree records: {len(records):,}.",
        f"- Unknown species records: {unknown_species:,}.",
        f"- Protected/notable candidate records: {protected_matches:,}.",
        f"- Notable point spatial candidates within {NOTABLE_POINT_MATCH_M:g} m: {notable_point_spatial_candidates:,}.",
        f"- Notable point matches with compatible names: {notable_point_matches:,}.",
        f"- Notable point spatial candidates requiring review: {notable_point_review_required:,}.",
        f"- Notable group polygon matches: {notable_group_matches:,}.",
        "",
        "Protected/notable status is a candidate join for this pilot. Point matches are stored "
        "when they are spatially nearby, but are only counted as protected/notable candidates "
        "when the inventory species/common name is compatible with the notable-tree name. "
        "Spatial-only candidates are retained for review.",
        "",
        "## Species Confidence",
        "",
        markdown_counts(count_field(records, "species_confidence")),
        "",
        "## Owner Class",
        "",
        markdown_counts(count_field(records, "owner_class")),
        "",
        "## Top Common Species Names",
        "",
        markdown_counts(count_field(records, "species_common")),
        "",
        "## Top Latin Species Names",
        "",
        markdown_counts(count_field(records, "species_latin")),
        "",
        "## Outputs",
        "",
        "- `data/processed/akl_trees.sqlite`",
        "- `data/processed/trees_canonical.csv`",
        "- `data/processed/trees_canonical.geojson`",
        "- `data/processed/trees_map_points.geojson`",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_ROOT)
    parser.add_argument("--report", type=Path, default=DOCS_ROOT / "normalized_tree_inventory.md")
    args = parser.parse_args()

    processed_dir = args.processed_dir if args.processed_dir.is_absolute() else ROOT / args.processed_dir
    report_path = args.report if args.report.is_absolute() else ROOT / args.report

    records, metadata = build_canonical_records()
    processed_dir.mkdir(parents=True, exist_ok=True)
    (processed_dir / "normalization_manifest.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    write_csv(records, processed_dir / "trees_canonical.csv")
    write_geojson(records, processed_dir / "trees_canonical.geojson", minimal=False)
    write_geojson(records, processed_dir / "trees_map_points.geojson", minimal=True)
    write_sqlite(records, metadata, processed_dir / "akl_trees.sqlite")
    write_report(records, metadata, report_path)

    print(f"Normalized {len(records):,} trees")
    print(f"Wrote {processed_dir / 'akl_trees.sqlite'}")
    print(f"Wrote {report_path}")


if __name__ == "__main__":
    main()
