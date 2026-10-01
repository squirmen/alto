#!/usr/bin/env python3
"""WS1×WS2 — draw a stratified validation sample of WS2 `removed_to_open` trees.

Picks a random sample per confidence tier so we can measure the PRECISION of the removal
signal against aerial imagery (human-in-the-loop; automated scoring would just re-do tree
detection on RGB — circular). Emits a manifest the review UI (web/validation/removal_review.html)
loads. Score the returned labels with scripts/score_removal_validation.py.

Usage:
    python scripts/build_removal_validation_sample.py [--per-tier 120] [--seed 42]
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_tree_trajectories import removal_confidence  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT = ROOT / "web" / "validation" / "removal_sample.json"
TILES_OUT = ROOT / "web" / "validation" / "linz_tiles.json"  # gitignored (embeds the key)

# LINZ Data Service aerial layers via the koordinates CDN XYZ endpoint.
LINZ_LAYERS = {"before_2016": 88142,   # Auckland 0.075m Urban Aerial Photos (2015-2016)
               "after_2024": 121752}   # Auckland 0.075m Urban Aerial Photos (2024-2025)


def linz_api_key() -> str | None:
    key = os.environ.get("LINZ_API_KEY")
    if key:
        return key
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("LINZ_API_KEY="):
                return line.split("=", 1)[1].strip()
    return None


def write_linz_tiles() -> bool:
    """Write before/after LINZ aerial tile templates for the review UI (key embedded → gitignored)."""
    key = linz_api_key()
    if not key:
        return False
    base = "https://tiles-cdn.koordinates.com/services;key=%s/tiles/v4/layer=%d/EPSG:3857/{z}/{x}/{y}.png"
    TILES_OUT.write_text(json.dumps({k: base % (key, lid) for k, lid in LINZ_LAYERS.items()}), encoding="utf-8")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-tier", type=int, default=120)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    con = sqlite3.connect(DB)
    rows = con.execute(
        "SELECT trajectory_id, lon, lat, present_2013, present_2016, h_2013, h_2016, implausible "
        "FROM tree_trajectory_pilot WHERE fate='removed_to_open'").fetchall()
    con.close()

    tiers: dict[str, list] = {"high": [], "medium": [], "low": []}
    for r in rows:
        tiers[removal_confidence(r[3], r[4], r[6], r[7])].append(r)

    rng = random.Random(args.seed)
    sample = []
    for tier, pool in tiers.items():
        rng.shuffle(pool)
        for r in pool[:args.per_tier]:
            seen = "2013 & 2016" if (r[3] and r[4]) else ("2016" if r[4] else "2013")
            sample.append({"id": r[0], "lon": round(r[1], 6), "lat": round(r[2], 6),
                           "confidence": tier, "h_2016": (round(r[6], 1) if r[6] else None),
                           "h_2013": (round(r[5], 1) if r[5] else None), "seen": seen})
    rng.shuffle(sample)  # interleave tiers so the rater isn't biased by runs of one tier

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fate": "removed_to_open", "n": len(sample),
        "tier_pool": {k: len(v) for k, v in tiers.items()}, "sample": sample}, indent=0),
        encoding="utf-8")

    has_linz = write_linz_tiles()
    print(f"pool by tier: { {k: len(v) for k, v in tiers.items()} }")
    print(f"wrote {len(sample):,} sampled removals → {OUT}")
    print(f"LINZ 2016/2024 before-after layers: {'enabled (linz_tiles.json)' if has_linz else 'NOT set (no LINZ_API_KEY) — ESRI recent only'}")
    print("Open web/validation/removal_review.html (served from repo root) to label them.")


if __name__ == "__main__":
    main()
