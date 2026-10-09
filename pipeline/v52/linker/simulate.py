"""Make realistic test records with known answers, for hold-out evaluation and for fitting the weights.

Hiding a trusted link and asking the matcher to find it again is too easy here: every trusted
record already sits inside its crown (that is why it is linked). So each trusted record is moved
to where an unlinked record of its source would be relative to its crown: an edge distance drawn
from the learned offset distribution of that source's unlinked records, in a random direction from the crown
top (records drawn at distance 0 keep their own point). Rows of trusted register records (run
segments with >= 3 trusted members) are instead moved together by one shift drawn from the shifts
accepted on real runs, with the observed probability that a real run needs one, so run alignment
is tested on correlated error, not on independent noise. A displaced point that lands inside another
tree's crown is redrawn: v5 links such points, so real unlinked records almost never sit there, and
keeping them would test the matcher on a situation that does not occur. A third of the singly linked records are
also copied with their crown deleted ("simdel"): the right answer is then the record-seeded crown
over the same tree, or no crown - never another tree's crown.

Folds are by record (a stable hash of the id), so a hidden record's neighbours are mostly still linked, as
they are for real unlinked records.
"""
import json
import numpy as np, pandas as pd
from shapely import from_wkb, STRtree, points as P_, distance as D_
from common import WORK

rng = np.random.default_rng(5252)
BLOCK = 800.0


def trusted(R, crowns):
    lk = R[R.link_seg.notna() & R.link_seg.isin(crowns.seg_key) & R.automatic_crown_link_allowed.fillna(1).ne(0)].copy()
    gen = lk.groupby("link_seg").genus.agg(lambda s: set(s.dropna()))
    lk["n_on_crown"] = lk.link_seg.map(lk.groupby("link_seg").size())
    lk = lk[lk.link_seg.map(gen).map(len) <= 1]          # one genus (or none) recorded on the crown
    return lk


def main():
    R = pd.read_parquet(WORK / "records.parquet"); K = pd.read_parquet(WORK / "crowns.parquet")
    EM = json.loads((WORK / "errmodel.json").read_text())
    T = trusted(R, K).reset_index(drop=True)
    # Folds by record, not by area: in reality an unlinked record's neighbours are mostly linked (about half of
    # register records are), and whether a neighbouring crown is already taken is real evidence. Hiding whole
    # 800 m blocks would hide every neighbour at once and test a situation that does not occur.
    import zlib
    T["fold"] = [zlib.crc32(t.encode()) % 5 for t in T.tree_id]
    shifts = pd.read_parquet(WORK / "run_shifts_real.parquet"); mem = pd.read_parquet(WORK / "run_members_real.parquet")
    acc = shifts[shifts.accepted]
    p_shift = len(acc) / max(len(shifts), 1)
    # rows: run segments with >= 3 trusted members get one common shift (or none) for all of them
    tm = mem[mem.qid.isin(T.tree_id)]
    seg_n = tm.groupby("run_id").size()
    row_ids = seg_n[seg_n >= 3].index
    common = {}
    for rid in row_ids:
        if rng.random() < p_shift and len(acc):
            a = acc.iloc[rng.integers(len(acc))]; common[rid] = (a.sdx, a.sdy)
        else:
            common[rid] = None
    run_of = dict(zip(tm[tm.run_id.isin(row_ids)].qid, tm[tm.run_id.isin(row_ids)].run_id))
    Kg = K.set_index("seg_key")
    polys = from_wkb(Kg.crown_wkb.reindex(T.link_seg).values)
    tops = Kg[["x_2193", "y_2193"]].reindex(T.link_seg).values
    area = Kg.crown_area_m2.reindex(T.link_seg).values
    sx, sy, how, dtarget = T.x.values.copy(), T.y.values.copy(), np.array(["inside"] * len(T), dtype=object), np.zeros(len(T))
    bins = None
    for i, r in T.iterrows():
        rid = run_of.get(r.tree_id)
        if rid is not None and common[rid] is not None:      # the whole row moves together
            v = common[rid]
            sx[i] += v[0] + rng.normal(0, 0.3); sy[i] += v[1] + rng.normal(0, 0.3); how[i] = "row_shift"
            continue
        m = EM[r.src_group]; f = np.array(m["f_edge_unlinked"]); bins = np.array(m["bins"])
        p = f / f.sum(); b = rng.choice(len(p), p=p)
        if b == 0:
            continue
        d = rng.uniform(bins[b], bins[b + 1]); dtarget[i] = d; how[i] = "offset"
        th = rng.uniform(0, 2 * np.pi); u = np.array([np.cos(th), np.sin(th)])
        ts = np.arange(0, 80, 0.25)
        q = P_(tops[i, 0] + ts * u[0], tops[i, 1] + ts * u[1])
        dd = D_(q, polys[i])
        k = np.argmax(dd >= d)
        sx[i], sy[i] = tops[i, 0] + ts[k] * u[0], tops[i, 1] + ts[k] * u[1]
    # Selection: a real unlinked record is almost never inside another tree's crown - v5 would have linked it
    # there (5% of unlinked records are, against 15-28% of random points). A displaced point that lands inside
    # another crown is redrawn from a second random stream, so every accepted first draw is reproduced exactly.
    K2 = K[K.canopy_class.isin(["tree", "low_canopy"])].reset_index(drop=True)
    kg = from_wkb(K2.crown_wkb.values); tree = STRtree(kg); keys = K2.seg_key.values
    def inside_other(x, y, own):
        hit = tree.query(P_(x, y), predicate="within")
        return any(keys[j] != own for j in np.atleast_1d(hit))
    rng2 = np.random.default_rng(777); dropped = []
    for i in np.where(how == "offset")[0]:
        if not inside_other(sx[i], sy[i], T.link_seg.iat[i]):
            continue
        m = EM[T.src_group.iat[i]]; f = np.array(m["f_edge_unlinked"]); bins = np.array(m["bins"]); p = f / f.sum()
        for attempt in range(60):
            b = rng2.choice(len(p), p=p)
            if b == 0:
                sx[i], sy[i], how[i], dtarget[i] = T.x.iat[i], T.y.iat[i], "inside", 0.0; break
            d = rng2.uniform(bins[b], bins[b + 1]); th = rng2.uniform(0, 2 * np.pi); u = np.array([np.cos(th), np.sin(th)])
            ts = np.arange(0, 80, 0.25)
            dd = D_(P_(tops[i, 0] + ts * u[0], tops[i, 1] + ts * u[1]), polys[i]); k = np.argmax(dd >= d)
            x_, y_ = tops[i, 0] + ts[k] * u[0], tops[i, 1] + ts[k] * u[1]
            if not inside_other(x_, y_, T.link_seg.iat[i]):
                sx[i], sy[i], dtarget[i], how[i] = x_, y_, d, "offset_redrawn"; break
        else:
            dropped.append(i)
    T["sx"], T["sy"], T["sim_how"], T["d_target"] = sx, sy, how, dtarget
    T = T.drop(index=dropped).reset_index(drop=True)
    sx, sy, how = T.sx.values, T.sy.values, T.sim_how.values
    polys = from_wkb(Kg.crown_wkb.reindex(T.link_seg).values)
    print("redrawn", int((how == "offset_redrawn").sum()), "dropped (no gap within reach)", len(dropped))
    T["d_edge_sim"] = D_(P_(sx, sy), polys)
    Q = T[["tree_id", "src_group", "genus", "fold", "link_seg", "n_on_crown", "sim_how", "d_target", "d_edge_sim"]].copy()
    Q["x"], Q["y"] = sx, sy; Q["qid"] = Q.tree_id + "|sim"; Q["del_seg"] = None
    single = Q[Q.n_on_crown.eq(1)]
    import zlib     # a stable third of singly linked records, chosen by id so reruns pick the same ones
    D = single[single.tree_id.map(lambda t: zlib.crc32(t.encode()) % 3 == 0)].copy()
    D["qid"] = D.tree_id + "|simdel"; D["del_seg"] = D.link_seg
    Q = pd.concat([Q, D], ignore_index=True)
    from common import tname
    Q["tile"] = [tname(a, b) for a, b in zip(Q.x, Q.y)]
    Q.to_parquet(WORK / "sim_queries.parquet", index=False)
    print(len(T), Q.qid.str.endswith("simdel").sum(), pd.Series(how).value_counts().to_dict(), "p_shift=%.3f" % p_shift)
    print(Q.groupby("src_group").d_edge_sim.describe().round(2))


if __name__ == "__main__":
    main()
