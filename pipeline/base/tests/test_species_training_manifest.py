from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pandas as pd


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prepare_species_training_manifest.py"
SPEC = importlib.util.spec_from_file_location("prepare_species_training_manifest", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_normalize_taxon_preserves_label_scope() -> None:
    assert MODULE.normalize_taxon("Agathis australis") == (
        "Agathis",
        "Agathis australis",
        "species_exact",
    )
    assert MODULE.normalize_taxon("Prunus sp.") == ("Prunus", None, "genus_only")
    assert MODULE.normalize_taxon("Unknown") == (None, None, "unknown")


def test_hybrid_taxon_is_normalized() -> None:
    assert MODULE.normalize_taxon("Platanus x acerifolia") == (
        "Platanus",
        "Platanus x acerifolia",
        "species_exact",
    )


def test_spatial_split_excludes_boundary_buffer() -> None:
    frame = pd.DataFrame(
        {
            "approx_x_m": [1001.0, 1250.0, 1499.0],
            "approx_y_m": [1001.0, 1250.0, 1499.0],
        }
    )
    result = MODULE.assign_spatial_splits(frame, block_size_m=500.0, buffer_m=50.0, seed=42)
    assert result["split"].tolist()[0] == "buffer_excluded"
    assert result["split"].tolist()[1] != "buffer_excluded"
    assert result["split"].tolist()[2] == "buffer_excluded"


def test_surveillance_and_conflicting_labels_are_not_supervised() -> None:
    frame = pd.DataFrame(
        {
            "tree_id": ["a", "b", "c"],
            "source_primary": ["tree_register_points", "tree_register_points", "ruru_obskauri_tiaki_public"],
            "species_latin": ["Agathis australis", "Metrosideros excelsa", "Agathis australis"],
            "species_confidence": ["source_species", "source_species", "source_species"],
            "approx_x_m": [1250.0, 1250.1, 2250.0],
            "approx_y_m": [1250.0, 1250.1, 2250.0],
            "crown_area_m2": [20.0, 20.0, 20.0],
            "crown_diameter_m": [5.0, 5.0, 5.0],
            "pointcloud_class": ["vegetation", "vegetation", "vegetation"],
        }
    )
    result = MODULE.prepare_manifest(
        frame, block_size_m=1000.0, buffer_m=50.0, seed=42, min_species_samples=1
    )
    eligible = result.set_index("tree_id")["supervised_label_eligible"].to_dict()
    assert eligible == {"a": False, "b": False, "c": False}
