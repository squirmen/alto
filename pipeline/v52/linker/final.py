"""Production run: place every v5.1 unlinked external record, write the v5.2 link table and its companions.

Same models and assignment as the hold-out (evaluate.py), fitted on everything: the error model
from the unlinked records themselves, size and capacity models from all trusted links, choice
weights from all simulated folds, confidence from the cross-fitted hold-out calibration. Each record
then gets one status:

  linked_high / linked_medium  an existing crown, calibrated confidence >= T_HIGH / >= T_MED
  linked_new_crown             a crown drawn here from the record's own uncovered returns (new_crowns_v52)
  needs_review                 the best option is a crown but not confidently, or two options are close,
                               or the source position is flagged unverified in v5.1
  tree_no_crown                tree-height returns stand uncovered at the record but no crown could be drawn
  no_tree_found                nothing tree-height within 3 m of the point
  position_unusable            the point is on a building and no tree-height return is near
  outside_coverage             no v5 crowns or 2024 point cloud there (Waitakere Ranges, rural, islands)

Nothing in v5.1 is modified; all outputs are new files under out/.
"""
from __future__ import annotations
import json, time
import numpy as np, pandas as pd
from shapely import from_wkb, wkb as swkb, points as P_, distance as D_
from sklearn.isotonic import IsotonicRegression
import link
from scenario import Data, models, existing_of, apply_shifts, truth_of
from evaluate import prepare, del_weights
from common import WORK, OUT, EVAL, METHOD_ID, crown_set_id, code_sha256

T_HIGH, T_MED, M_REVIEW = 0.97, 0.85, 1.0
NEW_RULE = dict(min_margin=2.0, max_edge_m=1.0)
# Evidence the simulation cannot contain, so the confidence model cannot have learned it: a record standing on a
# roof, on a tree that has no crown, or a crown far out of size for the recorded taxon. An existing-crown link
# with any of these goes to review instead of being linked automatically.
# The last guard comes from the audit, not the simulation: a record with nothing of tree height at its point and
# its crown more than 1 m away is the signature of a felled or never-grown street tree whose neighbour's crown
# is nearby - audited links of that kind were right only ~80% of the time (and half could not be decided),
# against ~96% for the rest. The simulation never removes a tree, so it cannot see this.
GUARD = dict(bld_point=0.5, bld_edge_m=1.0, unc_cells=4, unc_edge_m=2.0, implausible_llr=-2.0, empty_cells=4, empty_edge_m=1.0)


def crown_guard(d_use, bld_1p5, unc_tall_1p5, x_h, tall_1p5=None):
    g = GUARD
    empty = (tall_1p5 < g["empty_cells"]) & (d_use > g["empty_edge_m"]) if tall_1p5 is not None else np.zeros(len(d_use), bool)
    why = np.select([(bld_1p5 >= g["bld_point"]) & (d_use > g["bld_edge_m"]),
                     (unc_tall_1p5 >= g["unc_cells"]) & (d_use > g["unc_edge_m"]),
                     x_h <= g["implausible_llr"], empty],
                    ["point_on_building_crown_not_at_point", "uncovered_tree_at_point_crown_beyond_2m", "crown_size_implausible_for_taxon",
                     "no_tree_at_point_crown_beyond_1m"], "")
    return why


def new_crown_rule(kind, margin, d_use, u_gap_best):
    """A record-seeded crown is linked when the record stands on it (<= 1 m from its edge), it is the record's own
    best option, and the best global alternative is at least 2 nats worse; otherwise it is proposed for review."""
    return (kind == "new") & (margin >= NEW_RULE["min_margin"]) & (d_use <= NEW_RULE["max_edge_m"]) & (u_gap_best >= -1e-9)


def gclass(g):
    return "register" if g.startswith("register") else ("kauri" if g == "kauri_obs" else "notable_osm")


def confidence_models(H):
    """P(correct | linked) per option kind, fitted on every hold-out record (evaluate.py cross-fits the same model)."""
    cols = ["cf_" + c for c in link.CONF_FEATS]
    out = {}
    for kind, g in H[H.linked].groupby("kind"):
        out[kind] = link.conf_model(g[cols].values, g.correct.values, g.weight.fillna(1).values) if g.correct.nunique() > 1 else None
    return out


def main():
    t0 = time.time(); D = Data()
    Q, sc, sn, pc, pn, sh = prepare(D)
    truth = truth_of(D, Q); wts = del_weights(Q, link.EM, json.loads((EVAL / "missing_share.json").read_text()))
    ctx = models(D)
    dmap = Q.set_index("qid").del_seg.dropna()
    trc = sc[~(sc.qid.map(dmap) == sc.seg_key)]
    Otr = link.build_options(Q, trc, D.crowns, sn, D.sfeat, existing_of(D.linked), ctx)
    w, _ = link.fit_weights(Otr, truth, wts)
    (OUT.parent / "eval" / "weights_production.json").write_text(json.dumps(w, indent=1))
    U = D.unl
    existing = existing_of(D.linked)
    O = link.build_options(U[["qid", "src_group", "genus"]], pc[pc.qid.isin(U.qid)], D.crowns, pn[pn.qid.isin(U.qid)],
                           D.feat, existing, ctx)
    A, Oa = link.assign(O, ctx["cap"], w, margins=True)
    H = pd.read_parquet(EVAL / "holdout_full.parquet")
    cm = confidence_models(H)
    X = link.conf_features(A, Oa, D.feat, pn[pn.qid.isin(U.qid)], U)
    A["gclass"] = A.qid.map(U.set_index("qid").src_group).map(gclass)
    ci = {c: i for i, c in enumerate(link.CONF_FEATS)}
    A["new_ok"] = new_crown_rule(A.kind.values, A.margin.values, X[:, ci["d_use"]], X[:, ci["u_gap_best"]])
    A["guard"] = crown_guard(X[:, ci["d_use"]], X[:, ci["bld_1p5"]], X[:, ci["unc_tall_1p5"]], X[:, ci["x_h"]], X[:, ci["tall_1p5"]])
    A["confidence"] = np.nan
    for kind, m in cm.items():
        k = (A.kind == kind).values
        if m is not None and k.any():
            A.loc[k, "confidence"] = m.predict_proba(X[k])[:, 1]
    print("assigned", len(A), round(time.time() - t0), "s", flush=True)
    A.join(pd.DataFrame(X, columns=["cf_" + c for c in link.CONF_FEATS])).to_parquet(WORK / "production_assign.parquet", index=False)
    write_outputs(D, U, A, Oa, pc, pn, w)


def write_outputs(D, U, A, Oa, pc, pn, w):
    R = D.R.set_index("tree_id"); F = D.feat.set_index("qid")
    rs = pd.read_parquet(WORK / "run_shifts_real.parquet"); rm = pd.read_parquet(WORK / "run_members_real.parquet")
    run_of = rm.merge(rs, on="run_id").set_index("qid")
    K = D.crowns.set_index("seg_key"); NC = pn.drop_duplicates(["qid", "seg_key"]).set_index(["qid", "seg_key"])
    crown_set, sha = crown_set_id(), code_sha256()
    # top-3 alternatives per record
    top = Oa[Oa["rank"] <= 3].sort_values(["qid", "rank"])
    alts = {q: json.dumps([{"option": ("none" if k == "null" else k), "seg_key": (None if k == "null" else o),
                            "utility": round(float(u), 3), "edge_m": (None if k == "null" or pd.isna(d) else round(float(d), 2)),
                            "p_local": round(float(p), 3)}
                           for k, o, u, d, p in zip(g.kind, g.okey, g.U, g.d_use, g.p_local)])
            for q, g in top.groupby("qid")}
    second = Oa.sort_values(["qid", "U"], ascending=[True, False]).groupby("qid").nth(1).set_index("qid") if len(Oa) else None
    rows = []
    shared = A[A.kind != "null"].groupby("okey").size()
    exist_n = D.linked.groupby("link_seg").size()
    for r in A.itertuples(index=False):
        rec = R.loc[r.qid]; f = F.loc[r.qid] if r.qid in F.index else None
        kind, conf, m = r.kind, r.confidence, r.margin
        reason = ""
        if kind == "crown":
            status = "linked_high" if conf >= T_HIGH else ("linked_medium" if conf >= T_MED else "needs_review")
            reason = "existing_crown" if status != "needs_review" else "existing_crown_low_confidence"
            if status != "needs_review" and r.guard:
                status, reason = "needs_review", r.guard
            if rec.src_group == "kauri_obs" and status == "linked_medium":
                # dense forest and handheld GPS: kauri observations are linked only at the high band
                status, reason = "needs_review", "kauri_observation_requires_high_confidence"
        elif kind == "new":
            status = "linked_new_crown" if r.new_ok else "needs_review"
            reason = "record_seeded_crown" if status == "linked_new_crown" else "record_seeded_crown_low_confidence"
        else:
            alt = second.loc[r.qid] if second is not None and r.qid in second.index else None
            close = alt is not None and alt.kind != "null" and m < M_REVIEW
            tall3 = f.tall_3 if f is not None else 0
            uncv = (f.unc_veg_3 + f.unc_c1g_3) if f is not None else 0
            if close:
                status, reason = "needs_review", f"close_alternative_{alt.kind}"
            elif uncv >= 4:
                status, reason = "tree_no_crown", "uncovered_tree_height_returns_no_drawable_crown"
            elif f is not None and f.bld_1p5 >= 0.5 and tall3 < 4:
                status, reason = "position_unusable", "point_on_building_no_tree_within_3m"
            elif tall3 < 4:
                status, reason = "no_tree_found", "no_tree_height_returns_within_3m"
            else:
                status, reason = "needs_review", "tree_height_returns_inside_unaccepted_crowns"
        if rec.automatic_crown_link_allowed == 0 and status.startswith("linked"):
            status, reason = "needs_review", "source_location_unverified:" + reason
        run = run_of.loc[r.qid] if r.qid in run_of.index else None
        acc_run = run is not None and bool(run.accepted)
        okey = None if kind == "null" else r.okey
        if kind == "crown":
            top_xy = K.loc[okey, ["x_2193", "y_2193"]].values
        elif kind == "new":
            top_xy = NC.loc[(r.qid, okey), ["x_2193", "y_2193"]].values
        else:
            top_xy = None
        opt = Oa.loc[r.opt]
        rows.append({"tree_id": r.qid, "source": rec.source, "source_tree_id": rec.source_tree_id, "src_group": rec.src_group,
                     "species_latin": rec.species_latin, "species_common": rec.species_common, "owner_class": rec.owner_class,
                     "status": status, "seg_key": okey, "crown_source": {"crown": "v5", "new": "record_seeded_v52"}.get(kind),
                     "crown_published_v5": bool(kind == "crown" and K.loc[okey, "canopy_class"] == "tree"),
                     "shared_crown_n": int(shared.get(okey, 0) + (exist_n.get(okey, 0) if kind == "crown" else 0)) if okey else 0,
                     "existing_records_on_crown": int(exist_n.get(okey, 0)) if kind == "crown" else 0,
                     "edge_distance_m": None if kind == "null" else round(float(opt.d_use), 2),
                     "top_distance_m": None if top_xy is None else round(float(np.hypot(top_xy[0] - rec.x - (run.sdx if acc_run else 0),
                                                                                         top_xy[1] - rec.y - (run.sdy if acc_run else 0))), 2),
                     "raw_top_distance_m": None if top_xy is None else round(float(np.hypot(top_xy[0] - rec.x, top_xy[1] - rec.y)), 2),
                     "run_id": run.run_id if run is not None else None,
                     "applied_row_shift_dx": round(float(run.sdx), 2) if acc_run else 0.0,
                     "applied_row_shift_dy": round(float(run.sdy), 2) if acc_run else 0.0,
                     # seeded crowns are linked by rule (margin and distance), so they carry no model confidence
                     "score": round(float(r.U), 3), "margin": round(float(m), 3),
                     "confidence": round(float(conf), 4) if (pd.notna(conf) and kind == "crown") else None,
                     "p_local": round(float(r.p_local), 4), "candidates_json": alts.get(r.qid, "[]"), "reason": reason,
                     "x_2193": rec.x, "y_2193": rec.y, "lon": rec.lon, "lat": rec.lat,
                     "method_id": METHOD_ID, "code_sha256": sha, "crown_set_id": crown_set})
    L = pd.DataFrame(rows)
    # records outside v5 crown coverage
    out = D.R[D.R.unlinked & ~D.R.tree_id.isin(L.tree_id)]
    L = pd.concat([L, pd.DataFrame({"tree_id": out.tree_id, "source": out.source, "source_tree_id": out.source_tree_id,
                                    "src_group": out.src_group, "species_latin": out.species_latin, "species_common": out.species_common,
                                    "owner_class": out.owner_class, "status": "outside_coverage", "shared_crown_n": 0,
                                    "existing_records_on_crown": 0, "applied_row_shift_dx": 0.0, "applied_row_shift_dy": 0.0,
                                    "candidates_json": "[]", "reason": "no_v5_crowns_or_2024_point_cloud_here",
                                    "x_2193": out.x, "y_2193": out.y, "lon": out.lon, "lat": out.lat, "method_id": METHOD_ID,
                                    "code_sha256": sha, "crown_set_id": crown_set})], ignore_index=True)
    L.to_parquet(OUT / "links_v52.parquet", index=False)
    write_new_crowns(L, pn, crown_set, sha)
    write_positions(L, K)
    write_queue(L, D)
    print(L.groupby(["src_group", "status"]).size().unstack(fill_value=0).to_string())


def write_new_crowns(L, pn, crown_set, sha):
    ln = L[L.crown_source.eq("record_seeded_v52")]
    nc = pn.merge(ln[["tree_id", "seg_key", "status"]].rename(columns={"tree_id": "qid"}), on=["qid", "seg_key"])
    recs = nc.groupby("seg_key").qid.agg(lambda s: json.dumps(sorted(s)))
    st = nc.groupby("seg_key").status.agg(lambda s: "linked_new_crown" if (s == "linked_new_crown").any() else "needs_review")
    nc = nc.drop_duplicates("seg_key").set_index("seg_key")
    nc["record_ids_json"] = recs; nc["link_status"] = st; nc["n_records"] = nc.record_ids_json.map(lambda s: len(json.loads(s)))
    nc["crown_source"] = "record_seeded_v52"; nc["method_id"] = "record_seeded_crown_v52"; nc["crown_set_id"] = crown_set
    nc["code_sha256"] = sha; nc["created_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    drop = [c for c in ["qid", "tree_id", "status", "edge_distance_m", "top_distance_m", "d_edge_shift", "x", "y", "mode"] if c in nc]
    nc.drop(columns=drop).reset_index().to_parquet(OUT / "new_crowns_v52.parquet", index=False)


def write_positions(L, K):
    from pyproj import Transformer
    tr = Transformer.from_crs(2193, 4326, always_xy=True)
    lk = L[L.status.isin(["linked_high", "linked_medium", "linked_new_crown"])]
    new = pd.read_parquet(OUT / "new_crowns_v52.parquet").set_index("seg_key")
    with open(OUT / "council_positions_v52.geojsonl", "w") as fh:
        for r in lk.itertuples(index=False):
            src = (r.lon, r.lat)
            tx, ty = (K.loc[r.seg_key, ["x_2193", "y_2193"]].values if r.crown_source == "v5" else new.loc[r.seg_key, ["x_2193", "y_2193"]].values)
            tl = tr.transform(tx, ty)
            props = {"tree_id": r.tree_id, "source": r.source, "status": r.status, "seg_key": r.seg_key, "crown_source": r.crown_source,
                     "distance_m": r.raw_top_distance_m, "edge_distance_m": r.edge_distance_m,
                     "row_shift_m": round(float(np.hypot(r.applied_row_shift_dx, r.applied_row_shift_dy)), 2), "layer": "source_recorded_positions"}
            fh.write(json.dumps({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(src[0], 7), round(src[1], 7)]},
                                 "properties": {**props, "feature": "recorded_position"}}) + "\n")
            fh.write(json.dumps({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[round(src[0], 7), round(src[1], 7)], [round(tl[0], 7), round(tl[1], 7)]]},
                                 "properties": {**props, "feature": "position_to_crown_top"}}) + "\n")


def write_queue(L, D):
    q = L[~L.status.isin(["linked_high", "linked_medium", "linked_new_crown"])].copy()
    F = D.feat.set_index("qid")
    keep = ["tall_1p5", "tall_3", "unc_tall_3", "unc_veg_3", "unc_c1g_3", "unc_c1_3", "maxh_3", "maxh_unc_3", "bld_1p5", "ndvi_1p5",
            "c1_returns_1p5", "veg_returns_1p5", "palm_det_at"]
    ev = F.reindex(q.tree_id)[[k for k in keep if k in F]].reset_index(drop=True)
    ev.columns = ["ev_" + c for c in ev.columns]
    q = pd.concat([q.reset_index(drop=True), ev], axis=1)
    q["nearest_crowns_json"] = q.candidates_json
    q["queue_priority"] = q.status.map({"needs_review": 1, "tree_no_crown": 2, "position_unusable": 3, "no_tree_found": 4, "outside_coverage": 5})
    q.sort_values(["queue_priority", "src_group"]).to_parquet(OUT / "no_crown_queue_v52.parquet", index=False)


if __name__ == "__main__":
    main()
