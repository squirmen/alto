from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit_release_readiness.py"
SPEC = importlib.util.spec_from_file_location("audit_release_readiness", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_parse_web_totals() -> None:
    html = """
    <script>
      const PILOT_TOTALS = {
        trees: 12,
        crowns: 10,
        totalValueNzdY: 345
      };
    </script>
    """
    assert MODULE.parse_web_totals(html) == {
        "trees": 12,
        "crowns": 10,
        "totalValueNzdY": 345,
    }


def test_rate_handles_missing_and_zero_denominator() -> None:
    assert MODULE.rate(5, 10) == 0.5
    assert MODULE.rate(None, 10) is None
    assert MODULE.rate(5, 0) is None


def test_validation_artifact_requires_explicit_acceptance(tmp_path: Path) -> None:
    artifact = tmp_path / "metrics.json"
    assert not MODULE.validation_artifact_ready(artifact)
    artifact.write_text(json.dumps({"status": "draft"}), encoding="utf-8")
    assert not MODULE.validation_artifact_ready(artifact)
    artifact.write_text(json.dumps({"status": "validated"}), encoding="utf-8")
    assert MODULE.validation_artifact_ready(artifact)


def test_full_audit_builds_every_gate_and_reports_pointcloud_gap(tmp_path: Path) -> None:
    db = tmp_path / "audit.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript(
        """
        CREATE TABLE trees (
            tree_id TEXT PRIMARY KEY,
            source_primary TEXT,
            species_latin TEXT,
            record_role TEXT,
            taxon_assertion_status TEXT
        );
        INSERT INTO trees VALUES (
            'tree_1', 'lidar_inferred_canopy', NULL,
            'remote_detection', 'not_asserted'
        );

        CREATE TABLE tree_crown_pilot (tree_id TEXT PRIMARY KEY);
        INSERT INTO tree_crown_pilot VALUES ('tree_1');
        CREATE TABLE tree_valuation_pilot (
            tree_id TEXT PRIMARY KEY,
            valuation_confidence TEXT,
            total_value_nzd_y REAL,
            avoided_runoff_m3_y REAL,
            stored_co2e_tonnes_est REAL
        );
        INSERT INTO tree_valuation_pilot VALUES ('tree_1', 'modelled_medium', 10, 2, 3);
        CREATE TABLE tree_assets_pilot (tree_id TEXT PRIMARY KEY);
        INSERT INTO tree_assets_pilot VALUES ('tree_1');
        CREATE TABLE tree_root_zone_pilot (tree_id TEXT PRIMARY KEY);
        INSERT INTO tree_root_zone_pilot VALUES ('tree_1');
        CREATE TABLE tree_trajectory_pilot (
            trajectory_id TEXT PRIMARY KEY,
            canonical_tree_id TEXT,
            present_2013 INTEGER,
            present_2016 INTEGER,
            present_2024 INTEGER,
            fate TEXT
        );
        CREATE TABLE tree_species_class_predictions (
            tree_id TEXT PRIMARY KEY,
            predicted_species_class TEXT,
            release_eligible INTEGER
        );
        INSERT INTO tree_species_class_predictions VALUES ('tree_1', 'conifer', 0);
        CREATE TABLE tree_pointcloud_pilot (
            tree_id TEXT PRIMARY KEY,
            pointcloud_class TEXT
        );
        INSERT INTO tree_pointcloud_pilot VALUES ('tree_1', 'no_data');
        """
    )
    conn.commit()
    conn.close()
    html = tmp_path / "index.html"
    html.write_text(
        "const PILOT_TOTALS = {trees: 1, crowns: 1, totalValueNzdY: 10, "
        "runoffM3Y: 2, carbonTco2e: 3};",
        encoding="utf-8",
    )

    metrics, findings = MODULE.audit(db, html)
    by_gate = {finding.gate: finding for finding in findings}

    assert len(findings) == len(by_gate)
    assert by_gate["required_tables"].status == "PASS"
    assert by_gate["pointcloud_verification_coverage"].status == "FAIL"
    assert metrics["inferred_pointcloud_no_data"] == 1
    assert metrics["inferred_pointcloud_no_data_rate"] == 1.0
    assert metrics["web_total_mismatches"] == {}


def test_write_reports_creates_both_output_parents(tmp_path: Path) -> None:
    json_out = tmp_path / "json" / "release.json"
    md_out = tmp_path / "markdown" / "release.md"
    finding = MODULE.Finding("gate", "PASS", "minor", "evidence", "none")

    payload = MODULE.write_reports({"metric": 1}, [finding], json_out, md_out)

    assert payload["verdict"] == "READY"
    assert json.loads(json_out.read_text(encoding="utf-8"))["verdict"] == "READY"
    assert "**Verdict: READY.**" in md_out.read_text(encoding="utf-8")
