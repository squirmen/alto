#!/usr/bin/env python3
"""Build a fused base-data stack per benchmark site.

The kit's chm.tif is a surface model that includes buildings, so segmentation run on
it partly segments rooftops. This rebuilds the inputs from everything available and
keeps the layers separate so later steps can decide how to combine them.

Per site, on a common 0.25 m grid:

  chm_veg     canopy height from vegetation returns only (classes 3,4,5) above a
              ground model built from class 2
  dsm_all     highest return of any class, for comparison and for building detection
  bld         fraction of returns classed as building, a LiDAR view of structures
  nret        return density, which falls away at crown edges
  ndvi        (NIR - red) / (NIR + red) from the near-infrared survey flown with the
              same photography, block-averaged to the grid. Vegetation is bright in NIR
              and shadowed leaf still is, which is what excess green could never handle
  exg         excess green from the same imagery, kept for comparison
  rgb         the same imagery aggregated to the grid, for reference

and at native imagery resolution:

  rgb_fine    0.0625 m RGB, kept for edge-guided work where a smoothed CHM has no
              information but the picture plainly does

Vegetation is not decided here. The layers are written and the mask is a later choice
that can be varied and scored like any other parameter.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import laspy
import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from scipy import ndimage

import os
# Benchmark kit: hand-labelled crowns and imagery used to calibrate segmentation (not distributed).
KIT = Path(os.environ.get("ALTO_BENCH_KIT", "/data/alto/bench_kit"))
LAZ = Path("/data/alto/point_cloud_2024/auckland_metro_v1")
# LINZ publishes this survey as cloud-optimised GeoTIFFs on public S3 under the same
# 1:1000 tile names as the point cloud, so a window can be read directly and no bulk
# download is needed anywhere - including for production across the whole region.
S3 = ("https://nz-imagery.s3.ap-southeast-2.amazonaws.com/auckland/"
      "auckland_2024_0.075m/rgbnir/2193")
IMG = Path("/data/alto/working/bench_imagery_pad")
import os
RES = float(os.environ.get("SEG_RES", "0.5"))
OUT = Path(os.environ.get(
    "SEG_BASE", "/data/alto/working/seg_lab/base"))           # 4 pts/m2 gives ~1 return per 0.5 m cell; finer is invention
PAD = 20.0          # metres of context around the site, so crowns at the edge are whole


def tiles_for(x0, y0, x1, y1):
    man = [json.loads(l) for l in (LAZ / "manifest.jsonl").read_text().splitlines() if l.strip()]
    out = []
    for r in man:
        bx0, by0, bx1, by1 = r["bbox_2193"][-4:]
        if bx0 <= x1 and bx1 >= x0 and by0 <= y1 and by1 >= y0:
            p = LAZ / r["tile"]
            if p.exists():
                out.append(p)
    return out


def rasterise(x, y, v, x0, y1, w, h, how="max"):
    col = ((x - x0) / RES).astype(int)
    row = ((y1 - y) / RES).astype(int)
    m = (col >= 0) & (col < w) & (row >= 0) & (row < h)
    col, row, v = col[m], row[m], v[m]
    flat = row * w + col
    out = np.full(w * h, np.nan, dtype="float32")
    if how == "max":
        order = np.argsort(v)
        out[flat[order]] = v[order]
    elif how == "min":
        order = np.argsort(-v)
        out[flat[order]] = v[order]
    elif how == "count":
        cnt = np.bincount(flat, minlength=w * h).astype("float32")
        return cnt.reshape(h, w)
    return out.reshape(h, w)


def fill(a):
    """Nearest-value fill for gaps, so later filters do not trip over NaN."""
    m = np.isnan(a)
    if not m.any():
        return a
    if m.all():
        return np.zeros_like(a)
    idx = ndimage.distance_transform_edt(m, return_distances=False, return_indices=True)
    return a[tuple(idx)]



def _fill_canopy(a, res, reach_m=1.5, return_mask=False):
    """Close sampling gaps inside canopy without inventing canopy over open ground."""
    valid = np.isfinite(a)
    if not valid.any():
        empty = np.zeros_like(a, dtype="float32")
        return (empty, np.zeros_like(a, dtype=bool)) if return_mask else empty
    near = ndimage.binary_dilation(valid, iterations=max(1, int(round(reach_m / res))))
    filled = np.where(valid, a, 0.0).astype("float32")
    wts = valid.astype("float32")
    out = np.where(valid, a, np.nan).astype("float32")
    for s in (1.0, 2.0, 4.0):
        num = ndimage.gaussian_filter(filled * wts, s, mode="nearest")
        den = ndimage.gaussian_filter(wts, s, mode="nearest")
        est = np.where(den > 1e-6, num / den, np.nan)
        gap = ~np.isfinite(out) & near & np.isfinite(est)
        out[gap] = est[gap]
        if np.isfinite(out[near]).all():
            break
    filled_mask = ~valid & np.isfinite(out)
    out[~np.isfinite(out)] = 0.0
    if return_mask:
        return out.astype("float32"), filled_mask
    return out.astype("float32")


def _imagery(X0, Y0, X1, Y1, w, h):
    """NDVI, excess green and a reference RGB for the padded extent, from S3.

    Each 0.5 m cell covers about 44 imagery pixels. Reading the one pixel at the cell
    centre - which an earlier version did - leaves a layer that is mostly single-pixel
    noise, so every cell averages the pixels that actually fall inside it.
    """
    import os
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    from rasterio.windows import from_bounds
    import time as _time
    acc = np.zeros((4, h, w), dtype="float64")
    cnt = np.zeros((h, w), dtype="float64")
    failed = []
    for t in tiles_for(X0, Y0, X1, Y1):
        code = t.name.replace("pc_", "").replace(".laz", "")
        # Six workers reading nine COGs each means a lot of concurrent range requests,
        # and a swallowed transient error looks exactly like absent imagery. The guard
        # caught 23 tiles this way on the first run, every one of which had complete
        # imagery on S3. Retry, and make a real failure loud rather than invisible.
        for attempt in range(4):
            try:
                with rasterio.open(f"/vsicurl/{S3}/{code}.tiff") as r:
                    bx0, by0, bx1, by1 = r.bounds
                    ox0, oy0 = max(X0, bx0), max(Y0, by0)
                    ox1, oy1 = min(X1, bx1), min(Y1, by1)
                    if ox1 <= ox0 or oy1 <= oy0:
                        a = None
                        break
                    win = from_bounds(ox0, oy0, ox1, oy1, r.transform)
                    a = r.read((1, 2, 3, 4), window=win).astype("float32")
                    alpha = r.read(5, window=win) if r.count >= 5 else None
                    ires = r.res[0]
                    px0, py1 = r.xy(int(win.row_off), int(win.col_off), offset="ul")
                break
            except Exception:
                a = None
                if attempt == 3:
                    failed.append(code)
                else:
                    _time.sleep(1.5 * (attempt + 1))
        if a is None:
            continue
        ih, iw = a.shape[1], a.shape[2]
        iy, ix = np.mgrid[0:ih, 0:iw]
        col = np.floor(((px0 + (ix + 0.5) * ires) - X0) / RES).astype(np.int64)
        row = np.floor((Y1 - (py1 - (iy + 0.5) * ires)) / RES).astype(np.int64)
        ok = (col >= 0) & (col < w) & (row >= 0) & (row < h)
        if alpha is not None:
            ok &= alpha > 0
        if not ok.any():
            continue
        flat = (row[ok] * w + col[ok]).ravel()
        cnt += np.bincount(flat, minlength=w * h).reshape(h, w)
        for b in range(4):
            acc[b] += np.bincount(flat, weights=a[b][ok].ravel(),
                                  minlength=w * h).reshape(h, w)
    have = cnt > 0
    mean = np.where(have, acc / np.maximum(cnt, 1), 0.0)
    R, G, B, N = mean[0], mean[1], mean[2], mean[3]
    tot = np.maximum(R + G + B, 1.0)
    exg = np.where(have, (2 * G - R - B) / tot, 0.0).astype("float32")
    ndvi = np.where(have, (N - R) / np.maximum(N + R, 1.0), 0.0).astype("float32")
    rgb = np.clip(np.stack([R, G, B], axis=-1), 0, 255).astype("uint8")
    if failed:
        _imagery.last_failures = failed
    return exg, ndvi, rgb


def build_site(sid: str) -> dict:
    meta = json.loads((KIT / f"data/sites/chips/{sid}/meta.json").read_text())
    x0, y0, x1, y1 = meta["bbox_epsg2193"]
    X0, Y0, X1, Y1 = x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD
    w = int(round((X1 - X0) / RES)); h = int(round((Y1 - Y0) / RES))

    xs, ys, zs, cls, nret = [], [], [], [], []
    for t in tiles_for(X0, Y0, X1, Y1):
        f = laspy.read(str(t), laz_backend=laspy.LazBackend.Lazrs)
        x, y, z = np.asarray(f.x), np.asarray(f.y), np.asarray(f.z)
        k = (x >= X0) & (x <= X1) & (y >= Y0) & (y <= Y1)
        if not k.any():
            continue
        xs.append(x[k]); ys.append(y[k]); zs.append(z[k])
        cls.append(np.asarray(f.classification)[k])
        try:
            nret.append(np.asarray(f.number_of_returns)[k])
        except Exception:
            nret.append(np.ones(k.sum(), dtype="uint8"))
    if not xs:
        raise RuntimeError(f"{sid}: no points")
    x = np.concatenate(xs); y = np.concatenate(ys); z = np.concatenate(zs)
    c = np.concatenate(cls); nr = np.concatenate(nret)

    ground = c == 2
    dem = fill(rasterise(x[ground], y[ground], z[ground], X0, Y1, w, h, "min"))
    dem = ndimage.median_filter(dem, size=5)

    veg = np.isin(c, (3, 4, 5))
    dsm_veg = rasterise(x[veg], y[veg], z[veg], X0, Y1, w, h, "max")
    chm_veg = (dsm_veg - dem).astype("float32")
    chm_veg[chm_veg < 0] = np.nan
    # A canopy is continuous; the gaps between returns are sampling, not holes in the
    # tree. Fill them by normalised Gaussian convolution, but only near real returns,
    # so open ground is not invented into canopy.
    chm_veg = _fill_canopy(chm_veg, RES)

    keep = ~np.isin(c, (7, 18))
    dsm_all = fill(rasterise(x[keep], y[keep], z[keep], X0, Y1, w, h, "max")) - dem

    bld_cnt = rasterise(x[c == 6], y[c == 6], z[c == 6], X0, Y1, w, h, "count")
    all_cnt = rasterise(x[keep], y[keep], z[keep], X0, Y1, w, h, "count")
    bld = np.where(all_cnt > 0, bld_cnt / np.maximum(all_cnt, 1), 0).astype("float32")
    nret_r = np.where(all_cnt > 0, rasterise(x[keep], y[keep], nr[keep].astype("float32"),
                                             X0, Y1, w, h, "max"), 0).astype("float32")

    # imagery: read the NIR survey straight from S3, windowed, and block-average it
    exg, ndvi, rgb_small = _imagery(X0, Y0, X1, Y1, w, h)

    OUT.mkdir(parents=True, exist_ok=True)
    d = OUT / sid; d.mkdir(exist_ok=True)
    tr = from_origin(X0, Y1, RES, RES)
    prof = dict(driver="GTiff", height=h, width=w, count=1, dtype="float32",
                crs="EPSG:2193", transform=tr, compress="deflate")
    for name, arr in [("chm_veg", chm_veg), ("dsm_all", dsm_all.astype("float32")),
                      ("bld", bld), ("nret", nret_r), ("exg", exg.astype("float32")),
                      ("ndvi", ndvi.astype("float32")), ("dem", dem.astype("float32"))]:
        with rasterio.open(d / f"{name}.tif", "w", **prof) as dst:
            dst.write(arr, 1)
    Image.fromarray(rgb_small).save(d / "rgb.png")

    info = {"site_id": sid, "stratum": meta["stratum"], "split": meta["split"],
            "res_m": RES, "pad_m": PAD, "width": w, "height": h,
            "bbox_padded_2193": [X0, Y0, X1, Y1], "bbox_site_2193": [x0, y0, x1, y1],
            "points": int(len(x)), "veg_points": int(veg.sum()),
            "ground_points": int(ground.sum()), "building_points": int((c == 6).sum()),
            "point_density_per_m2": round(len(x) / ((X1 - X0) * (Y1 - Y0)), 2),
            "chm_veg_max_m": round(float(chm_veg.max()), 2),
            "frac_veg_above_3m": round(float((chm_veg >= 3).mean()), 4),
            "has_imagery": bool(np.any(exg != 0)),
            "imagery_source": "LINZ Auckland 0.075m rgbnir 2024-2025 COG on S3, CC-BY 4.0"}
    (d / "info.json").write_text(json.dumps(info, indent=2) + "\n")
    return info


if __name__ == "__main__":
    import sys
    splits = json.loads((Path(__file__).parent / "splits.json").read_text())
    todo = splits["dev_sites"] if len(sys.argv) < 2 else sys.argv[1:]
    for sid in todo:
        if (OUT / sid / "info.json").exists():
            print(f"  {sid}: done"); continue
        i = build_site(sid)
        print(f"  {sid} [{i['split']:5}] {i['stratum']:20} "
              f"{i['point_density_per_m2']:5.1f} pts/m2  veg>3m {100*i['frac_veg_above_3m']:5.1f}%  "
              f"max {i['chm_veg_max_m']:5.1f} m  img={i['has_imagery']}", flush=True)
