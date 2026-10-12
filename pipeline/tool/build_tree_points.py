#!/usr/bin/env python3
"""LiDAR point crops for the tree page: the 2024 returns inside each crown, as compact binary files.

For a subset of crowns (default: every crown that carries a protected tree or a record from an
inventory: Council register, Notable Trees schedule, OpenStreetMap, kauri survey), reads the 2024 LAZ
tile the crown was segmented from (read-only), keeps the returns inside the v5 crown polygon, and
writes one file per crown, named by the crown's map-marker tree ID:

  tree_points/index.json          format, subset, counts, path patterns
  tree_points/i/{shard}.json      {tree_id: {n, of, bytes, origin:[x,y], ground, top, seg_key}}
  tree_points/p/{shard}/{tree_id}.bin

Format alto-points/1 (little-endian): 16-byte header ("ALP1", uint32 n, float32 quantum = 0.01 m,
uint32 0), then int16 x[n], int16 y[n], int16 z[n] (quantised offsets from the crown top in NZTM and
from the ground level under the crown), uint8 classification[n] (LAS class), uint8 returns[n]
(return number << 4 | number of returns), uint8 intensity[n] (intensity >> 8). Shard = FNV-1a of the
tree ID mod --shards, hex. A crown with more than --max-points returns keeps a uniform random sample
(seeded by its crown key), so the sample has the same vertical distribution as the returns.

Ground level: median height of ground-class returns within 2 m of the crown, else the 2nd percentile
of the crown's returns.

Usage:
  build_tree_points.py --db RELEASE.sqlite --metadata release-metadata.json --crowns CROWNS_DIR \
      --laz LAZ_DIR --out DERIVED/<dataset_version> [--max-points 1500] [--limit N] [--count-only]
"""
import argparse
import hashlib
import json
import os
import sqlite3
import struct
import time
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

QUANTUM = 0.01


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def fnv(s):
    h = 2166136261
    for b in s.encode('utf-8'):
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


def shard(tree_id, n):
    width = max(1, len(format(n - 1, 'x')))
    return format(fnv(tree_id) % n, f'0{width}x')


def subset(db):
    """Crowns with a protected tree or an inventory record: {seg_key: representative tree ID}."""
    c = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
    q = """SELECT DISTINCT i.seg_key, i.current_primary_tree_id
           FROM tree_identity_v5 i JOIN trees t ON t.tree_id = i.tree_id
           WHERE i.seg_key IS NOT NULL AND i.current_primary_tree_id IS NOT NULL
             AND (t.is_protected_notable = 1 OR i.inventory_records > 0)"""
    out = {}
    for seg, rep in c.execute(q):
        out.setdefault(seg, rep)
    c.close()
    return out


def encode(dx, dy, dz, cls, ret, inten):
    n = len(dx)
    head = b'ALP1' + struct.pack('<IfI', n, QUANTUM, 0)
    return head + dx.astype('<i2').tobytes() + dy.astype('<i2').tobytes() + dz.astype('<i2').tobytes() + \
        cls.astype('u1').tobytes() + ret.astype('u1').tobytes() + inten.astype('u1').tobytes()


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))


def register(out_root, release, key, path):
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
    ap.add_argument('--crowns', required=True, help='folder of v5 crown parquet files, one per LAZ tile')
    ap.add_argument('--laz', required=True, help='folder of the 2024 LAZ tiles')
    ap.add_argument('--out', required=True)
    ap.add_argument('--max-points', type=int, default=1500)
    ap.add_argument('--shards', type=int, default=256)
    ap.add_argument('--limit', type=int, default=0, help='stop after this many tiles (testing)')
    ap.add_argument('--count-only', action='store_true')
    ap.add_argument('--reuse', default=None, help='another release\'s derived folder: crowns already cut there (same crown key) are copied, not re-read')
    a = ap.parse_args()

    release = json.load(open(a.metadata))['release']['dataset_version']
    log('selecting crowns from', os.path.basename(a.db))
    crowns = subset(a.db)
    by_tile = defaultdict(dict)
    for seg, rep in crowns.items():
        tile, x, y = seg.split(':')
        by_tile[tile][(float(x), float(y))] = (seg, rep)
    log(len(crowns), 'crowns in', len(by_tile), 'tiles')
    if a.count_only:
        return

    import laspy
    import pyarrow.parquet as pq
    import shapely
    import shutil

    out = os.path.join(a.out, 'tree_points')
    index = defaultdict(dict)
    done = written = missing = reused = 0
    total_bytes = 0
    # Crowns cut for another release: same crown key, same returns; copy the file under this release's ID.
    if a.reuse:
        prior, base = {}, os.path.join(a.reuse, 'tree_points')
        idx = json.load(open(os.path.join(base, 'index.json')))
        for name in os.listdir(os.path.join(base, 'i')):
            for tid, e in json.load(open(os.path.join(base, 'i', name))).items():
                prior[e['seg_key']] = (os.path.join(base, idx['file_path'].replace('{shard}', name[:-5]).replace('{id}', tid)), e)
        for tile in list(by_tile):
            for key, (seg, rep) in list(by_tile[tile].items()):
                if seg in prior and os.path.exists(prior[seg][0]):
                    src, e = prior[seg]
                    s = shard(rep, a.shards)
                    dst = os.path.join(out, 'p', s, f'{rep}.bin')
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copyfile(src, dst)
                    index[s][rep] = dict(e)
                    total_bytes += e['bytes']
                    reused += 1
                    del by_tile[tile][key]
            if not by_tile[tile]:
                del by_tile[tile]
        log(reused, 'crowns copied from', a.reuse, ';', sum(len(v) for v in by_tile.values()), 'left to cut in', len(by_tile), 'tiles')
    for k, (tile, want) in enumerate(sorted(by_tile.items())):
        if a.limit and k >= a.limit:
            break
        cp, lp = os.path.join(a.crowns, f'{tile}.parquet'), os.path.join(a.laz, f'{tile}.laz')
        if not (os.path.exists(cp) and os.path.exists(lp)):
            missing += len(want)
            continue
        t = pq.read_table(cp, columns=['x_2193', 'y_2193', 'crown_wkb'])
        xs, ys, wkb = t.column('x_2193').to_numpy(), t.column('y_2193').to_numpy(), t.column('crown_wkb').to_pylist()
        polys = {}
        for x, y, w in zip(xs, ys, wkb):
            hit = want.get((float(x), float(y)))
            if hit:
                g = shapely.from_wkb(w)
                polys[hit] = g if g.is_valid else shapely.make_valid(g)
        if not polys:
            missing += len(want)
            continue
        las = laspy.read(lp)
        px, py, pz = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
        cls = np.asarray(las.classification, dtype=np.uint8)
        ret = (np.minimum(np.asarray(las.return_number), 15) << 4 | np.minimum(np.asarray(las.number_of_returns), 15)).astype(np.uint8)
        inten = (np.asarray(las.intensity, dtype=np.uint32) >> 8).astype(np.uint8)
        order = np.argsort(px, kind='stable')
        sx = px[order]
        for (seg, rep), poly in polys.items():
            minx, miny, maxx, maxy = poly.buffer(2.0).bounds
            lo, hi = np.searchsorted(sx, minx), np.searchsorted(sx, maxx, side='right')
            idx = order[lo:hi]
            idx = idx[(py[idx] >= miny) & (py[idx] <= maxy)]
            near = shapely.contains_xy(poly.buffer(2.0), px[idx], py[idx])
            ring = idx[near]
            inside = ring[shapely.contains_xy(poly, px[ring], py[ring])]
            inside = inside[(cls[inside] != 7) & (cls[inside] != 18)]  # noise classes
            if not len(inside):
                continue
            g = ring[cls[ring] == 2]
            ground = float(np.median(pz[g])) if len(g) else float(np.percentile(pz[inside], 2))
            n_all = len(inside)
            if n_all > a.max_points:
                rng = np.random.default_rng(int(hashlib.sha256(seg.encode()).hexdigest()[:12], 16))
                inside = np.sort(rng.choice(inside, a.max_points, replace=False))
            _, x0, y0 = seg.split(':')
            x0, y0 = float(x0), float(y0)
            dx = np.clip(np.round((px[inside] - x0) / QUANTUM), -32768, 32767)
            dy = np.clip(np.round((py[inside] - y0) / QUANTUM), -32768, 32767)
            dz = np.clip(np.round((pz[inside] - ground) / QUANTUM), -32768, 32767)
            blob = encode(dx, dy, dz, cls[inside], ret[inside], inten[inside])
            s = shard(rep, a.shards)
            path = os.path.join(out, 'p', s, f'{rep}.bin')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(blob)
            index[s][rep] = {'n': int(len(inside)), 'of': int(n_all), 'bytes': len(blob), 'origin': [x0, y0],
                             'ground': round(ground, 2), 'top': round(float(pz[inside].max() - ground), 2), 'seg_key': seg}
            written += 1
            total_bytes += len(blob)
        done += 1
        if done % 25 == 0:
            log(done, 'tiles;', written, 'crowns;', f'{total_bytes / 1e6:.1f} MB')
        del las, px, py, pz
    for s, entries in index.items():
        write_json(os.path.join(out, 'i', f'{s}.json'), entries)
    write_json(os.path.join(out, 'index.json'), {
        'schema': 'alto.tree-points/1', 'release': release, 'format': 'alto-points/1', 'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'subset': 'crowns that carry a protected tree or an inventory record (Council register, Notable Trees schedule, OpenStreetMap, kauri survey)',
        'source': 'Auckland 2024 LiDAR survey (Woolpert for Auckland Council; published by LINZ), returns inside the v5 crown',
        'crs': 'EPSG:2193', 'quantum': QUANTUM, 'max_points': a.max_points, 'shards': a.shards,
        'shard_path': 'i/{shard}.json', 'file_path': 'p/{shard}/{id}.bin', 'key': 'map_marker_tree_id',
        'counts': {'crowns_selected': len(crowns), 'crowns_written': written + reused, 'crowns_cut': written, 'crowns_copied': reused,
                   'crowns_missing_inputs': missing, 'bytes': total_bytes}})
    register(a.out, release, 'tree_points', 'tree_points/index.json')
    log('wrote', written + reused, 'crowns (', written, 'cut,', reused, 'copied),', f'{total_bytes / 1e6:.1f} MB;', missing, 'crowns without crown or LAZ input')


if __name__ == '__main__':
    main()
