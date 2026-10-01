#!/usr/bin/env python3
"""Promote a working-copy database to the production path.

Development runs against a copy on the archive volume so the shared database
stays stable for downstream users. This publishes a finished lineage back to
the production path using SQLite's backup API, which overwrites the destination
in place rather than deleting and replacing the file, then verifies the result
before reporting success.

The pre-swap state must already exist as a verified snapshot; this refuses to
run without one, because the destination is overwritten irreversibly.

    python scripts/promote_lineage_to_production.py \
        --lineage /data/alto/.../akl_trees.sqlite \
        --require-snapshot /data/alto/.../capstone-20260730
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROD = ROOT / "data" / "processed" / "akl_trees.sqlite"

# Tables whose counts are reported before and after, so a swap that silently
# lost a stage is visible rather than merely "completed".
REPORT_TABLES = [
    "trees", "tree_lidar_pilot", "tree_crown_pilot", "tree_context_pilot",
    "tree_valuation_pilot", "tree_pointcloud_pilot", "tree_species_attributes",
    "tree_low_canopy_candidates",
]


def counts(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        present = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        return {t: conn.execute(f"SELECT COUNT(*) FROM '{t}'").fetchone()[0]
                for t in REPORT_TABLES if t in present}
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lineage", type=Path, required=True)
    ap.add_argument("--dest", type=Path, default=PROD)
    ap.add_argument("--require-snapshot", type=Path, required=True,
                    help="verified snapshot of the pre-swap state; the recovery path")
    ap.add_argument("--yes", action="store_true", help="perform the swap")
    args = ap.parse_args()

    if not args.lineage.exists():
        raise SystemExit(f"lineage not found: {args.lineage}")
    snapshot_db = args.require_snapshot / "akl_trees.sqlite"
    if not (args.require_snapshot / "manifest.json").exists() or not snapshot_db.exists():
        raise SystemExit(
            f"no verified snapshot at {args.require_snapshot}; refusing to overwrite "
            f"{args.dest}. Run scripts/baseline_snapshot.py freeze first.")

    before, after = counts(args.dest), counts(args.lineage)
    print(f"lineage: {args.lineage}")
    print(f"dest:    {args.dest}")
    print(f"recovery snapshot: {snapshot_db}\n")
    print(f"  {'table':30s} {'current':>14} {'lineage':>14} {'change':>12}")
    for table in REPORT_TABLES:
        b, a = before.get(table), after.get(table)
        if a is None:
            continue
        delta = f"{a - b:+,}" if b is not None else "new"
        print(f"  {table:30s} {b if b is None else format(b, ','):>14} "
              f"{a:>14,} {delta:>12}")

    if not args.yes:
        print("\nDry run. Pass --yes to perform the swap.")
        return 0

    print("\ncopying via the backup API (overwrites in place, no delete) ...")
    src = sqlite3.connect(f"file:{args.lineage}?mode=ro", uri=True)
    dst = sqlite3.connect(str(args.dest))
    try:
        done = 0

        def progress(status, remaining, total):
            nonlocal done
            if total and (total - remaining) - done > total // 10:
                done = total - remaining
                print(f"  {done * 100 // total}%", flush=True)

        src.backup(dst, pages=20000, progress=progress)
    finally:
        dst.close()
        src.close()

    print("verifying ...")
    conn = sqlite3.connect(f"file:{args.dest}?mode=ro", uri=True)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        conn.close()
    if integrity != "ok":
        raise SystemExit(f"integrity_check failed after swap: {integrity}\n"
                         f"Restore from {snapshot_db}")
    final = counts(args.dest)
    mismatched = {t: (after[t], final.get(t)) for t in after if final.get(t) != after[t]}
    if mismatched:
        raise SystemExit(f"counts do not match the lineage after swap: {mismatched}\n"
                         f"Restore from {snapshot_db}")
    print(f"  integrity ok, all {len(final)} reported tables match the lineage")
    print(f"\nProduction database is now the lineage. Recovery: {snapshot_db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
