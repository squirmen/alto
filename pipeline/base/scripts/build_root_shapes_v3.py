#!/usr/bin/env python3
"""WS4 v3 — asymmetric per-tree root-space scenario polygons.

Creates a visual planning scenario from the circular v2 zone:
  base   = foraging circle (1.5 × crown radius)
  ∩ Voronoi cell   → neighbour competition partitions the ground between trees
  − building footprints (cached OSM outlines) → roots deflect around foundations

Output: `tree_root_shapes.geojson` (polygons + constraint flag) → `tree_root_shapes.pmtiles`
for a fill layer on the map. Reuses v2's foraging radius + constraint flag from
`tree_root_zone_pilot`. Roots from neighbouring trees can overlap in reality, and
building subtraction/Voronoi partitioning is not a measured root footprint. Read-only
on inputs. No GPU.

Test on a window first:  python scripts/build_root_shapes_v3.py --size-km 2
Whole isthmus:           python scripts/build_root_shapes_v3.py --full
"""

from __future__ import annotations

import argparse
import glob
import json
import sqlite3
import time
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import MultiPoint, Polygon, box
from shapely.ops import voronoi_diagram

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OSM_BUILDINGS = ROOT / "data" / "raw" / "osm" / "buildings_tiles"
OUT = ROOT / "data" / "processed" / "tree_root_shapes.geojson"

TO_2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
TO_4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)


def load_buildings(bbox) -> STRtree:
    polys = []
    for f in glob.glob(str(OSM_BUILDINGS / "*.json")):
        for el in json.load(open(f)).get("elements", []):
            g = el.get("geometry")
            if not g or len(g) < 3:
                continue
            xs, ys = TO_2193.transform([p["lon"] for p in g], [p["lat"] for p in g])
            try:
                poly = Polygon(zip(xs, ys))
                if poly.is_valid and poly.area > 1:
                    polys.append(poly)
            except Exception:
                continue
    # keep only buildings overlapping the working bbox (+margin)
    region = box(bbox[0] - 30, bbox[1] - 30, bbox[2] + 30, bbox[3] + 30)
    polys = [p for p in polys if p.intersects(region)]
    return STRtree(polys), polys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size-km", type=float, default=2.0)
    ap.add_argument("--full", action="store_true")
    args = ap.parse_args()

    # Export-only stage: read-only so it cannot lock the shared database.
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute("""
        SELECT t.lon, t.lat, z.foraging_radius_m, z.root_constraint_flag, t.tree_id
        FROM tree_root_zone_pilot z JOIN trees t ON t.tree_id = z.tree_id
        WHERE t.lon IS NOT NULL AND t.lat IS NOT NULL AND z.foraging_radius_m IS NOT NULL""").fetchall()
    con.close()

    xs, ys = TO_2193.transform([r[0] for r in rows], [r[1] for r in rows])
    xs, ys = np.array(xs), np.array(ys)
    fr = np.array([r[2] for r in rows])
    flag = [r[3] for r in rows]
    tree_ids = [r[4] for r in rows]

    if args.full:
        bbox = (xs.min(), ys.min(), xs.max(), ys.max())
        sel = np.ones(len(xs), bool)
    else:
        cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        h = args.size_km * 1000 / 2
        bbox = (cx - h, cy - h, cx + h, cy + h)
        sel = (xs >= bbox[0]) & (xs <= bbox[2]) & (ys >= bbox[1]) & (ys <= bbox[3])
    xs, ys, fr = xs[sel], ys[sel], fr[sel]
    flag = [f for f, s in zip(flag, sel) if s]
    tree_ids = [tree_id for tree_id, selected in zip(tree_ids, sel) if selected]
    print(f"trees in window: {len(xs):,}  ({'FULL' if args.full else f'{args.size_km} km'})")

    t0 = time.time()
    bsrt, bpolys = load_buildings(bbox)
    print(f"  buildings: {len(bpolys):,} ({time.time()-t0:.1f}s)")

    pts = shapely.points(xs, ys)
    env = box(bbox[0] - 50, bbox[1] - 50, bbox[2] + 50, bbox[3] + 50)
    cells = list(voronoi_diagram(MultiPoint(list(zip(xs, ys))), envelope=env).geoms)
    ctree = STRtree(cells)
    # match each point to its containing Voronoi cell
    qi, ci = ctree.query(pts, predicate="within")
    cell_of = {}
    for p_i, c_i in zip(qi, ci):
        cell_of.setdefault(p_i, c_i)
    print(f"  voronoi cells: {len(cells):,} ({time.time()-t0:.1f}s)")

    circles = shapely.buffer(pts, fr, quad_segs=10)
    feats = []
    for i in range(len(xs)):
        c_i = cell_of.get(i)
        zone = shapely.intersection(circles[i], cells[c_i]) if c_i is not None else circles[i]
        if zone.is_empty:
            continue
        # subtract nearby buildings
        bidx = bsrt.query(zone, predicate="intersects")
        if len(bidx):
            zone = shapely.difference(zone, shapely.union_all([bpolys[j] for j in bidx]))
        zone = zone.simplify(0.3)
        if zone.is_empty or zone.area < 0.5:
            continue
        # to 4326
        def to4326(ring):
            lo, la = TO_4326.transform([c[0] for c in ring], [c[1] for c in ring])
            return [[round(x, 6), round(y, 6)] for x, y in zip(lo, la)]
        geoms = zone.geoms if zone.geom_type == "MultiPolygon" else [zone]
        coords = [[to4326(g.exterior.coords)] for g in geoms if g.geom_type == "Polygon"]
        if not coords:
            continue
        geom = ({"type": "Polygon", "coordinates": coords[0]} if len(coords) == 1
                else {"type": "MultiPolygon", "coordinates": coords})
        feats.append({
            "type": "Feature",
            "id": tree_ids[i],
            "geometry": geom,
            "properties": {
                "tree_id": tree_ids[i],
                "foraging_radius_m": round(float(fr[i]), 2),
                "modelled_area_m2": round(float(zone.area), 2),
                "constraint": flag[i],
                "method_id": "root_shape_v3_voronoi_osm_buildings_scenario",
            },
        })

    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    print(f"  wrote {len(feats):,} root-shape polygons ({time.time()-t0:.1f}s) -> {OUT.name}")


if __name__ == "__main__":
    main()
