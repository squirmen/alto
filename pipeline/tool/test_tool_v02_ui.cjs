// Offline checks for the tool v0.2.0 modules: versions, the tree-ID resolver, sources/status/quality and
// their map expressions, the tree summary, the panel and the pictures.
// Usage: node pipeline/tool/test_tool_v02_ui.cjs
const assert=require('node:assert/strict');
const web=require('node:path').join(__dirname,'..','..','web')+'/';
const Ver=require(web+'version.js'),Id=require(web+'tree-id.js'),S=require(web+'sources.js');
require(web+'growth-form.js');require(web+'record-links.js');
const V=require(web+'alto-viz.js'),T=require(web+'tree-summary.js'),P=require(web+'tree-panel.js'),A=require(web+'area.js');

// Versions: the tool owns its version; the data label comes from the release metadata.
assert.equal(Ver.TOOL.version,'0.2.17.1');
assert.deepEqual([Ver.data({release:{dataset_version:'metro-2026.10.10-pointcloud-v5.2'}}).label,Ver.data({release:{dataset_version:'metro-2026.10.10-pointcloud-v5.2'}}).dev],['v5.2',false]);
assert.deepEqual([Ver.data({release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev'}}).label,Ver.data({release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev'}}).dev],['v6',true]);
assert.equal(Ver.data({release:{data_release:'6',dataset_version:'x'}}).label,'v6');
assert.equal(Ver.label({release:{dataset_version:'metro-2026.10.10-pointcloud-v5.2'}}),'Data v5.2 · Tool v0.2.17.1');
assert.equal(Ver.label(null),'Data release unknown · Tool v0.2.17.1');
// The public label names the release by its number and its date, since two releases can share a date (6.1 and 6.2,
// 13 Oct 2026): "Release 6.2 · 13 Oct 2026 · Tool 0.2.17.1".
assert.deepEqual(Ver.publicLabel({release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev'}}),{text:'Release 6 · 11 Oct 2026 · Tool 0.2.17.1',preview:true,number:'6',date:'11 Oct 2026'});
assert.deepEqual(Ver.publicLabel({release:{dataset_version:'metro-2026.10.10-pointcloud-v5.2'}}),{text:'Release 5.2 · 10 Oct 2026 · Tool 0.2.17.1',preview:false,number:'5.2',date:'10 Oct 2026'});
assert.equal(Ver.publicLabel({release:{dataset_version:'metro-2026.10.13-pointcloud-v6.2'}}).text,'Release 6.2 · 13 Oct 2026 · Tool 0.2.17.1');
assert.equal(Ver.publicLabel({release:{dataset_version:'metro-2026.10.17-pointcloud-v6.3'}}).text,'Release 6.3 · 17 Oct 2026 · Tool 0.2.17.1');
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
  // An earlier survey without a linked crown reads "not linked", never "not detected": the crown may be there.
  assert.equal(s.surveys[0].line,'No 2013 LiDAR crown is linked to this tree');
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
  // The panel's root-space card is the dripline radius, measured on the crown outline the map holds (TS-03).
  assert.ok(/data-q="dripline"/.test(html)&&html.includes('Dripline radius (2024 crown outline)')&&html.includes('14.2'),'the dripline radius from the crown outline');
  // A value the release does not hold is said, never silent: this record has no root-space scenario.
  const strip=globalThis.ALTOInstrument.strip(card,['height','rootProtection']);
  assert.ok(strip.includes('BS 5837 root protection radius (UK standard; 12 × trunk estimate), for comparison: none for this record (no root-space scenario)'),'an absent value is said, never silent');
  // Beside a recorded species the growth form is the release's call, named as a model's (SKP-02); nowhere else.
  assert.ok(html.includes('<p class="tp-gf">Crown growth form (model): likely conifer</p>'),'the crown growth form line');
  assert.ok(!/\(model\)|pointcloud_v5|Data v6/.test(html.replace(/<code[^>]*>[^<]*<\/code>/g,'').replace(/<p class="tp-gf">[^<]*<\/p>/,'')),'no "(model)", release numbers or method IDs in labels');
  assert.ok(!/undefined|NaN|null</.test(html),'no missing values leak into the panel');
  for(const gone of ['v-house','v-ref"><circle','v-bark','benefit-ico','irr-meter','stage-ico'])assert.ok(!html.includes(gone),`no illustration: ${gone}`);
  const dr=R.fromTile({tree_id:'akl_tree_pc5_x',source_primary:'lidar_pointcloud_v5',gf6:'tree_fern',crown_max_chm_m:6,evidence_tier:'possible'},{siteRoot:'.'});
  const dh=P.render(dr,{treeUrl:'t'});
  // A model-named tree is titled in the release's own wording (growth-form.js WORDING), never the top score (SKP-02).
  assert.ok(dh.includes('>Likely tree fern (model)<')&&dh.includes('badge-estimate')&&dh.includes('Species not identified.')&&!/\d+%\)/.test(dh.split('tp-gf')[0]),'a model title is the release wording with an Estimate badge');
  assert.equal(T.replacement(13.3,29.3,'effectively_irreplaceable',33.5).irrDefinition,'25 m or taller','a tall tree is in the class by height');
  assert.ok(/DOWNLOADS=window\.ALTO_ENABLE_DOWNLOADS===true/.test(require('node:fs').readFileSync(web+'tree-page.js','utf8')),'per-tree download is off unless enabled');

  // Graphics: drawn from the tree's values only.
  assert.equal((V.profile('[0,3,0,4]').match(/v-band-bar/g)||[]).length,2);
  assert.equal(V.profile('not json'),'');
  // TS-07: the stored life_stage is a height class named by size.
  assert.match(V.stageScale('mature'),/aria-label="Height class scale; this tree: Large"[\s\S]*aria-current="true"><b>Large<\/b><span>60–90%/);
  assert.ok(V.stageScale('unknown').includes('Height class not estimated'));
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
  // Below zoom 16 the markers drawn are a sample: counted as drawn, never summed and never ranked (UX-04, AREA-01).
  const ah=A.render(a,{kind:'view',title:'x',sample:true});
  assert.ok(ah.includes('Map markers drawn')&&ah.includes('a sample at this zoom')&&ah.includes('Zoom in to 16 to total this view')&&ah.includes('data-highlight="stage:large"'));
  assert.ok(!ah.includes('data-area-go="tallest"')&&!/Largest crown|Crown area<|Benefits</.test(ah),'no sums or superlatives over a sample');
  const full=A.render(a,{kind:'view',title:'x',sample:false});
  assert.ok(full.includes('data-area-go="tallest"')&&full.includes('Map markers')&&full.includes('Estimate · range not computed'),'at zoom 16 and above the view is totalled');
  assert.ok(!/class="kpi-ico"|kpi-ico/.test(ah),'no decorative icons in the Area tab');
  assert.deepEqual(A.highlightExpr('stage','mature'),['any',['==',['get','height_class'],'large'],['==',['get','life_stage'],'mature']]);
  assert.equal(F.filter(f=>ev(A.highlightExpr('source','register_at'),f)).map(f=>f.tree_id).join(),'at');
  // Defined terms (TS-24): the Area counts map markers, never "trees", at every scope; the board's count from the earlier
  // map says so; the map's view count reads in the singular for one marker.
  {
    assert.ok(full.includes('<h3>Map markers by source</h3>')&&!/Trees by|Mapped trees|Trees counted/.test(full),'view scope');
    const bd=A.render(a,{kind:'board',title:'Ōrākei local board',board:{board_name:'Ōrākei',land_area_km2:10,tree_count:32809},sample:false});
    assert.ok(bd.includes('<dt>Map markers</dt><dd>32,809<small>in the earlier map, Sep 2026</small>')&&!/Mapped trees|Trees by/.test(bd),'board scope');
    const pr=A.render(a,{kind:'property',title:'1 Example Street',property:{property:{n_trees:5,n_confident:4,n_uncertain:1,canopy_m2:200,canopy_cover_pct:20,area_m2:1000},trees:[]}});
    assert.ok(pr.includes('<dt>Map markers</dt><dd>5<small>4 confident · 1 possible</small>')&&!/Trees counted/.test(pr),'property scope');
    const mapSrc=require('node:fs').readFileSync(web+'map-app.js','utf8');
    assert.ok(mapSrc.includes('`${one ? "marker" : "markers"} in view`')&&mapSrc.includes('Map markers (Sep 2026 map)')&&!/Mapped trees|"No trees in view|Loading trees in this view/.test(mapSrc),'map view count and board popup');
    // One tree in the search's species line reads "1 tree" (UX-09 residual, 0.2.10).
    assert.ok(mapSrc.includes('${count === 1 ? "tree" : "trees"} in the release'),'species search line in the singular');
  }
  // The map headline's mean height is Area's (0.2.10): both leave out heights of 55 m or more (tree-record.js TALL_M,
  // the one constant); the headline counts them and its scope line says how many it left out.
  {
    const MA=require(web+'map-analysis.js'),R=require(web+'tree-record.js');
    const hs=[12,9,63.7,6.4,79.9],fx=hs.map((h,i)=>({properties:{tree_id:'h'+i,crown_max_chm_m:h,crown_area_m2:10},geometry:{type:'Point',coordinates:[174.7,-36.8]}}));
    const sm=MA.summarise(fx),ar=A.summarise(fx);
    assert.equal(R.TALL_M,55);assert.equal(sm.tallM,R.TALL_M);
    assert.deepEqual([sm.heightCount,sm.tallCount,+sm.meanHeight.toFixed(2)],[3,2,9.13]);
    assert.equal(sm.meanHeight,ar.meanHeight,'headline mean = Area mean');
    assert.equal(MA.summarise(fx,{tallM:100}).heightCount,5);
    const ms=require('node:fs').readFileSync(web+'map-app.js','utf8');
    assert.ok(ms.includes('mean height leaves out ${formatNumber.format(summary.tallCount)} flagged ${summary.tallCount === 1 ? "height" : "heights"} of ${summary.tallM} m or more'),'the scope line counts them');
    // Area lists the three tallest and how many more.
    const many=A.summarise([55,56,57,58,59,12].map((h,i)=>({properties:{tree_id:'m'+i,crown_max_chm_m:h},geometry:{type:'Point',coordinates:[174.7,-36.8]}})));
    assert.ok(A.render(many,{kind:'view',title:'x',sample:false}).includes('59 m · flagged<br>58 m · flagged<br>57 m · flagged<br>and 2 more'));
  }
  // Phone sheet (WCAG 2.4.11): Tab onto a control below the sheet's visible part raises the sheet to full, at once when
  // the keyboard moved it (no slide), so focus never rests on a control out of view.
  {
    const fsx=require('node:fs'),src=fsx.readFileSync(web+'map-app.js','utf8'),css=fsx.readFileSync(web+'map.css','utf8');
    assert.ok(/explorer\.addEventListener\("focusin", e => \{[\s\S]{0,400}if \(bottom > sheetStop\(panelSheet\)\) \{ setPanelSheet\("full"\); if \(tabbing\) raiseNow\(\); \}/.test(src),'focus below the sheet raises it');
    assert.ok(src.includes('if (tabbing) raiseNow(); else requestAnimationFrame(() => placeSheet(explorer.offsetHeight));'),'the search raises the sheet at once from the keyboard');
    assert.ok(css.includes('#explorer.lp.is-dragging, #explorer.lp.is-instant { transition: none; }'));
    // The tree panel too (0.2.10): Tab scrolls its body at once, not smoothly, and a control a survey preview pushes out
    // of the body's visible part (a survey chip at 390x844) is brought back into view after the preview's re-layout.
    assert.ok(/profileBody\.addEventListener\("focusin", e => \{[\s\S]{0,300}if \(el\.isConnected && document\.activeElement === el && !inView\(el\)\) el\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\); \};\n\s+keep\(\); requestAnimationFrame\(keep\);/.test(src),'tree panel focus kept in view');
    assert.ok(src.includes('if (e.key === "Tab") { keyboard = true; profileBody.classList.add("is-keyboard"); }')&&css.includes('.tree-profile-body.is-keyboard { scroll-behavior: auto; }'),'keyboard scrolls the panel at once');
  }
  // Recorded species (TS-14, UX-09): one entry per species with its spellings, highlighted together; a record naming
  // several species ("Rata,Rimu") is not listed as a species, only counted apart.
  {
    const N=require(web+'species-names.js');globalThis.ALTOSpeciesNames=globalThis.ALTOSpeciesNames||N;
    const sp=['Pohutukawa','Pōhutukawa','London Plane Tree','London Plane','Rata,Rimu','Rata,Rimu','Unknown','Totara'];
    const s2=A.summarise(sp.map((n,i)=>({properties:{tree_id:'s'+i,species_common:n}})));
    assert.deepEqual(s2.topSpecies.map(g=>[g.label,g.n]),[['London plane',2],['Pōhutukawa',2],['Tōtara',1]]);
    assert.deepEqual([s2.recorded,s2.speciesCount,s2.multiCount],[7,3,2]);
    const html=A.render(s2,{kind:'view',title:'x',sample:false});
    assert.ok(html.includes('7 of 8 map markers with a recorded species; 3 species. Not listed: 2 markers whose records name several species (as supplied: ‘Rata,Rimu’).'),html);
    assert.ok(!/species:[^"]*Rata/.test(html)&&!/>Rata,rimu</i.test(html),'never listed or highlighted as one species');
    assert.ok(html.includes('<span lang="mi">Pōhutukawa</span>'),'te reo name marked');
    assert.deepEqual(A.highlightExpr('species',JSON.stringify(['London Plane','London Plane Tree'])),['in',['get','species_common'],['literal',['London Plane','London Plane Tree']]]);
    assert.deepEqual(A.highlightExpr('species','["Totara"]'),['==',['get','species_common'],'Totara']);
    // UX-09 (0.2.10): Area names a species as its tree pages do. "Cherry" beside Prunus serrulata is Japanese flowering
    // cherry and beside Prunus sp. stays Cherry, and each group rings only its own records; "Magnolia Grandiflora" and
    // "Southern Magnolia" are one Southern magnolia.
    const pr=[['Cherry','Prunus serrulata'],['Cherry',"Prunus serrulata 'Kanzan'"],['Cherry','Prunus sp.'],['Cherry',null],['Magnolia Grandiflora','Magnolia grandiflora'],['Southern Magnolia',null]]
      .map(([c,l],i)=>({properties:{tree_id:'p'+i,species_common:c,...(l?{species_latin:l}:{})}}));
    const s3=A.summarise(pr);
    assert.deepEqual(s3.topSpecies.map(g=>[g.label,g.n]),[['Cherry',2],['Japanese flowering cherry',2],['Southern magnolia',2]]);
    const h3=A.render(s3,{kind:'view',title:'x',sample:false});
    const hl=label=>{const m=new RegExp(`data-highlight="species:([^"]+)" data-label="${label} \\(`).exec(h3);return m?m[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'):null;};
    const rings=label=>pr.filter(f=>ev(A.highlightExpr('species',hl(label)),f.properties)).map(f=>f.properties.tree_id).join();
    assert.equal(rings('Japanese flowering cherry'),'p0,p1');
    assert.equal(rings('Cherry'),'p2,p3');
    assert.equal(rings('Southern magnolia'),'p4,p5');
  }
  assert.ok(A.render({count:0},{kind:'region',title:'Auckland',totals:{markers:3574825}}).includes('3,574,825'));
  assert.ok(A.render({count:0},{kind:'region',title:'Auckland',totals:{markers:1,value:295000000}}).includes('about NZ$295 million a year'),'release totals rounded');
  assert.ok(A.render({count:0},{kind:'region',title:'Auckland',error:'Release metadata not loaded (HTTP 500).'}).includes('Release metadata not loaded (HTTP 500).'),'a failed metadata load is said');
  // AREA-01: at zoom 16 and above the superlatives say "in this view"; Auckland and a local board show their Species
  // maxima (clear leads from maxima.json, with margins, the list for the area), or say there are none; never a maximum
  // over the markers drawn.
  {
    for(const l of ['Tallest in this view','Largest crown in this view','Highest single benefit in this view'])assert.ok(full.includes(`<dt>${l}</dt>`),`zoom 16+: ${l}`);
    assert.ok(!/<dt>(Tallest|Largest crown|Highest single benefit)<\/dt>/.test(full),'no superlative without its scope');
    const Mx=require(web+'species-maxima.js');
    const mk=(measure,area,species,tree,value,within,extra={})=>({measure,area,species,tree,value,margin:measure==='max_height'?2:measure==='max_crown_spread'?1:30,unit:measure==='max_crown_area'?'m²':'m',n:12,next:value-5,within_margin:within,...extra});
    const D=Mx.prepare({schema:'alto-species-maxima/1',label:'Maximum',copy:{scope_note:"Ranks trees whose species is named in Auckland Council's tree register. Trees without a named species are not ranked."},
      areas:{Auckland:{coverage:1},'Ōrākei':{coverage:1},'Maungakiekie-Tāmaki':{coverage:1}},
      species:{'Araucaria heterophylla':{name:'Norfolk Island pine'},'Quercus robur':{name:'English oak'},'Platanus x acerifolia':{name:'London plane'},'Metrosideros excelsa':{name:'pōhutukawa'},'Agathis australis':{name:'kauri'},'Liriodendron tulipifera':{name:'tulip tree'}},
      trees:{TSG2SSKH:{lon:174.8,lat:-36.85},T2GJBWHP:{lon:174.76,lat:-36.85},TF0TD1X1:{lon:174.75,lat:-36.86},TNXWY21K:{lon:174.7,lat:-36.9},TKAURI00:{lon:174.6,lat:-36.9},TTULIP00:{lon:174.6,lat:-36.9}},
      maxima:[mk('max_height','Auckland','Araucaria heterophylla','TSG2SSKH',46.4,false),mk('max_height','Auckland','Quercus robur','T2GJBWHP',25.5,false),
        mk('max_height','Auckland','Platanus x acerifolia','TF0TD1X1',31.7,false),mk('max_height','Auckland','Metrosideros excelsa','TNXWY21K',24,false),
        mk('max_height','Auckland','Liriodendron tulipifera','TTULIP00',40,true),mk('max_height','Auckland','Agathis australis','TKAURI00',50,false),
        mk('max_crown_area','Auckland','Liriodendron tulipifera','TTULIP00',397,false),mk('max_height','Ōrākei','Quercus robur','T2GJBWHP',25.5,false),
        mk('max_height','Maungakiekie-Tāmaki','Quercus robur','T2GJBWHP',20,true)]});
    const region=A.render({count:0},{kind:'region',title:'Auckland',totals:{markers:1},maxima:D,base:'.'});
    const card=region.slice(region.indexOf('Species maxima · Auckland'));
    assert.ok(card.length>30,'Auckland: a Species maxima card');
    const heightTrees=[...card.slice(0,card.indexOf('Crown area')).matchAll(/data-area-tree="(T\w+)"/g)].map(m=>m[1]);
    assert.deepEqual(heightTrees,['TSG2SSKH','TF0TD1X1','T2GJBWHP'],'the three largest clear leads, largest first; near-ties and kauri never');
    assert.ok(card.includes('46.4 m<small>±2 m</small>')&&card.includes('397 m²<small>±30 m² · at the 400 m² limit</small>'),'values with margins; the crown-area limit said');
    assert.ok(card.includes('<span class="area-max-n">4 species</span>')&&card.includes('href="./maxima.html"')&&card.includes('data-area-maxima="Auckland"'),'counts, the list and the map rings');
    assert.ok(card.includes('Ranks trees whose species is named in Auckland Council’s tree register.')&&card.includes('Not field-verified.'),'the scope note');
    assert.ok(!region.includes('data-area-go'),'no maximum over the markers drawn at Auckland scope');
    const board=name=>A.render(a,{kind:'board',title:`${name} local board`,board:{board_name:name,land_area_km2:10},sample:true,maxima:D,base:'.'});
    const ora=board('Orakei');
    assert.ok(ora.includes('Species maxima · Ōrākei')&&ora.includes(`href="./maxima.html?area=${encodeURIComponent('Ōrākei')}"`)&&ora.includes('data-area-tree="T2GJBWHP"'),'a board: its own maxima and the list filtered to it');
    assert.ok(ora.indexOf('Species maxima')<ora.indexOf('Markers drawn inside the board')&&!ora.includes('data-area-go="tallest"'),'a board at a sample zoom: maxima first, no sample superlatives');
    assert.ok(board('Maungakiekie-Tāmaki').includes('No clear lead in Maungakiekie-Tāmaki: each species maximum there is within the margin of the next measured tree.'),'a board with near-ties only');
    assert.ok(board('Henderson-Massey').includes('None for Henderson-Massey in this release. Species maxima are ranked for Auckland and in Maungakiekie-Tāmaki and Ōrākei local boards.'),'a board without maxima says so');
    const zoomed=A.render(a,{kind:'board',title:'x',board:{board_name:'Ōrākei'},sample:false,maxima:D});
    assert.ok(zoomed.includes('<dt>Tallest in this view</dt>')&&zoomed.includes('Species maxima · Ōrākei'),'a board at zoom 16+: its maxima and the view superlatives, scoped');
    assert.ok(!A.render({count:0},{kind:'region',title:'Auckland',totals:{markers:1},maxima:null}).includes('Species maxima'),'no card before maxima.json loads');
    // The map passes the maxima to both scopes, redraws Area when they load, opens a listed tree and rings the set.
    const mapSrc=(require('node:fs').readFileSync(web+'index.html','utf8')+require('node:fs').readFileSync(web+'map-app.js','utf8'));
    assert.ok(mapSrc.includes('totals: areaTotals(), maxima, base: SITE_ROOT,')&&mapSrc.includes('sample: map.getZoom() < 16, maxima, base: SITE_ROOT,'),'Area scopes get the maxima');
    assert.ok(mapSrc.includes('if (areaScope === "region" || areaScope === "board") renderArea();'),'Area redrawn when maxima.json loads');
    assert.ok(/if \(mt\) \{ openTreeByNumber\(mt\.dataset\.areaTree, Number\(mt\.dataset\.lon\), Number\(mt\.dataset\.lat\)\); return; \}/.test(mapSrc)&&/state\.maximaArea = ma\.dataset\.areaMaxima; state\.onlyMaxima = true;/.test(mapSrc),'Area maxima: open a tree, ring the set');
  }
  // The typeface: fonts.css names files that ship in web/fonts (with the licence), and every page that
  // preloads a font preloads the upright file fonts.css uses, so the preload is never a second download.
  const fs=require('node:fs');
  const fontsCss=fs.readFileSync(web+'fonts.css','utf8'),urls=[...fontsCss.matchAll(/url\("([^"]+)"\)/g)].map(m=>m[1]);
  assert.ok(urls.length===2&&urls.every(u=>fs.existsSync(web+u)),`fonts.css files: ${urls}`);
  assert.ok(fs.existsSync(web+'fonts/Inter-LICENSE-OFL.txt'),'the Inter licence ships with the fonts');
  for(const page of ['index.html','tree.html','v5-methods.html','v51-methods.html','v52-methods.html','v6-methods.html','v61-methods.html','v62-methods.html','v63-methods.html']){
    const html=fs.readFileSync(web+page,'utf8'),pre=html.match(/<link rel="preload" href="\.\/([^"]+)" as="font"[^>]*crossorigin>/);
    assert.ok(pre&&pre[1]===urls[0]&&html.includes('fonts.css'),`${page}: preloads ${pre&&pre[1]}, fonts.css uses ${urls[0]}`);
  }
  // A11Y-03: keyboard focus on a map canvas is a two-tone ring drawn inside it (the map clips anything outside), on the
  // map and the tree page's inset map; one of its two colours stands at 3.6:1 or more against any pixel, so against the light basemap
  // and aerial imagery (also measured next to the ring on the v6.2 preview, 14 Oct 2026); both canvases describe their keys.
  {
    const ui=fs.readFileSync(web+'alto-ui.css','utf8'),tok=fs.readFileSync(web+'tokens.css','utf8'),idx=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8')),tp=fs.readFileSync(web+'tree-page.js','utf8');
    assert.ok(ui.includes('.maplibregl-map .maplibregl-canvas:focus-visible { outline: 3px solid var(--alto-green-800); outline-offset: -3px; }'),'canvas focus: outline inside the canvas');
    assert.ok(ui.includes('.maplibregl-map .maplibregl-canvas-container:has(> .maplibregl-canvas:focus-visible)::after { content: ""; position: absolute; inset: 3px; z-index: 1; box-shadow: inset 0 0 0 2px var(--neutral-0); pointer-events: none; }'),'canvas focus: the inner ring');
    const hex=name=>{const m=new RegExp(`--${name}: (#[0-9a-f]{6});`,'i').exec(tok);return [1,3,5].map(i=>parseInt(m[1].slice(i,i+2),16));};
    const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
    const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
    const green=hex('alto-green-800'),white=hex('neutral-0');
    assert.ok(ratio(green,white)>=3,'the two rings differ by 3:1 or more');
    // Contrast depends on luminance only, so a grey ramp covers every pixel colour the map can show.
    let worst=99;for(let v=0;v<256;v++){const bg=[v,v,v];worst=Math.min(worst,Math.max(ratio(green,bg),ratio(white,bg)));}
    assert.ok(worst>=3.6,`ring against any pixel: ${worst.toFixed(2)}`);
    for(const bg of [[208,207,212],[68,111,92],[46,61,29],[170,160,140],[30,22,11]])assert.ok(Math.max(ratio(green,bg),ratio(white,bg))>=3.6,`ring against ${bg}`);
    assert.ok(idx.includes('<p id="mapKeys" class="sr-only">Arrow keys move the map; plus and minus zoom; search finds a tree by number, address or species.</p>')&&idx.includes('map.getCanvas().setAttribute("aria-describedby", "mapKeys");'),'map canvas: key description');
    assert.ok(tp.includes("mini.getCanvas().setAttribute('aria-describedby','miniMapDesc');"),'tree page inset map canvas: key description');
    // FE-04: the first map view reads only the points' and crowns' archives; the others join the style when first used.
    assert.ok(idx.includes('const DEFERRED_SOURCES = ["akl-near-canopy", "akl-low-canopy", "akl-change", "akl-rootshape", "akl-properties"];'),'deferred archives');
    assert.ok(/function styleFor\(key\) \{\s*const style = fullStyleFor\(key\), drop = new Set\(DEFERRED_SOURCES\.filter\(id => !activeSources\.has\(id\)\)\);\s*for \(const id of drop\) delete style\.sources\[id\];\s*style\.layers = style\.layers\.filter\(layer => !drop\.has\(layer\.source\)\);/.test(idx),'styleFor leaves out archives not yet used, with their layers');
    assert.ok(idx.includes('map.addLayer(layer, order.slice(order.indexOf(layer.id) + 1).find(next => map.getLayer(next)));'),'added layers keep the full style\'s order');
    for(const [cond,id] of [['state.showLowBand || state.showSubBand','akl-near-canopy'],['state.showLowCanopy','akl-low-canopy'],['state.showChange','akl-change'],['state.showRootZone','akl-rootshape'],['state.showProperties || state.showLandType','akl-properties']])
      assert.ok(idx.includes(`if (${cond}) ensureSource("${id}");`),`applyFilters adds ${id} when its layer is on`);
    assert.ok(/async function openProperty\(pid, address = null, options = \{\}\) \{\s*if \(!pid\) return;\s*pid = String\(pid\);\s*ensureSource\("akl-properties"\);/.test(idx),'a property opening adds the parcels');
    // FE-09: on a phone the map's controls ride above the sheet by transform (from the sheet's peek height in CSS, the slim
    // bar's --sheet-bar), and the attribution is folded from the start, so nothing moves as the archives arrive; the tree
    // page keeps a screen's height until its record has rendered.
    {const mcss=fs.readFileSync(web+'map.css','utf8'),tcss=fs.readFileSync(web+'tree-instrument-page.css','utf8');
      assert.ok(mcss.includes('.maplibregl-ctrl-bottom-right { bottom: 0; transform: translateY(calc(-1 * var(--sheet-clear, var(--sheet-bar)))); transition: transform 260ms var(--ease-standard); }'),'bottom-right controls move by transform');
      assert.ok(mcss.includes('.maplibregl-ctrl-bottom-left { bottom: 0; transform: translateY(calc(-1 * (var(--sheet-clear, var(--sheet-bar)) + var(--scale-lift, 0px)))); transition: transform 260ms var(--ease-standard); }'),'bottom-left controls move by transform');
      assert.ok(!/maplibregl-ctrl-bottom-(?:right|left) \{ bottom: calc\(var\(--sheet-clear/.test(mcss),'no control moves by its bottom edge');
      assert.ok(idx.includes('fold();\n      map.on("styledata", fold); map.on("sourcedata", fold); map.on("resize", fold);')&&idx.includes('a?.querySelector(".maplibregl-ctrl-attrib-button")?.addEventListener("click", () => { opened = true; });'),'attribution folded from the start until the reader opens it');
      assert.ok(tcss.includes('body:not([data-ready="true"]) .ti-main { min-height: 100vh; min-height: 100dvh; }'),'tree page: main keeps a screen height until ready');}
    // A11Y-15: "/" moves to the search box only from the map panel or the map canvas; Ctrl or Cmd K from anywhere.
    assert.ok(idx.includes('const onMap = explorer.contains(event.target) || !!event.target.matches?.("#map .maplibregl-canvas");')&&idx.includes('const slash = event.key === "/" && onMap && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;'),'slash: map panel and canvas only');
    assert.ok(idx.includes('const commandK = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k";'),'Ctrl/Cmd K unchanged');
    assert.ok(idx.includes('" Press / on the map or in this panel, or Ctrl K, to come back here."'),'the hint says where / works');
  }
  // Change since 2013 v1 (tool 0.2.3): its own file name and revision (the screened tree_change.pmtiles is served as
  // immutable and stays on the host for rollback), no "(experimental)" label, and a removal popup that says what the
  // 2024 survey shows where the crown stood.
  const map=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8'));
  assert.ok(map.includes('url: MAP_SOURCES.archive("tree_change_v1", { rev: CHANGE_TILES_REV })')&&map.includes('const CHANGE_TILES_REV = "v1-20261013";')
    &&require(web+'map-sources.js').create({dataBase:'./data/',version:()=>'s1'}).archive('tree_change_v1',{rev:'v1-20261013'})==='pmtiles://./data/tree_change_v1.pmtiles?v=s1&rev=v1-20261013','change layer: v1 file and revision');
  assert.ok(!/\/tree_change\.pmtiles/.test(map)&&!/experimental/i.test(map),'change layer: no old file name, no "(experimental)"');
  const from=map.indexOf('    function changePopupHtml(p) {'),to=map.indexOf('    map.on("click", "tree-change"');
  const popup=new Function('safe','fmt','ALTOChangeLink',`${map.slice(from,to)}\nreturn changePopupHtml;`)(v=>v==null||v===''?'Unknown':String(v),(v,d,u)=>v==null?'Unknown':`${Number(v).toFixed(d??1)}${u??''}`,require(web+'change-link.js'));
  // FTA-16: a change with an ID offers its aerial photos and its permalink, between the rows and the notes.
  for(const h of [popup({fate:'removed_to_open',confidence:'high',h_2013:6,h_2016:6.5,cover_2024:'open',change_id:'16:BA31_1000_3040:28'}),popup({fate:'established_since_2013',h_2024:9,change_id:'cr:86'})]){
    assert.ok(h.includes('data-change-photos aria-haspopup="dialog">Aerial photos of this spot</button>')&&h.includes('data-change-link href="#">Link to this change</a>'),'change popup: photos and link');
    assert.ok(h.indexOf('popup-actions')<h.indexOf('popup-note'),'change popup: the actions come before the notes');
  }
  assert.ok(!popup({fate:'established_since_2013',h_2024:9}).includes('popup-actions'),'a change without an ID offers neither');
  const removal={fate:'removed_to_open',confidence:'high',h_2013:6,h_2016:6.5,h_2024:null,species:null};
  const built=popup({...removal,cover_2024:'built'}),open=popup({...removal,cover_2024:'open'}),older=popup(removal);
  assert.ok(/<span>2024 survey<\/span><span>No tree canopy; built over<\/span>/.test(built)&&!/bare ground|open ground/.test(built),'built-over removal');
  assert.ok(/<span>2024 survey<\/span><span>Open ground<\/span>/.test(open)&&!/built over/.test(open),'removal to open ground');
  assert.ok(/the 2024 survey shows open ground/.test(older)&&!/bare ground/.test(older),'a file without cover_2024 still reads');
  // SKP-08: canopy change, not felled trees; the cause is not known; confidence defined; grown canopy by its height rule.
  for(const h of [built,open,older])assert.ok(h.includes('<div class="popup-title">Canopy gone by 2024 · cause not known</div>')&&h.includes('Confidence: high when the canopy was in both the 2013 and 2016 surveys, was green in the earlier aerial photo and no building stands there in 2024; medium for any other change shown.')&&/<span>Confidence<\/span><span>High<\/span>/.test(h),'canopy gone: title and confidence');
  const grew=popup({fate:'established_since_2016',h_2024:7.2,cover_2024:'canopy'});
  assert.ok(grew.includes('<div class="popup-title">Grew into canopy since 2016</div>')&&grew.includes('No vegetation 2 m or taller here in 2016; 5 m or taller by 2024.'),'grew into canopy since 2016');
  assert.ok(popup({fate:'established_since_2013',h_2024:9}).includes('Grew into canopy since 2013'),'grew into canopy since 2013');
  const PAL=require(web+'palette.js'),CL=PAL.legend('change');
  assert.equal(CL.title,'Canopy change since 2013 (central isthmus only)');
  assert.deepEqual(PAL.rows('change').map(r=>r.label),['Canopy gone by 2024 (cause not known)','Grew into canopy since 2013 (under 2 m in 2013, 5 m or taller in 2024)','Grew into canopy since 2016 (under 2 m in 2016, 5 m or taller in 2024)']);
  assert.ok(CL.note.includes('Shows about 83,000 changes. In a blind check of 315 shown changes, 92% (88–95%) agreed with the reference labels from machine-learning image-interpretation models (two, with a third for disagreements; no field check). About 114,000 (91,000–137,000) more likely changes are not shown, mostly partial losses.'),'change legend note');
  const changeCopy=[CL.title,CL.note,...PAL.rows('change').map(r=>r.label),map.slice(from,to)].join(' ');
  assert.ok(!/confirmed|\bAI\b|Tree removed|New tree|removed/i.test(changeCopy.replace(/removed_to_open/g,'')),'change layer copy: no "confirmed", no "AI", no felled-tree wording');
  assert.ok(map.includes('showChangeExtent(state.showChange);')&&map.includes('const CHANGE_EXTENT_KM = [1749, 1766, 5907, 5925];')&&map.includes('label: "Extent of the 2013 and 2016 surveys", colour: tok("--neutral-700"), mark: "dashed-line"'),'change layer: the survey extent outlined and in the legend');
  {
    const a=map.indexOf('    const CHANGE_EXTENT_KM'),b=map.indexOf('    function showChangeExtent(on) {');
    const R2=require(web+'tree-record.js');
    const mk=meta=>new Function('releaseMetadata','ALTOTreeRecord',`${map.slice(a,b)}\nreturn {changeExtentKm,changeExtentFeature};`)(meta,R2);
    assert.deepEqual(mk({models:[{component:'tree_change',extent:'central isthmus (the 2013 and 2016 height models): 1749-1766 kE x 5907-5925 kN (NZTM)'}]}).changeExtentKm(),[1749,1766,5907,5925]);
    assert.deepEqual(mk({models:[{component:'tree_change',extent:'1740-1770 kE x 5900-5930 kN (NZTM)'}]}).changeExtentKm(),[1740,1770,5900,5930],'the extent follows the metadata');
    const ring=mk(null).changeExtentFeature().geometry.coordinates[0],sw=R2.nztm(...ring[0]),ne=R2.nztm(...ring[24]);
    assert.ok(ring.length===49&&Math.abs(sw[0]-1749000)<0.01&&Math.abs(sw[1]-5907000)<0.01&&Math.abs(ne[0]-1766000)<0.01&&Math.abs(ne[1]-5925000)<0.01,'extent corners in NZTM');
  }
  // TS-03: when the crown outline reaches the map after the panel, the dripline radius replaces the equal-area radius.
  assert.ok(/panelGeometry = g;\n\s+\/\/ The outline gives the dripline radius[^\n]*\n\s+ALTOTreeRecord\.extras\(full, \{ geometry: g \}\);\n\s+const metricsSection = profileBody\.querySelector\("#tpMetrics"\)\?\.closest\("section"\);\n\s+if \(metricsSection\) metricsSection\.outerHTML = ALTOTreePanel\.metrics\(full\);/.test(map),'TS-03: panel measurements redrawn with the outline');
  // TS-01: the map panel's schedule line takes the schedule's date and a group's item number from notable_facts.json,
  // read when a panel opens (not at map start): the part holding the panel's tree where the package splits the facts by
  // tree number (tool 0.2.12), else the whole file once; a later panel, or the maxima loader, keeps the facts.
  {
    const a=map.indexOf('    const scheduleFacts = new Map();'),b=map.indexOf('    function panelHtml(rec) {');
    assert.ok(a>0&&b>a,'TS-01: schedule facts loader on the map');
    assert.ok(map.includes('if (!D.facts && ALTOMaxima.current?.facts) D.facts = ALTOMaxima.current.facts;'),'TS-01: the maxima loader keeps facts already read');
    assert.ok(/if \(props\.tn\) loadScheduleFacts\(props\.tn\);\n\s+const quick = ALTOTreeRecord\.fromTile/.test(map)&&(map.match(/; completeScheduleLine\(requestId\);/g)||[]).length===2,'TS-01: facts requested when a panel opens; both renders complete the line');
    const loads=[],slot={innerHTML:'before'},facts={credits:{council_schedule_10:{as_at:'2026-06-04'}},trees:{}};
    const shardOf=n=>String(n||'').charAt(1)||'_';
    const M={current:null,shardOf,load:async(env,o)=>{loads.push(o);return {maxima:[],facts};}};
    const I={protectionLine:(rec,o)=>`${rec.number} ${o.facts?.credits?.council_schedule_10?.as_at||'no date'} ${o.cls}`};
    const panel={hidden:false},body={querySelector:sel=>sel==='.tp-sched'?slot:null};
    const f=new Function('releaseReady','ALTOMaxima','SITE_ROOT','TILE_VERSION','ALTOInstrument','profileBody','profilePanel',
      `let profileRequestId=1,panelRec={number:'TW9QK0A0'};\n${map.slice(a,b)}\nreturn {loadScheduleFacts,completeScheduleLine,set:(id,rec)=>{profileRequestId=id;panelRec=rec;}};`)(
      Promise.resolve({release:{dataset_version:'v'}}),M,'.','t',I,body,panel);
    f.completeScheduleLine(1);await f.loadScheduleFacts('TW9QK0A0');await new Promise(r=>setTimeout(r,0));
    assert.equal(slot.innerHTML,'TW9QK0A0 2026-06-04 ti-prot tp-prot','TS-01: the open panel line is redrawn with the facts');
    assert.equal(loads.length,1);assert.equal(loads[0].facts,true);assert.deepEqual(loads[0].trees,['TW9QK0A0'],'only the open tree’s facts asked for');assert.equal(M.current.facts,facts,'TS-01: facts kept for later panels');
    slot.innerHTML='kept';f.completeScheduleLine(2);await new Promise(r=>setTimeout(r,0));
    assert.equal(slot.innerHTML,'kept','TS-01: facts read once; a panel rendered after them needs no redraw');
    const M2={current:{facts:null},shardOf,load:async()=>{throw new Error('offline');}},slot2={innerHTML:'line without date'};
    const g=new Function('releaseReady','ALTOMaxima','SITE_ROOT','TILE_VERSION','ALTOInstrument','profileBody','profilePanel',
      `let profileRequestId=5,panelRec={number:'T1'};\n${map.slice(a,b)}\nreturn {loadScheduleFacts,completeScheduleLine};`)(
      Promise.resolve({}),M2,'.','t',I,{querySelector:()=>slot2},panel);
    g.completeScheduleLine(4);assert.equal(await g.loadScheduleFacts('T1'),null);await new Promise(r=>setTimeout(r,0));
    assert.equal(slot2.innerHTML,'line without date','TS-01: a facts file that cannot load leaves the line as it was');
  }
  // UX-18: a shared link (?tree=) says "Opening tree <n>…", reads its record before the map's tiles (the tile reads wait
  // for it, 8 s at most; the record files' schema is read alongside the number lookup), and centres and opens the panel
  // as soon as the record is in. Measured on the slow-phone profile: panel at about 9.5 s (24 s before, 28 s in 0.2.8).
  {
    const idx=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8')),td=fs.readFileSync(web+'tree-details.js','utf8');
    const proto=idx.indexOf('maplibregl.addProtocol("pmtiles", async (params, abort) => {\n      if (tilesHeld) await tilesHeld;');
    assert.ok(idx.indexOf('let tilesHeld = null;')>0&&proto>idx.indexOf('let tilesHeld = null;'),'tile reads wait while tilesHeld is set');
    const linked=idx.indexOf('const linkedTree = LINKED_TREE ? dataMetadataReady.then(async metadata => {\n      ALTOTreeDetails.prefetch(DATA_BASE, TILE_VERSION);');
    assert.ok(linked>0,'the record files\' schema is read alongside the number lookup');
    assert.ok(idx.includes('if (linkedTree) tilesHeld = Promise.race([linkedTree.catch(() => null), new Promise(r => setTimeout(r, 8000))]).then(() => { tilesHeld = null; });'),'held until the record is in (or failed), 8 s at most');
    assert.ok(idx.indexOf('if (linkedTree) tilesHeld')<idx.indexOf('const map = new maplibregl.Map({'),'held before the map asks for its first tile');
    assert.ok(idx.includes('document.getElementById("status").textContent = `Opening tree ${LINKED_TREE}…`;'),'the status line says which tree is opening');
    assert.ok(/function prefetch\(base,version\)\{return cached\(`\$\{base\}\/tree_details\/schema\.json\?v=\$\{encodeURIComponent\(version\)\}`\)\.catch\(\(\)=>null\);\}/.test(td)&&/const api=\{[^}]*\bprefetch\b/.test(td),'tree-details.js: prefetch reads the same schema URL load() does');
  }
  // Saved-trees comparison (0.2.9 wording, UX-16's "Compare your trees"): trees by tree number and species display name,
  // values rounded as on the tree page, benefits as a sensitivity scenario with its band, plain words for the height
  // measure; no record ID in a heading, no method ID, no "V5" and no amounts to the cent.
  {
    globalThis.window=globalThis;require(web+'alto-format.js');require(web+'species-names.js');
    const E=require(web+'tree-evidence.js'),F62=require('./fixtures/tree-records-v62.json');
    const recs=['TW9QK0A0','TSG2SSKH'].map(k=>F62.trees[k].record);
    const h=E.comparison(recs),head=h.slice(0,h.indexOf('</thead>')),vis=h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    assert.ok(head.includes('<span lang="mi">Tītoki</span>')&&head.includes('<small>Tree TW9QK0A0</small>')&&head.includes('Norfolk Island pine')&&head.includes('<small>Tree TSG2SSKH</small>'),head);
    assert.ok(!/akl_tree_/.test(head.replace(/<[^>]+>/g,' ')),'headings name trees by tree number');
    assert.ok(vis.includes('Benefits Estimate $320/yr · sensitivity scenario')&&vis.includes('Benefits band Estimate $230–$420/yr'),vis);
    assert.ok(vis.includes('Height 14.3 m')&&vis.includes('Height measure 2024 LiDAR survey, highest point of the crown')&&vis.includes('Record ID akl_tree_trp_ACCT0175194'),vis);
    assert.ok(!/not_release_eligible|valuation_v|V5 segmented|Titoki|Norfolk Island Pine|\d\.\d\d\b(?! ha)/.test(vis.replace(/akl_tree_\S+/g,'')),'no method IDs, old names or cents: '+vis);
    assert.ok(vis.includes('not run in i-Tree Eco'),'the benefit method in the note');
    assert.ok(/^"tree_number","record_id","name"/.test(E.csv(recs))&&E.csv(recs).includes('"TW9QK0A0","akl_tree_trp_ACCT0175194","Tītoki"'),'CSV leads with the tree number');
    // A flagged height (55 m or more, tree-record.js TALL_M) as the tree page gives it (SKP-03, 0.2.10): T6Z3DYC8's 79.9 m
    // with the caution, each estimate computed from it marked, the note saying what the flag means; the crown is
    // "outside the 2024 crown survey" as on its tree page; the tree beside it is unmarked.
    require(web+'tree-record.js');
    const fl=['TW9QK0A0','T6Z3DYC8'].map(k=>F62.trees[k].record),hf=E.comparison(fl),vf=hf.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    const caution='unusually tall for Auckland: possibly a power line, structure or noise; not used in rankings';
    assert.ok(vf.includes(`Height 14.3 m 79.9 m · ${caution}`),vf);
    assert.ok(vf.includes('Height measure 2024 LiDAR survey, highest point of the crown Earlier crown, outside the 2024 crown survey'),vf);
    for(const row of ['Trunk diameter','Benefits','Benefits band','Carbon stored','Carbon taken up a year']){
      const m=new RegExp(`<th scope="row">${row}<span class="badge-estimate">Estimate</span></th><td>([^<]*)</td><td>([^<]*)</td>`).exec(hf.replace(/ <span class="badge-estimate">/g,'<span class="badge-estimate">'));
      assert.ok(m&&!/flagged/.test(m[1])&&/ · flagged height$/.test(m[2]),`${row}: ${m&&m.slice(1).join(' | ')}`);
    }
    assert.ok(vf.includes('A flagged height is 55 m or more: unusually tall for Auckland, possibly a power line, structure or noise, and is not used in rankings. Estimates computed from it carry the same flag.'),vf);
    assert.ok(!E.comparison(recs).includes('flagged'),'no flag note without a flagged tree');
    assert.ok(E.csv(fl).includes(`"79.9 m · ${caution}"`)&&/ · flagged height"/.test(E.csv(fl)),'the CSV carries the flag too');
  }
  console.log('Tool v0.2.0: versions, IDs, sources/status/quality expressions, summary, panel, pictures, Area, typeface and change layer checks passed.');
})().catch(e=>{console.error(e);process.exit(1);});
