# WS2 — Cross-time tree trajectories (v2: greenness-masked + fate-validated)

_Generated 2026-06-19T01:54:07+00:00. Window: FULL pilot. Epochs 2013/2016/2024; 2024 greenness-masked, history CHM-only._

## Per-epoch detection

| Epoch | apexes |
|---|--:|
| 2013 | 439,443 |
| 2016 | 480,496 |
| 2024 | 305,079 |

**696,766 trajectories** (182,018 linked to canonical trees).

## Fate

| Fate | n | share |
|---|--:|--:|
| persistent | 339,945 | 48.8% |
| candidate_conversion | 188,827 | 27.1% |
| removed_to_open | 89,886 | 12.9% |
| established_since_2013 | 38,349 | 5.5% |
| indeterminate | 31,855 | 4.6% |
| established_since_2016 | 7,904 | 1.1% |

## Headline

**`removed_to_open` = 89,886 trees (12.9%)** — canopy that became bare ground (HIGH confidence; immune to the building confound). `candidate_conversion` (188,827) = tall-but-non-green in 2024 = likely tree→building (development) BUT building-polluted (history is CHM-only); needs historic imagery to separate real conversions from pre-existing structures. Not a tree-loss estimate.

## Growth (stitched intervals, m/yr)

n=528,252  median **+0.10**  p5 -0.17  p95 +0.63

---

**Novel signal** the old `tree_change_pilot` cannot produce: identity-tracked individual-tree loss/gain across 3 epochs, with removals. Map layer = `removed_to_open` + `established_*` only (the clean signals). **Caveats:** min height 5 m; one global growth prior (species-specific = next); validate `removed_to_open` against aerial before headline publication.
