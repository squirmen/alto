# ALTO v6.3 full-record data dictionary

Release: 20261017-v6.3.

Each tree profile exposes the datasets below. The schema gives their exact ordered fields. Blank means unavailable, not zero. All source IDs and original coordinates are retained.

**Tree number** (`tree_number`) is the permanent public ID of the map tree a record belongs to: `T` + 6 Crockford base-32 characters + a Luhn mod 32 check character (any case; spaces and hyphens ignored; I and L read as 1, O as 0), drawn at random in v6.1 and never reused. Every record of a tree carries the same number: `role` marker for the record that is the tree's map marker, member for the other records on its crown, merged for records a reviewer joined to it. `akl_tree_*` stays the immutable record ID. Every record ID, v4 and v5 crown key and number ever published resolves through `data/tree_ids` (statuses current, member, merged, split, retired; see its schema.json). Link a tree as https://alto.org.nz/tree/<number>.

**Current crown area** is the segmented horizontal footprint in square metres (`crown_area_m2`: the crown's 0.5 m LiDAR cells as v5 segmented them; it drives every estimate). The smoothed polygon the map draws has its own area, `outline_area_m2` in `outline`. **Crown spread** is a width in metres and is not the same measurement. The area-derived equivalent diameter (`crown_diameter_m`) is a circular approximation, not a measured crown spread. Where a reviewer drew a crown (v6.1; `outline.crown_source` reviewer_outline) the crown area is the area of that outline and the original polygon stays in the database; where a reviewer merged crowns, the area is the sum of their cell areas and the polygon their union.

Only current representative records carry current service estimates (`services`) and the benefit estimates (`benefits`). Shared-crown aliases may repeat crown measurements: do not sum areas over every source record. Earlier datasets retain their previous spatial and methodological basis.

Record-to-crown links (v5.2) are in `record_link`; `source_lon`/`source_lat` are the source position, unchanged, and `crown_source` `record_seeded_v52` marks a crown drawn from the record awaiting confirmation, and `record_seeded_v52_confirmed` one a reviewer confirmed is the record's tree (v6.2; evidence tier very_likely, `record_link.review_status` confirmed for the confirmed record, the confirmation in `corrections`). Records outside survey coverage carry `record_link_status`. `record_link` is the v5.2 linker's result, kept as published except where a reviewer confirmed or outlined the crown drawn from the record, or linked the record to another crown (v6.2: the reviewer's link, review_status confirmed; the v5.2 linker's result stays in the release database): where a reviewer correction moved a record to another crown (v6.1), the current association is in `identity` and the correction in `corrections`.

**Growth form** (`growth_form`) is a model estimate for the crown, never an identified species. `wording` is what the map shows; `display` is show, possibly or withhold. Rules: data/growth-form-v6.json (from v6.2 the palm detection also counts from a score of 0.2 on crowns whose growth form v6 left undetermined).

**Crown outline** (`outline`): the map polygon is a smoothed outline of the same v5 cells; `crown_area_m2` everywhere stays the v5 cell area, except where a reviewer drew or merged the crown (above).

**Benefit value** (`benefits`, v6.3): stormwater plus carbon in NZ$ a year, with a low to high band from the valuation confidence; air-quality and cooling dollars, the v6 PM2.5 rate and the release 6.2 total stay in `services`, marked not release-eligible from v6.3 (see each dataset's retired fields). PM2.5 removal and the cooling index are in `benefits` with `release_eligible` 0: not published in v6.3. Estimates are withheld (`withheld_reason` height_not_plausible) where the crown height is not plausible.

**Height class and crown replacement time** (`size`, v6.3) replace the life-stage label and the irreplaceability class, which stay in `assets`, `roots`, `previous_assets` and `previous_roots` as retired stored values. A crown that is not classed has `not_classed_reason`.

**Checks** (v6.3): `height_check` gives the level (implausible or check), the rules and the published maximum height with its source; `link_check` the checks between a record and the crown it is linked to (likely_different or check). Map features carry `hchk` and `lchk`.

**Schedule 10 and group areas** (v6.3): `schedule_entry` is the Schedule 10 entry whose Council point the tree holds, as the July 2026 schedule lists it; `group_area` places the map marker inside a Notable Group of Trees area (map features carry `grp`), which does not establish that the tree is one of the scheduled trees. `notes` holds a reviewer's note from the corrections ledger; `survey` the kauri survey's result codes; `trajectory_label` and `services_drawn` the canopy-history label and the estimates on the drawn crown.

**Licences** (`licence`): every record keeps its source's licence; tree_details/schema.json `source_licences` gives it for each source_primary and credits.html lists every source. Records derived from OpenStreetMap: © OpenStreetMap contributors, available under the Open Database Licence 1.0 (https://opendatacommons.org/licenses/odbl/1-0/); see https://www.openstreetmap.org/copyright. They stay under the ODbL, ALTO's noncommercial terms do not apply to them, and exports that contain them carry its share-alike condition. Method: pipeline/base/scripts/fetch_osm_natural_trees.py (https://github.com/squirmen/alto).

## Original tree record

Original source IDs, names and coordinates remain unchanged. See current crown and identity evidence for the v5 association. v6.3: species_common of the 1,205 kauri survey records reads Kauri; the result codes the name carried up to v6.2 are in the survey dataset (species_name_v62).

`record` → `trees`

Fields: `source_primary`, `source_object_id`, `source_tree_id`, `species_common_raw`, `species_latin_raw`, `species_common`, `species_latin`, `species_confidence`, `owner_raw`, `owner_class`, `lon`, `lat`, `approx_x_m`, `approx_y_m`, `is_protected_notable`, `notable_point_match`, `notable_point_spatial_candidate`, `notable_point_name_compatible`, `notable_point_review_required`, `notable_point_objectid`, `notable_point_name`, `notable_point_type`, `notable_point_type_label`, `notable_point_distance_m`, `notable_point_match_confidence`, `notable_group_match`, `notable_group_count`, `notable_group_objectids`, `notable_group_names`, `as_of_utc`, `record_role`, `taxon_assertion_status`.

## Current crown and record links

Polygon containment, audited crown continuity (v5.1) and record-to-crown links (v5.2) associate source records with current crowns. A shared crown can contain several trees; original positions, identities and histories remain separate.

`identity` → `tree_identity_v5`

Fields: `seg_key`, `current_primary_tree_id`, `evidence_tier`, `link_role`, `current_height_m`, `current_crown_area_m2`, `top_distance_m`, `method_id`, `source_records`, `inventory_records`, `members_json`, `new_overlapping_crowns`, `old_overlapping_crowns`, `within_v5_footprint`, `spatial_evidence_note`.

## Tree number (permanent ID)

The permanent public number of the map tree this record belongs to (T + 6 Crockford base-32 characters + a Luhn mod 32 check character; never reused). role: marker (this record is the tree's map marker), member (a record on the tree's crown without its own marker) or merged (joined to the tree by a reviewer correction). Old IDs and crown keys resolve through data/tree_ids (see its schema.json). Link: https://alto.org.nz/tree/<number>.

`tree_number` → `tree_number_v61`

Fields: `number`, `role`, `kind`, `status`, `representative_tree_id`, `minted_release`, `correction_id`.

## Current canopy dimensions

V5 crown boundaries and maximum height from the 2024 survey; crown_source record_seeded_v52 marks a crown drawn in v5.2 from the returns at a source record's position, awaiting confirmation. Earlier v4 crowns remain in areas outside the v5 survey footprint. v6.2: crown_source record_seeded_v52_confirmed marks a crown drawn in v5.2 from a record that a reviewer confirmed is the record's tree (evidence tier very_likely; the corrections dataset names the confirmation).

`crown` → `tree_current_crown_v5`

Fields: `crown_area_m2`, `crown_diameter_m`, `crown_max_chm_m`, `mean_veg_height_m`, `method_id`, `crown_source`, `current_primary_tree_id`, `gap_filled_fraction`, `ndvi_mean`, `evidence_tier`, `evidence_reasons`.

## Crown outline (v6)

The map draws this crown with the smoothed v6 outline: an area-preserving smoothing of the same v5 crown cells (crown_v53 "B"). Crown area, height and every estimate keep the v5 cell area (cell_area_m2); outline_area_m2 is the area of the smoothed polygon.

`outline` → `tree_crown_outline_v6`

Fields: `seg_key`, `crown_source`, `outline_method`, `outline_area_m2`, `cell_area_m2`, `method_id`.

## Current laser-return evidence

Return counts and structure within the v5 crown. Interpolated area is reported as gap_filled_fraction.

`pointcloud` → `tree_current_pointcloud_v5`

Fields: `canopy_top_m`, `n_veg_returns`, `n_building_returns`, `n_ground_returns`, `n_unclassified_returns`, `n_water_returns`, `n_bridge_returns`, `multi_return_fraction`, `intensity_mean`, `aerial_greenness`, `ndvi_mean`, `elongation`, `bbox_fill`, `gap_filled_fraction`, `pointcloud_class`, `method_id`.

## Current trunk estimates and retired size labels

Existing height and crown sensitivity equations applied to current dimensions. Trunk diameter and life stage still need field measurements.

`assets` → `tree_current_assets_v5`

Fields: `height_max_m`, `height_mean_m`, `dbh_cm_crown_est`, `dbh_confidence`, `life_stage`, `replacement_years_canopy`, `irreplaceability_class`, `method_id`.

Retired fields (kept in the record; not release-eligible from v6.3): `life_stage`: Retired label: a height-only class stored under life-stage words, on the v5.2 growth-form class (v6.2 and earlier). The size dataset holds the height class. `irreplaceability_class`: Retired (25 m override): every crown 25 m or taller was placed in the top class whatever its regrowth time (v6.2 and earlier). The size dataset holds the crown replacement time. `replacement_years_canopy`: Retired: crown area divided by the planning rate of the v5.2 growth-form class (v6.2 and earlier). The size dataset holds regrowth years on the class the service estimates use.

## Current root scenarios

Crown and estimated trunk dimensions set exploratory root extents. Known paving can constrain the scenario; missing paving leaves effective extent unknown. Root depth is unmeasured.

`roots` → `tree_current_roots_v5`

Fields: `dbh_cm`, `trunk_circumference_cm`, `crown_radius_m`, `foraging_radius_m`, `effective_radius_m`, `effective_area_m2`, `stability_radius_m`, `root_constraint_flag`, `rpa_radius_m`, `rpa_area_m2`, `life_stage`, `method_id`, `model_confidence`, `constraint_basis`.

Retired fields (kept in the record; not release-eligible from v6.3): `life_stage`: Retired label: a height-only class stored under life-stage words, on the v5.2 growth-form class (v6.2 and earlier). The size dataset holds the height class.

## Current ecosystem-service scenarios

Existing sensitivity equations updated with current crown dimensions, once per representative crown. Several trees may share a crown. Monetary coefficients and height-based biomass remain uncalibrated. V6: where the growth-form model gives a call, LAI and the height-to-DBH curve are weighted by its calibrated probabilities and the other class parameters follow the call; a crown whose growth form is not yet determined keeps the flagged evergreen default. Records whose estimate did not change keep their V5.2 values (blank v6 fields).

`services` → `tree_current_services_v6`

Fields: `species_class`, `species_class_source`, `species_class_confidence_ml`, `species_allometry_source`, `paved_fraction_source`, `crown_area_m2`, `crown_max_chm_m`, `in_flood_prone_area`, `paved_fraction_used`, `interception_fraction_used`, `runoff_coefficient_used`, `intercepted_rainfall_m3_y`, `avoided_runoff_m3_y`, `stormwater_value_nzd_y`, `dbh_cm_est`, `agb_kg_est`, `bgb_kg_est`, `carbon_kg_est`, `stored_co2e_tonnes_est`, `annual_sequestration_tco2e_y_est`, `carbon_value_nzd_stored`, `carbon_value_nzd_y`, `cooling_value_nzd_y_temp`, `cooling_value_nzd_y_paved`, `cooling_value_nzd_y`, `lai_used`, `pm25_removed_kg_y`, `air_quality_value_nzd_y`, `total_value_nzd_y`, `total_value_nzd_y_low`, `total_value_nzd_y_high`, `uncertainty_factor`, `valuation_confidence`, `method_id`, `assumptions_json`, `created_at_utc`, `growth_form_basis`, `growth_form_default`, `growth_form_weights_json`, `v52_species_class`, `v52_species_class_source`, `v52_total_value_nzd_y`, `v52_avoided_runoff_m3_y`, `v52_stored_co2e_tonnes_est`.

Retired fields (kept in the record; not release-eligible from v6.3): `total_value_nzd_y`: Kept for provenance; not release-eligible from v6.3. Sum of stormwater, carbon, cooling and air-quality dollars (v6 to v6.2 headline); the benefits dataset holds the release value. `total_value_nzd_y_low`: Kept for provenance; not release-eligible from v6.3. `total_value_nzd_y_high`: Kept for provenance; not release-eligible from v6.3. `air_quality_value_nzd_y`: Kept for provenance; not release-eligible from v6.3. PM2.5 removal priced at NZ$25 per kg. `cooling_value_nzd_y`: Kept for provenance; not release-eligible from v6.3. `cooling_value_nzd_y_temp`: Kept for provenance; not release-eligible from v6.3. `cooling_value_nzd_y_paved`: Kept for provenance; not release-eligible from v6.3. `pm25_removed_kg_y`: Kept for provenance; not release-eligible from v6.3. v6 rule: crown area × leaf area index × 0.008 kg a year.

## Field observations

Dated field observations retain their provenance. Joined-crown dimensions derived from earlier segmentation are distinct from field measurements. v6.3: where a reviewer's note (notes dataset) replaces a field visit's wording, the visit's note shows the note's history line; the database keeps the original.

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

## Growth form and reference height

Mature height: i-Tree species database (USDA Forest Service), for the recorded species or its genus; i-Tree gives it in feet (mature_height_ft_as_supplied) and mature_height_m converts it (x 0.3048). i-Tree heights describe trees grown in the United States. height_plausibility: implausibly_tall where the LiDAR canopy height is above 1.3 x the mature height, ok at or below it, no_ceiling where either height is missing. growth_form_source curated_species: ALTO's class for a species the i-Tree database misclasses (pūriri evergreen broadleaf; cabbage tree palm or palm-like); growth_form_as_supplied and growth_form_source_as_supplied keep the i-Tree value. v6.3: read from tree_species_attributes_v63 (metres); fields_v62 lists the fields v6.2 published.

`species` → `tree_species_attributes_v63`

Fields: `growth_form`, `growth_form_source`, `growth_form_confidence`, `model_confidence`, `mature_height_m`, `mature_height_ft_as_supplied`, `lidar_height_m`, `height_plausibility`, `growth_form_as_supplied`, `growth_form_source_as_supplied`.

Retired fields (kept in the record; not release-eligible from v6.3): `height_plausibility`: Retired in v6.3. It compared the LiDAR height with 1.3 x the i-Tree mature height, a typical height for the species. Height checks against published maximum heights are in the height_check dataset.

## Growth form (model, v6)

Growth form estimated for the crown from the 2024 LiDAR and aerial imagery (phase-2b model A2, C1 palm detector, A2_robust on April and October flights). A model estimate, never an identified species; a recorded species stays the tree's species. display_key and wording follow the v6 display rules; display_r15 is the rule before the v6 palm guard and the outside-isthmus palm-type decision. Probabilities are calibrated four-class model outputs, rounded to 4 decimals. v6.2: the C1 palm detection is also used from a score of 0.2 (v6: 0.5) on crowns whose growth form v6 left undetermined, after a blind check; method_id says so on the crowns it changed.

`growth_form` → `tree_growth_form_v6`

Fields: `seg_key`, `display_key`, `wording`, `display`, `display_reason`, `call`, `band`, `palm_subcall`, `model_id`, `model_call`, `model_band`, `c1_override`, `p_palm_det`, `guard_v2`, `p_evergreen_broadleaf`, `p_deciduous_broadleaf`, `p_conifer`, `p_palm`, `p_palm_like`, `p_tree_fern`, `isthmus`, `leaf_on`, `lidar_flight_date`, `late_june_flight`, `display_r15`, `display_reason_r15`, `structure_call`, `merged_call`, `method_id`.

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

Retired fields (kept in the record; not release-eligible from v6.3): `life_stage`: Retired label: a height-only class stored under life-stage words, on the v5.2 growth-form class (v6.2 and earlier). The size dataset holds the height class. `irreplaceability_class`: Retired (25 m override): every crown 25 m or taller was placed in the top class whatever its regrowth time (v6.2 and earlier). The size dataset holds the crown replacement time. `replacement_years_canopy`: Retired: crown area divided by the planning rate of the v5.2 growth-form class (v6.2 and earlier). The size dataset holds regrowth years on the class the service estimates use.

## Earlier root scenarios

Preserved root assumptions and estimates based on the earlier crown inputs.

`previous_roots` → `tree_root_zone_pilot`

Fields: `dbh_cm`, `trunk_circumference_cm`, `crown_radius_m`, `foraging_radius_m`, `effective_radius_m`, `effective_area_m2`, `stability_radius_m`, `root_constraint_flag`, `rpa_radius_m`, `rpa_area_m2`, `life_stage`, `root_zone_avoided_runoff_m3_y`, `root_zone_stormwater_value_nzd_y`.

Retired fields (kept in the record; not release-eligible from v6.3): `life_stage`: Retired label: a height-only class stored under life-stage words, on the v5.2 growth-form class (v6.2 and earlier). The size dataset holds the height class.

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

Joins a source record that v5.1 left unlinked to a v5 crown, or to a crown drawn from the LiDAR returns at its position. The source position is kept unchanged (source_lon, source_lat). joined_as says whether the record became the crown's map marker or a member of a tree that already had one. v6.2: where a reviewer confirmed or outlined the crown drawn from this record, or linked the record to another crown, review_status is confirmed and the link fields describe the reviewer's link; otherwise every field is the v5.2 linker's.

`record_link` → `tree_record_link_v52`

Fields: `seg_key`, `link_class`, `link_evidence`, `confidence`, `edge_distance_m`, `top_distance_m`, `shared_crown_n`, `crown_source`, `display_style`, `review_status`, `source_lon`, `source_lat`, `method_id`, `crown_set_id`, `status`, `joined_as`, `crown_canopy_class`, `crown_in_service_totals`.

## Record-to-crown linking: left unlinked (v5.2)

No v5 crowns or 2024 point cloud reach this position, so the record cannot be linked to a crown by any method. The record is unchanged and stays unlinked until the survey coverage is extended.

`record_link_status` → `tree_record_link_status_v52`

Fields: `status`, `reason`, `reason_text`, `method_id`, `crown_set_id`.

## Reviewer corrections

Accepted human corrections that concern this tree, from the append-only ALTO corrections ledger, and how this release carries each one: applied (the map and record show it), recorded_in_release (published with the tree, values unchanged), already_in_release, or pending (needs a crown or association rebuild; reason given). data/corrections-applied.json lists every correction in the ledger. v6.3: public_summary gives each correction in tree numbers and plain names, as the receipt (data/corrections-applied.json) does; summary stays as recorded.

`corrections` → `config/corrections/corrections.jsonl`

Fields: `id`, `version`, `type`, `status`, `outcome`, `role`, `summary`, `decided_on`, `reviewer`, `evidence`, `reason`, `public_summary`.

## Benefit estimates (v6.3)

Benefit value is stormwater plus carbon in NZ$ a year, with a low to high band from the valuation confidence (±30 % for modelled medium, ±60 % for modelled low). Air-quality and cooling dollar values stay in the services dataset, labelled not release-eligible. Estimates are withheld where the crown height is not plausible. PM2.5 removal and the cooling index: Not release-eligible in v6.3: the method awaits confirmation of its sources. (release_eligible 0).

`benefits` → `tree_benefits_v63`

Fields: `benefit_value_nzd_y`, `benefit_value_nzd_y_low`, `benefit_value_nzd_y_high`, `components`, `pm25_removed_g_y`, `cooling_index`, `release_eligible`, `withheld_reason`, `method_id`.

## Height class and crown replacement time

Height class: the crown's measured height (2024 LiDAR) as a share of the reference height for its growth form (evergreen broadleaf 22 m, deciduous broadleaf 25 m, conifer 35 m, palm or palm-like 14 m), rounded down to 0.1 %: very small under 18 %, small 18–35 %, medium 35–60 %, large 60–90 %, very large 90 % or more. Crown replacement time: the years a newly planted tree would take to grow a crown of this area at the planning rate for its growth form (2.2, 2.6, 2.0 and 0.6 m² a year), in bands: under 5, 5–15, 15–40, 40–80, 80 years or more; the band follows the years alone. Growth form: the class the published service estimates use. Not classed: crowns under 5 m tall, crowns whose height is not plausible (height check; values withheld) and markers with no crown estimate; they are left out of comparisons. Tall tree: 25 m or taller, a separate fact. Reference heights and planning rates are ALTO planning defaults for four growth forms. Plantation forest crowns are classed by regrowth time like every other crown (v6.3 does not overlay a land-cover map).

`size` → `tree_size_class_v63`

Fields: `height_class`, `height_share_pct`, `reference_height_m`, `class_used`, `height_m`, `crown_area_m2`, `planning_rate_m2_y`, `regrowth_years`, `replacement_band`, `crown_replacement`, `not_classed_reason`, `tall_tree`, `withheld_reason`, `in_comparisons`, `comparisons_excluded_by`.

## Height check

Height checks on the crown's measured height (v6.3). Not plausible: 55 m or more; or 30 m or more with no vegetation returns, or more building than vegetation returns, in the crown's laser-return record. To check: over 30 m tall with a crown under 20 m²; highest point more than 3 times the mean vegetation height (20 m or more); more than 10 % taller than the credible maximum height published for the recorded species or genus. A crown whose height is not plausible keeps its values here and is left out of comparisons, maxima, property tallest tree, estimates and totals. A crown whose height is to check is counted in totals and left out of comparisons, maxima and property tallest tree.

`height_check` → `tree_height_check_v63`

Fields: `level`, `rules`, `note`, `height_m`, `crown_area_m2`, `mean_veg_height_m`, `pointcloud_record`, `n_veg_returns`, `n_building_returns`, `taxon`, `taxon_ceiling_m`, `taxon_ceiling_source`, `excluded_from`, `withheld_reason`.

## Record and crown check

Checks that this record and the crown it is linked to describe the same tree (v6.3): r1 the LiDAR height at the recorded point is under a quarter of the crown height (crown 8 m or more); r2 the crown is more than 10 % taller than the credible maximum height published for the recorded species or genus (crown 8 m or more); r3 the growth-form model reads the crown as another growth form than the recorded species' class (the i-Tree species database; ALTO's class for pūriri and cabbage tree), at 0.8 or more. Two or more: record and crown may be different trees; one: to check. A link a reviewer confirmed stays as confirmed. The crown of a record to check, or one that may be a different tree, is counted in totals and left out of comparisons, maxima and property tallest tree.

`link_check` → `tree_link_check_v63`

Fields: `level`, `rules`, `note`, `crown_height_m`, `point_height_m`, `ceiling_taxon`, `ceiling_m`, `ceiling_source`, `record_class`, `model_class`, `model_probability`, `reviewer_confirmed`, `marker_tree_id`, `excluded_from`.

## Canopy history label

An "established since" fate needs a current crown with vegetation returns; where there is none, the history reads not assessed. fate_v62 keeps the earlier value.

`trajectory_label` → `tree_trajectory_label_v63`

Fields: `label`, `display`, `reason`, `fate_v62`.

## Estimates on the drawn crown

Estimates for this crown recomputed on the crown outline the map draws (area and height), with the same functions as every other crown; up to v6.2 they used an earlier crown outline (services_area_m2_v62).

`services_drawn` → `tree_services_drawn_v63`

Fields: `crown_area_m2`, `crown_max_chm_m`, `services_area_m2_v62`, `avoided_runoff_m3_y`, `stormwater_value_nzd_y`, `stored_co2e_tonnes_est`, `carbon_value_nzd_y`, `dbh_cm_crown_est`, `replacement_years_canopy`, `crown_radius_m`, `rpa_radius_m`, `basis`.

## Schedule 10 entry

The Schedule 10 entry whose Council point (Notable Trees Overlay) this tree holds: trees listed, names and address as the July 2026 schedule gives them. Collapsed: the entry lists 2 or more trees, Council has 2 or more points for it, and ALTO maps those points on fewer crowns. Schedule 10 is the legal record; the overlay is indicative.

`schedule_entry` → `tree_schedule_entry_v63`

Fields: `item`, `line`, `trees_listed`, `trees_text`, `common_names`, `botanical_names`, `address`, `locality`, `legal_description`, `points_total`, `points_here`, `alto_trees`, `collapsed`, `fewer_points_than_trees`, `schedule_version`.

## Notable Group of Trees area

The map marker lies inside a polygon of Council's Notable Group of Trees Overlay (Auckland Unitary Plan). Whether this tree is one of the scheduled trees has not been established; the flag does not change the tree's protected status.

`group_area` → `tree_group_area_v63`

Fields: `schedule_item`, `group_name`, `objectid`, `line`, `layer_retrieved`.

## Reviewer note

A reviewer's note on this tree, carried by the corrections ledger (type tree_note). It changes wording only: protection and every measured value stay as they are. Where a field visit shown on the tree carried the wording the note replaces, the visit shows the history line.

`notes` → `tree_note_v63`

Fields: `text`, `history_line`, `decided_on`, `reviewer`, `correction_id`.

## Kauri survey result

Result codes of this kauri survey record. p_agathidicida and p_cinnamomi read "recorded" where the survey record has a value in its Phytophthora agathidicida or Phytophthora cinnamomi field. soil_sample_result is the survey's soil sample result as supplied. species_name_v62 is the species name ALTO showed up to v6.2, with the codes appended.

`survey` → `tree_name_fix_v63`

Fields: `survey`, `p_agathidicida`, `p_cinnamomi`, `soil_sample_result`, `species_name_v62`, `credit`, `caveat`.

## Licence

Licence of a record derived from OpenStreetMap (v6.3). © OpenStreetMap contributors; the record is available under the Open Database Licence 1.0 and stays under it; ALTO's noncommercial terms do not apply to it; exports that contain it carry the ODbL's share-alike condition. method_url is the script that derives these records.

`licence` → `tree_licence_v63`

Fields: `licence`, `licence_name`, `licence_url`, `attribution`, `attribution_url`, `noncommercial_terms`, `method`, `method_url`, `note`.
