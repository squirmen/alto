# Tree Crown Pilot

Generated at: 2026-06-21T07:17:08+00:00
Pilot bbox EPSG:2193: `[1740000.0, 5895000.0, 1782000.0, 5935000.0]` (~1680.0 km²).

## What This Adds

Each canonical tree point inside the pilot LiDAR area now has a derived crown polygon (where canopy structure is present) plus structural metrics. Dollar valuation is computed separately in `build_tree_valuation.py`.

## Building Mask

- Building polygons used: 536,099.
- Source: OpenStreetMap buildings via Overpass.
- Preferred source: LINZ NZ Building Outlines layer 101290. If no clipped local LINZ file is present, the script falls back to OpenStreetMap building footprints via Overpass API.

## Non-Tree Exclusion Mask

- Water / bridge / port / industrial exclusion polygons used: 18,448.
- Source: OpenStreetMap ways and relation members for water, harbour, port, industrial, piers, wharves, bridges, rail, marinas, and container-terminal features.

## Crown Segmentation

- 1 km × 1 km processing chunks: 1,680.
- Crown polygons generated: 1,568,774.
- Total crown area: 184,996,543 m².
- Median crown area: 100.0 m².
- Maximum crown CHM height: 79.9 m.

Segmentation is point-constrained: known tree locations claim nearby CHM pixels after building and non-tree exclusion masks are applied. Each pixel goes to its nearest tree within a height-scaled radius (`min(0.65 × height, 14) m, ≥ 5 m`).

## Outputs

- `data/processed/tree_crowns_pilot.geojson`
- `data/processed/akl_trees.sqlite`, table `tree_crown_pilot`
