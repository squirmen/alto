// Offline checks for the tree panel and tree page components (web/tree-instrument.js, web/tree-panel.js; concept B
// with concept A's and C's components) on the real v6 development records in fixtures/tree-records-v6dev.json:
// data-sheet rounding, the Estimate badge on every model value, provenance for every key measurement, no release
// numbers or method IDs in visible copy, and the must-fixes from the tree-page evaluation (protection said for every
// tree, the root protection radius for every tree with a root-space scenario, the central trunk estimate with its
// range, no zero-width ranges, shapes named in figure keys, record counts, KYTE links with the release).
// Usage: node pipeline/tool/test_tree_instrument.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js'])require(web+f);
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js'),P=require(web+'tree-panel.js');
const F=require('./fixtures/tree-records-v6dev.json');
const META={release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev',dataset_last_updated_utc:'2026-10-11T00:00:00+00:00',status:'research_only_not_independently_validated'},assembly:{tile_version:'20261011-v6-dev'}};
const build=id=>R.assemble({id,record:F.trees[id].record,schema:F.schema,members:F.trees[id].members,memberCount:F.trees[id].memberCount,metadata:META,env:{siteRoot:'.',dataBase:'./data',metadata:META}});
const DET='akl_tree_pc5_ab98fbf0a5adf8128307',REG='akl_tree_trp_ACCT0245027',NOT='akl_tree_not_361';
// Visible text of a markup string: tags, attributes, SVG and code removed.
const visible=h=>h.replace(/<(svg|code)[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');

// Rounding follows the design system's precision table.
const Q=(key,value,kind='model')=>({key,value,kind,provenance:{}});
assert.equal(I.text(Q('height',16.85,'measured')),'16.9 m');
assert.equal(I.text(Q('height',16,'measured')),'16.0 m','metres to 0.1, always one decimal');
assert.equal(I.text(Q('rootProtection',6.96)),'7.0 m');
assert.equal(I.text(Q('crownArea',315.5,'measured')),'316 m²');
assert.equal(I.text(Q('crownArea',8.25,'measured')),'8.3 m²');
assert.equal(I.text(Q('crownDiameter',20.04,'derived')),'20 m');
assert.equal(I.text(Q('trunkDiameter',36.19)),'36 cm');
assert.equal(I.text(Q('benefits',537.9)),'$540/yr');
assert.equal(I.text(Q('carbonStored',1.165)),'1.2 t CO₂e');
assert.equal(I.text(Q('carbonStored',2.98)),'3.0 t CO₂e');
assert.equal(I.text(Q('carbonStored',0.55)),'550 kg CO₂e');
assert.equal(I.fmtRange({key:'benefits',range:{low:376.5,high:699.3}}),'$380–$700/yr');
// No zero-width ranges: ends that print the same give no range at all.
assert.equal(I.fmtRange({key:'height',range:{low:23.69,high:23.71}}),null);
assert.equal(I.fmtRange({key:'trunkDiameter',range:{low:36.2,high:36.4}}),null);
// Measured values never print "range" beside them; estimates start with theirs.
assert.ok(!/range/i.test(I.line({key:'height',kind:'measured',value:16.85,range:{low:15.5,high:17.4},provenance:{source:'Auckland 2024 LiDAR survey (Woolpert)'}})));
assert.match(I.line({key:'trunkDiameter',kind:'model',value:37.2,range:{low:36.2,high:38.3},provenance:{}}),/^Range 36–38 cm/);

const SHAPE_WORDS=/\b(yellow|orange|cyan|magenta|purple|green dot|red|blue)\b/i;
for(const id of Object.keys(F.trees)){
  const rec=build(id);
  const panel=P.render(rec,{treeUrl:'tree.html?id='+id});
  const strip=I.strip(rec,Object.keys(rec.measures));
  const text=visible(panel)+' '+visible(strip)+' '+visible(I.matrix(rec))+' '+visible(I.lost(rec,{variant:'page'}))+' '+visible(I.rootRows(rec));
  const bad=/\bv[456](\.\d)?\b|\(model\)|Data v6|laser survey|\bMODEL\b|undefined|NaN|\bnull\b|LiDAR-only/;
  assert.ok(!bad.test(text),`${id}: copy: ${text.match(bad)?.[0]}`);
  // No zero-width range anywhere ("23.7–23.7 m").
  assert.ok(!/(\$?\d[\d.,]*)–\1(?![\d.,])/.test(text),`${id}: zero-width range: ${text.match(/(\$?\d[\d.,]*)–\1(?![\d.,])/)?.[0]}`);
  // Hybrid sign, never the letter x, in names.
  assert.ok(!/[A-Z][a-z]+ x [a-z]/.test(text),`${id}: hybrid written with x`);
  // Every model value in the strip carries the Estimate badge; measured and recorded values do not.
  for(const [k,q] of Object.entries(rec.measures)){
    const cell=I.metric(rec,k);
    assert.equal(cell.includes('badge-estimate'),q.kind==='model',`${id} ${k}: Estimate badge for kind ${q.kind}`);
    const pop=I.provenance(q,rec);
    assert.ok(/<dt>Source<\/dt>/.test(pop)&&/<dt>Release<\/dt>/.test(pop)&&pop.includes(rec.id),`${id} ${k}: provenance popover`);
    assert.ok(pop.includes('Release 11 Oct 2026 · Tool 0.2.4 · Preview'),`${id} ${k}: release named by its date`);
  }
  // The year control has one button per survey and a selected 2024.
  const years=I.years(rec);
  assert.equal((years.match(/class="ti-yb/g)||[]).length,rec.surveys.length);
  assert.ok(years.includes('data-year="2024" aria-pressed="true"'));
  // Protection is said for every tree, with the schedule's legal basis.
  assert.ok(panel.includes('Auckland Unitary Plan, Schedule 10'),`${id}: protection line`);
  // The records count links to the records section of the tree page.
  assert.ok(panel.includes(`href="tree.html?id=${id}#m-records"`),`${id}: records link`);
  // The root protection radius sits with the size values for every tree with a root-space scenario.
  assert.ok(/data-q="rootProtection"/.test(panel),`${id}: root protection radius in the panel`);
  // KYTE task links carry the release; one set of labels.
  for(const k of rec.know)assert.ok(panel.includes(`href="./kyte/?tree=${encodeURIComponent(id)}&amp;task=${k.task}&amp;release=${META.release.dataset_version}"`),`${id}: KYTE ${k.task}`);
  assert.ok(panel.includes('Confirm or correct the species')&&panel.includes('Flag the crown outline'));
  // Numbered links into the tree page's sections, the records and releases among them (concept C).
  const links=[...panel.matchAll(/href="tree\.html\?id=[^"#]+#m-([a-z]+)"/g)].map(m=>m[1]);
  for(const [s] of I.SECTIONS)assert.ok(links.includes(s),`${id}: link to #m-${s}`);
  // Figure keys name shapes; captions never rely on colour words.
  const key=I.figureKey(rec,{geometry:true,profile:true});
  assert.ok(/ti-sw-outline/.test(key)&&/2024 crown/.test(key));
  assert.ok(!SHAPE_WORDS.test(visible(panel)),`${id}: a colour word in the panel: ${visible(panel).match(SHAPE_WORDS)?.[0]}`);
}

// The LiDAR-detected tree: not protected (with what was checked), one record from one source, a root protection
// radius without an effective rooting radius, and the central trunk estimate (never the lowest model).
{
  const rec=build(DET),panel=visible(P.render(rec,{treeUrl:'tree.html?id='+DET}));
  assert.ok(panel.includes('Not protected · checked against the Notable Trees schedule (Auckland Unitary Plan, Schedule 10) as published in this release'),panel);
  assert.ok(panel.includes('1 record · 1 source'));
  assert.ok(panel.includes('44 cm')&&panel.includes('Range 36–52 cm'),'central trunk estimate with its range');
  assert.ok(!/\b36 cm\b/.test(panel.replace('Range 36–52 cm','')),'the lowest model is not shown as the value');
  assert.ok(panel.includes('Root protection radius 5.3 m')&&panel.includes('Range 4.3–6.3 m'),'root protection radius with its range');
  const roots=visible(I.rootRows(rec));
  assert.ok(roots.includes('5.3 m · 87 m²')&&roots.includes('Effective rooting radius None for this record'),roots);
  assert.ok(/Growth form estimated from the 2024 LiDAR survey and aerial imagery/.test(panel));
}
// The protected London plane: the scheduled group under the name, in the panel.
{
  const panel=visible(P.render(build(REG),{treeUrl:'tree.html?id='+REG}));
  assert.ok(panel.includes('Scheduled group of about 112 trees: London Plane · Notable Trees schedule (Auckland Unitary Plan, Schedule 10)'));
  assert.ok(panel.includes('Platanus × acerifolia'));
  assert.ok(panel.includes('Save to compare')&&panel.includes('Add a photo (KYTE)'),'design-system action labels');
}
// The map tile renders at once: no "not protected" claim before the record has loaded.
{
  const quick=R.fromTile({tree_id:DET,source_primary:'lidar_pointcloud_v5',crown_max_chm_m:23.7},{siteRoot:'.'});
  assert.ok(!/Not protected/.test(P.render(quick,{treeUrl:'tree.html?id='+DET})));
}
// Survey change in plain words.
assert.equal(I.surveySentence(build(DET)),'No canopy in the 2013 or 2016 LiDAR surveys is matched to this tree in this release, so 2024 is its only survey.');
assert.match(I.surveySentence(build(NOT)),/2024 is its only survey|outside the area/);

// The tree page: concept B's page without the 3D view or the browser-computed 200 m comparison; tree.html loads
// the design system, the fonts and palette.js before the modules that read colours.
const page=fs.readFileSync(web+'tree-page.js','utf8'),html=fs.readFileSync(web+'tree.html','utf8'),inst=fs.readFileSync(web+'tree-instrument.js','utf8');
for(const gone of ['load3d','tree-model.js','tree-architecture.js','localSet','equalCrown','Within 200 m','RADIUS=200'])assert.ok(!page.includes(gone)&&!inst.includes(gone),`dropped: ${gone}`);
assert.ok(!/'points'/.test(page.match(/R\.enrich\(rec,env,\{parts:\[[^\]]*\]/)[0]),'the public page reads no point crops');
const order=['palette.js','sources.js','growth-form.js','tree-record.js','tree-instrument.js','tree-page.js'].map(f=>html.indexOf(`./${f}?`));
assert.ok(order.every(i=>i>0),'tree.html scripts');
assert.ok(order[0]<order[1]&&order[0]<order[2],'palette.js loads before sources.js and growth-form.js');
assert.ok(html.includes('fonts.css')&&html.includes('tokens.css')&&html.includes('tree-instrument-page.css')&&/lang="en-NZ" data-theme="light"/.test(html));
assert.ok(page.includes('I.SECTIONS')&&page.includes("mod('records'")&&page.includes("mod('roots'"),'numbered sections, records and root space');
assert.ok(page.includes('@top-left')&&page.includes('counter(pages)'),'A4 print header and page numbers');
assert.ok(page.includes('window.ALTOTreeRecordCurrent=rec'),'the record is reachable for page checks');
const css=fs.readFileSync(web+'tree-instrument-page.css','utf8');
assert.ok(/@page\s*\{\s*size:\s*A4/.test(css)&&/@media print/.test(css),'print layout');
assert.ok(/@media screen and \(max-width: 759px\)[\s\S]*\.ti-bar-nav a \{[^}]*min-height: var\(--target-touch\)/.test(css),'numbered section chips on phones');
assert.ok(!/@media \(max-width/.test(css),'narrow layouts are for screens; print keeps the wide layout');
// The citation names the release by its date, with its number for exactness; no development-build wording.
const cite=require(web+'version.js').citation({treeId:DET,metadata:META});
assert.ok(cite.includes('Release 11 Oct 2026 (release 6, preview), tool 0.2.4')&&!/development build|Data v6/.test(cite),cite);
console.log('tree-instrument checks passed (panel, components, page wiring and the must-fixes)');
