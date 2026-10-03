# Property totals and land tenure

From October 2026 the map can show any Auckland property's trees: search an address, and the panel lists the trees on that parcel, the canopy over it and the estimated services those trees provide each year. The same build gives every tree on the map a land-tenure class (street, park, institutional, private, other or unknown), which the map's Land filter uses.

Code: `pipeline/v5/property_sources.py` (fetches and caches the open layers), `pipeline/v5/build_property_tenure_v5.py` (tenure, parcel assignment, canopy, property summaries, parcel tiles and the address index) and `pipeline/v5/property_spot_checks.py` (reconciliation and spot checks, read back through the static files).

## Sources and licences

| Source | Use | Licence and attribution |
|---|---|---|
| ALTO v5 web export (`web_build/points.geojsonl`, `crowns.geojsonl`, `totals.json`), plus four columns from `tree_current_services_v5` that the export does not carry (intercepted_rainfall_m3_y, annual_sequestration_tco2e_y_est, total_value_nzd_y_low and total_value_nzd_y_high) | Trees, crowns, per-tree values | ALTO data, CC BY-NC 4.0 |
| LINZ NZ Primary Parcels (600,194 parcels) | Parcel polygons, parcel_intent, statutory_actions (read for reserve and road-vesting signals; the text is never written out) | CC BY 4.0, "Sourced from LINZ" |
| Auckland Council Unitary_Plan_Base_Zone (139,462 polygons, 14 invalid geometries repaired) | Zone at each point or parcel | CC BY 4.0, Auckland Council |
| Auckland Council Designation (1,548 polygons, 15 invalid geometries repaired; SUBTYPE is the requiring authority) | Ministerial designations (institutional); Auckland Council designations (ownership signal for Open Space zones) | CC BY 4.0, Auckland Council |
| Auckland Council ParkExtentPublic (4,690) and Park_Extents (3,951) | Public open space, Council road reserve and Council property | CC BY 4.0, Auckland Council |
| DOC Public Conservation Land (790 polygons in the Auckland envelope) | Public open space where the plan zones say nothing (Hauraki Gulf Islands, regional park margins). Added because the Unitary Plan base zones are blank over most of the Gulf islands. | CC BY 4.0, Department of Conservation |
| OpenStreetMap addresses (700,702 nodes, ways and relations with addr:housenumber, fetched 2 Oct 2026 from Overpass in 36 sequential cells) | Address search | ODbL 1.0, "Addresses © OpenStreetMap contributors, ODbL" |
| OpenStreetMap golf courses (52 `leisure=golf_course` outlines) and Hauraki Gulf island road centrelines (2,615 ways, 561 km of motor roads and service roads in nine island boxes) | Private golf land under an Open Space zone; island roads outside the parcels | ODbL 1.0, "© OpenStreetMap contributors, ODbL" (carried in the tile attribution and `schema.json`) |

No LINZ titles, appellations, statutory action text or owner names are written to any output. Parcels are identified only by their LINZ parcel id. The AC_Property_Query and AC_Address_Query layers were not used. Four Park_Extents names are double-encoded in the Council's own service (for example "Cadness Reserve, PuÄwai"). Park names are used only inside the build, so they were left as published.

## Counting rule and reconciliation

`export_web_v5.py` adds a feature to `totals.json` when `display_role != 'earlier_detection'`. That covers current_crown (3,352,851), source_record (41,397) and outside_v5_coverage (187,105), for 3,581,353 trees. The property build uses the same rule. Each counted tree belongs to exactly one parcel or to the unassigned remainder (roads, foreshore, register trees kept off a parcel of another tenure).

The table below reads all 65,303 buckets back from disk in `property_spot_checks.py`:

| Total | Parcels (from buckets) | Unassigned | Sum | Release `totals.json` | Difference |
|---|---|---|---|---|---|
| Trees | 3,264,546 | 316,807 | 3,581,353 | 3,581,353 | 0 |
| Value, NZ$/yr | 268,835,181.98 | 23,223,953.38 | 292,059,135.36 | 292,059,135.36 | 0.00 |
| Avoided runoff, m³/yr | 19,259,160.44 | 1,744,440.21 | 21,003,600.65 | 21,003,600.65 | 0.00 |
| Stored carbon, t CO₂e | 3,379,406.36 | 111,805.46 | 3,491,211.83 | 3,491,211.83 | 0.00 |

Other service fields, summed over parcels + unassigned (all counted trees): low value $118.7M; high value $465.4M; stormwater $76.0M; intercepted rainfall 49.9M m³; sequestration 52,247 t CO₂e/yr; carbon value $2.62M; cooling $54.8M; PM2.5 6.34M kg; air quality $158.6M.

The unassigned remainder, by tenure: street 262,195 trees ($17.42M); other (coastal and water) 39,467 ($4.47M); park 8,794 ($0.83M); unknown 5,790 ($0.45M); private 438; institutional 123. It includes 10,589 register trees ($449,945/yr) whose point falls inside a parcel of another class, almost all within a metre or two of the boundary. These trees are kept out of that parcel's figures. Street-tenure ones are listed as "street trees outside your boundary" at 0 m.

## Tenure (`data/tenure.parquet`)

Tenure is inferred from registers, zoning, designations, park extents and parcel records. It is not taken from ownership records. Council-owned housing sits in residential zones, some schools are private, and Crown land can be zoned for anything. `tenure_basis` records which rule fired for each feature.

### Parcel rules (first rule with evidence wins; shares are of the parcel's area)

1. `park_extent`: Council park extents (asset groups Park, Regional, Owned NotMaint, Maint NotOwned, Stormwater, Blue/Green Network Properties, Holiday, plus null-group `PARK -` and `RESERVE -` rows) cover at least half: **park**.
2. `conservation_land`: those extents plus DOC public conservation land cover at least half: **park**.
3. `council_road_reserve`: Council extents describing road reserve, street corridor or streetscape cover at least half: **street**.
4. `council_property`: Council-held non-park property covers at least half: **institutional**.
5. `designation`: a ministerial designation covers at least half: **institutional**.
6. `golf_course`: an OSM golf course covers at least half, the park extents cover less than a fifth, and the zone is Open Space or private: **private**.
7. `parcel_intent`: a reserve-vesting parcel under a private zone is **park**; a railway parcel there is **institutional**.
8. `statutory_reserve`: a live LINZ statutory action declares or vests a recreation, scenic, historic, nature, scientific, esplanade or wildlife reserve, a domain or a recreation ground, and the zone is not road or institutional: **park**.
9. `zone_school_name`: a Residential, Business or Rural zone polygon carrying a school name is **institutional**. 371 polygons qualify (354 names). Most of these schools now take `designation` first; 145 parcels remain on this rule.
10. `open_space_zone_public`: Open Space or Green Infrastructure Corridor zone with a public-ownership signal (any Council extent or DOC land over a fifth, an Auckland Council designation over a fifth, reserve intent, or a live statutory reserve or road vesting): **park**.
11. `open_space_zone_unconfirmed`: Open Space or Green Infrastructure Corridor zone without one: **unknown**.
12. `zone`, by Unitary Plan zone:
    - Road and Strategic Transport Corridor are **street**.
    - Special Purpose (school, tertiary, healthcare, cemetery, airport, Māori purpose, major recreation) is **institutional**. The exceptions are the quarry, landfill and airport-housing zones, which are **private**.
    - Residential, Business, Rural and Future Urban are **private**.
    - Coastal and Water are **other**.
13. `parcel_intent` with no usable zone: reserve is **park** and railway is **institutional**.
14. `parcel_title_unzoned`: titled land in the Hauraki Gulf Islands zone is **private**. The Unitary Plan leaves the islands to their own plan.
15. `outside_plan_zones` (no zone at all) and anything left (`no_evidence`) are **unknown**.

Then `verge_reserve`: a park or unconfirmed open-space parcel under 3,000 m², with a mean width under 8 m and at least 30% of its edge on the road zone, is **street**. 1,002 of 5,372 candidates qualify.

### Point rules

1. `owner_register`: an Auckland Transport register tree is **street**.
2. `verge_reserve`: inside a verge strip is **street**.
3. `road_corridor`: outside every LINZ parcel and inside the Road or Strategic Transport Corridor zone is **street**.
4. `register_boundary`: an Auckland Council Parks register tree inside a private or institutional parcel takes the class of the nearest road zone, verge or park parcel within 5 m.
5. `owner_register`: any other Auckland Council Parks register tree is **park**.
6. Inside a parcel: the parcel's tenure and tenure_basis. One title, one class.
7. Outside every parcel only: park_extent, conservation_land, council_road_reserve, council_property, designation, golf_course, `island_road` (Hauraki Gulf Islands zone within 10 m of an OSM road centreline: **street**), zone_school_name, open_space_zone_public (Open Space zone over Council-owned land or under an Auckland Council designation), open_space_zone_unconfirmed, zone, `unparcelled_unzoned` (island foreshore and streams away from roads: **unknown**), outside_plan_zones.

**Order of the point rules.** The verge and road-corridor tests run before the Council Parks register. The parks register holds many berm and street trees (the Guiniven palms are an example), so location has to be tested first. Auckland Transport stays first. The school-name rule exists because some state schools sit under residential zoning without a designation of their own. DOC conservation land is included because the Unitary Plan base zones are blank over most of the Gulf islands.

**For a public/private filter.** street, park and institutional are public land and private is private. other (coastal and water zones) and unknown are neither; unknown includes the unconfirmed open space. `schema.json` says the same.

### Counts per feature (all 4,207,543 features)

| Tenure | All features | Counted toward totals | Value of counted trees, NZ$/yr |
|---|---|---|---|
| private | 2,631,900 | 2,226,804 | 173,027,746 |
| park | 1,008,193 | 888,062 | 80,963,300 |
| street | 325,416 | 269,697 | 18,038,350 |
| institutional | 140,734 | 117,393 | 11,187,594 |
| other | 80,971 | 62,317 | 7,306,507 |
| unknown | 20,329 | 17,080 | 1,535,637 |

| tenure_basis | Features | Classes |
|---|---|---|
| zone | 2,679,743 | private 2,552,088; other 80,971; institutional 37,965; street 8,719 |
| park_extent | 748,687 | park |
| road_corridor | 282,355 | street |
| conservation_land | 236,018 | park |
| designation | 99,352 | institutional |
| parcel_title_unzoned | 59,058 | private |
| owner_register | 39,127 | street 29,538 (Auckland Transport); park 9,589 (Council parks) |
| golf_course | 20,754 | private |
| open_space_zone_unconfirmed | 13,849 | unknown |
| statutory_reserve | 9,006 | park |
| unparcelled_unzoned | 6,383 | unknown |
| island_road | 3,631 | street |
| open_space_zone_public | 3,059 | park |
| council_property | 2,744 | institutional |
| parcel_intent | 1,686 | park |
| verge_reserve | 995 | street |
| zone_school_name | 673 | institutional |
| register_boundary | 207 | park 148; street 59 |
| council_road_reserve | 119 | street |
| no_evidence | 92 | unknown |
| outside_plan_zones | 5 | unknown |

| display_role | private | park | street | other | institutional | unknown |
|---|---|---|---|---|---|---|
| current_crown | 2,060,225 | 855,775 | 244,414 | 61,812 | 114,209 | 16,416 |
| earlier_detection (not counted) | 405,096 | 120,131 | 55,719 | 18,654 | 23,341 | 3,249 |
| outside_v5_coverage | 164,996 | 13,620 | 4,563 | 378 | 2,917 | 631 |
| source_record | 1,583 | 18,667 | 20,720 | 127 | 267 | 33 |

Register trees by final tenure: all 29,538 Auckland Transport trees are street. Of the 10,952 Council parks trees, 9,737 are park (9,589 owner_register, 148 register_boundary) and 1,215 are street (1,079 on unparcelled road, 77 in verge strips, 59 by register_boundary).

Other facts:
- 374,350 features (8.9%) fall outside every LINZ parcel, because road corridors are gaps between parcels. By basis: road_corridor 282,355; zone 52,016 (mostly coastal and water); owner_register 19,281; park_extent 9,696; unparcelled_unzoned 6,383; island_road 3,631; open_space_zone_unconfirmed 675; conservation_land 209; council_property 75; designation 15; golf_course 7; outside_plan_zones 5; council_road_reserve 2.
- A Unitary Plan zone was found for 4,206,397 features.
- `parcel_id` is the point-in-polygon parcel. When several parcels contain a point, the smallest wins (unit and strata overlaps). `in_property` is false for the 384,939 features not counted in that parcel's figures (no parcel, or a register tree kept off a parcel of another class).

### Parcel tenure (600,194 parcels)

| Class | Parcels | Bases |
|---|---|---|
| private | 534,314 | zone 525,591; parcel_title_unzoned 8,499; golf_course 224 |
| unknown | 37,876 | outside_plan_zones 37,117 (the LINZ extract runs into Kaipara and Waikato); open_space_zone_unconfirmed 734; no_evidence 25 |
| park | 19,069 | park_extent 15,606; conservation_land 1,672; statutory_reserve 758; parcel_intent 561; open_space_zone_public 472 |
| institutional | 4,621 | designation 2,383; zone 1,353; council_property 685; zone_school_name 145; parcel_intent 55 |
| street | 3,429 | zone 2,362; verge_reserve 1,002; council_road_reserve 65 |
| other | 885 | zone |

By parcel_intent class: title 594,351 (Fee Simple Title, DCDB, Māori, Strata, Lease); reserve 2,741; railway 316; other 2,786. Statutory actions mark 8,920 parcels as open-space reserves and 15,553 as public in some way. 507 of the 758 statutory_reserve parcels have no plan zone: islets, coastal margins and reserves just over the district boundary. None of them holds a tree.

## Parcel assignment and canopy

- Each map point is placed in a LINZ parcel by point-in-polygon: 3,833,193 of 4,207,543 features.
- Canopy is measured by streaming all 3,522,567 crowns from crowns.geojsonl: 3,352,851 current_crown, 169,626 outside_v5_coverage and 90 source_record. Each crown is reprojected to EPSG:2193 and intersected with every parcel it touches. A property therefore gets canopy from its neighbours' and the street's overhanging crowns (`canopy_overhang_m2`) as well as from its own trees (`canopy_own_m2`).
- Counted crown area is 220.7 km², of which 205.0 km² (92.9%) lies over parcels and the rest over roads and foreshore.
- Overlapping crowns are not dissolved, so where two crowns overlap a parcel the overlap counts twice. Measured within export batches, overlap is 0.40 km², or 0.18% of crown area. Cover is capped at 100%, which affected 2 parcels.
- Canopy is map crowns only. Hedges and the near-canopy layer are excluded, so cover is a floor for woody canopy.

## Address index (`data/address_index/`)

From 700,702 OSM rows, 689,649 addresses were indexed. The others were dropped for one of three reasons:
- duplicates on (street, number, unit, suburb), with nodes kept ahead of ways;
- no housenumber or street;
- more than 15 m from any parcel.

The indexed count is 48 lower than in the first build: once the text was decoded correctly, some garbled and clean spellings of the same address became duplicates. 1,716 addresses on the road were snapped to the nearest parcel within 15 m. Each row is `[number, unit, street, street_norm, suburb, postcode, lon, lat, pid]`. Shards are keyed by the first two alphanumeric characters of `street_norm`.

**Encoding.** Text is stored as UTF-8 with macrons intact ("Ōnehunga Mall", "Māngere East", "Te Atatū South"). The fetch and the build both refuse text containing C1 controls or the Ã/Ä/Å-plus-continuation pattern, and the spot checks scan every shard (0 rows).

Normalisation is documented in `meta.json`:
- NFKD with macrons stripped, lower case, apostrophes removed, so "Ōnehunga Mall" becomes `onehunga mall` in shard `on`;
- a final street type is spelled out (ave/av, st, rd, dr, cres/cr/crs, pl, tce/terr, hwy, ln, ct/crt, cl, gr/gro, pde, esp, sq, blvd, hts, wy, cir);
- a leading St/Mt/Pt becomes saint/mount/point;
- "2/15A" becomes unit 2, number 15A, and Unit, Flat and Apt prefixes are dropped.

OSM itself mixes "Onehunga Mall" and "Ōnehunga Mall" (and "Mangere" and "Māngere" suburbs), so a search should show the street as stored and match on `street_norm`.

**Coverage:** 421,069 of 457,924 residential-zone parcels (92.0%) have at least one address. Most of the rest are accessways, common property and rear lots that carry no address of their own. 125,312 rows have a unit. Only 12.8% of rows carry a postcode, because OSM's LINZ import has none, so search should not depend on postcode.

## Caveats

- **Tenure is inferred, not owned.** The class says what kind of land a tree most likely stands on. Council housing reads as private. Private schools on Special Purpose land read as institutional. Crown or Council land under a residential zone reads as private unless a ministerial designation, a Council property extent or a reserve record covers it.
- **Open space.** An Open Space zone needs an ownership signal to count as park. 734 parcels (584 ha, 11,780 trees) have none and are unknown. They are Fee Simple, DCDB and Legalisation parcels zoned Informal Recreation (267), Conservation (240), Sport and Active Recreation (189), Community (23) or Green Infrastructure Corridor (15); the largest are bush blocks in the Waitākere foothills around Titirangi. They could be private, utility, Crown or iwi land, and the open data cannot tell which.
- **Golf courses.** Golf courses come from OSM outlines, so a course missing from OSM keeps its zone rule. A course outside the Council park extents is private even when the land is a reserve. 7 golf parcels carry a live statutory reserve or road vesting and may be Crown or Council land leased to a club.
- **Designations** are taken at half the parcel's area. A partly designated parcel keeps its zone class, and a designation over private land the authority has yet to acquire would read as institutional.
- **Boundary trees.** A LiDAR point is the crown top. A leaning or boundary tree can sit over the neighbour's section, so it may be listed on the wrong side. The register-boundary handling applies only to register trees.
- **Subdivided and shared sites.** Cross-lease and unit-title flats share one parcel, so every address on it shows the same trees. Fee-simple subdivisions such as 110 Bayswater Avenue are separate parcels, so each household sees only its own lot.
- **Values are indicative.** They are the release's modelled per-tree estimates summed per parcel, not a valuation of the property. They include uncertain-tier trees exactly as the release totals do. `n_confident` and `total_value_confident_nzd_y` give the conservative view.
- **Unregistered verges.** Berm trees outside a parcel are street by road_corridor. Grass verges that are part of a titled parcel stay with that parcel's class.
- **Unknown tenure covers 20,329 features (0.5%; 17,080 counted trees, $1.54M/yr).**
  - 13,849 features are on Open Space zones with no ownership signal (see above).
  - 6,383 are outside every parcel in the Hauraki Gulf Islands zone and more than 10 m from any road: 4,525 on the Rangitoto and Motutapu shoreline outside the reserve parcels, and 1,858 on Waiheke foreshore and streams.
  - 92 lie on 25 Hauraki Gulf Islands parcels (8 ha) with no usable record: Legalisation 20, Erosion 3, Crown vesting 2. The large Rangitoto and Motutapu parcels the first report described here as probable legalised roads are in fact reserves and are now park.
  - 5 are beyond the plan maps.
- **Missing species names.** Many register records have no species_common in the v5 export, so species is empty in their rows. The Guiniven palms are an example.