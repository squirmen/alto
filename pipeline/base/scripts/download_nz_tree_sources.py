#!/usr/bin/env python3
"""Download public New Zealand tree-related sources into a normalized snapshot.

The script intentionally uses only the Python standard library so it can run in
a plain Python environment. It supports ArcGIS FeatureServer/MapServer layers
and simple direct file downloads. OSM extraction is handled separately because
it depends on osmium.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REGISTRY = ROOT / "data" / "source_discovery" / "nz_tree_sources_registry.json"
DEFAULT_OUTPUT_ROOT = ROOT / "data" / "nz_tree_sources"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def url_with_params(url: str, params: dict[str, Any]) -> str:
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urllib.parse.urlencode(params)}"


def request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            "Accept": "application/json,*/*",
            "User-Agent": "akl-trees-nz-source-collector/0.1",
        },
    )


def fetch_json(url: str, params: dict[str, Any] | None = None, retries: int = 4) -> dict[str, Any]:
    if params:
        url = url_with_params(url, params)

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(request(url), timeout=180) as response:
                payload = response.read().decode("utf-8")
            data = json.loads(payload)
            if isinstance(data, dict) and "error" in data:
                raise RuntimeError(f"ArcGIS error: {data['error']}")
            return data
        except Exception as exc:  # noqa: BLE001 - keep data fetch resilient.
            last_error = exc
            if attempt == retries:
                break
            time.sleep(2 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}") from last_error


def load_registry(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def arcgis_service_url(layer_url: str) -> tuple[str, int]:
    match = re.search(r"/(FeatureServer|MapServer)/(\d+)$", layer_url)
    if not match:
        raise ValueError(f"Expected ArcGIS layer URL ending in FeatureServer/N or MapServer/N: {layer_url}")
    service_url = layer_url[: match.start(2) - 1]
    return service_url, int(match.group(2))


def object_id_field(layer_meta: dict[str, Any]) -> str:
    for key in ("objectIdField", "objectIdFieldName"):
        if layer_meta.get(key):
            return str(layer_meta[key])
    for field in layer_meta.get("fields", []):
        if field.get("type") == "esriFieldTypeOID":
            return str(field["name"])
    raise ValueError("Could not identify object ID field")


def count_layer(layer_url: str) -> int | None:
    payload = fetch_json(
        f"{layer_url}/query",
        {"where": "1=1", "returnCountOnly": "true", "f": "json"},
    )
    count = payload.get("count")
    return int(count) if count is not None else None


def query_features(
    layer_url: str,
    layer_meta: dict[str, Any],
    expected_count: int | None,
    page_size: int | None,
) -> list[dict[str, Any]]:
    max_record_count = int(layer_meta.get("maxRecordCount") or 1000)
    page_size = min(page_size or max_record_count, max_record_count)
    oid = object_id_field(layer_meta)
    advanced = layer_meta.get("advancedQueryCapabilities") or {}
    supports_order_by = bool(advanced.get("supportsOrderBy", True))
    supports_pagination = bool(advanced.get("supportsPagination", True))

    if supports_pagination:
        records: list[dict[str, Any]] = []
        offset = 0
        empty_pages = 0
        while expected_count is None or offset < expected_count:
            params: dict[str, Any] = {
                "where": "1=1",
                "outFields": "*",
                "returnGeometry": "true",
                "outSR": "4326",
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "f": "json",
            }
            if supports_order_by:
                params["orderByFields"] = f"{oid} ASC"
            payload = fetch_json(f"{layer_url}/query", params)
            page = payload.get("features", [])
            if not page:
                empty_pages += 1
                if empty_pages >= 2:
                    break
                offset += page_size
                continue
            empty_pages = 0
            records.extend(page)
            offset += len(page)
            total = f"{expected_count:,}" if expected_count is not None else "unknown"
            print(f"  fetched {len(records):,}/{total}")
            if len(page) < page_size and not payload.get("exceededTransferLimit"):
                break
        if expected_count is None or len(records) >= min(expected_count, len(records)):
            return records
        print("  pagination returned fewer records than expected; trying object ID chunks")

    ids_payload = fetch_json(
        f"{layer_url}/query",
        {"where": "1=1", "returnIdsOnly": "true", "f": "json"},
    )
    object_ids = ids_payload.get("objectIds") or []
    object_ids = sorted(int(x) for x in object_ids)
    records = []
    chunk_size = min(page_size, 500)
    for index in range(0, len(object_ids), chunk_size):
        chunk = object_ids[index : index + chunk_size]
        payload = fetch_json(
            f"{layer_url}/query",
            {
                "objectIds": ",".join(str(x) for x in chunk),
                "outFields": "*",
                "returnGeometry": "true",
                "outSR": "4326",
                "f": "json",
            },
        )
        records.extend(payload.get("features", []))
        print(f"  fetched {len(records):,}/{len(object_ids):,}")
    return records


def arcgis_geometry_to_geojson(geometry: dict[str, Any] | None, geometry_type: str) -> dict[str, Any] | None:
    if not geometry:
        return None
    if geometry_type == "esriGeometryPoint":
        if "x" not in geometry or "y" not in geometry:
            return None
        return {"type": "Point", "coordinates": [geometry["x"], geometry["y"]]}
    if geometry_type == "esriGeometryPolyline":
        paths = geometry.get("paths") or []
        if len(paths) == 1:
            return {"type": "LineString", "coordinates": paths[0]}
        return {"type": "MultiLineString", "coordinates": paths}
    if geometry_type == "esriGeometryPolygon":
        return {"type": "Polygon", "coordinates": geometry.get("rings") or []}
    if geometry_type == "esriGeometryMultipoint":
        return {"type": "MultiPoint", "coordinates": geometry.get("points") or []}
    return None


def features_to_geojson(layer_meta: dict[str, Any], records: list[dict[str, Any]]) -> dict[str, Any]:
    geometry_type = layer_meta.get("geometryType", "")
    try:
        oid = object_id_field(layer_meta)
    except ValueError:
        oid = ""
    features = []
    for record in records:
        properties = dict(record.get("attributes") or {})
        feature: dict[str, Any] = {
            "type": "Feature",
            "properties": properties,
            "geometry": arcgis_geometry_to_geojson(record.get("geometry"), geometry_type),
        }
        if oid and properties.get(oid) is not None:
            feature["id"] = properties[oid]
        features.append(feature)
    return {"type": "FeatureCollection", "features": features}


def write_json(path: Path, data: Any, *, gzip_output: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if gzip_output:
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
    else:
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def write_feature_csv(path: Path, source: dict[str, Any], layer_meta: dict[str, Any], records: list[dict[str, Any]]) -> None:
    attr_keys: list[str] = []
    seen = set()
    for record in records:
        for key in (record.get("attributes") or {}).keys():
            if key not in seen:
                seen.add(key)
                attr_keys.append(key)

    fieldnames = [
        "source_slug",
        "source_name",
        "provider",
        "category",
        "geometry_type",
        "longitude",
        "latitude",
        "geometry_json",
        *attr_keys,
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            geometry = record.get("geometry") or {}
            row = {
                "source_slug": source["slug"],
                "source_name": source["name"],
                "provider": source.get("provider", ""),
                "category": source.get("category", ""),
                "geometry_type": layer_meta.get("geometryType", ""),
                "longitude": geometry.get("x", ""),
                "latitude": geometry.get("y", ""),
                "geometry_json": json.dumps(geometry, separators=(",", ":")) if geometry else "",
            }
            row.update(record.get("attributes") or {})
            writer.writerow(row)


def clean_for_match(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def first_matching_property(attrs: dict[str, Any], candidates: tuple[str, ...]) -> Any:
    normalized = {clean_for_match(k): k for k in attrs}
    for candidate in candidates:
        key = normalized.get(clean_for_match(candidate))
        if key is not None and attrs.get(key) not in (None, ""):
            return attrs.get(key)
    for key, value in attrs.items():
        compact = clean_for_match(key)
        if any(clean_for_match(candidate) in compact for candidate in candidates) and value not in (None, ""):
            return value
    return ""


def append_unified_point_rows(
    rows: list[dict[str, Any]],
    source: dict[str, Any],
    layer_meta: dict[str, Any],
    records: list[dict[str, Any]],
) -> None:
    if layer_meta.get("geometryType") != "esriGeometryPoint":
        return
    category = source.get("category", "")
    if not any(token in category for token in ("individual_tree", "protected_notable_tree", "tree_infrastructure")):
        return

    try:
        oid_field = object_id_field(layer_meta)
    except ValueError:
        oid_field = ""

    for record in records:
        geometry = record.get("geometry") or {}
        attrs = record.get("attributes") or {}
        if "x" not in geometry or "y" not in geometry:
            continue
        rows.append(
            {
                "source_slug": source["slug"],
                "source_name": source["name"],
                "provider": source.get("provider", ""),
                "category": category,
                "source_priority": source.get("priority", ""),
                "source_url": source.get("layer_url", source.get("download_url", "")),
                "source_record_id": attrs.get(oid_field, "") if oid_field else "",
                "tree_id": first_matching_property(
                    attrs,
                    ("treeid", "tree_id", "assetid", "asset_id", "globalid", "id", "objectid", "fid"),
                ),
                "common_name": first_matching_property(
                    attrs,
                    ("treecommon", "commonname", "common_name", "common", "speciescommon", "species common", "tree name"),
                ),
                "scientific_name": first_matching_property(
                    attrs,
                    ("treelatin", "botanical", "botanicalname", "latin", "scientific", "scientificname", "taxon"),
                ),
                "species_or_name": first_matching_property(
                    attrs,
                    ("species", "speciesname", "spname", "name", "description"),
                ),
                "dbh_or_diameter": first_matching_property(attrs, ("dbh", "diameter", "trunkdiameter")),
                "height": first_matching_property(attrs, ("height", "treeheight")),
                "condition_or_health": first_matching_property(attrs, ("condition", "health", "vigour")),
                "longitude": geometry["x"],
                "latitude": geometry["y"],
                "properties_json": json.dumps(attrs, separators=(",", ":")),
            }
        )


def write_unified_points(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "source_slug",
        "source_name",
        "provider",
        "category",
        "source_priority",
        "source_url",
        "source_record_id",
        "tree_id",
        "common_name",
        "scientific_name",
        "species_or_name",
        "dbh_or_diameter",
        "height",
        "condition_or_health",
        "longitude",
        "latitude",
        "properties_json",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_unified_points_merged(
    path: Path,
    new_rows: list[dict[str, Any]],
    replace_slugs: set[str],
) -> int:
    fieldnames = [
        "source_slug",
        "source_name",
        "provider",
        "category",
        "source_priority",
        "source_url",
        "source_record_id",
        "tree_id",
        "common_name",
        "scientific_name",
        "species_or_name",
        "dbh_or_diameter",
        "height",
        "condition_or_health",
        "longitude",
        "latitude",
        "properties_json",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    count = 0

    with temp_path.open("w", newline="", encoding="utf-8") as fout:
        writer = csv.DictWriter(fout, fieldnames=fieldnames)
        writer.writeheader()
        if path.exists():
            with path.open(newline="", encoding="utf-8") as fin:
                reader = csv.DictReader(fin)
                for row in reader:
                    if row.get("source_slug") in replace_slugs:
                        continue
                    writer.writerow({key: row.get(key, "") for key in fieldnames})
                    count += 1
        for row in new_rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})
            count += 1

    temp_path.replace(path)
    return count


def download_file(source: dict[str, Any], source_dir: Path) -> dict[str, Any]:
    url = source["download_url"]
    filename = source.get("filename") or Path(urllib.parse.urlparse(url).path).name or f"{source['slug']}.download"
    out_path = source_dir / filename
    source_dir.mkdir(parents=True, exist_ok=True)
    started = utc_now()
    print(f"\nDownloading {source['slug']}")
    bytes_written = 0
    with urllib.request.urlopen(request(url), timeout=300) as response:
        with out_path.open("wb") as f:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                bytes_written += len(chunk)
                if bytes_written and bytes_written % (50 * 1024 * 1024) < 1024 * 1024:
                    print(f"  wrote {bytes_written / (1024 * 1024):,.0f} MiB")

    manifest = {
        "slug": source["slug"],
        "name": source["name"],
        "provider": source.get("provider", ""),
        "category": source.get("category", ""),
        "kind": source.get("kind", ""),
        "status": "downloaded",
        "source_url": url,
        "source_page": source.get("source_page", ""),
        "license": source.get("license", ""),
        "fetched_at_utc": started,
        "bytes": bytes_written,
        "outputs": {"download": str(out_path)},
    }
    write_json(source_dir / "source_record.json", source)
    write_json(source_dir / "manifest.json", manifest)
    return manifest


def write_geojson_feature_csv(path: Path, source: dict[str, Any], geojson: dict[str, Any]) -> None:
    attr_keys: list[str] = []
    seen = set()
    for feature in geojson.get("features", []):
        for key in (feature.get("properties") or {}).keys():
            if key not in seen:
                seen.add(key)
                attr_keys.append(key)

    fieldnames = [
        "source_slug",
        "source_name",
        "provider",
        "category",
        "geometry_type",
        "longitude",
        "latitude",
        "geometry_json",
        *attr_keys,
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for feature in geojson.get("features", []):
            geometry = feature.get("geometry") or {}
            coordinates = geometry.get("coordinates") or []
            row = {
                "source_slug": source["slug"],
                "source_name": source["name"],
                "provider": source.get("provider", ""),
                "category": source.get("category", ""),
                "geometry_type": geometry.get("type", ""),
                "longitude": coordinates[0] if geometry.get("type") == "Point" and len(coordinates) > 0 else "",
                "latitude": coordinates[1] if geometry.get("type") == "Point" and len(coordinates) > 1 else "",
                "geometry_json": json.dumps(geometry, separators=(",", ":")) if geometry else "",
            }
            row.update(feature.get("properties") or {})
            writer.writerow(row)


def append_unified_geojson_point_rows(
    rows: list[dict[str, Any]],
    source: dict[str, Any],
    geojson: dict[str, Any],
) -> None:
    category = source.get("category", "")
    if not any(token in category for token in ("individual_tree", "protected_notable_tree", "tree_infrastructure")):
        return

    for feature in geojson.get("features", []):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) < 2:
            continue
        attrs = feature.get("properties") or {}
        feature_id = feature.get("id", "")
        rows.append(
            {
                "source_slug": source["slug"],
                "source_name": source["name"],
                "provider": source.get("provider", ""),
                "category": category,
                "source_priority": source.get("priority", ""),
                "source_url": source.get("download_url", source.get("source_page", "")),
                "source_record_id": feature_id,
                "tree_id": first_matching_property(
                    attrs,
                    ("treeid", "tree_id", "assetid", "asset_id", "globalid", "id", "objectid", "fid", "pol_id"),
                )
                or feature_id,
                "common_name": first_matching_property(
                    attrs,
                    ("treecommon", "commonname", "common_name", "common", "speciescommon", "species common", "tree name"),
                ),
                "scientific_name": first_matching_property(
                    attrs,
                    ("treelatin", "botanical", "botanicalname", "latin", "scientific", "scientificname", "taxon"),
                ),
                "species_or_name": first_matching_property(
                    attrs,
                    ("species", "speciesname", "spname", "name", "description", "Policy_SubCat"),
                ),
                "dbh_or_diameter": first_matching_property(attrs, ("dbh", "diameter", "trunkdiameter")),
                "height": first_matching_property(attrs, ("height", "treeheight")),
                "condition_or_health": first_matching_property(attrs, ("condition", "health", "vigour")),
                "longitude": coordinates[0],
                "latitude": coordinates[1],
                "properties_json": json.dumps(attrs, separators=(",", ":")),
            }
        )


def download_wfs_geojson(
    source: dict[str, Any],
    source_dir: Path,
    unified_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    url = source["download_url"]
    source_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nDownloading {source['slug']}")
    geojson = fetch_json(url)
    features = geojson.get("features", [])
    geojson_path = source_dir / "features_4326.geojson"
    csv_path = source_dir / "features_4326.csv"
    write_json(source_dir / "source_record.json", source)
    write_json(geojson_path, geojson)
    write_geojson_feature_csv(csv_path, source, geojson)
    append_unified_geojson_point_rows(unified_rows, source, geojson)

    manifest = {
        "slug": source["slug"],
        "name": source["name"],
        "provider": source.get("provider", ""),
        "category": source.get("category", ""),
        "kind": source.get("kind", ""),
        "status": "downloaded",
        "source_url": url,
        "source_page": source.get("source_page", ""),
        "license": source.get("license", ""),
        "fetched_at_utc": utc_now(),
        "feature_count": len(features),
        "geometry_type": "GeoJSON",
        "outputs": {
            "source_record": str(source_dir / "source_record.json"),
            "geojson": str(geojson_path),
            "csv": str(csv_path),
        },
    }
    write_json(source_dir / "manifest.json", manifest)
    print(f"  fetched {len(features):,}")
    return manifest


def download_arcgis_layer(
    source: dict[str, Any],
    source_dir: Path,
    page_size: int | None,
    metadata_only: bool,
    unified_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    layer_url = source["layer_url"].rstrip("/")
    service_url, layer_id = arcgis_service_url(layer_url)
    source_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nFetching {source['slug']}")

    service_meta = fetch_json(service_url, {"f": "json"})
    layer_meta = fetch_json(layer_url, {"f": "json"})
    expected_count = count_layer(layer_url)
    fetched_at = utc_now()

    write_json(source_dir / "source_record.json", source)
    write_json(source_dir / "service_metadata.json", service_meta)
    write_json(source_dir / "layer_metadata.json", layer_meta)

    manifest: dict[str, Any] = {
        "slug": source["slug"],
        "name": source["name"],
        "provider": source.get("provider", ""),
        "category": source.get("category", ""),
        "kind": source.get("kind", ""),
        "status": "metadata_only" if metadata_only else "downloaded",
        "source_url": layer_url,
        "source_page": source.get("source_page", ""),
        "license": source.get("license", ""),
        "fetched_at_utc": fetched_at,
        "service_url": service_url,
        "layer_id": layer_id,
        "expected_count": expected_count,
        "feature_count": 0,
        "geometry_type": layer_meta.get("geometryType", ""),
        "max_record_count": layer_meta.get("maxRecordCount", ""),
        "outputs": {
            "source_record": str(source_dir / "source_record.json"),
            "service_metadata": str(source_dir / "service_metadata.json"),
            "layer_metadata": str(source_dir / "layer_metadata.json"),
        },
    }

    if metadata_only:
        write_json(source_dir / "manifest.json", manifest)
        print(f"  count {expected_count if expected_count is not None else 'unknown'}")
        return manifest

    records = query_features(layer_url, layer_meta, expected_count, page_size)
    geojson = features_to_geojson(layer_meta, records)
    raw_path = source_dir / "features_arcgis.json.gz"
    geojson_path = source_dir / "features_4326.geojson"
    csv_path = source_dir / "features_4326.csv"
    write_json(raw_path, {"features": records}, gzip_output=True)
    write_json(geojson_path, geojson)
    write_feature_csv(csv_path, source, layer_meta, records)
    append_unified_point_rows(unified_rows, source, layer_meta, records)

    manifest.update(
        {
            "feature_count": len(records),
            "outputs": {
                **manifest["outputs"],
                "arcgis_features_gzip": str(raw_path),
                "geojson": str(geojson_path),
                "csv": str(csv_path),
            },
        }
    )
    write_json(source_dir / "manifest.json", manifest)
    return manifest


def write_manifest_tables(output_root: Path, manifests: list[dict[str, Any]]) -> None:
    write_json(output_root / "download_manifest.json", manifests)
    fieldnames = [
        "slug",
        "name",
        "provider",
        "category",
        "kind",
        "status",
        "feature_count",
        "expected_count",
        "geometry_type",
        "source_url",
        "source_page",
        "license",
        "error",
    ]
    with (output_root / "download_manifest.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for manifest in manifests:
            writer.writerow({key: manifest.get(key, "") for key in fieldnames})


def write_readme(output_root: Path, manifests: list[dict[str, Any]], unified_count: int, metadata_only: bool) -> None:
    downloaded = [m for m in manifests if m.get("status") == "downloaded"]
    failed = [m for m in manifests if m.get("status") == "error"]
    arcgis_count = sum(int(m.get("feature_count") or 0) for m in downloaded)
    lines = [
        "# NZ tree source snapshot",
        "",
        f"Created UTC: {utc_now()}",
        f"Mode: {'metadata only' if metadata_only else 'full download'}",
        "",
        "## Summary",
        "",
        f"- Sources processed: {len(manifests)}",
        f"- Sources downloaded: {len(downloaded)}",
        f"- Failed sources: {len(failed)}",
        f"- ArcGIS features downloaded: {arcgis_count:,}",
        f"- Unified point rows: {unified_count:,}",
        "",
        "## Layout",
        "",
        "- `raw/<source_slug>/`: source metadata, manifest, and per-source files.",
        "- `download_manifest.csv`: one row per source with counts/status.",
        "- `derived/unified_tree_points.csv`: cross-source point index for individual/protected/infrastructure tree point layers.",
        "",
        "Manual/API-key context sources from the registry are copied into `registry.json` but are not bulk-downloaded by this script.",
    ]
    if failed:
        lines.extend(["", "## Failures", ""])
        for item in failed:
            lines.append(f"- `{item.get('slug')}`: {item.get('error')}")
    (output_root / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def selected_sources(registry: dict[str, Any], only: set[str] | None, include_manual: bool) -> list[dict[str, Any]]:
    sources = registry["sources"]
    if only:
        sources = [source for source in sources if source["slug"] in only]
    if not include_manual:
        sources = [
            source
            for source in sources
            if source.get("kind") in {"arcgis_layer", "file_download", "wfs_geojson"}
        ]
    return sources


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--only", nargs="*", help="Optional source slugs to fetch")
    parser.add_argument("--page-size", type=int, default=None)
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--include-manual", action="store_true", help="Include manual sources in manifest as not_downloaded")
    parser.add_argument(
        "--append-existing",
        action="store_true",
        help="Merge selected downloads into an existing output root instead of replacing manifest/index files.",
    )
    args = parser.parse_args()

    registry = load_registry(args.registry)
    output_root = args.output_root
    raw_root = output_root / "raw"
    derived_root = output_root / "derived"
    output_root.mkdir(parents=True, exist_ok=True)
    raw_root.mkdir(parents=True, exist_ok=True)
    derived_root.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.registry, output_root / "registry.json")

    sources = selected_sources(registry, set(args.only) if args.only else None, args.include_manual)
    manifests: list[dict[str, Any]] = []
    unified_rows: list[dict[str, Any]] = []

    for source in sources:
        source_dir = raw_root / source["slug"]
        try:
            if source.get("kind") == "arcgis_layer":
                manifest = download_arcgis_layer(source, source_dir, args.page_size, args.metadata_only, unified_rows)
            elif source.get("kind") == "wfs_geojson":
                if args.metadata_only:
                    manifest = {
                        "slug": source["slug"],
                        "name": source["name"],
                        "provider": source.get("provider", ""),
                        "category": source.get("category", ""),
                        "kind": source.get("kind", ""),
                        "status": "metadata_only",
                        "source_url": source.get("download_url", ""),
                        "source_page": source.get("source_page", ""),
                        "license": source.get("license", ""),
                    }
                    write_json(source_dir / "source_record.json", source)
                    write_json(source_dir / "manifest.json", manifest)
                else:
                    manifest = download_wfs_geojson(source, source_dir, unified_rows)
            elif source.get("kind") == "file_download":
                if args.metadata_only:
                    manifest = {
                        "slug": source["slug"],
                        "name": source["name"],
                        "provider": source.get("provider", ""),
                        "category": source.get("category", ""),
                        "kind": source.get("kind", ""),
                        "status": "metadata_only",
                        "source_url": source.get("download_url", ""),
                        "source_page": source.get("source_page", ""),
                        "license": source.get("license", ""),
                    }
                    write_json(source_dir / "source_record.json", source)
                    write_json(source_dir / "manifest.json", manifest)
                else:
                    manifest = download_file(source, source_dir)
            else:
                manifest = {
                    "slug": source["slug"],
                    "name": source["name"],
                    "provider": source.get("provider", ""),
                    "category": source.get("category", ""),
                    "kind": source.get("kind", ""),
                    "status": "not_downloaded",
                    "source_url": source.get("source_page", ""),
                    "source_page": source.get("source_page", ""),
                    "license": source.get("license", ""),
                }
            manifests.append(manifest)
        except Exception as exc:  # noqa: BLE001 - continue other public sources.
            print(f"  ERROR {source['slug']}: {exc}", file=sys.stderr)
            manifest = {
                "slug": source["slug"],
                "name": source.get("name", ""),
                "provider": source.get("provider", ""),
                "category": source.get("category", ""),
                "kind": source.get("kind", ""),
                "status": "error",
                "source_url": source.get("layer_url", source.get("download_url", source.get("source_page", ""))),
                "source_page": source.get("source_page", ""),
                "license": source.get("license", ""),
                "error": str(exc),
            }
            write_json(source_dir / "source_record.json", source)
            write_json(source_dir / "manifest.json", manifest)
            manifests.append(manifest)

    selected_slugs = {source["slug"] for source in sources}
    if args.append_existing and (output_root / "download_manifest.json").exists():
        existing_manifests = json.loads((output_root / "download_manifest.json").read_text(encoding="utf-8"))
        merged_manifests = [
            manifest
            for manifest in existing_manifests
            if manifest.get("slug") not in selected_slugs
        ]
        merged_manifests.extend(manifests)
        unified_count = write_unified_points_merged(
            derived_root / "unified_tree_points.csv",
            unified_rows,
            selected_slugs,
        )
        write_manifest_tables(output_root, merged_manifests)
        write_readme(output_root, merged_manifests, unified_count, args.metadata_only)
    else:
        write_unified_points(derived_root / "unified_tree_points.csv", unified_rows)
        write_manifest_tables(output_root, manifests)
        write_readme(output_root, manifests, len(unified_rows), args.metadata_only)
    print(f"\nWrote {output_root}")


if __name__ == "__main__":
    main()
