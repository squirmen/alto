# WS5 — Valuation coefficient provenance audit

> **Superseded.** This file incorrectly described several legacy coefficient/source mappings as defensible. They have not been reproduced from the cited equation tables. See `pre_hpc_readiness_review_2026-07-12.md`.

**Historical verdict withdrawn.** The listed citations do not reproduce and verify every encoded equation, unit, domain or Auckland monetary pathway. Treat every coefficient below as an unvalidated sensitivity parameter.

## Cited bases

- **rainfall_source** — Auckland-wide ~1240 mm/year (NIWA climate normals 1991-2020 for the Auckland Aero gauge). Used as a constant for the pilot until per-tree gridded rainfall is wired in.
- **stormwater_value_basis** — NZD 3.50 / m³ avoided runoff. Anchored to Auckland's Healthy Waters Targeted Rate per-property charge schedule and indicative marginal treatment/storage cost from Watercare 2022 cost-of-service reporting; still an interim figure until council confirms an audited avoided-cost rate. Flood-prone catchments get a 1.5× uplift to reflect higher downstream damage avoided.
- **cooling_value_basis** — Two-term shade proxy. Temperature term mirrors i-Tree Eco residential energy-savings estimates for temperate climates (~NZD 0.5–1.2 / m² / °C-above-baseline depending on building density). Paved-fraction term captures avoided urban-heat-island energy demand and pavement-life extension at NZD 0.30 / m² / paved-fraction unit, consistent with Akbari et al. cool-surface studies. Replace with energy-saving + health-pathway components once Auckland-specific values are agreed.
- **pm25_value_basis** — NZD 25 / kg PM2.5 removed. Sits between Auckland Council's 2018 Air Quality Report indicative value (~NZD 5 / kg averted from health cost analysis) and the US EPA monetised range (USD 30-100 / kg). v1 used USD 80 / kg directly, which over-valued the air-quality service; v2 normalises to a defensible mid-range Auckland figure. Replace with the next NZ MfE / Auckland Council monetised value when published.
- **allometry_basis** — Tiered allometry. First lookup of species/genus in SPECIES_ALLOMETRY table covering the top ~30 species in the Waitemata pilot, with cited NZ-specific equations (Beets 2008, Steward & Beveridge 2010, Beets et al. 2007) and i-Tree Eco urban tree equations (Nowak 2002, Pillsbury 1998, McPherson 2016) for common exotics. Second tier uses class-level Beets 2008 broadleaf/conifer equations. Third tier uses Chave 2014 pantropical at DBH < 5 cm.
- **carbon_sequestration_basis** — 1.5% annual increase as a planning-grade default for urban broadleaf trees; should be replaced by age/condition-specific increments per i-Tree Eco growth equations.
- **carbon_price_basis** — NZ ETS unit price assumption (recent NZU spot ~NZD 55). Use a documented hedge if final figures need public defence.

## Coefficients (status)

| Coefficient | value | status |
|---|--:|:--|
| annual_rainfall_m | 1.24 | INTERIM |
| interception_fraction_evergreen_broadleaf | 0.18 | — |
| interception_fraction_deciduous_broadleaf | 0.1 | — |
| interception_fraction_conifer | 0.2 | — |
| interception_fraction_palm_other | 0.12 | — |
| runoff_coefficient_pervious | 0.3 | — |
| runoff_coefficient_impervious | 0.9 | — |
| flood_prone_uplift_factor | 1.5 | — |
| stormwater_value_nzd_per_m3 | 3.5 | INTERIM |
| cooling_temp_threshold_c | 18.0 | INTERIM |
| cooling_value_nzd_per_m2_per_degree | 0.6 | INTERIM |
| cooling_paved_value_nzd_per_m2_paved_fraction | 0.3 | INTERIM |
| lai_evergreen_broadleaf | 4.0 | — |
| lai_deciduous_broadleaf | 2.5 | — |
| lai_conifer | 3.0 | — |
| lai_palm_other | 2.0 | — |
| pm25_removal_rate_kg_per_m2_lai_per_year | 0.008 | INTERIM |
| pm25_value_nzd_per_kg | 25.0 | INTERIM |
| allometry_method | per_species_then_beets_then_ch… | INTERIM |
| agb_a_evergreen_broadleaf | 0.083 | — |
| agb_b_evergreen_broadleaf | 2.46 | — |
| agb_a_deciduous_broadleaf | 0.06 | — |
| agb_b_deciduous_broadleaf | 2.5 | — |
| agb_a_conifer | 0.053 | — |
| agb_b_conifer | 2.62 | — |
| carbon_root_shoot_ratio_broadleaf | 0.24 | INTERIM |
| carbon_root_shoot_ratio_conifer | 0.22 | INTERIM |
| carbon_root_shoot_ratio_palm | 0.2 | INTERIM |
| carbon_fraction_broadleaf | 0.47 | INTERIM |
| carbon_fraction_conifer | 0.5 | INTERIM |
| carbon_fraction_palm | 0.45 | INTERIM |
| co2_per_carbon_mass_ratio | 3.6666666666666665 | INTERIM |
| carbon_sequestration_fraction_per_year | 0.015 | INTERIM |
| carbon_price_nzd_per_tco2e | 50.0 | INTERIM |
| wood_density_kg_per_m3_default | 600.0 | — |

## To replace with authoritative NZ values (the real WS5 task)

- **stormwater_value_nzd_per_m3** — interim NZD 3.50; needs council audited avoided-cost rate.
- **cooling** terms — i-Tree-mirrored; need Auckland energy + health-pathway components.
- **pm25_value_nzd_per_kg** — interim NZD 25; replace with MfE/Council monetised value.
- Interception, runoff, LAI, DBH, allometry, carbon and sequestration all require source reproduction plus local validation.

_Current framing: exploratory sensitivity scenarios only; not i-Tree, an inventory estimate, or an economic valuation suitable for publication or decisions._
