# Species-Class Model (Stage 3-lite: structure + aerial colour)

Generated at: 2026-06-04T19:10:18+00:00

## What This Adds

Stage 3 proper trains a CNN on RGB aerial chips. We don't have PyTorch / a GPU installed in this environment, so this script does the next-best thing: it crops a 16 m × 16 m patch from the cached Esri World Imagery around each tree, summarises it with mean/std colour and vegetation-index statistics, and trains the same gradient-boosted classifier as Stage 1 on the combined structural + colour feature set.

Healthy broadleaf canopy clusters lighter/yellower in summer than conifers, and palms have a very different texture / colour signature. Even shallow colour statistics carry signal a structure-only model cannot see.

## Model

- Algorithm: `sklearn.ensemble.HistGradientBoostingClassifier`.
- Features: 10 structural + 18 aerial colour/vegetation indices.
- Labels: `evergreen_broadleaf`, `deciduous_broadleaf`, `conifer`, `palm_other`.
- Patch size: 16 m × 16 m (radius 8 m at z=18 Esri imagery, ~0.6 m pixel).
- Spatial cross-validation: GroupKFold(5) on 1 km cells.
- Labelled rows used: 40,799.
- Inferred rows scored: 121,812.

## Spatial Cross-Validation Quality

- Overall balanced accuracy: 0.416
- Per-fold balanced accuracy: 0.392, 0.333, 0.374, 0.485, 0.440

### Per-class quality

| Class | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| evergreen_broadleaf | 0.65 | 0.84 | 0.73 | 22,529 |
| deciduous_broadleaf | 0.54 | 0.39 | 0.46 | 12,353 |
| conifer | 0.72 | 0.41 | 0.52 | 4,434 |
| palm_other | 0.40 | 0.02 | 0.04 | 1,483 |

### Confusion matrix (rows = truth, cols = predicted)

| | evergreen_broadleaf | deciduous_broadleaf | conifer | palm_other |
| --- | --- | --- | --- | --- |
| **evergreen_broadleaf** | 18,924 | 3,113 | 468 | 24 |
| **deciduous_broadleaf** | 7,288 | 4,856 | 193 | 16 |
| **conifer** | 1,943 | 669 | 1,810 | 12 |
| **palm_other** | 1,078 | 335 | 35 | 35 |

## Class Distribution

| Class | Labelled (council) | Predicted (inferred) |
| --- | ---: | ---: |
| evergreen_broadleaf | 22,529 | 80,610 |
| deciduous_broadleaf | 12,353 | 19,709 |
| conifer | 4,434 | 21,213 |
| palm_other | 1,483 | 280 |

## Outputs

- `data/processed/akl_trees.sqlite`, table `tree_species_class_predictions` (overwritten with Stage 3-lite output)
- `docs/species_class_model_stage3_lite.md` (this file)