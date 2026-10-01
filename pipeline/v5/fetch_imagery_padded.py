#!/usr/bin/env python3
"""Fetch LINZ 0.075 m imagery for each benchmark site, cut to the PADDED stack extent.

The first pass cropped to the site box while the fused stack carries a 20 m pad, so 52%
of the stack had no imagery at all and a greenness-gated canopy mask was blind exactly
where edge crowns are resolved. Same layer, same sites, wider crop.

The kit's chips are 0.25 m Esri imagery. LINZ layer 121752 is 0.075 m and flown in
the same years as the point cloud, which is four times finer and much closer to the
resolution DeepForest was trained at. Everything else about the benchmark is left
alone: same sites, same boxes, same splits.

Resumable. Sites already written are skipped.
"""
import json, math, re, sys, time
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from pyproj import Transformer

import os
# Benchmark kit: hand-labelled crowns and imagery used to calibrate segmentation (not distributed).
KIT = Path(os.environ.get("ALTO_BENCH_KIT", "/data/alto/bench_kit"))
OUT = Path("/data/alto/working/bench_imagery_pad")
PAD = 20.0          # must match build_base.PAD
LAYER, ZOOM, TILE = 121752, 21, 256


def api_key():
    key = os.environ.get("LINZ_API_KEY")
    if not key:
        sys.exit("Set LINZ_API_KEY (a free LINZ Basemaps key) in the environment")
    return key


def deg2num(lat, lon, z):
    n = 2 ** z
    return (int((lon + 180.0) / 360.0 * n),
            int((1.0 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n))


def num2deg(x, y, z):
    n = 2 ** z
    return (math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))), x / n * 360.0 - 180.0)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    key = api_key()
    to_wgs = Transformer.from_crs(2193, 4326, always_xy=True)
    session = requests.Session()
    session.headers["User-Agent"] = "ALTO research (Better Places Lab, University of Auckland)"
    url = ("https://tiles-cdn.koordinates.com/services;key=%s/tiles/v4/layer=%d/EPSG:3857/{z}/{x}/{y}.png"
           % (key, LAYER))

    metas = sorted(KIT.glob("data/sites/chips/*/meta.json"))
    print(f"sites: {len(metas)}")
    for mp in metas:
        m = json.loads(mp.read_text())
        sid = m["site_id"]
        dest = OUT / sid
        if (dest / "site.png").exists() and (dest / "site.json").exists():
            print(f"  {sid}: already done"); continue
        dest.mkdir(parents=True, exist_ok=True)
        x0, y0, x1, y1 = m["bbox_epsg2193"]
        x0, y0, x1, y1 = x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD
        # corners to WGS84 (the box is small, so corner transforms are enough)
        lon_w, lat_s = to_wgs.transform(x0, y0)
        lon_e, lat_n = to_wgs.transform(x1, y1)
        tx0, ty0 = deg2num(lat_n, lon_w, ZOOM)
        tx1, ty1 = deg2num(lat_s, lon_e, ZOOM)
        xs = range(min(tx0, tx1), max(tx0, tx1) + 1)
        ys = range(min(ty0, ty1), max(ty0, ty1) + 1)

        canvas = Image.new("RGB", (len(xs) * TILE, len(ys) * TILE))
        ok = 0
        for i, tx in enumerate(xs):
            for j, ty in enumerate(ys):
                r = session.get(url.format(z=ZOOM, x=tx, y=ty), timeout=30)
                if r.status_code == 200 and r.content:
                    canvas.paste(Image.open(__import__("io").BytesIO(r.content)).convert("RGB"),
                                 (i * TILE, j * TILE))
                    ok += 1
                time.sleep(0.02)
        # world extent of the mosaic, then crop precisely to the site box
        lat_top, lon_left = num2deg(min(xs), min(ys), ZOOM)
        lat_bot, lon_right = num2deg(max(xs) + 1, max(ys) + 1, ZOOM)
        to_nztm = Transformer.from_crs(4326, 2193, always_xy=True)
        # sample the mosaic corners in NZTM by inverse-mapping a grid
        W_px, H_px = canvas.size

        def px_of(xe, yn):
            """NZTM -> pixel in the mosaic, via WGS84 web-mercator y."""
            lon, lat = to_wgs.transform(xe, yn)
            fx = (lon - lon_left) / (lon_right - lon_left)
            my = lambda L: math.log(math.tan(math.pi / 4 + math.radians(L) / 2))
            fy = (my(lat_top) - my(lat)) / (my(lat_top) - my(lat_bot))
            return fx * W_px, fy * H_px

        px_a, py_a = px_of(x0, y1)      # top-left of the site box
        px_b, py_b = px_of(x1, y0)      # bottom-right
        left, right = sorted((px_a, px_b))
        top, bottom = sorted((py_a, py_b))
        crop = canvas.crop((int(round(left)), int(round(top)), int(round(right)), int(round(bottom))))
        crop.save(dest / "site.png")

        side_px = crop.size[0]
        res = (x1 - x0) / side_px
        json.dump({"site_id": sid, "stratum": m["stratum"], "split": m["split"],
                   "bbox_epsg2193": [x0, y0, x1, y1], "crs": "EPSG:2193",
                   "width_px": crop.size[0], "height_px": crop.size[1],
                   "resolution_m": res, "zoom": ZOOM, "tiles_fetched": ok,
                   "source": "LINZ 121752 Auckland 0.075m Urban Aerial Photos (2024-2025), CC-BY 4.0",
                   "pixel_to_world": {"x0": x0, "y1": y1,
                                      "x": "x0 + (col + 0.5) * resolution_m",
                                      "y": "y1 - (row + 0.5) * resolution_m"}},
                  open(dest / "site.json", "w"), indent=2)
        print(f"  {sid}: {ok} tiles -> {crop.size[0]}x{crop.size[1]} px at {res:.3f} m", flush=True)


if __name__ == "__main__":
    main()
