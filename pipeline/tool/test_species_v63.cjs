// Offline checks for tool 0.2.12, release 6.3 species names (P1, P6): the Species filter reads species_options.json
// version 2 (one option per species key, grouped by common name with each Latin name as a sub-option, filtering on the
// map's sp) and still reads release 6.2's list (common names, filtering on species_common); tree pages show the accepted
// Latin name where release 6.3 renames a species and keep the name as supplied; the kauri survey result reads release
// 6.3's survey dataset (DB-06) or release 6.2's codes in the name.
// Usage: node pipeline/tool/test_species_v63.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js','credits.js'])require(web+f);
const FD=globalThis.ALTOFields,N=globalThis.ALTOSpeciesNames,T=globalThis.ALTOTreeSummary;
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js');
const F62=require('./fixtures/tree-records-v62.json'),F63=require('./fixtures/tree-records-v63.json');
const S63=require('./fixtures/species-options-v63-sample.json'),S62=require('./fixtures/species-options-v62-sample.json');
const build=(F,n,props={})=>{const t=F.trees[n];return R.assemble({id:t.id,record:t.record,props,schema:F.schema,members:t.members,memberCount:t.memberCount,metadata:F.metadata,env:{siteRoot:'.',dataBase:'./data',metadata:F.metadata}});};

// ---- The filter's groups: release 6.3 ----
{
  const r=FD.speciesGroups(S63,N),by=l=>r.groups.find(g=>g.label===l);
  assert.equal(r.keyed,true);
  const cherry=by('Cherry');
  assert.deepEqual(cherry.subs.map(s=>s.key),['Prunus sp.','Prunus serrulata','Prunus serrula','Prunus × yedoensis'],'Cherry splits into four Latin names');
  assert.deepEqual(cherry.keys,cherry.subs.map(s=>s.key));
  assert.equal(cherry.count,cherry.subs.reduce((n,s)=>n+s.count,0));
  const kauri=by('Kauri');
  assert.deepEqual(kauri.subs.map(s=>[s.key,s.latin]),[['Agathis australis','Agathis australis'],['Kauri',null],['Agathis sp.','Agathis sp.']],'a common name without a Latin name is its own key');
  // "London Plane Tree" and "London Plane" are one species (species-names.js), under its accepted name.
  const plane=by('London plane');
  assert.ok(plane.names.includes('London Plane Tree')&&plane.subs.some(s=>s.key==='Platanus × hispanica'),JSON.stringify(plane));
  assert.ok(r.groups.some(g=>g.multi&&g.label==='Recorded as: Oak, Coral tree'),'a source string naming several species is its own group');
  assert.ok(by('Pōhutukawa'),'macrons');
  assert.deepEqual(FD.speciesExpr(new Set(['Prunus serrulata']),true),['match',['coalesce',['get','sp'],'__none__'],['Prunus serrulata'],true,false]);
}
// ---- Release 6.2: common names, as before ----
{
  const r=FD.speciesGroups(S62,N),cherry=r.groups.find(g=>g.label==='Cherry');
  assert.equal(r.keyed,false);
  assert.deepEqual([cherry.keys,cherry.subs],[['Cherry'],[]]);
  const kauri=r.groups.find(g=>g.label==='Kauri');
  assert.ok(kauri.keys.length>1&&kauri.keys.every(k=>/^Kauri/.test(k)),'the survey codes fold into Kauri');
  assert.deepEqual(FD.speciesExpr(['Cherry'],false),['match',['coalesce',['get','species_common'],'Unknown'],['Cherry'],true,false]);
}
// ---- The whole v6.3 list (when the preview data is on this machine): 1,028 options over 56,258 markers ----
{
  const f='/data/alto/working/alto_v63_20261017/deploy/alto_v63_upload_20261017/data/species_options.json';
  if(fs.existsSync(f)){
    const d=JSON.parse(fs.readFileSync(f,'utf8')),r=FD.speciesGroups(d,N);
    assert.equal(d.options.length,1028);
    const keys=new Set(r.groups.flatMap(g=>g.keys));
    assert.equal(keys.size,1028,'every option is reachable from a group');
    assert.equal(r.groups.reduce((n,g)=>n+g.count,0),56258,'counts add up to the markers with a species');
    assert.ok(!r.groups.some(g=>/soil:/i.test(g.label)),'no survey codes in a label');
  }
}
// ---- The map wiring ----
{
  const app=fs.readFileSync(web+'map-app.js','utf8');
  assert.ok(app.includes('if (d && d.version === 2 && Array.isArray(d.options) && d.options.length && d.common_names) {'),'version 2 read when the release ships it');
  assert.ok(app.includes('conditions.push(ALTOFields.speciesExpr(state.selectedSpecies, SPECIES_KEYED));'));
  assert.ok(app.includes('sub.dataset.speciesKey = s.key;')&&app.includes('function toggleSpeciesKey(k)'),'each Latin name its own option');
  assert.ok(app.includes('function speciesSelectionToKeys()'),'a 6.2 shared view’s common names become 6.3 keys');
}

// ---- Accepted names on tree pages (TM4FXFWJ, a London plane recorded as Platanus x acerifolia) ----
{
  const rec=build(F63,'TM4FXFWJ',{sp:'Platanus × hispanica',tree_id:F63.trees.TM4FXFWJ.id});
  assert.deepEqual([rec.identity.title,rec.identity.latin],['London plane','Platanus × hispanica']);
  assert.deepEqual(rec.species.recorded.name,{common:'London plane',latin:'Platanus × hispanica',latinAsSupplied:'Platanus x acerifolia'});
  assert.equal(rec.species.recorded.asSupplied,'London Plane Tree · Platanus x acerifolia','the name as supplied stays in the record');
  const page=fs.readFileSync(web+'tree-page.js','utf8');
  assert.ok(page.includes("kv('Latin name',N?N.latinHtml(r.name.latin):esc(r.name.latin),esc(`Accepted name (release 6.3), checked against the iNaturalist taxonomy; supplied as ${r.name.latinAsSupplied}`))"));
  // A key that only drops a cultivar keeps the recorded name; release 6.2 (no sp) is unchanged.
  const s=T.from({sp:'Prunus serrulata',species_common:'Cherry',species_latin:"Prunus serrulata 'Kanzan'",tree_id:'x'});
  assert.deepEqual([s.name.latin,s.name.latinAsSupplied],["Prunus serrulata 'Kanzan'",null]);
  assert.equal(build(F62,'TW9QK0A0').species.recorded.name?.latinAsSupplied??null,null);
}
// ---- The kauri survey result (TNQM3W9M) ----
{
  const c63=I.surveyCodes(build(F63,'TNQM3W9M')),c62=I.surveyCodes(build(F62,'TNQM3W9M'));
  assert.equal(c63.line,'Council kauri survey (Ruru ObsKauri Tiaki): Phytophthora agathidicida recorded; Phytophthora cinnamomi recorded; soil sample result: P. cinnamomi');
  assert.deepEqual([c63.release63,c63.credit,c63.flags],[true,'Bio Info Team, Environmental Services, Auckland Council',['PA+','PC+']]);
  assert.ok(/does not give a complete picture/.test(c63.caveat));
  assert.equal(c62.line,'Council kauri survey (Ruru ObsKauri Tiaki): result codes as supplied: PA+ PC+ soil: P. cinnamomi');
  assert.equal(build(F63,'TNQM3W9M').identity.title,'Kauri','the name reads Kauri (DB-06)');
}
console.log('species checks passed (tool 0.2.12, P1 and P6): the Latin-name filter of release 6.3 and the common-name filter of 6.2, accepted names with the name as supplied, the kauri survey result');
