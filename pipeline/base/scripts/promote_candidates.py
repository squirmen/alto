#!/usr/bin/env python3
"""Promote accepted point-cloud candidates to full inventory trees.

Two candidate sources become real, counted trees:
  * high-confidence missed trees (`tree_pointcloud_missed_pilot`,
    confidence_tier = 'high');
  * non-hedge low-canopy candidates (`tree_low_canopy_candidates`,
    is_hedge = 0) at or above LOW_CANOPY_MIN_SCORE.

For each we insert a `trees` row (source tagged so they're identifiable and
reversible), a `tree_lidar_pilot` sample (so crown/valuation joins resolve),
and a crown record. Crowns are approximated as circles sized from the canopy
patch (missed) or a height-scaled radius (low-canopy) — these are small trees
where a circular crown is a fair v1; the polygons are appended to
tree_crowns_pilot.geojson so the crown layer shows them.

After this, re-run build_tree_valuation.py (values the new trees), then refresh
totals + rebuild web. Idempotent: prior promotions (by source tag) are removed
first so reruns don't double-insert.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, mapping
from shapely.ops import transform as shapely_transform

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
SQLITE_PATH = PROCESSED / "akl_trees.sqlite"
CROWNS_GEOJSON = PROCESSED / "tree_crowns_pilot.geojson"


def _web_geojson_helpers():
    """Borrow the streaming reader/writer from the web build.

    The crown intermediate is a single multi-gigabyte line, so rewriting it with
    json.loads needs the whole document in memory at once.
    """
    spec = importlib.util.spec_from_file_location(
        "build_web_geojson", ROOT / "scripts" / "build_web_geojson.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.iter_geojson_features, module.FeatureWriter


def has_table(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(r[1] == column for r in conn.execute(f"PRAGMA table_info('{table}')"))
TO_2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
TO_4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)

LOW_CANOPY_MIN_SCORE = 0.60          # promotion bar (user-chosen: medium)
SRC_MISSED = "pointcloud_missed_promoted"
SRC_LOW = "low_canopy_promoted"
PROMOTED_SOURCES = (SRC_MISSED, SRC_LOW)
M_PER_DEG_LAT = 111_132.0
LAT0 = -36.85
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def crown_radius_for_height(h: float) -> float:
    """Match build_tree_crown_pilot's height→radius for small trees."""
    if h is None or not math.isfinite(h):
        return 2.0
    return float(min(max(h * 0.45, 1.2), 5.0))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=SQLITE_PATH,
                    help="database to write to; point this at a working copy")
    ap.add_argument("--crowns", type=Path, default=None,
                    help="crown GeoJSON to append to (default: alongside --db)")
    ap.add_argument("--min-score", type=float, default=LOW_CANOPY_MIN_SCORE)
    ap.add_argument("--exclude-buildings", type=Path,
                    default=ROOT / "data" / "raw" / "linz_buildings" / "nz_building_outlines.gpkg",
                    help="polygon layer whose interiors are dropped; pass a missing "
                         "path to skip")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be promoted and write nothing")
    args = ap.parse_args()

    crowns_path = args.crowns or (args.db.parent / CROWNS_GEOJSON.name)
    print(f"database: {args.db}")
    print(f"crowns:   {crowns_path}")
    if args.dry_run:
        print("DRY RUN - nothing will be written\n")

    conn = sqlite3.connect(f"file:{args.db}?mode=ro" if args.dry_run else str(args.db),
                           uri=args.dry_run)
    conn.row_factory = sqlite3.Row

    # ---- Gather the promoted set. Either source may be absent: the metro build
    # has no missed-tree table, and the low-canopy table has no hedge flag.
    if has_table(conn, "tree_pointcloud_missed_pilot"):
        missed = conn.execute(
            "SELECT candidate_id, lon, lat, x_2193, y_2193, canopy_height_m, patch_area_m2 "
            "FROM tree_pointcloud_missed_pilot WHERE confidence_tier='high'").fetchall()
    else:
        missed = []
        print("  no tree_pointcloud_missed_pilot in this database; low-canopy only")
    hedge_clause = ("COALESCE(is_hedge,0)=0 AND"
                    if has_column(conn, "tree_low_canopy_candidates", "is_hedge") else "")
    low = conn.execute(
        f"""SELECT candidate_id, lon, lat, x_2193, y_2193, height_m
            FROM tree_low_canopy_candidates
            WHERE {hedge_clause} confidence_score >= ?""", (args.min_score,)).fetchall()
    # Drop anything standing inside a mapped building. The low-canopy detector
    # already excludes buildings, but it used OpenStreetMap, which under-maps
    # the garages and outbuildings that read as small trees at 3 to 5 m. The
    # authoritative LINZ outlines are a cheap second pass.
    if args.exclude_buildings and args.exclude_buildings.exists() and low:
        import geopandas as gpd
        import pandas as pd
        buildings = gpd.read_file(args.exclude_buildings)[["geometry"]]
        points = gpd.GeoDataFrame(
            pd.DataFrame({"i": range(len(low))}),
            geometry=gpd.points_from_xy([r["x_2193"] for r in low],
                                        [r["y_2193"] for r in low]),
            crs="EPSG:2193")
        inside = set(gpd.sjoin(points, buildings, how="inner", predicate="within")["i"])
        if inside:
            low = [r for i, r in enumerate(low) if i not in inside]
            print(f"  dropped {len(inside):,} candidates standing inside a mapped building "
                  f"({args.exclude_buildings.name})")
    elif args.exclude_buildings and not args.exclude_buildings.exists():
        print(f"  NOTE {args.exclude_buildings.name} not found; no building exclusion applied")

    print(f"Promoting {len(missed):,} missed trees + {len(low):,} low-canopy "
          f"(score>={args.min_score}) = {len(missed)+len(low):,} new trees", flush=True)
    if low:
        heights = sorted(r["height_m"] for r in low if r["height_m"] is not None)
        if heights:
            q = lambda p: heights[int(p * (len(heights) - 1))]  # noqa: E731
            print(f"  height p5/p50/p95: {q(0.05):.1f} / {q(0.5):.1f} / {q(0.95):.1f} m")
    if args.dry_run:
        conn.close()
        print("\nDry run complete; nothing written.")
        return

    created = utc_now()
    tree_cols = ["tree_id", "source_primary", "record_role", "source_tree_id", "species_common",
                 "species_confidence", "owner_class", "lon", "lat",
                 "approx_x_m", "approx_y_m", "is_protected_notable", "as_of_utc"]
    tree_rows, lidar_rows, crown_rows, crown_feats = [], [], [], []

    def add(prefix, src, idx, lon, lat, x, y, height, area):
        tid = f"akl_tree_{prefix}_{idx:07d}"
        tree_rows.append((tid, src, "remote_sensing_detection", f"{prefix.upper()}{idx:07d}", "Unknown",
                          "pointcloud_promoted_no_species", "Point-cloud Detected",
                          lon, lat, round(lon * M_PER_DEG_LON, 3),
                          round(lat * M_PER_DEG_LAT, 3), 0, created))
        lidar_rows.append((tid, x, y, height, height, 1 if (height or 0) >= 3 else 0,
                           "pointcloud_promoted_v1", created))
        if area is None or area <= 0:
            r = crown_radius_for_height(height)
            area = math.pi * r * r
        else:
            r = math.sqrt(area / math.pi)
        diam = 2 * r
        crown_rows.append((tid, round(area, 1), round(diam, 1), height, height,
                           "pointcloud_promoted_circular_v1", created))
        circle_2193 = Point(x, y).buffer(r, quad_segs=12)
        circle_4326 = shapely_transform(TO_4326.transform, circle_2193)
        crown_feats.append({"type": "Feature", "id": tid,
                            "properties": {"tree_id": tid, "source_primary": src,
                                           "crown_area_m2": round(area, 1),
                                           "crown_diameter_m": round(diam, 1),
                                           "crown_max_chm_m": round(height, 2) if height else None},
                            "geometry": mapping(circle_4326)})

    for i, m in enumerate(missed, 1):
        add("pcm", SRC_MISSED, i, m["lon"], m["lat"], m["x_2193"], m["y_2193"],
            m["canopy_height_m"], m["patch_area_m2"])
    for i, lc in enumerate(low, 1):
        add("lcp", SRC_LOW, i, lc["lon"], lc["lat"], lc["x_2193"], lc["y_2193"],
            lc["height_m"], None)

    # ---- Idempotent: drop any prior promotion, then insert.
    placeholder = ",".join("?" for _ in PROMOTED_SOURCES)
    prior = [r[0] for r in conn.execute(
        f"SELECT tree_id FROM trees WHERE source_primary IN ({placeholder})", PROMOTED_SOURCES)]
    if prior:
        conn.execute("CREATE TEMP TABLE _prom(tree_id TEXT PRIMARY KEY)")
        conn.executemany("INSERT OR IGNORE INTO _prom VALUES (?)", [(i,) for i in prior])
        for tbl in ("trees", "tree_lidar_pilot", "tree_crown_pilot",
                    "tree_valuation_pilot", "tree_context_pilot"):
            cols = {r[1] for r in conn.execute(f"PRAGMA table_info({tbl})")}
            if "tree_id" in cols:
                conn.execute(f"DELETE FROM {tbl} WHERE tree_id IN (SELECT tree_id FROM _prom)")
        conn.execute("DROP TABLE _prom")
        print(f"  removed {len(prior):,} rows from a prior promotion", flush=True)

    conn.executemany(
        f"INSERT INTO trees ({','.join(tree_cols)}) VALUES ({','.join('?' for _ in tree_cols)})",
        tree_rows)
    conn.executemany(
        "INSERT INTO tree_lidar_pilot (tree_id,x_2193,y_2193,chm_at_point_m,"
        "chm_local_max_2m_m,likely_canopy_ge_3m,method_id,created_at_utc) VALUES (?,?,?,?,?,?,?,?)",
        lidar_rows)
    conn.executemany(
        "INSERT INTO tree_crown_pilot (tree_id,crown_area_m2,crown_diameter_m,"
        "crown_mean_chm_m,crown_max_chm_m,method_id,created_at_utc) VALUES (?,?,?,?,?,?,?)",
        crown_rows)
    conn.commit()
    conn.close()

    # ---- Append circular crowns to the crowns GeoJSON (drop prior promoted
    # first). Streamed through a temporary file and swapped in, so a failure
    # part-way cannot leave a truncated crown intermediate behind.
    if crowns_path.exists():
        iter_features, FeatureWriter = _web_geojson_helpers()
        tmp = crowns_path.with_suffix(".geojson.tmp")
        kept = 0
        with FeatureWriter(tmp) as writer:
            for feature in iter_features(crowns_path):
                if feature.get("properties", {}).get("source_primary") in PROMOTED_SOURCES:
                    continue
                writer.add(feature)
                kept += 1
            for feature in crown_feats:
                writer.add(feature)
        tmp.replace(crowns_path)
        print(f"  crowns GeoJSON: kept {kept:,} existing + {len(crown_feats):,} promoted")
    else:
        print(f"  WARNING: {crowns_path} not found; crown polygons not appended")

    print(f"Inserted {len(tree_rows):,} trees + crowns. Now re-run build_tree_valuation.py.",
          flush=True)


if __name__ == "__main__":
    main()
