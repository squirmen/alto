// Offline checks for tool 0.2.12, release 6.3 Notable Group of Trees areas (P5): the tree page and panel say "Inside a
// Notable Group of Trees area" in the release's words and never that the tree is scheduled or protected (TS-01); a tree
// the schedule line already places in that group gets no second line; the 229 areas are a map layer offered from release
// 6.3 (data/notable_group_areas.geojson), dashed, credited "Plans and Places, Auckland Council; CC BY 4.0" with a link.
// Usage: node pipeline/tool/test_group_areas_v63.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js','credits.js'])require(web+f);
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js'),VL=require(web+'view-link.js'),C=globalThis.ALTOCredits;
const F62=require('./fixtures/tree-records-v62.json'),F63=require('./fixtures/tree-records-v63.json');
const build=(F,n)=>{const t=F.trees[n];return R.assemble({id:t.id,record:t.record,schema:F.schema,members:t.members,memberCount:t.memberCount,metadata:F.metadata,env:{siteRoot:'.',dataBase:'./data',metadata:F.metadata}});};
const visible=h=>h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const read=f=>fs.readFileSync(web+f,'utf8');

// ---- The line: Keith's Awanui Street palms (TNZ83787), a 6.3 flag only ----
{
  const rec=build(F63,'TNZ83787'),h=I.protectionLine(rec),v=visible(h);
  assert.ok(h.includes('data-protection="unmatched"')&&h.includes('data-protection="group_area"'),'the schedule line, then the group-area line');
  assert.ok(v.includes('Inside a Notable Group of Trees area · Schedule 10 item 1038, “Palms” (Auckland Unitary Plan; Council layer retrieved 4 Jun 2026). Whether this tree is one of the scheduled trees has not been established.'),v);
  assert.ok(h.includes('href="https://www.arcgis.com/home/item.html?id=864f687d7d014aedb7e3dceaa797750e"'),'linked to Council’s layer');
  const g=visible(I.groupAreaLine(rec,null));
  assert.ok(!/\bprotected\b|Scheduled notable tree|Part of scheduled group/i.test(g),`TS-01: never a protection claim (${g})`);
  assert.equal(rec.identity.protectionStatus.status,'unmatched','the flag never sets protection');
  assert.ok(!rec.identity.badges.some(b=>b.key==='protected'),'no schedule badge');
}
// A 6.3 flag on a street crown (TA94PV1P, item 1382), and a tree the schedule already places in its group (T8AF3AE9):
// one statement each.
{
  assert.match(visible(I.protectionLine(build(F63,'TA94PV1P'))),/Inside a Notable Group of Trees area · Schedule 10 item 1382, “Totara \(12\)”/);
  const h=I.protectionLine(build(F63,'T8AF3AE9'));
  assert.ok(h.includes('data-protection="scheduled"')&&!h.includes('data-protection="group_area"'),'no second line beside the scheduled group');
}
// Release 6.2 records carry no group_area dataset: no line.
for(const n of Object.keys(F62.trees))assert.ok(!I.protectionLine(build(F62,n)).includes('group_area'),n);

// ---- The map layer ----
{
  const app=read('map-app.js'),html=read('index.html');
  assert.ok(/<label class="check" for="showGroupAreas" id="groupAreasToggle"[^>]*hidden>/.test(html),'offered only when the release ships it');
  assert.ok(html.includes('A tree inside an area is not thereby one of the scheduled trees.'));
  assert.ok(/"akl-group-areas": \{ type: "geojson", data: \{type: "FeatureCollection", features: \[\]\}, attribution: ALTOCredits\.MAP\.groupAreas \}/.test(app),'empty until switched on, credited');
  assert.ok(/id: "group-areas-line",\s*type: "line",\s*source: "akl-group-areas"/.test(app)&&/"line-dasharray": \[2\.5, 1\.5\]/.test(app),'a dashed outline');
  assert.ok(app.includes('if (state.showGroupAreas && groupAreasShipped) loadOverlay("akl-group-areas", "notable_group_areas.geojson");'),'read only from a release that ships the file');
  assert.ok(/ALTOFields\.atLeast\(metadata, 6\.3\)/.test(app),'release 6.3 and later');
  assert.ok(app.includes('label: "Schedule 10 group area", colour: tok("--color-protected"), mark: "dashed-line"'),'the legend names it, with the dash');
  assert.equal(VL.LAYERS.showGroupAreas,'groupareas','a shared view keeps it on');
  const v=VL.decode(new URLSearchParams('layers=groupareas'));
  assert.equal(v.layers?.showGroupAreas,true);
}
// ---- Credit, in the provider's words, linked ----
{
  const m=C.MAP.groupAreas;
  assert.ok(m.includes('Plans and Places, Auckland Council')&&m.includes('CC BY 4.0')&&m.includes('href="https://www.arcgis.com/home/item.html?id=864f687d7d014aedb7e3dceaa797750e"')&&m.includes('href="https://creativecommons.org/licenses/by/4.0/"'),m);
}
// The release file (when the v6.3 bundle is on this machine): 229 polygons, each with its Schedule 10 item.
{
  const f='/data/alto/working/alto_v63_20261017/deploy/alto_v63_upload_20261017/data/notable_group_areas.geojson';
  if(fs.existsSync(f)){const g=JSON.parse(fs.readFileSync(f,'utf8'));assert.equal(g.features.length,229);assert.ok(g.features.every(x=>/Polygon/.test(x.geometry?.type)));}
}
console.log('group area checks passed (tool 0.2.12, P5): the release line, never a protection claim, no duplicate; the dashed map layer from release 6.3, credited and linked');
