# v5.2: record-to-crown linking

Joins records that v5.1 left without a crown to the crowns they stand on, or to a crown drawn from the
2024 laser returns at the record's position, and rebuilds the release on top of v5.1. Method,
evaluation and decisions: [`docs/v52/linking.md`](../../docs/v52/linking.md).

```
linker/                        the linking chain (reads a database read-only, writes new files only)
  run_all.sh                   runs the chain in order
  package_v52.py               applies the publication decisions and writes the merge package
build_council_positions_tiles.sh   the Council recorded positions layer from the package
ui_v52.patch                   the map changes (record-links.js, index.html, observatory.css, tree-evidence.js)
build_v52.py, verify_v52.py, publish_v52.py, smoke_v52.py   the release tools
```

## Inputs

All under the data root, `/data/alto`:

- The v5.1 release: `working/alto_v51_20261008/` with its frozen `akl_trees.sqlite`, `code/`,
  `web_build/`, `properties/`, `verification/` and the sealed upload `deploy/alto_v51_upload_20261008/`
  (see [`../v51`](../v51)).
- For the linker: a read-only copy of the v5.1 continuity-repair database (`LINK_DB`, default
  `working/alto_v5_link_repair_20261008/akl_trees.sqlite`), the v5 crown tiles (`LINK_CROWNS`, default
  `working/crowns_v5_full/crowns`), the 2024 LiDAR tiles (`point_cloud_2024/auckland_metro_v1`) and the
  LINZ 2024 7.5 cm RGB+NIR imagery, read directly from the public LINZ bucket. Palm detection scores from
  the species work are read if present; they contributed nothing to this release. LINZ primary parcels
  are used only by the `parcels.py` diagnostic.
- The property and tenure build, `working/alto_parcels_20261002/`.

The linker writes under `LINK_ROOT` (default `/data/alto/working/link_v52_20261009`): `work/`, `eval/`,
`logs/` and `out/`.

## Order

1. **Link**: `linker/run_all.sh` (about two hours with eight workers; set `PYTHON` to choose the
   interpreter and `LINK_WORKERS` for the pool). It extracts the unlinked records, builds evidence at
   every record, fits the error model, tests run alignment against a null, simulates displaced records,
   evaluates on a five-fold hold-out, writes the production links to `out/` and the report. On a new
   crown set, draw, render and judge a fresh blind audit round (`audit.py sample4`,
   `audit.py render`, judgments into `eval/`, `audit_score.py`) before `report.py`.
2. **Package**: `python linker/package_v52.py` writes `out/v52_package/`: published links, crowns drawn
   from a record, the review queue, the records outside coverage, the recorded positions, and
   `PACKAGE.json` with the SHA-256 of each file.
3. **Positions layer**: `./build_council_positions_tiles.sh` builds
   `web/data/council_positions.pmtiles` under `LINK_ROOT`.
4. **Build** the release in `/data/alto/working/alto_v52_20261010`, one stage at a time:
   `python build_v52.py prepare`, then `maps`, `details`, `properties`, `nearby`, `positions`, `assemble`.
   - `prepare` freezes the package beside the release (checked against `PACKAGE.json`), re-checks every
     link against the v5.1 release database and leaves out any conflict (a record v5.1 already linked,
     a moved source point, a drawn crown that overlaps a v5 crown), clones the v5.1 database and applies
     the links: one marker per crown, protected or notable records first, members listed in the
     crown's profile, estimates recomputed once per crown with the v5 equations.
   - `maps` rewrites the v5.1 feature streams, regenerating only the features a link touches and
     appending drawn crowns; `details` regenerates the touched profiles and hash-checks every other one;
     `properties` and `nearby` rebuild the property summaries, tenure tiles and KYTE nearby index;
     `positions` checks the prebuilt layer feature by feature against the release; `assemble` applies
     `ui_v52.patch` to the v5.1 page and writes the metadata, release notes, data dictionary and
     `data/record-links-v52.json`.
5. **Check and seal**: `python verify_v52.py` checks that nothing v5.1 published was removed or
   overridden, that every link appears exactly once in the database, profiles, tiles and layer, that the
   totals move only as the package explains and that property sums reconcile, then writes
   `bundle-manifest.json`.
6. **Publish**: `python publish_v52.py plan|push|check|activate`, `rollback` to restore v5.1. Activation
   rechecks every staged digest and that the live site is still exactly v5.1 on every replaced path. Set
   `ALTO_DEPLOY_HOST` to the SSH host alias.
7. **Smoke test** the public site: `python smoke_v52.py`.

`build_v52.py` pins the SHA-256 of `ui_v52.patch` and of the 10 October positions layer, and the check
scripts assert that build's counts and named cases. A different package needs those updated. Tiles need
[tippecanoe](https://github.com/felt/tippecanoe) and the `pmtiles` CLI; the checks also use Node and `git`
(to apply the patch).
