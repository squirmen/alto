#!/usr/bin/env python3
"""Build the tree_inat derived product: the iNaturalist records matched to each tree, for "iNaturalist records at
this tree" on the tree page.

Input: matches.parquet of the iNaturalist matching run (inat_v1_20261017; research-grade woody plant records with open
locations and a stated accuracy of 15 m or better, fetched through the public API on 17 Oct 2026 and matched by
location to the release's crowns and markers: inside a crown, or within 5 m + the record's accuracy, at most 15 m).

The licence of each record decides what is written, nothing else is copied:
  CC BY, CC BY-SA, CC BY-ND   taxon name, common name, month observed, phenology annotations, where it sits, the
                              observer's login for the credit line, the observation id;
  CC0                         the same without a login (none is stored);
  CC BY-NC (any variant) and all rights reserved
                              the observation id, the licence and where it sits only (the page links to the record).
Never written: photos, notes, identifications, comments, per-observer lists or counts.

Output (<out>/tree_inat/): index.json (schema alto.tree-inat/1) and 256 shards, <shard>.json, shard = FNV-1a 32 of the
tree number mod 256 as two hex digits (tree-record.js fnvShard). Each shard maps a tree number to
  {"n": records matched, "r": [[id, licence, "YYYY-MM" | null, where, metres, taxon | null, common | null,
                               phenology | null, login | null], ...]}
newest first, at most TOP records; where: "c" inside the crown, "n" near the crown (metres to its edge), "m" near the
tree's map position (metres to it); phenology: letters f (flowers), r (fruits or seeds), b (flower buds).

Usage: python3 pipeline/tool/build_tree_inat.py --matches .../inat_v1_20261017/matches.parquet --out DERIVED_FOLDER
         --release metro-2026.10.17-pointcloud-v6.3 [--matched-on metro-2026.10.13-pointcloud-v6.2]
Needs pandas and pyarrow (the main conda environment).
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

import pandas as pd

TOP = 10
SHARDS = 256
FACTS = {'cc-by', 'cc-by-sa', 'cc-by-nd', 'cc0'}
LOGIN = {'cc-by', 'cc-by-sa', 'cc-by-nd'}
WHERE = {'crown_contains': 'c', 'crown_near': 'n', 'record_marker': 'm', 'earlier_detection': 'm'}


def fnv(s):
    h = 2166136261
    for b in s.encode():
        h = ((h ^ b) * 16777619) & 0xffffffff
    return h


def row(r):
    lic = r.license_code if isinstance(r.license_code, str) and r.license_code else None
    where = WHERE[r.match_type]
    metres = 0 if where == 'c' else max(1, round(float(r.distance_m)))
    if lic not in FACTS:
        return [int(r.obs_id), lic, None, where, metres, None, None, None, None]
    phen = ''.join(k for k, col in (('f', 'ann_flowers'), ('r', 'ann_fruits'), ('b', 'ann_flower_buds')) if bool(getattr(r, col)))
    login = r.observer_login if lic in LOGIN and isinstance(r.observer_login, str) and r.observer_login else None
    month = r.observed_on.strftime('%Y-%m') if pd.notna(r.observed_on) else None
    common = r.common_name if isinstance(r.common_name, str) and r.common_name else None
    return [int(r.obs_id), lic, month, where, metres, r.taxon_name, common, phen or None, login]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', required=True)
    ap.add_argument('--out', required=True, help='the derived folder of the release (holds manifest.json)')
    ap.add_argument('--release', required=True)
    ap.add_argument('--matched-on', default=None, help='the dataset the matches were made on, if not --release')
    ap.add_argument('--fetched', default='2026-10-17')
    a = ap.parse_args()
    m = pd.read_parquet(a.matches)
    assert m.obs_id.is_unique, 'one row per record'
    m = m.sort_values(['alto_tn', 'observed_on', 'obs_id'], ascending=[True, False, False])
    shards = {f'{i:02x}': {} for i in range(SHARDS)}
    licences, trees = {}, 0
    for tn, g in m.groupby('alto_tn', sort=False):
        trees += 1
        shards[f'{fnv(tn) % SHARDS:02x}'][tn] = {'n': len(g), 'r': [row(r) for r in g.head(TOP).itertuples()]}
    for lic, n in m.license_code.fillna('none').replace('', 'none').value_counts().items():
        licences[lic] = int(n)
    out = Path(a.out) / 'tree_inat'
    out.mkdir(parents=True, exist_ok=True)
    digests = {}
    for k, v in shards.items():
        body = json.dumps(v, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
        (out / f'{k}.json').write_bytes(body)
        digests[k] = hashlib.sha256(body).hexdigest()
    index = {
        'schema': 'alto.tree-inat/1', 'release': a.release, 'built_on': a.release,
        'matched_on': a.matched_on or a.release,
        'generated_utc': datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        'source': {'name': 'iNaturalist', 'url': 'https://www.inaturalist.org/', 'api': 'https://api.inaturalist.org/',
                   'fetched': a.fetched,
                   'filter': 'Research-grade woody plant records in Auckland with open locations and a stated accuracy of 15 m or better'},
        'rule': 'Inside the crown, or within 5 m plus the record’s stated accuracy (at most 15 m) of it or of the tree’s map position',
        'licences': 'Each record keeps its own licence. Names, dates and annotations are shown for CC BY, CC BY-SA, CC BY-ND and CC0 records; other records are linked only.',
        'records': int(len(m)), 'trees': trees, 'top': TOP, 'licence_counts': licences,
        'shards': SHARDS, 'path': '{shard}.json', 'sha256': digests,
    }
    (out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')))
    mf_path = Path(a.out) / 'manifest.json'
    mf = json.loads(mf_path.read_text())
    mf['products']['tree_inat'] = 'tree_inat/index.json'
    mf.setdefault('checks', {})['tree_inat'] = {
        'built_on': a.release, 'matched_on': index['matched_on'], 'records': index['records'], 'trees': trees,
        'text': f'{index["records"]:,} iNaturalist records on {trees:,} trees; licence rules applied per record'}
    mf['updated_utc'] = index['generated_utc']
    mf_path.write_text(json.dumps(mf, ensure_ascii=False, separators=(',', ':')))
    print(json.dumps({'records': index['records'], 'trees': trees, 'licences': licences, 'out': str(out)}))


if __name__ == '__main__':
    main()
