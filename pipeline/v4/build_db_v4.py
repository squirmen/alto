#!/usr/bin/env python3
"""Fold the v4 point-cloud detection into the working copy of the ALTO database.

Additive only: no existing row is deleted or overwritten.
  1. restore the LiDAR detections the isthmus-only coastline rule deleted, copying
     their rows back from the 23 June snapshot (logged in tree_restoration_log);
  2. load every v4 crown (tree_crown_v4) with its evidence and tier;
  3. link existing records to the crown their point falls in (tree_crown_v4_links);
  4. add a tree record for every crown no existing record claims;
  5. write tree_evidence_v4: one row per tree, with an evidence tier and plain reasons.

DRY_RUN=1 computes and reports everything without writing (TILES_DIR picks the tile outputs).
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from pyproj import Transformer

W = Path("/data/alto/working/alto_v4_20260917")
T7 = Path("/data/alto")
JUN23 = T7 / "metro_predeploy_backup_2026-06-23" / "akl_trees.sqlite"
DB = Path(os.environ.get("V4_DB", str(W / "akl_trees.sqlite")))
TILES = Path(os.environ.get("TILES_DIR", str(W / "tiles")))
DRY = os.environ.get("DRY_RUN") == "1"
SRC_V4 = "lidar_pointcloud_v4"
CROWN_METHOD = "pointcloud_v4_vegetation_watershed"
LIDAR_METHOD = "pointcloud_v4_vegetation_chm"
LAT0 = -36.85
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")
TO4326 = Transformer.from_crs(2193, 4326, always_xy=True)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def crown_tiers(cr: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Evidence tier for a crown traced from vegetation returns.

    very_likely : at least 5 m tall with a solid, rounded crown of laser returns
    probable    : vegetation at least 3 m tall with one or more weaker signs
    possible    : vegetation at least 3 m tall that could also be a hedge, shrub or
                  misread object (tiny, very sparse, strongly linear, water beneath)
    """
    h = cr.height_m.to_numpy()
    a = cr.area_m2.to_numpy()
    nv = cr.n_veg.to_numpy()
    mr = cr.multi_return.fillna(0).to_numpy()
    el = cr.elong.to_numpy()
    wat = cr.n_water.to_numpy()
    bl = cr.n_bldg.to_numpy()
    hf = cr.hedge_frac.fillna(0).to_numpy() if "hedge_frac" in cr else np.zeros(len(cr))
    flags = {
        "under 5 m tall": h < 5,
        "small crown": a < 4,
        "few laser returns": nv < 25,
        "hedge-like shape": el > 3.5,
        "water beneath": wat > 2,
        "mostly over a roof": bl > 0.5 * np.maximum(nv, 1),
        "few multiple returns": mr < 0.2,
        "part of a hedge-like row": hf >= 0.6,
    }
    weak = np.column_stack(list(flags.values()))
    possible = (a < 2) | (nv < 8) | (el > 5) | (wat > 5) | (bl > nv) | (mr < 0.1) | (hf >= 0.6)
    tier = np.where(~weak.any(axis=1), "very_likely", np.where(possible, "possible", "probable"))
    names = np.array(list(flags.keys()))
    reasons = np.array(["; ".join(names[row]) for row in weak], dtype=object)
    return tier, reasons


def restore(conn: sqlite3.Connection, restore_ids: list[str]) -> None:
    log(f"restoring {len(restore_ids):,} deleted detections from the 23 June snapshot")
    conn.execute(f"ATTACH DATABASE 'file:{JUN23}?immutable=1' AS jun")
    conn.execute("CREATE TEMP TABLE _restore(tree_id TEXT PRIMARY KEY)")
    conn.executemany("INSERT INTO _restore VALUES (?)", [(i,) for i in restore_ids])
    main_tables = {r[0] for r in conn.execute("SELECT name FROM main.sqlite_master WHERE type='table'")}
    for (table,) in conn.execute("SELECT name FROM jun.sqlite_master WHERE type='table'").fetchall():
        if table not in main_tables:
            continue
        mcols = [(r[1], r[2]) for r in conn.execute(f"PRAGMA main.table_info({table})")]
        jcols = {r[1] for r in conn.execute(f"PRAGMA jun.table_info({table})")}
        if "tree_id" not in jcols:
            continue
        shared = [c for c, _ in mcols if c in jcols]
        names, exprs = list(shared), [f"j.{c}" for c in shared]
        for col, ctype in mcols:
            if col in jcols or (ctype or "").upper() == "REAL":
                continue
            # a flag or label the June schema lacked: use the value current LiDAR
            # detections carry in this table
            join = "" if table == "trees" else "JOIN main.trees t ON t.tree_id = x.tree_id"
            where = "x.source_primary" if table == "trees" else "t.source_primary"
            mode = conn.execute(
                f"SELECT x.{col}, COUNT(*) n FROM main.{table} x {join} "
                f"WHERE {where} = 'lidar_inferred_canopy' GROUP BY 1 ORDER BY n DESC LIMIT 1").fetchone()
            if mode is not None and mode[0] is not None:
                names.append(col)
                exprs.append("'" + str(mode[0]).replace("'", "''") + "'" if isinstance(mode[0], str) else str(mode[0]))
        cur = conn.execute(
            f"INSERT OR IGNORE INTO main.{table} ({', '.join(names)}) "
            f"SELECT {', '.join(exprs)} FROM jun.{table} j JOIN _restore r ON r.tree_id = j.tree_id")
        filled = [c for c in names if c not in shared]
        log(f"  {table}: {cur.rowcount:,} rows" + (f" (filled {filled})" if filled else ""))
    conn.execute("""CREATE TABLE IF NOT EXISTS tree_restoration_log (
        tree_id TEXT PRIMARY KEY, restored_from TEXT, reason TEXT, restored_at_utc TEXT)""")
    conn.executemany("INSERT OR IGNORE INTO tree_restoration_log VALUES (?,?,?,?)",
                     [(i, "metro_predeploy_backup_2026-06-23",
                       "deleted as offshore by a coastline layer that omitted the islands", NOW) for i in restore_ids])
    conn.commit()
    conn.execute("DETACH DATABASE jun")


def main() -> None:
    t0 = time.time()
    ex = pq.read_table(os.environ.get("V4_EXISTING", str(W / "existing.parquet"))).to_pandas()
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True) if DRY else sqlite3.connect(DB)
    if not DRY:
        conn.execute("PRAGMA synchronous=OFF")
        conn.execute("PRAGMA temp_store=MEMORY")
        if conn.execute("SELECT name FROM sqlite_master WHERE name='tree_evidence_v4'").fetchone():
            raise SystemExit("tree_evidence_v4 already exists in the working database; start from a fresh copy")
        for leftover in ("tree_crown_v4", "tree_crown_v4_links"):
            if conn.execute("SELECT name FROM sqlite_master WHERE name=?", (leftover,)).fetchone():
                if conn.execute(f"SELECT COUNT(*) FROM {leftover}").fetchone()[0]:
                    raise SystemExit(f"{leftover} already holds rows; start from a fresh copy")
                conn.execute(f"DROP TABLE {leftover}")  # empty table left by an interrupted run

    # ---- crowns and links from the tile run
    files = sorted(TILES.glob("*.crowns.parquet"))
    log(f"reading {len(files):,} tile outputs from {TILES}")
    attr_cols = ["seg_key", "x", "y", "height_m", "area_m2", "mean_veg_hag_m", "n_veg", "n_bldg", "n_uncl",
                 "n_bridge", "n_water", "n_ground", "multi_return", "intensity", "img_gli", "elong", "fill",
                 "hedge_frac", "gap_frac"]
    cr = pd.concat([pq.read_table(f, columns=attr_cols).to_pandas() for f in files], ignore_index=True)
    lk = pd.concat([pq.read_table(str(f).replace(".crowns.", ".links.")).to_pandas() for f in files], ignore_index=True)
    dupe_keys = int(cr.seg_key.duplicated().sum())
    cr = cr.drop_duplicates("seg_key").reset_index(drop=True)
    log(f"{len(cr):,} crowns ({dupe_keys} duplicate keys dropped), {len(lk):,} links")
    cr["tier"], cr["reasons"] = crown_tiers(cr)

    lk = lk.sort_values("dist_m").drop_duplicates("exist_idx")
    lk = lk.merge(ex[["exist_idx", "tree_id", "kind", "x", "y"]], on="exist_idx")
    lk = lk.merge(cr[["seg_key", "x", "y"]].rename(columns={"x": "cx", "y": "cy"}), on="seg_key")
    lk["top_dist"] = np.hypot(lk.x - lk.cx, lk.y - lk.cy)
    lk["is_inv"] = lk.kind == 0
    lk = lk.sort_values(["seg_key", "is_inv", "top_dist"], ascending=[True, False, True]).reset_index(drop=True)
    first = ~lk.seg_key.duplicated()
    primary_inv = lk.groupby("seg_key").is_inv.transform("first")
    lk["role"] = np.where(first, "primary",
                          np.where(lk.is_inv, "shares_crown",
                                   np.where(primary_inv, "same_crown_as_record", "possible_duplicate")))
    prim = lk[first].set_index("seg_key")
    cr["primary_tree_id"] = cr.seg_key.map(prim.tree_id)
    new = cr.primary_tree_id.isna()
    cr.loc[new, "primary_tree_id"] = "akl_tree_pc4_" + cr.loc[new, "seg_key"]
    cr["n_records_linked"] = cr.seg_key.map(lk.groupby("seg_key").size()).fillna(0).astype(int)
    log(f"crowns claimed by existing records: {(~new).sum():,}; new trees: {new.sum():,}; "
        f"crown tiers {cr.tier.value_counts().to_dict()}; link roles {lk.role.value_counts().to_dict()}")

    # ---- one evidence row per tree
    by_key = cr.set_index("seg_key")
    ev = ex[["tree_id", "kind"]].merge(lk[["tree_id", "seg_key", "role", "dist_m"]], on="tree_id", how="left")
    legacy = {r[0] for r in conn.execute("SELECT tree_id FROM tree_crown_pilot")}
    linked = ev.seg_key.notna()
    inv = ev.kind == 0
    is_primary = linked & (ev.role == "primary")
    ev["evidence_tier"] = np.select([inv, is_primary, linked], ["recorded", ev.seg_key.map(by_key.tier), "possible_duplicate"],
                                    default="unverified")
    ev["evidence_reasons"] = np.select(
        [inv & ~linked, inv, is_primary, ev.role == "same_crown_as_record", linked],
        ["no 2024 laser canopy found at the recorded position", "", ev.seg_key.map(by_key.reasons),
         "same crown as a recorded tree", "same crown as another detection"],
        default="no 2024 laser canopy at this point")
    # possible duplicates sit inside a crown already drawn for the primary record
    ev["crown_source"] = np.select(
        [linked & ev.role.isin(["primary", "shares_crown"]), linked],
        ["v4", "shared"], default=np.where(ev.tree_id.isin(legacy), "legacy", "none"))
    ev["v4_height_m"] = ev.seg_key.map(by_key.height_m)
    ev["v4_crown_area_m2"] = ev.seg_key.map(by_key.area_m2)
    ev["restored"] = (ev.kind == 3).astype(int)
    nc = cr[new].reset_index(drop=True)
    newev = pd.DataFrame(dict(tree_id=nc.primary_tree_id, seg_key=nc.seg_key, role="new_detection", dist_m=0.0,
                              evidence_tier=nc.tier, evidence_reasons=nc.reasons, crown_source="v4",
                              v4_height_m=nc.height_m, v4_crown_area_m2=nc.area_m2, restored=0))
    out = pd.concat([ev.drop(columns=["kind"]), newev], ignore_index=True)
    summary = dict(existing_records=int(len(ex)), crowns_v4=int(len(cr)), new_trees=int(len(nc)),
                   restored=int((ex.kind == 3).sum()), tiers=out.evidence_tier.value_counts().to_dict(),
                   roles=out.role.fillna("unlinked").value_counts().to_dict(),
                   crown_sources=out.crown_source.value_counts().to_dict(),
                   tiers_by_kind=ev.groupby("kind").evidence_tier.value_counts().unstack(fill_value=0).to_dict("index"))
    log(json.dumps(summary, indent=2, default=int))
    if DRY:
        return

    if conn.execute("SELECT name FROM sqlite_master WHERE name='tree_restoration_log'").fetchone():
        log("restoration already applied in this working database; not repeating it")
    else:
        restore(conn, ex.loc[ex.kind == 3, "tree_id"].tolist())

    conn.execute("""CREATE TABLE tree_crown_v4 (
        seg_key TEXT PRIMARY KEY, primary_tree_id TEXT, x_2193 REAL, y_2193 REAL, lon REAL, lat REAL,
        height_m REAL, crown_area_m2 REAL, crown_diameter_m REAL, mean_veg_height_m REAL,
        n_veg_returns INTEGER, n_building_returns INTEGER, n_unclassified_returns INTEGER,
        n_bridge_returns INTEGER, n_water_returns INTEGER, n_ground_returns INTEGER,
        multi_return_fraction REAL, intensity_mean REAL, aerial_greenness REAL, elongation REAL,
        bbox_fill REAL, hedge_fraction REAL, gap_filled_fraction REAL, evidence_tier TEXT,
        evidence_reasons TEXT, n_records_linked INTEGER,
        crown_wkb BLOB, method_id TEXT, created_at_utc TEXT)""")
    meta = by_key[["primary_tree_id", "tier", "reasons", "n_records_linked"]].to_dict("index")
    total = 0
    for f in files:
        tb = pq.read_table(f).to_pandas()
        if tb.empty:
            continue
        lon, lat = TO4326.transform(tb.x.to_numpy(), tb.y.to_numpy())
        rows = []
        for i, r in enumerate(tb.itertuples(index=False)):
            m = meta.pop(r.seg_key, None)
            if m is None:
                continue
            rows.append((r.seg_key, m["primary_tree_id"], r.x, r.y, float(lon[i]), float(lat[i]),
                         float(r.height_m), float(r.area_m2), 2 * math.sqrt(r.area_m2 / math.pi),
                         None if pd.isna(r.mean_veg_hag_m) else float(r.mean_veg_hag_m),
                         int(r.n_veg), int(r.n_bldg), int(r.n_uncl), int(r.n_bridge), int(r.n_water), int(r.n_ground),
                         None if pd.isna(r.multi_return) else float(r.multi_return),
                         None if pd.isna(r.intensity) else float(r.intensity),
                         None if pd.isna(r.img_gli) else float(r.img_gli),
                         float(r.elong), float(r.fill), float(r.hedge_frac), float(r.gap_frac),
                         m["tier"], m["reasons"] or None,
                         int(m["n_records_linked"]), r.crown_wkb, CROWN_METHOD, NOW))
        conn.executemany(f"INSERT INTO tree_crown_v4 VALUES ({','.join('?' * 29)})", rows)
        total += len(rows)
    conn.execute("CREATE INDEX idx_crown_v4_primary ON tree_crown_v4(primary_tree_id)")
    conn.commit()
    log(f"tree_crown_v4: {total:,} rows")

    conn.execute("""CREATE TABLE tree_crown_v4_links (
        tree_id TEXT PRIMARY KEY, seg_key TEXT, link_role TEXT, dist_to_crown_m REAL, dist_to_top_m REAL)""")
    conn.executemany("INSERT INTO tree_crown_v4_links VALUES (?,?,?,?,?)",
                     ((r.tree_id, r.seg_key, r.role, float(r.dist_m), float(r.top_dist))
                      for r in lk[["tree_id", "seg_key", "role", "dist_m", "top_dist"]].itertuples(index=False)))
    conn.commit()

    lon, lat = TO4326.transform(nc.x.to_numpy(), nc.y.to_numpy())
    tcols = [r[1] for r in conn.execute("PRAGMA table_info(trees)")]
    taxon = conn.execute("SELECT taxon_assertion_status, COUNT(*) n FROM trees WHERE source_primary='lidar_inferred_canopy' "
                         "GROUP BY 1 ORDER BY n DESC LIMIT 1").fetchone() if "taxon_assertion_status" in tcols else None
    base = dict(source_primary=SRC_V4, record_role="remote_sensing_detection", species_common="Unknown",
                species_confidence="pointcloud_v4_no_species", owner_class="LiDAR Point-cloud Detection",
                is_protected_notable=0, notable_point_match=0, notable_point_spatial_candidate=0,
                notable_point_name_compatible=0, notable_point_review_required=0, notable_group_match=0,
                notable_group_count=0, as_of_utc=NOW)
    if taxon:
        base["taxon_assertion_status"] = taxon[0]
    extra = [c for c in base if c in tcols]
    cols = ["tree_id", "source_tree_id", "lon", "lat", "approx_x_m", "approx_y_m"] + extra
    conn.executemany(
        f"INSERT INTO trees ({', '.join(cols)}) VALUES ({','.join('?' * len(cols))})",
        ((r.primary_tree_id, r.seg_key, float(lon[i]), float(lat[i]), round(lon[i] * M_PER_DEG_LON, 3),
          round(lat[i] * M_PER_DEG_LAT, 3), *[base[c] for c in extra]) for i, r in enumerate(nc.itertuples(index=False))))
    conn.executemany(
        "INSERT INTO tree_lidar_pilot (tree_id, x_2193, y_2193, chm_at_point_m, chm_local_max_2m_m, "
        "likely_canopy_ge_3m, method_id, created_at_utc) VALUES (?,?,?,?,?,?,?,?)",
        ((r.primary_tree_id, r.x, r.y, float(r.height_m), float(r.height_m), 1, LIDAR_METHOD, NOW)
         for r in nc.itertuples(index=False)))
    conn.executemany(
        "INSERT INTO tree_crown_pilot (tree_id, crown_area_m2, crown_diameter_m, crown_mean_chm_m, "
        "crown_max_chm_m, method_id, created_at_utc) VALUES (?,?,?,?,?,?,?)",
        ((r.primary_tree_id, float(r.area_m2), 2 * math.sqrt(r.area_m2 / math.pi),
          None if pd.isna(r.mean_veg_hag_m) else float(r.mean_veg_hag_m), float(r.height_m), CROWN_METHOD, NOW)
         for r in nc.itertuples(index=False)))
    conn.commit()
    log(f"added {len(nc):,} tree records ({SRC_V4})")

    conn.execute("""CREATE TABLE tree_evidence_v4 (
        tree_id TEXT PRIMARY KEY, evidence_tier TEXT, evidence_reasons TEXT, seg_key TEXT, link_role TEXT,
        link_dist_m REAL, crown_source TEXT, v4_height_m REAL, v4_crown_area_m2 REAL, restored INTEGER,
        method_id TEXT, created_at_utc TEXT)""")
    conn.executemany(
        "INSERT INTO tree_evidence_v4 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ((r.tree_id, r.evidence_tier, r.evidence_reasons or None, r.seg_key if isinstance(r.seg_key, str) else None,
          r.role if isinstance(r.role, str) else None, None if pd.isna(r.dist_m) else float(r.dist_m),
          r.crown_source, None if pd.isna(r.v4_height_m) else float(r.v4_height_m),
          None if pd.isna(r.v4_crown_area_m2) else float(r.v4_crown_area_m2), int(r.restored),
          CROWN_METHOD, NOW) for r in out.itertuples(index=False)))
    conn.commit()
    summary["trees_in_db"] = conn.execute("SELECT COUNT(*) FROM trees").fetchone()[0]
    summary["minutes"] = round((time.time() - t0) / 60, 1)
    (W / "logs" / "build_db_v4_summary.json").write_text(json.dumps(summary, indent=2, default=int))
    log(f"done: {summary['trees_in_db']:,} trees in the working database ({summary['minutes']} min)")
    conn.close()


if __name__ == "__main__":
    main()
