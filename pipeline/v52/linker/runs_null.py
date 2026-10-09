"""How big a gain does run alignment find by chance? Calibrate the acceptance threshold on null runs.

Every real run segment is moved 45-70 m in a random direction, keeping its shape, so its true trees are
out of reach but the canopy around it is of the same kind; the aligner is run without anchors. The
99th percentile of the mean per-record fit it reaches there, per segment size, is what a real shift must beat:
at most ~1% of runs with no true shift should be shifted.
"""
import json
import numpy as np, pandas as pd
from shapely import STRtree, points as P_
import runs
from common import WORK, load_crowns, tiles_around

rng = np.random.default_rng(99)
mem = pd.read_parquet(WORK / "run_members_real.parquet")
out = []
for draw in range(3):
    for rid, m in mem.groupby("run_id"):
        th = rng.uniform(0, 2 * np.pi); r = rng.uniform(45, 70)
        P = m[["x", "y"]].values + r * np.array([np.cos(th), np.sin(th)])
        cs = [c for t in tiles_around(P[:, 0].mean(), P[:, 1].mean(), 60) if (c := load_crowns(t)) is not None]
        if not cs:
            continue
        c = pd.concat(cs); c = c[c.canopy_class.isin(["tree", "low_canopy"])]
        d = np.hypot(c.x_2193.values[None, :] - P[:, 0:1], c.y_2193.values[None, :] - P[:, 1:2])
        nm = len(P); tops, rad, ok = np.zeros((nm, 30, 2)), np.zeros((nm, 30)), np.zeros((nm, 30), bool)
        for i in range(nm):
            j = np.argsort(d[i])[:30]; j = j[d[i, j] <= 45]
            tops[i, :len(j)] = c[["x_2193", "y_2193"]].values[j]; rad[i, :len(j)] = np.sqrt(c.crown_area_m2.values[j] / np.pi); ok[i, :len(j)] = True
        if not ok.any():
            continue
        res = runs._fit_run(P, tops, rad, ok, np.zeros(nm, bool), m.src_group.iloc[0])
        res["run_id"] = rid; res["draw"] = draw
        out.append(res)
N = pd.DataFrame(out)
N["other_ok"] = (N.shift_m >= runs.MIN_SHIFT) & (N.gain >= 2) & (N.inlier_frac >= 0.6) & (N.inlier_frac - N.inlier_frac0 >= 0.2) & (N.improved_frac >= 0.6) & (N.distinct >= 2)
q = {}
for n in range(3, 13):
    g = N[N.n.clip(upper=12) == n]
    q[str(n)] = float(np.quantile(g.fit_mean, 0.99)) if len(g) >= 50 else None
last = None
for n in range(3, 13):
    q[str(n)] = q[str(n)] if q[str(n)] is not None else last
    last = q[str(n)]
N.to_parquet(WORK / "run_null.parquet", index=False)
thr = N.n.clip(upper=12).astype(str).map(q)
fa = {"null_runs": len(N), "v_max_m": runs.V_MAX, "pass_other_criteria": float(N.other_ok.mean()),
      "false_accept_rate": float((N.other_ok & (N.fit_mean >= thr)).mean())}
(WORK / "run_null.json").write_text(json.dumps({"q99_fit_by_n": q, **fa}, indent=1))
print(json.dumps({"q99_fit_by_n": q, **fa}, indent=1))
