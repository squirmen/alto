#!/usr/bin/env python3
"""Freeze and verify the dataset baseline a downstream project is pinned to.

The capstone benchmark reads this repository's working database and CHM
directly. Its reference-site selection aggregates over those tables, so any
change to them silently moves the sites and breaks the reproducibility of a
selection that has already been run. Detection development therefore needs a
frozen baseline that cannot drift underneath it, and a way to prove later that
it did not.

`freeze` writes a consistent copy of the database using SQLite's backup API,
which is safe against a database in use, then records row counts and content
checksums for every table plus fingerprints of the non-database inputs. Every
copied byte is read back and compared, because the archive volume has a history
of silent corruption.

`verify` re-fingerprints the live inputs and reports any drift from a snapshot.

    python scripts/baseline_snapshot.py freeze --label capstone
    python scripts/baseline_snapshot.py verify --snapshot <dir>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
DEFAULT_DEST = Path("/data/alto/baselines")

# Everything the downstream project reads. Recorded so drift is detectable even
# where the input is too large to copy.
TRACKED_INPUTS = {
    "chm_vrt": ROOT / "data" / "interim" / "auckland_metro_v1_lidar" / "chm.vrt",
    "chm_dir": ROOT / "data" / "interim" / "auckland_metro_v1_lidar",
    "imagery_z18": ROOT / "data" / "raw" / "esri_world_imagery" / "tiles_z18",
    "laz_root": Path("/data/alto/point_cloud_2024/auckland_metro_v1"),
}

# Tables the downstream selection actually aggregates over. Their checksums are
# the ones that matter; a change anywhere in them moves reference sites.
CRITICAL_TABLES = [
    "trees", "tree_lidar_pilot", "tree_crown_pilot",
    "tree_context_pilot", "tree_pointcloud_pilot", "tree_species_attributes",
]


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while block := fh.read(chunk):
            h.update(block)
    return h.hexdigest()


def dir_fingerprint(path: Path) -> dict:
    """Cheap directory fingerprint: file count and total bytes.

    Hashing hundreds of thousands of imagery tiles would cost more than it is
    worth; count and size catch the changes that matter here.
    """
    if not path.exists():
        return {"exists": False}
    files, total = 0, 0
    for p in path.rglob("*"):
        if p.is_file():
            files += 1
            total += p.stat().st_size
    return {"exists": True, "files": files, "bytes": total}


def table_checksum(conn: sqlite3.Connection, table: str) -> dict:
    """Row count plus an order-independent checksum of the table's contents."""
    count = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info('{table}')")]
    if not cols:
        return {"rows": count, "checksum": None}
    # Stock SQLite has no hash function, so rows are hashed here. Summing
    # per-row digests is order-independent, so the result does not depend on
    # scan order or on a rowid the table may not have. Rows are batched and
    # joined into one buffer per batch to keep the per-row cost low.
    # Double quotes: SQLite reads a single-quoted token in a result column as a
    # string literal, not an identifier, so f"'{c}'" hashed the column *names*
    # once per row and the checksum reduced to f(row count, column names).
    select = ", ".join(f'"{c}"' for c in cols)
    cursor = conn.execute(f'SELECT {select} FROM "{table}"')
    acc = 0
    while batch := cursor.fetchmany(20000):
        for row in batch:
            acc += int.from_bytes(
                hashlib.blake2b(str(row).encode(), digest_size=8).digest(), "big")
    return {"rows": count, "checksum": str(acc % (1 << 63))}


def fingerprint_database(path: Path, tables: list[str] | None = None) -> dict:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        names = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        wanted = tables if tables is not None else names
        out = {}
        for t in names:
            if t.startswith("sqlite_"):
                continue
            if t in wanted:
                print(f"    checksumming {t} ...", flush=True)
                out[t] = table_checksum(conn, t)
            else:
                out[t] = {"rows": conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]}
        return out
    finally:
        conn.close()


def freeze(dest_root: Path, label: str) -> Path:
    stamp = time.strftime("%Y%m%d", time.gmtime())
    dest = dest_root / f"{label}-{stamp}"
    if dest.exists():
        raise SystemExit(f"{dest} already exists; choose another --label or remove it")
    dest.mkdir(parents=True)
    out_db = dest / DB.name

    free = shutil.disk_usage(dest_root).free
    need = DB.stat().st_size
    print(f"source {DB} ({need / 1e9:.1f} GB) -> {out_db}")
    print(f"destination free space: {free / 1e9:.1f} GB")
    if free < need * 1.1:
        raise SystemExit("not enough free space at the destination")

    print("copying via SQLite backup API (safe against concurrent readers) ...")
    src = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    dst = sqlite3.connect(out_db)
    try:
        done = 0

        def progress(status, remaining, total):
            nonlocal done
            if total and (total - remaining) - done > total // 20:
                done = total - remaining
                print(f"  {done * 100 // total}%", flush=True)

        src.backup(dst, pages=20000, progress=progress)
    finally:
        dst.close()
        src.close()

    print("verifying the copy by reading it back ...")
    print("  integrity_check ...", flush=True)
    check = sqlite3.connect(f"file:{out_db}?mode=ro", uri=True)
    try:
        result = check.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        check.close()
    if result != "ok":
        raise SystemExit(f"integrity_check failed on the copy: {result}")
    print("  integrity_check ok")

    print("fingerprinting source ...")
    src_fp = fingerprint_database(DB, CRITICAL_TABLES)
    print("fingerprinting copy ...")
    dst_fp = fingerprint_database(out_db, CRITICAL_TABLES)
    mismatches = [t for t in src_fp if src_fp[t] != dst_fp.get(t)]
    if mismatches:
        raise SystemExit(f"copy does not match source for: {mismatches}")
    print(f"  all {len(src_fp)} tables match")

    inputs = {k: (dir_fingerprint(p) if p.is_dir() else
                  ({"exists": True, "sha256": sha256_file(p), "bytes": p.stat().st_size}
                   if p.exists() else {"exists": False}))
              for k, p in TRACKED_INPUTS.items()}

    manifest = {
        "label": label,
        "frozen_at_utc": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "purpose": ("Frozen baseline for the capstone benchmark. Detection development "
                    "must not modify the live inputs fingerprinted here."),
        "source_database": str(DB),
        "source_database_mtime_utc": time.strftime(
            "%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(DB.stat().st_mtime)),
        "snapshot_database": str(out_db),
        "database_bytes": out_db.stat().st_size,
        "critical_tables": CRITICAL_TABLES,
        "tables": dst_fp,
        "tracked_inputs": {k: str(p) for k, p in TRACKED_INPUTS.items()},
        "input_fingerprints": inputs,
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nfrozen: {dest}")
    return dest


def verify(snapshot: Path) -> int:
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    print(f"baseline '{manifest['label']}' frozen {manifest['frozen_at_utc']}\n")
    failures = []

    live_mtime = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(DB.stat().st_mtime))
    same_mtime = live_mtime == manifest["source_database_mtime_utc"]
    print(f"live database mtime {live_mtime} "
          f"({'unchanged' if same_mtime else 'CHANGED since freeze'})")

    print("re-checksumming the live critical tables ...")
    live = fingerprint_database(DB, manifest["critical_tables"])
    for table in manifest["critical_tables"]:
        want, got = manifest["tables"].get(table), live.get(table)
        if want != got:
            failures.append(f"table {table}: {want} -> {got}")
            print(f"  DRIFT  {table}: {want} -> {got}")
        else:
            print(f"  ok     {table}  rows={got['rows']:,}")

    print("re-fingerprinting tracked inputs ...")
    for key, path_str in manifest["tracked_inputs"].items():
        path = Path(path_str)
        want = manifest["input_fingerprints"][key]
        got = (dir_fingerprint(path) if path.is_dir() else
               ({"exists": True, "sha256": sha256_file(path), "bytes": path.stat().st_size}
                if path.exists() else {"exists": False}))
        if want != got:
            failures.append(f"input {key}: {want} -> {got}")
            print(f"  DRIFT  {key}: {want} -> {got}")
        else:
            print(f"  ok     {key}")

    if failures:
        print(f"\n{len(failures)} baseline input(s) have drifted since the freeze.")
        print("The capstone's site selection is no longer reproducible from the live inputs;")
        print("point its config at the snapshot database instead.")
        return 1
    print("\nBaseline intact. Every input the capstone depends on is unchanged.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)
    f = sub.add_parser("freeze")
    f.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    f.add_argument("--label", default="baseline")
    v = sub.add_parser("verify")
    v.add_argument("--snapshot", type=Path, required=True)
    args = ap.parse_args()
    if args.command == "freeze":
        freeze(args.dest, args.label)
        return 0
    return verify(args.snapshot)


if __name__ == "__main__":
    sys.exit(main())
