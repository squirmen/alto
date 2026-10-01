#!/usr/bin/env python3
"""Headline totals and release metadata for the v4 bundle.

    python release_meta_v4.py totals  OUT_totals.json
    python release_meta_v4.py meta    LIVE_release-metadata.json OUT.json totals.json VERSION
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

W = Path("/data/alto/working/alto_v4_20260917")
DB = Path(os.environ.get("V4_DB", str(W / "akl_trees.sqlite")))
BUILD = Path(os.environ.get("V4_BUILD", str(W / "web_build")))
DETECTION_SOURCES = ("lidar_inferred_canopy", "lidar_pointcloud_v4", "low_canopy_promoted", "pointcloud_missed_promoted")


def count_lines(path):
    n = 0
    with open(path, "rb") as fh:
        for _ in fh:
            n += 1
    return n


def totals(out):
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    q = lambda sql, *a: c.execute(sql, a).fetchone()  # noqa: E731
    val = q("SELECT ROUND(SUM(total_value_nzd_y)), ROUND(SUM(avoided_runoff_m3_y)), ROUND(SUM(stored_co2e_tonnes_est)) "
            "FROM tree_valuation_pilot")
    tiers = dict(c.execute("SELECT evidence_tier, COUNT(*) FROM tree_evidence_v4 GROUP BY 1").fetchall())
    t = dict(
        trees=count_lines(BUILD / "points.geojsonl"),
        crowns=count_lines(BUILD / "crowns.geojsonl") + (count_lines(BUILD / "crowns_legacy.geojsonl") if (BUILD / "crowns_legacy.geojsonl").exists() else 0),
        protected=q("SELECT COUNT(*) FROM trees WHERE is_protected_notable = 1")[0],
        detections=q(f"SELECT COUNT(*) FROM trees WHERE source_primary IN ({','.join('?' * len(DETECTION_SOURCES))})",
                     *DETECTION_SOURCES)[0],
        new_pointcloud_trees=q("SELECT COUNT(*) FROM trees WHERE source_primary = 'lidar_pointcloud_v4'")[0],
        restored=q("SELECT COUNT(*) FROM tree_restoration_log")[0],
        crowns_v4=q("SELECT COUNT(*) FROM tree_crown_v4")[0],
        total_value_nzd_y=int(val[0] or 0), runoff_m3_y=int(val[1] or 0), carbon_tco2e=int(val[2] or 0),
        evidence_tiers=tiers,
    )
    Path(out).write_text(json.dumps(t, indent=2))
    print(json.dumps(t, indent=2))


def meta(live, out, totals_path, version):
    m = json.loads(Path(live).read_text())
    t = json.loads(Path(totals_path).read_text())
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rel = m.setdefault("release", {})
    rel["dataset_version"] = f"metro-{now[:10].replace('-', '.')}-pointcloud-v4"
    rel["dataset_last_updated_utc"] = now
    rel["metadata_generated_utc"] = now
    rel["source_revision"] = "uncommitted working build (alto_v4_20260917)"
    ds = m.setdefault("dataset", {})
    ds["tree_records"] = t["trees"]
    ds["crown_records"] = t["crowns"]
    ds["pointcloud_v4_crowns"] = t["crowns_v4"]
    ds["new_pointcloud_tree_records"] = t["new_pointcloud_trees"]
    ds["restored_records"] = t["restored"]
    ds["evidence_tiers"] = t["evidence_tiers"]
    for model in m.get("models", []):
        if model.get("component") == "crown_segmentation":
            ids = [i.get("id") for i in model.get("implementations", [])]
            if "pointcloud_v4_vegetation_watershed" not in ids:
                model.setdefault("implementations", []).append({"id": "pointcloud_v4_vegetation_watershed"})
    m["v4_changes"] = [
        "Every vegetation crown at least 3 m tall in the 2024 point cloud is on the map, labelled very likely, probably or possibly a tree.",
        "Crown outlines are traced from the 2024 vegetation returns instead of being cut around the nearest tree point.",
        f"{t['restored']:,} island and shoreline detections deleted by a coastline layer without the islands are restored.",
        "Existing records are kept; detections the 2024 survey does not support are labelled unverified, and likely duplicates are labelled rather than removed.",
        "Removals inside the Port of Auckland container terminals are shown as unverified structures.",
        "Service totals do not yet include the new point-cloud trees, which have no modelled services.",
    ]
    m.setdefault("assembly", {})["assembled_utc"] = now
    m["assembly"]["tile_version"] = version
    Path(out).write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
    print(f"release metadata -> {out}")


if __name__ == "__main__":
    if sys.argv[1] == "totals":
        totals(sys.argv[2])
    else:
        meta(*sys.argv[2:6])
