#!/usr/bin/env python3
"""Regenerate the baked-in headline numbers in web/pilot_map/index.html.

The map can't aggregate over vector tiles in the browser, so pilot-wide totals,
the species-menu counts, and the growth-bucket counts are baked into the HTML
as JS consts. They previously drifted out of sync with the database whenever a
pipeline step added or deleted trees (e.g. point-cloud false-positive
deletions). This script recomputes all three blocks from akl_trees.sqlite with
the SAME definitions the map's filters use, and rewrites them in place:

  PILOT_TOTALS    — counts/sums over trees + tree_crown_pilot + tree_valuation_pilot
  SPECIES_OPTIONS — COALESCE(species_common,'Unknown'), the filter's match key
  GROWTH_BUCKETS  — tree_status='new' + growth_velocity_class counts

Run after any step that changes the per-tree tables, before build_web_deploy.
"""

from __future__ import annotations

import re
import sqlite3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQLITE_PATH = ROOT / "data" / "processed" / "akl_trees.sqlite"
HTML = ROOT / "web" / "pilot_map" / "index.html"
N_SPECIES = 36  # menu length: "Unknown" + this many named species


def replace_block(html: str, const: str, body: str) -> str:
    pat = re.compile(rf"const {const} = (?:\{{.*?\}}|\[.*?\]);", re.S)
    if not pat.search(html):
        raise SystemExit(f"const {const} block not found in {HTML}")
    return pat.sub(f"const {const} = {body};", html, count=1)


def js_json(value) -> str:
    """JSON safe to embed inside an HTML script element."""
    return (json.dumps(value, ensure_ascii=False)
            .replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e"))


def main() -> None:
    # Read-only: this stage only summarises, and the working database may be
    # open elsewhere while the web build runs.
    conn = sqlite3.connect(f"file:{SQLITE_PATH}?mode=ro", uri=True)
    q = lambda s: conn.execute(s).fetchone()[0]  # noqa: E731

    # Crown-merge duplicate seeds (apply_crown_merge.py) are flagged, not
    # deleted — exclude them from the trees-based headline counts so a tree
    # split across several council points isn't counted twice.
    has_dup = bool(conn.execute(
        "SELECT 1 FROM pragma_table_info('tree_pointcloud_pilot') WHERE name='is_duplicate_seed'"
    ).fetchone())
    DUP = ("AND tree_id NOT IN (SELECT tree_id FROM tree_pointcloud_pilot "
           "WHERE is_duplicate_seed = 1)") if has_dup else ""

    totals = {
        "trees": q(f"SELECT COUNT(*) FROM trees WHERE 1=1 {DUP}"),
        "crowns": q("SELECT COUNT(*) FROM tree_crown_pilot"),
        "protected": q(f"SELECT COUNT(*) FROM trees WHERE is_protected_notable = 1 {DUP}"),
        "lidarInferred": q(
            f"SELECT COUNT(*) FROM trees WHERE source_primary = 'lidar_inferred_canopy' {DUP}"),
        "totalValueNzdY": int(q(
            "SELECT ROUND(SUM(total_value_nzd_y)) FROM tree_valuation_pilot "
            "WHERE valuation_confidence != 'modelled_nominal'")),
        "runoffM3Y": int(q(
            "SELECT ROUND(SUM(avoided_runoff_m3_y)) FROM tree_valuation_pilot "
            "WHERE valuation_confidence != 'modelled_nominal'")),
        "carbonTco2e": int(q(
            "SELECT ROUND(SUM(stored_co2e_tonnes_est)) FROM tree_valuation_pilot "
            "WHERE valuation_confidence != 'modelled_nominal'")),
    }

    species = conn.execute(
        f"""
        SELECT COALESCE(NULLIF(TRIM(species_common), ''), 'Unknown') s, COUNT(*) n
        FROM trees WHERE 1=1 {DUP} GROUP BY s
        """).fetchall()
    unknown = next((n for s, n in species if s == "Unknown"), 0)
    named = sorted(((s, n) for s, n in species if s != "Unknown"),
                   key=lambda r: -r[1])[:N_SPECIES]
    species_rows = [("Unknown", unknown)] + named

    # Growth-velocity buckets come from the historic-CHM tree_change_pilot sample.
    # The metro build doesn't carry that table (its change story is the cross-epoch
    # tree_trajectory_pilot layer), so bake an empty set and let the UI hide the
    # growth section rather than show meaningless zeros.
    has_change = bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tree_change_pilot'").fetchone())
    if has_change:
        growth = dict(conn.execute(
            """
            SELECT growth_velocity_class, COUNT(*) FROM tree_change_pilot
            WHERE growth_velocity_class IN ('expanding', 'stable', 'declining')
            GROUP BY growth_velocity_class
            """).fetchall())
        growth["new"] = q(
            "SELECT COUNT(*) FROM tree_change_pilot WHERE tree_status = 'newly_established'")
    else:
        growth = {}
    conn.close()

    totals_js = ("{\n" + "\n".join(
        f"      {k}: {v}," for k, v in totals.items()).rstrip(",") + "\n    }")
    species_js = ("[\n" + ",\n".join(
        f"      {js_json([s, n])}" for s, n in species_rows) + "\n    ]")
    glyphs = {"new": "✦", "expanding": "↑", "stable": "→", "declining": "↓"}
    labels = {"new": "New", "expanding": "Growing", "stable": "Stable",
              "declining": "Declining"}
    if growth:
        growth_js = ("[\n" + ",\n".join(
            f'      ["{k}", "{labels[k]}", "{glyphs[k]}", {growth.get(k, 0)}]'
            for k in ("new", "expanding", "stable", "declining")) + "\n    ]")
    else:
        growth_js = "[]"  # no growth-velocity data; the UI hides the section

    html = HTML.read_text(encoding="utf-8")
    html = replace_block(html, "PILOT_TOTALS", totals_js)
    html = replace_block(html, "SPECIES_OPTIONS", species_js)
    html = replace_block(html, "GROWTH_BUCKETS", growth_js)
    HTML.write_text(html, encoding="utf-8")

    print("PILOT_TOTALS:", totals)
    print(f"SPECIES_OPTIONS: Unknown {unknown:,} + top {len(named)} "
          f"(#1 {named[0][0]} {named[0][1]:,})")
    print("GROWTH_BUCKETS:", {k: growth.get(k, 0) for k in
                              ("new", "expanding", "stable", "declining")})


if __name__ == "__main__":
    main()
