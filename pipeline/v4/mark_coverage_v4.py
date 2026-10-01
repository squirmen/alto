#!/usr/bin/env python3
"""Label records that the 2024 point cloud used for v4 does not cover.

About 64 km2 of the metro area (mainly the eastern edge from Whitford to Maraetai,
and a small patch near the airport) has no downloaded point-cloud tile. Detections
there could not be checked, so they are 'not_assessed' rather than 'unverified';
recorded trees keep 'recorded' with a coverage note. Updates tree_evidence_v4 only.
"""
import json
import os
import sqlite3
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import box
from shapely.ops import unary_union

W = Path("/data/alto/working/alto_v4_20260917")
DB = Path(os.environ.get("V4_DB", str(W / "akl_trees.sqlite")))
NOTE = "outside the 2024 point-cloud coverage used for this release"

man = [json.loads(l) for l in open("/data/alto/point_cloud_2024/auckland_metro_v1/manifest.jsonl")]
cov = unary_union([box(*r["bbox_2193"][-4:]) for r in man])
shapely.prepare(cov)
ex = pq.read_table(W / "existing.parquet", columns=["tree_id", "kind", "x", "y"]).to_pandas()
outside = ~shapely.contains_xy(cov, ex.x.to_numpy(), ex.y.to_numpy())
ids_det = ex.tree_id[outside & (ex.kind != 0)].tolist()
ids_inv = ex.tree_id[outside & (ex.kind == 0)].tolist()

conn = sqlite3.connect(DB)
conn.execute("CREATE TEMP TABLE _out(tree_id TEXT PRIMARY KEY, inv INTEGER)")
conn.executemany("INSERT INTO _out VALUES (?, 0)", [(i,) for i in ids_det])
conn.executemany("INSERT INTO _out VALUES (?, 1)", [(i,) for i in ids_inv])
det = conn.execute(f"""UPDATE tree_evidence_v4 SET evidence_tier = 'not_assessed', evidence_reasons = '{NOTE}'
    WHERE evidence_tier = 'unverified' AND tree_id IN (SELECT tree_id FROM _out WHERE inv = 0)""").rowcount
inv = conn.execute(f"""UPDATE tree_evidence_v4 SET evidence_reasons = '{NOTE}'
    WHERE seg_key IS NULL AND tree_id IN (SELECT tree_id FROM _out WHERE inv = 1)""").rowcount
conn.commit()
tiers = dict(conn.execute("SELECT evidence_tier, COUNT(*) FROM tree_evidence_v4 GROUP BY 1").fetchall())
conn.close()
print(json.dumps({"coverage_gap_detections_relabelled": det, "coverage_gap_recorded_notes": inv, "tiers": tiers}, indent=2))
