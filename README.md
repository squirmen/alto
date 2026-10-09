# ALTO · Aotearoa Long-term Tree Observatory

A tree-by-tree map and database of Auckland's urban forest, from the Better Places Lab at
Waipapa Taumata Rau | University of Auckland.

ALTO brings Auckland Council and Auckland Transport tree registers, the notable trees overlay,
kauri observations and OpenStreetMap together with the 2024 LINZ aerial laser survey. Every
vegetation crown at least 3 m tall is detected from the point cloud, drawn as a polygon with the
help of aerial NDVI, linked to the register and other source records that describe it, and graded
by how strong the evidence is. Each tree carries its height and crown, canopy history from the 2013 and 2016
surveys where a match exists, estimates of trunk size, roots and environmental benefits, and the
assumptions behind every estimate.

- **Map:** https://alto.tfwelch.com
- **Release notes:** [v5.2](https://alto.tfwelch.com/v52-methods.html) (record-to-crown links),
  [v5.1](https://alto.tfwelch.com/v51-methods.html) (crown continuity repair),
  [v5](https://alto.tfwelch.com/v5-methods.html) (crown redraw)
- **Data:** explore any tree on the map; field definitions are in
  [`docs/data-dictionary.md`](docs/data-dictionary.md). Bulk data is available to research
  partners on request.
- **Your property:** search an address on the map to see the trees on that parcel, the canopy over it and an estimate of
  the services they provide each year. Every tree also carries an inferred land type (street, park, institutional,
  private), which the map's Land filter uses. See [`docs/methods/property_tenure.md`](docs/methods/property_tenure.md).
- **Council recorded positions:** a map layer (Layers tab, off by default) showing, for every record
  joined to a crown in v5.2, where its source recorded the tree and a line to the crown it was joined
  to. See [`docs/v52/linking.md`](docs/v52/linking.md).
- **KYTE**, the companion phone app for adding ground observations: https://alto.tfwelch.com/kyte/

This is a research beta. The release is reproducible and openly documented, but it has not been
independently validated. Read [`docs/v5/release-review.md`](docs/v5/release-review.md),
[`docs/v52/linking.md`](docs/v52/linking.md) and
[`docs/methods/beta_known_limitations.md`](docs/methods/beta_known_limitations.md) before using
any estimate for a decision.

## The current release

v5.2 (`20261010-v5.2`, 10 October 2026). It keeps v5's crowns and adds two association releases on
top: v5.1 restored 4,661 record-to-crown links that v5's containment rule had dropped, and v5.2 joined
3,088 of the records still unlinked to the crowns they stand on.

| | |
|---|---|
| Tree records | 6,238,420 |
| Trees on the map | 3,574,825 |
| Current crowns from the 2024 survey (≥ 3 m) | 3,352,851, plus 457 drawn from a record in v5.2 |
| Crowns counted, including earlier crowns outside the 2024 survey footprint | 3,523,024 |
| Records joined to a crown in v5.2 | 3,088: 1,043 linked, 1,456 probable, 589 on 534 crowns drawn from the record |
| Associations restored in v5.1 | 4,661 across 4,362 crowns |
| Protected or notable trees on the map | 3,570 |
| Survey tiles processed | 3,149 of 3,149 |
| Canopy captures linked | 2013, 2016, 2024 |

Records outnumber trees because earlier detections, register entries and duplicates are all
kept and linked rather than merged. Nothing provided by a source is deleted; uncertain trees are
labelled instead.

v5.2 link precision, from a hold-out on displaced records and a blind visual audit of real ones:
linked 0.989 and 47 of 48; probable 0.936 and 33 of 37; crowns drawn from the record 31 of 37 (audit
only). Crowns drawn from a record are shown faintly and await confirmation. 20,704 records went to
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
web/      The live map interface: MapLibre and PMTiles map, tree profiles, 3D tree forms,
          ground evidence from KYTE, the Council recorded positions layer and the release notes pages.
docs/     Methods, validation notes, the v5 release review, segmentation notes, the v5.1 repair and
          v5.2 linking write-ups, and the data dictionary.
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
   and conservation layers; `build_property_tenure_v5.py` assigns every map tree a land-tenure class and a LINZ parcel,
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
   drew none, evaluates on a hold-out and writes the links; a blind visual audit is judged by eye before the report;
   `linker/package_v52.py` applies the publication decisions. `build_council_positions_tiles.sh` builds the recorded
   positions layer, `build_v52.py` merges the package into the v5.1 release after re-checking every link against it,
   and `verify_v52.py`, `publish_v52.py` and `smoke_v52.py` check, publish and test it. See
   [`docs/v52/linking.md`](docs/v52/linking.md).

`pipeline/v51` and `pipeline/v52` each have a README with the order of their steps and the inputs they expect.

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
| `ALTO_BENCH_KIT` | Hand-labelled benchmark crowns used to calibrate segmentation (not distributed) |
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
cd pipeline/base && python -m pytest tests
```

The v5 and v5.1 tests and the interface tests pass. In the base suite, two failures are known and
open: the deploy gate notes that the base web build does not ship the v5 near-canopy tiles, and one
tile-attestation edge case does not yet reject a pre-existing stale tile. `test_growth_form_abstention.py` can abort inside a
native library on some builds of the scientific stack.

## Data sources and attribution

- Auckland Council: tree register, notable trees and notable groups overlays, Unitary Plan base zones and designations, park extents, flood plains and overland flow paths, stormwater assets, predicted air temperature
  (Nov 2021–Mar 2022), impervious surfaces and land cover. Auckland Council open data, CC BY 4.0,
  with the Council's caveats.
- Auckland Transport: street tree records in the tree register.
- Kauri observations (Ruru ObsKauri Tiaki, valid and public records), under Auckland Council's
  data licence with biosecurity caveats.
- Toitū Te Whenua Land Information New Zealand: 2024 Auckland LiDAR point cloud, DEM and DSM,
  2013 and 2016 surface models, 2024–2025 urban aerial imagery, NZ Building Outlines and NZ Primary
  Parcels, CC BY 4.0.
- Department of Conservation: public conservation land, CC BY 4.0.
- OpenStreetMap contributors: mapped trees, buildings, addresses, golf courses and island roads, under the Open Database Licence. Exports
  that contain OpenStreetMap-derived records carry its share-alike condition.
- i-Tree species references for growth form and mature size.

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
- **Third-party material** keeps its own terms: three.js (MIT), and Auckland Council, Auckland
  Transport, LINZ (CC BY 4.0) and OpenStreetMap (ODbL) data. See [`NOTICE`](NOTICE).

When you use ALTO, cite it as below.

## Citing ALTO

Use the citation in [`CITATION.cff`](CITATION.cff), or "Welch, T. F. (2026). ALTO: Aotearoa
Long-term Tree Observatory, Auckland release v5.2. Better Places Lab, University of Auckland.
https://alto.tfwelch.com".

## Contact

Dr Tim Welch, Better Places Lab, Te Pare | School of Architecture, Planning and Design,
Waipapa Taumata Rau | University of Auckland · t.welch@auckland.ac.nz
