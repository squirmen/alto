# Crown continuity repair (v5.1)

Release v5.1 (`20261008-v5.1`, published 9 October 2026) reconnects existing records to existing
crowns. It does not redraw the canopy or establish new tree growth. The code is in
[`pipeline/v51`](../../pipeline/v51).

## What failed in v5

v4 linked inventory points up to 3 m from a crown, and earlier LiDAR detections up to 1.5 m away. The
v5 build kept only points that fall inside a crown polygon (`covered_by`) and are uniquely contained. A
point just outside a trimmed boundary, or inside an interior hole, therefore lost its crown. The stored
v4-to-v5 polygon intersections were kept as lineage but not used to recover the association, so a new
LiDAR detection could represent the crown while the long-standing register record beside it showed
"No crown".

Both are processing versions of the same 2024 survey. Their disagreement is not evidence that a tree
disappeared or a new one grew.

## Extent

The audit (`audit_inventory_crown_links.py`) covers all 76,812 preserved inventory records. 27,784 were
unlinked inside v5 coverage. Of these:

- 21,664 (78%) have a current tree crown within 6 m of the source point;
- 17,607 have both a nearby current crown and a previous v4 crown link;
- 2,299 have both a nearby crown and a persistent historical trajectory;
- 6,120 have no tree crown within 6 m, which covers uncertain locations and missed segmentation as
  well as possible absence.

Six metres is the audit's search radius, not a linking threshold. Proximity makes a review candidate,
not a confirmed match.

| Inventory owner | Source records | Unlinked in v5 | Of those, linked in v4 | Restored in v5.1 | Still unlinked |
|---|--:|--:|--:|--:|--:|
| Auckland Transport | 32,793 | 18,762 | 11,923 | 3,518 | 15,244 |
| Auckland Council Parks | 16,699 | 5,494 | 4,164 | 470 | 5,024 |

A further 5,612 earlier LiDAR identities inside coverage have persistent histories but no v5
association; 5,197 have a current crown within 6 m and 673 meet the repair rules.

Close duplicates in the registers are common and are not only Auckland Transport against Parks: among
50,311 register records there are 1,957 pairs within 1 cm (1,559 with the same owner, 32 AT/Parks
pairs) and 12,659 pairs within 3 m. These are pair counts, not confirmed duplicate trees.

## Repair rule

Automatic restoration needs a unique, dominant continuation of an existing v4 crown:

- at least 50% of the old footprint and 60% of the new footprint overlap, with at least 4 m² of
  intersection;
- the source point is at most 3 m from the polygon for managed inventories, or 1.5 m for persistent
  historical detections;
- heights agree within the larger of 3 m or 25%, including any 2024 trajectory height.

Competing nearby crowns, a fragmented old crown, contributions from other old crowns, conflicting
recorded taxa, incompatible previous associations, contradictory histories and unverified locations
all cause abstention. Several records can regain a shared crown when their earlier crown and recorded
taxa agree; that is a crown association, not a claim that they describe one organism. The thresholds
are conservative engineering rules, not calibrated match probabilities.

## Result

**4,661 associations restored across 4,362 crowns**: 3,518 Auckland Transport records, 470 Parks
records and 673 earlier LiDAR records. 1,626 of the restored records have a preserved trajectory. Of
33,396 unlinked records audited, 28,735 remain for review.

The repair updates current links, representatives, identity summaries, group membership, current
crown and point-cloud measurements and display records together. When an inventory record replaces a
LiDAR detection as a crown's representative, the service, trunk and root scenarios are recomputed once
with the existing v5 equations for the recorded taxon, so only one set counts per crown. The affected
annual service total changed from NZ$289,401 to NZ$361,787 under the existing model assumptions,
with crown geometry unchanged. Every decision, including abstentions, is kept with its reason and
spatial evidence in `tree_crown_link_repairs_v5`.

Verification (`verify_crown_link_repair.py`) checks that:

- all 9,387 affected source rows are unchanged;
- the 4,362 affected crown rows match their originals except for the representative ID;
- all 2,371,898 trajectory rows have the same logical SHA-256 before and after;
- all 6,238,420 tree records and 3,352,851 v5 crown polygons remain, and display rows fall by exactly
  4,661 without deleting any source identity;
- every repaired group has exactly one display representative and one current set of estimates.

`test_crown_link_repair.py` has 13 focused cases: points in holes, position offsets, competing crowns,
fragments, taxon and height conflicts, absent or ambiguous history, shared records, and preservation of
unlinked earlier detections.

## Worked examples

- `akl_tree_trp_ACCT0255252`: the source point lies in a hole in the v5 polygon, 0.09 m from its
  filled outline. The current 101.25 m² crown lies entirely within the earlier footprint with
  compatible height. The register record is restored as the representative and the LiDAR detection
  `akl_tree_pc5_07d63b73c211a292949a` stays linked. The undersized outline and its hole are unchanged
  and need separate geometry work.
- Magnolia `akl_tree_trp_ACCT0238479`: two further Auckland Transport records (`ACCT0060116`,
  `ACCT0243631`), about 4 mm apart, sit 2.19 m outside the v5 polygon and were linked to the same v4
  crown. The polygon keeps 87.7% of that footprint. Both are restored to the existing representative;
  this does not certify that three records describe one trunk.
- Magnolia `akl_tree_trp_ACCT0060118`: 2.77 m outside a crown whose v4 and v5 footprints overlap by
  94–95%. The register record becomes the representative again; the LiDAR detection stays linked.
- Nearby `ACCT0060119` and `ACCT0060120` stay in review: their candidates are 4.13 m and 3.40 m away
  and they had no prior crown link. A consistent offset along a row is a hypothesis for review, not a
  reason to shift the row.

## What changed on the map

- Map markers, profiles, property summaries, release totals and KYTE nearby suggestions were all
  rebuilt from the same repaired database: 3,577,365 trees on the map (from 3,581,353).
- "Crown unlinked" replaces "No crown". Failing to link a source position does not establish that a
  tree is absent.
- A profile whose link was restored says so and notes that the polygon was not redrawn.
- All 6,238,420 source IDs, source positions and survey histories are kept; former representatives
  remain as linked records. Ground visits already accepted from KYTE were preserved.
- `cleanup_inferred_without_crowns.py` (base pipeline) used to delete LiDAR identities and their
  measurements because they lacked a crown. It now opens the database read-only and only reports them.

## Limits

- v5 polygon geometry, including known holes and clipped edges, is unchanged. Crown completeness is a
  separate problem.
- 28,735 audited candidates still need review; proximity alone is not enough to attach a record.
- A restored association does not certify that every linked source record describes the same tree.

Record-to-crown linking for the records v5.1 left unlinked is the v5.2 release; see
[`../v52/linking.md`](../v52/linking.md).
