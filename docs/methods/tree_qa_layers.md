# Tree QA Layers

Generated at: 2026-07-30T22:54:21+00:00

## Hard-Negative Candidates

- Candidate retained LiDAR trees inside high-risk water/marina/port/wharf OSM exclusions: 0.
- These are review/training seeds, not automatic deletions. They target the recurring boat, ship, container, wharf, and harbour false positives.

## Low-Canopy Candidates

- Green 2-5 m CHM local maxima not near an existing canonical tree: 881,968.
- These are excluded from `trees`, crowns, context, and valuation until reviewed/accepted.

## Outputs

- `data/processed/hard_negative_candidates.geojson`
- `data/processed/crown_detector_training_seeds.geojson`
- `data/processed/low_canopy_candidates.slim.geojson`
- `data/processed/low_canopy_candidates.pmtiles` after `make build-pmtiles`
- `data/processed/akl_trees.sqlite`, tables `tree_hard_negative_candidates` and `tree_low_canopy_candidates`
