#!/usr/bin/env python3
"""Fetch valuation context layers clipped to the Waitemata pilot bbox."""

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
CONFIG_PATH = ROOT / "config" / "valuation_sources.json"
DOCS_ROOT = ROOT / "docs"

# The historical context cache lives at data/raw/arcgis_context_waitemata/
# for the Waitemata pilot. Newer pilots get a pilot-specific subdirectory so
# both can coexist on disk.
from _pilot_config import active_pilot_name  # noqa: E402
_PILOT_NAME = active_pilot_name()
if _PILOT_NAME == "waitemata_v1":
    RAW_ROOT = ROOT / "data" / "raw" / "arcgis_context_waitemata"
else:
    RAW_ROOT = ROOT / "data" / "raw" / f"arcgis_context_{_PILOT_NAME}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_json(url: str, params: dict[str, Any] | None = None, retries: int = 3) -> dict[str, Any]:
    if params:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{urllib.parse.urlencode(params)}"
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "akl-trees-context-fetcher/0.1",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = response.read().decode("utf-8")
            data = json.loads(payload)
            if "error" in data:
                raise RuntimeError(f"ArcGIS error from {url}: {data['error']}")
            return data
        except Exception as exc:  # noqa: BLE001 - dependency-free retry wrapper.
            last_error = exc
            if attempt == retries:
                break
            time.sleep(2 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}") from last_error


def load_config(only: set[str] | None = None) -> tuple[tuple[float, float, float, float], list[dict[str, Any]]]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    # If the active pilot is the legacy Waitemata, use the pilot_bbox_4326
    # baked into valuation_sources.json. For any other pilot, compute the
    # 4326 bbox from the active 2193 bbox so we don't have to edit the
    # config file on every expansion.
    from pyproj import Transformer
    from _pilot_config import active_pilot_bbox, active_pilot_name
    if active_pilot_name() == "waitemata_v1":
        bbox = tuple(config["pilot_bbox_4326"])
    else:
        bb = active_pilot_bbox()
        tf = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
        sw = tf.transform(bb[0], bb[1])
        ne = tf.transform(bb[2], bb[3])
        nw = tf.transform(bb[0], bb[3])
        se = tf.transform(bb[2], bb[1])
        lons = [sw[0], ne[0], nw[0], se[0]]
        lats = [sw[1], ne[1], nw[1], se[1]]
        bbox = (min(lons), min(lats), max(lons), max(lats))
    sources = [
        source
        for source in config["sources"]
        if source.get("type") == "arcgis_feature_layer"
    ]
    if only:
        sources = [source for source in sources if source["slug"] in only]
    return bbox, sources


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


def records_to_geojson(layer_meta: dict[str, Any], records: list[dict[str, Any]]) -> dict[str, Any]:
    geometry_type = layer_meta.get("geometryType", "")
    oid_field = object_id_field(layer_meta)
    features = []
    for record in records:
        properties = dict(record.get("attributes", {}))
        feature: dict[str, Any] = {
            "type": "Feature",
            "properties": properties,
            "geometry": arcgis_geometry_to_geojson(record.get("geometry"), geometry_type),
        }
        if properties.get(oid_field) is not None:
            feature["id"] = properties[oid_field]
        features.append(feature)
    return {"type": "FeatureCollection", "features": features}


def query_params(
    bbox: tuple[float, float, float, float],
    layer_meta: dict[str, Any],
    offset: int | None = None,
    page_size: int | None = None,
) -> dict[str, Any]:
    xmin, ymin, xmax, ymax = bbox
    params: dict[str, Any] = {
        "where": "1=1",
        "geometry": f"{xmin},{ymin},{xmax},{ymax}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "json",
    }
    if offset is not None:
        params["resultOffset"] = offset
        params["resultRecordCount"] = page_size
        params["orderByFields"] = f"{object_id_field(layer_meta)} ASC"
    return params


def fetch_source(source: dict[str, Any], bbox: tuple[float, float, float, float]) -> dict[str, Any]:
    out_dir = RAW_ROOT / source["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)

    service_meta = fetch_json(source["service_url"], {"f": "json"})
    layer_meta = fetch_json(layer_url(source), {"f": "json"})
    max_record_count = int(layer_meta.get("maxRecordCount") or service_meta.get("maxRecordCount") or 1000)

    count_payload = fetch_json(
        f"{layer_url(source)}/query",
        {
            **query_params(bbox, layer_meta),
            "returnCountOnly": "true",
            "returnGeometry": "false",
        },
    )
    expected_count = int(count_payload["count"])

    records: list[dict[str, Any]] = []
    offset = 0
    while offset < expected_count:
        payload = fetch_json(
            f"{layer_url(source)}/query",
            query_params(bbox, layer_meta, offset=offset, page_size=max_record_count),
        )
        page_records = payload.get("features", [])
        if not page_records:
            break
        records.extend(page_records)
        offset += len(page_records)
        print(f"{source['slug']}: fetched {len(records):,}/{expected_count:,}")

    geojson = records_to_geojson(layer_meta, records)
    (out_dir / "service.json").write_text(json.dumps(service_meta, indent=2), encoding="utf-8")
    (out_dir / "layer_0.json").write_text(json.dumps(layer_meta, indent=2), encoding="utf-8")
    (out_dir / "features_4326.geojson").write_text(json.dumps(geojson), encoding="utf-8")

    manifest = {
        "slug": source["slug"],
        "name": source["name"],
        "category": source.get("category"),
        "valuation_role": source.get("valuation_role"),
        "service_url": source["service_url"],
        "layer_url": layer_url(source),
        "fetched_at_utc": utc_now(),
        "pilot_bbox_4326": list(bbox),
        "expected_count_in_bbox": expected_count,
        "feature_count": len(records),
        "geometry_type": layer_meta.get("geometryType"),
        "fields": [field.get("name") for field in layer_meta.get("fields", [])],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def write_report(manifests: list[dict[str, Any]]) -> None:
    lines = [
        "# Pilot Context Layers",
        "",
        f"Generated at: {utc_now()}",
        "",
        "These layers were fetched only for the Waitemata pilot bbox. They are the first real context inputs for replacing the interim service-value placeholders.",
        "",
        "| Source | Category | Features in Pilot | Geometry | Valuation Role |",
        "| --- | --- | ---: | --- | --- |",
    ]
    for manifest in manifests:
        lines.append(
            "| "
            + " | ".join(
                [
                    manifest["name"],
                    str(manifest.get("category") or ""),
                    f"{manifest['feature_count']:,}",
                    str(manifest.get("geometry_type") or ""),
                    str(manifest.get("valuation_role") or ""),
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## Immediate Use",
            "",
            "- Join every tree/crown to flood plain and flood-prone polygons.",
            "- Measure distance to overland flow paths, catchpits, pipes, and inlets/outlets.",
            "- Use the air-temperature polygons to flag trees in hotter locations.",
            "- Bring in impervious-surface and land-cover files next to replace the current uniform runoff coefficient with local surface coefficients.",
            "",
        ]
    )
    (DOCS_ROOT / "pilot_context_layers.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="Optional source slugs to fetch.")
    args = parser.parse_args()

    bbox, sources = load_config(set(args.only) if args.only else None)
    RAW_ROOT.mkdir(parents=True, exist_ok=True)
    manifests = [fetch_source(source, bbox) for source in sources]
    (RAW_ROOT / "fetch_manifest.json").write_text(json.dumps(manifests, indent=2), encoding="utf-8")
    write_report(manifests)
    print(json.dumps(manifests, indent=2))


if __name__ == "__main__":
    main()
