# WS4 — root-zone model (historical scenario)

> **Superseded terminology.** These polygons are root-space sensitivity scenarios, not measured root extent or windthrow risk. Rebuild with `root_space_sensitivity_v3_not_physical_extent` before republishing.

Per-tree root zones for **1,568,774** trees. The BS5837 RPA (12×DBH) is kept as the construction-protection minimum, but the displayed/analysed zone is a research-grounded estimate.

## Model
- **Foraging extent** = 1.5 × crown radius (roots extend well beyond the dripline; Gilman 1988, Stone & Kalisz 1991, Day et al. 2010).
- **Constrained** by neighbour competition (≤0.6 × nearest-tree distance) and impervious exclusion (sealed surfaces/buildings/roads remove ~70% of rooting on an area basis).
- **Stability floor** = max(3×DBH, 0.12×height) — structural root-plate anchorage (Coutts 1983); below it ⇒ windthrow risk flag.

**Effective root radius: median 5.7 m** (vs the old RPA ~1–2 m — the discs were under-sized because RPA is a legal minimum, not biology).

## Constraint / stability flags

| Flag | n | share |
|---|--:|--:|
| constrained | 993,580 | 63.3% |
| ok | 569,915 | 36.3% |
| at_risk | 5,279 | 0.3% |

`at_risk` = effective root zone below the anchorage minimum (hemmed in by buildings + close neighbours) — genuine windthrow-risk candidates.

Total effective root area **182.0 km²** vs canopy 185.0 km² (ratio 0.98).

## Stormwater (kept conservative, on the RPA)

Root-zone avoided runoff 2.84M m³/yr → **NZ$10.4M/yr** (+18% on canopy NZ$57.2M/yr). Still on the small RPA (not the larger effective zone) to avoid over-claiming infiltration the soil provides anyway.

**All estimates** — root systems are highly plastic; without GPR/excavation this is a model. Shape is still a circle; true asymmetric deflection around building footprints is a v3.
