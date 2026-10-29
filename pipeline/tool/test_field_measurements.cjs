// Offline checks for field measurements (tool 0.2.17): trunk diameters measured on the ground and published apart from
// data and tool releases in <siteRoot>/field/measurements_v1.json, served here through a stub fetch, on real release 6.3
// records (fixtures/tree-records-v63.json). A missing or unreachable file, another version and malformed entries leave
// every tree as it was (no rows, no error, nothing logged); a tree in the file is measured, at the height its entry gives,
// with ALTO's estimate beside it, on the tree page, the map's tree panel and the saved-trees comparison.
// Usage: node pipeline/tool/test_field_measurements.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js','credits.js'])require(web+f);
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js'),P=require(web+'tree-panel.js'),E=require(web+'tree-evidence.js');
const F63=require('./fixtures/tree-records-v63.json'),META=F63.metadata,ENV={siteRoot:'.',dataBase:'./data',metadata:META};
const build=(n,live=null)=>{const t=F63.trees[n];return R.assemble({id:t.id,record:t.record,schema:F63.schema,members:t.members,memberCount:t.memberCount,metadata:META,env:ENV,live});};
const visible=h=>h.replace(/<(svg|code)[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
// The tree page's key measurements (tree-page.js KEYS) as the page draws them: the band, then the field rows.
const PAGE_KEYS=['height','crownArea','crownDiameter','crownSpread','dripline','rootZone','rootZoneColumnar','trunkDiameter','largestStem','rootProtection','lifeStage','benefits','carbonStored','replacementYears','crownReplacement','irreplaceability'];
const page=rec=>I.strip(rec,PAGE_KEYS,{id:'pgPop',cls:'ti-band-page'})+I.fieldRows(rec);
const panel=rec=>P.render(rec,{treeUrl:'tree.html?id='+(rec.number||rec.id)});
const A='TZ69KK1G',B='TADY8HB7',W='T6Z3DYC8',URL_='./field/measurements_v1.json';
const entry=(o={})=>({kind:'trunk_diameter',value_cm:21.5,n_measurements:6,n_teams:3,n_classes:2,spread_cm:2.0,height_m:1.3,method:'diameter tape',
  date_from:'2026-10-28',date_to:'2026-10-30',by:'Example school students, Years 4–6',review:'checked by the ALTO team',ref:'TEST-1',...o});

// The stub: one file (or a status, or a network error) per run; every request is counted.
let served=null,asked=[];
const ok=body=>({ok:true,status:200,arrayBuffer:async()=>new TextEncoder().encode(typeof body==='string'?body:JSON.stringify(body)).buffer});
globalThis.fetch=async(url,init)=>{asked.push({url:String(url),init:init||null});
  if(served instanceof Error)throw served;
  if(typeof served==='number')return {ok:false,status:served,arrayBuffer:async()=>new ArrayBuffer(0)};
  return served===null?{ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)}:ok(served);};
// Nothing from our code reaches the console.
const logged=[];for(const k of ['log','warn','error','info','debug']){const was=console[k];console[k]=(...a)=>{logged.push([k,...a]);if(k==='log')was(...a);};}
const fresh=file=>{R._internal.clearField();served=file;asked=[];};

(async()=>{
  // ---- the file is missing (404), unreachable (network error), another version, or not JSON: every tree as before ----
  for(const [what,file,status] of [['missing',404,'not_published'],['forbidden',403,'not_published'],['unreachable',new TypeError('Failed to fetch'),'unavailable'],
    ['another version',{version:'field_measurements_v2',trees:{[A]:[entry()]}},'not_published'],['not JSON','<!doctype html><title>Not found</title>','unavailable'],['server error',500,'unavailable']]){
    fresh(file);logged.length=0;
    const rec=build(A),before={measures:JSON.stringify(R.toJSON(rec).measures),panel:panel(rec),page:page(rec),matrix:I.matrix(rec),roots:I.rootRows(rec)};
    await R.enrich(rec,ENV,{parts:['field']});
    assert.equal(rec.field.status,status,`${what}: status`);
    assert.deepEqual(rec.field.entries,[],`${what}: no entries`);
    assert.equal(I.fieldRows(rec),'',`${what}: no field rows`);
    assert.equal(JSON.stringify(R.toJSON(rec).measures),before.measures,`${what}: measures unchanged`);
    assert.equal(panel(rec),before.panel,`${what}: the panel exactly as before`);
    assert.equal(page(rec),before.page,`${what}: the page's measurements exactly as before`);
    assert.equal(I.matrix(rec),before.matrix,`${what}: measurements by source unchanged`);
    assert.equal(I.rootRows(rec),before.roots,`${what}: root space unchanged`);
    assert.equal(rec.measures.trunkDiameter.kind,'model');
    assert.match(I.line(rec.measures.trunkDiameter),/· Not measured$/,`${what}: still "Not measured"`);
    assert.ok(!/Field measurements/.test(visible(panel(rec))),`${what}: no Field measurements in the panel`);
    assert.ok(visible(E.comparison([F63.trees[A].record])).includes('· not measured'),`${what}: the comparison still says not measured`);
    assert.equal(asked.length,1,`${what}: one request`);
    assert.deepEqual(logged,[],`${what}: nothing logged`);
  }

  // ---- the file: one tree with one entry, one with two, and entries that are left out ----
  const file={version:'field_measurements_v1',updated:'2026-11-03',trees:{
    [A]:[entry()],
    [B]:[entry({value_cm:30.2,spread_cm:2.5,height_m:1.35,n_measurements:4,n_teams:2,n_classes:1,date_from:'2026-10-14',date_to:'2026-10-14',ref:'TEST-2'}),
      entry({value_cm:31.04,spread_cm:0.45,n_measurements:3,n_teams:1,n_classes:1,date_from:'2026-10-30',date_to:'2026-11-02',by:'A second group',review:null,ref:'TEST-3'}),
      // left out: another kind, no value, no height, no one named, a value that is not a trunk, a string where an entry belongs
      {...entry(),kind:'height'},entry({value_cm:null}),entry({height_m:undefined}),entry({by:'  '}),entry({value_cm:4000}),'21.5 cm'],
    [W]:[entry({value_cm:64.0,ref:'TEST-4'})],TNOTATREE:'not a list'}};
  fresh(file);logged.length=0;

  // A tree with no entry: "none", and nothing changes.
  {
    const rec=build('TW9QK0A0'),before=panel(rec);
    await R.enrich(rec,ENV,{parts:['field']});
    assert.equal(rec.field.status,'none');
    assert.equal(I.fieldRows(rec),'');
    assert.equal(panel(rec),before,'no entry: the panel exactly as before');
  }

  // One entry: the trunk diameter is measured, at the height the entry gives (1.3 m stays 1.3 m).
  const rec=build(A),model=rec.measures.trunkDiameter,parts=[];
  await R.enrich(rec,ENV,{parts:['field'],onPart:p=>parts.push(p)});
  assert.deepEqual(parts,['field']);
  assert.equal(rec.field.status,'ready');
  assert.equal(rec.field.updated.iso,'2026-11-03');
  assert.equal(rec.field.entries.length,1);
  const td=rec.measures.trunkDiameter;
  assert.equal(td.kind,'measured');
  assert.equal(td.value,21.5);
  assert.equal(td.text,'21.5 cm');
  assert.equal(td.label,'Trunk diameter at 1.3 m','the label names the height measured at');
  assert.equal(td.provenance.source,'Example school students, Years 4–6','source: the by label, as written');
  assert.equal(td.provenance.method.text,'Diameter tape at 1.3 m above the ground');
  assert.equal(td.provenance.date.text,'28–30 Oct 2026');
  assert.equal(td.provenance.note,'6 measurements by 3 teams in 2 classes; spread across teams 2 cm. Checked by the ALTO team.');
  assert.equal(I.text(td),'21.5 cm','a tape reading as measured, to 0.1 cm');
  assert.equal(I.line(td),'Measured in the field · 28–30 Oct 2026','"Measured" replaces "Not measured"');
  assert.ok(!I.metric(rec,'trunkDiameter').includes('badge-estimate'),'no Estimate badge on the measurement');
  assert.ok(I.metric(rec,'trunkDiameter').includes('Trunk diameter at 1.3 m')&&!I.metric(rec,'trunkDiameter').includes('at 1.4 m'),'the card says 1.3 m, never 1.4 m');
  // ALTO's estimate stays, with its own method and range, as the model value it was.
  const est=rec.measures.trunkEstimate;
  assert.equal(est.kind,'model');
  assert.equal(est.value,model.value);
  assert.deepEqual(est.range,model.range);
  assert.equal(est.label,'Trunk diameter at 1.4 m, ALTO estimate');
  assert.equal(est.how,'Median of the release’s 2 trunk-diameter models, at 1.4 m above the ground (on a slope, from mid-slope)');
  assert.equal(est.provenance.method.text,model.provenance.method.text,'the models’ own method');
  // The root protection radius follows the measured trunk, as it does for a KYTE tape reading: 12 × 21.5 cm, no range.
  assert.ok(Math.abs(rec.measures.rootProtection.value-2.58)<1e-9);
  assert.equal(rec.measures.rootProtection.range,null);
  assert.match(rec.measures.rootProtection.provenance.note,/From the trunk diameter measured in the field \(1\.3 m above the ground\)\./);
  assert.ok(Math.abs(rec.roots.rpaRadius-2.58)<1e-9,'root space follows it too');
  assert.equal(rec.roots.rpaBasis,'From the trunk diameter measured in the field');
  // Measurements by source: a column for the measurement, its value as measured.
  const col=rec.bySource.columns.find(c=>c.key==='fieldMeasure1');
  assert.deepEqual([col.label,col.when,col.trunk,col.trunkKind],['Example school students, Years 4–6','28–30 Oct 2026',21.5,'measured']);
  assert.equal(col.note,'Diameter tape at 1.3 m above the ground. 6 measurements by 3 teams in 2 classes; spread across teams 2 cm. Checked by the ALTO team.');
  assert.ok(visible(I.matrix(rec)).includes('21.5 cm'));
  // Every provenance note is there once (the page's numbered notes).
  const ids=rec.provenance.map(p=>p.id);assert.equal(new Set(ids).size,ids.length);
  assert.ok(['p-trunkDiameter','p-trunkEstimate','p-field1','p-col-fieldMeasure1'].every(x=>ids.includes(x)),ids.join(' '));
  // The record stays plain text.
  for(const s of JSON.stringify(R.toJSON(rec)).match(/"(?:[^"\\]|\\.)*"/g))assert.ok(!/<[a-z\/]/i.test(s),s);

  // The rows: the measurement first (value; method at its height · dates · who; counts and spread; review), then ALTO's estimate.
  const rows=I.fieldRows(rec),rv=visible(rows);
  assert.ok(rows.startsWith('<dl class="ti-rows ti-field">'));
  assert.equal(rv.trim(),'Measured 21.5 cm Diameter tape at 1.3 m above the ground · 28–30 Oct 2026 · Example school students, Years 4–6 6 measurements by 3 teams in 2 classes; spread across teams 2 cm Checked by the ALTO team '+
    `ALTO estimate ${I.text(model)} Estimate ${model.rangeLabel} ${I.fmtRange(model)} Median of the release’s 2 trunk-diameter models, at 1.4 m above the ground (on a slope, from mid-slope)`);
  assert.equal((rows.match(/badge-estimate/g)||[]).length,1,'the Estimate badge on the estimate only');
  assert.ok(rows.includes('data-q="field1"')&&rows.includes('data-q="trunkEstimate"'),'each value opens its provenance');
  assert.equal(I.provenance(rec.field.entries[0],rec).includes('<dt>Source</dt><dd>Example school students, Years 4–6</dd>'),true);
  // The map panel: the trunk card measured, the rows under the band.
  const pv=visible(panel(rec));
  assert.ok(pv.includes('Trunk diameter at 1.3 m 21.5 cm Measured in the field · 28–30 Oct 2026'),pv.slice(pv.indexOf('Trunk'),pv.indexOf('Trunk')+120));
  assert.ok(pv.includes('Field measurements Measured 21.5 cm Diameter tape at 1.3 m above the ground'),'panel: field rows');
  assert.ok(!/Not measured/.test(pv),'panel: never "Not measured" for a measured tree');
  assert.equal(P.metrics(rec),P.metrics(rec),'the map redraws the same section');
  assert.ok(P.metrics(rec).includes('<h5 class="ti-h ti-field-h">Field measurements</h5>'));
  // The tree page's key measurements: the same card and rows.
  const gv=visible(page(rec));
  assert.ok(gv.includes('Trunk diameter at 1.3 m 21.5 cm Measured in the field')&&gv.includes('ALTO estimate'),'page: card and rows');
  // No release numbers, method IDs or other words the design system keeps out of visible copy.
  for(const t of [pv,gv,visible(I.matrix(rec))])assert.ok(!/\bAI\b|undefined|NaN|\bnull\b|\bv[456](\.\d)?\b/.test(t),t.match(/\bAI\b|undefined|NaN|\bnull\b|\bv[456](\.\d)?\b/)?.[0]);

  // Two entries: the newest is the trunk diameter, both are listed newest first, each at its own height.
  const two=build(B);
  await R.enrich(two,ENV,{parts:['field']});
  assert.deepEqual(two.field.entries.map(x=>x.value),[31.04,30.2],'six malformed entries left out; newest first');
  assert.equal(two.measures.trunkDiameter.value,31.04);
  assert.equal(two.measures.trunkDiameter.text,'31 cm','to 0.1 cm as measured, no trailing zero');
  assert.equal(two.measures.trunkDiameter.provenance.date.text,'30 Oct – 2 Nov 2026');
  assert.equal(two.field.entries[1].label,'Trunk diameter at 1.35 m','1.35 m as given');
  assert.equal(two.field.entries[1].provenance.date.text,'14 Oct 2026');
  assert.equal(two.field.entries[1].words.counts,'4 measurements by 2 teams in 1 class; spread across teams 2.5 cm');
  assert.equal(two.field.entries[0].words.counts,'3 measurements by 1 team in 1 class; spread across teams 0.5 cm','spread to 0.1 cm');
  assert.equal(two.field.entries[0].words.review,null,'no review line when the entry has none');
  const tv=visible(I.fieldRows(two));
  assert.ok(tv.indexOf('31 cm')<tv.indexOf('30.2 cm')&&tv.indexOf('30.2 cm')<tv.indexOf('ALTO estimate'),'newest first, the estimate last');
  assert.ok(tv.includes('Diameter tape at 1.35 m above the ground · 14 Oct 2026 · Example school students, Years 4–6')&&tv.includes('A second group'));
  assert.deepEqual(two.bySource.columns.filter(c=>/^fieldMeasure/.test(c.key)).map(c=>c.label),['A second group','Example school students, Years 4–6']);

  // A crown whose estimates release 6.3 withholds (height not plausible): the measurement is shown, with no estimate beside
  // it and no root protection radius (as for a KYTE reading).
  {
    const w=build(W);assert.equal(w.measures.trunkDiameter,undefined);
    await R.enrich(w,ENV,{parts:['field']});
    assert.equal(w.measures.trunkDiameter.kind,'measured');
    assert.equal(w.measures.trunkDiameter.text,'64 cm');
    assert.equal(w.measures.trunkEstimate,undefined);
    assert.equal(w.measures.rootProtection,undefined);
    const wv=visible(I.fieldRows(w)).trim();
    assert.ok(wv.startsWith('Measured 64 cm')&&!wv.includes('ALTO estimate'),wv);
  }

  // One request a page load, for every tree; no cache stamp, revalidated.
  assert.equal(asked.length,1,'the file is read once for every tree');
  assert.equal(asked[0].url,URL_,'site root, not the data folder');
  assert.deepEqual(asked[0].init,{cache:'no-cache'});
  assert.ok(!/\?v=/.test(asked[0].url));
  {
    const R2=build(A);await R.enrich(R2,{...ENV,siteRoot:'..'},{parts:['field']});
    assert.equal(asked.length,1,'a later tree reads the file already read');
    R._internal.clearField();asked=[];await R.enrich(build(A),{...ENV,siteRoot:'../beta/'},{parts:['field']});
    assert.equal(asked[0].url,'../beta/field/measurements_v1.json','<siteRoot>/field/measurements_v1.json');
    fresh(file);
  }

  // The saved-trees comparison: measured trees say so; others keep "not measured".
  await R.fieldFile(ENV);
  const cmp=visible(E.comparison([F63.trees[A].record,F63.trees[B].record,F63.trees.T7GNAD02.record]));
  const t=x=>{const a=E.explain(x),F=globalThis.ALTOFormat;return Math.round(a.low)===Math.round(a.high)?F.quantityText('trunkDiameter',a.low):F.range('trunkDiameter',a.low,a.high);};
  assert.ok(cmp.includes(`21.5 cm · measured at 1.3 m, 28–30 Oct 2026; ALTO estimate ${t(F63.trees[A].record)}`),cmp.slice(cmp.indexOf('Trunk diameter'),cmp.indexOf('Trunk diameter')+200));
  assert.ok(cmp.includes(`31 cm · measured at 1.3 m, 30 Oct – 2 Nov 2026; ALTO estimate ${t(F63.trees[B].record)}`));
  assert.ok(cmp.includes('· not measured'),'a tree without a field measurement keeps "not measured"');
  assert.ok(E.csv([F63.trees[A].record]).includes('21.5 cm · measured at 1.3 m'),'the CSV copy too');

  // A reviewed KYTE single-trunk reading stays the trunk diameter (as before); the field measurement is still listed, with
  // ALTO's estimate, and root space follows the KYTE reading.
  {
    const k=build(A);
    R.setLive(k,{diameter_cm:24.4,circumference_cm:null,measuring_height_m:1.4,observed_on:'2026-10-21'},ENV);
    await R.enrich(k,ENV,{parts:['field']});
    assert.equal(k.measures.trunkDiameter.provenance.source,R.SOURCE.kyte);
    assert.equal(k.measures.trunkDiameter.value,24.4);
    assert.equal(k.measures.trunkDiameter.label,'Trunk diameter at 1.4 m');
    assert.ok(Math.abs(k.measures.rootProtection.value-2.928)<1e-9&&Math.abs(k.roots.rpaRadius-2.928)<1e-9,'root protection from the KYTE reading');
    assert.equal(k.measures.trunkEstimate.kind,'model','the estimate beside the field measurement');
    assert.ok(visible(I.fieldRows(k)).trim().startsWith('Measured 21.5 cm Diameter tape at 1.3 m'),'the field measurement still listed');
    assert.ok(k.bySource.columns.some(c=>c.key==='kyteMeasure')&&k.bySource.columns.some(c=>c.key==='fieldMeasure1'));
    // Whichever arrives first, the result is the same.
    const k2=build(A);await R.enrich(k2,ENV,{parts:['field']});
    R.setLive(k2,{diameter_cm:24.4,circumference_cm:null,measuring_height_m:1.4,observed_on:'2026-10-21'},ENV);
    assert.deepEqual(R.toJSON(k2).measures,R.toJSON(k).measures);
    assert.deepEqual(k2.roots,k.roots);
  }
  // A measurement arriving after the map's outline keeps the outline's dripline radius (refresh keeps what extras() had).
  {
    const g=build(A),pos=g.identity.position,d=0.00012,ring=[[pos.lon-d,pos.lat-d],[pos.lon+d,pos.lat-d],[pos.lon+d,pos.lat+d],[pos.lon-d,pos.lat+d],[pos.lon-d,pos.lat-d]];
    R.extras(g,{geometry:{type:'Polygon',coordinates:[ring]}});
    const before=g.measures.dripline.value;assert.notEqual(g.measures.dripline.basis,'equal_area');
    await R.enrich(g,ENV,{parts:['field']});
    assert.equal(g.measures.dripline.value,before);
  }
  // A map-tile record (not loaded) is read but drawn only from the full record.
  {
    const tile=R.fromTile({tree_id:F63.trees[A].id,tn:A},ENV);
    await R.enrich(tile,ENV,{parts:['field']});
    assert.equal(tile.field.status,'ready');
    assert.ok(!P.render(tile,{treeUrl:'t'}).includes('Field measurements'),'no rows before the full record');
  }
  // The example file for a test upload (docs/tool/field_measurements_example.json) reads as it should.
  {
    fresh(JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','docs','tool','field_measurements_example.json'),'utf8')));
    const x=build(A),y=build(B);await R.enrich(x,ENV,{parts:['field']});await R.enrich(y,ENV,{parts:['field']});
    assert.deepEqual([x.field.entries.map(q=>q.text),y.field.entries.map(q=>q.text)],[['11.1 cm','22.2 cm'],['33.3 cm']]);
    assert.ok([...x.field.entries,...y.field.entries].every(q=>q.provenance.source==='Example data'));
    assert.deepEqual(x.field.entries.map(q=>q.label),['Trunk diameter at 1.3 m','Trunk diameter at 1.4 m']);
  }
  assert.deepEqual(logged,[],'nothing logged');

  // ---- wiring: the tree page, the map and the comparison ask for the part and draw it ----
  {
    const src=f=>fs.readFileSync(web+f,'utf8');
    const tp=src('tree-page.js'),map=src('map-app.js'),ws=src('evidence-workspace.js');
    assert.ok(tp.includes("R.enrich(rec,env,{parts:['history','corrections','field'],onPart})"),'tree page: the field part with the first parts');
    assert.ok(/else if\(name==='field'\)\{if\(rec\.field\?\.status==='ready'\)\{/.test(tp),'tree page: redraws only for a tree in the file');
    assert.ok(tp.includes("const field=I.fieldRows(rec)")&&tp.includes('<h3 class="ti-h3">Field measurements</h3>${field}'),'tree page: rows under the band');
    assert.ok(map.includes('parts: ["context", "field"]')&&map.includes('if (full.field?.status !== "ready") return;')&&map.includes('metricsSection.outerHTML = ALTOTreePanel.metrics(full);'),'map: the part, and a redraw only for a tree in the file');
    assert.ok(map.includes('siteRoot: SITE_ROOT,')&&ws.includes('root.ALTOTreeRecord.fieldFile({siteRoot:config.siteRoot})')&&ws.includes('await field;'),'comparison: waits for the file');
    assert.ok(!/console\./.test(src('tree-record.js').slice(src('tree-record.js').indexOf('// ---------- field measurements ----------'),src('tree-record.js').indexOf('// ---------- identity ----------'))),'no logging');
    // Nothing on the host blocks or rewrites the file, and the policy allows the same-origin read.
    const ht=src('htaccess.example');
    assert.ok(!/^\s*RewriteRule\s+\^?field/im.test(ht)&&!/field\//.test(ht),'.htaccess: no rule for /field/');
    assert.match(ht,/connect-src 'self'/);
  }
  console.log('field measurement checks passed (tool 0.2.17): missing, unreachable and other files change nothing; one and two entries, the height from the data, tape precision, ALTO’s estimate beside it, KYTE first, page, panel and comparison');
})().catch(err=>{process.stderr.write(`${err?.stack||err}\n`);process.exit(1);});
