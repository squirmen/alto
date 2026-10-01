from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "train_species_class_cnn.py"
SPEC = importlib.util.spec_from_file_location("train_species_class_cnn", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_low_score_abstains_and_preserves_raw_growth_form() -> None:
    probabilities = np.array(
        [
            [0.70, 0.10, 0.10, 0.10],
            [0.05, 0.05, 0.85, 0.05],
        ]
    )
    published, raw, scores, abstained = MODULE.abstaining_predictions(
        probabilities, threshold=0.80
    )
    assert published == ["unknown", "conifer"]
    assert raw == ["evergreen_broadleaf", "conifer"]
    np.testing.assert_allclose(scores, [0.70, 0.85])
    assert abstained.tolist() == [True, False]
