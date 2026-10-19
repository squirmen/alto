# Versioning

ALTO has two things that change on their own schedules, and each has its own version.

| | What it covers | Version | Where it is set | Tag |
|---|---|---|---|---|
| **Tool** | The interface: the map (`web/index.html`), the tree page (`web/tree.html`), Species maxima (`web/maxima.html`) and their modules, styles and tests | Semantic version, e.g. `0.2.13` | `web/version.js` (`ALTOVersion.TOOL.version`), nowhere else | `tool-v0.2.13` |
| **Data release** | Everything under `data/` on the site: tiles, per-tree and per-property records, release metadata | Release name, e.g. `v6.2`, `v6.3` | `release-metadata.json` (`release.data_release` from v6.2 on, and `release.dataset_version`) | `data-v6.3` |

The interface shows both together, with the release's date, for example **Release 6.3 · 17 Oct 2026 · Tool
0.2.13**, on the map, the tree page and Species maxima, and both go into every citation.

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
continuity repair, `v5.2` record-to-crown links, `v6` growth form and smoothed outlines, `v6.1`
permanent tree numbers, `v6.2` reviewer-confirmed and palm-type crowns, `v6.3` benefit value, height and
record checks, height class and group areas). Its
`release-metadata.json` describes the data, not the interface:

- `release.dataset_version` (e.g. `metro-2026.10.10-pointcloud-v5.2`) identifies the build;
- `release.data_release` (e.g. `"v6.3"`) is the short name shown in the interface. Releases write it
  from v6.2 on; for earlier releases `version.js` reads it from `dataset_version`;
- `release.software_version` records **the tool version the data release was checked with** (the
  release tool should write it from `web/version.js` when it assembles the bundle). It is not the
  version of the interface people are using. The copy in `web/release-metadata.json` is the v6.3
  bundle's: it reads `0.2.12`, the tool v6.3 was checked with and went live with on 18 October 2026;
  the site has run tool 0.2.13 since 19 October (see `CHANGELOG.md`). Releases before v6.2 left the
  field at `0.1.0`.

## Compatibility

The tool reads data through published contracts, and checks them rather than assuming:

- the detail and property bucket layout from each `schema.json` (`bucket_algorithm`);
- optional layers and products from `derived_products` and `artifacts` (the Council recorded
  positions layer, the v6 growth form, from v6.1 the alias table `derived_products.tree_ids`, and from
  v6.3 the Notable Group of Trees areas);
- tile fields that a release may not have (`gf6`, `link_class`, `tn`, and from v6.3 `hchk`, `lchk`,
  `grp`): absent fields render nothing;
- fields a release renamed, read by `web/release-fields.js`: tool 0.2.12 and later read both v6.2's and
  v6.3's names (`benefit_value_nzd_y` or `total_value_nzd_y`, `height_class` or `life_stage`,
  `crown_replacement` or `irreplaceability_class`), so one build serves either release;
- the tool build's derived tables for each release (comparisons, history, Species maxima, notable facts,
  and from 0.2.13 iNaturalist records and street-level links), in `derived/<dataset_version>/`, read only
  for the release whose `dataset_version` names them.

So a tool release normally works with the current and the previous data release. A data release
that changes a contract (a new bucket layout, renamed fields) needs a tool release that reads both
before it goes live.

## Tree IDs

Tree links (`/tree/<ID>`, `tree.html?id=…`, `?tree=…`) go through `web/tree-id.js`. From data
v6.1 every marker on the map has a permanent tree number (`T` + 6 characters + a check character, e.g.
`TMCTT6X4`), and the release lists an alias table under `derived_products.tree_ids` that resolves
every tree number, record ID and crown key published so far. Tool 0.2.3 and later show the number
as the tree's ID and use `https://alto.tfwelch.com/tree/<number>` as its permanent link; merged,
split and retired IDs open a page that says what became of them. With a release that has no alias
table, the resolver accepts the release `tree_id` (`akl_tree_…`, or without the prefix) as before.
Links made before v6.1 keep working. See [`docs/v61/tree-numbers.md`](docs/v61/tree-numbers.md).

## Tags and the changelog

Tag the commit that ships each version: `tool-vX.Y.Z` for the interface, `data-vN` for the commit
that documents a data release (its release metadata, data dictionary and method notes).

The public tags are the reference for each live build. At a `tool-v…` tag, `web/` is the interface
served at the site root, apart from the build's version stamps; at a `data-v…` tag,
`web/release-metadata.json` is the live release's. `tool-v0.2.1` and `data-v6` mark one snapshot,
`tool-v0.2.4` and `data-v6.1` the next, and `tool-v0.2.13` and `data-v6.3` the one after; versions
released between two snapshots (tool 0.2.2, 0.2.3 and 0.2.5 to 0.2.12; data v6.2) have no tag, and their
changes are in the changelog and the next snapshot.

The commit ID in a live build's `tool-build.json` (`tool.source.commit`) belongs to the development
branch the interface is built from, not to `main`; use the tag to find a build's source here.

`CHANGELOG.md` has a Tool section and a Data section; each entry says which versions of the other it
was tested with.
