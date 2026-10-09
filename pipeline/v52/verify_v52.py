#!/usr/bin/env python3
"""Check the actual V5.2 static products before sealing a deployable bundle.

Every published link must appear exactly once, release totals may move only as the package
explains, nothing V5.1 published may disappear or be overridden, and the named review cases must
land where the decisions say. Only then is the bundle manifest sealed.
"""
import collections
import gzip
import json
import math
import re
import subprocess
from pathlib import Path

import pandas as pd

from build_v52 import (CASES, DB, DB51, PKG, PROTECTED_SQL, SEEDED, STAGE, STAGE51, VERSION, W, W51, bucket, now, ro, sha, write)


def unpack(root, schema, tid):
    packed = json.loads(gzip.decompress((root / 'data/tree_details' / bucket(tid)).read_bytes()))[tid]
    return {d['key']: ([dict(zip(d['fields'], r)) for r in packed[d['key']]] if d['multiple'] else dict(zip(d['fields'], packed[d['key']])))
            for d in schema['datasets'] if d['key'] in packed}


def raw_record(root, tid):
    return json.loads(gzip.decompress((root / 'data/tree_details' / bucket(tid)).read_bytes()))[tid]


def tile_features(archive, lon, lat, layer):
    """Features of the exact z18 tile, read with the PMTiles directory as a browser reads it.

    tippecanoe-decode's own PMTiles lookup falls back to a z14 parent for some tiles of these large
    archives (V5.1's archive shows the same), so the tile is extracted with go-pmtiles and decoded alone.
    """
    z = 18
    x = int((lon + 180) / 360 * 2**z)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**z)
    blob = subprocess.check_output(['/opt/homebrew/bin/pmtiles', 'tile', str(archive), str(z), str(x), str(y)])
    assert blob, (archive, z, x, y, 'tile missing')
    path = W / 'tmp/check_tile.pbf'
    path.write_bytes(blob)
    data = json.loads(subprocess.check_output(['/opt/homebrew/bin/tippecanoe-decode', '-l', layer, str(path), str(z), str(x), str(y)]))
    return [f for group in data['features'] for f in group.get('features', [])]


def scan(path, wanted):
    """Every line of a feature stream for the wanted tree IDs, without parsing the rest."""
    found = collections.defaultdict(list)
    key = b'"tree_id":"'
    with path.open('rb', buffering=1 << 24) as f:
        for line in f:
            i = line.find(key) + 11
            tid = line[i:line.index(b'"', i)].decode()
            if tid in wanted:
                found[tid].append(line)
    return found


def main():
    report = {'status': 'running', 'checked_utc': now(), 'version': VERSION}
    snapshot = json.loads((W / 'verification/database_snapshot.json').read_text())
    assert str(DB.stat().st_mtime_ns) == snapshot['mtime_ns'] and DB.stat().st_size == snapshot['bytes'], 'V5.2 database changed after sealing'
    assert str(DB51.stat().st_mtime_ns) == snapshot['baseline_mtime_ns'] and DB51.stat().st_size == snapshot['baseline_bytes'], 'V5.1 database was modified'
    audit = json.loads((W / 'verification/package_audit.json').read_text())
    assert sha(W / 'verification/package_audit.json') == snapshot['package_audit_sha256']
    for name, h in audit['package_sha256'].items():
        assert sha(PKG / name) == h, name
    summary = snapshot['summary']
    excluded = set(summary['excluded_links'])
    links = pd.read_parquet(PKG / 'links_publish.parquet')
    links = links[~links.tree_id.isin(excluded)].set_index('tree_id', drop=False)
    outside = pd.read_parquet(PKG / 'unlinked_outside_coverage.parquet', columns=['tree_id'])
    queue = pd.read_parquet(PKG / 'workbench_queue.parquet', columns=['tree_id', 'status', 'reason', 'queue_reason']).set_index('tree_id')
    schema = json.loads((STAGE / 'data/tree_details/schema.json').read_text())
    schema51 = json.loads((STAGE51 / 'data/tree_details/schema.json').read_text())
    assert schema['records'] == 6238420 and schema['database_mtime_ns'] == snapshot['mtime_ns'] and schema['release'] == VERSION
    assert schema['coverage']['record_link'] == len(links)
    assert schema['coverage']['record_link_status'] == summary['outside_coverage_reasons_published']
    assert schema['coverage']['crown_link_review'] == schema51['coverage']['crown_link_review'] == 33396
    assert schema['coverage']['ground'] == schema51['coverage']['ground']
    manifest = json.loads((W / 'verification/details_manifest.json').read_text())
    assert len(manifest['files']) == 65536 and sum(f['records'] for f in manifest['files']) == schema['records']

    c = ro()
    c.execute('ATTACH DATABASE ? AS v51', (f'file:{DB51}?mode=ro',))
    # 1. Nothing removed, nothing V5.1 decided overridden.
    kept = {}
    kept['trees'] = [c.execute('SELECT count(*) FROM main.trees').fetchone()[0], c.execute('SELECT count(*) FROM v51.trees').fetchone()[0]]
    assert kept['trees'] == [6238420, 6238420]
    kept['v51_trees_missing'] = c.execute('SELECT count(*) FROM v51.trees o WHERE NOT EXISTS (SELECT 1 FROM main.trees n WHERE n.tree_id=o.tree_id)').fetchone()[0]
    kept['source_positions_changed'] = c.execute('''SELECT count(*) FROM v51.trees o JOIN main.trees n USING(tree_id)
        WHERE n.lon IS NOT o.lon OR n.lat IS NOT o.lat OR n.source_tree_id IS NOT o.source_tree_id OR n.source_primary IS NOT o.source_primary''').fetchone()[0]
    assert kept['v51_trees_missing'] == 0 and kept['source_positions_changed'] == 0
    for table in ('tree_ground_evidence', 'tree_crown_link_repairs_v5', 'tree_field_observation_v5', 'tree_location_review_v5', 'notable_source_crosswalk_v5'):
        a = c.execute(f'SELECT count(*) FROM (SELECT * FROM main.{table} EXCEPT SELECT * FROM v51.{table})').fetchone()[0]
        b = c.execute(f'SELECT count(*) FROM (SELECT * FROM v51.{table} EXCEPT SELECT * FROM main.{table})').fetchone()[0]
        kept[table] = {'rows': c.execute(f'SELECT count(*) FROM main.{table}').fetchone()[0], 'added': a, 'removed_or_changed': b}
        assert a == 0 and b == 0, table
    kept['v51_links_changed'] = c.execute('''SELECT count(*) FROM v51.tree_crown_v5_links o LEFT JOIN main.tree_crown_v5_links n USING(tree_id)
        WHERE n.seg_key IS NOT o.seg_key OR n.top_distance_m IS NOT o.top_distance_m''').fetchone()[0]
    assert kept['v51_links_changed'] == 0
    groups = [dict(r) for r in c.execute('SELECT * FROM record_link_v52_groups')]
    v5groups = [g for g in groups if g['crown_source'] == 'v5']
    kept['v5_crowns'] = [c.execute('SELECT count(*) FROM main.tree_crown_v5').fetchone()[0], c.execute('SELECT count(*) FROM v51.tree_crown_v5').fetchone()[0]]
    kept['v5_crown_representatives_changed'] = c.execute('''SELECT count(*) FROM main.tree_crown_v5 n JOIN v51.tree_crown_v5 o USING(seg_key)
        WHERE n.primary_tree_id IS NOT o.primary_tree_id''').fetchone()[0]
    assert kept['v5_crowns'][0] == kept['v5_crowns'][1] and kept['v5_crown_representatives_changed'] == sum(g['primary_changed'] for g in v5groups)
    for g in v5groups:
        assert c.execute('SELECT n.crown_wkb=o.crown_wkb FROM main.tree_crown_v5 n JOIN v51.tree_crown_v5 o USING(seg_key) WHERE seg_key=?', (g['seg_key'],)).fetchone()[0] == 1
    kept['v5_geometry_of_linked_crowns_unchanged'] = len(v5groups)
    report['preservation'] = kept

    # 2. Every published link present exactly once, in the database, the profiles and the layer.
    db_links = {r['tree_id']: dict(r) for r in c.execute('SELECT * FROM tree_record_link_v52')}
    assert set(db_links) == set(links.tree_id)
    joined = {r[0]: r[1] for r in c.execute('SELECT l.tree_id,l.seg_key FROM tree_crown_v5_links l JOIN tree_record_link_v52 r USING(tree_id)')}
    assert len(joined) == len(links) and all(joined[t] == links.loc[t, 'seg_key'] for t in joined)
    assert all(db_links[t]['link_class'] == links.loc[t, 'link_class'] for t in db_links)
    markers = {t for t, r in db_links.items() if r['joined_as'] == 'marker'}
    kept = {t for t, r in db_links.items() if r['joined_as'] == 'member_keeps_marker'}
    members = set(db_links) - markers - kept
    profile_links = 0
    for tid in sorted(db_links):
        rec = unpack(STAGE, schema, tid)
        rl, idn, src = rec['record_link'], rec['identity'], rec['record']
        assert rl['seg_key'] == idn['seg_key'] == db_links[tid]['seg_key'] and rl['link_class'] == db_links[tid]['link_class'], tid
        assert abs(rl['source_lon'] - src['lon']) < 1e-7 and abs(rl['source_lat'] - src['lat']) < 1e-7, tid
        assert (idn['current_primary_tree_id'] == tid) == (tid in markers), tid
        assert (rec['crown']['crown_source'] == SEEDED) == (db_links[tid]['crown_source'] == SEEDED), tid
        profile_links += 1
    positions = json.loads((W / 'verification/council_positions.json').read_text())
    assert positions['published_links'] == len(links) and positions['one_point_and_one_line_per_link'] and positions['problem_count'] == 0
    assert sha(STAGE / 'data/council_positions.pmtiles') == positions['sha256']
    unchanged = set(CASES['unchanged'])
    lines = scan(W / 'web_build/points.geojsonl', set(db_links) | unchanged)
    lines51 = scan(W51 / 'web_build/points.geojsonl', unchanged)
    assert all(len(lines[t]) == 1 for t in markers | kept) and not any(t in lines for t in members), 'markers once, members never'
    for t in markers | kept:
        p = json.loads(lines[t][0])['properties']
        assert p['link_class'] == db_links[t]['link_class'] and p['link_evidence'] == db_links[t]['link_evidence'], t
        assert (p.get('display_style') == 'faint') == (db_links[t]['crown_source'] == SEEDED), t
    report['links'] = {'published': len(links), 'by_class': links.link_class.value_counts().to_dict(), 'markers': len(markers), 'members': len(members),
                       'protected_members_keeping_own_marker': len(kept),
                       'in_database_once': True, 'in_profiles': profile_links, 'marker_features_once': len(markers), 'member_features': 0,
                       'council_positions': positions['features_checked'], 'excluded_after_v51_check': sorted(excluded)}

    # Protected or notable trees never lose their marker, and the Protected count does not drop.
    protected_ids, lost = 0, []
    touched = set()
    for g in groups:
        touched.update(r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (g['seg_key'],)))
    for t in sorted(touched):
        if c.execute(PROTECTED_SQL.replace('FROM trees', 'FROM main.trees'), (t,)).fetchone() is None:
            continue
        protected_ids += 1
        was = c.execute("SELECT 1 FROM v51.tree_display_v5 WHERE tree_id=? AND display_role!='earlier_detection'", (t,)).fetchone()
        now_ = c.execute("SELECT 1 FROM main.tree_display_v5 WHERE tree_id=? AND display_role!='earlier_detection'", (t,)).fetchone()
        if was and not now_:
            lost.append(t)
    assert not lost, ('protected trees lost their marker', lost)
    report['protected'] = {'protected_records_on_changed_crowns': protected_ids, 'lost_marker': 0,
                           'protected_took_marker_from_ordinary_record': sum(1 for g in groups if g['crown_source'] == 'v5' and g['primary_changed']
                                                                              and c.execute("SELECT source_primary FROM main.trees WHERE tree_id=?", (g['old_primary_tree_id'],)).fetchone()[0] not in
                                                                              ('lidar_inferred_canopy', 'lidar_pointcloud_v4', 'lidar_pointcloud_v5', 'low_canopy_promoted', 'pointcloud_missed_promoted')),
                           'protected_members_keeping_own_marker': len(kept)}

    # 3. The named cases.
    cases = {}
    for tid in CASES['probable']:
        r = db_links[tid]
        assert r['link_class'] == 'probable' and r['crown_source'] == 'v5', tid
        cases[tid] = {'link_class': r['link_class'], 'seg_key': r['seg_key'], 'joined_as': r['joined_as'],
                      'representative': c.execute('SELECT primary_tree_id FROM tree_crown_v5 WHERE seg_key=?', (r['seg_key'],)).fetchone()[0],
                      'evidence': r['link_evidence']}
    for tid in CASES['seeded']:
        r = db_links[tid]
        s = c.execute('SELECT height_m,crown_area_m2,canopy_class,primary_tree_id,in_service_totals FROM tree_crown_seeded_v52 WHERE seg_key=?', (r['seg_key'],)).fetchone()
        assert r['crown_source'] == SEEDED and r['link_class'] == 'drawn_from_record' and s is not None, tid
        cases[tid] = {'link_class': r['link_class'], 'seg_key': r['seg_key'], 'joined_as': r['joined_as'], 'crown_height_m': s['height_m'],
                      'crown_area_m2': s['crown_area_m2'], 'canopy_class': s['canopy_class'], 'counted': bool(s['in_service_totals']), 'representative': s['primary_tree_id']}
    for tid in CASES['unchanged']:
        d = c.execute('SELECT display_role FROM tree_display_v5 WHERE tree_id=?', (tid,)).fetchone()
        assert d['display_role'] == 'source_record' and tid not in db_links and not c.execute('SELECT 1 FROM tree_crown_v5_links WHERE tree_id=?', (tid,)).fetchone()
        assert raw_record(STAGE, tid) == raw_record(STAGE51, tid), tid
        assert lines[tid] == lines51[tid] and len(lines[tid]) == 1, tid
        q = queue.loc[tid]
        cases[tid] = {'state': 'unchanged, Crown unlinked', 'package_status': q.status, 'reason': q.reason, 'review_queue': q.queue_reason}
    report['cases'] = cases

    # 4. Tiles and profiles at the maximum zoom for a sample of changed crowns and every named case.
    fields = {d['key']: d for d in schema['datasets']}
    case_segs = {db_links[t]['seg_key'] for t in CASES['probable'] + CASES['seeded']}
    chosen = [g for i, g in enumerate(sorted(groups, key=lambda g: g['seg_key'])) if i % 120 == 0 or g['seg_key'] in case_segs]
    tile_checks = []
    for g in chosen:
        seg, tid = g['seg_key'], g['primary_tree_id']
        ids = [r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (seg,))]
        services = 0
        for member in ids:
            rec = unpack(STAGE, schema, member)
            for key in ('identity', 'crown', 'pointcloud', 'assets', 'roots', 'services', 'record_link', 'record'):
                d = fields[key]
                row = c.execute('SELECT ' + ','.join(d['fields']) + ' FROM main.' + d['table'] + ' WHERE tree_id=?', (member,)).fetchone()
                expanded = {k: rec.get(key, {}).get(k) for k in d['fields']}
                want = {k: (None if isinstance(v, float) and not math.isfinite(v) else v) for k, v in dict(row).items()} if row else dict.fromkeys(d['fields'])
                assert expanded == want, (member, key)
            assert rec['identity']['current_primary_tree_id'] == tid
            services += 'services' in rec
        assert services == g['crown_in_service_totals'], seg
        loc = c.execute('SELECT lon,lat FROM tree_display_v5 WHERE tree_id=?', (tid,)).fetchone()
        crown = unpack(STAGE, schema, tid)['crown']
        for name, layer in [('trees_map_points', 'trees'), ('tree_crowns_pilot', 'crowns')]:
            features = tile_features(STAGE / 'data' / (name + '.pmtiles'), *loc, layer)
            matches = [f for f in features if f['properties']['tree_id'] == tid]
            assert matches, (name, tid, 'missing at maximum zoom')
            for f in matches:
                p = f['properties']
                assert abs(p['crown_area_m2'] - crown['crown_area_m2']) < .002 and abs(p['crown_max_chm_m'] - crown['crown_max_chm_m']) < .002
                assert p['linked_source_records'] == len(ids)
                assert p.get('tenure') in {'street', 'park', 'institutional', 'private', 'other', 'unknown'}
                assert p.get('link_class') == (db_links[tid]['link_class'] if tid in db_links else None)
                assert (p.get('crown_source') == SEEDED) == (g['crown_source'] == SEEDED) and (p.get('display_style') == 'faint') == (g['crown_source'] == SEEDED)
            others = set(ids) - {tid} - set(json.loads(g['kept_markers_json']))
            assert not any(f['properties']['tree_id'] in others for f in features), (name, tid, 'duplicate member marker or crown')
        tile_checks.append({'seg_key': seg, 'representative': tid, 'records': len(ids), 'crown_source': g['crown_source']})
    for tid in CASES['unchanged']:
        loc = c.execute('SELECT lon,lat FROM trees WHERE tree_id=?', (tid,)).fetchone()
        f = [f for f in tile_features(STAGE / 'data/trees_map_points.pmtiles', *loc, 'trees') if f['properties']['tree_id'] == tid]
        assert len(f) == 1 and not f[0]['properties'].get('crown_pilot') and 'link_class' not in f[0]['properties'], tid
    report['tile_and_profile_cases'] = tile_checks
    for tid, expected in json.loads((W51 / 'verification/database_snapshot.json').read_text())['accepted_ground'].items():
        actual = unpack(STAGE, schema, tid)['ground']
        assert {k: actual.get(k) for k in expected} == expected
    ar = unpack(STAGE, schema, 'akl_tree_trp_ACCT0255252')
    assert ar['crown_link_review']['status'] == 'restore_association' and ar['crown']['crown_area_m2'] == 101.25
    assert raw_record(STAGE, 'akl_tree_trp_ACCT0255252') == raw_record(STAGE51, 'akl_tree_trp_ACCT0255252')

    # 5. Totals move only as the package explains.
    totals = json.loads((W / 'web_build/totals.json').read_text())
    totals51 = json.loads((W51 / 'web_build/totals.json').read_text())
    explained = summary['deltas']['total_delta']
    n_changed = sum(g['records_joined'] + 1 for g in groups)
    recon = {}
    for key, old in totals51['totals'].items():
        delta = totals['totals'][key] - old
        bound = 0 if key in ('trees', 'protected', 'lidarInferred', 'crowns') else n_changed * 0.0011
        assert abs(delta - explained.get(key, 0)) <= bound + 1e-6, (key, delta, explained.get(key))
        recon[key] = {'v51': old, 'v52': totals['totals'][key], 'delta': delta, 'explained_by_package': explained.get(key, 0)}
    assert totals['display_roles'] == dict(c.execute('SELECT display_role,count(*) FROM main.tree_display_v5 GROUP BY display_role'))
    assert totals['totals']['trees'] == sum(v for k, v in totals['display_roles'].items() if k != 'earlier_detection')
    index = (STAGE / 'index.html').read_text()
    embedded = json.loads(re.search(r'const PILOT_TOTALS = (\{.*?\});', index, re.S)[1])
    assert embedded == totals['totals']
    assert f'window.AKL_TILE_VERSION="{VERSION}"' in index and f'record-links.js?v={VERSION}' in index and 'v52-methods.html' in index
    assert totals['totals']['protected'] >= totals51['totals']['protected'], ('Protected count dropped', totals['totals']['protected'], totals51['totals']['protected'])
    report['protected'].update(v51=totals51['totals']['protected'], v52=totals['totals']['protected'])
    report['totals'] = recon
    report['total_delta_by_cause'] = summary['deltas']['by_cause']

    # 6. Property summaries reconcile exactly with the new totals (decoded buckets, not builder memory).
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
    assert records == ps['records'] and ps['database_mtime_ns'] == schema['database_mtime_ns'] and ps['release'] == VERSION
    recon_p = json.loads((W / 'properties/data/build_stats.json').read_text())['summaries']['reconciliation']
    property_checks = {}
    for key in keys:
        assert abs(recon_p[key]['difference']) < .1, key
        difference = sums[key] + recon_p[key]['unassigned'] - totals['totals'][key]
        assert abs(difference) <= (0 if key == 'trees' else records * .00051), (key, difference)
        property_checks[key] = {'decoded_parcel_sum': sums[key], 'unassigned': recon_p[key]['unassigned'], 'difference_after_rounding': difference}
    # Untouched trees keep V5.1's tenure, parcel and class exactly.
    affected = set()
    for g in groups:
        affected.update(r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (g['seg_key'],)))
    t51 = pd.read_parquet(W51 / 'properties/data/tenure.parquet')
    t52 = pd.read_parquet(W / 'properties/data/tenure.parquet')
    both = t51.merge(t52, on='tree_id', suffixes=('_51', '_52'))
    both = both[~both.tree_id.isin(affected)]
    differ = int(((both.tenure_51 != both.tenure_52) | (both.tenure_basis_51 != both.tenure_basis_52) |
                  (both.parcel_id_51.fillna('') != both.parcel_id_52.fillna(''))).sum())
    assert differ == 0 and len(both) == len(t51) - int(t51.tree_id.isin(affected).sum())
    property_checks['untouched_tree_tenure_compared'] = len(both)
    property_checks['untouched_tree_tenure_differences'] = differ
    del t51, t52, both

    # 7. KYTE nearby index.
    nearby = STAGE / 'kyte/data/nearby'
    nm = json.loads((nearby / 'manifest.json').read_text())
    assert nm['database_mtime_ns'] == schema['database_mtime_ns'] and nm['detail_snapshot'] == schema['generated_utc'] and nm['release'] == VERSION
    nrows = 0
    for f in nm['files']:
        p = nearby / f['path']
        assert sha(p) == f['sha256']
        if 'records' in f:
            rows = json.loads(gzip.decompress(p.read_bytes()))
            assert len(rows) == f['records']
            nrows += len(rows)
    assert nrows == nm['records'] == json.loads((W / 'verification/nearby_rebuild.json').read_text())['population_by_sql']

    # 8. Static code and tiles.
    for name in ('trees_map_points', 'tree_crowns_pilot', 'properties', 'council_positions'):
        subprocess.run(['/opt/homebrew/bin/pmtiles', 'verify', str(STAGE / 'data' / (name + '.pmtiles'))], check=True)
    for p in ('record-links.js', 'tree-evidence.js', 'tree-identity.js', 'kyte/config.js', 'kyte/sw.js'):
        subprocess.run(['/opt/homebrew/bin/node', '--check', str(STAGE / p)], check=True)
    snippets = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', index, re.S)
    for i, text in enumerate(snippets):
        if text.strip():
            p = W / 'tmp' / f'inline-{i}.js'
            p.write_text(text)
            subprocess.run(['/opt/homebrew/bin/node', '--check', str(p)], check=True)
    ui = W / 'tmp/ui_check'
    (ui / 'web').mkdir(parents=True, exist_ok=True)
    (ui / 'pipeline/v5').mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'record-links.js', 'tree-evidence.js', 'observatory.css'):
        (ui / 'web' / name).write_bytes((STAGE / name).read_bytes())
    (ui / 'pipeline/v5/test_record_links_ui.cjs').write_bytes((W / 'tmp/ui_tests/test_record_links_ui.cjs').read_bytes())
    subprocess.run(['/opt/homebrew/bin/node', str(ui / 'pipeline/v5/test_record_links_ui.cjs')], check=True)
    meta = json.loads((STAGE / 'release-metadata.json').read_text())
    assert meta['assembly']['tile_version'] == VERSION and meta['previous_release']['release']['dataset_version'] == 'metro-2026.10.08-pointcloud-v5.1'
    assert any(a['path'] == 'data/council_positions.pmtiles' and a['bytes'] == (STAGE / 'data/council_positions.pmtiles').stat().st_size for a in meta['artifacts'])
    assert '20261010-v14c-v52-data' in (STAGE / 'kyte/config.js').read_text() and '20261010-v14c-v52-data' in (STAGE / 'kyte/sw.js').read_text()
    assert str(DB.stat().st_mtime_ns) == snapshot['mtime_ns']
    report.update(status='passed', checked_utc=now(), database_mtime_ns=schema['database_mtime_ns'], total_profiles=schema['records'],
                  property_buckets=buckets, property_records=records, property_reconciliation=property_checks, nearby_records=nrows,
                  accepted_kyte_records_preserved=list(json.loads((W51 / 'verification/database_snapshot.json').read_text())['accepted_ground']),
                  geometry_redrawn=False, new_record_seeded_crowns=summary['crowns_with_new_links'][SEEDED])
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
    print(json.dumps({k: report[k] for k in ('status', 'version', 'total_profiles', 'property_records', 'nearby_records', 'totals', 'protected', 'links', 'cases')}, indent=2), flush=True)


if __name__ == '__main__':
    main()
