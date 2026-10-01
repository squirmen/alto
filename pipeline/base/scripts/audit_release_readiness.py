#!/usr/bin/env python3
"""Evidence-based release and HPC hand-off gate for the Aotearoa Long-term Tree Observatory (ALTO).

The pipeline is intentionally allowed to produce exploratory products. This audit
prevents those products being described as publication-, policy-, or commercial-
ready before the corresponding evidence exists. It is read-only with respect to
the analysis database and writes a machine-readable JSON report plus Markdown.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
DEFAULT_HTML = ROOT / "web" / "pilot_map" / "index.html"
DEFAULT_JSON = ROOT / "docs" / "validation" / "release_readiness.json"
DEFAULT_MD = ROOT / "docs" / "validation" / "release_readiness.md"

FUNCTIONAL_CLASSES = {
    "evergreen_broadleaf",
    "deciduous_broadleaf",
    "conifer",
    "palm_other",
}


@dataclass
class Finding:
    gate: str
    status: str
    severity: str
    evidence: str
    required_action: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def has_table(conn: sqlite3.Connection, table: str) -> bool:
    return bool(
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
    )


def scalar(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> Any:
    row = conn.execute(sql, params).fetchone()
    return row[0] if row else None


def table_count(conn: sqlite3.Connection, table: str) -> int | None:
    if not has_table(conn, table):
        return None
    return int(scalar(conn, f'SELECT COUNT(*) FROM "{table}"') or 0)


def rate(numerator: int | float | None, denominator: int | float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return float(numerator) / float(denominator)


def parse_web_totals(html: str) -> dict[str, int]:
    match = re.search(r"const\s+PILOT_TOTALS\s*=\s*\{(.*?)\};", html, re.S)
    if not match:
        return {}
    return {
        key: int(value)
        for key, value in re.findall(r"([A-Za-z][A-Za-z0-9]*)\s*:\s*([0-9]+)", match.group(1))
    }


def validation_artifact_ready(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return payload.get("status") in {"validated", "accepted"}


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    if not has_table(conn, table):
        return set()
    return {str(row[1]) for row in conn.execute(f'PRAGMA table_info("{table}")')}


def latest_hpc_manifest() -> Path | None:
    candidates = list((ROOT / "outputs" / "hpc_readiness").glob("*/input_manifest.json"))
    return max(candidates, key=lambda path: path.stat().st_mtime_ns) if candidates else None


def audit(db: Path, html_path: Path) -> tuple[dict[str, Any], list[Finding]]:
    if not db.exists():
        raise FileNotFoundError(db)
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.execute("PRAGMA query_only=ON")

    metrics: dict[str, Any] = {"database": str(db)}
    findings: list[Finding] = []
    tables = [
        "trees",
        "tree_crown_pilot",
        "tree_valuation_pilot",
        "tree_assets_pilot",
        "tree_root_zone_pilot",
        "tree_trajectory_pilot",
        "tree_species_class_predictions",
        "tree_pointcloud_pilot",
    ]
    counts = {table: table_count(conn, table) for table in tables}
    metrics["table_counts"] = counts
    total = counts.get("trees") or 0

    required_tables = [table for table in tables if table != "tree_trajectory_pilot"]
    missing_tables = [table for table in required_tables if counts.get(table) is None]
    findings.append(
        Finding(
            "required_tables",
            "PASS" if not missing_tables else "FAIL",
            "critical",
            "All required tables exist." if not missing_tables else f"Missing: {', '.join(missing_tables)}.",
            "Rebuild the missing pipeline stages in dependency order.",
        )
    )

    coverage = {
        name: rate(counts.get(table), total)
        for name, table in {
            "crowns": "tree_crown_pilot",
            "valuations": "tree_valuation_pilot",
            "assets": "tree_assets_pilot",
            "root_zones": "tree_root_zone_pilot",
            "pointcloud_rows": "tree_pointcloud_pilot",
            "functional_class_predictions": "tree_species_class_predictions",
        }.items()
    }
    metrics["coverage"] = coverage
    crown_count = counts.get("tree_crown_pilot") or 0
    downstream_counts = {
        "valuations": counts.get("tree_valuation_pilot"),
        "assets": counts.get("tree_assets_pilot"),
        "root_zones": counts.get("tree_root_zone_pilot"),
    }
    downstream_mismatch = {
        name: value for name, value in downstream_counts.items() if value != crown_count
    }
    findings.append(
        Finding(
            "tree_product_completeness",
            "PASS" if not downstream_mismatch else "FAIL",
            "major",
            f"Crown-bearing eligibility denominator={crown_count:,}; downstream products match it. "
            f"Point-only/source observations without crowns={total - crown_count:,}."
            if not downstream_mismatch
            else f"Crown denominator={crown_count:,}; mismatches={downstream_mismatch}.",
            "Keep crown-bearing and point-only denominators explicit; never imply every source observation has measured canopy structure.",
        )
    )

    tree_columns = table_columns(conn, "trees")
    explicit_not_kauri_bad = 0
    if "taxon_assertion_status" in tree_columns:
        explicit_not_kauri_bad = int(
            scalar(
                conn,
                """SELECT COUNT(*) FROM trees
                   WHERE taxon_assertion_status='explicitly_not_kauri'
                     AND species_latin IS NOT NULL""",
            )
            or 0
        )
    predictions_columns = table_columns(conn, "tree_species_class_predictions")
    release_eligible_predictions = 0
    if "release_eligible" in predictions_columns:
        release_eligible_predictions = int(
            scalar(
                conn,
                "SELECT COUNT(*) FROM tree_species_class_predictions WHERE release_eligible=1",
            )
            or 0
        )
    source_semantics_ready = (
        "record_role" in tree_columns
        and "taxon_assertion_status" in tree_columns
        and explicit_not_kauri_bad == 0
        and release_eligible_predictions == 0
    )
    metrics["source_semantics"] = {
        "record_role_column": "record_role" in tree_columns,
        "taxon_assertion_status_column": "taxon_assertion_status" in tree_columns,
        "explicit_not_kauri_with_taxon_remaining": explicit_not_kauri_bad,
        "release_eligible_legacy_growth_form_predictions": release_eligible_predictions,
    }
    findings.append(
        Finding(
            "source_semantics",
            "PASS" if source_semantics_ready else "FAIL",
            "major",
            "Inventory, surveillance, crowdsourced and remote-detection roles are explicit; "
            "explicit not-kauri taxa are cleared and legacy scores are held from release."
            if source_semantics_ready
            else json.dumps(metrics["source_semantics"], sort_keys=True),
            "Rebuild/migrate source roles, preserve raw assertions and quarantine contradicted or uncalibrated taxon outputs.",
        )
    )

    nominal = 0
    nominal_by_source: dict[str, int] = {}
    if has_table(conn, "tree_valuation_pilot"):
        nominal = int(
            scalar(
                conn,
                "SELECT COUNT(*) FROM tree_valuation_pilot WHERE valuation_confidence='modelled_nominal'",
            )
            or 0
        )
        if nominal and has_table(conn, "trees"):
            nominal_by_source = dict(
                conn.execute(
                    """
                    SELECT t.source_primary, COUNT(*)
                    FROM tree_valuation_pilot v JOIN trees t USING(tree_id)
                    WHERE v.valuation_confidence='modelled_nominal'
                    GROUP BY t.source_primary ORDER BY COUNT(*) DESC
                    """
                ).fetchall()
            )
    metrics["unsupported_nominal_valuations"] = nominal
    metrics["unsupported_nominal_valuations_by_source"] = nominal_by_source
    findings.append(
        Finding(
            "observed_structure_before_valuation",
            "PASS" if nominal == 0 else "FAIL",
            "critical",
            f"{nominal:,} records without detected crowns were assigned synthetic p25 crown/height values."
            if nominal
            else "No synthetic no-canopy valuations are present in the primary valuation table.",
            "Keep no-canopy values null; if required, move proxy scenarios to a separate scenario table excluded from headlines.",
        )
    )

    inferred = inferred_no_data = 0
    if has_table(conn, "tree_pointcloud_pilot") and has_table(conn, "trees"):
        inferred = int(
            scalar(conn, "SELECT COUNT(*) FROM trees WHERE source_primary='lidar_inferred_canopy'")
            or 0
        )
        inferred_no_data = int(
            scalar(
                conn,
                """
                SELECT COUNT(*) FROM trees t JOIN tree_pointcloud_pilot p USING(tree_id)
                WHERE t.source_primary='lidar_inferred_canopy' AND p.pointcloud_class='no_data'
                """,
            )
            or 0
        )
    pc_gap = rate(inferred_no_data, inferred) or 0.0
    metrics["inferred_pointcloud_no_data"] = inferred_no_data
    metrics["inferred_pointcloud_no_data_rate"] = pc_gap
    findings.append(
        Finding(
            "pointcloud_verification_coverage",
            "PASS" if pc_gap <= 0.01 else "FAIL",
            "major",
            f"{inferred_no_data:,}/{inferred:,} inferred trees ({pc_gap:.1%}) have pointcloud_class='no_data'.",
            "Resolve tile/footprint coverage and report verified and unverified populations separately.",
        )
    )

    unknown_species = int(
        scalar(
            conn,
            "SELECT COUNT(*) FROM trees WHERE species_latin IS NULL OR TRIM(species_latin)=''",
        )
        or 0
    ) if has_table(conn, "trees") else 0
    predicted_classes: list[str] = []
    if has_table(conn, "tree_species_class_predictions"):
        predicted_classes = [
            row[0]
            for row in conn.execute(
                "SELECT DISTINCT predicted_species_class FROM tree_species_class_predictions ORDER BY 1"
            )
        ]
    metrics["unknown_taxon_records"] = unknown_species
    metrics["predicted_taxa"] = predicted_classes
    only_functional = bool(predicted_classes) and set(predicted_classes).issubset(FUNCTIONAL_CLASSES)
    findings.append(
        Finding(
            "species_identification",
            "FAIL" if only_functional or unknown_species else "PASS",
            "critical",
            f"{unknown_species:,}/{total:,} records lack a Latin taxon; model outputs are {predicted_classes}, which are functional classes, not species.",
            "Rename the current output to growth_form, add an abstaining taxonomic model, and validate species/genus predictions on spatially held-out field labels.",
        )
    )

    unvalidated_persistent = 0
    outside_historic_coverage = 0
    duplicate_links = 0
    trajectory_v3_applied = False
    if has_table(conn, "tree_trajectory_pilot"):
        unvalidated_persistent = int(
            scalar(
                conn,
                """
                SELECT COUNT(*) FROM tree_trajectory_pilot
                WHERE present_2024=1 AND present_2013=0 AND present_2016=0 AND fate='persistent'
                """,
            )
            or 0
        )
        outside_historic_coverage = int(
            scalar(
                conn,
                "SELECT COUNT(*) FROM tree_trajectory_pilot WHERE fate='outside_historic_coverage'",
            )
            or 0
        )
        linked = int(
            scalar(
                conn,
                "SELECT COUNT(*) FROM tree_trajectory_pilot WHERE canonical_tree_id IS NOT NULL",
            )
            or 0
        )
        distinct_linked = int(
            scalar(
                conn,
                "SELECT COUNT(DISTINCT canonical_tree_id) FROM tree_trajectory_pilot WHERE canonical_tree_id IS NOT NULL",
            )
            or 0
        )
        duplicate_links = linked - distinct_linked
        if has_table(conn, "current_database_remediation_runs"):
            trajectory_v3_applied = bool(
                scalar(
                    conn,
                    """SELECT 1 FROM current_database_remediation_runs
                       WHERE status='applied' AND command_version='current_db_remediation_v3'
                       ORDER BY completed_at_utc DESC LIMIT 1""",
                )
            )
        metrics["trajectory_linked_rows"] = linked
        metrics["trajectory_distinct_canonical_trees"] = distinct_linked
    metrics["trajectory_current_only_labelled_persistent"] = unvalidated_persistent
    metrics["trajectory_outside_historic_coverage"] = outside_historic_coverage
    metrics["trajectory_duplicate_canonical_links"] = duplicate_links
    metrics["trajectory_coverage_value_remediation_v3_applied"] = trajectory_v3_applied
    findings.append(
        Finding(
            "historic_coverage_aware_tracking",
            "PASS" if trajectory_v3_applied and duplicate_links == 0 else "FAIL",
            "critical",
            f"Coverage/value-aware v3 applied={trajectory_v3_applied}; "
            f"{outside_historic_coverage:,} rows are outside historic coverage; "
            f"{unvalidated_persistent:,} covered current-only rows retain persistent only where "
            f"historic CHM samples contain canopy; duplicate canonical links={duplicate_links:,}.",
            "Classify covered current-only rows from historic CHM content, rebuild with component-optimal assignment, then validate removals and establishments against independent imagery.",
        )
    )

    species_manifest_summary = ROOT / "outputs" / "hpc" / "species_training_manifest.summary.json"
    species_manifest_metrics: dict[str, Any] = {}
    if species_manifest_summary.exists():
        try:
            species_manifest_metrics = json.loads(species_manifest_summary.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            species_manifest_metrics = {}
    weak_label_ready = (
        species_manifest_metrics.get("species_model_eligible", 0) > 0
        and species_manifest_metrics.get("validation_status")
        == "weak_label_only_not_release_validation"
    )
    metrics["species_training_manifest"] = species_manifest_metrics
    findings.append(
        Finding(
            "species_weak_label_preparation",
            "PASS" if weak_label_ready else "FAIL",
            "major",
            f"Buffered weak-label manifest contains {species_manifest_metrics.get('species_model_eligible', 0):,} "
            "species-eligible records and is explicitly excluded from release validation."
            if weak_label_ready
            else "No valid weak-label species training manifest is present.",
            "Use it for pretraining/benchmarking only; independent field/crown labels remain required for accepted metrics.",
        )
    )

    hpc_path = latest_hpc_manifest()
    hpc_payload: dict[str, Any] = {}
    if hpc_path:
        try:
            hpc_payload = json.loads(hpc_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            hpc_payload = {}
    hpc_readiness = hpc_payload.get("readiness", {})
    metrics["hpc_input_manifest"] = {
        "path": str(hpc_path) if hpc_path else None,
        "status": hpc_readiness.get("status"),
        "blockers": hpc_readiness.get("blockers", []),
    }
    findings.append(
        Finding(
            "reproducible_hpc_input_freeze",
            "PASS" if hpc_readiness.get("status") == "ready_to_stage" else "FAIL",
            "major",
            json.dumps(metrics["hpc_input_manifest"], sort_keys=True),
            "Create a clean-commit, full-content-hashed manifest with every point-cloud header read and versioned model artifacts.",
        )
    )

    artifacts = {
        "crown_segmentation": ROOT / "docs" / "validation" / "crown_segmentation_metrics.json",
        "species_taxonomy": ROOT / "docs" / "validation" / "species_model_metrics.json",
        "tree_change": ROOT / "docs" / "validation" / "change_detection_metrics.json",
        "ecosystem_services": ROOT / "docs" / "validation" / "ecosystem_service_validation.json",
    }
    artifact_state = {name: validation_artifact_ready(path) for name, path in artifacts.items()}
    metrics["validation_artifacts"] = artifact_state
    for name, ready in artifact_state.items():
        findings.append(
            Finding(
                f"validated_{name}",
                "PASS" if ready else "FAIL",
                "critical",
                f"{artifacts[name].relative_to(ROOT)} is accepted." if ready else f"No accepted validation artifact at {artifacts[name].relative_to(ROOT)}.",
                "Create the artifact from independent reference data with sampling design, metrics, uncertainty, and acceptance threshold.",
            )
        )

    model_roots = [ROOT / "models", ROOT / "outputs" / "models", ROOT / "data" / "processed" / "models"]
    model_artifacts = [
        p for model_root in model_roots if model_root.exists()
        for pattern in ("*.pt", "*.pth", "*.ckpt", "*.onnx")
        for p in model_root.rglob(pattern)
    ]
    metrics["versioned_model_artifacts"] = [str(path.relative_to(ROOT)) for path in model_artifacts]
    findings.append(
        Finding(
            "reproducible_model_artifact",
            "PASS" if model_artifacts else "FAIL",
            "major",
            "Versioned model artifact(s): " + ", ".join(metrics["versioned_model_artifacts"])
            if model_artifacts
            else "No trained model weights/checkpoint is present in the repository root.",
            "Store weights in a versioned artifact registry and record code commit, data manifest, split, seed, environment, and calibration metadata.",
        )
    )

    db_totals: dict[str, int] = {}
    if total:
        db_totals["trees"] = total
    if counts.get("tree_crown_pilot") is not None:
        db_totals["crowns"] = int(counts["tree_crown_pilot"] or 0)
    if has_table(conn, "tree_valuation_pilot"):
        db_totals["totalValueNzdY"] = int(
            scalar(conn, "SELECT ROUND(COALESCE(SUM(total_value_nzd_y),0)) FROM tree_valuation_pilot WHERE valuation_confidence != 'modelled_nominal'") or 0
        )
        db_totals["runoffM3Y"] = int(
            scalar(conn, "SELECT ROUND(COALESCE(SUM(avoided_runoff_m3_y),0)) FROM tree_valuation_pilot WHERE valuation_confidence != 'modelled_nominal'") or 0
        )
        db_totals["carbonTco2e"] = int(
            scalar(conn, "SELECT ROUND(COALESCE(SUM(stored_co2e_tonnes_est),0)) FROM tree_valuation_pilot WHERE valuation_confidence != 'modelled_nominal'") or 0
        )
    web_totals = parse_web_totals(html_path.read_text(encoding="utf-8")) if html_path.exists() else {}
    mismatches = {
        key: {"database": value, "web": web_totals.get(key)}
        for key, value in db_totals.items()
        if web_totals.get(key) != value
    }
    metrics["database_totals"] = db_totals
    metrics["web_totals"] = web_totals
    metrics["web_total_mismatches"] = mismatches
    findings.append(
        Finding(
            "web_database_consistency",
            "PASS" if not mismatches else "FAIL",
            "major",
            "Web totals match the database." if not mismatches else json.dumps(mismatches, sort_keys=True),
            "Run scripts/refresh_web_totals.py after every database-changing stage and before deployment.",
        )
    )

    config = json.loads((ROOT / "config" / "pilots.json").read_text(encoding="utf-8"))
    default_pilot = config.get("default")
    makefile_text = (ROOT / "Makefile").read_text(encoding="utf-8")
    explicit_pilot_guard = "guard-pilot:" in makefile_text and "AKL_TREES_PILOT" in makefile_text
    metrics["configured_default_pilot"] = default_pilot
    metrics["explicit_pilot_guard"] = explicit_pilot_guard
    findings.append(
        Finding(
            "single_database_pilot_safety",
            "PASS" if explicit_pilot_guard else "FAIL",
            "major",
            f"The single working database has {total:,} trees; config defaults to {default_pilot!r}; explicit Make guard={explicit_pilot_guard}.",
            "Write each pilot/run to an isolated output database or require an explicit pilot and run ID before destructive stages.",
        )
    )

    stray_tags: list[str] = []
    for path in (ROOT / "docs").rglob("*.md"):
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"</?(?:content|invoke)>", text):
            stray_tags.append(str(path.relative_to(ROOT)))
    metrics["documents_with_stray_tool_tags"] = stray_tags
    findings.append(
        Finding(
            "documentation_integrity",
            "PASS" if not stray_tags else "FAIL",
            "minor",
            "No tool markup is embedded in documentation." if not stray_tags else ", ".join(stray_tags),
            "Remove tool-protocol fragments and regenerate stale reports from the current run.",
        )
    )

    conn.close()
    return metrics, findings


def write_reports(metrics: dict[str, Any], findings: list[Finding], json_out: Path, md_out: Path) -> dict[str, Any]:
    failures = [finding for finding in findings if finding.status == "FAIL"]
    critical = [finding for finding in failures if finding.severity == "critical"]
    verdict = "NOT_READY" if critical else ("CONDITIONAL" if failures else "READY")
    payload = {
        "generated_at_utc": utc_now(),
        "verdict": verdict,
        "failure_count": len(failures),
        "critical_failure_count": len(critical),
        "metrics": metrics,
        "findings": [asdict(finding) for finding in findings],
    }
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    lines = [
        "# Release and HPC hand-off readiness",
        "",
        f"Generated: {payload['generated_at_utc']}",
        "",
        f"**Verdict: {verdict}.** {len(critical)} critical and {len(failures) - len(critical)} non-critical failed gates.",
        "",
        "This is an evidence gate, not a claim that every row must have every attribute. A gate passes only when the required product and independent validation evidence both exist.",
        "",
        "| Gate | Status | Severity | Evidence | Required action |",
        "| --- | --- | --- | --- | --- |",
    ]
    for finding in findings:
        evidence = finding.evidence.replace("|", "\\|").replace("\n", " ")
        action = finding.required_action.replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| `{finding.gate}` | **{finding.status}** | {finding.severity} | {evidence} | {action} |"
        )
    lines.extend(
        [
            "",
            "## Machine-readable metrics",
            "",
            "```json",
            json.dumps(metrics, indent=2, sort_keys=True),
            "```",
            "",
        ]
    )
    md_out.parent.mkdir(parents=True, exist_ok=True)
    md_out.write_text("\n".join(lines), encoding="utf-8")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--html", type=Path, default=DEFAULT_HTML)
    parser.add_argument("--json-out", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--markdown-out", type=Path, default=DEFAULT_MD)
    parser.add_argument("--strict", action="store_true", help="exit non-zero when any gate fails")
    args = parser.parse_args()

    metrics, findings = audit(args.db, args.html)
    payload = write_reports(metrics, findings, args.json_out, args.markdown_out)
    print(
        f"{payload['verdict']}: {payload['critical_failure_count']} critical / "
        f"{payload['failure_count']} total failed gates -> {args.markdown_out}"
    )
    if args.strict and payload["failure_count"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
