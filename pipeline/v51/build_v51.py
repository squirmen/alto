#!/usr/bin/env python3
"""Rebuild V5.1 from the verified, additive crown association repair.

The V5 geometry and unchanged analytical records are retained. Changed profiles
are regenerated from SQL; map features, property aggregates and nearby choices
are rebuilt. No source ID, researcher decision or submitted visit is removed.
"""
import argparse
import collections
import gzip
import hashlib
import importlib.util
import json
import math
import re
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

PIPE = Path(__file__).resolve().parents[1]  # pipeline/ in this repository
ROOT = Path('/data/alto')  # data root: audit outputs, live baseline copy and release receipts
W = Path('/data/alto/working/alto_v51_20261008')
V5 = W.parent / 'alto_v5_20260922'
PAR = W.parent / 'alto_parcels_20261002'
DB = W / 'akl_trees.sqlite'
STAGE = W / 'deploy/alto_v51_upload_20261008'
LIVE = ROOT / 'outputs/alto_v51_release/live_baseline'
AUDIT = ROOT / 'outputs/crown_link_audit_20261008'
VERSION = '20261008-v5.1'


def now():
    return datetime.now(timezone.utc).isoformat()


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + '\n')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(8 << 20), b''):
            h.update(b)
    return h.hexdigest()


def module(name):
    spec = importlib.util.spec_from_file_location(name, W / 'code' / (name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def bucket(tid):
    h = 2166136261
    for b in tid.encode():
        h = ((h ^ b) * 16777619) & 0xffffffff
    return f'{(h % 65536) >> 8:02x}/{h & 255:02x}.json.gz'


def prepare():
    if DB.exists():
        raise RuntimeError('Release database already exists; preparation is not destructive.')
    for p in ('code', 'logs', 'tmp', 'verification', 'web_build', 'properties/tmp',
              'properties/data', 'properties/tiles', 'properties/logs'):
        (W / p).mkdir(parents=True, exist_ok=True)
    # Freeze the v5 modules this release reuses (pipeline/v5) beside the release.
    for name in ('export_web_v5', 'build_tree_details_v5', 'build_nearby_v5', 'build_property_tenure_v5', 'build_tenure_tiles_v5'):
        shutil.copy2(PIPE / 'v5' / (name + '.py'), W / 'code')
    source = W.parent / 'alto_v5_link_repair_20261008/akl_trees_verified.sqlite'
    wal = Path(str(source) + '-wal')
    assert not wal.exists() or wal.stat().st_size == 0
    subprocess.run(['cp', '-cp', str(source), str(DB)], check=True)
    schema = json.loads((LIVE / 'data/tree_details/schema.json').read_text())
    local = json.loads((V5 / 'details_v2/tree_details/schema.json').read_text())
    assert schema == local, 'Live profile schema advanced; reconcile before rebuilding.'
    fields = next(d['fields'] for d in schema['datasets'] if d['key'] == 'ground')
    c = sqlite3.connect(DB)
    c.execute('PRAGMA synchronous=NORMAL')
    # A copied WAL-mode database has no live WAL/SHM context. Use a rollback
    # journal for this small, isolated preparation transaction, then freeze it.
    c.execute('PRAGMA journal_mode=DELETE')
    accepted = {}
    for tid in ('akl_tree_lid_1097574', 'akl_tree_lcp_0159718'):
        path = LIVE / 'data/tree_details' / bucket(tid)
        row = json.loads(gzip.decompress(path.read_bytes()))[tid]['ground']
        old = json.loads(gzip.decompress((V5 / 'details_v2/tree_details' / bucket(tid)).read_bytes()))[tid]['ground']
        assert row == old
        assert not c.execute('SELECT 1 FROM tree_ground_evidence WHERE tree_id=?', (tid,)).fetchone()
        vals = row + [None] * (len(fields) - len(row))
        c.execute('INSERT INTO tree_ground_evidence (tree_id,' + ','.join(fields) + ') VALUES (' + ','.join('?' for _ in range(len(fields) + 1)) + ')', [tid] + vals)
        accepted[tid] = dict(zip(fields, vals))
    c.execute('CREATE TABLE release_snapshot_v51(version TEXT PRIMARY KEY, created_utc TEXT, repair_plan_sha256 TEXT, accepted_ground_json TEXT)')
    c.execute('INSERT INTO release_snapshot_v51 VALUES(?,?,?,?)', (VERSION, now(), sha(AUDIT / 'repair_plan.json'), json.dumps(accepted)))
    c.commit()
    c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    c.execute('PRAGMA journal_mode=DELETE')
    c.close()
    write(W / 'verification/database_snapshot.json', {'version': VERSION, 'database': str(DB), 'bytes': DB.stat().st_size,
          'mtime_ns': str(DB.stat().st_mtime_ns), 'repair_verification_sha256': sha(AUDIT / 'verification.json'),
          'repair_plan_sha256': sha(AUDIT / 'repair_plan.json'), 'accepted_ground': accepted,
          'geometry_method': 'pointcloud_v5_ndvi_watershed', 'association_method': 'v5_crown_continuity_repair_1'})
    STAGE.mkdir(parents=True, exist_ok=True)
    for p in LIVE.iterdir():
        if p.is_file():
            shutil.copy2(p, STAGE / p.name)
    print('Frozen V5.1 database prepared; two accepted KYTE visits preserved.', flush=True)


def maps():
    """Rewrite complete feature streams using SQL for every changed identity.

    The repair verifier establishes that other rows and all polygon geometry are
    unchanged. Retaining their original serialized features avoids a 75 GB random
    join scan and preserves exact feature formatting for the existing tile recipe.
    """
    m = module('export_web_v5')
    m.W, m.DB, m.OUT = W, DB, W / 'web_build'
    plan = json.loads((AUDIT / 'repair_plan.json').read_text())
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    ids = set()
    for g in plan['groups']:
        ids.update(r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (g['seg_key'],)))
    assert len(ids) == 9387
    # The two added ground observations contain no species or dimensions and
    # therefore do not change map properties. Their profile rows are preserved.
    fresh = {}
    for tid in sorted(ids):
        row = c.execute(m.SQL + ' WHERE d.tree_id=?', (tid,)).fetchone()
        if row:
            fresh[tid] = (m.properties(row), [round(row['lon'], 7), round(row['lat'], 7)])
    assert len(fresh) == 4362
    old_to_new = {g['old_primary']: g['primary'] for g in plan['groups']}
    totals, roles, species = collections.Counter(), collections.Counter(), collections.Counter()
    seen, emitted = set(), set()
    src_receipts = {}
    for kind in ('points', 'crowns'):
        count = changed = 0
        oldpath, outpath = V5 / 'web_build' / (kind + '.geojsonl'), m.OUT / (kind + '.geojsonl')
        h = hashlib.sha256()
        with oldpath.open('rb') as f, outpath.open('wb') as out:
            for line in f:
                h.update(line)
                obj = json.loads(line)
                tid = obj['properties']['tree_id']
                if kind == 'points' and tid in ids:
                    seen.add(tid)
                    # Emit the representative at the old crown's position/order.
                    # Restored source-only markers disappear, never their records.
                    if tid not in old_to_new:
                        continue
                    new = old_to_new[tid]
                    props, xy = fresh[new]
                    line = m.feature(props, {'type': 'Point', 'coordinates': xy}).encode()
                    obj = json.loads(line)
                    emitted.add(new)
                    changed += 1
                elif kind == 'crowns' and tid in old_to_new:
                    new = old_to_new[tid]
                    obj['properties'] = fresh[new][0]
                    # Preserve the original geometry JSON byte-for-byte.
                    geometry = line[line.rindex(b',"geometry":'):]
                    line = b'{"type":"Feature","properties":' + json.dumps(obj['properties'], separators=(',', ':'), ensure_ascii=False).encode() + geometry
                    changed += 1
                out.write(line)
                count += 1
                if kind == 'points':
                    p = obj['properties']
                    roles[p['display_role']] += 1
                    if p['display_role'] != 'earlier_detection':
                        totals['trees'] += 1
                        totals['protected'] += p.get('is_protected_notable', 0)
                        totals['lidarInferred'] += p['source_primary'] in m.DETECTION
                        for a, b in [('totalValueNzdY', 'total_value_nzd_y'), ('runoffM3Y', 'avoided_runoff_m3_y'), ('carbonTco2e', 'stored_co2e_tonnes_est')]:
                            totals[a] += p.get(b, 0)
                        if p.get('species_common') and p['species_common'] != 'Species not recorded':
                            species[p['species_common']] += 1
                if count % 500000 == 0:
                    print(kind, count, flush=True)
        src_receipts[kind] = {'sha256': h.hexdigest(), 'source': str(oldpath), 'output_count': count, 'changed_features': changed}
        assert changed == 4362
        if kind == 'points':
            assert count == 4202882 and emitted == set(fresh)
        else:
            assert count == 3522567
            totals['crowns'] = count
    old = json.loads((V5 / 'web_build/totals.json').read_text())
    write(m.OUT / 'totals.json', {'totals': dict(totals), 'display_roles': dict(roles), 'near_canopy': old['near_canopy'], 'species_options': species.most_common(150)})
    write(STAGE / 'data/species_options.json', {'release': VERSION, 'options': species.most_common()})
    write(W / 'verification/map_feature_rebuild.json', {'strategy': 'Complete stream rebuild with SQL-regenerated affected features and unchanged geometry', 'inputs': src_receipts, 'database_mtime_ns': str(DB.stat().st_mtime_ns)})
    c.close()


def details():
    """SQL rebuild all affected rows; hash-verified reuse of unchanged V5 rows."""
    base = V5 / 'details_v2/tree_details'
    out = STAGE / 'data/tree_details'
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        subprocess.run(['cp', '-cRp', str(base), str(out)], check=True)
    before = json.loads((base / 'schema.json').read_text())
    schema = json.loads(json.dumps(before))
    defs = schema['datasets']
    review = {'key': 'crown_link_review', 'table': 'tree_crown_link_repairs_v5', 'title': 'Crown association audit',
              'evidence': 'Audited spatial association', 'note': 'Small position offsets and dominant V4–V5 crown overlap support restored links. Review-needed candidates remain unlinked. This is not confirmation that shared source records describe one organism.',
              'fields': ['seg_key', 'primary_tree_id', 'old_seg_key', 'status', 'reason', 'evidence_json', 'method_id'], 'multiple': False}
    defs.append(review)
    next(d for d in defs if d['key'] == 'identity')['note'] = 'Polygon containment and audited crown continuity associate source records with current crowns. A shared crown can contain several trees; original positions, identities and histories remain separate.'
    plan = json.loads((AUDIT / 'repair_plan.json').read_text())
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    affected = set(d['tree_id'] for d in plan['decisions'])
    c.execute('PRAGMA cache_size=-250000')
    c.execute('PRAGMA mmap_size=1073741824')
    group_ids = set()
    for gi, g in enumerate(plan['groups'], 1):
        group_ids.update(r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (g['seg_key'],)))
        if gi % 1000 == 0:
            print('Resolved repaired groups', gi, flush=True)
    assert len(group_ids) == 9387
    affected.update(group_ids)
    def trim(row):
        row = [None if isinstance(v, float) and not math.isfinite(v) else v for v in row]
        while row and row[-1] is None:
            row.pop()
        return row
    updates = collections.defaultdict(dict)
    changed_keys = {'identity', 'crown', 'pointcloud', 'assets', 'roots', 'services'}
    # The repair transaction only changes these public datasets. Regenerate each
    # affected row, including removal of old representative-only service rows.
    # Historical and original source datasets stay exactly as verified in V5.
    for d in defs:
        if d['key'] not in changed_keys:
            continue
        sql = 'SELECT ' + ','.join(d['fields']) + ' FROM ' + d['table'] + ' WHERE tree_id=?'
        for tid in sorted(group_ids):
            rows = c.execute(sql, (tid,)).fetchall()
            assert len(rows) <= 1, (d['key'], tid)
            updates[bucket(tid)].setdefault(tid, {})[d['key']] = trim(rows[0]) if rows else None
        print('Regenerated profile dataset', d['key'], len(group_ids), flush=True)
    for row in c.execute('SELECT tree_id,' + ','.join(review['fields']) + ' FROM ' + review['table']):
        tid = row[0]
        updates[bucket(tid)].setdefault(tid, {})['crown_link_review'] = trim(row[1:])
    assert sum(map(len, updates.values())) == len(affected)
    baseline_manifest = json.loads((V5 / 'details_v2/details_manifest.json').read_text())
    indexed = {f['path'].removeprefix('tree_details/'): f for f in baseline_manifest['files']}
    cov = collections.Counter(schema['coverage'])
    changes = []
    for ix, (name, rows) in enumerate(sorted(updates.items())):
        path = out / name
        assert sha(path) == indexed[name]['sha256'], 'Baseline profile digest mismatch: ' + name
        records = json.loads(gzip.decompress(path.read_bytes()))
        for tid, delta in rows.items():
            previous = records[tid]
            rec = dict(previous)
            for key, value in delta.items():
                if value is None:
                    rec.pop(key, None)
                else:
                    rec[key] = value
            cov.subtract(previous.keys())
            cov.update(rec.keys())
            records[tid] = rec
        path.write_bytes(gzip.compress((json.dumps(records, ensure_ascii=False, separators=(',', ':')) + '\n').encode(), compresslevel=7, mtime=0))
        changes.append(name)
        if ix % 2000 == 0:
            print('Rebuilt profile buckets', ix, '/', len(updates), flush=True)
    schema.update(database_mtime_ns=str(DB.stat().st_mtime_ns), generated_utc=now(), coverage=dict(cov), release=VERSION,
                  rebuild={'strategy': 'Regenerate every affected record from SQL; verified reuse of unchanged V5 records.',
                           'affected_records': len(affected), 'changed_buckets': len(updates), 'baseline_manifest_sha256': sha(V5 / 'details_v2/details_manifest.json'),
                           'repair_plan_sha256': sha(AUDIT / 'repair_plan.json')})
    write(out / 'schema.json', schema)
    files = []
    for path in sorted(out.rglob('*.json.gz')):
        rel = path.relative_to(out).as_posix()
        h = sha(path)
        if rel not in updates:
            assert h == indexed[rel]['sha256'], 'Unchanged bucket changed'
        files.append({'path': rel, 'bytes': path.stat().st_size, 'sha256': h, 'records': indexed[rel]['records']})
    assert len(files) == 65536 and sum(f['records'] for f in files) == 6238420
    write(W / 'verification/details_manifest.json', {'records': 6238420, 'files': files, 'changed_buckets': changes,
          'changed_records': len(affected), 'database_mtime_ns': str(DB.stat().st_mtime_ns)})
    c.close()
    print('All 6,238,420 profiles verified; affected profiles rebuilt.', flush=True)


def properties():
    import pandas as pd
    m = module('build_property_tenure_v5')
    m.W, m.V5, m.WEB, m.DB = W / 'properties', W, W / 'web_build', DB
    m.RAW = PAR / 'data/raw'
    m.TMP, m.DATA = m.W / 'tmp', m.W / 'data'
    m.STATS = m.DATA / 'build_stats.json'
    # Parcel geometry/tenure and crown intersections do not change in a link repair.
    # Crown intersections carry representative IDs, so rekey those before aggregation.
    old_stats = json.loads((PAR / 'data/build_stats.json').read_text())
    write(m.STATS, {k: old_stats[k] for k in ('parcel_tenure', 'canopy')})
    shutil.copy2(PAR / 'tmp/parcels.parquet', m.TMP / 'parcels.parquet')
    plan = json.loads((AUDIT / 'repair_plan.json').read_text())
    mapping = {g['old_primary']: g['primary'] for g in plan['groups'] if g['old_primary'] != g['primary']}
    cp = pd.read_parquet(PAR / 'tmp/canopy_pairs.parquet')
    cp['tree_id'] = cp.tree_id.map(lambda t: mapping.get(t, t))
    cp.to_parquet(m.TMP / 'canopy_pairs.parquet', index=False)
    del cp
    m.stage_points()
    m.point_tenure(pd.read_parquet(m.TMP / 'parcels.parquet'))
    m.stage_summaries()
    m.stage_tiles()
    tm = module('build_tenure_tiles_v5')
    tm.W, tm.WEB = m.W, m.WEB
    tm.TMP, tm.TILES, tm.LOGS = m.TMP, m.W / 'tiles', m.W / 'logs'
    tm.SIDECAR, tm.STATS = m.DATA / 'tenure.parquet', m.DATA / 'tenure_tiles_stats.json'
    tm.features()
    tm.tiles()
    for name in ('trees_map_points', 'tree_crowns_pilot', 'properties'):
        subprocess.run(['cp', '-cp', str(m.W / 'tiles' / (name + '.pmtiles')), str(STAGE / 'data' / (name + '.pmtiles'))], check=True)
    subprocess.run(['cp', '-cRp', str(m.DATA / 'property_details'), str(STAGE / 'data/property_details')], check=True)
    print('Map and property rebuild complete.', flush=True)


def nearby():
    m = module('build_nearby_v5')
    m.W, m.DB = W, DB
    m.OUT, m.SRC = STAGE / 'kyte/data/nearby', STAGE / 'data/tree_details'
    base = V5 / 'deploy/alto_v5_upload_20260923/kyte/data/nearby'
    baseline = json.loads((base / 'manifest.json').read_text())
    schema = json.loads((m.SRC / 'schema.json').read_text())
    plan = json.loads((AUDIT / 'repair_plan.json').read_text())
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    ids, by_cell = set(), collections.defaultdict(list)
    c.execute('PRAGMA cache_size=-250000')
    c.execute('PRAGMA mmap_size=1073741824')
    query = m.SQL[:m.SQL.index('ORDER BY')] + ' AND d.tree_id=?'
    for group in plan['groups']:
        ids.update(r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (group['seg_key'],)))
        r = c.execute(query, (group['primary'],)).fetchone()
        assert r is not None
        cx, cy, tid, lon, lat, common, latin, source, owner, height, diameter = r
        by_cell[f'{cx}_{cy}.json.gz'].append([tid, round(lon, 7), round(lat, 7), m.clean(common), m.clean(latin), m.clean(source), m.clean(owner), m.clean(height), m.clean(diameter)])
    assert len(ids) == 9387
    m.OUT.mkdir(parents=True, exist_ok=True)
    files, total, replaced = [], 0, 0
    baseline_files = {f['path']: f for f in baseline['files']}
    for name in sorted((set(baseline_files) | set(by_cell)) - {'groups.json.gz'}):
        path = base / name
        rows = []
        if path.exists():
            assert sha(path) == baseline_files[name]['sha256']
            old = json.loads(gzip.decompress(path.read_bytes()))
            rows = [r for r in old if r[0] not in ids]
            replaced += len(old) - len(rows)
        rows.extend(by_cell.get(name, []))
        rows.sort(key=lambda r: r[0])
        assert len({r[0] for r in rows}) == len(rows)
        if not rows:
            continue
        payload = gzip.compress(json.dumps(rows, separators=(',', ':'), ensure_ascii=False).encode(), mtime=0)
        (m.OUT / name).write_bytes(payload)
        files.append({'path': name, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'records': len(rows)})
        total += len(rows)
    assert total == baseline['records'] - 3988
    group_payload = gzip.compress(json.dumps({'groups': [], 'method_id': 'v51_current_crown_representatives', 'database_mtime_ns': schema['database_mtime_ns']}).encode(), mtime=0)
    (m.OUT / 'groups.json.gz').write_bytes(group_payload)
    files.append({'path': 'groups.json.gz', 'bytes': len(group_payload), 'sha256': hashlib.sha256(group_payload).hexdigest()})
    baseline.update(release=VERSION, detail_snapshot=schema['generated_utc'], database_mtime_ns=schema['database_mtime_ns'], records=total, files=files)
    write(m.OUT / 'manifest.json', baseline)
    for p in base.glob('.*'):
        if p.is_file():
            shutil.copy2(p, m.OUT / p.name)
    write(W / 'verification/nearby_rebuild.json', {'records': total, 'replaced_rows': replaced, 'new_representatives': len(plan['groups']), 'baseline_manifest_sha256': sha(base / 'manifest.json')})
    c.close()
    print('KYTE nearby rebuilt:', total, 'records.', flush=True)


def assemble():
    schema = json.loads((STAGE / 'data/tree_details/schema.json').read_text())
    totals = json.loads((W / 'web_build/totals.json').read_text())
    snapshot = json.loads((W / 'verification/database_snapshot.json').read_text())
    repair = json.loads((AUDIT / 'applied_repair_verified.json').read_text())
    assert schema['database_mtime_ns'] == str(DB.stat().st_mtime_ns) == snapshot['mtime_ns']
    index = (LIVE / 'index.html').read_text()
    index = index.replace('window.AKL_TILE_VERSION="20261002-v5d"', f'window.AKL_TILE_VERSION="{VERSION}"')
    index, n = re.subn(r'const PILOT_TOTALS = \{.*?\};', 'const PILOT_TOTALS = ' + json.dumps(totals['totals'], indent=6) + ';', index, flags=re.S)
    assert n == 1
    index = index.replace('<span>No crown</span>', '<span title="No crown is linked to this source record; the tree may still be present.">Crown unlinked</span>')
    index = index.replace('./tree-identity.js?v=20260928-v5b', './tree-identity.js?v=' + VERSION)
    index = index.replace('v5-methods.html', 'v51-methods.html')
    index = index.replace('`${ex}/akl_trees_data_dictionary.md`;', 'vq(`${ex}/akl_trees_data_dictionary.md`);')
    (STAGE / 'index.html').write_text(index)
    identity = (LIVE / 'tree-identity.js').read_text()
    identity = identity.replace("method_id:'v5_actual_polygon_containment'", "method_id:'v5_containment_with_v51_continuity_repair'")
    identity = identity.replace('current:record.datasets.identity||null,', 'current:record.datasets.identity||null,crown_link_review:record.datasets.crown_link_review||null,')
    identity = identity.replace('source records fall inside this crown.', 'source records are linked to this crown.')
    identity = identity.replace('The older measurements remain below for comparison.', 'This does not establish that the tree is absent. Its older measurements remain below for comparison.')
    marker = "  if(x.old_overlapping_crowns>1||x.new_overlapping_crowns>1)"
    assert marker in identity
    identity = identity.replace(marker, "  if(d.crown_link_review?.status==='restore')html+='<p class=\"pp-note\"><strong>Crown link restored in V5.1.</strong> The earlier and current crowns overlap strongly, and the source point lies just outside the filled boundary. The polygon itself has not been redrawn.</p>';\n" + marker)
    # The repair stores status='accepted', rather than assuming its spelling.
    statuses = {d['status'] for d in json.loads((AUDIT / 'repair_plan.json').read_text())['decisions'] if d['reason'] == 'dominant_polygon_continuity_and_small_position_offset'}
    assert len(statuses) == 1
    identity = identity.replace("status==='restore'", 'status===' + json.dumps(next(iter(statuses))))
    (STAGE / 'tree-identity.js').write_text(identity)
    meta = json.loads((LIVE / 'release-metadata.json').read_text())
    meta['previous_release'] = json.loads(json.dumps({k: meta[k] for k in
        ('release', 'dataset', 'headline_scope', 'artifacts', 'assembly', 'derived_products') if k in meta}))
    meta['release'].update(dataset_version='metro-2026.10.08-pointcloud-v5.1', dataset_last_updated_utc=now(), metadata_generated_utc=now(),
                           source_revision='V5.1 audited crown-continuity repair; method and policy in data/crown-link-repair-v51.json')
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    meta['dataset'].update(current_map_markers=totals['totals']['trees'], crown_records=totals['totals']['crowns'], display_roles=totals['display_roles'],
                           evidence_tiers=dict(c.execute('SELECT evidence_tier,count(*) FROM tree_evidence_v5 GROUP BY evidence_tier')))
    meta['assembly'].update(assembled_utc=now(), tile_version=VERSION, database_mtime_ns=schema['database_mtime_ns'], mode='verified_v51_association_rebuild',
                            note='SQL-regenerated changed records, hash-verified unchanged profiles and geometry; rebuilt map, property summaries, totals and KYTE nearby choices.')
    for model in meta['models']:
        if model['component'] == 'record_identity':
            model['implementations'].append({'id': 'v5_crown_continuity_repair_1'})
            model['counts']['source_links'] = c.execute('SELECT count(*) FROM tree_crown_v5_links').fetchone()[0]
            model['counts']['restored_associations_v51'] = repair['restored_records']
    c.close()
    meta['v51_changes'] = [
        'Restored 4,661 crown associations across 4,362 existing crowns: 3,518 Auckland Transport, 470 Council Parks and 673 earlier LiDAR records.',
        'Retained all 6,238,420 original source IDs, source positions and existing survey histories. Former generated representatives remain accessible as linked records.',
        'Recomputed affected model scenarios once per representative crown using the existing V5 equations; no recalibration or new ground measurements.',
        'Rebuilt map markers, property summaries, release totals and KYTE nearby suggestions from the same repaired snapshot.',
        'Preserved the two KYTE visits already accepted since V5. Incoming submissions and researcher review decisions were not changed.',
        'Crown unlinked replaces No crown: failure to link a source position does not establish tree absence.']
    meta['v51_limits'] = ['The V5 polygon geometry, including known holes and clipped boundaries, is unchanged.',
                          '28,735 audited candidates still need review; proximity alone is not sufficient for automatic attachment.',
                          'A restored crown association does not certify that every linked source record describes the same organism.',
                          'The private researcher workbench retains its earlier dataset baseline and saved assessments until a separate, versioned migration.']
    summary = {k: repair[k] for k in ('groups', 'restored_records', 'changed_representatives', 'reasons', 'restored_by_source', 'restored_by_owner',
                                    'affected_records_including_existing_members', 'canonical_geometry_changed', 'source_records_changed', 'histories_changed')}
    summary.update(release=VERSION, policy=json.loads((AUDIT / 'repair_plan.json').read_text())['policy'], repair_plan_sha256=snapshot['repair_plan_sha256'])
    write(STAGE / 'data/crown-link-repair-v51.json', summary)
    for name in ('trees_map_points', 'tree_crowns_pilot', 'properties'):
        p = STAGE / 'data' / (name + '.pmtiles')
        artifact = {'path': 'data/' + p.name, 'bytes': p.stat().st_size, 'last_modified_utc': now()}
        meta['artifacts'] = [a for a in meta['artifacts'] if a['path'] != artifact['path']] + [artifact]
    meta['derived_products'].update(crown_association_audit='data/crown-link-repair-v51.json', property_summaries='data/property_details/schema.json')
    write(STAGE / 'release-metadata.json', meta)
    model = json.loads((LIVE / 'model.json').read_text())
    model.update(application_database_mtime_ns=schema['database_mtime_ns'], application_release=VERSION,
                 application_note='Existing fitted model applied to current V5 dimensions with V5.1 repaired associations. Historical matching and original benchmark unchanged; this is not a new model validation.')
    write(STAGE / 'data/longitudinal/model.json', model)
    ps = json.loads((STAGE / 'data/property_details/schema.json').read_text())
    ps.update(release=VERSION, database_mtime_ns=schema['database_mtime_ns'])
    write(STAGE / 'data/property_details/schema.json', ps)
    (STAGE / 'kyte').mkdir(exist_ok=True)
    for name in ('config.js', 'sw.js'):
        source = (LIVE / 'kyte' / name).read_text()
        assert '20261003-v14c' in source
        (STAGE / 'kyte' / name).write_text(source.replace('20261003-v14c', '20261008-v14c-v51-data'))
    notes = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ALTO · V5.1 crown associations</title><style>body{font:17px/1.65 system-ui,sans-serif;color:#23372b;background:#f2f5ef;margin:0}main{max-width:780px;margin:32px auto;padding:28px;background:white;border-radius:18px}a{color:#3e693c}h1{line-height:1.2}h2{font-size:1.25em}li{margin:.5em 0}</style><main><a href="./">← Auckland map</a><h1>V5.1 · Restoring crown associations</h1><p>8 October 2026. This release reconnects existing records to existing crowns. It does not redraw the canopy or establish new tree growth.</p><h2>What changed</h2><p>We restored 4,661 associations across 4,362 crowns: 3,518 Auckland Transport records, 470 Council Parks records and 673 earlier LiDAR records. Original IDs, source coordinates and survey histories remain intact. Former generated representatives are retained as linked records.</p><p>V5 required the source point to fall inside the filled polygon. Small positional offsets and holes could therefore leave a longstanding tree record unlinked while a new detection represented its crown. V5.1 also considers strong continuity between its earlier and current crown, a small edge distance, compatible height and the absence of competing crowns or conflicting recorded taxa.</p><h2>What a link means</h2><p>A restored association is spatial evidence, not proof that all records within a shared canopy describe one organism. Ambiguous cases remain for review: 28,735 audited candidates were not automatically attached. “Crown unlinked” does not mean a tree is missing or dead.</p><h2>Consistent records and estimates</h2><p>Map markers, profiles, property summaries, totals and KYTE nearby suggestions use the repaired snapshot. A current crown contributes one set of modelled service estimates. Those scenarios use the same V5 equations and retain their existing uncertainty. The two previously accepted KYTE visits remain available.</p><h2>Polygon work comes next</h2><p>The polygon geometry is unchanged, including known holes and clipped edges. The next geometry candidate will use native-resolution LINZ imagery, the LiDAR returns and researcher-drawn reference crowns. It must distinguish erroneous gaps from real gaps, and crown shape from source-record identity. Existing V6 growth-form research does not itself redraw crowns.</p><p><a href="./data/crown-link-repair-v51.json">Association policy and repair counts</a> · <a href="./data/tree_details/schema.json">Full-record schema</a> · <a href="./release-metadata.json">Release metadata</a> · <a href="./v5-methods.html">Original V5 methods</a></p></main></html>'''
    (STAGE / 'v51-methods.html').write_text(notes)
    dictionary = ['# ALTO V5.1 full-record data dictionary', '', 'Release: ' + VERSION + '.', '',
                  'Each tree profile exposes the datasets below. The schema gives their exact ordered fields. Blank means unavailable, not zero. All source IDs and original coordinates are retained.', '',
                  '**Current crown area** is the segmented horizontal footprint in square metres. **Crown spread** is a width in metres and is not the same measurement. The area-derived equivalent diameter is a circular approximation, not a measured crown spread.', '',
                  'Only current representative records carry current service estimates. Shared-crown aliases may repeat crown measurements: do not sum areas over every source record. Earlier datasets retain their previous spatial and methodological basis.', '',
                  'The former bulk-export dictionary described an older release. This dictionary describes the current downloadable full records and schema; no outdated bulk table is presented as V5.1.', '']
    for d in schema['datasets']:
        dictionary.extend(['## ' + d['title'], '', d['note'], '', '`' + d['key'] + '` → `' + d['table'] + '`', '', 'Fields: ' + ', '.join('`' + f + '`' for f in d['fields']) + '.', ''])
    (STAGE / 'data/exports').mkdir(exist_ok=True)
    (STAGE / 'data/exports/akl_trees_data_dictionary.md').write_text('\n'.join(dictionary))
    replace = ['index.html', 'tree-identity.js', 'release-metadata.json', 'v51-methods.html', 'data/trees_map_points.pmtiles',
               'data/tree_crowns_pilot.pmtiles', 'data/properties.pmtiles', 'data/tree_details', 'data/property_details',
               'data/species_options.json', 'data/crown-link-repair-v51.json', 'data/exports/akl_trees_data_dictionary.md',
               'data/longitudinal/model.json', 'kyte/data/nearby', 'kyte/config.js', 'kyte/sw.js',
               'deployment.json', 'release-checks.json', 'bundle-manifest.json']
    write(STAGE / 'deployment.json', {'version': VERSION, 'replace_paths': replace,
          'preserve': ['KYTE code except cache version', 'KYTE accounts, uploads and API configuration', 'private research workbench and review ledger',
                       'address index and unchanged historical map layers', 'root .htaccess and other applications'],
          'baseline_hashes': {name: sha(LIVE / name) for name in ('index.html', 'tree-identity.js', 'release-metadata.json', 'kyte/config.js', 'kyte/sw.js', 'data/tree_details/schema.json')}})
    print('Current UI preserved; V5.1 metadata, notes and cache versions assembled.', flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('stage', choices=['prepare', 'maps', 'details', 'properties', 'nearby', 'assemble'])
    globals()[p.parse_args().stage]()
