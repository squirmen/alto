// Offline checks for the methods pages (web/v*-methods.html on web/methods.css): every release page is on the
// template, links the others, and keeps to the glossary; release 6's page has its sections, figures in the
// design system's colours and neutral wording about who labelled the growth-form crowns; release 6.1's page covers
// tree numbers, their format and check character, older IDs, the corrections applied and limits. The public build
// ships the restyled pages (pipeline/tool/build_web_beta.py --public).
// Usage: node pipeline/tool/test_methods_pages.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const PAGES={'v5-methods.html':'5','v51-methods.html':'5.1','v52-methods.html':'5.2','v6-methods.html':'6','v61-methods.html':'6.1'};
const read=f=>fs.readFileSync(web+f,'utf8');
for(const [f,rel] of Object.entries(PAGES)){
  const html=read(f);
  assert.ok(html.includes('href="./methods.css?v=')&&html.includes('href="./tokens.css?v='),`${f}: on the methods template`);
  assert.match(html,new RegExp(`<dt>Release</dt><dd>${rel.replace('.','\\.')}</dd>`),`${f}: release ${rel}`);
  for(const other of Object.keys(PAGES))assert.ok(html.includes(`href="./${other}"`),`${f}: links ${other}`);
  assert.ok(!/laser survey/i.test(html),`${f}: says "LiDAR survey", not "laser survey"`);
  assert.ok(!/\bby (hand|eye)\b|hand-labelled|human-labelled/i.test(html),`${f}: no claim that people made the labels`);
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
// The public build ships every restyled methods page, releases 6 and 6.1 included.
const build=fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8');
assert.ok(/skip = \{'release-metadata.json', 'htaccess.example'\} if a\.public else SKIP/.test(build),'public build: methods pages included');
assert.ok(/METHODS_PAGES = \([^)]*'v61-methods\.html'\)/.test(build),'public build: release 6.1 page stamped');
console.log('methods pages: template, links, glossary, release 6 sections, audit rules, labelling wording, figure colours and release 6.1 checked');
