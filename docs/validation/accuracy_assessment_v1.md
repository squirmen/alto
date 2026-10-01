# WS1 — Accuracy assessment (v1)

_Generated 2026-06-19T00:50:18+00:00 from `akl_trees.sqlite`. See `docs/research_programme.md`._

## 1. Detection rate — CHM/point-cloud evidence vs field-verified trees

Ground truth: **72,012** field-verified trees (register + notable + kauri). Detection is measured as per-tree evidence on each verified tree. **Point-cloud confirmation (`pc_confirmed`) has 100% coverage across all sources → it is the clean signal.** CHM-based evidence has uneven coverage (see *CHM coverage* column), so read CHM rates only alongside coverage.

**Overall: point cloud confirms canopy on 64.9% of verified trees** (CHM canopy 64.3% at 74.1% CHM coverage; either sensor 68.5%).

### By canopy-height band (overstory vs understory)

| Stratum | n | PC confirmed | CHM canopy | CHM coverage |
|---|--:|--:|--:|--:|
| 15-25m | 9,514 | 98.9% | 99.7% | 100.0% |
| 25m+ | 1,596 | 98.3% | 99.8% | 100.0% |
| 3-8m | 16,155 | 93.9% | 95.0% | 100.0% |
| 8-15m | 16,753 | 97.6% | 99.1% | 100.0% |
| <3m (sub-canopy) | 9,343 | 45.0% | 35.1% | 100.0% |
| no-CHM | 18,651 | 0.3% | 0.0% | 0.0% |

### By owner / land-use class

| Stratum | n | PC confirmed | CHM canopy | CHM coverage |
|---|--:|--:|--:|--:|
| Auckland Council Parks | 16,699 | 91.9% | 92.5% | 100.0% |
| Auckland Transport | 32,793 | 85.1% | 83.0% | 100.0% |
| Kauri Observation (Public Survey) | 18,379 | 8.7% | 8.5% | 8.8% |
| Notable Tree (Council Schedule) | 3,322 | 40.1% | 40.8% | 43.2% |
| Unknown | 819 | 70.3% | 87.1% | 100.0% |

### By verified source

| Stratum | n | PC confirmed | CHM canopy | CHM coverage |
|---|--:|--:|--:|--:|
| notable_trees_overlay | 3,322 | 40.1% | 40.8% | 43.2% |
| ruru_obskauri_tiaki_public | 18,379 | 8.7% | 8.5% | 8.8% |
| tree_register_points | 50,311 | 87.1% | 86.2% | 100.0% |


## 2. Height cross-sensor agreement (CHM crown height vs point-cloud canopy top)

n = **227,627** trees with both measures. RMSE **3.16 m**, bias **-1.64 m** (CHM − point cloud), r = 0.915.

| Height band | n | RMSE (m) | bias (m) |
|---|--:|--:|--:|
| <3m (sub-canopy) | 217 | 9.78 | +6.79 |
| 3-8m | 33,157 | 2.71 | -0.27 |
| 8-15m | 123,556 | 2.41 | -1.31 |
| 15-25m | 54,752 | 3.56 | -2.46 |
| 25m+ | 15,945 | 6.11 | -4.38 |

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

**Caveats / findings:** (1) `tree_register_points` is 100% CHM+PC processed → its rates are clean. (2) **Notable (43% CHM coverage) and kauri (9%) are confounded** — their low rates partly reflect missing CHM rows and possibly points outside the pilot extent; needs a spatial-extent + position audit before the 'field-verified' grade is trusted for them. (3) Height-band rates are mildly circular (band derived from CHM). (4) Commission/precision needs register-complete zones (WS1 next). (5) Height agreement is sensor *consistency*, not field truth. (6) Growth-form map is a genus scaffold.
