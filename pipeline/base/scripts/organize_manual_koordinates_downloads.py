#!/usr/bin/env python3
"""Organize manually downloaded Koordinates GeoPackage exports."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SOURCES = [
    {
        "zip_name": "lds-nz-tree-points-topo-150k-GPKG.zip",
        "slug": "linz_nz_tree_points_topo_50k",
        "name": "NZ Tree Points (Topo, 1:50k)",
        "provider": "Land Information New Zealand",
        "category": "national_topographic_tree_points",
        "priority": "medium",
        "kind": "koordinates_wfs",
        "source_page": "https://data.linz.govt.nz/layer/50365-nz-tree-points-topo-150k/",
        "source_url": "https://data.linz.govt.nz/layer/50365-nz-tree-points-topo-150k/",
        "license": "CC BY 4.0",
    },
    {
        "zip_name": "lris-lcdb-v50-land-cover-database-version-50-mainland-new-zealand-GPKG.zip",
        "slug": "lcdb_v50_mainland_nz",
        "name": "LCDB v5.0 - Land Cover Database version 5.0 Mainland New Zealand",
        "provider": "Manaaki Whenua - Landcare Research / LRIS",
        "category": "national_land_cover_context",
        "priority": "high",
        "kind": "koordinates_export",
        "source_page": "https://lris.scinfo.org.nz/layer/104400-lcdb-v50-land-cover-database-version-50-mainland-new-zealand/",
        "source_url": "https://lris.scinfo.org.nz/layer/104400-lcdb-v50-land-cover-database-version-50-mainland-new-zealand/",
        "license": "CC BY 4.0",
    },
    {
        "zip_name": "lris-new-zealand-potential-vegetation-vector-version-GPKG.zip",
        "slug": "nz_potential_vegetation_vector",
        "name": "New Zealand Potential Vegetation (Vector version)",
        "provider": "Manaaki Whenua - Landcare Research / LRIS",
        "category": "national_vegetation_context",
        "priority": "medium",
        "kind": "koordinates_export",
        "source_page": "https://lris.scinfo.org.nz/layer/123462-new-zealand-potential-vegetation-vector-version/",
        "source_url": "https://lris.scinfo.org.nz/layer/123462-new-zealand-potential-vegetation-vector-version/",
        "license": "LRIS terms",
    },
    {
        "zip_name": "mfe-recruitment-of-indigenous-tree-sp-tree-fern-20022014-GPKG.zip",
        "slug": "mfe_recruitment_indigenous_tree_fern_2002_2014",
        "name": "Recruitment of indigenous tree species / tree fern 2002-2014",
        "provider": "Ministry for the Environment",
        "category": "national_forest_change_context",
        "priority": "medium",
        "kind": "koordinates_export",
        "source_page": "https://data.mfe.govt.nz/layer/52792-recruitment-of-indigenous-tree-sp-tree-fern-20022014/",
        "source_url": "https://data.mfe.govt.nz/layer/52792-recruitment-of-indigenous-tree-sp-tree-fern-20022014/",
        "license": "CC BY 3.0 NZ",
    },
    {
        "zip_name": "mfe-mortality-of-indigenous-tree-sp-tree-fern-20022014-GPKG.zip",
        "slug": "mfe_mortality_indigenous_tree_fern_2002_2014",
        "name": "Mortality of indigenous tree species / tree fern 2002-2014",
        "provider": "Ministry for the Environment",
        "category": "national_forest_change_context",
        "priority": "medium",
        "kind": "koordinates_export",
        "source_page": "https://data.mfe.govt.nz/layer/52776-mortality-of-indigenous-tree-sp-tree-fern-20022014/",
        "source_url": "https://data.mfe.govt.nz/layer/52776-mortality-of-indigenous-tree-sp-tree-fern-20022014/",
        "license": "CC BY 3.0 NZ",
    },
]

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


def locate_zip(manual_dir: Path, export_dir: Path, zip_name: str) -> Path:
    manual_path = manual_dir / zip_name
    export_path = export_dir / zip_name
    if manual_path.exists():
        export_dir.mkdir(parents=True, exist_ok=True)
        if export_path.exists():
            manual_path.unlink()
        else:
            shutil.move(str(manual_path), export_path)
    if not export_path.exists():
        raise FileNotFoundError(f"Could not find {zip_name} in {manual_dir} or {export_dir}")
    return export_path


def extract_zip(zip_path: Path, extract_dir: Path) -> list[Path]:
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        members = [name for name in archive.namelist() if not name.endswith("/")]
        missing = [name for name in members if not (extract_dir / name).exists()]
        if missing:
            archive.extractall(extract_dir)
    return sorted(path for path in extract_dir.rglob("*") if path.is_file())


def inspect_gpkg(path: Path) -> list[dict[str, Any]]:
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        contents = conn.execute(
            """
            SELECT c.table_name, c.identifier, c.data_type, c.srs_id,
                   g.geometry_type_name, g.column_name
            FROM gpkg_contents c
            LEFT JOIN gpkg_geometry_columns g ON c.table_name = g.table_name
            WHERE c.data_type = 'features'
            ORDER BY c.table_name
            """
        ).fetchall()
        layers = []
        for row in contents:
            table_name = row["table_name"]
            count = conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
            layers.append(
                {
                    "table_name": table_name,
                    "identifier": row["identifier"],
                    "feature_count": count,
                    "srs_id": row["srs_id"],
                    "geometry_type": row["geometry_type_name"],
                    "geometry_column": row["column_name"],
                }
            )
    return layers


def table_columns(conn: sqlite3.Connection, table_name: str) -> list[str]:
    return [row[1] for row in conn.execute(f'PRAGMA table_info("{table_name}")').fetchall()]


def first_present(columns: list[str], candidates: list[str]) -> str | None:
    compact = {"".join(ch for ch in column.lower() if ch.isalnum()): column for column in columns}
    for candidate in candidates:
        key = "".join(ch for ch in candidate.lower() if ch.isalnum())
        if key in compact:
            return compact[key]
    return None


def write_unified_points_from_gpkgs(path: Path, source: dict[str, Any], gpkg_paths: list[Path]) -> int:
    if path.exists():
        return sum(1 for _ in path.open(encoding="utf-8")) - 1

    count = 0
    with path.open("w", newline="", encoding="utf-8") as fout:
        writer = csv.DictWriter(fout, fieldnames=POINT_FIELDNAMES)
        writer.writeheader()
        for gpkg_path in gpkg_paths:
            with sqlite3.connect(gpkg_path) as conn:
                conn.row_factory = sqlite3.Row
                point_layers = conn.execute(
                    """
                    SELECT c.table_name
                    FROM gpkg_contents c
                    JOIN gpkg_geometry_columns g ON c.table_name = g.table_name
                    WHERE c.data_type = 'features'
                      AND upper(g.geometry_type_name) IN ('POINT', 'MULTIPOINT')
                    ORDER BY c.table_name
                    """
                ).fetchall()
                for layer in point_layers:
                    table_name = layer["table_name"]
                    columns = table_columns(conn, table_name)
                    lon_col = first_present(columns, ["fLong", "longitude", "long", "lon", "x"])
                    lat_col = first_present(columns, ["fLat", "latitude", "lat", "y"])
                    if not lon_col or not lat_col:
                        continue
                    species_col = first_present(columns, ["Species", "species", "scientific_name", "name"])
                    fid_col = first_present(columns, ["fid", "id", "objectid"])
                    attr_cols = [
                        column
                        for column in columns
                        if column.lower() not in {"geom", lon_col.lower(), lat_col.lower()}
                    ]
                    query_cols = ", ".join(f'"{column}"' for column in columns if column.lower() != "geom")
                    for row in conn.execute(f'SELECT {query_cols} FROM "{table_name}"'):
                        attrs = dict(row)
                        lon = attrs.get(lon_col)
                        lat = attrs.get(lat_col)
                        if lon in (None, "") or lat in (None, ""):
                            continue
                        record_id = attrs.get(fid_col) if fid_col else ""
                        species = attrs.get(species_col) if species_col else ""
                        writer.writerow(
                            {
                                "source_slug": source["slug"],
                                "source_name": source["name"],
                                "provider": source["provider"],
                                "category": source["category"],
                                "source_priority": source.get("priority", ""),
                                "source_url": source["source_url"],
                                "source_record_id": record_id,
                                "tree_id": record_id,
                                "common_name": "",
                                "scientific_name": species or "",
                                "species_or_name": species or "",
                                "dbh_or_diameter": "",
                                "height": "",
                                "condition_or_health": "",
                                "longitude": lon,
                                "latitude": lat,
                                "properties_json": json.dumps(
                                    {column: attrs.get(column) for column in attr_cols},
                                    separators=(",", ":"),
                                ),
                            }
                        )
                        count += 1
    return count


def merge_existing_manifest(manifest_path: Path, new_manifest: dict[str, Any]) -> dict[str, Any]:
    if not manifest_path.exists():
        return new_manifest
    existing = json.loads(manifest_path.read_text(encoding="utf-8"))
    merged = {**existing, **new_manifest}
    merged_outputs = dict(existing.get("outputs") or {})
    merged_outputs.update(new_manifest.get("outputs") or {})
    if merged_outputs:
        merged["outputs"] = merged_outputs
    if existing.get("fetched_at_utc") and not new_manifest.get("fetched_at_utc"):
        merged["fetched_at_utc"] = existing["fetched_at_utc"]
    return merged


def organize_source(snapshot_root: Path, manual_dir: Path, source: dict[str, Any]) -> dict[str, Any]:
    source_dir = snapshot_root / "raw" / source["slug"]
    export_dir = source_dir / "manual_export"
    extract_dir = export_dir / "extracted"
    zip_path = locate_zip(manual_dir, export_dir, source["zip_name"])
    extracted_files = extract_zip(zip_path, extract_dir)
    gpkg_paths = sorted(path for path in extracted_files if path.suffix.lower() == ".gpkg")
    layers = []
    for gpkg_path in gpkg_paths:
        for layer in inspect_gpkg(gpkg_path):
            layer["gpkg"] = str(gpkg_path)
            layers.append(layer)

    geometry_types = sorted({layer.get("geometry_type") or "" for layer in layers if layer.get("geometry_type")})
    point_count = sum(
        int(layer["feature_count"])
        for layer in layers
        if str(layer.get("geometry_type", "")).upper() in {"POINT", "MULTIPOINT"}
    )
    feature_count = sum(int(layer["feature_count"]) for layer in layers)
    docs = sorted(
        str(path)
        for path in extracted_files
        if path.suffix.lower() in {".txt", ".xml", ".pdf", ".doc", ".docx", ".xlsx", ".lyrx"}
    )
    points_path = source_dir / "unified_points.csv"
    normalized_point_count = 0
    if point_count:
        normalized_point_count = write_unified_points_from_gpkgs(points_path, source, gpkg_paths)

    manifest = {
        "slug": source["slug"],
        "name": source["name"],
        "provider": source["provider"],
        "category": source["category"],
        "kind": source["kind"],
        "status": "downloaded",
        "feature_count": feature_count,
        "point_count": point_count,
        "geometry_type": ", ".join(geometry_types) if geometry_types else "GeoPackage",
        "source_url": source["source_url"],
        "source_page": source["source_page"],
        "license": source["license"],
        "manual_export_organized_at_utc": utc_now(),
        "layers": layers,
        "outputs": {
            "manual_export_zip": str(zip_path),
            "manual_export_dir": str(extract_dir),
            "gpkg": [str(path) for path in gpkg_paths],
            "docs": docs,
        },
    }
    if normalized_point_count:
        manifest["outputs"]["unified_points"] = str(points_path)
        manifest["normalized_point_count"] = normalized_point_count
    if point_count:
        manifest["expected_count"] = point_count
    else:
        manifest["expected_count"] = feature_count

    manifest_path = source_dir / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    merged = merge_existing_manifest(manifest_path, manifest)
    manifest_path.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    return merged


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-root", type=Path, required=True)
    parser.add_argument("--manual-dir", type=Path, required=True)
    args = parser.parse_args()

    organized = []
    for source in SOURCES:
        manifest = organize_source(args.snapshot_root, args.manual_dir, source)
        organized.append(
            {
                "slug": manifest["slug"],
                "feature_count": manifest.get("feature_count", 0),
                "geometry_type": manifest.get("geometry_type", ""),
            }
        )
        print(
            f"{manifest['slug']}: {int(manifest.get('feature_count') or 0):,} "
            f"features ({manifest.get('geometry_type', 'unknown')})"
        )

    summary_path = args.snapshot_root / "manual_downloads_organized.json"
    summary_path.write_text(json.dumps({"organized_at_utc": utc_now(), "sources": organized}, indent=2), encoding="utf-8")
    print(summary_path)


if __name__ == "__main__":
    main()
