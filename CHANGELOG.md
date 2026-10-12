# Changelog

Two sections: the **Tool** (the interface, semantic versions) and the **Data** (release names). See
[VERSIONING.md](VERSIONING.md).

## Tool

### 0.2.1 (12 October 2026)

- "Change since 2013" is marked experimental; points on buildings, ports, water, industrial yards and construction sites, and points the aerial photos do not confirm, are screened out (blind photo check: about three in four shown changes confirmed).
- Legend rows grow with wrapped text in every browser.
- The change layer draws only the changes its legend names.

### 0.2.0 (12 October 2026, released with data v6)

Tested with data v6 (development build) and v5.2.

Added
- **Left panel (concept A, chosen 12 Oct 2026)**: search, the three live numbers, chips for every
  active filter and layer, Colour by, and Filters, Layers and Area as drawers; a bottom sheet on
  phones (peek, half, full).
- **One search box** for addresses, tree IDs, species, local boards and map commands ("protected
  trees", "colour by height", "show parcels", "taller than 25 m", "pōhutukawa in Kaipātiki"), with
  suggestions, two presets, macron-insensitive matching with one typo allowed, an ARIA combobox, and
  / or Ctrl/Cmd+K to reach it (`web/command-search.js`, from concept C).
- **Legend docked under the left panel** (in the bottom sheet on phones): the colour mode, the marks
  that mean the same in every mode, and each colour-coded layer that is on, with counts for the trees
  in view. Its rows for source, link status, land type and growth form show or hide that category.
- **ALTO design system v1.0**: `web/tokens.css`, Inter 4.1 self-hosted as "ALTO Inter" (Latin subsets of
  the variable fonts, about 100 KB each; `web/fonts.css`, `web/fonts/`, preloaded by every page), opaque floating panels, one focus ring, map controls laid out so
  nothing overlaps (zoom and basemap top right, attribution clear of the legend, tile loading in the
  panel), the glossary's names, Estimate badges and the system's rounding in Area, the release named by
  its date in the footer.
- **Colour-blind safe map colours** (`web/palette.js`): every colour mode and colour-coded layer uses
  the design system's checked palettes, never red against green; categories that share a colour differ
  by mark (ring, hollow, dashed ring, dashed crown outline, triangle, diamond, parcel edge).
  `pipeline/tool/test_cvd_palettes.cjs` simulates protanopia, deuteranopia and tritanopia (Machado
  2009) and fails below CIEDE2000 9 between any two same-mark categories shown together.
- **Tree panel and tree page: the instrument dashboard (concept B, chosen 12 Oct 2026)**, with
  concept A's protection line (the Notable Trees schedule with its legal basis, Auckland Unitary Plan,
  Schedule 10, or "Not protected" with what was checked), records link, root-space rows, numbered
  notes and A4 print layout, and concept C's numbered links into the page (a sticky strip of chips on
  phones), the root protection radius beside the size values, and plain sentences for survey change
  and protection. Every value shows its kind and range and opens its provenance; one survey-year
  control highlights 2013, 2016 or 2024 in every figure, the values and the map; comparisons come
  from the release's tables only. The panel floats as the design system specifies.
  (`web/tree-instrument.js`, `tree-instrument.css`, `tree-instrument-page.css`, `tree-panel.js`,
  `tree-page.js`; `pipeline/tool/test_tree_instrument.cjs`.)
- **Tree record fixes** found by the tree-page evaluation: protection said for every tree; the trunk
  diameter is the central estimate of the release's two models with their range (never the lowest),
  and the root protection radius (12 × trunk diameter, area capped at 707 m²) follows it with its
  range, also for LiDAR-detected trees; no zero-width ranges; records counted with the sources of the
  records only; KYTE task links carry the release; the corrections receipt is read through
  `derived_products.corrections_applied` in the v6 corrections stage's format.

Removed
- The per-tree 3D returns viewer and its point-crop requests from the tree page (a workbench tool);
  the beta build leaves point crops out unless `--with-points`.
- From concept B: the 3D view, and the comparison within 200 m and the "equal crown area" plot that
  were computed in the browser from map tiles (their n changed between loads).

- **Tree page** (`tree.html?id=<tree id>`), laid out as a record: identity and a key-measurements
  table (value, source, date, method); how the tree was mapped (aerial image with the crown
  outline, other crowns and recorded positions; the LiDAR return profile by 1 m band; the 3D return
  envelope; LiDAR measurements; how the outline was drawn; recorded species and the v6 growth-form
  probabilities); records and identifiers with public source links; measurements by source; canopy
  by survey (2013, 2016, 2024) with the height scenario; benefits with method and assumptions; life
  stage, replacement time and root scenarios; "Know this tree?" tasks routed to KYTE; accepted KYTE
  photos; local board, land type and property parcel; nearby trees; citation; data and tool
  versions; every stored field. A per-tree JSON download is built in, off behind a flag
  (`ALTO_ENABLE_DOWNLOADS`) until the data-download policy is decided.
- **Tree record** (`web/tree-record.js`, schema `alto.tree-record/1`, `docs/tool/tree-record.md`): one
  plain object per tree for any presentation. Every number is a quantity with its kind (measured,
  recorded, model, derived, rule) and provenance (source, date, method, model and validation status,
  uncertainty, release). Network parts report their status and are used only for the release they
  were built for.
- **Tree page v2**: numbered provenance notes on every sourced number; **Among similar trees** (street,
  local board and Auckland percentiles of height, crown area and estimated benefits within the tree
  class, with the comparison set and n, from `pipeline/tool/build_tree_context.py`); **History and
  corrections** (crown, link, repair and outline per release; map-marker and ID changes per release
  from `pipeline/tool/build_tree_history.py`; reviews from the record and the release's corrections
  receipt); the crown's own 2024 LiDAR returns in 3D where a release publishes point crops
  (`pipeline/tool/build_tree_points.py`, alto-points/1); setting (flood and stormwater layers, heat
  grid, impervious cover, the earlier crown's neighbourhood); height change between surveys; dated
  aerial captures from World Imagery Wayback, off on the public site until its CSP and terms allow it
  (`web/wayback.js`); one spacing and type scale. The beta build carries per-release derived folders
  (`build_web_beta.py --derived`).
- **Tree panel** as a data sheet: the identity header, then size (aerial image of the crown with its
  outline and recorded position, LiDAR return profile, height, crown area, modelled trunk with its
  range), life stage with its definition, canopy by survey, benefits, replacement time (2026 to the
  year a new tree reaches this crown area, with 25–100% marks) and irreplaceability defined, and every
  record and identifier. A bottom sheet on phones.
- **Area** tab (replaces "In view"): Auckland, the local board under the map, the current view or a
  selected property, aggregated live from the drawn trees; the tallest tree, largest crown and highest
  single benefit fly to the tree; a click on a source, life stage, height, growth form, species or
  data-quality entry rings those trees on the map; "Select a property" turns parcels on and picks one.
- **Tree-ID resolver** (`tree-id.js`), ready for permanent IDs and an alias table; tree IDs can be
  typed into the search box. `?property=<LINZ parcel id>` opens a property.
- Map legend that follows "Colour trees by"; "Land type of parcels" overlay; "Change since 2013" and
  "Data quality" colour modes; "Risk & constraints" layer group.
- `version.js`, `VERSIONING.md`, this changelog; Better Places Lab credit in the panel footer, About
  and the tree page header; `pipeline/tool/build_web_beta.py` for a build at `/beta/` that reads the
  live site's data.
- Offline checks: `pipeline/tool/test_tool_v02_ui.cjs`.

Changed
- The "Tree sources" legend (one priority category per tree, mixing record origin, legal status and
  data quality) is split into **Sources** (a tree can have several; live counts for the view),
  **Status** (protected) and **Data quality** (crown linked, probable, drawn from the record,
  unlinked). "Council Parks" and "Transport" are named as the Council tree register's owner field.
- Markers: fill shows the source; a magenta ring marks a protected tree; a record with no crown
  linked is hollow.
- Layers regrouped as Basemap, Tree display, Context overlays, Risk & constraints and Vegetation &
  detections.
- Graphics are drawn only from each tree's data; copy follows a data-sheet style.
- About shows "Data … · Tool …", the lockup and a citation; the tool version no longer comes from
  the data release's metadata.
- The 3D view, forecast and tree-architecture modules load only on the tree page, on request.

Removed
- The long research profile in the map panel (its content is on the tree page).
- The "Open field notebook" link (`/field/` never existed on the site).
- The Council tree register record link: the register's ArcGIS service now requires a token.

### 0.1.0 (1 October 2026)

The interface published with data v5 and kept through v5.1 and v5.2: map with tree profiles,
evidence summary, full research record, 3D tree forms, ground evidence from KYTE, property search and
panel, land filter, Council recorded positions layer (v5.2).

## Data

### v6 (12 October 2026, `20261012-v6`)

Model growth form for 3,352,099 crowns (A2 + C1 palm detector, A2_robust on leaf-on flights): 2,771,551
shown, 580,548 not yet determined. Display rules r15 with the v6 decisions and the pre-publication audit:
"possibly conifer" on the isthmus and "possibly palm-type" outside it withheld, deciduous calls outside the
isthmus read "Broadleaf (model)", palm detections read "palm or cabbage tree". Smoothed crown outlines
with area preserved; service estimates reweighted by the growth-form probabilities where a call is shown
(2,918,424 rows; release totals +NZ$3.19 million a year, −114,500 t CO₂e stored, −483,700 m³ a year of
avoided runoff). Recorded species stay the species shown. Every v5.2 record, link and position is kept;
one reviewed correction moved a notable-tree record onto its crown (3,574,824 trees on the map). Tool:
0.1.0 with the v6 patch, or 0.2.0 and later. Method: `docs/v6/growth-form.md` in the repository.

### v5.2 (10 October 2026)

Record-to-crown links: 3,088 records left unlinked by v5.1 joined to a crown (1,043 linked,
1,456 probable, 589 on 534 crowns drawn from the 2024 returns). Council recorded positions layer.

### v5.1 (8 October 2026)

Crown continuity repair: 4,661 record-to-crown associations restored across 4,362 crowns.
"Crown unlinked" replaces "No crown".

### v5 (23 September 2026)

Crowns redrawn from the 2024 point cloud with aerial NDVI; polygon-containment identity; crown-based
services; per-tree detail buckets; near-canopy layer; property totals and land tenure (2 October).

### v4 (18 September 2026)

Point-cloud tree detection, record linking, evidence tiers, restored island trees.
