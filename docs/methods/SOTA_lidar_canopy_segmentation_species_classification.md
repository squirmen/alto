# A State-of-the-Art Approach to Tree Canopy Segmentation and Species Classification from LiDAR-Derived Imagery and Point Clouds

*Methodology reference — last revised 2026-07-10*

---

## 1. Scope and framing

This document describes a defensible, current best-practice pipeline for two coupled tasks:

1. **Individual Tree Segmentation (ITS)** — delineating individual tree crowns (and ideally whole trees, stem + crown) from LiDAR point clouds and derived raster products.
2. **Species classification** — assigning a taxonomic label (species, or genus/functional group where species is not separable) to each segmented tree.

The two tasks are treated jointly because segmentation quality is the dominant upstream control on classification accuracy: a mis-merged or split crown corrupts every feature fed to the classifier. The pipeline is organised so that segmentation and classification can be trained and evaluated independently, but deployed as one instance-then-label cascade — or, at the frontier, as a single multi-task network.

The design assumptions are a temperate/subtropical broadleaf-and-conifer mosaic with mixed native and exotic species, structurally complex closed canopy, and a mix of airborne and drone LiDAR — i.e. the hard case, not open plantation. Simplifications for easier settings are noted inline.

---

## 2. Data foundations

### 2.1 Sensing modalities and when each earns its place

| Modality | Typical density | Strengths | Limits |
|---|---|---|---|
| **Airborne LiDAR (ALS)** | 8–50 pts/m² | Wall-to-wall coverage, canopy height, landscape scale | Sparse understory, weak on sub-canopy stems |
| **UAV/drone LiDAR (ULS)** | 200–2000+ pts/m² | Dense crown structure, resolves branching, small-area detail | Coverage cost, battery/regulatory limits |
| **Mobile laser scanning (MLS)** | very high, stem-level | Excellent stems/DBH along accessible routes | Roadside bias, poor upper canopy |
| **Terrestrial laser scanning (TLS)** | very high, static | Reference-grade stem + lower-crown geometry | Occlusion, plot-scale only, labour |
| **Full-waveform ALS** | — | Vertical canopy profile, intensity/echo-width features | Larger data, more processing |

**Recommendation:** treat ALS as the operational backbone for coverage, and use ULS/TLS as a *calibration and reference tier* over sample plots to train and validate models that then generalise to the ALS-only extent. Do not assume a model trained on 1000 pts/m² ULS transfers to 12 pts/m² ALS without density-augmentation (Section 6.4).

### 2.2 Multimodal fusion is now the default, not an add-on

Structure alone (LiDAR geometry) separates *form* — conical conifer vs. spreading broadleaf, dense vs. open crown. It rarely separates species within a functional group. Species discrimination at SOTA accuracy comes from **fusing structure with spectral information**:

- **Multispectral / RGB orthoimagery** — co-registered aerial imagery, ideally leaf-on and captured close in time to the LiDAR.
- **Hyperspectral imagery (HSI)** — the single strongest species signal where available; narrow bands capture pigment, water, and lignin/cellulose absorption features. Airborne HSI (e.g. AVIRIS-NG-class, or commercial VNIR–SWIR line scanners) is the reference standard.
- **LiDAR intensity / return metrics** — a cheap, always-available radiometric proxy; requires range/incidence-angle normalisation to be usable across a survey.
- **Multi-temporal imagery** — phenology (leaf-out, senescence, flowering) is a powerful discriminator; a spring + autumn pair often beats a single richer scene. Satellite time series (Sentinel-2 10 m, or PlanetScope 3 m) can supply phenology even when airborne capture is single-date.

The governing principle: **LiDAR proposes the tree, spectra name it.** A pipeline that ignores either modality is leaving accuracy on the table.

### 2.3 Co-registration and radiometric conditioning

Fusion is worthless if the pixels and points don't line up. Requirements:

- Sub-pixel/sub-decimetre co-registration between LiDAR and imagery; verify against hard targets, not just metadata.
- Orthorectify imagery to the LiDAR-derived DSM (true-orthophoto) so building/crown lean doesn't smear crown spectra onto neighbours.
- Normalise LiDAR intensity for range, angle of incidence, and per-flightline gain before using it as a feature.
- Topographic/BRDF normalisation of optical imagery across the survey; harmonise across flightlines and dates.

---

## 3. Preprocessing and terrain normalisation

1. **Outlier / noise removal** — statistical outlier removal (SOR) and isolated-point filtering; remove birds, low points, and atmospheric noise.
2. **Ground classification** — Cloth Simulation Filter (CSF) or progressive-TIN densification. This is the load-bearing step; errors propagate into every height metric.
3. **DTM generation** — interpolate ground returns to a bare-earth model (typically 0.5–1 m).
4. **Height normalisation** — subtract DTM from every point to get **height above ground (HAG)**. Work in normalised height space thereafter; this removes terrain-slope confounds from both segmentation and features.
5. **Derived rasters:**
   - **DSM** — first-return surface.
   - **CHM** — DSM − DTM, the canopy height model. Use a **pit-free / spike-free CHM** (Khosravipour pit-free algorithm or point-cloud-based CHM) — raw CHMs contain data pits that fragment watershed segmentation.
   - Optional structural rasters: canopy cover, rugosity, return-density, and vertical-complexity layers.

**Note on resolution:** CHM resolution should track point density — over-fine CHMs on sparse ALS manufacture noise; ~0.5 m suits dense ULS, ~1 m suits typical ALS.

---

## 4. Individual tree segmentation

There are three families. SOTA in complex canopy is decisively moving from (A) and (B) toward (C), but a hybrid remains the most robust operational choice today.

### 4.1 (A) Raster/CHM-based delineation — the baseline

- **Local-maxima detection** with a variable-window filter to find treetops, followed by **marker-controlled watershed** or region-growing on the CHM.
- Fast, interpretable, scales trivially, and works well in even-aged or open canopy.
- **Failure modes:** merges intergrown crowns of similar height, misses fully suppressed sub-canopy trees (invisible to the CHM), and is sensitive to CHM smoothing choices. It fundamentally cannot see below the top surface.

Use as a fallback and as a fast prior, not as the final method in closed multi-layered canopy.

### 4.2 (B) Classical point-cloud segmentation — the workhorse

Operates on the 3D cloud, so it can recover sub-canopy structure the CHM cannot.

- **Top-down region growing** from detected apexes (e.g. Li et al. 2012): grow crowns downward using horizontal spacing rules.
- **Layer-stacking / vertical slicing**, **mean-shift**, **voxel/supervoxel + graph cuts**, and **comparative-shortest-path / stem-based** methods (Tao, AMS3D) that segment from detected stems upward — strong where stems are visible (dense ULS/TLS/MLS).
- Better than CHM methods on overlapping crowns and understory, but heavily **parameter-dependent** (crown spacing, slice thickness) and those parameters don't transfer cleanly across forest types.

### 4.3 (C) Deep learning — the current frontier

Two sub-approaches, both now mature enough for operational use:

**Semantic-then-instance (bottom-up):**
- A point-cloud network (KPConv, RandLA-Net, Point Transformer v3, or a sparse-conv U-Net on voxels) predicts per-point semantics (ground / stem / foliage / low-veg) and often an **offset/embedding** that shifts each point toward its instance centre; instances are then recovered by clustering (mean-shift / HDBSCAN) in the shifted space.
- Representative systems: **ForAINet**, **TreeLearn**, **SegmentAnyTree** (density-agnostic, trained across ALS/ULS/TLS). These are the reference points for a modern build and several ship pretrained weights.

**Raster instance segmentation (top-down):**
- Apply image instance-segmentation networks (Mask R-CNN, or **SAM/DETR-family** with LiDAR-informed prompts) to the CHM + spectral stack to output crown polygons directly.
- **DeepForest** (RGB, pretrained crown detector) is a strong, accessible starting baseline and transfers reasonably with light fine-tuning.

**Why DL wins:** it learns the crown-separation cues rather than requiring hand-tuned spacing thresholds, degrades more gracefully across forest types, and — critically — can be co-trained with classification.

### 4.4 Recommended segmentation architecture (hybrid, defensible today)

```
Point cloud (normalised HAG)
        │
   ┌────┴─────────────────────────────────┐
   │                                       │
 Pit-free CHM                        3D DL segmenter
 → local maxima  ───(tree-top priors)──► (KPConv/PTv3 semantic + offset)
   (fast prior)                            → mean-shift/HDBSCAN instances
   │                                       │
   └──────────► reconcile / NMS ◄──────────┘
                     │
             Instance crowns (3D point sets + 2D polygons)
                     │
             QA: rule-based sanity (min height, area, crown-ratio)
```

- CHM local-maxima give cheap, high-precision treetop priors that stabilise the DL clustering and catch obvious dominants.
- The 3D network recovers sub-canopy and intergrown crowns the CHM misses.
- Reconcile the two with non-max suppression and simple morphological sanity rules.
- Emit **both** a 3D point set and a 2D crown polygon per tree — downstream classification and spectral sampling need both.

---

## 5. Feature extraction (for classical / interpretable classifiers)

Even if the final classifier is a deep network operating on raw points, engineered features remain valuable for interpretable baselines, small-sample regimes, and error analysis. Compute per segmented tree:

**Structural / geometric (from LiDAR):**
- Height metrics — max, mean, percentiles (H25/50/75/95), height CV.
- Crown metrics — crown diameter, projected area, crown volume (convex hull / alpha-shape), crown base height, live-crown ratio, crown-shape asymmetry.
- Density/return metrics — point-density profiles, canopy-cover fractions per height layer, gap fraction.
- Vertical profile shape — the normalised height histogram itself (a "pseudo-waveform"); conifer vs. broadleaf profiles differ sharply.
- Branching/return geometry — mean return count, echo ratios (from multi-return or full-waveform).

**Radiometric (LiDAR intensity):**
- Mean/percentile normalised intensity, intensity by height layer (foliage vs. bark returns differ).

**Spectral (from fused imagery), per crown:**
- Per-band statistics and vegetation indices (NDVI, NDRE, red-edge indices, PRI, water indices from SWIR).
- **Full hyperspectral signature** (mean + variance across the crown), ideally after shadow-masking; this is the dominant species signal.
- **Texture** (GLCM) on high-res RGB — crown texture separates fine- vs. coarse-foliage species.

**Phenological (from multi-temporal imagery):**
- Green-up/senescence timing, amplitude, and flowering signals from a Sentinel-2/PlanetScope time series sampled at each crown.

---

## 6. Species classification

### 6.1 Classical ML baseline (always build this first)

- **Random Forest / gradient boosting (XGBoost, LightGBM)** on the engineered features above.
- Robust, fast, handles mixed feature types, gives feature-importance for interpretation, and sets an honest bar the deep models must beat.
- Expect strong genus/functional-group accuracy; species separability depends almost entirely on spectral richness. Report which classes are confusable — the confusion structure is itself a result.

### 6.2 Deep-learning classifiers — SOTA

**Point-cloud networks (structure-driven):**
- **PointNet++, KPConv, Point Transformer v3, DGCNN** operating directly on each tree's point set. Capture crown architecture without hand-crafted features.
- Structure-only species accuracy is capped by how much species differ in form — good for conifer/broadleaf and gross genus, weaker within a genus.

**Multimodal fusion networks (SOTA for species):**
- Fuse a point-cloud branch (geometry) with a spectral/image branch (HSI/multispectral crown patch) via a fusion head — concatenation, cross-attention, or a transformer that tokenises both modalities.
- This is where the best published species accuracies come from. Cross-attention fusion of LiDAR structure + hyperspectral is the current frontier.
- **2D-CNN on the fused crown raster stack** (CHM + spectral bands + indices as channels) is a simpler, very competitive alternative that avoids 3D-network engineering cost — often the best accuracy-per-effort choice.

### 6.3 Multi-task / end-to-end frontier

The research frontier is a **single network that jointly segments instances and classifies species** (panoptic forest segmentation), sharing a backbone so classification gradients improve crown boundaries and vice versa. This is not yet a low-risk operational default — build the cascade first, treat joint training as an R&D track.

### 6.4 The data problems that actually determine success

Model architecture is rarely the binding constraint; these are:

- **Reference labels.** You need field-verified, geolocated species labels co-located with the point clouds. GNSS-tagged field plots, MLS/TLS-surveyed plots, and expert crown delineation on imagery are the sources. Label quality and spatial accuracy cap everything downstream.
- **Class imbalance.** Real forests are long-tailed. Use stratified sampling, class-weighted losses / focal loss, oversampling of rare species, and **report per-class recall**, not just overall accuracy — overall accuracy is dominated by the common species and hides failure on the rare ones that often matter most.
- **Density-agnostic training.** Augment by decimating dense clouds to ALS densities so the model doesn't overfit to a single density; this is what lets a ULS-trained model deploy on ALS extent. (SegmentAnyTree's core design lesson.)
- **Domain shift.** Phenological state, sensor, and site differ between train and deploy. Hold out entire sites/dates for validation — never random point splits, which leak spatial autocorrelation and inflate accuracy dramatically.
- **Shadow and mixed pixels.** Mask shadowed and inter-crown pixels before extracting spectra, or the classifier learns illumination, not species.

---

## 7. Evaluation

Evaluate the two stages separately, then end-to-end.

**Segmentation:**
- Matched-detection metrics against reference crowns: **recall (detection rate), precision, F-score**, plus over-/under-segmentation rates.
- Instance-quality metrics: **IoU / panoptic quality (PQ)**, boundary agreement, and — where reference stems exist — stem-location matching.
- Stratify by canopy position (dominant / intermediate / suppressed) and crown size; aggregate scores hide systematic failure on suppressed trees.

**Classification:**
- **Per-class precision/recall/F1**, overall accuracy, and a **full confusion matrix** (the confusable-species structure is a primary result).
- Balanced accuracy / macro-F1 to fairly weight rare species.
- Report on **spatially disjoint held-out sites**, ideally a different acquisition date, to give a real generalisation estimate.

**End-to-end:**
- Accuracy conditioned on segmentation correctness vs. unconditional — quantify how much classification error is inherited from segmentation.
- Calibrated per-tree **confidence**, so downstream users can threshold; abstention on low-confidence trees beats confident wrong labels.

**Uncertainty:** propagate and report it — deep ensembles or MC-dropout for classification confidence, and flag low-density / edge-of-swath / heavily-shadowed trees as low-reliability rather than silently labelling them.

---

## 8. Recommended reference pipeline (end-to-end)

```
1. Acquire        ALS (coverage) + ULS/TLS (reference plots) + multispectral/HSI + S2/Planet time series
2. Condition      Denoise → ground-classify (CSF) → DTM → normalise to HAG
                  Co-register + radiometrically normalise imagery + LiDAR intensity
3. Rasterise      Pit-free CHM, DSM, structural layers; true-ortho spectral stack
4. Segment        3D DL segmenter (KPConv/PTv3, pretrained e.g. SegmentAnyTree) 
                  + CHM local-maxima priors → reconcile → per-tree 3D cloud + crown polygon
5. Featurise      Structural + intensity + spectral + phenological features per tree
6. Classify       Baseline: RF/XGBoost on features
                  SOTA: multimodal fusion net (point branch + spectral branch, cross-attention)
                  Efficient alt: 2D-CNN on fused crown raster stack
7. Calibrate      Confidence estimation; abstain below threshold
8. Evaluate       Spatially disjoint held-out sites; per-class + confusion + PQ
9. Deliver        Per-tree geometry, species + confidence, provenance/QA flags
```

### Pragmatic build order

1. Ship the **CHM watershed + RF-on-features** cascade first — it's the honest baseline and often "good enough" for dominants.
2. Swap in a **pretrained 3D DL segmenter** (SegmentAnyTree / TreeLearn / ForAINet) and measure the lift on suppressed and intergrown trees.
3. Add the **multimodal classifier** once fused spectra are co-registered and cleaned.
4. Treat **joint multi-task training** as the R&D frontier, not the deadline deliverable.

---

## 9. Key open challenges (be honest about these)

- **Sub-canopy and suppressed trees** remain the hardest segmentation case for any top-down/CHM-reliant method; only dense clouds + 3D methods help, and coverage economics limit density.
- **Within-genus species separability** is fundamentally spectral-limited; without HSI or good phenology, expect to collapse to genus/functional group and say so.
- **Cross-site / cross-sensor / cross-season transfer** is the recurring failure mode; density-agnostic training and site-disjoint validation are non-negotiable.
- **Reference-label cost** is the true bottleneck; budget for it as a first-class deliverable, and consider self-/weakly-supervised pretraining on unlabelled clouds to reduce label demand.
- **Rare species** drive both ecological value and error; imbalance-aware training and per-class reporting must be baked in from the start, not bolted on.

---

## 10. Anchor methods and systems (starting points, not exhaustive)

- **Segmentation, classical:** Li et al. 2012 (top-down region growing); Dalponte & Coomes (itcSegment); Khosravipour pit-free CHM; `lidR` (R) toolchain.
- **Segmentation, deep:** ForAINet; TreeLearn; SegmentAnyTree (density-agnostic, pretrained); DeepForest (RGB crown detection, pretrained).
- **Backbones:** KPConv, RandLA-Net, Point Transformer v3, Minkowski/sparse-conv U-Nets; SAM/DETR for raster instances.
- **Classification:** Random Forest / XGBoost baselines; PointNet++/KPConv for structure; multimodal LiDAR+HSI cross-attention fusion for species SOTA.
- **Benchmarks/refs:** NEON airborne (HSI+LiDAR + field species) as a canonical fusion benchmark; FOR-instance and related point-cloud instance-segmentation benchmarks.

---

*This document is a methodology reference, not a commitment to a specific implementation. Adapt density, spectral richness, and model complexity to the actual acquisition budget and the accuracy required per management decision.*
