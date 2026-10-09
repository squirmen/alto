# ALTO V5.2 full-record data dictionary

Release: 20261010-v5.2.

Each tree profile exposes the datasets below. The schema gives their exact ordered fields. Blank means unavailable, not zero. All source IDs and original coordinates are retained.

**Current crown area** is the segmented horizontal footprint in square metres. **Crown spread** is a width in metres and is not the same measurement. The area-derived equivalent diameter is a circular approximation, not a measured crown spread.

Only current representative records carry current service estimates. Shared-crown aliases may repeat crown measurements: do not sum areas over every source record. Earlier datasets retain their previous spatial and methodological basis.

V5.2 record-to-crown links are in `record_link`; `source_lon`/`source_lat` are the source position, unchanged, and `crown_source` `record_seeded_v52` marks a crown drawn from the record awaiting confirmation. Records outside survey coverage carry `record_link_status`.

## Original tree record

Original source IDs, names and coordinates remain unchanged. See current crown and identity evidence for the v5 association.

`record` → `trees`

Fields: `source_primary`, `source_object_id`, `source_tree_id`, `species_common_raw`, `species_latin_raw`, `species_common`, `species_latin`, `species_confidence`, `owner_raw`, `owner_class`, `lon`, `lat`, `approx_x_m`, `approx_y_m`, `is_protected_notable`, `notable_point_match`, `notable_point_spatial_candidate`, `notable_point_name_compatible`, `notable_point_review_required`, `notable_point_objectid`, `notable_point_name`, `notable_point_type`, `notable_point_type_label`, `notable_point_distance_m`, `notable_point_match_confidence`, `notable_group_match`, `notable_group_count`, `notable_group_objectids`, `notable_group_names`, `as_of_utc`, `record_role`, `taxon_assertion_status`.

## Current crown and record links

Polygon containment, audited crown continuity (v5.1) and record-to-crown links (v5.2) associate source records with current crowns. A shared crown can contain several trees; original positions, identities and histories remain separate.

`identity` → `tree_identity_v5`

Fields: `seg_key`, `current_primary_tree_id`, `evidence_tier`, `link_role`, `current_height_m`, `current_crown_area_m2`, `top_distance_m`, `method_id`, `source_records`, `inventory_records`, `members_json`, `new_overlapping_crowns`, `old_overlapping_crowns`, `within_v5_footprint`, `spatial_evidence_note`.

## Current canopy dimensions

V5 crown boundaries and maximum height from the 2024 survey; crown_source record_seeded_v52 marks a crown drawn in v5.2 from the returns at a source record's position, awaiting confirmation. Earlier v4 crowns remain in areas outside the v5 survey footprint.

`crown` → `tree_current_crown_v5`

Fields: `crown_area_m2`, `crown_diameter_m`, `crown_max_chm_m`, `mean_veg_height_m`, `method_id`, `crown_source`, `current_primary_tree_id`, `gap_filled_fraction`, `ndvi_mean`, `evidence_tier`, `evidence_reasons`.

## Current laser-return evidence

Return counts and structure within the v5 crown. Interpolated area is reported as gap_filled_fraction.

`pointcloud` → `tree_current_pointcloud_v5`

Fields: `canopy_top_m`, `n_veg_returns`, `n_building_returns`, `n_ground_returns`, `n_unclassified_returns`, `n_water_returns`, `n_bridge_returns`, `multi_return_fraction`, `intensity_mean`, `aerial_greenness`, `ndvi_mean`, `elongation`, `bbox_fill`, `gap_filled_fraction`, `pointcloud_class`, `method_id`.

## Current trunk and life-stage estimates

Existing height and crown sensitivity equations applied to current dimensions. Trunk diameter and life stage still need field measurements.

`assets` → `tree_current_assets_v5`

Fields: `height_max_m`, `height_mean_m`, `dbh_cm_crown_est`, `dbh_confidence`, `life_stage`, `replacement_years_canopy`, `irreplaceability_class`, `method_id`.

## Current root scenarios

Crown and estimated trunk dimensions set exploratory root extents. Known paving can constrain the scenario; missing paving leaves effective extent unknown. Root depth is unmeasured.

`roots` → `tree_current_roots_v5`

Fields: `dbh_cm`, `trunk_circumference_cm`, `crown_radius_m`, `foraging_radius_m`, `effective_radius_m`, `effective_area_m2`, `stability_radius_m`, `root_constraint_flag`, `rpa_radius_m`, `rpa_area_m2`, `life_stage`, `method_id`, `model_confidence`, `constraint_basis`.

## Current ecosystem-service scenarios

Existing sensitivity equations updated with current crown dimensions, once per representative crown. Several trees may share a crown. Monetary coefficients and height-based biomass remain uncalibrated.

`services` → `tree_current_services_v5`

Fields: `species_class`, `species_class_source`, `species_class_confidence_ml`, `species_allometry_source`, `paved_fraction_source`, `crown_area_m2`, `crown_max_chm_m`, `in_flood_prone_area`, `paved_fraction_used`, `interception_fraction_used`, `runoff_coefficient_used`, `intercepted_rainfall_m3_y`, `avoided_runoff_m3_y`, `stormwater_value_nzd_y`, `dbh_cm_est`, `agb_kg_est`, `bgb_kg_est`, `carbon_kg_est`, `stored_co2e_tonnes_est`, `annual_sequestration_tco2e_y_est`, `carbon_value_nzd_stored`, `carbon_value_nzd_y`, `cooling_value_nzd_y_temp`, `cooling_value_nzd_y_paved`, `cooling_value_nzd_y`, `lai_used`, `pm25_removed_kg_y`, `air_quality_value_nzd_y`, `total_value_nzd_y`, `total_value_nzd_y_low`, `total_value_nzd_y_high`, `uncertainty_factor`, `valuation_confidence`, `method_id`, `assumptions_json`, `created_at_utc`.

## Field observations

Dated field observations retain their provenance. Joined-crown dimensions derived from earlier segmentation are distinct from field measurements.

`ground` → `tree_ground_evidence`

Fields: `observed_on`, `presence`, `photo_views`, `gps_accuracy_m`, `joined_records`, `joined_crown_area_m2`, `joined_crown_width_m`, `joined_height_max_m`, `joined_height_p95_m`, `trunk_form`, `leaves`, `species_common`, `species_latin`, `species_basis`, `note`, `method_id`, `created_at_utc`.

## Recent field report

Devonport Primary plaque observation and record links reported by the observer. Tentative identities and the schedule association remain marked for checking.

`field` → `tree_field_observation_v5`

Fields: `observed_on`, `observation_json`.

## Source location review

Unverified Council points remain register entries and are excluded from automatic crown matching.

`location_review` → `tree_location_review_v5`

Fields: `source_position_status`, `source_schedule`, `automatic_crown_link_allowed`, `review_note`.

## Earlier notable-point association

The source notable point is unverified. This review concerns the notable association, while the inventory record keeps its own position.

`notable_link_review` → `tree_notable_link_review_v5`

Fields: `original_notable_objectid`, `notable_source_position`, `review_note`, `protected_from_verified_or_group_evidence`.

## Council source-ID reconciliation

Original ALTO identity and current Council IDs, matched by unchanged schedule, name and position. Renumbering does not create a new tree.

`source_crosswalk` → `notable_source_crosswalk_v5`

Fields: `old_objectid`, `current_objectid`, `old_globalid`, `current_globalid`, `source_snapshot_sha256`, `match_method`.

## Earlier canopy history 2013–2024

Preserved historical matching results. V5 redraws the same 2024 survey; differences between v4 and v5 crown counts do not establish tree loss or growth.

`trajectory` → `tree_trajectory_pilot`

Fields: `trajectory_id`, `lon`, `lat`, `x_2193`, `y_2193`, `present_2013`, `present_2016`, `present_2024`, `h_2013`, `h_2016`, `h_2024`, `growth_2013_2016`, `growth_2016_2024`, `fate`, `implausible`, `created_at_utc`.

## Species references and growth form

Recorded identifications, reference matches and model guesses retain separate provenance.

`species` → `tree_species_attributes`

Fields: `growth_form`, `growth_form_source`, `growth_form_confidence`, `model_confidence`, `mature_height_m`, `lidar_height_m`, `height_plausibility`.

## Earlier growth-form guesses

Stored class scores from the previous inputs. These are not calibrated species probabilities and have not been rerun on v5 crowns.

`predictions` → `tree_species_class_predictions`

Fields: `predicted_species_class`, `species_class_confidence`, `proba_evergreen_broadleaf`, `proba_deciduous_broadleaf`, `proba_conifer`, `proba_palm_other`, `model_id`, `created_at_utc`, `score_semantics`, `release_eligible`.

## Mapped surroundings

Source-position context retained from the previous release. Absent values remain missing.

`context` → `tree_context_pilot`

Fields: `in_flood_plain`, `flood_plain_count`, `in_flood_prone_area`, `flood_prone_area_count`, `flood_prone_max_depth_m`, `dist_overland_flow_path_m`, `dist_stormwater_pipe_m`, `dist_stormwater_catchpit_m`, `dist_stormwater_manhole_m`, `dist_stormwater_inlet_outlet_m`, `air_temp_mean_c`, `air_temp_max_c`, `fraction_paved_surfaces`, `fraction_buildings`, `fraction_trees`, `context_confidence`, `created_at_utc`.

## Paving, buildings and roads

Stored surface-cover samples at the original tree position.

`impervious` → `tree_impervious_pilot`

Fields: `fraction_impervious_30m`, `fraction_buildings_30m`, `fraction_roads_30m`, `fraction_other_imperv_30m`, `source`, `created_at_utc`.

## Previous v4 crown measurements

Original v4 geometry statistics, retained to compare redraws of the same 2024 survey.

`previous_crown_v4` → `tree_previous_crown_v4`

Fields: `seg_key`, `x_2193`, `y_2193`, `lon`, `lat`, `height_m`, `crown_area_m2`, `crown_diameter_m`, `mean_veg_height_m`, `n_veg_returns`, `n_building_returns`, `n_unclassified_returns`, `n_bridge_returns`, `n_water_returns`, `n_ground_returns`, `multi_return_fraction`, `intensity_mean`, `aerial_greenness`, `elongation`, `bbox_fill`, `hedge_fraction`, `gap_filled_fraction`, `evidence_tier`, `evidence_reasons`, `n_records_linked`, `method_id`, `created_at_utc`.

## Earlier dimensions and neighbourhood estimates

Preserved earlier canopy structure, neighbourhood, condition, diversity and life-stage estimates. Their inputs predate v5.

`previous_assets` → `tree_assets_pilot`

Fields: `height_p25_m`, `height_p50_m`, `height_p75_m`, `height_p95_m`, `height_max_m`, `height_mean_m`, `crown_volume_m3`, `canopy_density_proxy`, `crown_complexity_index`, `vertical_ratio`, `n_canopy_pixels`, `nearest_tree_m`, `neighbours_25m`, `neighbours_50m`, `local_canopy_density_25m`, `local_canopy_density_50m`, `crown_overlap_index`, `cluster_id`, `cluster_size`, `growth_setting`, `edge_tree`, `dominance_class`, `dbh_cm_crown_est`, `dbh_confidence`, `life_stage`, `replacement_years_canopy`, `irreplaceability_class`, `condition_proxy`, `condition_confidence`, `neighbourhood_shannon`, `neighbourhood_class_simpson`, `neighbourhood_native_share`, `neighbourhood_tree_count`, `created_at_utc`.

## Earlier root scenarios

Preserved root assumptions and estimates based on the earlier crown inputs.

`previous_roots` → `tree_root_zone_pilot`

Fields: `dbh_cm`, `trunk_circumference_cm`, `crown_radius_m`, `foraging_radius_m`, `effective_radius_m`, `effective_area_m2`, `stability_radius_m`, `root_constraint_flag`, `rpa_radius_m`, `rpa_area_m2`, `life_stage`, `root_zone_avoided_runoff_m3_y`, `root_zone_stormwater_value_nzd_y`.

## Earlier service estimates

Preserved service and monetary scenarios from the earlier geometry; excluded from v5 headline totals within the new footprint.

`previous_services` → `tree_valuation_pilot`

Fields: `species_class`, `species_class_source`, `species_class_confidence_ml`, `species_allometry_source`, `paved_fraction_source`, `crown_area_m2`, `crown_max_chm_m`, `in_flood_prone_area`, `paved_fraction_used`, `interception_fraction_used`, `runoff_coefficient_used`, `intercepted_rainfall_m3_y`, `avoided_runoff_m3_y`, `stormwater_value_nzd_y`, `dbh_cm_est`, `agb_kg_est`, `bgb_kg_est`, `carbon_kg_est`, `stored_co2e_tonnes_est`, `annual_sequestration_tco2e_y_est`, `carbon_value_nzd_stored`, `carbon_value_nzd_y`, `cooling_value_nzd_y_temp`, `cooling_value_nzd_y_paved`, `cooling_value_nzd_y`, `lai_used`, `pm25_removed_kg_y`, `air_quality_value_nzd_y`, `total_value_nzd_y`, `total_value_nzd_y_low`, `total_value_nzd_y_high`, `uncertainty_factor`, `valuation_confidence`, `method_id`, `assumptions_json`, `created_at_utc`.

## Earlier alternative service scenarios

Includes nominal-crown scenarios for records without a segmented crown. Excluded from headline totals.

`scenarios` → `tree_valuation_scenarios`

Fields: `scenario_row_id`, `scenario_name`, `remediation_run_id`, `moved_at_utc`, `species_class`, `species_class_source`, `species_class_confidence_ml`, `species_allometry_source`, `paved_fraction_source`, `crown_area_m2`, `crown_max_chm_m`, `in_flood_prone_area`, `paved_fraction_used`, `interception_fraction_used`, `runoff_coefficient_used`, `intercepted_rainfall_m3_y`, `avoided_runoff_m3_y`, `stormwater_value_nzd_y`, `dbh_cm_est`, `agb_kg_est`, `bgb_kg_est`, `carbon_kg_est`, `stored_co2e_tonnes_est`, `annual_sequestration_tco2e_y_est`, `carbon_value_nzd_stored`, `carbon_value_nzd_y`, `cooling_value_nzd_y_temp`, `cooling_value_nzd_y_paved`, `cooling_value_nzd_y`, `lai_used`, `pm25_removed_kg_y`, `air_quality_value_nzd_y`, `total_value_nzd_y`, `total_value_nzd_y_low`, `total_value_nzd_y_high`, `uncertainty_factor`, `valuation_confidence`, `method_id`, `assumptions_json`, `created_at_utc`.

## Earlier laser-return profiles

Original point-cloud classifications and foliage profiles remain available with their original spatial basis.

`previous_pointcloud` → `tree_pointcloud_pilot`

Fields: `n_points`, `n_ground`, `n_vegetation`, `n_building`, `n_water`, `n_noise`, `n_unclassified`, `veg_fraction`, `veg_cover`, `multireturn_fraction`, `intensity_mean`, `point_density`, `canopy_top_m`, `canopy_base_m`, `canopy_mean_m`, `canopy_std_m`, `canopy_relief_ratio`, `pc_canopy_present`, `is_vegetation`, `is_building`, `pc_false_positive`, `pointcloud_class`, `created_at_utc`, `canopy_cover`, `gap_fraction`, `height_to_live_crown_m`, `understory_present`, `n_canopy_layers`, `canopy_rugosity_m`, `foliage_profile`, `pc_review_no_canopy`.

## Earlier raster crown

Stored raster-derived canopy footprint measurements.

`previous_crown` → `tree_crown_pilot`

Fields: `crown_area_m2`, `crown_diameter_m`, `crown_mean_chm_m`, `crown_max_chm_m`, `method_id`, `created_at_utc`.

## Earlier canopy raster sample

Height samples at the original point, separate from the v5 segmented crown maximum.

`lidar` → `tree_lidar_pilot`

Fields: `x_2193`, `y_2193`, `chm_at_point_m`, `chm_local_max_2m_m`, `likely_canopy_ge_3m`, `method_id`, `created_at_utc`.

## Previous detection assessment

V4 assessment retained for comparison. Current location and identity review takes precedence.

`previous_evidence` → `tree_evidence_v4`

Fields: `evidence_tier`, `evidence_reasons`, `seg_key`, `link_role`, `link_dist_m`, `crown_source`, `v4_height_m`, `v4_crown_area_m2`, `restored`, `method_id`, `created_at_utc`.

## Restored record

Records restored after an earlier processing error.

`restoration` → `tree_restoration_log`

Fields: `restored_from`, `reason`, `restored_at_utc`.

## Earlier alternative detection explanation

Stored suggestions that a detection may represent another object, available for comparison with current evidence.

`review` → `tree_hard_negative_candidates`

Fields: `candidate_type`, `suggested_label`, `reason`, `osm_type`, `osm_id`, `osm_name`, `lon`, `lat`, `crown_area_m2`, `crown_max_chm_m`, `total_value_nzd_y`, `method_id`, `created_at_utc`.

## Crown association audit

Small position offsets and dominant V4–V5 crown overlap support restored links. Review-needed candidates remain unlinked. This is not confirmation that shared source records describe one organism.

`crown_link_review` → `tree_crown_link_repairs_v5`

Fields: `seg_key`, `primary_tree_id`, `old_seg_key`, `status`, `reason`, `evidence_json`, `method_id`.

## Record-to-crown link (v5.2)

Joins a source record that v5.1 left unlinked to a v5 crown, or to a crown drawn from the LiDAR returns at its position. The source position is kept unchanged (source_lon, source_lat). joined_as says whether the record became the crown's map marker or a member of a tree that already had one.

`record_link` → `tree_record_link_v52`

Fields: `seg_key`, `link_class`, `link_evidence`, `confidence`, `edge_distance_m`, `top_distance_m`, `shared_crown_n`, `crown_source`, `display_style`, `review_status`, `source_lon`, `source_lat`, `method_id`, `crown_set_id`, `status`, `joined_as`, `crown_canopy_class`, `crown_in_service_totals`.

## Record-to-crown linking: left unlinked (v5.2)

No v5 crowns or 2024 point cloud reach this position, so the record cannot be linked to a crown by any method. The record is unchanged and stays unlinked until the survey coverage is extended.

`record_link_status` → `tree_record_link_status_v52`

Fields: `status`, `reason`, `reason_text`, `method_id`, `crown_set_id`.
