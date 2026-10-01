#!/usr/bin/env python3
"""Evaluate what GBIF tree occurrences would add to the inventory's species.

1,378,859 inventory records carry no Latin taxon, and the only species signal on
most of them comes from an aerial-RGB model that is not release eligible. GBIF
records carry a determined taxon, so the question is how many inventory trees
sit close enough to one to inherit it, and how often GBIF agrees with the
records whose species is already known.

That second number is the important one. Agreement on trees the inventory has
already identified is the only available check on whether this matching is
sound, because a GBIF observation is a point with 5 to 50 m of positional
uncertainty rather than a label attached to a crown.

Read-only. Writes a report and a candidate match table under outputs/.

    python scripts/evaluate_gbif_species_match.py [--max-distance 10]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path

import numpy as np
from pyproj import Transformer
from scipy.spatial import cKDTree


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OCCURRENCES = ROOT / "data" / "raw" / "gbif" / "auckland_tree_occurrences.jsonl"
OUT_DIR = ROOT / "outputs" / "gbif_match"

TO_2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)


def load_occurrences(max_uncertainty: float) -> list[dict]:
    kept, dropped_uncertain, dropped_rank = [], 0, 0
    with OCCURRENCES.open(encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            if not r.get("species"):
                dropped_rank += 1
                continue
            unc = r.get("coordinateUncertaintyInMeters")
            # An unrecorded uncertainty is common and is not evidence of
            # precision, so treat it as unknown and keep it in a separate tier.
            if unc is not None and unc > max_uncertainty:
                dropped_uncertain += 1
                continue
            kept.append(r)
    print(f"occurrences: {len(kept):,} usable "
          f"({dropped_rank:,} without a species, {dropped_uncertain:,} too imprecise)")
    return kept


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-distance", type=float, default=10.0,
                    help="metres from a GBIF point to an inventory tree")
    ap.add_argument("--max-uncertainty", type=float, default=50.0)
    args = ap.parse_args()

    occ = load_occurrences(args.max_uncertainty)
    if not occ:
        raise SystemExit("no usable occurrences; run fetch_gbif_tree_observations.py first")

    lons = np.array([o["decimalLongitude"] for o in occ])
    lats = np.array([o["decimalLatitude"] for o in occ])
    ox, oy = TO_2193.transform(lons, lats)

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            """
            SELECT l.tree_id, l.x_2193, l.y_2193, t.species_latin, t.source_primary,
                   sa.growth_form, sa.growth_form_confidence
            FROM tree_lidar_pilot l
            JOIN trees t ON t.tree_id = l.tree_id
            LEFT JOIN tree_species_attributes sa ON sa.tree_id = l.tree_id
            WHERE l.x_2193 IS NOT NULL AND l.y_2193 IS NOT NULL
            """
        ).fetchall()
    finally:
        conn.close()
    print(f"inventory trees with coordinates: {len(rows):,}")

    tx = np.array([r[1] for r in rows])
    ty = np.array([r[2] for r in rows])
    tree = cKDTree(np.column_stack([tx, ty]))

    dist, idx = tree.query(np.column_stack([ox, oy]), k=1, workers=-1)
    within = dist <= args.max_distance
    print(f"\nGBIF points within {args.max_distance:g} m of an inventory tree: "
          f"{within.sum():,} / {len(occ):,} ({within.mean():.1%})")

    matched_trees = set()
    gains, checks, agree, disagree = [], 0, 0, 0
    disagreements = Counter()
    for k in np.nonzero(within)[0]:
        row = rows[idx[k]]
        tree_id, _, _, latin, source, _gf, _gfc = row
        gbif_species = occ[k]["species"]
        if latin:
            checks += 1
            # Genus-level agreement: species epithets differ between the local
            # register's naming and GBIF's accepted names more often than the
            # actual identification does.
            if latin.split()[0].lower() == gbif_species.split()[0].lower():
                agree += 1
            else:
                disagree += 1
                disagreements[(latin.split()[0], gbif_species.split()[0])] += 1
        else:
            if tree_id not in matched_trees:
                gains.append({
                    "tree_id": tree_id, "gbif_species": gbif_species,
                    "distance_m": round(float(dist[k]), 1),
                    "source_primary": source,
                    "gbif_dataset": occ[k].get("datasetKey"),
                    "coordinate_uncertainty_m": occ[k].get("coordinateUncertaintyInMeters"),
                })
        matched_trees.add(tree_id)

    print(f"distinct inventory trees touched: {len(matched_trees):,}")
    print(f"\n--- validation on trees that already have a species ---")
    print(f"  checkable matches: {checks:,}")
    if checks:
        print(f"  genus agrees:    {agree:,} ({agree/checks:.1%})")
        print(f"  genus disagrees: {disagree:,} ({disagree/checks:.1%})")
        print("  most common disagreements (inventory -> GBIF):")
        for (a, b), n in disagreements.most_common(8):
            print(f"    {a} -> {b}: {n}")

    print(f"\n--- potential gain ---")
    print(f"  trees with no Latin name that would receive one: {len(gains):,}")
    if gains:
        by_species = Counter(g["gbif_species"] for g in gains)
        print("  top species that would be added:")
        for sp, n in by_species.most_common(10):
            print(f"    {sp}: {n}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "candidate_matches.json").write_text(
        json.dumps(gains[:5000], indent=1), encoding="utf-8")
    (OUT_DIR / "summary.json").write_text(json.dumps({
        "max_distance_m": args.max_distance,
        "max_uncertainty_m": args.max_uncertainty,
        "occurrences_usable": len(occ),
        "occurrences_within_distance": int(within.sum()),
        "distinct_trees_touched": len(matched_trees),
        "validation_checkable": checks,
        "validation_genus_agree": agree,
        "validation_genus_agree_rate": (agree / checks) if checks else None,
        "trees_that_would_gain_a_name": len(gains),
    }, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT_DIR}/summary.json and candidate_matches.json")


if __name__ == "__main__":
    main()
