#!/usr/bin/env python3
"""Check that the tenure tile rebuild changed nothing but the added field.

Compares each rebuilt archive with the copy of the live release bundle: file sizes,
PMTiles headers and metadata, the tile set, and per tile the feature count and the
attribute keys of the layer (every tile in both archives, read with a small protobuf
scan rather than a full decode). Tiles over Bayswater at z12, z14 and z16 are fully
decoded and matched feature by feature: geometry and every release property must be
identical, and tenure must equal the sidecar class for that tree. Runs in the local
.venv (pmtiles, mapbox-vector-tile, pyarrow); writes data/tenure_tiles_check.json.
"""
import collections, gzip, json, math, mmap, sys, time
from pathlib import Path
import mapbox_vector_tile, pyarrow.parquet as pq
from pmtiles.reader import Reader, MmapSource, all_tiles

W = Path('/data/alto/working/alto_parcels_20261002')
LIVE = Path('/data/alto/working/alto_v5_20260922/deploy/alto_v5_upload_20260923/data')
OUT = W / 'data/tenure_tiles_check.json'
BUILDS = [('trees_map_points', 'trees'), ('tree_crowns_pilot', 'crowns')]
BAYSWATER, ZOOMS = (174.7744, -36.8133), (12, 14, 16)


def log(*s): print(time.strftime('%H:%M:%S'), *s, flush=True)


def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7f) << s
        if c < 0x80: return r, i
        s += 7


def skip(b, i, wire):
    if wire == 0: return varint(b, i)[1]
    if wire == 1: return i + 8
    if wire == 5: return i + 4
    n, i = varint(b, i); return i + n


def scan(tile):
    """Per layer: (feature count, attribute keys) without decoding geometry or values."""
    out, i = {}, 0
    while i < len(tile):
        k, i = varint(tile, i)
        if k != 0x1a: i = skip(tile, i, k & 7); continue
        n, i = varint(tile, i); end, j, name, feats, keys = i + n, i, None, 0, []
        while j < end:
            k, j = varint(tile, j)
            if k == 0x12: n, j = varint(tile, j); feats += 1; j += n
            elif k in (0x0a, 0x1a):  # layer name, attribute key
                n, j = varint(tile, j); s = tile[j:j + n].decode(); j += n
                if k == 0x0a: name = s
                else: keys.append(s)
            else: j = skip(tile, j, k & 7)
        out[name] = (feats, keys); i = end
    return out


def open_archive(p):
    f = p.open('rb'); return MmapSource(f)


def tile_counts(p):
    get, counts = open_archive(p), {}
    for (z, x, y), data in all_tiles(get):
        counts[(z, x, y)] = (len(data), scan(gzip.decompress(data)))
    return counts


def bayswater_tiles(z):
    lon, lat = BAYSWATER; n = 2 ** z; r = math.radians(lat)
    x, y = int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(r)) / math.pi) / 2 * n)
    return [(z, x + dx, y + dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]


def compare_sample(live, new, layer, tenure):
    rows = []
    for z in ZOOMS:
        for zxy in bayswater_tiles(z):
            a, b = Reader(live).get(*zxy), Reader(new).get(*zxy)
            if a is None or b is None: rows.append({'tile': zxy, 'live': a is not None, 'new': b is not None}); continue
            fa = mapbox_vector_tile.decode(gzip.decompress(a)).get(layer, {}).get('features', [])
            fb = mapbox_vector_tile.decode(gzip.decompress(b)).get(layer, {}).get('features', [])
            key = lambda f: json.dumps([f['type'], f['geometry'], f['properties']], sort_keys=True)
            wrong, missing = 0, 0
            for f in fb:
                t = f['properties'].pop('tenure', None)
                if t is None: missing += 1
                elif t != tenure.get(f['properties']['tree_id'], 'unknown'): wrong += 1
            same = collections.Counter(map(key, fa)) == collections.Counter(map(key, fb))
            rows.append({'tile': zxy, 'live_features': len(fa), 'new_features': len(fb), 'identical_apart_from_tenure': same,
                         'tenure_missing': missing, 'tenure_not_sidecar': wrong})
    return rows


def main():
    t = pq.read_table(W / 'data/tenure.parquet', columns=['tree_id', 'tenure'])
    tenure = dict(zip(t['tree_id'].to_pylist(), t['tenure'].to_pylist())); report = {}
    for name, layer in BUILDS:
        lp, np_ = LIVE / f'{name}.pmtiles', W / f'tiles/{name}.pmtiles'
        live, new = open_archive(lp), open_archive(np_); r = {'bytes': {'live': lp.stat().st_size, 'new': np_.stat().st_size}}
        hl, hn = Reader(live).header(), Reader(new).header()
        r['header_differences'] = {k: [hl[k], hn[k]] for k in hl if hl[k] != hn[k] and not k.endswith(('_offset', '_length'))}
        ml, mn = Reader(live).metadata(), Reader(new).metadata()
        r['metadata_keys_differing'] = sorted(k for k in set(ml) | set(mn) if ml.get(k) != mn.get(k))
        vl = {l['id']: l for l in ml['vector_layers']}[layer]; vn = {l['id']: l for l in mn['vector_layers']}[layer]
        r['vector_layer'] = {'fields_added': {k: vn['fields'][k] for k in set(vn['fields']) - set(vl['fields'])},
                             'fields_removed': sorted(set(vl['fields']) - set(vn['fields'])),
                             'fields_changed': sorted(k for k in vl['fields'] if vn['fields'].get(k, vl['fields'][k]) != vl['fields'][k]),
                             'zooms': [[vl['minzoom'], vl['maxzoom']], [vn['minzoom'], vn['maxzoom']]]}
        ts = {l['layer']: l for l in mn['tilestats']['layers']}[layer]; tl = {l['layer']: l for l in ml['tilestats']['layers']}[layer]
        r['tilestats'] = {'count': [tl['count'], ts['count']],
                          'tenure_values': next((a.get('values') for a in ts['attributes'] if a['attribute'] == 'tenure'), None)}
        log(name, 'scanning live'); cl = tile_counts(lp); log(name, 'scanning new'); cn = tile_counts(np_)
        zl, zn = collections.Counter(), collections.Counter(); bl, bn = collections.Counter(), collections.Counter()
        diff_counts, diff_keys, no_tenure = [], [], 0
        for k, (size, layers) in cl.items(): zl[k[0]] += layers.get(layer, (0, []))[0]; bl[k[0]] += size
        for k, (size, layers) in cn.items():
            zn[k[0]] += layers.get(layer, (0, []))[0]; bn[k[0]] += size
            if k not in cl: continue
            (fa, ka), (fb, kb) = cl[k][1].get(layer, (0, [])), layers.get(layer, (0, []))
            if fa != fb: diff_counts.append([list(k), fa, fb])
            if fb and 'tenure' not in kb: no_tenure += 1
            if set(kb) - {'tenure'} != set(ka): diff_keys.append(list(k))
        r['tiles'] = {'live': len(cl), 'new': len(cn), 'only_live': len(set(cl) - set(cn)), 'only_new': len(set(cn) - set(cl)),
                      'feature_count_differs': len(diff_counts), 'feature_count_differs_examples': diff_counts[:20],
                      'attribute_keys_differ_beyond_tenure': len(diff_keys), 'nonempty_without_tenure': no_tenure}
        r['by_zoom'] = {z: {'features': [zl[z], zn[z]], 'bytes': [bl[z], bn[z]]} for z in sorted(zl | zn)}
        r['bayswater'] = compare_sample(live, new, layer, tenure)
        report[name] = r; log(name, json.dumps({k: v for k, v in r.items() if k != 'bayswater'}, default=str)[:3000])
    OUT.write_text(json.dumps(report, indent=1, default=str) + '\n'); log('written', OUT)


if __name__ == '__main__': main()
