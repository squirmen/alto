# Aotearoa Long-term Tree Observatory (ALTO)

Better Places Lab, Waipapa Taumata Rau | University of Auckland.

This project is a reproducible geospatial pipeline for building a tree-by-tree map and database of Auckland's urban forest, then estimating environmental and economic value for each tree with transparent methods and uncertainty.

The goal is not a pretty canopy map. The goal is an evidence-backed tree inventory where each record can be traced to source data, field inventory, LiDAR/aerial inference, or a documented model.

## Current Starting Point

The workspace now has:

- A source registry in `config/sources.json`.
- Public Auckland Council tree layers configured for download:
  - `TreeRegisterPoints`: 50,311 tree register records, including common name, Latin name, owner, and point location.
  - `Notable Trees Overlay`: 3,718 protected/notable tree point records.
  - `Notable Group of Trees Overlay`: 229 protected/notable tree group polygons.
  - `Ruru ObsKauri Tiaki`: 52,047 public kauri survey / disease observation points. This is not a complete kauri distribution layer.
- LINZ 2024/2025 LiDAR and aerial imagery metadata configured for reproducible discovery.
- Methodology notes for remote-sensing extraction and ecosystem-service valuation.

## Repository Layout

```text
config/             Source registry and project configuration.
data/raw/           Immutable source downloads and metadata snapshots.
data/interim/       Derived working files.
data/processed/     Versioned analytical outputs.
docs/               Project plan, data inventory, methods, data requests.
notebooks/          Exploratory notebooks.
references/         Papers, manuals, and external documentation.
scripts/            Acquisition and processing scripts.
src/akl_trees/      Reusable Python package code.
outputs/            Maps, reports, exports, tiles, and figures.
```

## First Commands

Fetch public FeatureServer layers:

```bash
python3 scripts/fetch_arcgis_features.py
```

Fetch LINZ metadata snapshots:

```bash
python3 scripts/fetch_linz_metadata.py
```

Or run both:

```bash
make fetch-public-data
```

Normalize the public tree inventory and protected/notable joins:

```bash
make normalize-public-inventory
```

Serve the pilot map (Range-capable server, required for PMTiles vector tiles):

```bash
make serve-pilot-map
```

Then open:

```text
http://localhost:8765/web/pilot_map/
```

The map uses MapLibre GL JS with vector tiles (PMTiles) so it only loads the visible viewport at each zoom level. Initial page load is sub-100 KB; tiles stream in as you pan / zoom. The current Auckland Isthmus tiles total ~445 MB on disk for 264K trees, 232K crowns, and 165K low-canopy review candidates.

Build the LiDAR canopy-height pilot (set the area with `AKL_TREES_PILOT`,
e.g. `auckland_isthmus_v1`; see `config/pilots.json`):

```bash
make lidar-pilot
```

Build tree crown outlines and first-pass service metrics for the pilot:

```bash
make crown-pilot
```

Fetch valuation context layers for the pilot bbox:

```bash
make fetch-pilot-context
```

Join trees to flood, stormwater, and heat context:

```bash
make tree-context-pilot
```

Build owner/species/top-tree findings from the current pilot:

```bash
make pilot-findings
```

Build QA layers for hard negatives and low-canopy review candidates:

```bash
make build-tree-qa-layers
```

Build multi-year canopy growth/change from historic LiDAR (uses the manually
downloaded LINZ LDS GeoTIFF zips in `data/raw/linz_historic_lidar/DSM_manualDL/`):

```bash
AKL_TREES_PILOT=auckland_isthmus_v1 make build-historic-chm HISTORIC_YEAR=2016
AKL_TREES_PILOT=auckland_isthmus_v1 make growth-change HISTORIC_YEAR=2016
make merge-web
make build-pmtiles
```

Run the current end-to-end pilot pipeline:

```bash
AKL_TREES_PILOT=auckland_isthmus_v1 make end-to-end-pilot
```

## Analysis Principles

- Every tree-level attribute must carry provenance and confidence.
- Exact species, age, DBH, health, and ownership are used only where observed or supplied by an authoritative source.
- Remote-sensed tree crowns are treated as inferred objects until validated against inventory or field data.
- Monetary values are split by service type, method, year, currency, and uncertainty interval.
- We keep physical quantities separate from dollar values so policy assumptions can change without rerunning all detection work.
- Spatial context, such as flood overlap and stormwater-asset proximity, is joined separately from the dollar model so avoided-cost assumptions remain auditable.

## Current State

See `docs/pilot_summary.md` for the consolidated state, methodology, and numbers, and `docs/growth_change.md` for the multi-year canopy growth layer.

- **264,435 canonical trees** combining TreeRegisterPoints, Notable Trees, kauri observations, OSM `natural=tree`, and retained CHM-inferred trees (6 m dedup + crown cleanup).
- **~306 km² Auckland Isthmus pilot** (`auckland_isthmus_v1`): 1 m DSM-DEM CHM mosaic under a VRT; Esri-imagery green-leaf-index mosaic as a second VRT.
- **232,805 trees with point-constrained crown polygons** (21.25 M m² of canopy), all carrying full valuation.
- **187,623 retained LiDAR-inferred trees** after CHM local maxima, OSM water/bridge/port/industrial/marina relation masking, Esri-imagery green-index masking, and no-crown cleanup. False-positive containers, ships, boats, and motorway overpasses are explicitly targeted.
- **Multi-year canopy growth/change (2016 → 2024)** for all 232,805 crowns: per-crown height-change, annual growth rate, growth-velocity class, newly-established detection, and a structural-decline flag, from historic LINZ LiDAR. Median +0.105 m/yr; 7,610 newly established; 8,544 structural-decline flagged.
- **Stage 3 ResNet18 CNN** species-class predictions for every retained inferred tree (24 m × 24 m aerial chips), post-hoc Saerens calibrated to Auckland species priors. Spatial 4-fold balanced accuracy 0.463.
- **NZ-specific allometry** (Beets et al. 2008) for above-ground biomass, with class-specific root:shoot and carbon-fraction ratios.
- **Per-tree NZD valuation** with documented sources for each price assumption: NZ ETS for carbon, stormwater avoided-cost with flood uplift, Auckland Council impervious-surface fraction, temperature-weighted cooling, LAI-based PM2.5 removal. **Total NZD 36.16M / year** (range 19.85M – 52.48M).
- **DeepForest Stage 2 validation** (Weecology pretrained crown detector) showed 0.74 Pearson correlation with our per-tile crown counts on the Waitemata pilot; not yet re-run for the full isthmus.
- **QA layers:** hard-negative retained detections in high-risk marina/port/water exclusions (0 this run), plus 165,285 low-canopy review candidates that are visually distinct and excluded from trees, crowns, context, valuation, and growth until accepted.
- **Web pilot map** with 4-way basemap selector, collapsible sidebar, legend-based source/status toggles, multi-select species filtering, distinct protected/no-crown colours, an optional low-canopy candidate layer, and a per-tree **Growth & change** profile section.

## Near-Term Work

1. **Replace OSM building mask** with the authoritative LINZ NZ Building Outlines via API key.
2. **Swap the constant Auckland annual rainfall** for NIWA gridded / gauge data.
3. **Confirm avoided-cost** NZD/m³ stormwater value with Healthy Waters.
4. **Re-run DeepForest validation** on the full isthmus (currently Waitemata-only).
5. **Add a web map growth visualisation** — growth currently surfaces only in the per-tree profile; a "colour by growth velocity / status" map mode would make it discoverable at a glance.
6. **Fine-tune the crown detector** with CHM + aerial imagery using the hard-negative and positive seed outputs.
7. **Expand citywide in tiles/regions** (`auckland_metro_v1`, 1,680 km²) once the LINZ building mask is cached locally; staged rather than one monolithic job.
8. **Field validation** sample at ~100 random crowns to ground-truth the inferred-tree precision and species class.
