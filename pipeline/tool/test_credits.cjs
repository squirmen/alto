// Offline checks for the credits (tool 0.2.7): every source named in its provider's own words wherever ALTO shows
// it, and Sources and credits (web/credits.html) on the methods template, linked from the map, the tree page, every
// methods page and the changelog. Wording read from the providers on 13 Oct 2026.
// Usage: node pipeline/tool/test_credits.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');
const C=require(web+'credits.js');
const ESRI_LINK='Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>';
const OSM_LINK='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

// ---- credits.js: basemaps
assert.equal(C.AERIAL.provider,'esri','the aerial basemap is Esri World Imagery by default');
assert.ok(C.MAP.aerial.startsWith(ESRI_LINK)&&C.MAP.aerial.includes('Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'),'World Imagery: Powered by Esri and its copyright text');
assert.ok(C.MAP.esriLight.startsWith(ESRI_LINK)&&C.MAP.esriLight.includes(`Esri, HERE, Garmin, ${OSM_LINK}, and the GIS user community`),'Light Gray Canvas: Powered by Esri and its copyright text');
assert.ok(C.MAP.esriLight.includes(C.MAP.esriLabels),'the reference layer credit is part of the base credit, so the control shows it once');
assert.ok(!/Powered by/.test(C.MAP.esriLabels),'"Powered by Esri" shows once per map');
assert.equal(C.MAP.osm,OSM_LINK,'OpenStreetMap: linked credit');
assert.ok(/Esri World Imagery/.test(C.text(C.aerialFigure()))===false&&C.aerialFigure().startsWith(ESRI_LINK),'aerial figures carry Powered by Esri');
// ---- credits.js: data and overlays
const text=C.text;
assert.ok(text(C.MAP.lidar2024).includes('Auckland 2024 LiDAR survey (licensed by Regional Software Holdings Limited and Auckland Council; Sourced from LINZ. CC BY 4.0)'));
assert.ok(C.MAP.lidar2024.includes('href="https://www.linz.govt.nz/products-services/data/licensing-and-using-data/attributing-elevation-or-aerial-imagery-data"'),'LINZ short form links LINZ guidance');
assert.ok(text(C.MAP.change).includes('2013, 2016–18 and 2024 LiDAR surveys'));
assert.ok(text(C.MAP.boards).includes('Stats NZ – Tatauranga Aotearoa, CC BY 4.0'),'local boards credited to Stats NZ');
assert.ok(text(C.MAP.kauri).includes('Bio Info Team, Environmental Services, Auckland Council')&&text(C.MAP.kauri).includes('Not a complete record; verify before relying on it.'),'kauri: the team the Council names, and its caveat');
assert.ok(C.MAP.kauri.includes('https://www.arcgis.com/home/item.html?id=98eb8eb841ed4205a5e97f7bd0dbdf86'),'kauri: item page');
assert.equal(C.MAP.page,'<a href="./credits.html">Sources and credits</a>');
assert.ok(text(C.MAP.data).includes('Crown Copyright: Department of Conservation Te Papa Atawhai 2026'),'DOC Crown copyright');
// Records: each dataset's credit and page.
assert.deepEqual(C.dataset('tree_register_points'),{text:'Auckland Council tree register (incl. Auckland Transport), retrieved June 2026',links:[]});
assert.ok(C.dataset('notable_trees_overlay').links.some(l=>/Schedule%2010/.test(l.href))&&C.dataset('notable_trees_overlay').text.includes('Plans and Places, Auckland Council; CC BY 4.0'));
assert.ok(C.dataset('notable_group').links[0].href.endsWith('864f687d7d014aedb7e3dceaa797750e'));
assert.ok(C.dataset('ruru_obskauri_tiaki_public').text.includes('Not a complete record; verify before relying on it.'));
assert.equal(C.dataset('osm_natural_tree').text,'© OpenStreetMap contributors, ODbL');
assert.equal(C.dataset('lidar_pointcloud_v5'),null);
assert.deepEqual(C.dataset('nz_tree_register'),{text:'New Zealand Tree Register, New Zealand Notable Trees Trust',links:[{text:'Register',href:'https://www.treeregister.nz/'}]});
{const T=require(web+'tree-summary.js');assert.equal(T.sourceHref('nz_tree_register','AR/0591'),'https://www.treeregister.nz/tree/view/591','a register record links its own page');}
// New Zealand Tree Register records named in a text, each linked to its own page.
assert.deepEqual(C.registerRecords('NZ Tree Register AR/0177 is ALTO akl_tree_x; see AR/0177 and group AR/G0905',['AR/0811']),
  [{code:'AR/0177',href:'https://www.treeregister.nz/tree/view/177'},{code:'AR/G0905',href:'https://www.treeregister.nz/tree/view/905'},{code:'AR/0811',href:'https://www.treeregister.nz/tree/view/811'}]);
assert.deepEqual(C.registerRecords(null,'BAR/12 FAR/0001x'),[]);
assert.ok(text(C.PLANTNET)==='The image-based plant species identification service used, is based on the Pl@ntNet recognition API, regularly updated and accessible through the site https://my.plantnet.org/','Pl@ntNet acknowledgement, word for word');

// ---- the LINZ Basemaps switch (tool 0.2.11): per channel. The beta channel is set to LINZ Basemaps, the public site
// keeps Esri; LINZ answers no tile without a key, so with none (as shipped) every channel stays on Esri.
const cfg=read('basemap-config.js');
assert.match(cfg,/window\.ALTO_BASEMAP_CONFIG = \{ aerial: 'esri', channels: \{ beta: 'linz' \}, linzApiKey: '' \};/,'basemap-config.js: Esri, LINZ on beta, no key');
const load=(config,channel)=>{const ctx={ALTO_BASEMAP_CONFIG:config,ALTO_CHANNEL:channel};vm.createContext(ctx);vm.runInContext(read('credits.js'),ctx);return ctx.ALTOCredits;};
const shipped=new Function('window',`${cfg};return window.ALTO_BASEMAP_CONFIG;`)({});
for(const ch of ['release','beta',undefined])assert.equal(load(shipped,ch).AERIAL.provider,'esri',`as shipped (no key), ${ch||'no'} channel: Esri`);
assert.equal(load(shipped,'beta').AERIAL_WANTED,'linz','the beta channel asks for LINZ Basemaps');
const keyed={...shipped,linzApiKey:'test-key-abc123'};
const linz=load(keyed,'beta');
assert.deepEqual([linz.CHANNEL,linz.AERIAL.provider,linz.LINZ_ON],['beta','linz',true],'with a key: LINZ Basemaps on the beta channel');
assert.deepEqual(['release',undefined,'Beta','beta;'].map(ch=>load(keyed,ch).AERIAL.provider),['esri','esri','esri','esri'],'with a key: the public site (and any other channel) keeps Esri');
assert.equal(linz.aerialSource().tiles[0],'https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=test-key-abc123');
assert.equal(text(linz.MAP.aerial),'© LINZ CC BY 4.0 © Imagery Basemap contributors');
assert.ok(linz.MAP.aerial.includes('https://www.linz.govt.nz/linz-copyright')&&linz.MAP.aerial.includes('https://www.linz.govt.nz/data/linz-data/linz-basemaps/data-attribution'));
assert.equal(text(linz.aerialFigure()),'LINZ Basemaps aerial imagery: © LINZ CC BY 4.0 © Imagery Basemap contributors.');
assert.equal(load({aerial:'linz',linzApiKey:''}).AERIAL.provider,'esri','no key: the map stays on Esri');
assert.equal(load({aerial:'linz',linzApiKey:'test-key-abc123'},'release').AERIAL.provider,'linz','aerial: linz switches the public site too');
// The public site's credit stays Esri's, as corrected in 0.2.7.
assert.equal(text(load(keyed,'release').MAP.aerial),'Powered by Esri · Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community; in Auckland, Auckland Council imagery');
// Every aerial figure and map takes its tiles from this one switch.
{const viz=read('alto-viz.js'),ms=read('map-sources.js');
  assert.ok(viz.includes('const aerialTiles=()=>root.ALTOCredits?.AERIAL?.tiles||null;')&&ms.includes('CR.aerialSource?CR.aerialSource(extra)'));}
// Sources and credits names the aerial basemap the build shows (credits-page.js; Esri without scripts).
{const cr=read('credits.html'),cp=read('credits-page.js');
  assert.ok(/<li data-aerial="esri"><strong>Esri World Imagery<\/strong>/.test(cr)&&/<li data-aerial="linz" hidden><strong>LINZ Basemaps aerial imagery<\/strong>[^<]*: © <a href="https:\/\/www\.linz\.govt\.nz\/linz-copyright">LINZ CC BY 4\.0<\/a> © <a href="https:\/\/www\.linz\.govt\.nz\/data\/linz-data\/linz-basemaps\/data-attribution">Imagery Basemap contributors<\/a>/.test(cr));
  assert.ok(cr.includes('<li><strong>Esri World Boundaries and Places</strong> (the labels over “Hybrid”)'),'the Hybrid labels stay credited to Esri');
  const order=['site-config.js','basemap-config.js','credits.js','credits-page.js'].map(f=>cr.indexOf(`<script src="./${f}?v=`));
  assert.ok(order.every((i,k)=>i>0&&(!k||i>order[k-1])),'credits.html: settings, config, credits, then the page script');
  const page=(provider)=>{const lis=[{dataset:{aerial:'esri'},hidden:false},{dataset:{aerial:'linz'},hidden:true}];
    const ctx={ALTOCredits:{AERIAL:{provider}},document:{querySelectorAll:()=>lis}};vm.createContext(ctx);vm.runInContext(cp,ctx);return lis.map(l=>l.hidden);};
  assert.deepEqual(page('linz'),[true,false]);assert.deepEqual(page('esri'),[false,true]);}

// ---- the map
const page=(read('index.html')+read('map-app.js'));
const order=['basemap-config.js','credits.js','sources.js'].map(f=>page.indexOf(`src="./${f}?v=`));
assert.ok(order.every(i=>i>0)&&order[0]<order[1]&&order[1]<order[2]&&order[2]<page.indexOf('const DATA_CREDIT'),'config, then credits, before the map script');
// The basemaps come from the map's source factory (map-sources.js, FE-16), shared with the tree page's inset map.
{const MS=require('../../web/map-sources.js'),bm=MS.create({dataBase:'./data',version:'x',credits:{MAP:{osm:'OSM'}}}).basemaps();
  const osm=[bm.streets.sources.osm,bm.light.sources['osm-street-names']];
  assert.ok(!/[abc]\.tile\.openstreetmap\.org/.test(page+read('map-sources.js'))&&osm.every(s=>s.tiles.length===1&&s.tiles[0]==='https://tile.openstreetmap.org/{z}/{x}/{y}.png'&&s.attribution==='OSM'),'one OpenStreetMap tile host');}
assert.ok(!/Tiles &copy; Esri|Imagery © Esri/.test(page),'no bare Esri credit');
{const MS=require('../../web/map-sources.js'),cr={aerialSource:(e={})=>({type:'raster',tiles:['CONFIGURED'],attribution:'AERIAL',...e}),MAP:{}};
  const bm=MS.create({credits:cr}).basemaps(),mini=MS.create({credits:cr}).raster.aerial({maxzoom:20});
  assert.ok(page.includes('const basemaps = MAP_SOURCES.basemaps();')&&['hybrid','satellite'].every(k=>bm[k].sources['esri-imagery'].tiles[0]==='CONFIGURED'&&bm[k].sources['esri-imagery'].attribution==='AERIAL')
    &&mini.tiles[0]==='CONFIGURED'&&mini.maxzoom===20,'Hybrid, Satellite and the tree page map use the configured aerial basemap');}
for(const [src,credit] of [['akl-near-canopy','lidar2024'],['akl-low-canopy','lidar2024'],['akl-change','change'],['akl-rootshape','lidar2024'],['akl-canopy','boards'],['akl-kauri','kauri']])
  assert.ok(new RegExp(`"${src}":[^\\n]*ALTOCredits\\.MAP\\.${credit}`).test(page),`${src} credits ${credit}`);
assert.ok(page.includes('customAttribution: ALTOCredits.MAP.page'),'the attribution control links Sources and credits');
assert.ok(page.includes('<h3>Sources and credits</h3>')&&page.includes('Te Pare</span> School of Architecture and Planning, <span lang="mi">Waipapa Taumata Rau</span> | University of Auckland'),'About: lab and university');
assert.ok(/About[\s\S]*Regional Software Holdings Limited[\s\S]*retrieved June 2026|retrieved June 2026[\s\S]*Regional Software Holdings Limited/.test(page),'About names the register retrieval date and the LiDAR licensor');
assert.ok(page.includes('Kauri dieback surveillance<small>Auckland Council kauri survey records (Ruru ObsKauri Tiaki). Not a complete record; verify before relying on it.</small>'),'kauri overlay: source and caveat');

// ---- the tree page
const tree=read('tree.html'),tp=read('tree-page.js');
assert.ok(tree.indexOf('src="./credits.js?v=')>0&&tree.indexOf('src="./credits.js?v=')<tree.indexOf('src="./tree-record.js?v='),'tree page loads credits.js first');
assert.ok(/<footer[\s\S]*<a href="\.\/credits\.html">Sources and credits<\/a>[\s\S]*<\/footer>/.test(tree),'tree page footer links Sources and credits');
assert.ok(tp.includes("imagery:MS.raster.aerial({maxzoom:20})")&&tp.includes('attribution:CR.MAP?.data')&&tp.includes('customAttribution:CR.MAP?.page'),'tree page map: the map credits');
assert.ok(tp.includes("New Zealand Tree Register record ${z.code}")&&tp.includes('New Zealand Notable Trees Trust. Register recognition has no legal status.'),'register records linked and credited');
assert.ok(tp.includes("link(PLANTNET,'Pl@ntNet')")&&tp.includes("link(ITREE,'i-Tree')"),'Pl@ntNet and i-Tree linked');
assert.ok(/<p class="ti-cap ti-credits">Sources: /.test(tp),'records module credits each dataset');
const ground=read('tree-ground.js');
assert.ok(ground.includes('The image-based plant species identification service used, is based on the <a href="https://plantnet.org/" target="_blank" rel="noopener">Pl@ntNet</a> recognition API, regularly updated and accessible through the site <a href="https://my.plantnet.org/" target="_blank" rel="noopener">https://my.plantnet.org/</a>.'),'tree page: Pl@ntNet acknowledgement');
assert.ok(ground.includes('Photographs: KYTE contributors, shared with ALTO for this page'),'KYTE photographs credited');
const X=require(web+'tree-imagery.js');
const att=X.attribution(X.SURVEYS.slice(-1));
assert.ok(att.includes('New Zealand Imagery accessed on ')&&att.includes('href="https://registry.opendata.aws/nz-imagery/"')&&att.includes('Cropped and resampled by ALTO'),'imagery: access date, archive and changes');
assert.ok(X.accessed(new Date('2026-10-12T00:00:00Z')).includes('12 Oct 2026'));
const I=require(web+'tree-instrument.js');
assert.equal(I.imageryText({source:'Auckland Council 2024',date:'31 Jan 2024',resolution:0.075}),'Aerial imagery: Auckland Council 2024, 31 Jan 2024 (7.5 cm), via Esri World Imagery');
for(const f of ['tree-model.js','tree-webgl.mjs'])assert.ok(read(f).includes("copyright:'ALTO, Better Places Lab, Waipapa Taumata Rau | University of Auckland. Contains data sourced from LINZ, licensed by Regional Software Holdings Limited and Auckland Council for re-use under CC BY 4.0.'"),`${f}: 3D model copyright`);

// ---- sources panel and records
const S=require(web+'sources.js');
assert.ok(S.source('osm').note.includes('© OpenStreetMap contributors, ODbL'),'OpenStreetMap source line: ODbL');
for(const k of ['register_parks','register_at','register_other'])assert.ok(S.source(k).note.includes('Retrieved June 2026'),`${k}: retrieval date`);
assert.equal(S.source('kauri').label,'Ruru kauri survey (Auckland Council)');
assert.ok(S.source('kauri').note.includes('Bio Info Team, Environmental Services, Auckland Council')&&S.source('kauri').note.includes('Not a complete record; verify before relying on it.'));
assert.ok(!/RŪRU/.test(['sources.js','palette.js','record-links.js','tree-summary.js','area.js','v52-methods.html'].map(read).join('')),'the Council title is Ruru, without macrons');

// ---- methods pages, changelog and the build
for(const f of ['v5-methods.html','v51-methods.html','v52-methods.html','v6-methods.html','v61-methods.html','v62-methods.html','v63-methods.html']){
  const h=read(f);
  assert.ok(/<p class="credit">[\s\S]*?<a href="\.\/credits\.html">Sources and credits<\/a>[\s\S]*?<\/p>/.test(h),`${f}: footer links Sources and credits`);
  assert.ok(h.includes('Waipapa Taumata Rau</span> | University of Auckland'),`${f}: university named with the bar`);
}
const v6=read('v6-methods.html');
for(const s of ['DINOv2 embeddings (Meta; Apache License 2.0)','LightGBM (Microsoft; MIT licence)','DeepForest (Weecology; MIT licence)','torchvision (BSD 3-Clause)','doi:10.15468/ab3s5x','each under its observer’s licence'])assert.ok(v6.includes(s),'v6 methods: '+s);
const build=fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8');
assert.ok(build.includes("CREDITS_PAGE = 'credits.html'")&&/p = out \/ CREDITS_PAGE\n\s+p\.write_text\(site_links\(stamp_assets\(p\.read_text\(\), stamp\), root\)\)/.test(build),'every build ships credits.html with the build stamp');
assert.ok(!/SKIP = \{[^}]*credits\.html/.test(build),'credits.html is not skipped in the beta build');
assert.ok(build.includes(`p.write_text(p.read_text().replace(f'"./site-config.js?v={stamp}"', f'"./site-config.js?v={config_stamp}"'))`),'credits.html reads the build\'s site settings');
assert.ok(build.includes(`'<p><a href="./credits.html">Sources and credits</a> · <a href="./">ALTO map</a></p></body></html>\\n'`),'changelog and versioning pages link Sources and credits');
const ht=read('htaccess.example');
assert.ok(!ht.includes('*.tile.openstreetmap.org')&&(ht.match(/https:\/\/tile\.openstreetmap\.org/g)||[]).length===2,'CSP: tile.openstreetmap.org in connect-src and img-src');
{const csp=/Header always set Content-Security-Policy "([^"]+)"/.exec(ht)[1],d=Object.fromEntries(csp.split(';').map(x=>x.trim().split(/\s+/)).filter(x=>x[0]).map(([k,...v])=>[k,v]));
  assert.ok(d['connect-src'].includes('https://basemaps.linz.govt.nz')&&d['img-src'].includes('https://basemaps.linz.govt.nz'),'CSP: LINZ Basemaps in connect-src (map tiles) and img-src (aerial figures)');
  assert.ok(!csp.includes('*.linz.govt.nz')&&(csp.match(/basemaps\.linz\.govt\.nz/g)||[]).length===2,'CSP: that host only, twice');}

// ---- Sources and credits
const cr=read('credits.html');
assert.ok(cr.includes('href="./methods.css?v=')&&cr.includes('href="./tokens.css?v=')&&cr.includes('<main id="main" class="doc"'),'credits.html: on the methods template');
assert.ok(cr.includes('<title>Sources and credits · ALTO</title>')&&cr.includes('<h1>Sources and credits</h1>'));
for(const id of ['changes','tree-records','lidar','aerial','street-level','basemaps','land','models','software','alto'])assert.ok(cr.includes(`<section id="${id}"`)&&cr.includes(`href="#${id}"`),`credits.html: section ${id} in the contents`);
for(const id of [...cr.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]))assert.equal(cr.split(` id="${id}"`).length,2,`credits.html: id ${id} once`);
for(const s of [
  'Auckland Council tree register (incl. Auckland Transport), retrieved June 2026',
  'Bio Info Team, Environmental Services, Auckland Council','https://www.arcgis.com/home/item.html?id=98eb8eb841ed4205a5e97f7bd0dbdf86','verify before relying on it',
  'https://www.arcgis.com/home/item.html?id=583f5e99290b4adb9f7cc1196451f1e7','https://www.arcgis.com/home/item.html?id=864f687d7d014aedb7e3dceaa797750e','Schedule%2010%20Notable%20Trees%20Schedule.pdf',
  'href="https://www.openstreetmap.org/copyright"','href="https://opendatacommons.org/licenses/odbl/1-0/"','stay under the ODbL',
  'New Zealand Notable Trees Trust','links to that record on the register','does not copy the register’s text or photographs',
  'licensed by Regional Software Holdings Limited (Part 1 DEM and DSM, Part 2 DEM) and Auckland Council (Part 2 DSM) for re-use under the Creative Commons Attribution 4.0 International licence',
  'Copyright in the underlying dataset from which this work has been derived is owned by Auckland Council',
  'https://registry.opendata.aws/nz-imagery','Powered by <a href="https://www.esri.com">Esri</a>','Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
  'tile usage policy','Crown Copyright: Department of Conservation <span lang="mi">Te Papa Atawhai</span> 2026','2 October 2026; it may be out of date',
  'Stats NZ – <span lang="mi">Tatauranga Aotearoa</span>','https://database.itreetools.org/','i-Tree® is a registered trademark','Nowak, D. J. (2024)',
  'The benefit values are an ALTO benefit scenario: simplified equations adapted from published i-Tree Eco components, with ALTO’s own unit values; not run in i-Tree Eco.',
  'DINOv2</strong> (Meta; Apache License 2.0)','LightGBM</strong> (Microsoft; MIT licence)','DeepForest</strong> (Weecology, University of Florida; MIT licence)',
  'https://doi.org/10.15468/ab3s5x','accessed via GBIF.org on 2026-10-02',
  'The image-based plant species identification service used, is based on the Pl@ntNet recognition API, regularly updated and accessible through the site <a href="https://my.plantnet.org/">https://my.plantnet.org/</a>',
  'MapLibre GL JS 4.7.1 (BSD 3-Clause)','Leaflet 1.9.4 (BSD 2-Clause)','PolyForm Noncommercial 1.0.0','t.welch@auckland.ac.nz'])assert.ok(cr.includes(s),'credits.html: '+s);
const body=cr.replace(/<head>[\s\S]*?<\/head>/,'').replace(/<[^>]+>/g,' ');
assert.ok(!/\bAI\b/.test(body),'credits.html: no "AI"');
assert.ok(!/\b(\w+), not (a|an|the)?\s*\w+/i.test(body),'credits.html: no "X, not Y" phrasing');
assert.ok(!/#[0-9a-f]{6}\b/i.test(cr.replace(/<head>[\s\S]*?<\/head>/,'')),'credits.html: no colour literals');
assert.ok(/<p class="credit">[\s\S]*?<a href="\.\/credits\.html" aria-current="page">Sources and credits<\/a>/.test(cr),'credits.html: its own footer link is the current page');
console.log('credits: basemaps, data and overlay credits, the LINZ Basemaps switch, register links, the map, tree and methods pages, the build and Sources and credits checked');
