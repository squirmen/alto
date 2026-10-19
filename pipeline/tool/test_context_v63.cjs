// Offline checks for tool 0.2.12, "Among similar trees" on release 6.3's comparison tables (P8): groups count crown
// replacement bands and height classes (no irreplaceability classes) and the benefit metric is the stormwater-and-carbon
// value; a crown that is not classed, or whose height or record link is flagged, is not compared and the page says why.
// The tables are served through a stub fetch in the shape release 6.3's tree_context/comparisons.json has.
// Usage: node pipeline/tool/test_context_v63.cjs
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js','credits.js'])require(web+f);
const R=require(web+'tree-record.js');
const F63=require('./fixtures/tree-records-v63.json'),META=F63.metadata,ENV={siteRoot:'.',dataBase:'./data',metadata:META};
const build=n=>{const t=F63.trees[n];return R.assemble({id:t.id,record:t.record,schema:F63.schema,members:t.members,memberCount:t.memberCount,metadata:META,env:ENV});};
(async()=>{
  const files=new Map(),serve=(u,o)=>files.set(u,JSON.stringify(o));
  globalThis.fetch=async url=>{const body=files.get(String(url).replace(/\?v=.*$/,''));return {ok:!!body,status:body?200:404,arrayBuffer:async()=>new TextEncoder().encode(body||'').buffer};};
  globalThis.ALTOGround={board:async()=>({board_name:'Albert-Eden',canopy_cover_pct:20}),load:async()=>({visits:[]}),lead:()=>null,live:()=>null,init:()=>{}};
  const D=`./derived/${META.release.dataset_version}`;
  serve(`${D}/manifest.json`,{release:META.release.dataset_version,products:{tree_context:'tree_context/comparisons.json'},built_on:META.release.dataset_version});
  const probs=[0,10,20,30,40,50,60,70,80,90,95,99,99.5,99.9,100],qs=a=>probs.map((p,i)=>a[i]);
  const group=n=>({n,q:{height:qs([5,6,7,8,9,10,11,12,13,15,17,20,22,25,30]),crownArea:qs([5,10,15,20,30,40,50,70,90,130,170,260,300,380,600]),benefits:qs([1,3,5,8,10,14,18,24,32,45,60,95,110,140,300])},
    bands:{under_5y:100,'5_15y':200,'15_40y':300,'40_80y':250,'80y_plus':150},height_class:{very_small:50,small:200,medium:350,large:300,very_large:100}});
  serve(`${D}/tree_context/comparisons.json`,{schema:'alto.tree-context.comparisons/1',release:META.release.dataset_version,release_label:'v6.3',generated_utc:'2026-10-17T10:32:34Z',
    population:{description:'Crowns in this release with a benefit estimate and a crown replacement time, one per crown.',short:'classed crowns with a benefit estimate',n:1000},
    classes:{evergreen_broadleaf:'Evergreen broadleaf',conifer:'Conifer',palm_other:'Palm or palm-like'},class_field:'size.class_used (the published services class)',
    metrics:{height:{decimals:2},crownArea:{decimals:2},benefits:{label:'Estimated benefits (stormwater and carbon)',decimals:2}},probabilities:probs,
    auckland:{evergreen_broadleaf:group(1000),conifer:group(300),palm_other:group(400)},boards:{'Albert-Eden':{evergreen_broadleaf:group(500)}},
    counts_per_group:{bands:{keys:['under_5y','5_15y','15_40y','40_80y','80y_plus']},height_class:{keys:['very_small','small','medium','large','very_large']}},built_on:META.release.dataset_version});
  // TZ69KK1G: large, 80 years or more, compared on its stormwater-and-carbon value.
  const rec=build('TZ69KK1G');
  await R.enrich(rec,ENV,{parts:['context']});
  const c=rec.context;
  assert.equal(c.status,'ready',JSON.stringify(c).slice(0,300));
  assert.equal(c.class.key,'evergreen_broadleaf');
  const auck=c.scopes.find(s=>s.scope==='auckland');
  assert.ok(auck.irreplaceability.band,'the crown replacement band');
  assert.deepEqual([auck.irreplaceability.key,auck.irreplaceability.inClass,Math.round(auck.irreplaceability.shareAtOrAbove)],['80y_plus',150,15]);
  assert.deepEqual([auck.heightClass.key,Math.round(auck.heightClass.shareAtOrAbove)],['large',40],'large or very large: 400 of 1,000');
  assert.equal(auck.metrics.benefits.value,F63.trees.TZ69KK1G.record.datasets.benefits.benefit_value_nzd_y,'benefits = the headline');
  // Not classed (TW3DESRB, under 5 m) and flagged (TWB0Q29B: height to check, record may be a different tree): not compared.
  const nc=build('TW3DESRB');await R.enrich(nc,ENV,{parts:['context']});
  assert.deepEqual([nc.context.status,nc.context.note],['not_classed','Not classed: crown under 5 m tall. Crowns that are not classed are not compared.']);
  const fl=build('TWB0Q29B');await R.enrich(fl,ENV,{parts:['context']});
  assert.deepEqual([fl.context.status,fl.context.note],['excluded','Not compared: height to check; record and crown to check (left out of comparisons and Species maxima).']);
  const hc=build('T7GNAD02');await R.enrich(hc,ENV,{parts:['context']});
  assert.equal(hc.context.status,'excluded');
  console.log('release 6.3 comparison checks passed (tool 0.2.12): bands and height classes per group, the headline benefit, not classed and flagged crowns not compared');
})().catch(e=>{console.error(e);process.exit(1);});
