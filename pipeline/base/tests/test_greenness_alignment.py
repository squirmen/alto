from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "detect_inferred_trees.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("detect_inferred_trees", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_greenness_uses_haloed_chm_grid_without_stretching() -> None:
    source = np.arange(100, dtype="float32").reshape(10, 10)
    source_transform = from_origin(0.0, 10.0, 1.0, 1.0)
    chm_transform = from_origin(-2.0, 12.0, 1.0, 1.0)
    with MemoryFile() as memory:
        with memory.open(
            driver="GTiff",
            width=10,
            height=10,
            count=1,
            dtype="float32",
            transform=source_transform,
            crs="EPSG:2193",
            nodata=-9999.0,
        ) as writer:
            writer.write(source, 1)
        with memory.open() as reader:
            aligned = MODULE.read_gli_window(
                reader,
                (0.0, 0.0, 10.0, 10.0),
                (14, 14),
                chm_transform,
            )
    assert aligned is not None
    np.testing.assert_array_equal(aligned[2:12, 2:12], source)
    assert np.isnan(aligned[0, 0])
