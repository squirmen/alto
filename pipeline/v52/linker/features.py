"""Per-tile evidence for every inventory record: crown candidates, uncovered tree-height returns, and a record-seeded crown.

The matcher must be able to say three different things about a record - "this is your crown",
"there is a tree here that nobody drew", and "there is no tree here" - and only the point cloud
can tell the last two apart. v5 drew crowns from vegetation-class returns only, so trees LINZ
left unclassified (palms above all: sparse fronds on a bare trunk) are invisible to it. Here the
height model is built from every non-ground return (LAS 1, 3, 4, 5), building returns and
low-NDVI unclassified returns are gated out, and wherever tree-height returns stand uncovered by
any crown near a record a crown is delineated from the local maximum nearest the record in the
same way v5 does it (0.5 m grid, 1 m pit fill, 0.75 m smoothing, watershed from local maxima,
cells below 0.6 of the top trimmed), bounded by a taxon-plausible radius.

For hold-out evaluation the same is computed a second time ("del" mode) for trusted singly
linked records with their own crown removed, which is exactly the situation of a tree whose
crown was never drawn. Everything is written per tile so the run resumes and parallelises.
"""
from __future__ import annotations
import argparse, json, os, sys, time, traceback
from pathlib import Path
from functools import lru_cache
from multiprocessing import Pool
import numpy as np, pandas as pd
for k, v in {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MULTIRANGE": "YES", "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
             "VSI_CACHE": "TRUE", "VSI_CACHE_SIZE": "50000000", "GDAL_HTTP_VERSION": "2", "CPL_VSIL_CURL_CACHE_SIZE": "100000000"}.items():
    os.environ.setdefault(k, v)
from scipy import ndimage
from shapely import from_wkb, STRtree, points as shp_points, distance as shp_distance
from common import WORK, LAZ, S3, PALM_DET, CROWNS, load_crowns, tname, seg_key, genus_of

RES, PAD, R_CAND, K_CAND = 0.5, 45.0, 40.0, 30
H_TALL, H_ELIG, NDVI_MIN, BLD_FRAC = 2.5, 2.0, 0.25, 0.3
TRIM, SMOOTH_M, PITFILL_M = 0.6, 0.75, 1.0          # v5 shipping configuration values
R_SEED = {"register_at": 4.0, "register_parks": 4.0, "osm": 4.0, "notable": 8.0, "kauri_obs": 8.0}
PALMLIKE = {"Washingtonia", "Phoenix", "Trachycarpus", "Archontophoenix", "Howea", "Syagrus", "Livistona", "Butia",
            "Rhopalostylis", "Chamaerops", "Cordyline", "Dracaena", "Yucca", "Cyathea", "Dicksonia", "Jubaea",
            "Brahea", "Sabal", "Arecastrum", "Dypsis", "Roystonea", "Ravenea", "Bismarckia", "Wodyetia", "Pandanus"}
OUTT = WORK / "tiles"


def r_cap(genus, mature_h):
    """Largest crown radius a record-seeded crown may take: tight for palm-like plants, else by mature height."""
    if genus in PALMLIKE:
        return 5.0 if genus in ("Phoenix", "Jubaea") else 3.0
    if mature_h and np.isfinite(mature_h):
        return float(np.clip(0.35 * mature_h, 3.0, 10.0))
    return 6.0


@lru_cache(maxsize=6)
def read_laz(tile):
    import laspy
    f = LAZ / f"{tile}.laz"
    if not f.exists():
        return None
    las = laspy.read(str(f), laz_backend=laspy.LazBackend.Lazrs)
    out = {"x": np.asarray(las.x), "y": np.asarray(las.y), "z": np.asarray(las.z).astype("float32"),
           "cls": np.asarray(las.classification).astype("uint8"),
           "nret": np.asarray(las.number_of_returns).astype("uint8"), "int": np.asarray(las.intensity).astype("float32")}
    return out


def tiles_over(x0, y0, x1, y1):
    xs = np.append(np.arange(x0, x1, 240.0), x1); ys = np.append(np.arange(y0, y1, 360.0), y1)
    return sorted({tname(x, y) for x in xs for y in ys})


def imagery(X0, Y0, X1, Y1, w, h):
    """NDVI and excess-green on the 0.5 m grid, GDAL-averaged from the LINZ 2024 COGs (it reads the 0.3 m overview)."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds
    acc = np.zeros((5, h, w), "float32")
    for t in tiles_over(X0, Y0, X1, Y1):
        code = t.replace("pc_", "")
        for attempt in range(4):
            try:
                with rasterio.open(f"/vsicurl/{S3}/{code}.tiff") as r:
                    bx0, by0, bx1, by1 = r.bounds
                    ox0, oy0, ox1, oy1 = max(X0, bx0), max(Y0, by0), min(X1, bx1), min(Y1, by1)
                    if ox1 - ox0 < RES or oy1 - oy0 < RES:
                        break
                    c0, r0 = int(round((ox0 - X0) / RES)), int(round((Y1 - oy1) / RES))
                    cw, rh = int(round((ox1 - ox0) / RES)), int(round((oy1 - oy0) / RES))
                    a = r.read((1, 2, 3, 4, 5), window=from_bounds(ox0, oy0, ox1, oy1, r.transform),
                               out_shape=(5, rh, cw), resampling=Resampling.average).astype("float32")
                    acc[:, r0:r0 + rh, c0:c0 + cw] = a
                break
            except Exception:
                if attempt == 3:
                    break
                time.sleep(1.5 * (attempt + 1))
    R, G, B, N, A = acc
    have = A > 127
    ndvi = np.where(have, (N - R) / np.maximum(N + R, 1.0), np.nan).astype("float32")
    exg = np.where(have, (2 * G - R - B) / np.maximum(R + G + B, 1.0), np.nan).astype("float32")
    return ndvi, exg, float(have.mean())


def rasterise(x, y, v, X0, Y1, w, h, how):
    col = ((x - X0) / RES).astype(np.int64); row = ((Y1 - y) / RES).astype(np.int64)
    m = (col >= 0) & (col < w) & (row >= 0) & (row < h)
    flat = row[m] * w + col[m]
    if how == "count":
        return np.bincount(flat, minlength=w * h).reshape(h, w).astype("float32")
    v = v[m]; out = np.full(w * h, np.nan, "float32")
    order = np.argsort(v if how == "max" else -v)
    out[flat[order]] = v[order]
    return out.reshape(h, w)


def fill_nearest(a):
    m = np.isnan(a)
    if not m.any():
        return a
    if m.all():
        return np.zeros_like(a)
    idx = ndimage.distance_transform_edt(m, return_distances=False, return_indices=True)
    return a[tuple(idx)]


def fill_canopy(a, reach_m=1.5):
    """v5's gap fill: close sampling holes inside canopy without inventing canopy over open ground."""
    valid = np.isfinite(a)
    if not valid.any():
        return np.zeros_like(a, dtype="float32")
    near = ndimage.binary_dilation(valid, iterations=max(1, int(round(reach_m / RES))))
    filled = np.where(valid, a, 0.0).astype("float32"); wts = valid.astype("float32"); out = a.copy()
    for s in (1.0, 2.0, 4.0):
        num = ndimage.gaussian_filter(filled * wts, s, mode="nearest"); den = ndimage.gaussian_filter(wts, s, mode="nearest")
        est = np.where(den > 1e-6, num / np.maximum(den, 1e-9), np.nan)
        gap = ~np.isfinite(out) & near & np.isfinite(est); out[gap] = est[gap]
    out[~np.isfinite(out)] = 0.0
    return out.astype("float32")


class Stack:
    """Rasters for one focal tile's record extent, on the v5 0.5 m grid."""

    def __init__(self, X0, Y0, X1, Y1, crowns):
        self.X0, self.Y1 = X0, Y1
        self.w, self.h = int(round((X1 - X0) / RES)), int(round((Y1 - Y0) / RES))
        w, h = self.w, self.h
        xs = []
        for t in tiles_over(X0, Y0, X1, Y1):
            P = read_laz(t)
            if P is None:
                continue
            k = (P["x"] >= X0) & (P["x"] < X1) & (P["y"] >= Y0) & (P["y"] < Y1)
            if k.any():
                xs.append({a: b[k] for a, b in P.items()})
        self.has_laz = bool(xs)
        if not xs:
            return
        P = {a: np.concatenate([d[a] for d in xs]) for a in xs[0]}
        C = P["cls"]; g = C == 2
        dem = fill_nearest(rasterise(P["x"][g], P["y"][g], P["z"][g], X0, Y1, w, h, "min"))
        dem = ndimage.median_filter(dem, size=5)
        col = np.clip(((P["x"] - X0) / RES).astype(np.int64), 0, w - 1); row = np.clip(((Y1 - P["y"]) / RES).astype(np.int64), 0, h - 1)
        P["agl"] = P["z"] - dem[row, col]; P["cell"] = row * w + col
        self.P = P
        veg = np.isin(C, (3, 4, 5)); c1 = C == 1; keep = ~np.isin(C, (7, 18))
        self.chm_veg = rasterise(P["x"][veg], P["y"][veg], P["agl"][veg], X0, Y1, w, h, "max")
        self.chm_c1 = rasterise(P["x"][c1], P["y"][c1], P["agl"][c1], X0, Y1, w, h, "max")
        ng = np.fmax(self.chm_veg, self.chm_c1); ng[ng < 0] = np.nan
        work = fill_canopy(ng)
        work = ndimage.grey_closing(work, size=max(1, int(round(PITFILL_M / RES))))
        self.work = ndimage.gaussian_filter(work, SMOOTH_M / RES).astype("float32")
        tv = veg & (P["agl"] >= H_TALL); tc = c1 & (P["agl"] >= H_TALL)
        self.vegcnt = rasterise(P["x"][tv], P["y"][tv], None, X0, Y1, w, h, "count")
        self.c1cnt = rasterise(P["x"][tc], P["y"][tc], None, X0, Y1, w, h, "count")
        bc = rasterise(P["x"][C == 6], P["y"][C == 6], None, X0, Y1, w, h, "count")
        ac = rasterise(P["x"][keep], P["y"][keep], None, X0, Y1, w, h, "count")
        self.bld = np.where(ac > 0, bc / np.maximum(ac, 1), 0).astype("float32")
        self.ndvi, self.exg, self.img_frac = imagery(X0, Y0, X1, Y1, w, h)
        self.ndvi_s = ndimage.gaussian_filter(np.nan_to_num(self.ndvi, nan=0.0), 1.0)
        vegev = ndimage.binary_dilation(self.vegcnt > 0); c1ev = ndimage.binary_dilation(self.c1cnt > 0)
        self.bad_bld = (self.bld >= BLD_FRAC) & ~(self.vegcnt > 0)
        self.vegev, self.c1ev = vegev, c1ev
        # tall thin crowns are displaced in the orthophoto by relief, so green within 1.5 m is accepted
        self.green = ndimage.binary_dilation(self.ndvi_s >= NDVI_MIN, iterations=3)
        # crown cover: tree and low-canopy crowns block new crowns; sub-canopy cells may be absorbed
        from rasterio.features import rasterize as rz
        from rasterio.transform import from_origin
        tr = from_origin(X0, Y1, RES, RES)
        self.lab = np.zeros((h, w), dtype=np.int32)
        cc = crowns[crowns.canopy_class.isin(["tree", "low_canopy"])]
        if len(cc):
            self.lab = rz(((g, i + 1) for i, g in zip(cc.index, cc.geom)), out_shape=(h, w), transform=tr, fill=0, dtype="int32")
        sub = crowns[crowns.canopy_class.eq("sub_canopy")]
        self.sub = rz(((g, 1) for g in sub.geom), out_shape=(h, w), transform=tr, fill=0, dtype="uint8") if len(sub) else np.zeros((h, w), "uint8")

    def rc(self, x, y):
        return int((self.Y1 - y) / RES), int((x - self.X0) / RES)

    def disc(self, r0, c0, rad):
        k = int(np.ceil(rad / RES))
        a0, a1, b0, b1 = max(r0 - k, 0), min(r0 + k + 1, self.h), max(c0 - k, 0), min(c0 + k + 1, self.w)
        yy, xx = np.mgrid[a0:a1, b0:b1]
        m = ((yy - r0) ** 2 + (xx - c0) ** 2) * RES * RES <= rad * rad
        return (slice(a0, a1), slice(b0, b1)), m


def point_features(S, x, y, del_id):
    r0, c0 = S.rc(x, y)
    f = {"has_laz": S.has_laz}
    if not S.has_laz or not (0 <= r0 < S.h and 0 <= c0 < S.w):
        return f
    cover = S.lab > 0
    if del_id:
        cover = cover & (S.lab != del_id)
    f["img_frac"] = S.img_frac
    for rad in (1.5, 3.0, 5.0, 8.0):
        sl, m = S.disc(r0, c0, rad)
        cov = cover[sl][m]; bb = S.bad_bld[sl][m]; wk = S.work[sl][m]
        tall = (wk >= H_TALL) & ~bb
        unc = tall & ~cov
        tag = str(rad).replace(".0", "").replace(".", "p")
        f[f"tall_{tag}"] = int(tall.sum()); f[f"unc_tall_{tag}"] = int(unc.sum())
        f[f"unc_veg_{tag}"] = int((unc & S.vegev[sl][m]).sum())
        f[f"unc_c1g_{tag}"] = int((unc & S.c1ev[sl][m] & ~S.vegev[sl][m] & S.green[sl][m]).sum())
        f[f"unc_c1_{tag}"] = int((unc & S.c1ev[sl][m] & ~S.vegev[sl][m]).sum())
        f[f"maxh_unc_{tag}"] = float(wk[unc].max()) if unc.any() else 0.0
        f[f"maxh_{tag}"] = float(wk.max()) if wk.size else 0.0
        f[f"bld_{tag}"] = float(bb.mean())
        f[f"cov_{tag}"] = float(cov.mean())
        if rad == 1.5:
            f["c1_returns_1p5"] = int(S.c1cnt[sl][m].sum()); f["veg_returns_1p5"] = int(S.vegcnt[sl][m].sum())
            f["ndvi_1p5"] = float(np.nanmean(S.ndvi[sl][m])) if np.isfinite(S.ndvi[sl][m]).any() else np.nan
    f["h_at"] = float(S.work[r0, c0]); f["bld_at"] = float(S.bld[r0, c0]); f["ndvi_at"] = float(S.ndvi_s[r0, c0])
    return f


def seeded_crown(S, x, y, rseed, rcap, del_id, tile_of):
    """Delineate the uncovered tree nearest the record, v5-style, or return None."""
    from skimage.segmentation import watershed
    r0, c0 = S.rc(x, y)
    k = int(np.ceil((rseed + rcap + 3) / RES))
    a0, a1, b0, b1 = max(r0 - k, 0), min(r0 + k + 1, S.h), max(c0 - k, 0), min(c0 + k + 1, S.w)
    sl = (slice(a0, a1), slice(b0, b1))
    lab = S.lab[sl]; cover = (lab > 0) & ((lab != del_id) if del_id else True)
    work = S.work[sl]
    elig = (work >= H_ELIG) & ~cover & ~S.bad_bld[sl] & (S.vegev[sl] | (S.c1ev[sl] & S.green[sl]))
    if not elig.any():
        return None
    mx = ndimage.maximum_filter(work, size=5)
    lm = (work >= mx - 1e-6) & elig & (work >= H_TALL)
    if not lm.any():
        return None
    mk, n = ndimage.label(lm)
    ws = watershed(-work, mk, mask=elig)
    rr, cc = r0 - a0, c0 - b0
    yy, xx = np.mgrid[0:ws.shape[0], 0:ws.shape[1]]
    d = np.hypot(yy - rr, xx - cc) * RES
    best, bd = None, 1e9
    for b in np.unique(ws[(ws > 0) & (d <= rseed)]):
        cells = ws == b
        top = np.unravel_index(np.argmax(np.where(cells, work, -1)), work.shape)
        hmax = work[top]
        keep = cells & (work >= TRIM * hmax) & (np.hypot(yy - top[0], xx - top[1]) * RES <= rcap)
        cl, _ = ndimage.label(keep); keep = cl == cl[top]
        keep = ndimage.binary_fill_holes(keep)
        if keep.sum() * RES * RES < 1.5:
            continue
        dd = float(d[keep].min())
        if dd < bd - 0.25 or (abs(dd - bd) <= 0.25 and best is not None and hmax > best[2]):
            best, bd = (keep, top, hmax), dd
    if best is None:
        return None
    keep, top, hmax = best
    from rasterio.features import shapes
    from rasterio.transform import from_origin
    from shapely.geometry import shape
    from shapely import wkb as swkb
    X0, Y1 = S.X0 + b0 * RES, S.Y1 - a0 * RES
    geoms = [shape(g) for g, v in shapes(keep.astype("uint8"), mask=keep, transform=from_origin(X0, Y1, RES, RES))]
    poly = max(geoms, key=lambda g: g.area)
    tx, ty = round(X0 + (top[1] + 0.5) * RES, 2), round(Y1 - (top[0] + 0.5) * RES, 2)
    # per-crown return statistics, from the points whose cells fall inside
    P = S.P
    full = np.zeros((S.h, S.w), bool); full[sl] = keep
    inside = full.ravel()[P["cell"]]
    C = P["cls"][inside]; agl = P["agl"][inside]
    veg = np.isin(C, (3, 4, 5)); ngr = np.isin(C, (1, 3, 4, 5)) & (agl >= H_ELIG)
    n_veg, n_unc = int(veg.sum()), int((C == 1).sum())
    n_unc_hi = int(((C == 1) & (agl >= H_ELIG)).sum()); n_veg_hi = int((veg & (agl >= H_ELIG)).sum())
    rf, cf = np.nonzero(keep); k_ = len(rf)
    cov = np.cov(np.vstack([rf, cf])) if k_ > 2 else np.eye(2)
    ev = np.sort(np.linalg.eigvalsh(cov))[::-1]
    area = k_ * RES * RES
    hgt = float(hmax)
    nd = S.ndvi[sl][keep]
    pt_d = shp_distance(poly, shp_points(x, y))
    return {"seg_key": seg_key(tile_of(tx, ty), tx, ty), "x_2193": tx, "y_2193": ty, "height_m": round(hgt, 2),
            "crown_area_m2": round(area, 2), "crown_diameter_m": round(float(2 * np.sqrt(area / np.pi)), 2),
            "mean_veg_height_m": round(float(agl[veg].mean()), 2) if n_veg else None,
            "mean_nonground_height_m": round(float(agl[ngr].mean()), 2) if ngr.any() else None,
            "n_veg_returns": n_veg, "n_building_returns": int((C == 6).sum()), "n_ground_returns": int((C == 2).sum()),
            "n_unclassified_returns": n_unc, "n_bridge_returns": int((C == 17).sum()), "n_water_returns": int((C == 9).sum()),
            "multi_return_fraction": round(float((P["nret"][inside] > 1).mean()), 4) if inside.any() else None,
            "intensity_mean": round(float(P["int"][inside].mean()), 2) if inside.any() else None,
            "aerial_greenness": round(float(np.nanmean(S.exg[sl][keep])), 4) if np.isfinite(S.exg[sl][keep]).any() else None,
            "ndvi_mean": round(float(np.nanmean(nd)), 4) if np.isfinite(nd).any() else None,
            "elongation": round(float(np.sqrt(max(ev[0], 1e-9) / max(ev[1], 1e-9))), 3),
            "bbox_fill": round(float(k_ / ((rf.max() - rf.min() + 1) * (cf.max() - cf.min() + 1))), 3),
            "gap_filled_fraction": round(float(np.mean(~(S.vegev[sl][keep] | S.c1ev[sl][keep]))), 4),
            "unclassified_fraction": round(n_unc_hi / max(n_unc_hi + n_veg_hi, 1), 4),
            "building_overlap": round(float(np.mean(S.bld[sl][keep] > 0)), 4),
            "sub_canopy_overlap": round(float(np.mean(S.sub[sl][keep] > 0)), 4),
            "crown_wkb": swkb.dumps(poly), "edge_distance_m": round(float(pt_d), 2),
            "top_distance_m": round(float(np.hypot(tx - x, ty - y)), 2),
            "canopy_class": "tree" if hgt >= 3 else ("low_canopy" if hgt >= 2 else "sub_canopy")}


def palm_scores(tile, x0, y0, x1, y1):
    out = []
    for t in tiles_over(x0, y0, x1, y1):
        f = PALM_DET / f"det_{t.replace('pc_', '')}.parquet"
        if f.exists():
            d = pd.read_parquet(f, columns=["cls", "score", "x0", "y0", "x1", "y1", "in_tile"])
            out.append(d[(d.cls == "palm") & d.in_tile])
    return pd.concat(out) if out else None


def process_tile(args):
    """One focal tile: queries (qid, tree_id, x, y, src_group, genus, del_seg) -> feat / cand / crowns / new parquet."""
    tile, recs, mature, outt = args
    dest = outt / f"{tile}.done"
    if dest.exists():
        return tile, "cached", 0
    t0 = time.time()
    x0, x1 = recs.x.min() - PAD, recs.x.max() + PAD; y0, y1 = recs.y.min() - PAD, recs.y.max() + PAD
    x0, y0 = np.floor(x0 / RES) * RES, np.floor(y0 / RES) * RES; x1, y1 = np.ceil(x1 / RES) * RES, np.ceil(y1 / RES) * RES
    cs = [c for t in tiles_over(x0 - R_CAND, y0 - R_CAND, x1 + R_CAND, y1 + R_CAND) if (c := load_crowns(t)) is not None]
    crowns = pd.concat(cs, ignore_index=True) if cs else pd.DataFrame(columns=["seg_key", "canopy_class", "crown_wkb", "x_2193", "y_2193"])
    crowns = crowns[(crowns.x_2193 > x0 - R_CAND - 40) & (crowns.x_2193 < x1 + R_CAND + 40) &
                    (crowns.y_2193 > y0 - R_CAND - 40) & (crowns.y_2193 < y1 + R_CAND + 40)].reset_index(drop=True)
    crowns["geom"] = from_wkb(crowns.crown_wkb.values) if len(crowns) else []
    S = Stack(x0, y0, x1, y1, crowns)
    idx_of = {k: i + 1 for i, k in enumerate(crowns.seg_key)}
    # crown candidates (tree + low canopy) by polygon edge distance
    cand = crowns[crowns.canopy_class.isin(["tree", "low_canopy"])]
    rows = []
    if len(cand):
        tree = STRtree(cand.geom.values); P = shp_points(recs.x.values, recs.y.values)
        ri, ci = tree.query(P, predicate="dwithin", distance=R_CAND)
        de = shp_distance(P[ri], cand.geom.values[ci])
        cx, cy = cand.x_2193.values[ci], cand.y_2193.values[ci]
        cd = pd.DataFrame({"qid": recs.qid.values[ri], "seg_key": cand.seg_key.values[ci], "d_edge": de.round(3),
                           "dx": (cx - recs.x.values[ri]).round(3), "dy": (cy - recs.y.values[ri]).round(3)})
        cd["d_top"] = np.hypot(cd.dx, cd.dy).round(3)
        cd = cd.sort_values(["qid", "d_edge", "d_top"]).groupby("qid").head(K_CAND)
        rows.append(cd)
    cdf = pd.concat(rows) if rows else pd.DataFrame(columns=["qid", "seg_key", "d_edge", "dx", "dy", "d_top"])
    used = crowns[crowns.seg_key.isin(cdf.seg_key)].drop(columns=["geom"])
    palms = palm_scores(tile, x0, y0, x1, y1)
    feats, news = [], []
    for r in recs.itertuples(index=False):
        del_id = idx_of.get(r.del_seg) if isinstance(r.del_seg, str) else None
        f = point_features(S, r.x, r.y, del_id); f.update(qid=r.qid, tree_id=r.tree_id)
        if palms is not None and len(palms):
            hit = palms[(palms.x0 <= r.x + 1) & (palms.x1 >= r.x - 1) & (palms.y0 <= r.y + 1) & (palms.y1 >= r.y - 1)]
            f["palm_det_at"] = float(hit.score.max()) if len(hit) else 0.0
        feats.append(f)
        if S.has_laz:
            nc = seeded_crown(S, r.x, r.y, R_SEED[r.src_group], r_cap(r.genus, mature.get(r.genus)), del_id, tname)
            if nc:
                if palms is not None and len(palms):
                    from shapely import wkb as swkb
                    b = swkb.loads(nc["crown_wkb"]).bounds
                    hit = palms[(palms.x0 <= b[2]) & (palms.x1 >= b[0]) & (palms.y0 <= b[3]) & (palms.y1 >= b[1])]
                    nc["palm_det_score"] = float(hit.score.max()) if len(hit) else 0.0
                nc.update(qid=r.qid, tree_id=r.tree_id, tile=tname(nc["x_2193"], nc["y_2193"]))
                news.append(nc)
    pd.DataFrame(feats).to_parquet(outt / f"{tile}.feat.parquet", index=False)
    cdf.to_parquet(outt / f"{tile}.cand.parquet", index=False)
    used.to_parquet(outt / f"{tile}.crowns.parquet", index=False)
    if news:
        pd.DataFrame(news).to_parquet(outt / f"{tile}.new.parquet", index=False)
    dest.write_text(json.dumps({"records": len(recs), "seconds": round(time.time() - t0, 1)}))
    return tile, "done", round(time.time() - t0, 1)


def production_queries():
    R = pd.read_parquet(WORK / "records.parquet")
    have = {f.name[:-8] for f in CROWNS.glob("pc_*.parquet")}
    R = R[R.tile.isin(have)].copy()
    R["qid"] = R.tree_id; R["del_seg"] = None
    return R[["qid", "tree_id", "x", "y", "src_group", "genus", "del_seg", "tile"]]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--workers", type=int, default=3); ap.add_argument("--tiles", nargs="*")
    ap.add_argument("--queries", help="parquet of (qid, tree_id, x, y, src_group, genus, del_seg, tile); default: production records")
    ap.add_argument("--out", default=str(OUTT)); ap.add_argument("--log", default="features.log")
    a = ap.parse_args()
    outt = Path(a.out); outt.mkdir(parents=True, exist_ok=True)
    Q = pd.read_parquet(a.queries) if a.queries else production_queries()
    have = {f.name[:-8] for f in CROWNS.glob("pc_*.parquet")}
    Q = Q[Q.tile.isin(have)]
    ig = pd.read_parquet(WORK / "itree_genus.parquet")
    mature = dict(zip(ig.genus, ig.mature_height_m))
    tiles = sorted(Q.tile.unique()) if not a.tiles else a.tiles
    jobs = [(t, g, mature, outt) for t, g in Q[Q.tile.isin(tiles)].groupby("tile")]
    log = open(WORK.parent / "logs" / a.log, "a")
    t0 = time.time()
    with Pool(a.workers, maxtasksperchild=40) as pool:
        for i, res in enumerate(pool.imap_unordered(safe, jobs, chunksize=2), 1):
            log.write(json.dumps(res) + "\n"); log.flush()
            if i % 25 == 0:
                print(f"[{i}/{len(jobs)}] {time.time() - t0:.0f}s", flush=True)


def safe(job):
    try:
        os.environ["OMP_NUM_THREADS"] = "1"
        return process_tile(job)
    except Exception as e:
        return job[0], f"error {type(e).__name__}: {e}", traceback.format_exc()[-600:]


if __name__ == "__main__":
    main()
