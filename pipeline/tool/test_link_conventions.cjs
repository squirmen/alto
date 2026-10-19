// Offline checks for the link and label conventions (UX-21, with FTA-20 and FTA-21): ↗ only on links that open a new
// tab, ALTO's own pages (methods) in the same tab, the email link named for what it does, a text label on the phone
// About button, the tool's own pages linked inside a /beta/ build, the larger imagery view's "Frame width" group, and
// the Area subtitle naming its filters.
// Usage: node pipeline/tool/test_link_conventions.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');
const files=fs.readdirSync(web).filter(f=>/\.(html|js)$/.test(f));

// 1. ↗ marks only links that open a new tab: the anchor that holds each ↗ has target="_blank".
for(const f of files){
  const src=read(f);
  for(let i=src.indexOf('↗');i>=0;i=src.indexOf('↗',i+1)){
    const open=src.lastIndexOf('<a',i),close=src.lastIndexOf('</a>',i),tag=src.slice(open,src.indexOf('>',open)+1);
    // A link helper whose text is the arrow's own line: ext=(href,text)=>`<a ... target="_blank" ...>${text} ↗</a>`.
    assert.ok(open>close&&/target="_blank"/.test(tag),`${f}: ↗ at ${src.slice(Math.max(0,i-60),i+1).replace(/\s+/g,' ')} is on a link that opens in the same tab`);
  }
}
assert.ok(read('index.html').includes('<a class="action-button" href="./kyte/" data-site-link="kyte/">Add a photo (KYTE)</a>'),'KYTE opens in the same tab, without ↗');

// ALTO's own pages open in the same tab: no target="_blank" on a link to a methods page, credits or maxima.
for(const f of files){
  const src=read(f);
  for(const m of src.matchAll(/<a\b[^>]*href="\.\/(?:methods|v\d+-methods|how-alto-is-made|credits|maxima)\.html[^"]*"[^>]*>/g))
    assert.ok(!/target="_blank"/.test(m[0]),`${f}: ${m[0]} opens a new tab`);
}
{const I=read('tree-instrument.js');
  assert.ok(I.includes("const newTab=h=>/^https?:/i.test(String(h||''))?' target=\"_blank\" rel=\"noopener\"':'';")&&(I.match(/class="ti-mlink" href="\$\{esc\([a-z]\??\.method\??\.href\)\}"\$\{newTab\(/g)||[]).length===2,'tree panel and tree page: a methods page in the same tab, another site in a new one');
  globalThis.window=globalThis;
  for(const f of ['palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js'])require(web+f);
  const R=require(web+'tree-record.js'),Ins=require(web+'tree-instrument.js'),P=require(web+'tree-panel.js');
  const FX=require('./fixtures/tree-records-v6dev.json');
  const META={release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev',dataset_last_updated_utc:'2026-10-11T00:00:00+00:00',status:'research_only_not_independently_validated'},assembly:{tile_version:'20261011-v6-dev'}};
  let n=0;
  for(const id of Object.keys(FX.trees)){
    const rec=R.assemble({id,record:FX.trees[id].record,schema:FX.schema,members:FX.trees[id].members,memberCount:FX.trees[id].memberCount,metadata:META,env:{siteRoot:'.',dataBase:'./data',metadata:META}});
    const html=P.render(rec,{treeUrl:'tree.html?id=X'})+Object.keys(rec.measures||{}).map(k=>Ins.provenance?.(rec,k)||'').join('');
    for(const m of html.matchAll(/<a class="ti-mlink" href="([^"]+)"([^>]*)>/g)){n++;assert.equal(/target="_blank"/.test(m[2]),/^https?:/i.test(m[1]),`${id}: Method link ${m[1]}`);}
  }
  assert.ok(n>0,'method links checked');}

// 2. The email link says what it does; the phone About button has a text label; a /beta/ build links its own pages.
for(const f of ['index.html','map-app.js','credits.html','how-alto-is-made.html']){
  const src=read(f),links=[...src.matchAll(/<a\b[^>]*href="mailto:[^"]+"[^>]*>([^<]*)<\/a>/g)];
  assert.ok(links.length,`${f}: an email link`);
  for(const m of links)assert.match(m[1],/^[Ee]mail the Better Places Lab$/,`${f}: the email link reads "Email the Better Places Lab"`);
}
assert.ok(/<button id="aboutDockBtn" class="about-dock"[^>]*>[\s\S]*?<\/svg><span>About<\/span><\/button>/.test(read('index.html')),'phone About button: a text label');
assert.ok(/\.about-dock \{ min-height: 40px; width: auto;/.test(read('map.css'))&&read('observatory.css').includes('.dock-heading { display:grid; grid-template-columns:minmax(0,1fr) auto auto;'),'phone About button: room for its label');
for(const f of ['map-app.js','tree-page.js','tree-panel.js','tree-instrument.js','species-maxima.js'])
  assert.ok(!/(?:SITE_ROOT|siteRoot|KYTE_BASE)\}\/(?:maxima|tree|credits|index)\.html/.test(read(f)),`${f}: the tool's own pages are linked relative to the page, so a /beta/ build stays under /beta/`);

// 3. The larger imagery view's frame buttons: a "Frame width" group, Crown · 2× wider · 4× · 8×, each with its width said.
{const V=read('tree-imagery-viewer.js');
  assert.ok(V.includes('<div class="ixv-seg" role="group" aria-label="Frame width">${FRAMES.map(k=>`<button type="button" class="ti-yb" data-frame="${k}" aria-pressed="false" aria-label="${k===1?\'Frame the crown\':`Frame ${k} times the crown width`}">${k===1?\'Crown\':k===2?\'2× wider\':`${k}×`}</button>`).join(\'\')}</div>'),'frame width buttons');}

// 4. The Area subtitle names its filters or says "no filters"; never a bare "filters applied".
assert.ok(![read('area.js'),read('map-app.js'),read('index.html')].some(s=>/filters applied/.test(s)),'no hard-coded "filters applied"');
console.log('link conventions checked (↗ and new tabs, methods in the same tab, the email link, the phone About label, /beta/ links, frame width, Area subtitle)');
