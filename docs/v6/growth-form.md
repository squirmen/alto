# Growth form and smoothed crown outlines (v6)

Release v6 (`20261012-v6`, published 12 October 2026) adds a model estimate of growth form for the v5
crowns (3,352,099 scored), draws each crown with a smoothed outline of the same cells, and lets the
benefit estimates use the growth form. It keeps every v5.2 record, link, map marker, source position and history, and a
recorded species always stays the species shown. Method ids: `growth_form_v6_A2_C1or_A2robust` (growth
form) and `pointcloud_v53_outline_B` (outlines). The release's own counts, display rules and service
changes are published with the data as `data/growth-form-v6.json`; the fields are in
[`docs/data-dictionary.md`](../data-dictionary.md) (`growth_form`, `outline`, `services`).

The interface that shows growth form is [`web/growth-form.js`](../../web/growth-form.js) (colour by
growth form, the Growth form filter and the legend wording), tested by
[`pipeline/v6/test_growth_form_ui.cjs`](../../pipeline/v6/test_growth_form_ui.cjs). The scoring and
release code for v6 is not in this repository yet; this document describes it.

## Why a new growth form

Before v6 a tree's growth form (evergreen or deciduous broadleaf, conifer, palm) came from a recorded
species name where a source gave one, which is true for a small share of the map's trees. Elsewhere it
came from an earlier, uncalibrated aerial-image model, which v5.2 used for 1.15 million detections and
which called 643,000 of them conifer, implausible for Auckland, or from a default evergreen broadleaf
assumption. Tested on 19,558 crowns whose growth form is known from the Council register, the v5
growth form without register names had a balanced accuracy of 0.274, where always answering "evergreen"
scores 0.250. Growth form matters beyond the label: the benefit estimates take leaf area, the trunk-size
curve and the biomass equations from it.

## The model

Six classes: evergreen broadleaf, deciduous broadleaf, conifer, palm, palm-like (cabbage trees and
similar monocots) and tree fern. Palm, palm-like and tree fern together are "palm-type"; with broadleaf
and conifer they make the three coarse classes.

- **Inputs** for each scored v5 crown:
  - LiDAR structure from the 2024 survey inside the crown, such as height, height against width, the
    mix of return types, intensity, the vertical profile, ground returns and NDVI;
  - setting within 30 m and 100 m: canopy cover, crown density, distance to roads and buildings,
    nearness to a parcel boundary and membership of a street run;
  - image features: embeddings from a frozen DINOv2 ViT-B vision model of 2024 LINZ 7.5 cm true-colour
    and colour-infrared chips cut at the LiDAR crown top, read by per-class logistic heads. The chip is
    not shifted for lean: shifting it toward the photographed crown often landed on shadow for tall,
    leaning bush trees.
- **Classifier (A2):** a six-class LightGBM model, calibrated (temperature and class bias), with an F1
  decision rule. It abstains below a probability of 0.5, and a call is "high confidence" in the band
  where inner out-of-fold accuracy is at least 0.90.
- **Leaf-on flights (A2_robust):** the 2024 survey was flown on ten dates, mostly in May and June.
  Crowns on the 30 April, 4 July and 21 October flights, which the model treats as leaf-on, are scored by
  the same model without the leaf-sensitive LiDAR features (return types, intensity, band shares, ground
  returns and flight day). A2 scored 2,934,764 crowns and A2_robust 417,335.
- **Palm detector (C1):** a RetinaNet object detector built on DeepForest and fine-tuned on labelled palm
  boxes, run over the 2024 aerial imagery of the whole metropolitan area independently of the crown
  outlines. A crown with a palm detection is called palm-type whatever the model says, except on crowns
  wider than 10 m whose model call is not palm-type high or medium: such crowns are often several trees,
  so the detection is not used on its own (1,028 crowns).
- **Training labels:** 21,988 crowns: 19,329 whose growth form comes from a Council register species
  (97% of them on the central isthmus) and 2,659 labelled blind from aerial imagery and LiDAR views
  outside the isthmus. Tree fern is trained as its own class (197 crowns). Blind labels carry four times
  the weight of register labels, a weight every training fold chose.
- **Validation:** five spatial folds on 1 km blocks with a 100 m buffer; seed 20261002.

## How well it does

**A fresh blind test outside the isthmus.** 600 crowns in 15 new 1 km blocks, never trained or tuned on;
401 received a decided label. Results are weighted to the 2.89 million crowns of the outside blocks, with
95% intervals from a block bootstrap:

| | Earlier candidate (not released) | v6 model |
|---|--:|--:|
| Coarse balanced accuracy, single trees | 0.457 [0.364, 0.562] | 0.719 [0.633, 0.813] |
| Crowns shown as conifer (labels: 3.8%) | 22.0% | 5.7% |
| Palm-type recall / precision | 0.13 / 1.00 | 0.85 [0.72, 0.94] / 0.72 [0.66, 0.84] |
| Leaf-on crowns, coarse balanced accuracy (13 single trees) | 0.21 | 0.93 |

Under the display rules below, 81% of these crowns get a growth form and 94% of those are right;
shown broadleaf calls are 0.94 [0.92, 0.97] precise.

**Against the register.** Out of fold on register crowns, the six-class balanced accuracy is 0.602. The
acceptance bar set before the work asked for 0.70; the model passes 11 of the bar's 16 items. v6
therefore publishes it as an additive model estimate under display rules that show a class only where
calls of that kind were right often enough.

**Label consistency.** 60 test crowns were labelled again, blind, under new ids. When both labels commit
to a coarse class they agree on 30 of 31 (kappa 0.88); whether to commit at all is much less consistent
(kappa 0.28), and 32% of test crowns were left undecided.

## Display rules

A cell (call × confidence × region × flight season) is shown where out-of-fold precision is at least 0.80,
shown as "possibly" at 0.60–0.80, and withheld otherwise. Two cells were tightened after checks on the
blind test, and the pre-publication audit below changed three more. The rules as released:

| Call | Isthmus, May–June flights | Outside the isthmus, May–June flights | Leaf-on flights (30 Apr, 4 Jul, 21 Oct) |
|---|---|---|---|
| Evergreen broadleaf, high / medium | show | show | show |
| Deciduous broadleaf, high / medium | show | show as "Broadleaf (model)" | withhold |
| Conifer, high | show | show | withhold |
| Conifer, medium | withhold (audit) | withhold | withhold |
| Palm-type with a palm detection | show | show | show |
| Palm-type, high | show | show | withhold |
| Palm-type, medium, no palm detection | withhold | withhold (audit) | withhold |
| Abstained (probability below 0.5) | "Growth form not yet determined" | same | same |

The palm-type wording follows the largest of the palm, palm-like and tree-fern probabilities. Tree fern
against palm separates well; palm against palm-like does not, so both read "palm or cabbage tree".

What the map shows for the 3,352,099 scored crowns:

| Shown as | Crowns | Isthmus | Outside |
|---|--:|--:|--:|
| Evergreen broadleaf (model, high confidence) | 1,491,608 | 113,054 | 1,378,554 |
| Probably evergreen broadleaf (model) | 839,983 | 192,259 | 647,724 |
| Deciduous broadleaf (model, high confidence; bare in late-autumn LiDAR) | 16,913 | 16,913 | 0 |
| Likely deciduous (bare in late-autumn LiDAR) | 39,048 | 39,048 | 0 |
| Broadleaf (model) | 136,708 | 0 | 136,708 |
| Likely conifer (model) | 144,883 | 2,537 | 142,346 |
| Likely palm or cabbage tree (palm-type crown seen in 2024 aerial imagery) | 19,600 | 4,780 | 14,820 |
| Likely palm or cabbage tree (model) | 10,861 | 2,114 | 8,747 |
| Likely tree fern (model) | 71,947 | 771 | 71,176 |
| Growth form not yet determined | 580,548 | 80,554 | 499,994 |
| **All scored crowns** | **3,352,099** | **452,030** | **2,900,069** |

2,771,551 crowns (82.7%) show a growth form. The 580,548 not yet determined: 304,461 abstained, 111,339
medium-band conifer calls outside the isthmus, 108,528 palm-type medium calls without a palm detection,
45,693 calls that leaf-on flights cannot support, and 10,527 isthmus "possibly conifer" calls withheld
after the audit. The interface keeps the wordings "Possibly conifer (model)" and "Possibly palm, cabbage
tree or tree fern (model)", but no crown carries them in this release.

Every shown call reads "Growth form (model)" and is described as a model estimate, never an identified
species. Where a source recorded a species, that name stays the tree's species and the model's growth
form is shown beside it; where they disagree both are shown. On 24,785 scored crowns the benefit
estimates already came from a recorded species; they are unchanged.

## Pre-publication audit

Before release, the calls v6 would show were checked in a blind, stratified visual audit across the
whole metropolitan area. The gate criteria and estimators were written before any label existed.

- **Sample:** 18 cells (display class × isthmus or outside × May–June or leaf-on flight), 12 crowns
  each (all of a smaller cell), the rest of 240 shown crowns in proportion to cell size, plus 20 crowns
  not yet determined and 20 decoys drawn uniformly. The 37,395 scored crowns that belong to any
  training, tuning or test label set were excluded. Seeded random draw within each stratum.
- **Cards:** the 2024 chips at the crown top and at the lean-corrected position, colour infrared, older
  aerial surveys (2015–16, 2017 and, in the central survey, August 2023) and LiDAR side profiles. No
  model, display or register value appears on a card.
- **Labels:** one labeller, one pass, blind to every model value; the labels were hashed before the key
  was opened.

**Result: 0.899 of shown calls correct** [0.828, 0.956] (coarse class, decided labels, weighted to the
metro; bar 0.85). Counting uncertain labels as wrong gives 0.782. By class:

| Class | Precision [95%] |
|---|---|
| Evergreen broadleaf | 0.927 [0.841, 0.990] |
| Deciduous broadleaf (all wordings) | 0.977 [0.926, 1.0] |
| Palm-type with a palm detection | 0.981 [0.943, 1.0] |
| Palm-type high ("palm or cabbage tree") | 21 of 21 |
| Tree fern | 0.834 [0.587, 1.0] |
| Conifer | 0.669 [0.268, 0.997] |

Changes made before release:

- **Withheld: isthmus "Possibly conifer (model)".** 1 of 9 decided crowns was a conifer (Wilson interval
  0.02–0.44, against 0.60 for "possibly"); the crowns were mostly eucalypt-, kānuka- and native-broadleaf
  crowns in bush remnants. 10,527 crowns.
- **Withdrawn: "Possibly palm, cabbage tree or tree fern (model)" outside the isthmus.** 4 of 11 decided,
  against 0.76 out of fold and 0.77 on the blind test. About 94,900 crowns stay "not yet determined".
- **Reworded: outside the isthmus a deciduous call reads "Broadleaf (model)"** on every flight. On the
  late-June flights broadleaf was right for 9 of 9 decided crowns, deciduous for only 4 of 7 with
  leaf-habit evidence; kānuka-type scrub looks leaf-off in the LiDAR.
- **Reworded: palm detections read "Likely palm or cabbage tree"**: palm-type was right for 35 of 36, the
  palm sub-type for 25 of 33.
- **Kept, with a caveat: "Likely conifer (model)".** Outside the isthmus 4 of 6 decided crowns were
  conifers and 7 of 13 sampled crowns could not be decided: tall forest emergents where pine, eucalypt and
  podocarp cannot be told apart from above. Pooled with the blind test's high-band calls (6 of 6) it is 10
  of 12.

With these changes the audit's overall figure is 0.921 [0.848, 0.980] (computed after the labels were
joined). Its weak points: one labeller and no repeats; 12–31 crowns per cell, so only cells far from
their bar are settled; leaf-habit evidence is thin outside the central survey; the labels describe the v5
outlines the scores were computed on; and 43% of shown crowns (weighted) are merged outlines, scored by
the majority growth form.

## Smoothed outlines

v5 traced each crown along the 0.5 m grid of the laser survey, so every outline ran east–west or
north–south and crowns looked square. v6 draws a smooth outline around the same cells:

- each crown's cells and its neighbours' cells are blurred separately (σ = 0.5 m) on a 0.25 m grid;
- the outline is the boundary where the crown's own surface reaches a level chosen per crown (0.30–0.50)
  so that the outline encloses the crown's cell area, and exceeds its neighbours' surface, so neighbouring
  outlines cannot overlap; it is then simplified at 0.04 m;
- a crown whose contour fails keeps its raster outline (49 crowns across the full v5 crown set).

Identity does not change: every crown keeps its v5 `seg_key`, its top and its cells. Rasterised back at
v5's cell centres, 99.16% of v5 crown cells stay in their own crown and 0.08% move to a neighbour, and
outlines overlap on 0.005% of crown area, including across tile seams. Crown area, height and every
estimate keep the v5 cell area; the smoothed polygon's area is stored as `outline_area_m2`. Across the
3,352,099 v5 crowns and the 534 crowns drawn from a record in v5.2, smoothed area ÷ cell area has a
median of 0.995 (1st–99th percentile 0.939–1.019; 0.997 in total).

On the held-out test sites of the hand-labelled crown benchmark (an October 2026 update of the one in
[`docs/v5/segmentation.md`](../v5/segmentation.md); 93 reference trees, scored once, matched one to one at
IoU ≥ 0.5), the smoothed outlines keep v5's F1 (0.368) and raise the median matched IoU from 0.632 to
0.634. Their shape now resembles the reference outlines:

| | v5 | v6 outline | Reference outlines |
|---|--:|--:|--:|
| Perimeter ÷ perimeter of a circle of the same area | 1.36 | 1.06 | 1.08 |
| Share of the outline on the survey grid | 1.00 | 0.06 | 0.07 |
| Convexity | 0.90 | 0.98 | 0.98 |

Property canopy is recomputed from the smoothed polygons, so the map and the property panel agree:
canopy over parcels falls by 0.34% (186.28 to 185.65 km²). Where a smoothed edge no longer reaches across
a boundary, a parcel can lose its only canopy; parcels with a property record went from 369,663 to
368,540.

## Benefit estimates

The weighting applies only where the v5.2 service class did not come from a recorded name:

- **Shown call:** leaf area index and the height-to-trunk-diameter coefficients (a + b·h + c·h²) are the
  class values weighted by the model's calibrated four-class probabilities (palm, palm-like and tree fern
  pooled; tree fern takes the v5 palm values until a tree-fern value is chosen). Every other class
  parameter (interception, biomass coefficients, root-to-shoot ratio, carbon fraction) follows the shown
  call, as in v5.
- **Not yet determined:** the flagged evergreen default, as v5 used for undetermined crowns. The legacy
  image-model class is replaced by that default.
- **Recorded species:** unchanged. No coefficient is new; the v5 coefficients are read from and checked
  against [`pipeline/v5/valuation_baseline.py`](../../pipeline/v5/valuation_baseline.py), and every v5.2
  row was first reproduced exactly from its own inputs.

| Change of basis | Crowns | NZ$ a year | Avoided runoff, m³ a year | Stored carbon, t CO₂e |
|---|--:|--:|--:|--:|
| Default evergreen → model weighted | 1,911,354 | −6,914,939 | −277,526 | −319,140 |
| Legacy image-model class → model weighted | 838,325 | +7,795,857 | −231,313 | +100,829 |
| Legacy image-model class → evergreen default (not determined) | 168,745 | +2,305,087 | +25,173 | +103,802 |
| Default evergreen, still not determined | 408,890 | 0 | 0 | 0 |
| Recorded species | 24,785 | 0 | 0 | 0 |
| **All scored crowns** | **3,352,099** | **+3,186,005** | **−483,666** | **−114,509** |

Release totals, summed from the published features: estimated annual value NZ$292.18 million → NZ$295.36
million (+1.1%), avoided runoff 21.01 → 20.52 million m³ a year (−2.3%), stored carbon 3.49 → 3.38 million
t CO₂e (−3.3%). Most of the carbon change comes from crowns now called conifer that v5.2 valued as
evergreen broadleaf trees: the conifer trunk curve and biomass coefficients give less biomass for the
same height (144,883 crowns, −301,500 t CO₂e). Three other readings of the weighting were computed: they
move the annual value by +NZ$2.6 million to +NZ$5.0 million and stored carbon by −97,000 to −179,000 t.
Outlines do not enter the estimates. Crown-based trunk size, life stage and root scenarios are not
recomputed.

## What did not change

- Every v5.2 record, link, map marker, source position, survey history, review decision and accepted
  KYTE visit. Protected or notable trees on the map: 3,570. Crowns counted: 3,523,024.
- The near-canopy (low and sub-canopy) layer and the Council recorded positions layer. Crown tops do not
  move.
- KYTE's nearby index is reused from v5.2 (one cell changed with the corrections below), and its
  missions are unchanged apart from the release label; KYTE's cache stamp is `20261012-v15-v6-data`.

**Corrections.** After the build, reviewer decisions kept in an append-only corrections ledger were
applied, and the release publishes a receipt (`data/corrections-applied.json`). Of 354 corrections, 318
were already reflected in the release, 18 are published with their tree as notes without changing the
map, 1 was applied (a Council notable-tree record moved to the crown its schedule entry describes, so the
map has 3,574,824 trees, one fewer than v5.2), 12 are pending with a stated reason and 5 await review.

## Checks

Before release:

- the scoring run's display was reproduced for every crown, and the v6 rules were recomputed from the
  stored columns;
- every changed service row (2,918,424) was recomputed and equal; v5.2 rows reproduced exactly;
- both map feature streams were compared with v5.2 line by line: 3,352,113 of 4,200,342 point lines and
  3,352,633 of 3,523,101 crown lines changed (the outlines), and every other line is byte-identical;
- 120 tile reads, 180 full records and 175 traced cases; property sums reconcile with the release
  totals, and the land type of all 4,200,342 map features is identical to v5.2;
- the release database was written through a guard that refuses any write to an existing table (none
  was refused); 112 v5.2 schema objects are unchanged.

After activation, the public site was checked over HTTPS: a profile for each display key, 6,238,420
records, 3,574,178 KYTE nearby records and 368,540 property records.

## Limitations

- Growth form is a coarse class, not a species, and every call is a model estimate.
- Conifer calls rest on small samples; outside the isthmus most tall forest crowns cannot be checked from
  above. Medium-band conifer calls outside the isthmus are withheld.
- The palm detector rarely finds palms under 4 m (recall 0.02) and was not trained on cabbage trees or
  tree ferns; palm against palm-like is not reliable.
- Tree ferns use the v5 palm leaf area and trunk curve.
- Crowns drawn from a record in v5.2, crowns outside the v5 survey and records without a crown have no
  growth form. 17.3% of scored crowns are "not yet determined".
- Outlines smooth the v5 cells only: v5's merges remain, and crowns over 60 m² remain about 20% smaller
  than hand-drawn outlines. Near-canopy polygons are not smoothed.
- The `rules` text in `data/growth-form-v6.json` and the late-June sentence on the v6 methods page were
  written before the audit; the counts in that file and the map follow the rules in this document.
