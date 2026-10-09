"""Learn how far each source's recorded positions sit from their trees, from the unlinked records themselves.

The obvious training set - records v5.1 already links - cannot teach this: v4 linked only records
within 3 m of a crown and v5 kept only links whose point falls inside the crown, so every existing
link is a record with a small offset by construction (100% of linked notable, OSM and kauri
records sit inside their crown). The records we must place are exactly the ones those rules
rejected. So the offset distribution is estimated the way astronomers cross-match catalogues
(the likelihood-ratio method of Sutherland & Saunders 1992): around every unlinked record, count
crowns by edge distance; around decoy points 25-45 m away (same streets, same canopy density) count
the crowns that are unrelated by construction; and fit by EM the mixture "one true crown at offset
d ~ f(d), plus unrelated crowns at background rate g(d), or no crown at all (1 - pi)". f is the
error model, f/g the evidence an offset carries, pi the share of records whose tree has a crown.

Fitted per source group and per crown-size class (offsets measured to the crown edge still grow
with crown size). Also reported: the direction of offsets (systematic shift), from the
responsibility-weighted vectors record -> crown top.
"""
import json, sys
import numpy as np, pandas as pd
from shapely import from_wkb, STRtree, points as P_, distance as D_
from common import WORK, EVAL, load_crowns, tiles_around

BINS = np.array([0.0, 1e-6, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 13.0, 16.0, 20.0, 25.0])
DMAX = 25.0
SIZE_EDGES = np.array([0, 2.0, 4.0, 1e9])            # crown radius classes, m
rng = np.random.default_rng(52)


def bin_of(d):
    return np.clip(np.searchsorted(BINS, d, side="right") - 1, 0, len(BINS) - 2)


def size_of(area):
    return np.clip(np.searchsorted(SIZE_EDGES, np.sqrt(np.asarray(area) / np.pi), side="right") - 1, 0, len(SIZE_EDGES) - 2)


def decoy_counts(recs, n_decoy=3):
    """Per-decoy expected count of crowns by (edge-distance bin, size class), decoys 25-45 m from each record."""
    out = np.zeros((len(BINS) - 1, len(SIZE_EDGES) - 1)); n = 0
    for tile, g in recs.groupby("tile"):
        th = rng.uniform(0, 2 * np.pi, (len(g), n_decoy)); rr = rng.uniform(25, 45, (len(g), n_decoy))
        dx = (g.x.values[:, None] + rr * np.cos(th)).ravel(); dy = (g.y.values[:, None] + rr * np.sin(th)).ravel()
        cs = [c for t in tiles_around(g.x.mean(), g.y.mean(), 480) if (c := load_crowns(t)) is not None]
        if not cs:
            continue
        c = pd.concat(cs); c = c[c.canopy_class.isin(["tree", "low_canopy"])]
        geoms = from_wkb(c.crown_wkb.values); tree = STRtree(geoms); pts = P_(dx, dy)
        pi, ci = tree.query(pts, predicate="dwithin", distance=DMAX)
        d = D_(pts[pi], geoms[ci])
        np.add.at(out, (bin_of(d), size_of(c.crown_area_m2.values[ci])), 1)
        n += len(pts)
    return out / max(n, 1), n


def pav_decreasing(y, w):
    """Weighted isotonic (non-increasing) fit: evidence must not grow with distance."""
    from sklearn.isotonic import IsotonicRegression
    return IsotonicRegression(increasing=False).fit(np.arange(len(y)), y, sample_weight=np.maximum(w, 1e-6)).predict(np.arange(len(y)))


def em(cand, g, cls, iters=300, alpha=0.005):
    """Mixture EM over every record of a source (linked and unlinked).

    cand: rows (rid, bin, sz) of each crown within DMAX of each record; g[b, s]: decoy count per record;
    cls[r]: 0 linked / 1 unlinked (each class has its own share pi of records whose tree has a crown).
    The true crown's offset is f(b|s) = f_in[s] inside the polygon, else (1 - f_in[s]) h[b] - one outside
    shape shared by all crown sizes - and q[s] is how often the true crown has size class s.
    """
    nb, ns = g.shape
    rid = cand.rid.values; b = cand.bin.values; s = cand.sz.values; nr = len(cls)
    gg = np.maximum(g, 1e-4)
    q = np.ones(ns) / ns; fin = np.full(ns, 0.4); h = np.exp(-np.arange(1, nb) / 3.0); h /= h.sum(); pi = np.array([0.9, 0.6])
    for it in range(iters):
        f = np.vstack([fin[None, :], (1 - fin)[None, :] * h[:, None]])
        L = pi[cls[rid]] * q[s] * f[b, s] / gg[b, s]
        tot = np.bincount(rid, weights=L, minlength=nr) + (1 - pi[cls])
        w = L / tot[rid]
        W = np.zeros((nb, ns)); np.add.at(W, (b, s), w)
        qn = W.sum(0) / W.sum()
        fin_n = W[0] / np.maximum(W.sum(0), 1e-9)
        ho = W[1:].sum(1) + alpha * W.sum() / (nb - 1); hn = ho / ho.sum()
        per = np.bincount(rid, weights=w, minlength=nr)
        pin = np.array([per[cls == k].mean() if (cls == k).any() else 0.5 for k in (0, 1)])
        delta = max(np.abs(qn - q).max(), np.abs(fin_n - fin).max(), np.abs(hn - h).max(), np.abs(pin - pi).max())
        q, fin, h, pi = qn, fin_n, hn, np.clip(pin, 1e-3, 1 - 1e-3)
        if delta < 1e-7:
            break
    f = np.vstack([fin[None, :], (1 - fin)[None, :] * h[:, None]])
    llr = np.log(np.maximum(q[None, :] * f, 1e-6) / gg)
    for k in range(ns):            # monotone outside the crown, weighted by how much mass each bin carries
        llr[1:, k] = pav_decreasing(llr[1:, k], W[1:, k] + 1)
    return dict(q=q, f_in=fin, h=h, pi=pi, llr=llr, W=W), w


def main():
    R = pd.read_parquet(WORK / "records.parquet"); C = pd.read_parquet(WORK / "cand.parquet")
    K = pd.read_parquet(WORK / "crowns.parquet", columns=["seg_key", "crown_area_m2", "height_m"])
    C = C.rename(columns={"qid": "tree_id"})
    cov = set(R[R.tree_id.isin(C.tree_id)].tile)
    model, vecs = {}, []
    for grp, Pg in R[R.tile.isin(cov)].groupby("src_group"):
        # 1) unlinked records: EM for the offset tail and the share whose tree has a crown at all
        Ug = Pg[Pg.unlinked].reset_index(drop=True); Ug["rid"] = np.arange(len(Ug))
        c = C.merge(Ug[["tree_id", "rid"]], on="tree_id").merge(K, on="seg_key")
        c = c[c.d_edge <= DMAX].copy()
        c["bin"] = bin_of(c.d_edge.values); c["sz"] = size_of(c.crown_area_m2.values)
        g, nd = decoy_counts(Pg)
        m, w = em(c, g, np.ones(len(Ug), int))
        c["w"] = w
        # 2) linked records sit at their crown by selection; add them back so the inside share is the population's
        lk = Pg[Pg.link_seg.notna()].merge(C, left_on=["tree_id", "link_seg"], right_on=["tree_id", "seg_key"]).merge(K, on="seg_key")
        Wl = np.zeros_like(m["W"]); np.add.at(Wl, (bin_of(lk.d_edge.values), size_of(lk.crown_area_m2.values)), 1.0)
        W = m["W"] + Wl
        nb, ns = W.shape
        q = W.sum(0) / W.sum(); fin = W[0] / np.maximum(W.sum(0), 1e-9)
        ho = W[1:].sum(1) + 0.005 * W.sum() / (nb - 1); h = ho / ho.sum()
        f = np.vstack([fin[None, :], (1 - fin)[None, :] * h[:, None]])
        llr = np.log(np.maximum(q[None, :] * f, 1e-6) / np.maximum(g, 1e-4))
        for k in range(ns):
            llr[1:, k] = pav_decreasing(llr[1:, k], W[1:, k] + 1)
        f_edge = W.sum(1) / W.sum(); fu = m["W"].sum(1) / m["W"].sum()
        model[grp] = {"bins": BINS.tolist(), "size_edges_radius_m": SIZE_EDGES.tolist(), "llr": llr.round(4).tolist(),
                      "g": g.round(5).tolist(), "q_size": q.round(4).tolist(), "f_inside_by_size": fin.round(4).tolist(),
                      "h_outside": h.round(5).tolist(), "pi": float(m["pi"][1]),
                      "n_records": int(len(Pg)), "n_unlinked": int(len(Ug)), "n_linked_used": int(len(lk)), "n_decoys": int(nd),
                      "f_edge_population": f_edge.round(5).tolist(), "f_edge_unlinked": fu.round(5).tolist(),
                      "cum_f_edge_unlinked": np.cumsum(fu).round(4).tolist()}
        mm = c[c.w > 0.05]
        vecs.append(pd.DataFrame({"src_group": grp, "tree_id": mm.tree_id, "seg_key": mm.seg_key, "w": mm.w, "dx": mm.dx, "dy": mm.dy,
                                  "d_edge": mm.d_edge, "d_top": mm.d_top, "area": mm.crown_area_m2}))
        print(grp, len(Ug), len(lk), "pi_unlinked=%.3f" % m["pi"][1], "f_in:", fin.round(3).tolist(),
              "\n   unlinked edge pmf:", fu.round(3).tolist(), "\n   LLR(size1):", llr[:, 1].round(2).tolist(), flush=True)
    V = pd.concat(vecs)
    # systematic direction: responsibility-weighted mean vector record -> crown top, and its share of the mean length
    for grp, v in V.groupby("src_group"):
        mx, my = np.average(v.dx, weights=v.w), np.average(v.dy, weights=v.w)
        ml = np.average(np.hypot(v.dx, v.dy), weights=v.w)
        R_ = np.hypot(np.average(v.dx / np.maximum(v.d_top, 1e-6), weights=v.w), np.average(v.dy / np.maximum(v.d_top, 1e-6), weights=v.w))
        model[grp]["mean_vector_to_top_m"] = [round(mx, 3), round(my, 3)]
        model[grp]["mean_offset_to_top_m"] = round(ml, 3)
        model[grp]["direction_resultant_length"] = round(float(R_), 4)
        for k, (lo, hi) in enumerate(zip(SIZE_EDGES[:-1], SIZE_EDGES[1:])):
            vv = v[(np.sqrt(v.area / np.pi) >= lo) & (np.sqrt(v.area / np.pi) < hi)]
            if len(vv):
                model[grp][f"median_edge_offset_size{k}"] = round(float(np.average(vv.d_edge, weights=vv.w)), 3)
    (WORK / "errmodel.json").write_text(json.dumps(model, indent=1))
    V.to_parquet(WORK / "em_vectors.parquet", index=False)


if __name__ == "__main__":
    main()
