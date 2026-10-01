#!/usr/bin/env python3
"""Build the public per-tree data export for the Aotearoa Long-term Tree Observatory (ALTO) model.

Produces a curated, documented release of the inventory in two open formats:
  * GeoParquet  (point geometry, EPSG:4326) for GIS and analysis
  * gzipped CSV (lon/lat columns)           for spreadsheets and general use

Plus a data dictionary describing every field. The export is a curated subset of
the master tables: identity and location, species and growth form (with explicit
confidence tiers), dimensions and structure, ecosystem-service estimates, root
zone, and site context. Confidence and evidence fields travel with the data so
downstream users can filter on certainty.
"""

from __future__ import annotations

import gzip
import json
from datetime import datetime, timezone
import pyarrow as pa
import pyarrow.parquet as pq
import shapely
import sqlite3
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT_DIR = ROOT / "data" / "processed" / "exports"

# Curated export schema: (SQL source expression, output column, description).
# Order here is the column order in the release and the data dictionary.
SCHEMA = [
    ("t.tree_id", "tree_id", "Stable identifier for the tree record."),
    ("t.source_primary", "source", "Primary data source for the record (council register, LiDAR-inferred, etc.)."),
    ("t.record_role", "record_role", "Audited evidence role from the inventory; surveillance observations are not a tree census."),
    ("t.taxon_assertion_status", "taxon_assertion_status", "Audited status of the recorded taxonomic assertion."),
    ("t.source_object_id", "source_object_id", "Identifier in the source dataset."),
    ("t.as_of_utc", "record_updated_utc", "Source record timestamp, UTC."),
    ("t.owner_class", "owner_class", "Land-tenure class of the host site (public, private, road, park)."),
    ("t.is_protected_notable", "protected_notable", "1 if the tree is on a protected or notable schedule."),
    ("t.lon", "lon", "Longitude (WGS84, EPSG:4326)."),
    ("t.lat", "lat", "Latitude (WGS84, EPSG:4326)."),
    ("l.x_2193", "x_nztm", "Easting (NZ Transverse Mercator, EPSG:2193)."),
    ("l.y_2193", "y_nztm", "Northing (NZ Transverse Mercator, EPSG:2193)."),
    # Species and growth form, with honest certainty tiers.
    ("t.species_common", "species_common", "Source common name; missing identities may be blank or the literal Unknown."),
    ("t.species_latin", "species_latin", "Source scientific name; missing identities may be blank or the literal Unknown."),
    ("t.species_confidence", "species_id_confidence", "Confidence in the recorded species identity."),
    ("sa.growth_form", "growth_form", "Growth form (evergreen broadleaf, deciduous broadleaf, conifer, palm/other)."),
    ("sa.growth_form_confidence", "growth_form_confidence",
     "'known' = derived from an identified species; 'model_inferred' = aerial-image model estimate (low confidence)."),
    ("sa.model_confidence", "growth_form_model_probability", "Stored growth-form model score; calibration and independent accuracy are not established for individual trees."),
    ("sa.mature_height_m", "species_mature_height_m", "i-Tree species or genus reference height converted from feet to metres; a plausibility reference, not this tree's expected height or a biological maximum."),
    ("sa.growth_form_source", "species_reference_match", "Exact species, genus fallback, image-model growth form, or none. The mature-height reference exists only for i-Tree matches."),
    ("sa.height_plausibility", "height_plausibility", "Screening flag against 1.3 times the reference height: implausibly_tall, ok, no_ceiling or no_height; not a species or tree-presence verdict."),
    # Dimensions and structure.
    ("a.height_max_m", "height_m", "Canopy height, maximum (metres), from the canopy height model."),
    ("a.height_p50_m", "height_p50_m", "Canopy height, median of the vertical profile (metres)."),
    ("a.height_p95_m", "height_p95_m", "Canopy height, 95th percentile of the vertical profile (metres)."),
    ("c.crown_area_m2", "crown_area_m2", "Crown projected area (square metres)."),
    ("c.crown_diameter_m", "crown_diameter_m", "Crown diameter (metres)."),
    ("a.crown_volume_m3", "crown_volume_m3", "Crown volume (cubic metres)."),
    ("a.dbh_cm_crown_est", "dbh_cm_modelled", "Trunk diameter at breast height, modelled from crown allometry (centimetres)."),
    ("a.dbh_confidence", "dbh_confidence", "Confidence band for the modelled trunk diameter."),
    ("a.canopy_density_proxy", "canopy_density", "Fullness of the vertical canopy profile (0-1)."),
    ("a.crown_complexity_index", "crown_complexity", "Structural complexity index of the crown."),
    ("a.life_stage", "life_stage", "Life stage class (juvenile through veteran)."),
    ("a.condition_proxy", "condition_proxy", "Remote-sensed condition proxy."),
    ("a.dominance_class", "dominance_class", "Canopy dominance class relative to neighbours."),
    # Detection evidence.
    ("l.chm_at_point_m", "chm_height_at_point_m", "Canopy height model value at the tree point (metres)."),
    ("l.likely_canopy_ge_3m", "canopy_confirmed_ge_3m", "1 where the raster canopy height model indicates canopy at or above 3 metres at the point; not classified point-cloud verification."),
    # Ecosystem-service estimates (physical and monetary, annual unless noted).
    ("v.stored_co2e_tonnes_est", "stored_co2e_t", "Modelled stored-carbon scenario (tonnes CO2-equivalent), not a measured carbon stock."),
    ("v.annual_sequestration_tco2e_y_est", "sequestration_tco2e_yr", "Annual carbon sequestration (tonnes CO2-equivalent per year)."),
    ("v.carbon_value_nzd_y", "carbon_value_nzd_yr", "Annual carbon value (NZ$ per year)."),
    ("v.avoided_runoff_m3_y", "avoided_runoff_m3_yr", "Avoided stormwater runoff (cubic metres per year)."),
    ("v.stormwater_value_nzd_y", "stormwater_value_nzd_yr", "Annual stormwater value (NZ$ per year)."),
    ("v.cooling_value_nzd_y", "cooling_value_nzd_yr", "Annual urban-cooling value (NZ$ per year)."),
    ("v.pm25_removed_kg_y", "pm25_removed_kg_yr", "Fine-particulate (PM2.5) removed (kilograms per year)."),
    ("v.air_quality_value_nzd_y", "air_quality_value_nzd_yr", "Annual air-quality value (NZ$ per year)."),
    ("v.total_value_nzd_y", "total_value_nzd_yr", "Exploratory annual ecosystem-service proxy (NZ$ per year); not a financial assessment."),
    ("v.total_value_nzd_y_low", "total_value_nzd_yr_low", "Lower sensitivity scenario for annual value (NZ$ per year); not a statistical confidence limit."),
    ("v.total_value_nzd_y_high", "total_value_nzd_yr_high", "Upper sensitivity scenario for annual value (NZ$ per year); not a statistical confidence limit."),
    ("v.valuation_confidence", "valuation_confidence", "Confidence band for the valuation."),
    # Root zone.
    ("rz.effective_radius_m", "root_zone_radius_m", "Modelled root-space scenario radius (metres); not a measured root extent."),
    ("rz.effective_area_m2", "root_zone_area_m2", "Modelled root-space scenario area (square metres)."),
    ("rz.root_constraint_flag", "root_constraint", "Scenario constraint class; legacy at_risk and future space_deficit_review mean an assumed space deficit, not windthrow probability."),
    # Site context.
    ("ctx.in_flood_plain", "in_flood_plain", "1 if the tree falls within a mapped flood plain."),
    ("ctx.fraction_paved_surfaces", "paved_fraction_30m", "Paved-surface fraction within 30 metres (0-1)."),
    ("ctx.fraction_buildings", "building_fraction_30m", "Building fraction within 30 metres (0-1)."),
    ("ctx.air_temp_mean_c", "air_temp_mean_c", "Modelled mean air temperature at the site (degrees Celsius)."),
]

# Rich analytical attributes stay in downloads, avoiding larger map tiles.
SCHEMA += [
    ("pc.pointcloud_class", "pointcloud_class", "Classified LiDAR evidence class; no_data means no usable coverage."),
    ("pc.pc_canopy_present", "pointcloud_canopy_present", "1 where classified LiDAR returns corroborate canopy."),
    ("pc.pc_review_no_canopy", "pointcloud_review_no_canopy", "1 where a record needs review because classified returns do not corroborate canopy."),
    ("pc.n_points", "pointcloud_return_count", "Number of sampled classified LiDAR returns."),
    ("pc.veg_fraction", "pointcloud_vegetation_fraction", "Share of sampled returns classified as vegetation (0–1)."),
    ("pc.point_density", "pointcloud_density", "Sampled point-cloud density, returns per square metre."),
    ("pc.canopy_cover", "pointcloud_canopy_cover", "Canopy cover proxy from LiDAR first returns (0–1)."),
    ("pc.gap_fraction", "pointcloud_gap_fraction", "Canopy gap proxy from LiDAR returns (0–1)."),
    ("pc.height_to_live_crown_m", "height_to_live_crown_m", "Modelled height to sustained foliage from classified returns, metres."),
    ("pc.n_canopy_layers", "canopy_layers", "Estimated number of vertical foliage layers."),
    ("pc.canopy_rugosity_m", "canopy_rugosity_m", "Canopy top-surface roughness, metres."),
    ("pc.created_at_utc", "pointcloud_processed_utc", "Point-cloud processing timestamp, UTC."),
    ("a.nearest_tree_m", "nearest_tree_m", "Distance to nearest mapped tree, metres."),
    ("a.neighbours_25m", "neighbours_25m", "Mapped neighbouring trees within 25 metres."),
    ("a.growth_setting", "growth_setting", "Modelled standalone, cluster or forest-patch setting."),
    ("a.neighbourhood_shannon", "neighbourhood_shannon", "Modelled local diversity index; depends on available species and class assignments."),
    ("a.neighbourhood_native_share", "neighbourhood_native_share", "Modelled local native share; not a field-verified species census."),
    ("a.replacement_years_canopy", "replacement_years_canopy", "Indicative modelled years to replace canopy, not a forecast."),
    ("v.method_id", "valuation_method", "Method identifier for the service scenario."),
    ("v.created_at_utc", "valuation_processed_utc", "Service-scenario processing timestamp, UTC."),
    ("v.species_allometry_source", "allometry_source", "Species or class basis used by biomass allometry."),
    ("v.paved_fraction_source", "paved_fraction_source", "Source of impervious-surface input used by service scenarios."),
    ("v.uncertainty_factor", "valuation_sensitivity_factor", "Scenario sensitivity multiplier, not a calibrated probability."),
    ("tr.fate", "trajectory_fate", "Cross-epoch canopy trajectory class, where linked to this current record; not field-confirmed removal or establishment."),
    ("tr.h_2013", "height_2013_m", "Historic 2013 canopy-model height at trajectory location, metres; blank without coverage."),
    ("tr.h_2016", "height_2016_m", "Historic 2016 canopy-model height at trajectory location, metres; blank without coverage."),
    ("tr.h_2024", "height_2024_m", "2024 canopy-model height at trajectory location, metres."),
    ("tr.growth_2013_2016", "height_change_2013_2016_m_yr", "Annualised canopy-model height difference, 2013–2016, metres/year; not repeated stem measurement."),
    ("tr.growth_2016_2024", "height_change_2016_2024_m_yr", "Annualised canopy-model height difference, 2016–2024, metres/year; not repeated stem measurement."),
    ("tr.implausible", "trajectory_implausible", "Trajectory plausibility flag from the existing model; retain for review."),
]

JOIN_SQL = """
SELECT {cols}
FROM trees t
LEFT JOIN tree_lidar_pilot       l   ON l.tree_id   = t.tree_id
LEFT JOIN tree_crown_pilot       c   ON c.tree_id   = t.tree_id
LEFT JOIN tree_assets_pilot      a   ON a.tree_id   = t.tree_id
LEFT JOIN tree_valuation_pilot   v   ON v.tree_id   = t.tree_id
                                      AND v.valuation_confidence != 'modelled_nominal'
LEFT JOIN tree_species_attributes sa ON sa.tree_id  = t.tree_id
LEFT JOIN tree_root_zone_pilot   rz  ON rz.tree_id  = t.tree_id
LEFT JOIN tree_context_pilot     ctx ON ctx.tree_id = t.tree_id
LEFT JOIN tree_pointcloud_pilot  pc ON pc.tree_id = t.tree_id
LEFT JOIN tree_trajectory_pilot  tr ON tr.canonical_tree_id = t.tree_id
"""


TEXT_FIELDS = {
    "tree_id", "source", "record_role", "taxon_assertion_status", "source_object_id",
    "record_updated_utc", "owner_class", "species_common", "species_latin", "species_id_confidence",
    "growth_form", "growth_form_confidence", "dbh_confidence", "life_stage", "condition_proxy",
    "dominance_class", "valuation_confidence", "root_constraint", "pointcloud_class",
    "pointcloud_processed_utc", "growth_setting", "valuation_method", "valuation_processed_utc",
    "allometry_source", "paved_fraction_source", "trajectory_fate", "species_reference_match", "height_plausibility",
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    # A many-to-one trajectory join would silently duplicate trees and service totals.
    duplicate = con.execute("SELECT canonical_tree_id FROM tree_trajectory_pilot "
        "WHERE canonical_tree_id IS NOT NULL GROUP BY canonical_tree_id HAVING COUNT(*) > 1 LIMIT 1").fetchone()
    if duplicate:
        raise RuntimeError(f"Ambiguous trajectory link: {duplicate[0]}")
    expected = con.execute("SELECT COUNT(*) FROM trees").fetchone()[0]
    cols = ", ".join(f"CAST({src} AS TEXT) AS {name}" if name in TEXT_FIELDS
                     else f"{src} AS {name}" for src, name, _ in SCHEMA)
    schema = pa.schema([(name, pa.string() if name in TEXT_FIELDS else pa.float64())
                        for _, name, _ in SCHEMA] + [("geometry", pa.binary())])
    schema = schema.with_metadata({b"geo": json.dumps({"version": "1.0.0", "primary_column": "geometry",
        "columns": {"geometry": {"encoding": "WKB", "geometry_types": ["Point"]}}}).encode()})
    # Omitted CRS in GeoParquet means OGC:CRS84 (longitude/latitude), as used here.
    csv_tmp = OUT_DIR / "akl_trees_metro.csv.gz.tmp"
    pq_tmp = OUT_DIR / "akl_trees_metro.parquet.tmp"
    rows = 0; coverage = {name: 0 for _, name, _ in SCHEMA}
    print(f"Exporting {expected:,} records in bounded chunks ({len(SCHEMA)} fields)...", flush=True)
    try:
        with gzip.open(csv_tmp, "wt", encoding="utf-8", newline="", compresslevel=6) as csv_file, pq.ParquetWriter(pq_tmp, schema, compression="zstd") as writer:
            for frame in pd.read_sql_query(JOIN_SQL.format(cols=cols), con, chunksize=25000):
                frame.to_csv(csv_file, index=False, header=rows == 0)
                for name in coverage: coverage[name] += int(frame[name].notna().sum())
                frame["geometry"] = shapely.to_wkb(shapely.points(frame["lon"], frame["lat"]))
                writer.write_table(pa.Table.from_pandas(frame, schema=schema, preserve_index=False))
                rows += len(frame)
                if rows % 250000 == 0: print(f"  {rows:,} records", flush=True)
        if rows != expected:
            raise RuntimeError(f"Join returned {rows:,} rows for {expected:,} trees")
        csv_tmp.replace(OUT_DIR / "akl_trees_metro.csv.gz")
        pq_tmp.replace(OUT_DIR / "akl_trees_metro.parquet")
    finally:
        con.close()
        csv_tmp.unlink(missing_ok=True); pq_tmp.unlink(missing_ok=True)

    dd = ["# ALTO Auckland: per-tree data dictionary", "",
          f"{rows:,} current tree records; {len(SCHEMA)} attributes plus point geometry in GeoParquet.", "",
          "Blank means unavailable or not applicable, never zero. Service fields exclude nominal "
          "crownless scenarios. Historic trajectories are included only where linked to a current "
          "record; removed trees without current records are in the separate map change layer. "
          "All dates describe the source or processing, not a fresh field survey.", "",
          "Height, crown shape, condition, life stage and replacement are remote-sensing or model "
          "outputs. Growth-form model scores and service sensitivity bounds are not calibrated "
          "probabilities or statistical confidence intervals. Classified LiDAR evidence is separate "
          "from the raster canopy-height indicator. Mature-height references use the audited "
          "feet-to-metres correction. They are screening references, not hard biological ceilings.", "",
          "| Field | Description | Records with a value |", "| --- | --- | ---: |"]
    dd += [f"| `{name}` | {desc} | {coverage[name]:,} |" for _, name, desc in SCHEMA]
    (OUT_DIR / "akl_trees_data_dictionary.md").write_text("\n".join(dd) + "\n", encoding="utf-8")
    manifest = {"dataset": "ALTO Auckland", "generated_utc": datetime.now(timezone.utc).isoformat(),
                "database_mtime_ns": DB.stat().st_mtime_ns, "records": rows, "fields": len(SCHEMA),
                "non_null_counts": coverage}
    (OUT_DIR / "export-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {rows:,} records, dictionary and coverage manifest.", flush=True)


if __name__ == "__main__":
    main()
