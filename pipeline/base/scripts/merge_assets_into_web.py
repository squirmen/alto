#!/usr/bin/env python3
"""Merge asset-register fields into the slim web GeoJSONs (standalone).

Used to refresh the web tiles with the ``tree_assets_pilot`` enrichment
without re-running the whole pipeline from SQLite. Reads:

  - data/processed/tree_assets_pilot.geojson   (asset fields, by tree_id)
  - data/processed/tree_crowns_pilot.slim.geojson (valuation fields, by tree_id)

and enriches:

  - tree_crowns_pilot.slim.geojson  (+ asset fields)
  - trees_map_points.slim.geojson   (+ valuation + asset fields so a clicked
                                      dot opens the same rich profile as a crown)

After this, run scripts/build_pmtiles.sh.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / "data" / "processed"

ASSET_FIELDS = [
    "height_p25_m", "height_p50_m", "height_p75_m", "height_p95_m",
    "height_max_m", "height_mean_m", "crown_volume_m3",
    "canopy_density_proxy", "crown_complexity_index", "vertical_ratio",
    "nearest_tree_m", "neighbours_25m", "local_canopy_density_25m",
    "crown_overlap_index", "cluster_size", "growth_setting",
    "dominance_class", "edge_tree",
    "dbh_cm_crown_est", "dbh_confidence", "life_stage",
    "replacement_years_canopy", "irreplaceability_class", "condition_proxy",
    "neighbourhood_shannon", "neighbourhood_native_share",
]
# Valuation/structure fields to push from crowns onto points so a clicked
# dot opens a full profile.
VALUATION_FIELDS = [
    "species_common", "species_class", "crown_area_m2", "crown_diameter_m",
    "crown_max_chm_m", "avoided_runoff_m3_y", "stormwater_value_nzd_y",
    "stored_co2e_tonnes_est", "carbon_value_nzd_y", "cooling_value_nzd_y",
    "air_quality_value_nzd_y", "total_value_nzd_y", "valuation_confidence",
    "paved_fraction_source", "in_flood_prone_area", "in_flood_plain",
]


CHANGE_FIELDS = [
    "historic_year", "historic_height_m", "current_height_m",
    "height_change_m", "height_change_pct", "annual_height_growth_m",
    "crown_area_change_pct", "tree_status", "growth_velocity_class",
    "canopy_change_class", "vitality_change_score", "structural_decline_flag",
]


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def index_by_id(fc: dict) -> dict:
    out = {}
    for f in fc.get("features", []):
        tid = f.get("id") or f.get("properties", {}).get("tree_id")
        if tid is not None:
            out[tid] = f["properties"]
    return out


def main() -> None:
    print("Loading asset + crown + change property indexes ...")
    assets = index_by_id(load(P / "tree_assets_pilot.geojson"))
    crowns_props = index_by_id(load(P / "tree_crowns_pilot.slim.geojson"))
    change_path = P / "tree_change_pilot.geojson"
    change = index_by_id(load(change_path)) if change_path.exists() else {}
    print(f"  assets: {len(assets):,}  crown props: {len(crowns_props):,}  change: {len(change):,}")

    # --- enrich crowns slim (asset + change fields)
    crowns = load(P / "tree_crowns_pilot.slim.geojson")
    n_c = 0
    for f in crowns["features"]:
        tid = f.get("id") or f["properties"].get("tree_id")
        a = assets.get(tid)
        ch = change.get(tid)
        if a:
            for k in ASSET_FIELDS:
                if a.get(k) is not None:
                    f["properties"][k] = a[k]
            n_c += 1
        if ch:
            for k in CHANGE_FIELDS:
                if ch.get(k) is not None:
                    f["properties"][k] = ch[k]
    (P / "tree_crowns_pilot.slim.geojson").write_text(
        json.dumps(crowns, separators=(",", ":")), encoding="utf-8")
    print(f"  crowns enriched: {n_c:,}")

    # --- enrich points slim (valuation + asset + change fields)
    points = load(P / "trees_map_points.slim.geojson")
    n_p = 0
    for f in points["features"]:
        tid = f.get("id") or f["properties"].get("tree_id")
        cp = crowns_props.get(tid)
        a = assets.get(tid)
        ch = change.get(tid)
        if cp:
            for k in VALUATION_FIELDS:
                if cp.get(k) is not None:
                    f["properties"][k] = cp[k]
        if a:
            for k in ASSET_FIELDS:
                if a.get(k) is not None:
                    f["properties"][k] = a[k]
        if ch:
            for k in CHANGE_FIELDS:
                if ch.get(k) is not None:
                    f["properties"][k] = ch[k]
        if cp or a or ch:
            n_p += 1
    (P / "trees_map_points.slim.geojson").write_text(
        json.dumps(points, separators=(",", ":")), encoding="utf-8")
    print(f"  points enriched: {n_p:,} / {len(points['features']):,}")

    for name in ("trees_map_points.slim.geojson", "tree_crowns_pilot.slim.geojson"):
        mb = (P / name).stat().st_size / 1024 / 1024
        print(f"  {name}: {mb:.1f} MB")


if __name__ == "__main__":
    main()
