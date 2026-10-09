"""Turn the hold-out results into the tables the report quotes (printed; numbers also in eval/summary.json).

Precision is weighted so that crown-deleted copies stand for the share of records whose tree has
no crown (the error model's 1 - pi per source); unweighted numbers for the two scenarios are
given alongside so nothing hides in the weighting.
"""
import json
import numpy as np, pandas as pd
from common import WORK, EVAL
from final import T_HIGH, T_MED, new_crown_rule, crown_guard

AUTO = ["linked_high", "linked_medium", "linked_new_crown"]


def md(df, index=True):
    """Pipe table without the tabulate dependency."""
    d = df.reset_index() if index else df
    fmt = lambda v: "" if v is None or (isinstance(v, float) and np.isnan(v)) else (f"{v:.4g}" if isinstance(v, float) else str(v))
    lines = ["| " + " | ".join(map(str, d.columns)) + " |", "|" + "---|" * len(d.columns)]
    lines += ["| " + " | ".join(fmt(v) for v in row) + " |" for row in d.itertuples(index=False)]
    return "\n".join(lines)


def band(A):
    nok = new_crown_rule(A.kind.values, A.margin.values, A.cf_d_use.values, A.cf_u_gap_best.values)
    b = np.select([A.kind.eq("crown") & (A.conf >= T_HIGH), A.kind.eq("crown") & (A.conf >= T_MED), nok, A.kind.ne("null")],
                  ["linked_high", "linked_medium", "linked_new_crown", "needs_review"], "none")
    b = np.where((b == "linked_medium") & A.src_group.eq("kauri_obs").values, "needs_review", b)   # kauri: high band only
    guard = crown_guard(A.cf_d_use.values, A.cf_bld_1p5.values, A.cf_unc_tall_1p5.values, A.cf_x_h.values, A.cf_tall_1p5.values)
    b = np.where(np.isin(b, ["linked_high", "linked_medium"]) & (guard != ""), "needs_review", b)
    return pd.Series(b, index=A.index)


def wmean(x, w):
    return float(np.average(x, weights=w)) if len(x) and w.sum() > 0 else np.nan


def table(A, by):
    rows = []
    for k, g in A.groupby(by):
        s, d = g[g.scenario == "sim"], g[g.scenario == "simdel"]
        auto = g[g.band.isin(AUTO)]
        rows.append({by if isinstance(by, str) else "/".join(by): k, "n_sim": len(s), "n_simdel": len(d),
                     "auto_linked_precision_w": round(wmean(auto.correct, auto.weight), 4),
                     "auto_linked_n": len(auto),
                     "recall_sim": round(float((s.band.isin(AUTO) & s.correct).mean()), 4) if len(s) else np.nan,
                     "sim_precision": round(float(s[s.band.isin(AUTO)].correct.mean()), 4) if s.band.isin(AUTO).any() else np.nan,
                     "simdel_false_existing_link": round(float((d.band.isin(AUTO) & d.kind.eq("crown")).mean()), 4) if len(d) else np.nan,
                     "simdel_new_crown_correct": round(float((d.band.eq("linked_new_crown") & d.correct).mean()), 4) if len(d) else np.nan})
    return pd.DataFrame(rows)


def main():
    out, S = [], {}
    cfgs = [c for c in ["full", "no_error_model", "no_run_alignment", "no_plausibility", "no_capacity_conflict", "no_new_crowns"]
            if (EVAL / f"holdout_{c}.parquet").exists()]
    for c in cfgs:
        A = pd.read_parquet(EVAL / f"holdout_{c}.parquet"); A["band"] = band(A); A["weight"] = A.weight.fillna(1)
        if c == "full":
            A["dband"] = pd.cut(A.d_edge_sim, [-1, 0, 1, 2, 3, 5, 10, 100], labels=["inside", "0-1", "1-2", "2-3", "3-5", "5-10", ">10"])
            for by in ["band", "src_group", "sim_how", "dband"]:
                out.append(f"\n### Hold-out by {by} ({c})\n\n" + md(table(A, by), index=False))
            bb = A.groupby("band").apply(lambda g: pd.Series({"n": len(g), "precision_w": wmean(g.correct, g.weight),
                                                               "precision_sim": g[g.scenario == "sim"].correct.mean(),
                                                               "precision_simdel": g[g.scenario == "simdel"].correct.mean()}))
            out.append("\n### Precision by band (full)\n\n" + md(bb.round(4)))
            S["full_by_band"] = bb.round(4).to_dict()
        auto = A[A.band.isin(AUTO)]; s = A[A.scenario == "sim"]; d = A[A.scenario == "simdel"]
        S[c] = {"auto_precision_w": wmean(auto.correct, auto.weight), "auto_n": len(auto),
                "recall_sim": float((s.band.isin(AUTO) & s.correct).mean()),
                "simdel_false_existing_link": float((d.band.isin(AUTO) & d.kind.eq("crown")).mean()) if len(d) else None,
                "argmax_accuracy_sim": float(s.correct.mean())}
    # naive baseline: nearest crown by edge distance within 3 m / 5 m, independently per record
    Q = pd.read_parquet(WORK / "sim_queries.parquet"); C = pd.read_parquet(WORK / "sim_cand.parquet")
    C = C.merge(Q[["qid", "del_seg", "link_seg", "src_group"]], on="qid")
    C = C[~(C.seg_key == C.del_seg)]
    nn = C.sort_values(["qid", "d_edge"]).groupby("qid").head(1)
    w = pd.read_parquet(EVAL / "holdout_full.parquet")[["qid", "weight"]] if cfgs else None
    for r in (3.0, 5.0):
        L = nn[nn.d_edge <= r].copy(); L["correct"] = (L.seg_key == L.link_seg) & ~L.qid.str.endswith("|simdel")
        if w is not None:
            L = L.merge(w, on="qid", how="left"); L["weight"] = L.weight.fillna(1)
        sq = Q[~Q.qid.str.endswith("|simdel")]
        S[f"naive_nearest_{int(r)}m"] = {"auto_precision_w": wmean(L.correct, L.weight) if w is not None else float(L.correct.mean()),
                                         "auto_n": len(L), "recall_sim": float(L[~L.qid.str.endswith("|simdel")].correct.sum() / len(sq)),
                                         "simdel_false_existing_link": float(L.qid.str.endswith("|simdel").sum() / max(Q.qid.str.endswith("|simdel").sum(), 1))}
    ab = pd.DataFrame(S).T.drop(columns=[c for c in ["full_by_band"] if c in pd.DataFrame(S).T.columns], errors="ignore")
    ab = ab.drop(index=["full_by_band"], errors="ignore")
    out.insert(0, "### Components and baselines (hold-out, same thresholds)\n\n" + md(ab.astype(float).round(4)))
    (EVAL / "summary.json").write_text(json.dumps(S, indent=1, default=float))
    print("\n".join(out))


if __name__ == "__main__":
    main()
