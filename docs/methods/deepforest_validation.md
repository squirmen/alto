# Stage 2 Validation: DeepForest vs CHM-based Detection

Generated at: 2026-06-04T19:25:23+00:00

## What This Tests

Stage 2 doesn't replace our pipeline — it benchmarks it. We sample random 256 m × 256 m blocks from the pilot, run the Weecology DeepForest pretrained tree-crown detector against the matching cached aerial mosaic, then count the crowns our CHM + greenness pipeline assigned in the same block. Ratios > 1 mean our pipeline over-detects, ratios < 1 mean it under-detects, relative to DeepForest.

DeepForest was trained on US NEON aerial imagery; it may under-recall NZ-native canopy and under-detect dense forest interiors. Treat as a sanity check, not ground truth.

## Results

- Samples taken: 30 tiles (256 × 256 px each at z=18).
- DeepForest total detections: 783.
- Our pipeline total crowns in same tiles: 435.
- Median ratio (ours / DeepForest): 0.46.
- Mean absolute difference per tile: 13.3.
- Pearson correlation of per-tile counts: 0.737.

## Per-tile counts (head)

| tile_x | tile_y | DeepForest | Ours | |Δ| |
| --- | --- | ---: | ---: | ---: |
| 258281 | 159970 | 2 | 0 | 2 |
| 258354 | 159984 | 11 | 0 | 11 |
| 258293 | 160007 | 37 | 11 | 26 |
| 258336 | 160023 | 40 | 17 | 23 |
| 258369 | 159936 | 2 | 0 | 2 |
| 258308 | 159946 | 34 | 12 | 22 |
| 258325 | 160018 | 52 | 32 | 20 |
| 258293 | 159953 | 1 | 0 | 1 |
| 258359 | 159981 | 0 | 0 | 0 |
| 258362 | 160006 | 23 | 10 | 13 |
| 258344 | 159994 | 28 | 20 | 8 |
| 258308 | 159937 | 37 | 26 | 11 |
| 258290 | 159976 | 0 | 0 | 0 |
| 258314 | 159961 | 12 | 5 | 7 |
| 258321 | 160024 | 59 | 29 | 30 |
| 258304 | 159953 | 0 | 0 | 0 |
| 258293 | 160005 | 52 | 15 | 37 |
| 258294 | 159939 | 47 | 35 | 12 |
| 258359 | 159948 | 63 | 34 | 29 |
| 258345 | 160025 | 37 | 0 | 37 |
| 258357 | 159951 | 39 | 28 | 11 |
| 258307 | 159951 | 0 | 0 | 0 |
| 258350 | 159963 | 0 | 0 | 0 |
| 258291 | 159991 | 31 | 19 | 12 |
| 258320 | 159975 | 43 | 67 | 24 |

## Interpretation

- High Pearson correlation suggests both methods agree on which tiles have more trees, even if absolute counts differ.
- A ratio above 1.0 indicates our LiDAR-derived pipeline picks up more crowns per tile (often the case in dense canopy where DeepForest under-segments).
- A ratio below 1.0 in residential blocks suggests we miss isolated garden trees DeepForest can see directly in the aerial.

Per-tile CSV: `data/processed/deepforest_vs_chm_validation.csv`