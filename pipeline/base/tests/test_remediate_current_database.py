from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import remediate_current_database as remediation  # noqa: E402
import build_tree_trajectories as trajectory_builder  # noqa: E402


VALUATION_COLUMNS = [
    "tree_id TEXT PRIMARY KEY",
    "total_value_nzd_y REAL",
    "valuation_confidence TEXT",
    "method_id TEXT",
]


def write_raster(path: Path, values: np.ndarray) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=values.shape[0],
        width=values.shape[1],
        count=1,
        dtype="float32",
        crs="EPSG:2193",
        transform=from_origin(0.0, 3.0, 1.0, 1.0),
        nodata=-9999.0,
    ) as dst:
        dst.write(values.astype("float32"), 1)


def build_database(
    path: Path,
    *,
    block_trajectory_updates: bool = False,
    block_canonical_updates: bool = False,
) -> None:
    conn = sqlite3.connect(path)
    conn.execute(f"CREATE TABLE tree_valuation_pilot ({', '.join(VALUATION_COLUMNS)})")
    conn.executemany(
        "INSERT INTO tree_valuation_pilot VALUES (?, ?, ?, ?)",
        [
            ("tree_nominal", 75.0, "modelled_nominal", "nominal_method"),
            ("tree_primary", 125.0, "modelled_medium", "primary_method"),
        ],
    )
    conn.execute(
        """
        CREATE TABLE tree_trajectory_pilot (
            trajectory_id TEXT PRIMARY KEY,
            canonical_tree_id TEXT,
            x_2193 REAL,
            y_2193 REAL,
            present_2013 INTEGER,
            present_2016 INTEGER,
            present_2024 INTEGER,
            fate TEXT
        )
        """
    )
    conn.executemany(
        "INSERT INTO tree_trajectory_pilot VALUES (?, NULL, ?, ?, ?, ?, ?, ?)",
        [
            # Pixel (row=0,col=0) is nodata in both rasters: outside coverage.
            ("no_history", 0.5, 2.5, 0, 0, 1, "persistent"),
            # Covered ground in 2013, nodata in 2016: established since 2013.
            ("has_2013", 1.5, 2.5, 0, 0, 1, "persistent"),
            # Nodata in 2013, covered ground in 2016: established since 2016.
            ("has_2016", 2.5, 2.5, 0, 0, 1, "persistent"),
            # Historic presence means this is not current-only: never relabel.
            ("historic_apex", 0.5, 2.5, 1, 0, 1, "persistent"),
            # Missing coordinates cannot prove absent coverage: never relabel.
            ("missing_coordinates", None, None, 0, 0, 1, "persistent"),
            # A legacy established label is also invalid when both rasters lack coverage.
            ("established_without_coverage", 0.5, 2.5, 0, 0, 1, "established_since_2013"),
            # Already remediated rows are excluded, making reruns idempotent.
            (
                "already_remediated",
                0.5,
                2.5,
                0,
                0,
                1,
                remediation.NEW_FATE,
            ),
            # Canopy in both historical epochs: persistent is already correct.
            ("prior_canopy", 0.5, 1.5, 0, 0, 1, "persistent"),
            # Covered, but in the ambiguous 3m-to-<5m band in both epochs.
            ("ambiguous", 1.5, 1.5, 0, 0, 1, "persistent"),
            # 2013 ground plus 2016 canopy is persistent under builder precedence.
            ("canopy_2016", 2.5, 1.5, 0, 0, 1, "persistent"),
            # 2013 canopy plus 2016 ground follows the 2016 establishment rule.
            ("regrowth_established_2016", 0.5, 0.5, 0, 0, 1, "persistent"),
            # A correct legacy establishment label must be preserved.
            ("already_established_2013", 1.5, 2.5, 0, 0, 1, "established_since_2013"),
        ],
    )
    conn.executemany(
        "INSERT INTO tree_trajectory_pilot VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            # present_2024 wins before distance; among current rows, nearest wins.
            ("dup_present_far", "canonical_present", 2.5, 0.5, 0, 0, 1, "duplicate_test"),
            ("dup_old_exact", "canonical_present", 0.5, 0.5, 1, 1, 0, "duplicate_test"),
            ("dup_present_near", "canonical_present", 1.5, 0.5, 0, 0, 1, "duplicate_test"),
            # With no LiDAR point, trajectory_id is the deterministic tie-break.
            ("a_no_lidar", "canonical_no_lidar", 0.5, 1.5, 0, 0, 1, "duplicate_test"),
            ("b_no_lidar", "canonical_no_lidar", 2.5, 1.5, 0, 0, 1, "duplicate_test"),
            ("single_link", "canonical_single", 1.5, 1.5, 0, 0, 1, "duplicate_test"),
        ],
    )
    conn.execute(
        "CREATE TABLE tree_lidar_pilot (tree_id TEXT PRIMARY KEY, x_2193 REAL, y_2193 REAL)"
    )
    conn.executemany(
        "INSERT INTO tree_lidar_pilot VALUES (?, ?, ?)",
        [
            ("canonical_present", 0.5, 0.5),
            ("canonical_single", 1.5, 1.5),
        ],
    )
    conn.execute("CREATE TABLE run_metadata (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO run_metadata VALUES ('canonical_total', '2')")
    # Representative source table: remediation must never touch it.
    conn.execute("CREATE TABLE trees (tree_id TEXT PRIMARY KEY, source_value TEXT)")
    conn.execute("INSERT INTO trees VALUES ('source_tree', 'unchanged')")
    if block_trajectory_updates:
        conn.execute(
            """
            CREATE TRIGGER block_fate_update
            BEFORE UPDATE OF fate ON tree_trajectory_pilot
            BEGIN
                SELECT RAISE(ABORT, 'trajectory update blocked for rollback test');
            END
            """
        )
    if block_canonical_updates:
        conn.execute(
            """
            CREATE TRIGGER block_canonical_update
            BEFORE UPDATE OF canonical_tree_id ON tree_trajectory_pilot
            BEGIN
                SELECT RAISE(ABORT, 'canonical update blocked for rollback test');
            END
            """
        )
    conn.commit()
    conn.close()


@pytest.fixture
def workspace(tmp_path: Path) -> tuple[Path, Path, Path]:
    db = tmp_path / "trees.sqlite"
    chm13 = tmp_path / "chm_2013.tif"
    chm16 = tmp_path / "chm_2016.tif"
    build_database(db)
    write_raster(
        chm13,
        np.array(
            [
                [-9999.0, 0.0, -9999.0],
                [6.0, 4.0, 1.0],
                [6.0, 0.0, 0.0],
            ]
        ),
    )
    write_raster(
        chm16,
        np.array(
            [
                [-9999.0, -9999.0, 0.0],
                [6.0, 4.0, 6.0],
                [1.0, 0.0, 0.0],
            ]
        ),
    )
    return db, chm13, chm16


def config(
    paths: tuple[Path, Path, Path],
    *,
    apply: bool,
) -> remediation.RemediationConfig:
    db, chm13, chm16 = paths
    return remediation.RemediationConfig(
        db_path=db,
        historic_2013=chm13,
        historic_2016=chm16,
        apply=apply,
        batch_size=2,
    )


def snapshot(path: Path) -> tuple[list[tuple], list[tuple], tuple[list[tuple], list[tuple]], list[str]]:
    conn = sqlite3.connect(path)
    values = conn.execute("SELECT * FROM tree_valuation_pilot ORDER BY tree_id").fetchall()
    trajectories = conn.execute(
        "SELECT trajectory_id, fate, canonical_tree_id FROM tree_trajectory_pilot ORDER BY trajectory_id"
    ).fetchall()
    sources = (
        conn.execute("SELECT * FROM trees ORDER BY tree_id").fetchall(),
        conn.execute("SELECT * FROM tree_lidar_pilot ORDER BY tree_id").fetchall(),
    )
    tables = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
    ]
    conn.close()
    return values, trajectories, sources, tables


def test_dry_run_is_strictly_read_only(workspace: tuple[Path, Path, Path]) -> None:
    before = snapshot(workspace[0])
    summary = remediation.run_remediation(config(workspace, apply=False))
    after = snapshot(workspace[0])

    assert summary["mode"] == "dry-run"
    assert summary["nominal_rows_to_move"] == 1
    assert summary["trajectory_rows_to_relabel"] == 6
    assert summary["current_only_legacy_candidates"] == 10
    assert summary["already_correct_fate"] == 3
    assert summary["fate_changes"] == {
        "established_since_2013->outside_historic_coverage": 1,
        "persistent->established_since_2013": 1,
        "persistent->established_since_2016": 2,
        "persistent->indeterminate": 1,
        "persistent->outside_historic_coverage": 1,
    }
    assert summary["duplicate_canonical_tree_ids"] == 2
    assert summary["canonical_links_to_unlink"] == 3
    assert summary["missing_or_invalid_coordinates"] == 1
    assert before == after
    assert remediation.SCENARIO_TABLE not in after[3]
    assert remediation.RUN_AUDIT_TABLE not in after[3]


def test_apply_moves_nominal_rows_and_reclassifies_from_historic_values(
    workspace: tuple[Path, Path, Path],
) -> None:
    summary = remediation.run_remediation(config(workspace, apply=True))
    assert summary["nominal_rows_moved"] == 1
    assert summary["primary_rows_deleted"] == 1
    assert summary["trajectory_rows_relabelled"] == 6
    assert summary["duplicate_canonical_groups"] == 2
    assert summary["canonical_links_unlinked"] == 3

    conn = sqlite3.connect(workspace[0])
    primary = conn.execute(
        "SELECT tree_id, valuation_confidence FROM tree_valuation_pilot ORDER BY tree_id"
    ).fetchall()
    scenario = conn.execute(
        f"SELECT scenario_name, remediation_run_id, tree_id, total_value_nzd_y, "
        f"valuation_confidence, method_id FROM {remediation.SCENARIO_TABLE}"
    ).fetchone()
    fates = dict(conn.execute("SELECT trajectory_id, fate FROM tree_trajectory_pilot"))
    canonical_links = dict(
        conn.execute("SELECT trajectory_id, canonical_tree_id FROM tree_trajectory_pilot")
    )
    fate_audit = conn.execute(
        f"SELECT trajectory_id, old_fate, new_fate, sampled_chm_2013_m, "
        f"sampled_chm_2016_m, historic_coverage_2013, historic_coverage_2016, "
        f"classification_rule FROM {remediation.FATE_AUDIT_TABLE} "
        "ORDER BY trajectory_id"
    ).fetchall()
    run_audit = conn.execute(
        f"SELECT status, nominal_rows_moved, trajectory_rows_relabelled, "
        f"duplicate_canonical_groups, canonical_links_unlinked, details_json "
        f"FROM {remediation.RUN_AUDIT_TABLE}"
    ).fetchone()
    canonical_audit = conn.execute(
        f"SELECT canonical_tree_id, retained_trajectory_id, unlinked_trajectory_id "
        f"FROM {remediation.CANONICAL_LINK_AUDIT_TABLE} "
        "ORDER BY canonical_tree_id, unlinked_trajectory_id"
    ).fetchall()
    metadata = dict(conn.execute("SELECT key, value FROM run_metadata"))
    source_rows = (
        conn.execute("SELECT * FROM trees").fetchall(),
        conn.execute("SELECT * FROM tree_lidar_pilot ORDER BY tree_id").fetchall(),
    )
    conn.close()

    assert primary == [("tree_primary", "modelled_medium")]
    assert scenario[0] == remediation.SCENARIO_NAME
    assert scenario[1] == summary["run_id"]
    assert scenario[2:] == ("tree_nominal", 75.0, "modelled_nominal", "nominal_method")
    assert fates["no_history"] == remediation.NEW_FATE
    assert fates["established_without_coverage"] == remediation.NEW_FATE
    assert fates["has_2013"] == "established_since_2013"
    assert fates["has_2016"] == "established_since_2016"
    assert fates["ambiguous"] == "indeterminate"
    assert fates["regrowth_established_2016"] == "established_since_2016"
    assert fates["prior_canopy"] == "persistent"
    assert fates["canopy_2016"] == "persistent"
    assert fates["already_established_2013"] == "established_since_2013"
    assert fates["historic_apex"] == "persistent"
    assert fates["missing_coordinates"] == "persistent"
    assert fates["already_remediated"] == remediation.NEW_FATE
    assert [(row[0], row[1], row[2]) for row in fate_audit] == [
        ("ambiguous", "persistent", "indeterminate"),
        ("established_without_coverage", "established_since_2013", remediation.NEW_FATE),
        ("has_2013", "persistent", "established_since_2013"),
        ("has_2016", "persistent", "established_since_2016"),
        ("no_history", "persistent", remediation.NEW_FATE),
        ("regrowth_established_2016", "persistent", "established_since_2016"),
    ]
    evidence = {row[0]: row[3:] for row in fate_audit}
    assert evidence["ambiguous"][:4] == (4.0, 4.0, 1, 1)
    assert evidence["has_2013"][:4] == (0.0, None, 1, 0)
    assert evidence["has_2016"][:4] == (None, 0.0, 0, 1)
    assert evidence["regrowth_established_2016"][:4] == (6.0, 1.0, 1, 1)
    assert all(
        row[-1].startswith(remediation.FATE_CLASSIFICATION_RULE + ":") for row in fate_audit
    )
    assert canonical_links["dup_present_near"] == "canonical_present"
    assert canonical_links["dup_present_far"] is None
    assert canonical_links["dup_old_exact"] is None
    assert canonical_links["a_no_lidar"] == "canonical_no_lidar"
    assert canonical_links["b_no_lidar"] is None
    assert canonical_links["single_link"] == "canonical_single"
    assert canonical_audit == [
        ("canonical_no_lidar", "a_no_lidar", "b_no_lidar"),
        ("canonical_present", "dup_present_near", "dup_old_exact"),
        ("canonical_present", "dup_present_near", "dup_present_far"),
    ]
    assert run_audit[:5] == ("applied", 1, 6, 2, 3)
    details = json.loads(run_audit[5])
    assert details["source_tables_modified"] == []
    assert details["fate_classification_rule"] == remediation.FATE_CLASSIFICATION_RULE
    assert json.loads(metadata["current_database_remediation_last_run"])["run_id"] == summary["run_id"]
    assert metadata["current_database_remediation_version"] == remediation.VERSION
    assert source_rows == (
        [("source_tree", "unchanged")],
        [("canonical_present", 0.5, 0.5), ("canonical_single", 1.5, 1.5)],
    )


def test_apply_is_idempotent(workspace: tuple[Path, Path, Path]) -> None:
    remediation.run_remediation(config(workspace, apply=True))
    second = remediation.run_remediation(config(workspace, apply=True))

    conn = sqlite3.connect(workspace[0])
    scenario_rows = conn.execute(
        f"SELECT COUNT(*) FROM {remediation.SCENARIO_TABLE}"
    ).fetchone()[0]
    audit_runs = conn.execute(
        f"SELECT COUNT(*) FROM {remediation.RUN_AUDIT_TABLE}"
    ).fetchone()[0]
    conn.close()

    assert second["nominal_rows_moved"] == 0
    assert second["trajectory_rows_relabelled"] == 0
    assert second["duplicate_canonical_groups"] == 0
    assert second["canonical_links_unlinked"] == 0
    assert scenario_rows == 1
    assert audit_runs == 2


@pytest.mark.parametrize(
    ("value_2013", "value_2016", "expected"),
    [
        (None, None, "outside_historic_coverage"),
        (0.0, None, "established_since_2013"),
        (None, 0.0, "established_since_2016"),
        (0.0, 6.0, "persistent"),
        (6.0, 0.0, "established_since_2016"),
        (6.0, None, "persistent"),
        (None, 6.0, "persistent"),
        (3.0, 4.999, "indeterminate"),
        (5.0, 3.0, "persistent"),
    ],
)
def test_current_only_fate_matches_trajectory_builder_precedence(
    value_2013: float | None,
    value_2016: float | None,
    expected: str,
) -> None:
    fate, detail = remediation.classify_current_only_fate(value_2013, value_2016)
    builder_fate, _ = trajectory_builder.classify_fates(
        {
            2013: np.array([False]),
            2016: np.array([False]),
            2024: np.array([True]),
        },
        {
            2013: np.array([np.nan if value_2013 is None else value_2013]),
            2016: np.array([np.nan if value_2016 is None else value_2016]),
            2024: np.array([10.0]),
        },
        np.array([0.1]),
    )
    assert fate == expected
    assert fate == builder_fate[0]
    assert detail


def test_v2_fate_audit_schema_is_forward_migrated(
    workspace: tuple[Path, Path, Path],
) -> None:
    conn = sqlite3.connect(workspace[0])
    conn.executescript(
        f"""
        CREATE TABLE {remediation.RUN_AUDIT_TABLE} (
            run_id TEXT PRIMARY KEY,
            command_version TEXT NOT NULL,
            started_at_utc TEXT NOT NULL,
            completed_at_utc TEXT NOT NULL,
            status TEXT NOT NULL,
            nominal_rows_found INTEGER NOT NULL,
            nominal_rows_moved INTEGER NOT NULL,
            primary_rows_deleted INTEGER NOT NULL,
            current_only_candidates INTEGER NOT NULL,
            trajectory_rows_relabelled INTEGER NOT NULL,
            duplicate_canonical_groups INTEGER NOT NULL DEFAULT 0,
            canonical_links_unlinked INTEGER NOT NULL DEFAULT 0,
            details_json TEXT NOT NULL
        );
        CREATE TABLE {remediation.FATE_AUDIT_TABLE} (
            run_id TEXT NOT NULL,
            trajectory_id TEXT NOT NULL,
            old_fate TEXT,
            new_fate TEXT NOT NULL,
            reason TEXT NOT NULL,
            changed_at_utc TEXT NOT NULL,
            PRIMARY KEY (run_id, trajectory_id),
            FOREIGN KEY (run_id) REFERENCES {remediation.RUN_AUDIT_TABLE}(run_id)
                DEFERRABLE INITIALLY DEFERRED
        );
        """
    )
    conn.execute(
        f"INSERT INTO {remediation.RUN_AUDIT_TABLE} VALUES "
        "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "legacy_v2",
            "current_db_remediation_v2",
            "2026-07-12T00:00:00+00:00",
            "2026-07-12T00:01:00+00:00",
            "applied",
            1,
            1,
            1,
            2,
            2,
            0,
            0,
            "{}",
        ),
    )
    conn.execute(
        f"INSERT INTO {remediation.FATE_AUDIT_TABLE} VALUES (?, ?, ?, ?, ?, ?)",
        (
            "legacy_v2",
            "legacy_trajectory",
            "persistent",
            "outside_historic_coverage",
            "legacy coverage-only reason",
            "2026-07-12T00:00:30+00:00",
        ),
    )
    conn.commit()
    conn.close()

    summary = remediation.run_remediation(config(workspace, apply=True))
    assert summary["trajectory_rows_relabelled"] == 6

    conn = sqlite3.connect(workspace[0])
    columns = {
        row[1] for row in conn.execute(f"PRAGMA table_info({remediation.FATE_AUDIT_TABLE})")
    }
    legacy = conn.execute(
        f"SELECT sample_x_2193, sample_y_2193, sampled_chm_2013_m, "
        f"sampled_chm_2016_m, historic_coverage_2013, historic_coverage_2016, "
        f"classification_rule FROM {remediation.FATE_AUDIT_TABLE} "
        "WHERE run_id = 'legacy_v2'"
    ).fetchone()
    v3_rows = conn.execute(
        f"SELECT COUNT(*), COUNT(classification_rule), COUNT(sample_x_2193) "
        f"FROM {remediation.FATE_AUDIT_TABLE} WHERE run_id = ?",
        (summary["run_id"],),
    ).fetchone()
    versions = conn.execute(
        f"SELECT command_version FROM {remediation.RUN_AUDIT_TABLE} ORDER BY started_at_utc"
    ).fetchall()
    conn.close()

    assert {
        "sample_x_2193",
        "sample_y_2193",
        "sampled_chm_2013_m",
        "sampled_chm_2016_m",
        "historic_coverage_2013",
        "historic_coverage_2016",
        "classification_rule",
    } <= columns
    assert legacy == (None, None, None, None, None, None, None)
    assert v3_rows == (6, 6, 6)
    assert versions == [("current_db_remediation_v2",), (remediation.VERSION,)]


def test_apply_rolls_back_every_persistent_change_when_update_fails(tmp_path: Path) -> None:
    db = tmp_path / "blocked.sqlite"
    chm13 = tmp_path / "chm_2013.tif"
    chm16 = tmp_path / "chm_2016.tif"
    build_database(db, block_trajectory_updates=True)
    values = np.full((3, 3), -9999.0, dtype="float32")
    write_raster(chm13, values)
    write_raster(chm16, values)
    paths = (db, chm13, chm16)
    before = snapshot(db)

    with pytest.raises(sqlite3.IntegrityError, match="trajectory update blocked"):
        remediation.run_remediation(config(paths, apply=True))

    after = snapshot(db)
    assert before == after
    assert remediation.SCENARIO_TABLE not in after[3]
    assert remediation.RUN_AUDIT_TABLE not in after[3]


def test_apply_rolls_back_fate_and_valuation_when_canonical_unlink_fails(
    tmp_path: Path,
) -> None:
    db = tmp_path / "blocked_canonical.sqlite"
    chm13 = tmp_path / "chm_2013.tif"
    chm16 = tmp_path / "chm_2016.tif"
    build_database(db, block_canonical_updates=True)
    values = np.full((3, 3), -9999.0, dtype="float32")
    write_raster(chm13, values)
    write_raster(chm16, values)
    paths = (db, chm13, chm16)
    before = snapshot(db)

    with pytest.raises(sqlite3.IntegrityError, match="canonical update blocked"):
        remediation.run_remediation(config(paths, apply=True))

    after = snapshot(db)
    assert before == after
    assert remediation.SCENARIO_TABLE not in after[3]
    assert remediation.RUN_AUDIT_TABLE not in after[3]


def test_schema_mismatch_fails_before_any_write(workspace: tuple[Path, Path, Path]) -> None:
    conn = sqlite3.connect(workspace[0])
    conn.execute("ALTER TABLE tree_trajectory_pilot RENAME TO legacy_trajectory")
    conn.commit()
    before = list(conn.iterdump())
    conn.close()

    with pytest.raises(remediation.RemediationError, match="required table is missing"):
        remediation.run_remediation(config(workspace, apply=True))

    conn = sqlite3.connect(workspace[0])
    after = list(conn.iterdump())
    conn.close()
    assert after == before
