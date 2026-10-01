#!/usr/bin/env python3
"""Before/after pictures of the v4 release for a few views.

Left : the live map (released crowns in yellow, tree points as white dots).
Right: the v4 working database (crowns and points coloured by evidence tier).
Background is the cached Esri z18 imagery. Read-only; writes JPEGs under ../renders.
"""
import json
import math
import sqlite3
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import shapely  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from PIL import Image  # noqa: E402
from pyproj import Transformer  # noqa: E402
from shapely.geometry import shape  # noqa: E402

W = Path("/data/alto/working/alto_v4_20260917")
import os
AUDIT = Path(os.environ.get("ALTO_AUDIT_DIR", "/data/alto/working/truth_audit"))
TILES = Path("/data/alto/raw/esri_world_imagery/tiles_z18")
PROD = "/data/alto/working/prod-20260909/akl_trees.sqlite"
OUT = W / "renders"
T4326_3857 = Transformer.from_crs(4326, 3857, always_xy=True)
T2193_3857 = Transformer.from_crs(2193, 3857, always_xy=True)
R = 6378137.0
SIZE = 2 * math.pi * R / 2 ** 18
TIER_COLOUR = {"recorded": "#3d7cc9", "very_likely": "#1fa05a", "probable": "#b8d136", "possible": "#f0a030",
               "unverified": "#9a9a9a", "possible_duplicate": "#cfcfcf"}
TIER_LABEL = {"recorded": "Recorded tree", "very_likely": "Very likely a tree", "probable": "Probably a tree",
              "possible": "Possibly a tree", "unverified": "Unverified detection", "possible_duplicate": "Possible duplicate"}
VIEWS = {
    "devonport_primary": ((174.7975, -36.8298, 174.8020, -36.8265), 0.3),
    "fergusson_reserve": ((174.7270, -36.8910, 174.7350, -36.8850), 0.35),
    "bayswater_view": ((174.7720, -36.8165, 174.7850, -36.8085), 0.4),
}


def mosaic(x0, y0, x1, y1):
    tx0, tx1 = int((x0 + math.pi * R) // SIZE), int((x1 + math.pi * R) // SIZE)
    ty0, ty1 = int((math.pi * R - y1) // SIZE), int((math.pi * R - y0) // SIZE)
    img = np.full(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), 90, np.uint8)
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            p = TILES / f"18_{tx}_{ty}.jpg"
            if p.exists():
                img[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = \
                    np.asarray(Image.open(p).convert("RGB"))
    return img, (-math.pi * R + tx0 * SIZE, -math.pi * R + (tx1 + 1) * SIZE,
                 math.pi * R - (ty1 + 1) * SIZE, math.pi * R - ty0 * SIZE)


def rings(geoms):
    out = []
    for g in geoms:
        for p in getattr(g, "geoms", [g]):
            if p.geom_type == "Polygon" and not p.is_empty:
                out.append(np.asarray(p.exterior.coords))
    return out


def render(tag, bbox, scale):
    lon0, lat0, lon1, lat1 = bbox
    x0, y0 = T4326_3857.transform(lon0, lat0)
    x1, y1 = T4326_3857.transform(lon1, lat1)
    img, ext = mosaic(x0, y0, x1, y1)

    # before: deployed crowns (extracted from the live tiles) and live points
    old = []
    def walk(o):
        if isinstance(o, dict):
            if o.get("type") == "Feature" and o.get("geometry"):
                g = shape(o["geometry"])
                if g.geom_type in ("Polygon", "MultiPolygon"):
                    old.append(shapely.transform(g, lambda xy: np.column_stack(T4326_3857.transform(xy[:, 0], xy[:, 1]))))
            for ch in o.get("features", []) if isinstance(o.get("features"), list) else []:
                walk(ch)
    walk(json.loads((AUDIT / f"{tag}_crowns_z18.geojson").read_text()))
    pc = sqlite3.connect(f"file:{PROD}?immutable=1", uri=True)
    op = np.array(pc.execute("SELECT lon, lat FROM trees WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?",
                             (lon0, lon1, lat0, lat1)).fetchall())

    # after: v4 working database
    wc = sqlite3.connect(f"file:{W / 'akl_trees.sqlite'}?mode=ro", uri=True)
    to2193 = Transformer.from_crs(4326, 2193, always_xy=True)
    ax0, ay0 = to2193.transform(lon0, lat0)
    ax1, ay1 = to2193.transform(lon1, lat1)
    crowns = wc.execute("SELECT crown_wkb, evidence_tier FROM tree_crown_v4 WHERE x_2193 BETWEEN ? AND ? AND y_2193 BETWEEN ? AND ?",
                        (ax0 - 30, ax1 + 30, ay0 - 30, ay1 + 30)).fetchall()
    geoms = shapely.from_wkb([c[0] for c in crowns])
    geoms = shapely.transform(geoms, lambda xy: np.column_stack(T2193_3857.transform(xy[:, 0], xy[:, 1])))
    ctier = [c[1] for c in crowns]
    pts = wc.execute("""SELECT t.lon, t.lat, COALESCE(e.evidence_tier, 'recorded') FROM trees t
                        LEFT JOIN tree_evidence_v4 e ON e.tree_id = t.tree_id
                        WHERE t.lon BETWEEN ? AND ? AND t.lat BETWEEN ? AND ?""", (lon0, lon1, lat0, lat1)).fetchall()

    wpx = (x1 - x0) / scale
    hpx = (y1 - y0) / scale
    fig, axes = plt.subplots(1, 2, figsize=(2 * wpx / 100, hpx / 100 + 0.8), dpi=100)
    for ax in axes:
        ax.imshow(img, extent=ext, interpolation="bilinear")
        ax.set_xlim(x0, x1)
        ax.set_ylim(y0, y1)
        ax.set_axis_off()
    ax = axes[0]
    ax.add_collection(PolyCollection(rings(old), facecolors="none", edgecolors="#ffd21f", linewidths=0.9))
    if len(op):
        px, py = T4326_3857.transform(op[:, 0], op[:, 1])
        ax.scatter(px, py, s=6, c="white", edgecolors="black", linewidths=0.4, zorder=5)
    ax.set_title(f"Live map now: {len(op):,} trees", fontsize=13, loc="left")
    ax = axes[1]
    for tier, colour in TIER_COLOUR.items():
        sel = [g for g, t in zip(geoms, ctier) if t == tier]
        if sel:
            ax.add_collection(PolyCollection(rings(sel), facecolors=colour + "22", edgecolors=colour, linewidths=0.8))
    counts = {}
    for tier, colour in TIER_COLOUR.items():
        xy = np.array([(p[0], p[1]) for p in pts if p[2] == tier])
        counts[tier] = len(xy)
        if len(xy):
            px, py = T4326_3857.transform(xy[:, 0], xy[:, 1])
            ax.scatter(px, py, s=7, c=colour, edgecolors="black", linewidths=0.3, zorder=5)
    ax.set_title(f"This release: {len(pts):,} trees", fontsize=13, loc="left")
    handles = [Line2D([0], [0], marker="o", ls="", markerfacecolor=c, markeredgecolor="black", markersize=8,
                      label=f"{TIER_LABEL[t]} ({counts[t]:,})") for t, c in TIER_COLOUR.items() if counts[t]]
    ax.legend(handles=handles, loc="lower right", fontsize=10, framealpha=0.85)
    plt.subplots_adjust(left=0.005, right=0.995, top=1 - 0.8 / (hpx / 100 + 0.8), bottom=0.005, wspace=0.01)
    OUT.mkdir(exist_ok=True)
    out = OUT / f"{tag}_v4.jpg"
    fig.savefig(out, dpi=100, pil_kwargs={"quality": 85})
    plt.close(fig)
    print(f"{tag}: before {len(op):,} trees, after {len(pts):,} {counts} -> {out}")


if __name__ == "__main__":
    for tag in sys.argv[1:] or VIEWS:
        render(tag, *VIEWS[tag])
