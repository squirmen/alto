# Path to Real Tree-by-Tree Dollar Values

This project should not present final dollar values until each service has a documented physical model and a documented Auckland-specific avoided-cost basis.

## Trunks

Current tree points are best treated as trunk candidates, not verified trunks.

- `TreeRegisterPoints` may be asset/trunk points, but the public layer does not prove field-survey trunk accuracy.
- Crown polygons alone cannot locate trunks reliably in dense stands or leaning/asymmetric trees.
- Better trunk evidence can come from council/AT asset records, field survey, street-level imagery, or LiDAR point-cloud stem detection for isolated trees.
- The pilot should store `trunk_confidence`: `source_asset_point`, `field_verified`, `point_cloud_inferred`, or `unknown`.

## Stormwater Value

The real stormwater value chain is:

1. Tree structure: crown area, crown diameter, height, species, leaf area, evergreen/deciduous class.
2. Local rainfall: hourly or event rainfall, preferably Auckland gauge or gridded data.
3. Local surface response: impervious surface, land cover, slope, soil/drainage class, and crown-over-surface type.
4. Drainage/flood context: flood-prone areas, flood plains, overland flow paths, catchpits, pipes, inlets/outlets, subcatchments, and known capacity constraints.
5. Physical model: intercepted rainfall, delayed runoff, avoided runoff volume, and uncertainty.
6. Dollar model: Auckland-specific avoided cost per cubic metre, avoided storage/treatment/network capacity cost, or agreed Healthy Waters accounting value.

The pilot now has steps 1, 3/4 partially, and a placeholder for 5/6. The next scientific step is to replace the uniform runoff proxy with local surface and drainage modifiers, then replace `NZD/m3` with an Auckland cost basis.

## Cooling Value

Cooling should be separated into physical exposure and monetary impact:

- Crown shade over road, footpath, roof, playground, park path, or paved public space.
- Heat context from predicted air-temperature and paved-surface fraction.
- Time of day and season for shade geometry.
- People or assets exposed: footpath usage, transit stops, schools, playgrounds, vulnerable-population areas, or nearby buildings.
- Dollar value only after choosing a defensible health, energy, pavement-life, or productivity valuation pathway.

## Carbon Value

Carbon needs DBH or a defensible DBH estimate:

- Observed DBH from asset records or field survey is preferred.
- If missing, infer DBH from species, crown diameter, and height using documented allometry.
- Keep carbon storage and annual sequestration separate.
- Price carbon with NZ ETS price and/or a documented social cost of carbon, labelled by year and source.

## Required Non-Public Inputs

These are the highest-value asks for Auckland Council / Auckland Transport / Healthy Waters:

- Full tree asset records: trunk coordinates, species, DBH, height, crown spread, planting date or age, condition, maintenance history, and removal/replacement costs.
- Stormwater subcatchments, design storm outputs, capacity constraints, modelled runoff volumes, and marginal avoided-cost assumptions.
- Any canopy classification, crown segmentation, tree AI monitoring, or LiDAR point-cloud products.
- Local hourly rainfall/weather inputs and any council-approved climate/flood scenario assumptions.
- Maintenance cost schedules for pruning, inspections, removals, replacements, claims, and infrastructure conflicts.
