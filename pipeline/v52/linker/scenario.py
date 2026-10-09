"""Assemble one matching problem - production or a hold-out fold - and solve it.

A scenario is: which records are free to be placed (queries), which links stay fixed (they
occupy crowns and carry taxa), which crowns exist (a deleted-crown fold removes some), which run
shifts apply, and which model components are switched on. Production and every hold-out fold go
through the same code, so what is evaluated is what ships.
"""
from __future__ import annotations
import numpy as np, pandas as pd
from shapely import from_wkb, points as P_, distance as D_
import link, runs
from link import SizeModel, Capacity, build_options, fit_weights, assign
from common import WORK


class Data:
    def __init__(self, sim=True):
        self.R = pd.read_parquet(WORK / "records.parquet")
        self.feat = pd.read_parquet(WORK / "feat.parquet"); self.cand = pd.read_parquet(WORK / "cand.parquet")
        self.new = self._saddle(pd.read_parquet(WORK / "newcrowns.parquet"), WORK / "saddle.parquet")
        self.crowns = pd.read_parquet(WORK / "crowns.parquet")
        if sim and (WORK / "sim_feat.parquet").exists():
            self.Q = pd.read_parquet(WORK / "sim_queries.parquet")
            self.sfeat = pd.read_parquet(WORK / "sim_feat.parquet"); self.scand = pd.read_parquet(WORK / "sim_cand.parquet")
            self.snew = self._saddle(pd.read_parquet(WORK / "sim_newcrowns.parquet"), WORK / "sim_saddle.parquet")
            sc = pd.read_parquet(WORK / "sim_crowns.parquet")
            self.crowns = pd.concat([self.crowns, sc[~sc.seg_key.isin(self.crowns.seg_key)]], ignore_index=True)
        ig = pd.read_parquet(WORK / "itree_genus.parquet")
        self.ig = {g: (f, h) for g, f, h in zip(ig.genus, ig.growth_form, ig.mature_height_m)}
        self.runs, self.mem = runs.detect(self.R)
        self.linked = self.R[self.R.link_seg.notna()]
        self.unl = self.R[self.R.unlinked & self.R.tree_id.isin(self.feat.qid)].copy()
        self.unl["qid"] = self.unl.tree_id


    @staticmethod
    def _saddle(new, path):
        """Attach saddle.py's verdict: is the seeded crown continuous canopy with a touching v5 crown?"""
        if path.exists():
            s = pd.read_parquet(path)[["qid", "seg_key", "saddle_ratio_max", "saddle_seg", "continuous_with_existing"]]
            new = new.merge(s, on=["qid", "seg_key"], how="left")
        return new


def existing_of(linked):
    g = linked.groupby("link_seg")
    return {k: (int(n), frozenset(s.dropna())) for (k, n), (_, s) in zip(g.size().items(), g.genus)}


def models(D, exclude_ids=()):
    """Size and capacity models from links, leaving out held-out records."""
    from simulate import trusted
    T = trusted(D.R[~D.R.tree_id.isin(exclude_ids)], D.crowns)
    T = T.rename(columns={"link_seg": "seg_key"})
    sm = SizeModel().fit(T[["tree_id", "genus", "seg_key", "n_on_crown"]], D.crowns, D.ig)
    lk = D.linked[~D.linked.tree_id.isin(exclude_ids)]
    cnt = lk.groupby("link_seg").size().rename("n").reset_index().merge(
        D.crowns[["seg_key", "crown_area_m2"]], left_on="link_seg", right_on="seg_key").rename(columns={"crown_area_m2": "area"})
    cap = Capacity().fit(cnt)
    f = WORK.parent / "eval" / "missing_share.json"
    ms = __import__("json").loads(f.read_text()) if f.exists() else {}
    return {"size": sm, "cap": cap, "missing_share": ms, "seed_rho": seed_background_ratio(D, lk)}


def seed_background_ratio(D, lk, r=3.0):
    """Gate-passing seeded crowns per v5 crown within r m of linked records (whose own crown is known, so both
    are unrelated to them): the relative background density of the two kinds of candidate."""
    from link import new_crown_gate
    n = D.new[D.new.qid.isin(lk.tree_id)]
    n = n[new_crown_gate(n).eq("ok").values & (n.edge_distance_m <= r).values]
    c = D.cand[D.cand.qid.isin(lk.tree_id)].merge(lk[["tree_id", "link_seg"]].rename(columns={"tree_id": "qid"}), on="qid")
    c = c[(c.seg_key != c.link_seg) & (c.d_edge <= r)]
    return float(np.clip(len(n) / max(len(c), 1), 1e-3, 1.0))


def real_shifts(D, anchors):
    sh = runs.align(D.runs, D.mem[D.mem.qid.isin(D.R.tree_id)], D.cand.rename(columns={}), D.crowns, anchors)
    return sh


def sim_shifts(D, qsel):
    """Run alignment on displaced trusted members only (no anchors), per run segment and fold."""
    m = D.mem.merge(qsel[["tree_id", "qid", "x", "y", "fold"]], left_on="qid", right_on="tree_id", suffixes=("_r", ""))
    m["run_id"] = m.run_id + "|f" + m.fold.astype(str)
    m = m[m.groupby("run_id").qid.transform("size") >= 3][["qid", "run_id", "src_group", "x", "y"]]
    if not len(m):
        return pd.DataFrame(columns=["run_id", "accepted", "sdx", "sdy"]), m
    return runs.align(None, m, D.scand, D.crowns, {}), m


def apply_shifts(cand, new, mem, shifts, crowns):
    c, n, mm = runs.shifted_distances(cand, new, mem, shifts, crowns)
    return c, n, mm


def build(D, ctx, queries, cand, new, feat, existing, use=frozenset(), drop_segs=()):
    if len(drop_segs):
        cand = cand[~cand.seg_key.isin(drop_segs)]
    return build_options(queries, cand, D.crowns, new, feat, existing, ctx, use)


def truth_of(D, Q):
    """Correct option per sim query: the true crown; for crown-deleted copies the seeded crown over the same tree, else none."""
    t = Q[~Q.qid.str.endswith("|simdel")][["qid", "link_seg"]].rename(columns={"link_seg": "okey"})
    d = Q[Q.qid.str.endswith("|simdel")][["qid", "link_seg"]]
    n = D.snew[D.snew.qid.isin(d.qid)][["qid", "seg_key", "crown_wkb", "x_2193", "y_2193"]].merge(d, on="qid")
    if len(n):
        K = D.crowns.set_index("seg_key")
        dp = from_wkb(K.crown_wkb.reindex(n.link_seg).values); npoly = from_wkb(n.crown_wkb.values)
        inter = np.array([a.intersection(b).area for a, b in zip(dp, npoly)])
        iou = inter / np.maximum(np.array([a.union(b).area for a, b in zip(dp, npoly)]), 1e-9)
        top_in = np.array([a.contains(p) for a, p in zip(dp, P_(n.x_2193, n.y_2193))])
        n["match"] = (iou >= 0.2) | top_in | (inter / np.maximum([b.area for b in npoly], 1e-9) >= 0.5)
        good = n[n.match][["qid", "seg_key"]].rename(columns={"seg_key": "okey"})
    else:
        good = pd.DataFrame(columns=["qid", "okey"])
    nul = d[~d.qid.isin(good.qid)][["qid"]].assign(okey="null")
    return pd.concat([t, good, nul], ignore_index=True)
