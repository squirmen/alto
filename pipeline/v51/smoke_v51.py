#!/usr/bin/env python3
"""Read the deployed V5.1 HTTP products, including repaired and old alias IDs."""
import gzip
import json
import urllib.request

from build_v51 import ROOT, VERSION, W, bucket, now, write

BASE = 'https://alto.tfwelch.com/'


def get(path, headers=None):
    request = urllib.request.Request(BASE + path + ('&' if '?' in path else '?') + 'v=' + VERSION,
                                    headers={'User-Agent': 'ALTO V5.1 release verification', **(headers or {})})
    with urllib.request.urlopen(request, timeout=60) as r:
        data = r.read()
        return r.status, dict(r.headers), data


def obj(path):
    _, _, data = get(path)
    return json.loads(gzip.decompress(data) if data[:2] == b'\x1f\x8b' else data)


def main():
    _, _, page = get('index.html')
    page = page.decode()
    assert f'window.AKL_TILE_VERSION="{VERSION}"' in page and 'Crown unlinked' in page
    meta = obj('release-metadata.json')
    assert meta['assembly']['tile_version'] == VERSION
    assert meta['release']['dataset_version'] == 'metro-2026.10.08-pointcloud-v5.1'
    assert meta['previous_release']['release']['dataset_version'] == 'metro-2026.09.23-pointcloud-v5'
    schema = obj('data/tree_details/schema.json')
    assert schema['release'] == VERSION and schema['records'] == 6238420
    def profile(tid):
        packed = obj('data/tree_details/' + bucket(tid))[tid]
        return {d['key']: dict(zip(d['fields'], packed[d['key']])) for d in schema['datasets'] if d['key'] in packed and not d['multiple']}
    checks = []
    for tid, primary in [('akl_tree_trp_ACCT0255252', 'akl_tree_trp_ACCT0255252'),
                         ('akl_tree_pc5_07d63b73c211a292949a', 'akl_tree_trp_ACCT0255252'),
                         ('akl_tree_trp_ACCT0060116', 'akl_tree_trp_ACCT0238479'),
                         ('akl_tree_trp_ACCT0243631', 'akl_tree_trp_ACCT0238479'),
                         ('akl_tree_trp_ACCT0060118', 'akl_tree_trp_ACCT0060118')]:
        d = profile(tid)
        assert d['identity']['current_primary_tree_id'] == primary
        assert d['crown']['crown_area_m2'] > 0 and d['crown']['crown_max_chm_m'] > 0
        assert ('services' in d) == (tid == primary)
        checks.append({'id': tid, 'representative': primary, 'height_m': d['crown']['crown_max_chm_m'], 'area_m2': d['crown']['crown_area_m2']})
    for tid in ('akl_tree_lid_1097574', 'akl_tree_lcp_0159718'):
        assert profile(tid)['ground']['method_id'] == 'kyte-ground-evidence-v1'
    ps = obj('data/property_details/schema.json')
    assert ps['database_mtime_ns'] == schema['database_mtime_ns'] and ps['release'] == VERSION
    nearby = obj('kyte/data/nearby/manifest.json')
    assert nearby['records'] == 3576718 and nearby['database_mtime_ns'] == schema['database_mtime_ns']
    for name in ('trees_map_points', 'tree_crowns_pilot', 'properties'):
        status, headers, data = get('data/' + name + '.pmtiles', {'Range': 'bytes=0-127', 'Accept-Encoding': 'identity'})
        assert status == 206 and len(data) == 128 and data.startswith(b'PMTiles')
        assert not headers.get('Content-Encoding')
    assert 'V5.1' in get('v51-methods.html')[2].decode()
    assert 'V5.1' in get('data/exports/akl_trees_data_dictionary.md')[2].decode()
    assert '20261008-v14c-v51-data' in get('kyte/config.js')[2].decode()
    report = {'status': 'passed', 'checked_utc': now(), 'version': VERSION, 'url': BASE,
              'profile_cases': checks, 'all_profiles': schema['records'], 'nearby_records': nearby['records'],
              'property_records': ps['records'], 'pmtiles_byte_ranges': 'passed', 'accepted_ground_visits': 'preserved'}
    write(W / 'verification/public_http_smoke.json', report)
    write(ROOT / 'outputs/alto_v51_release/public_http_smoke.json', report)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
