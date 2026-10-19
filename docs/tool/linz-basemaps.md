# LINZ Basemaps aerial imagery

`web/basemap-config.js` can replace Esri World Imagery with LINZ Basemaps aerial imagery in the "Hybrid" and
"Satellite" maps, the tree page's map and the aerial figures on the panel and the tree page. From tool 0.2.11 the
switch is per build channel: the beta channel (`/beta/`) is set to LINZ Basemaps and the public site keeps Esri. It
stays off until the config holds a key LINZ has issued for the site, because LINZ answers no tile without one. The
"Light" default map and the labels over "Hybrid" stay on Esri.

## Can the tiles be read without a key? No (checked 17 October 2026)

- A tile request without a key is refused: `https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/17/129147/80276.webp`
  answers HTTP 400 `{"message":"API Key Invalid: missing"}`. Every URL template in LINZ's API guide carries
  `api={api_key}`, "Insert your allocated API key".
- "Standard access" needs no registration, but it is still a key: "A dynamic API key is allocated to you", and
  "Standard API keys expire after 90 days" (LINZ Basemaps technical documentation). Limits: "1,000 tiles / minute and
  1,000,000 tiles / month" (terms of use). LINZ describes it as "designed for use of our APIs in internal GIS
  applications or web mapping tools" and "best suited for use of our APIs in internal apps".
- "Developer access" is the level for a public site: "to support integration of our APIs in public, high-volume web
  and mobile apps"; "Developer keys do not expire"; "Static API keys are issued to restrict use by others", locked to a
  nominated website; unlimited reasonable use. Neither level is charged for.
- Terms: "We track use of our APIs and may restrict use outside the current limits or any other unreasonable use."
  Licence: the basemaps are "licensed for reuse under the Creative Commons 4.0 International licence".

Sources: <https://www.linz.govt.nz/guidance/data-service/linz-basemaps-guide/linz-basemaps-terms-use>,
<https://www.linz.govt.nz/guidance/data-service/linz-basemaps-guide/linz-basemaps-documentation>,
<https://www.linz.govt.nz/guidance/data-service/linz-basemaps-guide/how-use-linz-basemaps-apis>,
<https://basemaps.linz.govt.nz/docs/user-guide/technical-documentation/>, and the request link in LINZ's own site
(`linz/basemaps`, `packages/landing/src/components/layout.header.tsx`).

## What to request

Developer access, locked to `https://alto.tfwelch.com` (it covers `/beta/`). Do not use a Standard key from the
LINZ Basemaps website: it is meant for internal apps and stops working after 90 days.

Email **basemaps@linz.govt.nz** with the subject **Request Basemaps Developer Access** and the three fields the
request link on the LINZ Basemaps website fills in:

```
Your Name: Tim Welch, Better Places Lab, Waipapa Taumata Rau | University of Auckland
Your Email: t.welch@auckland.ac.nz
Your Service/App URL: https://alto.tfwelch.com (and https://alto.tfwelch.com/kyte/ if KYTE should use it)
```

Useful to add: ALTO is a free, noncommercial public map of Auckland's trees; the key would serve the aerial basemap
on the beta site first and then the public site, mostly at street-tree zooms (17–21); please lock it to
alto.tfwelch.com. LINZ replies with the site's key.

## Switching it on

1. `web/basemap-config.js`: put the key in `linzApiKey`. The beta channel (`channels: { beta: 'linz' }`) switches at
   once; the public site follows when `aerial` is also set to `'linz'`.
2. The site's Content-Security-Policy (live `.htaccess`; `web/htaccess.example` already has it from tool 0.2.11):
   `https://basemaps.linz.govt.nz` in `connect-src` (the map's tiles, fetched by MapLibre) and `img-src` (the aerial
   figures' tiles, in `<img>`). The live root `.htaccess` also governs `/beta/`, so it must carry both additions
   before the beta channel is switched on.
3. Sources and credits needs no edit: `credits.html` shows the LINZ Basemaps entry in place of Esri World Imagery
   wherever the build uses LINZ (`credits-page.js`).
4. Build, then check on `/beta/`: "Satellite" shows LINZ imagery; the map's attribution reads
   "© LINZ CC BY 4.0 © Imagery Basemap contributors" with both parts linked; the aerial figures' captions name
   LINZ Basemaps; the browser makes no World_Imagery requests to `server.arcgisonline.com`; the root site still shows
   Esri. `pipeline/tool/test_credits.cjs` checks the switch per channel with a test key.

What changes with it on: Esri's capture-date lookup is not used, so aerial captions name the basemap but no capture
date. LINZ serves an attribution list for the imagery at `/v1/tiles/aerial/WebMercatorQuad/attribution.json?api=<key>`
(not used yet). A browser key is visible in the page source; the Developer key's site lock is what protects it.

## KYTE

KYTE's two maps (`app/app.js` in the KYTE repository, from branch `credits-2026-10`) read the same switch from
`kyte/config.js`: add `"aerial": "linz", "linzApiKey": "<key>"` to `window.KYTE_CONFIG`, leaving the build stamp as
it is, and add `https://basemaps.linz.govt.nz` to `img-src` in KYTE's `.htaccess`. Without both keys KYTE stays on
Esri. Ask LINZ for the key to cover `https://alto.tfwelch.com/kyte/` too.

## Reference

- Tiles: `https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=<key>`, 256-pixel
  tiles, zoom 0–22 (webp; png, jpeg and avif are also served). `web/credits.js` builds this URL from the config.
- Credit, always visible and linked, in LINZ's own words (its Leaflet example):
  `© <a href="https://www.linz.govt.nz/linz-copyright">LINZ CC BY 4.0</a> © <a href="https://www.linz.govt.nz/data/linz-data/linz-basemaps/data-attribution">Imagery Basemap contributors</a>`
- Attribution rule: "Your product must always visibly show attribution and link to the LINZ Basemap custom
  attribution data and copyright text" (technical documentation); "Mapping libraries like Leaflet and OpenLayers do
  not do this for you automatically, so you must add it yourself" (API guide).
