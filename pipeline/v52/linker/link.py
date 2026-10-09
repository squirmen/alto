"""Score every record against every crown it could be, then assign jointly with crown capacities.

Each record r has options: an existing crown c within 40 m, the crown seeded from its own
uncovered returns (if one could be drawn), or none. An option's utility is a weighted sum of
evidence terms, each a log-likelihood ratio where one can be learned:

  offset       log f_g(d)/g_g(d) from the EM error model (errmodel.py), d = edge distance after any
               run shift, by source group and crown-size class
  plausibility log N(log h | taxon) / N(log h | all candidates), same for crown area per record
  conflict     the crown already holds a record of a different genus
  capacity     -log P(crown holds >= j records | holds >= j-1, area): how many records a crown of
               that size carries in v5.1, so a merged row crown can take several but a small one not
  new crown    a record-seeded crown is scored by the same terms plus a fixed prior log-odds that the
               record's tree is one v5 never drew and a background term (seeded crowns are rarer than v5
               crowns); its spectral and shape evidence is a gate (new_crown_gate), not a weight
  none         per-source intercept, plus whether uncovered tree-height returns stand near the point

Weights are fitted as a conditional logit on simulated records (trusted links displaced by the
learned offsets, some with their crown deleted), so they are calibrated to choices, not asserted.
Assignment is then a min-cost assignment per connected neighbourhood with one column per crown
slot (slot j priced by the capacity term at its own log-probability scale), and the margin of each record's choice is the cost of
the best global solution that forbids it - the honest "how much better than the next best".
"""
from __future__ import annotations
import json
import numpy as np, pandas as pd
from scipy.optimize import linear_sum_assignment, minimize
from common import WORK, genus_of

EM = json.loads((WORK / "errmodel.json").read_text()) if (WORK / "errmodel.json").exists() else None
BIG = 1e6
PRUNE = 0.0     # an option below the record's own (private, unlimited) null can never be optimal, so it is dropped
GROUPS = ["register_at", "register_parks", "notable", "osm", "kauri_obs"]
EXIST_FEATS = ["x_off", "x_h", "x_a", "x_conf", "x_cap", "x_low"]
# Record-seeded crowns enter the choice model by geometry only. Their spectral and point-class evidence (NDVI,
# unclassified share, building overlap, palm detection) is a gate, not a learned weight: the simulated missing
# crowns are deleted v5 crowns, which v5 drew precisely because they were green, vegetation-classified trees, so
# a weight learned there would penalise the palms and off-colour trees that are really missing.
#
# A seeded crown is scored exactly like a v5 crown - same error model, same plausibility, same weights - plus a
# fixed prior log-odds that a record's tree is one v5 did not draw, log(m / (1 - m)) with m the estimated share
# of crown-missing records for its source (evaluate.missing_share). Its weights are not learned separately: the
# simulated missing crowns sit in dense canopy, unlike the palms and off-colour trees really missing.
NEW_FEATS = []
# A seeded crown is linked only by rule (final.new_crown_rule): the hold-out has too few missing crowns that look
# like the real ones (isolated palms, off-colour trees) to fit a confidence model for them; the audit measures it.
# Shape limits are v5's own: of v5 tree crowns up to 40 m2, 90% have elongation <= 2.1 and 99% fill >= 0.42 of
# their bounding box. Seeded crowns outside that are slivers - building parapets, the trimmed skirt of a big
# canopy, a row merged into one - which is what the first audit round found among the wrong ones.
NEW_GATE = dict(min_height_m=2.5, max_height_m=50.0, min_area_m2=1.5, max_building_overlap=0.02, min_ndvi_if_unclassified=0.15,
                palm_score=0.5, max_elongation=2.1, min_bbox_fill=0.42)


def new_crown_gate(n):
    """Which seeded crowns are allowed as options, and why the others are not."""
    g = NEW_GATE
    palm = n.get("palm_det_score", pd.Series(0.0, index=n.index)).fillna(0) >= g["palm_score"]
    spectral = (n.unclassified_fraction.fillna(0) < 0.5) | (n.ndvi_mean.fillna(0) >= g["min_ndvi_if_unclassified"]) | palm
    cont = n.get("continuous_with_existing", pd.Series(False, index=n.index)).fillna(False).astype(bool)
    why = np.select([n.height_m < g["min_height_m"], n.height_m > g["max_height_m"], n.crown_area_m2 < g["min_area_m2"],
                     n.building_overlap.fillna(0) > g["max_building_overlap"], ~spectral, cont,
                     n.elongation.fillna(9) > g["max_elongation"], n.bbox_fill.fillna(0) < g["min_bbox_fill"]],
                    ["too_low", "implausibly_tall", "too_small", "on_building", "unclassified_and_not_green", "continuous_with_existing_crown",
                     "elongated", "fragmented"], "ok")
    return pd.Series(why, index=n.index)
# "nothing tree-height here" and "point on a roof" are left out of the choice model on purpose: the simulation
# has no felled trees or roof points with a true crown absent, so it would learn them backwards. They are
# applied after assignment, in the status rules (final.py).
NULL_FEATS = ["z_" + g for g in GROUPS] + ["z_unc"]
FEATS = EXIST_FEATS + NEW_FEATS + NULL_FEATS


# ---------- error model ----------
def llr_table(group):
    m = EM[group]
    return np.array(m["llr"]), np.array(m["bins"]), np.array(m["size_edges_radius_m"])


_LLR = {}


def llr_edge(groups, d, area):
    """log f/g for each (group, edge distance, crown area)."""
    out = np.zeros(len(d))
    groups = np.asarray(groups); d = np.asarray(d, float); area = np.asarray(area, float)
    for grp in np.unique(groups):
        if grp not in _LLR:
            _LLR[grp] = llr_table(grp)
        L, bins, se = _LLR[grp]
        k = groups == grp
        b = np.clip(np.searchsorted(bins, d[k], side="right") - 1, 0, len(bins) - 2)
        s = np.clip(np.searchsorted(se, np.sqrt(np.maximum(area[k], 0) / np.pi), side="right") - 1, 0, len(se) - 2)
        v = L[b, s]
        v[d[k] > bins[-1]] = L[-1, s[d[k] > bins[-1]]] - 1.0
        out[k] = v
    return out


# ---------- taxon size plausibility ----------
PALMLIKE = {"Washingtonia", "Phoenix", "Trachycarpus", "Archontophoenix", "Howea", "Syagrus", "Livistona", "Butia",
            "Rhopalostylis", "Chamaerops", "Cordyline", "Dracaena", "Yucca", "Cyathea", "Dicksonia", "Jubaea", "Brahea"}
SYN = {"Racosperma": "Acacia", "Eucalyptus": "Eucalyptus"}


def taxon_class(genus, ig):
    """Fallback size class from i-Tree growth form and mature height when a genus has too few links."""
    if genus is None:
        return None
    if genus in PALMLIKE:
        return "palmlike"
    r = ig.get(genus)
    if r is None:
        return "unknown_taxon"
    gf, mh = r
    hc = "s" if (mh or 0) < 10 else ("m" if (mh or 0) < 20 else "l")
    return f"{'conifer' if gf == 'conifer' else 'broadleaf'}_{hc}"


class SizeModel:
    def fit(self, links, crowns, ig, min_n=15):
        """links: trusted (tree_id, genus, seg_key, n_on_crown). Crown size per taxon, per record on the crown."""
        d = links.merge(crowns[["seg_key", "height_m", "crown_area_m2"]], on="seg_key")
        d = d[d.genus.notna()]
        d["lh"] = np.log(d.height_m.clip(1)); d["la"] = np.log((d.crown_area_m2 / d.n_on_crown).clip(1))
        d["tc"] = [taxon_class(g, ig) for g in d.genus]
        st = lambda x: (float(x.median()), float(max(1.4826 * (x - x.median()).abs().median(), 0.15)), len(x))
        self.genus = {g: (st(x.lh), st(x.la)) for g, x in d.groupby("genus") if len(x) >= min_n}
        self.cls = {g: (st(x.lh), st(x.la)) for g, x in d.groupby("tc") if len(x) >= min_n}
        bg = crowns[crowns.canopy_class.isin(["tree", "low_canopy"])]
        self.bg = (st(np.log(bg.height_m.clip(1))), st(np.log(bg.crown_area_m2.clip(1))))
        self.ig = ig
        return self

    def params(self, genus):
        if genus is None:
            return None
        if genus in self.genus:
            return self.genus[genus]
        tc = taxon_class(genus, self.ig)
        return self.cls.get(tc)

    def llr(self, genera, h, a_per):
        lp = lambda x, m, s: -0.5 * ((x - m) / s) ** 2 - np.log(s)
        out_h, out_a = np.zeros(len(h)), np.zeros(len(h))
        genera = pd.Series(genera).reset_index(drop=True)
        lh, la = np.log(np.clip(h, 1, None)), np.log(np.clip(a_per, 1, None))
        (bmh, bsh, _), (bma, bsa, _) = self.bg
        for g, idx in genera.groupby(genera).groups.items():
            p = self.params(g)
            if p is None:
                continue
            (mh, sh, _), (ma, sa, _) = p
            i = np.asarray(list(idx))
            out_h[i] = np.clip(lp(lh[i], mh, sh) - lp(lh[i], bmh, bsh), -6, 3)
            out_a[i] = np.clip(lp(la[i], ma, sa) - lp(la[i], bma, bsa), -6, 3)
        return out_h, out_a


# ---------- crown capacity ----------
class Capacity:
    """P(a crown holds >= j records | >= j-1, area), logistic in log area and j, from v5.1 crowns with inventory records."""

    def fit(self, counts):
        from sklearn.linear_model import LogisticRegression
        X, y = [], []
        for n, a in zip(counts.n, counts.area):
            for j in range(2, int(n) + 2):
                X.append([np.log(max(a, 1)), np.log(j - 1)]); y.append(int(n >= j))
                if j > n:
                    break
        self.m = LogisticRegression(C=10).fit(np.array(X), np.array(y))
        return self

    def pen(self, j, area):
        """cost of putting the j-th record (1-based) on a crown of this area; the first is free."""
        j = np.asarray(j, float); area = np.asarray(area, float)
        X = np.column_stack([np.log(np.clip(area, 1, None)), np.log(np.clip(j - 1, 1, None))])
        p = self.m.predict_proba(X)[:, 1]
        return np.where(j <= 1, 0.0, -np.log(np.clip(p, 1e-4, 1)))


# ---------- options and utilities ----------
def build_options(Q, cand, crowns, new, feat, existing, ctx, use=frozenset()):
    """Q: queries (qid, src_group, genus). cand/new carry d_edge (and d_edge_shift where a run shift applies).

    existing: seg_key -> (count of fixed records on crown, frozenset of their genera).
    use: ablation switches ('no_err', 'no_plaus', 'no_cap', 'no_new', 'no_run').
    """
    sm, cap = ctx["size"], ctx["cap"]
    c = cand.merge(Q[["qid", "src_group", "genus"]], on="qid")
    c = c.merge(crowns[["seg_key", "height_m", "crown_area_m2", "canopy_class"]], on="seg_key")
    c["d_use"] = c.d_edge_shift.fillna(c.d_edge) if ("d_edge_shift" in c and "no_run" not in use) else c.d_edge
    ex = c.seg_key.map(lambda k: existing.get(k, (0, frozenset())))
    c["n_ex"] = [e[0] for e in ex]
    if "self_seg" in Q:          # a training record's own link must not count as an occupant of its own crown
        c["n_ex"] = c.n_ex - (c.seg_key == c.qid.map(Q.set_index("qid").self_seg)).astype(int)
    c["x_conf"] = [float(g is not None and len(e[1]) > 0 and g not in e[1]) for g, e in zip(c.genus, ex)]
    c["x_off"] = -c.d_use.values if "no_err" in use else llr_edge(c.src_group.values, c.d_use.values, c.crown_area_m2.values)
    h, a = sm.llr(c.genus.values, c.height_m.values, c.crown_area_m2.values / (c.n_ex.values + 1))
    c["x_h"], c["x_a"] = (0.0, 0.0) if "no_plaus" in use else (h, a)
    c["x_cap"] = 0.0 if "no_cap" in use else -cap.pen(c.n_ex.values + 1, c.crown_area_m2.values)
    if "no_cap" in use:
        c["x_conf"] = 0.0
    c["x_low"] = (c.canopy_class != "tree").astype(float)
    c["kind"] = "crown"; c["okey"] = c.seg_key
    cols = ["qid", "kind", "okey", "d_use", "height_m", "crown_area_m2", "n_ex"] + EXIST_FEATS
    out = [c.rename(columns={})[cols]]
    if "no_new" not in use and new is not None and len(new):
        n = new.merge(Q[["qid", "src_group", "genus"]], on="qid")
        n = n[new_crown_gate(n).eq("ok").values]
        n["d_use"] = n.d_edge_shift.fillna(n.edge_distance_m) if ("d_edge_shift" in n.columns and "no_run" not in use) else n.edge_distance_m
        # A distinct seeded crown is a rare object: around trees whose own crown is known there are ~20x fewer of
        # them than v5 crowns (scenario.seed_background_ratio), so landing on or beside one is that much stronger
        # evidence - the likelihood-ratio method's background term, n(m), for this class of candidate.
        rho = ctx.get("seed_rho", 1.0)
        n["x_off"] = -n.d_use.values if "no_err" in use else llr_edge(n.src_group.values, n.d_use.values, n.crown_area_m2.values) - np.log(rho)
        nh, na = sm.llr(n.genus.values, n.height_m.values, n.crown_area_m2.values)
        n["x_h"], n["x_a"] = (0.0, 0.0) if "no_plaus" in use else (nh, na)
        n["x_conf"] = 0.0; n["x_cap"] = 0.0; n["x_low"] = 0.0
        ms = ctx.get("missing_share", {})
        m = n.src_group.map(lambda g: ms.get(g, {}).get("missing_share", 0.15)).clip(0.02, 0.6)
        n["x_prior"] = np.log(m / (1 - m))
        n["kind"] = "new"; n["okey"] = n.seg_key; n["n_ex"] = 0
        out.append(n[["qid", "kind", "okey", "d_use", "height_m", "crown_area_m2", "n_ex", "x_prior"] + EXIST_FEATS])
    z = Q[["qid", "src_group"]].merge(feat[["qid", "tall_3", "unc_tall_3", "bld_1p5", "unc_veg_3", "unc_c1g_3"]], on="qid", how="left")
    for g in GROUPS:
        z["z_" + g] = (z.src_group == g).astype(float)
    z["z_noveg"] = (z.tall_3.fillna(0) < 4).astype(float)
    z["z_bld"] = z.bld_1p5.fillna(0)
    z["z_unc"] = ((z.unc_veg_3.fillna(0) + z.unc_c1g_3.fillna(0)) >= 4).astype(float)
    z["kind"] = "null"; z["okey"] = "null"; z["n_ex"] = 0
    out.append(z[["qid", "kind", "okey", "n_ex"] + NULL_FEATS])
    O = pd.concat(out, ignore_index=True)
    for f in FEATS + ["x_prior"]:
        O[f] = O[f].fillna(0.0) if f in O else 0.0
    return O


def utilities(O, w):
    return O[FEATS].values @ np.array([w.get(f, 0.0) for f in FEATS]) + O.x_prior.values


def fit_weights(O, truth, sw=None, l2=0.05):
    """Conditional logit: maximise sum_r w_r log softmax(U_r)[true_r] over each record's options."""
    O = O.reset_index(drop=True)
    qi = pd.factorize(O.qid)[0]; nq = qi.max() + 1
    y = np.zeros(len(O)); key = O.qid + "|" + O.okey
    y[key.isin(truth.qid + "|" + truth.okey).values] = 1
    has = np.bincount(qi, weights=y, minlength=nq) > 0
    keep = has[qi]; X = O[FEATS].values[keep]; off = O.x_prior.values[keep]; y = y[keep]; qi = pd.factorize(O.qid[keep])[0]; nq = qi.max() + 1
    wq = np.ones(nq) if sw is None else pd.Series(sw).reindex(pd.unique(O.qid[keep])).fillna(1).values
    def nll(wv):
        u = X @ wv + off; m = np.full(nq, -np.inf); np.maximum.at(m, qi, u)
        e = np.exp(u - m[qi]); z = np.bincount(qi, weights=e, minlength=nq)
        lse = m + np.log(z); ut = np.bincount(qi, weights=u * y, minlength=nq)
        p = e / z[qi]
        grad = X.T @ ((y - p) * wq[qi])
        return -(wq * (ut - lse)).sum() + l2 * (wv ** 2).sum(), -grad + 2 * l2 * wv
    w0 = np.zeros(X.shape[1]); w0[FEATS.index("x_off")] = 1.0
    r = minimize(nll, w0, jac=True, method="L-BFGS-B")
    return dict(zip(FEATS, r.x)), float(r.fun)


# ---------- joint assignment ----------
def components(O):
    """Union records that share any crown or seeded-crown option."""
    q = pd.factorize(O.qid)[0]; o = pd.factorize(O.okey.where(O.kind != "null", "null|" + O.qid))[0]
    parent = np.arange(q.max() + 1)
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    first = {}
    for qi, oi in zip(q, o):
        if oi in first:
            ra, rb = find(qi), find(first[oi])
            if ra != rb:
                parent[ra] = rb
        else:
            first[oi] = qi
    roots = np.array([find(i) for i in range(len(parent))])
    return pd.Series(roots[q], index=O.index)


def solve(Oc, cap_fn, w_cap, max_slots=8, w_xcap=0.0):
    """Min-cost assignment for one neighbourhood: a column per crown slot (slot j priced by capacity) plus a private null per record."""
    qids = list(pd.unique(Oc.qid)); qpos = {q: i for i, q in enumerate(qids)}
    cols = []
    nz = Oc[Oc.kind != "null"]
    for (kind, okey), g in nz.groupby(["kind", "okey"], sort=False):
        e = int(g.n_ex.iloc[0]); area = float(g.crown_area_m2.iloc[0]); m = min(len(g), max_slots)
        if w_cap:
            # marginal cost per extra record, made non-decreasing so slots fill in order (the fitted conditional
            # probabilities rise with j, which would let a solver skip to a cheaper later slot)
            pens = np.maximum.accumulate(cap_fn(np.arange(e + 1, e + m + 1), np.full(m, area))); base = pens[0]
        else:
            pens = np.zeros(m); base = 0.0
        # every slot, the first included, is priced at the assignment's capacity scale: the utility carries the
        # choice model's (small) x_cap weight for the first slot, which is swapped out here
        for j in range(m):
            cols.append((g.index.values, g.qid.values, g.U.values + w_xcap * base - w_cap * pens[j]))
    nq = len(qids); nc = len(cols) + nq
    M = np.full((nq, nc), BIG); rowidx = np.full((nq, nc), -1)
    for ci, (ix, qs, u) in enumerate(cols):
        r = [qpos[q] for q in qs]; M[r, ci] = -u; rowidx[r, ci] = ix
    nu = Oc[Oc.kind == "null"]
    for ix, q, u in zip(nu.index, nu.qid, nu.U):
        M[qpos[q], len(cols) + qpos[q]] = -u; rowidx[qpos[q], len(cols) + qpos[q]] = ix
    r, c = linear_sum_assignment(M)
    return qids, M, rowidx, r, c


def assign(O, cap, w, margins=True, max_exact=150):
    """Assign every query jointly per neighbourhood; margin = utility lost by the best solution that forbids the choice."""
    O = O.copy(); O["U"] = utilities(O, w)
    full = O.copy()
    nullU = O[O.kind == "null"].set_index("qid").U
    O = O[(O.kind == "null") | (O.U >= O.qid.map(nullU) - PRUNE)].reset_index(drop=True)
    O["comp"] = components(O)
    # The choice model sees one record at a time, so it cannot learn what crowding costs; in the joint assignment
    # each extra record on a crown is priced at no less than its own log-probability under the capacity model.
    w_cap = max(w.get("x_cap", 0.0), 1.0) if cap is not None else 0.0
    cap_fn = (lambda j, a: cap.pen(j, a)) if cap is not None else (lambda j, a: np.zeros(len(j)))
    res = []
    for comp, Oc in O.groupby("comp"):
        qids, M, rowidx, r, c = solve(Oc, cap_fn, w_cap, w_xcap=w.get("x_cap", 0.0) if cap is not None else 0.0)
        best = M[r, c].sum()
        for i, j in zip(r, c):
            ix = rowidx[i, j]; q = qids[i]
            rec = {"qid": q, "opt": ix, "comp_n": len(qids)}
            if margins:
                if len(qids) <= max_exact:
                    M2 = M.copy(); M2[i, rowidx[i] == ix] = BIG
                    r2, c2 = linear_sum_assignment(M2)
                    rec["margin"] = float(M2[r2, c2].sum() - best)
                else:
                    alt = Oc[(Oc.qid == q) & (Oc.index != ix)]
                    rec["margin"] = float(O.at[ix, "U"] - alt.U.max()) if len(alt) else 99.0
            res.append(rec)
    A = pd.DataFrame(res)
    A["U"] = O.loc[A.opt.values, "U"].values; A["kind"] = O.loc[A.opt.values, "kind"].values
    A["okey"] = O.loc[A.opt.values, "okey"].values
    e = np.exp(full.U - full.groupby("qid").U.transform("max")); full["p_local"] = e / e.groupby(full.qid).transform("sum")
    key = full.qid + "|" + full.okey
    A["p_local"] = (A.qid + "|" + A.okey).map(dict(zip(key, full.p_local))).values
    full["rank"] = full.groupby("qid").U.rank(ascending=False, method="first")
    A["opt"] = (A.qid + "|" + A.okey).map(dict(zip(key, full.index))).values
    return A, full


# ---------- confidence ----------
CONF_FEATS = ["margin", "u_gap_best", "m_crown", "m_null", "d_use", "inside", "gap2", "n_cand3", "height_m", "area_log", "n_ex", "x_h",
              "unc_tall_1p5", "unc_tall_3", "unc_veg_3", "unc_c1g_3", "tall_1p5", "bld_1p5", "seed_d", "seed_cont", "seed_cont_chosen",
              "g_register_at", "g_register_parks", "g_notable", "g_osm", "g_kauri_obs"]


def conf_features(A, Oa, feat, new_raw, Q):
    """Evidence about a chosen option beyond its utility: how close the runner-up crown is, how much tree-height
    canopy stands uncovered near the point (the signature of a tree whose crown was never drawn), and whether
    the record's own seeded crown was set aside as part of a neighbour. Used by the confidence model only."""
    O = Oa
    ch = A[["qid", "okey", "kind", "U", "margin"]]
    nu = O[O.kind == "null"].set_index("qid").U
    cr = O[O.kind == "crown"]
    oth = cr.merge(ch[["qid", "okey"]].rename(columns={"okey": "ch"}), on="qid")
    oth = oth[oth.okey != oth.ch]
    best_other = oth.groupby("qid").U.max(); d_other = oth.groupby("qid").d_use.min()
    near3 = cr[cr.d_use <= 3].groupby("qid").size()
    sel = O.loc[A.opt.values, ["d_use", "height_m", "crown_area_m2", "n_ex", "x_h"]].reset_index(drop=True)
    F = A[["qid"]].reset_index(drop=True).join(sel)
    F["margin"] = A.margin.values
    F["m_crown"] = (A.U.values - A.qid.map(best_other).values); F["m_crown"] = F.m_crown.fillna(15).clip(-15, 15)
    F["m_null"] = (A.U.values - A.qid.map(nu).values)
    # 0 when the record got its own best option; negative when crowding pushed it to a lesser one
    F["u_gap_best"] = (A.U.values - A.qid.map(O.groupby("qid").U.max()).values).clip(-15, 0)
    F["inside"] = (F.d_use.fillna(99) <= 0).astype(float)
    F["gap2"] = (A.qid.map(d_other).values - F.d_use.values); F["gap2"] = F.gap2.fillna(40).clip(-40, 40)
    F["n_cand3"] = A.qid.map(near3).fillna(0).values
    F["area_log"] = np.log(F.crown_area_m2.clip(1))
    f = feat.set_index("qid").reindex(A.qid)
    for c in ["unc_tall_1p5", "unc_tall_3", "unc_veg_3", "unc_c1g_3", "tall_1p5", "bld_1p5"]:
        F[c] = f[c].values if c in f else 0.0
    nr = new_raw.sort_values("edge_distance_m").drop_duplicates("qid").set_index("qid") if len(new_raw) else None
    F["seed_d"] = A.qid.map(nr.edge_distance_m).fillna(30).values if nr is not None else 30.0
    F["seed_cont"] = A.qid.map(nr.continuous_with_existing.astype(float)).fillna(0).values if (nr is not None and "continuous_with_existing" in nr) else 0.0
    # continuous with the chosen crown itself: the uncovered remainder of the same tree, which supports the link
    F["seed_cont_chosen"] = ((A.qid.map(nr.saddle_seg).values == A.okey.values) & (F.seed_cont.values > 0)).astype(float) \
        if (nr is not None and "saddle_seg" in nr) else 0.0
    grp = A.qid.map(Q.set_index("qid").src_group).values
    for g in GROUPS:
        F["g_" + g] = (grp == g).astype(float)
    return F[CONF_FEATS].fillna(0.0).values


def conf_model(X, y, w):
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(max_depth=3, max_iter=250, learning_rate=0.05, min_samples_leaf=40,
                                          l2_regularization=1.0, random_state=0).fit(X, y, sample_weight=w)
