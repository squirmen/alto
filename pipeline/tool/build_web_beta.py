#!/usr/bin/env python3
"""Build a self-contained copy of the interface (web/) to serve at a sub-path of the live site, e.g. /beta/.

The copy reads the live site's data from the parent folder (same origin, no data copy):
  - data from ../data, the data release's metadata from ../release-metadata.json, KYTE from ../kyte;
  - the tile cache stamp is taken at run time from the live metadata (assembly.tile_version), so the
    copy follows the live data from one release to the next (v5.2 -> v6) without a rebuild and never
    reuses a cached tile from an earlier release;
  - the v6 growth form, the Council recorded positions layer and other optional products are switched
    on only when the live metadata lists them.

It writes its own release-metadata.json describing the tool build (not the data), a MANIFEST.sha256 and
UPLOAD.md. Nothing is uploaded.

Usage: build_web_beta.py --out <folder>/beta [--version 0.2.0-beta] [--channel beta] [--force]
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WEB = REPO / 'web'
# Files the live site already serves from its root, or that describe a data release.
SKIP = {'release-metadata.json', 'v5-methods.html', 'v51-methods.html', 'v52-methods.html', 'v6-methods.html', 'v61-methods.html', 'htaccess.example'}
PAGES = ('index.html', 'tree.html')
METHODS_PAGES = ('v5-methods.html', 'v51-methods.html', 'v52-methods.html', 'v6-methods.html', 'v61-methods.html')
# Every page's own scripts and styles carry the build's stamp (?v=tool-<version>), whatever stamp the source
# page had, so a browser never pairs a new page with a cached script or style from an earlier build.
LOCAL_ASSET = re.compile(r'(["\'](?:\./)?[\w./-]+\.(?:js|mjs|css))\?v=[^"\'&#]*')


def stamp_assets(html, stamp):
    return LOCAL_ASSET.sub(lambda m: f'{m.group(1)}?v={stamp}', html)


def git(*args):
    try:
        return subprocess.run(['git', '-C', str(REPO), *args], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None


def changelog_html(md, version):
    """CHANGELOG.md as a plain page the build can link to (the repository copy is not public yet)."""
    import html as h
    def inline(t):
        t = h.escape(t)
        t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
        t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
        return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    out, para, items = [], [], []
    def flush():
        if para: out.append('<p>' + inline(' '.join(para)) + '</p>'); para.clear()
        if items: out.append('<ul>' + ''.join(f'<li>{inline(i)}</li>' for i in items) + '</ul>'); items.clear()
    for line in md.splitlines():
        m = re.match(r'^(#{1,4})\s+(.*)', line)
        if m: flush(); n = len(m.group(1)); out.append(f'<h{n}>{inline(m.group(2))}</h{n}>'); continue
        if line.startswith('- '): para and flush(); items.append(line[2:]); continue
        if line.startswith('  ') and items: items[-1] += ' ' + line.strip(); continue
        if not line.strip(): flush(); continue
        if items: flush()
        para.append(line.strip())
    flush()
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            '<meta name="robots" content="noindex, nofollow"><title>ALTO changelog</title><style>body{max-width:760px;margin:0 auto;padding:24px 16px 48px;'
            'font:15px/1.6 Inter,system-ui,sans-serif;color:#17201a;background:#f7f8f5}h1{font-size:26px}h2{margin-top:28px;font-size:20px;border-bottom:1px solid #d8ddd6}'
            'h3{font-size:16px}code{font-size:13px}a{color:#4a6f46}</style></head><body><p><a href="./">ALTO map (tool ' + h.escape(version) + ')</a></p>'
            + '\n'.join(out) + '</body></html>\n')


def write_upload_notes(out, version, commit, files, total, root, derived=(), public=False):
    """UPLOAD.md beside the folder: what to upload where, what it needs from the site, how to check and undo."""
    top = sorted({p.relative_to(out).parts[0] for p in files} | {'MANIFEST.sha256'})
    rows = '\n'.join(f'| `{name}` | {"folder" if (out / name).is_dir() else "file"} |' for name in top)
    derived_text = ''
    if derived:
        listed = '\n'.join(f'  - `{out.name}/derived/{d["release"]}/`: {", ".join(sorted(d["products"])) or "no products"}'
                           + (f' (left out: {", ".join(d["left_out"])}, which the public pages do not read)' if d.get('left_out') else '') for d in derived)
        derived_text = ('- Derived files travel inside the build, one folder per data release; the tree page uses only the\n'
                        '  folder named by the live release\'s `dataset_version`:\n' + listed + '\n')
    base = '' if public else f'{out.name}/'
    where = (f"""This is a public build for the site root: copy the contents of `{out.name}/` over the site root
(pages, scripts, styles, fonts, the methods pages, `derived/` and `tool-build.json`). It holds no
`data/`, `kyte/`, `release-metadata.json` (the data release's) or `.htaccess`; those stay as they are.
""" if public else f"""Upload the folder `{out.name}/` as it is to the site root, so it is served at `/{out.name}/` beside the
live map (for example `https://<site>/{out.name}/`). Nothing outside `{out.name}/` changes: the live
`index.html`, `data/`, `kyte/` and `.htaccess` are untouched.
""")
    text = f"""# Upload: ALTO tool {version}

{where}
- Build: tool {version}, commit `{commit}` ({len(files) + 1} files, {total / 1e6:.1f} MB).
- Checksums: `{out.name}/MANIFEST.sha256` (`shasum -a 256 -c MANIFEST.sha256` inside the folder).

| Top-level entry | |
|---|---|
{rows}

## What it uses from the live site (same origin, read only)

- `{root}/release-metadata.json`: the data release (v6 now, v6.1 next). The cache stamp for every data
  request is read from its `assembly.tile_version`, so the build follows the live data release
  without a rebuild, and growth form appears only when the metadata lists it.
- `{root}/data/…` (tiles, tree and property records), `{root}/kyte/…` (photos, KYTE links),
  `{root}/v6-methods.html` / `{root}/v61-methods.html` (release notes); from data release 6.1, the tree-number
  alias table `{root}/data/tree_ids/` (without it the pages keep record IDs as the tree IDs).
- `{root}/data/tree_change_v1.pmtiles`: Change since 2013 v1, a new file name (upload it before this build goes
  live; the screened `tree_change.pmtiles` stays for rollback).
- The site root `.htaccess` applies to `{out.name}/` too: `.mjs` as JavaScript, Range requests,
  the CSP (scripts from self and unpkg.com; tiles from arcgisonline.com and openstreetmap.org).
- The tree page's aerial imagery reads LINZ's open imagery archive from the browser: the CSP's
  `connect-src` must also allow `https://nz-imagery.s3.ap-southeast-2.amazonaws.com` (see
  `web/htaccess.example`). Until it does, that section says the site does not yet allow it; nothing
  else is affected.
- Its own `{'tool-build.json' if public else 'release-metadata.json'}` describes this tool build only (`tool_version`); the pages do not
  read it.
{derived_text}
## After uploading, check

1. `/{base}`: the map loads; About and the panel footer name the live data release and Tool v{version}{'' if public else '; the header shows a Beta pill and a link back to the current map'}.
2. Tap a tree: the panel shows size pictures and "Open tree page"; with data release 6.1, its tree number,
   Copy and permalink, and the address ends `?tree=<number>`.
3. `/{base}tree.html?id=akl_tree_trp_ACCT0245027`: the tree page loads with its mini map;
   "Among similar trees" shows street, local board and Auckland rows when the live release has a
   derived folder in this build (otherwise it says the tables are not published for this release);
   "Aerial imagery through time" shows the crown in each LINZ survey once the CSP allows the archive.
4. `/{base}?property=6563788`: a property opens; the Area tab summarises it.
5. Browser console: no errors; the pages {'do not carry' if public else 'carry'} `noindex`.{chr(10)+'6. `/v6-methods.html` and `/v61-methods.html`: the release 6 and 6.1 methods pages on the methods template.' if public else ''}

## Undo

{'Restore the previous tool files at the site root from the copy taken before this upload (the data release, `kyte/` and `.htaccess` were not touched).' if public else f'Delete the `{out.name}/` folder. Nothing else was changed.'}
"""
    (out.parent / 'UPLOAD.md').write_text(text)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True)
    ap.add_argument('--version', default=None, help='tool version for this build (default: web/version.js + "-beta")')
    ap.add_argument('--channel', default='beta')
    ap.add_argument('--site-root', default='..', help='path from the build to the live site root')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--derived', action='append', default=[],
                    help='a derived folder for one data release (named by its dataset_version, holding manifest.json); '
                         'copied to derived/<dataset_version>/ in the build; repeat for several releases')
    ap.add_argument('--public', action='store_true',
                    help='a build for the site root (the public map): no noindex, no "(beta)" title, the restyled methods '
                         'pages included, and the tool build described in tool-build.json so the root release-metadata.json '
                         '(the data release) is never replaced')
    ap.add_argument('--with-points', action='store_true',
                    help='also copy per-tree LiDAR point crops (tree_points); the public map and tree page no longer '
                         'read them (the 3D returns viewer is a workbench tool), so they are left out by default')
    a = ap.parse_args()
    out = Path(a.out).resolve()
    if out.exists() and any(out.iterdir()):
        if not a.force:
            sys.exit(f'{out} is not empty (use --force to replace it)')
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    vtext = (WEB / 'version.js').read_text()
    base_version = re.search(r"version:'([^']+)'", vtext).group(1)
    repository = re.search(r"repository:'([^']+)'", vtext).group(1)
    version = a.version or f'{base_version}-{a.channel}'
    stamp = f'tool-{version}'
    root = a.site_root.rstrip('/')

    # The public build ships the tool's restyled methods pages (release 5 to 6), replacing the copies a data
    # bundle carried (the v6 bundle's v6-methods.html predates the 12 Oct audit and the methods template).
    skip = {'release-metadata.json', 'htaccess.example'} if a.public else SKIP
    for src in sorted(WEB.iterdir()):
        if src.name in skip or src.name.startswith('.'):
            continue
        dst = out / src.name
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    # Derived files (comparison tables and the like) travel with the build, one folder per data release;
    # the tree page uses the folder whose name is the live release's dataset_version, and nothing else.
    derived = []
    for d in a.derived:
        d = Path(d).resolve()
        mf = json.loads((d / 'manifest.json').read_text())
        if mf.get('release') != d.name:
            sys.exit(f'{d}: manifest is for {mf.get("release")}')
        products = dict(mf.get('products', {}))
        skip = set()
        if not a.with_points and 'tree_points' in products:
            skip.add(Path(products.pop('tree_points')).parts[0])
        shutil.copytree(d, out / 'derived' / d.name, ignore=lambda folder, names: [n for n in names if Path(folder) == d and n in skip])
        if skip:
            (out / 'derived' / d.name / 'manifest.json').write_text(json.dumps({**mf, 'products': products}, separators=(',', ':')))
        derived.append({'release': d.name, 'products': products, 'left_out': sorted(skip)})
    derived_js = 'window.ALTO_DERIVED_BASE="./derived/{release}";' if derived else ''
    boot = (f'<script>window.AKL_DATA_BASE="{root}/data";window.AKL_TILE_VERSION="auto";'
            f'window.ALTO_SITE_ROOT="{root}";window.ALTO_CHANNEL="{a.channel}";window.ALTO_CHANGELOG="./changelog.html";{derived_js}</script>')
    for name in PAGES:
        p = out / name
        html = p.read_text()
        html, n = re.subn(r'<script>window\.AKL_DATA_BASE="[^"]*";window\.AKL_TILE_VERSION="[^"]*";</script>', boot, html)
        assert n == 1, f'{name}: data base script not found'
        if not a.public:
            html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
                                '<meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="robots" content="noindex, nofollow">', 1)
        html = stamp_assets(html.replace('?v=V6_VERSION', f'?v={stamp}'), stamp)
        if not a.public:
            html = re.sub(r'<title>(.*?)</title>', lambda m: f'<title>{m.group(1)} (beta)</title>', html, count=1)
        p.write_text(html)
    if a.public:
        for name in METHODS_PAGES:
            p = out / name
            if p.exists():
                p.write_text(stamp_assets(p.read_text(), stamp))
    (out / 'changelog.html').write_text(changelog_html((REPO / 'CHANGELOG.md').read_text(), version).replace('href="VERSIONING.md"', 'href="versioning.html"'))
    (out / 'versioning.html').write_text(changelog_html((REPO / 'VERSIONING.md').read_text(), version).replace('<title>ALTO changelog</title>', '<title>ALTO versioning</title>'))
    vjs = out / 'version.js'
    vjs.write_text(vjs.read_text().replace(f"version:'{base_version}'", f"version:'{version}'").replace("status:'prototype'", f"status:'{a.channel}'"))

    commit = git('rev-parse', 'HEAD')
    meta = {
        'schema_version': 1,
        'kind': 'tool_build',
        'tool_version': version,
        'tool': {'name': 'ALTO', 'version': version, 'channel': a.channel, 'built_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                 'source': {'repository': repository, 'branch': git('rev-parse', '--abbrev-ref', 'HEAD'), 'commit': commit,
                            'uncommitted_changes': bool(git('status', '--porcelain', '--', 'web'))}},
        'data': {'description': 'This build has no data of its own. It reads the live site data release.',
                 'metadata': f'{root}/release-metadata.json', 'base': f'{root}/data', 'kyte': f'{root}/kyte',
                 'tile_version': 'read at run time from the live metadata (assembly.tile_version)',
                 'tested_with': ['v5.2 (metro-2026.10.10-pointcloud-v5.2)', 'v6 (metro-2026.10.12-pointcloud-v6)',
                                 'v6.1 (metro-2026.10.13-pointcloud-v6.1)'],
                 'derived': derived or None},
        'see': ['CHANGELOG.md', 'VERSIONING.md']
    }
    (out / ('tool-build.json' if a.public else 'release-metadata.json')).write_text(json.dumps(meta, indent=2) + '\n')

    files = sorted(p for p in out.rglob('*') if p.is_file())
    lines = []
    for p in files:
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        lines.append(f'{h}  {p.relative_to(out).as_posix()}')
    (out / 'MANIFEST.sha256').write_text('\n'.join(lines) + '\n')
    total = sum(p.stat().st_size for p in files)
    write_upload_notes(out, version, commit, files, total, root, derived, public=a.public)
    print(json.dumps({'out': str(out), 'version': version, 'files': len(files) + 1, 'bytes': total, 'commit': commit}, indent=1))


if __name__ == '__main__':
    main()
