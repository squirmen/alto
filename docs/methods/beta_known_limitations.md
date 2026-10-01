# Aotearoa Long-term Tree Observatory (ALTO) — Known Limitations (Public Beta)

> **Release warning (13 July 2026):** the current products are research scenarios. They are not approved for individual-tree valuation, tax/rates, compensation, risk, or policy decisions.

_Generated 2026-06-15. Pilot: Auckland isthmus (306 km²)._

This is a **beta**. The inventory mixes authoritative records with machine
detections, and every figure is planning-grade, not survey-grade. Set
expectations accordingly when sharing.

## Inventory composition (301,825 trees)

| Evidence grade | Count | Share | What it means |
|---|---|---|---|
| **Inventory/reference record** (council register, notable, kauri surveillance) | 72,012 | 24% | A source recorded an asset or observation; it is not a complete current census or crown annotation. |
| **Crowd-sourced** (OpenStreetMap) | 4,800 | 2% | Community-mapped; usually real, variable accuracy. |
| **Machine-detected** (LiDAR CHM local maxima) | 184,362 | 61% | Detected from 2024 LiDAR canopy. Location good; species predicted. |
| **Promoted candidate** (point-cloud, unverified) | 43,173 | 14% | Small/low canopy the CHM missed, auto-promoted. Lowest confidence. |

Each tree's profile shows its grade in a coloured band so users know what to trust.
- **Point-cloud corroboration:** 235,520 trees (78%) have their canopy confirmed by the classified 2024 LiDAR returns. 3,779 are flagged "no canopy in point cloud — review."
- **Crown geometry:** 90% of trees have a crown polygon; the rest are points only.

## Specific limitations

1. **Species — the weakest layer.** 78% of trees are "Unknown" species (no council record); for those, species class is predicted by a CNN on 2024 aerial RGB with only **~0.4 balanced accuracy**. **Palms are notably under-detected** — they don't separate from broadleaf in either aerial RGB or the point cloud at this density. Treat all predicted species as indicative only. (See the SOTA roadmap for the fix path.)

2. **Promoted candidates (43,173) are unverified.** These are small trees / low canopy the main detector missed, auto-promoted at a medium confidence bar. Their crowns are **circular approximations** (sized from the canopy patch), not segmented polygons, and their species is "Unknown." They inflate counts and value modestly; exclude them if you need a conservative figure.

3. **Hedges are a v1 estimate.** 25,463 hedge segments (~308 km) are valued on their canopy footprint (stormwater + air quality + a conservative carbon term); **cooling value is omitted** (needs per-segment temperature). Hedges are a distinct asset type, not counted as trees.

4. **Valuation is an unvalidated sensitivity scenario.** It is not an i-Tree implementation. Carbon, runoff, cooling, PM2.5 and monetary totals use uncalibrated structural and price assumptions and are not approved even as aggregate release claims.

5. **Detection misses and false positives remain.** The point-cloud verification removed the obvious false positives (ships, cranes, offshore), but dense/overlapping canopy can still merge or split trees, and some low vegetation is over-counted. Counts are ±, not exact.

6. **Change detection** (2016→2024) only applies to the 90% of trees with a segmented crown; no-crown records show single-capture data only.

## Appropriate current use

- Explore neighbourhood-scale structural patterns while retaining coverage and method metadata.
- Use source protection status as an attributed source field, not a remotely verified condition.
- Use point-cloud-confirmed structure for QA and model development, not field-height truth.
- Do not publish accuracy, root extent, species, change, or ecosystem-service claims until the corresponding readiness artifact is accepted.
