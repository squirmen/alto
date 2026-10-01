#!/usr/bin/env python3
"""A learned crown-membership model, to place boundaries the height model cannot.

Round 2 ended with detections running 1.08x the labelled area but covering only 74% of
it, and the cells they wrongly include taller than the cells they wrongly exclude. That
is not skirt or over-reach, it is the divide between two adjacent crowns in the wrong
place, and every hand-coded rule tried against it - greenness in the cost surface, convex
hulls, height-scaled radius caps, greenness trimming - made things monotonically worse.

So the rule is learned instead. For each candidate cell near a crown, predict whether it
belongs to that crown, from features the watershed never looks at:

  height, height relative to the crown's peak, distance from the peak,
  local relief, gradient magnitude, number of LiDAR returns, building fraction

`nret` has been in the stack since it was built and has never been read by the segmenter.
At the boundary it separates in-crown from out-of-crown better than greenness does by a
factor of thirty.

Validation is by site, not by cell. Cells within a site are massively autocorrelated, so
a random split would score a memorised map. GroupKFold on site id is the only honest
measure, and the test sites are never loaded.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

LAB = Path("/data/alto/working/seg_lab")
sys.path.insert(0, str(LAB))
import core        # noqa: E402

FEATURES = ["height", "rel_peak", "dist_peak", "relief", "grad", "nret", "bld", "exg"]


def cell_features(site: dict, lab: np.ndarray, p: core.Params) -> tuple[np.ndarray, np.ndarray]:
    """Per-cell features for every cell currently assigned to a crown, plus its crown id."""
    chm = site["chm"]; res = site["res"]
    work = chm
    grad = ndimage.gaussian_gradient_magnitude(chm, max(1.0 / res, 1.0))
    relief = chm - ndimage.maximum_filter(chm, size=max(3, int(round(10.0 / res)) | 1))
    n = int(lab.max())
    rows, ids = [], []
    for i, sl in enumerate(ndimage.find_objects(lab, max_label=n), start=1):
        if sl is None:
            continue
        sub = lab[sl] == i
        if not sub.any():
            continue
        rr, cc = np.nonzero(sub)
        rr = rr + sl[0].start; cc = cc + sl[1].start
        h = work[rr, cc]
        k = int(np.argmax(h))
        peak = float(h[k])
        d = np.hypot(rr - rr[k], cc - cc[k]) * res
        rows.append(np.column_stack([
            h, h / max(peak, 1e-6), d, relief[rr, cc], grad[rr, cc],
            site["nret"][rr, cc], site["bld"][rr, cc], site["exg"][rr, cc]]))
        ids.append(np.column_stack([np.full(len(rr), i), rr, cc]))
    if not rows:
        return np.zeros((0, len(FEATURES))), np.zeros((0, 3), dtype=int)
    return np.vstack(rows).astype("float32"), np.vstack(ids).astype(int)


def build_training(sites: list[str], p: core.Params):
    """Cells of crowns that are the sole detection inside a labelled tree.

    The first version trained on every segmented crown and asked whether each cell fell
    inside any label. That scored 0.938 against a 0.940 majority baseline - worse than
    guessing - because no site labels more than 62% of its canopy, so "outside a label"
    mostly meant "a real tree nobody drew". The boundary question only exists inside a
    crown that has been matched to a tree: of those cells, which belong to that tree?
    """
    from shapely.geometry import Point
    X, y, g = [], [], []
    for sid in sites:
        site = core.load_site(sid)
        lab = core.segment_labels(site, p)
        if lab is None or not lab.any():
            continue
        work = core._prepared(site, p)
        crowns = core._to_crowns(lab, work, site, p)
        f, ids = cell_features(site, lab, p)
        if not len(f):
            continue
        W = site["chm"].shape[1]
        labels = core.labels_by_site().get(sid, {}).get("tree", [])
        cells = core.label_cells(sid)
        # crown id -> the label it is the sole detection for
        peak_of = {}
        for c in crowns:
            peak_of[(round(c["cx"], 3), round(c["cy"], 3))] = c
        for t, lc in zip(labels, cells):
            inside = [c for c in crowns if t["geom"].contains(Point(c["cx"], c["cy"]))]
            if len(inside) != 1 or lc.size == 0:
                continue
            want = set(inside[0]["cells"].tolist())
            sel = np.array([(r * W + cc_) in want for r, cc_ in zip(ids[:, 1], ids[:, 2])])
            if not sel.any():
                continue
            inlabel = np.zeros(site["chm"].size, dtype=bool)
            inlabel[lc] = True
            flat = ids[sel, 1] * W + ids[sel, 2]
            X.append(f[sel]); y.append(inlabel[flat]); g.append([sid] * int(sel.sum()))
    return (np.vstack(X), np.concatenate(y), np.concatenate(g)) if X else (None, None, None)


if __name__ == "__main__":
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.model_selection import GroupKFold

    DEV = json.loads((LAB / "splits.json").read_text())["dev_sites"]
    rows = [json.loads(l) for l in (LAB / "ledger.jsonl").read_text(errors="ignore").splitlines()
            if l.strip().startswith("{")]
    best = core.Params(**max(rows, key=lambda a: a["metrics"]["objective"])["params"])

    X, y, g = build_training(DEV, best)
    print(f"training cells {len(X):,}  in-crown {y.mean():.1%}  sites {len(set(g))}")
    gkf = GroupKFold(n_splits=min(8, len(set(g))))
    accs, bases = [], []
    for tr, te in gkf.split(X, y, groups=g):
        m = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08,
                                           max_depth=6, random_state=0)
        m.fit(X[tr], y[tr])
        accs.append(m.score(X[te], y[te]))
        bases.append(max(y[te].mean(), 1 - y[te].mean()))
    print(f"held-out sites: accuracy {np.mean(accs):.3f}  baseline {np.mean(bases):.3f}")
    m = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, max_depth=6,
                                       random_state=0).fit(X, y)
    import joblib
    joblib.dump(m, LAB / "membership_model.joblib")
    # permutation importance, cheap version: shuffle one column and see the accuracy fall
    rng = np.random.default_rng(0)
    base = m.score(X, y)
    print("\nwhich features carry it (accuracy lost when shuffled):")
    for i, name in enumerate(FEATURES):
        Z = X.copy(); rng.shuffle(Z[:, i])
        print(f"  {name:10}{base - m.score(Z, y):+.4f}")
