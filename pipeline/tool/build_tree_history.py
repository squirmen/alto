#!/usr/bin/env python3
"""Release-by-release ID lineage for the tree page: what each release changed about a tree ID.

Reads the release comparison tables of the tree-ID audit (one parquet file per pair of releases, rows
per tree ID that changed: became the crown's map marker, lost its marker, was demoted, moved) and
writes the tree_history derived product for one release:

  tree_history/index.json        release, transitions covered, shard count, path pattern, counts
  tree_history/{shard}.json      {tree_id: [{release, change, moved_m, seg_from, seg_to, role_to}, ...]}

Shard = FNV-1a of the tree ID mod --shards, hex (as in the tree record). Crown changes from v4 to v5
are not repeated here: every record already carries its v4 and v5 crowns.

Usage:
  build_tree_history.py --metadata release-metadata.json --out DERIVED/<dataset_version> \
      --transition v5.1=changes_v5_to_v51.parquet --transition v5.2=changes_v51_to_v52.parquet
"""
import argparse
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timezone

import pyarrow.parquet as pq


def fnv(s):
    h = 2166136261
    for b in s.encode('utf-8'):
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))


def register(out_root, release, key, path):
    mf = os.path.join(out_root, 'manifest.json')
    m = json.load(open(mf)) if os.path.exists(mf) else {'schema': 'alto.derived-manifest/1', 'release': release, 'products': {}}
    if m.get('release') != release:
        raise SystemExit(f'{mf} is for {m.get("release")}, not {release}')
    m['products'][key] = path
    m['updated_utc'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    write_json(mf, m)


def clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return round(v, 2) if isinstance(v, float) else v


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--metadata', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--transition', action='append', required=True, help='RELEASE=changes.parquet (the release the change arrived in)')
    ap.add_argument('--shards', type=int, default=256)
    ap.add_argument('--source', default='ALTO tree-ID audit: release comparison of tree IDs and crown keys')
    a = ap.parse_args()
    release = json.load(open(a.metadata))['release']['dataset_version']
    width = max(1, len(format(a.shards - 1, 'x')))
    shards = defaultdict(dict)
    counts = {}
    for t in a.transition:
        rel, path = t.split('=', 1)
        cols = ['tree_id', 'change', 'denoted_moved_m', 'rep_seg_from', 'rep_seg_to', 'role_to', 'source_changed', 'record_moved_m']
        tab = pq.read_table(path, columns=[c for c in cols if c in pq.read_schema(path).names]).to_pylist()
        counts[rel] = len(tab)
        for r in tab:
            e = {'release': rel, 'change': r['change'], 'moved_m': clean(r.get('denoted_moved_m')), 'seg_from': clean(r.get('rep_seg_from')),
                 'seg_to': clean(r.get('rep_seg_to')), 'role_to': clean(r.get('role_to'))}
            if r.get('source_changed'):
                e['source_changed'] = True
            if clean(r.get('record_moved_m')):
                e['record_moved_m'] = clean(r.get('record_moved_m'))
            shards[format(fnv(r['tree_id']) % a.shards, f'0{width}x')].setdefault(r['tree_id'], []).append({k: v for k, v in e.items() if v is not None})
    out = os.path.join(a.out, 'tree_history')
    for s, entries in shards.items():
        write_json(os.path.join(out, f'{s}.json'), entries)
    write_json(os.path.join(out, 'index.json'), {
        'schema': 'alto.tree-history/1', 'release': release, 'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': a.source, 'transitions': counts, 'releases': list(counts), 'shards': a.shards, 'path': '{shard}.json',
        'changes': {'became_rep': 'became the map marker of its crown', 'rep_demoted_marker_lost': 'no longer the crown’s map marker; marker removed',
                    'marker_lost': 'map marker removed', 'marker_gained': 'map marker added', 'rep_repointed': 'now names a different crown'}})
    register(a.out, release, 'tree_history', 'tree_history/index.json')
    print(json.dumps({'release': release, 'transitions': counts, 'ids': sum(len(v) for v in shards.values()), 'shards': len(shards)}))


if __name__ == '__main__':
    main()
