#!/usr/bin/env python3
"""ALTO v4 tree detection from the 2024 point cloud: every vegetation crown >= 3 m.

Per LAZ tile, with a halo read from neighbouring tiles:
  1. ground model from class-2 returns (1 m grid, holes filled linearly) and
     height above ground for every return;
  2. vegetation-only canopy height model (classes 3-5, 0.5 m), despiked, pits closed;
  3. tree tops by variable-window local maxima, crowns by marker watershed;
  4. evidence for each crown from the returns inside it (vegetation share,
     multi-return share, point-colour greenness, roof or water beneath, shape);
  5. links from existing ALTO records to the crown their point falls in or touches.

A tile keeps only crowns whose top lies inside its own footprint and inside the
metro release area, so tiles can run in any order without double counting.
Writes <tile>.crowns.parquet and <tile>.links.parquet. Inputs are only read.

    python detect_v4.py run --out ../tiles --existing ../existing.npz --workers 10
    python detect_v4.py run --out ../calib/p2 --tiles pc_BB32_1000_2137.laz ...
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import traceback
from collections import OrderedDict, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import laspy
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import shapely
from affine import Affine
from rasterio import features
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.segmentation import watershed

T7 = Path("/data/alto")
LAZ = T7 / "point_cloud_2024" / "auckland_metro_v1"
METRO = (1740000.0, 5895000.0, 1782000.0, 5935000.0)
RES = 0.5
HALO_M = 30.0
VEG = (3, 4, 5)
NOISE = (7, 18)
MIN_PEAK_M = 3.0          # a crown must reach 3 m to count as a possible tree
MASK_MIN_M = 2.0          # crown pixels are vegetation at least 2 m tall
REL_EDGE = 0.25           # ...and at least a quarter of their crown's top height
MIN_AREA_M2 = 1.0
DEFAULT_PARAMS = dict(nms_a=1.5, nms_b=0.15, nms_min=2.0, nms_max=6.0, sigma_px=1.0)
INVENTORY_LINK_M = 3.0    # council/notable/OSM/kauri positions can sit a few metres off
DETECTION_LINK_M = 1.5    # earlier LiDAR detections sit on a canopy top already

GLI_VRT = T7 / "interim" / "greenness_auckland_metro_v1" / "greenness.vrt"

_MANIFEST: list[tuple[str, float, float, float, float]] | None = None
_EXISTING: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None
_GLI = None


def gli_source():
    global _GLI
    if _GLI is None:
        import rasterio
        _GLI = rasterio.open(GLI_VRT)
    return _GLI


DSM_CHM_VRT = T7 / "interim" / "auckland_metro_v1_lidar" / "chm.vrt"
_DSM = None
EDGE_FILL_MAX_PX = 6          # bridge no-return bands up to 3 m from surveyed cells
DISK3 = np.hypot(*np.mgrid[-3:4, -3:4]) <= 3.0
HEDGE_MIN_AREA_M2 = 12.0


def dsm_source():
    global _DSM
    if _DSM is None:
        import rasterio
        _DSM = rasterio.open(DSM_CHM_VRT)
    return _DSM


def read_raster_05(src, bounds, H2, W2):
    """A 1 m raster window on this tile's 0.5 m grid (both aligned to whole metres)."""
    from rasterio.windows import from_bounds
    l, b, r, t = bounds
    nod = src.nodata if src.nodata is not None else -9999
    a = src.read(1, window=from_bounds(l, b, r, t, transform=src.transform), boundless=True,
                 fill_value=nod).astype(np.float32)
    a[a == nod] = np.nan
    return np.repeat(np.repeat(a, 2, axis=0), 2, axis=1)[:H2, :W2]


def manifest():
    global _MANIFEST
    if _MANIFEST is None:
        recs = []
        for line in (LAZ / "manifest.jsonl").open(encoding="utf-8"):
            r = json.loads(line)
            x0, y0, x1, y1 = (float(v) for v in r["bbox_2193"][-4:])
            recs.append((r["tile"], x0, y0, x1, y1))
        _MANIFEST = recs
    return _MANIFEST


def existing(path: str | None):
    global _EXISTING
    if _EXISTING is None and path:
        d = np.load(path)
        _EXISTING = (d["x"], d["y"], d["kind"])
    return _EXISTING


_TILE_CACHE: "OrderedDict[str, dict | None]" = OrderedDict()
TILE_CACHE_SIZE = 9


def decode_tile(name):
    """All non-noise returns of one LAZ tile, kept for the next few neighbouring tiles."""
    if name in _TILE_CACHE:
        _TILE_CACHE.move_to_end(name)
        return _TILE_CACHE[name]
    parts = defaultdict(list)
    # single-threaded decoding: the parallel decoder starts a thread per core in
    # every worker process, which swamps the machine when tiles run in parallel
    with laspy.open(LAZ / name, laz_backend=laspy.LazBackend.Lazrs) as f:
        for p in f.chunk_iterator(2_000_000):
            cls = np.asarray(p.classification)
            keep = ~np.isin(cls, NOISE)
            try:
                keep &= ~np.asarray(p.withheld).astype(bool)
            except Exception:  # noqa: BLE001 - older formats have no flag view
                pass
            sel = np.flatnonzero(keep)
            if sel.size == 0:
                continue
            parts["x"].append(np.asarray(p.x)[sel])
            parts["y"].append(np.asarray(p.y)[sel])
            parts["z"].append(np.asarray(p.z)[sel].astype(np.float32))
            parts["c"].append(cls[sel].astype(np.uint8))
            parts["nr"].append(np.asarray(p.number_of_returns)[sel].astype(np.uint8))
            parts["i"].append(np.asarray(p.intensity)[sel].astype(np.float32))
    arr = {k: np.concatenate(v) for k, v in parts.items()} if parts else None
    _TILE_CACHE[name] = arr
    while len(_TILE_CACHE) > TILE_CACHE_SIZE:
        _TILE_CACHE.popitem(last=False)
    return arr


def read_points(bounds):
    l, b, r, t = bounds
    parts = defaultdict(list)
    for name, x0, y0, x1, y1 in manifest():
        if not (x1 > l and x0 < r and y1 > b and y0 < t):
            continue
        if not (LAZ / name).exists():
            continue
        arr = decode_tile(name)
        if arr is None:
            continue
        m = (arr["x"] >= l) & (arr["x"] < r) & (arr["y"] >= b) & (arr["y"] < t)
        if not m.any():
            continue
        for k, v in arr.items():
            parts[k].append(v[m])
    if not parts:
        return None
    return {k: np.concatenate(v) for k, v in parts.items()}


def ground_model(P, bounds):
    """1 m ground surface: mean class-2 height per cell, holes filled from the surrounding ground."""
    l, b, r, t = bounds
    W, H = int(round(r - l)), int(round(t - b))
    g = P["c"] == 2
    if g.sum() < 20:
        g = np.isin(P["c"], (2, 9))
    if g.sum() < 3:
        return None
    col = np.clip((P["x"][g] - l).astype(np.int64), 0, W - 1)
    row = np.clip((t - P["y"][g]).astype(np.int64), 0, H - 1)
    idx = row * W + col
    s = np.bincount(idx, weights=P["z"][g], minlength=H * W)
    n = np.bincount(idx, minlength=H * W)
    dem = np.full(H * W, np.nan)
    ok = n > 0
    dem[ok] = s[ok] / n[ok]
    dem = dem.reshape(H, W)
    if np.isnan(dem).any():
        dem = inpaint(dem)
    return dem


def inpaint(dem):
    """Fill holes with Gaussian-weighted ground from ever wider surroundings.

    Matches linear interpolation to within a few centimetres at the median on held-out
    ground, and runs in well under a second where triangulation took ~20 s on harbour tiles.
    """
    out = dem.copy()
    known = ~np.isnan(out)
    for sigma in (1, 2, 4, 8, 16, 32, 64, 128):
        if known.all():
            break
        num = ndimage.gaussian_filter(np.where(known, out, 0.0), sigma, mode="nearest")
        den = ndimage.gaussian_filter(known.astype(float), sigma, mode="nearest")
        upd = ~known & (den > 0.02)
        out[upd] = num[upd] / den[upd]
        known = ~np.isnan(out)
    if not known.all():
        out[~known] = np.nanmean(out) if known.any() else 0.0
    return out


def cell_max(idx, vals, n):
    out = np.full(n, np.nan, np.float32)
    if idx.size:
        o = np.argsort(idx, kind="stable")
        i_s, v_s = idx[o], vals[o]
        u, st = np.unique(i_s, return_index=True)
        out[u] = np.maximum.reduceat(v_s, st)
    return out


def despike(a):
    filled = np.nan_to_num(a, nan=-9999.0)
    fp = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], bool)
    nmax = ndimage.maximum_filter(filled, footprint=fp, mode="nearest")
    out = a.copy()
    out[np.isfinite(a) & (a - nmax > 4.0)] = np.nan
    return out


def find_tops(sm, mask, p, filled=None):
    """Tree tops. Cells bridged across a tile-edge band only start a crown of their own
    when no surveyed top is within max(6 m, twice the usual spacing); otherwise they join
    the neighbouring crown instead of splitting it."""
    cand = (sm == ndimage.maximum_filter(sm, size=5)) & (sm >= MIN_PEAK_M) & mask
    if filled is None or not filled.any():
        return _nms(sm, cand, p)
    r1, c1 = _nms(sm, cand & ~filled, p)
    rf, cf = np.nonzero(cand & filled)
    if rf.size == 0:
        return r1, c1
    hf = sm[rf, cf]
    order = np.argsort(-hf, kind="stable")
    kd = cKDTree(np.column_stack([r1, c1])) if r1.size else None
    add = []
    for rr, cc, hh in zip(rf[order], cf[order], hf[order]):
        rad = max(12.0, 2 * float(np.clip(p["nms_a"] + p["nms_b"] * hh, p["nms_min"], p["nms_max"])) / RES)
        if kd is not None and kd.query_ball_point([rr, cc], rad):
            continue
        if any((ar - rr) ** 2 + (ac - cc) ** 2 <= rad * rad for ar, ac in add):
            continue
        add.append((int(rr), int(cc)))
    if not add:
        return r1, c1
    ar, ac = np.array(add, dtype=r1.dtype).T
    return np.concatenate([r1, ar]), np.concatenate([c1, ac])


def _nms(sm, cand, p):
    r, c = np.nonzero(cand)
    h = sm[r, c]
    o = np.argsort(-h, kind="stable")
    r, c, h = r[o], c[o], h[o]
    rad_px = np.clip(p["nms_a"] + p["nms_b"] * h, p["nms_min"], p["nms_max"]) / RES
    B = 16
    buckets: dict[tuple[int, int], list[tuple[int, int]]] = {}
    keep = np.zeros(h.size, bool)
    for i in range(h.size):
        rr, cc, rad = int(r[i]), int(c[i]), float(rad_px[i])
        br, bc = rr // B, cc // B
        reach = int(rad // B) + 1
        rad2 = rad * rad
        ok = True
        for dr in range(-reach, reach + 1):
            for dc in range(-reach, reach + 1):
                for qr, qc in buckets.get((br + dr, bc + dc), ()):
                    if (qr - rr) ** 2 + (qc - cc) ** 2 <= rad2:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                break
        if ok:
            keep[i] = True
            buckets.setdefault((br, bc), []).append((rr, cc))
    return r[keep], c[keep]


def process_tile(name, out_dir, existing_path=None, params=None, write=True):
    t0 = time.time()
    tm = {"start": t0}
    p = {**DEFAULT_PARAMS, **(params or {})}
    rec = next(m for m in manifest() if m[0] == name)
    _, cx0, cy0, cx1, cy1 = rec
    # core clipped to the release area; nothing to do for tiles wholly outside it
    kx0, ky0 = max(cx0, METRO[0]), max(cy0, METRO[1])
    kx1, ky1 = min(cx1, METRO[2]), min(cy1, METRO[3])
    if kx0 >= kx1 or ky0 >= ky1:
        return dict(tile=name, crowns=0, links=0, secs=0.0, note="outside release area")
    l, b = math.floor(cx0 - HALO_M), math.floor(cy0 - HALO_M)
    r, t = math.ceil(cx1 + HALO_M), math.ceil(cy1 + HALO_M)
    bounds = (l, b, r, t)
    P = read_points(bounds)
    tm["read"] = time.time()
    if P is None:
        return dict(tile=name, crowns=0, links=0, secs=time.time() - t0, note="no points")
    dem = ground_model(P, bounds)
    tm["ground"] = time.time()
    if dem is None:
        return dict(tile=name, crowns=0, links=0, secs=time.time() - t0, note="no ground")
    ground = ndimage.map_coordinates(dem, [(t - P["y"]) - 0.5, (P["x"] - l) - 0.5], order=1, mode="nearest")
    hag = (P["z"] - ground).astype(np.float32)

    W2, H2 = int(round((r - l) / RES)), int(round((t - b) / RES))
    col = ((P["x"] - l) / RES).astype(np.int64)
    row = ((t - P["y"]) / RES).astype(np.int64)
    inside = (row >= 0) & (row < H2) & (col >= 0) & (col < W2)
    cell = np.where(inside, row * W2 + col, -1)
    veg = np.isin(P["c"], VEG) & inside & (hag > 0.5)
    chm = cell_max(cell[veg], np.clip(hag[veg], 0, 80), H2 * W2).reshape(H2, W2)
    chm = despike(chm)
    # The point-cloud download trimmed ~2 m off every tile, leaving a 4 m band with no
    # returns along each tile boundary, which cut crowns in half. Bridge such bands with
    # the 1 m DSM-DEM canopy model, only where the nearest surveyed cell is vegetation
    # and not roof.
    any_pts = np.zeros(H2 * W2, bool)
    any_pts[cell[inside]] = True
    gap = ~ndimage.binary_dilation(any_pts.reshape(H2, W2), iterations=2)
    filled = np.zeros((H2, W2), bool)
    if gap.any():
        try:
            dsm05 = read_raster_05(dsm_source(), bounds, H2, W2)
            bsel = (P["c"] == 6) & inside & (hag > 2.0)
            roof = np.zeros(H2 * W2, bool)
            roof[cell[bsel]] = True
            roof = roof.reshape(H2, W2)
            # returns were thinned on download, so judge the surroundings on a closed surface:
            # vegetation within 3 m of the band and no roof within 1.5 m
            veg_near = ndimage.binary_dilation(
                (ndimage.grey_closing(np.nan_to_num(chm, nan=0.0), size=5) >= MASK_MIN_M) & ~gap, iterations=6)
            roof_near = ndimage.binary_dilation(roof, iterations=3)
            dist = ndimage.distance_transform_edt(gap)
            filled = (gap & (dist <= EDGE_FILL_MAX_PX) & veg_near & ~roof_near
                      & np.isfinite(dsm05) & (dsm05 >= MASK_MIN_M))
            chm = np.where(filled, dsm05, chm)
        except Exception:  # noqa: BLE001 - without the raster the band simply stays empty
            filled = np.zeros((H2, W2), bool)
    closed = ndimage.grey_closing(np.nan_to_num(chm, nan=0.0), size=3)
    sm = ndimage.gaussian_filter(closed, p["sigma_px"])
    mask = closed >= MASK_MIN_M
    tm["chm"] = time.time()

    tr, tc = find_tops(sm, mask, p, filled)
    tm["tops"] = time.time()
    if tr.size == 0:
        return _write(name, out_dir, [], [], write, t0)
    markers = np.zeros((H2, W2), np.int32)
    markers[tr, tc] = np.arange(1, tr.size + 1, dtype=np.int32)
    lab = watershed(-sm, markers, mask=mask).astype(np.int32)
    n = tr.size + 1
    idx_all = np.arange(n)
    top = np.asarray(ndimage.maximum(closed, lab, index=idx_all), dtype=np.float32)
    top[0] = 0
    lab[(lab > 0) & (closed < REL_EDGE * top[lab])] = 0
    tm["watershed"] = time.time()

    # keep crowns whose top is in this tile's core and in the release area
    xs = l + (tc + 0.5) * RES
    ys = t - (tr + 0.5) * RES
    owned = (xs >= kx0) & (xs < kx1) & (ys >= ky0) & (ys < ky1)
    area = np.bincount(lab.ravel(), minlength=n) * RES * RES
    ok = np.zeros(n, bool)
    ok[1:] = owned & (top[1:] >= MIN_PEAK_M) & (area[1:] >= MIN_AREA_M2)
    ids = np.flatnonzero(ok)
    if ids.size == 0:
        return _write(name, out_dir, [], [], write, t0)
    # hedge-like structure: vegetation narrower than ~3 m that runs on for several metres
    narrow = mask & ~ndimage.binary_opening(mask, structure=DISK3)
    nl, nn = ndimage.label(narrow)
    long_narrow = np.bincount(nl.ravel(), minlength=nn + 1) * RES * RES >= HEDGE_MIN_AREA_M2
    long_narrow[0] = False
    px_per = np.maximum(np.bincount(lab.ravel(), minlength=n), 1)
    hedge_frac = np.bincount(lab[long_narrow[nl]], minlength=n) / px_per
    gap_frac = np.bincount(lab[filled], minlength=n) / px_per

    # ---- evidence from the returns inside each crown
    li = np.zeros(P["x"].size, np.int32)
    li[inside] = lab.ravel()[cell[inside]]
    hi = hag > 2.0
    def count(sel):
        return np.bincount(li[sel], minlength=n)
    n_veg = count(hi & np.isin(P["c"], VEG))
    n_bld = count(hi & (P["c"] == 6))
    n_unc = count(hi & (P["c"] == 1))
    n_brg = count(hi & (P["c"] == 17))
    n_wat = count(P["c"] == 9)
    n_gnd = count(P["c"] == 2)
    vsel = hi & np.isin(P["c"], VEG)
    n_multi = count(vsel & (P["nr"] > 1))
    inten = np.bincount(li[vsel], weights=P["i"][vsel], minlength=n)
    # the 2024 LAZ carries no point colours; greenness comes from the aerial raster below
    gli_sum = gli_n = np.zeros(n)
    hag_sum = np.bincount(li[vsel], weights=hag[vsel], minlength=n)
    tm["features_points"] = time.time()
    # aerial greenness under the crown, read on this grid (1 m raster -> 0.5 m)
    img_sum = img_n = None
    try:
        from rasterio.windows import from_bounds
        src = gli_source()
        nod = src.nodata
        g1 = src.read(1, window=from_bounds(l, b, r, t, transform=src.transform), boundless=True,
                      fill_value=nod if nod is not None else -9999).astype(np.float32)
        g1[g1 == (nod if nod is not None else -9999)] = np.nan
        g05 = np.repeat(np.repeat(g1, 2, axis=0), 2, axis=1)[:H2, :W2]
        okg = np.isfinite(g05) & (lab > 0)
        img_sum = np.bincount(lab[okg], weights=g05[okg], minlength=n)
        img_n = np.bincount(lab[okg], minlength=n)
    except Exception:  # noqa: BLE001 - greenness is supporting evidence only
        pass

    # ---- shape from pixel moments
    rows_i, cols_i = np.indices(lab.shape, dtype=np.float64)
    flat = lab.ravel()
    cnt = np.maximum(np.bincount(flat, minlength=n), 1)
    mr = np.bincount(flat, weights=rows_i.ravel(), minlength=n) / cnt
    mc = np.bincount(flat, weights=cols_i.ravel(), minlength=n) / cnt
    vr = np.bincount(flat, weights=rows_i.ravel() ** 2, minlength=n) / cnt - mr ** 2
    vc = np.bincount(flat, weights=cols_i.ravel() ** 2, minlength=n) / cnt - mc ** 2
    cv = np.bincount(flat, weights=(rows_i * cols_i).ravel(), minlength=n) / cnt - mr * mc
    del rows_i, cols_i
    half = (vr + vc) / 2
    root = np.sqrt(np.maximum(((vr - vc) / 2) ** 2 + cv ** 2, 0))
    elong = np.sqrt((half + root + 0.083) / np.maximum(half - root + 0.083, 1e-6))
    objs = ndimage.find_objects(lab)
    tm["shape"] = time.time()

    # ---- crown polygons, smoothed off the pixel grid
    own_lab = np.where(ok[lab], lab, 0).astype(np.int32)
    affine = Affine(RES, 0, l, 0, -RES, t)
    parts = defaultdict(list)
    for geom, val in features.shapes(own_lab, mask=own_lab > 0, transform=affine, connectivity=4):
        parts[int(val)].append(shapely.geometry.shape(geom))
    rows_out = []
    for k in ids:
        polys = parts.get(int(k))
        if not polys:
            continue
        top_pt = shapely.Point(xs[k - 1], ys[k - 1])
        poly = next((pg for pg in polys if pg.buffer(0.5).contains(top_pt)), max(polys, key=lambda g: g.area))
        smooth = shapely.simplify(shapely.buffer(shapely.buffer(poly, 0.3, join_style="round"), -0.3,
                                                 join_style="round"), 0.15)
        if smooth.is_empty or smooth.area < 0.5 * poly.area:
            smooth = poly
        sl = objs[k - 1]
        bh = (sl[0].stop - sl[0].start) if sl else 1
        bw = (sl[1].stop - sl[1].start) if sl else 1
        nv = int(n_veg[k])
        rows_out.append(dict(
            seg_key=f"{int(round(xs[k - 1] * 2))}_{int(round(ys[k - 1] * 2))}",
            x=float(xs[k - 1]), y=float(ys[k - 1]),
            height_m=float(top[k]), area_m2=float(area[k]),
            mean_veg_hag_m=float(hag_sum[k] / nv) if nv else None,
            n_veg=nv, n_bldg=int(n_bld[k]), n_uncl=int(n_unc[k]), n_bridge=int(n_brg[k]),
            n_water=int(n_wat[k]), n_ground=int(n_gnd[k]),
            multi_return=float(n_multi[k] / nv) if nv else None,
            intensity=float(inten[k] / nv) if nv else None,
            gli=float(gli_sum[k] / gli_n[k]) if gli_n[k] else None,
            img_gli=float(img_sum[k] / img_n[k]) if img_n is not None and img_n[k] else None,
            elong=float(elong[k]), fill=float(cnt[k] / max(bh * bw, 1)),
            hedge_frac=float(hedge_frac[k]), gap_frac=float(gap_frac[k]),
            crown_wkb=shapely.to_wkb(smooth),
        ))

    tm["polygons"] = time.time()
    # ---- link existing records to the crown their point is in or next to
    links = []
    ex = existing(existing_path)
    if ex is not None and rows_out:
        exx, exy, exk = ex
        m = (exx >= l) & (exx < r) & (exy >= b) & (exy < t)
        eidx = np.flatnonzero(m)
        if eidx.size:
            dist, (ir, ic) = ndimage.distance_transform_edt(own_lab == 0, return_indices=True)
            er = ((t - exy[eidx]) / RES).astype(np.int64)
            ec = ((exx[eidx] - l) / RES).astype(np.int64)
            valid = (er >= 0) & (er < H2) & (ec >= 0) & (ec < W2)
            eidx, er, ec = eidx[valid], er[valid], ec[valid]
            near = own_lab[ir[er, ec], ic[er, ec]]
            d_m = dist[er, ec] * RES
            tol = np.where(exk[eidx] == 0, INVENTORY_LINK_M, DETECTION_LINK_M)
            hit = (near > 0) & (d_m <= tol)
            key_of = {int(k): f"{int(round(xs[k - 1] * 2))}_{int(round(ys[k - 1] * 2))}" for k in ids}
            for e, k, d in zip(eidx[hit], near[hit], d_m[hit]):
                links.append(dict(exist_idx=int(e), seg_key=key_of[int(k)], dist_m=float(d)))
    tm["links"] = time.time()
    return _write(name, out_dir, rows_out, links, write, t0, tm)


def _write(name, out_dir, rows, links, write, t0, tm=None):
    if write:
        out = Path(out_dir)
        stem = Path(name).stem
        schema = pa.schema([
            ("seg_key", pa.string()), ("x", pa.float64()), ("y", pa.float64()),
            ("height_m", pa.float32()), ("area_m2", pa.float32()), ("mean_veg_hag_m", pa.float32()),
            ("n_veg", pa.int32()), ("n_bldg", pa.int32()), ("n_uncl", pa.int32()), ("n_bridge", pa.int32()),
            ("n_water", pa.int32()), ("n_ground", pa.int32()), ("multi_return", pa.float32()),
            ("intensity", pa.float32()), ("gli", pa.float32()), ("img_gli", pa.float32()), ("elong", pa.float32()),
            ("fill", pa.float32()), ("hedge_frac", pa.float32()), ("gap_frac", pa.float32()),
            ("crown_wkb", pa.binary()),
        ])
        pq.write_table(pa.Table.from_pylist(rows, schema=schema), out / f"{stem}.crowns.parquet")
        lschema = pa.schema([("exist_idx", pa.int32()), ("seg_key", pa.string()), ("dist_m", pa.float32())])
        pq.write_table(pa.Table.from_pylist(links, schema=lschema), out / f"{stem}.links.parquet")
    timing = {}
    if tm:
        prev = tm["start"]
        for stage, stamp in tm.items():
            if stage != "start":
                timing[stage] = round(stamp - prev, 2)
                prev = stamp
    return dict(tile=name, crowns=len(rows), links=len(links), secs=time.time() - t0, timing=timing,
                rows=None if write else rows, link_rows=None if write else links)


def _worker(args):
    name, out_dir, existing_path, params = args
    try:
        res = process_tile(name, out_dir, existing_path, params)
        res.pop("rows", None)
        res.pop("link_rows", None)
        return res
    except Exception:  # noqa: BLE001 - report and keep the run going
        return dict(tile=name, error=traceback.format_exc())


def main():
    import os
    for var in ("RAYON_NUM_THREADS", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS", "GDAL_NUM_THREADS"):
        os.environ[var] = "1"
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["run"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--existing")
    ap.add_argument("--tiles", nargs="*")
    ap.add_argument("--tiles-file")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--params", default="{}")
    ap.add_argument("--chunksize", type=int, default=12)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    params = json.loads(args.params)
    if args.tiles_file:
        names = [ln.strip() for ln in open(args.tiles_file) if ln.strip()]
    else:
        names = args.tiles or [m[0] for m in manifest()]
    known = {m[0] for m in manifest()}
    unknown = [nm for nm in names if nm not in known]
    if unknown:
        raise SystemExit(f"{len(unknown)} tile names are not in the manifest, e.g. {unknown[0][:80]!r}")
    todo = [nm for nm in names if not (out / f"{Path(nm).stem}.links.parquet").exists()]
    # neighbour order (serpentine rows), handed out in runs, so each worker's tile
    # cache already holds most of the next tile's halo
    rec = {m[0]: m for m in manifest()}
    rows = defaultdict(list)
    for nm in todo:
        rows[round(rec[nm][2])].append(nm)
    ordered = []
    for i, key in enumerate(sorted(rows, reverse=True)):
        row = sorted(rows[key], key=lambda nm: rec[nm][1])
        ordered.extend(row if i % 2 == 0 else row[::-1])
    print(f"{len(names)} tiles, {len(todo)} to do, {args.workers} workers, params {params}", flush=True)
    t0 = time.time()
    done = crowns = errors = 0
    log = (out / "run_log.jsonl").open("a")
    tasks = [(nm, str(out), args.existing, params) for nm in ordered]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for res in pool.map(_worker, tasks, chunksize=args.chunksize):
            log.write(json.dumps(res) + "\n")
            log.flush()
            done += 1
            if "error" in res:
                errors += 1
                print(f"ERROR {res['tile']}: {res['error'][-300:]}", flush=True)
            else:
                crowns += res["crowns"]
            if done % 50 == 0 or done == len(todo):
                el = time.time() - t0
                print(f"  {done}/{len(todo)} tiles, {crowns:,} crowns, {errors} errors, "
                      f"{el/60:.1f} min, eta {el/done*(len(todo)-done)/60:.0f} min", flush=True)
    log.close()


if __name__ == "__main__":
    sys.exit(main())
