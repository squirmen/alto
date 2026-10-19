// Offline checks for tool 0.2.12, Species maxima on release 6.3 (P8's maxima.json version 2, notable_facts.json v2):
// the release leaves flagged crowns unranked (height or record-to-crown checks, Schedule 10 entries listing more trees
// than ALTO maps there), so the leaders P8 named (pōhutukawa crown area, willow myrtle and cherry height, tōtara height,
// jacaranda height) moved to unflagged trees; the tool never badges a flagged tree whatever a maxima file lists; the
// release's segmentation_cap flag and wording, its checks note and the names a species' records carry show on the list
// page; Recognition shows a group area in the release's words and a multi-tree Schedule 10 entry as the schedule lists it.
// Usage: node pipeline/tool/test_maxima_v63.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js','credits.js'])require(web+f);
const M=require(web+'species-maxima.js'),R=require(web+'tree-record.js');
const S63=require('./fixtures/species-maxima-v63-sample.json'),N63=require('./fixtures/notable-facts-v63-sample.json'),F63=require('./fixtures/tree-records-v63.json');
const visible=h=>String(h).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const build=n=>{const t=F63.trees[n];return R.assemble({id:t.id,record:t.record,schema:F63.schema,members:t.members,memberCount:t.memberCount,metadata:F63.metadata,env:{siteRoot:'.',dataBase:'./data',metadata:F63.metadata}});};

const D=M.prepare(S63,N63);
// ---- The leaders after the release's exclusions ----
{
  const real='/data/alto/working/alto_v63_20261017/derived/metro-2026.10.17-pointcloud-v6.3/species_maxima/maxima.json';
  const m=fs.existsSync(real)?JSON.parse(fs.readFileSync(real,'utf8')):S63;
  const trees=new Set(m.maxima.map(x=>x.tree));
  for(const gone of ['TZ69KK1G','TBBDCKDD','TR2C1BPY','TV6Y1C0D','TVPW0686'])assert.ok(!trees.has(gone),`${gone}: flagged in release 6.3, not ranked`);
  for(const lead of ['T055W90F','TBP9HT5R','TT4N1601','TF0X9T32','T80AX68X'])assert.ok(trees.has(lead),`${lead}: the new leader`);
  assert.match(m.copy.checks_note,/Crowns whose height or record-to-crown link is flagged in this release are not ranked\./);
}
// ---- Never badge a flagged tree ----
{
  // The new height leaders are near-ties (within the margin of the next measured tree): listed, never badged.
  for(const t of ['T055W90F','TBP9HT5R','TF0X9T32'])assert.equal(M.badge(D,t),null,`${t}: a near-tie has no badge`);
  assert.ok(M.badge(D,'TT4N1601'),'an unflagged clear lead is badged (cherry crown area)');
  assert.equal(M.badge(D,'TT4N1601',{flagged:true}),null);
  assert.equal(M.badgeHtml(D,'TT4N1601',{flagged:true}),'');
  assert.ok(M.recognition(D,'TT4N1601').rows.some(r=>r.key==='maximum'));
  assert.ok(!M.recognition(D,'TT4N1601',{flagged:true})?.rows.some(r=>r.key==='maximum'),'no maximum row for a flagged tree');
  // A maxima file listing a tree release 6.3 flags (TZ69KK1G: item 866 lists 2 trees, both Council points on its crown).
  const rec=build('TZ69KK1G');
  assert.equal(rec.maximaBlocked,true);
  const listed=M.prepare({...S63,maxima:[{measure:'max_crown_area',area:'Auckland',species:'Metrosideros excelsa',tree:'TZ69KK1G',value:395,margin:30,unit:'m²',n:2000,next:340,within_margin:false}],
    trees:{TZ69KK1G:{lon:174.77523,lat:-36.88815,board:'Albert-Eden',h:18.7,s:24,a:395,outline:[[0,0],[1,0],[1,1]]}}},N63);
  assert.ok(M.badgeHtml(listed,'TZ69KK1G'),'listed as a clear lead');
  assert.equal(M.badgeHtml(listed,'TZ69KK1G',{flagged:rec.maximaBlocked}),'','but never badged once the record carries a release 6.3 flag');
  for(const n of ['TWB0Q29B','T6Z3DYC8','T7GNAD02','T6WZXT45'])assert.equal(build(n).maximaBlocked,true,`${n}: flagged`);
  for(const n of ['TNZ83787','TWNHFK3H','TM4FXFWJ'])assert.equal(build(n).maximaBlocked,false,`${n}: not flagged`);
  const page=fs.readFileSync(web+'tree-page.js','utf8'),panel=fs.readFileSync(web+'tree-panel.js','utf8');
  assert.ok(page.includes("{id:'maxBadge',base:'.',flagged:!!rec.maximaBlocked}")&&page.includes('flagged:!!rec.maximaBlocked}):\'\';}'),'the tree page passes the flags');
  assert.ok(panel.includes('{panel:true,flagged:!!rec.maximaBlocked}'),'the map panel passes the flags');
}
// ---- The release's segmentation flag, checks note and names as recorded ----
{
  const cap=S63.maxima.find(m=>m.segmentation_cap===true);
  const rows=M.listRows(D,{measure:cap.measure,area:cap.area});
  assert.equal(rows.find(r=>r.tree===cap.tree).nearCap,true,'segmentation_cap read from the file');
  const spread={...cap,measure:'max_crown_spread',value:22,unit:'m',margin:1,segmentation_cap:true,within_margin:false};
  const Ds=M.prepare({...S63,maxima:[spread]},null);
  assert.ok(M.listRows(Ds,{measure:'max_crown_spread',area:cap.area})[0].nearCap,'a crown spread of a capped crown says so');
  assert.match(M.badge(Ds,cap.tree).text,/; crown at or near the 400 m² segmentation limit; the tree may be larger$/);
  const plane=M.listRows(D,{measure:S63.maxima.find(m=>m.species==='Platanus × hispanica').measure,area:S63.maxima.find(m=>m.species==='Platanus × hispanica').area}).find(r=>r.species==='Platanus × hispanica');
  assert.deepEqual(plane.recordedAs,['Platanus × acerifolia']);
  const pageJs=fs.readFileSync(web+'maxima-page.js','utf8');
  assert.ok(pageJs.includes("['Checks',D.copy.checks_note||")&&pageJs.includes('const v2=!!D.copy.checks_note;')&&pageJs.includes('class="mx-as">recorded as'),'the list page reads the file’s checks note, the release 6.3 exclusions and the names as recorded');
}
// ---- Recognition: a group area and a multi-tree Schedule 10 entry ----
{
  const g=M.recognition(D,'TNZ83787');
  const row=g.rows.find(r=>r.key==='group_area');
  assert.equal(visible(row.html),'Inside a Notable Group of Trees area: Schedule 10 item 1038, “Palms” (Auckland Unitary Plan; Council layer retrieved 4 Jun 2026). Whether this tree is one of the scheduled trees has not been established.');
  assert.ok(!g.rows.some(r=>r.key==='why'||r.key==='council_schedule'||r.key==='council_group'),'a group area is never a schedule entry or a reason ALTO highlights the tree');
  const s=M.recognition(D,'TZ69KK1G').rows.find(r=>r.key==='council_schedule');
  assert.equal(s.lines[0],'The schedule lists 2 trees for item 866, 317 Manukau Road, Epsom; its Council points lie on this crown, where ALTO maps one crown.');
  const k=M.recognition(D,'TMCTT6X4').rows.find(r=>r.key==='council_schedule');
  assert.equal(k.lines[0],'The schedule lists 2 trees for item 1186, 18 Kerr Street, Devonport.');
}
console.log('species maxima checks passed (tool 0.2.12, release 6.3): flagged trees never badged, the release’s cap flag, checks note and names, group areas and multi-tree entries in Recognition');
