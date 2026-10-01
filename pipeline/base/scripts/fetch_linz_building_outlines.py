#!/usr/bin/env python3
"""Fetch a clipped LINZ NZ Building Outlines layer for the pilot bbox.

The full national layer is millions of polygons. This script downloads only
the requested bbox via LINZ WFS and writes a local GeoPackage that
``build_tree_crown_pilot.py`` and ``detect_inferred_trees.py`` will prefer
over the interim OSM building mask.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.parse import quote

import geopandas as gpd


ROOT = Path(__file__).resolve().parents[1]
RAW_LINZ_BUILDINGS = ROOT / "data" / "raw" / "linz_buildings"
from _pilot_config import DEFAULT_PILOT_BBOX_2193  # noqa: E402
LINZ_BUILDINGS_LAYER_ID = 101290


def wfs_url(api_key: str, bbox: tuple[float, float, float, float]) -> str:
    xmin, ymin, xmax, ymax = bbox
    params = (
        "service=WFS"
        "&version=2.0.0"
        "&request=GetFeature"
        f"&typeNames=layer-{LINZ_BUILDINGS_LAYER_ID}"
        "&outputFormat=json"
        "&srsName=EPSG:2193"
        f"&bbox={xmin},{ymin},{xmax},{ymax},EPSG:2193"
    )
    return f"https://data.linz.govt.nz/services;key={quote(api_key)}/wfs/layer-{LINZ_BUILDINGS_LAYER_ID}/?{params}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, default=list(DEFAULT_PILOT_BBOX_2193))
    parser.add_argument(
        "--output",
        type=Path,
        default=RAW_LINZ_BUILDINGS / "nz_building_outlines_waitemata.gpkg",
    )
    args = parser.parse_args()

    api_key = os.environ.get("LINZ_API_KEY")
    if not api_key:
        raise SystemExit("LINZ_API_KEY is not set. Create a LINZ API key, export it, then rerun this script.")

    bbox = tuple(float(v) for v in args.bbox)
    url = wfs_url(api_key, bbox)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    print(f"Fetching LINZ NZ Building Outlines for bbox {bbox}...")
    gdf = gpd.read_file(url)
    if gdf.empty:
        raise SystemExit("LINZ WFS returned no building outlines for the requested bbox.")
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:2193")
    elif str(gdf.crs).upper() not in {"EPSG:2193", "2193"}:
        gdf = gdf.to_crs("EPSG:2193")

    gdf.to_file(args.output, layer="buildings", driver="GPKG")
    try:
        shown = args.output.resolve().relative_to(ROOT)
    except ValueError:
        shown = args.output
    print(f"Wrote {len(gdf):,} building outlines to {shown}")


if __name__ == "__main__":
    main()
