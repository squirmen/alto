#!/usr/bin/env python3
"""Report what promoting low-canopy candidates changes, against a baseline.

Promotion moves detections from a held-back candidate table into the counted
inventory. The question is not only how many trees it adds but what it does to
the composition of the dataset and to the totals the map publishes, because
these are small, crown-modelled trees with no measured canopy and no species.

Compares two databases and prints the before/after. Both are opened read-only.

    python scripts/cost_promotion.py --baseline <db> --candidate <db>
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


PROMOTED_SOURCES = ("low_canopy_promoted", "pointcloud_missed_promoted")


def connect(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def scalar(conn: sqlite3.Connection, sql: str, default=0):
    try:
        value = conn.execute(sql).fetchone()[0]
    except sqlite3.OperationalError:
        return default
    return value if value is not None else default


def snapshot(conn: sqlite3.Connection) -> dict:
    placeholder = ",".join(f"'{s}'" for s in PROMOTED_SOURCES)
    return {
        "trees": scalar(conn, "SELECT COUNT(*) FROM trees"),
        "crowns": scalar(conn, "SELECT COUNT(*) FROM tree_crown_pilot"),
        "lidar_rows": scalar(conn, "SELECT COUNT(*) FROM tree_lidar_pilot"),
        "valued": scalar(conn, "SELECT COUNT(*) FROM tree_valuation_pilot"),
        "value_nzd_y": scalar(
            conn, "SELECT ROUND(SUM(total_value_nzd_y)) FROM tree_valuation_pilot"),
        "carbon_tco2e": scalar(
            conn, "SELECT ROUND(SUM(stored_co2e_tonnes_est)) FROM tree_valuation_pilot"),
        "runoff_m3_y": scalar(
            conn, "SELECT ROUND(SUM(avoided_runoff_m3_y)) FROM tree_valuation_pilot"),
        "promoted": scalar(
            conn, f"SELECT COUNT(*) FROM trees WHERE source_primary IN ({placeholder})"),
        "candidates_left": scalar(conn, "SELECT COUNT(*) FROM tree_low_canopy_candidates"),
        "named_species": scalar(
            conn, "SELECT COUNT(*) FROM trees WHERE species_latin IS NOT NULL "
                  "AND species_latin <> ''"),
        "median_crown_m2": scalar(
            conn, "SELECT crown_area_m2 FROM tree_crown_pilot ORDER BY crown_area_m2 "
                  "LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM tree_crown_pilot)"),
        "median_height_m": scalar(
            conn, "SELECT crown_max_chm_m FROM tree_crown_pilot WHERE crown_max_chm_m "
                  "IS NOT NULL ORDER BY crown_max_chm_m LIMIT 1 OFFSET "
                  "(SELECT COUNT(*)/2 FROM tree_crown_pilot WHERE crown_max_chm_m IS NOT NULL)"),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", type=Path, required=True)
    ap.add_argument("--candidate", type=Path, required=True)
    args = ap.parse_args()

    base_conn, cand_conn = connect(args.baseline), connect(args.candidate)
    try:
        before, after = snapshot(base_conn), snapshot(cand_conn)
    finally:
        base_conn.close()
        cand_conn.close()

    labels = {
        "trees": "trees", "crowns": "crowns", "lidar_rows": "lidar samples",
        "valued": "valued records", "promoted": "promoted records",
        "candidates_left": "candidates remaining", "named_species": "records with a Latin name",
        "value_nzd_y": "service scenario NZ$/yr", "carbon_tco2e": "stored carbon tCO2e",
        "runoff_m3_y": "avoided runoff m3/yr",
        "median_crown_m2": "median crown m2", "median_height_m": "median height m",
    }
    print(f"{'metric':30s} {'before':>16} {'after':>16} {'change':>16}")
    print("-" * 82)
    for key, label in labels.items():
        b, a = before[key], after[key]
        delta = a - b
        pct = f"{delta / b:+.1%}" if b else "n/a"
        fmt = (lambda v: f"{v:,.1f}") if "median" in key else (lambda v: f"{v:,.0f}")
        print(f"  {label:28s} {fmt(b):>16} {fmt(a):>16} {fmt(delta):>10} {pct:>7}")

    print("\nComposition of what was added:")
    added_trees = after["trees"] - before["trees"]
    if added_trees:
        print(f"  every added record is crown-modelled, not crown-measured")
        print(f"  none carries a species: records with a Latin name changed by "
              f"{after['named_species'] - before['named_species']:+,}")
        unvalued = after["trees"] - after["valued"]
        print(f"  unvalued after promotion: {unvalued:,} "
              f"(re-run build_tree_valuation.py to value the new trees)")


if __name__ == "__main__":
    main()
