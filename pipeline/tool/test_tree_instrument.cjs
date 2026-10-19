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
  // "(model)" belongs to the release's growth-form wording only: a model-named tree's name and the crown growth form
  // line beside a recorded species (SKP-02); nowhere else.
  const name=I.title(rec.identity).text;
  const named=panel.replace(/<h3 class="tp-name"[^>]*>[\s\S]*?<\/h3>/,' ').replace(/<p class="tp-gf">[^<]*<\/p>/,' ').split(name).join(' ');
  const text=visible(named)+' '+visible(strip)+' '+visible(I.matrix(rec))+' '+visible(I.lost(rec,{variant:'page'}))+' '+visible(I.rootRows(rec));
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
    assert.ok(pop.includes('Release 6 · 11 Oct 2026 · Tool 0.2.13 · Preview'),`${id} ${k}: release named by its number and date`);
  }
  // The year control has one button per survey and a selected 2024.
  const years=I.years(rec);
  assert.equal((years.match(/class="ti-yb[ "]/g)||[]).length,rec.surveys.length);
  assert.ok(years.includes('data-year="2024" aria-pressed="true"'));
  // Protection is said for every tree, with the schedule's legal basis.
  assert.ok(panel.includes('Auckland Unitary Plan, Schedule 10'),`${id}: protection line`);
  // The records count links to the records section of the tree page.
  assert.ok(panel.includes(`href="tree.html?id=${id}#m-records"`),`${id}: records link`);
  // The panel's root-space value is the dripline radius (the equal-area crown radius, so labelled, until the outline is
  // loaded) for every tree with a crown; the BS 5837 radius moves to the tree page, for comparison (TS-03).
  if(rec.measures.crownArea){
    assert.ok(/data-q="dripline"/.test(panel)&&!/data-q="rootProtection"/.test(panel),`${id}: dripline radius in the panel`);
    assert.ok(panel.includes('Equal-area crown radius'),`${id}: the equal-area radius is labelled as such`);
  }
  if(rec.roots)assert.ok(/data-q="rootProtection"/.test(I.rootRows(rec))&&I.rootRows(rec).includes('BS 5837 root protection radius (UK standard; 12 × trunk estimate), for comparison'),`${id}: the BS 5837 radius for comparison`);
  assert.ok(!/>Root protection radius</.test(panel+I.rootRows(rec)+strip),`${id}: no card titled "Root protection radius" on its own`);
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

// The LiDAR-detected tree: no schedule entry matched (with what ALTO does not check; never "Not protected"), one record
// from one source, the dripline radius (equal-area until the outline loads), the BS 5837 radius for comparison without
// an effective rooting radius, and the central trunk estimate with its model spread (never the lowest model).
{
  const rec=build(DET),panel=visible(P.render(rec,{treeUrl:'tree.html?id='+DET}));
  assert.ok(panel.includes('Notable Trees schedule (Auckland Unitary Plan, Schedule 10): no entry matched to this tree.')&&
    panel.includes('ALTO checks this schedule only. Other Unitary Plan tree rules (trees in roads E17, open space zones E16, overlays) are not checked; Auckland Council determines whether a tree is protected.'),panel);
  assert.ok(!/Not protected/i.test(panel),'never "Not protected"');
  assert.ok(panel.includes('1 record · 1 source'));
  assert.ok(panel.includes('44 cm')&&panel.includes('Model spread (2 models) 36–52 cm'),'central trunk estimate with its model spread');
  assert.ok(!/\b36 cm\b/.test(panel.replace('Model spread (2 models) 36–52 cm','')),'the lowest model is not shown as the value');
  assert.ok(panel.includes('Equal-area crown radius 3.2 m'),'the dripline card says it is the equal-area radius');
  const roots=visible(I.rootRows(rec));
  assert.ok(roots.includes('BS 5837 root protection radius (UK standard; 12 × trunk estimate), for comparison 5.3 m · 87 m²')&&roots.includes('Range 4.3–6.3 m (57–123 m²) from the model spread'),roots);
  assert.ok(roots.includes('Effective rooting radius None for this record'),roots);
  assert.ok(/Growth form estimated from the 2024 LiDAR survey and aerial imagery/.test(panel));
}
// The protected London plane: the scheduled group under the name, in the panel.
{
  const panel=visible(P.render(build(REG),{treeUrl:'tree.html?id='+REG}));
  // A group member whose species matches the group's name is "part of" it (TS-01); the schedule and its law follow.
  assert.ok(panel.includes('Notable Trees schedule · Part of scheduled group, ‘London Plane (approx. 112)’')&&panel.includes('Notable Trees schedule (Auckland Unitary Plan, Schedule 10).'),panel.slice(0,400));
  assert.ok(panel.includes('Platanus × acerifolia'));
  assert.ok(panel.includes('Save to compare')&&panel.includes('Add a photo (KYTE)'),'design-system action labels');
}
// The map tile renders at once: no "not protected" claim before the record has loaded.
{
  const quick=R.fromTile({tree_id:DET,source_primary:'lidar_pointcloud_v5',crown_max_chm_m:23.7},{siteRoot:'.'});
  assert.ok(!/Not protected/.test(P.render(quick,{treeUrl:'tree.html?id='+DET})));
}
// Survey change in plain words.
// Earlier surveys without a linked crown are "not linked", never "not detected" (FTA-07).
assert.equal(I.surveySentence(build(DET)),'No LiDAR crown from 2013 or 2016 is linked to this tree in this release, so 2024 is its only survey.');
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
assert.ok(cite.includes('Release 11 Oct 2026 (release 6, preview), tool 0.2.13')&&!/development build|Data v6/.test(cite),cite);
// ---- Release 6.2 records: the 22 trees the 13 Oct 2026 review names (fixtures/tree-records-v62.json) ----
{
  const F62=require('./fixtures/tree-records-v62.json'),M62=F62.metadata;
  const b62=n=>{const t=F62.trees[n];return R.assemble({id:t.id,record:t.record,schema:F62.schema,members:t.members,memberCount:t.memberCount,metadata:M62,env:{siteRoot:'.',dataBase:'./data',metadata:M62}});};
  const PAGE_KEYS=['height','crownArea','crownDiameter','crownSpread','dripline','rootZone','rootZoneColumnar','trunkDiameter','largestStem','rootProtection','lifeStage','benefits','carbonStored','replacementYears','irreplaceability'];
  const G=globalThis.ALTOGrowthForm;
  let estimates=0;
  for(const n of Object.keys(F62.trees)){
    const rec=b62(n);
    // FTA-11: every key card marked Estimate shows a range, the model spread or that the release computed none.
    for(const li of I.strip(rec,PAGE_KEYS).split('<li class="ti-m"').slice(1)){
      if(!li.includes('badge-estimate'))continue;
      estimates++;
      const key=(li.match(/data-q="([^"]+)"/)||[])[1],line=visible((li.match(/<span class="ti-m-p">([\s\S]*?)<\/span>/)||[])[1]||'').trim();
      assert.ok(/^Range |^Model spread \(\d models\) |Range not computed in release 6\.2/.test(line),`${n} ${key}: an Estimate card without a range: "${line}"`);
    }
    // SKP-02: a model-named tree is titled in the release's wording, never by its top score; a recorded species keeps
    // its name, with the release's call beside it as the crown growth form (model).
    const id=rec.identity,t=I.title(id);
    assert.ok(!/\d\s*%/.test(t.text+' '+(t.note||'')),`${n}: no class percentage in the title or its note`);
    if(id.nameKind==='model')assert.equal(t.text,G.wording(id.growthForm.key||G.key(rec._ctx.props||{},rec._ctx.record)),`${n}: the release wording`);
    if(id.nameKind==='recorded'&&id.growthForm?.shown&&!id.nameMulti)assert.match(I.crownForm(id),/^Crown growth form \(model\): /,`${n}: crown growth form`);
    // TS-15: heights between surveys are compared like for like; a rate never prints as "−0".
    assert.ok(!/−0(?![.,]\d*[1-9])/.test(I.surveySentence(rec)),`${n}: ${I.surveySentence(rec)}`);
  }
  assert.ok(estimates>100,`Estimate cards checked: ${estimates}`);
  // The trees the review names.
  const T=n=>I.title(b62(n).identity).text;
  assert.deepEqual(['TADY8HB7','TFB5RTYE','TH5A0EQY'].map(T),['Likely conifer (model)','Probably evergreen broadleaf (model)','Broadleaf (model)']);
  for(const n of ['TA2WKG3S','T162DYHP']){const id=b62(n).identity;assert.equal(id.nameKind,'none');assert.equal(I.title(id).note,'Growth form not yet determined. No species recorded.');}
  const tm=b62('TMCTT6X4');
  assert.equal(tm.measures.trunkDiameter.text,'27 cm');assert.equal(I.line(tm.measures.trunkDiameter),'Range not computed in release 6.2 · Not measured');
  assert.equal(I.surveySentence(b62('TZ69KK1G')),'Height at the matched canopy point: 15.0 m 2013, 15.6 m 2016, 15.6 m 2024 (no detectable change 2013–2016; no detectable change 2016–2024). 2024 crown maximum 18.7 m (a different measure).');
  // SKP-03: one constant for "unusually tall for Auckland".
  const A=require(web+'area.js');
  assert.equal(R.TALL_M,55);assert.equal(A.TALL_M,R.TALL_M,'Area reads tree-record.js TALL_M');
  assert.ok(R.isTall(55)&&!R.isTall(54.9));
  const tall=b62('T6Z3DYC8');
  assert.equal(I.line(tall.measures.height),'Height 79.9 m · unusually tall for Auckland: possibly a power line, structure or noise; not used in rankings');
  assert.equal(tall.context.status,'pending');
}
// SKP-02: every display key of the release (growth-form.js WORDING), from a map tile: the wording, never a score; an
// undetermined call names no class.
for(const k of Object.keys(globalThis.ALTOGrowthForm.WORDING)){
  const rec=R.fromTile({tree_id:'akl_tree_pc5_k',source_primary:'lidar_pointcloud_v5',gf6:k,crown_max_chm_m:12,evidence_tier:'very_likely'},{siteRoot:'.'}),t=I.title(rec.identity);
  if(k==='not_determined')assert.deepEqual([rec.identity.nameKind,t.text,t.note],['none','LiDAR-detected tree','Growth form not yet determined. No species recorded.'],k);
  else assert.deepEqual([rec.identity.nameKind,t.text,t.estimate],['model',globalThis.ALTOGrowthForm.WORDING[k],true],k);
  assert.ok(!/\d\s*%/.test(t.text+' '+(t.note||'')),`${k}: no percentage`);
}
// TS-15: within ±1 m between surveys there is no detectable change, and a tiny negative rate never prints "−0".
assert.equal(I.rateText(-0.002),'no detectable change');
assert.equal(I.rateText(-0.002,{change:-0.016,from:2016,to:2024}),'no detectable change 2016–2024');
assert.equal(I.rateText(0.35,{change:2.8,from:2016,to:2024}),'+0.35 m a year 2016–2024');
assert.equal(I.rateText(-0.4,{change:-3.2,from:2016,to:2024}),'−0.4 m a year 2016–2024');
// LOC-01: the location row on the tree page (hero ID line) and in the map panel: coordinates with Copy, what the position
// is, plain links to Google Maps, Street View and OpenStreetMap in a new tab with rel=noopener and a spoken new-tab note.
{
  const reg=build(REG),panel=P.render(reg,{treeUrl:'tree.html?id='+REG,kyteBase:'./kyte'});
  const L=R.location(reg),locDd=panel.slice(panel.indexOf('<dd class="tp-sub tp-loc">'),panel.indexOf('</dd>',panel.indexOf('<dd class="tp-sub tp-loc">')));
  assert.ok(locDd.includes(`<code>${L.text}</code>`)&&locDd.includes('data-panel-action="copy-coords"')&&locDd.includes('aria-label="Copy the coordinates (latitude, longitude)"'),'panel: coordinates with Copy');
  assert.ok(locDd.includes(`<small>${L.caption}</small>`)&&/^Recorded position as supplied by Auckland Council’s tree register \(Council position (not )?verified\); the map pin\. Latitude, longitude \(WGS84\)\.$/.test(L.caption),'panel: what the position is');
  const anchors=[...locDd.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener" data-loc="(\w+)">([^<]+)<span class="sr-only"> at this position \(opens in a new tab\)<\/span><\/a>/g)];
  assert.deepEqual(anchors.map(m=>[m[3],m[1].replace(/&amp;/g,'&')]),L.links.map(l=>[l.label,l.href]),'panel: three plain links, new tab, noopener, spoken new-tab note');
  assert.ok(page.includes('${locationItem()}</dl></div>')&&/function locationItem\(\)\{\s*const L=R\.location\(rec\);/.test(page),'tree page: a Location row in the hero ID line');
  assert.ok(page.includes(`id="copyCoords" aria-label="Copy the coordinates (latitude, longitude)"`)&&page.includes("$('#copyCoords')?.addEventListener('click'"),'tree page: Copy for the coordinates');
  assert.ok(page.includes('target="_blank" rel="noopener" data-loc=')&&page.includes("newTab('at this position')"),'tree page: plain links in a new tab');
  assert.ok(/if\(name==='context'\|\|name==='place'\)\{const n=\$\('#heroNear'\);if\(n\)n\.textContent=R\.nearLine\(rec\)\|\|'';\}/.test(page),'tree page: nearest address point and parcel once read');
  assert.ok(page.includes("await R.parcel(rec,env,pid).catch(()=>null);")&&page.includes("const hn=$('#heroNear');if(hn)hn.textContent=R.nearLine(rec)||'';"),'tree page: the parcel joins the location row');
  const css=fs.readFileSync(web+'tree-instrument-page.css','utf8');
  assert.ok(/\.ti-idline \.ti-loc \{ grid-column: 1 \/ -1; \}/.test(css),'tree page: the Location row spans the ID line');
  const det=build(DET),dpanel=P.render(det,{treeUrl:'t'});
  assert.ok(dpanel.includes('Crown top in the 2024 LiDAR survey; the map pin.'),'panel: a LiDAR crown names its crown top');
}
// TS-03: a record outside its crown outline measures the dripline from the crown top, and says so on the card.
{
  const rec=build(REG),pos=rec.identity.position,kx=Math.cos(pos.lat*Math.PI/180)*111320,ky=110540,pt=(dx,dy)=>[pos.lon+(30+dx)/kx,pos.lat+dy/ky];
  const g={type:'Polygon',coordinates:[[pt(-2,-3),pt(8,-3),pt(8,3),pt(-2,3),pt(-2,-3)]]},top=R._internal.nztm(...pt(0,0));
  rec._ctx.record.datasets.identity={...(rec._ctx.record.datasets.identity||{}),seg_key:`pc_X_1000_0001:${top[0].toFixed(2)}:${top[1].toFixed(2)}`};
  const panel=P.render(rec,{treeUrl:'t',geometry:g}),cardAt=panel.indexOf('data-q="dripline"'),card=panel.slice(cardAt,panel.indexOf('</div>',panel.indexOf('</small>',cardAt)));
  assert.ok(/8\.[56]\b/.test(visible(card))&&card.includes('Crown top to the farthest outline point (the recorded position is outside the outline)'),`dripline from the crown top: ${visible(card)}`);
  assert.equal(typeof P.metrics,'function','the map redraws the panel measurements when the outline arrives');
}
// TS-14: kauri survey result codes are their own row, as supplied, with the Council layer's code definitions.
{
  const sc=I.surveyCodes({identity:{nameCodes:'PA+ PC+ soil:P. cinnamomi'}});
  assert.equal(sc.line,'Council kauri survey (Ruru ObsKauri Tiaki): result codes as supplied: PA+ PC+ soil: P. cinnamomi');
  assert.equal(sc.codes,'PA+ PC+ soil: P. cinnamomi');
  assert.deepEqual(sc.flags,['PA+','PC+']);assert.equal(sc.soil,'P. cinnamomi');
  assert.ok(sc.explain.startsWith('The Council layer’s field definitions code each Phytophthora result as Present, Not detected or NA. PA+ (Phytophthora agathidicida) and PC+ (Phytophthora cinnamomi) mark a result of Present or Not detected; this release does not keep which.'),sc.explain);
  assert.ok(sc.explain.endsWith('“soil:” is the layer’s Soil Sample Result field, free text as supplied.'));
  assert.ok(sc.explainHtml.includes('<i>Phytophthora agathidicida</i>')&&sc.explainHtml.includes('<i>Phytophthora cinnamomi</i>'),'Latin names in italics');
  assert.ok(/FeatureServer\/0$/.test(sc.fields),'links the layer page that publishes the field definitions');
  const one=I.surveyCodes({identity:{nameCodes:'PA+'}});
  assert.equal(one.line,'Council kauri survey (Ruru ObsKauri Tiaki): result codes as supplied: PA+');
  assert.ok(one.explain.includes('PA+ (Phytophthora agathidicida) marks a result')&&!one.explain.includes('soil'));
  assert.equal(I.surveyCodes({identity:{}}),null);
  const page=fs.readFileSync(web+'tree-page.js','utf8');
  assert.ok(page.includes("kv('Council kauri survey (Ruru ObsKauri Tiaki)',`${codes.release63?'Result as supplied':'Result codes as supplied'}: ${esc(codes.codes)}`")&&page.includes("link(codes.fields,'Council layer')"),'tree page: the survey row, its code definitions link, credit and caveat');
  assert.ok(page.includes("${esc(codes.credit||'Bio Info Team, Environmental Services, Auckland Council')}")&&page.includes("${esc(codes.caveat||'Not a complete record; verify before relying on it.')}"),'release 6.3: the survey dataset’s own credit and caveat');
  assert.ok(!/soil sample result as supplied/.test(page+fs.readFileSync(web+'tree-instrument.js','utf8')),'the old wording is gone');
}
// A11Y-01: the sticky stack, measured. The app bar and the section bar stay while they take at most a fifth of the
// window's height; past that the section bar scrolls with the page, then the app bar; focus and section links clear
// the stack that stays by 8 px (html scroll-padding-top, each section's scroll-margin-top, --ti-stack).
{
  const plan=(t,b,h)=>{const p=I.stickyPlan({top:t,bar:b,height:h});return [p.barStatic,p.topStatic,p.stack,p.offset];};
  assert.deepEqual(plan(56,54,900),[false,false,110,118],'1440 × 900: both bars stay; 118 px');
  assert.deepEqual(plan(56,110,844),[false,false,166,174],'390 × 844: the two-row bar stays at 19.7%');
  assert.deepEqual(plan(56,110,700),[true,false,56,64],'390 × 700: the two-row bar would take 24%; it scrolls with the page');
  assert.deepEqual(plan(56,98,450),[true,false,56,64],'720 × 450: the bar scrolls; the app bar stays (12%)');
  assert.deepEqual(plan(56,110,256),[true,true,0,8],'320 × 256: both bars scroll with the page');
  for(const [t,b,h] of [[56,54,900],[56,110,844],[56,98,450],[56,110,256],[56,110,500],[48,90,600]])assert.ok(I.stickyPlan({top:t,bar:b,height:h}).stack<=h*0.2,`${t}+${b} in ${h}: at most 20% stays stuck`);
  assert.equal(I.sectionScroll(1200,300,174),1326,'a section lands 174 px below the window top');
  assert.equal(I.sectionScroll(50,0,174),0,'never above the page top');
  const css=fs.readFileSync(web+'tree-instrument-page.css','utf8'),tp=fs.readFileSync(web+'tree-page.css','utf8'),page=fs.readFileSync(web+'tree-page.js','utf8');
  assert.ok(tp.includes('html { scroll-behavior: smooth; scroll-padding-top: var(--ti-stack, 76px); }')&&tp.includes('html { scroll-padding-top: var(--ti-stack, 120px); }'),'html scroll-padding-top is the measured stack');
  assert.equal((css.match(/scroll-margin-top: var\(--ti-stack, /g)||[]).length,2,'.ti-mod scroll-margin-top is the measured stack (desktop and phone)');
  assert.ok(css.includes('html.ti-bar-static .ti-bar { position: static; }')&&css.includes('html.ti-top-static .ti-page .tpg-top { position: static; }'),'static bars');
  assert.ok(/\.ti-page \.skip-link:focus \{ position: fixed; [^}]*top: max\(var\(--ti-stack, 64px\), calc\(var\(--ti-top, 56px\) \+ 8px\)\); \}/.test(css),'the skip link shows below the bars');
  assert.ok(css.includes('.ti-mini thead th, .ti-mini thead .num { white-space: normal; }'),'the survey table fits a phone (no sideways scroll)');
  assert.ok(/new ResizeObserver\(fit\);if\(top\)ro\.observe\(top\);if\(bar\)ro\.observe\(bar\);/.test(page)&&page.includes("root.style.setProperty('--ti-stack',`${p.offset}px`)"),'tree page: the stack measured and kept current by a ResizeObserver');
  assert.ok(page.includes("document.addEventListener('click',e=>{")&&page.includes("history.pushState(null,'',hash);")&&page.includes('pinTo(hash,{focus:true});')&&!page.includes("document.querySelector(location.hash)?.scrollIntoView()"),'tree page: section links land below the bars and stay while later parts render');
  assert.ok(page.includes("for(const ev of ['wheel','touchmove','keydown'])addEventListener(ev,unpin,{passive:true});"),'the reader scrolling or typing releases the pin');
}
// FE-03: the tree before everything else. tree.html starts the release metadata and the two lookup schemas from <head>
// (window.ALTO_PREFETCH, taken by URL); the page shows the hero, then reads the crown's other records, Species maxima and
// the notable-tree facts; the inset map and its libraries start when the map or Place and property nears the screen.
{
  const html=fs.readFileSync(web+'tree.html','utf8'),page=fs.readFileSync(web+'tree-page.js','utf8');
  // FE-15: the prefetch is a file (tree-prefetch.js), loaded straight after the site settings, before the stylesheets.
  const pre=fs.readFileSync(web+'tree-prefetch.js','utf8'),at=s=>html.indexOf(s);
  assert.ok(at('<script src="./site-config.js?v=')>0&&at('<script src="./site-config.js?v=')<at('<script src="./tree-prefetch.js?v=')&&at('<script src="./tree-prefetch.js?v=')<at('<link rel="stylesheet" href="./tokens.css'),'tree.html: the prefetch runs in <head>, after the site settings and before the stylesheets');
  const inline=[pre];
  const calls=[];let metaResolve;
  const win={AKL_DATA_BASE:'./data',AKL_TILE_VERSION:'auto'};
  const fetchStub=(u,o)=>{calls.push([u,o?.cache||null]);if(/release-metadata/.test(u))return new Promise(r=>{metaResolve=r;});return Promise.resolve({ok:true,url:u});};
  new Function('window','fetch',inline[0])(win,fetchStub);
  metaResolve({ok:true,clone:()=>({json:async()=>({assembly:{tile_version:'20261013-v6.2'},derived_products:{tree_ids:'data/tree_ids/schema.json'}})})});
  setTimeout(async()=>{
    assert.deepEqual(calls,[['./release-metadata.json',null],['./data/tree_details/schema.json?v=20261013-v6.2',null],['./data/tree_ids/schema.json?v=20261013-v6.2',null]],'prefetch: metadata, then both schemas at the version the page uses');
    const p=win.ALTO_PREFETCH.take('./data/tree_ids/schema.json?v=20261013-v6.2');
    assert.ok(p&&(await p).url==='./data/tree_ids/schema.json?v=20261013-v6.2'&&win.ALTO_PREFETCH.take('./data/tree_ids/schema.json?v=20261013-v6.2')===null,'prefetch: taken once, by URL');
  },20);
  for(const f of ['tree-id.js','tree-details.js'])assert.ok(fs.readFileSync(web+f,'utf8').includes('res=await (root.ALTO_PREFETCH?.take?.(url)||fetch(url));'),`${f}: takes a prefetched schema`);
  assert.ok(page.includes("r=await (window.ALTO_PREFETCH?.take?.(url)||fetch(url,{credentials:'same-origin'}));"),'tree page: takes the prefetched metadata (the host caches it for a minute, FE-04)');
  // FE-04: the scenario module loads with the build's stamp.
  assert.ok(page.includes("script(window.ALTOVersion?.asset?window.ALTOVersion.asset('./tree-future.js'):'./tree-future.js')")&&!page.includes('20260928-v5b'),'tree page: tree-future.js with the build stamp');
  const r=page.indexOf('    render();\n    // FE-03'),mx=page.indexOf("window.ALTOMaxima.load(env,{facts:true,trees:[rec.number].filter(Boolean)})");
  assert.ok(r>0&&mx>r&&!page.includes('Promise.race([maxima'),'tree page: Species maxima and the notable-tree facts after the hero');
  assert.ok(page.includes('rec=await R.load(raw,env,{resolved,later:true});')&&page.includes("R.loadMembers(rec)")&&page.includes("swapMod('records',records())")&&page.includes("Promise.all([crown,later()]).then(()=>R.enrich(rec,env,{parts:['context'],onPart}))"),'tree page: the crown’s other records after the hero; comparisons after them (and after the board reader, FE-03)');
  assert.ok(/function lazyMap\(\)\{[\s\S]*?new IntersectionObserver\(es=>\{if\(es\.some\(e=>e\.isIntersecting\)\)\{io\.disconnect\(\);miniMap\(\);\}\},\{rootMargin:'100% 0px'\}\)/.test(page)&&page.includes("[$('#miniMap'),$('#placeBody')]")&&page.includes('    lazyMap();')&&page.includes("const waiting=new Set(['parts']);"),'tree page: the inset map starts near the screen; the hero never waits for it');
}
// UX-08b: sections 9-14 sit in one column at every width, in SECTIONS order, so the visual and tab order follow the numbers.
{
  const css=fs.readFileSync(web+'tree-instrument-page.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  const flow=[...css.matchAll(/([^{}]*\.ti-flow[^{}]*)\{([^}]*)\}/g)];
  assert.ok(flow.length&&flow.every(([,,body])=>!/(?:^|[\s;])columns\s*:|column-count|column-width/.test(body)),'tree page: no multi-column flow');
  assert.ok(/^\.ti-flow \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: var\(--space-4\); \}$/m.test(css),'tree page: sections 9-14 in one column');
  const order=/<div class="ti-flow">\$\{species\(\)\}\$\{benefits\(\)\}\$\{mapped\(\)\}\$\{mod\('history'[\s\S]*?\$\{mod\('place'[\s\S]*?\$\{know\(\)\}<\/div>/.test(page);
  const ids=I.SECTIONS.map(x=>x[0]),nums=['species','benefits','mapped','history','place','know'].map(id=>ids.indexOf(id)+1);
  assert.ok(order&&nums.join()===[9,10,11,12,13,14].join(),'tree page: the flow holds sections 9-14 in number order');
}
// UX-16: once a tree is saved, "Saved trees (n)" in the map panel's header (or beside About on the map dock, where the
// header is out of sight) and in the tree panel; each opens the comparison.
{
  const map=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8'));
  const head=/<header class="lp-head">[\s\S]*?<\/header>/.exec(map)[0];
  assert.ok(/<button id="collapseAside"[^\n]*\n\s*<button id="savedTreesBtn" class="lp-about lp-saved" type="button" data-saved-trees aria-haspopup="dialog" aria-controls="treeComparison" hidden><span data-saved-count>Saved trees \(0\)<\/span><\/button>\n\s*<\/header>/.test(head),'map panel header: Saved trees (n), last, hidden until a tree is saved');
  assert.ok(/id="aboutDockBtn"[\s\S]*?<\/button><button id="savedTreesDock" class="saved-dock" type="button" data-saved-trees aria-haspopup="dialog" aria-controls="treeComparison" hidden>/.test(map),'map dock: Saved trees (n) beside About');
  assert.ok(map.includes('for (const id of ["savedTreesBtn", "savedTreesDock"]) document.getElementById(id)?.addEventListener("click", () => ALTOEvidenceWorkspace.show());'),'both open the comparison');
  assert.ok(map.includes('savedCount: ALTOEvidenceWorkspace.count(),')&&map.includes(`profileBody.querySelector('[data-panel-action="compare"]')?.addEventListener("click", () => ALTOEvidenceWorkspace.show());`),'tree panel: rendered with the count, opens the comparison');
  const rec=build(REG),none=P.render(rec,{treeUrl:'x'}),two=P.render(rec,{treeUrl:'x',savedCount:2});
  assert.ok(/<button type="button" class="btn" data-panel-action="compare" data-saved-trees aria-haspopup="dialog" aria-controls="treeComparison" hidden><span data-saved-count>Saved trees \(0\)<\/span><\/button>/.test(none),'tree panel: hidden with nothing saved');
  assert.ok(two.includes('data-saved-trees aria-haspopup="dialog" aria-controls="treeComparison"><span data-saved-count>Saved trees (2)</span></button>'),'tree panel: Saved trees (2)');
  // the workspace keeps every such control in step with the count
  const span={textContent:''},els=[{hidden:true,querySelector:()=>span},{hidden:true,textContent:'',querySelector:()=>null}];
  const store={};
  global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v;}};
  global.document={getElementById:()=>null,querySelectorAll:sel=>sel==='[data-saved-trees]'?els:[]};
  global.window={location:{href:'https://alto.test/'}};
  delete require.cache[require.resolve(web+'evidence-workspace.js')];
  require(web+'evidence-workspace.js');
  const W=global.window.ALTOEvidenceWorkspace;
  W.update();
  assert.ok(els.every(e=>e.hidden),'nothing saved: hidden');
  W.toggle('akl_tree_not_336');W.toggle('akl_tree_lid_1110327');
  assert.ok(els.every(e=>!e.hidden)&&span.textContent==='Saved trees (2)'&&els[1].textContent==='Saved trees (2)','two saved: shown with the count');
  W.toggle('akl_tree_not_336');W.toggle('akl_tree_lid_1110327');
  assert.ok(els.every(e=>e.hidden),'none left: hidden again');
  delete global.document;delete global.window;delete global.localStorage;
}
// A11Y-09: the provenance popover opens right after its trigger in the DOM (unless a positioned box between them would
// clip it), takes none of the trigger's text styles, and closes when focus leaves it and its trigger, without pulling
// focus back; the tree page's More sections menu closes the same way.
{
  const src=fs.readFileSync(web+'tree-instrument.js','utf8'),css=fs.readFileSync(web+'tree-instrument.css','utf8'),page=fs.readFileSync(web+'tree-page.js','utf8');
  assert.ok(src.includes("if(ok){if(btn.nextElementSibling!==pop)btn.after(pop);}else if(pop.parentElement!==scope||scope.lastElementChild!==pop)scope.append(pop);"),'popover after its trigger');
  assert.ok(src.includes("for(let el=btn.parentElement;el&&el!==scope;el=el.parentElement)if(getComputedStyle(el).position!=='static'){ok=false;break;}"),'kept in the scope where a positioned box would clip it');
  assert.ok(/const open=\(q,btn\)=>\{\s*place\(btn\);/.test(src),'placed before it is shown');
  assert.ok(src.includes('const cb=pop.offsetParent||scope,cr=cb.getBoundingClientRect()'),'offsets within its containing block');
  assert.ok(src.includes("pop.addEventListener('focusout',e=>{")&&src.includes('close({refocus:false});'),'focus leaving closes it');
  assert.ok(src.includes("const close=({refocus=true}={})=>{")&&src.includes('if(refocus)opener?.focus({preventScroll:true});'),'Escape and the close button still return focus');
  assert.ok(src.includes("let pop=scope.querySelector(`#${id}.ti-pop`)||scope.querySelector(':scope > .ti-pop');"),'found wherever it was placed');
  assert.ok(/\.ti-pop \{[^}]*font: var\(--text-body-ui\); color: var\(--color-text\); text-align: left; white-space: normal;/.test(css),'no inherited table or figure text styles');
  assert.ok(page.includes("const wrap=b.closest('.ti-nav-more');")&&page.includes("wrap?.addEventListener('focusout',e=>{")&&page.includes('if(!m.hidden&&document.hasFocus?.()&&!wrap.contains(document.activeElement))close();'),'More menu closes on focusout');
  assert.ok(/<button type="button" class="ti-nav-more-btn" aria-expanded="false" aria-controls="navMore">More<span class="ti-nav-more-n"><\/span><\/button>\s*<ol class="ti-nav-menu" id="navMore" hidden>/.test(page),'the menu follows its button');
}
// A11Y-13: the permalink has a 24 px line of its own under Copy; on a touch screen values, Method links, the inset map's
// controls and the sheet handles reach 44 px (values through an invisible area, their rows 44 px apart); the selected
// year, frame or basemap carries a 2 px bar in the text colour, not the fill alone.
{
  const css=fs.readFileSync(web+'tree-instrument.css','utf8'),pcss=fs.readFileSync(web+'tree-instrument-page.css','utf8'),mcss=fs.readFileSync(web+'map.css','utf8');
  const ins=fs.readFileSync(web+'tree-instrument.js','utf8'),page=fs.readFileSync(web+'tree-page.js','utf8'),panel=fs.readFileSync(web+'tree-panel.js','utf8');
  assert.ok(pcss.includes('.ti-idline dd small { margin-top: var(--space-1); }')&&pcss.includes('.ti-idline dd small .ti-permalink { display: inline-block; min-height: 24px; padding: 4px 0; }'),'permalink line');
  assert.ok(css.includes('.ti-v::after, .ti-mlink::after { content: ""; position: absolute; left: 50%; top: 50%; width: max(100%, var(--target-touch)); height: max(100%, var(--target-touch)); transform: translate(-50%, -50%); }'),'44 px hit areas');
  assert.ok(css.includes('.ti-table tr:has(.ti-v) > :is(th, td) { height: var(--target-touch); box-sizing: border-box; }')&&css.includes('.ti-kv:has(.ti-v), .ti-row:has(.ti-v) { min-height: var(--target-touch); box-sizing: border-box; }'),'value rows 44 px apart');
  assert.ok(css.includes('.ti-mlink { display: inline-block; padding: 5px 0; margin: -5px 0; }'),'Method links 24 px tall');
  assert.equal((ins.match(/<a class="ti-mlink" href=/g)||[]).length,2);assert.ok(page.includes(`<a$`+`{t==='Method'?' class="ti-mlink"':''} href=`)&&panel.includes('<a class="ti-mlink" href="${esc(base)}#m-structure">Method</a>'),'Method links tagged');
  assert.ok(/@media \(pointer: coarse\) \{ \.ti-minimap \.maplibregl-ctrl-group button \{ width: var\(--target-touch\); height: var\(--target-touch\); \} \.ti-mm button \{ min-height: var\(--target-touch\); \} \}/.test(pcss),'inset map controls');
  assert.ok(pcss.indexOf('.ti-minimap .maplibregl-ctrl-group button')>pcss.indexOf('.ti-mm button { min-height: var(--control-sm)'),'after the rule it overrides');
  assert.ok(mcss.includes('@media (pointer: coarse) { .lp-handle { height: var(--target-touch); } }')&&mcss.includes('@media (pointer: coarse) { .sheet-handle { height: var(--target-touch); } }'),'sheet handles');
  assert.ok(css.includes('.ti-yb[aria-pressed="true"] { background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-1), inset 0 -2px 0 var(--color-text); }'),'year, frame and viewer controls: a bar, not only a fill');
  assert.ok(mcss.includes('box-shadow: 0 1px 3px rgb(23 32 26 / 14%), inset 0 -2px 0 currentColor; }')&&mcss.includes('body .basemap-switch button.active { background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-1), inset 0 -2px 0 var(--color-text); }'),'basemap switches');
}
// Survey-year chips (TS-15): two lines, the year and height over the measure (or why there is no height), so a chip
// never needs more than its share of the strip; status words in the survey table wrap in their cells.
{
  const S=[{year:2013,height:{key:'height',value:15,kind:'measured',provenance:{}}},{year:2016,status:'unlinked',line:'No crown linked in 2016'},{year:2024,height:{key:'height',value:18.7,kind:'measured',provenance:{}}}];
  const y=I.years({surveys:S});
  assert.ok(y.includes('<span class="ti-yb-l"><b>2013</b><span>15.0 m</span></span><small class="ti-yb-m">matched point</small>'),y);
  assert.ok(y.includes('<span class="ti-yb-l"><b>2024</b><span>18.7 m</span></span><small class="ti-yb-m">crown maximum</small>'),y);
  assert.ok(y.includes('<span class="ti-yb-l"><b>2016</b></span><small class="ti-yb-x">not linked</small>'),y);
  const icss=fs.readFileSync(web+'tree-instrument.css','utf8'),pcss=fs.readFileSync(web+'tree-instrument-page.css','utf8');
  assert.ok(/\.ti-yb-s \{[^}]*flex-direction: column;[^}]*white-space: normal;/.test(icss),'two-line chips that may wrap');
  assert.ok(/\.ti-yb-s \.ti-yb-m, \.ti-yb-s \.ti-yb-x \{[^}]*overflow-wrap: break-word;/.test(icss));
  assert.ok(pcss.includes('.ti-mini td .ti-na { white-space: normal; }'),'status words wrap in the survey table');
}
// Comparison strips (SKP-03): a table with a 99th percentile ends there; a street table, stored in 5% steps, ends at its
// 95th percentile and says so; the top value is named apart as "highest value (unverified)", never as a percentile.
{
  const P1=[...Array(100).keys(),99.5,99.9,100],Q1=P1.map(p=>p/5);
  const city=I.distStrip('height',{value:12,dist:{kind:'quantiles',quantiles:Q1,probabilities:P1},text:'Above 60%',n:5000});
  assert.ok(city.includes('>99th pct 19.8 m</text>'),city);
  assert.ok(/highest value \(unverified\) 20 m/.test(visible(city)));
  assert.ok(/the strip ends at the 99th percentile, 19\.8 m; highest value \(unverified\) 20 m/.test(city),'aria-label');
  const P2=Array.from({length:21},(_,i)=>i*5),Q2=P2.map(p=>p===100?17.03:p===95?12.95:p/10);
  const street=I.distStrip('height',{value:9,dist:{kind:'quantiles',quantiles:Q2,probabilities:P2},text:'Above 80%',n:40});
  assert.ok(street.includes('>95th pct 13 m</text>'),street);
  assert.ok(!/99th/.test(street),'a street strip never names a 99th percentile');
  assert.ok(/the strip ends at the 95th percentile, 13 m; highest value \(unverified\) 17 m/.test(street),'street aria-label');
  assert.ok(/highest value \(unverified\) 17 m/.test(visible(street)));
  const tall=I.distStrip('height',{value:16,dist:{kind:'quantiles',quantiles:Q2,probabilities:P2},text:'Above 99%',n:40});
  assert.ok(/is-beyond/.test(tall)&&/beyond the strip’s end/.test(tall),'a tree past the 95th percentile sits at the strip’s end');
  const few=I.distStrip('height',{value:9,dist:{kind:'values',values:[4,7,9,11]},text:'2nd tallest of 4',n:4});
  assert.ok(!/pct|highest value/.test(few),'a strip of each value has no percentile end');
}
console.log('tree-instrument checks passed (panel, components, page wiring and the must-fixes)');
