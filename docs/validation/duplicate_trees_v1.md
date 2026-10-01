# Duplicate / near-coincident trees — diagnostic

_Read-only scan of 304,347 trees with coordinates. Cluster radius 2 m._

## Near-neighbour pairs by radius

| Radius (m) | total pairs | cross-source | same-source | trees w/ a neighbour |
|--:|--:|--:|--:|--:|
| 1 | 2,468 | 25 | 2,443 | 3,541 |
| 2 | 7,182 | 55 | 7,127 | 9,601 |
| 3 | 12,762 | 72 | 12,690 | 13,490 |

## Duplicate clusters @ 2 m

- Multi-record clusters: **3,658**  (of which **55** span >1 source)
- **Estimated duplicate inflation: 55 records** (~0.0% of the inventory) if each cross-source cluster collapses to one tree.
- Clusters with a crowned tree **and** a no-crown record together: **2,465** (your observation — the same tree from two datasets, one carrying the crown).

## Worst-colliding source pairs (cross-source clusters)

| Source A | Source B | clusters |
|---|---|--:|
| low_canopy_promoted | pointcloud_missed_promoted | 55 |

---

**Read:** cross-source pairs at ≤2 m are very likely one physical tree described by two datasets. **Fix (next):** a dedup/merge pass that collapses each cross-source cluster to a single record, keeping the highest-evidence source (field-verified > crowd > inferred > promoted) and the best geometry (the crowned record), re-pointing trajectories/valuation. This also cleans the WS2 `removed_to_open` set (a removed tree shouldn't sit next to a surviving duplicate).
