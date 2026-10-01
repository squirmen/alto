#!/usr/bin/env python3
"""The sealed evaluation. Run once, on sites no configuration has ever seen.

Comparing two overlapping confidence intervals is the wrong test: the methods are run on
the same sites, so the comparison is paired and the pairing carries most of the
information. Sites differ from each other far more than methods differ on a site. So the
difference is bootstrapped directly, over sites, and reported with the share of resamples
in which this work leads.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

LAB = Path("/data/alto/working/seg_lab")
sys.path.insert(0, str(LAB))
import core        # noqa: E402

SPL = json.loads((LAB / "splits.json").read_text())
TEST = SPL["test_sites"]
DEV = SPL["dev_sites"]


def best_of(path: Path):
    rows = [json.loads(l) for l in path.read_text(errors="ignore").splitlines()
            if l.strip().startswith("{")]
    b = max(rows, key=lambda a: a["metrics"]["objective"])
    return core.Params(**b["params"]), b["metrics"]["objective"], len(rows)


def obj_from(per_site) -> float:
    rows = [r for s in per_site for r in s["labels"]]
    ious = [v for s in per_site for v in s["ious"]]
    if not rows:
        return 0.0
    sr = float(np.mean([r["n_inside"] == 1 for r in rows]))
    iu = float(np.median(ious)) if ious else 0.0
    return 0.0 if (sr + iu) == 0 else 2 * sr * iu / (sr + iu)


def main():
    sites = TEST if "--test" in sys.argv else DEV
    which = "SEALED TEST" if "--test" in sys.argv else "development"
    methods = {}
    for f in sorted(LAB.glob("ledger_base_*.jsonl")):
        methods[f.stem.replace("ledger_base_", "")] = best_of(f)
    methods["this work (exg)"] = best_of(LAB / "ledger_ch_exg.jsonl")
    methods["this work (NDVI)"] = best_of(LAB / "ledger_ch_ndvi.jsonl")
    methods["v4 default"] = (core.Params(), None, 0)

    per_method = {}
    print(f"{which}: {len(sites)} sites\n")
    print(f"{'method':22}{'tuned on dev':>14}{'objective':>11}{'single':>8}{'split':>7}"
          f"{'recall':>8}{'IoU':>7}{'dpl':>6}{'FP':>4}")
    for name, (p, dev_obj, n) in methods.items():
        per = [core.score_site(s, core.segment(core.load_site(s), p)) for s in sites]
        per_method[name] = per
        m = core.aggregate(per)
        d = f"{dev_obj:.4f}" if dev_obj else "-"
        print(f"{name:22}{d:>14}{m['objective']:11.4f}{m['singleton_rate']:8.3f}"
              f"{m['split_rate']:7.3f}{m['recall']:8.3f}{m['median_iou']:7.3f}"
              f"{m['det_per_label']:6.1f}{m['fp_hard_negative']:4d}")

    # paired bootstrap over sites
    print(f"\npaired bootstrap over the same {len(sites)} sites, 5000 resamples")
    print(f"{'this work vs':22}{'median diff':>13}{'95% interval':>22}{'leads in':>10}")
    rng = np.random.default_rng(7)
    idx = np.arange(len(sites))
    mine = per_method["this work (NDVI)"]
    for name, per in per_method.items():
        if name == "this work (NDVI)":
            continue
        diffs = []
        for _ in range(5000):
            pick = rng.choice(idx, size=len(idx), replace=True)
            diffs.append(obj_from([mine[i] for i in pick]) - obj_from([per[i] for i in pick]))
        d = np.array(diffs)
        print(f"{name:22}{np.median(d):13.4f}"
              f"{f'[{np.percentile(d, 2.5):+.4f}, {np.percentile(d, 97.5):+.4f}]':>22}"
              f"{(d > 0).mean():10.1%}")


if __name__ == "__main__":
    main()
