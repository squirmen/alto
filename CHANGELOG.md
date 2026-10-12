# Changelog

Two sections: the **Tool** (the interface, semantic versions) and the **Data** (release names). See
[VERSIONING.md](VERSIONING.md).

## Tool

### 0.2.4 (13 October 2026)

Changed
- **Release 6 methods page:** the labels made from imagery (training, the 600-crown blind test and the pre-release
  audit) are described as made by a machine-learning image-interpretation model, in one pass, with no independent
  second labeller yet.

### 0.2.3 (13 October 2026)

Tested with data v6.1 (`metro-2026.10.13-pointcloud-v6.1`, local preview) and v6 (`metro-2026.10.12-pointcloud-v6`).

Added
- **Tree numbers** (data v6.1): the tree page and the map panel show the tree number as the tree's ID
  ("Tree number", the value, Copy and the permalink `https://alto.tfwelch.com/tree/<number>`), with the
  `akl_tree_*` record ID second as "Record ID". The citation, Share, the print header, the provenance popover and
  the page's canonical link use the number and the permalink. With data before v6.1 (no `tn` in the tiles, no
  `tree_number` in the records) the record ID stays the tree ID, as in 0.2.2.
- **Lookups by number**: the map's search takes tree numbers (any case, spaces or a hyphen) and release 4 crown
  keys as well as record IDs and crown keys. A number that fails its check character offers "Check character
  doesn’t match; did you mean …?" when exactly one number one keystroke away (one character changed or two
  neighbours swapped) is in the release's alias table, and "Not a valid tree number" otherwise; 8-letter words
  such as Takapuna stay with the place and species search. An older ID opens its tree with one line in the panel
  or on the tree page: "Record ID akl_tree_… is tree T…".
- **Pages for IDs that name no current tree**: a retired, merged or split ID opens a page whose title states the
  status and the reason ("Retired: no tree at this LiDAR detection", "Merged: reviewer correction C00004",
  "Split: release 4 crown divided between 2 current crowns"), with the reason in full (and the correction from
  the corrections receipt), a tombstone's last position, release and source ID, and the trees that took its place
  as links, each named from its record. A mistyped number in the address gets the search's correction. On the map
  the same IDs open the surviving tree, the largest part or the successor with that one line; a tombstone opens
  the map at its last position with the reason.
- **Release 6.1 methods page** (`web/v61-methods.html`) on the methods template: what changed, tree numbers and
  their carry-over rules, the format and check character, how older IDs resolve, the corrections applied and the
  limits. Linked from the 6, 5.2, 5.1 and 5 pages; the public build ships it.
- `web/tree-id.js`: `nearNumbers`, `suggestNumber`, `searchEntry`, `describe`, `label`, `MESSAGES` and
  `isNumberShaped`; `resolve()` also returns the alias row's `reason`, `last_release` and `source_id`.
  `pipeline/tool/test_tree_numbers_ui.cjs` checks display, fallback, search, the check character and status pages.

Changed
- **Change since 2013 is v1**: 82,863 changes from crowns matched across the 2013, 2016 and 2024 LiDAR surveys, read
  from a new file, `data/tree_change_v1.pmtiles` (revision `v1-20261013`; the screened `tree_change.pmtiles` stays
  on the host for rollback). A blind photo check found 92% (88–95%) of shown changes real, against 74% for the
  previous screened layer. Partial losses are not shown. The "(experimental)" label is removed from the legend and
  the Colour by menu. A removal's popup says what the 2024 survey shows: open ground, or no tree canopy and built
  over (10,051 removals: a house, extension or carport).
- Selecting a tree on the map puts its number in the address (`?tree=T…`, replaced in place); closing the panel or
  opening a property takes it off. Without numbers the address is left as before.
- KYTE links (Add a photo, Know this tree?) keep the `akl_tree_*` record ID: KYTE does not take numbers yet.
- With numbers, the records table links a record to a tree page only when the record carries another tree's
  number; nearby trees and the page's mini map open trees by number.

### 0.2.2 (13 October 2026)

Tested with data v6 (`metro-2026.10.12-pointcloud-v6`) and v5.2.

Added
- **Aerial imagery through time** on the tree page (section 3): the crown in each aerial survey of
  Auckland since 2010 that covers the tree (2010, 2010–11, 2010–12, 2012, 2015–16, 2017, 2020, 2022,
  2023, 2024, 2024–25), oldest first, with each survey's flying period and pixel size and the 2024
  crown outline drawn on every photograph. Read keylessly in the browser from LINZ's open imagery
  archive (cloud-optimised GeoTIFFs, WebP tiles): one Range request for a file's header and one per
  row of internal tiles under the window, at the overview that gives about 160–320 pixels across it,
  four surveys at a time, only when the section comes near the screen, cached for the visit. A survey
  without a file or pixels at the tree is listed as not covering it. Attribution: the licensors LINZ
  lists for each survey shown, CC BY 4.0. Needs `https://nz-imagery.s3.ap-southeast-2.amazonaws.com`
  in the site's CSP `connect-src` (`web/tree-imagery.js`, `pipeline/tool/test_tree_imagery.cjs`).
- **Release 6 methods page** (`web/v6-methods.html`) on the methods template: growth form, the
  12 October audit and its rule changes, smoothed outlines, benefit estimates, trunk diameter at 1.3 m,
  the corrections ledger and limits, with three figures in the design system's colour-blind safe
  colours. Linked from the 5.2, 5.1 and 5 pages; the public build ships it in place of the copy in
  the v6 data bundle. The trunk-diameter method links to it for release 6 trees.

Changed
- The tree page's section bar shows the section links that fit whole and puts the rest in a More menu
  (it showed a clipped "If it were lost" at 1440 px); phones keep the scrolling strip.
- Street comparisons need at least 10 trees of the class on the street; smaller street groups are
  left out with the rule stated ("Tallest of 2" said nothing).
- A field observation and the review decision that cites it as evidence are listed once (matched by
  the observation's ID; `akl_tree_not_336` listed its plaque observation twice).
- Copy: no "v5 crown", "laser survey" or "(model)" in tree-page values, sources and notes; methods
  copy describes the labels behind the growth-form model and its audit neutrally (one labeller, one
  pass, no second labeller yet).
- Builds stamp every page's local scripts and styles with the build's version (0.2.1 pages still
  requested `?v=tool-0.2.0` files).

Removed
- The Esri World Imagery Wayback reader (`web/wayback.js`), never switched on.

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

### v6.1 (13 October 2026, `20261013-v6.1`)

Permanent tree numbers for all 4,200,336 map trees (`tn` in the map features, `tree_number` in the full
records) and an alias table of 19,376,165 keys (`data/tree_ids`) that resolves every record ID, release 4 and 5
crown key and tree number, with tombstones for the 7,405 LiDAR detections removed before the 9 September
release. Corrections ledger applied in full (14 applied, 17 recorded, 318 already true, 5 awaiting review):
3,574,821 trees on the map and 3,523,021 crowns counted, 3 fewer of each than v6. Otherwise v6's crowns,
measurements and estimates. Tool: 0.2.3 and later show the numbers (live with 0.2.4); earlier tools keep
working on record IDs. Method: `docs/v61/tree-numbers.md` in the repository.

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
