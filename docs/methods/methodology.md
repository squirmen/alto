# Methodology Notes

## Evidence Standard

This project should produce a real analysis, not an illustrative calculator. Each output value should have:

- `source_id`: where the input came from.
- `method_id`: how it was derived.
- `confidence`: observed, modelled-high, modelled-medium, modelled-low, or unknown.
- `as_of_date`: source or model date.
- `uncertainty`: interval or class where practical.

## Tree Object Model

Core fields:

- Stable project tree ID.
- Source IDs and original source fields.
- Geometry: point, crown polygon, and optional trunk point.
- Species: common name, Latin name, source, and confidence.
- Structure: height, crown area, crown diameter, DBH, age class, condition, live/dead status.
- Context: owner, public/private, road/park/property, catchment, land use, impervious cover nearby, heat exposure.
- Services: physical quantities and dollar values by method/year.

## Remote-Sensing Pipeline

1. Build canopy height model:
   - CHM = DSM - DEM.
   - Use EPSG:2193 and consistent 1m grid alignment.
   - Remove negative values and obvious artefacts.

2. Mask non-tree surfaces:
   - Remove buildings, bridges, and non-vegetated tall structures using building footprints, land cover, and image features.
   - Use height thresholds consistent with Auckland canopy reporting, initially trees/woody vegetation above 3m.

3. Segment tree crowns:
   - Detect local maxima in CHM.
   - Use watershed or marker-controlled segmentation.
   - Split/merge crowns using aerial imagery texture and known tree register points.
   - Keep unresolved dense stands as canopy clusters until confidence improves.

4. Validate:
   - Match inferred crowns to `TreeRegisterPoints` and notable tree records.
   - Report omission, commission, positional error, and crown-area error.

## Current Pilot Segmentation

The Waitemata pilot uses point-constrained segmentation:

- CHM candidate pixels are `DSM - DEM >= 3m`.
- OSM building footprints are rasterized and removed as an interim structure mask.
- Known tree points from `TreeRegisterPoints` seed crown assignment.
- Candidate pixels are assigned to the nearest known tree only inside a height-scaled maximum crown radius.
- Resulting labels are polygonized into crown outlines and joined back to the tree database.

This produces usable end-to-end crown objects for the pilot, but it is not yet a production individual-tree segmentation method. Dense multi-tree canopies, missing inventory points, and trees over buildings/structures need LiDAR point-cloud or watershed-style refinement.

## Ecosystem-Service Modules

## Current Context Joins

The Waitemata pilot now joins each crown/tree to public context layers:

- Flood plain intersection.
- Flood-prone area intersection and mapped depth fields.
- Distance to overland flow paths.
- Distance to stormwater pipes, catchpits, manholes/chambers, and inlets/outlets.
- Predicted air-temperature field, paved fraction, building fraction, and tree fraction.

These are real spatial inputs, but not final avoided-cost values. They should be used to replace uniform placeholder assumptions with local risk and exposure modifiers.

### Carbon

Estimate carbon storage and annual sequestration from species, DBH, height, and biomass equations. When DBH is absent, estimate it from height/crown/species allometry and mark it as inferred. Monetary values should be reported separately using NZ ETS price and/or a social cost of carbon assumption.

### Avoided Runoff and Stormwater

Use an i-Tree Eco style avoided-runoff method as the first benchmark: leaf/crown area, local hourly rainfall where available, evapotranspiration/weather, and runoff coefficients. Translate physical avoided runoff into dollars only with an Auckland-specific marginal stormwater cost or clearly labelled interim proxy.

Next replacement for the pilot proxy:

1. Replace the uniform interception fraction with species/leaf-area/seasonal assumptions.
2. Replace the uniform runoff coefficient with local impervious-surface and land-cover context around each crown.
3. Weight stormwater value by flood-prone overlap, overland-flow proximity, and stormwater-asset proximity.
4. Replace the `NZD/m3` placeholder with a documented Auckland avoided-cost basis, such as marginal treatment/storage/network-capacity cost or an agreed council accounting value.

### Cooling and Shade

Separate:

- Shade geometry and exposed-surface cooling.
- Air-temperature / urban heat island effects.
- Energy-demand effects for nearby buildings.
- Health/exposure effects for pedestrians and vulnerable populations.

Cooling value should not be collapsed into a single dollar estimate until local assumptions are documented.

### Air Pollution

Use dry-deposition methods for pollutants where local concentration/weather data exist. Track physical pollutant removal separately from monetary valuation.

### Costs and Disservices

Include costs only where data support them:

- Maintenance and pruning costs.
- Removal/replacement costs.
- Infrastructure conflict risk.
- Allergenic or VOC disservices where species-specific evidence exists.

## Initial Confidence Classes

| Class | Meaning |
| --- | --- |
| observed | Direct source attribute or field measurement |
| modelled-high | Inferred from LiDAR/imagery and validated locally |
| modelled-medium | Inferred from remote sensing but not locally validated |
| modelled-low | Proxy or imported equation with weak local calibration |
| unknown | Not available and not defensibly inferred |
