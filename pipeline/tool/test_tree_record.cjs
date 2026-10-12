// Offline checks for web/tree-record.js (schema alto.tree-record/1) on real v6 development records
// (fixtures/tree-records-v6dev.json: a LiDAR detection, a Council register tree with its crown's other
// records, a scheduled notable tree) and small derived files served by a stub fetch.
// Usage: node pipeline/tool/test_tree_record.cjs
const assert=require('node:assert/strict');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
for(const f of ['version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js'])require(web+f);
const R=require(web+'tree-record.js');
const F=require('./fixtures/tree-records-v6dev.json');
const META={release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev',dataset_last_updated_utc:'2026-10-10T16:29:38+00:00',status:'research_only_not_independently_validated'},
  assembly:{tile_version:'20261011-v6-dev'},models:[{component:'crown_segmentation',validation_status:'not_independently_validated'},{component:'ecosystem_services',validation_status:'not_independently_validated'}],
  derived_products:{growth_form:'data/growth-form-v6.json'}};
const ENV={siteRoot:'.',dataBase:'./data',metadata:META};
const DET='akl_tree_pc5_ab98fbf0a5adf8128307',REG='akl_tree_trp_ACCT0245027',NOT='akl_tree_not_361';
const build=id=>R.assemble({id,record:F.trees[id].record,schema:F.schema,members:F.trees[id].members,memberCount:F.trees[id].memberCount,metadata:META,env:ENV});

// Every string in a record is plain text: presentations decide the markup.
function strings(o,out=[]){if(typeof o==='string')out.push(o);else if(Array.isArray(o))o.forEach(x=>strings(x,out));else if(o&&typeof o==='object')Object.values(o).forEach(x=>strings(x,out));return out;}
const QKINDS=new Set(['measured','recorded','model','derived','rule']);
function quantities(rec){return [...Object.values(rec.measures),...(rec.lidar?.measurements||[]),...rec.surveys.map(s=>s.height).filter(Boolean)];}

for(const id of [DET,REG,NOT]){
  const rec=build(id);
  for(const s of rec.surveys)assert.ok(s.position===null||(Number.isFinite(s.position.lon)&&Number.isFinite(s.position.lat)&&s.year!==2024),`survey ${s.year} position`);
  assert.equal(rec.schema,'alto.tree-record/1');
  assert.equal(rec.loaded,true);
  assert.equal(rec.id,id);
  // Method links open the methods page at the method's own section (the pages' stable anchors).
  const hrefs=new Map();(function walk(o){if(!o||typeof o!=='object')return;if(Array.isArray(o))return o.forEach(walk);if(o.href&&o.id)hrefs.set(o.id,o.href);Object.values(o).forEach(walk);})(rec);
  for(const [m,h] of hrefs){
    if(m==='pointcloud_v5_ndvi_watershed')assert.equal(h,'./v5-methods.html#crown-outline');
    if(m==='pointcloud_v4_vegetation_watershed')assert.equal(h,'./v5-methods.html#earlier-records');
    if(/^valuation_/.test(m))assert.equal(h,'./v5-methods.html#benefits');
  }
  // NDVI is a 0-1 index from the aerial imagery: two decimals, credited to the imagery (not the LiDAR survey).
  const ndvi=(rec.lidar?.measurements||[]).find(m=>m.key==='ndvi');
  if(ndvi&&ndvi.value!==null){assert.match(ndvi.text,/^-?\d\.\d\d$/,`NDVI text ${ndvi.text}`);assert.match(String(ndvi.provenance.source),/aerial imagery/,'NDVI source');}
  assert.equal(rec.release.data,'v6');
  assert.equal(rec.release.dev,true);
  assert.ok(rec.citation.includes(`Tree ${id}`));
  const json=R.toJSON(rec);
  assert.equal(json.summary,undefined,'internal fields stay out of the JSON copy');
  assert.equal(json._ctx,undefined);
  for(const s of strings(json))assert.ok(!/<[a-z\/]/i.test(s),`markup in a record string: ${s.slice(0,80)}`);
  // Quantities: a kind, a text and a provenance entry with a source each.
  for(const x of quantities(rec)){
    assert.ok(QKINDS.has(x.kind),`${x.key}: kind ${x.kind}`);
    assert.ok(typeof x.text==='string'&&x.text.length,`${x.key}: text`);
    assert.ok(x.provenance&&x.provenance.id&&x.provenance.source,`${x.key}: provenance`);
    assert.equal(x.provenance.release,'v6');
  }
  assert.deepEqual(rec.measureOrder,Object.keys(rec.measures));
  const ids=rec.provenance.map(p=>p.id);assert.equal(new Set(ids).size,ids.length,'provenance ids unique');
  // Model values are never measured values.
  for(const k of ['trunkDiameter','lifeStage','benefits','carbonStored','replacementYears'])if(rec.measures[k])assert.ok(['model'].includes(rec.measures[k].kind),`${k} is a model value`);
  assert.equal(rec.measures.height.kind,'measured');
  assert.equal(rec.measures.crownDiameter.kind,'derived');
  // KYTE task links name the tree, the task and the release the person saw (KYTE docs/REPORTS.md).
  assert.deepEqual(rec.know.map(k=>k.task),['species','age','removed','outline']);
  assert.ok(rec.know.every(k=>k.href===`./kyte/?tree=${encodeURIComponent(id)}&task=${k.task}&release=${encodeURIComponent(META.release.dataset_version)}`));
  assert.deepEqual(rec.know.map(k=>k.title),['Confirm or correct the species','Add the planting year or age','Report it removed','Flag the crown outline']);
  // Protection is said for every tree; "not protected" names what was checked.
  const ps=rec.identity.protectionStatus;
  assert.ok(['protected','not_protected'].includes(ps.status),`${id}: protection ${ps.status}`);
  assert.ok(ps.line.includes('Notable Trees schedule (Auckland Unitary Plan, Schedule 10)'),ps.line);
  if(ps.status==='not_protected')assert.ok(/as published in this release/.test(ps.line)&&/as published in this release/.test(ps.checked));
  // The record count beside "N records" counts the sources of those records only.
  const rb=rec.identity.badges.find(b=>b.key==='records');
  assert.equal(rb.sources,rec.identity.recordSources.length);
  // Trunk diameter: the central estimate of the release's two models, never the lowest; ranges never zero-width.
  const tdq=rec.measures.trunkDiameter,dd=F.trees[id].record.datasets,models=[dd.assets?.dbh_cm_crown_est,dd.services?.dbh_cm_est].filter(x=>x!=null);
  assert.equal(tdq.kind,'model');
  assert.ok(Math.abs(tdq.value-(Math.min(...models)+Math.max(...models))/2)<1e-9,`${id}: trunk ${tdq.value}`);
  assert.equal(tdq.range.label,'Trunk models');
  assert.equal(tdq.provenance.method.href,'./v5-methods.html#trunk-diameter');
  // A computed central value is not presented as a stored field; the stored fields are named in the note.
  assert.equal(tdq.provenance.field,null);assert.ok(/assets\.dbh_cm_crown_est/.test(tdq.provenance.note)&&/services\.dbh_cm_est/.test(tdq.provenance.note));
  assert.equal(rec.measures.rootProtection.provenance.field,null);
  // Root protection: 12 × the central trunk estimate, for every tree with a root-space scenario.
  const rp=rec.measures.rootProtection;
  assert.ok(rp&&rp.kind==='model',`${id}: root protection radius`);
  assert.ok(Math.abs(rp.value-0.12*tdq.value)<1e-9);
  assert.ok(Math.abs(rp.range.low-0.12*tdq.range.low)<1e-9&&Math.abs(rp.range.high-0.12*tdq.range.high)<1e-9);
  assert.ok(rec.roots&&Math.abs(rec.roots.rpaRadius-rp.value)<1e-9&&Math.abs(rec.roots.rpaArea-Math.PI*rp.value**2)<1e-6);
  assert.equal(rec.roots.stored.rpaRadius,dd.roots.rpa_radius_m);
  for(const x of quantities(rec))if(x.range)assert.notEqual(x.range.text.replace(/ .*$/,'').split('–')[0],x.range.text.replace(/ [^–]*$/,'').split('–')[1]?.replace(/ .*$/,''),`${id} ${x.key}: zero-width range ${x.range.text}`);
  for(const s of strings(R.toJSON(rec)))assert.ok(!/(\d[\d.,]*)–\1 (m|cm|m²)\b/.test(s),`zero-width range in "${s}"`);
  assert.deepEqual(rec.release.public,{text:'Release 11 Oct 2026 · Tool 0.2.1',preview:true});
  // Parts that need the network start as pending.
  for(const p of ['context','imagery','place','photos','scenario'])assert.equal(rec[p].status,'pending',p);
  assert.equal(rec.lidar.points.status,'pending');
  assert.equal(rec.history.status,'ready');
  assert.ok(rec.history.releases.some(r=>r.release==='v6'&&r.current),'the release on the page has a history row');
}

// A LiDAR detection: the detection is the crown; the growth form is a model value with its probability.
{
  const rec=build(DET);
  assert.equal(rec.identity.detection,true);
  assert.equal(rec.identity.category,'LiDAR-detected tree');
  // One record from one source (the growth-form model is not a source of records).
  assert.equal(rec.identity.badges.find(b=>b.key==='records').label,'1 record · 1 source');
  assert.equal(rec.identity.protectionStatus.status,'not_protected');
  assert.equal(rec.identity.protection,null);
  // A LiDAR-detected tree has no effective rooting radius, and keeps its root protection radius.
  assert.equal(rec.roots.effectiveRadius,null);
  assert.equal(rec.measures.trunkDiameter.text,'44 cm');
  assert.equal(rec.measures.trunkDiameter.range.text,'36–52 cm');
  assert.equal(rec.measures.rootProtection.text,'5.3 m');
  assert.equal(rec.measures.rootProtection.range.text,'4.3–6.3 m');
  assert.equal(Math.round(rec.roots.rpaArea),87);
  assert.equal(rec.identity.nameKind,'model');
  assert.equal(rec.records[0].self,true);
  assert.equal(rec.records[0].link.class,'detection');
  assert.equal(rec.measures.growthForm.kind,'model');
  assert.match(rec.measures.growthForm.provenance.uncertainty.text,/^Evergreen broadleaf 6[12]%/);
  assert.equal(rec.identity.growthForm.probabilities.filter(p=>p.top).length,1);
  assert.ok(rec.outline.smoothed&&rec.outline.smoothed.area>31);
  assert.equal(rec.species.growthFormStatus,'scored');
}
// A Council register tree on a shared crown: its record first, the crown's other records after it;
// the v4 crown and its redraw in v5 are in its history.
{
  const rec=build(REG);
  assert.equal(rec.identity.nameKind,'recorded');
  assert.equal(rec.measures.species.kind,'recorded');
  assert.equal(rec.measures.species.provenance.note,'As named by the source');
  assert.equal(rec.records[0].treeId,REG);
  assert.equal(rec.records[0].mapMarker,true);
  assert.equal(rec.records[0].link.class,'contained');
  assert.ok(rec.moreRecords>=0);
  assert.equal(rec.identity.protection.kind,'group');
  assert.equal(rec.identity.protection.approx,112);
  assert.equal(rec.identity.protectionStatus.line,'Scheduled group of about 112 trees: London Plane · Notable Trees schedule (Auckland Unitary Plan, Schedule 10)');
  assert.equal(rec.identity.protectionStatus.sentence,'Protected: part of a scheduled group of about 112 trees (London Plane) in the Notable Trees schedule (Auckland Unitary Plan, Schedule 10).');
  assert.equal(rec.identity.badges.find(b=>b.key==='records').label,`${rec.identity.recordCount} records · 2 sources`,'register and LiDAR detections; the schedule match is not a record');
  assert.equal(rec.measures.trunkDiameter.text,'37 cm');
  assert.equal(rec.measures.trunkDiameter.range.text,'36–38 cm');
  const v4=rec.history.releases.find(r=>r.release==='v4'),v5=rec.history.releases.find(r=>r.release==='v5');
  assert.equal(v4.crown.key,'3511932_11840418');
  assert.equal(v4.crown.area,134.5);
  assert.ok(v5.events.some(e=>e.kind==='resegmented'&&e.text==='Crown redrawn: 134.5 → 315.5 m²'));
  // Height range: the spread of this record's own estimates.
  assert.ok(rec.measures.height.range.low<rec.measures.height.value&&rec.measures.height.range.high>=rec.measures.height.value);
  assert.equal(rec.measures.benefits.kind,'model');
  assert.ok(rec.measures.benefits.range.text.includes('–'));
  const cols=rec.bySource.columns.map(c=>c.key);
  assert.ok(cols.includes('v5')&&cols.includes('v4')&&cols.includes('source'),cols.join());
}
// Setting: stored layers, each with provenance; flood and stormwater for the scheduled redwood.
{
  const rec=build(NOT);
  assert.equal(rec.setting.water.floodPlain,true);
  assert.equal(rec.setting.surface.radius,30);
  assert.ok(rec.setting.heat.airTempMean>15&&rec.setting.heat.airTempMean<25);
  for(const k of ['water','heat','surface','neighbourhood'])assert.ok(rec.setting[k].provenance.source,k);
  assert.ok(rec.provenance.some(p=>p.id==='p-setting-water'));
  assert.equal(build(DET).surveyChange,null);
}
// A scheduled notable tree: protection is a recorded value from the schedule.
{
  const rec=build(NOT);
  assert.equal(rec.identity.protection.kind,'tree');
  assert.equal(rec.identity.protectionStatus.line,'Scheduled tree: California Redwood · Notable Trees schedule (Auckland Unitary Plan, Schedule 10)');
  assert.equal(rec.identity.badges.find(b=>b.key==='records').label,'1 record · 1 source');
  assert.equal(rec.measures.protection.kind,'recorded');
  assert.equal(rec.measures.protection.provenance.source,'Auckland Unitary Plan, Schedule 10 Notable Trees');
  assert.equal(rec.measures.irreplaceability.kind,'rule');
}
// A map-tile record renders before the full record arrives.
{
  const rec=R.fromTile({tree_id:REG,source_primary:'tree_register_points',species_common:'London Plane Tree',crown_area_m2:315.5,crown_max_chm_m:16.85,owner_class:'Auckland Transport'},ENV);
  assert.equal(rec.loaded,false);
  assert.equal(rec.identity.title,'London Plane Tree');
  assert.deepEqual(rec.measureOrder,[]);
  // From a tile alone, protection is unknown unless the tile says it (never "not protected" by default).
  assert.equal(rec.identity.protectionStatus.status,'unknown');
  assert.equal(R.fromTile({tree_id:REG,is_protected_notable:0},ENV).identity.protectionStatus.status,'not_protected');
  assert.equal(R.fromTile({tree_id:REG,is_protected_notable:1,notable_group_names:'London Plane (approx. 112)'},ENV).identity.protectionStatus.status,'protected');
}
// No zero-width spreads: two height estimates that print the same give no range.
{
  const r=JSON.parse(JSON.stringify(F.trees[DET].record));
  r.datasets.pointcloud={...r.datasets.pointcloud,canopy_top_m:r.datasets.crown.crown_max_chm_m+0.02};
  const rec=R.assemble({id:DET,record:r,schema:F.schema,metadata:META,env:ENV});
  assert.equal(rec.measures.height.range,null);
  assert.ok(!/–/.test(rec.measures.height.provenance.uncertainty.text),rec.measures.height.provenance.uncertainty.text);
  // A KYTE tape measurement replaces the trunk models; the root protection radius follows it.
  R.setLive(rec,{diameter_cm:61.2,circumference_cm:192.3,observed_on:'2026-10-05'},ENV);
  assert.equal(rec.measures.trunkDiameter.kind,'measured');
  assert.ok(Math.abs(rec.measures.rootProtection.value-7.344)<1e-9);
  assert.equal(rec.measures.rootProtection.range,null);
}

// Percentiles from published quantiles: ties split evenly, interpolation between quantiles, both ends.
{
  const p=[0,25,50,75,100],q=[1,2,2,4,8];
  assert.equal(R.percentile(0.5,q,p),0);
  assert.equal(R.percentile(9,q,p),100);
  assert.equal(R.percentile(2,q,p),37.5);
  assert.equal(R.percentile(3,q,p),62.5);
  assert.equal(R.percentile(8,q,p),100);
  const e=R.exact(5,[1,3,5,5,9]);
  assert.deepEqual([e.rank,e.of],[2,5]);
  assert.equal(e.percentile,60);
  assert.deepEqual(R.tileOf(174.7494,-36.8512,14),{z:14,x:16145,y:9998});
  assert.equal(R.fnvShard('akl_tree_trp_ACCT0245027',4096).length,3);
}

// Derived files through a stub fetch: comparisons (Auckland, board, street), history lineage,
// corrections receipt and point crops; each says when it is missing or built for another release.
(async()=>{
  const files=new Map();
  const serve=(url,obj)=>files.set(url,JSON.stringify(obj));
  globalThis.fetch=async url=>{const key=String(url).replace(/\?v=.*$/,'');const body=files.get(key);
    return {ok:!!body,status:body?200:404,arrayBuffer:async()=>new TextEncoder().encode(body||'').buffer};};
  globalThis.ALTOGround={board:async()=>({board_name:'Waitematā',canopy_cover_pct:18.2}),load:async()=>({visits:[]}),lead:()=>null,live:()=>null,init:()=>{}};
  const D='./derived/metro-2026.10.11-pointcloud-v6-dev';
  const MANIFEST={release:META.release.dataset_version,products:{tree_context:'tree_context/comparisons.json',tree_history:'tree_history/index.json',tree_points:'tree_points/index.json',corrections_applied:'corrections-applied.json'}};
  const withManifest=()=>serve(`${D}/manifest.json`,MANIFEST);
  const probs=[0,10,20,30,40,50,60,70,80,90,95,99,99.5,99.9,100];
  const qs=a=>probs.map((p,i)=>a[i]);
  const group={n:1000,q:{height:qs([3,5,6,7,8,9,10,11,13,15,17,20,22,25,30]),crownArea:qs([5,10,15,20,30,40,50,70,90,130,170,260,300,380,600]),benefits:qs([1,3,5,8,10,14,18,24,32,45,60,95,110,140,300])},
    irr:{low:200,moderate:300,high:250,very_high:150,effectively_irreplaceable:100}};
  withManifest();
  serve(`${D}/tree_context/comparisons.json`,{schema:'alto.tree-context.comparisons/1',release:META.release.dataset_version,release_label:'v6 dev',generated_utc:'2026-10-11T00:00:00Z',
    population:{description:'Current crowns with a benefit estimate (one per crown)'},classes:{deciduous_broadleaf:'Deciduous broadleaf',evergreen_broadleaf:'Evergreen broadleaf',conifer:'Conifer'},
    metrics:{height:{decimals:2},crownArea:{decimals:2},benefits:{decimals:2}},
    probabilities:probs,auckland:{deciduous_broadleaf:group},boards:{'Waitematā':{deciduous_broadleaf:{...group,n:500}}},
    streets:{cell_path:'streets/cells/{z}/{x}/{y}.json',street_path:'streets/s/{shard}.json',shards:256,zoom:14,max_distance_m:60}});
  const t=R.tileOf(174.74944924642253,-36.851178440144515,14);
  serve(`${D}/tree_context/streets/cells/14/${t.x}/${t.y}.json`,{addresses:[[174.7495,-36.8512,300],[174.7600,-36.8600,1]]});
  serve(`${D}/tree_context/streets/s/2c.json`,{300:{name:'Franklin Road',board:'Waitematā',groups:{deciduous_broadleaf:{n:4,values:{height:[9.1,12.4,14,16.85],crownArea:[80,120,200,315.5],benefits:[20,40,80,537.9]}}}}});
  const rec=build(REG);
  const parts=[];
  await R.enrich(rec,ENV,{parts:['context','history','corrections','points'],onPart:p=>parts.push(p)});
  assert.deepEqual(parts.sort(),['context','corrections','history','points']);
  const ctx=rec.context;
  assert.equal(ctx.status,'ready');
  assert.equal(ctx.class.key,'deciduous_broadleaf');
  assert.deepEqual(ctx.scopes.map(s=>s.scope),['street','board','auckland']);
  const [street,board,akl]=ctx.scopes;
  assert.equal(street.name,'Franklin Road');
  assert.equal(street.n,4);
  assert.equal(street.metrics.height.exact,true);
  assert.equal(street.metrics.height.rank,1);
  assert.equal(street.metrics.height.text,'Tallest of 4');
  assert.equal(street.metrics.crownArea.text,'Largest crown of 4');
  assert.equal(street.metrics.benefits.rank,1,'a tree meets its own published (rounded) value');
  assert.equal(street.metrics.benefits.percentile,87.5);
  assert.equal(board.name,'Waitematā');
  assert.equal(board.n,500);
  assert.equal(akl.n,1000);
  assert.ok(akl.metrics.height.share>=90&&akl.metrics.height.share<95,String(akl.metrics.height.percentile));
  assert.equal(akl.metrics.height.text,`Taller than ${akl.metrics.height.share}%`);
  // Each comparison carries its distribution, for a strip: sorted values for a small street group, quantiles otherwise.
  assert.equal(street.metrics.height.distribution.kind,'values');
  assert.equal(street.metrics.height.distribution.values.length,4);
  assert.equal(akl.metrics.height.distribution.kind,'quantiles');
  assert.equal(akl.metrics.height.distribution.quantiles.length,akl.metrics.height.distribution.probabilities.length);
  assert.equal(akl.irreplaceability.key,'effectively_irreplaceable');
  assert.equal(Math.round(akl.irreplaceability.shareAtOrAbove),10);
  assert.equal(rec.history.lineageStatus,'not_published');
  assert.equal(rec.corrections.status,'none');
  assert.equal(rec.corrections.receiptStatus,'not_published');
  assert.equal(rec.lidar.points.status,'not_published');

  // Built for another release: not used.
  files.clear();R._internal.clearCache();withManifest();
  serve(`${D}/tree_context/comparisons.json`,{release:'metro-2026.10.10-pointcloud-v5.2',release_label:'v5.2',classes:{},probabilities:[]});
  const rec2=build(REG);await R.enrich(rec2,ENV,{parts:['context']});
  assert.equal(rec2.context.status,'release_mismatch');
  assert.equal(rec2.context.scopes.length,0);

  // Corrections receipt, history lineage and point crops.
  files.clear();R._internal.clearCache();withManifest();
  serve(`${D}/corrections-applied.json`,{release:META.release.dataset_version,generated_utc:'2026-10-11T08:00:00Z',ledger:'config/corrections',
    corrections:[{id:'C00001',type:'identity_link',status:'accepted',outcome:'applied',subject:{tree_id:REG},object:{crown:{seg_key:'pc_x',crown_set:'v5',as_of_release:'v5.2'}},
        decided_on:'2026-10-01',reviewer:'Reviewer',summary:'Register record joined to its crown',applied_in:['v5.2','v6']},
      {id:'C00002',type:'species_correction',status:'accepted',subject:{tree_id:'akl_tree_other'},summary:'Not this tree: akl_tree_trp_ACCT0245027 named only in the summary'},
      {id:'C00003',type:'outline_override',status:'accepted',outcome:'recorded_in_release',subject:{crown:{seg_key:'pc_BA31_1000_3650:1755978.75:5920216.25',crown_set:'v5',as_of_release:'v5.2'}},summary:'Outline redrawn'}]});
  serve(`${D}/tree_history/index.json`,{release:META.release.dataset_version,shards:256,path:'{shard}.json',releases:['v5.1','v5.2','v6'],changes:{became_rep:'became the map marker of its crown'}});
  serve(`${D}/tree_history/${R.fnvShard(REG,256)}.json`,{[REG]:[{release:'v5.1',change:'became_rep',moved_m:6.71}]});
  serve(`${D}/tree_points/index.json`,{release:META.release.dataset_version,format:'alto-points/1',subset:'Protected and record-linked trees',trees:{[REG]:{file:'p/x.bin',n:1500,bytes:10512}}});
  const rec3=build(REG);await R.enrich(rec3,ENV,{parts:['corrections','history','points']});
  assert.equal(rec3.corrections.status,'ready');
  assert.deepEqual(rec3.corrections.items.map(x=>x.id),['C00001','C00003']);
  assert.deepEqual(rec3.corrections.items[0].appliedIn,['v5.2','v6']);
  assert.equal(rec3.corrections.items[0].outcome,'applied');
  assert.equal(rec3.corrections.items[1].outcome,'recorded in release');
  assert.equal(rec3.history.lineageStatus,'ready');
  const v51=rec3.history.releases.find(r=>r.release==='v5.1');
  assert.equal(v51.events[0].text,'Became the map marker of its crown; its position on the map moved 6.7 m');
  assert.deepEqual(rec3.history.releases.map(r=>r.release),['v4','v5','v5.1','v6']);
  assert.equal(rec3.lidar.points.status,'ready');
  assert.equal(rec3.lidar.points.href,`${D}/tree_points/p/x.bin`);
  const rec4=build(DET);await R.enrich(rec4,ENV,{parts:['points']});
  assert.equal(rec4.lidar.points.status,'not_in_subset');

  // The receipt as release_tools/corrections_v6.py writes it (alto-corrections-applied/1), found through the
  // release metadata (derived_products.corrections_applied) with no tool manifest; the tree's own corrections
  // dataset lists the same correction once.
  files.clear();R._internal.clearCache();
  const META6={...META,derived_products:{...META.derived_products,corrections_applied:'data/corrections-applied.json'}},ENV6={...ENV,metadata:META6};
  serve('./data/corrections-applied.json',{schema:'alto-corrections-applied/1',ledger:'alto-corrections/1',release:META.release.dataset_version,release_version:'20261012-v6',
    generated_utc:'2026-10-12T02:00:00Z',corrections:[{id:'C00007',decision_id:'C00007',version:1,type:'species_correction',kind:'species_correction',status:'accepted',outcome:'recorded_in_release',
      reason:null,summary:'Species confirmed on a ground visit',decided_on:'2026-10-09',reviewer:'ALTO reviewer',evidence:['ground visit akl_tree_other'],applied_in:['20261012-v6'],
      tree_ids:[DET],roles:{[DET]:'subject'},seg_keys:[]},{id:'C00008',type:'identity_link',kind:'identity_link',status:'proposed',outcome:'awaiting_review',applied_in:[]}],by_tree:{[DET]:['C00007']}});
  const r6=JSON.parse(JSON.stringify(F.trees[DET].record));
  r6.datasets.corrections=[{id:'C00007',version:1,type:'species_correction',status:'accepted',outcome:'recorded_in_release',role:'subject',summary:'Species confirmed on a ground visit',decided_on:'2026-10-09',reviewer:'ALTO reviewer',evidence:'',reason:null}];
  const rec6=R.assemble({id:DET,record:r6,schema:F.schema,metadata:META6,env:ENV6});
  assert.equal(rec6.corrections.items.length,1,'the record lists its own corrections before the receipt is read');
  await R.enrich(rec6,ENV6,{parts:['corrections']});
  assert.equal(rec6.corrections.receiptStatus,'ready');
  assert.equal(rec6.corrections.receipt.url,'./data/corrections-applied.json');
  assert.deepEqual(rec6.corrections.items.map(x=>[x.id,x.outcome,x.basis]),[['C00007','recorded in release','ledger']]);

  // alto-points/1 decodes to metres from the crown top and the ground (a synthetic buffer for the codec).
  {
    const n=3,buf=new ArrayBuffer(16+n*9),v=new DataView(buf);
    [65,76,80,49].forEach((c,i)=>v.setUint8(i,c));v.setUint32(4,n,true);v.setFloat32(8,0.01,true);
    [[-150,0,250],[20,-35,0],[1200,800,1685]].forEach(([x,y,z],i)=>{v.setInt16(16+i*2,x,true);v.setInt16(16+2*n+i*2,y,true);v.setInt16(16+4*n+i*2,z,true);});
    [5,2,5].forEach((c,i)=>v.setUint8(16+6*n+i,c));
    const d=R.decodePoints(buf);
    assert.equal(d.n,3);
    assert.deepEqual([...d.z].map(z=>Math.round(z*100)/100),[2.5,0,16.85]);
    assert.deepEqual([...d.classification],[5,2,5]);
    assert.throws(()=>R.decodePoints(new ArrayBuffer(8)));
  }

  // Nearby trees and land type from map features.
  const rec5=build(REG);
  R.fromMap(rec5,{points:[{properties:{tree_id:'akl_tree_a',source_primary:'lidar_pointcloud_v5',crown_max_chm_m:10},geometry:{coordinates:[174.74950,-36.85120]}},
    {properties:{tree_id:'akl_tree_far',source_primary:'lidar_pointcloud_v5'},geometry:{coordinates:[174.76,-36.86]}},{properties:{tree_id:REG},geometry:{coordinates:[174.7494,-36.8511]}}],tileProps:{tenure:'street'}});
  assert.deepEqual(rec5.nearby.trees.map(t=>t.treeId),['akl_tree_a']);
  assert.equal(rec5.place.landType.key,'street');
  console.log('tree-record checks passed');
})().catch(err=>{console.error(err);process.exit(1);});
