#!/usr/bin/env python3
"""Consolidation — wire the i-Tree species reference into the inventory.

For every tree, attach a curated growth-form + mature-height ceiling:
  - known species → `itree_species_ref` (exact), else `itree_genus_ref` (genus);
  - unknown species → the CNN `predicted_species_class` (growth-form only, no height ceiling).
Then a **height-plausibility QA flag**: a tree whose LiDAR canopy height (p95) exceeds its
species mature height by >30% is flagged — a likely false positive / over-merge / building.

Writes `tree_species_attributes`. Read-only on inputs. This is the concrete use of the
i-Tree mature-height ceilings (also available to WS2 / the species CNN class mapping).
"""

from __future__ import annotations

import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
TALL_TOLERANCE = 1.30  # height > 1.3 × mature height → implausibly tall


def main() -> None:
    con = sqlite3.connect(DB)
    rows = con.execute("""
        SELECT t.tree_id, t.species_latin, a.height_p95_m,
               p.predicted_species_class, p.species_class_confidence
        FROM trees t
        LEFT JOIN tree_assets_pilot a ON a.tree_id = t.tree_id
        LEFT JOIN tree_species_class_predictions p ON p.tree_id = t.tree_id
    """).fetchall()
    sp_ref = {r[0]: (r[1], r[2]) for r in con.execute(
        "SELECT scientific_name, growth_form, mature_height_m FROM itree_species_ref")}
    gen_ref = {r[0]: (r[1], r[2]) for r in con.execute(
        "SELECT genus, growth_form, mature_height_m FROM itree_genus_ref")}

    con.execute("BEGIN IMMEDIATE")
    con.execute("DROP TABLE IF EXISTS tree_species_attributes")
    # growth_form_confidence: 'known' = actual species ID (i-Tree species/genus, firm);
    # 'model_inferred' = CNN growth-form guess (~0.42 balanced acc — low confidence, NOT
    # asserted as fact; model_confidence keeps the per-tree calibrated probability so the
    # detail is complete); 'none' = no growth-form. Headline species mix should use the
    # calibrated population estimate, not a raw count of model_inferred labels.
    con.execute("""CREATE TABLE tree_species_attributes (
        tree_id TEXT PRIMARY KEY, growth_form TEXT, growth_form_source TEXT,
        growth_form_confidence TEXT, model_confidence REAL,
        mature_height_m REAL, lidar_height_m REAL, height_plausibility TEXT)""")

    out = []
    src_count = Counter()
    conf_count = Counter()
    plaus = Counter()
    for tid, latin, h, cnn, cnn_conf in rows:
        gf = mh = None
        gf_src = "none"
        if latin and "nknown" not in latin:
            if latin in sp_ref:
                gf, mh = sp_ref[latin]
                gf_src = "itree_species"
            elif latin.split()[0] in gen_ref:
                gf, mh = gen_ref[latin.split()[0]]
                gf_src = "itree_genus"
        if gf is None and cnn:
            gf, gf_src = cnn, "cnn_predicted"
        # confidence tier + per-tree model probability (only meaningful for CNN guesses)
        if gf_src in ("itree_species", "itree_genus"):
            conf_tier, model_conf = "known", None
        elif gf_src == "cnn_predicted":
            conf_tier, model_conf = "model_inferred", cnn_conf
        else:
            conf_tier, model_conf = "none", None
        # plausibility
        if mh and h and h > 0:
            tag = "implausibly_tall" if h > TALL_TOLERANCE * mh else "ok"
        else:
            tag = "no_height" if mh else "no_ceiling"
        out.append((tid, gf, gf_src, conf_tier, model_conf, mh, h, tag))
        src_count[gf_src] += 1
        conf_count[conf_tier] += 1
        plaus[tag] += 1
    con.executemany("INSERT INTO tree_species_attributes VALUES (?,?,?,?,?,?,?,?)", out)
    con.commit()

    got = con.execute("SELECT COUNT(*) FROM tree_species_attributes").fetchone()[0]
    gf_cov = con.execute("SELECT COUNT(*) FROM tree_species_attributes WHERE growth_form IS NOT NULL").fetchone()[0]
    mh_cov = con.execute("SELECT COUNT(*) FROM tree_species_attributes WHERE mature_height_m IS NOT NULL").fetchone()[0]
    con.close()

    print(f"tree_species_attributes: {got:,} rows (verify {'OK' if got == len(out) else 'MISMATCH'})")
    print(f"  growth-form coverage: {gf_cov:,} ({gf_cov/got:.0%})  | mature-height ceiling: {mh_cov:,} ({mh_cov/got:.0%})")
    print(f"  growth-form source: {dict(src_count)}")
    print(f"  confidence tier: {dict(conf_count)}  (known=firm species ID; model_inferred=low-confidence CNN)")
    print(f"  height plausibility: {dict(plaus)}  → {plaus['implausibly_tall']:,} flagged as implausibly tall (QA)")


if __name__ == "__main__":
    main()
