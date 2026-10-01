#!/usr/bin/env python3
"""Safely remediate legacy valuation and trajectory rows in the current database.

This is deliberately a one-purpose migration command, not a pipeline rebuild. It:

1. copies legacy ``modelled_nominal`` valuation rows into
   ``tree_valuation_scenarios`` and removes them from the primary valuation table;
2. reclassifies current-only trajectories from the actual 2013/2016 CHM cells,
   distinguishing prior canopy, established trees, ambiguous heights, and areas
   outside historical coverage;
3. repairs duplicate ``canonical_tree_id`` links by retaining one deterministic
   best trajectory and setting secondary links to NULL (trajectories are retained);
4. records the applied run, every fate change, and every canonical unlink for
   audit/rollback.

Dry-run is the default. The database is opened read-only unless ``--apply`` is
provided. Applied changes use one ``BEGIN IMMEDIATE`` transaction. The command
does not write ``trees``, crown, LiDAR, point-cloud, context, species, or raw source
tables/files.

Examples::

    python scripts/remediate_current_database.py
    python scripts/remediate_current_database.py --apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import numpy as np
import rasterio
from rasterio.windows import Window


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
DEFAULT_HISTORIC_ROOT = ROOT / "data" / "interim" / "historic_chm_auckland_metro_v1"
DEFAULT_CHM_2013 = DEFAULT_HISTORIC_ROOT / "chm_2013.tif"
DEFAULT_CHM_2016 = DEFAULT_HISTORIC_ROOT / "chm_2016.tif"

VERSION = "current_db_remediation_v3"
LEGACY_CONFIDENCE = "modelled_nominal"
SCENARIO_NAME = "legacy_modelled_nominal_v1"
NEW_FATE = "outside_historic_coverage"
LEGACY_CURRENT_ONLY_FATES = (
    "persistent",
    "established_since_2013",
    "established_since_2016",
    "indeterminate",
)
CANOPY_MIN_HEIGHT_M = 5.0
GROUND_MAX_HEIGHT_M = 3.0
FATE_CLASSIFICATION_RULE = "current_only_historic_chm_values_v1"

SCENARIO_TABLE = "tree_valuation_scenarios"
RUN_AUDIT_TABLE = "current_database_remediation_runs"
FATE_AUDIT_TABLE = "tree_trajectory_fate_audit"
CANONICAL_LINK_AUDIT_TABLE = "tree_trajectory_canonical_link_audit"
TEMP_RELABEL_TABLE = "_current_db_trajectory_relabels"
TEMP_UNLINK_TABLE = "_current_db_canonical_unlinks"


class RemediationError(RuntimeError):
    """Raised when a safety check prevents the remediation."""


@dataclass(frozen=True)
class RemediationConfig:
    db_path: Path = DEFAULT_DB
    historic_2013: Path = DEFAULT_CHM_2013
    historic_2016: Path = DEFAULT_CHM_2016
    apply: bool = False
    batch_size: int = 20_000


@dataclass(frozen=True)
class Column:
    name: str
    declared_type: str
    not_null: bool
    default_sql: str | None
    primary_key_order: int


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def quote_identifier(name: str) -> str:
    """Quote a SQLite identifier after rejecting embedded NUL characters."""
    if "\x00" in name:
        raise RemediationError("SQLite identifier contains NUL")
    return '"' + name.replace('"', '""') + '"'


def connect_database(path: Path, *, writable: bool) -> sqlite3.Connection:
    mode = "rw" if writable else "ro"
    uri = f"{path.resolve().as_uri()}?mode={mode}"
    conn = sqlite3.connect(uri, uri=True, timeout=60.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=60000")
    conn.execute("PRAGMA foreign_keys=ON")
    if not writable:
        # Defence in depth: even an accidental DDL/DML statement must fail.
        conn.execute("PRAGMA query_only=ON")
    return conn


def table_columns(conn: sqlite3.Connection, table: str) -> list[Column]:
    rows = conn.execute(f"PRAGMA table_info({quote_identifier(table)})").fetchall()
    return [
        Column(
            name=str(row[1]),
            declared_type=str(row[2] or ""),
            not_null=bool(row[3]),
            default_sql=row[4],
            primary_key_order=int(row[5]),
        )
        for row in rows
    ]


def require_columns(conn: sqlite3.Connection, table: str, required: Iterable[str]) -> list[Column]:
    columns = table_columns(conn, table)
    if not columns:
        raise RemediationError(f"required table is missing: {table}")
    available = {column.name for column in columns}
    missing = sorted(set(required) - available)
    if missing:
        raise RemediationError(f"{table} is missing required columns: {', '.join(missing)}")
    return columns


def inspect_schema(conn: sqlite3.Connection) -> list[Column]:
    valuation_columns = require_columns(
        conn,
        "tree_valuation_pilot",
        {"tree_id", "valuation_confidence"},
    )
    require_columns(
        conn,
        "tree_trajectory_pilot",
        {
            "trajectory_id",
            "canonical_tree_id",
            "x_2193",
            "y_2193",
            "present_2013",
            "present_2016",
            "present_2024",
            "fate",
        },
    )
    require_columns(conn, "tree_lidar_pilot", {"tree_id", "x_2193", "y_2193"})
    require_columns(conn, "run_metadata", {"key", "value"})
    return valuation_columns


def raster_fingerprint(path: Path, dataset: rasterio.io.DatasetReader) -> dict[str, Any]:
    stat = path.stat()
    return {
        "path": str(path.resolve()),
        "size_bytes": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "crs": str(dataset.crs),
        "bounds": [float(value) for value in dataset.bounds],
        "shape": [dataset.height, dataset.width],
        "nodata": dataset.nodata,
    }


def validate_historic_raster(path: Path, dataset: rasterio.io.DatasetReader) -> None:
    if dataset.count < 1:
        raise RemediationError(f"historic raster has no bands: {path}")
    epsg = dataset.crs.to_epsg() if dataset.crs is not None else None
    if epsg != 2193:
        raise RemediationError(
            f"historic raster must be EPSG:2193 because trajectories use x_2193/y_2193: "
            f"{path} has {dataset.crs}"
        )


def sample_chm_values(
    dataset: rasterio.io.DatasetReader,
    coordinates: Sequence[tuple[float, float]],
) -> tuple[list[bool], list[float | None]]:
    """Return coverage and actual CHM values, reading each raster block once.

    ``DatasetReader.sample`` performs a tiny read for every coordinate and is
    prohibitively slow for the current ~1.8 million current-only trajectories.
    Grouping coordinates by native GeoTIFF block preserves exact cell-level mask
    semantics while turning many point reads into one 256x256 block read.
    """
    if not coordinates:
        return [], []
    xy = np.asarray(coordinates, dtype="float64")
    rows, cols = rasterio.transform.rowcol(dataset.transform, xy[:, 0], xy[:, 1])
    rows = np.asarray(rows, dtype="int64")
    cols = np.asarray(cols, dtype="int64")
    in_bounds = (
        (rows >= 0)
        & (rows < dataset.height)
        & (cols >= 0)
        & (cols < dataset.width)
    )
    covered = np.zeros(len(coordinates), dtype=bool)
    values = np.full(len(coordinates), np.nan, dtype="float64")
    valid_indices = np.flatnonzero(in_bounds)
    if valid_indices.size == 0:
        return covered.tolist(), [None] * len(coordinates)

    block_h, block_w = dataset.block_shapes[0]
    blocks_across = math.ceil(dataset.width / block_w)
    block_keys = (
        (rows[valid_indices] // block_h) * blocks_across
        + (cols[valid_indices] // block_w)
    )
    order = np.argsort(block_keys, kind="stable")
    sorted_indices = valid_indices[order]
    sorted_keys = block_keys[order]
    split_at = np.flatnonzero(np.diff(sorted_keys)) + 1
    for indices in np.split(sorted_indices, split_at):
        first = int(indices[0])
        block_row = int(rows[first] // block_h)
        block_col = int(cols[first] // block_w)
        row_off = block_row * block_h
        col_off = block_col * block_w
        height = min(block_h, dataset.height - row_off)
        width = min(block_w, dataset.width - col_off)
        mask = dataset.read_masks(
            1,
            window=Window(col_off=col_off, row_off=row_off, width=width, height=height),
        )
        data = dataset.read(
            1,
            window=Window(col_off=col_off, row_off=row_off, width=width, height=height),
        )
        local_rows = rows[indices] - row_off
        local_cols = cols[indices] - col_off
        sampled = data[local_rows, local_cols].astype("float64")
        valid = (mask[local_rows, local_cols] != 0) & np.isfinite(sampled)
        covered[indices] = valid
        values[indices[valid]] = sampled[valid]
    return covered.tolist(), [float(value) if math.isfinite(value) else None for value in values]


def batched_rows(cursor: sqlite3.Cursor, size: int) -> Iterator[list[sqlite3.Row]]:
    while True:
        rows = cursor.fetchmany(size)
        if not rows:
            return
        yield rows


def prepare_temp_relabel_table(conn: sqlite3.Connection) -> None:
    conn.execute(f"DROP TABLE IF EXISTS temp.{quote_identifier(TEMP_RELABEL_TABLE)}")
    conn.execute(
        f"CREATE TEMP TABLE {quote_identifier(TEMP_RELABEL_TABLE)} ("
        "trajectory_id TEXT PRIMARY KEY, "
        "old_fate TEXT NOT NULL, "
        "new_fate TEXT NOT NULL, "
        "sample_x_2193 REAL NOT NULL, "
        "sample_y_2193 REAL NOT NULL, "
        "sampled_chm_2013_m REAL, "
        "sampled_chm_2016_m REAL, "
        "historic_coverage_2013 INTEGER NOT NULL, "
        "historic_coverage_2016 INTEGER NOT NULL, "
        "classification_rule TEXT NOT NULL)"
    )


def classify_current_only_fate(
    value_2013: float | None,
    value_2016: float | None,
) -> tuple[str, str]:
    """Mirror ``build_tree_trajectories.classify_fates`` for current-only rows.

    Precedence is exactly the builder's ``est13`` then ``est16`` then prior
    canopy rule. The order matters when one epoch is canopy and the other is
    covered ground.
    """
    covered13 = value_2013 is not None and math.isfinite(value_2013)
    covered16 = value_2016 is not None and math.isfinite(value_2016)
    if not (covered13 or covered16):
        return NEW_FATE, "neither historic CHM has a valid cell"

    canopy13 = covered13 and value_2013 >= CANOPY_MIN_HEIGHT_M
    canopy16 = covered16 and value_2016 >= CANOPY_MIN_HEIGHT_M
    ground13 = covered13 and value_2013 < GROUND_MAX_HEIGHT_M
    ground16 = covered16 and value_2016 < GROUND_MAX_HEIGHT_M

    established13 = ground13 and not canopy16
    established16 = ground16 and not established13
    persistent = (canopy13 or canopy16) and not established13 and not established16

    if established13:
        return (
            "established_since_2013",
            "2013 is covered ground <3m and 2016 is not canopy >=5m; 2013 rule has precedence",
        )
    if established16:
        return (
            "established_since_2016",
            "2016 is covered ground <3m after the 2013 establishment rule",
        )
    if persistent:
        return "persistent", "at least one historic CHM has prior canopy >=5m"
    return "indeterminate", "historic coverage exists but values are ambiguous (3m to <5m or mixed)"


def find_trajectory_relabels(
    conn: sqlite3.Connection,
    *,
    historic_2013: Path,
    historic_2016: Path,
    batch_size: int,
    collect_for_apply: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Classify current-only rows from actual historical CHM values.

    Stored apex heights are detections, not raster-coverage evidence. Both
    coverage and height are therefore sampled at ``x_2193/y_2193``. Rows with
    missing/non-finite coordinates are left untouched.
    """
    if batch_size <= 0:
        raise RemediationError("batch_size must be positive")
    if not historic_2013.exists() or not historic_2016.exists():
        missing = [str(path) for path in (historic_2013, historic_2016) if not path.exists()]
        raise RemediationError(f"historic CHM file(s) missing: {', '.join(missing)}")

    if collect_for_apply:
        prepare_temp_relabel_table(conn)

    placeholders = ",".join("?" for _ in LEGACY_CURRENT_ONLY_FATES)
    sql = f"""
        SELECT trajectory_id, x_2193, y_2193, fate
        FROM tree_trajectory_pilot
        WHERE COALESCE(present_2024, 0) = 1
          AND COALESCE(present_2013, 0) = 0
          AND COALESCE(present_2016, 0) = 0
          AND fate IN ({placeholders})
        ORDER BY trajectory_id
    """
    cursor = conn.execute(sql, LEGACY_CURRENT_ONLY_FATES)
    stats: Counter[str] = Counter()
    relabel_by_old_fate: Counter[str] = Counter()
    expected_fates: Counter[str] = Counter()
    fate_changes: Counter[str] = Counter()

    with rasterio.open(historic_2013) as src13, rasterio.open(historic_2016) as src16:
        validate_historic_raster(historic_2013, src13)
        validate_historic_raster(historic_2016, src16)
        raster_details = {
            "historic_2013": raster_fingerprint(historic_2013, src13),
            "historic_2016": raster_fingerprint(historic_2016, src16),
        }

        for rows in batched_rows(cursor, batch_size):
            stats["current_only_legacy_candidates"] += len(rows)
            valid_rows: list[sqlite3.Row] = []
            coordinates: list[tuple[float, float]] = []
            for row in rows:
                x, y = row["x_2193"], row["y_2193"]
                if x is None or y is None or not math.isfinite(float(x)) or not math.isfinite(float(y)):
                    stats["missing_or_invalid_coordinates"] += 1
                    continue
                valid_rows.append(row)
                coordinates.append((float(x), float(y)))

            if not coordinates:
                continue
            covered13, values13 = sample_chm_values(src13, coordinates)
            covered16, values16 = sample_chm_values(src16, coordinates)
            to_store: list[tuple[Any, ...]] = []
            for row, has13, value13, has16, value16 in zip(
                valid_rows, covered13, values13, covered16, values16
            ):
                stats["covered_2013"] += int(has13)
                stats["covered_2016"] += int(has16)
                stats["historic_coverage_present"] += int(has13 or has16)
                stats["no_historic_coverage"] += int(not (has13 or has16))
                new_fate, rule_detail = classify_current_only_fate(value13, value16)
                expected_fates[new_fate] += 1
                old_fate = str(row["fate"])
                if old_fate == new_fate:
                    stats["already_correct_fate"] += 1
                    continue
                relabel_by_old_fate[old_fate] += 1
                fate_changes[f"{old_fate}->{new_fate}"] += 1
                if collect_for_apply:
                    to_store.append(
                        (
                            str(row["trajectory_id"]),
                            old_fate,
                            new_fate,
                            float(row["x_2193"]),
                            float(row["y_2193"]),
                            value13,
                            value16,
                            int(has13),
                            int(has16),
                            f"{FATE_CLASSIFICATION_RULE}: {rule_detail}",
                        )
                    )
            if to_store:
                conn.executemany(
                    f"INSERT INTO {quote_identifier(TEMP_RELABEL_TABLE)} "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    to_store,
                )

    stats["trajectory_rows_to_relabel"] = sum(relabel_by_old_fate.values())
    stats["relabel_by_old_fate"] = dict(sorted(relabel_by_old_fate.items()))
    stats["expected_fate_counts"] = dict(sorted(expected_fates.items()))
    stats["fate_changes"] = dict(sorted(fate_changes.items()))
    if collect_for_apply:
        # End the TEMP-only transaction before BEGIN IMMEDIATE on main. TEMP data
        # remains available on this connection after commit.
        conn.commit()
    return dict(stats), raster_details


def prepare_temp_unlink_table(conn: sqlite3.Connection) -> None:
    conn.execute(f"DROP TABLE IF EXISTS temp.{quote_identifier(TEMP_UNLINK_TABLE)}")
    conn.execute(
        f"CREATE TEMP TABLE {quote_identifier(TEMP_UNLINK_TABLE)} ("
        "canonical_tree_id TEXT NOT NULL, "
        "retained_trajectory_id TEXT NOT NULL, "
        "unlinked_trajectory_id TEXT PRIMARY KEY, "
        "retained_present_2024 INTEGER NOT NULL, "
        "unlinked_present_2024 INTEGER NOT NULL, "
        "retained_distance_sq_m2 REAL, "
        "unlinked_distance_sq_m2 REAL)"
    )


def duplicate_canonical_plan_cursor(conn: sqlite3.Connection) -> sqlite3.Cursor:
    """Return deterministic loser/winner pairs for duplicate canonical links."""
    return conn.execute(
        """
        WITH candidates AS (
            SELECT
                tr.trajectory_id,
                tr.canonical_tree_id,
                COALESCE(tr.present_2024, 0) AS present_2024,
                CASE
                    WHEN tr.x_2193 IS NOT NULL AND tr.y_2193 IS NOT NULL
                     AND lidar.x_2193 IS NOT NULL AND lidar.y_2193 IS NOT NULL
                    THEN 0 ELSE 1
                END AS distance_unavailable,
                CASE
                    WHEN tr.x_2193 IS NOT NULL AND tr.y_2193 IS NOT NULL
                     AND lidar.x_2193 IS NOT NULL AND lidar.y_2193 IS NOT NULL
                    THEN (tr.x_2193 - lidar.x_2193) * (tr.x_2193 - lidar.x_2193)
                       + (tr.y_2193 - lidar.y_2193) * (tr.y_2193 - lidar.y_2193)
                    ELSE NULL
                END AS distance_sq_m2
            FROM tree_trajectory_pilot AS tr
            LEFT JOIN tree_lidar_pilot AS lidar
              ON lidar.tree_id = tr.canonical_tree_id
            WHERE tr.canonical_tree_id IS NOT NULL
        ),
        ranked AS (
            SELECT
                candidates.*,
                COUNT(*) OVER (PARTITION BY canonical_tree_id) AS group_size,
                ROW_NUMBER() OVER (
                    PARTITION BY canonical_tree_id
                    ORDER BY
                        CASE WHEN present_2024 = 1 THEN 0 ELSE 1 END,
                        distance_unavailable,
                        distance_sq_m2,
                        trajectory_id
                ) AS rank_in_group
            FROM candidates
        ),
        winners AS (
            SELECT * FROM ranked WHERE group_size > 1 AND rank_in_group = 1
        )
        SELECT
            loser.canonical_tree_id,
            winner.trajectory_id AS retained_trajectory_id,
            loser.trajectory_id AS unlinked_trajectory_id,
            winner.present_2024 AS retained_present_2024,
            loser.present_2024 AS unlinked_present_2024,
            winner.distance_sq_m2 AS retained_distance_sq_m2,
            loser.distance_sq_m2 AS unlinked_distance_sq_m2
        FROM ranked AS loser
        JOIN winners AS winner USING (canonical_tree_id)
        WHERE loser.group_size > 1 AND loser.rank_in_group > 1
        ORDER BY loser.canonical_tree_id, loser.trajectory_id
        """
    )


def find_duplicate_canonical_links(
    conn: sqlite3.Connection,
    *,
    batch_size: int,
    collect_for_apply: bool,
) -> dict[str, Any]:
    """Build and optionally retain the deterministic canonical-unlink plan."""
    if batch_size <= 0:
        raise RemediationError("batch_size must be positive")
    if collect_for_apply:
        prepare_temp_unlink_table(conn)

    digest = hashlib.sha256()
    duplicate_groups = 0
    links_to_unlink = 0
    retained_present_2024 = 0
    retained_without_distance = 0
    last_canonical: str | None = None
    cursor = duplicate_canonical_plan_cursor(conn)
    for rows in batched_rows(cursor, batch_size):
        to_store = []
        for row in rows:
            canonical = str(row["canonical_tree_id"])
            if canonical != last_canonical:
                duplicate_groups += 1
                retained_present_2024 += int(row["retained_present_2024"] == 1)
                retained_without_distance += int(row["retained_distance_sq_m2"] is None)
                last_canonical = canonical
            links_to_unlink += 1
            values = (
                canonical,
                str(row["retained_trajectory_id"]),
                str(row["unlinked_trajectory_id"]),
                int(row["retained_present_2024"]),
                int(row["unlinked_present_2024"]),
                row["retained_distance_sq_m2"],
                row["unlinked_distance_sq_m2"],
            )
            digest.update(
                (json.dumps(values, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
            )
            if collect_for_apply:
                to_store.append(values)
        if to_store:
            conn.executemany(
                f"INSERT INTO {quote_identifier(TEMP_UNLINK_TABLE)} VALUES (?, ?, ?, ?, ?, ?, ?)",
                to_store,
            )
    if collect_for_apply:
        conn.commit()
    return {
        "duplicate_canonical_tree_ids": duplicate_groups,
        "canonical_links_to_unlink": links_to_unlink,
        "retained_links_present_2024": retained_present_2024,
        "retained_links_without_lidar_distance": retained_without_distance,
        "canonical_link_plan_sha256": digest.hexdigest(),
    }


def create_scenario_table(conn: sqlite3.Connection, source_columns: Sequence[Column]) -> None:
    metadata_columns = {
        "scenario_row_id",
        "scenario_name",
        "remediation_run_id",
        "moved_at_utc",
    }
    source_names = {column.name for column in source_columns}
    conflict = sorted(metadata_columns & source_names)
    if conflict:
        raise RemediationError(
            "valuation source columns conflict with scenario metadata columns: " + ", ".join(conflict)
        )

    existing = table_columns(conn, SCENARIO_TABLE)
    if existing:
        expected = metadata_columns | source_names
        missing = expected - {column.name for column in existing}
        if missing:
            raise RemediationError(
                f"existing {SCENARIO_TABLE} has an incompatible schema; missing: "
                + ", ".join(sorted(missing))
            )
        return

    source_sql = []
    for column in source_columns:
        declared_type = column.declared_type or "BLOB"
        source_sql.append(f"{quote_identifier(column.name)} {declared_type}")
    conn.execute(
        f"CREATE TABLE {quote_identifier(SCENARIO_TABLE)} ("
        "scenario_row_id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "scenario_name TEXT NOT NULL, "
        "remediation_run_id TEXT NOT NULL, "
        "moved_at_utc TEXT NOT NULL, "
        + ", ".join(source_sql)
        + ")"
    )
    conn.execute(
        f"CREATE INDEX idx_valuation_scenario_name_tree "
        f"ON {quote_identifier(SCENARIO_TABLE)} (scenario_name, tree_id)"
    )


def create_audit_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {quote_identifier(RUN_AUDIT_TABLE)} (
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
        )
        """
    )
    # Forward-compatible if v1 was applied before this duplicate-link repair was
    # added. These ALTERs are inside the remediation transaction.
    run_columns = {column.name for column in table_columns(conn, RUN_AUDIT_TABLE)}
    if "duplicate_canonical_groups" not in run_columns:
        conn.execute(
            f"ALTER TABLE {quote_identifier(RUN_AUDIT_TABLE)} "
            "ADD COLUMN duplicate_canonical_groups INTEGER NOT NULL DEFAULT 0"
        )
    if "canonical_links_unlinked" not in run_columns:
        conn.execute(
            f"ALTER TABLE {quote_identifier(RUN_AUDIT_TABLE)} "
            "ADD COLUMN canonical_links_unlinked INTEGER NOT NULL DEFAULT 0"
        )
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {quote_identifier(FATE_AUDIT_TABLE)} (
            run_id TEXT NOT NULL,
            trajectory_id TEXT NOT NULL,
            old_fate TEXT,
            new_fate TEXT NOT NULL,
            reason TEXT NOT NULL,
            sample_x_2193 REAL,
            sample_y_2193 REAL,
            sampled_chm_2013_m REAL,
            sampled_chm_2016_m REAL,
            historic_coverage_2013 INTEGER,
            historic_coverage_2016 INTEGER,
            classification_rule TEXT,
            changed_at_utc TEXT NOT NULL,
            PRIMARY KEY (run_id, trajectory_id),
            FOREIGN KEY (run_id) REFERENCES {quote_identifier(RUN_AUDIT_TABLE)}(run_id)
                DEFERRABLE INITIALLY DEFERRED
        )
        """
    )
    # v2 recorded only old/new fate and a text reason. Preserve those rows and
    # add nullable evidence fields for v3's value-based classification audit.
    fate_columns = {column.name for column in table_columns(conn, FATE_AUDIT_TABLE)}
    for name, declared_type in (
        ("sample_x_2193", "REAL"),
        ("sample_y_2193", "REAL"),
        ("sampled_chm_2013_m", "REAL"),
        ("sampled_chm_2016_m", "REAL"),
        ("historic_coverage_2013", "INTEGER"),
        ("historic_coverage_2016", "INTEGER"),
        ("classification_rule", "TEXT"),
    ):
        if name not in fate_columns:
            conn.execute(
                f"ALTER TABLE {quote_identifier(FATE_AUDIT_TABLE)} "
                f"ADD COLUMN {quote_identifier(name)} {declared_type}"
            )
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {quote_identifier(CANONICAL_LINK_AUDIT_TABLE)} (
            run_id TEXT NOT NULL,
            canonical_tree_id TEXT NOT NULL,
            retained_trajectory_id TEXT NOT NULL,
            unlinked_trajectory_id TEXT NOT NULL,
            retained_present_2024 INTEGER NOT NULL,
            unlinked_present_2024 INTEGER NOT NULL,
            retained_distance_sq_m2 REAL,
            unlinked_distance_sq_m2 REAL,
            reason TEXT NOT NULL,
            changed_at_utc TEXT NOT NULL,
            PRIMARY KEY (run_id, unlinked_trajectory_id),
            FOREIGN KEY (run_id) REFERENCES {quote_identifier(RUN_AUDIT_TABLE)}(run_id)
                DEFERRABLE INITIALLY DEFERRED
        )
        """
    )
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_canonical_link_audit_tree "
        f"ON {quote_identifier(CANONICAL_LINK_AUDIT_TABLE)} "
        "(canonical_tree_id, retained_trajectory_id)"
    )


def count_nominal_rows(conn: sqlite3.Connection) -> int:
    return int(
        conn.execute(
            "SELECT COUNT(*) FROM tree_valuation_pilot WHERE valuation_confidence = ?",
            (LEGACY_CONFIDENCE,),
        ).fetchone()[0]
    )


def apply_remediation(
    conn: sqlite3.Connection,
    *,
    valuation_columns: Sequence[Column],
    nominal_rows_expected: int,
    trajectory_stats: dict[str, Any],
    duplicate_stats: dict[str, Any],
    raster_details: dict[str, Any],
    run_id: str,
    started_at: str,
    db_path: Path,
) -> dict[str, Any]:
    """Apply all persistent changes in one transaction."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        nominal_rows_now = count_nominal_rows(conn)
        if nominal_rows_now != nominal_rows_expected:
            raise RemediationError(
                "tree_valuation_pilot changed after the dry analysis: "
                f"expected {nominal_rows_expected} nominal rows, found {nominal_rows_now}"
            )

        create_scenario_table(conn, valuation_columns)
        create_audit_tables(conn)

        moved_at = utc_now()
        names = [column.name for column in valuation_columns]
        quoted_names = ", ".join(quote_identifier(name) for name in names)
        insert_columns = (
            "scenario_name, remediation_run_id, moved_at_utc"
            + (", " + quoted_names if quoted_names else "")
        )
        select_columns = "?, ?, ?" + (", " + quoted_names if quoted_names else "")
        moved_cursor = conn.execute(
            f"INSERT INTO {quote_identifier(SCENARIO_TABLE)} ({insert_columns}) "
            f"SELECT {select_columns} FROM tree_valuation_pilot "
            "WHERE valuation_confidence = ?",
            (SCENARIO_NAME, run_id, moved_at, LEGACY_CONFIDENCE),
        )
        moved = int(moved_cursor.rowcount)
        deleted_cursor = conn.execute(
            "DELETE FROM tree_valuation_pilot WHERE valuation_confidence = ?",
            (LEGACY_CONFIDENCE,),
        )
        deleted = int(deleted_cursor.rowcount)
        if moved != nominal_rows_expected or deleted != nominal_rows_expected:
            raise RemediationError(
                f"valuation move/delete mismatch: expected={nominal_rows_expected}, "
                f"moved={moved}, deleted={deleted}"
            )

        reason = (
            "current-only trajectory reclassified from actual 2013/2016 CHM cell values "
            "using the trajectory-builder fate precedence"
        )
        changed_at = utc_now()
        audit_cursor = conn.execute(
            f"""
            INSERT INTO {quote_identifier(FATE_AUDIT_TABLE)} (
                run_id, trajectory_id, old_fate, new_fate, reason,
                sample_x_2193, sample_y_2193,
                sampled_chm_2013_m, sampled_chm_2016_m,
                historic_coverage_2013, historic_coverage_2016,
                classification_rule, changed_at_utc
            )
            SELECT
                ?, t.trajectory_id, t.fate, r.new_fate, ?,
                r.sample_x_2193, r.sample_y_2193,
                r.sampled_chm_2013_m, r.sampled_chm_2016_m,
                r.historic_coverage_2013, r.historic_coverage_2016,
                r.classification_rule, ?
            FROM tree_trajectory_pilot AS t
            JOIN {quote_identifier(TEMP_RELABEL_TABLE)} AS r
              ON r.trajectory_id = t.trajectory_id AND r.old_fate = t.fate
            WHERE COALESCE(t.present_2024, 0) = 1
              AND COALESCE(t.present_2013, 0) = 0
              AND COALESCE(t.present_2016, 0) = 0
              AND t.x_2193 = r.sample_x_2193
              AND t.y_2193 = r.sample_y_2193
            """,
            (run_id, reason, changed_at),
        )
        audited = int(audit_cursor.rowcount)
        expected_relabels = int(trajectory_stats["trajectory_rows_to_relabel"])
        if audited != expected_relabels:
            raise RemediationError(
                "tree_trajectory_pilot changed after coverage analysis: "
                f"expected {expected_relabels} relabels, found {audited} unchanged source rows"
            )

        update_cursor = conn.execute(
            f"""
            UPDATE tree_trajectory_pilot
            SET fate = (
                SELECT audit.new_fate
                FROM {quote_identifier(FATE_AUDIT_TABLE)} AS audit
                WHERE audit.run_id = ?
                  AND audit.trajectory_id = tree_trajectory_pilot.trajectory_id
            )
            WHERE trajectory_id IN (
                SELECT trajectory_id FROM {quote_identifier(FATE_AUDIT_TABLE)} WHERE run_id = ?
            )
            """,
            (run_id, run_id),
        )
        relabelled = int(update_cursor.rowcount)
        if relabelled != expected_relabels:
            raise RemediationError(
                f"trajectory update mismatch: expected={expected_relabels}, updated={relabelled}"
            )

        # Recompute the full winner/loser plan under the write transaction. The
        # digest catches changed links, coordinates, present_2024 flags, winners,
        # or newly introduced duplicates between analysis and BEGIN IMMEDIATE.
        live_duplicate_stats = find_duplicate_canonical_links(
            conn,
            batch_size=20_000,
            collect_for_apply=False,
        )
        comparison_keys = (
            "duplicate_canonical_tree_ids",
            "canonical_links_to_unlink",
            "canonical_link_plan_sha256",
        )
        if any(live_duplicate_stats[key] != duplicate_stats[key] for key in comparison_keys):
            raise RemediationError(
                "tree_trajectory_pilot canonical links changed after duplicate analysis; "
                "aborting rather than applying a stale winner plan"
            )

        unlink_reason = (
            "duplicate canonical_tree_id; retained deterministically by present_2024, "
            "then LiDAR-point squared distance, then trajectory_id"
        )
        unlink_changed_at = utc_now()
        canonical_audit_cursor = conn.execute(
            f"""
            INSERT INTO {quote_identifier(CANONICAL_LINK_AUDIT_TABLE)} (
                run_id, canonical_tree_id, retained_trajectory_id,
                unlinked_trajectory_id, retained_present_2024,
                unlinked_present_2024, retained_distance_sq_m2,
                unlinked_distance_sq_m2, reason, changed_at_utc
            )
            SELECT
                ?, plan.canonical_tree_id, plan.retained_trajectory_id,
                plan.unlinked_trajectory_id, plan.retained_present_2024,
                plan.unlinked_present_2024, plan.retained_distance_sq_m2,
                plan.unlinked_distance_sq_m2, ?, ?
            FROM {quote_identifier(TEMP_UNLINK_TABLE)} AS plan
            JOIN tree_trajectory_pilot AS retained
              ON retained.trajectory_id = plan.retained_trajectory_id
             AND retained.canonical_tree_id = plan.canonical_tree_id
            JOIN tree_trajectory_pilot AS secondary
              ON secondary.trajectory_id = plan.unlinked_trajectory_id
             AND secondary.canonical_tree_id = plan.canonical_tree_id
            """,
            (run_id, unlink_reason, unlink_changed_at),
        )
        canonical_audited = int(canonical_audit_cursor.rowcount)
        expected_unlinks = int(duplicate_stats["canonical_links_to_unlink"])
        if canonical_audited != expected_unlinks:
            raise RemediationError(
                f"canonical-link audit mismatch: expected={expected_unlinks}, "
                f"audited={canonical_audited}"
            )

        unlink_cursor = conn.execute(
            f"""
            UPDATE tree_trajectory_pilot
            SET canonical_tree_id = NULL
            WHERE trajectory_id IN (
                SELECT unlinked_trajectory_id
                FROM {quote_identifier(CANONICAL_LINK_AUDIT_TABLE)}
                WHERE run_id = ?
            )
            """,
            (run_id,),
        )
        canonical_unlinked = int(unlink_cursor.rowcount)
        if canonical_unlinked != expected_unlinks:
            raise RemediationError(
                f"canonical unlink mismatch: expected={expected_unlinks}, "
                f"updated={canonical_unlinked}"
            )

        if count_nominal_rows(conn) != 0:
            raise RemediationError("postcondition failed: nominal rows remain in primary valuation")
        duplicate_groups_remaining = int(
            conn.execute(
                "SELECT COUNT(*) FROM ("
                "SELECT canonical_tree_id FROM tree_trajectory_pilot "
                "WHERE canonical_tree_id IS NOT NULL GROUP BY canonical_tree_id HAVING COUNT(*) > 1"
                ")"
            ).fetchone()[0]
        )
        if duplicate_groups_remaining != 0:
            raise RemediationError(
                f"postcondition failed: {duplicate_groups_remaining} duplicate canonical link groups remain"
            )

        completed_at = utc_now()
        details = {
            "database": str(db_path.resolve()),
            "scenario_name": SCENARIO_NAME,
            "legacy_confidence": LEGACY_CONFIDENCE,
            "fate_classification_rule": FATE_CLASSIFICATION_RULE,
            "fate_thresholds_m": {
                "canopy_min": CANOPY_MIN_HEIGHT_M,
                "covered_ground_max_exclusive": GROUND_MAX_HEIGHT_M,
            },
            "historic_coverage_rule": (
                "sample actual masked CHM cells; apply establishment precedence "
                "from build_tree_trajectories.classify_fates"
            ),
            "trajectory_stats": trajectory_stats,
            "canonical_link_stats": duplicate_stats,
            "rasters": raster_details,
            "existing_tables_modified": [
                "tree_valuation_pilot",
                "tree_trajectory_pilot",
                "run_metadata",
            ],
            "source_tables_modified": [],
        }
        details_json = json.dumps(details, sort_keys=True, separators=(",", ":"))
        conn.execute(
            f"""
            INSERT INTO {quote_identifier(RUN_AUDIT_TABLE)} (
                run_id, command_version, started_at_utc, completed_at_utc,
                status, nominal_rows_found, nominal_rows_moved,
                primary_rows_deleted, current_only_candidates,
                trajectory_rows_relabelled, duplicate_canonical_groups,
                canonical_links_unlinked, details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                VERSION,
                started_at,
                completed_at,
                "applied",
                nominal_rows_expected,
                moved,
                deleted,
                int(trajectory_stats.get("current_only_legacy_candidates", 0)),
                relabelled,
                int(duplicate_stats["duplicate_canonical_tree_ids"]),
                canonical_unlinked,
                details_json,
            ),
        )
        metadata_value = json.dumps(
            {
                "run_id": run_id,
                "version": VERSION,
                "completed_at_utc": completed_at,
                "nominal_rows_moved": moved,
                "trajectory_rows_relabelled": relabelled,
                "fate_changes": trajectory_stats.get("fate_changes", {}),
                "duplicate_canonical_groups": int(duplicate_stats["duplicate_canonical_tree_ids"]),
                "canonical_links_unlinked": canonical_unlinked,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        conn.execute(
            "INSERT INTO run_metadata(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ("current_database_remediation_last_run", metadata_value),
        )
        conn.execute(
            "INSERT INTO run_metadata(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ("current_database_remediation_version", VERSION),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return {
        "run_id": run_id,
        "mode": "apply",
        "status": "applied",
        "nominal_rows_found": nominal_rows_expected,
        "nominal_rows_moved": moved,
        "primary_rows_deleted": deleted,
        "trajectory_rows_relabelled": relabelled,
        "duplicate_canonical_groups": int(duplicate_stats["duplicate_canonical_tree_ids"]),
        "canonical_links_unlinked": canonical_unlinked,
        "fate_changes": trajectory_stats.get("fate_changes", {}),
        "fate_classification_rule": FATE_CLASSIFICATION_RULE,
        "completed_at_utc": completed_at,
    }


def run_remediation(config: RemediationConfig) -> dict[str, Any]:
    started_at = utc_now()
    run_id = f"remediate_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    conn = connect_database(config.db_path, writable=config.apply)
    try:
        valuation_columns = inspect_schema(conn)
        nominal_rows = count_nominal_rows(conn)
        trajectory_stats, raster_details = find_trajectory_relabels(
            conn,
            historic_2013=config.historic_2013,
            historic_2016=config.historic_2016,
            batch_size=config.batch_size,
            collect_for_apply=config.apply,
        )
        duplicate_stats = find_duplicate_canonical_links(
            conn,
            batch_size=config.batch_size,
            collect_for_apply=config.apply,
        )
        if not config.apply:
            return {
                "run_id": run_id,
                "mode": "dry-run",
                "status": "no changes written",
                "database": str(config.db_path.resolve()),
                "nominal_rows_found": nominal_rows,
                "nominal_rows_to_move": nominal_rows,
                **trajectory_stats,
                **duplicate_stats,
                "fate_classification_rule": FATE_CLASSIFICATION_RULE,
                "rasters": raster_details,
                "apply_command": "rerun with --apply after reviewing this summary",
            }
        return apply_remediation(
            conn,
            valuation_columns=valuation_columns,
            nominal_rows_expected=nominal_rows,
            trajectory_stats=trajectory_stats,
            duplicate_stats=duplicate_stats,
            raster_details=raster_details,
            run_id=run_id,
            started_at=started_at,
            db_path=config.db_path,
        )
    finally:
        conn.close()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite database to inspect/remediate")
    parser.add_argument("--historic-2013", type=Path, default=DEFAULT_CHM_2013)
    parser.add_argument("--historic-2016", type=Path, default=DEFAULT_CHM_2016)
    parser.add_argument("--batch-size", type=int, default=20_000)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="apply the transaction; without this flag the command is strictly read-only",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    config = RemediationConfig(
        db_path=args.db,
        historic_2013=args.historic_2013,
        historic_2016=args.historic_2016,
        apply=args.apply,
        batch_size=args.batch_size,
    )
    try:
        summary = run_remediation(config)
    except (RemediationError, sqlite3.Error, rasterio.errors.RasterioError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, indent=2))
        return 2
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
