#!/usr/bin/env python3
"""Identify trees that are really one canopy split across several seed points.

The crown segmentation (`build_tree_crown_pilot.py`) is point-constrained: every
canopy pixel goes to its nearest seed. So wherever the *authoritative* inventory
has several points under one tree — duplicate council-register entries, multi-
stem records, clustered plantings — that single crown is sliced into Voronoi pie
pieces and the tree is double-counted. (The LiDAR-inferred points don't cause
this: they're spaced by non-max suppression.)

Proximity alone can't fix it — single-linkage at 2 m chains a whole avenue of
real street trees into one blob. The point cloud / CHM is the arbiter: two close
seeds are ONE tree only when the canopy *between* them stays high (no saddle to
the ground). Real neighbours have a saddle; duplicates don't.

This script is REPORT-ONLY. It finds the merge clusters and writes them to
`tree_crown_merge_pilot` (member -> primary), and prints the impact. It does NOT
modify `trees` or `tree_crown_pilot` — propagating the merge into the inventory
counts is a separate, confirmed step.

Saddle test uses the 1 m CHM (DSM-DEM) VRT, EPSG:2193.
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from scipy.spatial import cKDTree

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SQLITE_PATH = ROOT / "data" / "processed" / "akl_trees.sqlite"
_PILOT = active_pilot_name()
_SLUG = "waitemata_lidar_pilot" if _PILOT == "waitemata_v1" else f"{_PILOT}_lidar"
CHM_VRT = ROOT / "data" / "interim" / _SLUG / "chm.vrt"
INFERRED = "lidar_inferred_canopy"

MERGE_RADIUS_M = 1.6     # only very close seeds are merge candidates
SADDLE_FRAC = 0.60       # canopy between must stay >=60% of the shorter apex
MIN_CANOPY_M = 3.0       # both seeds must sit under real canopy to merge
N_INTERIOR = 4           # sample points along the segment between two seeds
# Continuous canopy across MANY clustered seeds is a hedge / formal planting /
# nursery row, not one tree — auto-merging it would erase real plants. Only
# small clusters auto-merge; bigger continuous-canopy groups are recorded as
# 'review_large' for manual eyes, never silently collapsed.
MAX_AUTO_MERGE_SIZE = 5
# Primary-seed preference when collapsing a cluster (keep the most authoritative
# record; the others are flagged as duplicate seeds, never deleted).
SOURCE_PRIORITY = {
    "notable_trees_overlay": 0,
    "ruru_obskauri_tiaki_public": 1,
    "tree_register_points": 2,
    "osm_natural_tree": 3,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def main() -> None:
    if not CHM_VRT.exists():
        raise SystemExit(f"CHM VRT not found: {CHM_VRT}")
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        f"""
        SELECT t.tree_id, t.source_primary src, l.x_2193 x, l.y_2193 y,
               c.crown_area_m2 area
        FROM trees t JOIN tree_lidar_pilot l ON l.tree_id = t.tree_id
        LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
        WHERE l.x_2193 IS NOT NULL AND l.y_2193 IS NOT NULL
          AND t.source_primary != '{INFERRED}'
        """
    ).fetchall()
    n = len(rows)
    xy = np.array([[r["x"], r["y"]] for r in rows], dtype="float64")
    print(f"{n:,} authoritative seeds", flush=True)

    kd = cKDTree(xy)
    pairs = kd.query_pairs(MERGE_RADIUS_M, output_type="ndarray")
    print(f"{len(pairs):,} candidate pairs within {MERGE_RADIUS_M} m", flush=True)
    if len(pairs) == 0:
        return

    # Batch-sample the CHM at both endpoints and N_INTERIOR points per pair.
    ts = np.linspace(0.0, 1.0, N_INTERIOR + 2)            # includes 0 and 1
    a = xy[pairs[:, 0]]
    b = xy[pairs[:, 1]]
    seg = (a[:, None, :] * (1 - ts)[None, :, None]
           + b[:, None, :] * ts[None, :, None])           # (P, S, 2)
    flat = seg.reshape(-1, 2)
    with rasterio.open(CHM_VRT) as src:
        nod = src.nodata
        h = np.array([v[0] for v in src.sample(flat)], dtype="float64")
    h = h.reshape(len(pairs), len(ts))
    if nod is not None:
        h[h == nod] = np.nan
    h[~np.isfinite(h)] = 0.0
    endpts = np.minimum(h[:, 0], h[:, -1])               # shorter apex
    interior_min = h[:, 1:-1].min(axis=1)
    confirm = (endpts >= MIN_CANOPY_M) & (interior_min >= SADDLE_FRAC * endpts)
    print(f"{int(confirm.sum()):,} pairs confirmed continuous canopy (merge)", flush=True)

    # Union-find over confirmed pairs only (so an avenue with saddles never
    # chains — each link must independently pass the canopy test).
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for (i, j), ok in zip(pairs, confirm):
        if ok:
            union(int(i), int(j))

    clusters: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        clusters[find(i)].append(i)
    multi = {root: members for root, members in clusters.items() if len(members) > 1}

    def prio(idx):
        r = rows[idx]
        return (SOURCE_PRIORITY.get(r["src"], 9), -(r["area"] or 0.0))

    merge_rows = []
    collapsed = 0
    size_hist = defaultdict(int)
    n_auto = n_review = 0
    created = utc_now()
    for ci, (root, members) in enumerate(multi.items(), 1):
        members_sorted = sorted(members, key=prio)
        primary = members_sorted[0]
        size_hist[len(members)] += 1
        merge_class = "auto" if len(members) <= MAX_AUTO_MERGE_SIZE else "review_large"
        if merge_class == "auto":
            collapsed += len(members) - 1
            n_auto += 1
        else:
            n_review += 1
        for m in members:
            merge_rows.append((
                f"merge_{ci:06d}", rows[primary]["tree_id"], rows[m]["tree_id"],
                rows[m]["src"], int(m == primary), len(members), merge_class, created,
            ))

    conn2 = sqlite3.connect(SQLITE_PATH)
    try:
        conn2.execute("DROP TABLE IF EXISTS tree_crown_merge_pilot")
        conn2.execute("""
            CREATE TABLE tree_crown_merge_pilot (
                cluster_id TEXT, primary_tree_id TEXT, member_tree_id TEXT,
                member_source TEXT, is_primary INTEGER, cluster_size INTEGER,
                merge_class TEXT, created_at_utc TEXT, PRIMARY KEY (member_tree_id)
            )""")
        conn2.executemany(
            "INSERT OR REPLACE INTO tree_crown_merge_pilot VALUES (?,?,?,?,?,?,?,?)",
            merge_rows)
        conn2.commit()
    finally:
        conn2.close()
    conn.close()

    print(f"\nMerge clusters: {len(multi):,}  (auto {n_auto:,}, review_large {n_review:,})")
    print(f"Auto-merge collapses {collapsed:,} duplicate seeds "
          f"({100*collapsed/n:.1f}% of authoritative seeds)")
    print("Cluster size distribution:",
          {k: size_hist[k] for k in sorted(size_hist)})
    print("Wrote tree_crown_merge_pilot (report only; inventory unchanged).")


if __name__ == "__main__":
    main()
