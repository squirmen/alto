#!/usr/bin/env python3
"""Run the shipping configuration over the point cloud, tile by tile.

Each tile is segmented with a 20 m pad taken from its neighbours, so a crown on the
boundary is resolved from whole canopy rather than cut off. A crown is then kept only by
the tile its tallest cell falls in, which assigns every crown exactly once with no
deduplication pass and no seams.

The configuration seeds directly from the height model only above 15 m and finds
everything shorter through the NDVI gate, so imagery is not optional here: a tile whose
imagery failed to read would silently return only the largest trees. Coverage is measured
per tile and a tile below the threshold is recorded as failed rather than published.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

import numpy as np

LAB = Path("/data/alto/working/seg_lab")
sys.path.insert(0, str(LAB))
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")

import build_base   # noqa: E402
import core         # noqa: E402

METHOD_ID = "pointcloud_v5_ndvi_watershed"
MANIFEST = Path("/data/alto/point_cloud_2024/auckland_metro_v1/manifest.jsonl")
MIN_IMAGERY = 0.60          # a tile with less usable imagery than this is not published

# Nothing is discarded; everything detected is written with a class, and what belongs in
# the published tree layer is a decision downstream rather than one baked in here.
#
#   tree         >= 3 m. A tree in the reference labels starts about there: of 136
#                labelled trees only 7 are under 3 m and 1 under 2 m, 10th percentile
#                3.8 m. This is the band the whole benchmark validates.
#   low_canopy   2-3 m. ALTO's existing convention for green low canopy - young trees,
#                large shrubs, things a reviewer should look at - carried as candidates,
#                excluded from trees, crowns, context and valuation until accepted.
#   sub_canopy   under 2 m. Median crown 4.5 m2: hedges, flax, garden beds. Kept so the
#                count is visible and nothing vanishes silently, published nowhere.
#
# This matters because the objective has no precision term - it cannot see a detection
# that misses every label - so the search was free to admit vegetation from 0.5 m through
# the NDVI gate, and across real tiles 30% of what it finds sits under 3 m.
TREE_MIN_HEIGHT_M = 3.0
LOW_CANOPY_MIN_HEIGHT_M = 2.0


def canopy_class(height_m: float) -> str:
    if height_m >= TREE_MIN_HEIGHT_M:
        return "tree"
    if height_m >= LOW_CANOPY_MIN_HEIGHT_M:
        return "low_canopy"
    return "sub_canopy"


def shipping_params() -> core.Params:
    return core.Params(**json.loads((LAB / "shipping_config.json").read_text()))


def tile_rows():
    return [json.loads(l) for l in MANIFEST.read_text().splitlines() if l.strip()]


def crown_attributes(lab, site, p: core.Params, x0, y0, x1, y1):
    """Every field v4 publishes, per crown, from the label raster and the points.

    v4's tree_crown_v4 carries 29 columns and the map renders `crown_wkb`, so centroids
    alone cannot rebuild the release. Shape comes from the labelled cells, structure from
    the returns inside them, colour from the imagery.
    """
    from rasterio.features import shapes
    from rasterio.transform import from_origin
    from shapely.geometry import shape as shp
    from shapely import wkb as shapely_wkb
    from scipy import ndimage

    res, X0, Y1 = site["res"], site["x0"], site["y1"]
    work = core._prepared(site, p)
    H, W = lab.shape
    tr = from_origin(X0, Y1, res, res)
    cell = res * res

    # polygons, one per label, from the raster itself so they tile without gaps
    polys = {}
    for geom, val in shapes(lab.astype("int32"), mask=lab > 0, transform=tr, connectivity=8):
        i = int(val)
        g = shp(geom)
        if i not in polys or g.area > polys[i].area:
            polys[i] = g

    # points to cells, then to crowns, so per-crown return statistics are one pass
    P = site["pts"]
    col = ((P["x"] - X0) / res).astype(np.int64)
    rowi = ((Y1 - P["y"]) / res).astype(np.int64)
    ok = (col >= 0) & (col < W) & (rowi >= 0) & (rowi < H)
    lid = np.zeros(len(P["x"]), dtype=np.int64)
    lid[ok] = lab[rowi[ok], col[ok]]
    n = int(lab.max())
    bc = lambda w, m: (np.bincount(lid[m], weights=w[m], minlength=n + 1)
                       if m.any() else np.zeros(n + 1))
    cnt = lambda m: np.bincount(lid[m], minlength=n + 1) if m.any() else np.zeros(n + 1)
    inc = lid > 0
    veg = inc & np.isin(P["cls"], (3, 4, 5))
    n_veg = cnt(veg); n_bld = cnt(inc & (P["cls"] == 6)); n_gnd = cnt(inc & (P["cls"] == 2))
    n_unc = cnt(inc & (P["cls"] == 1)); n_brg = cnt(inc & (P["cls"] == 17))
    n_wat = cnt(inc & (P["cls"] == 9))
    veg_h = bc(P["agl"], veg)
    multi = cnt(inc & (P["nret"] > 1)); allret = cnt(inc)
    fin = inc & np.isfinite(P["intensity"])
    inten = bc(np.nan_to_num(P["intensity"]), fin); inten_n = cnt(fin)

    gap = site["gap_filled"]
    out = []
    for i in range(1, n + 1):
        g = polys.get(i)
        if g is None or g.is_empty:
            continue
        sel = lab == i
        k = int(sel.sum())
        if k == 0:
            continue
        area = k * cell
        if area < p.min_crown_area_m2:
            continue
        rr, cc = np.nonzero(sel)
        j = int(np.argmax(work[rr, cc]))
        cx = X0 + (cc[j] + 0.5) * res
        cy = Y1 - (rr[j] + 0.5) * res
        if not (x0 <= cx < x1 and y0 <= cy < y1):
            continue                                   # belongs to a neighbouring tile
        # shape: second moments give the axis ratio, the bbox gives how fully it fills
        rf = rr.astype("float64"); cf = cc.astype("float64")
        cov = np.cov(np.vstack([rf, cf])) if k > 2 else np.eye(2)
        ev = np.sort(np.linalg.eigvalsh(cov))[::-1]
        elong = float(np.sqrt(max(ev[0], 1e-9) / max(ev[1], 1e-9))) if ev[1] > 0 else 1.0
        bbox_cells = (rr.max() - rr.min() + 1) * (cc.max() - cc.min() + 1)
        hgt = float(work[rr, cc].max())
        out.append({
            "x_2193": round(float(cx), 2), "y_2193": round(float(cy), 2),
            "height_m": round(hgt, 2),
            "crown_area_m2": round(float(area), 2),
            "crown_diameter_m": round(float(2 * np.sqrt(area / np.pi)), 2),
            "mean_veg_height_m": round(float(veg_h[i] / n_veg[i]), 2) if n_veg[i] else None,
            "n_veg_returns": int(n_veg[i]), "n_building_returns": int(n_bld[i]),
            "n_ground_returns": int(n_gnd[i]), "n_unclassified_returns": int(n_unc[i]),
            "n_bridge_returns": int(n_brg[i]), "n_water_returns": int(n_wat[i]),
            "multi_return_fraction": round(float(multi[i] / allret[i]), 4) if allret[i] else None,
            "intensity_mean": round(float(inten[i] / inten_n[i]), 2) if inten_n[i] else None,
            "aerial_greenness": round(float(site["exg"][sel].mean()), 4),
            "ndvi_mean": round(float(site["ndvi"][sel].mean()), 4),
            "elongation": round(elong, 3),
            "bbox_fill": round(float(k / max(bbox_cells, 1)), 3),
            "gap_filled_fraction": round(float(gap[sel].mean()), 4),
            "crown_wkb": shapely_wkb.dumps(g),
            "canopy_class": canopy_class(hgt),
        })
    return out


def run_tile(row: dict, p: core.Params, out_dir: Path) -> dict:
    """Segment one tile and write its crowns. Returns a status record."""
    name = Path(row["tile"]).stem
    dest = out_dir / f"{name}.parquet"
    if dest.exists():
        return {"tile": name, "status": "done", "cached": True}
    x0, y0, x1, y1 = row["bbox_2193"][-4:]
    t0 = time.time()

    # build_base works from a site bbox; give it this tile's, with its own padding
    site = build_base.build_site_bbox(name, x0, y0, x1, y1) if hasattr(build_base, "build_site_bbox") \
        else _stack(name, x0, y0, x1, y1)
    if site.get("imagery_fraction", 0.0) < MIN_IMAGERY:
        return {"tile": name, "status": "no_imagery",
                "imagery_fraction": round(site.get("imagery_fraction", 0.0), 3),
                "seconds": round(time.time() - t0, 1)}

    lab = core.segment_labels(site, p)
    # a crown belongs to the tile holding its tallest cell, so the pad never double-counts
    kept = crown_attributes(lab, site, p, x0, y0, x1, y1)
    for c in kept:
        c["tile"] = name
        c["method_id"] = METHOD_ID
        c["created_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    import pandas as pd
    pd.DataFrame(kept).to_parquet(dest, index=False)
    from collections import Counter
    by_class = Counter(canopy_class(c["height_m"]) for c in kept)
    return {"tile": name, "status": "done", "crowns": len(kept),
            "by_class": dict(by_class),
            "imagery_fraction": round(site["imagery_fraction"], 3),
            "points_per_m2": row.get("points_per_m2"),
            "seconds": round(time.time() - t0, 1)}


def _stack(name, x0, y0, x1, y1) -> dict:
    """The fused stack for one tile, plus the points themselves.

    v4 publishes per-crown return counts, intensity and shape, so the points cannot be
    thrown away after rasterising the way the benchmark stacks did.
    """
    import laspy
    import rasterio
    from scipy import ndimage
    RES, PAD = build_base.RES, build_base.PAD
    X0, Y0, X1, Y1 = x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD
    w = int(round((X1 - X0) / RES)); h = int(round((Y1 - Y0) / RES))

    xs, ys, zs, cls, nret, inten = [], [], [], [], [], []
    for t in build_base.tiles_for(X0, Y0, X1, Y1):
        f = laspy.read(str(t), laz_backend=laspy.LazBackend.Lazrs)
        X, Y, Z = np.asarray(f.x), np.asarray(f.y), np.asarray(f.z)
        k = (X >= X0) & (X <= X1) & (Y >= Y0) & (Y <= Y1)
        if not k.any():
            continue
        xs.append(X[k]); ys.append(Y[k]); zs.append(Z[k])
        cls.append(np.asarray(f.classification)[k])
        try:
            nret.append(np.asarray(f.number_of_returns)[k])
        except Exception:
            nret.append(np.ones(int(k.sum()), dtype="uint8"))
        try:
            inten.append(np.asarray(f.intensity)[k].astype("float32"))
        except Exception:
            inten.append(np.full(int(k.sum()), np.nan, dtype="float32"))
    if not xs:
        raise RuntimeError("no points")
    X = np.concatenate(xs); Y = np.concatenate(ys); Z = np.concatenate(zs)
    C = np.concatenate(cls); NR = np.concatenate(nret); IN = np.concatenate(inten)

    ground = C == 2
    dem = build_base.fill(build_base.rasterise(X[ground], Y[ground], Z[ground], X0, Y1, w, h, "min"))
    dem = ndimage.median_filter(dem, size=5)
    veg = np.isin(C, (3, 4, 5))
    chm = (build_base.rasterise(X[veg], Y[veg], Z[veg], X0, Y1, w, h, "max") - dem).astype("float32")
    chm[chm < 0] = np.nan
    chm, gap_filled = build_base._fill_canopy(chm, RES, return_mask=True)
    keep = ~np.isin(C, (7, 18))
    dsm = build_base.fill(build_base.rasterise(X[keep], Y[keep], Z[keep], X0, Y1, w, h, "max")) - dem
    bcnt = build_base.rasterise(X[C == 6], Y[C == 6], Z[C == 6], X0, Y1, w, h, "count")
    acnt = build_base.rasterise(X[keep], Y[keep], Z[keep], X0, Y1, w, h, "count")
    bld = np.where(acnt > 0, bcnt / np.maximum(acnt, 1), 0).astype("float32")
    nret_r = np.where(acnt > 0, build_base.rasterise(X[keep], Y[keep], NR[keep].astype("float32"),
                                                     X0, Y1, w, h, "max"), 0).astype("float32")
    exg, ndvi, _rgb = build_base._imagery(X0, Y0, X1, Y1, w, h)
    return {"site_id": name, "chm": chm, "res": RES, "x0": X0, "y1": Y1,
            "gap_filled": gap_filled,
            "pts": {"x": X, "y": Y, "z": Z, "cls": C, "nret": NR, "intensity": IN,
                    "agl": Z - dem[np.clip(((Y1 - Y) / RES).astype(int), 0, h - 1),
                                    np.clip(((X - X0) / RES).astype(int), 0, w - 1)]},
            "dsm_all": dsm.astype("float32"), "bld": bld, "nret": nret_r,
            "exg": exg, "ndvi": ndvi, "dem": dem.astype("float32"),
            "site_bbox": [X0, Y0, X1, Y1],
            "imagery_fraction": float(np.mean(ndvi != 0))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/data/alto/working/crowns_v5")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many tiles")
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--shards", type=int, default=1)
    ap.add_argument("--tiles", nargs="*", help="explicit tile stems, for a pilot")
    a = ap.parse_args()

    out = Path(a.out); (out / "crowns").mkdir(parents=True, exist_ok=True)
    rows = tile_rows()
    if a.tiles:
        want = set(a.tiles)
        rows = [r for r in rows if Path(r["tile"]).stem in want]
    else:
        rows = [r for i, r in enumerate(rows) if i % a.shards == a.shard]
    if a.limit:
        rows = rows[:a.limit]

    p = shipping_params()
    log = out / f"status_{a.shard}.jsonl"
    done = 0
    for r in rows:
        try:
            rec = run_tile(r, p, out / "crowns")
        except Exception as e:
            rec = {"tile": Path(r["tile"]).stem, "status": "error",
                   "error": f"{type(e).__name__}: {e}",
                   "trace": traceback.format_exc()[-400:]}
        with open(log, "a") as fh:
            fh.write(json.dumps(rec) + "\n")
        done += 1
        print(f"[{done}/{len(rows)}] {rec['tile']}: {rec['status']} "
              f"{rec.get('crowns','')} {rec.get('seconds','')}s", flush=True)


if __name__ == "__main__":
    main()
