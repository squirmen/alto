# Permanent tree numbers (v6.1)

Release v6.1 (`20261013-v6.1`, dataset `metro-2026.10.13-pointcloud-v6.1`, published 13 October 2026)
gives every tree on the map a permanent number, publishes an alias table that resolves every tree ID and
crown key ALTO has published, and applies the corrections ledger in full. Crowns, measurements and
estimates are release 6's except on the trees a correction changed. Schema id of the alias table:
`alto-tree-ids/1`.

The release's own format, rules and counts are published with the data as `data/tree-numbers-v61.json`,
and the alias table is described by `data/tree_ids/schema.json`. The interface reads both through
[`web/tree-id.js`](../../web/tree-id.js), tested by
[`pipeline/tool/test_tree_id.cjs`](../../pipeline/tool/test_tree_id.cjs) and
[`pipeline/tool/test_tree_numbers_ui.cjs`](../../pipeline/tool/test_tree_numbers_ui.cjs). The release
notes page is [`web/v61-methods.html`](../../web/v61-methods.html). Tool 0.2.3 and later show the numbers.

## Why numbers

Before v6.1 a tree was named by the record ID (`akl_tree_…`) of the record chosen to represent it, or by
a crown key. The representative can change when a release redraws crowns or a reviewer moves a record,
and crown keys change when crowns are redrawn. A tree number names the tree as the map draws it. Record IDs stay what they were, the immutable key of each full
record, and every one of them, like every crown key, still resolves through the alias table.

## What carries a number

One number for each map marker after the corrections. A crown's number covers its marker, its outline
and every record on the crown.

| Map tree | Carries the number | Numbers |
|---|---|--:|
| Crown | the crown outline, its marker and every record on the crown | 3,523,098 |
| Earlier LiDAR detection | a release 4 detection that no current crown covers | 625,515 |
| Record with its own marker | a record with a marker and no crown of its own: Council, OpenStreetMap and notable-tree records without a crown or outside the survey, and 14 protected records that keep their own marker on a shared crown | 51,723 |
| **All map trees** | | **4,200,336** |

Of the 6,238,420 records, 4,200,336 are a tree's marker, 2,038,080 sit on another record's crown and carry
that tree's number, and 4 were merged into another tree by a reviewer correction and carry the surviving
tree's number. The map shows 3,574,821 trees; the 625,515 earlier detections are numbered too.

| Where | What |
|---|---|
| Map tiles (`trees_map_points.pmtiles`, `tree_crowns_pilot.pmtiles`) | `tn` on every point and crown feature |
| Full records (`data/tree_details/`, all 65,536 buckets) | dataset `tree_number`: `number`, `role` (marker, member or merged), `kind`, `status`, `representative_tree_id`, `minted_release`, `correction_id` |
| Alias table (`data/tree_ids/`) | every number, record ID and crown key; listed in `release-metadata.json` under `derived_products.tree_ids` |
| `data/tree-numbers-v61.json` | format, rules and counts |
| `data/corrections-applied.json` | the corrections receipt |

The fields are in [`docs/data-dictionary.md`](../data-dictionary.md) (Tree number).

## Format and check character

A tree number is `T` followed by 6 characters and 1 check character, from Crockford's base 32: the 32
characters `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O or U). Pattern: `^T[0-9A-HJKMNP-TV-Z]{7}$`.
Example: `TMCTT6X4`.

- **Input:** any case, with spaces or a hyphen (`tmct-t6x4`); I and L read as 1, O as 0. The canonical
  form is upper case with no separator.
- **Check character:** Luhn mod 32 over the 6 characters after `T`. Take each character's value (its
  position in the alphabet above). From the rightmost character leftwards, multiply by 2, 1, 2, 1, …;
  write each product in base 32 and add its digits (⌊p ÷ 32⌋ + p mod 32); sum them. The check value is
  (32 − sum mod 32) mod 32. A number is valid when the same sum over all 7 characters, with factor 1 on
  the check character, is a multiple of 32.
- **Worked example** (`MCTT6X`): X 29 × 2 = 58 → 1 + 26 = 27; 6 × 1 = 6; T 26 × 2 = 52 → 1 + 20 = 21;
  T 26 × 1 = 26; C 12 × 2 = 24; M 20 × 1 = 20. Sum 124; 124 mod 32 = 28; check value 4, character `4`:
  `TMCTT6X4`.
- **What it catches:** every single mistyped character, and 99.8% of swapped neighbouring characters.
  A number that fails its check is refused. The map's search and the tree page offer a correction ("did
  you mean …?") when exactly one number one keystroke away (one character changed, or two neighbours
  swapped) is in the release's alias table, and say "Not a valid tree number" otherwise.
- **Drawn at random:** each number is 30 random bits from the operating system's cryptographic source,
  about 1.07 billion possible numbers, checked against every number issued before. A number is never
  reused and encodes nothing about the tree.

## Permanent links

A tree's permanent link is `https://alto.tfwelch.com/tree/<number>`. Any older ID works in the same
place, and `tree.html?id=…` and the map's `?tree=…` links made before v6.1 keep working: the tree page
and the map read every ID through the resolver. The site redirects `/tree/<ID>` to the tree page rather
than rewriting it, because the page loads its scripts and data by relative paths:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^tree/([A-Za-z0-9_.:-]{1,190})/?$ /tree.html?id=$1 [R=302,L,QSA]
</IfModule>
```

Citations, Share, the print header and the page's canonical link use the number and its permanent link.
Selecting a tree on the map puts its number in the address (`?tree=T…`).

## The alias table

65,536 gzip-compressed JSON files, `data/tree_ids/{hh}/{hh}.json.gz`, hashed like the full records: the
FNV-1a hash (32-bit) of the key's UTF-8 bytes, mod 65,536, written as four lower-case hex digits split in
two (`fnv1a_utf8_mod65536_hex4_split2`). Each file is an object from key to row:

```
key -> [canonical, detail, status, successor, note, extra]      (trailing nulls omitted)
```

- `canonical`: the tree number the key resolves to (null for a number itself, a split or a retired key);
- `detail`: the record ID whose full record shows the tree (null: the key itself);
- `status`: below; `successor`: the surviving tree (merged), the parts, largest share first (split), or
  the tree that replaced it, if any (retired);
- `note`: why, as a code the schema explains (`v4_continues`, `v4_split`, `v4_outside_v5`,
  `v4_not_continued`, `deleted_pointcloud_false_positive`, `seeded_crown_retired`) or a correction id
  (`C#####`, listed in `data/corrections-applied.json`);
- `extra`: for a retired key, `p`, the last known position (longitude, latitude); a removed detection
  also gives `last_release` and `source_tree_id`.

Three rows: a number (the tree shown by its marker record), a release 4 crown key that continues, and a
LiDAR detection removed before the 9 September release:

```
86/2b.json.gz  "TMCTT6X4":             [null, "akl_tree_not_336", "current"]
00/00.json.gz  "3480992_11791538":     ["TXBME5FT", "akl_tree_lid_0000341", "current", null, "v4_continues"]
94/6e.json.gz  "akl_tree_lid_0001873": [null, null, "retired", null, "deleted_pointcloud_false_positive",
                                        {"p": [174.5830158, -37.0779744], "last_release": "2026-06-23 snapshot",
                                         "source_tree_id": "LID0001873"}]
```

| Key | Resolves to | Keys |
|---|---|--:|
| Tree numbers | the tree | 4,200,336 |
| Record IDs (`akl_tree_…`), releases 4 to 6 | the tree the record is on: its marker 4,200,336; on its crown 2,038,080; merged 4 | 6,238,420 |
| LiDAR detections removed before the 9 September 2026 release | retired, with the reason and the last position; no successor | 7,405 |
| Crown keys, release 5 on | the tree; 1 crown merged into another by a reviewer correction | 3,352,852 |
| Keys of crowns drawn from a record in release 5.2 | the tree; 3 retired after a reviewer moved their record (successor: that record's tree) | 534 |
| Release 4 crown keys | continues as one crown 4,336,452; split 189,399; drawn outside the release 5 survey 103; not continued 1,050,664 (retired; successor: the tree its representative record is on now) | 5,576,618 |
| **All keys** | | **19,376,165** |

| Status | Meaning | Keys |
|---|---|--:|
| `current` | the tree, its marker record or its crown | 16,090,609 |
| `member` | a record on the tree's crown without a marker of its own | 2,038,080 |
| `retired` | no tree carries it now; a successor where one replaced it, the last position where none did | 1,058,072 |
| `split` | divided between current trees, largest share first | 189,399 |
| `merged` | joined to another tree by a reviewer correction | 5 |

A release 4 crown continues as a current crown when at least half of it lies in that crown and no other
crown holds a fifth of it; it is split when several crowns each hold at least a fifth.

## How an older ID resolves

`ALTOTreeId.resolve(raw, {base, version, metadata})` in `web/tree-id.js` normalises the input, refuses a
number-shaped input whose check character fails, reads the key's file and returns the tree to show:
`{input, key, kind, tree_id, canonical, number, status, relation, successor, successors, note, reason,
position, last_release, source_id, record, resolved_by}`. `tree_id` is the record to load and `canonical`
the tree's number. A record, crown or member key comes back as `current`, with `relation` saying which.
`permalink(id)` gives the permanent link, `url(id)` the relative tree page link (safe under a sub-path),
and `fromLocation()` reads `/tree/<ID>`, `?id=` or `?tree=`.

- **Current or member:** the tree opens; when the input was not its number, one line says so ("Record
  ID akl_tree_… is tree T…").
- **Merged:** the tree page states the status and the reason ("Merged: reviewer correction C00004") and
  links to the surviving tree; the map opens the surviving tree with that line.
- **Split:** the page lists the trees that took its place, largest share first; the map opens the
  largest part.
- **Retired:** the page gives the reason, the last position, the last release and the source ID, and the
  successor if there is one; the map opens the successor, or for a tombstone the last position, with the
  reason.
- **Unknown:** "No tree has this number" or "Unknown tree ID".

With a data release that has no alias table (before v6.1), a well-formed record ID resolves to itself
and stays the tree's ID, so tools from 0.2.3 work with earlier releases and earlier tools keep working on
record IDs.

## Carry-over to later releases

The assignment of numbers is frozen for this release: a rebuild reuses it and stops if the map markers
differ. Later releases carry numbers over:

- a crown that continues (at least half of it in one new crown, no other new crown holding a fifth)
  keeps its number;
- when several numbered trees become one, the number with outside references, corrections or a source
  record survives (otherwise the one with the largest overlap), and the others are marked merged;
- a split keeps the number on the part holding the representative record and lists every part;
- a record-only tree that gains a crown keeps its number;
- a tree with no successor is retired with a reason and its last position;
- a change of representative record alone never changes a number.

The numbering and carry-over code is part of the release tools, which are not in this repository yet.

## Checks before publication

- 4,200,336 numbers, all distinct, all with a valid check character and none with I, L, O or U; every
  one of the 6,238,420 records carries its tree's number.
- Every record ID and crown key of every earlier extract resolves through the table: the 23 June 2026
  snapshot (including the 7,405 removed detections), the 9 September release, and releases 4, 5, 5.1,
  5.2 and 6. Of 287,556 references to tree IDs found by the tree-ID audit, 286,192 resolve; the 1,364 others were never published as trees (953 link-review candidate and
  near-canopy crown keys, 400 notable-tree IDs reserved but never used, 11 test fixtures).
- Every row of the 65,536 files equals the release table and sits in the file its hash names; 605
  lookups through `web/tree-id.js` return what the table says.
- Apart from the corrected trees, the map tiles equal release 6's except for `tn` on each point and
  crown.

## Corrections applied

v6.1 applies the corrections ledger in full: each decision is planned against release 6 and applied to
the affected records and crowns, and `data/corrections-applied.json` lists every outcome. Of the 354
corrections, 14 are applied (records moved to reviewed crowns, merges of markers and crowns that are one tree,
reviewer outlines, a near-canopy crown linked to its Council record, a reviewer species, a field visit
shown on the tree it photographed), 17 are recorded with their trees, 318 were already true and 5 await review; none is
pending. The map shows 3 trees and 3 counted crowns fewer than release 6. Details: `web/v61-methods.html`.

## Limits

- A number names a tree as mapped in this release. When a later release redraws crowns, a number can be
  retired, merged or split under the carry-over rules; its page then says which.
- Not in the alias table: near-canopy (low and sub-canopy) polygon keys other than the one promoted to
  a tree crown, KYTE's own visit IDs, 772 link-review candidate crowns and 400 notable-tree IDs reserved
  but never published.
- KYTE takes record IDs only, so its links from ALTO carry the record ID.
- The near-canopy layer still draws the low-canopy polygon under the crown promoted to a tree crown.
- Reviewer outlines change the crown area; the height stays the release 5.2 measurement of the crown
  drawn from the record.
- Five corrections await review and are not applied.
- Benefit and trunk estimates are not independently validated; they remain sensitivity scenarios.
