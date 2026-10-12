# Versioning

ALTO has two things that change on their own schedules, and each has its own version.

| | What it covers | Version | Where it is set | Tag |
|---|---|---|---|---|
| **Tool** | The interface: the map (`web/index.html`), the tree page (`web/tree.html`) and their modules, styles and tests | Semantic version, e.g. `0.2.0` | `web/version.js` (`ALTOVersion.TOOL.version`), nowhere else | `tool-v0.2.0` |
| **Data release** | Everything under `data/` on the site: tiles, per-tree and per-property records, release metadata | Release name, e.g. `v5.2`, `v6` | `release-metadata.json` (`release.dataset_version`; `release.data_release` once a release writes it) | `data-v6` |

The interface shows both together, for example **Data v6 · Tool v0.2.0**, in About, the left panel
footer, the tree panel and the tree page, and both go into every citation.

## Tool versions

Semantic versioning, read for an interface:

- **Major** (`1.0.0`): a change that breaks links or saved state people rely on (tree page URLs,
  `?tree=` links, saved comparisons), or drops support for a data release still online.
  `0.x` means the interface is still a research beta.
- **Minor** (`0.2.0`): new views, panels or controls; a reorganised layout; support for a new data
  field. Existing links keep working.
- **Patch** (`0.2.1`): fixes and wording that change no behaviour a user depends on.

Script and stylesheet URLs carry `?v=tool-<version>` so browsers fetch new files after a tool
release. Modules shared with a data release keep that release's stamp until they change.

## Data releases

A data release is named for the method generation that produced it (`v5` crown redraw, `v5.1`
continuity repair, `v5.2` record-to-crown links, `v6` growth form and smoothed outlines). Its
`release-metadata.json` describes the data, not the interface:

- `release.dataset_version` (e.g. `metro-2026.10.10-pointcloud-v5.2`) identifies the build;
- `release.data_release` (e.g. `"v6"`) is the short name shown in the interface. No release writes it
  yet (v6 included), so `version.js` reads it from `dataset_version`;
- `release.software_version` records **the tool version the data release was checked with** (the
  release tool should write it from `web/version.js` when it assembles the bundle). It is not the
  version of the interface people are using. The copy in `web/release-metadata.json` is the v6
  bundle's; its `0.1.0` is the interface the release was built and checked with (0.1.0 with the v6
  growth-form patch).

## Compatibility

The tool reads data through published contracts, and checks them rather than assuming:

- the detail and property bucket layout from each `schema.json` (`bucket_algorithm`);
- optional layers and products from `derived_products` and `artifacts` (the Council recorded
  positions layer, the v6 growth form, and from the tree-ID audit `derived_products.tree_ids`);
- tile fields that a release may not have (`gf6`, `link_class`): absent fields render nothing.

So a tool release normally works with the current and the previous data release. A data release
that changes a contract (a new bucket layout, renamed fields) needs a tool release that reads both
before it goes live.

## Tree IDs

Tree links (`tree.html?id=…`, `?tree=…`) go through `web/tree-id.js`. Today it accepts the release
`tree_id` (`akl_tree_…`, or without the prefix). When the tree-ID audit publishes permanent IDs and
an alias table, a data release lists it under `derived_products.tree_ids`; the resolver then maps
aliases and retired IDs to the current tree, and the tree page rewrites its address to the
canonical ID. Links made before that keep working.

## Tags and the changelog

Tag the commit that ships each version: `tool-vX.Y.Z` for the interface, `data-vN` for the commit
whose release tools and documentation produced a data release. `CHANGELOG.md` has a Tool section
and a Data section; each entry says which versions of the other it was tested with.
