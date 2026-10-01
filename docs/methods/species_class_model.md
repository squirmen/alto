# Species-Class Model (Stage 1)

Generated at: 2026-06-04T11:22:34+00:00

## What This Adds

A gradient-boosted classifier that predicts the i-Tree-Eco-style species *class* (evergreen broadleaf / deciduous broadleaf / conifer / palm) for every LiDAR-inferred tree, using only structural and contextual features. It runs before the valuation step so the species-driven assumptions (carbon allometry, rainfall interception, leaf-area-based PM2.5 removal) actually respond to species rather than defaulting to evergreen broadleaf.

## Model

- Algorithm: `sklearn.ensemble.HistGradientBoostingClassifier`
- Features used: `crown_area_m2`, `crown_diameter_m`, `crown_mean_chm_m`, `crown_max_chm_m`, `fraction_paved_surfaces`, `fraction_buildings`, `fraction_trees`, `air_temp_mean_c`, `approx_x_m`, `approx_y_m`.
- Labels: `evergreen_broadleaf`, `deciduous_broadleaf`, `conifer`, `palm_other` (derived from council-supplied common/Latin names).
- Training rows (labelled): 40,799.
- Spatial cross-validation: GroupKFold(5) on 1 km cells.

## Spatial Cross-Validation Quality

- Overall balanced accuracy (held-out): 0.398
- Per-fold balanced accuracy: 0.364, 0.309, 0.351, 0.460, 0.444

### Per-class quality (precision / recall / F1 / support)

| Class | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| evergreen_broadleaf | 0.63 | 0.83 | 0.71 | 22,529 |
| deciduous_broadleaf | 0.50 | 0.34 | 0.40 | 12,353 |
| conifer | 0.70 | 0.40 | 0.51 | 4,434 |
| palm_other | 0.30 | 0.03 | 0.05 | 1,483 |

### Confusion matrix (rows = truth, cols = predicted)

| | evergreen_broadleaf | deciduous_broadleaf | conifer | palm_other |
| --- | --- | --- | --- | --- |
| **evergreen_broadleaf** | 18,642 | 3,328 | 509 | 50 |
| **deciduous_broadleaf** | 7,907 | 4,171 | 238 | 37 |
| **conifer** | 2,043 | 621 | 1,759 | 11 |
| **palm_other** | 1,144 | 275 | 21 | 43 |

## Feature Importance (permutation)

| Feature | Importance |
| --- | ---: |
| approx_x_m | 0.1434 |
| approx_y_m | 0.1385 |
| crown_max_chm_m | 0.1132 |
| crown_mean_chm_m | 0.0710 |
| crown_area_m2 | 0.0692 |
| fraction_buildings | 0.0666 |
| fraction_paved_surfaces | 0.0593 |
| air_temp_mean_c | 0.0512 |
| fraction_trees | 0.0479 |
| crown_diameter_m | 0.0000 |

## Class Distribution

| Class | Labelled (council) | Predicted (inferred) |
| --- | ---: | ---: |
| evergreen_broadleaf | 22,529 | 86,693 |
| deciduous_broadleaf | 12,353 | 18,240 |
| conifer | 4,434 | 18,974 |
| palm_other | 1,483 | 435 |

## Limitations & Next Steps

- Labels are derived by keyword matching on the council-supplied species name. Mis-spelled or generic entries inherit the same `evergreen_broadleaf` default the rule-based labeller falls back to, so the supervisory signal for that class is conservative.
- Features are non-visual: this model cannot see leaf shape, bark, or seasonal change. It distinguishes classes via crown structure and location.
- Confidence is reported per tree. Trees with low confidence should be flagged in the web map for manual or higher-stage ML review.
- Stage 2 (DeepForest crown detection on aerial imagery) and Stage 3 (CNN species classifier on RGB crops) remain the path to fine-species accuracy.

## Outputs

- `data/processed/akl_trees.sqlite`, table `tree_species_class_predictions`
- `docs/species_class_model.md` (this file)