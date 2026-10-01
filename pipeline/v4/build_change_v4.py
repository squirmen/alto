#!/usr/bin/env python3
"""Tree-change layer for the v4 release.

Removals inside the Port of Auckland and Fergusson Container Terminal are relabelled
'unverified_port_structure': their 2013 "canopy" is mostly stacked containers and
cranes, so they are shown in grey as unverified instead of red. Nothing is dropped.
Writes web_build/tree_change.geojsonl.
"""
import json
import os
import sys
from pathlib import Path

import shapely
from shapely.ops import unary_union

W = Path("/data/alto/working/alto_v4_20260917")
T7 = Path("/data/alto")
os.environ["AKL_TREES_PILOT"] = "auckland_metro_v1"
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "base" / "scripts"))
import build_tree_crown_pilot as bcp  # noqa: E402

PORT_NAMES = {"Port of Auckland", "Fergusson Container Terminal"}
elements = {}
for path in (T7 / "raw/osm/nonveg_tiles").glob("osm_nonveg_v2_*.json"):
    for el in json.loads(path.read_text()).get("elements", []):
        if (el.get("tags") or {}).get("name") in PORT_NAMES:
            elements[(el["type"], el["id"])] = el
port_2193 = unary_union(bcp.osm_payloads_to_exclusion_polygons([{"elements": list(elements.values())}]))
from pyproj import Transformer  # noqa: E402
to4326 = Transformer.from_crs(2193, 4326, always_xy=True)
port = shapely.transform(port_2193, lambda xy: __import__("numpy").column_stack(to4326.transform(xy[:, 0], xy[:, 1])))
shapely.prepare(port)

data = json.loads((W / "legacy" / "tree_trajectory_pilot.geojson").read_text())
counts = {}
with (W / "web_build" / "tree_change.geojsonl").open("w") as fh:
    for f in data["features"]:
        props = f["properties"]
        if props.get("fate") == "removed_to_open":
            lon, lat = f["geometry"]["coordinates"][:2]
            if shapely.contains_xy(port, lon, lat):
                props["fate"] = "unverified_port_structure"
                props["review_note"] = "2013 heights here are mostly stacked containers and cranes, not trees"
        counts[props.get("fate")] = counts.get(props.get("fate"), 0) + 1
        fh.write(json.dumps(f, separators=(",", ":")) + "\n")
print(f"port polygons from {len(elements)} OSM relations; fates {counts}")
