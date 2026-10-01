#!/usr/bin/env python3
"""Fetch OSM ``natural=tree`` points inside the pilot bbox.

Crowd-sourced tree points add coverage in residential gardens and street
verges that aren't in the Auckland Council TreeRegister (which is mostly
Waitemata Local Board). Many OSM tree nodes carry useful tags:

- ``species`` / ``genus`` — taxonomic identity
- ``species:en`` / ``name`` — common name
- ``denotation`` — e.g. ``urban``, ``avenue``, ``landmark``
- ``leaf_type`` — ``broadleaved``, ``needleleaved``, ``palm``
- ``leaf_cycle`` — ``deciduous``, ``evergreen``, ``mixed``
- ``height`` — in metres
- ``circumference`` — trunk circumference (use for DBH derivation)

Saves a single GeoJSON to ``data/raw/osm/natural_tree.geojson`` plus a
manifest. Downstream the inventory normaliser will dedup these against
the existing council records and add the unique ones as a new source
class (``osm_natural_tree``).

Polite caching: per-tile Overpass payloads are cached on disk so reruns
don't re-hammer the Overpass API.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pyproj import Transformer


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "osm" / "natural_tree_tiles"
OUT_PATH = ROOT / "data" / "raw" / "osm" / "natural_tree.geojson"
MANIFEST_PATH = ROOT / "data" / "raw" / "osm" / "natural_tree_manifest.json"

from _pilot_config import DEFAULT_PILOT_BBOX_2193  # noqa: E402
TILE_SIZE_M = 4_000.0  # 4 km tiles for polite Overpass batches

OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
OVERPASS_MAX_ATTEMPTS = 5
OVERPASS_SLEEP_S = 2.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def bbox_2193_to_4326(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    tf = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    xmin, ymin, xmax, ymax = bbox
    corners = [
        tf.transform(xmin, ymin),
        tf.transform(xmin, ymax),
        tf.transform(xmax, ymin),
        tf.transform(xmax, ymax),
    ]
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    return min(lons), min(lats), max(lons), max(lats)


def tile_grid(bbox_2193: tuple[float, float, float, float]) -> list[tuple[float, float, float, float]]:
    xmin, ymin, xmax, ymax = bbox_2193
    out: list[tuple[float, float, float, float]] = []
    y = ymin
    while y < ymax:
        x = xmin
        y_top = min(y + TILE_SIZE_M, ymax)
        while x < xmax:
            x_right = min(x + TILE_SIZE_M, xmax)
            out.append((x, y, x_right, y_top))
            x = x_right
        y = y_top
    return out


def overpass_query(bbox_4326: tuple[float, float, float, float]) -> dict[str, Any]:
    min_lon, min_lat, max_lon, max_lat = bbox_4326
    bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    query = f"""[out:json][timeout:120];
(
  node["natural"="tree"]({bbox});
  way["natural"="tree_row"]({bbox});
);
out tags center;"""
    last_error: Exception | None = None
    for attempt in range(1, OVERPASS_MAX_ATTEMPTS + 1):
        endpoint = OVERPASS_ENDPOINTS[(attempt - 1) % len(OVERPASS_ENDPOINTS)]
        try:
            data = urllib.parse.urlencode({"data": query}).encode("utf-8")
            req = urllib.request.Request(endpoint, data=data, headers={
                "User-Agent": "akl-trees-osm-natural-tree/0.1",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=180) as response:
                payload = response.read().decode("utf-8")
            return json.loads(payload)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            wait = min(60, 10 * attempt)
            print(f"  overpass attempt {attempt} failed ({exc}); sleeping {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Overpass repeatedly failed: {last_error}")


def fetch_tile(bbox_2193_tile: tuple[float, float, float, float]) -> dict[str, Any]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    name = "osm_natural_tree_{:.0f}_{:.0f}_{:.0f}_{:.0f}.json".format(*bbox_2193_tile)
    path = RAW_DIR / name
    if path.exists() and path.stat().st_size > 0:
        return json.loads(path.read_text(encoding="utf-8"))
    bbox_4326 = bbox_2193_to_4326(bbox_2193_tile)
    data = overpass_query(bbox_4326)
    path.write_text(json.dumps(data), encoding="utf-8")
    time.sleep(OVERPASS_SLEEP_S)
    return data


def normalise_element(element: dict[str, Any]) -> dict[str, Any] | None:
    """Convert an Overpass element to a GeoJSON Feature dict, or None."""
    el_type = element.get("type")
    if el_type == "node":
        lon = element.get("lon")
        lat = element.get("lat")
    elif el_type == "way" and "center" in element:
        lon = element["center"].get("lon")
        lat = element["center"].get("lat")
    else:
        return None
    if lon is None or lat is None:
        return None
    tags = element.get("tags") or {}
    if tags.get("natural") not in ("tree", "tree_row"):
        return None
    props = {
        "osm_type": el_type,
        "osm_id": element.get("id"),
        "natural": tags.get("natural"),
        "species": tags.get("species") or tags.get("species:la"),
        "species_en": tags.get("species:en") or tags.get("species:en-NZ"),
        "genus": tags.get("genus"),
        "name": tags.get("name"),
        "denotation": tags.get("denotation"),
        "leaf_type": tags.get("leaf_type"),
        "leaf_cycle": tags.get("leaf_cycle"),
        "height_m": _to_float(tags.get("height")),
        "circumference_m": _to_float(tags.get("circumference")),
    }
    return {
        "type": "Feature",
        "id": f"{el_type}/{element.get('id')}",
        "properties": {k: v for k, v in props.items() if v not in (None, "")},
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        text = str(value).strip().lower()
        for suffix in (" m", "m", " metres", " meters"):
            if text.endswith(suffix):
                text = text[: -len(suffix)].strip()
                break
        return float(text)
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, default=list(DEFAULT_PILOT_BBOX_2193))
    args = parser.parse_args()
    bbox = tuple(float(v) for v in args.bbox)
    tiles = tile_grid(bbox)
    print(f"Fetching OSM natural=tree across {len(tiles)} tiles...")

    seen_ids: set[str] = set()
    features: list[dict[str, Any]] = []
    for index, tile_bbox in enumerate(tiles, start=1):
        data = fetch_tile(tile_bbox)
        elements = data.get("elements", [])
        added_here = 0
        for element in elements:
            feature = normalise_element(element)
            if feature is None:
                continue
            if feature["id"] in seen_ids:
                continue
            seen_ids.add(feature["id"])
            features.append(feature)
            added_here += 1
        print(f"  tile {index}/{len(tiles)}: {len(elements):,} elements, {added_here:,} new trees")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )
    species_counts: dict[str, int] = {}
    for feat in features:
        latin = feat["properties"].get("species") or feat["properties"].get("genus")
        if latin:
            species_counts[latin] = species_counts.get(latin, 0) + 1
    top = sorted(species_counts.items(), key=lambda kv: kv[1], reverse=True)[:15]

    manifest = {
        "fetched_at_utc": utc_now(),
        "bbox_2193": list(bbox),
        "tiles": len(tiles),
        "feature_count": len(features),
        "with_species_or_genus": int(sum(1 for f in features if f["properties"].get("species") or f["properties"].get("genus"))),
        "with_height": int(sum(1 for f in features if f["properties"].get("height_m"))),
        "with_circumference": int(sum(1 for f in features if f["properties"].get("circumference_m"))),
        "top_species_or_genus": top,
        "out_path": str(OUT_PATH.relative_to(ROOT)),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in (
        "feature_count", "with_species_or_genus", "with_height", "with_circumference"
    )}, indent=2))


if __name__ == "__main__":
    main()
