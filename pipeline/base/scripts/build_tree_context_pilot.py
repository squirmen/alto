#!/usr/bin/env python3
"""Join pilot trees and crowns to flood, stormwater, and heat context layers.

Vectorised (shapely 2.x batch) rewrite. The previous implementation issued ~6
spatial queries *per tree* (``nearest_distance_m`` / ``intersects`` in a Python
loop), i.e. ~9.4M individual STRtree queries for the 1.57M-tree metro run, which
never finished on a laptop. This version does a handful of batch
``STRtree.query`` / ``STRtree.query_nearest`` calls over the whole tree array per
context layer, reads geometry with pyogrio (streamed via OGR, not ``json.loads``
of multi-GB files), and pulls the 2193 tree points straight from
``tree_lidar_pilot`` instead of re-transforming a 1.2 GB GeoJSON.

The SQLite ``tree_context_pilot`` table is the authoritative output and is what
every downstream step (valuation, web build, findings) joins against. The
optional enrichment of the full ``trees_map_points``/``tree_crowns_pilot``
GeoJSON is skipped above ``AKL_TREES_CONTEXT_GEOJSON_MAX`` trees (default
250k) — at metro/national scale ``build_web_geojson`` re-derives the slim
GeoJSON from SQLite, so rewriting 3+ GB of GeoJSON here is dead weight.
"""

from __future__ import annotations

import csv
import json
import math
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyogrio
import shapely
from shapely import STRtree


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from _pilot_config import active_pilot_name  # noqa: E402
_PILOT_NAME = active_pilot_name()
if _PILOT_NAME == "waitemata_v1":
    RAW_CONTEXT_ROOT = ROOT / "data" / "raw" / "arcgis_context_waitemata"
else:
    RAW_CONTEXT_ROOT = ROOT / "data" / "raw" / f"arcgis_context_{_PILOT_NAME}"
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"

POINTS_PATH = PROCESSED_ROOT / "trees_map_points.geojson"
CROWNS_PATH = PROCESSED_ROOT / "tree_crowns_pilot.geojson"
CONTEXT_CSV_PATH = PROCESSED_ROOT / "tree_context_pilot.csv"

# Above this tree count, skip the (expensive) full-GeoJSON context enrichment;
# the web build re-derives context from the SQLite table.
GEOJSON_ENRICH_MAX = int(os.environ.get("AKL_TREES_CONTEXT_GEOJSON_MAX", "250000"))

CONTEXT_SLUGS = [
    "flood_plains",
    "flood_prone_areas",
    "overland_flow_paths",
    "stormwater_pipe",
    "stormwater_catchpit",
    "stormwater_manhole_chamber",
    "stormwater_inlet_outlet",
    "average_daily_air_temperature_2021_2022",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_geojson(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def numeric(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


# ---------------------------------------------------------------------------
# Geometry loading (pyogrio / OGR — memory-friendly vs json.loads of GB files)
# ---------------------------------------------------------------------------

def _to_2193(gdf):
    if gdf.crs is None:
        gdf = gdf.set_crs(4326, allow_override=True)
    return gdf.to_crs(2193)


def load_layer(slug: str):
    """Return (geoms ndarray[object] in EPSG:2193, attributes DataFrame) for a context layer.

    Empty/None geometries are dropped and the attribute frame stays aligned.
    Returns (None, None) when the layer is missing or empty.
    """
    path = RAW_CONTEXT_ROOT / slug / "features_4326.geojson"
    if not path.exists():
        return None, None
    gdf = pyogrio.read_dataframe(path)
    if len(gdf) == 0:
        return None, None
    gdf = _to_2193(gdf)
    geoms = np.asarray(gdf.geometry.values, dtype=object)
    keep = np.array([g is not None and not g.is_empty for g in geoms])
    if not keep.any():
        return None, None
    attrs = gdf.drop(columns=gdf.geometry.name).reset_index(drop=True)
    return geoms[keep], attrs[keep].reset_index(drop=True)


def _col_numeric(df, name: str, n: int) -> np.ndarray:
    if df is not None and name in df.columns:
        return pd.to_numeric(df[name], errors="coerce").to_numpy(dtype="float64")
    return np.full(n, np.nan)


# ---------------------------------------------------------------------------
# Batch spatial ops
# ---------------------------------------------------------------------------

def intersect_pairs(query_geoms, layer_geoms):
    """Return (input_idx, feature_idx) arrays for every intersecting pair."""
    if layer_geoms is None or len(layer_geoms) == 0:
        empty = np.empty(0, dtype="int64")
        return empty, empty
    tree = STRtree(layer_geoms)
    res = tree.query(query_geoms, predicate="intersects")
    return res[0], res[1]


def nearest_distance(query_geoms, layer_geoms, valid_idx=None, n_out=None):
    """True global nearest distance from each query geom to the layer.

    ``valid_idx`` restricts which queries are issued (e.g. valid points); results
    are scattered back into a full-length ``n_out`` array, NaN elsewhere.
    """
    n = n_out if n_out is not None else len(query_geoms)
    out = np.full(n, np.nan)
    if layer_geoms is None or len(layer_geoms) == 0:
        return out
    if valid_idx is None:
        q = query_geoms
        idx_map = np.arange(len(query_geoms))
    else:
        idx_map = valid_idx
        q = query_geoms[valid_idx]
    if len(q) == 0:
        return out
    tree = STRtree(layer_geoms)
    idx, dist = tree.query_nearest(q, all_matches=False, return_distance=True)
    out[idx_map[idx[0]]] = dist
    return out


# ---------------------------------------------------------------------------
# Output writers (unchanged schema/semantics)
# ---------------------------------------------------------------------------

def round_record(record: dict[str, Any]) -> dict[str, Any]:
    out = dict(record)
    for key, value in list(out.items()):
        if isinstance(value, float):
            out[key] = round(value, 3)
    return out


SQL_FIELDS = [
    "tree_id",
    "in_flood_plain",
    "flood_plain_count",
    "in_flood_prone_area",
    "flood_prone_area_count",
    "flood_prone_max_depth_m",
    "dist_overland_flow_path_m",
    "dist_stormwater_pipe_m",
    "dist_stormwater_catchpit_m",
    "dist_stormwater_manhole_m",
    "dist_stormwater_inlet_outlet_m",
    "air_temp_mean_c",
    "air_temp_max_c",
    "fraction_paved_surfaces",
    "fraction_buildings",
    "fraction_trees",
    "context_confidence",
    "created_at_utc",
]


def write_sqlite(records: list[dict[str, Any]]) -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_context_pilot")
        conn.execute(
            """
            CREATE TABLE tree_context_pilot (
                tree_id TEXT PRIMARY KEY,
                in_flood_plain INTEGER,
                flood_plain_count INTEGER,
                in_flood_prone_area INTEGER,
                flood_prone_area_count INTEGER,
                flood_prone_max_depth_m REAL,
                dist_overland_flow_path_m REAL,
                dist_stormwater_pipe_m REAL,
                dist_stormwater_catchpit_m REAL,
                dist_stormwater_manhole_m REAL,
                dist_stormwater_inlet_outlet_m REAL,
                air_temp_mean_c REAL,
                air_temp_max_c REAL,
                fraction_paved_surfaces REAL,
                fraction_buildings REAL,
                fraction_trees REAL,
                context_confidence TEXT,
                created_at_utc TEXT
            )
            """
        )
        conn.executemany(
            f"""
            INSERT INTO tree_context_pilot ({", ".join(SQL_FIELDS)})
            VALUES ({", ".join("?" for _ in SQL_FIELDS)})
            """,
            [[record.get(field) for field in SQL_FIELDS] for record in records],
        )
        conn.execute("CREATE INDEX idx_tree_context_flood ON tree_context_pilot(in_flood_plain, in_flood_prone_area)")
        conn.execute("CREATE INDEX idx_tree_context_catchpit ON tree_context_pilot(dist_stormwater_catchpit_m)")
        conn.commit()
    finally:
        conn.close()


def write_csv(records: list[dict[str, Any]]) -> None:
    fieldnames = [
        "tree_id",
        "source_tree_id",
        "species_common",
        "owner_class",
        "in_flood_plain",
        "in_flood_prone_area",
        "flood_prone_max_depth_m",
        "dist_overland_flow_path_m",
        "dist_stormwater_pipe_m",
        "dist_stormwater_catchpit_m",
        "dist_stormwater_inlet_outlet_m",
        "air_temp_mean_c",
        "air_temp_max_c",
        "fraction_paved_surfaces",
        "fraction_buildings",
        "fraction_trees",
        "context_confidence",
    ]
    with CONTEXT_CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            rounded = round_record(record)
            writer.writerow({field: rounded.get(field, "") for field in fieldnames})


def update_geojson(path: Path, records_by_tree: dict[str, dict[str, Any]]) -> None:
    data = load_geojson(path)
    for feature in data.get("features", []):
        tree_id = feature.get("id") or feature.get("properties", {}).get("tree_id")
        if tree_id in records_by_tree:
            update = {
                key: value
                for key, value in round_record(records_by_tree[tree_id]).items()
                if key not in {"tree_id", "source_tree_id", "species_common", "owner_class", "created_at_utc"}
            }
            feature.setdefault("properties", {}).update(update)
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def write_report(records: list[dict[str, Any]]) -> None:
    flood_plain_count = sum(record["in_flood_plain"] for record in records)
    flood_prone_count = sum(record["in_flood_prone_area"] for record in records)
    close_catchpit_count = sum(
        1 for record in records
        if (record["dist_stormwater_catchpit_m"] if record["dist_stormwater_catchpit_m"] is not None else 999999) <= 10
    )
    close_flow_path_count = sum(
        1 for record in records
        if (record["dist_overland_flow_path_m"] if record["dist_overland_flow_path_m"] is not None else 999999) <= 5
    )
    temps = [record["air_temp_mean_c"] for record in records if record["air_temp_mean_c"] is not None]
    paved = [record["fraction_paved_surfaces"] for record in records if record["fraction_paved_surfaces"] is not None]

    lines = [
        "# Tree Context Pilot",
        "",
        f"Generated at: {utc_now()}",
        "",
        "This joins each pilot tree/crown to public flood, stormwater, and heat context layers. These fields do not yet create final dollar values, but they are real location-specific inputs for the next valuation model.",
        "",
        "## Summary",
        "",
        f"- Trees/crowns with context: {len(records):,}.",
        f"- Crown intersects mapped flood plain: {flood_plain_count:,}.",
        f"- Crown intersects flood-prone area: {flood_prone_count:,}.",
        f"- Crown within 5 m of an overland flow path: {close_flow_path_count:,}.",
        f"- Tree point within 10 m of a stormwater catchpit: {close_catchpit_count:,}.",
        f"- Mean air-temperature field range: {min(temps):.2f} to {max(temps):.2f} C." if temps else "- Mean air-temperature field range: unavailable.",
        f"- Paved-surface fraction range in joined heat grid: {min(paved):.2f} to {max(paved):.2f}." if paved else "- Paved-surface fraction range: unavailable.",
        "",
        "## Outputs",
        "",
        "- `data/processed/tree_context_pilot.csv`",
        "- `data/processed/akl_trees.sqlite`, table `tree_context_pilot`",
        "",
    ]
    (DOCS_ROOT / "tree_context_pilot.md").write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------

def _f(x) -> float | None:
    if x is None:
        return None
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    return xf if math.isfinite(xf) else None


def _s(x) -> str | None:
    if x is None:
        return None
    try:
        if pd.isna(x):
            return None
    except (TypeError, ValueError):
        pass
    s = str(x)
    return s if s not in ("", "nan", "None") else None


def main() -> None:
    t0 = datetime.now()

    def log(msg: str) -> None:
        print(f"[{(datetime.now() - t0).total_seconds():7.1f}s] {msg}", flush=True)

    # --- crowns (geometry + attributes), reprojected to 2193 ---
    log(f"reading crowns: {CROWNS_PATH.name}")
    gdf_c = pyogrio.read_dataframe(
        CROWNS_PATH, columns=["tree_id", "source_tree_id", "species_common", "owner_class"]
    )
    gdf_c = _to_2193(gdf_c)
    tree_ids = gdf_c["tree_id"].astype(str).to_numpy()
    src_ids = gdf_c["source_tree_id"].to_numpy()
    species = gdf_c["species_common"].to_numpy()
    owners = gdf_c["owner_class"].to_numpy()
    crown_geoms = np.asarray(gdf_c.geometry.values, dtype=object)
    n = len(crown_geoms)
    del gdf_c
    log(f"crowns: {n:,}")

    # crown validity (query_nearest errors on empty geoms)
    crown_valid = np.array([g is not None and not g.is_empty for g in crown_geoms])
    crown_valid_idx = np.where(crown_valid)[0]

    # --- tree points in 2193 from tree_lidar_pilot ---
    conn = sqlite3.connect(SQLITE_PATH)
    rows = conn.execute("SELECT tree_id, x_2193, y_2193 FROM tree_lidar_pilot").fetchall()
    conn.close()
    pmap = {str(tid): (x, y) for tid, x, y in rows}
    px = np.array([pmap.get(t, (np.nan, np.nan))[0] for t in tree_ids], dtype="float64")
    py = np.array([pmap.get(t, (np.nan, np.nan))[1] for t in tree_ids], dtype="float64")
    del pmap, rows
    valid_pt = np.isfinite(px) & np.isfinite(py)
    pt_idx = np.where(valid_pt)[0]
    point_geoms = np.empty(n, dtype=object)
    if pt_idx.size:
        point_geoms[pt_idx] = shapely.points(px[pt_idx], py[pt_idx])
    log(f"tree points with 2193 coords: {valid_pt.sum():,}/{n:,}")

    created_at = utc_now()

    # --- flood plains (crown intersects) ---
    g, _a = load_layer("flood_plains")
    fp_in, _fi = intersect_pairs(crown_geoms, g)
    fp_count = np.bincount(fp_in, minlength=n).astype("int64")
    del g
    log(f"flood_plains: {int((fp_count > 0).sum()):,} crowns intersect")

    # --- flood-prone areas (crown intersects + max depth) ---
    g, attrs = load_layer("flood_prone_areas")
    prn_in, prn_fi = intersect_pairs(crown_geoms, g)
    prone_count = np.bincount(prn_in, minlength=n).astype("int64")
    prone_maxdepth = np.full(n, np.nan)
    if g is not None and prn_in.size:
        m = len(g)
        d100 = _col_numeric(attrs, "Depth100y", m)
        dmax = _col_numeric(attrs, "MaxDepth", m)
        feat_depth = np.fmax(d100, dmax)
        np.fmax.at(prone_maxdepth, prn_in, feat_depth[prn_fi])
    del g, attrs
    log(f"flood_prone_areas: {int((prone_count > 0).sum()):,} crowns intersect")

    # --- overland flow paths (crown nearest) ---
    g, _a = load_layer("overland_flow_paths")
    dist_flow = nearest_distance(crown_geoms, g, valid_idx=crown_valid_idx, n_out=n)
    del g
    log("overland_flow_paths: nearest done")

    del crown_geoms  # crown-based layers finished

    # --- stormwater layers (point nearest) ---
    storm = {}
    for slug, key in [
        ("stormwater_pipe", "dist_stormwater_pipe_m"),
        ("stormwater_catchpit", "dist_stormwater_catchpit_m"),
        ("stormwater_manhole_chamber", "dist_stormwater_manhole_m"),
        ("stormwater_inlet_outlet", "dist_stormwater_inlet_outlet_m"),
    ]:
        g, _a = load_layer(slug)
        storm[key] = nearest_distance(point_geoms, g, valid_idx=pt_idx, n_out=n)
        del g
        log(f"{slug}: nearest done")

    # --- air temperature grid (point containing-or-nearest) ---
    t_mean = t_max = t_paved = t_build = t_trees = np.full(n, np.nan)
    g, attrs = load_layer("average_daily_air_temperature_2021_2022")
    if g is not None and pt_idx.size:
        m = len(g)
        tree = STRtree(g)
        qpts = point_geoms[pt_idx]
        cell = np.full(n, -1, dtype="int64")
        res = tree.query(qpts, predicate="intersects")
        if res.size:
            cell[pt_idx[res[0]]] = res[1]
        miss = (cell < 0) & valid_pt
        mi = np.where(miss)[0]
        if mi.size:
            idx, _d = tree.query_nearest(point_geoms[mi], all_matches=False, return_distance=True)
            cell[mi[idx[0]]] = idx[1]
        means = _col_numeric(attrs, "AirTemperatureMean", m)
        maxs = _col_numeric(attrs, "AirTemperatureMax", m)
        paved = _col_numeric(attrs, "FractionPavedSurfaces", m)
        build = _col_numeric(attrs, "FractionBuildings", m)
        trees = _col_numeric(attrs, "FractionTrees", m)

        def gather(arr):
            out = np.full(n, np.nan)
            ok = cell >= 0
            out[ok] = arr[cell[ok]]
            return out

        t_mean, t_max, t_paved, t_build, t_trees = (
            gather(means), gather(maxs), gather(paved), gather(build), gather(trees),
        )
    del g, attrs, point_geoms
    log("air_temperature: join done")

    # --- assemble records ---
    log("assembling records")
    records: list[dict[str, Any]] = []
    for i in range(n):
        records.append({
            "tree_id": str(tree_ids[i]),
            "source_tree_id": _s(src_ids[i]),
            "species_common": _s(species[i]),
            "owner_class": _s(owners[i]),
            "in_flood_plain": int(fp_count[i] > 0),
            "flood_plain_count": int(fp_count[i]),
            "in_flood_prone_area": int(prone_count[i] > 0),
            "flood_prone_area_count": int(prone_count[i]),
            "flood_prone_max_depth_m": _f(prone_maxdepth[i]),
            "dist_overland_flow_path_m": _f(dist_flow[i]),
            "dist_stormwater_pipe_m": _f(storm["dist_stormwater_pipe_m"][i]),
            "dist_stormwater_catchpit_m": _f(storm["dist_stormwater_catchpit_m"][i]),
            "dist_stormwater_manhole_m": _f(storm["dist_stormwater_manhole_m"][i]),
            "dist_stormwater_inlet_outlet_m": _f(storm["dist_stormwater_inlet_outlet_m"][i]),
            "air_temp_mean_c": _f(t_mean[i]),
            "air_temp_max_c": _f(t_max[i]),
            "fraction_paved_surfaces": _f(t_paved[i]),
            "fraction_buildings": _f(t_build[i]),
            "fraction_trees": _f(t_trees[i]),
            "context_confidence": "observed_public_spatial_join",
            "created_at_utc": created_at,
        })

    log(f"writing sqlite ({n:,} rows)")
    write_sqlite(records)
    log("writing csv")
    write_csv(records)

    if n <= GEOJSON_ENRICH_MAX:
        records_by_tree = {record["tree_id"]: record for record in records}
        log("enriching map GeoJSON (small pilot)")
        update_geojson(POINTS_PATH, records_by_tree)
        update_geojson(CROWNS_PATH, records_by_tree)
    else:
        log(f"[skip] GeoJSON context enrichment for {n:,} trees (> {GEOJSON_ENRICH_MAX:,}); web build re-derives from SQLite")

    write_report(records)
    print(json.dumps({
        "created_at_utc": created_at,
        "tree_context_count": len(records),
        "outputs": [str(CONTEXT_CSV_PATH.relative_to(ROOT)), "docs/tree_context_pilot.md"],
    }, indent=2))


if __name__ == "__main__":
    main()
