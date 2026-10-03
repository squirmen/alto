#!/usr/bin/env python3
"""Fetch and cache the open layers that property and tenure summaries rest on.

Auckland Council publishes the Unitary Plan base zones, designations and its park
extents, and DOC its public conservation land, as CC BY 4.0 ArcGIS feature services
(the plan zones stop at the Hauraki Gulf Islands, where conservation land fills much
of the gap). OpenStreetMap carries the LINZ address import, golf courses and the
island road network under the ODbL. Each layer is fetched once, sequentially and
politely, into data/raw so every later stage and every rerun works offline from the
same copy. Only the attributes the build needs are kept: editor user names and similar
service bookkeeping are dropped at fetch time.

Overpass answers CSV as text/csv with no charset, so the body is decoded as UTF-8
explicitly: decoded as ISO-8859-1 (the HTTP default for text) every macron is garbled,
ā becoming Ä plus a control character. Cells cached before that fix are repaired
losslessly on the next run.
"""
import csv, gzip, io, json, re, sys, time
from pathlib import Path
import numpy as np, pandas as pd, requests, shapely, geopandas as gpd
from pyproj import Transformer

W = Path('/data/alto/working/alto_parcels_20261002')
RAW = W / 'data/raw'
AGOL = 'https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services'
OVERPASS = 'https://overpass-api.de/api/interpreter'
UA = {'User-Agent': 'ALTO-research/1.0 (+https://alto.tfwelch.com)'}
DOC = 'https://services1.arcgis.com/3JjYDyG3oajxU6HO/arcgis/rest/services'
AUCKLAND_ENVELOPE = {'geometry': '174.1,-37.35,175.6,-35.85', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
                     'spatialRel': 'esriSpatialRelIntersects'}
# key: (service root, service, fields kept, extra query parameters, page size, publisher)
LAYERS = {
    'unitary_plan_base_zone': (AGOL, 'Unitary_Plan_Base_Zone', ['OBJECTID', 'ZONE', 'GROUPZONE', 'NAME'], {}, 2000, 'Auckland Council'),
    'park_extent_public': (AGOL, 'ParkExtentPublic', ['OBJECTID', 'AssetGroup', 'TLA_AssetDes', 'SiteName'], {}, 2000, 'Auckland Council'),
    'park_extents': (AGOL, 'Park_Extents', ['OBJECTID', 'AssetGroup', 'SAPID', 'DESCRIPTION', 'SITEDESCRIPTION', 'LOCALBOARD'], {}, 2000, 'Auckland Council'),
    # Public conservation land settles tenure where the plan zones do not reach (Hauraki Gulf Islands).
    'doc_public_conservation_land': (DOC, 'DOC_Public_Conservation_Land', ['OBJECTID', 'NaPALIS_ID', 'Type', 'Name', 'Legislation',
                                     'Vested', 'Control_Managed', 'Private_Ownership'], AUCKLAND_ENVELOPE, 1000, 'Department of Conservation'),
    # Unitary Plan designations: SUBTYPE is the requiring authority (Minister of Defence, Minister of Education, Auckland Council ...).
    'designation': (AGOL, 'Designation', ['OBJECTID', 'TYPE', 'SUBTYPE', 'SCHEDULE', 'NAME', 'VERSIONSTATUS'], {}, 2000, 'Auckland Council'),
}
# Auckland region split into cells small enough for Overpass to answer quickly.
ADDRESS_CELLS = [(s, w, round(s + 0.25, 2), round(w + 0.25, 2))
                 for s in [-37.35 + 0.25 * i for i in range(6)] for w in [174.1 + 0.25 * j for j in range(6)]]
ADDRESS_TAGS = ['addr:housenumber', 'addr:unit', 'addr:flats', 'addr:street', 'addr:place', 'addr:suburb', 'addr:hamlet', 'addr:city', 'addr:postcode']
# Hauraki Gulf island groups (south, west, north, east), each around the plan's Hauraki Gulf Islands zone plus 500 m:
# Great Barrier, Waiheke, Rangitoto and Motutapu, Kawau, Pakatoa/Rotoroa/Ponui, Rakino and the smaller islands.
ISLAND_BOXES = [(-36.36, 175.28, -36.01, 175.55), (-36.86, 174.97, -36.73, 175.21), (-36.82, 174.82, -36.69, 175.02),
                (-36.24, 175.04, -36.16, 175.12), (-36.94, 175.14, -36.78, 175.24), (-36.15, 175.48, -36.11, 175.53),
                (-35.93, 175.04, -35.89, 175.17), (-36.29, 175.32, -36.26, 175.34), (-36.87, 175.12, -36.85, 175.14)]
ROAD_TYPES = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road)(_link)?$'
# Double-encoded UTF-8 read as Latin-1: C1 controls, or a UTF-8 lead byte (Ã Ä Å ...) followed by a continuation byte.
MOJIBAKE = re.compile('[\u0080-\u009f]|[Â-ô][\u0080-¿]')


def log(*s): print(time.strftime('%H:%M:%S'), *s, flush=True)


def get(url, params=None, data=None, tries=6, timeout=300):
    for i in range(tries):
        try:
            r = (requests.post(url, data=data, headers=UA, timeout=timeout) if data is not None
                 else requests.get(url, params=params, headers=UA, timeout=timeout))
            if r.status_code == 200 and not r.content.lstrip().startswith(b'<'):
                return r
            log('retry', i + 1, r.status_code, r.content[:160].decode('utf-8', 'replace').replace('\n', ' '))
        except requests.RequestException as e:
            log('retry', i + 1, type(e).__name__, str(e)[:160])
        time.sleep(min(300, 20 * 2 ** i))
    raise RuntimeError(f'gave up on {url}')


def unmangle(text):
    """Undo UTF-8 that was decoded as Latin-1 (lossless: every Latin-1 character maps back to its byte)."""
    if not MOJIBAKE.search(text):
        return text
    fixed = text.encode('latin-1').decode('utf-8')
    assert not MOJIBAKE.search(fixed), 'text is still garbled after one repair'
    return fixed


def domains(root, service):
    """Coded-value domains, so cached zones carry names rather than numeric codes."""
    meta = get(f'{root}/{service}/FeatureServer/0', {'f': 'json'}).json()
    return {f['name']: {c['code']: c['name'] for c in f['domain']['codedValues']}
            for f in meta['fields'] if (f.get('domain') or {}).get('type') == 'codedValue'}


def fetch_layer(key, refresh=False):
    out = RAW / f'{key}.gpkg'
    if out.exists() and not refresh:
        return out
    root, service, fields, extra, size, publisher = LAYERS[key]
    url = f'{root}/{service}/FeatureServer/0/query'
    total = get(url, {'where': '1=1', 'returnCountOnly': 'true', 'f': 'json', **extra}).json()['count']
    rows, geoms, offset = [], [], 0
    while True:
        page = get(url, {'where': '1=1', 'outFields': ','.join(fields), 'outSR': 2193, 'orderByFields': 'OBJECTID',
                         'resultOffset': offset, 'resultRecordCount': size, 'f': 'geojson', **extra}).json()
        feats = page.get('features', [])
        for f in feats:
            rows.append({k: f['properties'].get(k) for k in fields})
            geoms.append(shapely.from_geojson(json.dumps(f['geometry'])) if f.get('geometry') else None)
        offset += len(feats)
        log(key, offset, '/', total)
        if not feats or offset >= total:
            break
        time.sleep(0.5)
    assert offset == total, (key, offset, total)
    df = gpd.GeoDataFrame(rows, geometry=geoms, crs=2193)
    for field, codes in domains(root, service).items():
        if field in df and all(isinstance(c, (int, float)) for c in codes):
            df[field + '_NAME'] = df[field].map(lambda v: codes.get(int(v)) if v == v and v is not None else None)
    df = df[df.geometry.notna()].copy()
    bad = ~df.geometry.is_valid
    df.loc[bad, 'geometry'] = shapely.make_valid(df.geometry[bad].values)
    df['source'] = f'{publisher} {service} (CC BY 4.0)'
    df['fetched_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    RAW.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.tmp.gpkg')
    df.to_file(tmp, layer=key, driver='GPKG')
    tmp.rename(out)
    log(key, 'cached', len(df), 'invalid repaired', int(bad.sum()))
    return out


def fetch_addresses(refresh=False):
    """OSM address points and building/parcel centres for the Auckland region, as TSV."""
    out = RAW / 'osm_addresses_auckland.tsv.gz'
    part_dir = RAW / 'osm_address_cells'
    part_dir.mkdir(parents=True, exist_ok=True)
    repaired = 0
    for part in sorted(part_dir.glob('*.tsv')):  # cells written before the UTF-8 fix
        text = part.read_text(encoding='utf-8')
        if (fixed := unmangle(text)) != text:
            part.write_text(fixed, encoding='utf-8'); repaired += 1
    if repaired:
        log('osm cells repaired', repaired)
    if out.exists() and not refresh and not repaired:
        return out
    cols = ['::type', '::id', '::lat', '::lon'] + ADDRESS_TAGS
    head = ','.join(f'"{c}"' if c.startswith('addr') else c for c in cols)
    for s, w, n, e in ADDRESS_CELLS:
        part = part_dir / f'{s}_{w}.tsv'
        if part.exists():
            continue
        q = f'[out:csv({head};true;"\\t")][timeout:600];nwr["addr:housenumber"]({s},{w},{n},{e});out center;'
        text = get(OVERPASS, data={'data': q}, timeout=900).content.decode('utf-8')
        assert text.startswith('@type'), text[:200]
        part.write_text(text, encoding='utf-8')
        log('osm cell', s, w, len(text.splitlines()) - 1, 'rows')
        time.sleep(5)
    seen = set()
    with gzip.open(out.with_suffix('.tmp.gz'), 'wt', encoding='utf-8', newline='') as fh:
        wr = csv.writer(fh, delimiter='\t')
        wr.writerow(['osm_type', 'osm_id', 'lat', 'lon'] + ADDRESS_TAGS)
        for part in sorted(part_dir.glob('*.tsv')):
            text = part.read_text(encoding='utf-8')
            assert not MOJIBAKE.search(text), part
            rd = csv.reader(io.StringIO(text), delimiter='\t')
            next(rd)
            for row in rd:
                if (row[0], row[1]) in seen or not row[2]:
                    continue
                seen.add((row[0], row[1]))
                wr.writerow(row)
    out.with_suffix('.tmp.gz').rename(out)
    log('osm addresses', len(seen))
    return out


def overpass_ways(query):
    """Overpass JSON with `out geom` -> list of (element, [LineString per way or member way])."""
    data = json.loads(get(OVERPASS, data={'data': query}, timeout=900).content.decode('utf-8'))
    out = []
    for el in data['elements']:
        ways = [el['geometry']] if el['type'] == 'way' else [m['geometry'] for m in el.get('members', [])
                                                           if m['type'] == 'way' and m.get('role', 'outer') in ('outer', '') and m.get('geometry')]
        lines = [shapely.linestrings([(p['lon'], p['lat']) for p in g]) for g in ways if len(g) >= 2]
        if lines:
            out.append((el, lines))
    return out


def save_osm(df, key, what):
    tf = Transformer.from_crs(4326, 2193, always_xy=True)
    df = gpd.GeoDataFrame(df, geometry=shapely.transform(df.pop('geometry').values, lambda xy: np.column_stack(tf.transform(xy[:, 0], xy[:, 1]))), crs=2193)
    df['source'] = f'OpenStreetMap {what} (ODbL 1.0, © OpenStreetMap contributors)'
    df['fetched_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    out = RAW / f'{key}.gpkg'
    df.to_file(out.with_suffix('.tmp.gpkg'), layer=key, driver='GPKG')
    out.with_suffix('.tmp.gpkg').rename(out)
    log(key, 'cached', len(df))


def fetch_golf_courses(refresh=False):
    """OSM leisure=golf_course outlines: an Open Space zone over a private club's course is not public land."""
    if (RAW / 'osm_golf_courses.gpkg').exists() and not refresh:
        return
    s, w, n, e = -37.35, 174.1, -35.85, 175.6
    rows = []
    for el, lines in overpass_ways(f'[out:json][timeout:600];(way["leisure"="golf_course"]({s},{w},{n},{e});'
                                   f'relation["leisure"="golf_course"]({s},{w},{n},{e}););out geom;'):
        polys = shapely.get_parts(shapely.polygonize(shapely.get_parts(shapely.line_merge(shapely.union_all(lines)))))
        if len(polys):
            rows.append({'osm_type': el['type'], 'osm_id': el['id'], 'name': el.get('tags', {}).get('name'),
                         'geometry': shapely.union_all(polys)})
    save_osm(pd.DataFrame(rows), 'osm_golf_courses', 'leisure=golf_course')


def fetch_island_roads(refresh=False):
    """OSM road centrelines on the Hauraki Gulf islands, where the plan zones leave roads unzoned and unparcelled."""
    if (RAW / 'osm_island_roads.gpkg').exists() and not refresh:
        return
    q = '[out:json][timeout:600];(' + ''.join(f'way["highway"~"{ROAD_TYPES}"]({s},{w},{n},{e});' for s, w, n, e in ISLAND_BOXES) + ');out geom;'
    rows = [{'osm_id': el['id'], 'highway': el.get('tags', {}).get('highway'), 'geometry': lines[0]} for el, lines in overpass_ways(q)]
    save_osm(pd.DataFrame(rows), 'osm_island_roads', 'highway centrelines')


if __name__ == '__main__':
    which = sys.argv[1:] or [*LAYERS, 'addresses', 'golf', 'island_roads']
    extra = {'addresses': fetch_addresses, 'golf': fetch_golf_courses, 'island_roads': fetch_island_roads}
    for k in which:
        extra[k]() if k in extra else fetch_layer(k)
