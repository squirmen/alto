#!/usr/bin/env python3
"""Tune each published algorithm on the same development sites, with the same budget.

Comparing a tuned method against textbook defaults proves nothing about the method. So
every comparator gets its own search over exactly the knobs that algorithm has, the same
number of attempts, the same scorer, the same sites. What it does not get is any of the
mechanisms added here - the greenness gate, the saddle merge, the edge trim, the crown
closing - because those are the contribution, not the baseline.

Each profile keeps its own ledger so the rankings never mix.
"""
from __future__ import annotations

import json
import os
import random
import sys
from dataclasses import asdict, replace
from pathlib import Path

LAB = Path("/data/alto/working/seg_lab")
sys.path.insert(0, str(LAB))

import core            # noqa: E402
import ledger          # noqa: E402

DEV = json.loads((LAB / "splits.json").read_text())["dev_sites"]

# Knobs every raster ITD method shares: how the height model is prepared and how
# treetops are found. Published methods differ only in how crowns are then delineated.
COMMON = {
    "smooth_sigma_m":   [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0],
    "pitfill_size_m":   [0.0, 0.5, 1.0, 1.5, 2.0, 3.0],
    "min_height_m":     [1.5, 2.0, 2.5, 3.0, 4.0, 5.0],
    "seed_min_height_m":[2.0, 3.0, 4.0, 5.0, 6.0],
    "win_a":            [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    "win_b":            [0.0, 0.05, 0.10, 0.15, 0.20, 0.30],
    "win_min_m":        [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    "win_max_m":        [4.0, 6.0, 8.0, 10.0, 12.0, 16.0],
    "min_crown_area_m2":[0.25, 0.5, 1.0, 2.0, 4.0, 8.0],
}

PROFILES = {
    # marker-controlled watershed on the CHM: the standard, and what ALTO v4 does
    "watershed": (dict(COMMON), {"method": "watershed"}),
    "dalponte":  (dict(COMMON, dal_th_seed=[0.2, 0.3, 0.45, 0.6, 0.7],
                               dal_th_crown=[0.35, 0.45, 0.55, 0.7, 0.8],
                               dal_max_radius_m=[3.0, 5.0, 8.0, 12.0, 16.0]),
                  {"method": "dalponte"}),
    "silva":     (dict(COMMON, silva_r_frac=[0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
                  {"method": "silva"}),
    "li":        (dict(COMMON), {"method": "li"}),
}


def propose(grid, fixed, attempts, rng):
    done = {json.dumps(a["params"], sort_keys=True) for a in attempts}
    if not attempts:
        return core.Params(**fixed), "textbook defaults for this algorithm", None
    ranked = sorted(attempts, key=lambda a: -a["metrics"].get("objective", -1))
    tried = {k: {a["params"].get(k) for a in attempts} for k in grid}
    for k, vals in grid.items():
        new = [v for v in vals if v not in tried[k]]
        if new:
            parent = ranked[rng.randrange(min(5, len(ranked)))]
            cand = replace(core.Params(**parent["params"]), **{k: rng.choice(new)}, **fixed)
            if json.dumps(asdict(cand), sort_keys=True) not in done:
                return cand, f"{k} has an unexplored value", parent["name"]
    for _ in range(400):
        parent = ranked[rng.randrange(min(12, len(ranked)))]
        cand = core.Params(**parent["params"])
        moved = []
        for _ in range(rng.choice([1, 1, 2, 3])):
            k = rng.choice(list(grid))
            v = rng.choice(grid[k])
            if v != getattr(cand, k):
                cand = replace(cand, **{k: v}); moved.append(f"{k}->{v}")
        cand = replace(cand, **fixed)
        if moved and json.dumps(asdict(cand), sort_keys=True) not in done:
            return cand, f"from {parent['name']}, moved {', '.join(moved)}", parent["name"]
    return core.Params(**{k: rng.choice(v) for k, v in grid.items()}, **fixed), "restart", None


def main():
    profile = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 400
    rng = random.Random(int(sys.argv[3]) if len(sys.argv) > 3 else 0)
    grid, fixed = PROFILES[profile]
    ledger.LEDGER = LAB / f"ledger_base_{profile}.jsonl"
    for _ in range(n):
        ats = ledger.attempts()
        it = ledger.next_iteration()
        params, why, parent = propose(grid, fixed, ats, rng)
        m = core.evaluate(params, DEV)
        m.pop("per_site", None)
        ledger.log_attempt(iteration=it, name=f"{profile}{it:04d}_{os.getpid()%1000:03d}",
                           params=params, metrics=m, parent=parent, rationale=why,
                           lesson=f"objective {m['objective']}", sites=DEV)
    b = ledger.best()
    print(f"{profile}: {len(ledger.attempts())} attempts, best {b['metrics']['objective']}", flush=True)


if __name__ == "__main__":
    main()
