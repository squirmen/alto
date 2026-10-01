# WS1 — internal sensor-consistency assessment (v2)

_Generated 2026-07-12T23:55:39+00:00 from `akl_trees.sqlite`. See `docs/research_programme.md`._

## 1. Canopy evidence at inventory/reference locations

Reference locations: **72,012** register, notable-tree and kauri-surveillance records. They are neither a complete current census nor independent ground truth. Rates below are conditional on each sensor having data and must always be read with the corresponding coverage column.

**Overall internal agreement:** point-cloud canopy 87.6% at 79.8% coverage; CHM canopy 87.6% at 80.7% coverage.

### By canopy-height band (overstory vs understory)

| Stratum | n | PC canopy / covered | PC coverage | CHM canopy / covered | CHM coverage |
|---|--:|--:|--:|--:|--:|
| 15-25m | 11,965 | 99.1% | 99.3% | 99.8% | 100.0% |
| 25m+ | 2,742 | 98.9% | 98.7% | 100.0% | 100.0% |
| 3-8m | 16,085 | 93.1% | 98.0% | 95.1% | 100.0% |
| 8-15m | 17,757 | 97.8% | 98.8% | 99.1% | 100.0% |
| <3m (sub-canopy) | 9,533 | 39.9% | 96.2% | 34.9% | 100.0% |
| no-CHM | 13,930 | 100.0% | 3.1% | n/a | 0.0% |

### By owner / land-use class

| Stratum | n | PC canopy / covered | PC coverage | CHM canopy / covered | CHM coverage |
|---|--:|--:|--:|--:|--:|
| Auckland Council Parks | 16,699 | 91.3% | 98.6% | 92.5% | 100.0% |
| Auckland Transport | 32,793 | 83.9% | 98.5% | 83.0% | 100.0% |
| Kauri Observation (Public Survey) | 18,379 | 98.4% | 29.7% | 97.9% | 27.6% |
| Notable Tree (Council Schedule) | 3,322 | 89.8% | 79.3% | 93.9% | 81.2% |
| Unknown | 819 | 83.4% | 80.2% | 88.3% | 100.0% |

### By verified source

| Stratum | n | PC canopy / covered | PC coverage | CHM canopy / covered | CHM coverage |
|---|--:|--:|--:|--:|--:|
| notable_trees_overlay | 3,322 | 89.8% | 79.3% | 93.9% | 81.2% |
| ruru_obskauri_tiaki_public | 18,379 | 98.4% | 29.7% | 97.9% | 27.6% |
| tree_register_points | 50,311 | 86.3% | 98.2% | 86.2% | 100.0% |


## 2. Height cross-sensor agreement (CHM crown height vs point-cloud canopy top)

n = **1,274,985** trees with both measures. RMSE **3.59 m**, bias **-2.21 m** (CHM − point cloud), r = 0.939.

| Height band | n | RMSE (m) | bias (m) |
|---|--:|--:|--:|
| <3m (sub-canopy) | 728 | 15.05 | +10.95 |
| 3-8m | 107,337 | 3.17 | -0.10 |
| 8-15m | 506,747 | 2.40 | -1.38 |
| 15-25m | 457,078 | 3.67 | -2.78 |
| 25m+ | 203,095 | 5.47 | -4.13 |

## 3. Species / growth-form

Known-species trees: **65,695**. CNN predictions on labelled trees: **0**.

> Species/growth-form confusion matrix is BLOCKED: the CNN scored only unlabelled inferred trees, so there are ~0 predictions on labelled trees. WS1 phase 2 = re-run inference on the labelled set with a held-out split.

Growth-form balance of the labelled set (collapsed to model classes):

| Class | n |
|---|--:|
| conifer | 21,454 |
| deciduous_broadleaf | 13,383 |
| evergreen_broadleaf | 29,258 |
| palm_other | 1,600 |

---

**Caveats / findings:** (1) inventory and surveillance locations are not crown annotations or a complete census. (2) Point-cloud and CHM agreement is not recall or precision. (3) Height-band rates are circular because the band is derived from CHM. (4) Commission/precision requires independent crown/non-tree annotations. (5) Height agreement is sensor consistency, not field truth. (6) Growth form remains a genus scaffold.
