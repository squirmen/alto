#!/usr/bin/env python3
"""Summarize the current end-to-end pilot analysis outputs."""

from __future__ import annotations

import csv
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_rows() -> list[sqlite3.Row]:
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(
            """
            SELECT
                t.tree_id,
                t.source_primary,
                t.source_tree_id,
                COALESCE(NULLIF(t.species_common, ''), 'Unknown') AS species_common,
                COALESCE(NULLIF(t.species_latin, ''), 'Unknown') AS species_latin,
                COALESCE(NULLIF(t.owner_class, ''), 'Unknown') AS owner_class,
                t.is_protected_notable,
                t.lon,
                t.lat,
                c.crown_area_m2,
                c.crown_diameter_m,
                c.crown_max_chm_m,
                v.species_class,
                v.avoided_runoff_m3_y,
                v.stormwater_value_nzd_y,
                v.cooling_value_nzd_y,
                v.carbon_value_nzd_y,
                v.carbon_value_nzd_stored,
                v.stored_co2e_tonnes_est,
                v.annual_sequestration_tco2e_y_est,
                v.air_quality_value_nzd_y,
                v.pm25_removed_kg_y,
                v.total_value_nzd_y,
                v.valuation_confidence
            FROM tree_crown_pilot c
            JOIN trees t ON t.tree_id = c.tree_id
            LEFT JOIN tree_valuation_pilot v ON v.tree_id = c.tree_id
            ORDER BY v.total_value_nzd_y DESC NULLS LAST
            """
        ).fetchall()
    finally:
        conn.close()


def total_count(table: str) -> int:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        conn.close()


def context_summary() -> dict[str, Any] | None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        exists = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tree_context_pilot'"
        ).fetchone()[0]
        if not exists:
            return None
        row = conn.execute(
            """
            SELECT
                COUNT(*),
                SUM(in_flood_plain),
                SUM(in_flood_prone_area),
                SUM(CASE WHEN dist_overland_flow_path_m <= 5 THEN 1 ELSE 0 END),
                SUM(CASE WHEN dist_stormwater_catchpit_m <= 10 THEN 1 ELSE 0 END),
                MIN(air_temp_mean_c),
                MAX(air_temp_mean_c),
                MIN(fraction_paved_surfaces),
                MAX(fraction_paved_surfaces)
            FROM tree_context_pilot
            """
        ).fetchone()
    finally:
        conn.close()
    return {
        "tree_count": int(row[0] or 0),
        "in_flood_plain": int(row[1] or 0),
        "in_flood_prone_area": int(row[2] or 0),
        "within_5m_flow_path": int(row[3] or 0),
        "within_10m_catchpit": int(row[4] or 0),
        "air_temp_min_c": float(row[5]) if row[5] is not None else None,
        "air_temp_max_c": float(row[6]) if row[6] is not None else None,
        "paved_fraction_min": float(row[7]) if row[7] is not None else None,
        "paved_fraction_max": float(row[8]) if row[8] is not None else None,
    }


def summarize(rows: list[sqlite3.Row], group_key: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        grouped[str(row[group_key] or "Unknown")].append(row)

    out: list[dict[str, Any]] = []
    for name, group in grouped.items():
        crown_areas = [float(row["crown_area_m2"] or 0) for row in group]
        values = [float(row["total_value_nzd_y"] or 0) for row in group]
        heights = [float(row["crown_max_chm_m"] or 0) for row in group]
        out.append(
            {
                group_key: name,
                "tree_count": len(group),
                "crown_area_m2": sum(crown_areas),
                "median_crown_area_m2": median(crown_areas),
                "max_height_m": max(heights) if heights else 0,
                "avoided_runoff_m3_y": sum(float(row["avoided_runoff_m3_y"] or 0) for row in group),
                "stored_co2e_tonnes": sum(float(row["stored_co2e_tonnes_est"] or 0) for row in group),
                "annual_sequestration_tco2e_y": sum(float(row["annual_sequestration_tco2e_y_est"] or 0) for row in group),
                "stormwater_value_nzd_y": sum(float(row["stormwater_value_nzd_y"] or 0) for row in group),
                "cooling_value_nzd_y": sum(float(row["cooling_value_nzd_y"] or 0) for row in group),
                "carbon_value_nzd_y": sum(float(row["carbon_value_nzd_y"] or 0) for row in group),
                "air_quality_value_nzd_y": sum(float(row["air_quality_value_nzd_y"] or 0) for row in group),
                "total_value_nzd_y": sum(values),
                "median_value_nzd_y": median(values) if values else 0,
            }
        )
    return sorted(out, key=lambda item: item["total_value_nzd_y"], reverse=True)


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            clean_row = {}
            for key in fieldnames:
                value = row.get(key, "")
                clean_row[key] = round(value, 3) if isinstance(value, float) else value
            writer.writerow(clean_row)


def fmt_int(value: float) -> str:
    return f"{value:,.0f}"


def fmt_money(value: float) -> str:
    return f"NZD {value:,.0f}/year"


def markdown_table(rows: list[dict[str, Any]], columns: list[tuple[str, str]], limit: int = 10) -> list[str]:
    lines = [
        "| " + " | ".join(label for label, _ in columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows[:limit]:
        values = []
        for _, key in columns:
            value = row.get(key, "")
            if isinstance(value, float):
                if "value_nzd" in key:
                    values.append(fmt_money(value))
                elif key.endswith("_m2") or key.endswith("_m3_y") or key.endswith("_tco2e_y") or key.endswith("_tco2e") or key.endswith("_tonnes"):
                    values.append(fmt_int(value))
                else:
                    values.append(f"{value:,.1f}")
            else:
                values.append(str(value))
        lines.append("| " + " | ".join(values) + " |")
    return lines


def main() -> None:
    rows = load_rows()
    species_rows = summarize(rows, "species_common")
    owner_rows = summarize(rows, "owner_class")
    top_rows = [dict(row) for row in rows[:25]]

    summary_columns = [
        "tree_count",
        "crown_area_m2",
        "median_crown_area_m2",
        "max_height_m",
        "avoided_runoff_m3_y",
        "stored_co2e_tonnes",
        "annual_sequestration_tco2e_y",
        "stormwater_value_nzd_y",
        "cooling_value_nzd_y",
        "carbon_value_nzd_y",
        "air_quality_value_nzd_y",
        "total_value_nzd_y",
        "median_value_nzd_y",
    ]
    write_csv(
        PROCESSED_ROOT / "pilot_species_summary.csv",
        species_rows,
        ["species_common"] + summary_columns,
    )
    write_csv(
        PROCESSED_ROOT / "pilot_owner_summary.csv",
        owner_rows,
        ["owner_class"] + summary_columns,
    )
    write_csv(
        PROCESSED_ROOT / "pilot_top_value_trees.csv",
        top_rows,
        [
            "tree_id",
            "source_primary",
            "source_tree_id",
            "species_common",
            "species_latin",
            "species_class",
            "owner_class",
            "is_protected_notable",
            "lon",
            "lat",
            "crown_area_m2",
            "crown_diameter_m",
            "crown_max_chm_m",
            "avoided_runoff_m3_y",
            "stored_co2e_tonnes_est",
            "annual_sequestration_tco2e_y_est",
            "stormwater_value_nzd_y",
            "cooling_value_nzd_y",
            "carbon_value_nzd_y",
            "air_quality_value_nzd_y",
            "total_value_nzd_y",
            "valuation_confidence",
        ],
    )

    total_tree_records = total_count("trees")
    lidar_tree_records = total_count("tree_lidar_pilot")
    crown_tree_records = len(rows)
    total_crown_area = sum(float(row["crown_area_m2"] or 0) for row in rows)
    total_runoff = sum(float(row["avoided_runoff_m3_y"] or 0) for row in rows)
    total_storm_value = sum(float(row["stormwater_value_nzd_y"] or 0) for row in rows)
    total_cooling_value = sum(float(row["cooling_value_nzd_y"] or 0) for row in rows)
    total_carbon_value = sum(float(row["carbon_value_nzd_y"] or 0) for row in rows)
    total_air_value = sum(float(row["air_quality_value_nzd_y"] or 0) for row in rows)
    total_value = sum(float(row["total_value_nzd_y"] or 0) for row in rows)
    total_stored_co2e = sum(float(row["stored_co2e_tonnes_est"] or 0) for row in rows)
    total_annual_seq = sum(float(row["annual_sequestration_tco2e_y_est"] or 0) for row in rows)
    total_pm25 = sum(float(row["pm25_removed_kg_y"] or 0) for row in rows)
    max_height = max((float(row["crown_max_chm_m"] or 0) for row in rows), default=0)
    context = context_summary()

    # Source-aware split: council records (TreeRegister + Notable + Kauri)
    # vs LiDAR-inferred. Lets the reader compare with Knowledge Auckland's
    # canopy reports (which see only council/AT data) and isolate the
    # incremental value from inferred trees.
    def _sum(rows_, field):
        return sum(float(r[field] or 0) for r in rows_)

    inferred_rows = [r for r in rows if r["source_primary"] == "lidar_inferred_canopy"]
    council_rows = [r for r in rows if r["source_primary"] != "lidar_inferred_canopy"]

    def source_block(label: str, src_rows: list) -> list[str]:
        if not src_rows:
            return [f"### {label}", "", "_No rows for this source._", ""]
        return [
            f"### {label}",
            "",
            f"- Trees: {len(src_rows):,}.",
            f"- Crown area: {_sum(src_rows, 'crown_area_m2'):,.0f} m².",
            f"- Stored carbon: {_sum(src_rows, 'stored_co2e_tonnes_est'):,.0f} tCO₂e.",
            f"- Avoided runoff: {_sum(src_rows, 'avoided_runoff_m3_y'):,.0f} m³/year.",
            f"- PM2.5 removal: {_sum(src_rows, 'pm25_removed_kg_y'):,.0f} kg/year.",
            f"- Stormwater value: {fmt_money(_sum(src_rows, 'stormwater_value_nzd_y'))}.",
            f"- Carbon value (annual sequestration): {fmt_money(_sum(src_rows, 'carbon_value_nzd_y'))}.",
            f"- Cooling proxy value: {fmt_money(_sum(src_rows, 'cooling_value_nzd_y'))}.",
            f"- Air-quality value: {fmt_money(_sum(src_rows, 'air_quality_value_nzd_y'))}.",
            f"- **Total annual value: {fmt_money(_sum(src_rows, 'total_value_nzd_y'))}.**",
            "",
        ]

    lines = [
        "# Pilot Findings",
        "",
        f"Generated at: {utc_now()}",
        "",
        "## Current Pilot Scope",
        "",
        f"- Public tree records normalized: {total_tree_records:,} (TreeRegister + Notable + Kauri obs).",
        f"- Trees with LiDAR sampled CHM inside the expanded pilot bbox: {lidar_tree_records:,}.",
        f"- Trees with assigned crown outlines and site-specific service values: {crown_tree_records:,}.",
        f"- Total assigned crown area: {total_crown_area:,.0f} m².",
        f"- Total avoided runoff (model-driven): {total_runoff:,.0f} m³/year.",
        f"- Total stored carbon (allometric estimate): {total_stored_co2e:,.0f} tCO₂e.",
        f"- Total annual sequestration estimate: {total_annual_seq:,.0f} tCO₂e/year.",
        f"- Total PM2.5 removal estimate: {total_pm25:,.0f} kg/year.",
        f"- Tallest crown max CHM in pilot: {max_height:,.1f} m.",
        "",
        "### Annual NZD value breakdown",
        "",
        f"- Stormwater (avoided runoff × cost × flood weight): {fmt_money(total_storm_value)}.",
        f"- Carbon (annual sequestration × NZ ETS): {fmt_money(total_carbon_value)}.",
        f"- Cooling proxy (temperature- and paved-fraction-weighted): {fmt_money(total_cooling_value)}.",
        f"- Air quality (PM2.5 removal × NZD/kg): {fmt_money(total_air_value)}.",
        f"- **Total annual service value:** {fmt_money(total_value)}.",
        "",
        "These figures are a model-driven first pass. Confidences are `modelled_medium` (heat plus impervious/paved context joined) or `modelled_low` (context missing). Replace H→DBH allometry, rainfall constant, stormwater cost per m³, and PM2.5 NZD/kg with locally validated values before any public claim. See `docs/tree_valuation_pilot.md` for the assumptions and method IDs.",
        "",
        "## Source-Aware Breakdown",
        "",
        "Same numbers, split by where the tree came from. The council/AT figures are directly comparable with Knowledge Auckland's TR2020/009-2 canopy reports (they see only the public inventory). The LiDAR-inferred row quantifies the incremental coverage from CHM detection.",
        "",
    ]
    lines.extend(source_block("Council & AT trees", council_rows))
    lines.extend(source_block("LiDAR-inferred trees", inferred_rows))
    if context:
        lines.extend(
            [
                "## Context Joined To Trees",
                "",
                f"- Trees/crowns with public context joins: {context['tree_count']:,}.",
                f"- Crown intersects mapped flood plain: {context['in_flood_plain']:,}.",
                f"- Crown intersects flood-prone area: {context['in_flood_prone_area']:,}.",
                f"- Crown within 5 m of an overland flow path: {context['within_5m_flow_path']:,}.",
                f"- Tree point within 10 m of a stormwater catchpit: {context['within_10m_catchpit']:,}.",
                f"- Air-temperature context range: {context['air_temp_min_c']:.2f} to {context['air_temp_max_c']:.2f} C.",
                f"- Paved-surface fraction context range: {context['paved_fraction_min']:.2f} to {context['paved_fraction_max']:.2f}.",
                "",
            ]
        )
    lines.extend(
        [
        "## Highest-Value Species Groups",
        "",
        ]
    )
    lines.extend(
        markdown_table(
            species_rows,
            [
                ("Species", "species_common"),
                ("Trees", "tree_count"),
                ("Crown Area m2", "crown_area_m2"),
                ("Runoff m3/y", "avoided_runoff_m3_y"),
                ("Stored tCO₂e", "stored_co2e_tonnes"),
                ("Annual Value", "total_value_nzd_y"),
            ],
        )
    )
    lines.extend(["", "## Owner Summary", ""])
    lines.extend(
        markdown_table(
            owner_rows,
            [
                ("Owner", "owner_class"),
                ("Trees", "tree_count"),
                ("Crown Area m2", "crown_area_m2"),
                ("Runoff m3/y", "avoided_runoff_m3_y"),
                ("Stored tCO₂e", "stored_co2e_tonnes"),
                ("Annual Value", "total_value_nzd_y"),
            ],
        )
    )
    lines.extend(["", "## Top Individual Trees by Annual Value", ""])
    lines.extend(
        markdown_table(
            top_rows,
            [
                ("Tree ID", "source_tree_id"),
                ("Species", "species_common"),
                ("Owner", "owner_class"),
                ("Crown Area m2", "crown_area_m2"),
                ("Height m", "crown_max_chm_m"),
                ("Annual Value", "total_value_nzd_y"),
            ],
            limit=12,
        )
    )
    lines.extend(
        [
            "",
            "## Generated Outputs",
            "",
            "- `data/processed/pilot_species_summary.csv`",
            "- `data/processed/pilot_owner_summary.csv`",
            "- `data/processed/pilot_top_value_trees.csv`",
            "",
        ]
    )
    (DOCS_ROOT / "pilot_findings.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
