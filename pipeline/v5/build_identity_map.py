#!/usr/bin/env python3
"""Carry v4 tree identity forward into the new segmentation.

ALTO holds 1.6M register links, KYTE observations, DPS frozen measurements and the
ground evidence published from field visits, all keyed to v4 tree ids. A new
segmentation produces new objects with no inherent relationship to those ids, so without
a mapping every measurement ever collected is orphaned — and the premise that this gets
better as KYTE gathers data fails at the first re-run.

The mapping is not one to one, and saying how it fails is the point:

  matched      one v4 tree inside one new crown. The id carries over.
  merged       several v4 trees inside one new crown. This is the fix working: v4 split
               one tree into fragments. One id becomes primary, the rest are recorded as
               superseded by it rather than deleted, so anything pointing at them can be
               followed forward.
  split        one v4 tree spanning several new crowns. The opposite case, rare, and
               genuinely ambiguous: the id goes to the largest crown and the others are
               flagged for review rather than silently inheriting it.
  unmatched    no new crown at that position. Either v4 detected something that is not
               there, or this run missed a real tree. Recorded, never dropped.

Nothing is deleted. A v4 id that loses its tree keeps a row saying so, because the
alternative is a dangling reference in a published dataset.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

import numpy as np

V4DB = Path("/data/alto/working/alto_v4_20260917/akl_trees.sqlite")


def load_new(crowns_dir: Path):
    """New crowns as arrays. Works with the centroid output or the full parquet one."""
    xs, ys, ar, hs, cls, tile = [], [], [], [], [], []
    files = sorted(crowns_dir.glob("*.parquet")) or sorted(crowns_dir.glob("*.jsonl"))
    for f in files:
        if f.suffix == ".parquet":
            import pandas as pd
            d = pd.read_parquet(f, columns=["x_2193", "y_2193", "crown_area_m2",
                                            "height_m", "canopy_class", "tile"])
            xs += d.x_2193.tolist(); ys += d.y_2193.tolist(); ar += d.crown_area_m2.tolist()
            hs += d.height_m.tolist(); cls += d.canopy_class.tolist(); tile += d.tile.tolist()
        else:
            for line in f.read_text().splitlines():
                if not line.strip():
                    continue
                r = json.loads(line)
                xs.append(r["x_2193"]); ys.append(r["y_2193"]); ar.append(r["crown_area_m2"])
                hs.append(r["height_m"]); cls.append(r["canopy_class"]); tile.append(r["tile"])
    return (np.array(xs), np.array(ys), np.array(ar), np.array(hs),
            np.array(cls), np.array(tile))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--crowns", default="/data/alto/working/crowns_v5/crowns")
    ap.add_argument("--out", default="/data/alto/working/identity_v4_to_v5.jsonl")
    a = ap.parse_args()

    X, Y, A, H, C, T = load_new(Path(a.crowns))
    print(f"new crowns: {len(X):,}")
    # equivalent radius, so a v4 point is judged against the crown it would sit in
    R = np.sqrt(np.maximum(A, 0.25) / np.pi)

    from scipy.spatial import cKDTree
    tree = cKDTree(np.column_stack([X, Y]))

    db = sqlite3.connect(f"file:{V4DB}?mode=ro", uri=True)
    v4 = list(db.execute(
        "select primary_tree_id, x_2193, y_2193, height_m, crown_area_m2 "
        "from tree_crown_v4 where x_2193 is not null"))
    print(f"v4 crowns: {len(v4):,}")

    # a v4 point belongs to a new crown when it lies within that crown's equivalent
    # radius; among candidates, the nearest wins
    vx = np.array([r[1] for r in v4]); vy = np.array([r[2] for r in v4])
    cand = tree.query_ball_point(np.column_stack([vx, vy]), r=float(R.max()))
    assign = np.full(len(v4), -1, dtype=np.int64)
    for i, idxs in enumerate(cand):
        if not idxs:
            continue
        idxs = np.asarray(idxs)
        d = np.hypot(X[idxs] - vx[i], Y[idxs] - vy[i])
        ok = d <= R[idxs]
        if not ok.any():
            continue
        assign[i] = idxs[ok][int(np.argmin(d[ok]))]

    by_new = defaultdict(list)
    for i, j in enumerate(assign):
        if j >= 0:
            by_new[int(j)].append(i)

    counts = defaultdict(int)
    with open(a.out, "w") as fh:
        for i, r in enumerate(v4):
            tid, x, y, h, area = r
            j = int(assign[i])
            if j < 0:
                rec = {"v4_tree_id": tid, "relation": "unmatched", "v5_crown": None,
                       "note": "no new crown covers this position"}
            else:
                group = by_new[j]
                key = f"{T[j]}:{X[j]:.2f}:{Y[j]:.2f}"
                if len(group) == 1:
                    rel = "matched"
                    primary = True
                else:
                    rel = "merged"
                    # the v4 fragment with the largest crown becomes the surviving id
                    areas = [v4[k][4] or 0 for k in group]
                    primary = (i == group[int(np.argmax(areas))])
                rec = {"v4_tree_id": tid, "relation": rel, "v5_crown": key,
                       "v5_canopy_class": str(C[j]),
                       "v5_crown_area_m2": float(A[j]), "v5_height_m": float(H[j]),
                       "primary": bool(primary),
                       "n_v4_in_this_crown": len(group)}
                if rel == "merged" and not primary:
                    k = group[int(np.argmax([v4[q][4] or 0 for q in group]))]
                    rec["superseded_by"] = v4[k][0]
            counts[rec["relation"]] += 1
            fh.write(json.dumps(rec) + "\n")

    used = set(by_new)
    print("\nrelation counts:")
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {k:12} {v:9,} ({v/len(v4):6.1%})")
    print(f"\nnew crowns with no v4 tree: {len(X) - len(used):,} ({1 - len(used)/len(X):.1%})")
    print(f"written to {a.out}")


if __name__ == "__main__":
    main()
