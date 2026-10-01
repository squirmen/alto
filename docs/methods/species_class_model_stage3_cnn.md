# Species-Class Model (Stage 3 CNN)

Generated at: 2026-06-22T00:09:49+00:00

## What This Adds

Fine-tunes a small ResNet18 (ImageNet-pretrained) on 24 m × 24 m aerial RGB chips around each labelled tree, then predicts species class for every LiDAR-inferred tree. The CNN sees texture, leaf colour, crown shape, and shadow patterns directly — signal Stage 1 (structure only) and Stage 3-lite (mean / std colour statistics) can only approximate.

## Model

- Backbone: torchvision ResNet18 ImageNet weights, final fc replaced for 4 classes.
- Input: 64×64 RGB, ImageNet normalisation, random flip + rotation augmentation.
- Patch radius: 12 m at Esri z=18 imagery.
- Optimiser: Adam(lr=1e-03), batch size 128, 6 epochs.
- Class-weighted cross-entropy (counter-balances broadleaf majority).
- Device: mps.
- Spatial cross-validation: GroupKFold(4) on 1 km cells.
- Labelled rows used: 43,869.
- Inferred rows scored: 1,519,271.

## Spatial Cross-Validation Quality

- Overall balanced accuracy: 0.425
- Per-fold balanced accuracy: 0.348, 0.482, 0.467, 0.445

### Per-class quality

| Class | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| evergreen_broadleaf | 0.61 | 0.65 | 0.63 | 22,007 |
| deciduous_broadleaf | 0.44 | 0.41 | 0.42 | 12,166 |
| conifer | 0.64 | 0.34 | 0.44 | 8,293 |
| palm_other | 0.09 | 0.31 | 0.14 | 1,403 |

### Confusion matrix (rows = truth, cols = predicted)

| | evergreen_broadleaf | deciduous_broadleaf | conifer | palm_other |
| --- | --- | --- | --- | --- |
| **evergreen_broadleaf** | 14,201 | 4,627 | 980 | 2,199 |
| **deciduous_broadleaf** | 5,562 | 4,999 | 542 | 1,063 |
| **conifer** | 2,770 | 1,512 | 2,784 | 1,227 |
| **palm_other** | 587 | 308 | 76 | 432 |

## Class Distribution

| Class | Labelled | Predicted (inferred) |
| --- | ---: | ---: |
| evergreen_broadleaf | 22,007 | 256,274 |
| deciduous_broadleaf | 12,166 | 36,006 |
| conifer | 8,293 | 1,161,871 |
| palm_other | 1,403 | 65,120 |

## Outputs

- `data/processed/akl_trees.sqlite`, table `tree_species_class_predictions` (overwritten with Stage 3 CNN output)
- `docs/species_class_model_stage3_cnn.md` (this file)