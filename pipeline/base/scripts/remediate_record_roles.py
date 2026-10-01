#!/usr/bin/env python3
"""Add source roles and correct explicit 'Not a kauri' taxon assertions.

Dry-run is the default. ``--apply`` performs one audited SQLite transaction.
Raw source fields are preserved; only normalized taxon fields are cleared where
the surveillance source explicitly says the observation is not kauri.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
DEFAULT_KAURI = ROOT / "data" / "raw" / "arcgis" / "ruru_obskauri_tiaki_public" / "features_4326.geojson"
VERSION = "record_roles_and_taxon_assertions_v1"

ROLE_BY_SOURCE = {
    "tree_register_points": "managed_inventory",
    "notable_trees_overlay": "statutory_or_notable_inventory",
    "ruru_obskauri_tiaki_public": "surveillance_observation",
    "osm_natural_tree": "crowdsourced_observation",
    "lidar_inferred_canopy": "remote_sensing_detection",
    "pointcloud_missed_promoted": "remote_sensing_detection",
    "low_canopy_promoted": "remote_sensing_detection",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def explicit_not_kauri_ids(path: Path) -> list[int]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return sorted(
        int(feature["properties"]["OBJECTID"])
        for feature in payload.get("features", [])
        if feature.get("properties", {}).get("KDBFieldStatus") == 5
        and feature.get("properties", {}).get("OBJECTID") is not None
    )


def connect(path: Path, writable: bool) -> sqlite3.Connection:
    mode = "rw" if writable else "ro"
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode={mode}", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    if not writable:
        connection.execute("PRAGMA query_only=ON")
    return connection


def source_role_counts(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        source: int(
            connection.execute(
                "SELECT COUNT(*) FROM trees WHERE source_primary=?", (source,)
            ).fetchone()[0]
        )
        for source in ROLE_BY_SOURCE
    }


def quarantine_legacy_growth_form_scores(connection: sqlite3.Connection) -> int:
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tree_species_class_predictions'"
    ).fetchone()
    if not exists:
        return 0
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(tree_species_class_predictions)")
    }
    if "score_semantics" not in columns:
        connection.execute(
            "ALTER TABLE tree_species_class_predictions ADD COLUMN score_semantics TEXT"
        )
    if "release_eligible" not in columns:
        connection.execute(
            "ALTER TABLE tree_species_class_predictions ADD COLUMN release_eligible INTEGER"
        )
    cursor = connection.execute(
        """UPDATE tree_species_class_predictions
           SET model_id='legacy_growth_form_rgb_prior_adjusted_not_calibrated',
               score_semantics='legacy_prior_adjusted_score_not_probability',
               release_eligible=0
           WHERE model_id LIKE '%calibrated_saerens%'
              OR model_id='stage3_cnn_resnet18_aerial_rgb_v1'"""
    )
    connection.execute(
        """UPDATE tree_species_class_predictions
           SET release_eligible=0,
               score_semantics=COALESCE(score_semantics, 'uncalibrated_model_score')
           WHERE release_eligible IS NULL OR score_semantics IS NULL"""
    )
    return int(cursor.rowcount)


def matched_not_kauri(connection: sqlite3.Connection, object_ids: list[int]) -> list[sqlite3.Row]:
    if not object_ids:
        return []
    placeholders = ",".join("?" for _ in object_ids)
    return connection.execute(
        f"""
        SELECT tree_id, source_object_id, species_common, species_latin, species_confidence
        FROM trees
        WHERE source_primary='ruru_obskauri_tiaki_public'
          AND source_object_id IN ({placeholders})
        ORDER BY tree_id
        """,
        object_ids,
    ).fetchall()


def plan(db: Path, kauri_source: Path) -> dict[str, object]:
    ids = explicit_not_kauri_ids(kauri_source)
    connection = connect(db, writable=False)
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(trees)")}
        required = {"tree_id", "source_primary", "source_object_id", "species_common", "species_latin", "species_confidence"}
        if missing := required - columns:
            raise RuntimeError(f"trees missing columns: {sorted(missing)}")
        matched = matched_not_kauri(connection, ids)
        return {
            "mode": "dry-run",
            "raw_explicit_not_kauri": len(ids),
            "database_taxa_to_clear": len(matched),
            "source_role_counts": source_role_counts(connection),
            "record_role_column_exists": "record_role" in columns,
            "taxon_assertion_status_column_exists": "taxon_assertion_status" in columns,
        }
    finally:
        connection.close()


def apply(db: Path, kauri_source: Path) -> dict[str, object]:
    ids = explicit_not_kauri_ids(kauri_source)
    connection = connect(db, writable=True)
    run_id = f"record_roles_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    try:
        matched = matched_not_kauri(connection, ids)
        expected_ids = [row["tree_id"] for row in matched]
        connection.commit()
        connection.execute("BEGIN IMMEDIATE")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(trees)")}
        if "record_role" not in columns:
            connection.execute("ALTER TABLE trees ADD COLUMN record_role TEXT")
        if "taxon_assertion_status" not in columns:
            connection.execute("ALTER TABLE trees ADD COLUMN taxon_assertion_status TEXT")
        for source, role in ROLE_BY_SOURCE.items():
            connection.execute(
                "UPDATE trees SET record_role=? WHERE source_primary=?", (role, source)
            )
        connection.execute(
            "UPDATE trees SET record_role='other_source' WHERE record_role IS NULL"
        )
        quarantined_growth_form_rows = quarantine_legacy_growth_form_scores(connection)
        connection.execute(
            """CREATE TABLE IF NOT EXISTS tree_taxon_correction_audit (
                run_id TEXT NOT NULL, tree_id TEXT NOT NULL,
                source_object_id INTEGER, old_species_common TEXT,
                old_species_latin TEXT, old_species_confidence TEXT,
                new_taxon_assertion_status TEXT NOT NULL,
                changed_at_utc TEXT NOT NULL,
                PRIMARY KEY(run_id, tree_id))"""
        )
        changed = utc_now()
        connection.executemany(
            "INSERT INTO tree_taxon_correction_audit VALUES (?,?,?,?,?,?,?,?)",
            [
                (
                    run_id,
                    row["tree_id"],
                    row["source_object_id"],
                    row["species_common"],
                    row["species_latin"],
                    row["species_confidence"],
                    "explicitly_not_kauri",
                    changed,
                )
                for row in matched
            ],
        )
        connection.executemany(
            """UPDATE trees
               SET species_common=NULL, species_latin=NULL,
                   species_confidence='source_explicitly_not_kauri',
                   taxon_assertion_status='explicitly_not_kauri'
               WHERE tree_id=? AND source_primary='ruru_obskauri_tiaki_public'""",
            [(tree_id,) for tree_id in expected_ids],
        )
        updated = int(
            connection.execute(
                "SELECT COUNT(*) FROM trees WHERE tree_id IN (SELECT tree_id FROM tree_taxon_correction_audit WHERE run_id=?) AND taxon_assertion_status='explicitly_not_kauri'",
                (run_id,),
            ).fetchone()[0]
        )
        if updated != len(expected_ids):
            raise RuntimeError(f"taxon correction mismatch: expected {len(expected_ids)}, updated {updated}")
        connection.execute(
            """CREATE TABLE IF NOT EXISTS source_semantics_runs (
                run_id TEXT PRIMARY KEY, version TEXT NOT NULL,
                corrected_taxa INTEGER NOT NULL, details_json TEXT NOT NULL,
                completed_at_utc TEXT NOT NULL)"""
        )
        details = {
            "raw_source": str(kauri_source.resolve()),
            "raw_explicit_not_kauri": len(ids),
            "role_mapping": ROLE_BY_SOURCE,
            "raw_species_fields_preserved": True,
            "legacy_growth_form_rows_marked_not_release_eligible": quarantined_growth_form_rows,
        }
        connection.execute(
            "INSERT INTO source_semantics_runs VALUES (?,?,?,?,?)",
            (run_id, VERSION, updated, json.dumps(details, sort_keys=True), changed),
        )
        connection.commit()
        return {
            "mode": "apply",
            "run_id": run_id,
            "corrected_taxa": updated,
            "legacy_growth_form_rows_quarantined": quarantined_growth_form_rows,
            "record_roles_assigned": source_role_counts(connection),
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--kauri-source", type=Path, default=DEFAULT_KAURI)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    result = apply(args.db, args.kauri_source) if args.apply else plan(args.db, args.kauri_source)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
