#!/usr/bin/env python3
"""Score detector settings against council register trees in the calibration tiles.

recall  : register trees >= 3 m tall (2024 surface model) linked to a crown
split   : isolated register trees >= 5 m -> crown tops within 4 m (1.0 is ideal)
merge   : register neighbours 4-9 m apart, both >= 5 m -> same crown (lower is better)
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from scipy.spatial import cKDTree

W = Path("/data/alto/working/alto_v4_20260917")
METRO = (1740000, 5895000, 1782000, 5935000)
tiles = [t.strip() for t in (W / "calib/tiles.txt").read_text().split() if t.strip()]
man = {json.loads(l)["tile"]: json.loads(l)["bbox_2193"][-4:]
       for l in open("/data/alto/point_cloud_2024/auckland_metro_v1/manifest.jsonl")}
ex = pq.read_table(W / "existing.parquet").to_pandas()
core = np.zeros(len(ex), bool)
for t in tiles:
    x0, y0, x1, y1 = man[t]
    core |= (ex.x >= x0) & (ex.x < x1) & (ex.y >= y0) & (ex.y < y1)
reg = ex[core & (ex.source_primary == "tree_register_points")]
inv_all = ex[ex.kind == 0]
inv_kd = cKDTree(inv_all[["x", "y"]].to_numpy())
area_ha = sum((man[t][2] - man[t][0]) * (man[t][3] - man[t][1]) for t in tiles) / 1e4

sets = sys.argv[1:] or sorted(p.name for p in (W / "calib").iterdir() if p.is_dir() and p.name != "test")
print(f"{len(tiles)} tiles ({area_ha:.0f} ha); register trees in cores: {len(reg):,}")
for s in sets:
    d = W / "calib" / s
    cr = [pq.read_table(p).to_pandas() for p in d.glob("*.crowns.parquet")]
    lk = [pq.read_table(p).to_pandas() for p in d.glob("*.links.parquet")]
    if len(cr) < len(tiles):
        print(f"{s}: incomplete ({len(cr)}/{len(tiles)} tiles)")
        continue
    cr = pd.concat(cr, ignore_index=True)
    lk = pd.concat(lk, ignore_index=True).sort_values("dist_m").drop_duplicates("exist_idx")
    link = dict(zip(lk.exist_idx, lk.seg_key))
    r3 = reg[reg.chm_local_max_2m_m >= 3]
    recall = np.mean([i in link for i in r3.exist_idx])
    r5 = reg[reg.chm_local_max_2m_m >= 5]
    xy5 = r5[["x", "y"]].to_numpy()
    nn = inv_kd.query(xy5, k=2)[0][:, 1]
    iso = xy5[nn > 15]
    tops = cKDTree(cr[["x", "y"]].to_numpy())
    counts = np.array([len(v) for v in tops.query_ball_point(iso, 4.0)]) if len(iso) else np.array([0])
    kd5 = cKDTree(xy5)
    pairs = [(i, j) for i, j in kd5.query_pairs(9.0) if np.hypot(*(xy5[i] - xy5[j])) >= 4.0]
    ids5 = r5.exist_idx.to_numpy()
    both = [(ids5[i], ids5[j]) for i, j in pairs if ids5[i] in link and ids5[j] in link]
    merge = np.mean([link[a] == link[b] for a, b in both]) if both else float("nan")
    log = [json.loads(l) for l in open(d / "run_log.jsonl")]
    secs = np.mean([r["secs"] for r in log if "secs" in r])
    tim = pd.DataFrame([r.get("timing", {}) for r in log]).mean().round(1).to_dict()
    print(f"{s:4s} crowns {len(cr):6,} ({len(cr)/area_ha:5.1f}/ha, median {cr.area_m2.median():4.0f} m2, "
          f"{(cr.height_m < 5).mean():.0%} under 5 m) | recall {recall:.1%} | split: tops within 4 m of isolated "
          f"trees mean {counts.mean():.2f}, >=2 {np.mean(counts >= 2):.0%} (n={len(iso)}) | merge {merge:.0%} "
          f"(pairs {len(both)}) | {secs:.1f} s/tile {tim}")
