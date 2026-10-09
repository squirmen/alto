"""Turn the linker's outputs into the v5.2 merge package, applying the publication decisions.

Publication decisions (10 Oct 2026), from the measured evaluation in out/REPORT.md:
  linked_high      published as a link, class "linked"            (hold-out 0.989, audit 47/48)
  linked_medium    published as a link, class "probable"          (hold-out 0.936, audit 33/37)
  linked_new_crown published on its record-seeded crown, class "drawn_from_record", shown faintly and
                   queued for confirmation in the workbench        (audit 31/37)
  outside_coverage left unlinked with its reason; needs point cloud beyond the metro set
  row alignment    off: it added nothing measurable; the 34 links that relied on a row shift become review proposals
Everything else (needs_review, tree_no_crown, no_tree_found, position_unusable) goes to the workbench queue.
Only record-seeded crowns that a record actually stands on are published; the other candidates are kept
for the queue but never shown on the map. Nothing here edits a database; v5.2 merges these files.
"""
import hashlib, json, os
from pathlib import Path
import pandas as pd

ROOT = Path(os.environ.get("LINK_ROOT", "/data/alto/working/link_v52_20261009"))
OUT = ROOT / "out"; PKG = OUT / "v52_package"; PKG.mkdir(exist_ok=True)
links = pd.read_parquet(OUT / "links_v52.parquet")
crowns = pd.read_parquet(OUT / "new_crowns_v52.parquet")

shifted = (links.applied_row_shift_dx.fillna(0) != 0) | (links.applied_row_shift_dy.fillna(0) != 0)
demote = shifted & links.status.isin(["linked_high", "linked_medium"])
links.loc[demote, "reason"] = "row_shift_link_held_for_review; " + links.loc[demote, "reason"].fillna("")
links.loc[demote, "status"] = "needs_review"   # alignment is off, so a link that needed a shift is a proposal only
print("links held for review because they relied on a row shift:", int(demote.sum()))
CLASS = {"linked_high": "linked", "linked_medium": "probable", "linked_new_crown": "drawn_from_record"}
pub = links[links.status.isin(CLASS)].copy()
pub["link_class"] = pub.status.map(CLASS)
pub["evidence_text"] = pub.apply(lambda r: {
    "linked": f"Linked to its LiDAR crown by position ({r.edge_distance_m:.1f} m from the crown edge)",
    "probable": f"Probable match to this LiDAR crown ({r.edge_distance_m:.1f} m from the crown edge)",
    "drawn_from_record": "Crown drawn from the LiDAR returns at this record's position; awaiting confirmation",
}[r.link_class], axis=1)
pub_cols = ["tree_id", "source", "source_tree_id", "seg_key", "crown_source", "link_class", "status", "confidence",
            "edge_distance_m", "top_distance_m", "shared_crown_n", "evidence_text", "lon", "lat",
            "method_id", "code_sha256", "crown_set_id"]
pub[pub_cols].to_parquet(PKG / "links_publish.parquet", index=False)

used = set(pub.loc[pub.link_class == "drawn_from_record", "seg_key"])
nc = crowns[crowns.seg_key.isin(used)].copy()
nc["crown_source"] = "record_seeded_v52"; nc["display_style"] = "faint"; nc["review_status"] = "awaiting_confirmation"
nc.to_parquet(PKG / "new_crowns_publish.parquet", index=False)

queue = links[~links.status.isin(["linked_high", "linked_medium", "outside_coverage"])].copy()
queue["queue_reason"] = queue.status.map({
    "needs_review": "Choose between the proposed crowns",
    "linked_new_crown": "Confirm the crown drawn from this record",
    "tree_no_crown": "Tree-height returns here but no crown could be drawn",
    "no_tree_found": "No tree found at the recorded position",
    "position_unusable": "Recorded position cannot be matched (e.g. on a roof)",
})
queue.to_parquet(PKG / "workbench_queue.parquet", index=False)
links[links.status == "outside_coverage"].to_parquet(PKG / "unlinked_outside_coverage.parquet", index=False)

# Council positions for the default-off map layer: only records whose link is published.
keep = set(pub.tree_id); lines = []
with open(OUT / "council_positions_v52.geojsonl") as f:
    for line in f:
        feat = json.loads(line)
        if feat["properties"].get("tree_id") in keep:
            lines.append(line)
(PKG / "council_positions_publish.geojsonl").write_text("".join(lines))

summary = {"published_links": pub.link_class.value_counts().to_dict(), "new_crowns_published": int(len(nc)),
           "workbench_queue": queue.status.value_counts().to_dict(),
           "left_unlinked_outside_coverage": int((links.status == "outside_coverage").sum()),
           "council_position_features": len(lines),
           "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(PKG.glob("*")) if p.is_file() and p.suffix != ".json"}}
(PKG / "PACKAGE.json").write_text(json.dumps(summary, indent=1))
print(json.dumps({k: v for k, v in summary.items() if k != "sha256"}, indent=1))
