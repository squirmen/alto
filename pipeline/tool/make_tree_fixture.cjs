// Writes pipeline/tool/fixtures/tree-records-v62.json: real release 6.2 records for the trees the 13 Oct 2026 challenge
// review names (tree numbers below), read from a local copy of the release's data folder through the same loaders the
// pages use (tree-id.js resolves the number, tree-details.js reads the record and the crown's map marker).
// Usage: node pipeline/tool/make_tree_fixture.cjs <data folder> [out] [more tree numbers...]
//   e.g. node pipeline/tool/make_tree_fixture.cjs /data/alto/working/alto_v62_20261013/preview/data
// Release 6.3 (tool 0.2.12): fixtures/tree-records-v63.json from the v6.3 preview data with the trees its new fields
// concern (V63_NUMBERS: height and record checks, group areas, Schedule 10 entries, the ODbL licence, a reviewer note).
'use strict';
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const NUMBERS=['TW9QK0A0','T3GH0GQC','TADY8HB7','TMCTT6X4','TZ69KK1G','TA2WKG3S','T162DYHP','TSG2SSKH','T8AF3AE9','TFB5RTYE','TH5A0EQY',
  'TWB0Q29B','T6Z3DYC8','T5D54076','TNQM3W9M','T47VMHR8','TSBAY0H7','T5JM9VFQ','T2J7B1S8','T318JMKK','T055W90F','TDCFW11G'];
// Release 6.3: a group-area-only crown (TNZ83787, Awanui Street), a 6.3 group-area flag (TA94PV1P), the ODbL licence on an
// OpenStreetMap record (TWNHFK3H), an under-5 m crown (TW3DESRB), a height to check (T7GNAD02), a height not plausible
// (TTSJF0D9), a kauri survey record (T6WZXT45) and a London plane whose Latin name 6.3 re-keys (TM4FXFWJ).
const V63_NUMBERS=['TNZ83787','TA94PV1P','TWNHFK3H','TW3DESRB','T7GNAD02','TTSJF0D9','T6WZXT45','TM4FXFWJ'];
(async()=>{
  const [dataDir,out=path.join(__dirname,'fixtures','tree-records-v62.json'),...more]=process.argv.slice(2);
  if(!dataDir)throw new Error('usage: make_tree_fixture.cjs <data folder> [out]');
  const metadata=JSON.parse(fs.readFileSync(path.join(dataDir,'..','release-metadata.json'),'utf8'));
  globalThis.fetch=async url=>{
    const p=path.join(dataDir,String(url).replace(/^\.\/data\//,'').replace(/\?.*$/,''));
    if(!fs.existsSync(p))return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)};
    const b=fs.readFileSync(p);return {ok:true,status:200,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
  };
  require(web+'tree-details.js');const Id=require(web+'tree-id.js'),TD=globalThis.ALTOTreeDetails;
  const opts={base:'./data',version:'fixture',metadata},trees={};
  let schema=null;
  const v63=/v6\.3/.test(String(metadata.release?.data_release||metadata.release?.dataset_version||''));
  for(const n of [...new Set([...NUMBERS,...(v63?V63_NUMBERS:[]),...more])]){
    const r=await Id.resolve(n,opts);
    if(!r.tree_id){console.warn('not found',n,r.status);continue;}
    const got=await TD.load('./data','fixture',r.tree_id);
    schema=schema||{version:got.schema.version??1,generated_utc:got.schema.generated_utc};
    const rec=got.record,rep=rec.datasets.identity?.current_primary_tree_id;
    const ids=[...new Set([rep,...(JSON.parse(rec.datasets.identity?.members_json||'[]')||[]).map(x=>x.tree_id)])].filter(x=>x&&x!==rec.tree_id);
    // The crown's map marker only (it holds the crown's estimates when this record does not); the count keeps the rest.
    const members=[];
    if(rep&&rep!==rec.tree_id){try{members.push((await TD.load('./data','fixture',rep)).record);}catch{}}
    // Datasets no page reads are left out to keep the fixture small (previous_services, previous_roots).
    for(const r of [rec,...members])for(const k of ['previous_services','previous_roots'])delete r.datasets[k];
    trees[n]={id:rec.tree_id,record:rec,members,memberCount:ids.length};
    console.log(n,rec.tree_id,Object.keys(rec.datasets).length,'datasets',ids.length,'members');
  }
  const meta={release:metadata.release,assembly:metadata.assembly,models:metadata.models.map(m=>({component:m.component,validation_status:m.validation_status??null,...(m.v5_transfer_validation?{v5_transfer_validation:m.v5_transfer_validation}:{})})),
    derived_products:metadata.derived_products,dataset:{headline_totals:metadata.dataset.headline_totals,current_map_markers:metadata.dataset.current_map_markers,crown_records:metadata.dataset.crown_records,tree_numbers:metadata.dataset.tree_numbers,
      ...(metadata.dataset.not_release_eligible_totals?{not_release_eligible_totals:metadata.dataset.not_release_eligible_totals}:{})},...(metadata.benefits?{benefits:metadata.benefits}:{})};
  const label=metadata.release?.data_release||'release',read=new Date().toISOString().slice(0,10);
  fs.writeFileSync(out,JSON.stringify({source:`${label} preview data (${metadata.release?.dataset_version}), read ${read}`,metadata:meta,schema,trees}));
  console.log('wrote',out,fs.statSync(out).size,'bytes');
})().catch(e=>{console.error(e);process.exit(1);});
