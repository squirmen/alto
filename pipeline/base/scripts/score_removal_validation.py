#!/usr/bin/env python3
"""Score WS2 removal precision from human labels (removal_labels.json from the review UI).

precision = removed / (removed + present)  — "unsure" excluded. Reports per confidence tier
with a Wilson 95% CI (a sample-based precision needs error bars). Writes docs/validation/.

Usage:
    python scripts/score_removal_validation.py --labels ~/Downloads/removal_labels.json
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "validation" / "removal_precision.md"


def wilson(k: int, n: int) -> tuple[float, float, float]:
    if n == 0:
        return (0.0, 0.0, 0.0)
    z, p = 1.96, k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return p, max(0.0, center - half), min(1.0, center + half)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", type=Path, required=True)
    args = ap.parse_args()
    data = json.loads(args.labels.read_text(encoding="utf-8"))

    tier = defaultdict(lambda: {"removed": 0, "present": 0, "unsure": 0})
    for r in data.get("labels", []):
        if r.get("label"):
            tier[r["confidence"]][r["label"]] += 1

    def line(name, c):
        scored = c["removed"] + c["present"]
        p, lo, hi = wilson(c["removed"], scored)
        return (f"| {name} | {c['removed']} | {c['present']} | {c['unsure']} | {scored} | "
                f"**{p:.0%}** | {lo:.0%}–{hi:.0%} |")

    total = {"removed": 0, "present": 0, "unsure": 0}
    for c in tier.values():
        for k in total:
            total[k] += c[k]

    rows = ["| Tier | removed | present | unsure | scored | precision | 95% CI |",
            "|---|--:|--:|--:|--:|--:|--:|"]
    for t in ("high", "medium", "low"):
        if sum(tier[t].values()):
            rows.append(line(t, tier[t]))
    rows.append(line("**all**", total))

    n_lab = sum(sum(c.values()) for c in tier.values())
    lines = [
        "# WS2 removal precision — aerial validation", "",
        f"_From {n_lab} human-labelled removals (review UI vs recent aerial). "
        f"Precision = removed / (removed + present); 'unsure' excluded._", "",
        *rows, "",
        "Interpretation: precision is the share of `removed_to_open` candidates that are genuinely "
        "gone (vs. a surviving tree the LiDAR missed). Use the **high-tier** precision as the "
        "headline figure for the tree-loss paper; report the CI.",
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(rows))
    print(f"\nreport -> {OUT}")


if __name__ == "__main__":
    main()
