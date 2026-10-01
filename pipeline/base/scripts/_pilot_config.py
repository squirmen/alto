"""Single source of truth for the active pilot bounding box.

Each pipeline script that used to hard-code ``DEFAULT_PILOT_BBOX_2193`` now
calls :func:`active_pilot_bbox` instead. Switch pilots by either:

1. Editing ``config/pilots.json`` (set the ``"default"`` key), or
2. Setting the ``AKL_TREES_PILOT`` env var to a named entry, e.g.
   ``AKL_TREES_PILOT=auckland_isthmus_v1 make end-to-end-pilot``.

This avoids touching every script when we expand from Waitemata to
Auckland Isthmus to full metro.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "pilots.json"


def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {
            "default": "waitemata_v1",
            "pilots": {
                "waitemata_v1": {
                    "bbox_2193": [1_751_000.0, 5_914_000.0, 1_762_000.0, 5_925_000.0],
                    "area_km2": 121.0,
                    "label": "Waitemata (fallback)",
                }
            }
        }
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def active_pilot_name() -> str:
    env = os.environ.get("AKL_TREES_PILOT")
    if env:
        return env
    return _load_config().get("default", "waitemata_v1")


def active_pilot() -> dict:
    cfg = _load_config()
    name = active_pilot_name()
    pilots = cfg.get("pilots") or {}
    if name not in pilots:
        raise KeyError(
            f"Active pilot '{name}' not found in config/pilots.json. "
            f"Available: {sorted(pilots.keys())}"
        )
    return {"name": name, **pilots[name]}


def active_pilot_bbox() -> tuple[float, float, float, float]:
    bb = active_pilot()["bbox_2193"]
    return tuple(float(v) for v in bb)


# Backward-compatible constant for scripts that still expect a module-level
# tuple. Callers should prefer ``active_pilot_bbox()`` for forward
# compatibility, but this lets us slot the helper into existing
# ``from _pilot_config import DEFAULT_PILOT_BBOX_2193`` imports cheaply.
DEFAULT_PILOT_BBOX_2193 = active_pilot_bbox()
