# Tree ecosystem-service sensitivity scenarios

Generated at: 2026-07-31T02:53:33+00:00

These are exploratory sensitivity scenarios, not validated physical or economic estimates. They combine:

- CHM-derived height per tree, fed through species-class allometry for carbon storage and annual sequestration.
- Crown area combined with species-class rainfall interception, Auckland average annual rainfall, and a local runoff coefficient derived from Auckland Council 2017 impervious-surface fraction in a 30 m tree window, with heat-grid paved fraction as fallback.
- A flood-prone uplift factor for trees whose crowns intersect mapped flood-prone or flood-plain polygons.
- A cooling proxy weighted by the local mean air temperature (excess above 18 °C) and impervious/paved-surface fraction.
- A first-pass PM2.5 dry-deposition removal estimate via species-class leaf area index.

Confidence is `modelled_medium` for trees with both paved fraction and air temperature context; `modelled_low` where context is missing. Confidence is never `observed` because no field-measured DBH, leaf area, or stem density feeds into the pilot.

## Scenario totals (not release claims)

- Trees valued: 1,650,129.
- Stored carbon (estimated): 2,333,733 tCO₂e.
- Annual sequestration (estimated): 35,006 tCO₂e/year.
- Carbon value: NZD 1,750,299/year (annual sequestration only).
- Avoided runoff: 13,824,883 m³/year.
- Stormwater value: NZD 51,831,157/year (flood-prone uplift applied).
- Cooling proxy value: NZD 61,152,767/year.
- Air-quality (PM2.5 removal): 4,498,821.0 kg/year, NZD 112,470,526/year.
- **Total annual sensitivity scenario:** NZD 227,204,750/year.

## Headline Assumptions

```json
{
  "annual_rainfall_m": 1.24,
  "rainfall_source": "Auckland-wide ~1240 mm/year (NIWA climate normals 1991-2020 for the Auckland Aero gauge). Used as a constant for the pilot until per-tree gridded rainfall is wired in.",
  "interception_fraction_evergreen_broadleaf": 0.18,
  "interception_fraction_deciduous_broadleaf": 0.1,
  "interception_fraction_conifer": 0.2,
  "interception_fraction_palm_other": 0.12,
  "runoff_coefficient_pervious": 0.3,
  "runoff_coefficient_impervious": 0.9,
  "flood_prone_uplift_factor": 1.5,
  "stormwater_value_nzd_per_m3": 3.5,
  "stormwater_value_basis": "Policy sensitivity scenario only. NZD 3.50/m\u00b3 and the 1.5 flood uplift are not audited Auckland marginal avoided costs and must not be used for financial, tax, or benefit-cost decisions until Healthy Waters validates them.",
  "cooling_temp_threshold_c": 18.0,
  "cooling_value_nzd_per_m2_per_degree": 0.6,
  "cooling_paved_value_nzd_per_m2_paved_fraction": 0.3,
  "cooling_value_basis": "Exploratory index converted to NZD with unvalidated coefficients. It is not an energy, health, shade-geometry, or pavement-life model. Replace with explicit Auckland exposure and dose-response pathways.",
  "lai_evergreen_broadleaf": 4.0,
  "lai_deciduous_broadleaf": 2.5,
  "lai_conifer": 3.0,
  "lai_palm_other": 2.0,
  "pm25_removal_rate_kg_per_m2_lai_per_year": 0.008,
  "pm25_value_nzd_per_kg": 25.0,
  "pm25_value_basis": "Sensitivity scenario only. The physical proxy omits local hourly PM2.5 concentration, deposition velocity, weather, resuspension, mixing height, population exposure and NZ health valuation, so NZD 25/kg is not a validated damage-avoidance value.",
  "allometry_method": "height_to_dbh_proxy_then_unverified_class_sensitivity_v4",
  "allometry_basis": "Exploratory coefficient scaffold. DBH is first inferred from an uncalibrated height-only curve, then fed to species/genus/class power functions. Several coefficient-source mappings have not been reproduced from published equation tables. Do not describe these as Beets/i-Tree estimates until every equation, unit, domain and citation is independently verified.",
  "agb_a_evergreen_broadleaf": 0.083,
  "agb_b_evergreen_broadleaf": 2.46,
  "agb_a_deciduous_broadleaf": 0.06,
  "agb_b_deciduous_broadleaf": 2.5,
  "agb_a_conifer": 0.053,
  "agb_b_conifer": 2.62,
  "carbon_root_shoot_ratio_broadleaf": 0.24,
  "carbon_root_shoot_ratio_conifer": 0.22,
  "carbon_root_shoot_ratio_palm": 0.2,
  "carbon_fraction_broadleaf": 0.47,
  "carbon_fraction_conifer": 0.5,
  "carbon_fraction_palm": 0.45,
  "co2_per_carbon_mass_ratio": 3.6666666666666665,
  "carbon_sequestration_fraction_per_year": 0.015,
  "carbon_sequestration_basis": "1.5% annual increase as a planning-grade default for urban broadleaf trees; should be replaced by age/condition-specific increments per i-Tree Eco growth equations.",
  "carbon_price_nzd_per_tco2e": 50.0,
  "carbon_price_basis": "Versioned NZD 50/tCO2e sensitivity scenario, not a live or dated NZU price.",
  "wood_density_kg_per_m3_default": 600.0,
  "method_id": "valuation_v4_exploratory_sensitivity_not_release_eligible"
}
```

## Limitations to Resolve Next

1. Replace H→DBH allometry with species-specific local equations (NZ urban tree inventories or i-Tree Eco's DBH module).
2. Replace constant annual rainfall with gridded or gauge-based Auckland rainfall.
3. Replace `NZD/m³` stormwater value with a council-approved avoided-treatment/storage marginal cost.
4. Replace cooling proxy with energy savings, pavement-life, and health-pathway components rather than a single NZD/m²/°C term.
5. Add observed DBH and condition fields when Auckland Council asset records are released, and downgrade `modelled_*` confidences to `observed` wherever applicable.

## Outputs

- `data/processed/akl_trees.sqlite`, table `tree_valuation_pilot`
- `data/processed/tree_services_pilot.csv` (long format: one row per service per tree)
