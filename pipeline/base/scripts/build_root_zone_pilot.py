#!/usr/bin/env python3
"""WS4 — per-tree root-space sensitivity scenario + regulatory RPA reference.

The BS5837 RPA (12×DBH) is a construction-protection calculation, not a mapped
root system. The additional fields below are explicit sensitivity assumptions:

  base (foraging) zone:  roots extend ~1.5× the crown radius, well beyond the dripline
                         (Gilman 1988; Stone & Kalisz 1991; Day et al. 2010). Crown size, not
                         DBH, drives it.
  constrained zone:      reduced by neighbour competition (roots partition space — capped at
                         ~0.6× distance-to-nearest-tree) and by impervious surfaces / building
                         footprints / roads (roots largely excluded under sealed ground).
  stability screen:      a heuristic comparison with a nominal structural root-plate radius.
                         Where the modelled zone falls below it, the record is flagged for
                         arborist review; it is not a windthrow probability or risk assessment.

Also keeps the BS5837 RPA (for construction protection + the conservative stormwater term).
Writes `tree_root_zone_pilot` + `tree_size.geojson` (effective radius + constraint flag for the
map) + a summary. All ESTIMATES — root systems are highly plastic; this is a model, not GPR.
Read-only on inputs. No GPU.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT_DOC = ROOT / "docs" / "validation" / "root_zone_summary.md"
GEOJSON_OUT = ROOT / "data" / "processed" / "tree_size.geojson"

CROWN_TO_ROOT = 1.5      # sensitivity multiplier; not a measured root radius
NEIGHBOR_FRAC = 0.60     # sensitivity cap; roots are not truly Voronoi-partitioned
IMPERV_EXCLUSION = 0.70  # sensitivity assumption for sealed-surface exclusion
STABILITY_DBH = 3.0      # unvalidated screening coefficient
STABILITY_HEIGHT = 0.12  # unvalidated screening coefficient

# BS5837 RPA (kept for construction protection + the conservative stormwater term).
RPA_FACTOR, RPA_AREA_CAP_M2 = 12.0, 707.0
# Stormwater infiltration term (matches build_tree_valuation; conservative, on the RPA, paved-scaled).
RAINFALL_M = 1.240
RUNOFF_IMPERVIOUS, RUNOFF_PERVIOUS = 0.90, 0.30
STORMWATER_NZD_PER_M3, FLOOD_UPLIFT = 3.50, 1.5
METHOD_ID = "root_space_sensitivity_v3_not_physical_extent"
MODEL_CONFIDENCE = "scenario_only_unvalidated"


def main() -> None:
    con = sqlite3.connect(DB)
    rows = con.execute("""
        SELECT a.tree_id, a.dbh_cm_crown_est, a.life_stage, a.height_p95_m, a.nearest_tree_m,
               c.crown_area_m2, c.crown_diameter_m,
               i.fraction_impervious_30m, x.fraction_paved_surfaces, x.in_flood_prone_area
        FROM tree_assets_pilot a
        LEFT JOIN tree_crown_pilot c ON c.tree_id = a.tree_id
        LEFT JOIN tree_impervious_pilot i ON i.tree_id = a.tree_id
        LEFT JOIN tree_context_pilot x ON x.tree_id = a.tree_id
        WHERE a.dbh_cm_crown_est IS NOT NULL""").fetchall()

    con.execute("DROP TABLE IF EXISTS tree_root_zone_pilot")
    con.execute("""CREATE TABLE tree_root_zone_pilot (
        tree_id TEXT PRIMARY KEY, dbh_cm REAL, trunk_circumference_cm REAL, crown_radius_m REAL,
        foraging_radius_m REAL, effective_radius_m REAL, effective_area_m2 REAL,
        stability_radius_m REAL, root_constraint_flag TEXT,
        rpa_radius_m REAL, rpa_area_m2 REAL, life_stage TEXT,
        root_zone_avoided_runoff_m3_y REAL, root_zone_stormwater_value_nzd_y REAL,
        method_id TEXT, model_confidence TEXT)""")

    out, feats = [], []
    sum_eff = sum_crown = sum_rz_runoff = sum_rz_value = 0.0
    flags = Counter()
    for (tid, dbh_cm, stage, height, nearest, crown_area, crown_diam,
         imperv, fpaved, flood) in rows:
        dbh_m = dbh_cm / 100.0
        crown_r = (crown_diam / 2.0) if crown_diam else (math.sqrt(crown_area / math.pi) if crown_area else 1.0)
        foraging_r = CROWN_TO_ROOT * crown_r
        # neighbour competition cap
        r = min(foraging_r, NEIGHBOR_FRAC * nearest) if nearest else foraging_r
        # impervious / building / road exclusion (area basis → radius)
        imp = imperv if (imperv is not None and 0 <= imperv <= 1) else 0.0
        effective_r = r * math.sqrt(max(0.05, 1.0 - IMPERV_EXCLUSION * imp))
        effective_area = math.pi * effective_r * effective_r
        # stability floor + flag
        stability_r = max(STABILITY_DBH * dbh_m, STABILITY_HEIGHT * (height or 0))
        if effective_r < stability_r:
            flag = "space_deficit_review"
        elif effective_r < 0.7 * foraging_r:
            flag = "constrained_scenario"
        else:
            flag = "unconstrained_scenario"
        flags[flag] += 1
        # BS5837 RPA (construction + stormwater)
        rpa_r = RPA_FACTOR * dbh_m
        rpa_area = min(math.pi * rpa_r * rpa_r, RPA_AREA_CAP_M2)
        rpa_r = min(rpa_r, math.sqrt(RPA_AREA_CAP_M2 / math.pi))
        paved = fpaved if (fpaved is not None and 0 <= fpaved <= 1) else 0.35
        rz_runoff = rpa_area * RAINFALL_M * (RUNOFF_IMPERVIOUS - RUNOFF_PERVIOUS) * paved
        rz_value = rz_runoff * STORMWATER_NZD_PER_M3 * (FLOOD_UPLIFT if flood else 1.0)

        out.append((tid, dbh_cm, math.pi * dbh_cm, crown_r, foraging_r, effective_r, effective_area,
                    stability_r, flag, rpa_r, rpa_area, stage, rz_runoff, rz_value,
                    METHOD_ID, MODEL_CONFIDENCE))
        sum_eff += effective_area
        sum_rz_runoff += rz_runoff
        sum_rz_value += rz_value
        if crown_area:
            sum_crown += crown_area
    con.executemany("INSERT INTO tree_root_zone_pilot VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", out)
    con.commit()

    got = con.execute("SELECT COUNT(*) FROM tree_root_zone_pilot").fetchone()[0]
    med_eff = con.execute("SELECT effective_radius_m FROM tree_root_zone_pilot "
                          "ORDER BY effective_radius_m LIMIT 1 OFFSET ?", (got // 2,)).fetchone()[0]
    coords = con.execute("SELECT t.lon, t.lat, z.dbh_cm, z.effective_radius_m, z.foraging_radius_m, "
                         "z.root_constraint_flag, z.life_stage, z.tree_id, z.method_id, z.model_confidence "
                         "FROM tree_root_zone_pilot z "
                         "JOIN trees t ON t.tree_id = z.tree_id WHERE t.lon IS NOT NULL").fetchall()
    con.close()

    for lo, la, d, eff, forg, flag, ls, tree_id, method_id, model_confidence in coords:
        feats.append({"type": "Feature", "id": tree_id,
                      "geometry": {"type": "Point", "coordinates": [round(lo, 6), round(la, 6)]},
                      "properties": {"tree_id": tree_id, "dbh_cm": round(d, 1) if d else None,
                                     "root_radius_m": round(eff, 2) if eff else None,
                                     "foraging_radius_m": round(forg, 2) if forg else None,
                                     "constraint": flag, "life_stage": ls,
                                     "method_id": method_id, "model_confidence": model_confidence}})
    GEOJSON_OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")

    OUT_DOC.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# WS4 — root-space sensitivity scenario", "",
        f"Per-tree root zones for **{got:,}** trees. The BS5837 RPA (12×DBH) is kept as the "
        "construction-protection calculation. The displayed zone is not a physical root extent.", "",
        "## Model",
        "- **Foraging extent** = 1.5 × crown radius (roots extend well beyond the dripline; "
        "Gilman 1988, Stone & Kalisz 1991, Day et al. 2010).",
        "- **Constrained** by neighbour competition (≤0.6 × nearest-tree distance) and impervious "
        "exclusion (sealed surfaces/buildings/roads remove ~70% of rooting on an area basis).",
        "- **Stability screen** = max(3×DBH, 0.12×height). This is a heuristic review threshold, "
        "not a validated windthrow model; Coutts (1983) describes Sitka spruce root architecture "
        "but does not validate this Auckland-wide formula.", "",
        f"**Effective root radius: median {med_eff:.1f} m** (vs the old RPA ~1–2 m — the discs were "
        f"under-sized because RPA is a legal minimum, not biology).", "",
        "## Constraint / stability flags", "", "| Flag | n | share |", "|---|--:|--:|",
        *[f"| {k} | {v:,} | {v/got:.1%} |" for k, v in flags.most_common()], "",
        "`space_deficit_review` means only that the assumed available-space radius is below an "
        "assumed comparison radius. It is not a windthrow or failure probability.", "",
        f"Summed scenario area **{sum_eff/1e6:.1f} km²** vs canopy {sum_crown/1e6:.1f} km². "
        "Overlapping root systems make this sum non-physical.", "",
        "## Stormwater sensitivity (on the RPA)", "",
        f"The legacy sensitivity calculation gives {sum_rz_runoff/1e6:.2f}M m³/yr and "
        f"NZ${sum_rz_value/1e6:.1f}M/yr. It uses an unaudited marginal price and simplified "
        "rainfall/runoff coefficients, so it is excluded from release claims.", "",
        "**Scenario only** — roots overlap, cross parcel boundaries, and respond to soil, utilities, "
        "water and construction history that are not observed here. Without GPR/excavation this is "
        "not an estimated physical root footprint. Shape is circular in this table; v3 supplies a "
        "visual Voronoi/building-constrained scenario.",
    ]
    OUT_DOC.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote tree_root_zone_pilot: {got:,} rows (verify {'OK' if got == len(out) else 'MISMATCH'})")
    print(f"  effective root radius median {med_eff:.1f} m (was RPA ~1-2 m)")
    print(f"  constraint flags: {dict(flags)}")
    print(f"  effective root area {sum_eff/1e6:.1f} km² (canopy {sum_crown/1e6:.1f} km²)")
    print(f"  stormwater sensitivity (on RPA; not release-ready): NZ${sum_rz_value/1e6:.1f}M/yr")
    print(f"  tree_size.geojson: {len(feats):,} feats -> {GEOJSON_OUT.name}")


if __name__ == "__main__":
    main()
