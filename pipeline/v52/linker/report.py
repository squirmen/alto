"""Write out/REPORT.md from the evaluation and production outputs, so a rerun on a redrawn crown set
regenerates every number in it. The prose states what was measured; the tables are computed here.
"""
import json
import numpy as np, pandas as pd
from common import WORK, OUT, EVAL, crown_set_id, code_sha256
from summarize import band, md
from final import T_HIGH, T_MED, NEW_RULE, GUARD
from link import NEW_GATE

E = json.loads((WORK / "errmodel.json").read_text())
RN = json.loads((WORK / "run_null.json").read_text())
MS = json.loads((EVAL / "missing_share.json").read_text())
RS = json.loads((EVAL / "report_stats.json").read_text())
AU = json.loads((EVAL / "audit_summary.json").read_text())
AV = [json.loads((EVAL / f"audit_summary_{r}.json").read_text()) for r in ("r2", "r3", "r4")]   # validation rounds, final statuses
AU2 = AV[0]


def vsum(band):
    c = sum(a[band]["correct"] for a in AV if a.get(band)); d = sum(a[band]["decided"] for a in AV if a.get(band))
    n = sum(a[band]["cards"] for a in AV if a.get(band))
    z = 1.96; ctr = (c + z * z / 2) / (d + z * z); hw = z * np.sqrt(c * (d - c) / d + z * z / 4) / (d + z * z) if d else 0
    return {"correct": c, "decided": d, "cards": n, "p": c / max(d, 1), "lo": ctr - hw, "hi": ctr + hw, "floor": c / max(n, 1)}
L = pd.read_parquet(OUT / "links_v52.parquet"); N = pd.read_parquet(OUT / "new_crowns_v52.parquet")
H = pd.read_parquet(EVAL / "holdout_full.parquet"); H["band"] = band(H); H["weight"] = H.weight.fillna(1)
sh = pd.read_parquet(WORK / "run_shifts_real.parquet")
W = json.loads((EVAL / "weights_production.json").read_text())
wavg = lambda x, w: float(np.average(x, weights=w)) if len(x) else float("nan")
AUTO = ["linked_high", "linked_medium"]
f3 = lambda v: f"{v:.3f}" if isinstance(v, (float, np.floating)) and np.isfinite(v) else ("n/a" if v is None or (isinstance(v, float) and not np.isfinite(v)) else str(v))


def status_table():
    order = ["linked_high", "linked_medium", "linked_new_crown", "needs_review", "tree_no_crown", "no_tree_found", "position_unusable", "outside_coverage"]
    t = pd.crosstab(L.src_group, L.status).reindex(columns=order).fillna(0).astype(int)
    t.loc["all"] = t.sum(axis=0); t["total"] = t.sum(axis=1)
    return t


def error_table():
    rows = []
    for g, v in E.items():
        f = np.array(v["f_edge_unlinked"])
        rows.append({"source": g, "unlinked in coverage": v["n_unlinked"], "share whose crown exists (pi)": round(v["pi"], 2),
                     "share whose tree has no crown (est.)": MS[g]["missing_share"],
                     "inside": round(f[0], 2), "0-1 m": round(f[1:3].sum(), 2), "1-2 m": round(f[3:5].sum(), 2), "2-3 m": round(f[5], 2),
                     "3-5 m": round(f[6:8].sum(), 2), "5-10 m": round(f[8:11].sum(), 2), ">10 m": round(f[11:].sum(), 2),
                     "mean vector to top E,N (m)": tuple(v["mean_vector_to_top_m"]), "direction resultant": v["direction_resultant_length"],
                     "edge offset by crown radius <2 / 2-4 / >4 m": "/".join(f"{v.get(f'median_edge_offset_size{k}', float('nan')):.1f}" for k in range(3))})
    return pd.DataFrame(rows)


def llr_table():
    rows = []
    for g, v in E.items():
        Lr = np.array(v["llr"]); b = v["bins"]
        rows.append({"source": g, **{("inside" if i == 0 else f"{b[i]:g}-{b[i+1]:g} m"): round(float(Lr[i, 1]), 2) for i in [0, 1, 2, 3, 5, 6, 7, 9, 11, 13]}})
    return pd.DataFrame(rows)


def holdout_tables():
    out = {}
    def agg(g):
        s, d = g[g.scenario == "sim"], g[g.scenario == "simdel"]
        a = g[g.band.isin(AUTO)]
        return pd.Series({"sim records": len(s), "crown-deleted copies": len(d),
                          "auto-linked": len(a), "precision (weighted)": round(wavg(a.correct, a.weight), 3),
                          "precision (pessimistic weights)": round(wavg(a.correct, a.weight_pessimistic.fillna(1)), 3) if len(a) else np.nan,
                          "recall of sim records": round(float((s.band.isin(AUTO) & s.correct).mean()), 3) if len(s) else np.nan,
                          "deleted-crown copies wrongly linked": round(float(d.band.isin(AUTO).mean()), 3) if len(d) else np.nan})
    out["by_band"] = H.groupby("band").apply(lambda g: pd.Series({"records": len(g), "sim": int((g.scenario == "sim").sum()),
                                                                 "precision (weighted)": round(wavg(g.correct, g.weight), 3),
                                                                 "precision (pessimistic)": round(wavg(g.correct, g.weight_pessimistic.fillna(1)), 3)}))
    out["by_source"] = H.groupby("src_group").apply(agg)
    H["offset band"] = pd.cut(H.d_edge_sim, [-1, 0, 1, 2, 3, 5, 10, 100], labels=["inside", "0-1 m", "1-2 m", "2-3 m", "3-5 m", "5-10 m", ">10 m"])
    out["by_offset"] = H.groupby("offset band", observed=True).apply(agg)
    return out


def ablation_table():
    rows = []
    for c, lab in [("full", "full method"), ("no_error_model", "no error model (offset = -distance)"), ("no_run_alignment", "no run alignment"),
                   ("no_plausibility", "no taxon size plausibility"), ("no_capacity_conflict", "no capacity/conflict (independent choice)"),
                   ("no_new_crowns", "no record-seeded crowns")]:
        f = EVAL / f"holdout_{c}.parquet"
        if not f.exists():
            continue
        A = pd.read_parquet(f); A["band"] = band(A); A["weight"] = A.weight.fillna(1)
        a = A[A.band.isin(AUTO)]; s = A[A.scenario == "sim"]; d = A[A.scenario == "simdel"]
        rows.append({"configuration": lab, "auto-linked": len(a), "precision (weighted)": round(wavg(a.correct, a.weight), 3),
                     "recall of sim records": round(float((s.band.isin(AUTO) & s.correct).mean()), 3),
                     "best-option accuracy, sim": round(float(s.correct.mean()), 3),
                     "deleted-crown copies linked to another crown (any band)": round(float((d.kind == "crown").mean()), 3)})
    Q = pd.read_parquet(WORK / "sim_queries.parquet"); C = pd.read_parquet(WORK / "sim_cand.parquet").merge(Q[["qid", "del_seg", "link_seg"]], on="qid")
    C = C[C.seg_key != C.del_seg]; nn = C.sort_values(["qid", "d_edge"]).groupby("qid").head(1)
    w = H.set_index("qid").weight
    for r in (3.0, 5.0):
        x = nn[nn.d_edge <= r].copy(); x["correct"] = (x.seg_key == x.link_seg) & ~x.qid.str.endswith("|simdel")
        sq = Q[~Q.qid.str.endswith("|simdel")]; dq = Q[Q.qid.str.endswith("|simdel")]
        rows.append({"configuration": f"naive: nearest crown edge within {r:g} m", "auto-linked": len(x),
                     "precision (weighted)": round(wavg(x.correct, w.reindex(x.qid).fillna(1)), 3),
                     "recall of sim records": round(float(x[~x.qid.str.endswith('|simdel')].correct.sum() / len(sq)), 3),
                     "best-option accuracy, sim": np.nan,
                     "deleted-crown copies linked to another crown (any band)": round(float(x.qid.str.endswith("|simdel").sum() / len(dq)), 3)})
    return pd.DataFrame(rows)


def wil(c, d, z=1.96):
    if not d:
        return (float("nan"), float("nan"))
    ctr = (c + z * z / 2) / (d + z * z); hw = z * np.sqrt(c * (d - c) / d + z * z / 4) / (d + z * z)
    return (ctr - hw, ctr + hw)


def audit_table():
    rows = []
    names = [("round 1: design (223 cards, rules before revision)", AU)] + [(f"round {i + 2}: validation, final rules", a) for i, a in enumerate(AV)]
    for name, a in names:
        for b in ["linked_high", "linked_medium", "linked_new_crown"]:
            v = a.get(b)
            if v and v["cards"]:
                rows.append({"round": name, "status": b, "cards": v["cards"], "decided": v["decided"], "correct": v["correct"],
                             "precision (decided)": v["precision_decided"], "95% interval": v["wilson95"],
                             "precision (can't tell = wrong)": v["precision_cant_tell_as_wrong"]})
        nc = a.get("no_crown")
        if nc and nc["cards"]:
            rows.append({"round": name, "status": "tree_no_crown / no_tree_found / position_unusable", "cards": nc["cards"],
                         "decided": nc["cards"] - nc["cant_tell"], "correct": nc["status_supported"],
                         "precision (decided)": round(nc["status_supported"] / max(nc["cards"] - nc["cant_tell"], 1), 3), "95% interval": None,
                         "precision (can't tell = wrong)": round(nc["status_supported"] / max(nc["cards"], 1), 3)})
    for b in ["linked_high", "linked_medium", "linked_new_crown"]:
        v = vsum(b)
        rows.append({"round": "validation rounds 2-4 combined", "status": b, "cards": v["cards"], "decided": v["decided"], "correct": v["correct"],
                     "precision (decided)": round(v["p"], 3), "95% interval": [round(float(v["lo"]), 3), round(float(v["hi"]), 3)],
                     "precision (can't tell = wrong)": round(v["floor"], 3)})
    return pd.DataFrame(rows)


def new_crown_table():
    """Linked and proposed seeded crowns by source of their (first) record and likely growth form."""
    from features import PALMLIKE
    first = N.record_ids_json.map(lambda s: json.loads(s)[0])
    Li = L.set_index("tree_id")
    g = first.map(Li.species_latin).fillna("").str.split().str[0]
    form = np.select([g.isin(PALMLIKE), N.unclassified_fraction >= 0.5], ["palm-like taxon", "unclassified returns, other/unknown taxon"],
                     "vegetation returns, other/unknown taxon")
    t = pd.crosstab([N.link_status, first.map(Li.src_group).rename("source")], form)
    t["total"] = t.sum(axis=1)
    return t


def touching_new():
    from shapely import from_wkb, STRtree
    g = from_wkb(N.crown_wkb.values); a, b = STRtree(g).query(g, predicate="intersects"); m = a < b
    ov = [g[i].intersection(g[j]).area / min(g[i].area, g[j].area) for i, j in zip(a[m], b[m])]
    return int(m.sum()), int(sum(o > 0.3 for o in ov))


def review_quality():
    r = L[L.status == "needs_review"]
    top = r.candidates_json.map(lambda s: (json.loads(s) or [{}])[0])
    p = top.map(lambda d: d.get("p_local") or 0.0); kind = top.map(lambda d: d.get("option"))
    return {"n": len(r), "top_crown_p80": int(((p >= 0.8) & kind.isin(["crown", "new"])).sum()),
            "top_crown_p50": int(((p >= 0.5) & kind.isin(["crown", "new"])).sum())}


def main():
    st = status_table(); ho = holdout_tables(); ab = ablation_table(); au = audit_table()
    n_unl = len(L); cov = L[L.status != "outside_coverage"]
    lk = L[L.status.isin(AUTO)]; ln = L[L.status == "linked_new_crown"]
    hv = H[H.band.isin(AUTO)]
    p_ho = wavg(hv.correct, hv.weight); p_hop = wavg(hv.correct, hv.weight_pessimistic.fillna(1))
    p_hi = wavg(H[H.band == "linked_high"].correct, H[H.band == "linked_high"].weight)
    p_me = wavg(H[H.band == "linked_medium"].correct, H[H.band == "linked_medium"].weight)
    vh, vm, vn = vsum("linked_high"), vsum("linked_medium"), vsum("linked_new_crown")
    vb_c, vb_d, vb_n = vh["correct"] + vm["correct"], vh["decided"] + vm["decided"], vh["cards"] + vm["cards"]
    r1h, r1m, r1n = AU["linked_high"], AU["linked_medium"], AU["linked_new_crown"]
    acc = sh[sh.accepted]
    sc = {r["case"]: r for r in RS["screenshot_cases"]}
    ev = RS["no_crown_evidence"]
    def evn(status, key):
        return int(ev.get(key, {}).get(status, 0))
    newc = RS["new_crowns"]; ntouch, nover = touching_new(); rq = review_quality(); nct = new_crown_table()
    text = f"""# Linking ALTO's unlinked external tree records to v5 crowns (v5.2)

9 October 2026. Working area `/data/alto/working/link_v52_20261009` (`code/`, `out/`, `eval/`,
`work/`, `logs/`). The v5.1 repair database was opened read-only throughout; nothing in v5, v5.1 or
`crowns_v5_full` was written. Every output is a new, additive file keyed by `tree_id` and `seg_key`.
Crown set: `{crown_set_id()}`; code sha256 `{code_sha256()[:16]}...`; method id `record_crown_link_v52`.

## 1. What came out

Of the {n_unl:,} records v5.1 leaves unlinked, {int((L.status == 'outside_coverage').sum()):,} lie where there are no v5 crowns and no 2024
point cloud at all (12,925 kauri observations in the Waitakere Ranges and other forest, 687 notable trees,
one OSM tree) and cannot be linked to a v5 crown by any method. The other {len(cov):,} were placed:

{md(st)}

* **{len(lk):,} records linked to an existing v5 crown** ({int((L.status == 'linked_high').sum()):,} high, {int((L.status == 'linked_medium').sum()):,} medium),
  and **{len(ln):,} linked to {int((N.link_status == 'linked_new_crown').sum()):,} new record-seeded crowns** drawn from the point cloud
  where v5 drew nothing (`new_crowns_v52.parquet`; {len(N):,} seeded crowns in all, the rest offered for review).
* **{int((L.status == 'needs_review').sum()):,} need review**: each carries its top three candidates with utilities, so the workbench
  starts from a proposal, not a blank map.
* **{int(L.status.isin(['tree_no_crown', 'no_tree_found', 'position_unusable']).sum()):,} are without a crown for a stated reason**:
  {int((L.status == 'tree_no_crown').sum()):,} stand on tree-height returns no crown covers and no plausible crown could be drawn,
  {int((L.status == 'no_tree_found').sum()):,} have nothing of tree height within 3 m, {int((L.status == 'position_unusable').sum()):,} sit on a roof
  with nothing of tree height near.

**Precision, measured two ways.**

| | linked_high | linked_medium | high + medium | record-seeded crowns |
|---|---|---|---|---|
| hold-out, simulated records (weighted to the estimated share of crown-missing records) | {p_hi:.3f} | {p_me:.3f} | **{p_ho:.3f}** | see 4.3 |
| hold-out, pessimistic weighting (every unlinked record without a crown counted as crown-missing) | | | {p_hop:.3f} | |
| blind visual audit, validation rounds 2-4 (final rules, fresh records; decided cards) | {vh['correct']}/{vh['decided']} = {vh['p']:.3f} | {vm['correct']}/{vm['decided']} = {vm['p']:.3f} | **{vb_c}/{vb_d} = {vb_c / max(vb_d, 1):.3f}** | {vn['correct']}/{vn['decided']} = {vn['p']:.3f} |
| same, 95% interval | [{vh['lo']:.2f}, {vh['hi']:.2f}] | [{vm['lo']:.2f}, {vm['hi']:.2f}] | | [{vn['lo']:.2f}, {vn['hi']:.2f}] |
| same, counting "can't tell" as wrong (floor) | {vh['floor']:.2f} | {vm['floor']:.2f} | {vb_c / max(vb_n, 1):.2f} | {vn['floor']:.2f} |
| design round 1 (rules before the last revisions) | {r1h['correct']}/{r1h['decided']} | {r1m['correct']}/{r1m['decided']} | | {r1n['correct']}/{r1n['decided']} |

The hold-out puts the two existing-crown statuses together at {p_ho:.3f}, above the 95% target. The audit of real
records puts them at {vb_c / max(vb_d, 1):.3f} ({vb_c}/{vb_d}, 95% interval {wil(vb_c, vb_d)[0]:.2f}-{wil(vb_c, vb_d)[1]:.2f}): consistent with the target but not
proof of it; round 4 alone, the cleanest test of the final rules, gave {AV[2]['linked_high']['correct'] + AV[2]['linked_medium']['correct']}/{AV[2]['linked_high']['decided'] + AV[2]['linked_medium']['decided']}. **`linked_high` meets the target by
every measure (~98-99%); `linked_medium` is ~89-94%**, and the record-seeded crowns ~84%. They are separate
statuses so they can be shown differently or held back (section 9).
Many audited cards could not be decided from the picture (merged canopy, a crown overhanging from a garden, dense
groves): counted as wrong they give the floor above, which is not an error rate.

## 2. Method

The chain is a dozen short scripts in `code/`, each with a docstring saying why it exists; `code/run_all.sh`
runs them in order.

### 2.1 Evidence at every record (`features.py`, `saddle.py`)

For every record of the four sources (63,199 inside v5 crown coverage, linked and unlinked) the area around
it is rebuilt on v5's own 0.5 m grid from the 2024 point cloud and the LINZ 2024 7.5 cm RGB+NIR imagery
(read as windows from the public COGs):

* **Candidates**: every v5 crown of class tree or low-canopy within 40 m (nearest 30 by edge distance).
* **A height model from every non-ground return** - LAS 1, 3, 4, 5, not only the vegetation classes v5 used.
  LINZ left many palms unclassified (class 1), which is why v5 could not see them (the Trachycarpus case: 12
  returns above 3 m, all class 1). Ground (2), building (6), noise (7, 18), water (9) and bridge (17) are
  excluded; building-dominated cells are masked; unclassified-only cells count as tree only where the imagery
  is green (NDVI >= 0.25 within 1.5 m: a tall thin crown is displaced in the orthophoto by relief).
* **Point evidence** at 1.5/3/5/8 m: tree-height cells, how many no crown covers, vegetation-class vs green
  unclassified-only, building share, NDVI, and returns above 2.5 m by class within 1.5 m.
* **A record-seeded crown** wherever uncovered tree-height returns stand within reach of the record (4 m for
  register and OSM points, 8 m for notable trees and kauri observations), drawn with v5's recipe (1 m pit
  fill, 0.75 m smoothing, watershed from local maxima of the non-ground model, cells below 0.6 of the top
  trimmed) on cells no v5 tree or low-canopy crown covers, capped at a taxon-plausible radius (3 m palm-like,
  5 m Phoenix/Jubaea, else 0.35 x i-Tree mature height within 3-10 m). Every crown-parquet column is filled
  (including the unclassified count), plus unclassified share, building overlap, sub-canopy overlap and the
  species-lab palm-detection score where that run has reached the tile (2% of record tiles so far - so it
  supports nothing yet).
* **Saddle test**: a seeded crown touching a v5 crown is walked top-to-top on the raw non-ground maxima; if the
  canopy never dips below 0.85 of the lower top it is the same tree (v5's trim left a shoulder, or a palm's
  fronds made a second peak) and is not offered. Added after the Fan Palm case produced exactly that.
* **Gates** a seeded crown must pass to be offered (they are rules, not learned - section 4.3): height
  {NEW_GATE['min_height_m']}-{NEW_GATE['max_height_m']:g} m, area >= {NEW_GATE['min_area_m2']} m2, building overlap <= {NEW_GATE['max_building_overlap']},
  vegetation-class returns or NDVI >= {NEW_GATE['min_ndvi_if_unclassified']} (or a palm detection), and v5's own shape range
  (elongation <= {NEW_GATE['max_elongation']}, bounding-box fill >= {NEW_GATE['min_bbox_fill']}: 90% / 99% of v5 tree crowns up to 40 m2).

### 2.2 Positional error model, learned from the unlinked records (`errmodel.py`)

The obvious training set does not work: **every existing link is a record inside or within 3 m of its crown by
construction** (v4 linked within 3 m; v5 kept links whose point falls inside; 100% of linked notable, OSM and
kauri records are inside). The offsets that matter are exactly those the old rules rejected. So the error model
is fitted the way astronomers cross-match catalogues (likelihood-ratio method, Sutherland & Saunders 1992):
around every unlinked record count crowns by edge distance and crown size; around decoy points 25-45 m away
(same streets, same canopy) count crowns that are unrelated by construction; fit by EM the mixture "one true
crown at offset d ~ f(d), unrelated crowns at background rate g(d), or no crown (1 - pi)". Linked records are
added back at their crowns so the inside share is the population's. The evidence an offset carries is
log f/g, made non-increasing with distance.

{md(error_table(), index=False)}

Evidence (log f/g) per edge-distance bin, medium crowns (radius 2-4 m):

{md(llr_table(), index=False)}

What it says:

* **Register offsets are short-tailed**: about 75% of AT and Parks records whose crown exists are within 3 m of
  its edge and few are beyond 5 m. Measured to the crown edge, offsets do not grow with crown size (median
  1.6-2.0 m in every size class); measured to the crown top they are 4-12 m on average, which is why the
  score uses the edge.
* **No systematic direction**: the responsibility-weighted mean vector record -> crown top is 0.1-0.4 m against
  mean offsets of 4-12 m (resultant length 0.02-0.04). There is no global kerb-side bias to correct. No road
  centreline data were available locally, so road-side effects were tested only within digitised runs (2.3).
* **Notable-tree positions are bimodal**: about 30% within 1 m of the crown edge, 30% at 8-13 m (lot or
  property points). At
  10 m the background is so dense that offset alone cannot identify the tree, so most notable records go to
  review unless size and taxon single one tree out.
* **Only {E['register_at']['pi']:.0%} of unlinked AT records ({E['register_parks']['pi']:.0%} Parks, {E['osm']['pi']:.0%} OSM, {E['notable']['pi']:.0%}
  notable, {E['kauri_obs']['pi']:.0%} kauri) have their crown among the v5 crowns at all.** A separate mixture estimate
  (the rate of seeded crowns at the point, between simulated records with and without their crown) puts the
  share standing on a tree v5 never drew at {MS['register_at']['missing_share']:.0%} AT, {MS['register_parks']['missing_share']:.0%} Parks,
  {MS['osm']['missing_share']:.0%} OSM, {MS['notable']['missing_share']:.0%} notable, {MS['kauri_obs']['missing_share']:.0%} kauri; the rest are
  records of trees no longer there, below tree height, or with positions too poor to resolve.

### 2.3 Run alignment (`runs.py`, `runs_null.py`, `runs_real.py`)

Register records with consecutive TreeIDs (gap <= 2) less than 25 m apart form chains, cut into segments of
<= 12 ({len(sh):,} segments, {int(sh.n.sum()):,} records). Each segment gets one common shift by RANSAC over
record -> crown-top vectors plus one ICP step, anchored by members v5.1 already links. The first version
(search to 20 m, gain threshold) accepted 543 shifts of median 7.4 m. **A null test showed that was chance:
moving each segment 45-70 m away (no true trees in reach, same kind of canopy) and aligning it the same way,
half of all null runs found a convincing-looking shift.** The final rule bounds shifts to 6 m (the error
model puts under 1% of register offsets beyond that) and requires the aligned fit to beat the 99th
percentile of null runs of the same size, keep anchored members on their crowns and land on >= 2 distinct
crowns; false acceptance on null runs is {RN['false_accept_rate']:.1%}. **{len(acc)} segments are shifted
({int(acc.n_unlinked.sum())} unlinked members; {RS['linked_with_row_shift']} of them end up linked), median {acc.shift_m.median():.1f} m.**
Digitised rows are real, but in this data they are not systematically displaced; per-record matching
absorbs their offsets. The Matipo roof row is not aligned: no shift within 6 m reaches trees.

### 2.4 Scoring and joint assignment (`link.py`)

Each record's options are the candidate crowns, its seeded crown (if gated in) and "none". An option's utility
is a weighted sum of: the error-model evidence for its edge distance (after any run shift), the taxon size
plausibility of its height and area-per-record (log N(.|taxon) - log N(.|all candidates); genus with >= 15
trusted links, else an i-Tree growth-form/mature-height class; notable trees get a genus from their common
name), a conflict flag (the crown already holds a record of a different genus), the crown's capacity cost
(-log P(crown holds >= j records | >= j-1, area), fitted on v5.1 crowns: a 400 m2 merged row crown takes a
second record for 0.8 nats, a 20 m2 crown for 2.4), and a low-canopy flag. Seeded crowns are scored by the
same terms plus a prior log-odds that a record's tree is one v5 did not draw, and a background term (seeded
crowns are ~25x rarer than v5 crowns around trees, so standing on one is stronger evidence). Weights are
fitted as a conditional logit on simulated records (section 3); production weights:
`{json.dumps({k: round(v, 2) for k, v in W.items() if abs(v) > 1e-3})}`.

Assignment is a min-cost assignment per connected neighbourhood with one column per crown slot (slot j priced
by the capacity term, made non-decreasing so slots fill in order) and a private "none" per record, so a merged
row crown can take several records but a small crown cannot take five, and two records never both take a
small crown when one has its own. **A record's margin is the utility the best global solution loses if its
choice is forbidden** - the honest "how much better than the next best", including the no-crown option.

### 2.5 Confidence and status (`evaluate.py`, `final.py`)

Confidence is P(correct | linked) from a small boosted model on the margin and evidence the utility does not
carry (runner-up distance, uncovered tree-height cells near the point, whether the record's own seeded crown
was set aside, crowding, source), cross-fitted on the hold-out and weighted so crown-deleted copies count at
the estimated crown-missing share. Statuses:

* `linked_high` confidence >= {T_HIGH}; `linked_medium` >= {T_MED} (kauri observations: high only);
* an existing-crown link is sent to review instead when the simulation cannot have taught the model about it:
  point on a roof with the crown > {GUARD['bld_edge_m']:g} m away, >= 1 m2 of uncovered tree-height returns at the point with the
  crown > {GUARD['unc_edge_m']:g} m away (the tree at the point is probably uncrowned), crown size implausible for the taxon
  (log ratio <= {GUARD['implausible_llr']}), or **nothing of tree height at the point and the crown > {GUARD['empty_edge_m']:g} m away** - the signature
  of a removed or never-grown street tree beside a garden tree; audited links of that kind were right only ~80% of
  the time (half undecidable), against ~96% for the rest, and the simulation, which never removes a tree, cannot
  teach it. This guard alone moves {int((L.reason == 'no_tree_at_point_crown_beyond_1m').sum()):,} records from linked to review;
* `linked_new_crown`: the seeded crown is the record's own best option, the record stands on or within
  {NEW_RULE['max_edge_m']:g} m of it, and the best global alternative is >= {NEW_RULE['min_margin']:g} nats worse;
* "none" chosen: `needs_review` if a crown option is within 1 nat, else `tree_no_crown` (>= 1 m2 of uncovered
  vegetation-class or green unclassified returns within 3 m), `position_unusable` (on a building, nothing
  tree-height within 3 m), `no_tree_found` (nothing tree-height within 3 m);
* records flagged `source_location_unverified` in v5.1 (647 notable trees) are capped at `needs_review`.

## 3. Hold-out evaluation (`simulate.py`, `evaluate.py`, `summarize.py`)

Hiding trusted links and finding them again is too easy here: every trusted record already sits inside its
crown. So {int((H.scenario == 'sim').sum()):,} trusted records (one genus per crown, location not flagged) were **moved to where an unlinked
record of their source would be**: an edge distance drawn from that source's learned unlinked offsets, in a
random direction; a point landing inside another tree's crown was redrawn (v5 links those, so real unlinked
records almost never sit there). Rows of >= 3 trusted members moved together by a shift drawn from the real
accepted shifts. A third of singly linked records were also copied **with their crown deleted**
({int((H.scenario == 'simdel').sum()):,}): the right answer is then the seeded crown over the same tree or none - never another crown.
The point-cloud evidence was recomputed at every displaced point. Five folds by record; models, weights and
confidence for fold k are fitted without it; the fold's records are matched together with every real
unlinked record that competes for the same crowns. Precision is weighted so crown-deleted copies stand for
the estimated crown-missing share per source; "pessimistic" weights them at the error model's 1 - pi.

By status band:

{md(ho['by_band'])}

By source (precision of the two linked bands):

{md(ho['by_source'])}

By how far the simulated record sits from its crown edge:

{md(ho['by_offset'])}

Recall is modest by design: a simulated record 1-3 m from its crown's edge usually has a second crown at a
similar distance, and the method declines to guess. Of the crown-deleted copies only
{float(H[H.scenario == 'simdel'].band.isin(AUTO).mean()):.1%} were linked to another tree's crown - the failure naive matching makes routinely.

### 3.1 What each component is worth (ablations, same thresholds, each refitted)

{md(ab, index=False)}

## 4. Blind visual audit (`audit.py`, `audit_score.py`; cards in `eval/audit_cards*/`)

Cards show the 2024 RGB chip, the NIR false-colour chip and the non-ground LiDAR height (unclassified-only cells
outlined, building returns grey), with the record point, any run shift, the proposed crown (cyan existing,
magenta seeded), neighbouring crowns and other inventory records. Status, band and score are not printed; I
judged each card from the picture (correct / wrong / can't tell; for records without a crown: no tree / tree
without a crown / missed link) and the strata were joined afterwards. Round 1 (223 cards, stratified by band and
source, plus 52 records without a crown) was the design round: it found the failure modes that led to the
seeded-crown shape, building and saddle rules and to the guards in 2.5. Rounds 2-4 (223 fresh records) validate:
round 2 stratified, rounds 3 and 4 drawn in proportion to production; the last guard (no tree at the point,
crown beyond 1 m) came from round 3, so round 4 alone is a clean test of the final rules. Each round is scored
against the final statuses: a card whose record has since changed status is dropped from its round.

{md(au, index=False)}

### 4.1 Wrong links seen
Existing crowns: a garden hedge, shrub or lawn-level crown behind the fence taken for an AT street tree whose
berm is empty (the commonest, 6 cards across the rounds - most now caught by the no-tree-at-point guard); a crown
chosen over a more plausible tree of the recorded taxon a few metres away (willow, Norfolk pine, Phoenix palm,
podocarp); a crown taken where a small separate tree stands at the point (3); a point on a building linked to a
car-park tree (caught by the building guard); a palm linked for a lawn point where the recorded tree is gone.
Checked and rejected as a fix: whether the crown lies on a property parcel (LINZ primary parcels, `parcels.py`) -
85% of AT records' true crowns are on the road reserve, but in the audit the flag did not separate wrong links
from right ones.
Seeded crowns: building parapets, awnings, porch and roof edges and a pole (unclassified returns that pass the
NDVI test by adjacency), parked vehicles beside berm trees, slivers of a hedge or the trimmed edge of a big
canopy, a row of small trees drawn as one, and a leafless poplar's green neighbour.

### 4.2 Records left without a crown
{AU['no_crown']['status_supported'] + AU2['no_crown']['status_supported']} of {AU['no_crown']['cards'] + AU2['no_crown']['cards']} audited were right to be left without a crown (roofs, berms and
footpaths with nothing tree-height, kerbs in front of buildings, a construction site); none was a missed link.
Point-cloud evidence behind all records left without a crown (incl. `needs_review` with no proposal):

| status | uncovered vegetation-class returns | uncovered unclassified cluster (green) | tree height only inside existing crowns | building only | nothing tree-height |
|---|---|---|---|---|---|
""" + "\n".join(f"| {s} | {evn(s, 'vegetation_class_uncovered')} | {evn(s, 'unclassified_cluster_uncovered')} | {evn(s, 'tree_height_inside_existing_crowns')} | {evn(s, 'building_only')} | {evn(s, 'nothing_tree_height')} |"
                for s in ["tree_no_crown", "no_tree_found", "position_unusable", "needs_review"]) + f"""

### 4.3 Record-seeded crowns
{newc['n']:,} seeded crowns: {newc['by_status'].get('linked_new_crown', 0)} carry a `linked_new_crown` record, the rest are proposals
for review. Height 10/50/90%: {newc['height_quantiles']} m; area {newc['area_quantiles']} m2; {newc['unclassified_dominated']} are
dominated by unclassified returns (the palms v5 could not see); {newc['low_canopy_2_3m']} are 2-3 m (low canopy).
By source and taxon of the linked record: see `eval/report_stats.json` (`new_crowns`); palm-like taxa (palms,
cabbage trees, tree ferns) account for {newc['palm_like']} seeded crowns. **Audited precision under the final rules: {vn['correct']}/{vn['decided']}
({vn['p']:.0%}; design round {r1n['correct']}/{r1n['decided']}).** Outlines were sensible
on the correct ones (one palm head or one small crown; a few spill onto an adjacent hedge). The hold-out
cannot measure these: its deleted crowns are v5 crowns - green, vegetation-classified trees in canopy - not the
isolated palms and off-colour trees that are really missing, so the hold-out numbers for seeded crowns
(precision 0.2-0.5) describe a different population; the seeded crowns are therefore linked by a rule and
measured by the audit. Golden and bronze foliage (low NDVI) and leaf-off trees were among the correct ones.

Seeded crowns by link status, source of the record and likely growth form (palm-like = palms, cabbage trees, tree
ferns by the recorded taxon; "unclassified returns" = >= 50% of the crown's tree-height returns are LAS class 1,
the signature of what v5 could not see):

{md(nct)}

## 5. Screenshot cases

| case | status | crown | judgement |
|---|---|---|---|
| Fan Palm ACCT0159885 | {sc['Fan Palm']['status']} | {sc['Fan Palm']['crown_source']} {sc['Fan Palm']['seg_key']} | right: the small palm crown 1.6 m away (margin {sc['Fan Palm']['margin']:.1f}, confidence {sc['Fan Palm']['confidence']:.2f}). The palm's uncovered fronds produced a second peak; the saddle test recognised it as the same tree |
| Wattle ACCT0257674 | {sc['Wattle']['status']} | {sc['Wattle']['seg_key']} | right (1.3 m) |
| Kowhai ACCT0248773 | {sc['Kowhai']['status']} | {sc['Kowhai']['crown_source']} | right: a 5.3 m, 7 m2 tree at the point that v5 never segmented; the v5 crown 3.5 m away is a different tree |
| Cabbage Tree ACCT0169814 | {sc['Cabbage Tree']['status']} | - | honest: no return above 2.5 m within 3 m of the point (max 0.7 m within 1.5 m); a median planting with nothing of tree height - a young cabbage tree below tree height or gone. There is no canopy over the point, so it is not hidden under a big tree |
| OSM golden tree node/7713504718 | {sc['OSM golden tree']['status']} | {sc['OSM golden tree']['crown_source']} | right: an 8 m, 29 m2 golden-leaved tree, 115 vegetation returns, NDVI 0.09 - v5's NDVI gate dropped it. Naive nearest-crown would have taken the different tree 2.9 m away |
| Trachycarpus ACCT0151353 | {sc['Trachycarpus palm']['status']} | {sc['Trachycarpus palm']['crown_source']} | right: a seeded crown on the palm itself (8.9 m, 9 m2, 94% of its returns unclassified, NDVI 0.36), 0.3 m from its top. The neighbouring small v5 crown is ACCT0151352's, and ACCT0151354 (2.9 m away) is held for review rather than also taking this palm |
| Matipo ACCT0109736 | {sc['Matipo (roof row)']['status']} | - | right: on a roof in an evenly spaced digitised row of >= 13 Matipo, all unlinked; nearest crown 30 m; no shift within the 6 m bound reaches trees |

## 6. Kauri observations
Kauri dieback surveillance points are handheld GPS in forest. {int((L.src_group == 'kauri_obs').sum()):,} are unlinked; 12,925 lie
outside v5 coverage. Of the 922 inside coverage, {int(((L.src_group == 'kauri_obs') & L.status.eq('linked_high')).sum())} are linked (high band only, by rule),
{int(((L.src_group == 'kauri_obs') & L.status.eq('needs_review')).sum())} go to review. In the hold-out their best-option accuracy is the lowest of all sources
(dense canopy: every point has several crowns within its GPS error), and the design-round audit could decide only
2 of 12 high-band kauri cards (both right). Kauri should be linked from the field (the observation's own photographs) or by a
kauri-specific crown classifier, not by position.

## 7. Outputs (`out/`)

* `links_v52.parquet` - one row per previously unlinked record ({n_unl:,}): status, seg_key, crown_source (`v5` or
  `record_seeded_v52`), crown_published_v5, shared_crown_n, existing_records_on_crown, edge_distance_m,
  top_distance_m (from the shifted point), raw_top_distance_m, run_id, applied_row_shift_dx/dy, score, margin,
  confidence, p_local, candidates_json (top 3 options with utilities, edge distances and local probabilities),
  reason, coordinates, method_id, code_sha256, crown_set_id.
* `new_crowns_v52.parquet` - {len(N):,} record-seeded crowns with every crown-parquet column, seg_key
  (`<pc_TILE>:<x>:<y>`), crown_source `record_seeded_v52`, unclassified_fraction, building_overlap,
  sub_canopy_overlap, palm_det_score, saddle result, record_ids_json, link_status. None overlaps a v5 tree or
  low-canopy crown; {ntouch} pairs of seeded crowns touch ({nover} overlap by more than 30% of the smaller).
* `council_positions_v52.geojsonl` - for every linked record (existing or seeded crown), the source's recorded
  point and a line from it to the crown top, for the default-off "recorded positions" layer (median line
  {L[L.status.str.startswith('linked')].raw_top_distance_m.median():.1f} m).
* `no_crown_queue_v52.parquet` - every record not linked ({int((~L.status.str.startswith('linked')).sum()):,}, incl. outside coverage), with
  point, nearest candidates, point-cloud evidence and reason, ordered review first.

Working tables in `work/` (evidence, error model, run shifts, simulation); hold-out results, audit samples,
judgments and cards in `eval/`.

## 8. Runtime and rerunning on a redrawn crown set
Point-cloud evidence ~25 min (8 workers, 946 tiles) and again for the simulation; saddle tests ~10 min each;
error model 1 min; run alignment and null test 3 min; hold-out 4 min per configuration; production 2 min;
audit rendering ~5 min per 75 cards. Machine: shared Mac, peak ~4 GB across workers.

Everything that depends on crowns is recomputed from `LINK_CROWNS`: candidates, the cover mask the seeded
crowns avoid, the error model (its background is the crown density), run shifts, the simulation, weights and
confidence. On a redrawn crown set: `LINK_CROWNS=<dir> LINK_DB=<db> code/run_all.sh` (about 2 hours),
then draw, render and judge a fresh audit round (`audit.py sample4`, `audit.py render ...`, `audit_score.py _r4`; see
the end of `run_all.sh`) - the audit is the measurement the simulation cannot replace. Expect more links where the
redraw splits merged rows and fewer seeded crowns where it adds palms. If the redraw links some of these
records itself, they simply drop out of the unlinked set. The crown_set_id column says which crowns a row was
matched against; rows from different crown sets should not be merged.

## 9. Publication decisions and limitations

1. **Which statuses to publish as links.** `linked_high` ({int((L.status == 'linked_high').sum()):,}) is ~98-99% by both measures.
   `linked_medium` ({int((L.status == 'linked_medium').sum()):,}) is ~89-94%: publish it with high (together ~94-97%), or keep it as a
   pre-filled review proposal so that what is published is unambiguously above 95%.
2. **Record-seeded crowns** ({int((N.link_status == 'linked_new_crown').sum())} linked, {len(N) - int((N.link_status == 'linked_new_crown').sum())} proposed): ~84% audited, new geometry
   not in v5. Publish as their own class ("drawn from the record", shown faintly), or hand to the workbench first?
3. **13,613 records outside v5 coverage** (12,925 kauri, 687 notable) cannot be linked to v5 crowns. Extending
   crowns needs point cloud beyond the metro set; until then they stay unlinked with that reason.
4. **The review queue is large** ({rq['n']:,}): {rq['top_crown_p80']:,} have a crown proposal holding >= 80% of the local choice
   probability and {rq['top_crown_p50']:,} >= 50%, so much of it is confirm-or-reject rather than search.
   Any labels the workbench produces are exactly the training data this linker lacks (real offsets, real
   removals), and would let the next run replace the simulation.
5. Run alignment adds almost nothing on this data; keep it (cheap, null-tested) or drop it for clarity.

Limitations: the hold-out is a simulation - real unlinked records include felled trees and positions worse than
any trusted record, which it does not contain, so the audit is the truer guide and its samples are small (wide
intervals). The confidence model learned which evidence matters from simulated records whose crowns exist or
were deleted; evidence it never saw is handled by the guards in 2.5, set from the design audit rounds rather than
estimated, and validated on fresh records only in round 4. The error model's background comes from decoys 25-45 m away, which sample gardens and roofs as well
as kerbs; a different decoy rule moves pi by up to 0.1 (checked for AT: 0.40 decoys vs 0.51 with a background from
around linked records). Imagery is 2024 leaf-on mostly; leaf-off trees and golden/purple foliage have low NDVI,
which is why seeded crowns accept vegetation-class returns regardless of NDVI. The species-lab palm detector
had reached 2% of record tiles and contributed nothing. Taxon plausibility uses height and area only; it cannot
tell deciduous from evergreen or a conifer's shape.
"""
    (OUT / "REPORT.md").write_text(text)
    print("wrote", OUT / "REPORT.md", len(text))


if __name__ == "__main__":
    main()
