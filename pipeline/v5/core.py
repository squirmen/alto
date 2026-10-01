#!/usr/bin/env python3
"""Crown segmentation lab: one parameterised algorithm, one honest scorer.

Evaluation notes that matter more than the algorithm:

* A detection landing inside a `tree_group` polygon is neither right nor wrong. The
  labeller marked those areas as several trees without separating them, so counting
  such a detection as a false positive would punish a model for being correct. They
  are ignored, the way crowd regions are in COCO.
* Sites are labelled exhaustively, so a detection outside every polygon really is a
  false positive.
* Scores are bootstrapped over sites, because 16 sites is a small sample and the
  spread between them is larger than most differences between parameter settings.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, asdict, field
from pathlib import Path

import numpy as np
import rasterio
from scipy import ndimage
from shapely.geometry import shape, Point, box as shbox
from rasterio.features import rasterize
from skimage.feature import peak_local_max
from skimage.segmentation import watershed

import os
# Benchmark kit: hand-labelled crowns and imagery used to calibrate segmentation (not distributed).
KIT = Path(os.environ.get("ALTO_BENCH_KIT", "/data/alto/bench_kit"))
LAB = Path("/data/alto/working/seg_lab")
TOL_M = 2.0


# --------------------------------------------------------------------------- params
@dataclass
class Params:
    """Everything the algorithm can vary. Defaults reproduce a v4-like watershed."""
    smooth_sigma_m: float = 0.25        # gaussian blur before seeding
    pitfill_size_m: float = 0.0         # grey-closing footprint, 0 = off
    min_height_m: float = 3.0           # canopy mask floor
    seed_min_height_m: float = 3.0      # a peak must be at least this tall
    win_a: float = 1.5                  # seed window radius = a + b*height, in metres
    win_b: float = 0.15
    win_min_m: float = 2.0
    win_max_m: float = 6.0
    min_crown_area_m2: float = 1.0
    edge_trim_frac: float = 0.0         # drop crown cells below frac * crown top
    merge_saddle_frac: float = 0.0      # merge two crowns when the dip between their
                                        # peaks stays above this share of the lower peak
    merge_max_area_m2: float = 400.0    # never merge beyond a plausible single crown
    # round 2: one smoothing width cannot serve a 3 m street tree and a 25 m pohutukawa,
    # so seed across an octave ladder and let height ordering resolve the overlaps
    n_scales: int = 1
    scale_step: float = 2.0
    # round 2: the imagery confirms that a low, weakly sampled blob is vegetation. It
    # cannot detect a tree on its own - lawn is green - so it only ever unlocks cells
    # that already carry some height. 0 disables the gate.
    # which channel the gate reads. Excess green from RGB cannot tell shaded leaf from
    # shadow; NDVI, from the near-infrared flown with the same photography, can.
    green_channel: str = "exg"
    green_exg_min: float = 0.0
    green_min_height_m: float = 2.0
    green_isolated_only: bool = True    # the gate may start a new crown, not fatten one
    # round 2: the watershed fills every masked cell, so a crown spills onto the road
    # and the lawn beside it. The picture knows where the leaves stop. 0 disables.
    crown_green_trim: float = 0.0
    # round 2: region growing as an alternative to filling every masked cell.
    # Dalponte & Coomes (2016): a cell joins a crown only while it stays within a
    # fraction of the seed and of the crown's running mean, inside a radius.
    dal_th_seed: float = 0.45
    dal_th_crown: float = 0.55
    dal_max_radius_m: float = 8.0
    # round 2: a crown's reach is bounded by its height. The watershed has no such
    # constraint and fills the canopy mask until it meets another crown, which is why
    # detections run 1.33x the labelled area. radius = a + b * height, 0 disables.
    radius_cap_a: float = 0.0
    radius_cap_b: float = 0.0
    # round 2: a human draws a crown as one smooth outline. A raster crown is ragged and
    # holed, and every hole is counted against it. Close and fill before scoring.
    crown_close_m: float = 0.0
    crown_fill_holes: bool = False
    # comparators, run through the same seeds and the same scorer so the only thing
    # that differs is the delineation rule itself
    silva_r_frac: float = 0.6           # Silva: crown radius as a share of tree height
    # round 3: the divide between two crowns is placed on the height model alone, at
    # 0.5 m, when the 0.059 m picture shows the gap between them plainly. Adding
    # greenness to the cost surface moves the divide without trimming anything: a hard
    # greenness trim was measured to eat shaded canopy, a soft cost only shifts a line.
    boundary_img_weight: float = 0.0
    # round 3: with the trim in place the delineation rule stopped mattering - Dalponte's
    # own thresholds became inert and it scored within 0.003 of a watershed. So the trim
    # is the thing that decides a crown, and a single global fraction of the crown top is
    # the crudest possible version of it.
    #   frac_top  cut below frac * this crown's tallest cell        (what round 2 used)
    #   drop_m    cut more than N metres below that cell
    #   quantile  cut the lowest share of the crown's own cells
    #   otsu      split the crown's height histogram at its natural break
    trim_mode: str = "frac_top"
    trim_drop_m: float = 6.0
    trim_quantile: float = 0.3
    method: str = "watershed"           # watershed | dalponte | silva | li

    def key(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)


# --------------------------------------------------------------------------- data
_LABEL_CACHE: dict | None = None


def labels_by_site() -> dict:
    global _LABEL_CACHE
    if _LABEL_CACHE is None:
        feats = json.loads((KIT / "data/exports/reference_crowns.geojson").read_text())["features"]
        out: dict[str, dict[str, list]] = {}
        for f in feats:
            p = f["properties"]
            g = shape(f["geometry"])
            d = out.setdefault(p["site_id"], {"tree": [], "tree_group": [], "other": []})
            if p["class"] == "tree":
                d["tree"].append({"geom": g, "stratum": p["stratum"],
                                  "cx": g.centroid.x, "cy": g.centroid.y})
            elif p["class"] == "tree_group":
                d["tree_group"].append(g)
            else:
                d["other"].append(g)
        _LABEL_CACHE = out
    return _LABEL_CACHE


import os
# Which fused stack to read. 0.25 m was rejected at 63-77% holes before gap
# filling existed; SEG_BASE lets that judgement be retested rather than inherited.
BASE = Path(os.environ.get("SEG_BASE", str(LAB / "base")))
_SITE_CACHE: dict[str, dict] = {}


def load_site(site_id: str) -> dict:
    """The fused stack, not the kit chip: chm.tif there includes buildings."""
    if site_id in _SITE_CACHE:
        return _SITE_CACHE[site_id]
    d = BASE / site_id
    info = json.loads((d / "info.json").read_text())
    layers = {}
    for name in ("chm_veg", "dsm_all", "bld", "nret", "exg", "ndvi", "dem"):
        fp = d / f"{name}.tif"
        if not fp.exists():
            layers[name] = np.zeros((1, 1), dtype="float32")
            continue
        with rasterio.open(fp) as r:
            layers[name] = np.nan_to_num(r.read(1).astype("float32"), nan=0.0,
                                         posinf=0.0, neginf=0.0)
            if name == "chm_veg":
                res = r.res[0]; x0, y1 = r.bounds.left, r.bounds.top
    site = {"site_id": site_id, "chm": layers["chm_veg"], "res": res, "x0": x0, "y1": y1,
            "stratum": info["stratum"], "split": info["split"],
            "site_bbox": info["bbox_site_2193"], "density": info["point_density_per_m2"],
            **layers}
    _SITE_CACHE[site_id] = site
    return site


# --------------------------------------------------------------------------- algorithm
def segment_labels(site: dict, p: Params) -> np.ndarray:
    """The labelled raster behind segment(), for work that needs the cells themselves."""
    return _segment_raster(site, p)


def segment(site: dict, p: Params) -> list[dict]:
    """Return crowns as dicts with a polygon-free footprint: centroid, area, bbox."""
    lab = _segment_raster(site, p)
    return _to_crowns(lab, _prepared(site, p), site, p) if lab is not None else []


def _prepared(site: dict, p: Params) -> np.ndarray:
    chm, res = site["chm"], site["res"]
    work = chm.copy()
    if p.pitfill_size_m > 0:
        work = ndimage.grey_closing(work, size=max(1, int(round(p.pitfill_size_m / res))))
    if p.smooth_sigma_m > 0:
        work = ndimage.gaussian_filter(work, p.smooth_sigma_m / res)
    return work


def _segment_raster(site: dict, p: Params):
    """Everything segment() does, stopping at the labelled raster."""
    chm, res = site["chm"], site["res"]
    work = _prepared(site, p)
    empty = np.zeros(chm.shape, dtype=np.int32)

    mask = work >= p.min_height_m
    seed_floor = p.seed_min_height_m
    if p.green_exg_min > 0:
        # A cell below the height floor joins the canopy only if the picture says it is
        # vegetation. Smoothed to the CHM's own scale so single green pixels cannot
        # promote a cell the point cloud never saw.
        chan = site.get(p.green_channel, site["exg"])
        green = ndimage.gaussian_filter(chan, max(0.5 / res, 0.5)) >= p.green_exg_min
        extra = green & (work >= p.green_min_height_m) & ~mask
        if p.green_isolated_only and extra.any():
            # low green ground touching a crown already found is skirt, not a new tree;
            # admitting it only grows that crown out over the lawn and costs IoU
            comp, n = ndimage.label(extra)
            if n:
                touching = set(np.unique(comp[ndimage.binary_dilation(mask) & extra]))
                touching.discard(0)
                if touching:
                    extra &= ~np.isin(comp, list(touching))
        mask = mask | extra
        seed_floor = min(seed_floor, p.green_min_height_m)
    if not mask.any():
        return empty

    # Seeds: local maxima whose exclusion radius grows with height, the standard
    # variable-window idea (Popescu & Wynne; Chen et al.), gathered across scales so a
    # small crown is not smoothed away by the width a large one needs.
    lbl = mask.astype(int)
    md = max(1, int(round(p.win_min_m / res)))
    cands = [peak_local_max(work, labels=lbl, min_distance=md,
                            threshold_abs=seed_floor, exclude_border=False)]
    for k in range(1, max(1, p.n_scales)):
        sig = (p.smooth_sigma_m if p.smooth_sigma_m > 0 else res) * (p.scale_step ** k) / res
        coarse = ndimage.gaussian_filter(work, sig)
        cands.append(peak_local_max(coarse, labels=lbl, min_distance=md,
                                    threshold_abs=seed_floor, exclude_border=False))
    cands = [c for c in cands if len(c)]
    if not cands:
        return empty
    cand = np.vstack(cands)
    cand = np.unique(cand, axis=0)
    heights = work[cand[:, 0], cand[:, 1]]
    order = np.argsort(-heights)
    cand, heights = cand[order], heights[order]
    keep = []
    taken = np.zeros((0, 2))
    for (r0, c0), h in zip(cand, heights):
        rad = min(max(p.win_a + p.win_b * float(h), p.win_min_m), p.win_max_m) / res
        if len(taken):
            d = np.hypot(taken[:, 0] - r0, taken[:, 1] - c0)
            if (d < rad).any():
                continue
        keep.append((r0, c0))
        taken = np.vstack([taken, [[r0, c0]]])
    if not keep:
        return empty

    markers = np.zeros(work.shape, dtype=np.int32)
    for i, (r0, c0) in enumerate(keep, start=1):
        markers[r0, c0] = i
    if p.method == "dalponte":
        lab = _grow_dalponte(markers, work, mask, res, p)
    elif p.method == "silva":
        lab = _grow_silva(markers, work, mask, res, p, keep)
    elif p.method == "li":
        lab = _grow_li(markers, work, mask, res, p, keep)
    else:
        cost = -work
        if p.boundary_img_weight > 0:
            g = ndimage.gaussian_filter(site.get(p.green_channel, site["exg"]),
                                        max(0.5 / res, 0.5))
            span = float(np.ptp(work[mask])) if mask.any() else 0.0
            gspan = float(np.ptp(g[mask])) if mask.any() else 0.0
            if span > 0 and gspan > 0:
                cost = -(work / span + p.boundary_img_weight * (g / gspan))
        lab = watershed(cost, markers, mask=mask)

    if p.edge_trim_frac > 0 or p.trim_mode != "frac_top":
        lab = _trim_crowns(lab, work, len(keep), p)

    if p.radius_cap_a > 0 or p.radius_cap_b > 0:
        lab = _cap_radius(lab, work, res, p)

    if p.crown_green_trim > 0:
        # cut cells the imagery says are not leaves, then keep each crown's largest
        # remaining piece so trimming cannot shatter one tree into several
        g = ndimage.gaussian_filter(site.get(p.green_channel, site["exg"]),
                                    max(0.5 / res, 0.5))
        lab[(lab > 0) & (g < p.crown_green_trim)] = 0
        for i in range(1, len(keep) + 1):
            sel = lab == i
            if not sel.any():
                continue
            parts, n = ndimage.label(sel)
            if n > 1:
                sizes = ndimage.sum(sel, parts, range(1, n + 1))
                lab[sel & (parts != int(np.argmax(sizes)) + 1)] = 0

    if p.merge_saddle_frac > 0:
        lab = _merge_shallow_saddles(lab, work, res, p)

    if p.crown_close_m > 0 or p.crown_fill_holes:
        lab = _tidy_crowns(lab, res, p)

    return lab


def _trim_crowns(lab, work, n, p: Params):
    """Cut the low outskirts of each crown. This is the step that decides the crown."""
    for i in range(1, n + 1):
        sel = lab == i
        if not sel.any():
            continue
        v = work[sel]
        top = float(v.max())
        if p.trim_mode == "drop_m":
            cut = top - p.trim_drop_m
        elif p.trim_mode == "quantile":
            cut = float(np.quantile(v, p.trim_quantile))
        elif p.trim_mode == "otsu":
            # the crown's own natural break: the threshold that best separates its
            # canopy from the skirt it has picked up, rather than a fixed fraction
            if v.size < 8 or float(np.ptp(v)) < 1e-6:
                cut = p.edge_trim_frac * top
            else:
                hist, edges = np.histogram(v, bins=32)
                w0 = np.cumsum(hist); w1 = w0[-1] - w0
                mids = (edges[:-1] + edges[1:]) / 2
                m0 = np.cumsum(hist * mids)
                tot = m0[-1]
                with np.errstate(invalid="ignore", divide="ignore"):
                    mu0 = m0 / np.maximum(w0, 1)
                    mu1 = (tot - m0) / np.maximum(w1, 1)
                    between = w0 * w1 * (mu0 - mu1) ** 2
                between[~np.isfinite(between)] = 0
                cut = float(mids[int(np.argmax(between))])
        else:
            cut = p.edge_trim_frac * top
        lab[sel & (work < cut)] = 0
    return lab


def _tidy_crowns(lab, res, p: Params):
    """Close and fill each crown, without letting one grow into its neighbour's cells."""
    n = int(lab.max())
    if n == 0:
        return lab
    out = lab.copy()
    k = max(1, int(round(p.crown_close_m / res))) if p.crown_close_m > 0 else 0
    st = ndimage.generate_binary_structure(2, 2)
    for i, sl in enumerate(ndimage.find_objects(lab, max_label=n), start=1):
        if sl is None:
            continue
        pad = (k + 1) if k else 1
        r0 = max(sl[0].start - pad, 0); r1 = min(sl[0].stop + pad, lab.shape[0])
        c0 = max(sl[1].start - pad, 0); c1 = min(sl[1].stop + pad, lab.shape[1])
        win = lab[r0:r1, c0:c1]
        sub = win == i
        if not sub.any():
            continue
        new = sub
        if k:
            new = ndimage.binary_closing(new, structure=st, iterations=k)
        if p.crown_fill_holes:
            new = ndimage.binary_fill_holes(new)
        # only claim cells no other crown already holds
        gain = new & ~sub & (win == 0)
        if gain.any():
            sec = out[r0:r1, c0:c1]
            sec[gain & (sec == 0)] = i
    return out


def _grow_silva(markers, work, mask, res, p: Params, seeds):
    """Silva et al. (2016): every canopy cell joins its nearest treetop, and a crown may
    not reach further than a fixed share of its tree's height."""
    n = len(seeds)
    if n == 0:
        return np.zeros_like(markers)
    rr = np.array([s[0] for s in seeds], dtype="float32")
    cc = np.array([s[1] for s in seeds], dtype="float32")
    hh = work[np.array([s[0] for s in seeds]), np.array([s[1] for s in seeds])]
    R, C = np.indices(work.shape)
    lab = np.zeros(work.shape, dtype=np.int32)
    bestd = np.full(work.shape, np.inf, dtype="float32")
    for i in range(n):
        d = np.hypot(R - rr[i], C - cc[i]) * res
        within = d <= p.silva_r_frac * hh[i]
        take = mask & within & (d < bestd)
        bestd[take] = d[take]
        lab[take] = i + 1
    return lab


def _grow_li(markers, work, mask, res, p: Params, seeds):
    """Li et al. (2012), applied to the height raster.

    The original takes points tallest first and assigns each one to a tree if it lies
    within a height-dependent spacing of that tree's *nearest already-assigned point*,
    starting a new tree otherwise. Measuring to the tree's apex instead — the obvious
    shortcut — shatters every wide crown, because its own outer cells fall outside the
    spacing. The neighbour rule is the algorithm.
    """
    rr, cc = np.nonzero(mask)
    if rr.size == 0:
        return np.zeros_like(markers)
    h = work[rr, cc]
    order = np.argsort(-h)
    rr, cc, h = rr[order], cc[order], h[order]
    lab = np.zeros(work.shape, dtype=np.int32)
    H, W = work.shape
    ntree = 0
    for r0, c0, hv in zip(rr, cc, h):
        thr = min(max(p.win_a + p.win_b * float(hv), p.win_min_m), p.win_max_m) / res
        k = int(np.ceil(thr))
        r1, r2 = max(r0 - k, 0), min(r0 + k + 1, H)
        c1, c2 = max(c0 - k, 0), min(c0 + k + 1, W)
        win = lab[r1:r2, c1:c2]
        nz = np.nonzero(win)
        if nz[0].size:
            d = np.hypot(nz[0] + r1 - r0, nz[1] + c1 - c0)
            j = int(np.argmin(d))
            if d[j] <= thr:
                lab[r0, c0] = win[nz[0][j], nz[1][j]]
                continue
        if hv < p.seed_min_height_m:
            continue
        ntree += 1
        lab[r0, c0] = ntree
    return lab


def _cap_radius(lab, work, res, p: Params):
    """Trim each crown to a plausible reach for a tree of its height.

    Crown radius scales with height across every published allometry; a 6 m street tree
    does not carry an 8 m crown. Measured here: detections run a median 1.33 times the
    labelled area, and 1.44 times for the small crowns, all of it spill into the gaps
    between trees.
    """
    n = int(lab.max())
    if n == 0:
        return lab
    out = lab.copy()
    R, C = np.indices(lab.shape)
    objs = ndimage.find_objects(lab, max_label=n)
    for i, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        sub = lab[sl] == i
        if not sub.any():
            continue
        wsub = work[sl]
        rr, cc = np.nonzero(sub)
        k = int(np.argmax(wsub[rr, cc]))
        h = float(wsub[rr[k], cc[k]])
        rad = (p.radius_cap_a + p.radius_cap_b * h) / res
        d = np.hypot(rr - rr[k], cc - cc[k])
        drop = d > rad
        if drop.any():
            gr, gc = rr[drop] + sl[0].start, cc[drop] + sl[1].start
            out[gr, gc] = 0
    return out


def _grow_dalponte(markers, work, mask, res, p: Params):
    """Region growing from seeds, after Dalponte & Coomes (2016).

    The watershed fills every masked cell, so a crown runs on until it meets another
    crown or the edge of the canopy. This stops instead at the tree: a cell joins only
    while it stays above a share of the seed height and of the crown's running mean,
    and within a plausible radius of the seed. Height must not rise as you move out,
    which is what separates a crown from the one behind it.
    """
    lab = markers.copy()
    n = int(markers.max())
    if n == 0:
        return lab
    rr, cc = np.nonzero(markers)
    order = markers[rr, cc]
    seed_h = np.zeros(n + 1, dtype="float32")
    seed_r = np.zeros(n + 1, dtype="float32")
    seed_c = np.zeros(n + 1, dtype="float32")
    for r0, c0, i in zip(rr, cc, order):
        seed_h[i] = work[r0, c0]; seed_r[i] = r0; seed_c[i] = c0
    tot = seed_h.copy()                       # running sum and count give the crown mean
    cnt = np.where(seed_h > 0, 1.0, 0.0).astype("float32")
    rad_cells = p.dal_max_radius_m / res
    R, C = np.indices(work.shape)

    for _ in range(int(np.ceil(rad_cells)) + 1):
        # candidate cells: unlabelled, inside the canopy, touching a labelled cell
        grown = ndimage.grey_dilation(lab, size=3)
        cand = (lab == 0) & mask & (grown > 0)
        if not cand.any():
            break
        idx = grown[cand]
        h = work[cand]
        mean = np.where(cnt[idx] > 0, tot[idx] / np.maximum(cnt[idx], 1), 0.0)
        d = np.hypot(R[cand] - seed_r[idx], C[cand] - seed_c[idx])
        ok = ((h > p.dal_th_seed * seed_h[idx]) &
              (h > p.dal_th_crown * mean) &
              (h <= seed_h[idx]) &                 # no climbing back up into another tree
              (d <= rad_cells))
        if not ok.any():
            break
        sel = np.zeros(work.shape, dtype=bool)
        sel[cand] = ok
        lab[sel] = grown[sel]
        np.add.at(tot, idx[ok], h[ok])
        np.add.at(cnt, idx[ok], 1.0)
    return lab


def _merge_shallow_saddles(lab, work, res, p: Params):
    """Join neighbouring crowns when the canopy between their peaks barely dips.

    Two trees standing side by side leave a real gap between their crowns; one
    spreading tree that the watershed has cut in half does not. The depth of the dip
    on the shared boundary is the physical difference between those cases.
    """
    n = int(lab.max())
    if n < 2:
        return lab
    peak = {i: work[lab == i].max() if (lab == i).any() else 0.0 for i in range(1, n + 1)}
    area = {i: int((lab == i).sum()) for i in range(1, n + 1)}
    cell = res * res

    # highest CHM value on each pair's shared boundary
    saddle: dict[tuple[int, int], float] = {}
    for shift in ((0, 1), (1, 0)):
        a = lab[:-shift[0] or None, :-shift[1] or None]
        b = lab[shift[0]:, shift[1]:]
        va = work[:-shift[0] or None, :-shift[1] or None]
        vb = work[shift[0]:, shift[1]:]
        m = (a > 0) & (b > 0) & (a != b)
        if not m.any():
            continue
        pa, pb = a[m], b[m]
        h = np.minimum(va[m], vb[m])
        for i, j, hh in zip(pa, pb, h):
            k = (int(min(i, j)), int(max(i, j)))
            if hh > saddle.get(k, 0.0):
                saddle[k] = float(hh)

    parent = list(range(n + 1))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x

    for (i, j), h in sorted(saddle.items(), key=lambda kv: -kv[1]):
        ri, rj = find(i), find(j)
        if ri == rj:
            continue
        lo = min(peak[i], peak[j])
        if lo <= 0:
            continue
        if h >= p.merge_saddle_frac * lo:
            if (area[ri] + area[rj]) * cell <= p.merge_max_area_m2:
                parent[rj] = ri
                area[ri] += area[rj]
                peak[ri] = max(peak[ri], peak[rj])
    out = lab.copy()
    for i in range(1, n + 1):
        r = find(i)
        if r != i:
            out[lab == i] = r
    return out


def _to_crowns(lab, work, site, p: Params) -> list[dict]:
    res, x0, y1 = site["res"], site["x0"], site["y1"]
    cell = res * res
    crowns = []
    for i in np.unique(lab):
        if i == 0:
            continue
        sel = lab == i
        a = int(sel.sum()) * cell
        if a < p.min_crown_area_m2:
            continue
        rr, cc = np.nonzero(sel)
        # crown position is its tallest point, which is the stem side of the canopy
        k = np.argmax(work[rr, cc])
        cy = y1 - (rr[k] + 0.5) * res
        cx = x0 + (cc[k] + 0.5) * res
        crowns.append({"cx": float(cx), "cy": float(cy), "area_m2": float(a),
                       "height_m": float(work[rr, cc].max()),
                       # flat cell indices: the crown's actual shape, for mask IoU
                       "cells": (rr.astype(np.int64) * lab.shape[1] + cc).astype(np.int64),
                       "bbox": shbox(x0 + cc.min() * res, y1 - (rr.max() + 1) * res,
                                     x0 + (cc.max() + 1) * res, y1 - rr.min() * res)})
    # the padding exists so edge crowns segment properly; only the site box is labelled
    sx0, sy0, sx1, sy1 = site["site_bbox"]
    return [c for c in crowns if sx0 <= c["cx"] <= sx1 and sy0 <= c["cy"] <= sy1]


# --------------------------------------------------------------------------- scoring
_MASK_CACHE: dict[str, list[np.ndarray]] = {}


def label_cells(site_id: str) -> list[np.ndarray]:
    """Each labelled crown as flat cell indices on the site's own grid.

    Round 1 compared bounding boxes. Interlocking crowns have boxes that overlap far
    more than the crowns do, so every IoU it reported was an upper bound. Rasterising
    the label onto the grid the detection already lives on makes the comparison exact
    to half a metre and costs one rasterisation per site, cached.
    """
    if site_id in _MASK_CACHE:
        return _MASK_CACHE[site_id]
    site = load_site(site_id)
    h, w = site["chm"].shape
    res, x0, y1 = site["res"], site["x0"], site["y1"]
    tr = rasterio.transform.from_origin(x0, y1, res, res)
    out = []
    for t in labels_by_site().get(site_id, {}).get("tree", []):
        m = rasterize([(t["geom"], 1)], out_shape=(h, w), transform=tr,
                      fill=0, all_touched=False, dtype="uint8").astype(bool)
        rr, cc = np.nonzero(m)
        out.append((rr.astype(np.int64) * w + cc).astype(np.int64))
    _MASK_CACHE[site_id] = out
    return out


def _mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    if a.size == 0 or b.size == 0:
        return 0.0
    inter = np.intersect1d(a, b, assume_unique=False).size
    return inter / (a.size + b.size - inter)


def score_site(site_id: str, crowns: list[dict]) -> dict:
    """Count detections inside each labelled crown.

    Exactly one is right. Two or more is the over-segmentation this work exists to
    fix. Zero is a miss. This needs no exhaustive labelling, which matters because no
    site here labels more than 62% of its canopy, so precision over the whole site is
    not measurable and an objective built on it would reward missing real trees.
    """
    lab = labels_by_site().get(site_id, {"tree": [], "tree_group": [], "other": []})
    cells = label_cells(site_id)
    rows, ious = [], []
    for t, tcells in zip(lab["tree"], cells):
        poly = t["geom"]
        inside = [c for c in crowns if poly.contains(Point(c["cx"], c["cy"]))]
        best = 0.0
        if inside:
            # the union of the detections inside: a crown cut in two should be judged
            # on the ground it actually covers, not on its better half
            det = np.unique(np.concatenate([c["cells"] for c in inside]))
            best = _mask_iou(tcells, det)
            ious.append(best)
        rows.append({"stratum": t["stratum"], "n_inside": len(inside), "iou": best,
                     "area_m2": poly.area})
    # detections landing on something a human marked as not a tree
    fp_hard = sum(1 for c in crowns
                  if any(g.contains(Point(c["cx"], c["cy"])) for g in lab["other"]))
    return {"site_id": site_id, "labels": rows, "ious": ious,
            "n_detections": len(crowns), "fp_hard_negative": fp_hard}


def aggregate(per_site: list[dict], n_boot: int = 2000, seed: int = 42) -> dict:
    rows = [r for s in per_site for r in s["labels"]]
    n = len(rows)
    if n == 0:
        return {"objective": 0.0}
    inside = np.array([r["n_inside"] for r in rows])
    found = inside >= 1
    singleton = inside == 1
    split = inside >= 2
    ious = [v for s in per_site for v in s["ious"]]
    med_iou = float(np.median(ious)) if ious else 0.0
    s_rate = float(singleton.mean())
    # harmonic mean: a method has to both find the tree once and outline it
    obj = 0.0 if (s_rate + med_iou) == 0 else 2 * s_rate * med_iou / (s_rate + med_iou)

    rng = np.random.default_rng(seed)
    idx = np.arange(len(per_site))
    boots = []
    for _ in range(n_boot):
        pick = rng.choice(idx, size=len(idx), replace=True)
        rr = [r for i in pick for r in per_site[i]["labels"]]
        ii = [v for i in pick for v in per_site[i]["ious"]]
        if not rr:
            continue
        s_ = np.mean([r["n_inside"] == 1 for r in rr])
        i_ = float(np.median(ii)) if ii else 0.0
        boots.append(0.0 if (s_ + i_) == 0 else 2 * s_ * i_ / (s_ + i_))
    boots = np.array(boots) if boots else np.array([0.0])

    by_str: dict[str, list[int]] = {}
    for r in rows:
        d = by_str.setdefault(r["stratum"], [0, 0])
        d[1] += 1
        if r["n_inside"] == 1:
            d[0] += 1
    by_size = {}
    for lo, hi in [(0, 20), (20, 50), (50, 100), (100, 1e9)]:
        sel = [r for r in rows if lo <= r["area_m2"] < hi]
        if sel:
            by_size[f"{lo}-{int(hi) if hi < 1e9 else 'inf'}"] = {
                "n": len(sel),
                "singleton": round(float(np.mean([r["n_inside"] == 1 for r in sel])), 3),
                "split": round(float(np.mean([r["n_inside"] >= 2 for r in sel])), 3)}
    nd = sum(s["n_detections"] for s in per_site)
    return {"objective": round(obj, 4),
            "objective_ci95": [round(float(np.percentile(boots, 2.5)), 4),
                               round(float(np.percentile(boots, 97.5)), 4)],
            "singleton_rate": round(s_rate, 4),
            "recall": round(float(found.mean()), 4),
            "split_rate": round(float(split.mean()), 4),
            "median_iou": round(med_iou, 4),
            "n_labels": n, "n_detections": nd,
            "det_per_label": round(nd / n, 2),
            "fp_hard_negative": sum(s["fp_hard_negative"] for s in per_site),
            "singleton_by_stratum": {k: round(v[0] / max(v[1], 1), 3) for k, v in sorted(by_str.items())},
            "min_stratum_singleton": round(min((v[0] / max(v[1], 1) for v in by_str.values()), default=0), 3),
            "by_crown_size": by_size}


def evaluate(p: Params, sites: list[str]) -> dict:
    per_site = []
    for sid in sites:
        site = load_site(sid)
        per_site.append(score_site(sid, segment(site, p)))
    out = aggregate(per_site)
    out["per_site"] = [{k: v for k, v in s.items() if k not in ("ious", "strata", "matched_strata")}
                       for s in per_site]
    return out
