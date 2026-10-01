#!/usr/bin/env python3
"""Re-shard the v5 tree-detail buckets from 4,096 files to 65,536.

Every tree profile fetched one ~1 MB bucket holding ~1,500 records, which is the
pause between a tree's map summary and its full record. With 65,536 buckets the
fetch is ~60 KB. Because 65536 = 16 x 4096, each old bucket splits into exactly
sixteen new ones and nothing is merged across files, so the records are byte-for-
byte the release's records. The only additions are ground rows for KYTE visits
accepted since the release, listed in PATCHES.

Output layout: tree_details/{hh}/{hh}.json.gz where the four hex digits are
FNV-1a(tree_id) mod 65536.
"""
import gzip, hashlib, json, os, sys, time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

SRC = Path('/data/alto/working/alto_v5_20260922/deploy/alto_v5_upload_20260923/data/tree_details')
OUT = Path('/data/alto/working/alto_v5_20260922/details_v2/tree_details')
LEVEL = 7

# Ground rows for visits accepted after the release. Field order follows the schema's
# `ground` dataset. Species is left empty on purpose: the observer did not record one,
# and a name read off a photograph by a machine does not belong in a public record.
PATCHES = {
    'akl_tree_lid_1097574': {'ground': ['2026-09-22', 'confirmed', 'whole_tree, trunk, leaves', 3.8, None, None, None, None, None, None, None, None, None, None,
        'A KYTE visit on 22 September 2026 photographed this tree from the ground; the person confirmed it as the record photographed and the visit was accepted on review. No trunk or crown measurement was taken.',
        'kyte-ground-evidence-v1', '2026-09-28T00:00:00+00:00']},
    'akl_tree_lcp_0159718': {'ground': ['2026-09-24', 'confirmed', 'whole_tree, trunk', 2.1, None, None, None, None, None, None, None, None, None, None,
        'A KYTE visit on 24 September 2026 photographed this tree, whole and trunk, in Bayswater Park; the person confirmed the record and the visit was accepted on review. No measurement was taken and the observer did not record a species.',
        'kyte-ground-evidence-v1', '2026-09-28T00:00:00+00:00']},
}

def fnv(tree_id):
    h = 2166136261
    for b in tree_id.encode('utf-8'):
        h = ((h ^ b) * 16777619) & 0xffffffff
    return h

def trim(values):
    values = list(values)
    while values and values[-1] is None:
        values.pop()
    return values

def split(name):
    old = int(name, 16)
    with gzip.open(SRC / f'{name}.json.gz', 'rt', encoding='utf-8') as f:
        records = json.load(f)
    groups = {}
    patched = []
    for tid, rec in records.items():
        h = fnv(tid)
        assert h % 4096 == old, (tid, name)
        if tid in PATCHES:
            for key, values in PATCHES[tid].items():
                assert key not in rec, (tid, key)
                rec[key] = trim(values)
            patched.append(tid)
        groups.setdefault(h % 65536, {})[tid] = rec
    out = []
    for nb, recs in groups.items():
        d = OUT / f'{nb >> 8:02x}'
        d.mkdir(parents=True, exist_ok=True)
        p = d / f'{nb & 255:02x}.json.gz'
        payload = (json.dumps(recs, separators=(',', ':'), ensure_ascii=False) + '\n').encode('utf-8')
        data = gzip.compress(payload, compresslevel=LEVEL, mtime=0)
        p.write_bytes(data)
        out.append((f'tree_details/{nb >> 8:02x}/{nb & 255:02x}.json.gz', len(data), hashlib.sha256(data).hexdigest(), len(recs)))
    return name, len(records), out, patched

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    names = sorted(p.name[:3] for p in SRC.glob('*.json.gz'))
    assert len(names) == 4096, len(names)
    schema = json.loads((SRC / 'schema.json').read_text())
    total = 0; files = []; patched = []; t0 = time.time()
    with ProcessPoolExecutor(max_workers=8) as pool:
        for i, (name, n, out, pt) in enumerate(pool.map(split, names, chunksize=4), 1):
            total += n; files.extend(out); patched.extend(pt)
            if i % 128 == 0:
                print(f'{i}/4096 old buckets · {total:,} records · {time.time()-t0:.0f}s', flush=True)
    assert total == schema['records'], (total, schema['records'])
    assert sorted(patched) == sorted(PATCHES), patched
    assert len(files) == 65536, len(files)
    schema['bucket_algorithm'] = 'fnv1a_utf8_mod65536_hex4_split2'
    schema['resharded_utc'] = time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime())
    schema['reshard_note'] = 'Same release records re-divided into 65,536 buckets so a profile fetches about 60 KB instead of 1 MB. Ground rows added for KYTE visits accepted after the release: ' + ', '.join(sorted(PATCHES)) + '.'
    schema['coverage']['ground'] = schema['coverage'].get('ground', 0) + len(PATCHES)
    (OUT / 'schema.json').write_text(json.dumps(schema, separators=(',', ':'), ensure_ascii=False) + '\n')
    (OUT / '.htaccess').write_text((SRC / '.htaccess').read_text())
    files.sort()
    manifest = {'bucket_algorithm': schema['bucket_algorithm'], 'records': total, 'files': [{'path': p, 'bytes': b, 'sha256': s, 'records': r} for p, b, s, r in files]}
    for extra in ('schema.json', '.htaccess'):
        data = (OUT / extra).read_bytes()
        manifest['files'].append({'path': f'tree_details/{extra}', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'records': 0})
    (OUT.parent / 'details_manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    sizes = [b for _, b, _, _ in files]
    print(json.dumps({'records': total, 'files': len(files), 'total_mb': round(sum(sizes) / 1048576, 1), 'mean_kb': round(sum(sizes) / len(sizes) / 1024, 1), 'max_kb': round(max(sizes) / 1024, 1), 'seconds': round(time.time() - t0)}), flush=True)

if __name__ == '__main__':
    main()
