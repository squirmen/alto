#!/usr/bin/env python3
"""Map GeoJSON (one feature per line) for the v4 release, read from the working database.

points : every tree record with the fields the live map reads, plus evidence_tier,
         evidence_reasons, crown_source and restored. Crown size and height come
         from the traced v4 crown where a tree has one.
crowns : every v4 crown under its primary tree, then the legacy metro crown for
         trees that have no v4 crown (from the 31 July crown file).

The database is opened read-only. Writes web_build/points.geojsonl and crowns.geojsonl.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow.compute as pc
import pyogrio
import shapely
from pyproj import Transformer

W = Path("/data/alto/working/alto_v4_20260917")
DB = Path(os.environ.get("V4_DB", str(W / "akl_trees.sqlite")))
OUT = Path(os.environ.get("V4_BUILD", str(W / "web_build")))
LEGACY_CROWNS = Path(os.environ.get("V4_LEGACY", str(W / "legacy" / "tree_crowns_pilot.slim.geojson")))
TO4326 = Transformer.from_crs(2193, 4326, always_xy=True)
PLACEHOLDER_SPECIES = {"0 records found.": "Species not recorded"}

spec = importlib.util.spec_from_file_location("bwg", W / "code" / "build_web_geojson.py")
bwg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bwg)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def connect():
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def has_table(conn, name):
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def write_points():
    conn = connect()
    pc_cols = {r[1] for r in conn.execute("PRAGMA table_info(tree_pointcloud_pilot)")}
    pc_fields = [f for f in bwg.POINTCLOUD_FIELDS if f in pc_cols]
    has_change = has_table(conn, "tree_change_pilot")
    change_select = ", ".join(f"ch.{f} AS {f}" for f in bwg.CHANGE_FIELDS) + "," if has_change else ""
    change_join = "LEFT JOIN tree_change_pilot ch ON ch.tree_id = t.tree_id" if has_change else ""
    sql = f"""
        SELECT t.tree_id, t.source_primary, t.species_common, t.species_latin, t.species_confidence,
            t.owner_class, t.is_protected_notable, t.notable_point_review_required, t.notable_point_name,
            t.notable_group_names, t.record_role, t.lon, t.lat,
            CASE WHEN l.chm_local_max_2m_m IS NOT NULL THEN 1 ELSE 0 END AS lidar_pilot,
            CASE WHEN c.crown_area_m2 IS NOT NULL THEN 1 ELSE 0 END AS crown_pilot,
            l.chm_local_max_2m_m, c.crown_area_m2, c.crown_max_chm_m, c.crown_diameter_m,
            v.species_class, ctx.in_flood_prone_area, ctx.in_flood_plain, ctx.fraction_paved_surfaces,
            ctx.air_temp_mean_c, ctx.dist_overland_flow_path_m, ctx.dist_stormwater_catchpit_m,
            v.paved_fraction_used, v.paved_fraction_source, v.avoided_runoff_m3_y, v.stormwater_value_nzd_y,
            v.stored_co2e_tonnes_est, v.carbon_value_nzd_y, v.cooling_value_nzd_y, v.air_quality_value_nzd_y,
            v.pm25_removed_kg_y, v.total_value_nzd_y, v.valuation_confidence,
            {", ".join(f"a.{f} AS {f}" for f in bwg.ASSET_FIELDS)},
            {change_select}
            {", ".join(f"pc.{f} AS {f}" for f in pc_fields)},
            {", ".join(f"sa.{f} AS {f}" for f in bwg.SPECIES_ATTR_FIELDS)},
            sc.total_value_nzd_y AS scenario_total_value_nzd_y, sc.scenario_name AS scenario_name,
            sc.valuation_confidence AS scenario_confidence,
            ev.evidence_tier, ev.evidence_reasons, ev.crown_source, ev.restored,
            cv.crown_area_m2 AS v4_area, cv.crown_diameter_m AS v4_diam, cv.height_m AS v4_height
        FROM trees t
        LEFT JOIN tree_lidar_pilot l ON l.tree_id = t.tree_id
        LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
        LEFT JOIN tree_context_pilot ctx ON ctx.tree_id = t.tree_id
        LEFT JOIN tree_valuation_pilot v ON v.tree_id = t.tree_id
        LEFT JOIN tree_assets_pilot a ON a.tree_id = t.tree_id
        {change_join}
        LEFT JOIN tree_pointcloud_pilot pc ON pc.tree_id = t.tree_id
        LEFT JOIN tree_species_attributes sa ON sa.tree_id = t.tree_id
        LEFT JOIN tree_valuation_scenarios sc ON sc.tree_id = t.tree_id
        LEFT JOIN tree_evidence_v4 ev ON ev.tree_id = t.tree_id
        LEFT JOIN tree_crown_v4 cv ON cv.seg_key = ev.seg_key AND ev.crown_source = 'v4'
        {"WHERE COALESCE(pc.is_duplicate_seed, 0) = 0" if "is_duplicate_seed" in pc_cols else ""}
    """
    cursor = conn.execute(sql)
    available = {d[0] for d in cursor.description}
    extra = ["crown_diameter_m", "pm25_removed_kg_y"] + bwg.ASSET_FIELDS + bwg.CHANGE_FIELDS + \
        [f for f in bwg.POINTCLOUD_FIELDS if f in available] + bwg.SPECIES_ATTR_FIELDS + bwg.SCENARIO_FIELDS
    extra = [k for k in extra if k in available]
    OUT.mkdir(exist_ok=True)
    n = 0
    tiers = {}
    with (OUT / "points.geojsonl").open("w", encoding="utf-8") as fh:
        for row in cursor:
            rd = dict(row)
            if rd["lon"] is None or rd["lat"] is None:
                continue
            if rd["crown_source"] == "v4" and rd["v4_area"] is not None:
                rd["crown_pilot"] = 1
                rd["crown_area_m2"], rd["crown_diameter_m"], rd["crown_max_chm_m"] = rd["v4_area"], rd["v4_diam"], rd["v4_height"]
            if rd["species_common"] in PLACEHOLDER_SPECIES:
                rd["species_common"] = PLACEHOLDER_SPECIES[rd["species_common"]]
            props = {}
            for key, sql_key in bwg.POINT_FIELDS:
                value = bwg.strip(rd.get(sql_key), keep_zero=key in bwg.KEEP_ZERO_FIELDS)
                if value is not None:
                    props[key] = value
            for key in extra:
                value = rd.get(key)
                if value is None:
                    continue
                props[key] = round(value, 3) if isinstance(value, float) else value
            props["evidence_tier"] = rd["evidence_tier"] or "recorded"
            if rd["evidence_reasons"]:
                props["evidence_reasons"] = rd["evidence_reasons"]
            if rd["crown_source"]:
                props["crown_source"] = rd["crown_source"]
            if rd["restored"]:
                props["restored"] = 1
            tiers[props["evidence_tier"]] = tiers.get(props["evidence_tier"], 0) + 1
            fh.write(json.dumps({"type": "Feature", "id": rd["tree_id"], "properties": props,
                                 "geometry": {"type": "Point", "coordinates": [round(rd["lon"], 6), round(rd["lat"], 6)]}},
                                separators=(",", ":")) + "\n")
            n += 1
            if n % 500_000 == 0:
                log(f"  points {n:,}")
    conn.close()
    log(f"points: {n:,} features; tiers {tiers}")
    return n


CROWN_PROPS = """t.tree_id, t.source_primary, t.species_common, t.species_latin, t.owner_class,
    t.is_protected_notable, t.record_role, v.species_class, ctx.in_flood_prone_area,
    ctx.fraction_paved_surfaces, ctx.air_temp_mean_c, v.paved_fraction_used, v.paved_fraction_source,
    v.avoided_runoff_m3_y, v.stormwater_value_nzd_y, v.stored_co2e_tonnes_est, v.carbon_value_nzd_y,
    v.cooling_value_nzd_y, v.air_quality_value_nzd_y, v.total_value_nzd_y, v.valuation_confidence,
    sa.growth_form, sa.growth_form_source, sa.growth_form_confidence, ev.evidence_tier"""
CROWN_JOINS = """LEFT JOIN tree_context_pilot ctx ON ctx.tree_id = t.tree_id
    LEFT JOIN tree_valuation_pilot v ON v.tree_id = t.tree_id
    LEFT JOIN tree_species_attributes sa ON sa.tree_id = t.tree_id
    LEFT JOIN tree_evidence_v4 ev ON ev.tree_id = t.tree_id"""
SKIP = {"lidar_pilot", "crown_pilot", "chm_local_max_2m_m"}


def crown_props(rd):
    if rd.get("species_common") in PLACEHOLDER_SPECIES:
        rd["species_common"] = PLACEHOLDER_SPECIES[rd["species_common"]]
    props = {}
    for key, sql_key in bwg.POINT_FIELDS:
        if key in SKIP or sql_key not in rd:
            continue
        value = bwg.strip(rd[sql_key])
        if value is not None:
            props[key] = value
    for key in ("crown_diameter_m", "growth_form", "growth_form_source", "growth_form_confidence", "evidence_tier"):
        value = rd.get(key)
        if value is not None:
            props[key] = round(value, 3) if isinstance(value, float) else value
    return props


def to_lonlat(geoms):
    return shapely.transform(geoms, lambda xy: np.column_stack(TO4326.transform(xy[:, 0], xy[:, 1])))


def write_crowns():
    conn = connect()
    n = 0
    with (OUT / "crowns.geojsonl").open("w", encoding="utf-8") as fh:
        cur = conn.execute(f"""SELECT {CROWN_PROPS}, cv.crown_area_m2, cv.crown_diameter_m,
                                      cv.height_m AS crown_max_chm_m, cv.crown_wkb
                               FROM tree_crown_v4 cv JOIN trees t ON t.tree_id = cv.primary_tree_id {CROWN_JOINS}""")
        while batch := cur.fetchmany(50_000):
            rows = [dict(r) for r in batch]
            geoms = to_lonlat(shapely.from_wkb([r.pop("crown_wkb") for r in rows]))
            geoms = shapely.set_precision(geoms, 1e-6)
            texts = shapely.to_geojson(geoms)
            for rd, gtxt in zip(rows, texts):
                if gtxt is None or rd["tree_id"] is None:
                    continue
                fh.write('{"type":"Feature","id":' + json.dumps(rd["tree_id"]) + ',"properties":'
                         + json.dumps(crown_props(rd), separators=(",", ":")) + ',"geometry":' + gtxt + "}\n")
                n += 1
            log(f"  v4 crowns {n:,}")
    conn.close()
    log(f"crowns: {n:,} v4 features")


def write_legacy_crowns():
    """Legacy crowns for trees without a v4 crown, to crowns_legacy.geojsonl.

    Their coordinates were already rounded by the original web build; they are passed
    through as stored (made valid where needed), since re-rounding can break old polygons.
    """
    conn = connect()
    n = 0
    legacy = {r["tree_id"]: dict(r) for r in conn.execute(
        f"""SELECT {CROWN_PROPS}, c.crown_area_m2, c.crown_diameter_m, c.crown_max_chm_m
            FROM tree_evidence_v4 ev JOIN trees t ON t.tree_id = ev.tree_id
            JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
            LEFT JOIN tree_context_pilot ctx ON ctx.tree_id = t.tree_id
            LEFT JOIN tree_valuation_pilot v ON v.tree_id = t.tree_id
            LEFT JOIN tree_species_attributes sa ON sa.tree_id = t.tree_id
            WHERE ev.crown_source = 'legacy'""")}
    log(f"legacy crowns wanted: {len(legacy):,}")
    meta, table = pyogrio.read_arrow(LEGACY_CROWNS, columns=["tree_id"])
    mask = pc.is_in(table.column("tree_id"), value_set=__import__("pyarrow").array(list(legacy)))
    sub = table.filter(mask)
    geom_col = meta.get("geometry_name") or "wkb_geometry"
    geoms = shapely.from_wkb(sub.column(geom_col).to_numpy(zero_copy_only=False))
    bad = ~shapely.is_valid(geoms)
    if bad.any():
        geoms[bad] = shapely.make_valid(geoms[bad])
    texts = shapely.to_geojson(geoms)
    seen = set()
    with (OUT / "crowns_legacy.geojsonl").open("w", encoding="utf-8") as fh:
        for tid, gtxt in zip(sub.column("tree_id").to_pylist(), texts):
            if gtxt is None or tid in seen:
                continue
            seen.add(tid)
            fh.write('{"type":"Feature","id":' + json.dumps(tid) + ',"properties":'
                     + json.dumps(crown_props(legacy[tid]), separators=(",", ":")) + ',"geometry":' + gtxt + "}\n")
            n += 1
    conn.close()
    log(f"legacy crowns: {n:,} written ({int(bad.sum()):,} repaired); {len(legacy) - n:,} had no stored outline")


if __name__ == "__main__":
    what = sys.argv[1:] or ["points", "crowns"]
    if "points" in what:
        write_points()
    if "crowns" in what:
        write_crowns()
    if "crowns" in what or "legacy" in what:
        write_legacy_crowns()
