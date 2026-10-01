#!/usr/bin/env python3
"""Verify every downloaded LAZ tile by decompressing it end-to-end.

On the T7 the directory listing alone proves nothing (see the corrupt-volume
incident: dirents that fail open(), files that vanish after remount). A tile
only counts as present if every point block decompresses and the count matches
the header. Bad/ghost tiles are deleted (best effort) so a fetch rerun
re-downloads them.

Usage: validate_pointcloud_tiles.py [--dir DIR] [--workers N] [--delete-bad]
Writes the bad list to /tmp/bad_tiles_validation.json and exits non-zero if
any tile failed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = Path(os.environ.get(
    "AKL_TREES_PC_ROOT", ROOT / "data" / "raw" / "point_cloud_2024")) / active_pilot_name()
CHUNK = 2_000_000


def check_tile(path_str: str) -> tuple[str, str | None]:
    import laspy
    p = Path(path_str)
    try:
        with laspy.open(p) as f:
            expect = f.header.point_count
            seen = 0
            for chunk in f.chunk_iterator(CHUNK):
                seen += len(chunk)
        if expect == 0 or seen != expect:
            return p.name, f"point count mismatch: header {expect}, read {seen}"
        return p.name, None
    except Exception as e:  # noqa: BLE001 — any failure means the tile is bad
        return p.name, f"{type(e).__name__}: {str(e)[:120]}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--delete-bad", action="store_true",
                    help="unlink tiles that fail so a fetch rerun re-downloads them")
    args = ap.parse_args()

    tiles = sorted(set(args.dir.glob("pc_*.laz")))
    print(f"Validating {len(tiles)} tiles in {args.dir} ({args.workers} workers)", flush=True)
    bad: list[tuple[str, str]] = []
    done = 0
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(check_tile, str(t)) for t in tiles]
        for fut in as_completed(futs):
            name, err = fut.result()
            done += 1
            if err:
                bad.append((name, err))
                print(f"  BAD {name}: {err}", flush=True)
            if done % 100 == 0:
                print(f"  [{done}/{len(tiles)}] ok so far: {done - len(bad)}", flush=True)

    print(f"RESULT: {len(tiles) - len(bad)}/{len(tiles)} tiles valid, {len(bad)} bad", flush=True)
    json.dump([n for n, _ in bad], open("/tmp/bad_tiles_validation.json", "w"))
    if bad and args.delete_bad:
        for name, _ in bad:
            try:
                (args.dir / name).unlink()
                print(f"  deleted {name}", flush=True)
            except OSError as e:
                print(f"  could not delete {name}: {e}", flush=True)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
