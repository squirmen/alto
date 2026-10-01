#!/usr/bin/env python3
"""WS1 — internal sensor-consistency assessment.

This is diagnostic evidence, not independent accuracy validation:

  1. CANOPY EVIDENCE AGREEMENT at inventory/register/surveillance locations, stratified
     by source and structural band, with CHM and point-cloud coverage denominators.

  2. HEIGHT CROSS-SENSOR AGREEMENT — CHM crown height vs point-cloud canopy-top height
     (two independent measures) → RMSE / bias by height band. (True height validation
     needs field DBH/height; see docs/research_programme.md WS1 gap.)

  3. SPECIES / GROWTH-FORM scaffold — collapses known species to the 4 model classes and
     checks whether CNN predictions exist on labelled trees (they do not, currently — the
     model only scored unlabelled inferred trees), so it reports the gap + class balance.

Pure stdlib + numpy + scipy. No GPU, no network. Writes a Markdown + JSON report to
docs/validation/.

Usage:
    python scripts/build_accuracy_assessment.py [--radius 5] [--db PATH]
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

try:
    from scipy.spatial import cKDTree  # noqa: F401
except ImportError:  # pragma: no cover
    raise SystemExit("scipy is required (conda env 'main'). Run with the geospatial python.")

ROOT = Path(__file__).resolve().parents[1]
DB_DEFAULT = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT_DIR = ROOT / "docs" / "validation"

REFERENCE_SOURCES = ("tree_register_points", "notable_trees_overlay", "ruru_obskauri_tiaki_public")
MACHINE_SOURCE = "lidar_inferred_canopy"

# Local equirectangular projection (consistent for both sets; metres for nearby points).
LAT0 = -36.85
LON0 = 174.76
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))

HEIGHT_BANDS = [(0, 3, "<3m (sub-canopy)"), (3, 8, "3-8m"), (8, 15, "8-15m"),
                (15, 25, "15-25m"), (25, 1e9, "25m+")]
RADII = (3.0, 5.0, 8.0)

# Coarse genus -> growth-form class map (scaffold; refine in WS1 phase 2).
CONIFER_GENERA = {"pinus", "cupressus", "agathis", "podocarpus", "dacrydium", "sequoia",
                  "sequoiadendron", "cedrus", "araucaria", "cryptomeria", "thuja", "taxodium",
                  "metasequoia", "callitris", "libocedrus", "prumnopitys", "phyllocladus",
                  "dacrycarpus", "cupressocyparis", "chamaecyparis", "juniperus", "picea", "abies"}
PALM_GENERA = {"phoenix", "howea", "rhopalostylis", "washingtonia", "archontophoenix",
               "trachycarpus", "butia", "syagrus", "livistona", "cordyline"}  # cordyline ~palm-form
DECIDUOUS_GENERA = {"quercus", "platanus", "liquidambar", "acer", "betula", "fraxinus", "ulmus",
                    "prunus", "malus", "pyrus", "tilia", "populus", "salix", "juglans", "carya",
                    "fagus", "ginkgo", "gleditsia", "robinia", "celtis", "zelkova", "magnolia",
                    "jacaranda", "catalpa", "sorbus", "alnus", "aesculus", "morus"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def to_xy(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    return np.column_stack([(lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT])


def height_band(h: float | None) -> str:
    if h is None or not np.isfinite(h):
        return "no-CHM"
    for lo, hi, label in HEIGHT_BANDS:
        if lo <= h < hi:
            return label
    return "no-CHM"


def growth_form(latin: str | None) -> str | None:
    if not latin:
        return None
    genus = latin.strip().split()[0].lower()
    if genus in CONIFER_GENERA:
        return "conifer"
    if genus in PALM_GENERA:
        return "palm_other"
    if genus in DECIDUOUS_GENERA:
        return "deciduous_broadleaf"
    return "evergreen_broadleaf"  # default for unmatched broadleaf


def load(db: Path) -> dict:
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    # Inventory/reference locations + per-tree cross-sensor evidence. These
    # sources are not assumed to be a current, complete or field-verified census.
    q_ver = f"""
        SELECT t.tree_id, t.source_primary, t.owner_class, t.species_latin,
               COALESCE(c.crown_max_chm_m, l.chm_at_point_m) AS chm_h,
               COALESCE(l.likely_canopy_ge_3m, 0) AS chm_canopy,
               CASE WHEN l.tree_id IS NOT NULL THEN 1 ELSE 0 END AS chm_covered,
               CASE WHEN l.chm_local_max_2m_m IS NOT NULL THEN 1 ELSE 0 END AS has_localmax,
               COALESCE(p.pc_canopy_present, 0) AS pc_present,
               CASE WHEN p.tree_id IS NOT NULL AND p.pointcloud_class != 'no_data'
                    THEN 1 ELSE 0 END AS pc_covered
        FROM trees t
        LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
        LEFT JOIN tree_lidar_pilot l ON l.tree_id = t.tree_id
        LEFT JOIN tree_pointcloud_pilot p ON p.tree_id = t.tree_id
        WHERE t.source_primary IN ({','.join('?' for _ in REFERENCE_SOURCES)})
          AND t.lon IS NOT NULL AND t.lat IS NOT NULL
    """
    references = cur.execute(q_ver, REFERENCE_SOURCES).fetchall()
    machine_n = cur.execute(
        "SELECT COUNT(*) FROM trees WHERE source_primary = ?", (MACHINE_SOURCE,)).fetchone()[0]

    # Height cross-sensor agreement: trees with BOTH a CHM crown height and a point-cloud canopy top.
    height_pairs = cur.execute(
        """SELECT c.crown_max_chm_m AS chm, p.canopy_top_m AS pc
           FROM tree_crown_pilot c JOIN tree_pointcloud_pilot p ON p.tree_id = c.tree_id
           WHERE c.crown_max_chm_m IS NOT NULL AND p.canopy_top_m IS NOT NULL
             AND c.crown_max_chm_m > 0 AND p.canopy_top_m > 0"""
    ).fetchall()

    # Known-species set + overlap with CNN predictions.
    known = cur.execute(
        """SELECT species_latin FROM trees
           WHERE species_latin IS NOT NULL AND species_latin <> '' AND species_latin NOT LIKE '%nknown%'"""
    ).fetchall()
    pred_on_known = cur.execute(
        """SELECT COUNT(*) FROM tree_species_class_predictions p
           JOIN trees t ON t.tree_id = p.tree_id
           WHERE t.species_latin IS NOT NULL AND t.species_latin <> ''
             AND t.species_latin NOT LIKE '%nknown%'"""
    ).fetchone()[0]

    con.close()
    return {"references": references, "machine_n": machine_n, "height_pairs": height_pairs,
            "known": known, "pred_on_known": pred_on_known}


def detection_assessment(references, machine_n) -> dict:
    """Summarise canopy evidence at reference locations, conditional on coverage."""
    bands = [height_band(r["chm_h"]) for r in references]
    owners = [(r["owner_class"] or "unknown") for r in references]
    sources = [r["source_primary"] for r in references]
    chm = np.array([r["chm_canopy"] for r in references], int)
    chm_cov = np.array([r["chm_covered"] for r in references], int)
    pc = np.array([r["pc_present"] for r in references], int)
    pc_cov = np.array([r["pc_covered"] for r in references], int)
    n = len(references)

    def conditional_rate(values: np.ndarray, coverage: np.ndarray) -> float | None:
        covered = coverage == 1
        return float(values[covered].mean()) if covered.any() else None

    def by(keys):
        agg = defaultdict(lambda: [0, 0, 0, 0, 0])
        for k, pc_value, chm_value, pc_has_data, chm_has_data in zip(
            keys, pc, chm, pc_cov, chm_cov
        ):
            agg[k][0] += 1
            agg[k][1] += int(pc_value and pc_has_data)
            agg[k][2] += int(chm_value and chm_has_data)
            agg[k][3] += int(pc_has_data)
            agg[k][4] += int(chm_has_data)
        return {
            k: {
                "n": values[0],
                "pc_canopy_rate_when_covered": (
                    values[1] / values[3] if values[3] else None
                ),
                "pc_coverage": values[3] / values[0],
                "chm_canopy_rate_when_covered": (
                    values[2] / values[4] if values[4] else None
                ),
                "chm_coverage": values[4] / values[0],
            }
            for k, values in sorted(agg.items())
        }

    return {
        "n_reference_locations": n,
        "n_machine": machine_n,
        "interpretation": "internal_consistency_not_detection_accuracy",
        "overall": {
            "pc_canopy_rate_when_covered": conditional_rate(pc, pc_cov),
            "pc_coverage": float(pc_cov.mean()),
            "chm_canopy_rate_when_covered": conditional_rate(chm, chm_cov),
            "chm_coverage": float(chm_cov.mean()),
        },
        "by_height_band": by(bands), "by_owner_class": by(owners), "by_source": by(sources),
    }


def height_agreement(height_pairs) -> dict:
    chm = np.array([r["chm"] for r in height_pairs], float)
    pc = np.array([r["pc"] for r in height_pairs], float)
    diff = chm - pc  # CHM minus point-cloud canopy top
    out = {"n": int(len(diff)), "overall": {
        "rmse_m": float(np.sqrt(np.mean(diff ** 2))),
        "mae_m": float(np.mean(np.abs(diff))),
        "bias_m": float(np.mean(diff)),
        "r": float(np.corrcoef(chm, pc)[0, 1]) if len(diff) > 2 else None,
    }, "by_height_band": {}}
    bands = np.array([height_band(h) for h in pc])
    for _, _, label in HEIGHT_BANDS:
        m = bands == label
        if m.sum() >= 30:
            d = diff[m]
            out["by_height_band"][label] = {
                "n": int(m.sum()), "rmse_m": float(np.sqrt(np.mean(d ** 2))),
                "bias_m": float(np.mean(d))}
    return out


def species_scaffold(known, pred_on_known) -> dict:
    forms = defaultdict(int)
    for r in known:
        f = growth_form(r["species_latin"])
        if f:
            forms[f] += 1
    return {"n_known_species": len(known), "growth_form_balance": dict(sorted(forms.items())),
            "predictions_on_labelled_trees": int(pred_on_known),
            "note": ("Species/growth-form confusion matrix is BLOCKED: the CNN scored only "
                     "unlabelled inferred trees, so there are ~0 predictions on labelled trees. "
                     "WS1 phase 2 = re-run inference on the labelled set with a held-out split.")}


def fmt_pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1%}"


def fmt_rate_rows(table: dict) -> str:
    rows = [
        "| Stratum | n | PC canopy / covered | PC coverage | CHM canopy / covered | CHM coverage |",
        "|---|--:|--:|--:|--:|--:|",
    ]
    for k, v in table.items():
        pc_rate = v["pc_canopy_rate_when_covered"]
        chm_rate = v["chm_canopy_rate_when_covered"]
        rows.append(
            f"| {k} | {v['n']:,} | {fmt_pct(pc_rate)} | {v['pc_coverage']:.1%} | "
            f"{fmt_pct(chm_rate)} | {v['chm_coverage']:.1%} |"
        )
    return "\n".join(rows)


def write_report(det, hgt, spc, db) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = utc_now()
    o = det["overall"]
    lines = [
        "# WS1 — internal sensor-consistency assessment (v2)", "",
        f"_Generated {ts} from `{db.name}`. See `docs/research_programme.md`._",
        "",
        "## 1. Canopy evidence at inventory/reference locations", "",
        f"Reference locations: **{det['n_reference_locations']:,}** register, notable-tree and "
        "kauri-surveillance records. They are neither a complete current census nor independent "
        "ground truth. Rates below are conditional on each sensor having data and must always be "
        "read with the corresponding coverage column.",
        "",
        f"**Overall internal agreement:** point-cloud canopy "
        f"{fmt_pct(o['pc_canopy_rate_when_covered'])} at {o['pc_coverage']:.1%} coverage; "
        f"CHM canopy {fmt_pct(o['chm_canopy_rate_when_covered'])} at "
        f"{o['chm_coverage']:.1%} coverage.",
        "",
        "### By canopy-height band (overstory vs understory)", "",
        fmt_rate_rows(det["by_height_band"]), "",
        "### By owner / land-use class", "",
        fmt_rate_rows(det["by_owner_class"]), "",
        "### By verified source", "",
        fmt_rate_rows(det["by_source"]), "",
        "", "## 2. Height cross-sensor agreement (CHM crown height vs point-cloud canopy top)", "",
        f"n = **{hgt['n']:,}** trees with both measures. "
        f"RMSE **{hgt['overall']['rmse_m']:.2f} m**, bias **{hgt['overall']['bias_m']:+.2f} m** "
        f"(CHM − point cloud), r = {hgt['overall']['r']:.3f}.", "",
        "| Height band | n | RMSE (m) | bias (m) |", "|---|--:|--:|--:|",
    ]
    for label, v in hgt["by_height_band"].items():
        lines.append(f"| {label} | {v['n']:,} | {v['rmse_m']:.2f} | {v['bias_m']:+.2f} |")
    lines += [
        "", "## 3. Species / growth-form", "",
        f"Known-species trees: **{spc['n_known_species']:,}**. "
        f"CNN predictions on labelled trees: **{spc['predictions_on_labelled_trees']:,}**.", "",
        f"> {spc['note']}", "",
        "Growth-form balance of the labelled set (collapsed to model classes):", "",
        "| Class | n |", "|---|--:|",
    ]
    for k, v in spc["growth_form_balance"].items():
        lines.append(f"| {k} | {v:,} |")
    lines += ["", "---", "",
              "**Caveats / findings:** (1) inventory and surveillance locations are not crown "
              "annotations or a complete census. (2) Point-cloud and CHM agreement is not recall or "
              "precision. (3) Height-band rates are circular because the band is derived from CHM. "
              "(4) Commission/precision requires independent crown/non-tree annotations. (5) Height "
              "agreement is sensor consistency, not field truth. (6) Growth form remains a genus "
              "scaffold."]
    path = OUT_DIR / "sensor_consistency_v2.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT_DIR / "sensor_consistency_v2.json").write_text(
        json.dumps({"generated": ts, "status": "diagnostic_not_independent_validation",
                    "canopy_evidence": det,
                    "height_agreement": hgt, "species": spc}, indent=2), encoding="utf-8")
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DB_DEFAULT)
    args = ap.parse_args()

    print(f"Loading from {args.db} ...")
    data = load(args.db)
    print(f"  references={len(data['references']):,}  machine={data['machine_n']:,}  "
          f"height_pairs={len(data['height_pairs']):,}  known_species={len(data['known']):,}")

    det = detection_assessment(data["references"], data["machine_n"])
    hgt = height_agreement(data["height_pairs"])
    spc = species_scaffold(data["known"], data["pred_on_known"])
    path = write_report(det, hgt, spc, args.db)

    o = det["overall"]
    print(f"\n== Internal consistency: PC canopy {fmt_pct(o['pc_canopy_rate_when_covered'])} "
          f"@ {o['pc_coverage']:.0%} coverage | CHM canopy "
          f"{fmt_pct(o['chm_canopy_rate_when_covered'])} @ {o['chm_coverage']:.0%} coverage ==")
    print("By height band:")
    for k, v in det["by_height_band"].items():
        print(f"  {k:<18} pc {fmt_pct(v['pc_canopy_rate_when_covered'])} "
              f"@ {v['pc_coverage']:.0%} cov; chm {fmt_pct(v['chm_canopy_rate_when_covered'])} "
              f"@ {v['chm_coverage']:.0%} cov (n={v['n']:,})")
    print("By source:")
    for k, v in det["by_source"].items():
        print(f"  {k:<28} pc {fmt_pct(v['pc_canopy_rate_when_covered'])} "
              f"@ {v['pc_coverage']:.0%} cov; chm-cov {v['chm_coverage']:.0%} (n={v['n']:,})")
    print(f"\nHeight agreement: RMSE {hgt['overall']['rmse_m']:.2f} m, "
          f"bias {hgt['overall']['bias_m']:+.2f} m (n={hgt['n']:,})")
    print(f"\nReport → {path}")


if __name__ == "__main__":
    main()
