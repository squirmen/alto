/* Credits for the map layers, figures and records the tool shows, in one place, so the map, the panel and the tree
 * page name each source with the same words. credits.html ("Sources and credits") lists every source with its
 * licence and a link to the original.
 *
 * Wording follows each provider's own requirement (read 13 Oct 2026):
 *  - Esri: "Powered by Esri", with Esri linked to esri.com, and each basemap layer's own copyright text.
 *  - OpenStreetMap: "© OpenStreetMap contributors", linked to its copyright page.
 *  - LINZ: the short form for web maps, "Sourced from LINZ. CC BY 4.0", linked to LINZ's attribution guidance;
 *    the 2024 LiDAR's licensors as LINZ's metadata names them (Regional Software Holdings Limited for the Part 1 DEM
 *    and DSM and the Part 2 DEM; Auckland Council for the Part 2 DSM).
 *  - Department of Conservation: "Crown Copyright: Department of Conservation Te Papa Atawhai [year]".
 *  - Stats NZ: "Stats NZ – Tatauranga Aotearoa".
 *  - Auckland Council: the tree register with its retrieval date; the kauri survey records credited to the team the
 *    Council names, with the Council's caveat.
 *
 * Strings are HTML (MapLibre's attribution control and captions); text() gives the same words without markup.
 * The aerial basemap is Esri World Imagery unless basemap-config.js switches it to LINZ Basemaps for this build's
 * channel (window.ALTO_CHANNEL from site-config.js: 'release' or 'beta') and holds the key LINZ issued for the site. */
(function(root){
  'use strict';
  const CONFIG=Object.assign({aerial:'esri',channels:{},linzApiKey:''},root.ALTO_BASEMAP_CONFIG||{});
  // The build's channel (site-config.js); a page without one is the public site.
  const CHANNEL=/^[a-z]+$/.test(String(root.ALTO_CHANNEL||''))?String(root.ALTO_CHANNEL):'release';
  // The aerial basemap this channel asks for: its own entry in channels, else the site's.
  const AERIAL_WANTED=(CONFIG.channels&&typeof CONFIG.channels==='object'&&CONFIG.channels[CHANNEL])||CONFIG.aerial;
  const ext=(href,text)=>`<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const URLS={
    page:'./credits.html',
    esri:'https://www.esri.com',
    esriTerms:'https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf',
    osm:'https://www.openstreetmap.org/copyright',
    odbl:'https://opendatacommons.org/licenses/odbl/1-0/',
    ccby:'https://creativecommons.org/licenses/by/4.0/',
    linz:'https://www.linz.govt.nz/products-services/data/licensing-and-using-data/attributing-elevation-or-aerial-imagery-data',
    linzBasemaps:'https://basemaps.linz.govt.nz/',
    notable:'https://www.arcgis.com/home/item.html?id=583f5e99290b4adb9f7cc1196451f1e7',
    notableGroups:'https://www.arcgis.com/home/item.html?id=864f687d7d014aedb7e3dceaa797750e',
    schedule10:'https://unitaryplan.aucklandcouncil.govt.nz/images/Auckland%20Unitary%20Plan%20Operative/Chapter%20L%20Schedules/Schedule%2010%20Notable%20Trees%20Schedule.pdf',
    kauri:'https://www.arcgis.com/home/item.html?id=98eb8eb841ed4205a5e97f7bd0dbdf86',
    nzTreeRegister:'https://www.treeregister.nz/',
    nzTreeRegisterRecord:'https://www.treeregister.nz/tree/view/',
    plantnet:'https://my.plantnet.org/',
    itree:'https://database.itreetools.org/'
  };
  const OSM=`© ${ext(URLS.osm,'OpenStreetMap contributors')}`;
  const POWERED_BY_ESRI=`Powered by ${ext(URLS.esri,'Esri')}`;
  // Each Esri layer's copyrightText: World Imagery; World Light Gray Canvas base and reference, and World
  // Boundaries and Places (one text for all three).
  const ESRI_IMAGERY_SOURCE='Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community';
  const ESRI_CANVAS_SOURCE=`Esri, HERE, Garmin, ${OSM}, and the GIS user community`;
  const LINZ=ext(URLS.linz,'Sourced from LINZ. CC BY 4.0');
  const LIDAR_2024_LICENSORS='Regional Software Holdings Limited and Auckland Council';
  const DOC='Crown Copyright: Department of Conservation Te Papa Atawhai 2026';
  const STATS_NZ='Stats NZ – Tatauranga Aotearoa, CC BY 4.0';
  const REGISTER='Auckland Council tree register (incl. Auckland Transport), retrieved June 2026';
  const KAURI_TEAM='Bio Info Team, Environmental Services, Auckland Council';
  const KAURI_CAVEAT='Not a complete record; verify before relying on it.';
  const NZTR='New Zealand Tree Register, New Zealand Notable Trees Trust';
  const PLANTNET=`The image-based plant species identification service used, is based on the Pl@ntNet recognition API, regularly updated and accessible through the site ${ext(URLS.plantnet,'https://my.plantnet.org/')}`;
  // LINZ Basemaps' credit for its aerial imagery, always visible and linked (LINZ Basemaps guide).
  const LINZ_BASEMAPS=`© ${ext('https://www.linz.govt.nz/linz-copyright','LINZ CC BY 4.0')} © ${ext('https://www.linz.govt.nz/data/linz-data/linz-basemaps/data-attribution','Imagery Basemap contributors')}`;

  // The aerial basemap in use: Esri World Imagery, or LINZ Basemaps when the config switches it on for this channel
  // and holds a key (LINZ answers no tile without one).
  const linzKey=String(CONFIG.linzApiKey||'').trim();
  const LINZ_ON=AERIAL_WANTED==='linz'&&/^[\w-]{8,}$/.test(linzKey);
  const AERIAL=LINZ_ON?{
    provider:'linz',name:'LINZ Basemaps aerial imagery',
    tiles:`https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=${encodeURIComponent(linzKey)}`,
    attribution:LINZ_BASEMAPS
  }:{
    provider:'esri',name:'Esri World Imagery',
    tiles:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    // Esri's own attribution feed names Auckland Council for its imagery at Auckland's zooms.
    attribution:`${POWERED_BY_ESRI} · ${ESRI_IMAGERY_SOURCE}; in Auckland, Auckland Council imagery`
  };

  const MAP={
    // Basemaps. The labels drawn over the imagery and the Light map's reference layer carry Esri's text without
    // "Powered by Esri", which the base layer's credit already shows.
    aerial:AERIAL.attribution,
    esriLabels:ESRI_CANVAS_SOURCE,
    esriLight:`${POWERED_BY_ESRI} · ${ESRI_CANVAS_SOURCE}`,
    osm:OSM,
    // The tree, crown and parcel tiles (one string, so the control shows it once).
    data:`Trees: Auckland Council (tree register incl. Auckland Transport, retrieved June 2026; notable trees; kauri survey `+
      `records, Bio Info Team, Environmental Services); ${OSM}, ODbL. Crowns and parcels: ${LINZ}; 2024 LiDAR licensed by `+
      `${LIDAR_2024_LICENSORS}. ${DOC}.`,
    // Overlays ALTO derives from the LiDAR surveys.
    lidar2024:`ALTO, from the Auckland 2024 LiDAR survey (licensed by ${LIDAR_2024_LICENSORS}; ${LINZ})`,
    change:`ALTO, from the Auckland 2013, 2016–18 and 2024 LiDAR surveys (licensed by Auckland Council and Regional Software Holdings Limited; ${LINZ})`,
    boards:`Canopy cover: ALTO, from the Auckland 2024 LiDAR survey and 2024–25 aerial imagery (licensed by ${LIDAR_2024_LICENSORS}; ${LINZ}); local boards and land areas: ${STATS_NZ}`,
    kauri:`Kauri survey records: ${ext(URLS.kauri,'Ruru ObsKauri Tiaki')}, ${KAURI_TEAM}. ${KAURI_CAVEAT}`,
    // Notable Group of Trees areas (release 6.3 map layer): Council's overlay, as its licence asks.
    groupAreas:`Notable Group of Trees areas: ${ext(URLS.notableGroups,'Notable Group of Trees Overlay')}, Plans and Places, Auckland Council; ${ext(URLS.ccby,'CC BY 4.0')}`,
    // Shown once at the end of the map's attribution.
    page:`<a href="${URLS.page}">Sources and credits</a>`
  };

  // A MapLibre raster source for the aerial basemap.
  function aerialSource(extra={}){return {type:'raster',tiles:[AERIAL.tiles],tileSize:256,attribution:AERIAL.attribution,...extra};}
  // The credit under an aerial figure (the chip on the panel and the tree page).
  function aerialFigure(){return LINZ_ON?`${AERIAL.name}: ${LINZ_BASEMAPS}.`:`${POWERED_BY_ESRI}. ${ESRI_IMAGERY_SOURCE}.`;}

  // A record's dataset as the tree page and the panel credit it: the provider's credit, its licence and links to
  // the dataset's own page (the tree register's public service now needs a token, so it has none).
  const DATASETS={
    tree_register_points:{text:REGISTER,links:[]},
    notable_trees_overlay:{text:'Notable Trees Overlay, Plans and Places, Auckland Council; CC BY 4.0',links:[{text:'Dataset',href:URLS.notable},{text:'Schedule 10',href:URLS.schedule10}]},
    notable_group:{text:'Notable Group of Trees Overlay, Plans and Places, Auckland Council; CC BY 4.0',links:[{text:'Dataset',href:URLS.notableGroups},{text:'Schedule 10',href:URLS.schedule10}]},
    ruru_obskauri_tiaki_public:{text:`Ruru ObsKauri Tiaki (valid and public), ${KAURI_TEAM}. ${KAURI_CAVEAT}`,links:[{text:'Dataset',href:URLS.kauri}]},
    osm_natural_tree:{text:'© OpenStreetMap contributors, ODbL',links:[{text:'Copyright and licence',href:URLS.osm}]},
    nz_tree_register:{text:NZTR,links:[{text:'Register',href:URLS.nzTreeRegister}]}
  };
  const dataset=key=>DATASETS[key]||null;

  // New Zealand Tree Register records named in a text ("AR/0177", groups "AR/G0905") and their pages.
  function registerRecords(...texts){
    const seen=new Map();
    for(const t of texts.flat())for(const m of String(t??'').matchAll(/\b(AR)\/(G?)(\d{1,5})\b/g)){
      const code=`${m[1]}/${m[2]}${m[3]}`;if(!seen.has(code))seen.set(code,{code,href:URLS.nzTreeRegisterRecord+Number(m[3])});
    }
    return [...seen.values()];
  }

  const text=html=>String(html??'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  const api={CONFIG,CHANNEL,AERIAL_WANTED,URLS,MAP,AERIAL,LINZ_ON,OSM,POWERED_BY_ESRI,ESRI_IMAGERY_SOURCE,ESRI_CANVAS_SOURCE,LINZ,LIDAR_2024_LICENSORS,DOC,STATS_NZ,
    REGISTER,KAURI_TEAM,KAURI_CAVEAT,NZTR,PLANTNET,LINZ_BASEMAPS,aerialSource,aerialFigure,dataset,registerRecords,text};
  root.ALTOCredits=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
