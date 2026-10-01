#!/usr/bin/env python3
"""Fetch georeferenced tree occurrences for the Auckland extent from GBIF.

The inventory carries 1.38 million records with no Latin taxon, and the only
species signal on most of them is an aerial-RGB model that is not release
eligible. GBIF aggregates iNaturalist NZ research-grade observations, herbarium
sheets and survey records, all of which carry a determined taxon.

These are independent observations, not an inventory: positional accuracy is
typically 5 to 50 m and many records are understory plants rather than trees.
This fetch therefore restricts to genera that are both present in the local
inventory and listed in the i-Tree tree reference, and it preserves
coordinateUncertaintyInMeters so downstream matching can be distance-aware.

Reads the project database read-only and writes only to data/raw/gbif/.

    python scripts/fetch_gbif_tree_observations.py [--limit-genera N] [--refresh]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT_DIR = ROOT / "data" / "raw" / "gbif"
KEY_CACHE = OUT_DIR / "genus_keys.json"
OUT_JSONL = OUT_DIR / "auckland_tree_occurrences.jsonl"
MANIFEST = OUT_DIR / "fetch_manifest.json"

API = "https://api.gbif.org/v1"
USER_AGENT = "AucklandTreeIntelligence/0.1 (University of Auckland; research)"

# Auckland metropolitan bounding box, matched to the working extent.
BBOX = {"decimalLatitude": "-37.3,-36.2", "decimalLongitude": "174.3,175.3"}
PAGE = 300
# GBIF's search endpoint refuses offsets beyond this; a genus that busy needs
# splitting rather than silently truncating.
MAX_OFFSET = 100_000

FIELDS = [
    "key", "scientificName", "species", "genus", "family", "taxonRank",
    "decimalLatitude", "decimalLongitude", "coordinateUncertaintyInMeters",
    "eventDate", "year", "basisOfRecord", "datasetKey", "license",
    "identificationVerificationStatus", "occurrenceID",
]


def get(path: str, params: dict) -> dict:
    url = f"{API}/{path}?" + urllib.parse.urlencode(params, doseq=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 3:
                raise
            print(f"    retry {attempt + 1} after {exc}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def inventory_tree_genera() -> list[str]:
    """Genera that appear in the local inventory and in the i-Tree tree list."""
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT g.genus
            FROM itree_genus_ref g
            WHERE g.genus IN (
                SELECT DISTINCT TRIM(SUBSTR(species_latin, 1, INSTR(species_latin || ' ', ' ') - 1))
                FROM trees
                WHERE species_latin IS NOT NULL AND species_latin <> ''
            )
            ORDER BY g.genus
            """
        ).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows]


def resolve_genus_keys(genera: list[str], refresh: bool) -> dict[str, int]:
    cache: dict[str, int] = {}
    if KEY_CACHE.exists() and not refresh:
        cache = json.loads(KEY_CACHE.read_text(encoding="utf-8"))
    missing = [g for g in genera if g not in cache]
    for i, genus in enumerate(missing, 1):
        match = get("species/match", {"name": genus, "rank": "GENUS", "kingdom": "Plantae"})
        key = match.get("usageKey")
        # Only accept a genus-rank match; a fuzzy hit on another rank would
        # silently widen the query to a whole family or order.
        if key and match.get("rank") == "GENUS" and match.get("matchType") != "NONE":
            cache[genus] = key
        if i % 25 == 0:
            print(f"  resolved {i}/{len(missing)}")
        time.sleep(0.05)
    KEY_CACHE.parent.mkdir(parents=True, exist_ok=True)
    KEY_CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True), encoding="utf-8")
    return {g: cache[g] for g in genera if g in cache}


def fetch_genus(key: int) -> list[dict]:
    out, offset = [], 0
    while True:
        page = get("occurrence/search", dict(
            BBOX, country="NZ", hasCoordinate="true", hasGeospatialIssue="false",
            taxonKey=key, limit=PAGE, offset=offset,
        ))
        for record in page.get("results", []):
            out.append({f: record.get(f) for f in FIELDS})
        offset += PAGE
        if page.get("endOfRecords", True) or offset >= min(page.get("count", 0), MAX_OFFSET):
            if page.get("count", 0) > MAX_OFFSET:
                print(f"    NOTE truncated at {MAX_OFFSET:,} of {page['count']:,}")
            break
        time.sleep(0.05)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit-genera", type=int, default=0, help="0 = all")
    ap.add_argument("--refresh", action="store_true", help="re-resolve genus keys")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    genera = inventory_tree_genera()
    if args.limit_genera:
        genera = genera[:args.limit_genera]
    print(f"tree genera to query: {len(genera)}")

    keys = resolve_genus_keys(genera, args.refresh)
    print(f"resolved to GBIF genus keys: {len(keys)}")

    total, per_genus = 0, {}
    with OUT_JSONL.open("w", encoding="utf-8") as fh:
        for i, (genus, key) in enumerate(sorted(keys.items()), 1):
            records = fetch_genus(key)
            for record in records:
                record["query_genus"] = genus
                fh.write(json.dumps(record, separators=(",", ":")) + "\n")
            per_genus[genus] = len(records)
            total += len(records)
            if records:
                print(f"  [{i:3d}/{len(keys)}] {genus:24s} {len(records):>6,}")

    MANIFEST.write_text(json.dumps({
        "source": "GBIF occurrence search",
        "api": API,
        "bbox": BBOX,
        "filters": {"country": "NZ", "hasCoordinate": True, "hasGeospatialIssue": False},
        "genus_filter": "present in local inventory AND in itree_genus_ref",
        "genera_queried": len(keys),
        "records": total,
        "per_genus": per_genus,
        "fetched_at_utc": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "note": ("Independent observations, not an inventory. Positional accuracy varies; "
                 "coordinateUncertaintyInMeters is preserved for distance-aware matching."),
    }, indent=2), encoding="utf-8")

    size = OUT_JSONL.stat().st_size / 1048576
    print(f"\n{total:,} occurrences -> {OUT_JSONL.name} ({size:.1f} MB)")


if __name__ == "__main__":
    main()
