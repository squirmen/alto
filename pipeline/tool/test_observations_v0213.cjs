// Offline checks for tool 0.2.13: "iNaturalist records at this tree" (tree_inat) and the street-level Mapillary link
// (tree_streetview), each a derived product sharded by tree number. The licence of each iNaturalist record decides what
// the page may show; a release whose folder lacks a product says so; a tree with no entry is "none".
// Usage: node pipeline/tool/test_observations_v0213.cjs
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js','credits.js'])require(web+f);
const R=require(web+'tree-record.js');
const F63=require('./fixtures/tree-records-v63.json'),META=F63.metadata,ENV={siteRoot:'.',dataBase:'./data',metadata:META};
const build=n=>{const t=F63.trees[n];return R.assemble({id:t.id,record:t.record,schema:F63.schema,members:t.members,memberCount:t.memberCount,metadata:META,env:ENV});};
const fnv=s=>{let h=2166136261;for(const b of new TextEncoder().encode(s))h=Math.imul(h^b,16777619)>>>0;return h;};
const shard=n=>(fnv(n)%256).toString(16).padStart(2,'0');
(async()=>{
  const files=new Map(),serve=(u,o)=>files.set(u,JSON.stringify(o));
  const asked=[];
  globalThis.fetch=async url=>{asked.push(String(url));const body=files.get(String(url).replace(/\?v=.*$/,''));return {ok:!!body,status:body?200:404,arrayBuffer:async()=>new TextEncoder().encode(body||'').buffer};};
  const DV=META.release.dataset_version,D=`./derived/${DV}`,N='TZ69KK1G';
  const rec=build(N);
  assert.equal(rec.number,N);

  // Neither product in the release's folder: both say so, nothing is fetched beyond the manifest.
  serve(`${D}/manifest.json`,{release:DV,products:{}});
  await R.enrich(rec,ENV,{parts:['inat','streetview']});
  assert.equal(rec.inat.status,'not_published');
  assert.equal(rec.streetview.status,'not_published');
  R._internal.clearCache();

  serve(`${D}/manifest.json`,{release:DV,products:{tree_inat:'tree_inat/index.json',tree_streetview:'streetview/index.json'}});
  serve(`${D}/tree_inat/index.json`,{schema:'alto.tree-inat/1',release:DV,shards:256,path:'{shard}.json',source:{name:'iNaturalist',fetched:'2026-10-17'}});
  serve(`${D}/tree_inat/${shard(N)}.json`,{[N]:{n:12,r:[
    [111,'cc-by','2024-12','c',0,'Metrosideros excelsa','pōhutukawa','f','someone',null],
    [222,'cc0','2023-09','n',6,'Coprosma robusta','karamū',null,null],
    [333,'cc-by-nc',null,'n',4,null,null,null,null],
    [444,null,null,'m',9,null,null,null,null],
    [555,'none',null,'n',2,null,null,null,null]]}});
  serve(`${D}/streetview/index.json`,{schema:'alto.tree-streetview/1',release:DV,shards:256,path:'{shard}.json',licence:'Mapillary contributors, CC BY-SA 4.0',link:'https://www.mapillary.com/app/?pKey={id}&focus=photo'});
  serve(`${D}/streetview/${shard(N)}.json`,{[N]:['1234567890','2019-03-02','p',12.3,-8,'987','2024-11-05',9.1]});
  await R.enrich(rec,ENV,{parts:['inat','streetview']});

  const x=rec.inat;
  assert.equal(x.status,'ready');
  assert.equal(x.count,12,'the total matched, beyond the ten listed');
  const [a,b,c,d]=x.records;
  assert.deepEqual([a.facts,a.taxon,a.common,a.login,a.licenceText,a.where,a.phenology],[true,'Metrosideros excelsa','pōhutukawa','someone','CC BY','inside this crown',['flowers']]);
  assert.match(a.monthText,/Dec 2024/);
  assert.equal(a.url,'https://www.inaturalist.org/observations/111');
  assert.deepEqual([b.facts,b.licence,b.login,b.where],[true,'cc0',null,'6 m from this crown'],'CC0: facts, no login');
  assert.deepEqual([c.facts,c.taxon,c.monthText,c.licenceText],[false,null,null,'CC BY-NC'],'NC: link only');
  assert.deepEqual([d.facts,d.licenceText,d.where],[false,'all rights reserved','9 m from this tree’s map position'],'no licence: all rights reserved, link only');
  const e=x.records[4];
  assert.deepEqual([e.facts,e.licence,e.licenceText],[false,null,'all rights reserved'],'iNaturalist "none" = all rights reserved, never "NONE"');
  assert.match(x.near,/^https:\/\/www\.inaturalist\.org\/observations\?lat=-?\d+\.\d{5}&lng=\d+\.\d{5}&radius=0\.05&taxon_id=47126$/);

  const v=rec.streetview;
  assert.equal(v.status,'ready');
  assert.equal(v.url,'https://www.mapillary.com/app/?pKey=1234567890&focus=photo');
  assert.deepEqual([v.pano,v.metres,v.offset,v.date.iso],[false,12.3,-8,'2019-03-02']);
  assert.deepEqual([v.newer.id,v.newer.url,v.newer.date.iso,v.newer.metres],['987','https://www.mapillary.com/app/?pKey=987&focus=photo','2024-11-05',9.1]);

  // A tree with no entry in its shard is "none", not an error.
  const other=build(Object.keys(F63.trees).find(k=>k!==N&&shard(k)!==shard(N))||N);
  if(other.number!==N){
    serve(`${D}/tree_inat/${shard(other.number)}.json`,{});serve(`${D}/streetview/${shard(other.number)}.json`,{});
    await R.enrich(other,ENV,{parts:['inat','streetview']});
    assert.equal(other.inat.status,'none');assert.equal(other.streetview.status,'none');
  }
  // A folder built for another release is not used.
  R._internal.clearCache();
  serve(`${D}/tree_inat/index.json`,{schema:'alto.tree-inat/1',release:'metro-2026.10.13-pointcloud-v6.2',shards:256,path:'{shard}.json'});
  const again=build(N);await R.enrich(again,ENV,{parts:['inat']});
  assert.equal(again.inat.status,'release_mismatch');
  // The derived folder ships inside the tool build and the site caches /derived/<release>/ for a year: every derived
  // file is asked for with the data stamp and the tool version.
  const derivedAsked=asked.filter(u=>u.includes('/derived/'));
  assert.ok(derivedAsked.length>0);
  for(const u of derivedAsked)assert.match(u,new RegExp(`\\?v=[^&]+\\.t${window.ALTOVersion.TOOL.version.replace(/\./g,'\\.')}$`),u);
  console.log('tool 0.2.13 observations: iNaturalist licence rules, Mapillary link and newer 360°, missing and mismatched products: ok');
})().catch(e=>{console.error(e);process.exit(1);});
