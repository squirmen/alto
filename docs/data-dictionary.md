# ALTO Auckland: per-tree data dictionary

1,677,438 current tree records; 85 attributes plus point geometry in GeoParquet.

Blank means unavailable or not applicable, never zero. Service fields exclude nominal crownless scenarios. Historic trajectories are included only where linked to a current record; removed trees without current records are in the separate map change layer. All dates describe the source or processing, not a fresh field survey.

Height, crown shape, condition, life stage and replacement are remote-sensing or model outputs. Growth-form model scores and service sensitivity bounds are not calibrated probabilities or statistical confidence intervals. Classified LiDAR evidence is separate from the raster canopy-height indicator. Mature-height references use the audited feet-to-metres correction. They are screening references, not hard biological ceilings.

| Field | Description | Records with a value |
| --- | --- | ---: |
| `tree_id` | Stable identifier for the tree record. | 1,677,438 |
| `source` | Primary data source for the record (council register, LiDAR-inferred, etc.). | 1,677,438 |
| `record_role` | Audited evidence role from the inventory; surveillance observations are not a tree census. | 1,677,438 |
| `taxon_assertion_status` | Audited status of the recorded taxonomic assertion. | 367 |
| `source_object_id` | Identifier in the source dataset. | 76,812 |
| `record_updated_utc` | Source record timestamp, UTC. | 1,677,438 |
| `owner_class` | Land-tenure class of the host site (public, private, road, park). | 1,677,438 |
| `protected_notable` | 1 if the tree is on a protected or notable schedule. | 1,677,438 |
| `lon` | Longitude (WGS84, EPSG:4326). | 1,677,438 |
| `lat` | Latitude (WGS84, EPSG:4326). | 1,677,438 |
| `x_nztm` | Easting (NZ Transverse Mercator, EPSG:2193). | 1,663,508 |
| `y_nztm` | Northing (NZ Transverse Mercator, EPSG:2193). | 1,663,508 |
| `species_common` | Source common name; missing identities may be blank or the literal Unknown. | 1,668,595 |
| `species_latin` | Source scientific name; missing identities may be blank or the literal Unknown. | 65,434 |
| `species_id_confidence` | Confidence in the recorded species identity. | 1,677,438 |
| `growth_form` | Growth form (evergreen broadleaf, deciduous broadleaf, conifer, palm/other). | 1,432,034 |
| `growth_form_confidence` | 'known' = derived from an identified species; 'model_inferred' = aerial-image model estimate (low confidence). | 1,444,293 |
| `growth_form_model_probability` | Stored growth-form model score; calibration and independent accuracy are not established for individual trees. | 1,367,481 |
| `species_mature_height_m` | i-Tree species or genus reference height converted from feet to metres; a plausibility reference, not this tree's expected height or a biological maximum. | 64,491 |
| `species_reference_match` | Exact species, genus fallback, image-model growth form, or none. The mature-height reference exists only for i-Tree matches. | 1,444,293 |
| `height_plausibility` | Screening flag against 1.3 times the reference height: implausibly_tall, ok, no_ceiling or no_height; not a species or tree-presence verdict. | 1,444,293 |
| `height_m` | Canopy height, maximum (metres), from the canopy height model. | 1,416,984 |
| `height_p50_m` | Canopy height, median of the vertical profile (metres). | 1,416,984 |
| `height_p95_m` | Canopy height, 95th percentile of the vertical profile (metres). | 1,416,984 |
| `crown_area_m2` | Crown projected area (square metres). | 1,650,129 |
| `crown_diameter_m` | Crown diameter (metres). | 1,650,129 |
| `crown_volume_m3` | Crown volume (cubic metres). | 1,416,984 |
| `dbh_cm_modelled` | Trunk diameter at breast height, modelled from crown allometry (centimetres). | 1,416,984 |
| `dbh_confidence` | Confidence band for the modelled trunk diameter. | 1,416,984 |
| `canopy_density` | Fullness of the vertical canopy profile (0-1). | 1,416,984 |
| `crown_complexity` | Structural complexity index of the crown. | 1,416,984 |
| `life_stage` | Life stage class (juvenile through veteran). | 1,416,984 |
| `condition_proxy` | Remote-sensed condition proxy. | 1,416,984 |
| `dominance_class` | Canopy dominance class relative to neighbours. | 1,416,984 |
| `chm_height_at_point_m` | Canopy height model value at the tree point (metres). | 1,663,508 |
| `canopy_confirmed_ge_3m` | 1 where the raster canopy height model indicates canopy at or above 3 metres at the point; not classified point-cloud verification. | 1,663,508 |
| `stored_co2e_t` | Modelled stored-carbon scenario (tonnes CO2-equivalent), not a measured carbon stock. | 1,650,129 |
| `sequestration_tco2e_yr` | Annual carbon sequestration (tonnes CO2-equivalent per year). | 1,650,129 |
| `carbon_value_nzd_yr` | Annual carbon value (NZ$ per year). | 1,650,129 |
| `avoided_runoff_m3_yr` | Avoided stormwater runoff (cubic metres per year). | 1,650,129 |
| `stormwater_value_nzd_yr` | Annual stormwater value (NZ$ per year). | 1,650,129 |
| `cooling_value_nzd_yr` | Annual urban-cooling value (NZ$ per year). | 1,650,129 |
| `pm25_removed_kg_yr` | Fine-particulate (PM2.5) removed (kilograms per year). | 1,650,129 |
| `air_quality_value_nzd_yr` | Annual air-quality value (NZ$ per year). | 1,650,129 |
| `total_value_nzd_yr` | Exploratory annual ecosystem-service proxy (NZ$ per year); not a financial assessment. | 1,650,129 |
| `total_value_nzd_yr_low` | Lower sensitivity scenario for annual value (NZ$ per year); not a statistical confidence limit. | 1,650,129 |
| `total_value_nzd_yr_high` | Upper sensitivity scenario for annual value (NZ$ per year); not a statistical confidence limit. | 1,650,129 |
| `valuation_confidence` | Confidence band for the valuation. | 1,650,129 |
| `root_zone_radius_m` | Modelled root-space scenario radius (metres); not a measured root extent. | 1,416,984 |
| `root_zone_area_m2` | Modelled root-space scenario area (square metres). | 1,416,984 |
| `root_constraint` | Scenario constraint class; legacy at_risk and future space_deficit_review mean an assumed space deficit, not windthrow probability. | 1,416,984 |
| `in_flood_plain` | 1 if the tree falls within a mapped flood plain. | 1,416,984 |
| `paved_fraction_30m` | Paved-surface fraction within 30 metres (0-1). | 1,416,984 |
| `building_fraction_30m` | Building fraction within 30 metres (0-1). | 1,416,984 |
| `air_temp_mean_c` | Modelled mean air temperature at the site (degrees Celsius). | 1,416,984 |
| `pointcloud_class` | Classified LiDAR evidence class; no_data means no usable coverage. | 1,444,293 |
| `pointcloud_canopy_present` | 1 where classified LiDAR returns corroborate canopy. | 1,444,293 |
| `pointcloud_review_no_canopy` | 1 where a record needs review because classified returns do not corroborate canopy. | 1,444,293 |
| `pointcloud_return_count` | Number of sampled classified LiDAR returns. | 1,444,293 |
| `pointcloud_vegetation_fraction` | Share of sampled returns classified as vegetation (0–1). | 1,285,748 |
| `pointcloud_density` | Sampled point-cloud density, returns per square metre. | 1,444,293 |
| `pointcloud_canopy_cover` | Canopy cover proxy from LiDAR first returns (0–1). | 1,288,485 |
| `pointcloud_gap_fraction` | Canopy gap proxy from LiDAR returns (0–1). | 1,288,485 |
| `height_to_live_crown_m` | Modelled height to sustained foliage from classified returns, metres. | 1,267,691 |
| `canopy_layers` | Estimated number of vertical foliage layers. | 1,270,957 |
| `canopy_rugosity_m` | Canopy top-surface roughness, metres. | 1,281,577 |
| `pointcloud_processed_utc` | Point-cloud processing timestamp, UTC. | 1,444,293 |
| `nearest_tree_m` | Distance to nearest mapped tree, metres. | 1,416,984 |
| `neighbours_25m` | Mapped neighbouring trees within 25 metres. | 1,416,984 |
| `growth_setting` | Modelled standalone, cluster or forest-patch setting. | 1,416,984 |
| `neighbourhood_shannon` | Modelled local diversity index; depends on available species and class assignments. | 1,416,984 |
| `neighbourhood_native_share` | Modelled local native share; not a field-verified species census. | 1,416,984 |
| `replacement_years_canopy` | Indicative modelled years to replace canopy, not a forecast. | 1,416,984 |
| `valuation_method` | Method identifier for the service scenario. | 1,650,129 |
| `valuation_processed_utc` | Service-scenario processing timestamp, UTC. | 1,650,129 |
| `allometry_source` | Species or class basis used by biomass allometry. | 1,650,129 |
| `paved_fraction_source` | Source of impervious-surface input used by service scenarios. | 1,650,129 |
| `valuation_sensitivity_factor` | Scenario sensitivity multiplier, not a calibrated probability. | 1,650,129 |
| `trajectory_fate` | Cross-epoch canopy trajectory class, where linked to this current record; not field-confirmed removal or establishment. | 1,212,863 |
| `height_2013_m` | Historic 2013 canopy-model height at trajectory location, metres; blank without coverage. | 92,775 |
| `height_2016_m` | Historic 2016 canopy-model height at trajectory location, metres; blank without coverage. | 120,835 |
| `height_2024_m` | 2024 canopy-model height at trajectory location, metres. | 1,212,863 |
| `height_change_2013_2016_m_yr` | Annualised canopy-model height difference, 2013–2016, metres/year; not repeated stem measurement. | 92,775 |
| `height_change_2016_2024_m_yr` | Annualised canopy-model height difference, 2016–2024, metres/year; not repeated stem measurement. | 120,835 |
| `trajectory_implausible` | Trajectory plausibility flag from the existing model; retain for review. | 1,212,863 |
