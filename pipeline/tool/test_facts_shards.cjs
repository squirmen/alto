// Offline checks for tool 0.2.12: notable facts read by tree number. Release 6.3's notable_facts.json is 1.4 MB, so the
// tool package also carries it split by the first character after T of the tree number (build_web_beta.py split_facts);
// a tree page and a map panel read the header and their tree's part only. A derived folder without the split (release
// 6.2's single file) is read whole, as before. Files are served through a stub fetch that records every request.
// Usage: node pipeline/tool/test_facts_shards.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['species-names.js','credits.js'])require(web+f);
const M=require(web+'species-maxima.js');
const D63='./derived/metro-2026.10.17-pointcloud-v6.3',D62='./derived/metro-2026.10.13-pointcloud-v6.2';
const files=new Map(),asked=[];
const serve=(u,o)=>files.set(u,JSON.stringify(o));
globalThis.fetch=async url=>{const u=String(url).replace(/\?v=.*$/,'');asked.push(u);const b=files.get(u);
  return {ok:!!b,status:b?200:404,json:async()=>JSON.parse(b)};};
const head={schema:'alto-notable-facts/1',release:'metro-2026.10.17-pointcloud-v6.3',links:{},credits:{council_schedule_10:{as_at:'2026-06-04'}},copy:{group_area:'Inside a Notable Group of Trees area'}};
const z={TZ69KK1G:{schedule:[{schedule:'866',name:'Pohutukawa'}]}},one={T162DYHP:{group_area:[{schedule:'1186'}]}};
serve(`${D63}/manifest.json`,{release:'metro-2026.10.17-pointcloud-v6.3',products:{species_maxima:'species_maxima/maxima.json',notable_facts:'species_maxima/notable_facts.json'}});
serve(`${D63}/species_maxima/maxima.json`,{schema:'alto-species-maxima/1',maxima:[]});
serve(`${D63}/species_maxima/notable_facts.json`,{...head,trees:{...z,...one}});
serve(`${D63}/species_maxima/notable_facts/index.json`,{...head,shards:{by:'tree number: the first character after T',path:'{shard}.json',keys:['1','Z'],trees:2}});
serve(`${D63}/species_maxima/notable_facts/Z.json`,{trees:z});
serve(`${D63}/species_maxima/notable_facts/1.json`,{trees:one});
serve(`${D62}/manifest.json`,{release:'metro-2026.10.13-pointcloud-v6.2',products:{species_maxima:'species_maxima/maxima.json',notable_facts:'species_maxima/notable_facts.json'}});
serve(`${D62}/species_maxima/maxima.json`,{schema:'alto-species-maxima/1',maxima:[]});
serve(`${D62}/species_maxima/notable_facts.json`,{...head,release:'metro-2026.10.13-pointcloud-v6.2',trees:z});
const env=dv=>({siteRoot:'.',metadata:{release:{dataset_version:dv}},version:'t'});
(async()=>{
  assert.deepEqual([M.shardOf('TZ69KK1G'),M.shardOf('t162dyhp'),M.shardOf(''),M.shardOf(null)],['Z','1','_','_']);
  // Release 6.3, one tree: the header and its part only, never the whole file.
  let D=await M.load(env('metro-2026.10.17-pointcloud-v6.3'),{facts:true,trees:['TZ69KK1G']});
  assert.deepEqual(Object.keys(D.facts.trees),['TZ69KK1G']);
  assert.deepEqual(D.facts.shardsRead,['Z']);
  assert.equal(D.facts.credits.council_schedule_10.as_at,'2026-06-04','the header comes with the part');
  assert.ok(asked.includes(`${D63}/species_maxima/notable_facts/Z.json`)&&!asked.includes(`${D63}/species_maxima/notable_facts.json`),asked.join('\n'));
  // Another tree reads its own part (the header is cached).
  asked.length=0;
  D=await M.load(env('metro-2026.10.17-pointcloud-v6.3'),{facts:true,trees:['T162DYHP']});
  assert.deepEqual([Object.keys(D.facts.trees),asked.filter(u=>/notable_facts/.test(u))],[['T162DYHP'],[`${D63}/species_maxima/notable_facts/1.json`]]);
  // Without tree numbers the whole file is read (as before).
  D=await M.load(env('metro-2026.10.17-pointcloud-v6.3'),{facts:true});
  assert.deepEqual(Object.keys(D.facts.trees).sort(),['T162DYHP','TZ69KK1G']);
  // Release 6.2's derived folder has no split: its single file, after one absent index.
  asked.length=0;
  D=await M.load(env('metro-2026.10.13-pointcloud-v6.2'),{facts:true,trees:['TZ69KK1G']});
  assert.deepEqual([Object.keys(D.facts.trees),D.facts.shardsRead],[['TZ69KK1G'],null]);
  assert.ok(asked.includes(`${D62}/species_maxima/notable_facts.json`));
  // The pages ask for their trees only.
  const page=fs.readFileSync(web+'tree-page.js','utf8'),app=fs.readFileSync(web+'map-app.js','utf8');
  assert.ok(page.includes("window.ALTOMaxima.load(env,{facts:true,trees:[rec.number].filter(Boolean)})"));
  assert.ok(app.includes('{ facts: true, trees: number ? [number] : null }')&&app.includes('if (props.tn) loadScheduleFacts(props.tn);'));
  const build=fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8');
  assert.ok(build.includes('facts = split_facts(out / \'derived\' / d.name, products)'),'the build splits every derived folder’s facts');
  console.log('notable facts checks passed (tool 0.2.12): one tree’s part on release 6.3, the whole file on release 6.2');
})().catch(e=>{console.error(e);process.exit(1);});
