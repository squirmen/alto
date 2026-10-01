#!/usr/bin/env python3
"""Build the public web-release provenance manifest.

The map itself is static, so release identity and provenance must travel with
the deployed files instead of being inferred from server state.  This script
uses only the Python standard library and is intentionally cheap enough to run
every time ``build_web_deploy.sh`` assembles a release.
"""

from __future__ import annotations

import json
import re
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT = ROOT / "web" / "pilot_map" / "release-metadata.json"

MODEL_SOURCES = (
    ("crown_segmentation", "tree_crown_pilot", "method_id"),
    ("growth_form_classifier", "tree_species_class_predictions", "model_id"),
    ("pointcloud_verification", "tree_pointcloud_pilot", "method_id"),
    ("tree_change", "tree_trajectory_pilot", "method_id"),
    ("root_space", "tree_root_zone_pilot", "method_id"),
    ("ecosystem_services", "tree_valuation_pilot", "method_id"),
)

PUBLIC_ARTIFACTS = (
    "data/processed/trees_map_points.pmtiles",
    "data/processed/tree_crowns_pilot.pmtiles",
    "data/processed/low_canopy_candidates.pmtiles",
    "data/processed/tree_change.pmtiles",
    "data/processed/tree_root_shapes.pmtiles",
    "data/processed/canopy_cover_by_board.geojson",
    "data/processed/kauri_dieback.geojson",
    "data/processed/exports/akl_trees_metro.parquet",
    "data/processed/exports/akl_trees_metro.csv.gz",
    "data/processed/exports/akl_trees_data_dictionary.md",
)


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone() is not None


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f'PRAGMA table_info("{table}")')}


def _count(conn: sqlite3.Connection, table: str, where: str = "1=1") -> int:
    if not _table_exists(conn, table):
        return 0
    return int(conn.execute(f'SELECT COUNT(*) FROM "{table}" WHERE {where}').fetchone()[0])


def _valuation_scope_counts(conn: sqlite3.Connection) -> tuple[int, int]:
    """Count included and nominal rows in one pass over the large valuation table."""
    if not _table_exists(conn, "tree_valuation_pilot"):
        return 0, 0
    included, nominal = conn.execute(
        """
        SELECT
          COALESCE(SUM(CASE WHEN valuation_confidence != 'modelled_nominal' THEN 1 ELSE 0 END), 0),
          COALESCE(SUM(CASE WHEN valuation_confidence = 'modelled_nominal' THEN 1 ELSE 0 END), 0)
        FROM tree_valuation_pilot
        """
    ).fetchone()
    return int(included), int(nominal)


def _project_version() -> str:
    match = re.search(
        r'^version\s*=\s*["\']([^"\']+)["\']',
        (ROOT / "pyproject.toml").read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    return match.group(1) if match else "unknown"


def _source_revision() -> str | None:
    """Read the current Git revision without invoking Git."""
    git = ROOT / ".git"
    head_path = git / "HEAD"
    if not head_path.exists():
        return None
    head = head_path.read_text(encoding="utf-8").strip()
    if head.startswith("ref: "):
        ref = git / head[5:]
        if not ref.exists():
            return None
        head = ref.read_text(encoding="utf-8").strip()
    return head[:12] if re.fullmatch(r"[0-9a-fA-F]{12,40}", head) else None


def _source_dirty() -> bool | None:
    if not (ROOT / ".git").exists():
        return None
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=all"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return bool(result.stdout.strip())


def _latest_timestamp() -> str:
    # The release database is the atomic product assembled by the pipeline.
    # Its filesystem timestamp is cheap to read and, unlike MAX() over several
    # million-row tables, does not turn each static deploy into a full DB scan.
    return datetime.fromtimestamp(DB.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")


def _models(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    for component, table, column in MODEL_SOURCES:
        if not _table_exists(conn, table):
            continue
        if column in _columns(conn, table):
            row = conn.execute(
                f'SELECT "{column}" FROM "{table}" '
                f'WHERE "{column}" IS NOT NULL AND TRIM("{column}") != \'\' LIMIT 1'
            ).fetchone()
            implementation_id = str(row[0]) if row else f"unrecorded_{component}_method"
        else:
            implementation_id = f"legacy_unversioned_{component}_output"
        models.append(
            {
                "component": component,
                "validation_status": "not_independently_validated",
                "release_eligible": False,
                "implementations": [{"id": implementation_id}],
            }
        )
    return models


def _artifacts() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for relative in PUBLIC_ARTIFACTS:
        path = ROOT / relative
        if not path.exists():
            continue
        out.append(
            {
                "path": relative.removeprefix("data/processed/"),
                "bytes": path.stat().st_size,
                "last_modified_utc": datetime.fromtimestamp(
                    path.stat().st_mtime, timezone.utc
                ).isoformat(timespec="seconds"),
            }
        )
    return out


def build_metadata() -> dict[str, Any]:
    if not DB.exists():
        raise SystemExit(f"database not found: {DB}")
    with sqlite3.connect(f"file:{DB}?mode=ro", uri=True) as conn:
        last_updated = _latest_timestamp()
        tree_records = _count(conn, "trees")
        headline_records, nominal_records = _valuation_scope_counts(conn)
        scenario_nominal_records = _count(
            conn,
            "tree_valuation_scenarios",
            "scenario_name = 'legacy_modelled_nominal_v1'",
        )
        nominal_records += scenario_nominal_records
        models = _models(conn)
        dataset_version = f"metro-{last_updated[:10].replace('-', '.')}"
        return {
            "schema_version": 1,
            "release": {
                "name": "ALTO — Auckland metropolitan research snapshot",
                "status": "research_only_not_independently_validated",
                "public_claims_enabled": False,
                "software_version": _project_version(),
                "dataset_version": dataset_version,
                "dataset_last_updated_utc": last_updated,
                "metadata_generated_utc": datetime.now(timezone.utc).isoformat(
                    timespec="seconds"
                ),
                "source_revision": _source_revision(),
                "source_dirty": _source_dirty(),
            },
            "dataset": {
                "extent_id": "auckland_metro",
                "tree_records": tree_records,
                "crown_records": _count(conn, "tree_crown_pilot"),
                "root_space_records": _count(conn, "tree_root_zone_pilot"),
                "pointcloud_records": _count(conn, "tree_pointcloud_pilot"),
            },
            "headline_scope": {
                "valuation_records_included": headline_records,
                "modelled_nominal_records_excluded": nominal_records,
                "description": (
                    "Headline service totals exclude modelled_nominal crownless scenarios. "
                    "All remaining ecosystem-service totals are unvalidated sensitivity "
                    "scenarios, not release-eligible economic or physical claims."
                ),
            },
            "models": models,
            "artifacts": _artifacts(),
            "provenance": {
                "source_catalog": "config/sources.json",
                "methods": "docs/methodology.md",
                "validation_directory": "docs/validation",
                "working_crs": "EPSG:2193",
                "web_crs": "EPSG:4326",
            },
        }


def main() -> None:
    metadata = build_metadata()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"release metadata -> {OUT}")
    print(
        f"  {metadata['release']['dataset_version']} · "
        f"{metadata['dataset']['tree_records']:,} trees · "
        f"updated {metadata['release']['dataset_last_updated_utc']}"
    )


if __name__ == "__main__":
    main()
