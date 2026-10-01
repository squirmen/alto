#!/usr/bin/env python3
"""The iteration loop. Reads the whole trial record, then proposes the next step.

Each iteration:
  1. loads every attempt and finding so far, including the failures and why they failed
  2. decides what to try next from that record rather than from a fixed grid
  3. evaluates on the development sites
  4. writes back the parameters, the score, why it was tried and what it showed

The proposal rules are deliberately simple and auditable. The point of the loop is the
accumulated record, not a clever optimiser: a search that cannot say why it tried
something is one nobody can check.

Guard: the objective is the harmonic mean of singleton rate and median IoU, so carpet-
bombing a site with detections lowers the score rather than raising it. Test sites are
never loaded.
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

# Round 1's answer, carried forward as the starting point rather than rediscovered.
ROUND2_SEED = None   # set below, once Params is known

ROUND1_BEST = core.Params(smooth_sigma_m=0.75, pitfill_size_m=1.0, min_height_m=3.0,
                          seed_min_height_m=3.0, win_a=1.0, win_b=0.1, win_min_m=1.0,
                          win_max_m=8.0, min_crown_area_m2=1.0, edge_trim_frac=0.3,
                          merge_saddle_frac=0.95, merge_max_area_m2=400.0)

# What the hand checks have established so far this round: the isolated greenness gate
# on repaired imagery, and an edge trim well past where the first grid stopped.
ROUND2_SEED = replace(ROUND1_BEST, green_exg_min=0.04, green_min_height_m=1.5,
                      edge_trim_frac=0.6, crown_close_m=0.5)

# What each knob may take. Ordered so neighbouring values are neighbouring ideas.
GRID = {
    "smooth_sigma_m":   [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0],
    "pitfill_size_m":   [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
    "min_height_m":     [1.5, 2.0, 2.5, 3.0, 4.0, 5.0],
    "seed_min_height_m":[1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 15.0, 18.0, 22.0],
    "win_a":            [0.0, 0.25, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0],
    "win_b":            [0.0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50],
    "win_min_m":        [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0],
    "win_max_m":        [4.0, 6.0, 8.0, 10.0, 12.0, 16.0, 20.0],
    "min_crown_area_m2":[0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 12.0],
    "edge_trim_frac":   [0.0, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8],
    "merge_saddle_frac":[0.0, 0.88, 0.92, 0.95, 0.97, 0.98, 0.99, 0.995],
    "merge_max_area_m2":[40.0, 60.0, 100.0, 250.0, 400.0, 600.0, 900.0, 1400.0, 2000.0, 3000.0],
    # round 2 axes
    "n_scales":         [1, 2, 3],
    "scale_step":       [1.5, 2.0, 3.0],
    # the gate, the trim and the boundary cost all read one channel. Excess green was
    # the only one available until the NIR survey was found; NDVI separates in-crown
    # from out-of-crown at 0.609 against its 0.475, and lawn from low canopy far better.
    "green_channel":    ["ndvi", "ndvi", "exg"],
    "green_exg_min":    [0.0, 0.03, 0.04, 0.06, 0.08, 0.12,
                         0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50],
    "green_min_height_m":[0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5],
    "green_isolated_only":[True, False],
    # both were measured harmful on the noisy, half-blank excess-green layer. That
    # measurement does not carry over to NDVI, so both are open again.
    "crown_green_trim":  [0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50],
    "boundary_img_weight":[0.0, 0.0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0],
    "method":            ["watershed", "watershed", "dalponte"],
    "dal_th_seed":       [0.3, 0.45, 0.6],
    "dal_th_crown":      [0.45, 0.55, 0.7],
    "dal_max_radius_m":  [3.0, 4.0, 5.0, 8.0, 12.0],
    # measured harmful (a circular cap cuts crown along its long axis); mostly off,
    # kept so the record can contradict the measurement if the rest of the space moves
    "radius_cap_a":      [0.0, 0.0, 0.0, 0.0, 2.0],
    "radius_cap_b":      [0.0, 0.0, 0.0, 0.0, 0.4],
    "crown_close_m":     [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0],
    "crown_fill_holes":  [True, False],
}


# A categorical axis cannot be left to a sampler weighted by past performance: a value
# that scored badly before the mechanisms existed never gets tried again after they do.
# SEG_METHOD pins one so it is explored on its own terms.
if os.environ.get("SEG_NO_IMAGERY"):
    # Auckland-wide LINZ imagery at working resolution is ~444,000 tiles. If the gain
    # survives without it, production does not need a single one.
    GRID["green_exg_min"] = [0.0]
    GRID["crown_green_trim"] = [0.0]
    GRID["boundary_img_weight"] = [0.0]

_CHAN = os.environ.get("SEG_CHANNEL")
if _CHAN:
    GRID["green_channel"] = [_CHAN]

_PIN = os.environ.get("SEG_METHOD")
if _PIN:
    GRID["method"] = [_PIN]


def _pinned(params):
    if _CHAN:
        params = replace(params, green_channel=_CHAN)
    """Force the pinned method onto every candidate.

    Constraining the grid alone did nothing: the seeds and every parent carry their own
    method, and a mutation only changes it when that knob is drawn. 2,400 attempts ran
    under a dalponte pin and every one of them was a watershed.
    """
    return replace(params, method=_PIN) if _PIN else params


def seen(attempts) -> set[str]:
    return {json.dumps(a["params"], sort_keys=True) for a in attempts}


def knob_preferences(attempts):
    """Mean objective achieved at each value of each knob, from the whole record."""
    import collections
    pref = {}
    for k in GRID:
        by = collections.defaultdict(list)
        for a in attempts:
            v = a["params"].get(k)
            if v is not None:
                by[v].append(a["metrics"]["objective"])
        if by:
            pref[k] = {v: sum(o) / len(o) for v, o in by.items()}
    return pref


def propose(attempts, rng) -> tuple[core.Params, str, str | None]:
    """Next configuration, chosen from the accumulated record.

    An earlier version only stepped one knob from the single best result, and once
    those neighbours were exhausted it restarted at random for a thousand attempts.
    This samples a parent from the leading configurations, moves one to three knobs,
    and prefers values that have done well before, while still reaching for anything
    never tried.
    """
    done = seen(attempts)
    if _PIN:
        globals()["ROUND1_BEST"] = replace(ROUND1_BEST, method=_PIN)
        globals()["ROUND2_SEED"] = replace(ROUND2_SEED, method=_PIN)
    if not attempts:
        return (core.Params(), "round 2 baseline: the v4-like watershed, rescored with mask IoU "
                               "so this round has its own comparable zero", None)
    if len(attempts) == 1:
        return (ROUND1_BEST, "round 1's best configuration under the corrected scorer: the "
                             "reference every round 2 attempt has to beat", None)
    if len(attempts) == 2:
        return (ROUND2_SEED,
                "round 1 best plus the greenness gate, which recovered small crowns from 0.522 to "
                "0.587 singleton in the hand check without costing IoU", None)

    ranked = sorted(attempts, key=lambda a: -a["metrics"].get("objective", -1))
    pref = knob_preferences(attempts)

    # unexplored values first: an unmapped part of an axis is worth more than another
    # step along one already covered
    tried = {k: {a["params"].get(k) for a in attempts} for k in GRID}
    for k, vals in GRID.items():
        new_vals = [v for v in vals if v not in tried[k]]
        if new_vals:
            v = rng.choice(new_vals)
            parent = ranked[rng.randrange(min(5, len(ranked)))]
            cand = replace(core.Params(**parent["params"]), **{k: v})
            if json.dumps(asdict(cand), sort_keys=True) not in done:
                return (cand, f"{k}={v} has never been tried; the record shows the axis "
                              f"trending that way, so this extends it from {parent['name']}",
                        parent["name"])

    # otherwise mutate a strong parent on one to three knobs, biased by what has worked
    for _ in range(400):
        parent = ranked[rng.randrange(min(12, len(ranked)))]
        cand = core.Params(**parent["params"])
        n_moves = rng.choice([1, 1, 2, 3])
        moved = []
        for _ in range(n_moves):
            k = rng.choice(list(GRID))
            vals = GRID[k]
            if rng.random() < 0.6 and k in pref and pref[k]:
                # weight toward values that have scored well, without ignoring the rest
                scores = [pref[k].get(v, min(pref[k].values())) for v in vals]
                lo = min(scores)
                w = [max(s - lo, 1e-6) ** 3 for s in scores]
                v = rng.choices(vals, weights=w, k=1)[0]
            else:
                cur = getattr(cand, k)
                i = vals.index(cur) if cur in vals else rng.randrange(len(vals))
                v = vals[max(0, min(len(vals) - 1, i + rng.choice([-1, 1])))]
            if v != getattr(cand, k):
                cand = replace(cand, **{k: v})
                moved.append(f"{k}->{v}")
        if moved and json.dumps(asdict(cand), sort_keys=True) not in done:
            return (cand, f"from {parent['name']} (obj {parent['metrics']['objective']:.4f}), "
                          f"moved {', '.join(moved)}; values weighted by their mean objective "
                          f"across all {len(attempts)} attempts", parent["name"])

    cand = core.Params(**{k: rng.choice(v) for k, v in GRID.items()})
    return cand, "every neighbour of the leading configurations is already in the record; restart", None


def boundary_audit(attempts, top_n: int = 40) -> dict:
    """Which axes are pinned at an end of their grid in the leading configurations.

    A boundary optimum is not an optimum, it is an unfinished grid. This round found
    twelve of them at once; round 1 lost a thousand attempts to a single one.
    """
    import collections
    top = sorted(attempts, key=lambda a: -a["metrics"].get("objective", -1))[:top_n]
    out = {}
    if not top:
        return out
    for k, vals in GRID.items():
        uniq = list(dict.fromkeys(vals))
        if len(uniq) < 3:
            continue
        c = collections.Counter(a["params"].get(k) for a in top)
        for end, v in (("low", uniq[0]), ("high", uniq[-1])):
            if c[v] / len(top) >= 0.5:
                out[k] = f"{end} {v} in {c[v] / len(top):.0%}"
    return out


def lesson_from(metrics, attempts, parent_name) -> str:
    parent = next((a for a in attempts if a["name"] == parent_name), None)
    if not parent:
        return (f"singleton {metrics['singleton_rate']}, split {metrics['split_rate']}, "
                f"IoU {metrics['median_iou']}, {metrics['det_per_label']} detections per label")
    d = metrics["objective"] - parent["metrics"]["objective"]
    lo, hi = metrics["objective_ci95"]
    plo, phi = parent["metrics"]["objective_ci95"]
    overlap = not (lo > phi or hi < plo)
    verdict = ("within the confidence interval of its parent, so not distinguishable"
               if overlap else ("clear improvement" if d > 0 else "clear regression"))
    return (f"objective {d:+.4f} against {parent_name}: {verdict}. "
            f"singleton {metrics['singleton_rate']}, split {metrics['split_rate']}, "
            f"IoU {metrics['median_iou']}, {metrics['det_per_label']} detections per label")


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 0)
    for _ in range(n):
        attempts = ledger.attempts()             # the whole record, every time
        it = ledger.next_iteration()
        params, rationale, parent = propose(attempts, rng)
        params = _pinned(params)
        m = core.evaluate(params, DEV)
        m.pop("per_site", None)
        name = f"it{it:04d}_{os.getpid()%1000:03d}_{rng.randrange(1000):03d}"
        ledger.log_attempt(iteration=it, name=name, params=params, metrics=m,
                           parent=parent, rationale=rationale,
                           lesson=lesson_from(m, attempts, parent), sites=DEV)
        best = ledger.best()
        if it % 200 == 0:
            pins = boundary_audit(ledger.attempts())
            if pins:
                print(f"  [boundary] still pinned: {pins}", flush=True)
        print(f"it{it:04d} obj={m['objective']:.4f} "
              f"(single {m['singleton_rate']:.3f} split {m['split_rate']:.3f} "
              f"iou {m['median_iou']:.3f} dpl {m['det_per_label']:.1f})  "
              f"best={best['metrics']['objective']:.4f} [{best['name']}]", flush=True)


if __name__ == "__main__":
    main()
