# Inferred Tree Detection

Generated at: 2026-06-20T22:00:24+00:00

## What This Adds

The council/AT public tree inventories cover street trees and notable trees, but most of Auckland's canopy sits on private parcels, parks, and roadside reserves with no point record. This step uses the 2024 LiDAR-derived canopy-height model (CHM) directly to detect tree tops as local maxima, deduplicates them against the canonical inventory, and inserts them as additional canonical tree records.

## Method

- Detection threshold: smoothed CHM ≥ 5 m above ground.
- Smoothing: Gaussian, σ = 1 px (1 px = 1 m).
- Variable-window non-max suppression: radius `clip(2.5 + 0.25·h, 3, 12) m`, taller peaks claim more area.
- Building mask: OSM Overpass footprints (same cache as the crown step). LINZ NZ Building Outlines is the next step.
- Non-tree exclusion mask: OSM water, bridge, port, industrial, harbour, marina, pier/wharf, rail, and container-terminal ways and relation members.
- Aerial greenness mask: 5 × 5 mean Esri World Imagery GLI must be ≥ 0.06.
- Dedup against canonical inventory within 5 m.

## Numbers

- Canonical inventory before detection: 76,812.
- Local maxima after non-max suppression and dedup: 1,545,547.
- Suppressed by canonical inventory dedup: 0.

These detected points carry `species_confidence = lidar_inferred_no_species` and `owner_class = LiDAR-Inferred Canopy`. The downstream crown segmentation keeps only candidates with accepted crown geometry; `cleanup_inferred_without_crowns.py` removes inferred candidates that fail the crown/mask/shape filters.

## Outputs

- `data/processed/inferred_trees_pilot.geojson` (raw detected points)
- `data/processed/akl_trees.sqlite` table `trees`: inserts with `source_primary = lidar_inferred_canopy`
