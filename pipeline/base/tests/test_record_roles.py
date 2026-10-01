from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "remediate_record_roles.py"
SPEC = importlib.util.spec_from_file_location("remediate_record_roles", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def fixture(tmp_path: Path) -> tuple[Path, Path]:
    db = tmp_path / "trees.sqlite"
    connection = sqlite3.connect(db)
    connection.execute(
        """CREATE TABLE trees (
            tree_id TEXT PRIMARY KEY, source_primary TEXT, source_object_id INTEGER,
            species_common_raw TEXT, species_latin_raw TEXT,
            species_common TEXT, species_latin TEXT, species_confidence TEXT)"""
    )
    connection.executemany(
        "INSERT INTO trees VALUES (?,?,?,?,?,?,?,?)",
        [
            ("bad", "ruru_obskauri_tiaki_public", 5, "Kauri", "Agathis australis", "Kauri", "Agathis australis", "source_kauri_observation"),
            ("good", "ruru_obskauri_tiaki_public", 6, "Kauri", "Agathis australis", "Kauri", "Agathis australis", "source_kauri_observation"),
            ("managed", "tree_register_points", 7, "Oak", "Quercus robur", "Oak", "Quercus robur", "source_species"),
        ],
    )
    connection.execute(
        "CREATE TABLE tree_species_class_predictions(tree_id TEXT, model_id TEXT)"
    )
    connection.execute(
        "INSERT INTO tree_species_class_predictions VALUES ('x','stage3_cnn_resnet18_aerial_rgb_v1__calibrated_saerens_smoothed')"
    )
    connection.commit()
    connection.close()
    source = tmp_path / "kauri.geojson"
    source.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {"type": "Feature", "properties": {"OBJECTID": 5, "KDBFieldStatus": 5}, "geometry": None},
                    {"type": "Feature", "properties": {"OBJECTID": 6, "KDBFieldStatus": 1}, "geometry": None},
                ],
            }
        )
    )
    return db, source


def test_dry_run_does_not_change_schema(tmp_path: Path) -> None:
    db, source = fixture(tmp_path)
    result = MODULE.plan(db, source)
    assert result["database_taxa_to_clear"] == 1
    connection = sqlite3.connect(db)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(trees)")}
    connection.close()
    assert "record_role" not in columns


def test_apply_preserves_raw_taxon_and_assigns_roles(tmp_path: Path) -> None:
    db, source = fixture(tmp_path)
    result = MODULE.apply(db, source)
    assert result["corrected_taxa"] == 1
    assert result["legacy_growth_form_rows_quarantined"] == 1
    connection = sqlite3.connect(db)
    bad = connection.execute(
        "SELECT species_common_raw, species_latin_raw, species_common, species_latin, record_role, taxon_assertion_status FROM trees WHERE tree_id='bad'"
    ).fetchone()
    good = connection.execute(
        "SELECT species_latin, record_role FROM trees WHERE tree_id='good'"
    ).fetchone()
    managed = connection.execute(
        "SELECT record_role FROM trees WHERE tree_id='managed'"
    ).fetchone()[0]
    model = connection.execute(
        "SELECT model_id, score_semantics, release_eligible FROM tree_species_class_predictions"
    ).fetchone()
    connection.close()
    assert bad == ("Kauri", "Agathis australis", None, None, "surveillance_observation", "explicitly_not_kauri")
    assert good == ("Agathis australis", "surveillance_observation")
    assert managed == "managed_inventory"
    assert model == (
        "legacy_growth_form_rgb_prior_adjusted_not_calibrated",
        "legacy_prior_adjusted_score_not_probability",
        0,
    )
