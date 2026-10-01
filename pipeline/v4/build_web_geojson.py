#!/usr/bin/env python3
"""Build slim GeoJSON files for the web map directly from SQLite.

This script is independent of the heavy intermediate geojsons. It joins the
canonical trees, lidar samples, crown geometry, context, and valuation
tables and writes two small files that the browser actually loads:

- ``trees_map_points.slim.geojson`` — every tree inside the LiDAR pilot bbox
  plus any notable/kauri point with usable structural data, with just the
  fields the popups and filters use, floats rounded, nulls stripped.
- ``tree_crowns_pilot.slim.geojson`` — crown polygons with the same lean
  attribute set, coordinates rounded to ~10 cm precision.

The full unslimmed files remain for analytical use.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any



ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"


def connect_readonly() -> sqlite3.Connection:
    """Open the shared database read-only.

    The single working database is also read by downstream users while a web
    build runs, so this stage must never take a write lock on it.
    """
    conn = sqlite3.connect(f"file:{SQLITE_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


POINT_FIELDS = [
    ("tree_id", "tree_id"),
    ("source_primary", "source_primary"),
    ("species_common", "species_common"),
    ("species_latin", "species_latin"),
    ("species_confidence", "species_confidence"),
    ("owner_class", "owner_class"),
    ("is_protected_notable", "is_protected_notable"),
    ("notable_point_review_required", "notable_point_review_required"),
    ("notable_point_name", "notable_point_name"),
    ("notable_group_names", "notable_group_names"),
    ("lidar_pilot", "lidar_pilot"),
    ("crown_pilot", "crown_pilot"),
    ("chm_local_max_2m_m", "chm_local_max_2m_m"),
    ("crown_area_m2", "crown_area_m2"),
    ("crown_max_chm_m", "crown_max_chm_m"),
    ("species_class", "species_class"),
    ("in_flood_prone_area", "in_flood_prone_area"),
    ("in_flood_plain", "in_flood_plain"),
    ("fraction_paved_surfaces", "fraction_paved_surfaces"),
    ("paved_fraction_used", "paved_fraction_used"),
    ("paved_fraction_source", "paved_fraction_source"),
    ("air_temp_mean_c", "air_temp_mean_c"),
    ("dist_overland_flow_path_m", "dist_overland_flow_path_m"),
    ("dist_stormwater_catchpit_m", "dist_stormwater_catchpit_m"),
    ("avoided_runoff_m3_y", "avoided_runoff_m3_y"),
    ("stormwater_value_nzd_y", "stormwater_value_nzd_y"),
    ("stored_co2e_tonnes_est", "stored_co2e_tonnes_est"),
    ("carbon_value_nzd_y", "carbon_value_nzd_y"),
    ("cooling_value_nzd_y", "cooling_value_nzd_y"),
    ("air_quality_value_nzd_y", "air_quality_value_nzd_y"),
    ("total_value_nzd_y", "total_value_nzd_y"),
    ("valuation_confidence", "valuation_confidence"),
    ("record_role", "record_role"),
]

# Audited growth form from tree_species_attributes. growth_form_confidence
# separates an actual identification ('known', from an i-Tree species/genus
# match on an inventory record) from a legacy model guess ('model_inferred'),
# which is the only honest way to show a growth form on the map. Merged in when
# the table exists.
#
# Mature-height references and plausibility screening remain in the full data
# download. They are not needed in map tiles and do not represent a field verdict.
SPECIES_ATTR_FIELDS = [
    "growth_form", "growth_form_source", "growth_form_confidence",
]

# Nominal crownless scenario from tree_valuation_scenarios. These are real,
# authoritative records (register, notable, kauri surveillance, OSM) with no
# measured canopy, so they carry no primary valuation. The per-tree scenario is
# shown as an explicitly nominal figure and stays out of every headline total.
SCENARIO_FIELDS = [
    "scenario_total_value_nzd_y", "scenario_name", "scenario_confidence",
]

# Asset-register fields from tree_assets_pilot (3D structure, competition,
# life stage, replacement, diversity). Merged in when the table exists.
ASSET_FIELDS = [
    "height_p25_m", "height_p50_m", "height_p75_m", "height_p95_m",
    "height_max_m", "height_mean_m", "crown_volume_m3",
    "canopy_density_proxy", "crown_complexity_index", "vertical_ratio",
    "nearest_tree_m", "neighbours_25m", "local_canopy_density_25m",
    "crown_overlap_index", "cluster_size", "growth_setting",
    "dominance_class", "edge_tree",
    "dbh_cm_crown_est", "dbh_confidence", "life_stage",
    "replacement_years_canopy", "irreplaceability_class",
    "condition_proxy",
    "neighbourhood_shannon", "neighbourhood_native_share",
]

# Change/growth fields from tree_change_pilot (Priorities 3 & 4). Merged in
# when the table exists.
CHANGE_FIELDS = [
    "historic_year", "historic_height_m", "current_height_m",
    "height_change_m", "height_change_pct", "annual_height_growth_m",
    "crown_area_change_pct", "tree_status", "growth_velocity_class",
    "canopy_change_class", "vitality_change_score", "structural_decline_flag",
]

# Point-cloud verification fields from tree_pointcloud_pilot (classified LAZ).
# Merged in when the table exists.
POINTCLOUD_FIELDS = [
    "pointcloud_class", "pc_canopy_present", "pc_review_no_canopy",
    "pc_false_positive", "n_points", "veg_fraction", "multireturn_fraction",
    "intensity_mean", "point_density",
    "canopy_top_m", "canopy_mean_m", "canopy_relief_ratio",
    # Canopy-structure metrics (build_tree_pointcloud_pilot.py). foliage_profile
    # (a per-tree JSON array) is intentionally excluded — too bulky to bake into
    # 260k vector-tile features for a click-only mini-chart.
    "canopy_cover", "gap_fraction", "height_to_live_crown_m",
    "understory_present", "n_canopy_layers", "canopy_rugosity_m",
]


KEEP_ZERO_FIELDS = {"crown_pilot"}


def strip(value: Any, *, keep_zero: bool = False) -> Any:
    if isinstance(value, float):
        rounded = round(value, 2)
        if rounded == 0.0:
            return 0 if keep_zero else None
        return rounded
    if value == "" or value == 0 or value == 0.0:
        return 0 if keep_zero else None
    return value


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone())


class FeatureWriter:
    """Stream a FeatureCollection to disk.

    At metro scale the collection holds ~1.4 million features. Accumulating
    them in a list and calling json.dumps once needs well over ten gigabytes of
    resident memory and thrashes swap; writing incrementally keeps the build to
    a roughly constant footprint and is faster for the same output.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._fh = None
        self.count = 0

    def __enter__(self) -> "FeatureWriter":
        self._fh = self.path.open("w", encoding="utf-8")
        self._fh.write('{"type":"FeatureCollection","features":[')
        return self

    def add(self, feature: dict) -> None:
        if self.count:
            self._fh.write(",")
        self._fh.write(json.dumps(feature, separators=(",", ":")))
        self.count += 1

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._fh is None:
            return
        # Leave no half-written collection behind for a later stage to tile.
        if exc_type is None:
            self._fh.write("]}")
        self._fh.close()
        self._fh = None
        if exc_type is not None:
            self.path.unlink(missing_ok=True)

    def report(self) -> None:
        size_mb = self.path.stat().st_size / 1024 / 1024
        print(f"{self.path.name}: {self.count:,} features ({size_mb:.1f} MB)")


def iter_geojson_features(path: Path, *, chunk_size: int = 1 << 22):
    """Yield features one at a time from a large FeatureCollection.

    The intermediate crown file is a single ~2 GB line, so it cannot be read
    line by line and json.load would materialise the whole document. This walks
    the byte stream tracking brace depth outside of strings and parses one
    feature object at a time.
    """
    with path.open("r", encoding="utf-8") as fh:
        buf = ""
        pos = 0
        started = False
        depth = 0
        start = -1
        in_string = False
        escaped = False
        while True:
            if pos >= len(buf):
                chunk = fh.read(chunk_size)
                if not chunk:
                    break
                buf = buf[pos:] if start < 0 else buf[start:]
                if start >= 0:
                    pos -= start
                    start = 0
                else:
                    pos = 0
                buf += chunk
            ch = buf[pos]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
            elif ch == '"':
                in_string = True
            elif not started:
                # Skip the envelope until the features array opens.
                if ch == "[":
                    started = True
            elif ch == "{":
                if depth == 0:
                    start = pos
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and start >= 0:
                    yield json.loads(buf[start:pos + 1])
                    start = -1
            pos += 1


def write_points() -> None:
    conn = connect_readonly()
    try:
        has_assets = _has_table(conn, "tree_assets_pilot")
        has_change = _has_table(conn, "tree_change_pilot")
        has_pc = _has_table(conn, "tree_pointcloud_pilot")
        has_species_attr = _has_table(conn, "tree_species_attributes")
        has_scenarios = _has_table(conn, "tree_valuation_scenarios")
        # pc_review_no_canopy is added by apply_pointcloud_verdicts.py; only
        # select columns that actually exist so an unverified DB still builds.
        pc_cols = (
            {r[1] for r in conn.execute("PRAGMA table_info(tree_pointcloud_pilot)")}
            if has_pc else set()
        )
        pc_fields = [f for f in POINTCLOUD_FIELDS if f in pc_cols]
        asset_select = (
            ", " + ", ".join(f"a.{f} AS {f}" for f in ASSET_FIELDS)
            if has_assets else ""
        )
        asset_join = (
            "LEFT JOIN tree_assets_pilot a ON a.tree_id = t.tree_id"
            if has_assets else ""
        )
        change_select = (
            ", " + ", ".join(f"ch.{f} AS {f}" for f in CHANGE_FIELDS)
            if has_change else ""
        )
        change_join = (
            "LEFT JOIN tree_change_pilot ch ON ch.tree_id = t.tree_id"
            if has_change else ""
        )
        pc_select = (
            ", " + ", ".join(f"pc.{f} AS {f}" for f in pc_fields)
            if pc_fields else ""
        )
        pc_join = (
            "LEFT JOIN tree_pointcloud_pilot pc ON pc.tree_id = t.tree_id"
            if pc_fields else ""
        )
        # Exclude crown-merge duplicate seeds (apply_crown_merge.py) so a tree
        # split across several council points isn't drawn — or counted — twice.
        dup_join = (
            "LEFT JOIN tree_pointcloud_pilot dup ON dup.tree_id = t.tree_id"
            if has_pc and "is_duplicate_seed" in pc_cols else ""
        )
        dup_where = (
            "WHERE COALESCE(dup.is_duplicate_seed, 0) = 0"
            if dup_join else ""
        )
        sa_select = (
            ", " + ", ".join(f"sa.{f} AS {f}" for f in SPECIES_ATTR_FIELDS)
            if has_species_attr else ""
        )
        sa_join = (
            "LEFT JOIN tree_species_attributes sa ON sa.tree_id = t.tree_id"
            if has_species_attr else ""
        )
        sc_select = (
            ", sc.total_value_nzd_y AS scenario_total_value_nzd_y"
            ", sc.scenario_name AS scenario_name"
            ", sc.valuation_confidence AS scenario_confidence"
            if has_scenarios else ""
        )
        sc_join = (
            "LEFT JOIN tree_valuation_scenarios sc ON sc.tree_id = t.tree_id"
            if has_scenarios else ""
        )
        cursor = conn.execute(
            f"""
            SELECT
                t.tree_id, t.source_primary, t.species_common, t.species_latin,
                t.species_confidence, t.owner_class, t.is_protected_notable,
                t.notable_point_review_required, t.notable_point_name,
                t.notable_group_names, t.record_role, t.lon, t.lat,
                CASE WHEN l.chm_local_max_2m_m IS NOT NULL THEN 1 ELSE 0 END AS lidar_pilot,
                CASE WHEN c.crown_area_m2 IS NOT NULL THEN 1 ELSE 0 END AS crown_pilot,
                l.chm_local_max_2m_m,
                c.crown_area_m2, c.crown_max_chm_m, c.crown_diameter_m,
                v.species_class,
                ctx.in_flood_prone_area, ctx.in_flood_plain,
                ctx.fraction_paved_surfaces, ctx.air_temp_mean_c,
                ctx.dist_overland_flow_path_m, ctx.dist_stormwater_catchpit_m,
                v.paved_fraction_used, v.paved_fraction_source,
                v.avoided_runoff_m3_y, v.stormwater_value_nzd_y,
                v.stored_co2e_tonnes_est, v.carbon_value_nzd_y,
                v.cooling_value_nzd_y, v.air_quality_value_nzd_y,
                v.pm25_removed_kg_y,
                v.total_value_nzd_y, v.valuation_confidence
                {asset_select}
                {change_select}
                {pc_select}
                {sa_select}
                {sc_select}
            FROM trees t
            LEFT JOIN tree_lidar_pilot l ON l.tree_id = t.tree_id
            LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
            LEFT JOIN tree_context_pilot ctx ON ctx.tree_id = t.tree_id
            LEFT JOIN tree_valuation_pilot v ON v.tree_id = t.tree_id
            {asset_join}
            {change_join}
            {pc_join}
            {sa_join}
            {sc_join}
            {dup_join}
            {dup_where}
            """
        )

        # Column presence comes from the cursor rather than a first row, so the
        # result set can be streamed instead of materialised.
        available = {d[0] for d in cursor.description}
        extra_keys = ["crown_diameter_m", "pm25_removed_kg_y"]
        if "life_stage" in available:
            extra_keys += ASSET_FIELDS
        if "tree_status" in available:
            extra_keys += CHANGE_FIELDS
        if "pointcloud_class" in available:
            extra_keys += [f for f in POINTCLOUD_FIELDS if f in available]
        if "growth_form" in available:
            extra_keys += SPECIES_ATTR_FIELDS
        if "scenario_total_value_nzd_y" in available:
            extra_keys += SCENARIO_FIELDS
        extra_keys = [k for k in extra_keys if k in available]

        out = PROCESSED_ROOT / "trees_map_points.slim.geojson"
        with FeatureWriter(out) as writer:
            for row in cursor:
                rd = dict(row)
                lon = rd["lon"]
                lat = rd["lat"]
                if lon is None or lat is None:
                    continue
                props: dict[str, Any] = {}
                for key, sql_key in POINT_FIELDS:
                    value = strip(rd.get(sql_key), keep_zero=key in KEEP_ZERO_FIELDS)
                    if value is not None:
                        props[key] = value
                for key in extra_keys:
                    value = rd.get(key)
                    # keep strings/ints as-is; round floats, drop None
                    if value is None:
                        continue
                    if isinstance(value, float):
                        value = round(value, 3)
                    props[key] = value
                writer.add({
                    "type": "Feature",
                    "id": rd["tree_id"],
                    "properties": props,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(lon, 6), round(lat, 6)],
                    },
                })
        writer.report()
    finally:
        conn.close()


def write_crowns() -> None:
    full_path = PROCESSED_ROOT / "tree_crowns_pilot.geojson"
    if not full_path.exists():
        print("no full crowns file to slim")
        return
    # Pull live valuation/context per tree to merge in.
    conn = connect_readonly()
    try:
        has_species_attr = _has_table(conn, "tree_species_attributes")
        sa_select = (
            ", " + ", ".join(f"sa.{f} AS {f}" for f in SPECIES_ATTR_FIELDS)
            if has_species_attr else ""
        )
        sa_join = (
            "LEFT JOIN tree_species_attributes sa ON sa.tree_id = c.tree_id"
            if has_species_attr else ""
        )
        cursor = conn.execute(
            f"""
            SELECT
                t.tree_id, t.source_primary, t.species_common, t.species_latin,
                t.owner_class, t.is_protected_notable, t.record_role,
                c.crown_area_m2, c.crown_diameter_m, c.crown_max_chm_m,
                v.species_class,
                ctx.in_flood_prone_area, ctx.fraction_paved_surfaces, ctx.air_temp_mean_c,
                v.paved_fraction_used, v.paved_fraction_source,
                v.avoided_runoff_m3_y, v.stormwater_value_nzd_y,
                v.stored_co2e_tonnes_est, v.carbon_value_nzd_y,
                v.cooling_value_nzd_y, v.air_quality_value_nzd_y,
                v.total_value_nzd_y, v.valuation_confidence
                {sa_select}
            FROM tree_crown_pilot c
            JOIN trees t ON t.tree_id = c.tree_id
            LEFT JOIN tree_context_pilot ctx ON ctx.tree_id = c.tree_id
            LEFT JOIN tree_valuation_pilot v ON v.tree_id = c.tree_id
            {sa_join}
            """
        )
        # Keep the lookup as tuples rather than a dict per tree: at 1.4 million
        # crowns the dict-of-dicts form alone costs several gigabytes.
        columns = [d[0] for d in cursor.description]
        id_at = columns.index("tree_id")
        props_by_tree = {row[id_at]: tuple(row) for row in cursor}
    finally:
        conn.close()

    # Round polygon coordinates to ~10 cm precision.
    def round_coords(coords):
        if isinstance(coords, (int, float)):
            return round(coords, 5)
        if isinstance(coords, list):
            return [round_coords(c) for c in coords]
        return coords

    skipped_keys = {"lidar_pilot", "crown_pilot", "chm_local_max_2m_m"}
    index = {name: i for i, name in enumerate(columns)}
    out = PROCESSED_ROOT / "tree_crowns_pilot.slim.geojson"
    dropped = 0
    with FeatureWriter(out) as writer:
        for feature in iter_geojson_features(full_path):
            tree_id = feature.get("id") or feature.get("properties", {}).get("tree_id")
            sql_props = props_by_tree.get(tree_id)
            if sql_props is None:
                # A crown whose tree is no longer in the database, for example
                # a detection deleted by point-cloud verification.
                dropped += 1
                continue
            props: dict[str, Any] = {}
            for key, sql_key in POINT_FIELDS:
                if key in skipped_keys or sql_key not in index:
                    continue
                value = strip(sql_props[index[sql_key]])
                if value is not None:
                    props[key] = value
            # Crown-specific extras.
            if "crown_diameter_m" in index:
                cd = strip(sql_props[index["crown_diameter_m"]])
                if cd is not None:
                    props["crown_diameter_m"] = cd
            for key in SPECIES_ATTR_FIELDS:
                if key not in index:
                    continue
                value = sql_props[index[key]]
                if value is None:
                    continue
                props[key] = round(value, 3) if isinstance(value, float) else value

            geom = feature.get("geometry") or {}
            if "coordinates" in geom:
                geom["coordinates"] = round_coords(geom["coordinates"])
            writer.add({
                "type": "Feature",
                "id": tree_id,
                "properties": props,
                "geometry": geom,
            })
    writer.report()
    if dropped:
        print(f"  dropped {dropped:,} crowns with no matching tree row")


def main() -> None:
    write_points()
    write_crowns()


if __name__ == "__main__":
    main()
