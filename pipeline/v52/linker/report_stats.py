"""Counts the report quotes from the production outputs: statuses by source, the point-cloud evidence behind
every record left without a crown, the record-seeded crowns by source and growth form, and the screenshot cases.
"""
import json
import numpy as np, pandas as pd
from common import WORK, OUT, EVAL
from features import PALMLIKE

L = pd.read_parquet(OUT / "links_v52.parquet"); F = pd.read_parquet(WORK / "feat.parquet").set_index("qid")
N = pd.read_parquet(OUT / "new_crowns_v52.parquet")
S = {}
order = ["linked_high", "linked_medium", "linked_new_crown", "needs_review", "tree_no_crown", "no_tree_found", "position_unusable", "outside_coverage"]
t = pd.crosstab(L.src_group, L.status).reindex(columns=[c for c in order if c in L.status.unique()]).fillna(0).astype(int)
t.loc["all"] = t.sum()
S["status_by_source"] = t.to_dict()
print(t.to_string()); print("total", len(L))
# evidence behind records left without a crown
nc = L[L.status.isin(["tree_no_crown", "no_tree_found", "position_unusable", "needs_review"]) & L.seg_key.isna()].copy()
f = F.reindex(nc.tree_id)
ev = np.select([f.unc_veg_3.values >= 4, (f.unc_c1g_3.values >= 4) | (f.c1_returns_1p5.values >= 5),
                f.tall_3.values >= 4, f.bld_1p5.values >= 0.5], ["vegetation_class_uncovered", "unclassified_cluster_uncovered",
                "tree_height_inside_existing_crowns", "building_only"], "nothing_tree_height")
nc["evidence"] = ev
e = pd.crosstab(nc.status, nc.evidence); print(e.to_string()); S["no_crown_evidence"] = e.to_dict()
# record-seeded crowns
N["genus"] = N.record_ids_json.map(lambda s: json.loads(s)[0]).map(L.set_index("tree_id").species_latin).fillna("").str.split().str[0]
N["form"] = np.where(N.genus.isin(PALMLIKE), "palm_like_taxon", "other_or_unknown_taxon")
N["src"] = N.record_ids_json.map(lambda s: json.loads(s)[0]).map(L.set_index("tree_id").src_group)
N["unc_dominated"] = N.unclassified_fraction >= 0.5
n = pd.crosstab([N.link_status, N.src], [N.form, N.unc_dominated]); print(n.to_string())
S["new_crowns"] = {"n": len(N), "by_status": N.link_status.value_counts().to_dict(),
                   "palm_like": int((N.form == "palm_like_taxon").sum()), "unclassified_dominated": int(N.unc_dominated.sum()),
                   "palm_detection_ge_0p5": int((N.get("palm_det_score", pd.Series(0)).fillna(0) >= 0.5).sum()),
                   "height_quantiles": N.height_m.quantile([.1, .5, .9]).round(1).tolist(),
                   "area_quantiles": N.crown_area_m2.quantile([.1, .5, .9]).round(1).tolist(),
                   "low_canopy_2_3m": int((N.canopy_class == "low_canopy").sum())}
lk = L[L.status.isin(["linked_high", "linked_medium"])]
S["linked_to_unpublished_low_canopy_crowns"] = int((~lk.crown_published_v5.astype(bool)).sum())
S["linked_with_row_shift"] = int(((lk.applied_row_shift_dx != 0) | (lk.applied_row_shift_dy != 0)).sum())
S["shared_crowns"] = {"records_on_crowns_with_2plus_records": int((lk.shared_crown_n >= 2).sum())}
ids = {"akl_tree_trp_ACCT0159885": "Fan Palm", "akl_tree_trp_ACCT0257674": "Wattle", "akl_tree_trp_ACCT0248773": "Kowhai",
       "akl_tree_trp_ACCT0169814": "Cabbage Tree", "akl_tree_osm_node_7713504718": "OSM golden tree",
       "akl_tree_trp_ACCT0109736": "Matipo (roof row)", "akl_tree_trp_ACCT0151353": "Trachycarpus palm"}
sc = L[L.tree_id.isin(ids)][["tree_id", "status", "seg_key", "crown_source", "edge_distance_m", "raw_top_distance_m", "confidence", "margin", "reason", "candidates_json"]]
sc["case"] = sc.tree_id.map(ids)
print(sc.drop(columns=["candidates_json"]).to_string())
S["screenshot_cases"] = sc.to_dict("records")
(EVAL / "report_stats.json").write_text(json.dumps(S, indent=1, default=str))
