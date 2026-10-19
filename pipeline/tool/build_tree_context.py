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

From data release 6.3 the population, its fields and the counts per group are options, so a release names its own
tables (none of them is assumed):
  --population-table TABLE   one row per crown, joined to trees by tree_id (else the v5/v6 service tables)
  --population-filter SQL    a condition on it, columns prefixed z. (release 6.3: "z.in_comparisons = 1")
  --class-field, --height-field, --area-field   its columns for the tree class, height and crown area
  --benefit-table TABLE --benefit-field COLUMN  the benefit value, joined by tree_id
  --unique-field COLUMN      one row per value of this column of the population table (a crown key: each crown once)
  --count NAME=COLUMN:KEY,KEY,...   counts per group of COLUMN's values, in that key order (repeat; release 6.3:
                             bands=replacement_band:... and height_class=height_class:...; without --count the
                             releases up to 6.2 count irreplaceability classes)
  --population FILE          or a parquet/CSV population with columns tree_id, lon, lat, cls, benefits, height, area
                             (and each --count COLUMN)
  --texts FILE.json          the published wording: population {description, short, rule}, class_field,
                             metrics {height|crownArea|benefits: {label, field}}, counts {NAME: {field, labels}},
                             counts_note
  --built-on DATASET_VERSION the release the tables were built on (default: the metadata's dataset_version),
                             stamped beside release in comparisons.json and the derived manifest (DB-13)

Usage:
  build_tree_context.py --db RELEASE.sqlite --metadata release-metadata.json --boards local_boards.json \
      --addresses osm_addresses.tsv.gz --out DERIVED/<dataset_version>
  Release 6.3:
  build_tree_context.py --db RELEASE.sqlite --metadata release-metadata.json --boards local_boards.json \
      --addresses osm_addresses.tsv.gz --out DERIVED/<dataset_version> \
      --population-table tree_size_class_v63 --population-filter "z.in_comparisons = 1" --class-field class_used \
      --height-field height_m --area-field crown_area_m2 --benefit-table tree_benefits_v63 --benefit-field headline_value_nzd_y \
      --count bands=replacement_band:under_5y,5_15y,15_40y,40_80y,80y_plus \
      --count height_class=height_class:very_small,small,medium,large,very_large --texts context_texts_v63.json
"""
import argparse
import gzip
import json
import math
import os
import re
import sqlite3
import subprocess
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


IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def ident(name, what):
    if not IDENT.match(name or ''):
        raise SystemExit(f'{what}: not a column or table name: {name!r}')
    return name


def parse_count(spec):
    """NAME=COLUMN:KEY,KEY,... -> (name, column, [keys])."""
    m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z_][A-Za-z0-9_]*):(.+)$', spec)
    if not m:
        raise SystemExit(f'--count {spec!r}: expected NAME=COLUMN:KEY,KEY,...')
    return m.group(1), m.group(2), [k.strip() for k in m.group(3).split(',') if k.strip()]


def read_population_table(db, a, counts):
    """The population a release names (--population-table and its fields), one row per crown."""
    if a.population_filter and ';' in a.population_filter:
        raise SystemExit('--population-filter: one condition, no ";"')
    z, cf, hf, af = (ident(a.population_table, '--population-table'), ident(a.class_field, '--class-field'),
                     ident(a.height_field, '--height-field'), ident(a.area_field, '--area-field'))
    cols = [f'z.{ident(col, "--count")} AS c_{name}' for name, col, _ in counts]
    if a.unique_field:
        cols.append(f'z.{ident(a.unique_field, "--unique-field")} AS u_key')
    join = ''
    ben = 'NULL'
    if a.benefit_table:
        join = f'LEFT JOIN {ident(a.benefit_table, "--benefit-table")} b ON b.tree_id = z.tree_id'
        ben = f'b.{ident(a.benefit_field, "--benefit-field")}'
    elif a.benefit_field:
        ben = f'z.{ident(a.benefit_field, "--benefit-field")}'
    q = (f"SELECT z.tree_id, t.lon, t.lat, z.{cf} AS cls, {ben} AS benefits, z.{hf} AS height, z.{af} AS area"
         f"{''.join(', ' + c for c in cols)} FROM {z} z JOIN trees t ON t.tree_id = z.tree_id {join}"
         f"{' WHERE ' + a.population_filter if a.population_filter else ''}")
    c = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
    try:
        df = pd.read_sql_query(q, c)
    finally:
        c.close()
    if a.unique_field:
        df = df.sort_values('tree_id').drop_duplicates(subset=['u_key'], keep='first').drop(columns=['u_key']).reset_index(drop=True)
    return df


def read_population_file(path, counts):
    df = pd.read_parquet(path) if str(path).endswith('.parquet') else pd.read_csv(path)
    need = ['tree_id', 'lon', 'lat', 'cls', 'benefits', 'height', 'area'] + [col for _, col, _ in counts]
    missing = [c for c in need if c not in df.columns]
    if missing:
        raise SystemExit(f'{path}: missing columns {missing}')
    return df.rename(columns={col: f'c_{name}' for name, col, _ in counts})[['tree_id', 'lon', 'lat', 'cls', 'benefits', 'height', 'area'] + [f'c_{n}' for n, _, _ in counts]]


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


# Counts per group: [(name, column in the population frame, key order)]; releases up to 6.2 count irreplaceability.
COUNTS = [('irr', 'irr', IRR)]


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
    for name, col, keys in COUNTS:
        counts = sub[col].value_counts()
        out[name] = {k: int(counts.get(k, 0)) for k in keys}
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


def register(out_root, release, key, path, built_on=None):
    """Record a derived product in <out_root>/manifest.json (merged with what is already there); built_on: the release
    the products were built on (DB-13)."""
    mf = os.path.join(out_root, 'manifest.json')
    m = json.load(open(mf)) if os.path.exists(mf) else {'schema': 'alto.derived-manifest/1', 'release': release, 'products': {}}
    if m.get('release') != release:
        raise SystemExit(f'{mf} is for {m.get("release")}, not {release}')
    m['products'][key] = path
    m['updated_utc'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    if built_on:
        m['built_on'] = built_on
    write_json(mf, m)


def tool_commit():
    try:
        return subprocess.run(['git', '-C', os.path.dirname(os.path.abspath(__file__)), 'rev-parse', '--short', 'HEAD'],
                              capture_output=True, text=True, check=True).stdout.strip() or None
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--db', help='the release database (read only); not needed with --population')
    ap.add_argument('--metadata', required=True)
    ap.add_argument('--boards', required=True)
    ap.add_argument('--addresses', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--street-zoom', type=int, default=14)
    ap.add_argument('--max-distance', type=float, default=60.0)
    ap.add_argument('--exact-max', type=int, default=60)
    ap.add_argument('--street-shards', type=int, default=256)
    ap.add_argument('--population-table', help='release 6.3 and later: the table of the comparison population, one row per crown')
    ap.add_argument('--population-filter', help='a condition on it, columns prefixed z. (release 6.3: "z.in_comparisons = 1")')
    ap.add_argument('--class-field', default='class_used')
    ap.add_argument('--height-field', default='height_m')
    ap.add_argument('--area-field', default='crown_area_m2')
    ap.add_argument('--benefit-table', help='the table holding the benefit value, joined by tree_id')
    ap.add_argument('--benefit-field', help='the benefit value column')
    ap.add_argument('--unique-field', help='one row per value of this population-table column (a crown key)')
    ap.add_argument('--count', action='append', default=[], help='NAME=COLUMN:KEY,KEY,... counts per group (repeat)')
    ap.add_argument('--population', help='a parquet or CSV population in place of the database')
    ap.add_argument('--texts', help='JSON: the population, class-field, metric and count wording to publish')
    ap.add_argument('--built-on', help='the release the tables were built on (default: the metadata dataset_version)')
    a = ap.parse_args()
    if not a.db and not a.population:
        ap.error('--db or --population')
    if a.population_table and not a.db:
        ap.error('--population-table reads --db')
    counts = [parse_count(s) for s in a.count]
    texts = json.load(open(a.texts)) if a.texts else {}

    md = json.load(open(a.metadata))
    release = md['release']['dataset_version']
    m = __import__('re').search(r'-v(\d+(?:\.\d+)?)(-dev)?$', release)
    label = ('v' + m.group(1) + (' dev' if m.group(2) else '')) if m else release
    out = os.path.join(a.out, 'tree_context')

    if a.population:
        log('reading population from', os.path.basename(a.population))
        df, v6 = read_population_file(a.population, counts), True
    elif a.population_table:
        log('reading population from', os.path.basename(a.db), a.population_table)
        df, v6 = read_population_table(a.db, a, counts), True
    else:
        log('reading population from', os.path.basename(a.db))
        df, v6 = read_population(a.db)
    if counts or a.population or a.population_table:
        global COUNTS
        COUNTS = [(name, f'c_{name}', keys) for name, _, keys in counts]
    log(len(df), 'crowns in the population', '(v6 services merged)' if v6 and not (a.population or a.population_table) else '')
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
                  'short': 'crowns with a benefit estimate', **{k: v for k, v in (texts.get('population') or {}).items() if k != 'n'}, 'n': int(len(df))}
    metrics = {k: {**v, **{f: x for f, x in ((texts.get('metrics') or {}).get(k) or {}).items() if f in ('label', 'field')}} for k, v in METRICS.items()}
    built_on = a.built_on or release
    extra = {}
    if counts:
        labels = texts.get('counts') or {}
        extra['counts_per_group'] = {name: {'field': (labels.get(name) or {}).get('field', col), 'keys': keys,
                                            **({'labels': labels[name]['labels']} if (labels.get(name) or {}).get('labels') else {})}
                                     for name, col, keys in counts}
        if texts.get('counts_note'):
            extra['counts_per_group']['note'] = texts['counts_note']
    write_json(os.path.join(out, 'comparisons.json'), {
        'schema': 'alto.tree-context.comparisons/1', 'release': release, 'release_label': label,
        'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'population': population, 'classes': CLASSES, 'class_field': texts.get('class_field', 'services.species_class'),
        'metrics': metrics, 'probabilities': PROBS, 'auckland': auckland, 'boards': boards,
        'board_layer': 'data/local_boards.json',
        'streets': {'cell_path': 'streets/cells/{z}/{x}/{y}.json', 'street_path': 'streets/s/{shard}.json', 'shards': a.street_shards,
                    'zoom': z, 'max_distance_m': a.max_distance, 'exact_max': a.exact_max,
                    'source': 'OpenStreetMap address points (ODbL)', 'n_streets': len(keys)},
        'counts': {'classes': {k: int((df.cls == k).sum()) for k in CLASSES}, 'outside_boards': int(df.board.isna().sum()),
                   'with_street': int(ok.sum())}, **extra,
        'built_with': {'script': 'pipeline/tool/build_tree_context.py', 'tool_commit': tool_commit()}, 'built_on': built_on})
    register(a.out, release, 'tree_context', 'tree_context/comparisons.json', built_on=built_on)
    total = 0
    for root, _, files in os.walk(out):
        total += sum(os.path.getsize(os.path.join(root, f)) for f in files)
    log('wrote', out, f'{total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
