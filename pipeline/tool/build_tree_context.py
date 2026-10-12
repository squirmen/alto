#!/usr/bin/env python3
"""Comparison tables for the tree page: where a tree sits among comparable crowns.

For one release database, writes into OUT (the release's derived folder):

  tree_context/comparisons.json            quantiles per tree class across Auckland and per local board
  tree_context/streets/cells/{z}/{x}/{y}.json   address points per map cell: [lon, lat, street id]
  tree_context/streets/s/{shard}.json      street tables: {id: {name, board, groups{class: {...}}}}

Population: the release's current service records (one per crown; the set the release totals use).
Comparable crowns share the tree class the benefit estimates used (services.species_class). Metrics:
height (crown maximum, else the assets height), crown area (v5 crown, else the services area) and
estimated benefits (NZ$/yr); irreplaceability as counts per class. A tree's local board is the board
polygon of data/local_boards.json that contains its recorded position (first match, as the site does);
its street is the street of the nearest OpenStreetMap address point within --max-distance metres.

Groups are published as quantiles (probabilities 0, 1, ..., 99, 99.5, 99.9, 100); a street group with
at most --exact-max crowns is published as its sorted values, so the page can state an exact rank.

Usage:
  build_tree_context.py --db RELEASE.sqlite --metadata release-metadata.json --boards local_boards.json \
      --addresses osm_addresses.tsv.gz --out DERIVED/<dataset_version>
"""
import argparse
import gzip
import json
import math
import os
import sqlite3
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import shapely
from scipy.spatial import cKDTree

PROBS = [float(p) for p in range(0, 100)] + [99.5, 99.9, 100.0]
STREET_PROBS = [float(p) for p in range(0, 101, 5)]
CLASSES = {'evergreen_broadleaf': 'Evergreen broadleaf', 'deciduous_broadleaf': 'Deciduous broadleaf',
           'conifer': 'Conifer', 'palm_other': 'Palm or palm-like'}
METRICS = {'height': {'label': 'Height', 'unit': 'm', 'field': 'crown.crown_max_chm_m (else assets.height_max_m)', 'decimals': 2},
           'crownArea': {'label': 'Crown area', 'unit': 'm²', 'field': 'crown.crown_area_m2 (else services.crown_area_m2)', 'decimals': 2},
           'benefits': {'label': 'Estimated benefits', 'unit': 'NZ$/yr', 'field': 'services.total_value_nzd_y', 'decimals': 2}}
IRR = ['low', 'moderate', 'high', 'very_high', 'effectively_irreplaceable']
KX0 = math.cos(math.radians(-36.85)) * 111320.0  # metres per degree of longitude near Auckland
KY = 110540.0


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def tables(c):
    return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def read_population(db):
    c = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
    t = tables(c)
    v6 = 'tree_current_services_v6' in t
    # V6 writes only the service rows that changed; the published value is the V6 row, else V5.2's.
    cls = 'COALESCE(s6.species_class, s.species_class)' if v6 else 's.species_class'
    val = 'COALESCE(s6.total_value_nzd_y, s.total_value_nzd_y)' if v6 else 's.total_value_nzd_y'
    join6 = 'LEFT JOIN tree_current_services_v6 s6 ON s6.tree_id = s.tree_id' if v6 else ''
    q = f"""SELECT s.tree_id, t.lon, t.lat, {cls} AS cls, {val} AS benefits,
              COALESCE(c.crown_max_chm_m, a.height_max_m) AS height, COALESCE(c.crown_area_m2, s.crown_area_m2) AS area,
              a.irreplaceability_class AS irr
            FROM tree_current_services_v5 s JOIN trees t ON t.tree_id = s.tree_id {join6}
            LEFT JOIN tree_current_crown_v5 c ON c.tree_id = s.tree_id
            LEFT JOIN tree_current_assets_v5 a ON a.tree_id = s.tree_id"""
    df = pd.read_sql_query(q, c)
    c.close()
    return df, v6


def assign_boards(df, boards_path):
    fc = json.load(open(boards_path))
    board = np.full(len(df), None, dtype=object)
    x, y = df.lon.to_numpy(float), df.lat.to_numpy(float)
    todo = np.isfinite(x) & np.isfinite(y)
    for f in fc['features']:
        g = shapely.geometry.shape(f['geometry'])
        shapely.prepare(g)
        minx, miny, maxx, maxy = g.bounds
        cand = np.where(todo & (x >= minx) & (x <= maxx) & (y >= miny) & (y <= maxy))[0]
        if not len(cand):
            continue
        inside = shapely.contains_xy(g, x[cand], y[cand])
        hit = cand[inside]
        board[hit] = f['properties']['board_name']
        todo[hit] = False
    return board


def read_addresses(path, boards_path):
    a = pd.read_csv(path, sep='\t', dtype=str, usecols=['lat', 'lon', 'addr:street', 'addr:place'])
    a['street'] = a['addr:street'].fillna(a['addr:place']).str.strip().str.replace(r'\s+', ' ', regex=True)
    a = a[a.street.notna() & (a.street != '')].copy()
    a['lon'] = a.lon.astype(float)
    a['lat'] = a.lat.astype(float)
    a['board'] = assign_boards(a, boards_path)
    a['key'] = a.street + '|' + a.board.fillna('')
    keys = sorted(a.key.unique())
    kid = {k: i for i, k in enumerate(keys)}
    a['sid'] = a.key.map(kid).astype(np.int64)
    return a.reset_index(drop=True), keys


def rounded(v, d):
    return [round(float(x), d) for x in v]


def group_stats(sub, probs, exact_max=None):
    out = {'n': int(len(sub))}
    if exact_max is not None and len(sub) <= exact_max:
        out['values'] = {}
        for m, col in (('height', 'height'), ('crownArea', 'area'), ('benefits', 'benefits')):
            v = np.sort(sub[col].dropna().to_numpy(float))
            out['values'][m] = rounded(v, METRICS[m]['decimals'])
    else:
        out['q'] = {}
        for m, col in (('height', 'height'), ('crownArea', 'area'), ('benefits', 'benefits')):
            v = sub[col].dropna().to_numpy(float)
            out['q'][m] = rounded(np.percentile(v, probs), METRICS[m]['decimals']) if len(v) else []
            if len(v) != len(sub):
                out.setdefault('nm', {})[m] = int(len(v))
        if probs is not PROBS:
            out['p'] = probs
    counts = sub.irr.value_counts()
    out['irr'] = {k: int(counts.get(k, 0)) for k in IRR}
    return out


def tile(lon, lat, z):
    n = 2 ** z
    x = np.floor((lon + 180.0) / 360.0 * n).astype(np.int64)
    r = np.radians(lat)
    y = np.floor((1 - np.log(np.tan(r) + 1 / np.cos(r)) / math.pi) / 2 * n).astype(np.int64)
    return x, y


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)


def register(out_root, release, key, path):
    """Record a derived product in <out_root>/manifest.json (merged with what is already there)."""
    mf = os.path.join(out_root, 'manifest.json')
    m = json.load(open(mf)) if os.path.exists(mf) else {'schema': 'alto.derived-manifest/1', 'release': release, 'products': {}}
    if m.get('release') != release:
        raise SystemExit(f'{mf} is for {m.get("release")}, not {release}')
    m['products'][key] = path
    m['updated_utc'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    write_json(mf, m)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--db', required=True)
    ap.add_argument('--metadata', required=True)
    ap.add_argument('--boards', required=True)
    ap.add_argument('--addresses', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--street-zoom', type=int, default=14)
    ap.add_argument('--max-distance', type=float, default=60.0)
    ap.add_argument('--exact-max', type=int, default=60)
    ap.add_argument('--street-shards', type=int, default=256)
    a = ap.parse_args()

    md = json.load(open(a.metadata))
    release = md['release']['dataset_version']
    m = __import__('re').search(r'-v(\d+(?:\.\d+)?)(-dev)?$', release)
    label = ('v' + m.group(1) + (' dev' if m.group(2) else '')) if m else release
    out = os.path.join(a.out, 'tree_context')

    log('reading population from', os.path.basename(a.db))
    df, v6 = read_population(a.db)
    log(len(df), 'service records', '(v6 services merged)' if v6 else '')
    df = df[df.cls.isin(CLASSES.keys())].reset_index(drop=True)
    log(len(df), 'with a tree class')
    df['board'] = assign_boards(df, a.boards)
    log('boards assigned;', int(df.board.isna().sum()), 'outside the board polygons')

    # Auckland and local boards.
    auckland = {k: group_stats(df[df.cls == k], PROBS) for k in CLASSES if (df.cls == k).any()}
    boards = {}
    for (b, k), sub in df[df.board.notna()].groupby(['board', 'cls']):
        boards.setdefault(b, {})[k] = group_stats(sub, PROBS)
    log('Auckland and board tables done')

    # Streets: nearest address point within the distance limit.
    addr, keys = read_addresses(a.addresses, a.boards)
    log(len(addr), 'address points;', len(keys), 'streets (street and board)')
    tree = cKDTree(np.c_[addr.lon.to_numpy() * KX0, addr.lat.to_numpy() * KY])
    d, i = tree.query(np.c_[df.lon.to_numpy() * KX0, df.lat.to_numpy() * KY], distance_upper_bound=a.max_distance)
    ok = np.isfinite(d)
    df['sid'] = np.where(ok, addr.sid.to_numpy()[np.minimum(i, len(addr) - 1)], -1)
    log(int(ok.sum()), 'crowns with a street;', int((~ok).sum()), 'without')
    shards = {}
    groups_written = 0
    for (sid, k), sub in df[df.sid >= 0].groupby(['sid', 'cls']):
        name, board = keys[sid].split('|', 1)
        e = shards.setdefault(int(sid) % a.street_shards, {}).setdefault(str(int(sid)), {'name': name, 'board': board or None, 'groups': {}})
        e['groups'][k] = group_stats(sub, STREET_PROBS, a.exact_max)
        groups_written += 1
    width = max(1, math.ceil(math.log(a.street_shards, 16)))
    for s, obj in shards.items():
        write_json(os.path.join(out, 'streets', 's', format(s, f'0{width}x') + '.json'), obj)
    log(groups_written, 'street groups in', len(shards), 'shards')

    # Address cells: every address within max-distance of a cell goes in that cell.
    z = a.street_zoom
    deg_x = a.max_distance / KX0
    deg_y = a.max_distance / KY
    cells = {}
    lon, lat, sid = addr.lon.to_numpy(), addr.lat.to_numpy(), addr.sid.to_numpy()
    for dx in (-deg_x, deg_x):
        for dy in (-deg_y, deg_y):
            tx, ty = tile(lon + dx, lat + dy, z)
            for j, (x, y) in enumerate(zip(tx, ty)):
                cells.setdefault((int(x), int(y)), set()).add(j)
    for (x, y), idx in cells.items():
        rows = sorted(idx)
        write_json(os.path.join(out, 'streets', 'cells', str(z), str(x), f'{y}.json'),
                   {'addresses': [[round(float(lon[j]), 6), round(float(lat[j]), 6), int(sid[j])] for j in rows]})
    log(len(cells), 'address cells')

    population = {'description': 'Current crowns with a benefit estimate in this release, one per crown (the set the release totals use)',
                  'short': 'crowns with a benefit estimate', 'n': int(len(df))}
    write_json(os.path.join(out, 'comparisons.json'), {
        'schema': 'alto.tree-context.comparisons/1', 'release': release, 'release_label': label,
        'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'population': population, 'classes': CLASSES, 'class_field': 'services.species_class',
        'metrics': METRICS, 'probabilities': PROBS, 'auckland': auckland, 'boards': boards,
        'board_layer': 'data/local_boards.json',
        'streets': {'cell_path': 'streets/cells/{z}/{x}/{y}.json', 'street_path': 'streets/s/{shard}.json', 'shards': a.street_shards,
                    'zoom': z, 'max_distance_m': a.max_distance, 'exact_max': a.exact_max,
                    'source': 'OpenStreetMap address points (ODbL)', 'n_streets': len(keys)},
        'counts': {'classes': {k: int((df.cls == k).sum()) for k in CLASSES}, 'outside_boards': int(df.board.isna().sum()),
                   'with_street': int(ok.sum())}})
    register(a.out, release, 'tree_context', 'tree_context/comparisons.json')
    total = 0
    for root, _, files in os.walk(out):
        total += sum(os.path.getsize(os.path.join(root, f)) for f in files)
    log('wrote', out, f'{total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
