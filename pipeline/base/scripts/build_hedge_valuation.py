#!/usr/bin/env python3
"""Classify hedge low-canopy candidates and value the hedge segments.

Two actions:
  1. Tag every `tree_low_canopy_candidates` row that sits on a detected hedge
     centreline (within HEDGE_NEAR_M) with is_hedge = 1, so the candidate-
     promotion step treats it as screening vegetation, not an individual tree.
  2. Give each hedge segment (`tree_pointcloud_hedges_pilot`) an ecosystem-
     services value from its canopy footprint, using the SAME documented unit
     prices as the tree valuation (area-based stormwater + air-quality, plus a
     conservative volume-based carbon estimate). Cooling is omitted in v1 (it
     needs per-location air temperature the hedge layer doesn't carry yet).

Hedges are a distinct asset type: valued, but NOT added to the tree count.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from pyproj import Transformer
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
SQLITE_PATH = ROOT / "data" / "processed" / "akl_trees.sqlite"
TO_2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)

HEDGE_NEAR_M = 3.0
# Unit prices / rates — kept identical to VALUATION_ASSUMPTIONS in
# build_tree_valuation.py so hedge dollars are comparable to tree dollars.
RAINFALL_M = 1.240
INTERCEPT_FRACTION = 0.18          # evergreen-broadleaf (hedges are dense evergreen)
RUNOFF_COEFFICIENT = 0.45          # mixed pervious/impervious urban surrounds
STORMWATER_NZD_PER_M3 = 3.50
LAI = 4.0                          # dense clipped hedge ~ evergreen broadleaf
PM25_KG_PER_M2_LAI_Y = 0.008
PM25_NZD_PER_KG = 25.0
# Hedges are mostly foliage + fine twigs, not woody trunk — far lower biomass
# density than a tree. Conservative green-biomass density for clipped hedge.
HEDGE_BIOMASS_KG_PER_M3 = 5.0
CARBON_FRACTION = 0.47
CO2_PER_C = 44.0 / 12.0
SEQUESTRATION_FRACTION_Y = 0.015
CARBON_PRICE_NZD_PER_TCO2E = 50.0
METHOD_ID = "hedge_valuation_v1_canopy_area"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def main() -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row

    # ---- 1. Tag low-canopy candidates that lie on a hedge.
    hedges = conn.execute(
        "SELECT hedge_id, length_m, width_m, mean_height_m, lon1, lat1, lon2, lat2 "
        "FROM tree_pointcloud_hedges_pilot").fetchall()
    # Densify hedge centrelines to ~1 m points for a nearest-distance test.
    pts, owner = [], []
    for h in hedges:
        x1, y1 = TO_2193.transform(h["lon1"], h["lat1"])
        x2, y2 = TO_2193.transform(h["lon2"], h["lat2"])
        n = max(2, int(np.hypot(x2 - x1, y2 - y1)) + 1)
        for t in np.linspace(0, 1, n):
            pts.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
            owner.append(h["hedge_id"])
    hedge_kd = cKDTree(np.array(pts)) if pts else None

    cand = conn.execute(
        "SELECT candidate_id, x_2193, y_2193 FROM tree_low_canopy_candidates").fetchall()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(tree_low_canopy_candidates)")}
    if "is_hedge" not in cols:
        conn.execute("ALTER TABLE tree_low_canopy_candidates ADD COLUMN is_hedge INTEGER DEFAULT 0")
    conn.execute("UPDATE tree_low_canopy_candidates SET is_hedge = 0")
    n_hedge_cand = 0
    if hedge_kd is not None and cand:
        cxy = np.array([[c["x_2193"], c["y_2193"]] for c in cand])
        d, _ = hedge_kd.query(cxy, k=1)
        on_hedge = d <= HEDGE_NEAR_M
        conn.executemany(
            "UPDATE tree_low_canopy_candidates SET is_hedge = 1 WHERE candidate_id = ?",
            [(cand[i]["candidate_id"],) for i in np.nonzero(on_hedge)[0]])
        n_hedge_cand = int(on_hedge.sum())

    # ---- 2. Value each hedge segment.
    new_cols = {
        "canopy_area_m2": "REAL", "avoided_runoff_m3_y": "REAL",
        "stormwater_value_nzd_y": "REAL", "pm25_removed_kg_y": "REAL",
        "air_quality_value_nzd_y": "REAL", "stored_co2e_tonnes_est": "REAL",
        "carbon_value_nzd_y": "REAL", "total_value_nzd_y": "REAL",
        "valuation_method_id": "TEXT",
    }
    hcols = {r[1] for r in conn.execute("PRAGMA table_info(tree_pointcloud_hedges_pilot)")}
    for name, typ in new_cols.items():
        if name not in hcols:
            conn.execute(f"ALTER TABLE tree_pointcloud_hedges_pilot ADD COLUMN {name} {typ}")

    totals = {"runoff": 0.0, "storm": 0.0, "pm": 0.0, "co2_stored": 0.0, "value": 0.0}
    for h in hedges:
        area = float(h["length_m"]) * float(h["width_m"])
        volume = area * float(h["mean_height_m"])
        avoided_m3 = area * RAINFALL_M * INTERCEPT_FRACTION * RUNOFF_COEFFICIENT
        storm = avoided_m3 * STORMWATER_NZD_PER_M3
        pm_kg = area * LAI * PM25_KG_PER_M2_LAI_Y
        pm_val = pm_kg * PM25_NZD_PER_KG
        biomass = volume * HEDGE_BIOMASS_KG_PER_M3
        co2e_kg = biomass * CARBON_FRACTION * CO2_PER_C
        stored_t = co2e_kg / 1000.0
        carbon_val_y = stored_t * SEQUESTRATION_FRACTION_Y * CARBON_PRICE_NZD_PER_TCO2E
        total = storm + pm_val + carbon_val_y
        conn.execute(
            """UPDATE tree_pointcloud_hedges_pilot SET canopy_area_m2=?, avoided_runoff_m3_y=?,
               stormwater_value_nzd_y=?, pm25_removed_kg_y=?, air_quality_value_nzd_y=?,
               stored_co2e_tonnes_est=?, carbon_value_nzd_y=?, total_value_nzd_y=?, valuation_method_id=?
               WHERE hedge_id=?""",
            (round(area, 1), round(avoided_m3, 2), round(storm, 2), round(pm_kg, 3),
             round(pm_val, 2), round(stored_t, 3), round(carbon_val_y, 2),
             round(total, 2), METHOD_ID, h["hedge_id"]))
        totals["runoff"] += avoided_m3
        totals["storm"] += storm
        totals["pm"] += pm_kg
        totals["co2_stored"] += stored_t
        totals["value"] += total
    conn.commit()
    conn.close()

    print(f"Hedge segments valued: {len(hedges):,}")
    print(f"Low-canopy candidates tagged on hedges: {n_hedge_cand:,}")
    print(f"Hedge ecosystem value: NZD {totals['value']:,.0f}/yr "
          f"(stormwater {totals['storm']:,.0f} + air-quality + carbon)")
    print(f"  avoided runoff {totals['runoff']:,.0f} m³/yr, "
          f"PM2.5 removed {totals['pm']:,.0f} kg/yr, stored {totals['co2_stored']:,.0f} tCO₂e")


if __name__ == "__main__":
    main()
