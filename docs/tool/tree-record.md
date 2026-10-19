# Tree record: `alto.tree-record/1`

`web/tree-record.js` assembles everything ALTO holds about one tree as plain data: identity, records
and identifiers, key measurements with per-number provenance, measurements by source, LiDAR, outline,
species evidence, canopy by survey, benefits, height class and replacement, roots, comparisons with
similar trees (street, local board, Auckland), history across releases, reviews and corrections,
imagery, LiDAR point crops, place, nearby trees, photos and the height scenario. Presentations (the
tree page, the map's tree panel, later collection pages) read this object and decide the markup. The
module writes no HTML and estimates nothing new: every value is a stored release value, a value from a
published derived file, or a stated formula over them.

Tests: `node pipeline/tool/test_tree_record.cjs` (real v6 development records in
`pipeline/tool/fixtures/tree-records-v6dev.json`, derived files through a stub fetch).

## Use

```js
// Browser: load after version.js, tree-id.js, sources.js, growth-form.js, record-links.js,
// tree-summary.js, tree-details.js (and tree-ground.js, property.js, alto-viz.js for the network parts).
const env = {dataBase: './data', siteRoot: '.', metadata};   // metadata = release-metadata.json
const rec = await ALTOTreeRecord.load(input, env);           // throws {code:'invalid'|'not_found'}
render(rec);                                                 // everything synchronous is ready
await ALTOTreeRecord.enrich(rec, env, {onPart: (name, rec) => renderPart(name, rec)});
ALTOTreeRecord.fromMap(rec, {points, tileProps});            // from a MapLibre map, if the page has one
await ALTOTreeRecord.parcel(rec, env, parcelId);             // parcel id from the map's properties layer
```

- For the map's tree panel: `fromTile(props, env)` on click, then `load(id, env, {members: 0})` (one
  bucket) and draw again.
- `load(input, env, {members = 15})`: resolves the ID (`ALTOTreeId.resolve`), reads the tree's detail
  bucket and up to `members` of its crown's other records (0 for a quick panel), then `assemble`.
- `assemble({id, record, schema, members, memberCount, metadata, resolved, env, live, props})`:
  the synchronous core; pure, used by the tests.
- `fromTile(props, env)`: a record from map-tile properties alone (`loaded: false`; identity and
  `summary` only) so a panel can draw at once.
- `enrich(rec, env, {parts, onPart})`: fills `context`, `history` (lineage), `corrections`,
  `lidar.points`, `imagery`, `place`, `photos`; `scenario` only when asked for and `tree-future.js` is
  loaded. Each part is set on `rec` and reported through `onPart(name, rec)` as it arrives.
- `fromMap(rec, {points, tileProps, radius = 40})`: nearby trees and land type from rendered map features.
- `setLive(rec, live)`: a reviewed ground measurement (KYTE) replaces modelled values where it measures them.
- `toJSON(rec)`: a plain copy (internal fields `summary`, `_ctx`, `_env` are not enumerable).
- Helpers: `percentile(value, quantiles, probabilities)`, `exact(value, sortedValues)`, `tileOf(lon,
  lat, z)`, `fnvShard(id, n)`, `methodRef(methodId)`.

`env`: `dataBase` (`./data`), `siteRoot` (`.`; the beta sets `..`), `metadata`, `version` (cache stamp;
default `assembly.tile_version`), `kyteBase` (`<siteRoot>/kyte`), `derivedBase` (default
`<siteRoot>/derived/<dataset_version>`; `window.ALTO_DERIVED_BASE` overrides, `{release}` is replaced
by the dataset version).

## Conventions

**Status** of a part: `pending` (not asked yet) · `ready` · `none` (nothing recorded for this tree) ·
`not_published` (this release has no such file) · `release_mismatch` (the file was built for another
release and is not used) · `unavailable` (request failed) · part-specific values listed below.

**Quantity** (every number a presentation shows):

```
{key, label, value, unit, text, kind, range, provenance}
kind:  measured | recorded | model | derived | rule
range: {low, high, text, basis, label} | null      e.g. label 'Segmentations', text '134.5–315.5 m²'
```

`measured`: read from a survey (LiDAR, a reviewed ground measurement). `recorded`: as a source
supplied it (species name, schedule). `model`: a model estimate (trunk diameter, benefits, height class,
growth form, regrowth time): never present it as a confirmed fact. `derived`: a fixed formula over
measured values (equivalent-circle diameter, smoothed outline). `rule`: a class assigned by a stated
rule (irreplaceability).

A `range` exists only when its two ends differ as printed, so no value carries a zero-width range
("23.7–23.7 m"); the same holds for the spreads written into `provenance.uncertainty.text`.

**Trunk diameter** (DBH, at 1.3 m above the uphill ground) is never measured by the release. It holds two
models: `assets.dbh_cm_crown_est` (crown size and height; `roots.dbh_cm` repeats it) and
`services.dbh_cm_est` (the benefit equations). `measures.trunkDiameter` is their median, the central
estimate (design system 4.8), with their spread as its range (`label: 'Trunk models'`); its method links
to `v5-methods.html#trunk-diameter`. A reviewed KYTE tape measurement replaces both (`kind: 'measured'`).
`measures.rootProtection` is the root protection radius from that value: 12 × trunk diameter, the area
capped at 707 m² (the release's rule), with the range the trunk range implies.

**Provenance** (one per Quantity; `rec.provenance` lists them all, ids unique per record):

```
{id: 'p-height', label: 'Height', kind: 'measured', source, date: {iso, text} | null, method: {id, text, href, doc} | null,
 model: {id, version, validation} | null, uncertainty: {text, low, high, basis} | null,
 release: 'v6', dataset, field, note}
```

Besides the key measurements, provenance entries are attached to: each `bySource` column
(`p-col-<key>`), `lidar.measurements`, `surveys[].height`, `roots`, and, once they arrive, `context`,
`scenario`, `place.board`, `place.parcel` and `nearby`; `rec.provenance` is refreshed as parts arrive
(ids already listed keep their place, so a page can number notes in arrival order).

`method.href` is the release methods page (`v5-methods.html` …) or the method document in the public
repository; `method.doc` is the repository document. `model.validation` comes from
`release-metadata.json` `models[].validation_status`.

**Dates** are `{iso, text}` (`text` in en-NZ, e.g. "31 Jan 2024"; a prefix such as "flown " or
"snapshot " when it says what the date is).

## The object

| Key | Contents |
|---|---|
| `schema` | `'alto.tree-record/1'` |
| `loaded` | `true` when built from the full record; `false` from a map tile |
| `id`, `shortId`, `url`, `mapUrl` | canonical tree ID, short form, tree page and map links |
| `request` | `{input, canonical, status, resolvedBy, note}` from the ID resolver |
| `release` | `{data: 'v6', dev, datasetVersion, updated, public{text: 'Release 11 Oct 2026 · Tool 0.2.0', preview}, snapshot, bucketSchema, tool, status, statusText, label, methodsHref, repository}`; `public` is the release as the interface names it (by its date; the number stays in provenance) |
| `citation` | citation string with tree ID, data and tool versions |
| `identity` | `{title, latin, nameKind: recorded\|model\|none, nameNote, category, detection, growthForm, protection, protectionStatus, notable, evidence, crownLink, quality, primarySource, badges[{key,label,tone,title}], recordCount, sources[{key,label,count}], recordSources[{key,label}], position{lon,lat,basis}, crownRepresentative}`. `protection` is the schedule entry or `null`; `protectionStatus` is said for every tree: `{status: protected\|not_protected\|unknown, label, entry, schedule, law: 'Auckland Unitary Plan, Schedule 10', line, sentence, checked, source}` (`unknown` only for a map-tile record whose tile does not carry the flag; `checked` says what "not protected" was checked against: the Notable Trees schedule as published in the release). `sources` names every kind of evidence on the crown; `recordSources` only the datasets of the records counted in `recordCount`, and the records badge (`N records · M sources`, with `records` and `sources` counts) uses it |
| `measures`, `measureOrder` | key measurements by key, in display order: `species`, `growthForm`, `height`, `crownArea`, `crownOutline`, `crownDiameter`, `trunkDiameter`, `rootProtection`, `lifeStage`, `benefits`, `carbonStored`, `stormwater`, `replacementYears`, `irreplaceability`, `protection` (each a Quantity; absent when the record has no value) |
| `records`, `moreRecords` | every source record on the crown, this tree first: `{treeId, self, mapMarker, detection, source{key,name,kind,group}, role, sourceId, objectId, href, species{common,latin,basis}, owner{raw,class}, snapshot, position, link{class,text,score,edgeDistance,topDistance}, protection{label,type}, crosswalk{from,to}, review, streetView}`; `moreRecords` = linked records not loaded |
| `identifiers` | every code that identifies the tree `{kind, code, href, tree_id, self, note}` |
| `bySource` | `{columns[{key,label,when,height,crownDiameter,crownArea,outlineArea,trunk,trunkKind,form,formKind,note,heightNote,method}], rows[{key,label,unit}]}`: values side by side by source (v5 crown, v4 crown, raster crown, canopy height at the record, 2016/2013 LiDAR, the source record, KYTE) |
| `outline` | how the crown and its links were drawn: `{segmentation{text,method}, crownKey, cellArea, gapFilled, smoothed{area,method,methodRef}, structure{call,merged,kind:'model'}, recordsOnCrown, inventoryRecords, earlierCrownsOverlapping, laterCrownsOverlapping, recordLink{text,class,edgeDistance,score,method}, evidenceTier{key,label}, review{status,reason}}` |
| `lidar` | `{profile{bands[], bandHeight:1, total, basis, crownTop, source} \| null, measurements[Quantity], points}` (points below) |
| `species` | `{recorded{name{common,latin}, asSupplied, source, basis, classFromName}, growthForm, growthFormStatus: scored\|not_scored\|not_in_release, legacy{model, calibrated:false, probabilities[]}, photoLead}` |
| `surveys` | 2013, 2016, 2024: `{year, status: matched\|absent\|outside\|none, line, outline, height: Quantity\|null, matchedHeight, area, cover, position}`; `position` `{lon, lat, basis}` is where an earlier survey's canopy was matched to this tree (the trajectory point), `null` for 2024 and unmatched years |
| `surveyChange` | `{rates[{from, to, value}], unit:'m/yr', implausible, fate, provenance}` from the matched canopy heights, or `null` |
| `setting` | where the tree stands, as joined by earlier builds (each part with provenance): `water{floodPlain, floodProne, floodProneMaxDepth, overlandFlowDistance, stormwaterPipeDistance, catchpitDistance}`, `heat{airTempMean, airTempMax, paved, buildings, trees}`, `surface{impervious, roads, buildings, other, radius:30}`, `neighbourhood{neighbours25, neighbours50, nearestTree, canopy25, canopy50, growthSetting, edgeTree, dominance, clusterSize}` (earlier crown); `null` when none is stored |
| `benefits` | `{status: estimated\|scenario_only\|not_estimated, rows[{key,label,quantity{value,unit,text,detail},value}], total{value,low,high,text,rangeText}, method, classUsed{key,label,source}, confidence, uncertaintyFactor, lai, biomass{aboveKg,belowKg}, growthFormBasis, assumptions{}, note}` |
| `lifeStage` | the height class (decision TS-07): the release's stored `life_stage` (`key`: juvenile, young, semi-mature, mature, veteran) named by size (`label`: Very small, Small, Medium, Large, Very large; `web/tree-summary.js` `HEIGHT_CLASS`), from height as a share of the class reference height. `{status, key, label, band, detail, definition, scale[{key,label,from,to,band,current}], referenceHeights, age: null}`. The `lifeStage` measure (label "Height class") adds `share` (the whole per cent printed, kept inside the class's band; `null` when the height shown falls outside it) and `band` |
| `replacement` | `{years, startYear, reachYear, rate, marks[{share,year}], irreplaceability{key,label,definition}, classes[{key,label,rule}], cost: null}` (no dollar replacement cost exists in the data) |
| `roots` | root-space scenario, or `null` when the release has none for the tree: `{kind:'scenario', rpaRadius, rpaArea, rpaRange{low,high,areaLow,areaHigh} \| null, rpaBasis, rule{factor:12, areaCap:707}, trunk{central,low,high,kind}, stored{rpaRadius,rpaArea,dbh}, effectiveRadius, effectiveArea, foragingRadius, constraint, basis, method, confidence, provenance}`. Present whenever the release stores a protection radius (a LiDAR-detected tree has one without an effective rooting radius). `rpaRadius` is 12 × the central trunk estimate (area capped at 707 m², the release's rule), `rpaRange` the radii of the lowest and highest trunk models; `stored` keeps the release's own values (from one model) |
| `context` | comparisons with similar trees (below) |
| `history` | `{status, source: 'record', releases[{release, date, crown{key,height,area,method}, role, evidence, events[{kind,text,method}], current}], lineage, lineageStatus, lineageReleases, lineageSource}`: crowns, links and repairs from the record's own fields; map-marker and ID changes (`kind: 'id'`) from `tree_history` when published. Roles are stated only where the record holds them for that release (v4 and the release on the page) |
| `corrections` | `{status: ready\|none\|pending, items[{id, kind, basis: record\|ledger, date, summary, by, status, appliedIn[], outcome, evidence[], basedOn[{kind,ref,date,summary}]}], receipt{release,generated,ledger,matches,url}, receiptStatus}`; a field observation the record holds (`ref`: its observation ID) that a decision cites in its `evidence` (`tree_field_observation_v5:<id>`) is folded into that decision's `basedOn`, so one review is listed once |
| `imagery` | `{status, current{source,date,resolution,provider}, surveys}`; `surveys` (from `tree-imagery.js`): `{status: available\|not_available, provider, archive, catalogue, licence, surveys[{id,label,kind,gsd,start,end,title,licensors,collection}]}`, the LINZ aerial surveys of Auckland since 2010 that the tree page reads at the tree in the browser (keyless, from LINZ's open imagery archive; the page's "Aerial imagery through time" section draws the crown in each survey that covers it) |
| `place` | `{status, board{name,canopyCover,canopyCoverBasis}, outsideBoards, landType{key,label,basis}, parcel{status,id,landType,zone,area,canopy,canopyCover,trees,benefits,href}}` |
| `nearby` | `{status, radius, basis, trees[{treeId,title,nameKind,protected,source,height,crownArea,distance,href}]}` |
| `photos` | `{status, visits[] (KYTE API), lead{name,common,score,organ,source}, live}` |
| `scenario` | `{status, kind:'scenario', anchor{year,height}, points[{year,height,low,high}], rate, personalRate, neighbourWeight, model{id,validation}, basis}` |
| `know` | KYTE routes `{task: species\|age\|removed\|outline, title, text, href: <kyte>/?tree=<id>&task=<task>&release=<dataset version>}` (KYTE `docs/REPORTS.md`; `release` is left out when the metadata gives no dataset version) |
| `provenance` | all provenance entries on the record, for footnotes |

### `context`: where the tree sits among comparable trees

```
{status: ready | not_published | release_mismatch | no_class | none | pending | unavailable,
 release, generated, class{key,label,source}, population, metrics,
 self{inPopulation, basis},
 scopes[ {scope: street|board|auckland, name, status, definition, n,
          metrics{height|crownArea|benefits: {value, unit, percentile, share, rank, of, exact, text, distribution}},
          irreplaceability{key, inClass, shareInClass, shareAtOrAbove, n, counts} } ]}
```

`distribution` is the group itself, for drawing it: `{kind: 'values', values[]}` (a small street group, sorted)
or `{kind: 'quantiles', quantiles[], probabilities[]}`.

Comparable trees are the release's current crowns with a benefit estimate (one per crown, the set the
release totals use) of the same tree class (the class the benefit estimates used:
`services.species_class`). `percentile` is the share of the group below the tree's value (ties split
evenly); `share` rounds it down so a statement never overstates; `text` is a data-sheet phrase
("Taller than 87%", "Top 1%", "3rd tallest of 27"). Small street groups are published as their sorted
values, so their ranks are exact (`exact: true`). A street is compared only when at least
`MIN_STREET_N` (10) trees of the class share it: a smaller street group keeps its name and `n` with
`status: 'small'` and no metrics ("Tallest of 2" says nothing), and pages leave its row out and state
the rule. Regrowth time is crown area ÷ a class growth rate, so
within a class it ranks exactly as crown area; irreplaceability is given as the share of the group in
the tree's class and in that class or higher.

## Derived files

Looked up in `release-metadata.json` `derived_products` (path from the site root) first, then in
`env.derivedBase`. Each states the `release` (dataset version) it was built for; a file built for
another release is not used.

| File | `derived_products` key | Contents |
|---|---|---|
| `tree_context/comparisons.json` | `tree_context` | `{schema:'alto.tree-context.comparisons/1', release, release_label, generated_utc, population{description,short,n}, classes{key:label}, metrics{key:{label,unit,field}}, probabilities[0…100], auckland{class:{n, q{metric:[…]}, irr{class:count}}}, boards{name:{class:{…}}}, board_layer, streets{path:'streets/{z}/{x}/{y}.json', zoom, max_distance_m, source}}` |
| `tree_context/streets/{z}/{x}/{y}.json` | (via `streets.path`) | `{addresses[[lon,lat,streetIndex]], streets[{name, board, groups{class:{n, values{metric:[sorted]} \| q{metric:[…]}}}}]}`; a tree's street is the street of its nearest address point within `max_distance_m` |
| `tree_history/index.json` + `{shard}.json` | `tree_history` | built by `pipeline/tool/build_tree_history.py` from the tree-ID audit's release comparison: `{release, source, transitions{release: n}, releases[], shards, path:'{shard}.json', changes{code: wording}}`; shard = FNV-1a(tree ID) mod `shards`, hex; each shard `{tree_id: [{release, change, moved_m, seg_from, seg_to, role_to}]}`. The record merges these events into `history.releases` |
| `tree_points/index.json` | `tree_points` | `{release, format:'alto-points/1', subset, source, crs, quantum, trees{id:{file,n,bytes,origin}}}` or `shards` + `shard_path` |
| `corrections-applied.json` | `corrections_applied` | the release's receipt of the corrections ledger (`alto-corrections/1`, `release_tools/corrections.py` in the research repository): a `corrections` list (also accepted: `applied`, `items`, `decisions`). An item belongs to the tree when any tree ID anywhere in it (subject, object, crown `anchor_tree_id`, observation `filed_under_tree_id`) is the tree or another record on its crown, or any `seg_key` in it is the tree's crown. Shown: `id`, `type`, `decided_on`, `reviewer`, `summary`, `status`, `outcome` (applied, recorded_in_release, …), `reason`, `applied_in` |
