#!/usr/bin/env python3
"""Build web/imagery-coverage.json: for every aerial survey that "Aerial imagery through time" reads (the surveys since
2010 in web/tree-imagery.js and the scanned historical surveys of Auckland in LINZ's catalogue), the files of LINZ's sheet
grid it holds and the outline of its capture area, so a tree page asks the archive only for surveys and files that cover
the tree (no 404 probes and no reads outside a survey; FE-18); and the list of the scanned surveys with their metadata.

Reads metadata only, from LINZ's open imagery archive (https://nz-imagery.s3.ap-southeast-2.amazonaws.com/, CC BY 4.0):
the catalogue (catalog.json), each survey's STAC collection (collection.json: title, flying period, pixel size,
providers, one item link per GeoTIFF) and its capture area (capture-area.geojson).

Per survey (surveys):
  scale, files  the sheet grid its files are cut on (1:500 to 1:10000) and how many files it has;
  sheets        one bitmask per map sheet of the files it holds: bit (row - 1) * columns + (column - 1), least
                significant first, base64;
  footprint     its capture area (LINZ: "excludes nodata areas", "geometries are simplified") in NZTM2000, grown by
                GROW m and simplified to SIMPLIFY m, so it still contains LINZ's outline: bbox [x0, y0, x1, y1] and
                rings, each a flat list x0, y0, dx1, dy1, ... in whole metres (closing point left out; inside = an odd
                number of rings around the point).
Scanned surveys (historic), oldest first: every collection in the catalogue whose title names Auckland and whose
linz:geospatial_category is scanned-aerial-photos. id, path, title, survey number, label (the years of the title),
pixel size (gsd, m), sheet scale, flying period as NZ dates (LINZ stores NZ midnight in UTC), colour, licensors and
producers as LINZ lists them.

Colour: LINZ's metadata has no colour field. A survey number with a C suffix (SN9998C) or the SNC prefix (SNC50347)
marks a colour survey. Checked on 17 Oct 2026 against the pixels of the smallest overview of one file of each of the 85
surveys (--check-colour; about 48 KB per survey, needs GDAL): the ten C surveys are colour, the other 75 are black and
white (their three bands equal).

The scanned surveys' rows in web/credits.html (between <!-- scanned-surveys --> and <!-- /scanned-surveys -->) are
written from the same list.

Usage: python3 pipeline/tool/build_imagery_coverage.py [--out web/imagery-coverage.json] [--credits web/credits.html]
         [--cache DIR] [--check-colour]
Needs shapely and pyproj (the main conda environment). Re-run it when tree-imagery.js gains a survey, or when LINZ adds
or republishes one.
"""
import argparse
import base64
import datetime
import html
import json
import re
import sys
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

from pyproj import Transformer
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[2]
BUCKET = 'https://nz-imagery.s3.ap-southeast-2.amazonaws.com'
SHEET_W, SHEET_H = 24000, 36000
GRID = {500: (240, 360), 1000: (480, 720), 2000: (960, 1440), 5000: (2400, 3600), 10000: (4800, 7200)}
SURVEY = re.compile(r"S\('([^']+)','[^']*','[^']*',[\d.]+,(\d+),")
NAME = re.compile(r'^([A-HJ-NP-Z]{2}\d{2})_(\d+)_(\d+)$')
GROW, SIMPLIFY = 20, 10  # m
SCANNED = 'scanned-aerial-photos'
NZ = ZoneInfo('Pacific/Auckland')
TO_NZTM = Transformer.from_crs(4326, 2193, always_xy=True).transform
UA = {'User-Agent': 'ALTO imagery coverage index (alto.tfwelch.com)'}
MARK = re.compile(r'(<!-- scanned-surveys -->\n)(.*?)([ \t]*<!-- /scanned-surveys -->)', re.S)


class Archive:
    """Metadata reads from the archive, kept in --cache when given (a re-run reads nothing twice)."""

    def __init__(self, cache=None):
        self.cache = Path(cache) if cache else None
        if self.cache:
            self.cache.mkdir(parents=True, exist_ok=True)

    def json(self, path):
        f = self.cache / path.replace('/', '__') if self.cache else None
        if f and f.exists():
            return json.loads(f.read_text())
        with urllib.request.urlopen(urllib.request.Request(f'{BUCKET}/{path}', headers=UA), timeout=60) as r:
            raw = r.read()
        if f:
            f.write_bytes(raw)
        return json.loads(raw)


def modern_surveys():
    src = (ROOT / 'web' / 'tree-imagery.js').read_text()
    out = [(m.group(1), int(m.group(2))) for m in SURVEY.finditer(src)]
    if not out:
        sys.exit('no surveys found in web/tree-imagery.js')
    return out


def item_names(col):
    return [Path(link['href']).name.removesuffix('.json') for link in col.get('links', []) if link.get('rel') == 'item']


def bitmasks(names, scale):
    gw, gh = GRID[scale]
    cols, rows, d = SHEET_W // gw, SHEET_H // gh, 3 if scale == 500 else 2
    sheets = {}
    for name in names:
        m = NAME.match(name)
        if not m or int(m.group(2)) != scale or len(m.group(3)) != 2 * d:
            raise SystemExit(f'unexpected file name {name} for 1:{scale}')
        row, col = int(m.group(3)[:d]), int(m.group(3)[d:])
        if not (1 <= row <= rows and 1 <= col <= cols):
            raise SystemExit(f'{name}: outside the 1:{scale} sheet grid')
        bits = sheets.setdefault(m.group(1), bytearray((rows * cols + 7) // 8))
        i = (row - 1) * cols + (col - 1)
        bits[i // 8] |= 1 << (i % 8)
    return {k: base64.b64encode(bytes(v)).decode() for k, v in sorted(sheets.items())}


def scale_of(names, sid):
    scales = {int(NAME.match(n).group(2)) for n in names if NAME.match(n)}
    if len(scales) != 1 or next(iter(scales)) not in GRID:
        raise SystemExit(f'{sid}: files on {sorted(scales)} sheet grids')
    return scales.pop()


def footprint(area, sid, grow=GROW, simplify=SIMPLIFY):
    """LINZ's capture area in NZTM, grown and simplified (it contains the original), in whole metres."""
    from shapely.ops import transform
    geom = area['geometry'] if area.get('type') == 'Feature' else area
    raw = transform(TO_NZTM, shape(geom))
    out = raw.buffer(grow, quad_segs=2).simplify(simplify, preserve_topology=True)
    if not out.is_valid:
        raise SystemExit(f'{sid}: footprint not valid after simplifying')
    left = raw.difference(out).area
    if left > 1:
        raise SystemExit(f'{sid}: the simplified footprint leaves {left:.0f} m² of the capture area out')
    rings = []
    for poly in getattr(out, 'geoms', [out]):
        for ring in [poly.exterior, *poly.interiors]:
            pts = [(round(x), round(y)) for x, y in ring.coords][:-1]
            flat, px, py = [], 0, 0
            for x, y in pts:
                flat += [x - px, y - py]
                px, py = x, y
            rings.append(flat)
    x0, y0, x1, y1 = out.bounds
    return {'bbox': [int(x0), int(y0), int(x1) + 1, int(y1) + 1], 'rings': rings}


def nz_date(iso):
    """A date LINZ stores as NZ midnight in UTC, as the NZ date (to the nearest day, whatever offset was used)."""
    t = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(NZ)
    return (t + datetime.timedelta(hours=12)).date().isoformat()


def label_of(title):
    m = re.search(r'\((\d{4})(?:-(\d{4}))?\)\s*$', title)
    if not m:
        raise SystemExit(f'no years in the title {title!r}')
    a, b = m.group(1), m.group(2)
    return a if not b or a == b else f'{a}–{b[2:]}' if a[:2] == b[:2] else f'{a}–{b}'


def is_colour(number):
    return bool(re.search(r'^SNC|C$', number))


def historic(archive):
    cat = archive.json('catalog.json')
    out = []
    for link in cat.get('links', []):
        title = link.get('title') or ''
        if link.get('rel') != 'child' or 'auckland' not in title.lower():
            continue
        path = link['href'].removeprefix('./').removesuffix('/collection.json')
        col = archive.json(f'{path}/collection.json')
        if col.get('linz:geospatial_category') != SCANNED:
            continue
        names = item_names(col)
        start, end = col['extent']['temporal']['interval'][0]
        number = col['linz:historic_survey_number']
        roles = lambda r: [p['name'] for p in col['providers'] if r in p.get('roles', [])]
        out.append({'id': col['linz:slug'], 'path': path, 'title': col['title'], 'number': number, 'label': label_of(col['title']),
                    'gsd': col['gsd'], 'scale': scale_of(names, col['linz:slug']), 'start': nz_date(start), 'end': nz_date(end),
                    'colour': is_colour(number), 'licensors': roles('licensor'), 'producers': roles('producer'),
                    '_names': names, '_area': f'{path}/capture-area.geojson'})
    if not out:
        sys.exit('no scanned surveys of Auckland in the catalogue')
    if len({s['id'] for s in out}) != len(out):
        sys.exit('two scanned surveys share an id')
    return sorted(out, key=lambda s: (s['start'], s['end'], s['id']))


def check_colour(surveys):
    """Each survey's colour flag against the pixels of the smallest overview of one of its files (GDAL, HTTP Range)."""
    import numpy as np
    from osgeo import gdal
    gdal.UseExceptions()
    for k, v in {'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR', 'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tiff'}.items():
        gdal.SetConfigOption(k, v)
    bad = []
    for s in surveys:
        ds = gdal.Open(f'/vsicurl/{BUCKET}/{s["path"]}/{s["_names"][len(s["_names"]) // 2]}.tiff')
        n = ds.GetRasterBand(1).GetOverviewCount()

        def band(i):
            b = ds.GetRasterBand(i)
            o = b.GetOverview(n - 1) if n else b
            return np.frombuffer(o.ReadRaster(0, 0, o.XSize, o.YSize, buf_type=gdal.GDT_Byte), dtype=np.uint8).reshape(o.YSize, o.XSize).astype(np.int16)
        r, g, b = band(1), band(2), band(3)
        m = band(4) > 0 if ds.RasterCount >= 4 else np.ones(r.shape, bool)
        diff = float(max(np.abs(r - g)[m].mean(), np.abs(g - b)[m].mean())) if m.any() else 0.0
        seen = diff > 2
        print(f'  {s["id"]}: mean band difference {diff:.2f} -> {"colour" if seen else "black and white"}')
        if seen != s['colour']:
            bad.append(s['id'])
    if bad:
        sys.exit(f'colour flag differs from the pixels: {", ".join(bad)}')


def credits_rows(surveys):
    esc = lambda t: html.escape(t, quote=False)
    names = lambda xs: ' and '.join(xs) if len(xs) < 3 else ', '.join(xs[:-1]) + ' and ' + xs[-1]
    return '\n'.join(
        f'            <tr><th scope="row">{esc(s["title"].replace("-", "–"))}</th><td>{esc("Colour" if s["colour"] else "Black and white")}</td>'
        f'<td>{esc(names(s["licensors"]))}</td><td>{esc(names(s["producers"]))}</td></tr>' for s in surveys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'web' / 'imagery-coverage.json'))
    ap.add_argument('--credits', default=str(ROOT / 'web' / 'credits.html'))
    ap.add_argument('--cache', default=None, help='keep the metadata read from the archive here')
    ap.add_argument('--check-colour', action='store_true')
    ap.add_argument('--grow', type=float, default=GROW, help='m added around each capture area')
    ap.add_argument('--simplify', type=float, default=SIMPLIFY, help='m tolerance (less than --grow)')
    a = ap.parse_args()
    if not 0 < a.simplify < a.grow:
        sys.exit('--simplify must be more than 0 and less than --grow')
    archive = Archive(a.cache)
    out = {'about': 'For each aerial survey read by web/tree-imagery.js: the files of LINZ\'s sheet grid it holds (per sheet, bit '
                    '(row - 1) * columns + (column - 1), least significant first, base64) and its capture area (NZTM2000, grown '
                    f'by {a.grow:g} m and simplified to {a.simplify:g} m; rings of whole metres, x0, y0, dx1, dy1, ...); and the scanned '
                    'historical surveys of Auckland, oldest first. From the STAC catalogue of the LINZ imagery archive (CC BY 4.0). '
                    'Built by pipeline/tool/build_imagery_coverage.py.',
           'generated': datetime.date.today().isoformat(),
           'grid': {str(s): [SHEET_W // g[0], SHEET_H // g[1]] for s, g in GRID.items()},
           'surveys': {}, 'historic': []}
    for sid, scale in modern_surveys():
        path = f'auckland/{sid}/rgb/2193'
        names = item_names(archive.json(f'{path}/collection.json'))
        out['surveys'][sid] = {'scale': scale, 'files': len(names), 'sheets': bitmasks(names, scale),
                               'footprint': footprint(archive.json(f'{path}/capture-area.geojson'), sid, a.grow, a.simplify)}
        print(f'{sid}: {len(names)} files on {len(out["surveys"][sid]["sheets"])} sheets')
    scanned = historic(archive)
    if a.check_colour:
        check_colour(scanned)
    for s in scanned:
        out['surveys'][s['id']] = {'scale': s['scale'], 'files': len(s['_names']), 'sheets': bitmasks(s['_names'], s['scale']),
                                   'footprint': footprint(archive.json(s['_area']), s['id'], a.grow, a.simplify)}
        out['historic'].append({k: v for k, v in s.items() if not k.startswith('_')})
    print(f'{len(scanned)} scanned surveys, {scanned[0]["start"][:4]}–{scanned[-1]["end"][:4]}; '
          f'{sum(s["colour"] for s in scanned)} in colour')
    Path(a.out).write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False) + '\n')
    print(f'wrote {a.out} ({Path(a.out).stat().st_size:,} bytes)')
    if a.credits:
        p = Path(a.credits)
        page = p.read_text()
        if not MARK.search(page):
            sys.exit(f'{p}: no <!-- scanned-surveys --> block')
        p.write_text(MARK.sub(lambda m: m.group(1) + credits_rows(scanned) + '\n' + m.group(3), page, count=1))
        print(f'wrote the {len(scanned)} scanned surveys into {p}')


if __name__ == '__main__':
    main()
