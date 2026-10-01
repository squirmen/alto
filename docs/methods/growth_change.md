# Canopy Growth & Change Detection

Multi-year canopy change for the Auckland Isthmus pilot, derived by
differencing a historic LiDAR canopy-height model (CHM) against the current
2024 CHM, per crown polygon. This adds a longitudinal dimension to every
tree: how its height and canopy have changed, whether it is growing,
stable, declining, or newly established.

This corresponds to **Priorities 3 (growth trajectory)** and **4
(change-based vitality / status)** in the project plan.

## Headline Numbers (2016 → 2024, Auckland Isthmus)

Baseline: **2016** LiDAR (the immediate predecessor collect — cleanest
registration against 2024). An **8-year** window.

| Metric | Value |
| --- | --- |
| Crowns with change data | **232,805** |
| Existing (canopy in both epochs) | 225,195 |
| Newly established (canopy now, none in 2016) | 7,610 |
| Median annual height growth | **+0.105 m/yr** |
| Mean annual height growth | +0.106 m/yr |
| Height-growth range (per tree) | −8.35 to +6.93 m/yr |

**Growth velocity (height-based):**

| Class | Trees | Rule |
| --- | --- | --- |
| Expanding | 43,924 | annual height growth ≥ +0.25 m/yr |
| Stable | 171,239 | between −0.25 and +0.25 m/yr |
| Declining | 10,032 | ≤ −0.25 m/yr |
| Newly established | 7,610 | canopy now, none in 2016 |

**Structural decline flag** (annual height loss ≤ −0.30 m/yr): 8,544 trees.

**Canopy-area change class** (see caveat below): expanded 148,321 · stable
76,821 · new_canopy 7,610 · contracted 53.

## Data Source

LINZ LDS regional 1 m LiDAR GeoTIFF archives, downloaded manually into
`data/raw/linz_historic_lidar/DSM_manualDL/`:

| Year | DSM archive | DEM archive |
| --- | --- | --- |
| 2013 | `lds-auckland-lidar-1m-dsm-2013-GTiff.zip` | `lds-auckland-lidar-1m-dem-2013-GTiff.zip` |
| 2016 | `lds-auckland-north-lidar-1m-dsm-2016-2018-GTiff.zip` + `…-south-…-2016-2017-…` | matching DEM north + south |

> **Why manual download, not the Exports API.** The LINZ Exports API
> (`fetch_historic_lidar.py`) returned only a ~0.37 km² clipped strip for
> the 306 km² isthmus bbox — four thin western-edge tiles totalling under
> 1 MB. The full LDS regional archives (each ~800 MB, ~3,800 tiles) cover
> the whole isthmus. `build_historic_chm_from_lds.py` reads the per-tile
> GeoTIFFs straight out of the zips with GDAL `/vsizip/` (no extraction —
> avoids needing ~12 GB scratch disk) and mosaics them.

Aligned historic CHM coverage over the 306 km² isthmus grid:

| Year | Valid pixels | Coverage | Canopy pixels ≥ 3 m |
| --- | --- | --- | --- |
| 2016 | 267.2 M | 87.3% | 68.5 M |
| 2013 | 235.3 M | 76.9% | 65.0 M |

The non-covered fraction is harbour/water and small inter-collect gaps.

## Method

### 1. Build the aligned historic CHM (`build_historic_chm_from_lds.py`)

1. List `.tif` members of each LDS zip → `/vsizip/` paths.
2. `gdalbuildvrt` an in-place VRT mosaic for DSM and for DEM.
3. `gdalwarp` each VRT onto the **exact** current pilot CHM grid (extent,
   1 m resolution, EPSG:2193), bilinear resampling.
4. `CHM_historic = DSM − DEM`, block-windowed, clamped to [0, 80] m,
   written as a tiled/deflate GeoTIFF `chm_<year>.tif`.

Output is identical in shape/grid to the 2024 `chm.vrt`, so the difference
is a straight per-pixel subtraction.

### 2. Per-crown differencing (`build_growth_change.py`)

For each of the 232,805 crown polygons (reprojected to EPSG:2193):

- Read both CHMs over the crown footprint on a common grid.
- `current_height_m` = max current CHM inside the crown.
- Historic canopy presence = historic pixels ≥ 3 m inside the footprint.
- If ≥ 3 historic canopy pixels exist → `tree_status = existing`,
  `historic_height_m` = max historic canopy height; compute
  `height_change_m`, `height_change_pct`, `annual_height_growth_m`
  (÷ year span), and `crown_area_change_pct` from cover fractions.
- If no historic canopy → `tree_status = newly_established`.

### 3. Classification

- **growth_velocity_class** — expanding / stable / declining /
  newly_established, by annual height growth (±0.25 m/yr thresholds).
- **vitality_change_score** — `clip(0.5 + annual_growth, 0, 1)`, a single
  covariate proxy (higher = healthier trend).
- **structural_decline_flag** — annual height loss ≤ −0.30 m/yr.
- **canopy_change_class** — expanded / stable / contracted / new_canopy,
  by crown-area cover-fraction change (±15% thresholds).

## Outputs

- SQLite table `tree_change_pilot` (keyed by `tree_id`), columns:
  `historic_year, historic_height_m, current_height_m, height_change_m,
  height_change_pct, annual_height_growth_m, crown_area_change_pct,
  historic_canopy_cover_frac, tree_status, growth_velocity_class,
  canopy_change_class, vitality_change_score, structural_decline_flag`.
- `data/processed/tree_change_pilot.geojson` (one point per changed tree).
- `data/interim/historic_chm_auckland_isthmus_v1/chm_2013.tif`,
  `chm_2016.tif` (+ aligned DSM/DEM rasters).

These are merged into the slim web GeoJSONs and PMTiles by
`merge_assets_into_web.py` + `build_pmtiles.sh`, and surfaced in the web map
per-tree profile under **Growth & change** (timeline, height then → now,
height change, annual growth, canopy-change class).

## How to Run

```bash
# 2016 baseline (headline), pilot = auckland_isthmus_v1
AKL_TREES_PILOT=auckland_isthmus_v1 \
  python scripts/build_historic_chm_from_lds.py --year 2016
AKL_TREES_PILOT=auckland_isthmus_v1 \
  python scripts/build_growth_change.py \
    --historic-chm data/interim/historic_chm_auckland_isthmus_v1/chm_2016.tif \
    --historic-year 2016
python scripts/merge_assets_into_web.py
scripts/build_pmtiles.sh
```

For a longer 11-year baseline, swap `--year 2013` / `--historic-year 2013`
(the 2013 CHM is already built). Only one `tree_change_pilot` baseline is
held at a time; re-running replaces it.

## Caveats

- **Crown footprints are 2024-defined.** Crown polygons come from the 2024
  segmentation, so historic canopy cover is measured *inside today's
  crown*. This biases `canopy_change_class` strongly toward "expanded"
  (148K expanded vs 53 contracted) — a tree that grew into its current
  footprint had less canopy there in 2016 almost by construction. The
  **height-based** `growth_velocity_class` is the more trustworthy change
  signal; treat area-change as directional, not quantitative.
- **Registration / collect differences.** 2016 is a north (2016–2018) +
  south (2016–2017) mosaic of two collects; small vertical/horizontal
  offsets between collects and against 2024 add noise to per-tree change.
  Aggregate statistics (median +0.105 m/yr) are robust; individual outliers
  (the −8.35 to +6.93 m/yr tails) are mostly registration/segmentation
  artefacts, not real growth.
- **3 m canopy threshold.** Same threshold as detection; sub-3 m historic
  shrubs/saplings that crossed 3 m by 2024 register as `newly_established`
  even though woody vegetation was already present.
- **Newly established ≠ planted.** A `newly_established` flag means "≥ 3 m
  canopy now, none in the historic epoch within this footprint." It
  captures genuine new plantings, but also previously-short vegetation and
  some edge/registration effects.
