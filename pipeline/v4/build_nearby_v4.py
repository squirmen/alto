#!/usr/bin/env python3
"""Rebuild KYTE's nearby-tree index from the v4 release.

Same shard format as kyte-nearby-v1 (0.01 degree cells, gzipped arrays, a manifest
pinned to the tree-detail snapshot), so nearby.js and geo.js need no change. Heights
and crown widths now come from the v4 crowns where a tree has one, which is what the
map shows, falling back to the pilot assets for the rest.

Rows stream out in cell order, so the 5.8 million records never sit in memory at once.
"""
import gzip, hashlib, json, math, shutil, sqlite3, sys
from pathlib import Path

W = Path("/data/alto/working/alto_v4_20260917")
OUT = Path("/data/alto/working/kyte_v4_20260918/nearby")
SRC = Path("/data/alto/working/kyte_v4_20260918")
DB = W / "akl_trees.sqlite"
FIELDS = ["tree_id", "lon", "lat", "common", "latin", "source", "owner", "height_m", "crown_diameter_m"]

SQL = """
SELECT CAST(floor(t.lon*100) AS INT) AS cx, CAST(floor(t.lat*100) AS INT) AS cy,
       t.tree_id, t.lon, t.lat,
       COALESCE(NULLIF(t.species_common,''), NULLIF(t.species_common_raw,'')),
       COALESCE(NULLIF(t.species_latin,''),  NULLIF(t.species_latin_raw,'')),
       t.source_primary, t.owner_raw,
       COALESCE(e.v4_height_m, a.height_p95_m),
       COALESCE(CASE WHEN e.v4_crown_area_m2 > 0
                     THEN 2.0*sqrt(e.v4_crown_area_m2/3.141592653589793) END,
                c.crown_diameter_m)
FROM trees t
LEFT JOIN tree_evidence_v4  e ON e.tree_id = t.tree_id
LEFT JOIN tree_assets_pilot a ON a.tree_id = t.tree_id
LEFT JOIN tree_crown_pilot  c ON c.tree_id = t.tree_id
WHERE t.lon IS NOT NULL AND t.lat IS NOT NULL
ORDER BY cx, cy, t.tree_id
"""


def clean(v, places=2):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    if isinstance(v, float):
        return None if not math.isfinite(v) else round(v, places)
    return v


def main():
    schema = json.loads((SRC / "schema.json").read_text())
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.execute("PRAGMA temp_store = FILE")
    conn.execute(f"PRAGMA temp_store_directory = '{W / 'tmp'}'")
    conn.execute("PRAGMA cache_size = -400000")          # 400 MB, leaves room on this Mac
    conn.execute("PRAGMA mmap_size = 0")

    files, count, cells, biggest = [], 0, 0, (0, "")
    key = None
    rows = []

    def flush():
        nonlocal cells, biggest
        if key is None:
            return
        blob = gzip.compress(json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode(), mtime=0)
        (OUT / f"{key}.json.gz").write_bytes(blob)
        files.append({"path": f"{key}.json.gz", "bytes": len(blob),
                      "sha256": hashlib.sha256(blob).hexdigest(), "records": len(rows)})
        cells += 1
        if len(blob) > biggest[0]:
            biggest = (len(blob), f"{key} ({len(rows):,} trees)")
        if cells % 200 == 0:
            print(f"  {cells} cells, {count:,} trees", flush=True)

    for cx, cy, tid, lon, lat, common, latin, source, owner, height, diameter in conn.execute(SQL):
        k = f"{cx}_{cy}"
        if k != key:
            flush()
            key, rows = k, []
        rows.append([tid, round(lon, 7), round(lat, 7), clean(common), clean(latin),
                     clean(source), clean(owner), clean(height), clean(diameter)])
        count += 1
    flush()
    conn.close()

    groups = gzip.decompress((SRC / "groups.json.gz").read_bytes())
    blob = gzip.compress(groups, mtime=0)
    (OUT / "groups.json.gz").write_bytes(blob)
    files.append({"path": "groups.json.gz", "bytes": len(blob),
                  "sha256": hashlib.sha256(blob).hexdigest()})

    if count != schema["records"]:
        raise SystemExit(f"index holds {count:,} trees but the release says {schema['records']:,}")

    manifest = {
        "method_id": "kyte-nearby-v1",
        "detail_snapshot": schema["generated_utc"],
        "database_mtime_ns": schema["database_mtime_ns"],
        "records": count,
        "cell_degrees": .01,
        "fields": FIELDS,
        "files": files,
        "matching": "Distance and optional capture bearing rank suggestions. A user must select the record. Proposed record groups retain all source IDs.",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    total = sum(f["bytes"] for f in files)
    print(json.dumps({"records": count, "cells": cells, "bytes": total,
                      "megabytes": round(total / 1048576, 1), "largest_cell": biggest[1],
                      "largest_cell_kb": round(biggest[0] / 1024, 1)}, indent=2))


if __name__ == "__main__":
    main()
