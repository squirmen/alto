#!/usr/bin/env python3
"""Read the deployed V5.2 HTTP products after activation: links, record-seeded crowns and unchanged cases."""
import gzip
import json
import urllib.request

from build_v52 import CASES, OUT, VERSION, W, bucket, now, write

BASE = 'https://alto.tfwelch.com/'


def get(path, headers=None):
    request = urllib.request.Request(BASE + path + ('&' if '?' in path else '?') + 'v=' + VERSION,
                                     headers={'User-Agent': 'Mozilla/5.0 ALTO V5.2 release verification', **(headers or {})})
    with urllib.request.urlopen(request, timeout=60) as r:
        return r.status, dict(r.headers), r.read()


def obj(path):
    _, _, data = get(path)
    return json.loads(gzip.decompress(data) if data[:2] == b'\x1f\x8b' else data)


def main():
    page = get('index.html')[2].decode()
    assert f'window.AKL_TILE_VERSION="{VERSION}"' in page and f'record-links.js?v={VERSION}' in page and 'v52-methods.html' in page
    meta = obj('release-metadata.json')
    assert meta['assembly']['tile_version'] == VERSION and meta['release']['dataset_version'] == 'metro-2026.10.10-pointcloud-v5.2'
    assert meta['previous_release']['release']['dataset_version'] == 'metro-2026.10.08-pointcloud-v5.1'
    assert any(a['path'] == 'data/council_positions.pmtiles' for a in meta['artifacts'])
    schema = obj('data/tree_details/schema.json')
    assert schema['release'] == VERSION and schema['records'] == 6238420 and any(d['key'] == 'record_link' for d in schema['datasets'])

    def profile(tid):
        packed = obj('data/tree_details/' + bucket(tid))[tid]
        return {d['key']: dict(zip(d['fields'], packed[d['key']])) for d in schema['datasets'] if d['key'] in packed and not d['multiple']}
    checks = []
    for tid in CASES['probable'] + CASES['seeded']:
        d = profile(tid)
        assert d['record_link']['link_class'] in ('probable', 'drawn_from_record') and d['identity']['seg_key'] == d['record_link']['seg_key']
        assert (d['crown']['crown_source'] == 'record_seeded_v52') == (tid in CASES['seeded'])
        checks.append({'id': tid, 'link_class': d['record_link']['link_class'], 'joined_as': d['record_link']['joined_as'], 'crown_source': d['crown']['crown_source']})
    for tid in CASES['unchanged']:
        d = profile(tid)
        assert 'record_link' not in d and d['identity']['link_role'] == 'unlinked'
        checks.append({'id': tid, 'state': 'unlinked, unchanged'})
    r = profile('akl_tree_trp_ACCT0255252')
    assert r['crown_link_review']['status'] == 'restore_association'
    for tid in ('akl_tree_lid_1097574', 'akl_tree_lcp_0159718'):
        assert profile(tid)['ground']['method_id'] == 'kyte-ground-evidence-v1'
    ps = obj('data/property_details/schema.json')
    assert ps['database_mtime_ns'] == schema['database_mtime_ns'] and ps['release'] == VERSION
    nearby = obj('kyte/data/nearby/manifest.json')
    assert nearby['release'] == VERSION and nearby['database_mtime_ns'] == schema['database_mtime_ns']
    for name in ('trees_map_points', 'tree_crowns_pilot', 'properties', 'council_positions'):
        status, headers, data = get('data/' + name + '.pmtiles', {'Range': 'bytes=0-127', 'Accept-Encoding': 'identity'})
        assert status == 206 and len(data) == 128 and data.startswith(b'PMTiles') and not headers.get('Content-Encoding'), name
    assert 'V5.2' in get('v52-methods.html')[2].decode()
    assert get('record-links.js')[2].decode().startswith('/* V5.2 record-to-crown links')
    assert 'V5.2' in get('data/exports/akl_trees_data_dictionary.md')[2].decode()
    assert '20261010-v14c-v52-data' in get('kyte/config.js')[2].decode()
    report = {'status': 'passed', 'checked_utc': now(), 'version': VERSION, 'url': BASE, 'profile_cases': checks, 'all_profiles': schema['records'],
              'nearby_records': nearby['records'], 'property_records': ps['records'], 'pmtiles_byte_ranges': 'passed', 'accepted_ground_visits': 'preserved'}
    write(W / 'verification/public_http_smoke.json', report)
    write(OUT / 'public_http_smoke.json', report)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
