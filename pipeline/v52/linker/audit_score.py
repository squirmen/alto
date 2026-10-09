"""Join the blind card judgments (eval/audit_judgments.csv) back to the matcher's statuses and estimate precision.

Usage: audit_score.py [_r2]. Judgments were made from the pictures alone (card id, species, record point, proposed outline); the
stratum is only joined here. For a link: correct / wrong / cant_tell. For a record left without a crown:
no_tree (nothing tree-height there - the status is right), tree_uncrowned (a tree stands there without a
crown - right for tree_no_crown, a miss for the others), missed_link (an existing crown clearly is the
tree), cant_tell. Precision is computed on decided cards and, as a bound, counting cant_tell as wrong;
the estimate for all auto-linked records reweights the strata by their production sizes.
"""
import json
import numpy as np, pandas as pd
from common import OUT, EVAL

import sys
rnd = sys.argv[1] if len(sys.argv) > 1 else ""
J = pd.read_csv(EVAL / f"audit_judgments{rnd}.csv"); S = pd.read_csv(EVAL / f"audit_sample{rnd}.csv")
A = S.merge(J, on="card")
A = A[A.stratum != "screenshot"]
A["band"] = A.stratum.str.split("|").str[0]
L = pd.read_parquet(OUT / "links_v52.parquet")
# a card measures the final rules only while the record still has the status and crown it was drawn with
cur = L.set_index("tree_id")
A["still"] = [cur.status.get(t) == s for t, s in zip(A.tree_id, A.status)]
changed = int((~A.still).sum())
if rnd:                      # the validation round is scored against the final statuses
    A = A[A.still]
rows = []
for st, g in A.groupby("stratum"):
    dec = g[g.judgment.isin(["correct", "wrong"])]
    rows.append({"stratum": st, "cards": len(g), "correct": int((g.judgment == "correct").sum()), "wrong": int((g.judgment == "wrong").sum()),
                 "cant_tell": int((g.judgment == "cant_tell").sum()), "other": int((~g.judgment.isin(["correct", "wrong", "cant_tell"])).sum()),
                 "precision_decided": round(len(dec[dec.judgment == "correct"]) / max(len(dec), 1), 3) if len(dec) else None})
T = pd.DataFrame(rows)
print(T.to_string(index=False))
out = {"by_stratum": T.to_dict("records")}
for band in ["linked_high", "linked_medium", "linked_new_crown"]:
    g = A[A.band == band]; dec = g[g.judgment.isin(["correct", "wrong"])]
    p = (dec.judgment == "correct").mean() if len(dec) else np.nan
    lo = (g.judgment == "correct").sum() / max(len(g), 1)
    # reweight source strata to production counts
    w = L[L.status == band].src_group.value_counts()
    gs = g.assign(src=g.stratum.str.split("|").str[1])
    est = []
    for src, n in w.items():
        h = gs[gs.src == src] if (band != "linked_new_crown" and (gs.src == src).any()) else gs
        d = h[h.judgment.isin(["correct", "wrong"])]
        if len(d):
            est.append((n, (d.judgment == "correct").mean()))
    pw = sum(n * q for n, q in est) / max(sum(n for n, _ in est), 1) if est else np.nan
    # binomial 95% interval (Wilson) on decided cards
    n = len(dec); k = int((dec.judgment == "correct").sum())
    z = 1.96; c = (k + z * z / 2) / (n + z * z) if n else np.nan; hw = z * np.sqrt(k * (n - k) / n + z * z / 4) / (n + z * z) if n else np.nan
    out[band] = {"cards": len(g), "decided": n, "correct": k, "precision_decided": round(float(p), 3),
                 "wilson95": [round(float(c - hw), 3), round(float(c + hw), 3)] if n else None,
                 "precision_cant_tell_as_wrong": round(float(lo), 3), "precision_reweighted_to_production": round(float(pw), 3)}
lk = A[A.band.isin(["linked_high", "linked_medium"])]; dec = lk[lk.judgment.isin(["correct", "wrong"])]
out["linked_existing_all"] = {"cards": len(lk), "decided": len(dec), "precision_decided": round(float((dec.judgment == "correct").mean()), 3),
                              "precision_cant_tell_as_wrong": round(float((lk.judgment == "correct").mean()), 3)}
nc = A[A.band.isin(["tree_no_crown", "no_tree_found", "position_unusable"])]
out["no_crown"] = {"cards": len(nc), "status_supported": int(nc.judgment.isin(["no_tree"]).sum() + ((nc.band == "tree_no_crown") & (nc.judgment == "tree_uncrowned")).sum()),
                   "missed_link": int((nc.judgment == "missed_link").sum()), "cant_tell": int((nc.judgment == "cant_tell").sum()),
                   "judged_as_link_would_be_right": int((nc.judgment == "correct").sum())}
out["cards_whose_status_changed_since_sampling"] = changed
print(json.dumps({k: v for k, v in out.items() if k != "by_stratum"}, indent=1))
(EVAL / f"audit_summary{rnd}.json").write_text(json.dumps(out, indent=1, default=str))
