#!/usr/bin/env python3
"""Present the v5 crowns in the shape the existing release pipeline already reads.

build_db_v4.py folds crowns into the database, links council records to the crown they
fall in, mints trees for unclaimed crowns and writes evidence tiers — and it takes its
input directory from TILES_DIR. So the v5 run does not need a parallel pipeline, only a
translation: the same columns under the names that pipeline expects, plus the links file
it reads alongside each tile.

  seg_key      the half-metre grid key v4 uses, round(x*2)_round(y*2)
  gli/img_gli  v4's two greenness channels. gli keeps excess green so the column means
               what it always meant; img_gli carries NDVI, which is the better signal and
               did not exist in v4.
  hedge_frac   v4 computes this and reports a median of 0. Not reproduced; written as 0
               rather than guessed, so nothing downstream reads an invented number.
  links        each existing record matched to the crown whose polygon contains it,
               which is what v4's detector emitted per tile.

The height bands are a judgement, not a measurement. A tree in the reference labels starts
about 3 m because that is where the labellers stopped drawing, and plenty of what falls
below that line is a real young tree. So all three classes are published with their full
attributes and the map carries a switch for each; only the tree class feeds counts,
valuation and the service estimates, which is the same treatment ALTO already gives its
low-canopy candidates.
"""
from __future__ import annotations

import argparse
import json
from notable_location_policy import DEFAULT_SOURCE, load_locations, prepare_existing, unique_covering_crown
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

COLS = ["seg_key", "x", "y", "height_m", "area_m2", "mean_veg_hag_m", "n_veg", "n_bldg",
        "n_uncl", "n_bridge", "n_water", "n_ground", "multi_return", "intensity",
        "gli", "img_gli", "elong", "fill", "hedge_frac", "gap_frac", "crown_wkb"]

RENAME = {"x_2193": "x", "y_2193": "y", "crown_area_m2": "area_m2",
          "mean_veg_height_m": "mean_veg_hag_m", "n_veg_returns": "n_veg",
          "n_building_returns": "n_bldg", "n_unclassified_returns": "n_uncl",
          "n_bridge_returns": "n_bridge", "n_water_returns": "n_water",
          "n_ground_returns": "n_ground", "multi_return_fraction": "multi_return",
          "intensity_mean": "intensity", "aerial_greenness": "gli",
          "ndvi_mean": "img_gli", "elongation": "elong", "bbox_fill": "fill",
          "gap_filled_fraction": "gap_frac"}


def seg_key(x, y):
    return (np.rint(x * 2).astype(np.int64).astype(str) + "_" +
            np.rint(y * 2).astype(np.int64).astype(str))


def convert(src: Path, out: Path, near: Path, existing: pd.DataFrame, strtree, idx_map):
    from shapely import wkb as shapely_wkb
    from shapely.geometry import Point
    if "location_match_allowed" not in existing.columns:
        raise ValueError("Call prepare_existing with source location metadata before converting tiles")
    d = pd.read_parquet(src)
    if d.empty:
        return 0, 0, 0
    d["seg_key"] = seg_key(d.x_2193.values, d.y_2193.values)
    d = d.rename(columns=RENAME)
    d["hedge_frac"] = 0.0
    for c in COLS:
        if c not in d.columns:
            d[c] = None

    trees = d[d.canopy_class == "tree"]
    other = d[d.canopy_class != "tree"]
    out.mkdir(parents=True, exist_ok=True)
    near.mkdir(parents=True, exist_ok=True)
    stem = src.stem
    trees[COLS].to_parquet(out / f"{stem}.crowns.parquet", index=False)
    if len(other):
        # published, not filed away: same columns as a tree plus the class, so the map
        # can show them and a reviewer can judge them on the same evidence
        other[COLS + ["canopy_class"]].to_parquet(near / f"{stem}.parquet", index=False)

    # links: an existing record belongs to the crown whose polygon contains it
    rows = []
    ambiguous = []
    if len(trees):
        polys = [shapely_wkb.loads(w) for w in trees.crown_wkb]
        minx = min(p.bounds[0] for p in polys); miny = min(p.bounds[1] for p in polys)
        maxx = max(p.bounds[2] for p in polys); maxy = max(p.bounds[3] for p in polys)
        m = ((existing.x >= minx) & (existing.x <= maxx) &
             (existing.y >= miny) & (existing.y <= maxy))
        sub = existing[m & existing.location_match_allowed]
        if len(sub):
            from shapely.strtree import STRtree
            tr = STRtree(polys)
            keys = trees.seg_key.values
            cx = trees.x.values; cy = trees.y.values
            for ei, px, py in zip(sub.exist_idx.values, sub.x.values, sub.y.values):
                pt = Point(px, py)
                j, review_reason = unique_covering_crown(pt, polys, tr)
                if j is not None:
                    # dist_m is distance to the polygon; build_db computes top_dist.
                    rows.append((int(ei), keys[j], 0.0))
                elif review_reason == "multiple_covering_crowns":
                    ambiguous.append({"exist_idx": int(ei), "reason": review_reason})
    pd.DataFrame(rows, columns=["exist_idx", "seg_key", "dist_m"]).to_parquet(
        out / f"{stem}.links.parquet", index=False)
    (out / f"{stem}.location-review.json").write_text(json.dumps(ambiguous, indent=2))
    return len(trees), len(other), len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/data/alto/working/crowns_v5_full/crowns")
    ap.add_argument("--out", default="/data/alto/working/crowns_v5_full/tiles_v5")
    ap.add_argument("--near", default="/data/alto/working/crowns_v5_full/near_canopy")
    ap.add_argument("--existing", default="/data/alto/working/alto_v4_20260917/existing.parquet")
    ap.add_argument("--notable-source", default=str(DEFAULT_SOURCE))
    a = ap.parse_args()

    ex = pq.read_table(a.existing, columns=["exist_idx", "tree_id", "source_primary", "x", "y"]).to_pandas()
    ex = prepare_existing(ex.dropna(subset=["x", "y"]), load_locations(a.notable_source))
    Path(a.out).mkdir(parents=True, exist_ok=True)
    blocked = ex[~ex.location_match_allowed][["tree_id", "exist_idx", "location_review_reason"]]
    (Path(a.out) / "notable-location-review.json").write_text(blocked.to_json(orient="records", indent=2))
    print(f"Uncertain notable positions withheld from automatic matching: {len(blocked):,}")
    print(f"existing records: {len(ex):,}")
    src = sorted(Path(a.src).glob("*.parquet"))
    print(f"tiles to convert: {len(src)}")
    T = O = L = 0
    for i, f in enumerate(src, 1):
        t, o, l = convert(f, Path(a.out), Path(a.near), ex, None, None)
        T += t; O += o; L += l
        if i % 200 == 0 or i == len(src):
            print(f"  [{i}/{len(src)}] trees {T:,}  near-canopy {O:,}  links {L:,}", flush=True)
    print(f"\ntree crowns {T:,}\nnear-canopy crowns {O:,}\nrecord links {L:,}")


if __name__ == "__main__":
    main()
