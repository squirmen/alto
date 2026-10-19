/* The aerial basemap: the "Hybrid" and "Satellite" maps, the tree page's map and the aerial figures.
 *
 * aerial    the site's aerial basemap: 'esri' (Esri World Imagery) or 'linz' (LINZ Basemaps aerial imagery).
 * channels  the basemap per build channel, where it differs (window.ALTO_CHANNEL, which site-config.js sets for each
 *           build: 'release' at the site root, 'beta' at /beta/). The beta channel is set to LINZ Basemaps; the public
 *           site keeps Esri.
 * linzApiKey  the key LINZ issues for alto.tfwelch.com. LINZ Basemaps answers no tile without a key (HTTP 400 "API Key
 *           Invalid: missing", checked 17 Oct 2026), so without one every channel stays on Esri.
 *
 * Use the permanent Developer access key LINZ issues on request (it does not expire and is locked to the site), never
 * the 90-day Standard key the LINZ Basemaps website allocates (meant for internal apps). docs/tool/linz-basemaps.md:
 * what to ask LINZ for, and the site's Content-Security-Policy (web/htaccess.example allows basemaps.linz.govt.nz). */
window.ALTO_BASEMAP_CONFIG = { aerial: 'esri', channels: { beta: 'linz' }, linzApiKey: '' };
