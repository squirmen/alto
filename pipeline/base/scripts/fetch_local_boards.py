#!/usr/bin/env python3
"""Fetch Auckland local board boundaries (21 boards) as a polygon layer.

Source: Stats NZ Territorial Authority / Local Board 2026 boundaries, served from
the Stats NZ ArcGIS organisation. Auckland is the only territorial authority split
into local boards, so a name filter returns the 21 Auckland boards directly, each
carrying its official land area. Output is written in EPSG:2193 for area work.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "admin" / "auckland_local_boards_2026.geojson"
SERVICE = ("https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/"
           "Territorial_Authority_Local_Board_2026/FeatureServer/0/query")
NAME_FIELD = "TALB2026_V1_00_NAME"
AREA_FIELD = "LAND_AREA_SQ_KM"


def main() -> None:
    params = {
        "where": f"{NAME_FIELD} LIKE '%Local Board%'",
        "outFields": f"{NAME_FIELD},{AREA_FIELD}",
        "outSR": 2193,
        "returnGeometry": "true",
        "f": "geojson",
    }
    url = f"{SERVICE}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "akl-trees-admin/0.1"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        gj = json.loads(resp.read().decode("utf-8"))

    feats = gj.get("features", [])
    # Normalise property names so downstream code is stable.
    for f in feats:
        p = f.get("properties", {})
        p["board_name"] = p.get(NAME_FIELD, "").replace(" Local Board Area", "").strip()
        p["land_area_km2"] = p.get(AREA_FIELD)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(gj), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(feats)} local boards (EPSG:2193)")
    for f in sorted(feats, key=lambda x: x["properties"]["board_name"]):
        p = f["properties"]
        print(f"  {p['board_name']:26s} {p['land_area_km2']:.1f} km2")


if __name__ == "__main__":
    main()
