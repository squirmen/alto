# Record-to-crown linking (v5.2)

Release v5.2 (`20261010-v5.2`, published 10 October 2026) joins tree records that v5.1 left without a
crown to the crowns they stand on. It does not redraw v5 crowns, and no record, source position or
survey history is removed. The linker is in [`pipeline/v52/linker`](../../pipeline/v52/linker) and the
release tools that merge its output into the map are in [`pipeline/v52`](../../pipeline/v52). Method
id: `record_crown_link_v52`.

## The problem

After v5.1, 37,409 records from Auckland Council's tree register (Auckland Transport and Parks), the
notable trees overlay, OpenStreetMap and the kauri observations still had no crown. Most sit a metre or
three outside a crown edge, which v5's polygon-containment rule rejects, and many digitised register
rows show on the map as lines of orange points beside the trees they describe.

The obvious training set does not help: every existing link is a record inside, or within 3 m of, its
crown by construction (v4 linked within 3 m; v5 kept points that fall inside). The offsets that matter
are exactly the ones the earlier rules rejected. So the linker learns them from the unlinked records
themselves.

The linker read the v5.1 continuity-repair database read-only and wrote only new files keyed by
`tree_id` and `seg_key`. Each output row records the crown set it was matched against
(`crown_set_id`) and a hash of the code.

## What came out

Of the 37,409 unlinked records, 13,613 lie where there are no v5 crowns and no 2024 point cloud
(12,925 kauri observations in the Waitākere Ranges and other forest, 687 notable trees, one
OpenStreetMap tree) and cannot be linked by any method. The other 23,796 were placed:

| Source | Linked, high | Linked, medium | Crown drawn from the record | Needs review | Tree, no crown | No tree found | Position unusable | Outside coverage | Total |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Kauri observations | 22 | 0 | 1 | 851 | 2 | 46 | 0 | 12,925 | 13,847 |
| Notable trees | 9 | 30 | 10 | 657 | 26 | 69 | 21 | 687 | 1,509 |
| OpenStreetMap | 33 | 121 | 99 | 718 | 59 | 325 | 4 | 1 | 1,360 |
| Register, Auckland Transport | 853 | 861 | 412 | 8,646 | 679 | 3,690 | 103 | 0 | 15,244 |
| Register, Parks | 144 | 460 | 71 | 3,854 | 255 | 653 | 12 | 0 | 5,449 |
| **All** | **1,061** | **1,472** | **593** | **14,726** | **1,021** | **4,783** | **140** | **13,613** | **37,409** |

- 2,533 records were linked to an existing v5 crown (1,061 high, 1,472 medium) and 593 to 538 crowns
  drawn from the point cloud where v5 drew nothing (1,232 such crowns were drawn in all; the rest are
  offered for review).
- 14,726 need review. Each carries its top three candidates, so review starts from a proposal.
- 5,944 are without a crown for a stated reason: 1,021 stand on tree-height returns that no crown
  covers and on which no plausible crown could be drawn, 4,783 have nothing of tree height within 3 m,
  and 140 sit on a roof with nothing of tree height near.

## Method

The chain is a set of short scripts, each with a docstring saying why it exists;
[`run_all.sh`](../../pipeline/v52/linker/run_all.sh) runs them in order.

### Evidence at every record (`features.py`, `saddle.py`)

For every record of the four sources inside v5 crown coverage (63,199, linked and unlinked), the area
around it is rebuilt on v5's 0.5 m grid from the 2024 LiDAR point cloud and the LINZ 2024 7.5 cm
RGB+NIR imagery, read as windows from the public cloud-optimised GeoTIFFs.

- **Candidates:** every v5 crown of class tree or low canopy within 40 m (the nearest 30 by edge
  distance).
- **A height model from every non-ground return** (LAS classes 1, 3, 4 and 5), not only the vegetation
  classes v5 used. LINZ left many palms unclassified (class 1), which is why v5 could not see them.
  Ground, building, noise, water and bridge returns are excluded and building-dominated cells are
  masked. Unclassified-only cells count as tree only where the imagery is green (NDVI ≥ 0.25 within
  1.5 m, since relief displaces a tall thin crown in the orthophoto).
- **Point evidence** at 1.5, 3, 5 and 8 m: tree-height cells, how many no crown covers,
  vegetation-class against green unclassified-only cells, building share, NDVI, and returns above
  2.5 m by class.
- **A record-seeded crown** wherever uncovered tree-height returns stand within reach of the record
  (4 m for register and OpenStreetMap points, 8 m for notable trees and kauri observations). It is
  drawn with v5's recipe (1 m pit fill, 0.75 m smoothing, watershed from local maxima, cells below 0.6
  of the top trimmed) on cells no v5 crown covers, capped at a radius plausible for the taxon (3 m for
  palm-like taxa, 5 m for *Phoenix* and *Jubaea*, otherwise 0.35 × the i-Tree mature height within
  3–10 m).
- **Saddle test:** a seeded crown touching a v5 crown is walked top to top on the raw maxima. If the
  canopy never dips below 0.85 of the lower top, it is the same tree (v5's trim left a shoulder, or a
  palm's fronds made a second peak) and is not offered.
- **Gates** a seeded crown must pass: height 2.5–50 m, area ≥ 1.5 m², building overlap ≤ 0.02,
  vegetation-class returns or NDVI ≥ 0.15, and v5's own shape range (elongation ≤ 2.1, bounding-box
  fill ≥ 0.42). These are rules, not learned values.

### Positional error model (`errmodel.py`)

The error model is fitted the way astronomers cross-match catalogues (the likelihood-ratio method of
Sutherland and Saunders, 1992). Around every unlinked record it counts crowns by edge distance and
crown size; around decoy points 25–45 m away, on the same streets and in the same kind of canopy, it
counts crowns that are unrelated by construction. An EM fit separates "one true crown at offset d",
"unrelated crowns at a background rate" and "no crown". The evidence an offset carries is the log
ratio of the two, made non-increasing with distance.

What it shows:

- **Register offsets are short-tailed.** About 75% of Auckland Transport and Parks records whose crown
  exists are within 3 m of its edge, and few are beyond 5 m. Measured to the crown edge, offsets do
  not grow with crown size (median 1.6–2.0 m in every size class); measured to the crown top they are
  4–12 m, which is why the score uses the edge.
- **There is no systematic direction.** The mean vector from record to crown top is 0.1–0.4 m against
  mean offsets of 4–12 m. There is no kerb-side bias to correct.
- **Notable-tree positions are bimodal:** about 30% within 1 m of the crown edge and 30% at 8–13 m
  (lot or property points). At 10 m, offset alone cannot identify the tree, so most notable records go
  to review unless size and taxon single one tree out.
- **Many unlinked records have no crown to find.** Only 40% of unlinked Auckland Transport records
  (61% Parks, 43% OpenStreetMap, 44% notable, 64% kauri) have their crown among the v5 crowns. A
  separate estimate puts the share standing on a tree v5 never drew at 12% (AT), 9% (Parks), 25% (OSM),
  17% (notable) and 5% (kauri). The rest are records of trees no longer there, trees below tree height,
  or positions too poor to resolve.

| Source | Unlinked in coverage | Share whose crown exists | Inside | 0–1 m | 1–2 m | 2–3 m | 3–5 m | 5–10 m | > 10 m |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Kauri observations | 921 | 0.64 | 0 | 0.43 | 0.32 | 0.13 | 0.09 | 0.01 | 0.01 |
| Notable trees | 820 | 0.44 | 0 | 0.29 | 0.03 | 0.08 | 0.10 | 0.25 | 0.25 |
| OpenStreetMap | 1,359 | 0.43 | 0.13 | 0.42 | 0.14 | 0.08 | 0.10 | 0.12 | 0.01 |
| Register, Auckland Transport | 15,244 | 0.40 | 0.02 | 0.32 | 0.23 | 0.20 | 0.21 | 0.01 | 0.01 |
| Register, Parks | 5,449 | 0.61 | 0 | 0.36 | 0.23 | 0.15 | 0.19 | 0.06 | 0.01 |

The distance columns are the fitted distribution of the record's distance to its true crown's edge.

### Run alignment (`runs.py`, `runs_null.py`, `runs_real.py`), tested and not used

Register records with consecutive tree IDs less than 25 m apart form digitised runs. Each run was
given one common shift, found by RANSAC over record-to-crown-top vectors. The first version accepted
543 shifts of median 7.4 m, but a null test showed that was chance: moved 45–70 m away from any true
tree and aligned the same way, half of all runs found a convincing-looking shift. With shifts bounded
to 6 m and a threshold at the 99th percentile of null runs, 25 runs are shifted and 34 of their
records end up linked. Digitised rows are real, but in this data they are not systematically
displaced. **Row alignment is off in the release**; the 34 links that relied on a shift went to review.

### Scoring and joint assignment (`link.py`)

Each record's options are its candidate crowns, its seeded crown if one passed the gates, and "none".
An option's utility is a weighted sum of:

- the error-model evidence for its edge distance;
- whether the crown's height and area suit the recorded taxon (genus where it has at least 15 trusted
  links, otherwise an i-Tree growth-form and mature-height class);
- a conflict flag when the crown already holds a record of a different genus;
- the crown's capacity cost, fitted on v5.1 crowns (a 400 m² merged row crown takes a second record
  for 0.8 nats, a 20 m² crown for 2.4);
- a low-canopy flag; and, for seeded crowns, a prior that the record's tree is one v5 did not draw.

Weights are fitted as a conditional logit on simulated records (below). Records are assigned together
in each connected neighbourhood by min-cost assignment, with one slot per crown priced by the capacity
term and a private "none" per record. A merged row crown can take several records, but a small crown
cannot take five, and two records never both take a small crown when one has its own. A record's
**margin** is the utility the best joint solution loses if its choice is forbidden, which includes the
no-crown option.

### Confidence and status (`evaluate.py`, `final.py`)

Confidence is the probability that a link is correct, from a small boosted model on the margin and on
evidence the utility does not carry (runner-up distance, uncovered tree-height cells near the point,
whether the record's own seeded crown was set aside, crowding, source). It is cross-fitted on the
hold-out.

- `linked_high`: confidence ≥ 0.97. `linked_medium`: ≥ 0.85 (kauri observations: high only).
- An existing-crown link is sent to review instead when the simulation cannot have taught the model
  about it: a point on a roof with the crown more than 1 m away; at least 1 m² of uncovered tree-height
  returns at the point with the crown more than 2 m away; a crown size implausible for the taxon; or
  nothing of tree height at the point and the crown more than 1 m away. The last is the signature of a
  removed or never-planted street tree beside a garden tree; audited links of that kind were right only
  about 80% of the time. This guard alone moves 2,242 records from linked to review.
- `linked_new_crown`: the seeded crown is the record's best option, the record stands on or within 1 m
  of it, and the best alternative is at least 2 nats worse.
- When "none" is chosen: `needs_review` if a crown option is within 1 nat, otherwise `tree_no_crown`,
  `position_unusable` (on a building, nothing tree-height within 3 m) or `no_tree_found`.
- Records whose source position v5.1 flagged as unverified (647 notable trees) are capped at
  `needs_review`.

## Evaluation

Precision was measured two ways: a hold-out on simulated records with known answers, and a blind
visual audit of real records.

| | Linked, high | Linked, medium | High and medium | Crowns drawn from the record |
|---|--:|--:|--:|--:|
| Hold-out, weighted to the estimated share of crown-missing records | 0.989 | 0.936 | **0.965** | not measurable |
| Hold-out, every unlinked record without a crown counted as crown-missing | | | 0.919 | |
| Blind audit, validation rounds 2–4 (decided cards) | 47/48 = 0.979 | 33/37 = 0.892 | **80/85 = 0.941** | 31/37 = 0.838 |
| Blind audit, 95% interval | 0.89–1.00 | 0.75–0.96 | 0.87–0.97 | 0.69–0.92 |
| Blind audit, "can't tell" counted as wrong (floor) | 0.76 | 0.51 | 0.63 | 0.69 |
| Design round 1 (rules before the last revisions) | 44/45 | 29/32 | | 29/38 |

`linked_high` meets the 95% target by every measure. `linked_medium` is about 89–94%, and crowns drawn
from the record about 84%. Many audited cards could not be decided from the picture (merged canopy, a
crown overhanging from a garden, dense groves); counting them as wrong gives the floor, which is not
an error rate.

### Hold-out (`simulate.py`, `evaluate.py`, `summarize.py`)

Hiding trusted links and finding them again is too easy here, because every trusted record already
sits inside its crown. So 31,119 trusted records were **moved to where an unlinked record of their
source would be**: an edge distance drawn from that source's learned offsets, in a random direction.
Runs of three or more trusted records moved together. A third of singly linked records were also
copied **with their crown deleted** (7,128): the right answer is then a seeded crown over the same
tree, or none, and never another crown. Point-cloud evidence was recomputed at every displaced point.
Five folds by record; each fold's records were matched together with every real unlinked record that
competes for the same crowns.

| Status band | Records | Precision (weighted) | Precision (pessimistic) |
|---|--:|--:|--:|
| `linked_high` | 4,307 | 0.989 | 0.957 |
| `linked_medium` | 3,621 | 0.936 | 0.874 |
| `needs_review` | 27,030 | 0.608 | 0.368 |

By source, the precision of the two linked bands is 0.95–0.99 (kauri 0.993, notable 0.972,
OpenStreetMap 0.965, Auckland Transport 0.969, Parks 0.951). By offset, simulated records inside or
within 2 m of their crown edge are linked at 0.994–1.000 precision. Beyond 2 m the method rarely links
(recall near zero), and the few links it makes there (278 of 7,928) are mostly wrong. Recall is modest
by design: a record 1–3 m from its crown's edge usually has a second crown at a similar distance, and
the method declines to guess. Only 1.2% of the crown-deleted copies were linked to another tree's
crown, the failure naive matching makes routinely.

What each component is worth (each refitted with the same thresholds):

| Configuration | Auto-linked | Precision (weighted) | Recall | Crown-deleted copies linked to another crown |
|---|--:|--:|--:|--:|
| Full method | 7,928 | 0.965 | 0.245 | 0.59 |
| No error model (offset = −distance) | 7,979 | 0.960 | 0.245 | 0.715 |
| No run alignment | 7,879 | 0.965 | 0.244 | 0.59 |
| No taxon size plausibility | 7,751 | 0.964 | 0.239 | 0.606 |
| No capacity or conflict terms | 7,213 | 0.965 | 0.223 | 0.665 |
| No record-seeded crowns | 7,955 | 0.965 | 0.246 | 0.606 |
| Naive: nearest crown edge within 3 m | 29,636 | 0.657 | 0.599 | 0.404 |
| Naive: nearest crown edge within 5 m | 34,603 | 0.649 | 0.684 | 0.616 |

The last column counts copies linked in any band, including review proposals.

### Blind visual audit (`audit.py`, `audit_score.py`)

Audit cards show the 2024 colour chip, a near-infrared false-colour chip and the LiDAR height of every
non-ground return (unclassified-only cells outlined, building returns grey), with the record point,
the proposed crown, neighbouring crowns and other records. Status, band and score are not printed: each
card was judged from the picture alone (correct, wrong or can't tell) and the strata were joined
afterwards. Round 1 (223 cards plus 52 records without a crown) was the design round; it found the
failure modes behind the seeded-crown shape, building and saddle rules and the review guards. Rounds
2–4 used fresh records under the final rules. The last guard came from round 3, so round 4 alone is a
clean test; it gave 34 of 35 for the two existing-crown bands.

| Round | Status | Cards | Decided | Correct | Precision (decided) | 95% interval |
|---|---|--:|--:|--:|--:|---|
| 2–4 combined | `linked_high` | 62 | 48 | 47 | 0.979 | 0.891–0.996 |
| 2–4 combined | `linked_medium` | 65 | 37 | 33 | 0.892 | 0.753–0.957 |
| 2–4 combined | `linked_new_crown` | 45 | 37 | 31 | 0.838 | 0.689–0.923 |
| 1 (design) | `linked_high` | 58 | 45 | 44 | 0.978 | 0.884–0.996 |
| 1 (design) | `linked_medium` | 48 | 32 | 29 | 0.906 | 0.758–0.968 |
| 1 (design) | `linked_new_crown` | 40 | 38 | 29 | 0.763 | 0.608–0.870 |

**Wrong links seen.** On existing crowns: a garden hedge, shrub or lawn-level crown behind the fence
taken for a street tree whose berm is empty (the commonest; most are now caught by the
no-tree-at-the-point guard); a crown chosen over a more plausible tree of the recorded taxon a few
metres away; a crown taken where a small separate tree stands at the point. On seeded crowns: building
parapets, awnings and roof edges, parked vehicles beside berm trees, slivers of a hedge or the trimmed
edge of a large canopy, and a row of small trees drawn as one. Whether the crown lies on a property
parcel was tested as a fix and rejected: 85% of Auckland Transport records' true crowns are on the
road reserve, but the flag did not separate wrong links from right ones.

**Records left without a crown.** 41 of 52 audited were right to be left without one (roofs, berms
and footpaths with nothing of tree height, kerbs in front of buildings, a construction site); none was
a missed link.

**Seeded crowns.** Of 1,232 seeded crowns, 538 carry a linked record. Their heights run 2.8, 4.4 and
8.3 m at the 10th, 50th and 90th percentiles, and their areas 2.8, 8.2 and 28.2 m². 237 are dominated
by unclassified returns (the palms v5 could not see) and 216 are 2–3 m tall. The hold-out cannot
measure them: its deleted crowns are v5 crowns, green and vegetation-classified, not the isolated palms
and off-colour trees that are really missing. So seeded crowns are linked by a rule and measured by
the audit. Golden and bronze foliage (low NDVI) and leaf-off trees were among the correct ones.

### Worked examples

| Record | Result |
|---|---|
| Fan palm `akl_tree_trp_ACCT0159885` | Probable link to the small palm crown 1.6 m away. The palm's uncovered fronds made a second peak; the saddle test recognised it as the same tree. |
| Wattle `akl_tree_trp_ACCT0257674` | Probable link, 1.3 m from the crown edge. |
| Kōwhai `akl_tree_trp_ACCT0248773` | Crown drawn from the record: a 5.3 m, 7 m² tree at the point that v5 never segmented. The v5 crown 3.5 m away is a different tree. |
| OpenStreetMap tree `akl_tree_osm_node_7713504718` | Crown drawn from the record: an 8 m, 29 m² golden-leaved tree with 115 vegetation returns and NDVI 0.09, which v5's NDVI gate dropped. Nearest-crown matching would have taken the different tree 2.9 m away. |
| *Trachycarpus* palm `akl_tree_trp_ACCT0151353` | Crown drawn from the record on the palm itself (8.9 m, 9 m², 94% of its returns unclassified). |
| Cabbage tree `akl_tree_trp_ACCT0169814` | No tree found: nothing above 2.5 m within 3 m of a median planting. Left unlinked. |
| Matipo `akl_tree_trp_ACCT0109736` | Position unusable: on a roof, in an evenly spaced digitised row with the nearest crown 30 m away. Left unlinked. |

### Kauri observations

Kauri dieback surveillance points are handheld GPS positions in forest. Of the 922 inside coverage,
22 are linked (high band only, by rule) and 851 go to review. Every point has several crowns within its
GPS error. Kauri should be linked from the field, for example from the observation's own photographs,
or by a kauri-specific crown classifier, not by position.

## What v5.2 published

Decisions taken on 10 October 2026 from the evaluation above:

1. `linked_high` and `linked_medium` are published as links, classes **linked** and **probable**. The
   record joins the crown and its map marker moves to the crown. The source point stays in the full
   record (`source_lon`, `source_lat`) and in the Council recorded positions layer.
2. A record joining a crown that already has a marker becomes a member of that tree: it is listed in
   the tree's profile and gets no second marker.
3. Marker precedence on every crown: a protected or notable record first, then linked before
   probable, then confidence, then distance to the crown top. A protected or notable tree never loses
   its marker. One protected record took the marker from an ordinary record, which stays a member; 14
   protected records that joined a crown already represented by another protected tree keep their own
   marker at their recorded position. The crown's estimates are still counted once.
4. Crowns drawn from a record (class **drawn from the record**, `crown_source` `record_seeded_v52`)
   are drawn faintly, counted in totals and service estimates with a flag, and await confirmation.
   Drawn crowns under 3 m follow v5's low-canopy rule: shown, not counted.
5. Before merging, every link was checked against the v5.1 release database: the record must still be
   unlinked there, its source identity and position unchanged, and a drawn crown must not overlap any
   v5 tree or low-canopy crown. Four drawn crowns enclosed a small existing v5 crown; those links were
   excluded and stay in review.
6. Row alignment is off. Records outside coverage stay unlinked with their reason.

| | v5.1 | v5.2 | Change |
|---|--:|--:|--:|
| Records joined to a crown | | 3,088 | 1,043 linked, 1,456 probable, 589 drawn from the record on 534 crowns |
| Trees on the map | 3,577,365 | 3,574,825 | −2,540 |
| Crowns counted | 3,522,567 | 3,523,024 | +457 (77 low-canopy drawn crowns not counted) |
| Protected or notable trees on the map | 3,570 | 3,570 | 0 |
| Annual value estimate | | | +NZ$47,218 |
| Avoided runoff | | | +1,545 m³/yr |
| Stored carbon | | | −43.9 t CO₂e |

1,456 crowns are now represented by a register or other source record instead of a LiDAR detection,
and their service scenarios were recalculated once, with the existing v5 equations, for the recorded
taxon. The superseded estimates are archived in the release database. Every change to the totals is
attributed by cause in the published `data/record-links-v52.json`.

**Council recorded positions** is a new map layer, off by default (Layers tab). For every joined record
it shows where the source recorded the tree and a dashed line to the top of the crown it was joined
to. Point and line counts are checked against the release: exactly one of each per published link.

## What goes to review

20,704 records went to the review queue and appear on the map as before: 14,760 with competing crowns
to choose between (including the 34 that relied on row alignment), 4,783 with nothing of tree height
within 3 m, 1,021 on tree-height returns no crown could be drawn on, and 140 whose position cannot be
matched. The queue also asks for confirmation of each of the 593 crowns drawn from a record (21,297
records in all). Of the records needing review, 5,479 have a proposal holding at least 80% of the local
choice probability, so much of the queue is confirm-or-reject rather than search. Review labels are the
training data this linker lacks: real offsets and real removals.

## What stays unlinked

13,613 records lie where there are no v5 crowns and no 2024 point cloud: 12,925 kauri observations,
687 notable trees and one OpenStreetMap tree. Their full records carry a `record_link_status` saying
so. Extending crowns there needs point cloud beyond the metropolitan set. "Crown unlinked" on the map
does not mean a tree is absent.

## Limitations

- The hold-out is a simulation. Real unlinked records include felled trees and positions worse than
  any trusted record, which it does not contain, so the audit is the truer guide, and its samples are
  small (wide intervals).
- The review guards were set from the design audit rounds, not estimated, and validated on fresh
  records only in round 4.
- The error model's background comes from decoys 25–45 m away, which sample gardens and roofs as well
  as kerbs. A different decoy rule moves the share-with-a-crown estimate by up to 0.1.
- The 2024 imagery is mostly leaf-on. Leaf-off trees and golden or purple foliage have low NDVI, which
  is why seeded crowns accept vegetation-class returns whatever their NDVI.
- Taxon plausibility uses height and area only. It cannot tell deciduous from evergreen or read a
  conifer's shape.
- A link is spatial evidence that a record describes the tree on that crown. It does not prove that
  every record on a shared canopy is the same organism, and a drawn crown is a proposal until it is
  confirmed. v5 polygon geometry, including known holes and clipped boundaries, is unchanged.

## Rerunning

`pipeline/v52/linker/run_all.sh` reruns the chain (about two hours with eight workers). It
reads `LINK_DB` (opened read-only), `LINK_CROWNS` (the crown tiles) and writes under `LINK_ROOT`.
Everything that depends on crowns is recomputed: candidates, the cover mask the seeded crowns avoid, the
error model, run shifts, the simulation, weights and confidence. On a redrawn crown set, a fresh audit
round has to be drawn, rendered and judged before `report.py`; the audit is the measurement the
simulation cannot replace. Rows matched against different crown sets should not be merged.
[`pipeline/v52/README.md`](../../pipeline/v52/README.md) gives the order of the release build.

## Reference

Sutherland, W. and Saunders, W. (1992). On the likelihood ratio for source identification. *Monthly
Notices of the Royal Astronomical Society*, 259(3), 413–420.
