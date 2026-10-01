#!/usr/bin/env python3
"""Ingest the national NZ tree-source snapshot into a queryable SQLite backbone.

Reads the harmonised `unified_tree_points_plus_osm.csv` (≈1.86M rows: council /
protected / infrastructure + OSM + keyed sources) and writes a typed, indexed SQLite
so the national pipeline (validation, species, allometry, dedup, scaling) can query it.
Heavy output lives on the data drive, not the Dropbox repo.

Usage:
    python scripts/ingest_nz_tree_sources.py
    python scripts/ingest_nz_tree_sources.py --src <csv> --out <sqlite> --authoritative-only
"""

from __future__ import annotations

import argparse
import csv
import sqlite3
from collections import Counter
from pathlib import Path

csv.field_size_limit(10 ** 7)

T7 = Path("/data/alto")
DEFAULT_SRC = T7 / "nz_tree_sources_2026-06-19" / "derived" / "unified_tree_points_plus_osm.csv"
DEFAULT_OUT = T7 / "processed" / "nz_tree_sources.sqlite"

COLS = ["source_slug", "source_name", "provider", "category", "source_priority", "source_url",
        "source_record_id", "tree_id", "common_name", "scientific_name", "species_or_name",
        "dbh_or_diameter", "height", "condition_or_health", "longitude", "latitude", "properties_json"]


def fnum(v: str):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--authoritative-only", action="store_true",
                    help="skip OSM nodes; keep council/protected/infrastructure")
    args = ap.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)

    con = sqlite3.connect(args.out)
    con.execute("DROP TABLE IF EXISTS nz_tree_points")
    con.execute("""CREATE TABLE nz_tree_points (
        rowid INTEGER PRIMARY KEY, source_slug TEXT, source_name TEXT, provider TEXT, category TEXT,
        source_priority TEXT, source_url TEXT, source_record_id TEXT, tree_id TEXT,
        common_name TEXT, scientific_name TEXT, species_or_name TEXT,
        dbh_or_diameter REAL, height_m REAL, condition_or_health TEXT,
        lon REAL, lat REAL, properties_json TEXT)""")

    insert = ("INSERT INTO nz_tree_points (source_slug,source_name,provider,category,source_priority,"
              "source_url,source_record_id,tree_id,common_name,scientific_name,species_or_name,"
              "dbh_or_diameter,height_m,condition_or_health,lon,lat,properties_json) "
              "VALUES (" + ",".join("?" * 17) + ")")

    n, kept = 0, 0
    cat = Counter()
    batch = []
    with open(args.src, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            n += 1
            if args.authoritative_only and "osm" in (row.get("source_slug", "")).lower():
                continue
            batch.append((row.get("source_slug"), row.get("source_name"), row.get("provider"),
                          row.get("category"), row.get("source_priority"), row.get("source_url"),
                          row.get("source_record_id"), row.get("tree_id"), row.get("common_name") or None,
                          row.get("scientific_name") or None, row.get("species_or_name") or None,
                          fnum(row.get("dbh_or_diameter")), fnum(row.get("height")),
                          row.get("condition_or_health") or None, fnum(row.get("longitude")),
                          fnum(row.get("latitude")), row.get("properties_json")))
            cat[row.get("category") or "?"] += 1
            kept += 1
            if len(batch) >= 5000:
                con.executemany(insert, batch)
                batch.clear()
            if n % 250000 == 0:
                print(f"  …{n:,} rows")
    if batch:
        con.executemany(insert, batch)

    print("indexing…")
    con.execute("CREATE INDEX idx_nz_provider ON nz_tree_points(provider)")
    con.execute("CREATE INDEX idx_nz_category ON nz_tree_points(category)")
    con.execute("CREATE INDEX idx_nz_source ON nz_tree_points(source_slug)")
    con.execute("CREATE INDEX idx_nz_xy ON nz_tree_points(lon, lat)")
    con.commit()

    # verify-by-read
    got = con.execute("SELECT COUNT(*) FROM nz_tree_points").fetchone()[0]
    hh = con.execute("SELECT COUNT(*) FROM nz_tree_points WHERE height_m IS NOT NULL").fetchone()[0]
    dd = con.execute("SELECT COUNT(*) FROM nz_tree_points WHERE dbh_or_diameter IS NOT NULL").fetchone()[0]
    ss = con.execute("SELECT COUNT(*) FROM nz_tree_points WHERE scientific_name IS NOT NULL").fetchone()[0]
    con.close()

    print(f"\nread {n:,} CSV rows → wrote {kept:,} → SQLite has {got:,} (verify {'OK' if got == kept else 'MISMATCH'})")
    print(f"  height: {hh:,} ({hh/got:.0%})  dbh: {dd:,} ({dd/got:.0%})  species: {ss:,} ({ss/got:.0%})")
    print(f"  categories: {cat.most_common()}")
    print(f"  -> {args.out}")


if __name__ == "__main__":
    main()
