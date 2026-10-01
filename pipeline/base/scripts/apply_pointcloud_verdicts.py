#!/usr/bin/env python3
"""Apply point-cloud verdicts (tree_pointcloud_pilot) for false-positive control.

Two distinct actions, by record provenance:

1. LiDAR-inferred "trees" (source_primary = lidar_inferred_canopy) that the
   point cloud confirms are a building / structure with no woody canopy
   (pc_false_positive = 1) are DELETED from every per-tree table. These are
   machine detections the classified point cloud rejects — rooftops, ships,
   cranes, gantries wrongly picked up as canopy.

2. Authoritative council / survey records (tree register, notable, kauri,
   OSM) are NEVER deleted — they assert a real tree exists or existed. Where
   the point cloud finds no woody canopy over their footprint (especially the
   "no crown" set) we instead set a review flag, surfaced in the web profile:
       pc_review_no_canopy = 1
   so they can be checked rather than silently dropped.

Inferred detections are additionally deleted when they are physically
impossible or contradicted by water returns (moored ships/dredgers at the port
whose deck gear the LINZ classifier labels vegetation):

  * offshore — the point sits > OFFSHORE_MARGIN_M seaward of the LINZ Topo50
    coastline (trees do not grow in berths). The margin spares shoreline
    pohutukawa whose inferred point (crown centroid) overhangs the water.
  * water-under-"canopy" — >5% of footprint returns are class-9 water and the
    point cloud finds no woody canopy.

Idempotent: rerunnable. Run after build_tree_pointcloud_pilot.py and before the
web/pmtiles build so deletions and flags propagate.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQLITE_PATH = ROOT / "data" / "processed" / "akl_trees.sqlite"
INFERRED_SOURCE = "lidar_inferred_canopy"
COASTLINE = ROOT / "data" / "raw" / "linz" / "nz_coastline_polygons_auckland_isthmus_v1.geojson"
OFFSHORE_MARGIN_M = 10.0
WATER_FRACTION_MAX = 0.05


def offshore_inferred_ids(conn: sqlite3.Connection) -> list[str]:
    """tree_ids of inferred detections > OFFSHORE_MARGIN_M out to sea.
    Empty list (rule skipped) when the coastline layer isn't downloaded."""
    if not COASTLINE.exists():
        print(f"  (coastline layer missing, offshore rule skipped: {COASTLINE})")
        return []
    from pyproj import Transformer
    from shapely.geometry import shape, Point
    from shapely.ops import unary_union
    from shapely.prepared import prep

    land_parts = [shape(f["geometry"]) for f in
                  json.load(open(COASTLINE))["features"]]   # EPSG:2193
    land = prep(unary_union(land_parts).buffer(OFFSHORE_MARGIN_M))
    to2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    rows = conn.execute(
        f"""
        SELECT tree_id, lon, lat FROM trees
        WHERE source_primary = '{INFERRED_SOURCE}'
          AND lon IS NOT NULL AND lat IS NOT NULL
        """).fetchall()
    out = []
    for tid, lon, lat in rows:
        x, y = to2193.transform(lon, lat)
        if not land.contains(Point(x, y)):
            out.append(tid)
    return out


def tables_with_tree_id(conn: sqlite3.Connection) -> list[str]:
    out = []
    for (name,) in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall():
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({name})")}
        if "tree_id" in cols:
            out.append(name)
    return out


def main() -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        if not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tree_pointcloud_pilot'"
        ).fetchone():
            raise SystemExit("tree_pointcloud_pilot missing — run build_tree_pointcloud_pilot.py first")

        # ---- 1. Delete confirmed inferred false positives.
        fp_ids = [r[0] for r in conn.execute(
            f"""
            SELECT pc.tree_id
            FROM tree_pointcloud_pilot pc
            JOIN trees t ON t.tree_id = pc.tree_id
            WHERE t.source_primary = '{INFERRED_SOURCE}'
              AND (pc.pc_false_positive = 1
                   OR (pc.n_points >= 30 AND pc.pc_canopy_present = 0
                       AND CAST(pc.n_water AS REAL) / pc.n_points > {WATER_FRACTION_MAX}))
            """
        ).fetchall()]
        offshore = offshore_inferred_ids(conn)
        fp_ids = sorted(set(fp_ids) | set(offshore))
        print(f"Offshore inferred detections:     {len(offshore):,}")

        deleted = 0
        if fp_ids:
            tables = tables_with_tree_id(conn)
            conn.execute("CREATE TEMP TABLE _fp(tree_id TEXT PRIMARY KEY)")
            conn.executemany("INSERT OR IGNORE INTO _fp VALUES (?)", [(i,) for i in fp_ids])
            for tbl in tables:
                conn.execute(f"DELETE FROM {tbl} WHERE tree_id IN (SELECT tree_id FROM _fp)")
            conn.execute("DROP TABLE _fp")
            deleted = len(fp_ids)

        # ---- 2. Flag authoritative no-canopy records for review.
        # Add the column if missing (kept on tree_pointcloud_pilot so the
        # normalize step, which rebuilds `trees`, doesn't wipe it).
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tree_pointcloud_pilot)")}
        if "pc_review_no_canopy" not in cols:
            conn.execute("ALTER TABLE tree_pointcloud_pilot ADD COLUMN pc_review_no_canopy INTEGER DEFAULT 0")
        conn.execute("UPDATE tree_pointcloud_pilot SET pc_review_no_canopy = 0")
        conn.execute(
            f"""
            UPDATE tree_pointcloud_pilot
            SET pc_review_no_canopy = 1
            WHERE pc_canopy_present = 0
              AND n_points >= 30
              AND pointcloud_class IN ('building', 'structure', 'low_vegetation')
              AND tree_id IN (
                  SELECT tree_id FROM trees WHERE source_primary != '{INFERRED_SOURCE}'
              )
            """
        )
        conn.commit()

        # ---- Report.
        flagged = conn.execute(
            "SELECT COUNT(*) FROM tree_pointcloud_pilot WHERE pc_review_no_canopy = 1"
        ).fetchone()[0]
        rescued = conn.execute(
            f"""
            SELECT COUNT(*) FROM tree_pointcloud_pilot pc
            JOIN trees t ON t.tree_id = pc.tree_id
            LEFT JOIN tree_crown_pilot c ON c.tree_id = pc.tree_id
            WHERE pc.pc_canopy_present = 1 AND c.tree_id IS NULL
              AND t.source_primary != '{INFERRED_SOURCE}'
            """
        ).fetchone()[0]
        remaining = conn.execute(
            f"SELECT COUNT(*) FROM trees WHERE source_primary = '{INFERRED_SOURCE}'"
        ).fetchone()[0]
        print(f"Inferred false positives deleted: {deleted:,}")
        print(f"Inferred trees remaining:         {remaining:,}")
        print(f"No-canopy records flagged:        {flagged:,}")
        print(f"No-crown trees with canopy found: {rescued:,}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
