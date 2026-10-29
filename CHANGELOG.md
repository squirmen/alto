# Changelog

Two sections: the **Tool** (the interface, semantic versions) and the **Data** (release names). See
[Versioning](VERSIONING.md).

## Tool

### 0.2.17.1 (29 October 2026)

- Tree permalinks now use alto.org.nz (`https://alto.org.nz/tree/<number>`) wherever a tree's link is shown, copied,
  shared, printed or cited. Links to alto.tfwelch.com still reach the same tree.

Tests: the permalink and the tree-number vectors shared with KYTE.

### 0.2.17 (27 October 2026)

- Field measurements: a tree measured on the ground shows the reading beside ALTO's estimate. On the tree page they sit
  under Key measurements ("Field measurements"), and in the map's tree panel among the key measurements. Each reading
  gives:
  - the value, the method and the height it was read at (each reading names its own height);
  - the dates, and who measured;
  - how many measurements, teams and classes, and the spread across teams;
  - the review.
  ALTO's own trunk estimate follows, with its method and model spread.
- The trunk diameter of a measured tree is the newest reading, unless a reviewed KYTE tape reading of a single trunk
  exists; the root protection radius follows it. The measurements are published apart from data and tool releases, in
  `field/measurements_v1.json` at the site root. A tree without one, or a site without the file, is unchanged.
- The saved-trees comparison gives a measured tree's reading, its height and dates, then ALTO's estimate.
- Root space follows a measured trunk (a reviewed KYTE tape reading, or a field measurement), as the root protection
  radius line already did; before, it kept the model radius.

Tests: the field file missing, unreachable or of another version; entries left out (no value, height or measurer);
trees with none, one and two readings; the precedence of a KYTE reading; the number formats.

### 0.2.16 (26 October 2026)

- On a phone the map is usable with a panel open. Minimised, the tree or property panel is a slim bar (about 60 px:
  the handle, the tree's name and number or the address, and a close button) instead of half the screen; the map
  panel shows only its handle and the search box. Tapping the bar expands it; the handle (with a chevron) minimises it
  again; dragging moves between sizes, and dragging the bar down closes it. Zoom, scale and attribution sit above
  whichever panel is showing. Desktop is unchanged.
- The handles carry aria-expanded; hidden content takes no focus; reduced motion is respected.

Tests: the phone sheets (heights, states, controls above the bar) and the version labels.

### 0.2.15 (20 October 2026)

- Trunk measuring height follows the New Zealand convention, as the New Zealand Tree Register does: 1.4 m above the
  ground (on a slope, from mid-slope), where ALTO and KYTE said 1.3 m above the uphill ground. The labels read "Trunk
  diameter at 1.4 m" and "Largest stem at 1.4 m"; the map's size markers, the tree page's girth note, the Species maxima
  girth line, How ALTO is made and the release 6.3 methods page say the same. ALTO's trunk diameters are estimates from
  the crown, so no number changed. Methods pages of releases before 6.3 keep their wording.
- A KYTE tape reading's method line names the height its visit stored (KYTE asked for 1.3 m before v22).

Tests: the labels, the method line at a stored height and without one, and the 6.3 methods sentence.

### 0.2.14 (19 October 2026)

- iNaturalist records with no licence code (iNaturalist's "none") read "all rights reserved", not "(NONE)"; they were
  already shown as links only. `build_tree_inat.py` now writes them with no code.

### 0.2.13 (19 October 2026)

Two outside sources on the tree page, each linked and credited, neither copied; one credit corrected.

iNaturalist records at this tree (Ground visits and contributions)
- Research-grade iNaturalist records of woody plants whose public location is inside the crown or within 5–15 m of
  it (set by each record's stated accuracy), from the matching run of 17 Oct 2026 (26,426 records on 16,242 crowns and markers;
  release 6.2's crowns, unchanged in 6.3). Newest ten per tree, the total, and a link to iNaturalist's map near the tree.
- Each record's licence decides what shows: species, month, phenology and the observer's credit ("© login, some rights
  reserved (CC BY)") for CC BY, CC BY-SA and CC BY-ND records; the same without a name for CC0; for CC BY-NC (any
  variant) and all-rights-reserved records, only a link with the licence and where it sits. No photographs, notes,
  identifications or per-observer views. A record never changes the species ALTO shows.
- Derived product `tree_inat` (`pipeline/tool/build_tree_inat.py`), 256 shards by tree number.

Street level (Aerial imagery through time)
- "See this tree on Mapillary" for 166,564 of the 321,011 map markers on streets: the newest photograph taken 6–25 m away facing the
  tree (within 25°), else the newest 360° photograph within 20 m, chosen from Mapillary's public coverage tiles on
  19 Oct 2026; a newer 360° photograph is offered beside an older facing one. The date and distance are shown. Images
  are Mapillary contributors' (CC BY-SA 4.0), linked and never shown or stored. Derived product `tree_streetview`.

Credits
- Street-level imagery (Mapillary) and iNaturalist observations added. PlantNET is credited to the Royal Botanic
  Gardens and Domain Trust, Sydney, as its own citation reads.

Caching
- The derived folder travels inside the tool build, and the site keeps `/derived/<release>/` for a year at one address.
  Its files are now asked for with the data stamp and the tool version (`?v=<data>.t<tool>`), so a tool update that
  adds or refreshes a product is read at once; before, a browser that had read 0.2.12's manifest would not see them.

Tests: `pipeline/tool/test_observations_v0213.cjs` (licence rules, the link and its newer option, missing and
mismatched products, the tool version on derived requests).

### 0.2.12 (17 October 2026)

Tool support for data v6.3, live ahead of the data: the map, the tree page, Area, the property panel, Species maxima
and the methods pages read v6.3's new and renamed fields and still read v6.2's, so the same build serves v6.3 and,
after a rollback, v6.2. Each feature, parcel or record is read by the fields it carries (`web/release-fields.js`);
page-wide choices follow the release metadata. Offline tests on v6.2 records and the v6.3 preview's records; local
builds and screens on both.

Renamed fields
- Map features: `benefit_value_nzd_y` for `total_value_nzd_y`, `height_class` for `life_stage`, `crown_replacement`
  for `irreplaceability_class`; parcels: `benefit_value_nzd_y` (with `_low`, `_high`, `_confident`) and
  `n_height_not_plausible`; full records: the `benefits` and `size` datasets. A withheld v6.3 estimate stays empty and
  never falls back to a retired field. Release totals read `benefitValueNzdY`, else `totalValueNzdY`.

Height class and crown replacement time
- The height class and its share as v6.3 stores them; the share prints rounded down (84.8% reads 84%), in both
  releases, so it never reads as the next class. Crown replacement time in bands of the regrowth years (under 5,
  5–15, 15–40, 40–80, 80 years or more); 25 m or taller is its own fact. A crown that is not classed says why (under
  5 m; height not plausible) and is not compared among similar trees. "Veteran" stays for field records.

Benefits
- From v6.3 the benefit value is stormwater plus carbon on every surface. Air-quality and cooling dollars appear only
  in the full record, beside the release's note that they are not release-eligible. PM2.5 removal and the cooling
  index stay hidden while the metadata does not publish them (`benefits.pm25_cooling_approved` or
  `pm25_cooling_published` false, as in v6.3).

Flags
- Height checks (not plausible; to check) and record-and-crown checks (may be different trees; to check) on tree
  pages and the panel, in the data's words. Flagged crowns stay out of comparisons and of the largest, tallest and
  highest-benefit trees in view; flagged heights leave the mean height. Totals follow the data.

Group areas and Schedule 10
- "Inside a Notable Group of Trees area", with the Schedule 10 item and name and that whether the tree is one of the
  scheduled trees has not been established; never a protection claim. The 229 areas as a dashed Context overlay from
  v6.3, credited "Plans and Places, Auckland Council; CC BY 4.0" with links. Schedule 10 entries as the July 2026
  schedule lists them, with the multi-tree note; reviewer notes from the corrections ledger; corrections in tree
  numbers and plain names.

Licences and credits
- The ODbL licence on records derived from OpenStreetMap. Sources and credits shows Change since 2013 as released,
  says that Auckland Council determines protection, and lists, once v6.3 is live, published maximum tree heights
  (used by v6.3's checks) and the iNaturalist taxonomy (names only: the 11 accepted Latin names were checked against
  it). `pipeline/base/config/sources.json` synced with the v6.3 source catalogue.

Species maxima
- v6.3's maxima leave flagged crowns unranked; the tool also never badges a tree whose record v6.3 flags, whatever a
  maxima file lists. The list page reads the file's checks note, segmentation flag and the names a species' records
  carry; Recognition shows group areas and multi-tree Schedule 10 entries.
- Notable facts by tree number: the package carries v6.3's 1.4 MB notable_facts.json split by the first character
  after T of the tree number, and a tree page or map panel reads only its tree's part (a folder without the split is
  read whole).

Derived tables
- `build_tree_context.py` takes a release's own comparison population (`--population-table`, `--class-field`,
  `--benefit-table`, `--benefit-field`, `--count`, `--texts`, or `--population`), counts crown replacement bands and
  height classes per group, and stamps `built_on`; so does `build_tree_history.py`.

Species
- The Species filter reads v6.3's Latin-name list: each common name with its Latin names as sub-options (1,028 species
  keys), filtering on `sp`; v6.2's list of common names still works. Accepted Latin names where v6.3 renames a species,
  with the name as supplied kept; the kauri survey result from v6.3's survey dataset.

Pages
- `v63-methods.html`: what changed in v6.3, in every release list. Version 0.2.12 in `web/version.js`.

### 0.2.11 (17 October 2026)

Scanned historical surveys on tree pages, and LINZ Basemaps prepared for the beta site; offline tests and local builds
on data v6.2 (`metro-2026.10.13-pointcloud-v6.2`), with the same derived files as 0.2.10. No data file changes. Tool
support for data v6.3 comes in 0.2.12.

Aerial imagery through time
- The 85 scanned historical surveys of Auckland in LINZ's open imagery archive, 1939–2004, found through the archive's
  STAC catalogue (metadata only). A tree page lists those that cover the tree under "Historic surveys (scanned)",
  above the surveys since 2010: open on a desktop, closed on a phone. Each card gives the years, the flying dates,
  "Scanned black-and-white photograph" (or colour, for the ten colour surveys), the survey number and the pixel size,
  with the 2024 crown outline drawn as on the others. One sentence says that positions in the scanned surveys can be
  several metres out.
- Credit: each scanned survey's number, licensors and producers as LINZ lists them, under CC BY 4.0. Sources and
  credits lists all 85.
- Coverage from capture areas: `imagery-coverage.json` now holds every survey's capture area as well as its files, so
  a survey that does not cover the tree is listed as not covering it with no request to the archive (the surveys
  since 2010 too). The scanned surveys are read after the surveys since 2010, two at a time, and only while their
  group is open; a survey LINZ publishes at two pixel sizes is read once, at the finer size.
- The larger view: the year strip starts with the scanned surveys, after the word "Scanned", names the survey number
  where two share a year, and fades at the side that scrolls. Captions name the photograph and its survey.
- The map's change view keeps to the surveys since 2010.

LINZ Basemaps
- `basemap-config.js` sets the aerial basemap per channel: LINZ Basemaps for the beta site, Esri World Imagery (with
  the 0.2.7 credit) for the public site. LINZ answers no tile without a key, so both stay on Esri until LINZ issues
  the site's Developer access key (`docs/tool/linz-basemaps.md` gives the request). Sources and credits shows the
  LINZ Basemaps entry wherever a build uses it. The CSP template allows `https://basemaps.linz.govt.nz` in
  `connect-src` and `img-src`.

### 0.2.10 (17 October 2026)

Fixes from the re-verify of 0.2.9; offline tests and local builds on data v6.2 (`metro-2026.10.13-pointcloud-v6.2`),
with the same derived files as 0.2.9. No data file changes.

Species names
- One name per species on every surface. Records that give a Latin name as the common name ("Magnolia Grandiflora",
  and its Little Gem form) read Southern magnolia, and "Lebanon Cedar" reads cedar of Lebanon. A common name that
  names only the genus takes the species' name beside that species' Latin name, as Species maxima and Recognition name
  it: "Cherry" with Prunus serrulata is Japanese flowering cherry and "Lime" with Tilia × europaea is common lime;
  "Cherry" with Prunus sp. or Prunus serrula stays Cherry. The source's own text stays under "Species as supplied".
- A tree page names its species one way: the heading, tab title, map panel, Species row, recorded name, nearby trees,
  citation and saved-trees comparison give the name its Maximum line and Recognition use. All 103 Species maxima trees
  name their species as `maxima.html` does. The Latin line shows whenever it differs from the name shown.
- Area's recorded species use the same names and the records' Latin names ("Japanese flowering cherry 7",
  "Cherry 8"), and each entry rings only its own records on the map. Rata reads Rātā, and the search reads "1 tree in
  the release".

Heights of 55 m or more
- The map's mean height leaves out heights of 55 m or more, as Area does, so a view shows one mean; the line under it
  says how many it left out ("mean height leaves out 1 flagged height of 55 m or more"). Area lists the three tallest
  flagged heights and how many more.
- The saved-trees comparison gives a flagged height as the tree page does: "79.9 m · unusually tall for Auckland:
  possibly a power line, structure or noise; not used in rankings", with each estimate computed from it marked
  "flagged height" in the table and the CSV, and a note on what the flag means. A crown outside the 2024 crown survey
  reads "Earlier crown, outside the 2024 crown survey", as on its tree page.

Keyboard
- On a phone, Tab never rests below the tree panel's visible part: the panel scrolls at once while the keyboard moves
  focus, and a survey chip whose preview re-lays the panel is brought back into view.

### 0.2.9 (16 October 2026)

Fixes from a review of the map, the tree page, Species maxima and the methods pages; offline tests and local builds on
data v6.2 (`metro-2026.10.13-pointcloud-v6.2`), with the same derived files as 0.2.8. No data file changes: values
that need recomputing say so until a data release recomputes them.

Protection wording
- The schedule line on the tree page and in the map panel says what ALTO checked. A tree with no schedule match reads
  "Notable Trees schedule (Auckland Unitary Plan, Schedule 10, as published 4 Jun 2026): no entry matched to this
  tree." and "ALTO checks this schedule only. Other Unitary Plan tree rules (trees in roads E17, open space zones E16,
  overlays) are not checked; Auckland Council determines whether a tree is protected." Street trees name E17 first,
  park trees E16 first. No sentence says whether consent is required.
- A scheduled tree leads with "Scheduled notable tree · Schedule 10 item <n> (<name>)". A tree in a scheduled group's
  mapped area is "Part of" the group only when its recorded species matches the group's name; otherwise it is "Inside
  the mapped area of scheduled group item <n>", with its recorded species and "group coverage for Council to confirm".
  Schedule entries the release holds back are never shown. A record the release left unflagged while the schedule
  facts list the tree (about 25 trees) reads the schedule's wording too, so the line and Recognition agree.
- The legend, filter, chips and popups read "Notable Trees schedule"; Area and the release 6.1 and 6.2 methods pages
  count the 3,570 map markers linked to Schedule 10. The search words "protected trees" still select the filter.
- Root distances: "Dripline radius (2024 crown outline)", from the recorded position when it lies inside the outline,
  otherwise from the crown top. Scheduled trees add the Unitary Plan protected root zone (Chapter J), trunk to canopy
  edge. The BS 5837 root protection radius (UK standard; 12 × trunk estimate) follows for comparison, with its range.

Estimates and ranges
- Every value marked Estimate shows its range, the model spread ("Model spread (2 models) 28–31 cm") or "Range not
  computed in release 6.2": trunk diameter, the BS 5837 radius, carbon, regrowth and benefits. Irreplaceability carries
  the Estimate mark and names the rule that set its class (80+ years to regrow, or 25 m or taller).
- Benefits read "Benefits $<n>/yr · Estimate · Sensitivity scenario", the ±30% band set by the confidence tier (±60%
  for LiDAR-only crowns), each component marked with its status. Sources and credits and the methods pages name the
  method an ALTO benefit scenario: simplified equations adapted from published i-Tree Eco components, with ALTO's own
  unit values; not run in i-Tree Eco. Release totals are rounded ("about NZ$295 million a year").
- The heading names the tree as the release does: a recorded species in its display form, or the model call in the
  release's words ("Likely conifer (model)"), never the top model score. A withheld growth-form call reads "Growth form
  not yet determined" with its model scores folded; beside a recorded species, "Crown growth form (model)".
- One evidence row under the name, inside a phone's first screen: detection tier (2024 LiDAR), record link, species
  source and Council position.
- Height class: the release's life stage (height as a share of a class reference height) reads "Height class", marked
  Estimate, from Very small to Very large ("Large · 85% of the 22 m evergreen-broadleaf reference height"). "Veteran"
  is kept for field records; the stored field is unchanged.
- Heights of 55 m or more carry "unusually tall for Auckland: possibly a power line, structure or noise; not used in
  rankings" on the height and every value built on it; they are not compared and are listed apart from Tallest.
  Comparison strips end at the 99th percentile, or for a street (its table is stored in 5% steps) at the 95th, and
  name the top value apart as "highest value (unverified)".
- Regrowth: "Years for a new crown to reach this crown area at the planning rate (crown area only)", captioned "Years if
  planted in 2026", naming the class whose rate it used.
- Height by survey gives the height at the matched canopy point in each survey and the 2024 crown maximum as its own
  measure; a change within ±1 m reads "no detectable change", never "−0 m a year". Each survey-year chip names its
  measure under the year and height ("matched point", "crown maximum"), on two lines so it fits its share of the bar.
- A record with no 2024 crown says "No crown is linked to this record in the 2024 LiDAR survey, so ALTO has no
  measurements or estimates for it"; the canopy-model height at its point may be a structure and is not plotted.
- The 2040 height scenario states its own validation ("Geographic hindcast; transfer to release 5 not validated");
  "photo checked" is used for the change layer only.
- One wording per measure on every page: height (highest point of the 2024 LiDAR canopy height model within the
  crown), crown diameter (equal-area circle), crown spread (mean of the widest width and the width at right angles),
  "Trunk diameter at 1.3 m". A KYTE girth of a multi-stem tree reads "Largest stem at 1.3 m: <d> cm (<n> stems)" and is
  not used as the trunk diameter.
- The i-Tree species reference mature height is converted from feet ("(i-Tree value in feet, converted)"); the stored
  height-plausibility flag, computed on the unconverted value, says so until a data release recomputes it.
- Change since 2013 reads as canopy change in the central isthmus: "Canopy gone by 2024 (cause not known)" and "Grew
  into canopy since 2013" (or 2016), with the survey extent outlined and, in the legend note, the blind check against
  reference labels from machine-learning image-interpretation models.
- Ranking sentences name the measure and the set compared ("Among evergreen broadleaf crowns in Albert-Eden Local Board
  (n = 77,796): taller than 98%").
- Methods pages report release 6's audit as agreement with a machine-learning image-interpretation model's labels
  (0.899, 0.828–0.956, of decided audit crowns), and count map markers, LiDAR crowns and permanent tree numbers as such
  (4,200,336 tree numbers: 3,574,821 for the markers on the map and 625,515 for earlier LiDAR detections).

Species maxima
- The Maximum line names who was ranked ("Maximum · tallest of 83 Norfolk Island pines named in Council records with a
  checked 2024 crown (2024 LiDAR, ±2 m)") and links the list's scope note; crown spread reads "widest crown spread".
- `maxima.html` states its scope above the list: trees without a named species are not ranked, larger trees may stand
  elsewhere, and nothing is field-verified. A near-tie says how close it is in place of "1 of N".
- Crown areas of 360 m² or more read "at or near the 400 m² segmentation limit; the tree may be larger"; How these are
  measured and the release 5 methods say crowns are not merged beyond 400 m².
- The map's Species maxima filter is its own group in Filters; with it on, the headline counts the rings ("28 species
  maxima in Auckland (rings)") and links the ringed trees in the list.
- Height, crown spread and crown diameter use the tree page's definitions; ±2 m is captioned as the ranking margin
  beside the survey's ±0.2 m vertical accuracy. Species names are in their display form, te reo Māori names marked.

Location
- Tree pages and the map panel give the tree's location again: latitude and longitude (WGS84, 5 decimals) with Copy,
  which position that is (the 2024 LiDAR crown top, an earlier detection, or the source's recorded position with
  Council's verification), links to Google Maps, Street View and OpenStreetMap, and the nearest address and parcel.
  The citation carries the coordinates.
- A street typed without a house number is offered as a street ("Grattan Place, Freemans Bay · street · 14 addresses")
  and fits the map to its addresses; a chosen address keeps its pin until Escape. On the Light basemap, OpenStreetMap's
  streets show above zoom 16.5, so street names can be read.
- A tree opened from a link sits centred above the phone sheet.
- The map's address holds its view (zoom, centre, colour, filters, layers), with "Copy link to this view"; an untouched
  map keeps a bare address.
- A canopy change opens "Aerial photos of this spot" (the imagery viewer on the change, the surveys before and after
  it marked in words) and has "Link to this change".

Area tab
- Below zoom 16 the map and Area count "markers drawn (a sample at this zoom)" and total nothing over the sample
  ("Zoom in to 16 to total this view"). At zoom 16 and above the leaders read "Tallest in this view", "Largest crown in
  this view" and "Highest single benefit in this view".
- At Auckland and local-board scope, Area lists the area's Species maxima: the three largest clear leads per measure
  with their margins, the list for the area and a button that rings them on the map.
- Auckland's figures and About's come from the release metadata (3,574,821 map markers, 3,523,021 LiDAR crowns 3 m or
  taller, 3,570 markers linked to Schedule 10, benefits as a rounded sensitivity scenario); the totals built into
  earlier versions are gone. Rows read "Map markers" and "Crowns"; subtitles name the filters in use.
- Carbon, benefit and stormwater sums carry "Estimate · range not computed". Summed areas read in whole m² below a
  hectare ("1,964 m²", then "1.15 ha"); totals drop trailing zeros.
- Recorded species are listed in their display form; property rows read "tree very likely", "tree probable" and "tree
  possible".
- "Saved trees (n)" shows in the panel header, on the map dock and beside "Save to compare", each opening the
  comparison, which names each tree by its species and tree number and rounds and labels its values as the tree page
  does (benefits as a sensitivity scenario with its band).
- Every Area scope counts map markers ("Map markers" for a local board in the earlier map, a property and the
  composition charts); one marker reads "1 marker in view". Recorded species groups a species' spellings, and a record
  naming several species ("Rata,Rimu") is counted apart, never listed as one species.

Navigation and search
- One text menu on every page: Map · Species maxima · Methods · Sources and credits · KYTE. Methods opens an index of
  every release, newest first. How ALTO is made (`how-alto-is-made.html`) is one overview of the sources, the 2024
  LiDAR crowns, record links, estimates and their ranges, reviews and corrections, and releases.
- About's "What changed" opens the release list in the same tab; the changelog lists release 6.2 and dates release 6.1
  as published. The map, the tree page and Species maxima name the release one way ("Release 6.2 · 13 Oct 2026 · Tool
  0.2.9").
- Back closes the tree panel before it leaves the map.
- Search reads "Search address, local board, species or tree number"; with no match it says suburbs, parks and schools
  are not searchable yet and what to try. "Species maxima", "tallest" and "notable trees" open the rings, the height
  colours and the schedule filter.
- Tree links read a number as typed or copied (closing punctuation, %20, no-break spaces, dashes, any case); a number
  one keystroke from a real one offers it; an address that names no file gets ALTO's own 404 page (`404.html`).
- "Tree number" for T-numbers and "record ID" for source records, in every message; every link into KYTE sends the
  tree number.
- Tree-page sections 9 to 14 read in number order on a desktop.
- About has a Corrections line (email with the tree number); "Report a problem with this record" waits until KYTE reads
  that task. "Know this tree?" asks for what KYTE's forms ask for.
- Links say where they go: ↗ only on links that open a new tab; methods links open in the same tab; email links read
  "Email the Better Places Lab" with the address; the About button on the phone dock is labelled.
- Tab titles name the tree ("Pōhutukawa TZ69KK1G · ALTO"; "<number> on the map · ALTO" while a tree is open).
- One display form per species on every surface: te reo Māori names with macrons, marked as te reo; sentence case with
  proper nouns kept; Latin names in italics. Kauri survey result codes are shown as supplied, on their own line, with
  the Council layer's code definitions, and every kauri variant is one Kauri in the species filter. Spellings of one
  species that differ by more than case share its name ("London Plane Tree" is London plane, as in Species maxima).
- A tree link that names no tree shows its correction in the map panel, styled as the panel, with no "Open the map".

Accessibility
- "Broadleaf, leaf habit not determined" moves off the brick colour that stood beside evergreen broadleaf's green with
  the same mark; the Notable Trees schedule is drawn as a dot with the schedule ring, so it differs from Council Parks
  by mark. `test_cvd_palettes.cjs` fails on brick or red beside green or olive with the same mark.
- The tree page measures its sticky bars: keyboard focus and section links land below them, and on short windows the
  bars scroll with the page.
- The map canvas shows keyboard focus as a two-tone ring inside the canvas and is described by its keys ("Arrow keys
  move the map; plus and minus zoom; search finds a tree by number, address or species.").
- Popovers open after their trigger and close when focus leaves them; so does the tree page's More sections menu.
- Copy confirmations are announced ("Tree number <n> copied."); the inset map's description is on its figure.
- On touch screens, values, Method links and Species maxima's controls are 44 px targets; the permalink no longer
  overlaps Copy; selected years and basemaps carry a bar in the text colour as well as the fill.
- "/" moves to search only from the map or its panel; Ctrl or Cmd K from anywhere.
- Species maxima below 600 px: "Sort by" above the cards, the clipped header's sort buttons out of the tab order, and
  no sideways scroll at 320 px.
- On a phone, Tab onto a control below the map sheet (the release line, the ALTO pages menu) raises the sheet, at
  once from the keyboard, so focus never rests out of view.

Performance and robustness
- The site template (`web/htaccess.example`) answers plain HTTP with a 301 to the same https URL and sets a one-year
  Strict-Transport-Security header.
- A file that did not load says which and why ("Not loaded: <file> (<reason>).") with Retry, and is never reported as
  an absent tree or an unpublished table; failed reads are not cached.
- MapLibre GL JS 4.7.1 and PMTiles 3.0.7 are also served from this site (`vendor/`, the same files and SRI hashes as
  unpkg), used when unpkg.com cannot be reached; the tree page loads them when its map comes into view.
- The tree page shows the tree first: the release metadata and the record schemas are requested from the page's
  head, the hero draws from the tree's own record, and the crown's other records and Species maxima follow. The
  aerial-imagery, place and KYTE readers and Species maxima's script load once the hero is drawn (largest
  contentful paint about 5.4 s on the slow-phone profile, 6.2 s before).
- A shared map link opens its tree in about 10 s on the slow-phone profile (28 s in 0.2.8): the map's tile reads wait
  for the tree's record, and the status line says "Opening tree <n>…".
- Range reads of versioned PMTiles archives are kept in Cache Storage (at most about 50 MB, cleared when the release's
  tile version changes) for when the browser's HTTP cache no longer holds them; no service worker. Archives that are
  off by default are read when their layer is switched on.
- The wordmark is a 10 KB image (was a 434 KB logo) and the About lockup loads when About opens; `web/htaccess.example`
  gives versioned files, a release's derived files and the release metadata their cache times.
- Pages hold their layout while their data arrives (Species maxima, the map on a phone, the tree page).
- No inline script: the map's script is `map-app.js`, the tree page's early reads are `tree-prefetch.js` and the site
  settings are `site-config.js`, so the site's Content-Security-Policy can drop 'unsafe-inline' for scripts and allow
  only the two pinned unpkg paths.
- One set of number formats (`alto-format.js`): one value prints one way on every page; one tree's benefits, carbon
  and runoff to two significant figures, totals to three.
- A tap paints the tree panel's header at once and parses only that tree's record; nothing inside the tap forces a
  layout, and a newly tapped tree's panel opens at its top.
- Aerial photographs read only the files a survey holds at the tree (`imagery-coverage.json`, built from LINZ's
  archive), the neighbouring surveys when the page is idle, and a coarser overview on a phone only where that reads
  fewer tiles.

### 0.2.8 (13 October 2026)

Offline tests and a local preview on data v6.2 (`metro-2026.10.13-pointcloud-v6.2`). The species maxima and the
tree-page facts were computed on release 6.1 and ship as derived files for release 6.2: every tree number, height,
crown spread and crown area they name is unchanged in release 6.2 (103 trees), and all 3,488 tree numbers with facts
are current.

Added
- **Species maxima** (`maxima.html`): the largest measured tree of each species by height, crown spread and crown
  area, across Auckland or in a local board, from the 2024 LiDAR survey. Filters by species (common or Latin name)
  and area; every column sorts. Each row shows the tree's own 2024 crown outline (one scale for the page), the value
  with its margin and unit, and the tree number linked to its page and to the map. Rows where the next measured tree
  is within the margin say "within the margin of the next measured tree". A coverage note (species from Council
  records only, mostly the central isthmus, 5 local boards so far), "How these are measured" with the release 5
  methods, and the sources. Linked from About and from Sources and credits.
- **Maximum line** on the tree page, under the tree's name, and in the map panel (up to two lines, the full line in
  its tooltip): text in a 1 px ink outline, for clear leads only (108 maxima on 49 trees). One line per tree:
  Auckland-wide before local board, several measures joined with "and", each with its own margin, for example
  "Maximum · tallest (±2 m), widest crown (±1 m) and largest crown area (±23 m²) of any measured tītoki in Ōrākei
  (2024 LiDAR)".
- **Recognition** on the tree page, above the key measurements: Council's Notable Trees schedule entry (with its
  position status, the Council entry, the Schedule 10 PDF and the dataset credit), the Notable Group of Trees area
  it stands in, its New Zealand Tree Register entry (identifier and link only, credited to the New Zealand Notable
  Trees Trust), its species maxima, and one row saying why ALTO shows the tree. Entries that no longer match
  Council's current layer are left out, and Council's `DocumentURL` (one link that now ends in a 404) is not used.
- **Map filter "Species maxima"** in Filters › Sources: only the trees holding a maximum in the chosen area (Auckland
  or a local board), each ringed (a 2 px ink ring with a white halo; the legend reads "ring = species maximum");
  the map zooms to them. A ring opens its tree at any zoom. `?maxima=<area>` opens the map with the filter on.
- **KYTE girth missions**: "Measure its girth (KYTE)" (`/kyte/?tree=<number>&task=girth`) for the street and park
  maxima that qualify, behind `web/kyte-config.js` (`girthTask`, off until KYTE reads the task).
- `web/species-maxima.js`: one module for the badge, Recognition, the list, the map rings and the girth link, reading
  `species_maxima` and `notable_facts` from the release's derived folder. Kauri maxima are never shown. Sentences come
  from the files' own copy.
- `pipeline/tool/test_species_maxima.cjs`: badges for clear leads only, the combined line, kauri left out,
  Recognition links and credits, list filters and sorting, the rings, the girth flag and the page wiring.
- **Release 6.2 methods page** (`web/v62-methods.html`) on the methods template: what changed (reviewer
  confirmations, the palm threshold and its conservative scope, the change-layer description, the near-canopy fix),
  the palm check, the service estimates, what did not change and the limits. The map's and the tree page's methods
  link, built from the release label, returned 404 on data v6.2. Linked from the 6.1, 6, 5.2, 5.1 and 5 pages
  (release 6.1 names it as the next release); the public build ships it.

Changed
- Every build stamps `maxima.html` with the data base and cache stamp, like the map and the tree page.

### 0.2.7 (13 October 2026)

Offline tests only; for data v6.1 and v6.2.

Added
- **Sources and credits** (`credits.html`, on the methods template): every source of tree records, LiDAR, aerial
  imagery, basemaps, land data, models and software, with its licence and a link to the original, what ALTO changes,
  and how to ask for a correction. Linked from About and the map's attribution, the tree page's footer, every methods
  page's footer, the changelog and the versioning page; every build ships it.
- `credits.js`: one set of credits for the map, the panel and the tree page, in each provider's own words.
- Tree pages link each New Zealand Tree Register record a review names (for example AR/0177) to its page on the
  register, and credit the New Zealand Tree Register and the New Zealand Notable Trees Trust under the list.
- `basemap-config.js`: LINZ Basemaps aerial imagery in place of Esri World Imagery, off until LINZ issues a key for
  the site (`docs/tool/linz-basemaps.md`).

Changed
- **Map credits.** Esri layers: "Powered by Esri", with Esri linked, and each layer's current copyright text
  (World Imagery now names Vantor). OpenStreetMap: "© OpenStreetMap contributors" linked to its copyright page; the
  Streets tiles come from `tile.openstreetmap.org` (the CSP example allows that host). The tree, crown and parcel
  tiles credit the Auckland Council tree register (incl. Auckland Transport, retrieved June 2026), notable trees,
  kauri survey records (Bio Info Team, Environmental Services), OpenStreetMap (ODbL), LINZ ("Sourced from LINZ.
  CC BY 4.0"), the 2024 LiDAR's licensors (Regional Software Holdings Limited and Auckland Council) and DOC's Crown
  copyright. The near-canopy, low-canopy, change, root-shape, canopy-by-board (local boards: Stats NZ) and kauri
  overlays carry their own credits; the control ends with a link to Sources and credits.
- **Kauri survey records.** The overlay, its legend and its records name "Ruru ObsKauri Tiaki" (the Council's
  spelling), the Bio Info Team, Environmental Services, Auckland Council, and the caveat "Not a complete record;
  verify before relying on it". The layer and each record's status stay as published.
- **Source lines.** OpenStreetMap trees read "© OpenStreetMap contributors, ODbL"; Council tree register records
  "Retrieved June 2026"; notable trees name Plans and Places, Auckland Council (CC BY 4.0).
- About › Attribution is now About › Sources and credits. The property panel names each land dataset in its
  provider's words (LINZ parcels, Plans and Places, DOC's Crown copyright with its retrieval date, OpenStreetMap).
- **Tree page.** Records end with each dataset's credit and its own page (Notable Trees Overlay and Schedule 10,
  Notable Group of Trees Overlay, the kauri item page, OpenStreetMap's copyright page). Aerial figures on the panel
  and the tree page name Esri World Imagery and carry "Powered by Esri" and Esri's text. "Aerial imagery through
  time" adds LINZ's access statement and what ALTO changes. i-Tree is linked and its values are named as ALTO's
  estimates using i-Tree methods. Pl@ntNet is linked, with the acknowledgement its terms ask for. KYTE photographs
  are credited to KYTE contributors. Local boards are credited to Stats NZ. LiDAR, imagery, impervious-surface and
  Schedule 10 sources name their licensors and licences. Exported 3D models carry a copyright line.
- Release 6 methods page names DINOv2 (Meta; Apache License 2.0), LightGBM (Microsoft; MIT licence), DeepForest
  (Weecology; MIT licence) and torchvision (BSD 3-Clause), and cites the iNaturalist observations obtained through
  GBIF.org for the palm check.
- "Waipapa Taumata Rau | University of Auckland" on the tree page, the methods pages and About.
- Tests: `pipeline/tool/test_credits.cjs` checks every credit, the LINZ Basemaps switch and Sources and credits;
  the property and tree-record tests follow the new wording.

### 0.2.6 (13 October 2026)

Tested with data v6.1 (`metro-2026.10.13-pointcloud-v6.1`, local preview).

Added
- **Aerial imagery through time: a larger view.** Selecting a photograph (click, tap or Enter) opens its survey in
  a dialog, or a full-screen sheet on a phone. Every survey is shown in the same frame around the crown, so
  stepping through the years shows what changed: ← and → (Home and End), the buttons beside the year strip, the
  strip itself, or a swipe on a touch screen. Zoom with the wheel, a pinch, a double-click or double-tap, or + and
  −; drag (or Shift + arrow keys) to move. The zoom and position stay when the year changes. The frame widens to
  2, 4 or 8 times the crown's to show the trees around it. The 2024 outline, or the ring at the recorded position,
  can be hidden (O). The scale bar follows the zoom. Each view's caption gives the year, the flying period, the
  survey, its pixel size (and the size shown, when coarser), the frame width and the LINZ CC BY 4.0 attribution
  naming the licensors.
- Reading for the larger view: the internal tiles under the visible part of the view, at the overview that matches
  the screen's pixels, down to the survey's own pixel size (7.5 cm for most surveys, 6 cm for central Auckland
  2023); at most 40 tiles per survey per view and 4 requests at a time. The previous and next surveys are read for
  the same view after the open one; requests for tiles that left the view are cancelled. Decoded tiles are kept
  for the visit (up to 100, 60 on a phone).
- Accessibility: Esc closes; focus stays in the dialog and returns to the photograph that opened it; the image, the
  icon buttons and the year buttons are labelled; a change of year is announced.
- `web/tree-imagery-viewer.js`. `tree-imagery.js` adds `tileNamesIn` (every file under a frame wider than one file),
  cancellable Range reads and a handle the viewer reads the surveys from. `pipeline/tool/test_tree_imagery_viewer.cjs`
  checks the frame, the zoom maths, the scale bar, the order of the years, the tiles read for a view and the request
  queue.

Changed
- The section's photographs are buttons, with a corner mark, and its text says how to open the larger view. The
  section still reads its photographs only when it comes into view; the rest of the page is unchanged.

### 0.2.5 (13 October 2026)

Fixed
- **Release 6 methods page:** the training labels are counted correctly: 19,329 Council tree register records
  (97% on the central isthmus) and 2,659 crowns outside the isthmus labelled from imagery (the page said 1,600,
  which was one of the four outside label sets).

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
  Schedule 10, or, where no entry matched, a negative label with what was checked; 0.2.9 withdrew that
  label), records link, root-space rows, numbered
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

### v6.3 (17 October 2026, `20261017-v6.3`)

The benefit value is stormwater plus carbon (about NZ$76.7 million a year, down from about NZ$295 million, which
also counted air quality and cooling); PM2.5 removal and the cooling index are kept in the full record and not
published. Heights and record-to-crown links are checked (80 map markers with a height that is not plausible, their
estimates withheld, and 2,692 to check; 253 records that may be on a different tree and 5,556 to check); height class and crown replacement time
replace the life-stage label and the irreplaceability class; crowns inside the 229 Notable Group of Trees areas and
Schedule 10 entries are joined; every source carries its licence, OpenStreetMap records the ODbL; species names are
fixed (1,028 species keys, 11 accepted names, kauri survey names, i-Tree heights in metres). Tree numbers, positions
and crown outlines are those of v6.2. Tool: 0.2.12 (live from 18 October 2026 with 0.2.12, and with 0.2.13 from
19 October). Method: the release 6.3 methods page (`web/v63-methods.html`) and `docs/data-dictionary.md` in the
repository.

### v6.2 (13 October 2026, `20261013-v6.2`)

Reviewer confirmations applied to 326 records; 16,226 crowns that v6 left "growth form not yet determined" shown
as palm-type (the palm detector's display threshold lowered from 0.5 to 0.2 for them); the Change since 2013
layer described in the release metadata; the near-canopy polygon under the crown v6.1 promoted no longer drawn.
Tree numbers, positions and crown outlines are those of v6.1. Tool: 0.2.8. Method: the release 6.2 methods page
(`web/v62-methods.html`) in the repository.

### v6.1 (13 October 2026, `20261013-v6.1`)

4,200,336 permanent tree numbers, 3,574,821 for the markers on the map and 625,515 for earlier LiDAR detections
kept as records (`tn` in the map features, `tree_number` in the full records), and an alias table of 19,376,165
keys (`data/tree_ids`) that resolves every record ID, release 4 and 5 crown key and tree number, with tombstones
for the 7,405 LiDAR detections removed before the 9 September release. Corrections ledger applied in full (14
applied, 17 recorded, 318 already true, 5 awaiting review): 3,574,821 markers on the map and 3,523,021 LiDAR crowns
counted, 3 fewer of each than v6. Otherwise v6's crowns, measurements and estimates.
Tool: 0.2.3 shows the numbers (live with 0.2.4); earlier tools keep working on record IDs. Method:
`docs/v61/tree-numbers.md` in the repository.

### v6 (12 October 2026, `20261012-v6`)

Model growth form for 3,352,099 crowns (A2 + C1 palm detector, A2_robust on leaf-on flights): 2,771,551
shown, 580,548 not yet determined. Display rules r15 with the v6 decisions and the pre-publication audit:
"possibly conifer" on the isthmus and "possibly palm-type" outside it withheld, deciduous calls outside the
isthmus read "Broadleaf (model)", palm detections read "palm or cabbage tree". Smoothed crown outlines
with area preserved; service estimates reweighted by the growth-form probabilities where a call is shown
(2,918,424 rows; release totals +NZ$3.19 million a year, −114,500 t CO₂e stored, −483,700 m³ a year of
avoided runoff). Recorded species stay the species shown. Every v5.2 record, link, marker and position is kept;
one reviewed correction moved a notable-tree record onto its crown (3,574,824 markers on the map). Tool: 0.1.0
with the v6 patch, or 0.2.0 and later. Method: `docs/v6/growth-form.md` in the repository.

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
