// Offline checks for the methods pages (web/v*-methods.html on web/methods.css): every release page is on the
// template, links the others, and keeps to the glossary; release 6's page has its sections, figures in the
// design system's colours and neutral wording about who labelled the growth-form crowns; release 6.1's page covers
// tree numbers, their format and check character, older IDs, the corrections applied and limits; release 6.2's page
// covers the reviewer confirmations, the palm threshold and its blind check, the service estimates and limits, with
// the release 6 labelling wording. The public build ships the restyled pages (pipeline/tool/build_web_beta.py --public).
// Usage: node pipeline/tool/test_methods_pages.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const PAGES={'v5-methods.html':'5','v51-methods.html':'5.1','v52-methods.html':'5.2','v6-methods.html':'6','v61-methods.html':'6.1','v62-methods.html':'6.2','v63-methods.html':'6.3'};
const read=f=>fs.readFileSync(web+f,'utf8');
for(const [f,rel] of Object.entries(PAGES)){
  const html=read(f);
  assert.ok(html.includes('href="./methods.css?v=')&&html.includes('href="./tokens.css?v='),`${f}: on the methods template`);
  assert.match(html,new RegExp(`<dt>Release</dt><dd>${rel.replace('.','\\.')}</dd>`),`${f}: release ${rel}`);
  for(const other of Object.keys(PAGES))assert.ok(html.includes(`href="./${other}"`),`${f}: links ${other}`);
  assert.ok(!/laser survey/i.test(html),`${f}: says "LiDAR survey", not "laser survey"`);
  assert.ok(!/\bby (hand|eye)\b|hand-labelled|human-labelled/i.test(html),`${f}: no claim that people made the labels`);
  // SKP-05: i-Tree Eco never names ALTO's method, and release totals are rounded ("about NZ$295 million a year").
  assert.ok(!/using i-Tree methods|made with i-Tree|i-Tree Eco methods|ALTO’s estimates using i-Tree/i.test(html),`${f}: i-Tree Eco does not name ALTO's method`);
  assert.ok(!/[Rr]elease totals[^.]*NZ\$\d{1,3}(,\d{3}){2}|annual benefits[^<.]*: NZ\$\d{1,3}(,\d{3}){2}/.test(html),`${f}: release totals rounded`);
  // SKP-11: agreement with model-made labels is never worded as accuracy; no "AI".
  assert.ok(!/right for 0\./.test(html)&&!/\bAI\b/.test(html.replace(/<[^>]+>/g,' ')),`${f}: no "right for 0." and no "AI"`);
  // Stable anchors the tree page and tree records link to.
  for(const id of [...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]))assert.equal(html.split(` id="${id}"`).length,2,`${f}: id ${id} once`);
}
const v6=read('v6-methods.html'),v52=read('v52-methods.html');
for(const id of ['what-changed','growth-form','audit','outlines','benefits','trunk-diameter','corrections','unchanged','limits','sources'])assert.ok(v6.includes(`<section id="${id}"`),`v6: section ${id}`);
assert.ok(v6.includes('<code>metro-2026.10.12-pointcloud-v6</code>'),'v6: dataset ID');
assert.ok(/<dt>Next release<\/dt><dd><a href="\.\/v6-methods\.html">6 · 12 Oct 2026<\/a>/.test(v52),'5.2 names release 6 as its next release');
// The audit's rule changes (release_tools/v6_common.py apply_v6, 12 Oct 2026) and none of the rules they replaced.
assert.ok(/Outside the isthmus every deciduous call reads “Broadleaf”/.test(v6)&&/no “possibly” call is shown/.test(v6)&&/10,527/.test(v6)&&/94,858/.test(v6),'v6: audit rule changes');
assert.ok(!/only where the (laser|LiDAR) survey was flown in late June/.test(v6),'v6: no pre-audit late-June rule');
assert.ok(/machine-learning image-interpretation model/.test(v6)&&/no independent second labeller/.test(v6),'v6: the labelling is described as approved (13 Oct 2026)');
assert.ok(!/\bAI\b|by hand|by eye|human-labelled/.test(v6),'v6: no AI, by-hand or by-eye wording');
assert.ok(/1\.3 m above the uphill ground/.test(v6),'v6: trunk diameter at 1.3 m');
// Figures: colours from design tokens only (the growth-form legend, the diverging pair), never literals.
const figs=[...v6.matchAll(/<figure[\s\S]*?<\/figure>/g)].map(m=>m[0]);
assert.equal(figs.length,3,'v6: three figures');
for(const f of figs)assert.ok(!/#[0-9a-f]{3,8}\b/i.test(f.replace(/href="[^"]*"/g,'')),'v6 figures: no colour literals');
assert.ok(/--c: var\(--viz-form-conifer\)/.test(v6)&&/--viz-div-loss-2/.test(v6)&&/--viz-div-gain-2/.test(v6),'v6 figures: legend and diverging tokens');
// Release 6.1: tree numbers (a data sheet: tables, no figures), named as the next release by release 6.
const v61=read('v61-methods.html');
for(const id of ['what-changed','numbers','format','old-ids','corrections','unchanged','limits','sources'])assert.ok(v61.includes(`<section id="${id}"`),`v6.1: section ${id}`);
assert.ok(v61.includes('<code>metro-2026.10.13-pointcloud-v6.1</code>')&&v61.includes('<dd><a href="./v6-methods.html">6 · 12 Oct 2026</a>'),'v6.1: dataset ID and previous release');
assert.ok(/<dt>Next release<\/dt><dd><a href="\.\/v61-methods\.html">6\.1 · 13 Oct 2026<\/a>/.test(v6),'6 names release 6.1 as its next release');
assert.ok(/Luhn mod 32/.test(v61)&&/I and L read as 1, O as 0/.test(v61)&&/99\.8%/.test(v61),'v6.1: format and check character');
assert.ok(/4,200,336/.test(v61)&&/19,376,165/.test(v61)&&/<td class="num">14<\/td>/.test(v61),'v6.1: numbers, alias keys and applied corrections');
assert.ok(!/<figure/.test(v61)&&!/#[0-9a-f]{6}\b/i.test(v61.replace(/<head>[\s\S]*?<\/head>/,'')),'v6.1: tables only, no colour literals');
assert.ok(!/\b(\w+), not (a|an|the)?\s*\w+/i.test(v61.replace(/<[^>]+>/g,' ')),'v6.1: no "X, not Y" phrasing');
// Release 6.2: reviewer confirmations and the palm threshold (a data sheet: tables, no figures), named as the next
// release by release 6.1; the copy follows the release 6 labelling wording.
const v62=read('v62-methods.html');
for(const id of ['what-changed','palm-check','services','unchanged','limits','sources'])assert.ok(v62.includes(`<section id="${id}"`),`v6.2: section ${id}`);
assert.ok(v62.includes('<code>metro-2026.10.13-pointcloud-v6.2</code>')&&v62.includes('<dd><a href="./v61-methods.html">6.1 · 13 Oct 2026</a>'),'v6.2: dataset ID and previous release');
assert.ok(/<dt>Next release<\/dt><dd><a href="\.\/v62-methods\.html">6\.2 · 13 Oct 2026<\/a>/.test(v61),'6.1 names release 6.2 as its next release');
assert.ok(/confirmed 326 records/.test(v62)&&/278 crowns/.test(v62)&&/C00038, C00040, C00067, C00151, C00172/.test(v62)&&/C00307, C00239, C00320 and C00201/.test(v62),'v6.2: reviewer confirmations');
assert.ok(/from 0\.5 to 0\.2/.test(v62)&&/16,226/.test(v62)&&/118,634/.test(v62)&&/This scope is conservative/.test(v62),'v6.2: palm threshold and its scope');
assert.ok(/0\.940 \(0\.874–0\.991\)/.test(v62)&&/0\.867 \(0\.703–0\.947\)/.test(v62)&&/<td class="num">49<\/td><td class="num">49<\/td>/.test(v62)&&/<td class="num">11<\/td><td class="num">6<\/td>/.test(v62),'v6.2: palm check results');
assert.ok(/The restriction is conservative and post hoc/.test(v62),'v6.2: the scope is called conservative and post hoc');
assert.ok(/−NZ\$145,973 a year/.test(v62)&&/−14,359 m³ a year/.test(v62)&&/\+3,162 t CO₂e/.test(v62)&&/3,574,821 map markers, with 3,570 map markers linked to Schedule 10/.test(v62)&&!/of them protected/.test(v62),'v6.2: service estimates and unchanged counts');
assert.ok(/92% of the changes shown agreed with the reference labels \(88–95%; 315 changes;/.test(v62)&&/no longer draws the low-canopy polygon/.test(v62),'v6.2: change-layer description and near-canopy fix');
assert.ok(v62.includes('by a machine-learning image-interpretation model (one pass; no independent second labeller yet)'),'v6.2: labelling worded as on the release 6 page');
assert.ok(!/\bAI\b|by hand|by eye|human-labelled/.test(v62),'v6.2: no AI, by-hand or by-eye wording');
assert.ok(!/<figure/.test(v62)&&!/#[0-9a-f]{6}\b/i.test(v62.replace(/<head>[\s\S]*?<\/head>/,'')),'v6.2: tables only, no colour literals');
assert.ok(!/\b(\w+), not (a|an|the)?\s*\w+/i.test(v62.replace(/<[^>]+>/g,' ')),'v6.2: no "X, not Y" phrasing');
// Release 6.3 (tool 0.2.12): benefit value, PM2.5 and the cooling index withheld, height and record checks, height class
// and crown replacement time, group areas and Schedule 10 entries, licences, species names, deferred items; named as the
// next release by release 6.2. A data sheet: tables, no figures, the release's own numbers.
{
  const v63=read('v63-methods.html'),txt=v63.replace(/<head>[\s\S]*?<\/head>/,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  for(const id of ['what-changed','benefits','pm25','height-checks','size','group-areas','licences','species','unchanged','deferred','limits','sources'])assert.ok(v63.includes(`<section id="${id}"`),`v6.3: section ${id}`);
  assert.ok(v63.includes('<code>metro-2026.10.17-pointcloud-v6.3</code>')&&v63.includes('<dd><a href="./v62-methods.html">6.2 · 13 Oct 2026</a>'),'v6.3: dataset ID and previous release');
  assert.ok(/<dt>Next release<\/dt><dd><a href="\.\/v63-methods\.html">6\.3 · 17 Oct 2026<\/a>/.test(v62),'6.2 names release 6.3 as its next release');
  assert.ok(txt.includes('The benefit value is now stormwater plus carbon: about NZ$76.7 million a year, down from about NZ$295 million a year, which also counted air quality and cooling.'),'v6.3: the headline change, plainly');
  assert.ok(/<th scope="row">Air quality \(PM2\.5 removal\)<\/th><td class="num">163\.5<\/td><td class="num">55\.4%<\/td>/.test(v63)&&/<th scope="row">Cooling<\/th><td class="num">55\.0<\/td><td class="num">18\.6%<\/td>/.test(v63),'v6.3: what the old value held');
  assert.ok(txt.includes('−NZ$9,352 a year')&&txt.includes('−NZ$671 a year'),'v6.3: the two data changes to stormwater and carbon');
  assert.ok(txt.includes('PM2.5 removal and the cooling index are kept in the full record and not published: the PM2.5 method awaits confirmation of its sources.')&&txt.includes('The map, the tree pages and the totals show neither.'),'v6.3: PM2.5 withheld and why');
  assert.ok(!/0\.580|128\.6|\bt a year of PM2\.5|tonnes of PM2\.5/.test(txt),'v6.3: no unpublished PM2.5 figure');
  assert.ok(txt.includes('80 map markers have a height that is not plausible')&&txt.includes('2,692 have a height to check')&&txt.includes('253 records may be on a different tree')&&txt.includes('5,556 are to check'),'v6.3: height and record checks');
  assert.ok(txt.includes('rounded down to 0.1%')&&txt.includes('“veteran” is kept for veteran features recorded in the field')&&/<th scope="row">80 years or more<\/th><td class="num">284,679<\/td>/.test(v63)&&txt.includes('951,906'),'v6.3: height class and crown replacement time');
  assert.ok(txt.includes('229 group areas')&&txt.includes('3,824 map markers lie inside one')&&txt.includes('2,980 of those crowns had no link to Schedule 10')&&txt.includes('3,570 map markers are linked to Schedule 10, as in release 6.2')&&txt.includes('Auckland Council determines whether a tree is protected'),'v6.3: group areas, never a protection claim');
  assert.ok(txt.includes('item 866 lists 2 pōhutukawa')&&txt.includes('2,480 entries'),'v6.3: Schedule 10 entries');
  assert.ok(txt.includes('The 4,800 records derived from OpenStreetMap stay under the Open Database Licence 1.0')&&txt.includes('Change since 2013 is release-eligible from release 6.3'),'v6.3: licences');
  assert.ok(txt.includes('1,028 species')&&txt.includes('11 misspelled or outdated Latin names')&&txt.includes('The 1,205 kauri survey records read Kauri'),'v6.3: species names');
  const deferred=v63.slice(v63.indexOf('<section id="deferred">'),v63.indexOf('<section id="limits">'));
  for(const w of ['PM2.5 removal and the cooling index','Plantation forest','Trunk diameter calibration','400 m² merge limit','benefit class of a recorded species','multi-tree Schedule 10 entry'])assert.ok(deferred.includes(w),`v6.3 deferred: ${w}`);
  assert.ok(!/\bAI\b|by hand|by eye|human-labelled|champion/i.test(txt),'v6.3: public wording');
  assert.ok(!/<figure/.test(v63)&&!/#[0-9a-f]{6}\b/i.test(v63.replace(/<head>[\s\S]*?<\/head>/,'')),'v6.3: tables only, no colour literals');
  assert.ok(!/\b(\w+), not (a|an|the)?\s*\w+/i.test(txt),'v6.3: no "X, not Y" phrasing');
  assert.ok(/METHODS_PAGES = \([^)]*'v63-methods\.html'[^)]*\)/.test(fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8')),'public build: release 6.3 page stamped');
}
// The public build ships every restyled methods page, releases 6, 6.1 and 6.2 included; the beta build leaves them
// to the live site.
const build=fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8');
assert.ok(/skip = \{'release-metadata.json', 'htaccess.example'\} if a\.public else SKIP/.test(build),'public build: methods pages included');
assert.ok(/METHODS_PAGES = \([^)]*'v61-methods\.html'[^)]*\)/.test(build),'public build: release 6.1 page stamped');
assert.ok(/METHODS_PAGES = \([^)]*'v62-methods\.html'[^)]*\)/.test(build),'public build: release 6.2 page stamped');
assert.ok(/^SKIP = \{[^}]*'v62-methods\.html'/m.test(build),'beta build: release 6.2 page read from the live site');
// SKP-11: the release 6 audit leads with one figure, agreement with the reference labels; 0.921 is marked post hoc;
// the kept classes below their bar carry their counts; Figure 2's axis; release 6.2's palm check and change layer.
assert.ok(v6.includes('<strong>Agreement with a machine-learning image-interpretation model’s labels (one pass): 0.899 (0.828–0.956) of decided audit crowns under the audited rules; 0.78 counting undecidable crowns; growth form only; no field check.</strong>'),'v6: the audit’s lead figure');
assert.ok(v6.includes('with those changes the figure is 0.921 (0.848–0.980), computed after the rules were set.')&&v6.includes('All shown calls, released rules (computed after the rules were set)'),'v6: 0.921 marked post hoc');
assert.ok(v6.includes('Likely conifer, isthmus <small>7 of 9 decided; 3 of 12 undecidable</small>')&&v6.includes('Likely conifer, outside the isthmus <small>4 of 6 decided; 7 of 13 undecidable</small>'),'v6: n beside the kept classes below their bar');
assert.ok(v6.includes('<p class="dotplot-title" style="grid-row: 13">Share of shown calls agreeing with the reference labels</p>')&&!/judged correct|\bright\b|correctly/.test(v6.slice(v6.indexOf('<section id="audit">'),v6.indexOf('<section id="outlines">'))),'v6: Figure 2 axis and audit wording');
{
  const v62=read('v62-methods.html'),palm=v62.slice(v62.indexOf('<section id="palm-check">'),v62.indexOf('<section id="services">'));
  assert.ok(v62.includes('92% of the changes shown agreed with the reference labels (88–95%; 315 changes; labels from machine-learning image-interpretation models, no field check)')&&!/were real|real changes/.test(v62),'v6.2: change layer check worded as agreement');
  assert.ok(!/judged|\bright\b|correct/.test(palm)&&palm.includes('Share agreeing with the reference labels (95% interval)'),'v6.2: palm check worded as agreement');
}
// SKP-05: the benefit method in its own words; release totals rounded, as a sensitivity scenario.
assert.ok(v6.includes('<li id="note-4">The service model: ALTO benefit scenario: simplified equations adapted from published i-Tree Eco components (USDA Forest Service and cooperators), with stated unit values; not run in i-Tree Eco.'),'v6: the service model named as ALTO’s scenario');
assert.ok(v6.includes('Release totals, sensitivity scenario: about NZ$292 million → about NZ$295 million a year;')&&!v6.includes('NZ$295,364,743'),'v6: release totals rounded');
assert.ok(read('v62-methods.html').includes('Estimated annual benefits, sensitivity scenario: about NZ$295 million a year in both releases.')&&!read('v62-methods.html').includes('NZ$295,218,754'),'v6.2: release totals rounded');
// TS-10: release 5 methods state the 400 m² merge limit and the near-limit note, linked to Species maxima.
assert.ok(read('v5-methods.html').includes('<p id="merge-limit">Crowns are not merged beyond 400&nbsp;m²; a larger tree can be split into several crowns. Crown areas of 360&nbsp;m² or more read “at or near the 400&nbsp;m² segmentation limit; the tree may be larger”'),'v5: the 400 m² merge limit');
// FTA-15: the overview, how-alto-is-made.html, on the methods template: sources, 2024 LiDAR crowns, record linking,
// estimates and ranges, reviews and corrections, releases; composed from the methods pages and linking them, with no
// number the methods pages, the methods index or Sources and credits do not already state. About links it before any
// other methods page; every methods page header links it.
{
  const ov=read('how-alto-is-made.html'),text=h=>h.replace(/<head>[\s\S]*?<\/head>/,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
  assert.ok(ov.includes('href="./methods.css?v=')&&ov.includes('href="./tokens.css?v=')&&ov.includes('<title>How ALTO is made · ALTO</title>')&&ov.includes('<h1>How ALTO is made</h1>'),'overview: on the methods template');
  for(const id of ['sources','crowns','record-links','estimates','reviews','releases'])assert.ok(new RegExp(`<section id="${id}"`).test(ov)&&ov.includes(`<li><a href="#${id}">`),`overview: section ${id} in the contents`);
  for(const f of [...Object.keys(PAGES),'methods.html','credits.html'])assert.ok(ov.includes(`href="./${f}`),`overview: links ${f}`);
  for(const m of ov.matchAll(/href="\.\/(v\d+-methods\.html)#([^"]+)"/g))assert.ok(read(m[1]).includes(` id="${m[2]}"`),`overview: ${m[1]}#${m[2]} exists`);
  const rel=h=>[...h.matchAll(/<li class="mi-release[^"]*" data-release="([^"]+)"[^>]*>\s*<h3><a href="\.\/([^"]+)"/g)].map(m=>m[1]+' '+m[2]);
  assert.deepEqual(rel(ov),rel(read('methods.html')),'overview: the same releases as the methods index');
  const t=text(ov);
  assert.ok(!/\bAI\b|by hand|by eye|human-labelled|hand-labelled|laser survey/i.test(t),'overview: public wording');
  assert.ok(!/\b(\w+), not (a|an|the)?\s*\w+/i.test(t),'overview: no "X, not Y" phrasing');
  assert.ok(!/using i-Tree methods|made with i-Tree|i-Tree Eco methods/i.test(t)&&t.includes('ALTO benefit scenario')&&t.includes('sensitivity scenarios'),'overview: benefits named as ALTO’s scenario');
  assert.ok(t.includes('machine-learning image-interpretation model in one pass; no independent second labeller'),'overview: labelling worded as on the release 6 page');
  const known=new Set([...Object.keys(PAGES),'methods.html','credits.html'].flatMap(f=>text(read(f)).match(/(?<![\w.])\d+(?:[.,]\d+)*(?!\w)/g)||[]));
  const nums=t.match(/(?<![\w.])\d+(?:[.,]\d+)*(?!\w)/g)||[];
  assert.ok(nums.length>10,'overview: numbers found');
  for(const n of nums)assert.ok(known.has(n),`overview: no new number (${n})`);
  const docHead=h=>h.slice(h.indexOf('<header class="doc-head">'),h.indexOf('</header>',h.indexOf('<header class="doc-head">')));
  for(const f of Object.keys(PAGES))assert.ok(/<dl class="release">[\s\S]*<div><dt>Overview<\/dt><dd><a href="\.\/how-alto-is-made\.html">How ALTO is made<\/a><\/dd><\/div>[\s\S]*<\/dl>/.test(docHead(read(f))),`${f}: header links the overview`);
  const idx=read('methods.html');
  assert.ok(docHead(idx).includes('<a href="./how-alto-is-made.html">How ALTO is made</a>'),'methods index: header links the overview');
  assert.ok(!idx.includes('<a href="./credits.html" aria-current="page">')&&!ov.includes('aria-current="page"'),'methods index and overview: the footer does not mark Sources and credits as this page');
  const about=read('index.html').slice(read('index.html').indexOf('<div id="aboutBackdrop"'));
  const first=about.search(/href="\.\/(how-alto-is-made|methods|v\d+-methods)\.html"/);
  assert.ok(first>0&&about.slice(first).startsWith('href="./how-alto-is-made.html"'),'About: the overview is its first methods link');
}
// TS-24: markers, crowns and tree numbers are counted in defined terms, never as "trees": 4,200,336 tree numbers are
// 3,574,821 markers on the map and 625,515 earlier LiDAR detections kept as records; a LiDAR crown 3 m or taller can hold
// several trees, and a large tree can be split into several crowns.
{
  const plain=h=>h.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
  const docs=Object.fromEntries([...Object.keys(PAGES),'methods.html','how-alto-is-made.html'].map(f=>[f,plain(read(f))]));
  docs['CHANGELOG.md']=fs.readFileSync(path.join(web,'..','CHANGELOG.md'),'utf8').replace(/\s+/g,' ');
  for(const [f,t] of Object.entries(docs)){
    assert.ok(!/\bmap trees\b|\bevery tree on the map\b|crowns? of tree height|\bshows [\d,]+ trees\b|\b[\d,]{5,} trees\b/i.test(t),`${f}: markers, crowns and tree numbers named as such (${(t.match(/\bmap trees\b|\bevery tree on the map\b|crowns? of tree height|\bshows [\d,]+ trees\b|\b[\d,]{5,} trees\b/i)||[''])[0]})`);
    assert.ok(!/one tree on the map/i.test(t),`${f}: a crown is one marker on the map, not one tree`);
  }
  const v61=docs['v61-methods.html'];
  assert.ok(v61.includes('4,200,336 permanent tree numbers are issued, such as TMCTT6X4 : 3,574,821 for the markers on the map and 625,515 for earlier LiDAR detections kept as records'),'release 6.1: the tree numbers in defined terms');
  assert.ok(v61.includes('counts 3,523,021 LiDAR crowns 3 m or taller (3 fewer; a crown can hold several trees, and a large tree can be split into several crowns)'),'release 6.1: crowns in defined terms');
  assert.ok(docs['methods.html'].includes('Issues 4,200,336 permanent tree numbers (3,574,821 markers on the map and 625,515 earlier LiDAR detections kept as records)'),'methods index: the same terms');
  assert.ok(docs['CHANGELOG.md'].includes('4,200,336 permanent tree numbers, 3,574,821 for the markers on the map and 625,515 for earlier LiDAR detections kept as records'),'changelog: the same terms');
  assert.ok(docs['v5-methods.html'].includes('Each current crown is shown as one marker on the map; a crown can hold several trees, and a large tree can be split into several crowns.'),'release 5: a crown is a marker');
}
console.log('methods pages: template, links, glossary, release 6 sections, audit rules, labelling wording, figure colours releases 6.1 and 6.2 and the overview checked');
