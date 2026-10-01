# ALTO Auckland v5 release review — 23 September 2026

This release is built in an isolated copy on T7. The original v4 database and production segmentation outputs are preserved. No live files have been changed by this review.

## Completed corrections

- All 3,149 survey tiles succeeded. The 15 empty-canopy failures now produce valid empty outputs. The missing-imagery tile was retried successfully. There are 41 genuinely empty tiles in the completed run.
- The new tree layer contains 3,352,851 crowns at least 3 m tall. A separate 1,499,603-candidate layer retains 594,370 low-canopy and 905,233 sub-canopy outlines. These are excluded from tree service totals.
- Lower-vegetation outlines are transformed from NZTM to longitude/latitude before tiling. A zero NDVI value is retained as a value, rather than treated as missing.
- Three invalid polygons were repaired and four saved areas corrected to the actual polygon area. All seven corrections are logged; input Parquets are unchanged.
- Source points are matched using actual crown containment. Old/new crown relationships use polygon intersections. Overlapping or shared crowns remain spatial hypotheses, not declarations that several records are one biological tree.
- Every one of the 5,839,130 v4 IDs remains in the new database. There are 399,290 new v5 IDs, for 6,238,420 total records. Current map representatives and earlier unmatched detections are distinct populations; the latter are available through a separate switch.
- Council source IDs are reconciled against the retained source identity registry. Original ALTO IDs remain stable. The fresh Council download has 3,502 safe matches, 98 unresolved current rows and 220 unmatched older entries; unresolved rows are not silently substituted or deleted.
- Unverified notable-tree positions are excluded from automatic crown attachment. Twenty-two inherited inventory-to-unverified-notable associations carry a separate review flag. The registry retains source entries that were previously absorbed during inventory normalisation; it does not introduce duplicate map markers merely to restore a source-row count.
- Devonport Primary's stable `akl_tree_not_336` maps to current Council object 684, schedule 1186. The Council source point remains unverified. The reported plaque tree is `akl_tree_lid_1097624`; all five indicated detection points fall in one new crown, 191 m² and 12.76 m tall. The observer's tentative link stays tentative, and the schedule association still needs confirmation.
- Service, trunk and root sensitivity equations are applied to current dimensions once per representative crown. Older estimates remain in the full records. Crown-neighbour separation is no longer treated as a measured root boundary; effective root extent stays missing where paving inputs are missing.
- Current 3D and future views share the current crown-height anchor. Historical canopy measurements keep their original geometry and provenance. The earlier fitted forecast is retained, with transfer to v5 labelled as untested; old nearby-history weighting is disabled pending a fresh match.
- Field species identifications are available to the illustration. Kermadec pōhutukawa uses a related-species form explicitly labelled provisional. Unverified notable positions do not generate a guessed individual-tree model.
- KYTE nearby suggestions are rebuilt from the same current representatives. Existing account files, observations, API configuration and saved tree IDs are preserved.

## Notes reconciled rather than promoted to claims

The segmentation log contains later corrections to the earlier summary. The original v4 comparison used a reconstructed algorithm, followed by a comparison with the actual v4 crowns. The development labels (136) and held-out labels (83) are different sets. The production 3 m height floor was added after the original benchmark. The release does not present those early scores as an independently validated production accuracy estimate.

The notes compare summed crown area with Council canopy-cover percentages. Different dates, extents, overlap treatment and definitions prevent that comparison from validating v5 cover. The map describes summed crown footprints; the board-level cover layer keeps its earlier method and date.

The photographed Kermadec pōhutukawa is still split into two v5 crowns. The older joined width and area were derived from the previous segmentation, not independently measured on the ground. They remain useful competing evidence, but are not used as a measured calibration target. This release does not claim that v5 resolves all multi-stem or spreading trees.

The producer's `imagery_fraction` is a nonzero-NDVI coverage proxy, not a separately measured valid-image mask. Its retry gate passed across the completed run. It is not presented as a calibrated per-tree coverage or accuracy statistic.

The standalone older circle-based identity builder is not used for this release. Current associations use crown polygons. The service, DBH, root and growth-form coefficients remain assumptions open to field testing; retaining them does not make them validated measurements.

## Deployment boundaries

The upload contains static map tiles, full-record buckets, the KYTE nearby index and updated public UI/metadata files. It does not contain either SQLite database, account data, API secrets, uploaded photographs, the field endpoint or replacement server configuration. Unchanged model assets and historical layers remain on the existing site.

The SSH uploader retains v4's independent parallel streams and split large-file transfers. It checks all staged hashes before activation, backs up replaced paths and changes `index.html` last. Transfer failures propagate; activation failure restores completed moves. Rollback is tested, including rejection of a second rollback after the backup has been restored.

Final readiness is recorded separately in `verification/database_checks.json`, `verification/static_checks.json`, `verification/browser_checks.json`, and the bundle's `release-checks.json`. This document alone is not a readiness certificate.
