// Offline checks for Species maxima and the tree page's Recognition block (tool 0.2.8, web/species-maxima.js):
// badges for clear leads only, one combined line per tree, kauri never shown, Recognition facts credited and linked
// (no held Council entry, no Council DocumentURL, NZ Tree Register identifier and link only), the list page's filters
// and sorting, the KYTE girth link behind its flag, and the pages that load and link it.
// Fixtures: pipeline/tool/fixtures/species-maxima-fixture.json and notable-facts-fixture.json (subsets of the 13 Oct
// 2026 files plus synthetic TTEST… rows). When the full files are on the T7 drive, their counts are checked too.
// Usage: node pipeline/tool/test_species_maxima.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');
const fixture=f=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',f),'utf8'));
require(web+'credits.js');
// The pages load species-names.js before species-maxima.js: names in their display form (macrons, sentence case).
require(web+'species-names.js');
const M=require(web+'species-maxima.js');
const plain=s=>String(s??'').replace(/<[^>]+>/g,'').replace(/ /g,' ').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&');
const D=M.prepare(fixture('species-maxima-fixture.json'),fixture('notable-facts-fixture.json'));

// ---- kauri and held rows: never shown
assert.ok(!D.maxima.some(m=>/^Agathis/.test(m.species)),'kauri maxima are dropped');
assert.ok(!D.maxima.some(m=>m.hold_reason),'held rows are dropped');
assert.equal(M.held({species:'Agathis australis'}),true);
assert.equal(M.held({species:'Agathis robusta'}),true,'any Agathis');
assert.equal(M.held({species:'Quercus robur'}),false);
for(const t of ['TTESTKA1','TTESTHE1']){
  assert.equal(M.badge(D,t),null,`${t}: no badge`);
  assert.equal(M.recognition(D,t),null,`${t}: no Recognition`);
  assert.ok(!M.mapSet(D,'Auckland').trees.includes(t),`${t}: not ringed`);
  assert.equal(M.girthHref(D,t,{config:{girthTask:true}}),null,`${t}: no KYTE girth mission`);
}
assert.ok(!M.listRows(D,{measure:'max_height',area:'Auckland'}).some(r=>/kauri|Agathis/i.test(r.name+r.species)),'kauri never listed');
assert.ok(!M.listRows(D,{measure:'max_crown_area',area:'Auckland'}).some(r=>r.tree==='TTESTHE1'),'a held row is never listed');

// ---- badge selection: clear leads only (within_margin false); Auckland-wide before local board
assert.equal(M.badge(D,'T055W90F'),null,'near-tie only (21.9 m, next 21.9 m): no badge');
assert.equal(M.badge(D,'TZ69KK1G'),null,'near-tie only: no badge');
assert.deepEqual(M.badgeMaxima(D,'TSG2SSKH').map(m=>m.area),['Auckland'],'Auckland-wide beats the local board');
assert.deepEqual(M.badgeMaxima(D,'TNXWY21K').map(m=>`${m.measure}/${m.area}`),['max_crown_spread/Auckland'],'the near-tie crown area (Waitematā) is left out');
assert.deepEqual(M.badgeMaxima(D,'TW9QK0A0').map(m=>m.measure),['max_height','max_crown_spread','max_crown_area'],'measures in order');
// ---- badge text: one line per tree naming the ranked population and its count (SKP-15), crown spread as "widest crown
// spread" (TS-18); te reo Māori names take no plural s
assert.equal(plain(M.badge(D,'TSG2SSKH').text),'Maximum · tallest of 83 Norfolk Island pines named in Council records with a checked 2024 crown (2024 LiDAR, ±2 m)');
assert.equal(plain(M.badge(D,'TNXWY21K').text),'Maximum · widest crown spread of 440 pōhutukawa named in Council records with a checked 2024 crown (2024 LiDAR, ±1 m)');
assert.equal(plain(M.badge(D,'TW9QK0A0').text),'Maximum · tallest (±2 m), widest crown spread (±1 m) and largest crown area (±23 m²) of 17 tītoki named in Council records with a checked 2024 crown in Ōrākei (2024 LiDAR)','combined: joined with "and", each with its own margin');
assert.equal(plain(M.badge(D,'TTESTSO1').text),'Maximum · tallest of 12 kōwhai (Sophora microphylla) named in Council records with a checked 2024 crown in the surveyed part of Test Partial (2024 LiDAR, ±2 m)','shared common name and partly surveyed area');
assert.ok(M.badge(D,'TTESTSO1').html.includes('<span lang="mi">kōwhai</span> <i>Sophora microphylla</i>'),'the Latin name in italics; the te reo name marked lang="mi"');
assert.equal(M.pluralName('cedar of Lebanon'),'cedars of Lebanon');
assert.equal(M.pluralName('Norfolk Island pine'),'Norfolk Island pines');
{
  const h=M.badgeHtml(D,'TSG2SSKH',{id:'maxBadge'}),p=M.badgeHtml(D,'TW9QK0A0',{panel:true});
  assert.ok(/^<p class="ti-max" id="maxBadge"><a class="max-chip" href="\.\/maxima\.html#scope" title="Maximum · [^"]*Scope: 83 trees ranked; trees without a named species are not ranked; larger trees may stand elsewhere; not field-verified\. ±2 m: ranking margin[^"]*">Maximum · /.test(h),'tree page: a text chip under the name, linked to the list page\'s scope note');
  assert.ok(p.includes('class="ti-max tp-max"')&&p.includes(`title="${M.badge(D,'TW9QK0A0').text}. Scope: `),'panel: the full line in the tooltip');
  assert.ok(!/<svg|<img|class="ico/.test(h+p),'text only: no icon');
  assert.equal(M.badgeHtml(D,'T055W90F'),'','no chip for a near-tie');
}
const css=read('tree-instrument.css');
assert.ok(/\.ti-scope \.max-chip \{[^}]*border: 1px solid var\(--color-text\)[^}]*background: transparent/.test(css),'1 px ink outline chip, no fill colour');

// ---- Recognition: facts, credited and linked
const L=fixture('notable-facts-fixture.json').links;
const rec=t=>M.recognition(D,t,{base:'.'});
{
  const R=rec('TSG2SSKH'),keys=R.rows.map(r=>r.key);
  assert.deepEqual(keys,['council_schedule','maximum','why']);
  const c=R.rows[0];
  assert.equal(plain(c.html),'Listed in Auckland Council’s Notable Trees schedule (Auckland Unitary Plan Schedule 10), item 297: “Norfolk Island Pine”.');
  // Council's field (its overlay point's position) and ALTO's crown link are two facts, said apart (SKP-15).
  assert.deepEqual(c.lines,['Council’s overlay point: verified position (Council field). Crown link: ALTO’s (recorded position inside the crown).']);
  assert.deepEqual(c.links,[{text:'Council entry',href:L.council_entry_by_gid.replace('{gid}','60d9f6ad-c8ef-49a8-b8ad-1888b99d8221')},{text:'Schedule 10 (PDF)',href:L.schedule_10_pdf}],'Council entry by GlobalID and the Schedule 10 PDF');
  assert.ok(plain(c.credit).includes('Notable Trees Overlay, Plans and Places, Auckland Council; CC BY 4.0; as at 4 Jun 2026; checked 13 Oct 2026'),c.credit);
  const m=R.rows[1];
  assert.equal(plain(m.html),'Tallest of 83 Norfolk Island pines named in Council records with a checked 2024 crown, in Auckland and in Albert-Eden');
  assert.deepEqual(m.lines.map(plain),['46.5 m (2024 LiDAR) · ±2 m ranking margin (method and crown-edge differences); survey vertical accuracy ±0.2 m · next 42.7 m']);
  assert.deepEqual(m.links,[{text:'Species maxima',href:'./maxima.html',internal:true}]);
  assert.ok(plain(m.credit).startsWith('ALTO, from the Auckland 2024 LiDAR survey (licensed by Regional Software Holdings Limited and Auckland Council; Sourced from LINZ. CC BY 4.0)'),m.credit);
  assert.equal(plain(R.rows[2].html),'ALTO highlights this tree because Council’s Notable Trees schedule lists it. It also holds a species maximum in ALTO’s measurements from the 2024 LiDAR survey.');
  assert.ok(R.rows[2].html.includes(`href="${L.schedule_10_pdf}"`),'why: the source linked');
}
{
  const R=rec('T47VMHR8'),nz=R.rows.find(r=>r.key==='nz_tree_register');
  assert.deepEqual(R.rows.map(r=>r.key),['council_schedule','nz_tree_register','why']);
  assert.equal(plain(nz.html),'On the New Zealand Tree Register as AR/0367 ↗. ALTO links this tree to that entry; the register holds its measurements, history and photographs.');
  assert.ok(nz.html.includes('href="https://www.treeregister.nz/tree/view/367"'),'the register entry linked');
  assert.ok(plain(nz.credit).startsWith('New Zealand Tree Register, New Zealand Notable Trees Trust'),'register credited');
  assert.deepEqual(nz.lines,['Link reviewed 6 Oct 2026']);
  assert.equal(plain(R.rows[2].html),'ALTO highlights this tree because Council’s Notable Trees schedule and the New Zealand Tree Register list it.');
  assert.ok(R.rows[2].html.includes('href="https://www.treeregister.nz/"'));
}
{
  const R=rec('T055W90F');
  assert.deepEqual(R.rows.map(r=>r.key),['council_schedule','why'],'a near-tie gets no maximum row (list page only)');
  assert.equal(plain(R.rows[1].html),'ALTO highlights this tree because Council’s Notable Trees schedule lists it.');
}
{
  const R=rec('TW9QK0A0');
  assert.deepEqual(R.rows.map(r=>r.key),['maximum','maximum','maximum','why'],'a maximum with no external entry');
  assert.deepEqual(R.rows.map(r=>!!r.credit),[false,false,true,false],'one credit under rows of one kind');
  assert.equal(plain(R.rows[3].html),'ALTO highlights this tree because it holds a species maximum in ALTO’s measurements from the 2024 LiDAR survey.');
  assert.equal(R.rows[0].links[0].href,'./maxima.html?area='+encodeURIComponent('Ōrākei'),'the list opens at the area');
  assert.equal(R.rows[1].links[0].href,'./maxima.html?measure=spread&area='+encodeURIComponent('Ōrākei'));
}
{
  const R=rec('TXHC62Y9');
  assert.equal(plain(R.rows[0].html),'Site of AR/0591 ↗ on the New Zealand Tree Register; the registered tree is no longer standing.','the former site sentence');
  assert.equal(plain(R.rows[1].html),'ALTO shows this tree because the New Zealand Tree Register records a former registered tree at its site.');
}
{
  const R=rec('TX1KVWKM'),all=JSON.stringify(R);
  assert.ok(!R.rows.some(r=>r.key==='council_schedule'),'a held Council entry (held_schedule) is never shown');
  assert.ok(!/item 15\b/.test(all)&&!/SCHEDULE%3D%2715%27/.test(all),'its schedule number is not linked either');
  assert.equal(plain(R.rows[R.rows.length-1].html),'ALTO highlights this tree because the New Zealand Tree Register lists it.');
}
{
  const R=rec('TTESTUV1'),c=R.rows.find(r=>r.key==='council_schedule'),g=R.rows.find(r=>r.key==='council_group');
  assert.deepEqual(c.lines,['Council’s overlay point: position not verified (Council field). Crown link: ALTO’s (recorded position inside the crown).']);
  assert.equal(c.links[0].href,L.council_entry_by_schedule.replace('{schedule}','9999'),'no GlobalID: the entry by schedule number');
  assert.equal(plain(g.html),'Stands inside a group listed in Auckland Council’s Notable Trees schedule, item 2924: “Native Bush”.');
  assert.deepEqual(g.links.map(l=>l.text),['Council group entry','Schedule 10 (PDF)']);
  assert.equal(g.links[0].href,L.council_group_by_schedule.replace('{schedule}','2924'));
  assert.ok(plain(g.credit).startsWith('Notable Group of Trees Overlay, Plans and Places, Auckland Council'));
}
assert.equal(rec('TNOFACTS'),null,'no entry and no maximum: no block');
{
  // Every Recognition link: Council's layer, the Schedule 10 PDF, the register, ALTO's own pages; never a DocumentURL.
  const html=['TSG2SSKH','T47VMHR8','T055W90F','TW9QK0A0','TXHC62Y9','TX1KVWKM','T00JGB4T','T8PZBYKH','TTESTUV1'].map(t=>M.recognitionHtml(D,t)).join('');
  const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));
  assert.ok(hrefs.length>20);
  for(const h of hrefs)assert.ok(/^https:\/\/services1\.arcgis\.com\/n4yPwebTjJCmXB6W\/arcgis\/rest\/services\/Notable_(Group_of_)?Trees_Overlay\/FeatureServer\/0\/query\?/.test(h)||h===L.schedule_10_pdf||
    /^https:\/\/www\.treeregister\.nz\/(tree\/view\/\d+)?$/.test(h)||/^\.\/maxima\.html/.test(h)||/^https:\/\/www\.linz\.govt\.nz\//.test(h),`unexpected link ${h}`);
  assert.ok(!/UnitaryPlanId|DocumentURL|details\.aspx/i.test(html),'no Council DocumentURL');
  assert.ok(html.includes('<h2 id="h-recognition">Recognition</h2>')&&!/ti-mod-n/.test(html),'an unnumbered section: the numbered sections keep their numbers');
  assert.ok(!/champion/i.test(html)&&!/\bAI\b/.test(html),'no "champion", no "AI"');
  assert.ok(!/<img|photograph[^s]/.test(html.replace(/photographs\./g,'')),'no register photographs');
}

// ---- list page rows: filters and sorting
{
  const rows=M.listRows(D,{measure:'max_height',area:'Auckland'});
  assert.deepEqual(rows.map(r=>r.tree),['TSG2SSKH','TF0TD1X1','T2GJBWHP','T055W90F'],'largest first');
  assert.deepEqual(rows.map(r=>r.within),[false,false,false,true],'the near-tie is marked');
  assert.equal(rows[3].next,21.9);
  assert.deepEqual(M.listRows(D,{measure:'max_height',area:'Auckland',sort:'species'}).map(r=>r.name),['English oak','London plane','Norfolk Island pine','Pōhutukawa'],'species A–Z, in their display form (UX-09)');
  assert.deepEqual(M.listRows(D,{measure:'max_height',area:'Auckland',sort:'value',dir:'asc'}).map(r=>r.tree)[0],'T055W90F','smallest first');
  assert.deepEqual(M.listRows(D,{measure:'max_height',area:'Auckland',sort:'n'}).map(r=>r.n),[440,177,93,83],'most measured first');
  assert.deepEqual(M.listRows(D,{measure:'max_height',area:'Auckland',q:'pohutukawa'}).map(r=>r.tree),['T055W90F'],'accents ignored');
  assert.deepEqual(M.listRows(D,{measure:'max_height',area:'Auckland',q:'Platanus'}).map(r=>r.tree),['TF0TD1X1'],'Latin names match');
  assert.deepEqual(M.listRows(D,{measure:'max_height',area:'Auckland',q:'birch'}),[],'no match');
  assert.deepEqual(M.listRows(D,{measure:'max_height',area:'Waitematā'}).map(r=>r.tree),['TF0TD1X1','T2GJBWHP'],'a local board');
  assert.deepEqual(M.listRows(D,{measure:'max_crown_area',area:'Waitematā'}).map(r=>[r.tree,r.within]),[['TNXWY21K',true]],'near-ties are listed');
  assert.deepEqual(M.listRows(D,{measure:'max_crown_spread',area:'Devonport-Takapuna'}),[],'an area with none');
  assert.ok(rows.every(r=>Array.isArray(r.outline)&&r.outline.length>2&&r.board),'each row has its crown outline and board');
  // SKP-15: a clear lead ranks "1 of N"; a near-tie never reads as first.
  assert.equal(M.rankText(rows[0]),'1 of 83','a clear lead');
  assert.equal(M.rankText(rows[3]),'near-tie: within ±2\u00a0m of the next measured tree (21.9\u00a0m)','a near-tie (T055W90F height)');
  assert.equal(M.rankText({...rows[3],next:null}),'near-tie: within ±2\u00a0m of the next measured tree','a near-tie without the next value');
  const area=M.listRows(D,{measure:'max_crown_area',area:'Waitematā'})[0];
  assert.ok(/^near-tie: within ±\d+\u00a0m² of the next measured tree \(\d+\u00a0m²\)$/.test(M.rankText(area)),`a crown-area near-tie: ${M.rankText(area)}`);
  // The scope note above the list: who is ranked (the file's first sentence), then what the ranking cannot say.
  assert.equal(M.scopeNote({copy:{scope_note:"Ranks trees whose species is named in Auckland Council's tree register. Trees without a named species are not ranked."}}),
    'Ranks trees whose species is named in Auckland Council’s tree register. Trees without a named species are not ranked; larger trees may stand elsewhere; not field-verified.');
  assert.equal(M.scopeNote({}),'Ranks trees named in Council records with a checked 2024 crown. Trees without a named species are not ranked; larger trees may stand elsewhere; not field-verified.');
  assert.deepEqual(M.areaList(D),['Auckland','Albert-Eden','Devonport-Takapuna','Maungakiekie-Tāmaki','Ōrākei','Test Partial','Waitematā'],'Auckland, then boards A–Z (Ō as O)');
  const svg=M.outlineSvg([[0,10],[10,0],[0,-10],[-10,0]],{size:40,span:40,label:'Crown outline of T1, 2024'});
  assert.equal(svg,'<svg class="mx-crown" viewBox="0 0 40 40" width="40" height="40" role="img" aria-label="Crown outline of T1, 2024"><polygon points="20.0,10.0 30.0,20.0 20.0,30.0 10.0,20.0"/></svg>','the tree\'s own outline, north up, at the page scale');
  assert.equal(M.latin('Platanus x acerifolia'),'Platanus × acerifolia','a hybrid with the multiplication sign');
  assert.equal(M.latin('Quercus robur'),'Quercus robur');
  assert.equal(M.sharedSpan(D),30,'one scale for the page: the widest crown, rounded up to 10 m');
  assert.equal(M.listHref('.',{measure:'max_crown_area',area:'Albert-Eden',species:'Quercus robur'}),'./maxima.html?measure=area&area=Albert-Eden&species=Quercus+robur');
}
// ---- the map: clear leads ringed, with their bounds
{
  const s=M.mapSet(D,'Auckland');
  assert.deepEqual(s.trees,['T2GJBWHP','TF0TD1X1','TNXWY21K','TSG2SSKH'],'near-tie-only trees are not ringed');
  assert.ok(s.bounds[0][0]<s.bounds[1][0]&&s.bounds[0][1]<s.bounds[1][1]);
  assert.deepEqual(M.mapSet(D,'Ōrākei').trees,['TW9QK0A0']);
  assert.deepEqual(M.mapSet(D,'Devonport-Takapuna'),{area:'Devonport-Takapuna',trees:[],bounds:null});
}
// ---- KYTE girth: behind ALTO_KYTE_CONFIG.girthTask, off by default
{
  global.ALTO_KYTE_CONFIG={girthTask:false};
  assert.equal(M.girthHref(D,'TW9QK0A0',{kyteBase:'./kyte'}),null,'off by default');
  assert.equal(M.girthHref(D,'TW9QK0A0',{kyteBase:'./kyte',config:{girthTask:true}}),'./kyte/?tree=TW9QK0A0&task=girth');
  assert.equal(M.girthHref(D,'TW9QK0A0',{kyteBase:'../kyte/',config:{girthTask:true}}),'../kyte/?tree=TW9QK0A0&task=girth','beta: the live site\'s KYTE');
  assert.equal(M.girthHref(D,'T055W90F',{config:{girthTask:true}}),'./kyte/?tree=T055W90F&task=girth','every tree marked kyte_girth, a near-tie too');
  assert.equal(M.girthHref(D,'TSG2SSKH',{config:{girthTask:true}}),null,'not where kyte_girth is false (private land)');
  const notEligible=Object.keys(D.trees).find(t=>M.has(D,t)&&D.trees[t].kyte_girth===false);
  assert.ok(notEligible);
  assert.equal(M.girthHref(D,notEligible,{config:{girthTask:true}}),null,'only trees marked kyte_girth');
  const cfg=read('kyte-config.js');
  assert.ok(/window\.ALTO_KYTE_CONFIG = \{ girthTask: true, problemTask: false \};/.test(cfg),'kyte-config.js ships with the girth flag on (KYTE v19 reads task=girth, live 13 Oct 2026)');
  // "Report a problem with this record" stays off until KYTE reads task=problem (FTA-12). About's Corrections line
  // names the email now, and the KYTE route too once the flag is on.
  {const map=(read('index.html')+read('map-app.js')),i=map.indexOf('<h3>Corrections</h3>'),j=map.indexOf('<h3>Sources and credits</h3>');
    assert.ok(i>0&&j>i,'About: a Corrections heading before Sources and credits');
    const line=map.slice(i,j);
    // UX-21: the link names what it does ("Email the Better Places Lab"), the address beside it.
    assert.ok(line.includes('<p id="aboutCorrections"><a class="about-link" href="mailto:t.welch@auckland.ac.nz">Email the Better Places Lab</a> (t.welch@auckland.ac.nz) to correct a record, with the tree number and what is wrong.</p>'),'About: the corrections email');
    assert.ok(/if \(window\.ALTO_KYTE_CONFIG\?\.problemTask === true\) document\.getElementById\("aboutCorrections"\)\.innerHTML =\s*'To correct a record, use “Report a problem with this record” on its tree page or map panel \(KYTE\), or <a class="about-link" href="mailto:t\.welch@auckland\.ac\.nz">email the Better Places Lab<\/a> \(t\.welch@auckland\.ac\.nz\)/.test(map),'About: the KYTE route joins the email behind problemTask');}
}
// ---- loading: the release's derived folder (manifest products), nothing when the release has none
(async()=>{
  const files={'./derived/metro-x-v6.2/manifest.json':{release:'metro-x-v6.2',products:{species_maxima:'species_maxima/maxima.json',notable_facts:'species_maxima/notable_facts.json'},checks:{species_maxima:{text:'Checked'}}},
    './derived/metro-x-v6.2/species_maxima/maxima.json':fixture('species-maxima-fixture.json'),'./derived/metro-x-v6.2/species_maxima/notable_facts.json':fixture('notable-facts-fixture.json')};
  const asked=[];
  global.fetch=async url=>{asked.push(url);const k=url.replace(/\?v=.*$/,'');return k in files?{ok:true,json:async()=>files[k]}:{ok:false,status:404,json:async()=>null};};
  const env={siteRoot:'.',metadata:{release:{dataset_version:'metro-x-v6.2'}},version:'t1'};
  const L1=await M.load(env);
  assert.ok(L1&&L1.maxima.length&&!L1.facts,'the map reads maxima.json only');
  assert.ok(!asked.some(u=>/notable_facts/.test(u)),'and never notable_facts.json');
  const L2=await M.load(env,{facts:true});
  assert.ok(L2.facts&&L2.facts.trees.TSG2SSKH&&L2.check.text==='Checked','the tree page reads both, and the check note');
  assert.equal(await M.load({siteRoot:'.',metadata:{release:{dataset_version:'metro-x-v6.1'}},version:'t1'}),null,'a release without the products: nothing');
  assert.equal(M.derivedBase({siteRoot:'..',derivedBase:'./derived/{release}',metadata:{release:{dataset_version:'metro-x-v6.2'}}}),'./derived/metro-x-v6.2','a build\'s own derived folder');
  // FE-02: found, absent or unavailable. A 404 is absent (null); a network error, a server error or a file that cannot
  // be read rejects with {unavailable, file, reason}; a failure is not kept, so Retry reads the file again.
  {
    const ok=global.fetch;let mode='abort';
    global.fetch=async(url,init)=>{if(/maxima\.json/.test(url)){if(mode==='abort')throw new TypeError('Failed to fetch');if(mode==='500')return {ok:false,status:500,json:async()=>null};if(mode==='bad')return {ok:true,status:200,json:async()=>{throw new SyntaxError('bad json');}};}return ok(url,init);};
    const env2={siteRoot:'.',metadata:{release:{dataset_version:'metro-x-v6.2'}},version:'t2'};
    for(const [m,reason] of [['abort','network error'],['500','HTTP 500'],['bad','could not be read']]){
      mode=m;
      await assert.rejects(M.load(env2),e=>e.unavailable===true&&e.reason===reason&&e.file==='derived/metro-x-v6.2/species_maxima/maxima.json'&&e.message===`Not loaded: derived/metro-x-v6.2/species_maxima/maxima.json (${reason}).`,`maxima.json ${m}: unavailable, said with the file and reason`);
    }
    mode='ok';
    const again=await M.load(env2);
    assert.ok(again&&again.maxima.length,'Retry reads again: a failed read is not cached');
    // The tree page reads facts too: facts that loaded are kept when the maxima did not, and the failure is noted.
    mode='abort';
    const part=await M.load({...env2,version:'t3'},{facts:true});
    assert.ok(part&&part.facts&&!part.maxima.length&&part.unavailable?.unavailable,'facts kept, maxima failure noted');
    // An unreadable manifest with nothing listed in the metadata is unavailable, never "not published".
    global.fetch=async url=>{if(/manifest\.json/.test(url))return {ok:false,status:503,json:async()=>null};return ok(url);};
    await assert.rejects(M.load({...env2,version:'t4'}),e=>e.unavailable&&e.reason==='HTTP 503','manifest 503: unavailable');
    global.fetch=ok;
    assert.equal(await M.fetchJSON('./derived/none/manifest.json'),null,'fetchJSON: 404 is absent');
    const page=read('maxima-page.js');
    assert.ok(page.includes("try{metadata=await M.fetchJSON(`${SITE_ROOT}/release-metadata.json`);}")&&page.includes("catch(e){$('#mxRelease').textContent='Not loaded';return notLoaded(e);}"),'maxima page: metadata that did not load says so');
    // UX-07: the header reads the map chip's and the tree page's label ("Release 6.2 · 13 Oct 2026 · Tool 0.2.12"); no
    // hard-coded tool row.
    assert.ok(page.includes("if(Ver&&metadata){const v=Ver.publicLabel(metadata);$('#mxRelease').textContent=v.text;}")&&!/<dt>Tool<\/dt>/.test(read('maxima.html')),'maxima page: the full release label');
    assert.ok(page.includes("catch(e){D=null;return notLoaded(e.unavailable?e:M.unavailable('maxima.json','could not be read'));}")&&page.includes('<button type="button" class="btn mx-retry">Retry</button>'),'maxima page: Not loaded with Retry');
    assert.equal((page.match(/Species maxima are not published/g)||[]).length,1,'"not published" only for a release without maxima');
  }

  // ---- pages: scripts, controls and links
  const tree=read('tree.html'),map=(read('index.html')+read('map-app.js')),list=read('maxima.html'),credits=read('credits.html'),page=read('tree-page.js'),panel=read('tree-panel.js');
  const at=(html,f)=>html.indexOf(`./${f}?`);
  // The tree page loads the KYTE config with the page and the module after the hero (FE-03: tree-page.js later()), then
  // the maxima and the facts; the page is ready once they have arrived or failed.
  assert.ok(at(tree,'kyte-config.js')>0&&at(tree,'kyte-config.js')<at(tree,'tree-page.js')&&at(tree,'species-maxima.js')<0,'tree.html loads the config before the page, not the module');
  assert.ok(/\['\.\/property\.js','\.\/tree-ground\.js','\.\/tree-imagery\.js','\.\/tree-imagery-viewer\.js','\.\/species-maxima\.js'\]/.test(page)&&page.includes("later().then(()=>window.ALTOMaxima?window.ALTOMaxima.load(env,{facts:true,trees:[rec.number].filter(Boolean)})"),'tree-page.js loads the module after the hero, then the maxima');
  assert.ok(at(map,'species-maxima.js')>0&&at(map,'species-maxima.js')<at(map,'tree-panel.js'),'index.html loads the module before the panel');
  assert.ok(page.includes("`<div id=\"recogSlot\">${recognitionMod()}</div>`,\n      metricsMod(),"),'Recognition sits above the key measurements');
  {const h1=page.indexOf('<h1>${t.html||esc(t.text)}</h1>'),la=page.indexOf('<p class="ti-latin">${t.latinHtml}</p>'),mb=page.indexOf('${maxBadge()}${t.note?');
    assert.ok(h1>0&&la>h1&&mb>la&&mb-h1<400,'the badge under the name (and its Latin name and "Recorded as" line)');}
  assert.ok(panel.includes('h+=maxBadge(rec);'),'the panel shows the badge');
  assert.ok(map.includes('id="onlyMaxima"')&&map.includes('id="maximaArea"')&&map.includes('label: "ring = species maximum"'),'map filter, area and legend wording');
  assert.ok(/"circle-stroke-color": tok\("--color-selection"\), "circle-stroke-width": 2/.test(map)&&/"circle-stroke-color": tok\("--color-selection-halo"\)/.test(map),'a 2 px ink ring with a white halo, from the tokens');
  assert.ok(map.includes('<a class="about-link" href="./maxima.html">Species maxima</a>'),'About links the list');
  assert.ok(credits.includes('<a href="./maxima.html">Species maxima</a>'),'Sources and credits links the list');
  assert.ok(/<script src="\.\/site-config\.js\?v=[^"]+"><\/script>/.test(list)&&list.indexOf('site-config.js')<list.indexOf('./species-maxima.js?'),'maxima.html: the site settings (site-config.js, written by the build) before its modules');
  assert.ok(list.includes('./species-maxima.js?')&&list.includes('./maxima-page.js?')&&list.includes('methods.css'),'maxima.html: on the methods template');
  const build=fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8');
  assert.ok(/PAGES = \('index\.html', 'tree\.html', 'maxima\.html'\)/.test(build),'every build stamps maxima.html');
  const pageJs=read('maxima-page.js');
  // SKP-15: the scope note sits above the table at #scope (every Maximum line links there); near-tie rows print their
  // rank text, never "1 of N".
  {const sc=list.indexOf('<p class="mx-scope" id="scope">Trees without a named species are not ranked; larger trees may stand elsewhere; not field-verified.</p>'),tb=list.indexOf('<table class="data-table mx-table" id="mxTable"');
    assert.ok(sc>0&&tb>sc,'maxima.html: the scope note above the table');}
  // A11Y-07: below 600 px "Sort by" sits above the cards and the clipped header's buttons leave the tab order; sort
  // controls are 44 px tall on a touch screen; sources link by name and long links and code wrap.
  assert.ok(list.includes('<label class="mx-field mx-sort-m" for="mxSort"><span>Sort by</span><select id="mxSort" disabled>'),'maxima.html: Sort by');
  // FE-09: the controls (disabled until the data arrives) and the list's room are there from the first paint; the
  // coverage note's fixed part is in the page; ready() enables the controls, settled() releases the room.
  assert.ok(list.includes('<div class="mx-controls" id="mxControls" data-loading>')&&!/id="mxControls"[^>]*hidden/.test(list),'controls at first paint');
  assert.equal((list.match(/<button type="button" data-measure="max_[a-z_]+" aria-pressed="(?:true|false)" disabled>/g)||[]).length,3,'measure tabs disabled until the data arrives');
  assert.ok(list.includes('<input id="mxSpecies" type="search" list="mxSpeciesList" placeholder="Common or Latin name" autocomplete="off" spellcheck="false" disabled>')&&list.includes('<select id="mxArea" disabled>'),'fields disabled until the data arrives');
  assert.ok(list.includes('data-loading="list"')&&list.includes('<p class="mx-coverage" id="mxCoverage"><b>Coverage.</b> Only trees whose species comes from a record are included'),'the list room and the coverage note at first paint');
  assert.ok(pageJs.includes("for(const el of c.querySelectorAll('button, input, select'))el.disabled=false;")&&pageJs.includes('ready();\n    render();settled();'),'ready() enables, settled() releases');
  assert.ok(pageJs.includes("function notLoaded(e){\n    $('#mxControls').hidden=true;settled();"),'not loaded: the controls go and the room is released');
  {const css=read('maxima.css');assert.ok(css.includes('.mx-wrap[data-loading="list"] { min-height: max(70vh, 480px); }')&&css.includes('.mx-wrap[data-loading="few"] { min-height: 160px; }'),'room for the list');}
  assert.ok(list.indexOf('id="mxSort"')<list.indexOf('<table class="data-table mx-table"'),'Sort by sits above the cards');
  assert.ok(pageJs.includes("window.matchMedia?.('(max-width: 599px)')")&&pageJs.includes("for(const b of document.querySelectorAll('#mxTable thead button[data-sort]')){if(narrow)b.tabIndex=-1;else b.removeAttribute('tabindex');}"),'header buttons out of the tab order below 600 px');
  assert.ok(pageJs.includes("'Auckland Council open data'")&&pageJs.includes('${esc(linkText(s.url))}')&&!pageJs.includes(".replace(/^https?:\\/\\//,'')"),'sources link by name');
  {const css=read('maxima.css');
    assert.ok(/@media \(pointer: coarse\) \{\s*\.mx-tabs button, \.mx-field input, \.mx-field select \{ min-height: var\(--target-touch\); \}\s*\.mx-table thead button \{ display: inline-flex; align-items: center; min-height: var\(--target-touch\); \}/.test(css),'44 px sort controls on coarse pointers');
    assert.ok(css.includes('#sources a, .mx-scope a, .table-note a, .mx-coverage a, .doc-body code { overflow-wrap: anywhere; }'),'links and code wrap');
    assert.ok(/thead \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect\(0 0 0 0\)/.test(css),'the clipped header stays for screen readers');}
  assert.ok(build.includes('code{font-size:13px;overflow-wrap:anywhere}a{color:#4a6f46;overflow-wrap:anywhere}'),'changelog: code and links wrap');
  assert.ok(pageJs.includes("$('#scope').textContent=M.scopeNote(D);")&&pageJs.includes('esc(M.rankText(r))')&&!pageJs.includes('>1 of ${'),'maxima-page.js: scope note and rank text');
  assert.ok(pageJs.includes('/v5-methods.html#crown-outline')&&pageJs.includes('local ${boards.length===1?\'board qualifies\':\'boards qualify\'} so far'),'methods link and coverage note');
  // TS-10: "How these are measured" states the 400 m² merge limit, and crown-area rows of 360 m² or more carry the
  // near-limit note under the value (TZ69KK1G 395 m² in the fixture).
  assert.equal(M.MERGE_CAP_TEXT,'Crowns are not merged beyond 400 m²; a larger tree can be split into several crowns.');
  assert.ok(pageJs.includes("${fixed('max_crown_area')} ${M.MERGE_CAP_TEXT} Crown areas of ${nf(M.NEAR_CAP_M2,0)}"),'maxima-page.js: the merge limit under Crown area');
  assert.ok(pageJs.includes('${r.nearCap?`<small class="mx-cap">${esc(M.current?.copy?.segmentation_cap||M.NEAR_CAP_TEXT)}</small>`:\'\'}'),'maxima-page.js: near-limit rows say so, in the release’s words when it gives them');
  {const area=M.listRows(D,{measure:'max_crown_area',area:M.AUCKLAND});
    assert.deepEqual(area.filter(r=>r.nearCap).map(r=>r.tree),['TZ69KK1G'],'crown areas of 360 m² or more are flagged');
    assert.ok(M.listRows(D,{measure:'max_height',area:M.AUCKLAND}).every(r=>!r.nearCap),'heights are never flagged');}
  assert.ok(/\.mx-cap \{[^}]*display: block/.test(read('maxima.css')),'maxima.css: the near-limit note on its own line');
  for(const f of ['species-maxima.js','maxima-page.js','maxima.html','kyte-config.js']){
    const t=read(f);
    assert.ok(!/champion/i.test(t),`${f}: never "champion"`);
    assert.ok(!/\bAI\b/.test(t),`${f}: never "AI"`);
    if(f.endsWith('.js'))assert.equal(t.match(/['"`]#[0-9a-f]{6}['"`;]/gi),null,`${f}: no colour literals`);
  }

  // ---- the full files on the T7 drive, when present: 108 clear leads on 49 trees, 3,488 trees with facts
  const T7='/data/alto/working/maxima_v1_20261013/';
  if(fs.existsSync(T7+'maxima.json')){
    const F=M.prepare(JSON.parse(fs.readFileSync(T7+'maxima.json','utf8')),JSON.parse(fs.readFileSync(T7+'notable_facts.json','utf8')));
    assert.equal(F.maxima.length,232);
    assert.equal(F.maxima.filter(m=>m.within_margin===false).length,108,'108 clear leads');
    const badged=[...F.byTree.keys()].filter(t=>M.badge(F,t));
    assert.equal(badged.length,49,'on 49 trees');
    assert.equal(new Set(badged.flatMap(t=>M.badge(F,t).maxima.map(m=>m.within_margin))).has(true),false,'no badge names a near-tie');
    assert.ok(Object.keys(F.facts.trees).every(t=>{const r=M.recognition(F,t);return !r||!/UnitaryPlanId/.test(JSON.stringify(r));}));
    console.log('species maxima: full files checked (232 maxima, 108 clear leads on 49 trees)');
  }
  // UX-06: the filter is its own Filters group (after Status, before Sources); with it on, the headline counts the rings
  // ("N species maxima in <area> (rings)"), counts that do not apply are hidden, the group links the list for the area;
  // the area list names every area with maxima, near-tie-only ones as such; on a phone the fit clears the sheet.
  {
    const map=(read('index.html')+read('map-app.js')),st=map.indexOf('data-group="status"'),mx=map.indexOf('data-group="maxima"'),src=map.indexOf('<div class="lp-group" data-group="sources">');
    assert.ok(st>0&&mx>st&&src>mx,'its own group, after Status and before Sources');
    const sources=map.slice(src,map.indexOf('<div class="lp-group" data-group="quality">'));
    assert.ok(!sources.includes('onlyMaxima')&&!map.includes('ALTO measurements'),'no longer under Sources');
    assert.ok(map.includes('<button type="button" class="lp-group-toggle" data-group-toggle="maxima" aria-expanded="false" aria-controls="groupMaxima"><span class="lp-group-name">Species maxima</span> <span class="lp-group-value" id="maximaSelection">Off</span></button>'),'the group row states its value');
    assert.ok(map.includes('add("filter", `Species maxima: ${state.maximaArea}`, () => A.setCheck("onlyMaxima", false), "filters", "maxima");'),'the chip opens the group');
    assert.ok(map.includes('const shownCount = rings ? rings.trees.length : grouped.markers, one = shownCount === 1;')&&map.includes('rings ? `species ${one ? "maximum" : "maxima"} in ${state.maximaArea} (${one ? "ring" : "rings"})`')&&map.includes('value("viewportCount", formatNumber.format(shownCount));'),'headline: N species maxima in <area> (rings), one in the singular');
    assert.ok(map.includes('el.hidden = ringsOnly;')&&map.includes('count: mode === "change" || (state.onlyMaxima && maxima) ? null'),'source counts and legend counts hidden with the filter on');
    // The area options, built as the map builds them.
    const from=map.indexOf('      select.innerHTML = ALTOMaxima.areaList(D)'),to=map.indexOf('.join("");',from)+10;
    const build=new Function('ALTOMaxima','D','escapeHtml','const select={};'+map.slice(from,to)+'return select.innerHTML;');
    const DD={...D,maxima:[...D.maxima,{measure:'height',area:'Maungakiekie-Tāmaki',species:'Quercus robur',tree:'TTEST001',value:20,margin:2,within_margin:true}],areas:{...D.areas,'Maungakiekie-Tāmaki':{coverage:1}}};
    const opts=plain(build(M,DD,s=>String(s)).replace(/<\/option>/g,'\n')).trim().split('\n');
    assert.ok(opts[0].startsWith('Auckland (')&&opts.includes('Maungakiekie-Tāmaki (near-ties only; no ring)'),`area options: ${opts.join(' | ')}`);
    // The list link for the area, and the near-tie sentence.
    const lf=map.indexOf('    function renderMaximaList() {'),lt=map.indexOf('    function zoomToMaxima() {');
    const R=new Function('state','maxima','ALTOMaxima','SITE_ROOT','escapeHtml','document',map.slice(lf,lt)+'return renderMaximaList;');
    const el={hidden:true,innerHTML:'',textContent:''},doc={getElementById:()=>el},esc=x=>String(x).replace(/&/g,'&amp;');
    R({onlyMaxima:true,maximaArea:'Albert-Eden'},DD,M,'.',esc,doc)();
    assert.ok(!el.hidden&&el.innerHTML.includes('<a href="./maxima.html?area=Albert-Eden">Species maxima in Albert-Eden</a>')&&/trees? (is|are) ringed/.test(el.innerHTML),`list link: ${el.innerHTML}`);
    R({onlyMaxima:true,maximaArea:'Maungakiekie-Tāmaki'},DD,M,'.',esc,doc)();
    assert.ok(el.innerHTML.startsWith('Near-ties only in Maungakiekie-Tāmaki: no tree leads its species by more than the margin, so none is ringed.'),'near-ties only, said');
    R({onlyMaxima:false,maximaArea:'Auckland'},DD,M,'.',esc,doc)();assert.ok(el.hidden,'nothing listed with the filter off');
    assert.ok(map.includes('const sheet = sheetLayout.matches ? Math.min(explorer.offsetHeight, sheetStop(panelSheet === "full" ? "half" : panelSheet)) : 0;')&&map.includes('bottom: Math.max(200, sheet + 24)'),'phone fit pads by the sheet');
  }
  // TS-18, TS-19: one wording for height, crown spread and crown diameter on the tree page, the legend, Species maxima
  // and the methods; ±2 m captioned as the ranking margin beside the survey's ±0.2 m.
  {
    const D_=M.DEFINITIONS,rec=read('tree-record.js'),pal=read('palette.js'),mp=read('maxima-page.js'),ov=read('how-alto-is-made.html'),map=(read('index.html')+read('map-app.js'));
    assert.ok(rec.includes(`const HEIGHT_DEF='${D_.height}';`),'tree page: the same height definition');
    assert.ok(pal.includes(`note:'${D_.height}.'`)&&!/Highest LiDAR return/i.test(pal+map),'map legend and search: the same height definition');
    assert.ok(rec.includes(`text:'${D_.crownSpread}'`)&&rec.includes(`text:'${D_.crownDiameter};`),'tree page: the same crown spread and crown diameter definitions');
    assert.ok(mp.includes("['Height',`${D_.height}.")&&mp.includes("['Crown spread',`${D_.crownSpread}, 2024 LiDAR.")&&mp.includes("['Crown diameter (equal-area circle)',`${D_.crownDiameter}"),'Species maxima: each measure defined once, in those words');
    assert.ok(mp.includes('is the ${M.HEIGHT_MARGIN_NOTE}.')&&M.HEIGHT_MARGIN_NOTE==='ranking margin (method and crown-edge differences); survey vertical accuracy ±0.2 m','Species maxima: ±2 m captioned');
    const t2=/<table class="data-table">\s*<caption id="table-2-caption">[\s\S]*?<\/table>/.exec(ov)?.[0]||'',plain=t2.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
    for(const d of [D_.height,D_.crownSpread,D_.crownDiameter])assert.ok(plain.includes(d),`methods (How ALTO is made, Table 2): ${d.slice(0,40)}…`);
    assert.ok(plain.includes('Crown diameter (equal-area circle)')&&plain.includes('Crown spread')&&plain.includes('±2 m ranking margin')&&plain.includes('±0.2 m'),'methods: both crown widths and the height margins');
    assert.ok(rec.includes('/how-alto-is-made.html#crown-measures')&&ov.includes('<p id="crown-measures">'),'tree page: the crown widths link the methods definition');
  }
  console.log('species maxima: badges (clear leads, combined line), kauri held, Recognition links and credits, list filters and sorting, map rings, KYTE girth flag and page wiring checked');
})().catch(e=>{console.error(e);process.exit(1);});
