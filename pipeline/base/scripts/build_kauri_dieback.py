#!/usr/bin/env python3
"""Kauri dieback surveillance overlay.

Auckland Council publishes a public kauri dieback surveillance layer: soil-sample
results for the pathogen Phytophthora agathidicida together with a field symptom
assessment at each surveyed kauri. This script classifies each survey point into a
plain status tier and writes a slim GeoJSON for the map plus a summary table.

Status tiers (grounded in the recorded fields, not inferred):
  * pathogen_confirmed : soil sample returned Phytophthora agathidicida present,
                         or a confirmed case within 50 m
  * symptomatic        : field assessment recorded possible or severe dieback
                         symptoms, or a probable/suspect case nearby
  * no_symptoms        : field assessment recorded a non-symptomatic kauri
  * other              : ill thrift, not a kauri, or no status recorded

Source: Auckland Council kauri dieback (public) surveillance, already ingested at
data/raw/arcgis/ruru_obskauri_tiaki_public.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "raw" / "arcgis" / "ruru_obskauri_tiaki_public" / "features_4326.geojson"
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT_GEOJSON = ROOT / "data" / "processed" / "kauri_dieback.geojson"
OUT_DOC = ROOT / "docs" / "validation" / "kauri_dieback.md"

PATHOGEN = {0: "Not sampled", 1: "Not detected", 2: "Present"}
FIELD = {1: "Non-symptomatic", 2: "Ill thrift", 3: "Possible symptoms",
         4: "Severe symptoms", 5: "Not a kauri", 6: "No status"}


def classify(p) -> str:
    pa = p.get("PhytAgathidicida")
    kdb = p.get("KDBFieldStatus")
    case50 = p.get("Analysis_CaseStatus50m")
    if pa == 2 or case50 == 1:
        return "pathogen_confirmed"
    if kdb in (3, 4) or case50 in (4, 5):
        return "symptomatic"
    if kdb == 1:
        return "no_symptoms"
    return "other"


def year_of(ms):
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).year
    except Exception:
        return None


def main() -> None:
    data = json.loads(SRC.read_text())
    feats_in = data.get("features", [])
    out_feats, rows, tiers = [], [], Counter()
    for f in feats_in:
        geom = f.get("geometry")
        if not geom or geom.get("type") != "Point":
            continue
        p = f.get("properties", {})
        tier = classify(p)
        tiers[tier] += 1
        lon, lat = geom["coordinates"][:2]
        props = {
            "status": tier,
            "field_status": FIELD.get(p.get("KDBFieldStatus"), "Unknown"),
            "pathogen": PATHOGEN.get(p.get("PhytAgathidicida"), "Unknown"),
            "survey_year": year_of(p.get("StartDate")),
        }
        out_feats.append({"type": "Feature", "geometry": {"type": "Point",
                          "coordinates": [round(lon, 6), round(lat, 6)]}, "properties": props})
        rows.append((props["status"], props["field_status"], props["pathogen"], props["survey_year"]))

    OUT_GEOJSON.write_text(json.dumps({"type": "FeatureCollection", "features": out_feats}),
                           encoding="utf-8")

    con = sqlite3.connect(DB)
    con.execute("DROP TABLE IF EXISTS kauri_dieback_surveillance")
    con.execute("""CREATE TABLE kauri_dieback_surveillance (
        status TEXT, field_status TEXT, pathogen TEXT, survey_year INTEGER)""")
    con.executemany("INSERT INTO kauri_dieback_surveillance VALUES (?,?,?,?)", rows)
    con.commit()
    con.close()

    n = len(out_feats)
    confirmed = tiers["pathogen_confirmed"]
    sympt = tiers["symptomatic"]
    lines = ["# Kauri dieback surveillance", "",
             f"Auckland Council has surveyed {n:,} kauri for dieback, recording a soil-sample "
             "result for the pathogen Phytophthora agathidicida and a field symptom assessment at "
             "each point. The overlay classifies each survey into a plain status tier.", "",
             f"The pathogen was confirmed present at {confirmed:,} points "
             f"({confirmed/n:.1%}); a further {sympt:,} kauri ({sympt/n:.1%}) showed possible or "
             "severe dieback symptoms in the field. The remainder were non-symptomatic or carried "
             "no status.", "",
             "| Status | Points | Share |", "| --- | ---: | ---: |"]
    label = {"pathogen_confirmed": "Pathogen confirmed", "symptomatic": "Symptomatic",
             "no_symptoms": "No symptoms recorded", "other": "Other or not assessed"}
    for k in ("pathogen_confirmed", "symptomatic", "no_symptoms", "other"):
        lines.append(f"| {label[k]} | {tiers[k]:,} | {tiers[k]/n:.1%} |")
    lines += ["", "Surveillance is concentrated where kauri grow, so the points are not an even "
              "sample of the region. The overlay reports recorded status; it is not a prediction of "
              "spread. Source: Auckland Council kauri dieback public surveillance."]
    OUT_DOC.write_text("\n".join(lines), encoding="utf-8")

    print(f"kauri_dieback: {n:,} surveillance points  {dict(tiers)}")
    print(f"  wrote {OUT_GEOJSON.name} ({OUT_GEOJSON.stat().st_size/1048576:.1f} MB), {OUT_DOC.name}")


if __name__ == "__main__":
    main()
