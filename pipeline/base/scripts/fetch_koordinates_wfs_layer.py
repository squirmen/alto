#!/usr/bin/env python3
"""Fetch a Koordinates/LINZ/LRIS/MfE WFS vector layer with an API key.

The API key is read from an environment variable by default so it does not need
to be stored in the repository or passed on the command line.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from urllib.error import HTTPError
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


POINT_FIELDNAMES = [
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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def request_json(url: str, params: dict[str, Any], retries: int = 3) -> dict[str, Any]:
    payload = request_text(url, params, retries)
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Non-JSON response from {url}: {payload[:500]}") from exc
    if isinstance(data, dict) and "ExceptionReport" in data:
        raise RuntimeError(json.dumps(data["ExceptionReport"])[:1000])
    return data


def request_text(url: str, params: dict[str, Any], retries: int = 3) -> str:
    query = urllib.parse.urlencode(params)
    full_url = f"{url}?{query}"
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(
                full_url,
                headers={
                    "Accept": "application/json,*/*",
                    "User-Agent": "akl-trees-koordinates-wfs/0.1",
                },
            )
            with urllib.request.urlopen(request, timeout=300) as response:
                return response.read().decode("utf-8")
        except HTTPError as exc:
            last_error = exc
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001 - best effort diagnostic body.
                body = ""
            if attempt == retries:
                detail = f"{exc}"
                if body:
                    detail = f"{detail}: {body[:1000]}"
                raise RuntimeError(f"Failed to fetch {full_url}: {detail}") from exc
            time.sleep(2 * attempt)
        except Exception as exc:  # noqa: BLE001 - retry transient network/API failures.
            last_error = exc
            if attempt == retries:
                break
            time.sleep(2 * attempt)
    raise RuntimeError(f"Failed to fetch {full_url}: {last_error}") from last_error


def build_wfs_url(domain: str, api_key: str, layer_id: int) -> str:
    return f"https://{domain}/services;key={urllib.parse.quote(api_key)}/wfs/layer-{layer_id}/"


def build_all_wfs_url(domain: str, api_key: str) -> str:
    return f"https://{domain}/services;key={urllib.parse.quote(api_key)}/wfs/"


def discover_feature_type_name(wfs_url: str, layer_id: int) -> str:
    xml_text = request_text(
        wfs_url,
        {"service": "WFS", "version": "2.0.0", "request": "GetCapabilities"},
    )
    root = ET.fromstring(xml_text)
    names = []
    for feature_type in root.findall(".//{*}FeatureType"):
        name = feature_type.find("{*}Name")
        if name is not None and name.text:
            names.append(name.text)
    if len(names) == 1:
        return names[0]
    for name in names:
        if str(layer_id) in name:
            return name
    raise RuntimeError(f"Could not discover a WFS typeName for layer {layer_id}; candidates={names}")


def geometry_xy(feature: dict[str, Any]) -> tuple[Any, Any]:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or []
    if geometry.get("type") == "Point" and len(coords) >= 2:
        return coords[0], coords[1]
    return "", ""


def first_attr(attrs: dict[str, Any], candidates: tuple[str, ...]) -> Any:
    compact = {
        "".join(ch for ch in key.lower() if ch.isalnum()): key
        for key in attrs
    }
    for candidate in candidates:
        candidate_key = "".join(ch for ch in candidate.lower() if ch.isalnum())
        key = compact.get(candidate_key)
        if key is not None and attrs.get(key) not in (None, ""):
            return attrs[key]
    for key, value in attrs.items():
        key_compact = "".join(ch for ch in key.lower() if ch.isalnum())
        if value not in (None, "") and any(
            "".join(ch for ch in candidate.lower() if ch.isalnum()) in key_compact
            for candidate in candidates
        ):
            return value
    return ""


def write_feature_csv(path: Path, source: dict[str, Any], geojson: dict[str, Any]) -> None:
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
            x, y = geometry_xy(feature)
            row = {
                "source_slug": source["slug"],
                "source_name": source["name"],
                "provider": source["provider"],
                "category": source["category"],
                "geometry_type": geometry.get("type", ""),
                "longitude": x,
                "latitude": y,
                "geometry_json": json.dumps(geometry, separators=(",", ":")) if geometry else "",
            }
            row.update(feature.get("properties") or {})
            writer.writerow(row)


def write_unified_points(path: Path, source: dict[str, Any], geojson: dict[str, Any]) -> int:
    count = 0
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=POINT_FIELDNAMES)
        writer.writeheader()
        for feature in geojson.get("features", []):
            x, y = geometry_xy(feature)
            if x == "" or y == "":
                continue
            attrs = feature.get("properties") or {}
            feature_id = feature.get("id", "")
            row = {
                "source_slug": source["slug"],
                "source_name": source["name"],
                "provider": source["provider"],
                "category": source["category"],
                "source_priority": source.get("priority", ""),
                "source_url": source["source_url"],
                "source_record_id": feature_id,
                "tree_id": first_attr(attrs, ("tree_id", "treeid", "id", "objectid", "fid")) or feature_id,
                "common_name": first_attr(attrs, ("common_name", "commonname", "name")),
                "scientific_name": first_attr(attrs, ("scientific_name", "scientificname", "species", "taxon")),
                "species_or_name": first_attr(attrs, ("species", "name", "description", "type")),
                "dbh_or_diameter": first_attr(attrs, ("dbh", "diameter", "circumference")),
                "height": first_attr(attrs, ("height",)),
                "condition_or_health": first_attr(attrs, ("condition", "health")),
                "longitude": x,
                "latitude": y,
                "properties_json": json.dumps(attrs, separators=(",", ":")),
            }
            writer.writerow(row)
            count += 1
    return count


def merge_unified_points(base_path: Path, add_path: Path, output_path: Path, replace_slug: str) -> int:
    total = 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    with temp_path.open("w", newline="", encoding="utf-8") as fout:
        writer = csv.DictWriter(fout, fieldnames=POINT_FIELDNAMES)
        writer.writeheader()
        for path in (base_path, add_path):
            if not path.exists():
                continue
            with path.open(newline="", encoding="utf-8") as fin:
                reader = csv.DictReader(fin)
                for row in reader:
                    if path == base_path and row.get("source_slug") == replace_slug:
                        continue
                    writer.writerow({key: row.get(key, "") for key in POINT_FIELDNAMES})
                    total += 1
    temp_path.replace(output_path)
    return total


def upsert_manifest(snapshot_root: Path, manifest: dict[str, Any]) -> None:
    manifest_json = snapshot_root / "download_manifest.json"
    if not manifest_json.exists():
        return
    manifests = json.loads(manifest_json.read_text(encoding="utf-8"))
    manifests = [item for item in manifests if item.get("slug") != manifest["slug"]]
    manifests.append(manifest)
    manifest_json.write_text(json.dumps(manifests, indent=2), encoding="utf-8")

    fields = [
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
    with (snapshot_root / "download_manifest.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for item in manifests:
            writer.writerow({key: item.get(key, "") for key in fields})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--domain", default="data.linz.govt.nz")
    parser.add_argument("--layer-id", type=int, required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--provider", default="Land Information New Zealand")
    parser.add_argument("--category", default="national_topographic_tree_points")
    parser.add_argument("--priority", default="medium")
    parser.add_argument("--source-page", required=True)
    parser.add_argument("--license", default="")
    parser.add_argument("--api-key-env", default="LINZ_API_KEY")
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--srs-name", default="EPSG:4326")
    parser.add_argument("--page-size", type=int, default=10000)
    parser.add_argument("--type-name")
    parser.add_argument("--discover-type-name", action="store_true")
    parser.add_argument("--capabilities-output", type=Path)
    parser.add_argument("--all-capabilities-output", type=Path)
    parser.add_argument("--hits-only", action="store_true")
    parser.add_argument("--merge-base-points", type=Path)
    parser.add_argument("--merge-output-points", type=Path)
    args = parser.parse_args()

    api_key = os.environ.get(args.api_key_env)
    if not api_key:
        raise SystemExit(f"Set {args.api_key_env} before running this script.")

    source_dir = args.output_root / "raw" / args.slug
    source_dir.mkdir(parents=True, exist_ok=True)
    wfs_url = build_wfs_url(args.domain, api_key, args.layer_id)
    all_wfs_url = build_all_wfs_url(args.domain, api_key)
    public_source_url = f"https://{args.domain}/services;key=<redacted>/wfs/layer-{args.layer_id}/"
    source = {
        "slug": args.slug,
        "name": args.name,
        "provider": args.provider,
        "category": args.category,
        "priority": args.priority,
        "source_url": public_source_url,
    }

    type_name = args.type_name or f"layer-{args.layer_id}"
    if args.capabilities_output:
        capabilities = request_text(
            wfs_url,
            {"service": "WFS", "version": "2.0.0", "request": "GetCapabilities"},
        )
        args.capabilities_output.write_text(capabilities, encoding="utf-8")
        print(args.capabilities_output)
        return
    if args.all_capabilities_output:
        capabilities = request_text(
            all_wfs_url,
            {"service": "WFS", "version": "2.0.0", "request": "GetCapabilities"},
        )
        args.all_capabilities_output.write_text(capabilities, encoding="utf-8")
        print(args.all_capabilities_output)
        return
    if args.discover_type_name:
        type_name = discover_feature_type_name(wfs_url, args.layer_id)
        print(f"{args.slug}: using WFS typeName {type_name}")

    if args.hits_only:
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": type_name,
            "outputFormat": "json",
            "srsName": args.srs_name,
            "resultType": "hits",
        }
        page = request_json(wfs_url, params)
        print(
            json.dumps(
                {
                    "slug": args.slug,
                    "layer_id": args.layer_id,
                    "totalFeatures": page.get("totalFeatures"),
                    "numberMatched": page.get("numberMatched"),
                    "numberReturned": page.get("numberReturned"),
                },
                indent=2,
            )
        )
        return

    all_features: list[dict[str, Any]] = []
    start_index = 0
    total_features: int | None = None
    while True:
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": type_name,
            "outputFormat": "json",
            "srsName": args.srs_name,
            "count": args.page_size,
            "startIndex": start_index,
        }
        page = request_json(wfs_url, params)
        features = page.get("features", [])
        if total_features is None:
            raw_total = page.get("totalFeatures")
            if isinstance(raw_total, int):
                total_features = raw_total
            elif isinstance(raw_total, str) and raw_total.isdigit():
                total_features = int(raw_total)
        all_features.extend(features)
        target = f"/{total_features:,}" if total_features is not None else ""
        print(f"{args.slug}: fetched {len(all_features):,}{target}")
        if not features or len(features) < args.page_size:
            break
        start_index += len(features)

    geojson = {
        "type": "FeatureCollection",
        "features": all_features,
        "crs": {"type": "name", "properties": {"name": args.srs_name}},
    }
    geojson_path = source_dir / "features_4326.geojson"
    csv_path = source_dir / "features_4326.csv"
    points_path = source_dir / "unified_points.csv"
    geojson_path.write_text(json.dumps(geojson, separators=(",", ":")), encoding="utf-8")
    write_feature_csv(csv_path, source, geojson)
    point_count = write_unified_points(points_path, source, geojson)

    manifest = {
        "slug": args.slug,
        "name": args.name,
        "provider": args.provider,
        "category": args.category,
        "kind": "koordinates_wfs",
        "status": "downloaded",
        "feature_count": len(all_features),
        "point_count": point_count,
        "geometry_type": "GeoJSON",
        "source_url": public_source_url,
        "source_page": args.source_page,
        "license": args.license,
        "fetched_at_utc": utc_now(),
        "outputs": {
            "geojson": str(geojson_path),
            "csv": str(csv_path),
            "unified_points": str(points_path),
        },
    }
    (source_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    upsert_manifest(args.output_root, manifest)

    if args.merge_base_points and args.merge_output_points:
        merged_count = merge_unified_points(
            args.merge_base_points,
            points_path,
            args.merge_output_points,
            args.slug,
        )
        print(f"{args.merge_output_points}: {merged_count:,} rows")


if __name__ == "__main__":
    main()
