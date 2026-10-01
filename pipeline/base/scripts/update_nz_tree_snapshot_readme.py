#!/usr/bin/env python3
"""Refresh the README and manifest for an NZ tree source snapshot."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path


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


def count_csv_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open(newline="", encoding="utf-8") as f:
        return max(sum(1 for _ in f) - 1, 0)


def normalize_raw_manifest(root: Path, manifest_path: Path, manifest: dict) -> dict:
    source_dir = manifest_path.parent
    normalized = dict(manifest)
    normalized["slug"] = normalized.get("slug") or source_dir.name

    outputs = dict(normalized.get("outputs") or {})
    for key, filename in {
        "geojson": "features_4326.geojson",
        "csv": "features_4326.csv",
        "unified_points": "unified_points.csv",
    }.items():
        output_path = source_dir / filename
        if output_path.exists():
            outputs[key] = str(output_path)
    if outputs:
        normalized["outputs"] = outputs

    return normalized


def load_downloaded_raw_manifests(root: Path) -> list[dict]:
    manifests = []
    for manifest_path in sorted(root.glob("raw/*/manifest.json")):
        if manifest_path.parent.name == "osm_nz_tree_features":
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("status") != "downloaded":
            continue
        normalized = normalize_raw_manifest(root, manifest_path, manifest)
        if normalized != manifest:
            manifest_path.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
        manifests.append(normalized)
    return manifests


def upsert_manifests(manifests: list[dict], additions: list[dict]) -> list[dict]:
    by_slug = {}
    order = []
    for manifest in [*manifests, *additions]:
        slug = manifest.get("slug")
        if not slug:
            continue
        if slug not in by_slug:
            order.append(slug)
        by_slug[slug] = manifest
    return [by_slug[slug] for slug in order]


def rebuild_points_plus_osm(root: Path) -> int:
    council_path = root / "derived" / "unified_tree_points.csv"
    osm_path = root / "raw" / "osm_nz_tree_features" / "osm_nz_individual_tree_nodes.csv"
    extra_point_paths = sorted(root.glob("raw/*/unified_points.csv"))
    combined_path = root / "derived" / "unified_tree_points_plus_osm.csv"
    temp_path = combined_path.with_suffix(combined_path.suffix + ".tmp")
    total = 0

    with temp_path.open("w", newline="", encoding="utf-8") as fout:
        writer = csv.DictWriter(fout, fieldnames=POINT_FIELDNAMES)
        writer.writeheader()
        for path in (council_path, osm_path, *extra_point_paths):
            if not path.exists():
                continue
            with path.open(newline="", encoding="utf-8") as fin:
                reader = csv.DictReader(fin)
                for row in reader:
                    writer.writerow({key: row.get(key, "") for key in POINT_FIELDNAMES})
                    total += 1

    temp_path.replace(combined_path)
    return total


def write_catalogued_only_sources(root: Path, downloaded_slugs: set[str]) -> int:
    registry_path = root / "registry.json"
    if not registry_path.exists():
        return 0
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    rows = [
        source
        for source in registry.get("sources", [])
        if source.get("kind") not in {"arcgis_layer", "file_download", "osm_geofabrik", "superseded"}
        and source.get("slug") not in downloaded_slugs
    ]
    fields = [
        "slug",
        "name",
        "provider",
        "category",
        "priority",
        "kind",
        "source_page",
        "download_url",
        "license",
        "notes",
    ]
    with (root / "catalogued_not_downloaded.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fields})
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot_root", type=Path)
    args = parser.parse_args()

    root = args.snapshot_root
    osm_manifest_path = root / "raw" / "osm_nz_tree_features" / "manifest.json"
    manifest_json_path = root / "download_manifest.json"
    manifest_csv_path = root / "download_manifest.csv"

    manifests = json.loads(manifest_json_path.read_text(encoding="utf-8"))
    osm_manifest = json.loads(osm_manifest_path.read_text(encoding="utf-8"))
    manifests = upsert_manifests(manifests, load_downloaded_raw_manifests(root))

    osm_row = {
        "slug": "osm_nz_tree_features",
        "name": osm_manifest["name"],
        "provider": osm_manifest["provider"],
        "category": osm_manifest["category"],
        "kind": osm_manifest["kind"],
        "status": "downloaded",
        "source_url": osm_manifest["source_url"],
        "source_page": osm_manifest["source_page"],
        "license": osm_manifest["license"],
        "feature_count": osm_manifest["individual_tree_node_count"],
        "expected_count": osm_manifest["individual_tree_node_count"],
        "geometry_type": "osm_node_points",
        "osm_individual_tree_node_count": osm_manifest["individual_tree_node_count"],
        "osm_broader_tree_feature_count": osm_manifest["broader_tree_feature_count"],
    }

    manifests = [m for m in manifests if m.get("slug") != "osm_nz_tree_features"]
    manifests = upsert_manifests(manifests, [osm_row])
    manifest_json_path.write_text(json.dumps(manifests, indent=2), encoding="utf-8")

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
    with manifest_csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for manifest in manifests:
            writer.writerow({key: manifest.get(key, "") for key in fields})

    arcgis_features = sum(
        int(m.get("feature_count") or 0)
        for m in manifests
        if m.get("kind") == "arcgis_layer"
    )
    arcgis_direct_sources = sum(
        1
        for m in manifests
        if m.get("kind") != "osm_geofabrik"
        and m.get("status") == "downloaded"
    )
    wfs_features = sum(
        int(m.get("feature_count") or 0)
        for m in manifests
        if m.get("kind") in {"wfs_geojson", "koordinates_wfs", "koordinates_export"}
    )
    direct_files = sum(1 for m in manifests if m.get("kind") == "file_download")
    failures = sum(1 for m in manifests if m.get("status") == "error")
    council_point_rows = count_csv_rows(root / "derived" / "unified_tree_points.csv")
    combined_point_rows = rebuild_points_plus_osm(root)
    downloaded_slugs = {
        m.get("slug", "")
        for m in manifests
        if m.get("status") == "downloaded"
    }
    catalogued_only = write_catalogued_only_sources(root, downloaded_slugs)

    readme = f"""# NZ tree source snapshot

Created UTC: {datetime.now(timezone.utc).isoformat(timespec="seconds")}
Mode: full download plus OSM extract

## Summary

- Sources in download manifest: {len(manifests)}
- Non-OSM sources downloaded: {arcgis_direct_sources}
- Direct file downloads: {direct_files}
- Failed active sources: {failures}
- ArcGIS features downloaded: {arcgis_features:,}
- WFS/manual vector/context features downloaded: {wfs_features:,}
- Council/protected/infrastructure point rows: {council_point_rows:,}
- OSM individual tree nodes: {osm_manifest["individual_tree_node_count"]:,}
- OSM broader tree/wood/forest/orchard features: {osm_manifest["broader_tree_feature_count"]:,}
- Combined point rows with OSM/keyed point sources: {combined_point_rows:,}
- Catalogued-only sources: {catalogued_only}

## Key Files

- `download_manifest.csv`: source-level status and counts.
- `registry.json`: all discovered sources, including manual/API-key/WFS sources not bulk-downloaded here.
- `catalogued_not_downloaded.csv`: relevant manual/API-key/Kart/WFS sources that were identified but not downloaded.
- `derived/unified_tree_points.csv`: council/protected/infrastructure point index only.
- `derived/unified_tree_points_plus_osm.csv`: council/protected/infrastructure point index plus OSM `natural=tree` nodes and keyed point-source extracts.
- `raw/<source_slug>/features_4326.geojson`: per-source GeoJSON snapshots for ArcGIS layers.
- `raw/<source_slug>/features_4326.csv`: per-source CSV snapshots for ArcGIS layers.
- `raw/<source_slug>/manual_export/`: manually downloaded Koordinates/LINZ/LRIS/MfE GeoPackage exports and bundled metadata/docs.
- `raw/osm_nz_tree_features/`: Geofabrik NZ PBF, OSM extracts, GeoJSON exports, CSV, and manifest.

Remaining manual/API-key context sources from the registry are catalogued in `catalogued_not_downloaded.csv`. Existing Auckland project data from `config/sources.json` was not duplicated in this non-Auckland expansion snapshot.
"""
    (root / "README.md").write_text(readme, encoding="utf-8")
    print(root / "README.md")


if __name__ == "__main__":
    main()
