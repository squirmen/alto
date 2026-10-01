#!/usr/bin/env python3
"""Diagnostic — near-coincident / duplicate trees across sources (WS3-adjacent).

The merged inventory stitches council register, OSM, kauri obs, notable, LiDAR-inferred and
promoted-candidate records. The same physical tree can appear 2+ times with a small spatial
offset (e.g. a council point + a LiDAR detection of the same crown), inflating counts and
ecosystem-service totals. This quantifies the problem before we build the merge:

  - pairs of trees within a tight radius, split SAME-source vs CROSS-source (cross-source at a
    tight radius is the strong duplicate signal — two datasets describing one tree);
  - cluster them (union-find) and estimate the duplicate "inflation" (extra records);
  - which source-pairs collide most;
  - the user's specific case: a crowned tree with a *no-crown* record right next to it.

Read-only. Writes docs/validation/duplicate_trees_v1.md. numpy + scipy + sqlite.
"""

from __future__ import annotations

import math
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT = ROOT / "docs" / "validation" / "duplicate_trees_v1.md"

LAT0 = -36.85
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))
RADII = (1.0, 2.0, 3.0)
CLUSTER_R = 2.0  # radius for the cluster/inflation estimate


def main() -> None:
    con = sqlite3.connect(DB)
    rows = con.execute("""
        SELECT t.tree_id, t.source_primary, t.lon, t.lat,
               CASE WHEN c.tree_id IS NULL THEN 0 ELSE 1 END AS has_crown
        FROM trees t LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
        WHERE t.lon IS NOT NULL AND t.lat IS NOT NULL
    """).fetchall()
    con.close()

    n = len(rows)
    src = np.array([r[1] for r in rows], dtype=object)
    has_crown = np.array([r[4] for r in rows], dtype=bool)
    xy = np.column_stack([(np.array([r[2] for r in rows]) - 174.76) * M_PER_DEG_LON,
                          (np.array([r[3] for r in rows]) - LAT0) * M_PER_DEG_LAT])
    tree = cKDTree(xy)

    radius_stats = {}
    for R in RADII:
        pairs = tree.query_pairs(R, output_type="ndarray")
        if len(pairs) == 0:
            radius_stats[R] = {"pairs": 0, "cross": 0, "same": 0, "trees_with_neighbor": 0}
            continue
        cross = src[pairs[:, 0]] != src[pairs[:, 1]]
        with_neighbor = len(np.unique(pairs))
        radius_stats[R] = {"pairs": len(pairs), "cross": int(cross.sum()),
                           "same": int((~cross).sum()), "trees_with_neighbor": with_neighbor}

    # Cluster at CLUSTER_R via union-find; estimate inflation from multi-record clusters.
    pairs = tree.query_pairs(CLUSTER_R, output_type="ndarray")
    parent = np.arange(n)
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b in pairs:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(n)])
    members = defaultdict(list)
    for i, r in enumerate(roots):
        members[r].append(i)

    multi = [m for m in members.values() if len(m) > 1]
    cross_clusters, inflation, crown_nocrown, pair_counter = 0, 0, 0, Counter()
    for m in multi:
        srcs = set(src[i] for i in m)
        if len(srcs) > 1:
            cross_clusters += 1
            inflation += len(m) - 1  # collapsing the cluster removes (size-1) records
            for s in sorted(srcs):
                for s2 in sorted(srcs):
                    if s < s2:
                        pair_counter[(s, s2)] += 1
        crowns = [has_crown[i] for i in m]
        if any(crowns) and any(not c for c in crowns):
            crown_nocrown += 1

    lines = [
        "# Duplicate / near-coincident trees — diagnostic", "",
        f"_Read-only scan of {n:,} trees with coordinates. Cluster radius {CLUSTER_R:.0f} m._", "",
        "## Near-neighbour pairs by radius", "",
        "| Radius (m) | total pairs | cross-source | same-source | trees w/ a neighbour |",
        "|--:|--:|--:|--:|--:|",
        *[f"| {R:.0f} | {s['pairs']:,} | {s['cross']:,} | {s['same']:,} | {s['trees_with_neighbor']:,} |"
          for R, s in radius_stats.items()], "",
        "## Duplicate clusters @ {:.0f} m".format(CLUSTER_R), "",
        f"- Multi-record clusters: **{len(multi):,}**  (of which **{cross_clusters:,}** span >1 source)",
        f"- **Estimated duplicate inflation: {inflation:,} records** "
        f"(~{inflation/n:.1%} of the inventory) if each cross-source cluster collapses to one tree.",
        f"- Clusters with a crowned tree **and** a no-crown record together: **{crown_nocrown:,}** "
        f"(your observation — the same tree from two datasets, one carrying the crown).", "",
        "## Worst-colliding source pairs (cross-source clusters)", "",
        "| Source A | Source B | clusters |", "|---|---|--:|",
        *[f"| {a} | {b} | {c:,} |" for (a, b), c in pair_counter.most_common(12)], "",
        "---", "",
        "**Read:** cross-source pairs at ≤2 m are very likely one physical tree described by two "
        "datasets. **Fix (next):** a dedup/merge pass that collapses each cross-source cluster to a "
        "single record, keeping the highest-evidence source (field-verified > crowd > inferred > "
        "promoted) and the best geometry (the crowned record), re-pointing trajectories/valuation. "
        "This also cleans the WS2 `removed_to_open` set (a removed tree shouldn't sit next to a "
        "surviving duplicate).",
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"trees={n:,}")
    for R, s in radius_stats.items():
        print(f"  @{R:.0f}m: {s['pairs']:,} pairs ({s['cross']:,} cross-source)")
    print(f"cross-source clusters @{CLUSTER_R:.0f}m: {cross_clusters:,} | inflation ~{inflation:,} ({inflation/n:.1%})")
    print(f"crowned+no-crown clusters: {crown_nocrown:,}")
    print(f"top pairs: {pair_counter.most_common(5)}")
    print(f"report -> {OUT}")


if __name__ == "__main__":
    main()
