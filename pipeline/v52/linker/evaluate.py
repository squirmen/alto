"""Hold-out evaluation: five spatial folds of simulated records, each matched by a model fitted without them.

For fold k the size and capacity models and the choice weights are fitted on the other folds; the
fold's displaced records ("sim") and, separately, their crown-deleted copies ("simdel") are then
matched together with every real unlinked record that competes for the same crowns, exactly as
production does. Results per record are written to eval/holdout_<config>.parquet; confidence
calibration is cross-fitted (fold k calibrated on the other folds). Ablations rerun the same
loop with one component switched off.
"""
from __future__ import annotations
import argparse, json, time
import numpy as np, pandas as pd
from sklearn.isotonic import IsotonicRegression
import link
from scenario import Data, models, existing_of, sim_shifts, apply_shifts, truth_of
from common import WORK, EVAL

CONFIGS = {"full": frozenset(), "no_error_model": frozenset({"no_err"}), "no_run_alignment": frozenset({"no_run"}),
           "no_plausibility": frozenset({"no_plaus"}), "no_capacity_conflict": frozenset({"no_cap"}),
           "no_new_crowns": frozenset({"no_new"})}


def missing_share(D):
    """Share of real unlinked records whose tree stands but has no crown, per source, by a mixture identity.

    A seeded crown within 2 m of the point is rare when the record's crown exists (simulated records, ~5%) and
    common when it was deleted (~55-75%); the production rate sits between, and its position gives the share:
    m = (p_prod - p_sim) / (p_simdel - p_sim). The error model's 1 - pi is larger because it also counts records
    with no tree at all, which do not look like a deleted crown.
    """
    near = lambda N, ids: N[N.qid.isin(ids) & (N.edge_distance_m <= 2)].qid.nunique() / max(len(ids), 1)
    out = {}
    for g in D.unl.src_group.unique():
        u = D.unl[D.unl.src_group == g].qid
        s = D.Q[(D.Q.src_group == g) & D.Q.qid.str.endswith("|sim")].qid; d = D.Q[(D.Q.src_group == g) & D.Q.qid.str.endswith("|simdel")].qid
        ps, pd_, pp = near(D.snew, s), near(D.snew, d), near(D.new, u)
        out[g] = {"p_prod": round(pp, 4), "p_sim": round(ps, 4), "p_simdel": round(pd_, 4),
                  "missing_share": round(float(np.clip((pp - ps) / max(pd_ - ps, 1e-3), 0.05, 0.95)), 4)}
    return out


def del_weights(Q, EM, share=None):
    """Weight crown-deleted copies so that, per source, they make up the estimated share of crown-missing records
    (missing_share; or the error model's 1 - pi, the pessimistic bound, when share is None)."""
    w = pd.Series(1.0, index=Q.qid.values)
    for g, q in Q.groupby("src_group"):
        m = share[g]["missing_share"] if share else 1 - EM[g]["pi"]
        nd = q.qid.str.endswith("|simdel").sum(); ns = len(q) - nd
        if nd:
            w[q.qid[q.qid.str.endswith("|simdel")].values] = m / max(1 - m, 1e-3) * ns / nd
    return w


def prepare(D):
    Q = D.Q.copy()
    sh, mem = sim_shifts(D, Q[~Q.qid.str.endswith("|simdel")])
    # crown-deleted copies share the displaced point and therefore the row shift of their sim twin
    if len(mem):
        md = mem.copy(); md["qid"] = md.qid.str.replace("|sim", "|simdel", regex=False)
        mem = pd.concat([mem, md[md.qid.isin(Q.qid)]], ignore_index=True)
    scand = D.scand.merge(Q[["qid", "x", "y"]], on="qid")
    sc, sn, _ = apply_shifts(D.scand, D.snew.merge(Q[["qid", "x", "y"]], on="qid"), mem, sh, D.crowns)
    rs = pd.read_parquet(WORK / "run_shifts_real.parquet"); rm = pd.read_parquet(WORK / "run_members_real.parquet")
    rmem = rm[["qid", "run_id", "x", "y"]]
    pc, pn, _ = apply_shifts(D.cand, D.new.merge(D.R[["tree_id", "x", "y"]].rename(columns={"tree_id": "qid"}), on="qid"), rmem, rs, D.crowns)
    Q["self_seg"] = Q.link_seg
    return Q, sc, sn, pc, pn, sh


def run_fold(D, k, Q, sc, sn, pc, pn, truth, wts, use, margins=True):
    EMd = link.EM
    hidden = Q[Q.fold == k]; train = Q[Q.fold != k]
    ctx = models(D, exclude_ids=set(hidden.tree_id))
    fixed = D.linked[~D.linked.tree_id.isin(hidden.tree_id)]
    existing = existing_of(fixed)
    # training options: other folds' sim records; their own crown is not an occupant; deleted copies lose their crown
    trc = sc[sc.qid.isin(train.qid)]
    dmap = train.set_index("qid").del_seg.dropna()
    trc = trc[~(trc.qid.map(dmap) == trc.seg_key)]
    Otr = link.build_options(train, trc, D.crowns, sn[sn.qid.isin(train.qid)], D.sfeat, existing_of(D.linked), ctx, use)
    w, nll = link.fit_weights(Otr, truth[truth.qid.isin(train.qid)], wts)
    out = []
    for kind in ("sim", "simdel"):
        hq = hidden[hidden.qid.str.endswith("|" + kind)]
        if not len(hq):
            continue
        drop = set(hq.del_seg.dropna())
        hc = sc[sc.qid.isin(hq.qid) & ~sc.seg_key.isin(drop)]
        segs = set(hc.seg_key)
        rq = D.unl[D.unl.qid.isin(pc[pc.seg_key.isin(segs)].qid)]
        rc = pc[pc.qid.isin(rq.qid) & ~pc.seg_key.isin(drop)]
        cand = pd.concat([hc, rc], ignore_index=True)
        new = pd.concat([sn[sn.qid.isin(hq.qid)], pn[pn.qid.isin(rq.qid)]], ignore_index=True)
        feat = pd.concat([D.sfeat[D.sfeat.qid.isin(hq.qid)], D.feat[D.feat.qid.isin(rq.qid)]], ignore_index=True)
        qs = pd.concat([hq[["qid", "src_group", "genus"]], rq[["qid", "src_group", "genus"]]], ignore_index=True)
        O = link.build_options(qs, cand, D.crowns, new, feat, existing, ctx, use)
        A, Oa = link.assign(O, None if "no_cap" in use else ctx["cap"], w, margins=margins)
        if "no_cap" in use:             # independent choice: every record takes its own best option
            Oa = Oa.copy(); best = Oa.loc[Oa.groupby("qid").U.idxmax()]; best = best.assign(opt=best.index)
            A = A.drop(columns=["opt", "U", "kind", "okey"]).merge(best[["qid", "opt", "U", "kind", "okey"]], on="qid")
        Xc = link.conf_features(A, Oa, feat, new, qs)
        A = pd.concat([A, pd.DataFrame(Xc, columns=["cf_" + c for c in link.CONF_FEATS])], axis=1)
        A = A[A.qid.isin(hq.qid)].merge(hq[["qid", "tree_id", "src_group", "sim_how", "d_edge_sim", "link_seg"]], on="qid")
        A = A.merge(truth.rename(columns={"okey": "truth"}), on="qid", how="left")
        # second-best option for the record (for reporting)
        A["fold"] = k; A["scenario"] = kind
        out.append(A)
    return pd.concat(out, ignore_index=True), w


def score(A):
    A = A.copy()
    A["linked"] = A.kind.ne("null")
    A["correct"] = A.linked & (A.okey == A.truth)
    A["wrong"] = A.linked & (A.okey != A.truth)
    return A


def calibrate(A, w):
    """Cross-fitted confidence: a small boosted model of P(correct | linked) on the evidence features, per option
    kind, trained on the other folds (weighted so crown-deleted copies count at their share)."""
    A = A.copy(); A["conf"] = np.nan
    A["gclass"] = A.src_group.map(lambda g: "register" if g.startswith("register") else ("kauri" if g == "kauri_obs" else "notable_osm"))
    cols = ["cf_" + c for c in link.CONF_FEATS]
    L = A[A.linked]
    for kind, g in L.groupby("kind"):
        for k in sorted(g.fold.unique()):
            tr = g[g.fold != k]; te = g[g.fold == k]
            if len(tr) < 50 or tr.correct.nunique() < 2:
                A.loc[te.index, "conf"] = float(tr.correct.mean()) if len(tr) else 0.0
                continue
            m = link.conf_model(tr[cols].values, tr.correct.values, w.reindex(tr.qid).fillna(1).values)
            A.loc[te.index, "conf"] = m.predict_proba(te[cols].values)[:, 1]
    return A


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--configs", nargs="*", default=["full"]); ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--no-margins", action="store_true")
    a = ap.parse_args()
    t0 = time.time(); D = Data()
    Q, sc, sn, pc, pn, sh = prepare(D)
    truth = truth_of(D, Q)
    share = missing_share(D); (EVAL / "missing_share.json").write_text(json.dumps(share, indent=1))
    wts = del_weights(Q, link.EM, share)
    wts_pess = del_weights(Q, link.EM, None)
    sh.to_parquet(EVAL / "sim_run_shifts.parquet", index=False); truth.to_parquet(EVAL / "sim_truth.parquet", index=False)
    print("prepared", round(time.time() - t0), "s", flush=True)
    for cfg in a.configs:
        res, ws = [], {}
        for k in range(a.folds):
            A, w = run_fold(D, k, Q, sc, sn, pc, pn, truth, wts, CONFIGS[cfg], margins=not a.no_margins)
            res.append(A); ws[k] = w
            print(cfg, "fold", k, len(A), round(time.time() - t0), "s", flush=True)
        A = score(pd.concat(res, ignore_index=True))
        if not a.no_margins:
            A = calibrate(A, wts)
        A["weight"] = wts.reindex(A.qid).values; A["weight_pessimistic"] = wts_pess.reindex(A.qid).values
        A.to_parquet(EVAL / f"holdout_{cfg}.parquet", index=False)
        (EVAL / f"weights_{cfg}.json").write_text(json.dumps({str(k): v for k, v in ws.items()}, indent=1))


if __name__ == "__main__":
    main()
