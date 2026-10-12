// Offline checks for the tool v0.2.0 modules: versions, the tree-ID resolver, sources/status/quality and
// their map expressions, the tree summary, the panel and the pictures.
// Usage: node pipeline/tool/test_tool_v02_ui.cjs
const assert=require('node:assert/strict');
const web=require('node:path').join(__dirname,'..','..','web')+'/';
const Ver=require(web+'version.js'),Id=require(web+'tree-id.js'),S=require(web+'sources.js');
require(web+'growth-form.js');require(web+'record-links.js');
const V=require(web+'alto-viz.js'),T=require(web+'tree-summary.js'),P=require(web+'tree-panel.js'),A=require(web+'area.js');

// Versions: the tool owns its version; the data label comes from the release metadata.
assert.equal(Ver.TOOL.version,'0.2.1');
assert.deepEqual([Ver.data({release:{dataset_version:'metro-2026.10.10-pointcloud-v5.2'}}).label,Ver.data({release:{dataset_version:'metro-2026.10.10-pointcloud-v5.2'}}).dev],['v5.2',false]);
assert.deepEqual([Ver.data({release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev'}}).label,Ver.data({release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev'}}).dev],['v6',true]);
assert.equal(Ver.data({release:{data_release:'6',dataset_version:'x'}}).label,'v6');
assert.equal(Ver.label({release:{dataset_version:'metro-2026.10.10-pointcloud-v5.2'}}),'Data v5.2 · Tool v0.2.1');
assert.equal(Ver.label(null),'Data release unknown · Tool v0.2.1');
// The public label names the release by its date; its number stays in provenance, About and methods.
assert.deepEqual(Ver.publicLabel({release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev'}}),{text:'Release 11 Oct 2026 · Tool 0.2.1',preview:true});
assert.deepEqual(Ver.publicLabel({release:{dataset_version:'metro-2026.10.10-pointcloud-v5.2'}}),{text:'Release 10 Oct 2026 · Tool 0.2.1',preview:false});
assert.ok(Ver.citation({treeId:'akl_tree_x',metadata:{release:{dataset_version:'a-v6',dataset_last_updated_utc:'2026-10-11'}}}).includes('Tree akl_tree_x'));

// IDs: one tree, however it is typed; anything else is refused; links are canonical.
for(const raw of ['akl_tree_trp_ACCT0050811','trp_ACCT0050811',' AKL_TREE_trp_ACCT0050811 ','akl_tree_trp_ACCT0050811%20'.replace('%20','')])assert.equal(Id.normalise(raw),'akl_tree_trp_ACCT0050811');
for(const bad of ['','<script>','a b','../x'])assert.equal(Id.normalise(bad),null,bad);
assert.ok(Id.looksLikeId('trp_ACCT0050811')&&Id.looksLikeId('akl_tree_pc5_91e7059c27f2ff059744')&&!Id.looksLikeId('12 Queen Street'));
assert.equal(Id.url('akl_tree_x',{base:'https://alto.tfwelch.com/'}),'https://alto.tfwelch.com/tree.html?id=akl_tree_x');
assert.equal(Id.url('akl_tree_x',{page:'map',base:'https://alto.tfwelch.com/tree.html?id=y#a'}),'https://alto.tfwelch.com/?tree=akl_tree_x');
(async()=>{
  const r=await Id.resolve('trp_ACCT0050811',{base:'./data',version:'1',metadata:{}});
  assert.deepEqual([r.tree_id,r.canonical,r.status,r.resolved_by],['akl_tree_trp_ACCT0050811','akl_tree_trp_ACCT0050811','current','release_tree_id']);
  assert.equal((await Id.resolve('<x>',{})).status,'invalid');

  // A tiny evaluator for the expression subset sources.js uses, so the map filters are checked against classify().
  function ev(e,p){
    if(!Array.isArray(e))return e;
    const [op,...a]=e;
    switch(op){
      case 'get':return p[a[0]]??null; case 'literal':return a[0]; case 'coalesce':for(const x of a){const v=ev(x,p);if(v!==null&&v!==undefined)return v;}return null;
      case 'to-number':{const v=ev(a[0],p);return v===null?null:Number(v);} case '==':return ev(a[0],p)===ev(a[1],p); case '!=':return ev(a[0],p)!==ev(a[1],p);
      case '!':return !ev(a[0],p); case 'all':return a.every(x=>ev(x,p)); case 'any':return a.some(x=>ev(x,p));
      case 'in':return ev(a[1],p).includes(ev(a[0],p));
      case 'case':for(let i=0;i<a.length-1;i+=2)if(ev(a[i],p))return ev(a[i+1],p);return ev(a[a.length-1],p);
      case 'match':{const v=ev(a[0],p);for(let i=1;i<a.length-1;i+=2){const k=a[i];if(Array.isArray(k)?k.includes(v):k===v)return ev(a[i+1],p);}return ev(a[a.length-1],p);}
      default:throw new Error('op '+op);
    }
  }
  const F=[
    {tree_id:'d',source_primary:'lidar_pointcloud_v4',owner_class:'LiDAR Point-cloud Detection',crown_pilot:1,is_protected_notable:0},
    {tree_id:'at',source_primary:'tree_register_points',owner_class:'Auckland Transport',crown_pilot:1,is_protected_notable:1},
    {tree_id:'park0',source_primary:'tree_register_points',owner_class:'Auckland Council Parks',crown_pilot:0,is_protected_notable:0},
    {tree_id:'unk',source_primary:'tree_register_points',owner_class:'Unknown',crown_pilot:1,is_protected_notable:0,link_class:'probable'},
    {tree_id:'not',source_primary:'notable_trees_overlay',owner_class:'Notable Tree (Council Schedule)',crown_pilot:1,crown_source:'record_seeded_v52',is_protected_notable:1},
    {tree_id:'osm',source_primary:'osm_natural_tree',owner_class:'OSM Crowd-Sourced',crown_pilot:0,is_protected_notable:0},
    {tree_id:'kau',source_primary:'ruru_obskauri_tiaki_public',owner_class:'Kauri Observation (Public Survey)',crown_pilot:1,is_protected_notable:0},
    {tree_id:'old',source_primary:'lidar_inferred_canopy',crown_pilot:0,display_role:'earlier_detection'}
  ];
  const C=Object.fromEntries(F.map(f=>[f.tree_id,S.classify(f)]));
  assert.deepEqual(C.at.sources.sort(),['lidar','register_at']);
  assert.deepEqual([C.at.protected,C.at.quality],[true,'linked']);
  assert.deepEqual([C.park0.sources,C.park0.quality],[['register_parks'],'unlinked']);
  assert.deepEqual([C.unk.primary,C.unk.quality],['register_other','probable']);
  assert.deepEqual([C.not.primary,C.not.quality],['notable','drawn']);
  assert.equal(C.old.quality,'linked','an earlier detection is a LiDAR detection, not an unlinked record');
  for(const f of F){
    assert.equal(ev(S.primaryExpr(),f),C[f.tree_id].primary,f.tree_id);
    assert.equal(ev(S.qualityExpr(),f),C[f.tree_id].quality,f.tree_id);
    for(const s of S.ACTIVE)assert.equal(!!ev(s.match,f),C[f.tree_id].sources.includes(s.key),`${f.tree_id} ${s.key}`);
    assert.equal(ev(S.protectedExpr,f),C[f.tree_id].protected);
  }
  assert.equal(S.sourceFilter(new Set(S.SOURCE_KEYS)),null);
  assert.deepEqual(S.sourceFilter(new Set()),['==',['get','tree_id'],'__none__']);
  const noLidar=S.sourceFilter(new Set(S.SOURCE_KEYS.filter(k=>k!=='lidar')));
  assert.deepEqual(F.filter(f=>ev(noLidar,f)).map(f=>f.tree_id),['at','park0','unk','not','osm','kau'],'turning LiDAR off keeps every recorded tree');
  assert.deepEqual(F.filter(f=>ev(S.statusFilter(new Set(['protected'])),f)).map(f=>f.tree_id),['at','not']);
  assert.equal(S.statusFilter(new Set(['notable'])),null,'a coming status filters nothing');
  assert.deepEqual(F.filter(f=>ev(S.qualityFilter(new Set(['unlinked'])),f)).map(f=>f.tree_id),['park0','osm']);
  assert.ok(S.SOURCES.filter(s=>s.soon).map(s=>s.key).join()==='kyte,nztr','KYTE and the NZ Tree Register are shown as coming');
  assert.ok(!/Council Parks/.test(S.source('register_parks').note.replace('Auckland Council Parks','')),'Council Parks is named as the register owner');

  // Summary: a recorded species stays the species; a model growth form is worded as a model.
  const rec={tree_id:'akl_tree_trp_A',datasets:{record:{source_primary:'tree_register_points',source_tree_id:'ACCT1',owner_class:'Auckland Transport',species_common:'London Plane Tree',species_latin:'Platanus x acerifolia',is_protected_notable:1,notable_group_names:'London Plane (approx. 112)',notable_group_objectids:'121',lon:174.7,lat:-36.8,as_of_utc:'2026-06-20T20:58:20+00:00'},
    identity:{seg_key:'pc_X:1:2',members_json:JSON.stringify([{tree_id:'akl_tree_pc4_1',source:'lidar_pointcloud_v4',source_tree_id:'1_1'},{tree_id:'akl_tree_trp_A',source:'tree_register_points',source_tree_id:'ACCT1'},{tree_id:'akl_tree_osm_node_9',source:'osm_natural_tree',source_tree_id:'node/9'}]),evidence_tier:'very_likely'},
    crown:{crown_area_m2:315.5,crown_diameter_m:20,crown_max_chm_m:16.85,crown_source:'v5',method_id:'pointcloud_v5_ndvi_watershed'},assets:{dbh_cm_crown_est:36.2,life_stage:'mature',replacement_years_canopy:121.3,irreplaceability_class:'effectively_irreplaceable'},
    services:{species_class:'deciduous_broadleaf',total_value_nzd_y:537.9,total_value_nzd_y_low:376.5,total_value_nzd_y_high:699.3,avoided_runoff_m3_y:27.6,stored_co2e_tonnes_est:1.17,dbh_cm_est:38.3},
    previous_pointcloud:{foliage_profile:'[0,1,0,0,0,0,2,5,9,14,20,18,12,6,2,1,0]',canopy_cover:0.925},
    growth_form:{display_key:'conifer',merged_call:'merged'},trajectory:{present_2013:0,present_2016:1,present_2024:1,h_2016:13.5,h_2024:15.8,fate:'persistent'}}};
  const s=T.from({tree_id:'akl_tree_trp_A'},rec);
  assert.deepEqual([s.name.kind,s.name.title,s.name.latin],['recorded','London Plane Tree','Platanus x acerifolia']);
  assert.equal(s.growth.wording,'Likely conifer (model)','the model line is kept beside a recorded species');
  assert.equal(s.schedule.label,'Scheduled group of about 112 trees: London Plane','a scheduled group is named as a group');
  assert.equal(s.lifeStage.detail,'16.9 m of 25 m (deciduous broadleaf): 67%');
  assert.deepEqual([s.replacement.irrLabel,Math.round(s.replacement.rate*10)/10],['Effectively irreplaceable',2.6]);
  assert.deepEqual(s.surveys.map(e=>[e.year,e.status,e.height]),[[2013,'absent',null],[2016,'matched',13.5],[2024,'matched',16.85]]);
  assert.equal(s.surveys[0].line,'Not detected in the 2013 survey');
  const ids=Object.fromEntries(s.ids.map(x=>[x.code,x]));
  assert.ok(ids.ACCT1.self&&ids.ACCT1.href===null,'the Council register now needs a token, so its IDs carry no link');
  assert.equal(ids['node/9'].href,'https://www.openstreetmap.org/node/9');
  assert.ok(ids['group 121'].href.includes('Notable_Group_of_Trees_Overlay')&&ids['group 121'].note==='about 112 trees: London Plane');
  assert.ok(ids['pc_X:1:2'].crown);
  assert.equal(s.ids[0].code,'ACCT1','this record is listed first');
  assert.deepEqual([s.size.dbhLow,s.size.dbhHigh],[36.2,38.3]);
  assert.ok(s.status.protected&&s.sources.some(x=>x.key==='notable_match'),'a schedule match is listed as a source of the status');
  const det=T.from({tree_id:'akl_tree_pc5_x',source_primary:'lidar_pointcloud_v5',gf6:'tree_fern',crown_max_chm_m:6,evidence_tier:'possible'},null);
  assert.deepEqual([det.name.kind,det.name.title,det.size.kind],['model','Likely tree fern (model)','fern']);
  assert.equal(det.evidence.tone,'warn');
  assert.equal(T.from({tree_id:'akl_tree_pc5_y',source_primary:'lidar_pointcloud_v5',gf6:'not_determined'},null).name.kind,'none','an undetermined crown is not given a name');

  // The panel (concept B, chosen 12 Oct 2026, with concept A's protection line and records link and concept C's
  // links into the tree page): it renders from the tree record (tree-record.js), from the map tile first.
  s.crownGeometry={type:'Polygon',coordinates:[[[174.70,-36.80],[174.7002,-36.80],[174.7002,-36.8002],[174.70,-36.8002],[174.70,-36.80]]]};s.position={lon:174.7001,lat:-36.8001};
  globalThis.window=globalThis;require(web+'tree-details.js');const R=require(web+'tree-record.js');require(web+'tree-instrument.js');
  const card=R.assemble({id:'akl_tree_trp_A',record:rec,env:{siteRoot:'.',dataBase:'./data'}});
  const html=P.render(card,{treeUrl:'tree.html?id=akl_tree_trp_A',geometry:s.crownGeometry});
  assert.ok(html.includes('href="tree.html?id=akl_tree_trp_A"')&&html.includes('Open tree page')&&html.includes('Save to compare')&&html.includes('Add a photo (KYTE)'));
  assert.ok(html.includes('Scheduled group of about 112 trees: London Plane')&&html.includes('Auckland Unitary Plan, Schedule 10')&&html.includes('3 records'));
  assert.ok(html.includes('Platanus × acerifolia'),'the hybrid sign, never the letter x');
  assert.ok(html.includes('World_Imagery/MapServer/tile')&&html.includes('feMorphology'),'the crown figure is the aerial image with this crown outline');
  assert.ok(html.includes('class="ti-pf"'),'the height figure is drawn from the stored return profile');
  assert.ok(html.includes('121 years')&&html.includes('2147')&&html.includes('Effectively irreplaceable'));
  assert.ok(html.includes('<b>316</b>')&&html.includes('<b>$540</b>')&&html.includes('<b>37</b>'),'values rounded by the design-system rules; the trunk is the central estimate of 36.2 and 38.3 cm');
  assert.ok((html.match(/class="badge badge-estimate"/g)||[]).length>=4,'estimates carry the Estimate badge');
  assert.ok(/data-q="height"/.test(html)&&/data-q="benefits"/.test(html),'every key value opens its source and method');
  assert.ok(html.includes('Root protection radius: none for this record (no root-space scenario)'),'an absent value is said, never silent');
  assert.ok(!/\(model\)|pointcloud_v5|Data v6/.test(html.replace(/<code[^>]*>[^<]*<\/code>/g,'')),'no "(model)", release numbers or method IDs in labels');
  assert.ok(!/undefined|NaN|null</.test(html),'no missing values leak into the panel');
  for(const gone of ['v-house','v-ref"><circle','v-bark','benefit-ico','irr-meter','stage-ico'])assert.ok(!html.includes(gone),`no illustration: ${gone}`);
  const dr=R.fromTile({tree_id:'akl_tree_pc5_x',source_primary:'lidar_pointcloud_v5',gf6:'tree_fern',crown_max_chm_m:6,evidence_tier:'possible'},{siteRoot:'.'});
  const dh=P.render(dr,{treeUrl:'t'});
  assert.ok(dh.includes('>Tree fern<')&&dh.includes('badge-estimate')&&dh.includes('Species not identified.'),'a model title is the class with an Estimate badge');
  assert.equal(T.replacement(13.3,29.3,'effectively_irreplaceable',33.5).irrDefinition,'25 m or taller','a tall tree is in the class by height');
  assert.ok(/DOWNLOADS=window\.ALTO_ENABLE_DOWNLOADS===true/.test(require('node:fs').readFileSync(web+'tree-page.js','utf8')),'per-tree download is off unless enabled');

  // Graphics: drawn from the tree's values only.
  assert.equal((V.profile('[0,3,0,4]').match(/v-band-bar/g)||[]).length,2);
  assert.equal(V.profile('not json'),'');
  assert.match(V.stageScale('mature'),/aria-current="true"><b>Mature<\/b><span>60–90%/);
  assert.ok(V.stageScale('unknown').includes('not estimated'));
  const line=V.replacementLine({years:121.3,startYear:2026});
  assert.ok(line.includes('2147')&&line.includes('25%')&&line.includes('planted'));
  assert.equal(V.replacementLine({years:null}),'');
  assert.ok(V.outline({geometry:s.crownGeometry}).includes('feMorphology'));
  assert.ok(V.composition([{key:'a',label:'A',value:2,colour:'#000'}],{key:'source'}).includes('data-highlight="source:a"'));
  assert.equal(V.litres(27.6),'27,600 L');

  // Area: one count per tree, superlatives point at a tree, clicks become map expressions.
  const a=A.summarise([...F.map(f=>({properties:{...f,crown_area_m2:10,crown_max_chm_m:f.tree_id==='at'?30:12,total_value_nzd_y:5,life_stage:'mature'},geometry:{type:'Point',coordinates:[174.7,-36.8]}})),{properties:{...F[0]}}]);
  assert.equal(a.count,F.length);
  assert.equal(Object.values(a.sources).reduce((x,y)=>x+y,0),F.length);
  assert.equal(a.protected,2);
  assert.deepEqual([a.tallest.id,a.tallest.value],['at',30]);
  const ah=A.render(a,{kind:'view',title:'x',sample:true});
  assert.ok(ah.includes('Showing a sample at this zoom. Zoom in to see every tree.')&&ah.includes('data-area-go="tallest"')&&ah.includes('data-highlight="stage:mature"'));
  assert.ok(!/class="kpi-ico"|kpi-ico/.test(ah),'no decorative icons in the Area tab');
  assert.deepEqual(A.highlightExpr('stage','mature'),['==',['get','life_stage'],'mature']);
  assert.equal(F.filter(f=>ev(A.highlightExpr('source','register_at'),f)).map(f=>f.tree_id).join(),'at');
  assert.ok(A.render({count:0},{kind:'region',title:'Auckland',totals:{trees:3574825}}).includes('3,574,825'));
  // The typeface: fonts.css names files that ship in web/fonts (with the licence), and every page that
  // preloads a font preloads the upright file fonts.css uses, so the preload is never a second download.
  const fs=require('node:fs');
  const fontsCss=fs.readFileSync(web+'fonts.css','utf8'),urls=[...fontsCss.matchAll(/url\("([^"]+)"\)/g)].map(m=>m[1]);
  assert.ok(urls.length===2&&urls.every(u=>fs.existsSync(web+u)),`fonts.css files: ${urls}`);
  assert.ok(fs.existsSync(web+'fonts/Inter-LICENSE-OFL.txt'),'the Inter licence ships with the fonts');
  for(const page of ['index.html','tree.html','v5-methods.html','v51-methods.html','v52-methods.html']){
    const html=fs.readFileSync(web+page,'utf8'),pre=html.match(/<link rel="preload" href="\.\/([^"]+)" as="font"[^>]*crossorigin>/);
    assert.ok(pre&&pre[1]===urls[0]&&html.includes('fonts.css'),`${page}: preloads ${pre&&pre[1]}, fonts.css uses ${urls[0]}`);
  }
  console.log('Tool v0.2.0: versions, IDs, sources/status/quality expressions, summary, panel, pictures, Area and typeface checks passed.');
})().catch(e=>{console.error(e);process.exit(1);});
