#!/usr/bin/env python3
"""Fetch configured ArcGIS FeatureServer layers into raw GeoJSON snapshots.

This script uses only the Python standard library so data collection can start
before the full geospatial environment is installed.
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


ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "config" / "sources.json"
RAW_ROOT = ROOT / "data" / "raw" / "arcgis"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_json(url: str, params: dict[str, Any] | None = None, retries: int = 3) -> dict[str, Any]:
    if params:
        query = urllib.parse.urlencode(params)
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{query}"

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "akl-trees-data-collector/0.1",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read().decode("utf-8")
            data = json.loads(payload)
            if "error" in data:
                raise RuntimeError(f"ArcGIS error from {url}: {data['error']}")
            return data
        except Exception as exc:  # noqa: BLE001 - keep script dependency-free.
            last_error = exc
            if attempt == retries:
                break
            time.sleep(2 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}") from last_error


def load_sources(only: set[str] | None) -> list[dict[str, Any]]:
    with SOURCES_PATH.open("r", encoding="utf-8") as f:
        config = json.load(f)
    sources = [
        source
        for source in config["sources"]
        if source.get("type") == "arcgis_feature_layer"
    ]
    if only:
        sources = [source for source in sources if source["slug"] in only]
    return sources


def layer_url(source: dict[str, Any]) -> str:
    return f"{source['service_url'].rstrip('/')}/{source.get('layer_id', 0)}"


def object_id_field(layer_meta: dict[str, Any]) -> str:
    for key in ("objectIdField", "objectIdFieldName"):
        if layer_meta.get(key):
            return layer_meta[key]
    for field in layer_meta.get("fields", []):
        if field.get("type") == "esriFieldTypeOID":
            return field["name"]
    raise ValueError("Could not find object id field")


def arcgis_geometry_to_geojson(geometry: dict[str, Any] | None, geometry_type: str) -> dict[str, Any] | None:
    if not geometry:
        return None
    if geometry_type == "esriGeometryPoint":
        return {"type": "Point", "coordinates": [geometry["x"], geometry["y"]]}
    if geometry_type == "esriGeometryPolygon":
        return {"type": "Polygon", "coordinates": geometry.get("rings", [])}
    if geometry_type == "esriGeometryPolyline":
        return {"type": "MultiLineString", "coordinates": geometry.get("paths", [])}
    return None


def features_to_geojson(layer_meta: dict[str, Any], records: list[dict[str, Any]]) -> dict[str, Any]:
    geometry_type = layer_meta.get("geometryType", "")
    oid_field = object_id_field(layer_meta)
    features = []
    for record in records:
        properties = dict(record.get("attributes", {}))
        geometry = arcgis_geometry_to_geojson(record.get("geometry"), geometry_type)
        feature_id = properties.get(oid_field)
        feature: dict[str, Any] = {
            "type": "Feature",
            "properties": properties,
            "geometry": geometry,
        }
        if feature_id is not None:
            feature["id"] = feature_id
        features.append(feature)
    return {"type": "FeatureCollection", "features": features}


def fetch_layer(source: dict[str, Any], page_size: int | None = None) -> dict[str, Any]:
    out_dir = RAW_ROOT / source["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)

    service_meta = fetch_json(source["service_url"], {"f": "json"})
    layer_meta = fetch_json(layer_url(source), {"f": "json"})
    oid_field = object_id_field(layer_meta)
    max_record_count = int(layer_meta.get("maxRecordCount") or service_meta.get("maxRecordCount") or 1000)
    page_size = min(page_size or max_record_count, max_record_count)

    count_payload = fetch_json(
        f"{layer_url(source)}/query",
        {"where": "1=1", "returnCountOnly": "true", "f": "json"},
    )
    expected_count = int(count_payload["count"])

    records: list[dict[str, Any]] = []
    offset = 0
    while offset < expected_count:
        payload = fetch_json(
            f"{layer_url(source)}/query",
            {
                "where": "1=1",
                "outFields": "*",
                "returnGeometry": "true",
                "outSR": "4326",
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "orderByFields": f"{oid_field} ASC",
                "f": "json",
            },
        )
        page_records = payload.get("features", [])
        if not page_records:
            break
        records.extend(page_records)
        offset += len(page_records)
        print(f"{source['slug']}: fetched {len(records):,}/{expected_count:,}")

    fetched_at = utc_now()
    geojson = features_to_geojson(layer_meta, records)

    (out_dir / "service.json").write_text(json.dumps(service_meta, indent=2), encoding="utf-8")
    (out_dir / "layer_0.json").write_text(json.dumps(layer_meta, indent=2), encoding="utf-8")
    (out_dir / "features_4326.geojson").write_text(json.dumps(geojson), encoding="utf-8")
    manifest = {
        "slug": source["slug"],
        "name": source["name"],
        "source_type": source["type"],
        "service_url": source["service_url"],
        "layer_url": layer_url(source),
        "layer_id": source.get("layer_id", 0),
        "fetched_at_utc": fetched_at,
        "expected_count": expected_count,
        "feature_count": len(records),
        "geometry_type": layer_meta.get("geometryType"),
        "source_spatial_reference": layer_meta.get("spatialReference"),
        "output_spatial_reference": "EPSG:4326",
        "outputs": {
            "service_metadata": str((out_dir / "service.json").relative_to(ROOT)),
            "layer_metadata": str((out_dir / "layer_0.json").relative_to(ROOT)),
            "geojson": str((out_dir / "features_4326.geojson").relative_to(ROOT)),
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--only",
        nargs="*",
        help="Optional source slugs to fetch. Defaults to all ArcGIS feature layers.",
    )
    parser.add_argument("--page-size", type=int, default=None)
    args = parser.parse_args()

    manifests = []
    for source in load_sources(set(args.only) if args.only else None):
        print(f"\nFetching {source['slug']}")
        manifests.append(fetch_layer(source, page_size=args.page_size))

    RAW_ROOT.mkdir(parents=True, exist_ok=True)
    (RAW_ROOT / "fetch_manifest.json").write_text(json.dumps(manifests, indent=2), encoding="utf-8")
    print(f"\nWrote {RAW_ROOT / 'fetch_manifest.json'}")


if __name__ == "__main__":
    main()
