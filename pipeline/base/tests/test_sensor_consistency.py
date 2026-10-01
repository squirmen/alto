from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_accuracy_assessment.py"
SPEC = importlib.util.spec_from_file_location("build_accuracy_assessment", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_canopy_rates_condition_on_sensor_coverage() -> None:
    references = [
        {
            "chm_h": 10.0,
            "owner_class": "public",
            "source_primary": "tree_register_points",
            "chm_canopy": 1,
            "chm_covered": 1,
            "pc_present": 1,
            "pc_covered": 1,
        },
        {
            "chm_h": None,
            "owner_class": "public",
            "source_primary": "tree_register_points",
            "chm_canopy": 0,
            "chm_covered": 0,
            "pc_present": 0,
            "pc_covered": 0,
        },
    ]
    result = MODULE.detection_assessment(references, machine_n=10)
    assert result["overall"]["pc_canopy_rate_when_covered"] == 1.0
    assert result["overall"]["pc_coverage"] == 0.5
    assert result["overall"]["chm_canopy_rate_when_covered"] == 1.0
    assert result["interpretation"] == "internal_consistency_not_detection_accuracy"
