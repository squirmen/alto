#!/usr/bin/env python3
"""Rebuild the v5 tree point and crown tiles with a land-tenure class on every feature.

The map's category chips say who recorded a tree, not whose land it stands on, so a
public/private filter needs the tenure class from build_property_tenure_v5.py on each
tile feature. The release export is not re-run: each line of the v5 web export gets one
"tenure" property appended as text, so feature ids, every other property (order and
number formatting included) and the geometry stay byte for byte what the release tiles
were built from, and tippecanoe runs with the release recipe from run_v5_exports.py.
A crown takes the tenure of the tree it belongs to. A feature with no row in the
sidecar gets "unknown", counted separately from trees whose class is unknown.
Stages: features, tiles, clean (removes the two large intermediate files).
"""
import argparse, collections, json, os, subprocess, time
from pathlib import Path
import pyarrow.parquet as pq

W = Path('/data/alto/working/alto_parcels_20261002')
WEB = Path('/data/alto/working/alto_v5_20260922/web_build')
TMP, TILES, LOGS = W / 'tmp', W / 'tiles', W / 'logs'
SIDECAR, STATS = W / 'data/tenure.parquet', W / 'data/tenure_tiles_stats.json'
TENURES = {'street', 'park', 'institutional', 'private', 'other', 'unknown'}
MISSING = b'unknown'
# run_v5_exports.py: (tileset, layer, minimum zoom, base zoom, export file)
BUILDS = [('trees_map_points', 'trees', 10, 14, 'points'), ('tree_crowns_pilot', 'crowns', 12, 15, 'crowns')]
HEAD, TAIL = b'"properties":{"tree_id":"', b'},"geometry":'
CHECK_EVERY = 25_000  # parse this share of lines both ways to confirm only "tenure" was added


def log(*s): print(time.strftime('%H:%M:%S'), *s, flush=True)


def stats_update(key, value):
    s = json.loads(STATS.read_text()) if STATS.exists() else {}
    s[key] = value
    STATS.write_text(json.dumps(s, indent=1) + '\n')


def load_tenure():
    t = pq.read_table(SIDECAR, columns=['tree_id', 'tenure'])
    codes = t['tenure'].to_pylist()
    assert None not in codes and set(codes) <= TENURES, set(codes) - TENURES
    enc = {c: c.encode() for c in set(codes)}
    m = {i.encode(): enc[c] for i, c in zip(t['tree_id'].to_pylist(), codes)}
    assert len(m) == t.num_rows, 'tree_id repeats in the tenure sidecar'
    return m


def add_tenure(kind, tenure):
    src, out = WEB / f'{kind}.geojsonl', TMP / f'{kind}_tenure.geojsonl'
    part = out.with_name(out.name + '.part')
    n = missing = checked = 0; by = collections.Counter(); t0 = time.time()
    with src.open('rb', buffering=1 << 24) as f, part.open('wb', buffering=1 << 24) as g:
        for line in f:
            a = line.find(HEAD); e = line.rfind(TAIL)
            assert a > 0 and e > a, f'{kind} line {n + 1}: unexpected layout'
            a += len(HEAD); tid = line[a:line.index(b'"', a)]
            assert b'"tenure":' not in line[a:e], f'{kind} line {n + 1} already has tenure'
            code = tenure.get(tid)
            if code is None: code = MISSING; missing += 1
            new = line[:e] + b',"tenure":"' + code + b'"' + line[e:]
            g.write(new); n += 1; by[code.decode()] += 1
            if n % CHECK_EVERY == 1:
                o, q = json.loads(line), json.loads(new)
                assert list(q['properties']) == list(o['properties']) + ['tenure'], tid
                assert q.pop('properties').pop('tenure') == code.decode() and q == {k: v for k, v in o.items() if k != 'properties'}, tid
                checked += 1
            if n % 1_000_000 == 0: log(kind, f'{n:,} lines')
    part.replace(out)
    r = {'features': n, 'missing_from_sidecar': missing, 'by_tenure': dict(by.most_common()), 'parsed_checks': checked,
         'source_bytes': src.stat().st_size, 'output_bytes': out.stat().st_size, 'seconds': round(time.time() - t0)}
    log(kind, r); stats_update(f'{kind}_features', r)
    return r


def features():
    tenure = load_tenure(); log(f'{len(tenure):,} sidecar rows')
    r = add_tenure('points', tenure)
    assert r['features'] == len(tenure) and r['missing_from_sidecar'] == 0, 'points and sidecar disagree'
    add_tenure('crowns', tenure)


def tiles():
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1',
           'TMPDIR': str(TMP), 'TIPPECANOE_MAX_THREADS': '6'}
    TILES.mkdir(exist_ok=True)
    for name, layer, z, base, kind in BUILDS:
        src, out, t0 = TMP / f'{kind}_tenure.geojsonl', TILES / f'{name}.pmtiles', time.time()
        cmd = ['/opt/homebrew/bin/tippecanoe', '--force', '-P', '--quiet', '-t', str(TMP), '--layer=' + layer,
               '--minimum-zoom=' + str(z), '--maximum-zoom=18', '--base-zoom=' + str(base), '--drop-densest-as-needed',
               '--extend-zooms-if-still-dropping', '-o', str(out), str(src)]
        if layer != 'trees': cmd.insert(3, '--simplification=3')
        log('tippecanoe', name)
        with (LOGS / f'tiles_{name}.log').open('w') as f:
            p = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, env=env)
        assert p.returncode == 0, f'tippecanoe failed for {name}, see logs/tiles_{name}.log'
        r = {'bytes': out.stat().st_size, 'seconds': round(time.time() - t0)}
        log(name, r); stats_update(f'{name}_tiles', r)


def clean():
    for kind in ('points', 'crowns'):
        for p in (TMP / f'{kind}_tenure.geojsonl', TMP / f'{kind}_tenure.geojsonl.part'):
            if p.exists(): log('removing', p.name); p.unlink()


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--stage', nargs='+', choices=['features', 'tiles', 'clean'], default=['features', 'tiles'])
    for stage in ap.parse_args().stage: log('stage', stage); globals()[stage]()
    log('done')
