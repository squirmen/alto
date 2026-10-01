from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pandas as pd


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_species_imagery.py"
SPEC = importlib.util.spec_from_file_location("fetch_species_imagery", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_chip_tiles_cover_centre_and_radius() -> None:
    tiles = MODULE.tiles_for_chip(174.76, -36.85, radius_m=12.0, zoom=21)
    centre_x, centre_y = MODULE.lonlat_to_world_pixel(174.76, -36.85, 21)
    assert (int(centre_x // 256), int(centre_y // 256)) in tiles
    assert len(tiles) >= 1


def test_tile_plan_excludes_ineligible_rows() -> None:
    frame = pd.DataFrame(
        {
            "lon": [174.76, 174.77],
            "lat": [-36.85, -36.86],
            "chip_radius_m": [8.0, 8.0],
            "species_model_eligible": [True, False],
            "split": ["train", "train"],
        }
    )
    expected = sorted(MODULE.tiles_for_chip(174.76, -36.85, 8.0))
    assert MODULE.build_tile_plan(frame) == expected


def test_evenly_spaced_subset_is_deterministic() -> None:
    items = [(index, index) for index in range(100)]
    assert MODULE.evenly_spaced(items, 3) == [(0, 0), (50, 50), (99, 99)]
