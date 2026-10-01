#!/usr/bin/env python3
"""Check a bounded carry-forward of unchanged tile inputs after the unit/link repair."""
import argparse
import json
from pathlib import Path
from repair_release_integrity import VERSION, UNCHANGED_TILES, digest_file

def verified(db, tile, report_path):
    try:
        report=json.loads(report_path.read_text())
        if report['version']!=VERSION or report['status']!='applied' or report['database_mtime_ns']!=db.stat().st_mtime_ns: return False
        if tile.name not in UNCHANGED_TILES: return False
        row=next(r for r in report['unchanged_tiles'] if r['path']==tile.name)
        # A restored file may regain its original modification time. Exact
        # bytes plus the same audited database snapshot are the identity check;
        # filesystem timestamps do not add evidence once SHA-256 matches.
        return row['bytes']==tile.stat().st_size and row['sha256']==digest_file(tile)
    except (OSError,ValueError,KeyError,StopIteration): return False

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('db',type=Path);ap.add_argument('tile',type=Path);a=ap.parse_args()
    raise SystemExit(0 if verified(a.db,a.tile,a.db.parent/'tile-integrity-repair.json') else 1)
