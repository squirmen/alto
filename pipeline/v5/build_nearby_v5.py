#!/usr/bin/env python3
"""Build KYTE's nearby index from current v5 crown representatives and source records.
Preserve the established cell format and pin the index to the full-record snapshot.
Earlier unmatched detections and unverified notable positions are excluded from
nearby suggestions; their original IDs remain accessible in full records.
"""
import gzip, hashlib, json, math, shutil, sqlite3, sys
from pathlib import Path

W = Path("/data/alto/working/alto_v5_20260922")
OUT = W / "deploy/alto_v5_upload_20260923/kyte/data/nearby"
SRC = W / "deploy/alto_v5_upload_20260923/data/tree_details"
DB = W / "akl_trees.sqlite"
FIELDS = ["tree_id", "lon", "lat", "common", "latin", "source", "owner", "height_m", "crown_diameter_m"]

SQL = """
SELECT CAST(floor(d.lon*100) AS INT) AS cx, CAST(floor(d.lat*100) AS INT) AS cy,
 d.tree_id,d.lon,d.lat,coalesce(g.species_common,t.species_common),coalesce(g.species_latin,t.species_latin),t.source_primary,t.owner_raw,cr.crown_max_chm_m,cr.crown_diameter_m
FROM tree_display_v5 d JOIN trees t using(tree_id)
LEFT JOIN tree_current_crown_v5 cr using(tree_id) LEFT JOIN tree_ground_evidence g using(tree_id)
WHERE d.display_role!='earlier_detection' AND NOT(t.source_primary='notable_trees_overlay' AND coalesce(t.notable_point_type,'')!='1')
ORDER BY cx,cy,d.tree_id
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

    groups = json.dumps({'groups':[], 'method_id':'v5_current_crown_representatives','database_mtime_ns':schema['database_mtime_ns']}).encode()
    blob = gzip.compress(groups, mtime=0)
    (OUT / "groups.json.gz").write_bytes(blob)
    files.append({"path": "groups.json.gz", "bytes": len(blob),
                  "sha256": hashlib.sha256(blob).hexdigest()})

    if count > schema["records"]:
        raise SystemExit(f"index holds {count:,} trees but the release says {schema['records']:,}")

    manifest = {
        "method_id": "kyte-nearby-v1",
        "detail_snapshot": schema["generated_utc"],
        "database_mtime_ns": schema["database_mtime_ns"],
        "records": count,
        "detail_records": schema["records"],
        "population": "Current crown representatives and source records; excludes earlier unmatched detections and unverified notable source positions.",
        "cell_degrees": .01,
        "fields": FIELDS,
        "files": files,
        "matching": "Distance and optional capture bearing rank suggestions. A user must select the record. V5 shared-crown records remain accessible through the representative profile and existing saved IDs.",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    total = sum(f["bytes"] for f in files)
    print(json.dumps({"records": count, "cells": cells, "bytes": total,
                      "megabytes": round(total / 1048576, 1), "largest_cell": biggest[1],
                      "largest_cell_kb": round(biggest[0] / 1024, 1)}, indent=2))


if __name__ == "__main__":
    main()
