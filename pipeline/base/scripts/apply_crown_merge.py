#!/usr/bin/env python3
"""Propagate the confirmed crown-merge clusters into the inventory outputs.

Reads `tree_crown_merge_pilot` (written by `merge_split_crowns.py`) and, for each
`merge_class = 'auto'` cluster, treats the non-primary members as duplicate seeds
of one tree:

  * FLAG (never delete) the authoritative duplicate records: set
    is_duplicate_seed = 1 and merged_into_tree_id on tree_pointcloud_pilot (which
    survives the normalize rebuild, like pc_review_no_canopy). The web points
    layer and the headline totals exclude these.
  * MERGE the Voronoi-split crown polygons into the primary so the map shows one
    continuous crown with no gap: union the member geometries, recompute area /
    diameter, drop the member crown rows + features. (Crowns are derived data,
    not authoritative — safe to recompute.)

'review_large' clusters (hedges / formal plantings) are left completely alone.

Idempotent: rerunnable. Run after merge_split_crowns.py, before build_web_geojson.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, transform as shapely_transform

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
SQLITE_PATH = PROCESSED / "akl_trees.sqlite"
CROWNS_GEOJSON = PROCESSED / "tree_crowns_pilot.geojson"
TO_2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)


def main() -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tree_crown_merge_pilot'"
    ).fetchone():
        raise SystemExit("tree_crown_merge_pilot missing — run merge_split_crowns.py first")

    rows = conn.execute(
        """SELECT cluster_id, primary_tree_id, member_tree_id, is_primary
           FROM tree_crown_merge_pilot WHERE merge_class='auto'"""
    ).fetchall()
    clusters: dict[str, dict] = defaultdict(lambda: {"primary": None, "members": []})
    for cid, primary, member, is_primary in rows:
        clusters[cid]["primary"] = primary
        clusters[cid]["members"].append(member)
    dup_ids = {m for c in clusters.values() for m in c["members"] if m != c["primary"]}
    primaries = {c["primary"] for c in clusters.values()}
    print(f"{len(clusters):,} auto clusters, {len(dup_ids):,} duplicate seeds to flag")

    # ---- 1. Flag duplicates (reversible) on tree_pointcloud_pilot.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(tree_pointcloud_pilot)")}
    if "is_duplicate_seed" not in cols:
        conn.execute("ALTER TABLE tree_pointcloud_pilot ADD COLUMN is_duplicate_seed INTEGER DEFAULT 0")
    if "merged_into_tree_id" not in cols:
        conn.execute("ALTER TABLE tree_pointcloud_pilot ADD COLUMN merged_into_tree_id TEXT")
    conn.execute("UPDATE tree_pointcloud_pilot SET is_duplicate_seed=0, merged_into_tree_id=NULL")
    for c in clusters.values():
        for m in c["members"]:
            if m != c["primary"]:
                conn.execute(
                    "UPDATE tree_pointcloud_pilot SET is_duplicate_seed=1, merged_into_tree_id=? WHERE tree_id=?",
                    (c["primary"], m))
    conn.commit()

    # ---- 2. Merge crown geometry into the primary in the GeoJSON.
    data = json.loads(CROWNS_GEOJSON.read_text(encoding="utf-8"))
    by_id = {f.get("id") or f["properties"].get("tree_id"): f for f in data["features"]}
    member_to_primary = {m: c["primary"] for c in clusters.values() for m in c["members"]}

    # Gather member geometries per primary (2193 for area, keep 4326 for file).
    geom4326_by_primary: dict[str, list] = defaultdict(list)
    props_by_primary: dict[str, dict] = {}
    for tid, feat in by_id.items():
        prim = member_to_primary.get(tid)
        if prim is None:
            continue
        g = feat.get("geometry")
        if g:
            geom4326_by_primary[prim].append(shape(g))
        if tid == prim:
            props_by_primary[prim] = feat["properties"]

    merged_features, dropped = [], 0
    for tid, feat in by_id.items():
        if tid in dup_ids:
            dropped += 1
            continue  # member crown folded into its primary below
        if tid in geom4326_by_primary and len(geom4326_by_primary[tid]) > 0:
            union4326 = unary_union(geom4326_by_primary[tid])
            union2193 = shapely_transform(TO_2193.transform, union4326)
            area = float(union2193.area)
            props = dict(feat["properties"])
            props["crown_area_m2"] = round(area, 1)
            props["crown_diameter_m"] = round(2 * math.sqrt(area / math.pi), 1)
            merged_features.append({"type": "Feature", "id": tid,
                                    "properties": props, "geometry": mapping(union4326)})
        else:
            merged_features.append(feat)
    data["features"] = merged_features
    CROWNS_GEOJSON.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"crowns geojson: dropped {dropped:,} member features, merged into primaries")

    # ---- 3. tree_crown_pilot table: delete duplicate crown rows, update primary
    # area/diameter from the merged geometry.
    conn.executemany("DELETE FROM tree_crown_pilot WHERE tree_id=?",
                     [(m,) for m in dup_ids])
    for f in merged_features:
        if f["id"] in primaries:
            conn.execute(
                "UPDATE tree_crown_pilot SET crown_area_m2=?, crown_diameter_m=? WHERE tree_id=?",
                (f["properties"].get("crown_area_m2"),
                 f["properties"].get("crown_diameter_m"), f["id"]))
    conn.commit()

    remaining_crowns = conn.execute("SELECT COUNT(*) FROM tree_crown_pilot").fetchone()[0]
    flagged = conn.execute(
        "SELECT COUNT(*) FROM tree_pointcloud_pilot WHERE is_duplicate_seed=1").fetchone()[0]
    conn.close()
    print(f"Duplicate seeds flagged (hidden from counts/map): {flagged:,}")
    print(f"tree_crown_pilot rows now: {remaining_crowns:,}")
    print("Inventory records preserved (flagged, reversible); crowns merged.")


if __name__ == "__main__":
    main()
