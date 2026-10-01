# Data Inventory

This inventory distinguishes actual tree observations from supporting data and model inputs.

## Tree-Level Sources

| Source | Status | Records | Canonical-pilot inclusion | Strength | Limitation |
| --- | ---: | ---: | ---: | --- | --- |
| Auckland Council `TreeRegisterPoints` | Downloaded | 50,311 | 50,311 (primary) | TreeID, common/Latin name, owner, point location | Local rather than all-Auckland; species often unknown |
| Auckland Council `Notable Trees Overlay` | Downloaded | 3,718 | 3,322 added (after 6 m dedup) | Protected/notable schedule reference and point | Schedule name is often a common name only |
| Auckland Council `Notable Group of Trees Overlay` | Downloaded | 229 | Joined as polygon flag | Protected group polygons | Inferred tree counts |
| Auckland Council `Ruru ObsKauri Tiaki` | Downloaded | 52,047 | 18,379 added (after dedup) | Kauri species + survey condition + Phytophthora flags | Survey points, not a census |

Canonical tree inventory now contains **72,012** records. Those that fall inside the Waitemata LiDAR pilot bbox (~52,800 points) get CHM height and crown polygon enrichment.

## Remote Sensing and Base Data

| Source | Status | Purpose |
| --- | --- | --- |
| LINZ Auckland Part 1/2 LiDAR 1m DEM 2024 | Metadata downloaded | Bare-earth terrain for canopy height |
| LINZ Auckland Part 1/2 LiDAR 1m DSM 2024 | Metadata downloaded | Surface heights for canopy/buildings |
| LINZ Auckland Part 1/2 LiDAR Point Cloud 2024 | Web links catalogued | Higher-resolution crown segmentation and validation |
| LINZ Auckland 0.075m Urban Aerial Photos 2024-2025 | Metadata downloaded | Crown delineation, species/condition model features |
| LINZ Auckland 0.25m Rural Aerial Photos 2024 | Metadata downloaded | Regional coverage outside urban layer |
| LINZ LiDAR/aerial tile index layers | Metadata downloaded | Targeted downloads and processing |
| LINZ NZ Building Outlines | Metadata downloaded | Building mask for removing structures from CHM canopy candidates |
| Auckland Council DSM/DEM 2024 ImageServices | **Full pilot bbox tiled (~3,870 LERC tiles, 121 km²)** | 1m DSM-DEM canopy-height model |
| OpenStreetMap building footprints via Overpass | **Full pilot bbox tiled fetch (~95k unique buildings)** | Interim building mask for crown segmentation |

## Pilot Coverage

The Waitemata pilot is now sized to the full footprint of the canonical inventory:

- EPSG:2193 bbox: `(1751000, 5914000, 1762000, 5925000)` (~121 km²).
- 4326 envelope: `[174.6928, -36.9079, 174.8184, -36.8070]`.
- 1 m CHM tiled across 121 GeoTIFF chunks with a VRT mosaic for streaming reads.

## Valuation Context Inputs (Full Pilot)

| Source | Status | Pilot features | Purpose |
| --- | --- | ---: | --- |
| Auckland Council `Flood Plains` | **Refetched for full bbox** | 573 | Flag trees/crowns in mapped flood plains |
| Auckland Council `Flood Prone Areas` | **Refetched** | 1,170 | Join flood-prone status, depth, and volume fields |
| Auckland Council `Overland Flow Paths` | **Refetched** | 22,628 | Measure crown distance to surface-flow routing |
| Auckland Council `Stormwater Pipe` | **Refetched** | 30,421 | Measure local network proximity and asset context |
| Auckland Council `Stormwater Catchpit` | **Refetched** | 20,522 | Measure distance to street drainage inlets |
| Auckland Council `Stormwater Manhole And Chamber` | **Refetched** | 22,088 | Stormwater network density/context |
| Auckland Council `Stormwater Inlet And Outlet` | **Refetched** | 1,994 | Drainage inlet/outlet proximity |
| Auckland Council predicted air-temperature polygons | **Refetched** | 2,088 | Join heat exposure, paved fraction, building fraction, tree fraction |
| Auckland Council `Impervious Surfaces 2017` | Catalogued | n/a | Replaces paved-fraction context with explicit surface raster |
| Auckland Council `Land Cover 2017` | Catalogued | n/a | Needed next for local surface classification |

## Strategic and Method Sources

- Auckland Council, `Auckland's Urban Ngahere (Forest) Strategy`, 2019.
- Knowledge Auckland, `Auckland's urban forest canopy cover: state and change (2013-2016/2018)`, TR2020/009-2.
- USDA Forest Service / i-Tree Eco methods for carbon, air pollution, and avoided runoff.
- Chave et al. 2014, *Improved allometric models to estimate above-ground biomass of tropical trees*, Global Change Biology — basis for the interim AGB allometry.
- NZ Emissions Trading Scheme (NZU) recent spot pricing — basis for the interim carbon NZD value.

## Data Gaps

- Full Auckland Council and Auckland Transport tree asset inventory with field-observed DBH, age, condition, and maintenance history.
- Authoritative LINZ NZ Building Outlines via API key (interim mask is OSM Overpass).
- Stormwater subcatchments, design storm layers, flood model outputs, and marginal stormwater cost assumptions.
- Local hourly rainfall, weather, and energy-price inputs suitable for Auckland-specific valuation.
- Any council-produced 2024 canopy classification, crown segmentation, or AI monitoring outputs.
- A defensible NZD/kg PM2.5 conversion based on NZ MfE / MoH analysis instead of the imported US EPA proxy.
