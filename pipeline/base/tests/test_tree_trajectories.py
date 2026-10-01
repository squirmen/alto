from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_tree_trajectories.py"
SPEC = importlib.util.spec_from_file_location("build_tree_trajectories", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_current_tree_outside_historic_coverage_is_not_persistent() -> None:
    present = {
        2013: np.array([False]),
        2016: np.array([False]),
        2024: np.array([True]),
    }
    heights = {
        2013: np.array([np.nan]),
        2016: np.array([np.nan]),
        2024: np.array([12.0]),
    }
    fate, masks = MODULE.classify_fates(present, heights, np.array([0.2]))
    assert fate.tolist() == ["outside_historic_coverage"]
    assert masks["historic_coverage"].tolist() == [False]


def test_prior_canopy_and_current_apex_is_persistent() -> None:
    present = {
        2013: np.array([True]),
        2016: np.array([True]),
        2024: np.array([True]),
    }
    heights = {
        2013: np.array([8.0]),
        2016: np.array([9.0]),
        2024: np.array([10.0]),
    }
    fate, _ = MODULE.classify_fates(present, heights, np.array([0.2]))
    assert fate.tolist() == ["persistent"]


def test_current_apex_over_historic_ground_is_established() -> None:
    present = {
        2013: np.array([False]),
        2016: np.array([False]),
        2024: np.array([True]),
    }
    heights = {
        2013: np.array([1.0]),
        2016: np.array([1.0]),
        2024: np.array([7.0]),
    }
    fate, _ = MODULE.classify_fates(present, heights, np.array([0.2]))
    assert fate.tolist() == ["established_since_2013"]


def test_optimal_assignment_beats_greedy_conflict() -> None:
    # The cheapest edge blocks a second match under greedy selection. Maximum-
    # cardinality assignment must instead retain two links.
    edges = [
        (1.0, 0, 0),
        (2.0, 0, 1),
        (2.0, 1, 0),
    ]
    assert MODULE.optimal_one_to_one(edges) == [(0, 1), (1, 0)]


def test_optimal_assignment_is_one_to_one_across_components() -> None:
    edges = [(0.2, 0, 0), (0.3, 1, 0), (0.1, 2, 3)]
    links = MODULE.optimal_one_to_one(edges)
    assert len({left for left, _ in links}) == len(links)
    assert len({right for _, right in links}) == len(links)
    assert links == [(0, 0), (2, 3)]


def test_stable_trajectory_id_is_order_independent() -> None:
    forward = {2013: (1.234, 5.678, 8.0), 2024: (2.0, 6.0, 9.0)}
    reverse = {2024: (2.0, 6.0, 9.0), 2013: (1.234, 5.678, 8.0)}
    assert MODULE.stable_trajectory_id(forward) == MODULE.stable_trajectory_id(reverse)
    assert MODULE.stable_trajectory_id(forward, "tree-1") != MODULE.stable_trajectory_id(forward)


def test_canonical_link_excludes_retired_inventory_rows() -> None:
    import sqlite3
    import tempfile
    from unittest.mock import patch
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / 'trees.sqlite'
        con = sqlite3.connect(db)
        con.executescript('''CREATE TABLE trees(tree_id TEXT PRIMARY KEY);
            INSERT INTO trees VALUES('current');
            CREATE TABLE tree_lidar_pilot(tree_id TEXT, x_2193 REAL, y_2193 REAL);
            INSERT INTO tree_lidar_pilot VALUES('retired',10,10),('current',12,10);''')
        con.close()
        with patch.object(MODULE, 'DB', db):
            linked = MODULE.link_canonical(np.array([10.]), np.array([10.]), (0,0,20,20))
        assert linked == {0: 'current'}
