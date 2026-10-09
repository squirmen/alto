"""Find digitised runs of register points and estimate one bounded shift per run segment.

Council and AT staff digitised many street and park plantings as rows: consecutive TreeIDs,
evenly spaced along a kerb or path, often all offset the same way from the trees because they
were placed against an older or misregistered base map. A row like that is better explained by
one common shift than by each point independently, and the shift can be estimated from the row
itself (RANSAC over record -> crown-top vectors, then one ICP refinement), anchored by members
v5.1 already links. A shift is accepted only when it moves most members onto crowns, the aligned fit beats what 99% of
null runs achieve (the same segment moved 45-70 m and aligned the same way; runs_null.py), it keeps
already-linked members on their crowns, lands on at least two distinct crowns, and is at most
V_MAX = 6 m long - the error model puts under 1% of register offsets beyond that, and with a 20 m
search half of all null runs found a convincing-looking "shift".
"""
from __future__ import annotations
import numpy as np, pandas as pd
from shapely import from_wkb, points as P_, distance as D_
from link import llr_edge

SEQ_GAP, LINK_M, SEG_MAX, V_MAX, MIN_SHIFT = 2, 25.0, 12, 6.0, 1.0


def detect(R):
    """Chains of register records with consecutive TreeIDs (gap <= 2) less than 25 m apart, cut into segments of <= 12."""
    g = R[R.source.eq("tree_register_points") & R.seq.notna()].sort_values("seq").reset_index(drop=True)
    d = np.hypot(np.diff(g.x), np.diff(g.y)); ds = np.diff(g.seq)
    brk = np.r_[True, ~((ds <= SEQ_GAP) & (d <= LINK_M))]
    g["chain"] = np.cumsum(brk)
    g["pos"] = g.groupby("chain").cumcount(); n = g.groupby("chain").seq.transform("size")
    g = g[n >= 3].copy()
    nseg = np.ceil(g.groupby("chain").seq.transform("size") / SEG_MAX)
    size = np.ceil(g.groupby("chain").seq.transform("size") / nseg)
    g["run_id"] = "run_" + g.chain.astype(str) + "_" + (g.pos // size).astype(int).astype(str)
    out = []
    for rid, s in g.groupby("run_id"):
        if len(s) < 3:
            continue
        xy = np.c_[s.x - s.x.mean(), s.y - s.y.mean()]
        ev, evec = np.linalg.eigh(np.cov(xy.T))
        sp = np.hypot(np.diff(s.x), np.diff(s.y))
        out.append({"run_id": rid, "n": len(s), "linearity": float(np.sqrt(max(ev[0], 0)) / max(np.sqrt(ev[1]), 1e-6)),
                    "perp_rms_m": float(np.sqrt(max(ev[0], 0))), "spacing_med_m": float(np.median(sp)),
                    "spacing_cv": float(np.std(sp) / max(np.mean(sp), 1e-6)), "axis": evec[:, 1].tolist()})
    runs = pd.DataFrame(out)
    mem = g[g.run_id.isin(runs.run_id)][["tree_id", "run_id", "src_group", "x", "y", "seq"]].rename(columns={"tree_id": "qid"})
    return runs, mem


def _fit_run(P, tops, rad, ok, an, grp, lam=0.15, in_d=2.0, floor_d=10.0):
    """Best common shift for one run segment, by exhaustive record->crown-top hypotheses plus one ICP step."""
    nm = len(P); areas = np.pi * rad ** 2
    lfloor = llr_edge([grp], [floor_d], [20.0])[0]
    def fit(v):
        q = P + v
        d = np.maximum(np.hypot(tops[..., 0] - q[:, None, 0], tops[..., 1] - q[:, None, 1]) - 0.8 * rad, 0)
        L = llr_edge(np.full(d.size, grp), d.ravel(), areas.ravel()).reshape(d.shape)
        L[~ok] = -50
        j = L.argmax(1)
        return np.maximum(L.max(1), lfloor), j, d[np.arange(nm), j]
    hyps = tops[ok] - np.repeat(P, ok.sum(1), axis=0)
    hyps = hyps[np.hypot(hyps[:, 0], hyps[:, 1]) <= V_MAX]
    hyps = np.unique(np.round(hyps * 2) / 2, axis=0) if len(hyps) else np.zeros((0, 2))
    l0, j0, d0 = fit(np.zeros(2))
    best = (l0.sum(), np.zeros(2))
    for v in hyps:
        sc = fit(v)[0].sum() - lam * np.hypot(*v)
        if sc > best[0]:
            best = (sc, v)
    v = best[1]
    if np.hypot(*v) > 0:
        l, j, d = fit(v); inl = d <= in_d
        if inl.sum() >= 2:   # one ICP step: median residual of inliers to their matched tops
            v2 = v + np.median((tops[np.arange(nm), j] - (P + v))[inl], axis=0)
            if np.hypot(*v2) <= V_MAX and fit(v2)[0].sum() - lam * np.hypot(*v2) >= fit(v)[0].sum() - lam * np.hypot(*v):
                v = v2
    l, j, d = fit(v)
    inl, inl0 = d <= in_d, d0 <= in_d
    return {"n": nm, "n_anchor": int(an.sum()), "sdx": float(v[0]), "sdy": float(v[1]), "shift_m": float(np.hypot(*v)),
            "gain": float(l.sum() - l0.sum()), "fit_mean": float(l.mean()), "fit0_mean": float(l0.mean()), "inlier_frac": float(inl.mean()), "inlier_frac0": float(inl0.mean()),
            "improved_frac": float((l > l0 + 0.25).mean()), "distinct": len({tuple(tops[i, j[i]]) for i in np.where(inl)[0]}),
            "anchors_kept": bool(not an.any() or (d[an] <= 1.5).all())}


def fit_threshold(n):
    """Mean per-record fit an aligned segment of n records must reach: the 99th percentile reached by null runs
    (the same segment moved 45-70 m and aligned with no anchors; runs_null.py)."""
    import json
    from common import WORK
    f = WORK / "run_null.json"
    if not f.exists():
        return 0.0
    t = json.loads(f.read_text())["q99_fit_by_n"]
    return float(t[str(min(max(n, 3), 12))])


def accepted(r):
    return bool(r["shift_m"] >= MIN_SHIFT and r["fit_mean"] >= fit_threshold(r["n"]) and r["gain"] >= 2.0 and r["inlier_frac"] >= 0.6
                and r["inlier_frac"] - r["inlier_frac0"] >= 0.2 and r["improved_frac"] >= 0.6 and r["distinct"] >= 2 and r["anchors_kept"])


def arrays_for(m, by, anchors):
    nm = len(m)
    tops, rad, ok = np.zeros((nm, 30, 2)), np.zeros((nm, 30)), np.zeros((nm, 30), bool)
    for i, t in enumerate(m.qid):
        g = by.get(t)
        if g is None:
            continue
        if t in anchors:
            g = g[g.seg_key == anchors[t]]
        g = g.head(30); k = len(g)
        tops[i, :k] = g[["x_2193", "y_2193"]].values; rad[i, :k] = np.sqrt(g.crown_area_m2.values / np.pi); ok[i, :k] = True
    return tops, rad, ok


def align(runs, mem, cand, crowns, anchors, rng_seed=0):
    """mem: (qid, run_id, src_group, x, y); anchors: qid -> seg_key for members whose link is kept fixed."""
    cc = cand[cand.qid.isin(mem.qid)].merge(crowns[["seg_key", "x_2193", "y_2193", "crown_area_m2"]], on="seg_key")
    by = {t: g.sort_values("d_edge") for t, g in cc.groupby("qid")}
    res = []
    for rid, m in mem.groupby("run_id"):
        tops, rad, ok = arrays_for(m, by, anchors)
        if not ok.any():
            continue
        an = np.array([t in anchors for t in m.qid])
        r = _fit_run(m[["x", "y"]].values, tops, rad, ok, an, m.src_group.iloc[0])
        r["run_id"] = rid; r["accepted"] = accepted(r)
        res.append(r)
    return pd.DataFrame(res)


def shifted_distances(cand, new, mem, shifts, crowns):
    """Exact polygon edge distances from each accepted-run member's shifted point."""
    acc = shifts[shifts.accepted][["run_id", "sdx", "sdy"]]
    mm = mem.merge(acc, on="run_id")[["qid", "run_id", "x", "y", "sdx", "sdy"]]
    if not len(mm):
        return cand.assign(d_edge_shift=np.nan), (new.assign(d_edge_shift=np.nan) if new is not None else None), mm
    c = cand.merge(mm, on="qid", how="left")
    k = c.sdx.notna().values
    geo = crowns.set_index("seg_key").crown_wkb
    c["d_edge_shift"] = np.nan
    if k.any():
        polys = from_wkb(geo.reindex(c.seg_key[k]).values)
        c.loc[k, "d_edge_shift"] = D_(P_(c.x[k] + c.sdx[k], c.y[k] + c.sdy[k]), polys)
    c = c.drop(columns=["run_id", "x", "y", "sdx", "sdy"])
    n = None
    if new is not None:
        n = new.drop(columns=[c for c in ("x", "y") if c in new]).merge(mm, on="qid", how="left"); k = n.sdx.notna().values; n["d_edge_shift"] = np.nan
        if k.any():
            n.loc[k, "d_edge_shift"] = D_(P_(n.x[k] + n.sdx[k], n.y[k] + n.sdy[k]), from_wkb(n.crown_wkb[k].values))
        n = n.drop(columns=["run_id", "x", "y", "sdx", "sdy"])
    return c, n, mm
