#!/usr/bin/env python3
"""WS5/WS1 — build a curated species attribute reference from the i-Tree species database.

Turns the 9,115-row i-Tree species list into a lookup the pipeline can use:
  scientific_name → growth_form (our 4 classes, taxonomically derived) · leaf_type ·
  growth_rate · longevity · mature_height_m (the plausibility CEILING WS2 wants).

Replaces the hand-built genus heuristic in build_accuracy_assessment.py with a curated,
taxonomy-grounded map, and gives WS2 species-specific height ceilings. Writes
`itree_species_ref` (+ a genus rollup) into the Auckland SQLite and reports coverage
against our inventory. Read-only on the i-Tree CSV.
"""

from __future__ import annotations

import csv
import math
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
SRC = Path("/data/alto/itree_database_2026-06-19/derived/itree_species_all.csv")

CONIFER_FAMILIES = {"pinaceae", "cupressaceae", "podocarpaceae", "araucariaceae", "taxaceae",
                    "taxodiaceae", "cephalotaxaceae", "sciadopityaceae", "phyllocladaceae"}
CONIFER_ORDERS = {"pinales", "coniferales"}
CONIFER_CLASSES = {"pinopsida", "coniferopsida"}


def growth_form(gf: str, leaf: str, fam: str, order: str, cls: str) -> str:
    gf, leaf = (gf or "").lower(), (leaf or "").lower()
    if "palm" in gf:
        return "palm_other"
    if (fam or "").lower() in CONIFER_FAMILIES or (order or "").lower() in CONIFER_ORDERS \
            or (cls or "").lower() in CONIFER_CLASSES:
        return "conifer"
    if "deciduous" in leaf:
        return "deciduous_broadleaf"
    return "evergreen_broadleaf"


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# i-Tree Species is a United States database and publishes MatureHeight in
# FEET. Earlier builds stored the raw value straight into a column named
# mature_height_m, which put every ceiling out by a factor of 3.28 (Agathis
# australis read 165 "metres") and made the downstream height plausibility check
# far too permissive to ever fire. Convert on ingest.
FEET_TO_METRES = 0.3048


def mature_height_metres(v):
    ft = fnum(v)
    return None if ft is None or not math.isfinite(ft) or ft <= 0 else round(ft * FEET_TO_METRES, 2)


def main() -> None:
    rows = list(csv.DictReader(open(SRC, encoding="utf-8")))
    con = sqlite3.connect(DB)
    con.execute("BEGIN IMMEDIATE")
    con.execute("DROP TABLE IF EXISTS itree_species_ref")
    con.execute("""CREATE TABLE itree_species_ref (
        scientific_name TEXT PRIMARY KEY, genus TEXT, growth_form TEXT, leaf_type TEXT,
        growth_rate TEXT, longevity TEXT, mature_height_m REAL)""")

    seen = set()
    out = []
    genus_heights = defaultdict(list)
    genus_forms = defaultdict(list)
    for r in rows:
        genus = (r.get("Genus") or "").strip()
        sp = (r.get("ScientificName") or "").strip()
        full = f"{genus} {sp}".strip()
        if not full or full in seen:
            continue
        seen.add(full)
        gform = growth_form(r.get("GrowthForm"), r.get("LeafType"), r.get("Family"),
                            r.get("Order"), r.get("Class"))
        mh = mature_height_metres(r.get("MatureHeight"))
        out.append((full, genus, gform, r.get("LeafType") or None, (r.get("GrowthRate") or None),
                    (r.get("Longevity") or None), mh))
        if genus:
            genus_forms[genus].append(gform)
            if mh:
                genus_heights[genus].append(mh)
    con.executemany("INSERT OR IGNORE INTO itree_species_ref VALUES (?,?,?,?,?,?,?)", out)

    # genus rollup (modal growth form + max mature height) for genus-only matches
    con.execute("DROP TABLE IF EXISTS itree_genus_ref")
    con.execute("CREATE TABLE itree_genus_ref (genus TEXT PRIMARY KEY, growth_form TEXT, mature_height_m REAL)")
    grows = []
    for g, forms in genus_forms.items():
        modal = sorted(set(forms), key=lambda form: (-forms.count(form), form))[0]
        mh = max(genus_heights[g]) if genus_heights[g] else None
        grows.append((g, modal, mh))
    con.executemany("INSERT OR IGNORE INTO itree_genus_ref VALUES (?,?,?)", grows)
    con.commit()

    # coverage against our inventory
    known = con.execute("SELECT species_latin, COUNT(*) FROM trees WHERE species_latin IS NOT NULL "
                        "AND species_latin <> '' AND species_latin NOT LIKE '%nknown%' "
                        "GROUP BY species_latin").fetchall()
    n_known = sum(c for _, c in known)
    sp_hit = sum(c for s, c in known if con.execute(
        "SELECT 1 FROM itree_species_ref WHERE scientific_name=?", (s,)).fetchone())
    gen_hit = sum(c for s, c in known if con.execute(
        "SELECT 1 FROM itree_genus_ref WHERE genus=?", (s.split()[0],)).fetchone())
    con.close()

    print(f"itree_species_ref: {len(out):,} species | itree_genus_ref: {len(grows):,} genera")
    from collections import Counter
    print("  growth_form split:", Counter(o[2] for o in out).most_common())
    print(f"  Auckland known-species trees: {n_known:,}")
    print(f"    matched at species level: {sp_hit:,} ({sp_hit/n_known:.0%})")
    print(f"    matched at genus level:   {gen_hit:,} ({gen_hit/n_known:.0%})  → growth-form + height ceiling")


if __name__ == "__main__":
    main()
