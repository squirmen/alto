#!/usr/bin/env python3
"""Canopy cover by Auckland local board.

Canopy cover is the share of land area under vegetation canopy at or above 3
metres. It is measured directly from the 2024 canopy height model masked to
vegetation by the Green Leaf Index, so it does not depend on individual-crown
delineation. For each local board the script reports:

  * canopy_cover_pct  : vegetation canopy area divided by the board's official
                        land area (Stats NZ land area, water excluded)
  * coverage_fraction : the share of the board that lies inside the modelled
                        extent; boards that extend beyond it are flagged so their
                        canopy figure is read as a lower bound
  * tree_count        : mapped trees whose point falls inside the board

Outputs a SQLite table, a board-polygon GeoJSON for the map, and a summary note.
"""

from __future__ import annotations

import json
import os
import math
import sqlite3
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
# Overridable so a comparison run can target a working copy. The shared
# database is read by another project; --no-write keeps this read-only.
DB = Path(os.environ["AKL_TREES_DB"]) if os.environ.get("AKL_TREES_DB") \
    else ROOT / "data" / "processed" / "akl_trees.sqlite"
BOARDS = ROOT / "data" / "raw" / "admin" / "auckland_local_boards_2026.geojson"
PILOTS = ROOT / "config" / "pilots.json"
CHM = ROOT / "data" / "interim" / "auckland_metro_v1_lidar" / "chm.vrt"
GREEN = ROOT / "data" / "interim" / "greenness_auckland_metro_v1" / "greenness.vrt"
OUT_GEOJSON = ROOT / "data" / "processed" / "canopy_cover_by_board.geojson"
OUT_DOC = ROOT / "docs" / "validation" / "canopy_cover_by_board.md"

NDVI = ROOT / "data" / "interim" / "ndvi_auckland_metro_v1" / "ndvi.vrt"

CANOPY_MIN_H = 3.0
GLI_THRESHOLD = 0.06
# NDVI from the LINZ near-infrared band. 0.2 is the conventional bare-soil
# boundary and sits in the valley of the measured distribution. The visible-band
# index discards shadowed canopy that NDVI keeps, so canopy area measured with
# GLI is an under-estimate.
NDVI_THRESHOLD = 0.2
INDEXES = {
    "gli": (GREEN, GLI_THRESHOLD, "5x5 mean GLI from Esri RGB basemap tiles"),
    "ndvi": (NDVI, NDVI_THRESHOLD, "NDVI from LINZ 0.075 m RGB+NIR aerial imagery"),
}
MAX_CELLS = 3200          # cap per-board raster read; decimate larger windows
MIN_COVERAGE = 0.80       # boards at least this far inside the extent are "full"


def board_canopy_km2(geom, chm_src, green_src, threshold: float = GLI_THRESHOLD) -> float:
    """Vegetation-canopy area (km²) inside a board: CHM >= 3 m and index >= threshold."""
    rb = chm_src.bounds
    minx, miny, maxx, maxy = geom.bounds
    minx, miny = max(minx, rb.left), max(miny, rb.bottom)
    maxx, maxy = min(maxx, rb.right), min(maxy, rb.top)
    if minx >= maxx or miny >= maxy:
        return 0.0
    win = from_bounds(minx, miny, maxx, maxy, chm_src.transform)
    decim = max(1, math.ceil(max(win.width, win.height) / MAX_CELLS))
    out_h, out_w = max(1, int(win.height // decim)), max(1, int(win.width // decim))
    chm = chm_src.read(1, window=win, out_shape=(out_h, out_w), resampling=Resampling.average,
                       boundless=True, fill_value=np.nan)
    gli = green_src.read(1, window=from_bounds(minx, miny, maxx, maxy, green_src.transform),
                         out_shape=(out_h, out_w), resampling=Resampling.average,
                         boundless=True, fill_value=np.nan)
    nd = chm_src.nodata
    if nd is not None:
        chm = np.where(chm == nd, np.nan, chm)
    # Both index rasters carry a sentinel nodata; make it explicit rather than
    # relying on the comparison happening to exclude a large negative value.
    gnd = green_src.nodata
    if gnd is not None:
        gli = np.where(gli == gnd, np.nan, gli)
    transform = rasterio.transform.from_bounds(minx, miny, maxx, maxy, out_w, out_h)
    inside = ~geometry_mask([geom.__geo_interface__], (out_h, out_w), transform, invert=False)
    canopy = (inside & np.isfinite(chm) & (chm >= CANOPY_MIN_H)
              & np.isfinite(gli) & (gli >= threshold))
    cell_km2 = ((maxx - minx) / out_w) * ((maxy - miny) / out_h) / 1e6
    return float(canopy.sum()) * cell_km2


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", choices=sorted(INDEXES), default="gli",
                    help="vegetation index gating the canopy height model")
    ap.add_argument("--no-write", action="store_true",
                    help="report only; do not touch the database or outputs")
    args = ap.parse_args()
    index_path, index_threshold, index_desc = INDEXES[args.index]
    if not index_path.exists():
        raise SystemExit(f"{index_path} not found; build it first")
    print(f"vegetation index: {args.index} >= {index_threshold} ({index_desc})")
    bbox = json.loads(PILOTS.read_text())["pilots"]["auckland_metro_v1"]["bbox_2193"]
    extent = box(*bbox)
    boards = gpd.read_file(BOARDS).to_crs(2193)

    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True) if args.no_write \
        else sqlite3.connect(DB)
    trees = con.execute("SELECT x_2193, y_2193 FROM tree_lidar_pilot WHERE x_2193 IS NOT NULL").fetchall()
    tree_pts = gpd.GeoDataFrame(geometry=gpd.points_from_xy([r[0] for r in trees], [r[1] for r in trees]), crs=2193)
    tree_count = gpd.sjoin(tree_pts, boards[["board_name", "geometry"]], predicate="within") \
                    .groupby("board_name").size().to_dict()

    rows = []
    with rasterio.open(CHM) as chm_src, rasterio.open(index_path) as green_src:
        for _, b in boards.iterrows():
            land = float(b["land_area_km2"]) if b["land_area_km2"] else 0.0
            canopy = board_canopy_km2(b.geometry, chm_src, green_src, index_threshold)
            cov_frac = (b.geometry.intersection(extent).area / b.geometry.area) if b.geometry.area else 0.0
            cover_pct = (100.0 * canopy / land) if land > 0 else None
            rows.append({
                "board_name": b["board_name"], "land_area_km2": round(land, 1),
                "canopy_km2": round(canopy, 2),
                "canopy_cover_pct": round(cover_pct, 1) if cover_pct is not None else None,
                "coverage_fraction": round(cov_frac, 3),
                "fully_assessed": 1 if cov_frac >= MIN_COVERAGE else 0,
                "tree_count": int(tree_count.get(b["board_name"], 0)),
            })

    if args.no_write:
        con.close()
        full_r = [r for r in rows if r["fully_assessed"]]
        ck = sum(r["canopy_km2"] for r in full_r)
        lk = sum(r["land_area_km2"] for r in full_r)
        print(f"\n{args.index}: metro canopy cover {100*ck/lk:.2f}% "
              f"({ck:.1f} km2 over {lk:.1f} km2, {len(full_r)} fully-assessed boards)")
        for r in sorted(full_r, key=lambda r: -(r["canopy_cover_pct"] or 0))[:5]:
            print(f"   {r['board_name']:28s} {r['canopy_cover_pct']:5.1f}%")
        return
    con.execute("DROP TABLE IF EXISTS canopy_cover_by_board")
    con.execute("""CREATE TABLE canopy_cover_by_board (
        board_name TEXT PRIMARY KEY, land_area_km2 REAL, canopy_km2 REAL,
        canopy_cover_pct REAL, coverage_fraction REAL, fully_assessed INTEGER, tree_count INTEGER)""")
    con.executemany("INSERT INTO canopy_cover_by_board VALUES (:board_name,:land_area_km2,"
                    ":canopy_km2,:canopy_cover_pct,:coverage_fraction,:fully_assessed,:tree_count)", rows)
    con.commit()
    con.close()

    by_name = {r["board_name"]: r for r in rows}
    feats = []
    for _, b in boards.to_crs(4326).iterrows():
        r = by_name[b["board_name"]]
        feats.append({"type": "Feature", "geometry": b.geometry.__geo_interface__,
                      "properties": dict(r)})
    OUT_GEOJSON.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")

    full = sorted([r for r in rows if r["fully_assessed"]], key=lambda r: r["canopy_cover_pct"] or 0, reverse=True)
    partial = sorted([r for r in rows if not r["fully_assessed"]], key=lambda r: r["coverage_fraction"], reverse=True)
    metro_canopy = sum(r["canopy_km2"] for r in full)
    metro_land = sum(r["land_area_km2"] for r in full)
    lines = ["# Canopy cover by Auckland local board", "",
             "Canopy cover is the share of land under vegetation canopy at or above 3 metres, "
             "measured from the 2024 canopy height model masked to vegetation by the Green Leaf "
             "Index. The denominator is the Stats NZ official land area for each board. Boards that "
             "sit at least 80 percent inside the modelled extent are listed first; the remainder "
             "extend beyond it, so their figures are lower bounds.", "",
             f"Across the {len(full)} fully assessed boards, canopy covers "
             f"{100*metro_canopy/metro_land:.1f} percent of {metro_land:,.0f} km² of land.", "",
             "## Boards assessed in full", "",
             "| Local board | Canopy cover | Canopy (km²) | Land (km²) | Trees |",
             "| --- | ---: | ---: | ---: | ---: |"]
    for r in full:
        lines.append(f"| {r['board_name']} | {r['canopy_cover_pct']:.1f}% | {r['canopy_km2']:.1f} "
                     f"| {r['land_area_km2']:.1f} | {r['tree_count']:,} |")
    lines += ["", "## Boards extending beyond the modelled extent (lower bounds)", "",
              "| Local board | Inside extent | Canopy cover (lower bound) |",
              "| --- | ---: | ---: |"]
    for r in partial:
        cov = f"{r['canopy_cover_pct']:.1f}%" if r["canopy_cover_pct"] is not None else "n/a"
        lines.append(f"| {r['board_name']} | {r['coverage_fraction']*100:.0f}% | {cov} |")
    OUT_DOC.write_text("\n".join(lines), encoding="utf-8")

    print(f"canopy_cover_by_board: {len(rows)} boards ({len(full)} fully assessed); "
          f"metro canopy cover {100*metro_canopy/metro_land:.1f}% over {metro_land:,.0f} km² land")
    for r in full:
        print(f"  {r['board_name']:24s} {r['canopy_cover_pct']:5.1f}%  ({r['tree_count']:,} trees)")


if __name__ == "__main__":
    main()
