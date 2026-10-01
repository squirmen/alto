# Tree Asset Model — Enrichment Layer

`scripts/enrich_tree_assets.py` turns the 2D crown inventory into a
tree-level asset register. It runs after valuation, samples the 2024 CHM
under each crown polygon, and computes structure + competition + derived
fields. Output: SQLite table `tree_assets_pilot` + `tree_assets_pilot.geojson`,
merged into the web tiles by `build_web_geojson` (pipeline) or
`merge_assets_into_web` (standalone).

## Implemented (single-snapshot 2024 LiDAR — no extra data needed)

| Priority | Fields | Method |
| --- | --- | --- |
| **P1 — 3D structure** | height P25/P50/P75/P95, mean/max height, crown_volume_m3, canopy_density_proxy, crown_complexity_index, vertical_ratio | Rasterize each crown polygon against the 1 m CHM (chunked); per-crown pixel-height stats. Volume = Σ(pixel height)×area. Density = mean/max height. Complexity = CV of heights. |
| **P2 — Context & competition** | nearest_tree_m, neighbours_25m/50m, local_canopy_density_25m/50m, crown_overlap_index, cluster_id, cluster_size, growth_setting (standalone/cluster/forest_patch), edge_tree, dominance_class (dominant/co-dominant/suppressed) | KDTree on crown centroids; union-find clustering at 12 m link; dominance by height rank vs neighbours within 25 m. |
| **P5 — DBH** | dbh_cm_crown_est, dbh_confidence | Blend of height-driven and crown-diameter-driven estimates by species class. |
| **P6 — Life stage** | life_stage (juvenile → veteran) | Height as fraction of species-class typical mature height. |
| **P7 — Replacement value** | replacement_years_canopy, irreplaceability_class | Crown area ÷ species-class annual crown growth → years to regrow; irreplaceability scaled by years + height. |
| **P8 — Diversity** | neighbourhood_shannon, neighbourhood_class_simpson, neighbourhood_native_share, neighbourhood_tree_count | Per 200 m grid cell: Shannon (species_common), Simpson (class), native-genus share. |

A single-snapshot `condition_proxy` (good/fair/sparse_review) is included
but explicitly flagged `condition_confidence = single_snapshot_low` — it
infers possible thinning from low canopy density, not from change.

## Pilot distributions (Waitemata, 137,519 crowns)

- **Life stage:** 1.9K juvenile · 40.8K young · 62.4K semi-mature · 25.4K mature · 7.0K veteran
- **Dominance:** 38.6K dominant · 55.5K co-dominant · 43.4K suppressed
- **Setting:** 4.5K standalone · 99.9K cluster · 33.1K forest patch
- **Irreplaceability:** 5.1K low · 18.5K moderate · 61.6K high · 34.3K very high · 18.1K effectively irreplaceable

## Deferred (need data we don't yet have)

| Priority | Blocker |
| --- | --- |
| **P3 — Growth trajectory** | Needs 2013 / 2016 / 2018 LiDAR (Knowledge Auckland TR2020/009-2 canopy mosaics). |
| **P4 — Change-based health/vitality** | Needs multi-year crown comparison. The single-snapshot `condition_proxy` is a placeholder. |
| **P9 — Storm/failure exposure (full)** | Needs NIWA wind raster + slope/aspect from DEM. Partial proxies (isolation, slenderness) are computable now. |
| **Exact age** | Intentionally not attempted — life stage + replacement timeframe are the defensible substitutes. |

## Web: tree profile panel

Clicking any tree (dot or crown) opens a slide-in profile panel —
identity, dimensions & structure, life stage & replacement, ecosystem
services, growing context, detection history (2024 ✓; 2018/2013 pending),
and data provenance. The selected tree is ringed on the map.
