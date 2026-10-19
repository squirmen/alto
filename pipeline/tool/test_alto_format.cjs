// Offline checks for the shared formatters (web/alto-format.js) and the shared map sources (web/map-sources.js), FE-16:
// the design system's precision per quantity (4.7), the en dash for a missing value (2.8), one rule set used by the
// panel, the tree page, Area and property, one benefits range and one carbon figure per tree, and one source factory
// (basemaps, versioned PMTiles URLs) for the map and the tree page's inset map.
// Usage: node pipeline/tool/test_alto_format.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');
globalThis.window=globalThis;
const F=require(web+'alto-format.js');

// 1. Precision follows the method (design system 4.7).
assert.equal(F.MISSING,'–','a missing value is an en dash');
assert.equal(F.quantityText('height',16.94),'16.9 m');assert.equal(F.quantityText('height',7),'7.0 m','0.1 m, never "7 m"');
assert.equal(F.quantityText('crownArea',316.4),'316 m²');assert.equal(F.quantityText('crownArea',4.53),'4.5 m²','under 10 m²: 0.1');
assert.equal(F.quantityText('crownDiameter',19.6),'20 m');
assert.equal(F.quantityText('trunkDiameter',37.2),'37 cm');assert.equal(F.quantityText('trunkDiameter',36.4,{measuredTape:true}),'36.4 cm','a tape measure as measured');
assert.equal(F.quantityText('benefits',537.9),'$540/yr','one tree: 2 significant figures');
assert.equal(F.money(118234.6,{total:true}),'$118,000','an area total: 3 significant figures');
assert.equal(F.money(62.453,{total:true}),'$62','from $10 never finer than the dollar (not "$62.5" read as "$63")');
assert.equal(F.money(4.56),'$4.60','under $10 in cents');
assert.equal(F.money(null),'–');
assert.equal(F.co2(1.165),'1.2 t CO₂e');assert.equal(F.co2(2.98),'3.0 t CO₂e');assert.equal(F.co2(0.55),'550 kg CO₂e');assert.equal(F.co2(28.4),'28 t CO₂e');
assert.equal(F.co2(1.2,{unit:false}),'1.2 t');assert.equal(F.co2Rate(0.4253),'430 kg CO₂e/yr');
assert.equal(F.volume(21.7),'22 m³/yr');assert.equal(F.pct(22.4),'22%');assert.equal(F.count(13154),'13,154');
assert.equal(F.land(294.6),'295 m²');assert.equal(F.land(12500),'1.25 ha');assert.deepEqual(F.viewArea(11000),['1.1','ha']);assert.deepEqual(F.viewArea(1964),['1,964','m²'],'m² below a hectare');assert.deepEqual(F.viewArea(1234567),['123','ha']);
assert.equal(F.co2(0.005,{total:true}),'5 kg CO₂e','a total: no trailing zeros');assert.equal(F.volume(5.435,{total:true}),'5.44 m³/yr');assert.equal(F.co2(2.98),'3.0 t CO₂e','one tree: two figures, kept');
assert.equal(F.about(295123456,{prefix:'NZ$'}),'about NZ$295 million');
assert.equal(F.range('benefits',376.5,699.3),'$380–$700/yr');assert.equal(F.range('trunkDiameter',36.2,38.3),'36–38 cm','unit once');
assert.equal(F.range('benefits',330,331),null,'no zero-width ranges');

// 2. One rule set: the panel, the tree page, Area and property format through ALTOFormat, with no formatter of their own.
for(const f of ['tree-instrument.js','tree-record.js','alto-viz.js','tree-panel.js','tree-summary.js','tree-ground.js','area.js','property.js']){
  const src=read(f);
  assert.ok(src.includes("root.ALTOFormat||(typeof require==='function'?require('./alto-format.js'):null)"),`${f}: reads ALTOFormat`);
  assert.ok(!/new Intl\.NumberFormat/.test(src),`${f}: no number format of its own`);
  assert.ok(!/toFixed\(2\)|'\$'\+/.test(src),`${f}: no money format of its own`);
}
assert.ok(!/'—'/.test(read('area.js'))&&!/'—'/.test(read('property.js')),'Area and property: missing values are the en dash');
const app=read('map-app.js');
assert.ok(!/formatCurrency|compactCurrency|compactNumber|function popupHtml/.test(app)&&app.includes('const formatNumber = { format: (v) => FMT.count(v) };'),'map: counts through ALTOFormat, no currency format of its own');
// On the tree page property.js and tree-ground.js arrive after the hero (FE-03), so after alto-format.js too.
for(const page of ['index.html','tree.html']){
  const h=read(page),at=s=>h.indexOf(`<script src="./${s}?v=`),later=page==='tree.html'?['property.js','tree-ground.js']:[];
  assert.ok(at('alto-format.js')>0&&['palette.js','alto-viz.js','tree-summary.js','tree-record.js','tree-instrument.js','property.js','tree-ground.js'].filter(s=>!later.includes(s)).every(s=>at(s)>at('alto-format.js')),`${page}: alto-format.js loads before every module that formats`);
  for(const s of later)assert.ok(at(s)<0&&read('tree-page.js').includes(`'./${s}'`),`${page}: ${s} after the hero`);
}
assert.ok(read('index.html').indexOf('<script src="./area.js?v=')>read('index.html').indexOf('<script src="./alto-format.js?v='),'index.html: Area after alto-format.js');

// 3. One benefits range and one carbon figure per tree: the record's breakdown, its key measurements and the panel agree.
{for(const f of ['palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js'])require(web+f);
  const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js'),P=require(web+'tree-panel.js');
  const FX=require('./fixtures/tree-records-v6dev.json');
  const META={release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev',dataset_last_updated_utc:'2026-10-11T00:00:00+00:00',status:'research_only_not_independently_validated'},assembly:{tile_version:'20261011-v6-dev'}};
  const visible=h=>h.replace(/<(svg|code)[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
  let n=0;
  for(const id of Object.keys(FX.trees)){
    const rec=R.assemble({id,record:FX.trees[id].record,schema:FX.schema,members:FX.trees[id].members,memberCount:FX.trees[id].memberCount,metadata:META,env:{siteRoot:'.',dataBase:'./data',metadata:META}});
    const b=rec.benefits,qb=rec.measures.benefits,qc=rec.measures.carbonStored;
    if(b?.status!=='estimated'||!qb||!qc)continue;
    n++;
    const carbon=I.text(qc),benefit=I.text(qb),range=I.fmtRange(qb);
    assert.equal(carbon,F.co2(qc.value),`${id}: carbon stored by the shared rule`);
    assert.equal(b.rows.find(r=>r.key==='carbon').quantity.text,`${carbon} stored`,`${id}: the breakdown's carbon is the key measurement's figure`);
    assert.equal(b.total.text,benefit,`${id}: one benefits figure`);
    assert.equal(`${b.total.rangeText}/yr`,range,`${id}: one benefits range`);
    const panel=visible(P.render(rec,{}));
    const carbons=[...panel.matchAll(/(\d[\d,.]*) (t|kg) CO₂e(?!\/yr)/g)].map(m=>`${m[1]} ${m[2]} CO₂e`);
    assert.ok(carbons.length&&carbons.every(c=>c===carbon),`${id}: the panel prints carbon stored one way (${[...new Set(carbons)].join(', ')})`);
    const ranges=[...panel.matchAll(/\$[\d,.]+–\$[\d,.]+\/yr/g)].map(m=>m[0]);
    assert.ok(ranges.length&&ranges.every(r=>r===range),`${id}: the panel prints the benefits range one way (${[...new Set(ranges)].join(', ')})`);
  }
  assert.ok(n>=2,'records with benefits checked');
}

// 4. One source factory for the map and the tree page's inset map.
{const MS=require(web+'map-sources.js');
  let stamp='__auto__';
  const S=MS.create({dataBase:'./data/',version:()=>stamp,credits:{aerialSource:(e={})=>({type:'raster',tiles:['AERIAL'],...e}),MAP:{osm:'OSM',esriLight:'LIGHT',esriLabels:'LABELS'}}});
  assert.equal(S.archive('trees_map_points'),'pmtiles://./data/trees_map_points.pmtiles?v=__auto__','versioned archive; the stamp read when the URL is made');
  stamp='20261013-v6.2';
  assert.equal(S.archive('tree_change_v1',{rev:'v1-20261013'}),'pmtiles://./data/tree_change_v1.pmtiles?v=20261013-v6.2&rev=v1-20261013');
  assert.equal(S.versioned('./data/species_options.json'),'./data/species_options.json?v=20261013-v6.2');
  const bm=S.basemaps();
  assert.deepEqual(Object.keys(bm),['hybrid','satellite','light','streets']);
  assert.equal(bm.light.sources['esri-light-base'].attribution,'LIGHT');assert.equal(bm.light.sources['osm-street-names'].minzoom,16);
  assert.deepEqual(S.raster.lightBase(),bm.light.sources['esri-light-base'],'the inset map\'s light base is the map\'s');
  const tp=read('tree-page.js');
  assert.ok(app.includes('const MAP_SOURCES = ALTOMapSources.create({ dataBase: DATA_BASE, version: () => TILE_VERSION });')&&app.includes('const basemaps = MAP_SOURCES.basemaps();'),'map: sources from the factory');
  assert.ok(tp.includes('const MS=window.ALTOMapSources.create({dataBase:DATA_BASE,version:VERSION})')&&tp.includes("url:MS.archive('trees_map_points')")&&tp.includes('base:MS.raster.lightBase()'),'inset map: sources from the factory');
  for(const [f,src] of [['map-app.js',app],['tree-page.js',tp]])assert.ok(!/pmtiles:\/\/\$\{|arcgisonline\.com|tile\.openstreetmap\.org/.test(src),`${f}: no archive URL or basemap of its own`);
  {const h=read('index.html'),at=s=>h.indexOf(`<script src="./${s}?v=`);
    assert.ok(at('credits.js')<at('map-sources.js')&&at('map-sources.js')<at('map-app.js'),"index.html: map-sources.js after the credits, before the map's script");}
  {const h=read('tree.html'),at=s=>h.indexOf(`<script src="./${s}?v=`);
    assert.ok(at('credits.js')>0&&at('credits.js')<at('tree-page.js')&&at('map-sources.js')<0&&tp.includes("['./map-libs.js','./tile-cache.js','./map-sources.js']"),'tree.html: the credits with the page; map-sources.js when the inset nears the screen (FE-03)');}
}
console.log('alto-format checks passed (precision rules, one rule set across panel, tree page, Area and property, one carbon figure and benefits range per tree, one map source factory)');
