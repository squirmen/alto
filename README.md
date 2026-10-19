# ALTO · Aotearoa Long-term Tree Observatory

A tree-by-tree map and database of Auckland's urban forest, from the Better Places Lab at
Waipapa Taumata Rau | University of Auckland.

ALTO brings Auckland Council and Auckland Transport tree registers, the notable trees overlay,
kauri observations and OpenStreetMap together with the 2024 LINZ aerial laser survey. Every
vegetation crown at least 3 m tall is detected from the point cloud, drawn as a polygon with the
help of aerial NDVI, linked to the register and other source records that describe it, and graded
by how strong the evidence is. Each tree carries its height and crown, a model estimate of its growth
form, canopy history from the 2013 and 2016 surveys where a match exists, a height class and crown
replacement time, estimates of trunk size, roots and benefits (stormwater and carbon), checks on its
height and its record link, and the assumptions behind every estimate.

- **Map:** https://alto.tfwelch.com · every tree also has its own page, at a permanent link
  (`https://alto.tfwelch.com/tree/<tree number>`), with its source records, key measurements and where
  each comes from, checks, history, aerial imagery through time (scanned surveys from 1939 and the surveys
  since 2010), iNaturalist records at the tree, a link to street-level imagery, benefits, photos and citation.
- **Versions:** the interface (tool) and the data release are versioned separately and shown together;
  the site now runs data release v6.3 with tool 0.2.13 ("Release 6.3 · 17 Oct 2026 · Tool 0.2.13"), tagged
  `data-v6.3` and `tool-v0.2.13` in this repository. See [`VERSIONING.md`](VERSIONING.md) and
  [`CHANGELOG.md`](CHANGELOG.md).
- **Release notes:** [Methods](https://alto.tfwelch.com/methods.html) lists every release, and
  [How ALTO is made](https://alto.tfwelch.com/how-alto-is-made.html) gives one overview.
  [v6.3](https://alto.tfwelch.com/v63-methods.html) (benefit value, height and record checks, height class,
  group areas, licences, species names),
  [v6.2](https://alto.tfwelch.com/v62-methods.html) (reviewer-confirmed crowns and palm-type crowns),
  [v6.1](https://alto.tfwelch.com/v61-methods.html) (permanent tree numbers),
  [v6](https://alto.tfwelch.com/v6-methods.html) (growth form and smoothed crown outlines),
  [v5.2](https://alto.tfwelch.com/v52-methods.html) (record-to-crown links),
  [v5.1](https://alto.tfwelch.com/v51-methods.html) (crown continuity repair),
  [v5](https://alto.tfwelch.com/v5-methods.html) (crown redraw)
- **Tree numbers:** every marker on the map has a permanent number, such as `TMCTT6X4`, with a check
  character that catches any single mistyped character. Every record ID and crown key published
  before still resolves, to the tree that carries it now or to a page saying why none does. See
  [`docs/v61/tree-numbers.md`](docs/v61/tree-numbers.md).
- **Growth form:** the 2024 survey's crowns carry a model estimate of their growth form (evergreen or
  deciduous broadleaf, conifer, palm or cabbage tree, tree fern) or "Growth form not yet determined";
  colour the map by it or filter on it. A recorded species always stays the species shown. See
  [`docs/v6/growth-form.md`](docs/v6/growth-form.md).
- **Species maxima:** the largest measured tree of each recorded species by height, crown spread and crown
  area, across Auckland or in a local board, from the 2024 LiDAR survey
  ([maxima.html](https://alto.tfwelch.com/maxima.html)).
- **Data:** explore any tree on the map; field definitions are in
  [`docs/data-dictionary.md`](docs/data-dictionary.md). Bulk data is available to research
  partners on request.
- **Your property:** search an address on the map to see the trees on that parcel, the canopy over it and an estimate of
  the services they provide each year. Every tree also carries an inferred land type (street, park, institutional,
  private), which the map's Land filter uses. See [`docs/methods/property_tenure.md`](docs/methods/property_tenure.md).
- **Council recorded positions:** a map layer (Layers tab, off by default) showing, for every record
  joined to a crown in v5.2, where its source recorded the tree and a line to the crown it was joined
  to. See [`docs/v52/linking.md`](docs/v52/linking.md).
- **Sources and credits:** every source, with its licence and a link to the original:
  https://alto.tfwelch.com/credits.html
- **KYTE**, the companion phone app for adding ground observations: https://alto.tfwelch.com/kyte/

This is a research beta. The release is reproducible and openly documented, but it has not been
independently validated. Read [`docs/v5/release-review.md`](docs/v5/release-review.md),
[`docs/v52/linking.md`](docs/v52/linking.md), [`docs/v6/growth-form.md`](docs/v6/growth-form.md),
[`docs/v61/tree-numbers.md`](docs/v61/tree-numbers.md), the
[release 6.3 methods page](https://alto.tfwelch.com/v63-methods.html) and
[`docs/methods/beta_known_limitations.md`](docs/methods/beta_known_limitations.md) before using
any estimate for a decision.

## The current release

Data release v6.3 (`20261017-v6.3`, 17 October 2026, live from 18 October), shown with tool 0.2.13. It
values benefits as stormwater plus carbon, checks every height and record-to-crown link, replaces the
life-stage label and the irreplaceability class with a height class and a crown replacement time, joins
Schedule 10 entries and the Notable Group of Trees areas, gives every source its licence (OpenStreetMap
records carry the ODbL) and fixes species names. Tree numbers, positions and crown outlines are those of
v6.2, which applied reviewer confirmations to 326 records and showed 16,226 crowns that v6 had left
undetermined as palm-type. Before it, v6.1 gave every marker on the map a permanent tree number and applied
the corrections ledger in full; v6 added a model estimate of growth form and smooth crown outlines; v5.1
restored 4,661 record-to-crown links that v5's containment rule had dropped, and v5.2 joined 3,088 of the
records still unlinked to the crowns they stand on.

| | |
|---|---|
| Tree records | 6,238,420 |
| Markers on the map | 3,574,821 (3,574,741 in the totals: the 80 whose height is not plausible are left out) |
| Permanent tree numbers (v6.1) | 4,200,336; the alias table holds 19,376,165 numbers, record IDs and crown keys |
| Current crowns from the 2024 survey (≥ 3 m) | 3,352,851, plus 457 drawn from a record in v5.2 (before the v6.1 corrections) |
| LiDAR crowns counted, including earlier crowns outside the 2024 survey footprint | 3,523,021 |
| Benefit value (v6.3) | about NZ$76.7 million a year, stormwater plus carbon (a sensitivity scenario) |
| Height checks (v6.3) | 80 map markers with a height that is not plausible, 2,692 to check |
| Record-to-crown checks (v6.3) | of 42,491 linked records, 253 may be on a different tree and 5,556 are to check |
| Crown replacement time (v6.3) | 2,622,915 map markers in a band; 951,906 not classed (917,582 crowns under 5 m tall) |
| Corrections ledger (v6.3) | 332 applied, 17 recorded with their trees, 1 already true, 5 awaiting review |
| Crowns with a model growth form (v6, v6.2) | 2,787,777 of 3,352,099 scored; 564,322 not yet determined |
| Records joined to a crown in v5.2 | 3,088: 1,043 linked, 1,456 probable, 589 on 534 crowns drawn from the record; v6.2 confirmed 278 of those crowns |
| Associations restored in v5.1 | 4,661 across 4,362 crowns |
| Map markers linked to Schedule 10 (notable trees) | 3,570; 3,824 map markers lie inside one of the 229 Notable Group of Trees areas |
| Survey tiles processed | 3,149 of 3,149 |
| Canopy captures linked | 2013, 2016, 2024 |

Records outnumber map markers because earlier detections, register entries and duplicates are all
kept and linked rather than merged. Nothing provided by a source is deleted; uncertain trees are
labelled instead. A LiDAR crown 3 m or taller can hold several trees, and a large tree can be split into
several crowns. There are more tree numbers than markers on the map because the 625,515 earlier LiDAR
detections that no current crown covers carry one too.

The benefit value is stormwater plus carbon from v6.3. Release 6.2's figure, about NZ$295 million a year,
also counted air quality and cooling; those dollars, PM2.5 removal and the cooling index stay in each
tree's full record and are not published while the PM2.5 method awaits confirmation of its sources. The 80
crowns whose height is not plausible keep their measurements, and their estimates are withheld. Crowns
whose height or record link is to check stay in the totals and are left out of comparisons, Species maxima
and the property tallest tree.

v6 growth form, from a fresh blind test outside the central isthmus and a blind audit before
release: 81% of test crowns get a growth form and 94% of those agree with the test labels; 0.899 of the calls
the map would show agreed with the audit labels (0.921 after the two weakest cells were withheld). The test
and audit labels were made from the imagery by a machine-learning image-interpretation model, in one pass.
Every call is a model estimate, never an identified species.

v5.2 link precision, from a hold-out on displaced records and a blind visual audit of real ones:
linked 0.989 and 47 of 48; probable 0.936 and 33 of 37; crowns drawn from the record 31 of 37 (audit
only). Crowns drawn from a record are shown faintly until a reviewer confirms them. 20,704 records went to
review and are unchanged on the map, and 13,613 lie outside the 2024 point cloud and stay unlinked
with that reason. "Crown unlinked" does not mean a tree is absent.

## What is in this repository

```
pipeline/
  base/   The original inventory and analysis pipeline: source downloads, register normalisation,
          LiDAR canopy work, species-class models, valuation, root zones, trajectories, tiles and
          the first web build. Kept in its own project layout so its relative paths still hold.
  v4/     Point-cloud tree detection (variable-window tops, watershed crowns), record linking,
          evidence tiers, restoration of island trees, tiles and deployment.
  v5/     NDVI-assisted crown segmentation, polygon-containment identity, crown-based services,
          per-tree detail buckets, near-canopy layer, property totals and land tenure, tiles,
          verification and deployment.
  v51/    Crown continuity repair: audit, repair, verification and the v5.1 release tools.
  v52/    Record-to-crown linking (linker/) and the v5.2 release tools.
  v6/     The growth-form interface test. The v6 scoring, outline and release code, the v6.1
          numbering and corrections code and the v6.2 and v6.3 release code are not in this
          repository yet; docs/v6/growth-form.md, docs/v61/tree-numbers.md and the release 6.2 and
          6.3 methods pages describe the methods.
  tool/   The interface build for the site (build_web_beta.py); the derived tables the tree page reads
          for each release (build_tree_context.py comparisons, build_tree_history.py history,
          build_tree_inat.py iNaturalist records at each tree); the aerial survey index
          (build_imagery_coverage.py); LiDAR point crops (not read by the public pages); and the
          interface tests with their fixtures (tree record, panel and page, tree numbers, search, aerial
          imagery, methods pages, credits, Species maxima, release 6.3 fields, colour vision).
web/      The interface (tool) source: the MapLibre and PMTiles map with its tree panel, search, legend
          and Area dashboard; the tree page (tree.html) with aerial imagery through time
          (tree-imagery.js, tree-imagery-viewer.js), iNaturalist records and street-level links; the
          tree-number resolver (tree-id.js); Species maxima (maxima.html); Sources and credits
          (credits.html); the methods index (methods.html), How ALTO is made and the release notes
          pages (v5 to v6.3); growth form, ground evidence from KYTE and the Council recorded positions
          layer; with the live data release's release-metadata.json. Version in web/version.js. The
          3D tree-form modules (tree-model.js, tree-architecture.js, tree-webgl.mjs, vendor/three) are
          kept but not loaded by the 0.2 pages.
docs/     Methods, validation notes, the v5 release review, segmentation notes, the v5.1 repair,
          v5.2 linking, v6 growth-form and v6.1 tree-number write-ups, the tree record schema and the
          LINZ Basemaps notes (docs/tool), and the v6.3 data dictionary.
CHANGELOG.md, VERSIONING.md   Tool and data release history, and how each is versioned.
```

## How a release is built

1. **Sources** (`pipeline/base`). `download_nz_tree_sources.py` and the `fetch_*` scripts collect
   the registers and LINZ products; `normalize_public_tree_inventory.py` builds one inventory with
   source IDs kept intact.
2. **Base analysis** (`pipeline/base`). Canopy rasters, crown and LiDAR samples, species-class
   models, valuation (`build_*valuation*`, documented in `docs/methods/tree_valuation_pilot.md`),
   root zones and canopy trajectories across 2013, 2016 and 2024.
3. **Point-cloud detection** (`pipeline/v4`). `detect_v4.py` finds tree tops and crowns in every
   survey tile from the vegetation classes; `build_db_v4.py` links them to records and assigns
   evidence tiers.
4. **v5 crowns and release** (`pipeline/v5`). `produce_crowns.py` redraws crowns with the shipped
   segmentation parameters (`shipping_config.json`, chosen as described in
   `docs/v5/segmentation.md`); `build_v5_database.py`, `enrich_v5.py` and `finalize_v5_database.py`
   build the release database; `export_web_v5.py`, `v5_to_tiles.py` and
   `build_tree_details_v5.py` produce the map tiles and per-tree records; `verify_v5_*.py` and
   `seal_v5_bundle.py` check and seal the bundle; `upload_v5.py` stages, verifies and activates it.

5. **Property totals and land tenure** (`pipeline/v5`). `property_sources.py` fetches the open zoning, designation, park
   and conservation layers; `build_property_tenure_v5.py` assigns every map marker a land-tenure class and a LINZ parcel,
   measures canopy over each parcel, writes per-property summaries, parcel tiles and an OpenStreetMap address index;
   `build_tenure_tiles_v5.py` adds the tenure class to the tree and crown tiles for the Land filter;
   `property_spot_checks.py` reconciles the property sums with the release totals. `upload_property.py` is the
   uploader the later releases extend.
6. **v5.1 crown continuity repair** (`pipeline/v51`). `audit_inventory_crown_links.py` audits every inventory record
   against the current crowns; `repair_v5_crown_links.py` plans and applies a conservative repair to an isolated copy
   of the v5 database; `verify_crown_link_repair.py` proves that nothing else changed. `build_v51.py` then rebuilds the
   affected features, profiles, property summaries and KYTE nearby index, `verify_v51.py` checks and seals the bundle,
   and `publish_v51.py` stages and activates it. See [`docs/v51/crown-continuity.md`](docs/v51/crown-continuity.md).
7. **v5.2 record-to-crown linking** (`pipeline/v52`). `linker/run_all.sh` scores every unlinked record against nearby
   crowns with a positional error model learned from the unlinked records, draws crowns from the laser returns where v5
   drew none, evaluates on a hold-out and writes the links; a blind visual audit is judged before the report;
   `linker/package_v52.py` applies the publication decisions. `build_council_positions_tiles.sh` builds the recorded
   positions layer, `build_v52.py` merges the package into the v5.1 release after re-checking every link against it,
   and `verify_v52.py`, `publish_v52.py` and `smoke_v52.py` check, publish and test it. See
   [`docs/v52/linking.md`](docs/v52/linking.md).
8. **v6 growth form and smoothed outlines.** A gradient-boosted classifier scores the v5 crowns from their
   LiDAR structure, its setting and image embeddings of the 2024 aerial imagery, with a separate palm
   detector; display rules show a growth form only where calls of that kind tested right often enough, and
   a blind audit before release withheld two more cells. Crowns are redrawn as area-preserving smooth
   outlines of the same cells, and the benefit estimates are weighted by the growth-form probabilities. A
   corrections stage then applies reviewed decisions from a ledger and publishes a receipt. The code for
   this step is not in this repository yet; see [`docs/v6/growth-form.md`](docs/v6/growth-form.md).
9. **v6.1 permanent tree numbers.** Every marker on the map is given a random number with a check character; an
   alias table maps every record ID, crown key and number ever published to the tree that carries it now
   (or records why none does), under rules that carry numbers over to later releases; and the whole
   corrections ledger is applied to the affected records and crowns. The code for this step is not in
   this repository yet; see [`docs/v61/tree-numbers.md`](docs/v61/tree-numbers.md).
10. **v6.2 and v6.3.** v6.2 applies reviewer confirmations from the corrections ledger and shows the palm
    detector's calls from a lower score on crowns v6 left undetermined. v6.3 checks every height against
    the laser returns and published maximum heights and every record-to-crown link, replaces the life-stage
    label and the irreplaceability class with a height class and a crown replacement time, values benefits
    as stormwater plus carbon, joins Schedule 10 entries and the Notable Group of Trees areas, gives every
    source its licence and fixes species names. The release code is not in this repository yet; see the
    [release 6.2](https://alto.tfwelch.com/v62-methods.html) and
    [release 6.3](https://alto.tfwelch.com/v63-methods.html) methods pages (`web/v62-methods.html`,
    `web/v63-methods.html`) and [`docs/data-dictionary.md`](docs/data-dictionary.md).

`pipeline/v51` and `pipeline/v52` each have a README with the order of their steps and the inputs they expect.

The interface is versioned and released on its own (see [`VERSIONING.md`](VERSIONING.md)).
`pipeline/tool/build_web_beta.py --out <folder> --public --site-root . --channel release --version 0.2.13`
(with `--derived <folder>` for each data release's tables) turns `web/` into the copy served at the site
root: it stamps script, style and image URLs with the tool version, writes the site settings
(`site-config.js`; the data release's cache stamp is read at run time), adds `tool-build.json`,
`changelog.html` and `versioning.html`, ships the methods index, How ALTO is made, the release notes pages
(`v5-methods.html` to `v63-methods.html`), Sources and credits and the 404 page, and leaves the data
release's own `release-metadata.json` to the data release. Without `--public` it builds a self-contained
copy for a sub-path such as `/beta/`. `build_tree_context.py`, `build_tree_history.py` and
`build_tree_inat.py` build the tree page's per-release comparison, history and iNaturalist tables
([`docs/tool/tree-record.md`](docs/tool/tree-record.md)); `build_imagery_coverage.py` writes
`web/imagery-coverage.json` from the metadata of LINZ's open imagery archive.

Per-tree records are split into 65,536 hashed buckets (`reshard_tree_details.py`) so a profile
loads about 60 KB rather than a whole region.

## Running it

The pipeline expects Python 3.11 with the geospatial stack in [`requirements.txt`](requirements.txt)
(`pipeline/base/environment.yml` has the original environment), plus
[tippecanoe](https://github.com/felt/tippecanoe) and the [pmtiles](https://github.com/protomaps/go-pmtiles)
CLI for tiles. A full metropolitan run needs the LINZ point cloud (about 3,000 tiles) and several
hundred gigabytes of working space.

Scripts read and write under one data root, `/data/alto`. Point it at your own storage with a
symlink, or edit the path constants at the top of each script. Settings that are not paths come
from the environment:

| Variable | Used for |
|---|---|
| `LINZ_API_KEY` | LINZ Basemaps and data downloads (a free key from LINZ) |
| `ALTO_BENCH_KIT` | Human-labelled benchmark crowns used to calibrate segmentation (not distributed) |
| `ALTO_DEPLOY_HOST`, `ALTO_DEPLOY_DATA` | SSH host and data folder for the uploaders |
| `ALTO_AUDIT_DIR` | Output folder for v4 audit renders |
| `ALTO_ENRICH_PID` | Optional: lets `run_v5_exports.py` stop waiting if enrichment has died |
| `LINK_ROOT`, `LINK_DB`, `LINK_CROWNS` | v5.2 linker: working folder, the database it reads (read-only) and the crown tiles |
| `LINK_WORKERS`, `PYTHON` | v5.2 linker: worker processes and the interpreter `run_all.sh` uses |

## Tests

```sh
cd pipeline/v5 && python -m unittest test_near_canopy_v5 test_upload_v5 test_v5_geometry_and_inputs
cd pipeline/v5 && node test_v5_ui.cjs && node test_property_ui.cjs && node test_record_links_ui.cjs
cd pipeline/v51 && python -m unittest test_crown_link_repair
cd pipeline/tool && for t in test_*.cjs; do node "$t"; done
cd pipeline/tool && python test_build_derived.py
cd pipeline/v6 && node test_growth_form_ui.cjs
cd pipeline/base && python -m pytest tests
```

The v5 and v5.1 tests, the derived-table test and the interface tests pass, with one exception:
`test_tree_id.cjs` stops at its check of the tree-number vectors shared with KYTE, which needs the trimmed
alias-table shards in `pipeline/tool/fixtures/tree_ids/` (rows of the release's `data/tree_ids`, kept out of
the repository with the other data files). The tool tests cover the tree record, the tree panel and page,
tree numbers and the alias-table resolver, search, aerial imagery through time and its larger view, the
methods pages and release notes, credits and licences, Species maxima, the release 6.3 fields and checks,
iNaturalist and street-level links, the site's security headers, and the map's colours under simulated
colour-vision deficiencies. Tests that compare against a full release read it under `/data/alto` and are
skipped when it is not there. In the base suite, two failures are known and open: the deploy gate notes
that the base web build does not ship the v5 near-canopy tiles, and one tile-attestation edge case does not
yet reject a pre-existing stale tile. `test_growth_form_abstention.py` can abort inside a native library on
some builds of the scientific stack.

## Data sources and attribution

Every source, with its licence and a link to the original: [Sources and credits](https://alto.tfwelch.com/credits.html).

- Auckland Council tree register (incl. Auckland Transport), retrieved June 2026. © Auckland Council; the public
  service now requires a token.
- Auckland Unitary Plan Notable Trees Overlay and Notable Group of Trees Overlay: Plans and Places, Auckland Council,
  [CC BY 4.0](https://www.aucklandcouncil.govt.nz/en/geospatial/council-open-data/user-licence-auckland-council-open-data.html).
  ALTO links a tree to its Schedule 10 (Notable Trees Schedule) entry as the July 2026 schedule gives it; Auckland
  Council determines whether a tree is protected.
- Kauri survey records, [Ruru ObsKauri Tiaki (valid and public)](https://www.arcgis.com/home/item.html?id=98eb8eb841ed4205a5e97f7bd0dbdf86):
  Bio Info Team, Environmental Services, Auckland Council, under the Council's terms. Not a complete record; verify
  before relying on it.
- Auckland Council context layers (zones and designations, park extents, impervious surfaces and land cover 2017,
  stormwater, flood plains, flood prone areas and overland flow paths, predicted air temperature), CC BY 4.0.
- Toitū Te Whenua LINZ: Auckland 2024 LiDAR (licensed by Regional Software Holdings Limited and Auckland Council),
  2013 and 2016–18 LiDAR (Auckland Council), aerial imagery since 2010 and scanned historical surveys from 1939 from
  [New Zealand Imagery](https://registry.opendata.aws/nz-imagery/), NZ Primary Land Parcels and NZ Building Outlines.
  Sourced from LINZ, [CC BY 4.0](https://www.linz.govt.nz/products-services/data/licensing-and-using-data/attributing-elevation-or-aerial-imagery-data).
- Public Conservation Land: Crown Copyright: Department of Conservation Te Papa Atawhai 2026, CC BY 4.0.
- Local board boundaries: Stats NZ – Tatauranga Aotearoa, CC BY 4.0.
- OpenStreetMap: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), Open Database Licence.
  Records derived from OpenStreetMap stay under the ODbL, and exports that contain them carry its share-alike
  condition.
- Basemaps: Powered by [Esri](https://www.esri.com) (World Imagery; World Light Gray Canvas), and OpenStreetMap tiles.
- i-Tree (USDA Forest Service and cooperators): species growth form and mature size from the
  [i-Tree Database](https://database.itreetools.org/); benefit values are ALTO's estimates using i-Tree methods.
- Published maximum tree heights for the v6.3 height and record checks, from floras, tree registers and species
  databases named on Sources and credits; ALTO quotes the height only. Accepted Latin names checked against the
  [iNaturalist](https://www.inaturalist.org) taxonomy.
- iNaturalist research-grade observations at each tree, each under its observer's own licence: facts and credit
  where the licence allows, otherwise a link; no photographs are copied.
- Street-level imagery: links to photographs on [Mapillary](https://www.mapillary.com) (Mapillary contributors,
  CC BY-SA 4.0); no image is copied or shown.
- Growth-form model: DINOv2 (Meta; Apache License 2.0), LightGBM (Microsoft; MIT), DeepForest (Weecology; MIT) and
  torchvision (BSD 3-Clause); palm check against iNaturalist research-grade observations through GBIF.org
  ([doi:10.15468/ab3s5x](https://doi.org/10.15468/ab3s5x)).

ALTO's outputs are derived estimates. They are not survey data and do not replace an arborist's
assessment of an individual tree.

## Licence

ALTO is open to read, run and build on for noncommercial work, and needs a licence for anything
commercial.

- **Code** is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You can use,
  modify and share it for research, teaching, personal study and other noncommercial purposes.
  Universities, charities, public research organisations and government bodies can use it on
  those terms whatever their funding.
- **Documents** in `docs/` are licensed under [CC BY-NC 4.0](docs/LICENSE.md): share and adapt
  them for noncommercial purposes with credit.
- **Commercial use**, including paid services, consulting deliverables or products built on ALTO's
  code, needs a separate licence from the University of Auckland. Contact Tim Welch.
- **Third-party material** keeps its own terms: three.js (MIT), MapLibre GL JS and PMTiles (BSD-3-Clause),
  the Inter typeface (SIL Open Font License 1.1), and the data above, each under its own licence. See
  [`NOTICE`](NOTICE) and [Sources and credits](https://alto.tfwelch.com/credits.html).

When you use ALTO, cite it as below.

## Citing ALTO

Use the citation in [`CITATION.cff`](CITATION.cff), or "Welch, T. F. (2026). ALTO: Aotearoa
Long-term Tree Observatory, Auckland release v6.3, tool 0.2.13. Better Places Lab, University of Auckland.
https://alto.tfwelch.com". Each tree page gives a citation for that tree with the data and tool versions.

## Contact

Dr Tim Welch, Better Places Lab, Te Pare School of Architecture and Planning,
Waipapa Taumata Rau | University of Auckland · t.welch@auckland.ac.nz
