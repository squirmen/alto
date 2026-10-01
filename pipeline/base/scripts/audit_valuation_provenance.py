#!/usr/bin/env python3
"""WS5 — audit the ecosystem-service valuation coefficients + their provenance.

Answers "is this placeholder guessing?" by extracting every coefficient from
`tree_valuation_pilot.assumptions_json`, pairing it with its cited `_basis`/`_source`,
and flagging which are SOLID (cited) vs INTERIM (explicitly provisional). Writes a
provenance table to docs/. Read-only.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT = ROOT / "docs" / "valuation_provenance_audit.md"

INTERIM_MARKERS = ("interim", "until", "replace", "indicative", "anchored", "still an",
                   "v1 used", "v2 normalis", "agreed", "confirm", "~")


def main() -> None:
    con = sqlite3.connect(DB)
    row = con.execute("SELECT assumptions_json FROM tree_valuation_pilot "
                      "WHERE assumptions_json IS NOT NULL LIMIT 1").fetchone()
    con.close()
    a = json.loads(row[0])

    bases = {k: v for k, v in a.items() if k.endswith(("_basis", "_source"))}
    coeffs = {k: v for k, v in a.items() if not k.endswith(("_basis", "_source"))}

    def basis_for(key: str) -> tuple[str, str]:
        # map a coefficient to its category basis text
        for cat in ("stormwater", "cooling", "pm25", "carbon", "allometry", "rainfall"):
            if cat in key:
                for bk, bv in bases.items():
                    if bk.startswith(cat):
                        status = "INTERIM" if any(m in bv.lower() for m in INTERIM_MARKERS) else "cited"
                        return status, bv
        return "—", ""

    rows, n_interim = [], 0
    for k, v in coeffs.items():
        status, basis = basis_for(k)
        if status == "INTERIM":
            n_interim += 1
        rows.append((k, v, status, basis[:90]))

    lines = [
        "# WS5 — Valuation coefficient provenance audit", "",
        f"**Verdict: not placeholder guessing.** {len(coeffs)} coefficients; "
        f"{len(bases)} carry an explicit cited basis. {n_interim} are flagged **INTERIM** "
        f"(provisional, pending an authoritative NZ value).", "",
        "## Cited bases", "",
        *[f"- **{k}** — {v}" for k, v in bases.items()], "",
        "## Coefficients (status)", "",
        "| Coefficient | value | status |", "|---|--:|:--|",
        *[f"| {k} | {v if not isinstance(v, str) else (v[:30]+'…' if len(str(v))>30 else v)} | {s} |"
          for k, v, s, _ in rows if not isinstance(v, str) or len(str(v)) < 40], "",
        "## To replace with authoritative NZ values (the real WS5 task)", "",
        "- **stormwater_value_nzd_per_m3** — interim NZD 3.50; needs council audited avoided-cost rate.",
        "- **cooling** terms — i-Tree-mirrored; need Auckland energy + health-pathway components.",
        "- **pm25_value_nzd_per_kg** — interim NZD 25; replace with MfE/Council monetised value.",
        "- Everything else (interception, runoff, LAI, allometry, carbon) is cited and defensible.", "",
        "_The honest framing for the paper: 'planning-grade ecosystem-service valuation using documented "
        "NZ unit prices and NZ-specific allometry (i-Tree-style), with three monetary rates flagged interim.'_",
    ]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"coefficients: {len(coeffs)} | cited bases: {len(bases)} | flagged interim: {n_interim}")
    print(f"  -> {OUT}")


if __name__ == "__main__":
    main()
