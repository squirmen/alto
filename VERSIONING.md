# Versioning

ALTO has two things that change on their own schedules, and each has its own version.

| | What it covers | Version | Where it is set | Tag |
|---|---|---|---|---|
| **Tool** | The interface: the map (`web/index.html`), the tree page (`web/tree.html`) and their modules, styles and tests | Semantic version, e.g. `0.2.4` | `web/version.js` (`ALTOVersion.TOOL.version`), nowhere else | `tool-v0.2.4` |
| **Data release** | Everything under `data/` on the site: tiles, per-tree and per-property records, release metadata | Release name, e.g. `v6`, `v6.1` | `release-metadata.json` (`release.dataset_version`; `release.data_release` once a release writes it) | `data-v6.1` |

The interface shows both together, for example **Data v6.1 · Tool v0.2.4**, in About, the left panel
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
continuity repair, `v5.2` record-to-crown links, `v6` growth form and smoothed outlines, `v6.1`
permanent tree numbers). Its
`release-metadata.json` describes the data, not the interface:

- `release.dataset_version` (e.g. `metro-2026.10.10-pointcloud-v5.2`) identifies the build;
- `release.data_release` (e.g. `"v6.1"`) is the short name shown in the interface. No release writes
  it yet (v6.1 included), so `version.js` reads it from `dataset_version`;
- `release.software_version` records **the tool version the data release was checked with** (the
  release tool should write it from `web/version.js` when it assembles the bundle). It is not the
  version of the interface people are using. The copy in `web/release-metadata.json` is the v6.1
  bundle's. It still reads `0.1.0`, because the release tools do not write the field yet: v6.1 was
  checked with tool 0.2.3 and went live with 0.2.4 (see `CHANGELOG.md`).

## Compatibility

The tool reads data through published contracts, and checks them rather than assuming:

- the detail and property bucket layout from each `schema.json` (`bucket_algorithm`);
- optional layers and products from `derived_products` and `artifacts` (the Council recorded
  positions layer, the v6 growth form, and from v6.1 the alias table `derived_products.tree_ids`);
- tile fields that a release may not have (`gf6`, `link_class`, `tn`): absent fields render nothing.

So a tool release normally works with the current and the previous data release. A data release
that changes a contract (a new bucket layout, renamed fields) needs a tool release that reads both
before it goes live.

## Tree IDs

Tree links (`/tree/<ID>`, `tree.html?id=…`, `?tree=…`) go through `web/tree-id.js`. From data
v6.1 every map tree has a permanent tree number (`T` + 6 characters + a check character, e.g.
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
`tool-v0.2.4` and `data-v6.1` the next; versions released between two snapshots (0.2.2, 0.2.3) have
no tag, and their changes are in the changelog and the next snapshot.

The commit ID in a live build's `tool-build.json` (`tool.source.commit`) belongs to the development
branch the interface is built from, not to `main`; use the tag to find a build's source here.

`CHANGELOG.md` has a Tool section and a Data section; each entry says which versions of the other it
was tested with.
