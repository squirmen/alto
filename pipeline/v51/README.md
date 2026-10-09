# v5.1: crown continuity repair

Restores record-to-crown associations that v5's polygon-containment rule dropped, then rebuilds the
release from the repaired database. Method and results: [`docs/v51/crown-continuity.md`](../../docs/v51/crown-continuity.md).

## Inputs

All under the data root, `/data/alto`:

- `working/alto_v5_20260922/akl_trees.sqlite`: the frozen v5 release database (never edited), with its
  `web_build/` feature streams and totals, `details_v2/` profile buckets and manifest, and the sealed v5
  upload under `deploy/alto_v5_upload_20260923/`.
- `point_cloud_2024/auckland_metro_v1/manifest.jsonl`: tile boxes for survey coverage.
- `working/alto_parcels_20261002/`: the property and tenure build (`data/raw`, `data/build_stats.json`,
  `tmp/parcels.parquet`, `tmp/canopy_pairs.parquet`), from `pipeline/v5/build_property_tenure_v5.py`.
- `outputs/alto_v51_release/live_baseline/`: a copy of the files the release replaces, taken from the
  live site just before the rebuild (`index.html`, `tree-identity.js`, `release-metadata.json`,
  `model.json`, `kyte/config.js`, `kyte/sw.js`, and the profile schema and buckets holding accepted
  KYTE visits). The build refuses to run if the live profile schema has moved on from v5.

## Order

1. **Audit** every inventory record against the current crowns:
   `python audit_inventory_crown_links.py --out /data/alto/outputs/crown_link_audit_20261008`
   (writes `audit.sqlite` and `summary.json`; the database is opened read-only).
2. **Plan** the repair: `python repair_v5_crown_links.py plan --audit .../audit.sqlite --out .../repair_plan.json`.
   The plan records the hashes of the audit, the baseline and this script; apply refuses if any changed.
3. **Apply** to an isolated, metadata-preserving copy of the baseline, never the baseline itself:
   `cp -cp /data/alto/working/alto_v5_20260922/akl_trees.sqlite /data/alto/working/alto_v5_link_repair_20261008/akl_trees_verified.sqlite`, then
   `python repair_v5_crown_links.py apply --plan .../repair_plan.json --db <copy> --receipt .../applied_repair_verified.json`.
4. **Verify** the copy against the baseline:
   `python verify_crown_link_repair.py --plan .../repair_plan.json --db <copy> --out .../verification.json`.
5. **Test**: `python -m unittest test_crown_link_repair` (imports from this folder and `../base/scripts`).
6. **Build** the release in `/data/alto/working/alto_v51_20261008`, one stage at a time:
   `python build_v51.py prepare`, then `maps`, `details`, `properties`, `nearby`, `assemble`.
   `prepare` clones the verified database, freezes the reused v5 modules from `pipeline/v5` beside it
   and re-inserts the accepted KYTE visits. `maps` and `details` regenerate only the affected features
   and profiles from SQL and hash-check every reused one; `properties` rebuilds property summaries and
   tenure tiles; `nearby` rebuilds the KYTE nearby index; `assemble` writes the page, metadata, release
   notes and data dictionary.
7. **Check and seal**: `python verify_v51.py` decodes the actual tiles, profiles, property buckets and
   nearby files, then writes `bundle-manifest.json`.
8. **Publish**: `python publish_v51.py plan|push|check|activate`, with `rollback` to restore the
   previous files. `push` writes only to a staging folder; `activate` rechecks every staged digest and
   that the live files are still the expected baseline. Set `ALTO_DEPLOY_HOST` to the SSH host alias.
9. **Smoke test** the public site: `python smoke_v51.py`.

The build and check scripts assert the counts of the 8 October 2026 build (for example 4,661 restored
records and 4,362 crowns). A rerun on other inputs has to update them. Tiles need
[tippecanoe](https://github.com/felt/tippecanoe) and the `pmtiles` CLI; the checks also use Node.
