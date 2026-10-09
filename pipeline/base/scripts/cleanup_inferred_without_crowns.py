#!/usr/bin/env python3
"""Report unlinked LiDAR records; never delete an identity for missing geometry.

Kept under the old command name because pipeline recipes still invoke it.
A segmentation can miss, split or offset a crown. That is not evidence that
an earlier detection or its measurements should be erased. Versioned crown
association and display logic decide what is current; raw records remain.
"""
from __future__ import annotations
import argparse
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQLITE_PATH = ROOT / "data" / "processed" / "akl_trees.sqlite"


def report(path):
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as c:
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "tree_evidence_v5" in tables:
            join = "LEFT JOIN tree_evidence_v5 e USING(tree_id)"
            missing = "(e.seg_key IS NULL)"
            basis = "V5 crown association"
        elif "tree_evidence_v4" in tables:
            join = "LEFT JOIN tree_evidence_v4 e USING(tree_id)"
            missing = "(e.seg_key IS NULL)"
            basis = "V4 crown association"
        elif "tree_crown_v4_links" in tables:
            join = "LEFT JOIN tree_crown_v4_links e USING(tree_id)"
            missing = "(e.seg_key IS NULL)"
            basis = "V4 crown association"
        else:
            join = "LEFT JOIN tree_crown_pilot e USING(tree_id)"
            missing = "(e.tree_id IS NULL)"
            basis = "Legacy crown association"
        sources = ("lidar_inferred_canopy", "lidar_pointcloud_v4", "lidar_pointcloud_v5",
                   "low_canopy_promoted", "pointcloud_missed_promoted")
        counts = dict(c.execute("SELECT t.source_primary,count(*) FROM trees t " + join +
            " WHERE t.source_primary IN (" + ",".join("?" for _ in sources) + ") AND " + missing +
            " GROUP BY t.source_primary", sources))
    return {"basis": basis, "unlinked_records_by_source": counts, "records_deleted": 0,
            "meaning": "No current crown association; not evidence of tree absence.",
            "next_step": "Audit continuity and source position; retain identity and all dated measurements."}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=SQLITE_PATH)
    print(json.dumps(report(ap.parse_args().db), indent=2))
