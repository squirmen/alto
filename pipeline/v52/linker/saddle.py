"""Is a record-seeded crown a separate tree, or the part of a neighbouring v5 crown that v5 trimmed away?

v5 trims cells below 0.6 of a crown's top and draws palms from sparse vegetation returns, so the
uncovered remainder of one tree can carry its own local maximum - a fan palm's fronds on one side,
a broad crown's shoulder. The test is v5's saddle idea on the raw non-ground maxima (single-cell holes bridged, no
smoothing): walk from the seeded crown's top to each touching v5 crown's top; if the canopy never
dips below SADDLE of the lower top, the two are one canopy and the seeded crown is not offered as a
new tree. Tops are re-read on the same raster (highest cell within 1 m).
Usage: saddle.py <newcrowns parquet> <out parquet> [workers]
"""
import sys, os, json
from multiprocessing import Pool
import numpy as np, pandas as pd
from scipy import ndimage
from shapely import from_wkb, STRtree
from common import load_crowns
from features import read_laz, tiles_over, rasterise, fill_nearest, RES

SADDLE = 0.85


def chm(x0, y0, x1, y1):
    w, h = int(round((x1 - x0) / RES)), int(round((y1 - y0) / RES))
    xs = []
    for t in tiles_over(x0, y0, x1, y1):
        P = read_laz(t)
        if P is None:
            continue
        k = (P["x"] >= x0) & (P["x"] < x1) & (P["y"] >= y0) & (P["y"] < y1)
        xs.append({a: b[k] for a, b in P.items()})
    if not xs:
        return None
    P = {a: np.concatenate([d[a] for d in xs]) for a in xs[0]}
    g = P["cls"] == 2
    dem = ndimage.median_filter(fill_nearest(rasterise(P["x"][g], P["y"][g], P["z"][g], x0, y1, w, h, "min")), size=5)
    col = np.clip(((P["x"] - x0) / RES).astype(int), 0, w - 1); row = np.clip(((y1 - P["y"]) / RES).astype(int), 0, h - 1)
    agl = P["z"] - dem[row, col]; ng = np.isin(P["cls"], (1, 3, 4, 5))
    c = rasterise(P["x"][ng], P["y"][ng], agl[ng], x0, y1, w, h, "max")
    c = np.where(np.isfinite(c) & (c > 0), c, 0.0)
    # Raw maxima, only single-cell sampling holes bridged: v5's gap fill and smoothing would also bridge the
    # 1-2 m gap between two separate small trees and call them one canopy.
    return ndimage.grey_dilation(c, size=3)


def tile_job(args):
    tile, N = args
    os.environ["OMP_NUM_THREADS"] = "1"
    x0, y0 = np.floor((N.x_2193.min() - 25) / RES) * RES, np.floor((N.y_2193.min() - 25) / RES) * RES
    x1, y1 = np.ceil((N.x_2193.max() + 25) / RES) * RES, np.ceil((N.y_2193.max() + 25) / RES) * RES
    W = chm(x0, y0, x1, y1)
    cs = [c for t in tiles_over(x0, y0, x1, y1) if (c := load_crowns(t)) is not None]
    out = []
    if W is None or not cs:
        return [{"qid": q, "seg_key": s, "touch_n": 0, "saddle_ratio_max": 0.0, "saddle_seg": None} for q, s in zip(N.qid, N.seg_key)]
    K = pd.concat(cs); K = K[K.canopy_class.isin(["tree", "low_canopy"])].reset_index(drop=True)
    geo = from_wkb(K.crown_wkb.values); tree = STRtree(geo)
    val = lambda x, y: W[np.clip(int((y1 - y) / RES), 0, W.shape[0] - 1), np.clip(int((x - x0) / RES), 0, W.shape[1] - 1)]
    for r in N.itertuples(index=False):
        poly = from_wkb(r.crown_wkb)
        idx = tree.query(poly, predicate="dwithin", distance=0.75)
        best, bseg = 0.0, None
        for j in np.atleast_1d(idx):
            tx, ty = K.x_2193.iat[j], K.y_2193.iat[j]
            n = max(2, int(np.hypot(tx - r.x_2193, ty - r.y_2193) / 0.25))
            line = [val(r.x_2193 + (tx - r.x_2193) * k / n, r.y_2193 + (ty - r.y_2193) * k / n) for k in range(n + 1)]
            top_a = max(val(r.x_2193 + dx, r.y_2193 + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
            top_b = max(val(tx + dx, ty + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
            low = min(top_a, top_b)
            ratio = float(min(line) / low) if low > 0 else 0.0
            if ratio > best:
                best, bseg = ratio, K.seg_key.iat[j]
        out.append({"qid": r.qid, "seg_key": r.seg_key, "touch_n": int(np.size(idx)), "saddle_ratio_max": round(best, 4), "saddle_seg": bseg})
    return out


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; nw = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    N = pd.read_parquet(src, columns=["qid", "seg_key", "tile", "x_2193", "y_2193", "crown_wkb"])
    jobs = list(N.groupby("tile"))
    with Pool(nw, maxtasksperchild=50) as p:
        res = [r for chunk in p.imap_unordered(tile_job, jobs, chunksize=4) for r in chunk]
    S = pd.DataFrame(res); S["continuous_with_existing"] = S.saddle_ratio_max >= SADDLE
    S.to_parquet(dst, index=False)
    print(json.dumps({"new_crowns": len(S), "touching": int((S.touch_n > 0).sum()), "continuous": int(S.continuous_with_existing.sum())}))
