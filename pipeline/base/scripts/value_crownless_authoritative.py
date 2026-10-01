#!/usr/bin/env python3
"""Build an optional scenario for inventory records without a detected crown.

A small share of the inventory is made up of named, authoritative points that
sit on no LiDAR-detectable canopy. Absence of a crown can mean a small/new tree,
positional error, stale inventory, removal, or non-tree observation. It is not
scientifically defensible to insert a typical crown into the primary valuation.

This script can create a clearly separated sensitivity scenario for authoritative
tree-register/notable records by assigning the detected population's 25th-
percentile crown and height. It never inserts those values into the primary
``tree_valuation_pilot`` table. Kauri surveillance and OpenStreetMap points are
excluded from this scenario because they are not authoritative asset records.

Existing legacy ``modelled_nominal`` rows can be removed explicitly. Both write
operations require a command-line flag; the default is report-only.

Usage:
    python scripts/value_crownless_authoritative.py
    python scripts/value_crownless_authoritative.py --write-scenario
    python scripts/value_crownless_authoritative.py --remove-primary-nominal
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_tree_valuation import (  # noqa: E402
    SQLITE_PATH,
    VALUATION_ASSUMPTIONS,
    compute_tree_valuation,
    utc_now,
)

NOMINAL_TIER = "modelled_nominal"
NOMINAL_UNCERTAINTY = 0.70  # ±70%: wider than modelled_low, these are unmeasured


def detected_percentiles(conn: sqlite3.Connection) -> tuple[float, float]:
    """25th-percentile crown area and canopy height of the detected population."""
    areas = [
        r[0]
        for r in conn.execute(
            "SELECT crown_area_m2 FROM tree_crown_pilot "
            "WHERE crown_area_m2 IS NOT NULL AND crown_area_m2 > 0"
        )
    ]
    heights = [
        r[0]
        for r in conn.execute(
            "SELECT crown_max_chm_m FROM tree_crown_pilot "
            "WHERE crown_max_chm_m IS NOT NULL AND crown_max_chm_m > 0"
        )
    ]
    # statistics.quantiles with n=4 gives the quartile cut points; [0] is p25.
    p25_area = statistics.quantiles(areas, n=4)[0]
    p25_height = statistics.quantiles(heights, n=4)[0]
    return round(p25_area, 2), round(p25_height, 2)


def load_crownless(conn: sqlite3.Connection) -> list[dict]:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT t.tree_id, t.source_primary, t.source_tree_id,
               t.species_common, t.species_latin, t.owner_class,
               t.is_protected_notable, t.lon, t.lat
        FROM trees t
        LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
        WHERE c.tree_id IS NULL
          AND t.source_primary IN ('tree_register_points', 'notable_trees_overlay')
        """
    ).fetchall()
    conn.row_factory = None
    return [dict(r) for r in rows]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="deprecated alias for report-only")
    ap.add_argument("--write-scenario", action="store_true",
                    help="write tree_valuation_crownless_scenario (never the primary table)")
    ap.add_argument("--remove-primary-nominal", action="store_true",
                    help="delete legacy modelled_nominal rows from tree_valuation_pilot")
    args = ap.parse_args()

    conn = sqlite3.connect(SQLITE_PATH)
    try:
        p25_area, p25_height = detected_percentiles(conn)
        print(f"Detected-population 25th percentile: crown {p25_area} m², height {p25_height} m")

        crownless = load_crownless(conn)
        print(f"Crownless authoritative trees: {len(crownless):,}")
        by_source: dict[str, int] = {}
        for r in crownless:
            by_source[r["source_primary"]] = by_source.get(r["source_primary"], 0) + 1
        for src, n in sorted(by_source.items(), key=lambda kv: -kv[1]):
            print(f"    {src}: {n:,}")

        values = []
        for r in crownless:
            # Feed the standard valuation with a conservative modelled crown and
            # height, and default (null) context so it uses conservative fallbacks.
            row = {
                "tree_id": r["tree_id"],
                "source_primary": r["source_primary"],
                "species_common": r["species_common"],
                "species_latin": r["species_latin"],
                "crown_area_m2": p25_area,
                "crown_max_chm_m": p25_height,
                "in_flood_prone_area": None,
                "in_flood_plain": None,
                "imperv_fraction_30m": None,
                "fraction_paved_surfaces": None,
                "air_temp_mean_c": None,
                "ml_species_class": None,
                "ml_species_class_confidence": None,
            }
            v = compute_tree_valuation(row)
            # Override the confidence tier and widen the uncertainty band.
            v["valuation_confidence"] = NOMINAL_TIER
            v["uncertainty_factor"] = NOMINAL_UNCERTAINTY
            v["total_value_nzd_y_low"] = v["total_value_nzd_y"] * (1 - NOMINAL_UNCERTAINTY)
            v["total_value_nzd_y_high"] = v["total_value_nzd_y"] * (1 + NOMINAL_UNCERTAINTY)
            v["species_allometry_source"] = "crownless_nominal_p25_detected"
            values.append(v)

        added_total = sum(v["total_value_nzd_y"] for v in values)
        print(f"Nominal service value added: NZ${added_total:,.0f}/yr across {len(values):,} trees")
        print(f"    mean per tree: NZ${added_total/max(len(values),1):,.0f}/yr")

        if not args.write_scenario and not args.remove_primary_nominal:
            print("Report only: no rows written. Use --write-scenario for a separated sensitivity table.")
            return

        created = utc_now()
        assumptions_json = json.dumps(VALUATION_ASSUMPTIONS)
        columns = [
            "tree_id", "species_class", "species_class_source",
            "species_class_confidence_ml", "species_allometry_source",
            "paved_fraction_source", "uncertainty_factor", "crown_area_m2",
            "crown_max_chm_m", "in_flood_prone_area", "paved_fraction_used",
            "interception_fraction_used", "runoff_coefficient_used",
            "intercepted_rainfall_m3_y", "avoided_runoff_m3_y",
            "stormwater_value_nzd_y", "dbh_cm_est", "agb_kg_est", "bgb_kg_est",
            "carbon_kg_est", "stored_co2e_tonnes_est",
            "annual_sequestration_tco2e_y_est", "carbon_value_nzd_stored",
            "carbon_value_nzd_y", "cooling_value_nzd_y_temp",
            "cooling_value_nzd_y_paved", "cooling_value_nzd_y", "lai_used",
            "pm25_removed_kg_y", "air_quality_value_nzd_y", "total_value_nzd_y",
            "total_value_nzd_y_low", "total_value_nzd_y_high",
            "valuation_confidence", "method_id",
        ]
        if args.remove_primary_nominal:
            deleted = conn.execute(
                "DELETE FROM tree_valuation_pilot WHERE valuation_confidence = ?",
                (NOMINAL_TIER,),
            ).rowcount
            print(f"Removed {deleted:,} legacy {NOMINAL_TIER} rows from the primary table.")
        if args.write_scenario:
            conn.execute("DROP TABLE IF EXISTS tree_valuation_crownless_scenario")
            conn.execute(
                "CREATE TABLE tree_valuation_crownless_scenario AS "
                "SELECT * FROM tree_valuation_pilot WHERE 0"
            )
            conn.executemany(
                f"INSERT INTO tree_valuation_crownless_scenario "
                f"({', '.join(columns)}, assumptions_json, created_at_utc) "
                f"VALUES ({', '.join('?' for _ in columns)}, ?, ?)",
                [tuple(v[c] for c in columns) + (assumptions_json, created) for v in values],
            )
        conn.commit()
        primary_nominal = conn.execute(
            "SELECT COUNT(*) FROM tree_valuation_pilot WHERE valuation_confidence = ?",
            (NOMINAL_TIER,),
        ).fetchone()[0]
        print(f"Primary table legacy nominal rows: {primary_nominal:,}.")
        if args.write_scenario:
            scenario = conn.execute(
                "SELECT COUNT(*) FROM tree_valuation_crownless_scenario"
            ).fetchone()[0]
            print(f"tree_valuation_crownless_scenario: {scenario:,} rows.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
