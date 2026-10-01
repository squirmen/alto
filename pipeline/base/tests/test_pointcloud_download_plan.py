from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_point_cloud.py"
SPEC = importlib.util.spec_from_file_location("fetch_point_cloud", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_select_tree_tiles_honours_margin() -> None:
    tiles = [("a", 0.0, 0.0, 100.0, 100.0), ("b", 100.0, 0.0, 200.0, 100.0)]
    selected = MODULE.select_tree_tiles(tiles, np.array([-20.0]), np.array([50.0]), 30.0)
    assert selected == [tiles[0]]


def test_download_plan_is_machine_readable(tmp_path: Path) -> None:
    output = tmp_path / "plan.json"
    MODULE.write_download_plan(
        output,
        pilot="test",
        bbox=(0.0, 0.0, 100.0, 100.0),
        tiles=[("tile_1", 0.0, 0.0, 10.0, 10.0)],
        decimate_step=4,
        tree_filtered=True,
    )
    payload = json.loads(output.read_text())
    assert payload["tile_count"] == 1
    assert payload["tiles"][0]["output_name"] == "pc_tile_1.laz"
    assert payload["schema_version"].endswith("/v1")
