#!/usr/bin/env python3
"""Check the actual V5.1 static products before sealing a deployable bundle."""
import collections
import gzip
import json
import math
import re
import sqlite3
import subprocess
from pathlib import Path

from build_v51 import AUDIT, DB, LIVE, STAGE, VERSION, W, bucket, now, sha, write


def unpack(schema, tid):
    packed = json.loads(gzip.decompress((STAGE / 'data/tree_details' / bucket(tid)).read_bytes()))[tid]
    return {d['key']: ([dict(zip(d['fields'], r)) for r in packed[d['key']]] if d['multiple'] else dict(zip(d['fields'], packed[d['key']])))
            for d in schema['datasets'] if d['key'] in packed}


def tile_features(archive, lon, lat, layer):
    z = 18
    x = int((lon + 180) / 360 * 2**z)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**z)
    cmd = ['/opt/homebrew/bin/tippecanoe-decode', '-l', layer, str(archive), str(z), str(x), str(y)]
    data = json.loads(subprocess.check_output(cmd))
    return [f for group in data['features'] for f in group.get('features', [])]


def main():
    source_proof = json.loads((AUDIT / 'verification.json').read_text())
    assert source_proof['success'] is True
    snapshot = json.loads((W / 'verification/database_snapshot.json').read_text())
    assert sha(AUDIT / 'verification.json') == snapshot['repair_verification_sha256']
    assert str(DB.stat().st_mtime_ns) == snapshot['mtime_ns'] and DB.stat().st_size == snapshot['bytes']
    schema = json.loads((STAGE / 'data/tree_details/schema.json').read_text())
    assert schema['records'] == 6238420 and schema['database_mtime_ns'] == snapshot['mtime_ns']
    assert schema['coverage']['crown_link_review'] == 33396
    manifest = json.loads((W / 'verification/details_manifest.json').read_text())
    assert len(manifest['files']) == 65536 and sum(f['records'] for f in manifest['files']) == schema['records']
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA cache_size=-200000')
    plan = json.loads((AUDIT / 'repair_plan.json').read_text())
    chosen = {g['primary']: g for g in plan['groups'][::300]}
    for g in plan['groups']:
        if any(t in g['restored_ids'] for t in ('akl_tree_trp_ACCT0255252', 'akl_tree_trp_ACCT0060116', 'akl_tree_trp_ACCT0060118')):
            chosen[g['primary']] = g
    profile_checks, tile_checks = [], []
    fields = {d['key']: d for d in schema['datasets']}
    for tid, group in chosen.items():
        ids = [r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (group['seg_key'],))]
        service_rows = 0
        for member in ids:
            rec = unpack(schema, member)
            for key in ('identity', 'crown', 'pointcloud', 'assets', 'roots', 'services', 'crown_link_review', 'record'):
                d = fields[key]
                row = c.execute('SELECT ' + ','.join(d['fields']) + ' FROM ' + d['table'] + ' WHERE tree_id=?', (member,)).fetchone()
                expanded = {k: rec.get(key, {}).get(k) for k in d['fields']}
                assert expanded == (dict(row) if row else dict.fromkeys(d['fields'])), (member, key)
            assert rec['identity']['current_primary_tree_id'] == tid
            service_rows += 'services' in rec
        assert service_rows == 1
        loc = c.execute('SELECT lon,lat FROM tree_display_v5 WHERE tree_id=?', (tid,)).fetchone()
        crown = unpack(schema, tid)['crown']
        for name, layer in [('trees_map_points', 'trees'), ('tree_crowns_pilot', 'crowns')]:
            features = tile_features(STAGE / 'data' / (name + '.pmtiles'), *loc, layer)
            matches = [f for f in features if f['properties']['tree_id'] == tid]
            assert matches, (name, tid, 'missing at maximum zoom')
            for f in matches:
                p = f['properties']
                assert abs(p['crown_area_m2'] - crown['crown_area_m2']) < .002
                assert abs(p['crown_max_chm_m'] - crown['crown_max_chm_m']) < .002
                assert p['linked_source_records'] == len(ids)
                assert p.get('tenure') in {'street', 'park', 'institutional', 'private', 'other', 'unknown'}
            assert not any(f['properties']['tree_id'] in set(ids) - {tid} for f in features), (name, tid, 'duplicate alias marker/crown')
        profile_checks.append({'primary': tid, 'linked_records_checked': len(ids), 'one_current_service_record': True})
        tile_checks.append(tid)
    for tid, expected in snapshot['accepted_ground'].items():
        actual = unpack(schema, tid)['ground']
        assert {k: actual.get(k) for k in expected} == expected
    ar = unpack(schema, 'akl_tree_trp_ACCT0255252')
    assert ar['crown_link_review']['status'] == 'restore_association'
    assert ar['crown']['crown_area_m2'] == 101.25
    assert all(ar['trajectory'].get(k) is not None for k in ('h_2013', 'h_2016', 'h_2024'))
    totals = json.loads((W / 'web_build/totals.json').read_text())
    assert totals['totals']['trees'] == 3577365
    assert totals['totals']['crowns'] == 3522567
    assert totals['display_roles'] == dict(c.execute('SELECT display_role,count(*) FROM tree_display_v5 GROUP BY display_role'))
    index = (STAGE / 'index.html').read_text()
    embedded = json.loads(re.search(r'const PILOT_TOTALS = (\{.*?\});', index, re.S)[1])
    assert embedded == totals['totals']
    assert 'Crown unlinked' in index and '<span>No crown</span>' not in index
    assert f'window.AKL_TILE_VERSION="{VERSION}"' in index
    # Reconcile decoded property buckets, not just the builder's in-memory totals.
    ps = json.loads((STAGE / 'data/property_details/schema.json').read_text())
    pf = next(d['fields'] for d in ps['datasets'] if d['key'] == 'property')
    keys = {'trees': 'n_trees', 'totalValueNzdY': 'total_value_nzd_y', 'runoffM3Y': 'avoided_runoff_m3_y', 'carbonTco2e': 'stored_co2e_tonnes_est'}
    sums, records, buckets = collections.Counter(), 0, 0
    ix = {k: pf.index(v) for k, v in keys.items()}
    for p in sorted((STAGE / 'data/property_details').glob('*/*.json.gz')):
        buckets += 1
        for pid, rec in json.loads(gzip.decompress(p.read_bytes())).items():
            assert bucket(pid) == p.relative_to(STAGE / 'data/property_details').as_posix()
            row = rec['property']
            records += 1
            for key, i in ix.items():
                sums[key] += row[i] or 0
            assert len(rec.get('trees', [])) == row[pf.index('trees_listed')]
    assert records == ps['records'] and ps['database_mtime_ns'] == schema['database_mtime_ns']
    recon = json.loads((W / 'properties/data/build_stats.json').read_text())['summaries']['reconciliation']
    property_checks = {}
    for key in keys:
        assert abs(recon[key]['difference']) < .1, key
        difference = sums[key] + recon[key]['unassigned'] - totals['totals'][key]
        # Public property service rows round to .001, with this worst-case bound.
        assert abs(difference) <= (0 if key == 'trees' else records * .00051), (key, difference)
        property_checks[key] = {'decoded_parcel_sum': sums[key], 'unassigned': recon[key]['unassigned'], 'difference_after_rounding': difference}
    nearby = STAGE / 'kyte/data/nearby'
    nm = json.loads((nearby / 'manifest.json').read_text())
    assert nm['database_mtime_ns'] == schema['database_mtime_ns'] and nm['records'] == 3576718
    assert nm['detail_snapshot'] == schema['generated_utc']
    nrows = 0
    for f in nm['files']:
        p = nearby / f['path']
        assert sha(p) == f['sha256']
        if 'records' in f:
            rows = json.loads(gzip.decompress(p.read_bytes()))
            assert len(rows) == f['records']
            nrows += len(rows)
    assert nrows == nm['records']
    for name in ('trees_map_points', 'tree_crowns_pilot', 'properties'):
        subprocess.run(['/opt/homebrew/bin/pmtiles', 'verify', str(STAGE / 'data' / (name + '.pmtiles'))], check=True)
    for p in ('tree-identity.js', 'kyte/config.js', 'kyte/sw.js'):
        subprocess.run(['/opt/homebrew/bin/node', '--check', str(STAGE / p)], check=True)
    snippets = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', index, re.S)
    for i, text in enumerate(snippets):
        if text.strip():
            p = W / 'tmp' / f'inline-{i}.js'
            p.write_text(text)
            subprocess.run(['/opt/homebrew/bin/node', '--check', str(p)], check=True)
    assert str(DB.stat().st_mtime_ns) == snapshot['mtime_ns']
    report = {'status': 'passed', 'checked_utc': now(), 'version': VERSION, 'database_mtime_ns': schema['database_mtime_ns'],
              'repaired_database_verification_sha256': snapshot['repair_verification_sha256'], 'profile_cases': profile_checks,
              'maximum_zoom_tile_cases': tile_checks, 'total_profiles': schema['records'], 'property_buckets': buckets,
              'property_records': records, 'property_reconciliation': property_checks, 'nearby_records': nrows,
              'accepted_kyte_records_preserved': list(snapshot['accepted_ground']), 'geometry_redrawn': False}
    write(W / 'verification/release-checks.json', report)
    write(STAGE / 'release-checks.json', report)
    deploy = json.loads((STAGE / 'deployment.json').read_text())
    files = []
    for relative in deploy['replace_paths']:
        if relative == 'bundle-manifest.json':
            continue
        p = STAGE / relative
        candidates = sorted(q for q in p.rglob('*') if q.is_file()) if p.is_dir() else [p]
        for q in candidates:
            assert q.is_file() and not q.is_symlink()
            files.append({'path': q.relative_to(STAGE).as_posix(), 'bytes': q.stat().st_size, 'sha256': sha(q)})
    assert len({f['path'] for f in files}) == len(files)
    write(STAGE / 'bundle-manifest.json', {'version': VERSION, 'tree_records': schema['records'], 'created_utc': now(), 'files': files})
    c.close()
    print(json.dumps({k: report[k] for k in ('status', 'version', 'total_profiles', 'property_records', 'nearby_records')}, indent=2), flush=True)


if __name__ == '__main__':
    main()
