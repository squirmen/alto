# Waitemata LiDAR Pilot

Generated at: 2026-06-21T06:45:39+00:00

## Pilot Area

- EPSG:2193 bbox: `[1740000.0, 5895000.0, 1782000.0, 5935000.0]`.
- Area: 1,680,000,000 m2 (~1,680.0 km2).
- LERC tile count per layer at level 9: 26,062.
- DSM tiles fetched: 24,602.
- DEM tiles fetched: 24,602.
- 1 km CHM chunks written: 1,310.

## Canopy Height Model

CHM = `DSM - DEM` from the 2024 Auckland Council 1 m imagery service. Values >= 3 m are candidate above-ground canopy/structure pixels; buildings are removed by the downstream crown step, not here.

- Valid raster pixels: 1,216,679,611.
- Candidate canopy/structure pixels >= 3 m: 390,719,190.
- Candidate canopy/structure area >= 3 m: 390,719,190 m2.
- Candidate canopy/structure cover >= 3 m: 32.1%.
- Mean CHM: 3.26 m (std 5.71 m).
- Median CHM (sample): 0.01 m.
- 95th percentile CHM (sample): 14.77 m.
- Maximum CHM: 80.00 m.

## Tree Inventory Join

- Canonical tree records sampled inside pilot bbox: 1,608,429.
- Trees with a LiDAR height sample: 1,608,429.
- Trees with local max CHM >= 3 m: 1,600,741.
- Median local max CHM around known trees: 12.21 m.
- 95th percentile local max CHM around known trees: 28.46 m.

## Outputs

- `data/interim/auckland_metro_v1_lidar/chm_tiles_1km` (1 km CHM tiles)
- `data/interim/waitemata_lidar_pilot/chm.vrt` (full-pilot CHM mosaic VRT)
- `data/processed/akl_trees.sqlite`, table `tree_lidar_pilot`
- `data/processed/trees_map_points.geojson`, enriched with pilot LiDAR fields
- `data/processed/lidar_pilot_extent.geojson`
