// Offline checks for web/tree-record.js (schema alto.tree-record/1) on real v6 development records
// (fixtures/tree-records-v6dev.json: a LiDAR detection, a Council register tree with its crown's other
// records, a scheduled notable tree) and small derived files served by a stub fetch.
// Usage: node pipeline/tool/test_tree_record.cjs
const assert=require('node:assert/strict');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
for(const f of ['version.js','tree-id.js','credits.js','sources.js','growth-form.js','record-links.js','species-names.js','tree-summary.js'])require(web+f);
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
  // The citation names the tree by its recorded species when it has one ("London Plane Tree (tree …)", FTA-23).
  // Its position (the map pin, WGS84, 5 decimals) follows the name (LOC-01).
  const at=rec.identity.position?`, at ${rec.identity.position.lat.toFixed(5)}, ${rec.identity.position.lon.toFixed(5)} (WGS84)`:'';
  assert.ok(rec.identity.nameKind==='recorded'&&!rec.identity.nameMulti?rec.citation.includes(`${rec.identity.title} (tree ${id})${at}.`):rec.citation.includes(`Tree ${id}${at}.`)||rec.citation.includes(`Scheduled notable tree (tree ${id})${at}.`),rec.citation);
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
  // The Notable Trees schedule is said for every tree, as a schedule match or as no entry matched, with what ALTO does
  // not check; never "Not protected" (TS-01).
  const ps=rec.identity.protectionStatus,sw=R.scheduleWords(ps);
  assert.ok(['scheduled','unmatched'].includes(ps.status),`${id}: schedule status ${ps.status}`);
  assert.ok((sw.text+' '+sw.note).includes('Notable Trees schedule (Auckland Unitary Plan, Schedule 10'),sw.text);
  if(ps.status==='unmatched')assert.ok(/: no entry matched to this tree\.$/.test(sw.text)&&/^ALTO checks this schedule only\. Other Unitary Plan tree rules \(.*\) are not checked; Auckland Council determines whether a tree is protected\.$/.test(sw.note),sw.note);
  for(const t of strings(R.toJSON(rec)))assert.ok(!/\bNot protected\b|\bconsent\b/i.test(t),`${id}: "${t}"`);
  // The record count beside "N records" counts the sources of those records only.
  const rb=rec.identity.badges.find(b=>b.key==='records');
  assert.equal(rb.sources,rec.identity.recordSources.length);
  // Trunk diameter: the central estimate of the release's two models, never the lowest; ranges never zero-width.
  const tdq=rec.measures.trunkDiameter,dd=F.trees[id].record.datasets,models=[dd.assets?.dbh_cm_crown_est,dd.services?.dbh_cm_est].filter(x=>x!=null);
  assert.equal(tdq.kind,'model');
  assert.ok(Math.abs(tdq.value-(Math.min(...models)+Math.max(...models))/2)<1e-9,`${id}: trunk ${tdq.value}`);
  assert.equal(tdq.range.label,'Trunk models');
  // Release 6 explains both trunk models (the benefit-equation curve now follows the growth form) on its own page.
  assert.equal(tdq.provenance.method.href,'./v6-methods.html#trunk-diameter');
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
  assert.deepEqual(rec.release.public,{text:'Release 6 · 11 Oct 2026 · Tool 0.2.17.1',preview:true,number:'6',date:'11 Oct 2026'});
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
  assert.equal(rec.identity.protectionStatus.status,'unmatched');
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
  // The top class is named as the model's highest score, never as the tree's class (SKP-02).
  assert.match(rec.measures.growthForm.provenance.uncertainty.text,/^Highest model score: Evergreen broadleaf 6[12]%/);
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
  // The species in its display form (species-names.js); the source's own text kept as supplied (UX-09).
  assert.equal(rec.identity.title,'London plane');
  assert.equal(rec.measures.species.provenance.note,'As named by the source. As supplied: London Plane Tree');
  assert.equal(rec.records[0].treeId,REG);
  assert.equal(rec.records[0].mapMarker,true);
  assert.equal(rec.records[0].link.class,'contained');
  // The register record is credited with the copy ALTO uses (the Council's service now needs a token, so no link).
  assert.deepEqual(rec.records[0].credit,{text:'Auckland Council tree register (incl. Auckland Transport), retrieved June 2026',links:[]});
  assert.ok(rec.moreRecords>=0);
  assert.equal(rec.identity.protection.kind,'group');
  assert.equal(rec.identity.protection.approx,112);
  // A London plane inside the London Plane group is part of it (its species matches the group's name).
  const sw=R.scheduleWords(rec.identity.protectionStatus);
  assert.deepEqual([sw.status,sw.kind,sw.label],['scheduled','group','Notable Trees schedule']);
  assert.equal(sw.text,'Part of scheduled group, ‘London Plane (approx. 112)’');
  assert.equal(sw.note,'Notable Trees schedule (Auckland Unitary Plan, Schedule 10).');
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
  // A notable-tree record carries its own item number (TS-01: "Scheduled notable tree · Schedule 10 item <n> (<name>)").
  const sw=R.scheduleWords(rec.identity.protectionStatus);
  assert.deepEqual([sw.label,sw.text],['Scheduled notable tree','Schedule 10 item 1393 (California Redwood)']);
  assert.equal(rec.identity.badges.find(b=>b.key==='records').label,'1 record · 1 source');
  assert.equal(rec.measures.protection.kind,'recorded');
  assert.equal(rec.measures.protection.provenance.source,'Auckland Unitary Plan, Schedule 10 Notable Trees (Notable Trees Overlay, Plans and Places, Auckland Council; CC BY 4.0)');
  // Irreplaceability is a class rule over estimates, so an estimate itself, with the Estimate mark (FTA-11).
  assert.equal(rec.measures.irreplaceability.kind,'model');
  assert.equal(rec.measures.irreplaceability.rangeNote,'Range not computed in release 6');
}
// Each kind of model value resolves its own release component: the 2040 height scenario is the canopy height forecast,
// never the change layer, whose status is its photo check (SKP-17). Release 6.2's own metadata.
{
  const env={metadata:require('./fixtures/tree-records-v62.json').metadata};
  const want={crown:'crown_segmentation',growth:'growth_form_classifier',services:'ecosystem_services',roots:'root_space',change:'tree_change',forecast:'canopy_height_forecast'};
  for(const [k,c] of Object.entries(want))assert.equal(R.modelOf(env,k,'x').component,c,k);
  assert.equal(R.modelOf(env,'forecast','x').validation,'Geographic hindcast; transfer to release 5 not validated');
  assert.equal(R.modelOf(env,'change','x').validation,'Photo checked');
  assert.ok(!/photo/i.test(R.modelOf(env,'forecast','x').validation),'the forecast never borrows the change layer\'s photo check');
  assert.equal(R.modelOf(env,'services','valuation_v5_not_release_eligible').id,'valuation_v5','the raw id loses its "not release eligible" clause (SKP-05)');
}
// No public surface says "Not protected" (TS-01): ALTO checks the Notable Trees schedule only, so it never states a tree's
// legal status. Every page, script and stylesheet the site serves.
{
  const fs=require('node:fs'),files=fs.readdirSync(web).filter(f=>/\.(html|js|mjs|css)$/.test(f));
  for(const f of files)assert.ok(!/not protected/i.test(fs.readFileSync(web+f,'utf8')),`web/${f} says "Not protected"`);
  // The changelog page (built from CHANGELOG.md) is a public page too, its earlier entries included.
  assert.ok(!/not protected/i.test(fs.readFileSync(web+'../CHANGELOG.md','utf8')),'CHANGELOG.md says "Not protected"');
}
// One display name per species (UX-09): macrons and sentence case, lang="mi" on te reo names, Latin names with genus and
// epithets in italics, a cultivar in roman quotes and the hybrid sign in roman; the source's text stays as supplied.
{
  const N=globalThis.ALTOSpeciesNames,F62=require('./fixtures/tree-records-v62.json');
  const b=n=>{const t=F62.trees[n];return R.assemble({id:t.id,record:t.record,schema:F62.schema,members:t.members,memberCount:t.memberCount,metadata:F62.metadata,env:{siteRoot:'.',metadata:F62.metadata}});};
  const pz=b('TZ69KK1G');
  assert.equal(pz.identity.title,'Pōhutukawa');assert.equal(N.nameHtml(pz.identity.title),'<span lang="mi">Pōhutukawa</span>');
  assert.equal(pz.identity.asSupplied,'Pohutukawa','the source text as supplied');
  for(const [raw,shown] of [['Indian Bead Tree','Indian bead tree'],['London Plane Tree','London plane'],['London Plane','London plane'],['Norfolk Island Pine','Norfolk Island pine'],['NZ Kauri','NZ kauri'],['Titoki','Tītoki'],['puriri','Pūriri'],['Southern Magnolia','Southern magnolia']])assert.equal(N.display(raw),shown,raw);
  // One name for London plane on a tree page: its H1 (from "London Plane Tree"), the Species filter (both spellings in one
  // option) and Species maxima and Recognition, which name Platanus × acerifolia "London plane" (TF0TD1X1).
  assert.equal(N.key('London Plane Tree'),N.key('London Plane'));
  assert.equal(N.display('London Plane Tree',{lower:true}),'London plane');
  assert.equal(N.display('Monkey Apple Tree'),'Monkey apple');
  const ch=b('T5JM9VFQ');
  assert.equal(N.latinHtml(ch.identity.latin),'<i>Prunus serrulata</i> ‘Kanzan’','the cultivar in roman');
  // One name per species on a tree page and across the surfaces (0.2.10): a Latin name in the common-name field, a
  // reordered name, and a genus-only name beside its species' Latin name take the name Species maxima and Recognition
  // give the species (TMRKZ6G2 "Magnolia Grandiflora", TCS19WR1 "Lebanon Cedar", TT4N1601 "Cherry" with Prunus
  // serrulata, TXFCBKAW "Lime" with Tilia × europaea). The genus-only name beside another Latin name stays as it is.
  for(const [raw,latin,shown] of [['Magnolia Grandiflora','Magnolia grandiflora','Southern magnolia'],['Magnolia Grandiflora Little Gem',"Magnolia grandiflora 'Little Gem'",'Southern magnolia'],
    ['Lebanon Cedar','Cedrus libani','Cedar of Lebanon'],['Cherry','Prunus serrulata','Japanese flowering cherry'],['Cherry',"Prunus serrulata 'Kanzan'",'Japanese flowering cherry'],
    ['Lime','Tilia x europaea','Common lime'],['Lime','Tilia × europaea','Common lime'],['Cherry','Prunus sp.','Cherry'],['Cherry','Prunus serrula','Cherry'],['Cherry',"Prunus x yedoensis 'Awanui'",'Cherry'],
    ['Lime','Tilia platyphyllos','Lime'],['Cedar','Cedrus sp.','Cedar'],['Rata',null,'Rātā'],['Northern Rata',null,'Northern rātā']])
    assert.equal(N.display(raw,{latin}),shown,`${raw} beside ${latin}`);
  assert.equal(N.display('Magnolia Grandiflora'),'Southern magnolia','without the Latin name too (Species filter, search)');
  assert.equal(N.display('Cherry',{latin:'Prunus serrulata',lower:true}),'Japanese flowering cherry','inside a sentence Japanese keeps its capital');
  assert.equal(N.key('Cherry',{latin:'Prunus serrulata'}),N.key('Japanese flowering cherry'));
  assert.notEqual(N.key('Cherry',{latin:'Prunus sp.'}),N.key('Cherry',{latin:'Prunus serrulata'}));
  assert.equal(N.key('Magnolia Grandiflora'),N.key('Southern Magnolia'));
  assert.equal(N.nameHtml('Rata'),'<span lang="mi">Rātā</span>');
  assert.ok(N.splits('Cherry')&&N.splits('Lime Tree')&&!N.splits('Tītoki'));
  assert.equal(ch.identity.title,'Japanese flowering cherry','T5JM9VFQ: its H1 and title name the species its Species maxima population names');
  assert.equal(ch.identity.asSupplied,'Cherry','the source text as supplied');
  assert.equal(ch.measures.species.text,'Japanese flowering cherry');
  assert.ok(!/\bCherry\b/.test(ch.citation),ch.citation);
  // Every BY_LATIN name is the one Species maxima gives that species (the release's maxima.json, when it is here).
  const MX='/data/alto/working/tool_v02_proto/derived/metro-2026.10.13-pointcloud-v6.2/species_maxima/maxima.json';
  if(require('node:fs').existsSync(MX)){
    const M=JSON.parse(require('node:fs').readFileSync(MX,'utf8'));
    for(const [bn,sp] of Object.entries(N.BY_LATIN)){
      const k=Object.keys(M.species).find(x=>N.binomial(x)===bn);
      assert.ok(k,`${bn} in maxima.json`);assert.equal(N.display(M.species[k].name),N.display(sp),bn);
    }
  }
  assert.equal(N.latinHtml('Platanus x acerifolia'),'<i>Platanus</i> × <i>acerifolia</i>','the hybrid sign in roman');
}
// Kauri survey result codes are not part of a name (TS-14): no title, H1 or species option carries "soil:"; the
// species filter folds the 48 survey-code variants into one "Kauri" option (index.html buildSpeciesGroups, as here).
{
  const N=globalThis.ALTOSpeciesNames;
  for(const v of ['Kauri (PA+ PC+ soil:Nil)','Kauri (PA+ soil:P. cinnamomi)','Kauri (PC+ soil: Nil)']){
    assert.equal(N.display(v),'Kauri',v);assert.equal(N.key(v),N.key('Kauri'),v);assert.ok(N.codes(v),v);
  }
  const F62=require('./fixtures/tree-records-v62.json'),t=F62.trees.TNQM3W9M;
  const kr=R.assemble({id:t.id,record:t.record,schema:F62.schema,members:t.members,memberCount:t.memberCount,metadata:F62.metadata,env:{siteRoot:'.',metadata:F62.metadata}});
  assert.ok(!/soil:/.test(kr.identity.title)&&kr.identity.title==='Kauri',kr.identity.title);
  // Several species named in one string are not a species (TS-14), with or without commas; one species with a qualifier is.
  for(const n of ['Oak, Coral tree','Pohutukawa, Oak','London Plane Pohutukawa','Rimu Puriri','Pohutukawa and Rata','Puriri (2) Karaka (2)','Holm Oak. Karaka. Puriri'])
    assert.ok(N.isMulti(n),n);
  for(const n of ['NZ Kauri','South Queensland Kauri','Pohutukawa Tree','Norfolk Island Pine','London Plane Tree','Willow Peppermint Gum','Kauri (PA+ PC+ soil: Nil)'])
    assert.ok(!N.isMulti(n),n);
  const OPTS='/data/alto/working/alto_v62_20261013/preview/data/species_options.json';
  if(require('node:fs').existsSync(OPTS)){
    const options=JSON.parse(require('node:fs').readFileSync(OPTS,'utf8')).options,g=new Map();
    for(const [name,count] of options){
      if(!name||name==='Unknown')continue;
      const multi=N.isMulti(name),key=multi?'multi:'+name:N.key(name);
      if(!g.has(key))g.set(key,{label:multi?`Recorded as: ${name}`:N.display(name),count:0,names:[]});
      const x=g.get(key);x.count+=count;x.names.push(name);
    }
    const groups=[...g.values()];
    assert.ok(!groups.some(x=>/soil:/.test(x.label)),'no species option carries "soil:"');
    const kauri=groups.filter(x=>x.label==='Kauri');
    assert.equal(kauri.length,1,'one Kauri option');
    const coded=options.filter(([n])=>/soil:/.test(n));
    assert.equal(coded.length,48);assert.ok(coded.every(([n])=>kauri[0].names.includes(n)),'every survey-code variant is in it');
    console.log(`species options: ${groups.length} options from ${options.length} names; Kauri ${kauri[0].count} trees (${coded.reduce((a,[,c])=>a+c,0)} with survey codes)`);
  }
}
// A map-tile record renders before the full record arrives.
{
  const rec=R.fromTile({tree_id:REG,source_primary:'tree_register_points',species_common:'London Plane Tree',crown_area_m2:315.5,crown_max_chm_m:16.85,owner_class:'Auckland Transport'},ENV);
  assert.equal(rec.loaded,false);
  assert.equal(rec.identity.title,'London plane','the display form from the tile as well');
  assert.deepEqual(rec.measureOrder,[]);
  // From a tile alone, protection is unknown unless the tile says it (never "not protected" by default).
  assert.equal(rec.identity.protectionStatus.status,'unknown');
  assert.equal(R.fromTile({tree_id:REG,is_protected_notable:0},ENV).identity.protectionStatus.status,'unmatched');
  assert.equal(R.fromTile({tree_id:REG,is_protected_notable:1,notable_group_names:'London Plane (approx. 112)'},ENV).identity.protectionStatus.status,'scheduled');
}
// The schedule line's wordings (TS-01): no entry matched, with the rule for the tree's setting first (street: E17;
// park: E16); a scheduled tree by its item number; a group member whose species is not the group's.
{
  const facts={credits:{council_schedule_10:{as_at:'2026-06-04'}},trees:{T0000001:{schedule:[{schedule:'297',name:'Norfolk Island Pine'}]},
    T0000002:{group:[{schedule:'1301',name:'English Oaks (approx. 20)'}]},T0000003:{group:[{schedule:'1302',name:'Pin Oaks (approx. 9)'}],held_schedule:['1302']}}};
  const un=R.scheduleWords({status:'unmatched'},{facts});
  assert.equal(un.text,'Notable Trees schedule (Auckland Unitary Plan, Schedule 10, as published 4 Jun 2026): no entry matched to this tree.');
  assert.equal(un.label,null);
  const rules=w=>w.note.match(/\(([^)]*)\)/)[1];
  assert.equal(rules(R.scheduleWords({status:'unmatched'},{tenure:'street'})),'trees in roads E17, open space zones E16, overlays','street: E17 first');
  assert.equal(rules(R.scheduleWords({status:'unmatched',owner:'Auckland Transport'})),'trees in roads E17, open space zones E16, overlays','Auckland Transport: E17 first');
  assert.equal(rules(R.scheduleWords({status:'unmatched'},{tenure:'park'})),'open space zones E16, trees in roads E17, overlays','park: E16 first');
  assert.equal(rules(R.scheduleWords({status:'unmatched',owner:'Council Parks'})),'open space zones E16, trees in roads E17, overlays','Council Parks: E16 first');
  const tr=R.scheduleWords({status:'scheduled',kind:'tree',name:'Norfolk Island Pine'},{facts,number:'T0000001'});
  assert.deepEqual([tr.label,tr.text,tr.note],['Scheduled notable tree','Schedule 10 item 297 (Norfolk Island Pine)','Notable Trees schedule (Auckland Unitary Plan, Schedule 10, as published 4 Jun 2026).']);
  const gm=R.scheduleWords({status:'scheduled',kind:'group',name:'English Oaks (approx. 20)',species:'Pin Oak',latin:'Quercus palustris'},{facts,number:'T0000002'});
  assert.equal(gm.text,'Inside the mapped area of scheduled group item 1301, ‘English Oaks (approx. 20)’; recorded here as a pin oak; group coverage for Council to confirm');
  assert.equal(R.scheduleWords({status:'scheduled',kind:'group',name:'English Oaks (approx. 20)',species:'English Oak'},{facts,number:'T0000002'}).text,'Part of scheduled group item 1301, ‘English Oaks (approx. 20)’');
  // A held schedule entry is never named.
  assert.ok(!/1302/.test(R.scheduleWords({status:'scheduled',kind:'group',name:'Pin Oaks (approx. 9)',species:'Pin Oak'},{facts,number:'T0000003'}).text),'held entry');
  // A record the release left unflagged while notable_facts.json lists the tree (what Recognition shows): the schedule's
  // wording, never "no entry matched" beside a Council schedule row (TTSEXPGK item 717; T00JGB4T inside group 128).
  const tf=R.scheduleWords({status:'unmatched',species:'Kauri'},{facts,number:'T0000001'});
  assert.deepEqual([tf.status,tf.label,tf.text],['scheduled','Scheduled notable tree','Schedule 10 item 297 (Norfolk Island Pine)'],'unflagged record, schedule entry in the facts');
  const gf=R.scheduleWords({status:'unmatched',species:'London Plane Tree'},{facts:{...facts,trees:{T0000006:{group:[{schedule:'128',name:'Plane Tree'}]}}},number:'T0000006'});
  assert.deepEqual([gf.status,gf.label,gf.text],['scheduled','Notable Trees schedule','Part of scheduled group item 128, ‘Plane Tree’'],'unflagged record, group area in the facts');
  const gx=R.scheduleWords({status:'unmatched',species:'Pin Oak'},{facts,number:'T0000002'});
  assert.equal(gx.text,'Inside the mapped area of scheduled group item 1301, ‘English Oaks (approx. 20)’; recorded here as a pin oak; group coverage for Council to confirm');
  assert.equal(R.scheduleWords({status:'unmatched',species:'Pin Oak'},{facts,number:'T0000003'}).status,'unmatched','only a held entry: still no entry matched');
  assert.equal(R.scheduleWords({status:'unmatched'},{facts,number:'T0000009'}).status,'unmatched','no facts for the tree');
  for(const w of [un,tr,gm,tf,gf,gx])assert.ok(!/Not protected|consent/i.test(w.text+' '+(w.note||'')));
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
  // Trunk measuring height (20 Oct 2026, tool 0.2.15): labels say 1.4 m, the New Zealand convention; a tape reading's
  // method names the height its visit stored (KYTE asked for 1.3 m before v22), else the rule.
  assert.equal(rec.measures.trunkDiameter.label,'Trunk diameter at 1.4 m');
  assert.equal(rec.measures.trunkDiameter.provenance.method.text,'Circumference tape at 1.4 m above the ground (on a slope, from mid-slope), divided by π');
  R.setLive(rec,{diameter_cm:61.2,circumference_cm:192.3,measuring_height_m:1.3,observed_on:'2026-10-05'},ENV);
  assert.equal(rec.measures.trunkDiameter.provenance.method.text,'Circumference tape at 1.3 m above the ground, divided by π');
  R.setLive(rec,{diameter_cm:58,circumference_cm:null,measuring_height_m:1.4,observed_on:'2026-10-21'},ENV);
  assert.equal(rec.measures.trunkDiameter.provenance.method.text,'Diameter tape at 1.4 m above the ground');
  R.setLive(rec,{diameter_cm:52.1,circumference_cm:163.7,measuring_height_m:1.25,multiStem:true,stems:3,observed_on:'2026-10-21'},ENV);
  assert.equal(rec.measures.largestStem.label,'Largest stem at 1.4 m');
  assert.equal(rec.measures.largestStem.provenance.method.text,'Tape round the largest stem at 1.25 m above the ground; several stems');
  assert.equal(rec.measures.trunkDiameter.kind,'model');
  assert.equal(rec.measures.trunkDiameter.label,'Trunk diameter at 1.4 m');
  for(const q of Object.values(rec.measures))assert.ok(!/1\.3 m|uphill/.test(`${q.label} ${q.provenance?.method?.text||''}`),`${q.key}: no 1.3 m or uphill wording`);
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
  // A street group is compared from R.MIN_STREET_N (10) trees of the class; Franklin Road has 12.
  const streetGroup=n=>({n,values:{height:[9.1,9.4,10,10.5,11,11.2,12,12.4,13,13.5,14,16.85].slice(-n),crownArea:[40,55,60,70,80,90,100,110,120,150,200,315.5].slice(-n),benefits:[10,12,15,18,20,25,30,35,40,60,80,537.9].slice(-n)}});
  serve(`${D}/tree_context/streets/s/2c.json`,{300:{name:'Franklin Road',board:'Waitematā',groups:{deciduous_broadleaf:streetGroup(12)}}});
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
  assert.equal(R.MIN_STREET_N,10);
  assert.equal(street.n,12);
  assert.equal(street.metrics.height.exact,true);
  assert.equal(street.metrics.height.rank,1);
  assert.equal(street.metrics.height.text,'Tallest of 12');
  assert.equal(street.metrics.crownArea.text,'Largest crown of 12');
  assert.equal(street.metrics.benefits.rank,1,'a tree meets its own published (rounded) value');
  assert.ok(Math.abs(street.metrics.benefits.percentile-(11.5/12*100))<1e-9);
  assert.equal(board.name,'Waitematā');
  assert.equal(board.n,500);
  assert.equal(akl.n,1000);
  assert.ok(akl.metrics.height.share>=90&&akl.metrics.height.share<95,String(akl.metrics.height.percentile));
  assert.equal(akl.metrics.height.text,`Taller than ${akl.metrics.height.share}%`);
  // Each comparison carries its distribution, for a strip: sorted values for a small street group, quantiles otherwise.
  assert.equal(street.metrics.height.distribution.kind,'values');
  assert.equal(street.metrics.height.distribution.values.length,12);
  assert.equal(akl.metrics.height.distribution.kind,'quantiles');
  assert.equal(akl.metrics.height.distribution.quantiles.length,akl.metrics.height.distribution.probabilities.length);
  assert.equal(akl.irreplaceability.key,'effectively_irreplaceable');
  assert.equal(Math.round(akl.irreplaceability.shareAtOrAbove),10);
  assert.equal(rec.history.lineageStatus,'not_published');
  assert.equal(rec.corrections.status,'none');
  assert.equal(rec.corrections.receiptStatus,'not_published');
  assert.equal(rec.lidar.points.status,'not_published');

  // A street with fewer than 10 trees of the class is not compared ("Tallest of 4" says nothing): its name and n
  // stay, with no metrics, so a page can leave the row out and state the rule.
  R._internal.clearCache();
  serve(`${D}/tree_context/streets/s/2c.json`,{300:{name:'Franklin Road',board:'Waitematā',groups:{deciduous_broadleaf:streetGroup(4)}}});
  const recS=build(REG);await R.enrich(recS,ENV,{parts:['context']});
  const small=recS.context.scopes.find(x=>x.scope==='street');
  assert.deepEqual([small.status,small.name,small.n,small.minN,Object.keys(small.metrics).length,small.irreplaceability],['small','Franklin Road',4,10,0,null]);
  assert.deepEqual(recS.context.scopes.filter(x=>x.status==='ready').map(x=>x.scope),['board','auckland']);

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
        decided_on:'2026-10-01',reviewer:'Reviewer',summary:'NZ Tree Register AR/0177 is this record; joined to its crown',applied_in:['v5.2','v6']},
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
  // A review that names a New Zealand Tree Register record links that record on the register.
  assert.deepEqual(rec3.corrections.items[0].register,[{code:'AR/0177',href:'https://www.treeregister.nz/tree/view/177'}]);
  assert.deepEqual(rec3.corrections.items[1].register,[]);
  assert.equal(rec3.history.lineageStatus,'ready');
  const v51=rec3.history.releases.find(r=>r.release==='v5.1');
  assert.equal(v51.events[0].text,'Became the map marker of its crown; its position on the map moved 6.7 m');
  // Newest first; every release from the tree's first to the page's is listed, one that changed nothing marked so (UX-07).
  assert.deepEqual(rec3.history.releases.map(r=>r.release),['v6','v5.2','v5.1','v5','v4']);
  assert.deepEqual(rec3.history.releases.map(r=>!!r.noChange),[false,true,false,false,false]);
  assert.ok(rec3.history.releases.every(r=>r.date),'every row dated from one source');
  // UX-07: that one source agrees with the methods index and the changelog's Data section, release by release.
  {
    const fs=require('node:fs'),web2=path.join(__dirname,'..','..');
    const idx=fs.readFileSync(path.join(web2,'web','methods.html'),'utf8'),log=fs.readFileSync(path.join(web2,'CHANGELOG.md'),'utf8');
    const MON={January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',July:'07',August:'08',September:'09',October:'10',November:'11',December:'12',Sep:'09',Oct:'10'};
    const methods=Object.fromEntries([...idx.matchAll(/data-release="([\d.]+)"[^>]*>\s*<h3>[\s\S]*?<time datetime="(\d{4}-\d{2}-\d{2})">/g)].map(m=>['v'+m[1],m[2]]));
    const r4=/Release 4 \((\d+) (\w+) (\d{4})\)/.exec(idx);if(r4)methods.v4=`${r4[3]}-${MON[r4[2]]}-${r4[1].padStart(2,'0')}`;
    const data=log.slice(log.indexOf('## Data'));
    const changelog=Object.fromEntries([...data.matchAll(/^### (v[\d.]+) \((\d+) (\w+) (\d{4})/gm)].map(m=>[m[1],`${m[4]}-${MON[m[3]]}-${m[2].padStart(2,'0')}`]));
    for(const r of R.RELEASES){
      assert.equal(methods[r.key],r.date,`${r.key}: methods index ${methods[r.key]}, release table ${r.date}`);
      assert.equal(changelog[r.key],r.date,`${r.key}: changelog ${changelog[r.key]}, release table ${r.date}`);
    }
    assert.ok(!/not yet published/.test(data),'the changelog marks no published release as unpublished');
  }
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

  // A field observation the record holds and the decision that cites it as evidence are one review: the
  // observation is matched by its ID and folded into the decision (akl_tree_not_336 listed it twice).
  files.clear();R._internal.clearCache();
  serve('./data/corrections-applied.json',{schema:'alto-corrections-applied/1',ledger:'alto-corrections/1',release:META.release.dataset_version,generated_utc:'2026-10-12T02:00:00Z',
    corrections:[{id:'C00009',type:'identity_link',kind:'identity_link',status:'accepted',outcome:'applied',summary:'The plaque tree is the crown represented by akl_tree_lid_1',decided_on:'2026-10-11',reviewer:'ALTO reviewer',
      evidence:['tree_field_observation_v5:obs-plaque-20260922','owner statement relayed 11 Oct 2026'],applied_in:['20261012-v6'],tree_ids:[DET],roles:{[DET]:'subject'},seg_keys:[]}]});
  const r7=JSON.parse(JSON.stringify(F.trees[DET].record));
  r7.datasets.field={observed_on:'2026-09-22',observation_json:JSON.stringify({observation_id:'obs-plaque-20260922',reported_on:'2026-09-22',description:'Notable-tree marker observed on another crown'})};
  r7.datasets.corrections=[{id:'C00009',version:1,type:'identity_link',status:'accepted',outcome:'applied',role:'subject',summary:'The plaque tree is the crown represented by akl_tree_lid_1',decided_on:'2026-10-11',reviewer:'ALTO reviewer',
    evidence:'tree_field_observation_v5:obs-plaque-20260922; owner statement relayed 11 Oct 2026',reason:null}];
  const rec7=R.assemble({id:DET,record:r7,schema:F.schema,metadata:META6,env:ENV6});
  await R.enrich(rec7,ENV6,{parts:['corrections']});
  assert.deepEqual(rec7.corrections.items.map(x=>[x.id,x.kind]),[['C00009','identity link']],'one entry for the decision and its observation');
  assert.deepEqual(rec7.corrections.items[0].basedOn.map(o=>[o.kind,o.ref,o.date.iso]),[['field_observation','obs-plaque-20260922','2026-09-22']]);
  // Without a receipt the record's own copy of the decision folds the observation the same way.
  files.clear();R._internal.clearCache();
  const rec8=R.assemble({id:DET,record:r7,schema:F.schema,metadata:META,env:ENV});
  await R.enrich(rec8,ENV,{parts:['corrections']});
  assert.deepEqual(rec8.corrections.items.map(x=>[x.id,x.basis,x.basedOn?.[0]?.ref]),[['C00009','record','obs-plaque-20260922']]);

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

  // TS-03: the dripline radius is the greatest distance to the 2024 crown outline from the recorded position when it lies
  // inside the outline, otherwise from the crown top (the crown key's NZTM position), and from the outline's centre only
  // when the record holds no crown key. One NZTM projection with tree-imagery.js.
  {
    const X=require(web+'tree-imagery.js');
    for(const [lon,lat] of [[174.79986,-36.82837],[174.5,-37.2],[175.1,-36.4]])assert.deepEqual(R._internal.nztm(lon,lat),X.nztm(lon,lat),'one NZTM projection');
    assert.deepEqual(R._internal.crownTop({_ctx:{record:{datasets:{identity:{seg_key:'pc_BA32_1000_3310:1760474.75:5922651.75'}}}}}),[1760474.75,5922651.75]);
    assert.equal(R._internal.crownTop({_ctx:{record:{datasets:{identity:{seg_key:'3521028_11845296'}}}}}),null,'an earlier crown key names no position');
    const base=build(REG),pos=base.identity.position,kx=Math.cos(pos.lat*Math.PI/180)*111320,ky=110540;
    // A 10 m by 6 m crown whose top stands 2 m in from its west end, at `at` metres east of the record.
    const crown=at=>{const pt=(dx,dy)=>[pos.lon+(at+dx)/kx,pos.lat+dy/ky];return {g:{type:'Polygon',coordinates:[[pt(-2,-3),pt(8,-3),pt(8,3),pt(-2,3),pt(-2,-3)]]},top:R._internal.nztm(...pt(0,0))};};
    const withKey=(rec,top)=>{rec._ctx.record.datasets.identity={...(rec._ctx.record.datasets.identity||{}),seg_key:top?`pc_X_1000_0001:${top[0].toFixed(2)}:${top[1].toFixed(2)}`:null};return rec;};
    const far=crown(30),out=withKey(build(REG),far.top);R.extras(out,{geometry:far.g});
    assert.equal(out.measures.dripline.basis,'top','the record 30 m off its crown: measured from the crown top');
    assert.ok(Math.abs(out.measures.dripline.value-Math.hypot(8,3))<0.05,`from the crown top: ${out.measures.dripline.value}`);
    assert.ok(out.measures.dripline.provenance.note.startsWith('Measured on the outline from the crown top (the highest point of the 2024 crown; the recorded position lies outside the outline).'));
    const near=crown(0),ins=withKey(build(REG),near.top);R.extras(ins,{geometry:near.g});
    assert.equal(ins.measures.dripline.basis,'position');assert.ok(Math.abs(ins.measures.dripline.value-Math.hypot(8,3))<0.05,'inside: from the recorded position');
    const nokey=withKey(build(REG),null);R.extras(nokey,{geometry:far.g});
    assert.equal(nokey.measures.dripline.basis,'centre');assert.ok(Math.abs(nokey.measures.dripline.value-Math.hypot(5,3))<0.05,'no crown key: from the outline centre');
    assert.equal(withKey(build(REG),far.top).measures.dripline?.label,'Equal-area crown radius','no outline loaded: the equal-area radius, so labelled');
  }

  // LOC-01: the location row. WGS84 latitude, longitude to 5 decimals; links to the same point with 6 decimals.
  assert.equal(R.coordText(-37.007573,175.026657),'-37.00757, 175.02666');
  assert.equal(R.coordText('-36.85118','174.74945'),'-36.85118, 174.74945');
  for(const bad of [[null,174],[-36,undefined],['',174],[NaN,174],[-91,174],[-36,181],[true,174]])assert.equal(R.coordText(...bad),null,`no coordinates from ${bad}`);
  assert.deepEqual(R.mapLinks(-37.007573,175.026657).map(l=>[l.label,l.href]),[
    ['Google Maps','https://www.google.com/maps/search/?api=1&query=-37.007573,175.026657'],
    ['Street View','https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=-37.007573,175.026657'],
    ['OpenStreetMap','https://www.openstreetmap.org/?mlat=-37.007573&mlon=175.026657#map=19/-37.007573/175.026657']]);
  assert.deepEqual(R.mapLinks(null,174),[]);
  {
    const det=R.location(build(DET)),reg=R.location(build(REG)),not=R.location(build(NOT));
    assert.equal(det.text,'-36.72329, 174.56764');assert.equal(det.datum,'WGS84');
    assert.equal(det.basis,'Crown top in the 2024 LiDAR survey','a 2024 LiDAR crown: its crown top, where the map pin sits');
    assert.equal(reg.basis,'Recorded position as supplied by Auckland Council’s tree register');
    assert.equal(not.basis,'Recorded position as supplied by Auckland Council’s Notable Trees schedule');
    assert.deepEqual([reg.lat,reg.lon],[build(REG).identity.position.lat,build(REG).identity.position.lon],'the position is the map pin (identity.position)');
    assert.equal(reg.links.length,3);
    const canopy=build(DET);canopy._ctx.record.datasets.record={...canopy._ctx.record.datasets.record,source_primary:'lidar_inferred_canopy'};
    assert.equal(R.location(canopy).basis,'Detection point (LiDAR canopy model)','an earlier detection says what its point is');
    const unv=build(REG);unv.identity.quality='location_unverified';assert.equal(R.location(unv).unverified,true);
    assert.equal(R.location(unv).caption,'Recorded position as supplied by Auckland Council’s tree register (Council position not verified); the map pin. Latitude, longitude (WGS84).');
    const ver=build(NOT);ver._ctx.record.datasets.record={...ver._ctx.record.datasets.record,notable_point_type:'1'};delete ver._ctx.record.datasets.location_review;
    assert.equal(R.location(ver).council,'verified','a verified Council point says so, as the evidence row does');
    assert.equal(det.council,null);assert.equal(det.caption,'Crown top in the 2024 LiDAR survey; the map pin. Latitude, longitude (WGS84).');
    const none=build(REG);none.identity.position=null;none.summary.position=null;assert.equal(R.location(none),null);
    // The nearest address point's street and the parcel, once read; nothing while neither is known.
    const n=build(REG);assert.equal(R.nearLine(n),null);
    n.context={status:'ready',scopes:[{scope:'street',name:'Glenbrook Street',status:'ready',distance:23.4}]};
    n.place={parcel:{status:'ready',id:'5003195'}};
    assert.equal(R.nearLine(n),'Nearest address point on Glenbrook Street (OpenStreetMap), 23 m away · LINZ parcel 5003195');
    n.context.scopes=[{scope:'street',status:'none',name:null,definition:'No address point within 60 m'}];n.place={parcel:{status:'none',note:'x'}};
    assert.equal(R.nearLine(n),'No address point within 60 m · Not on a LINZ parcel (road corridor or foreshore)');
  }
  // FE-03: load(…, {later:true}) gives the tree before the crown's other records (membersPending, the record list with
  // this record only); loadMembers() completes the list exactly as a full load gives it.
  {
    const byId=new Map();for(const t of Object.values(F.trees)){byId.set(t.record.tree_id,t.record);for(const m of t.members||[])byId.set(m.tree_id,m);}
    const reads=[];
    globalThis.ALTOTreeDetails={load:async(base,version,id)=>{reads.push(id);const r=byId.get(id);if(!r)throw new Error('absent');return {schema:F.schema,record:r};}};
    const resolved={tree_id:REG,canonical:REG,status:'current',resolved_by:'input'};
    const full=await R.load(REG,ENV,{resolved});
    assert.ok(reads.length>1&&!full.membersPending,'a full load reads the crown’s other records');
    reads.length=0;
    const early=await R.load(REG,ENV,{resolved,later:true});
    assert.deepEqual(reads,[REG],'later: only the tree’s own record before the hero');
    assert.equal(early.membersPending,true);
    assert.deepEqual(early.records.map(r=>r.treeId),[REG],'later: the record list holds this record only');
    assert.deepEqual(early.measures,full.measures,'later: the measures do not wait for the other records');
    await R.loadMembers(early);
    assert.equal(early.membersPending,false);
    assert.deepEqual(JSON.parse(JSON.stringify(early.records)),JSON.parse(JSON.stringify(full.records)),'loadMembers: the same record list as a full load');
    assert.equal(early.moreRecords,full.moreRecords,'loadMembers: the same count of records not read');
    const solo=await R.load(DET,ENV,{resolved:{tree_id:DET,canonical:DET,status:'current'},later:true});
    assert.ok(!solo.membersPending,'a tree with no other records has nothing pending');
    delete globalThis.ALTOTreeDetails;
  }
  // DB-11: the evidence table shows the i-Tree reference mature height (stored in feet under a metres name) converted to
  // metres, and says the stored plausibility flag was computed against the unconverted value (Agathis australis: 165).
  {
    globalThis.window=globalThis;require(web+'tree-details.js');const TD=globalThis.ALTOTreeDetails;
    const schema={datasets:[{key:'species',table:'tree_species_attributes',title:'Species references and growth form',evidence:'Mixed evidence',note:'',multiple:false}]};
    const html=TD.render(schema,{datasets:{species:{growth_form:'conifer',mature_height_m:165,lidar_height_m:31.2,height_plausibility:'no_ceiling'}}});
    assert.ok(html.includes('<span class="pp-value">50.3 <small class="pp-sub">(i-Tree value in feet, converted)</small></span>'),'165 ft shown as 50.3 m');
    assert.ok(!/<span class="pp-value">165<\/span>/.test(html),'no 165 metres');
    assert.ok(html.includes('no_ceiling <small class="pp-sub">(computed in release 6.2 against the unconverted value; to be recomputed)</small>'),'plausibility flag caveat');
    assert.ok(html.includes('<span class="pp-value">31.2</span>'),'other heights unchanged');
    delete globalThis.ALTOTreeDetails;
  }
  console.log('tree-record checks passed');
})().catch(err=>{console.error(err);process.exit(1);});
