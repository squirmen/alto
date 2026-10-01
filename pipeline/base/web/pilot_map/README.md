# Pilot Map

A static MapLibre GL page that streams vector tiles from five `.pmtiles`
archives via HTTP Range requests. No server-side code, no database — it runs on
any static host that serves byte ranges (including typical shared hosting).

## Local preview

The tiles are loaded with Range requests, so use the project's Range-capable
server (`python3 -m http.server` does **not** honour `Range` and will try to
pull whole 200 MB files):

```bash
make serve-pilot-map
# or: python scripts/serve_pilot_map.py
```

Then open <http://localhost:8765/web/pilot_map/>. In local dev the page reads
the tiles two levels up in `data/processed/` (the `DATA_BASE` default).

## Deploy to a static host

1. Build the tiles if they're stale:

   ```bash
   AKL_TREES_PILOT=auckland_isthmus_v1 make build-web-geojson build-pmtiles
   ```

2. Assemble a self-contained, upload-ready bundle:

   ```bash
   make build-web-deploy
   ```

   This writes `outputs/web_deploy/`:

   ```text
   outputs/web_deploy/
     index.html          # DATA_BASE rewritten to ./data
     .htaccess           # Range + caching + no-gzip-on-pmtiles
     data/*.pmtiles      # five vector-tile archives (~2.1 GiB)
   ```

3. Upload the **contents** of `outputs/web_deploy/` into your web server's target
   directory (e.g. `public_html/trees/`) via cPanel File Manager, SFTP, or
   rsync. The `.pmtiles` are large but static — uploading once per rebuild.

   ```bash
   rsync -av --delete outputs/web_deploy/ user@host:~/public_html/trees/
   ```

4. Visit `https://yourdomain/trees/`.

### Why it's fast on shared hosting

- The browser only fetches the **byte ranges** for tiles in the current
  viewport/zoom, not the whole archive — initial load is a few hundred KB.
- `.htaccess` marks the `.pmtiles` `immutable` with a 1-year cache, so repeat
  visits and panning hit the browser cache.
- `.pmtiles` are explicitly excluded from gzip (gzip + Range corrupts partial
  reads); text assets (HTML/CSS/JS) are still compressed.
- The only third-party requests are the pinned MapLibre + PMTiles libraries
  from unpkg and the chosen basemap tiles (Esri / OSM).

### Requirements on the host

Apache with `mod_headers`, `mod_deflate`, `mod_expires` (all standard on
shared hosts). If a host strips `Accept-Ranges`, tiles won't stream — verify with:

```bash
curl -sI -H 'Range: bytes=0-99' https://yourdomain/trees/data/trees_map_points.pmtiles | grep -i -E '206|content-range|accept-ranges'
```

A `206 Partial Content` response confirms Range support is working.

## September 2026 interface and data update

The map now loads `observatory.css`, `map-analysis.js` and `alto-logo.png` beside
`index.html`. Deploy with the bundler so these assets are copied and versioned.
Controls use Explore, Layers and In view tabs; phone layouts open as a bottom
sheet. The summary describes drawn tree points, which are sampled at low zoom,
not complete area totals. Full-release totals live in About & data.

The downloadable dataset now contains 85 attributes, with classified LiDAR,
source provenance, corrected species reference heights and linked historic trajectories. To rebuild those exports:

```sh
python3 scripts/build_data_export.py
make build-web-deploy PY=python3
```

Use your geospatial environment's Python on another machine. The bundler checks
that the exports match the current database and that required assets exist.
It writes `bundle-manifest.json` with sizes/checksums. Current bundle size is about
2.7 GiB including the richer downloads. Upload its contents, including `.htaccess`.

Offline UI behavior checks: `node tests/test_map_ui.cjs`. The changes and methods
review are documented in `docs/alto_auckland_ui_data_review_2026-09-09.md`.

The September integrity repair is complete: mature-height units were corrected
against the original T7 species source and retired canonical links were audited
and removed. The change archive was rebuilt. Four unaffected archives have a
bounded hash/timestamp attestation; subsequent database writes invalidate it.
See the review for completed browser checks and the full Devonport handover.
