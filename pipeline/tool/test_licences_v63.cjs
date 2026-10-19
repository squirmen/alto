// Offline checks for tool 0.2.12, release 6.3 licences (P6): a record derived from OpenStreetMap shows its ODbL licence
// (release 6.3's licence dataset, or the same terms for such a record in any release); the credits page shows the change
// layer as released, lists a source a data release first uses only once that release is live, and keeps the schedule
// wording accurate; the source catalogue (pipeline/base/config/sources.json) has a licence on every source.
// Usage: node pipeline/tool/test_licences_v63.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js','credits.js'])require(web+f);
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js');
const F62=require('./fixtures/tree-records-v62.json'),F63=require('./fixtures/tree-records-v63.json');
const build=(F,n,edit=null)=>{const t=F.trees[n],record=edit?edit(structuredClone(t.record)):t.record;return R.assemble({id:t.id,record,schema:F.schema,members:t.members,memberCount:t.memberCount,metadata:F.metadata,env:{siteRoot:'.',dataBase:'./data',metadata:F.metadata}});};
const visible=h=>h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

// ---- The ODbL line on an OpenStreetMap record (TWNHFK3H, node/8828910512) ----
{
  const rec=build(F63,'TWNHFK3H'),l=rec.lines.find(x=>x.key==='licence');
  assert.equal(l.text,'© OpenStreetMap contributors. This record is available under the Open Database Licence (ODbL) 1.0; ALTO’s noncommercial terms do not apply to it, and exports that contain it carry the ODbL’s share-alike condition.');
  assert.deepEqual(l.links.map(a=>a.href),['https://opendatacommons.org/licenses/odbl/1-0/','https://www.openstreetmap.org/copyright','https://github.com/squirmen/alto/blob/main/pipeline/base/scripts/fetch_osm_natural_trees.py']);
  assert.ok(fs.existsSync(path.join(__dirname,'..','base','scripts','fetch_osm_natural_trees.py')),'the method link names a script in this repository');
  const h=I.releaseLines(rec);
  assert.ok(visible(h).startsWith('Licence · © OpenStreetMap contributors.')&&h.includes('rel="noopener"'));
  // The same terms without the release 6.3 dataset (an OpenStreetMap record in release 6.2).
  const old=build(F63,'TWNHFK3H',r=>{delete r.datasets.licence;return r;}).lines.find(x=>x.key==='licence');
  assert.equal(old.text,l.text);
  // Records from other sources carry no licence line.
  for(const n of ['TZ69KK1G','TW9QK0A0','T6WZXT45'])assert.ok(!build(F63,n).lines.some(x=>x.key==='licence'),n);
  for(const n of Object.keys(F62.trees))assert.ok(!build(F62,n).lines.some(x=>x.key==='licence'),`6.2 ${n}`);
}

// ---- Sources and credits ----
const page=fs.readFileSync(web+'credits.html','utf8');
{
  assert.ok(page.includes('<p><strong>Change since 2013</strong> (map layer, version 1, released 13 Oct 2026) is ALTO’s comparison of the Auckland 2013, 2016–18 and 2024 LiDAR surveys'),'the change layer as released');
  assert.ok(page.includes('labels from machine-learning image-interpretation models, no field check'),'the check said as it was made');
  assert.ok(!/ALTO marks these trees Protected/.test(page),'TS-01: ALTO does not decide protection');
  assert.ok(page.includes('Auckland Council determines whether a tree is protected.')&&page.includes('a tree inside one is not thereby one of the scheduled trees'));
  assert.equal((page.match(/data-from-release="6\.3"/g)||[]).length,2,'two sources first used by release 6.3');
  assert.ok(/<li data-from-release="6\.3"><strong>Published maximum tree heights\.<\/strong>/.test(page));
  // The 11 accepted Latin names were checked against the iNaturalist taxonomy: one row, names only, with its date and link.
  assert.ok(/<li data-from-release="6\.3"><strong>iNaturalist taxonomy\.<\/strong>[^<]*<a href="https:\/\/www\.inaturalist\.org\/taxa">iNaturalist taxonomy<\/a> \(accessed 17 Oct 2026\)[^<]*This use is of names only\.<\/li>/.test(page),'the taxonomy row');
  // iNaturalist: listed for the palm check it is used in; the matching research product is not listed until it is used.
  assert.equal((page.match(/<li><strong>iNaturalist<\/strong>/g)||[]).length,1,'observations: the palm check’s row only');
  assert.ok(!/match(ed|ing)? .{0,40}iNaturalist|iNaturalist .{0,60}match/i.test(page),'no iNaturalist matching credit yet');
  assert.ok(!/\bAI\b|by hand|by eye|champion/i.test(visible(page)),'public wording');
  assert.ok(page.includes('<div><dt>Tool</dt><dd>0.2.12</dd></div>'));
}
// credits-page.js: the release 6.3 row is hidden while release 6.2 is live and listed from release 6.3.
async function rowHidden(metadata){
  const li={dataset:{fromRelease:'6.3'},hidden:false};
  const saved={document:globalThis.document,fetch:globalThis.fetch,root:globalThis.ALTO_SITE_ROOT};
  globalThis.document={querySelectorAll:sel=>sel==='[data-from-release]'?[li]:[]};
  let asked=null;globalThis.fetch=async url=>{asked=url;return metadata?{ok:true,json:async()=>metadata}:{ok:false};};
  globalThis.ALTO_SITE_ROOT='..';
  delete require.cache[require.resolve(web+'credits-page.js')];require(web+'credits-page.js');
  await new Promise(r=>setTimeout(r,10));
  Object.assign(globalThis,{document:saved.document,fetch:saved.fetch,ALTO_SITE_ROOT:saved.root});
  return {hidden:li.hidden,asked};
}
// ---- The source catalogue ----
{
  const cat=JSON.parse(fs.readFileSync(path.join(__dirname,'..','base','config','sources.json'),'utf8'));
  assert.ok(cat.sources.length>=30);
  for(const s of cat.sources)assert.ok(String(s.license||'').trim(),`${s.slug}: a licence`);
  assert.equal(cat.license_review?.release,'v6.3');
  assert.ok(!/\/Volumes\/|\/Users\//.test(JSON.stringify(cat)),'no local paths');
}
// ---- The beta build links the release methods pages at the site root ----
{
  const build=fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8');
  assert.ok(build.includes("re.sub(r'href=\"\\./(v\\d+-methods\\.html)'"),'v*-methods.html links follow the site root');
}
(async()=>{
  const a=await rowHidden(F62.metadata),b=await rowHidden(F63.metadata),c=await rowHidden(null);
  assert.deepEqual([a.hidden,b.hidden,c.hidden],[true,false,false],'hidden under 6.2, listed under 6.3, listed when the metadata cannot be read');
  assert.equal(a.asked,'../release-metadata.json','the live site’s data release');
  console.log('licence checks passed (tool 0.2.12, P6): ODbL on OpenStreetMap records, change layer as released, release 6.3 sources listed from release 6.3, catalogue licensed');
})().catch(e=>{console.error(e);process.exit(1);});
