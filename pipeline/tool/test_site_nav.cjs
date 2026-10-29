// Offline checks for the ALTO pages menu (UX-01, web/site-nav.css): every page carries the same text menu, Map ·
// Species maxima · Methods · Sources and credits · KYTE (no icons; the current page marked with aria-current), the
// methods index lists every release newest first with the current one marked (methods-index.js reads the release
// metadata), Species maxima links "Girth is not measured" to KYTE's girth missions, About says what KYTE is, and the
// build gives the changelog the menu and points a beta build's Methods and KYTE links at the site root.
// Usage: node pipeline/tool/test_site_nav.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');
const MENU='<nav class="site-nav" aria-label="ALTO pages"><ul><li><a href="./">Map</a></li><li><a href="./maxima.html">Species maxima</a></li>'+
  '<li><a href="./methods.html">Methods</a></li><li><a href="./credits.html">Sources and credits</a></li><li><a href="./kyte/">KYTE</a></li></ul></nav>';
const navs=html=>[...html.matchAll(/<nav class="site-nav[^"]*"[\s\S]*?<\/nav>/g)].map(m=>m[0]);
const plain=n=>n.replace(/ aria-current="(page|true)"/g,'').replace(/ data-site-link="kyte\/"/g,'').replace(/class="site-nav [^"]+"/,'class="site-nav"');
const current=n=>{const m=/<a href="[^"]*" aria-current="(page|true)"[^>]*>([^<]+)<\/a>/.exec(n);return m?`${m[2]}:${m[1]}`:null;};
const PAGES={'index.html':'Map:page','tree.html':null,'maxima.html':'Species maxima:page','credits.html':'Sources and credits:page','methods.html':'Methods:page',
  'v5-methods.html':'Methods:true','v51-methods.html':'Methods:true','v52-methods.html':'Methods:true','v6-methods.html':'Methods:true','v61-methods.html':'Methods:true','v62-methods.html':'Methods:true','how-alto-is-made.html':'Methods:true'};
for(const [f,cur] of Object.entries(PAGES)){
  const html=read(f),ns=navs(html);
  assert.equal(ns.length,f==='index.html'?2:1,`${f}: the menu (the map: one under the panel heading, one in the phone sheet's foot)`);
  for(const n of ns){
    assert.equal(plain(n),MENU,`${f}: the same menu, in the same order`);
    assert.equal(current(n),cur,`${f}: current page`);
    assert.ok(!/<svg|<img|class="ico/.test(n),`${f}: text only`);
  }
  assert.ok(html.includes('<link rel="stylesheet" href="./site-nav.css?v='),`${f}: loads site-nav.css`);
  assert.ok(!/class="app-bar-actions"[^>]*>\s*<a class="btn" href="\.\/">/.test(html),`${f}: no second Map button in the app bar`);
}
// FE-04 (wordmark): every page shows ALTO's wordmark from one small file, a 3x raster of 10 KB or less with the build
// stamp; the 434 KB alto-logo.png is no longer on any page; the About lockup is a 2x raster, read only when About opens.
{
  const W='./brand/alto-wordmark.png?v=tool-0.2.9',png=fs.readFileSync(web+'brand/alto-wordmark.png');
  assert.ok(png.length<=10240&&png.readUInt32BE(16)===282&&png.readUInt32BE(20)===84,`wordmark: ${png.length} bytes, 282 x 84 (3 x 28 px)`);
  for(const f of Object.keys(PAGES).concat('how-alto-is-made.html')){
    const html=read(f);
    assert.ok(!html.includes('alto-logo.png'),`${f}: no alto-logo.png`);
    assert.ok([...html.matchAll(/<img src="([^"]*wordmark[^"]*)"[^>]*>/g)].every(m=>m[1]===W)&&html.includes(`<img src="${W}"`),`${f}: the wordmark at one URL with the stamp`);
  }
  const map=(read('index.html')+read('map-app.js'));
  assert.ok(map.includes('<img src="./brand/alto-bpl-lockup-440.png?v=tool-0.2.9" alt="ALTO, from the Better Places Lab" width="440" height="169" loading="lazy" decoding="async">'),'About lockup: 2x and lazy');
  const lock=fs.readFileSync(web+'brand/alto-bpl-lockup-440.png');assert.ok(lock.length<30000&&lock.readUInt32BE(16)===440,'About lockup: 440 px wide');
  assert.ok(/LOCAL_ASSET = re\.compile\(r'[^\n]*\(\?:js\|mjs\|css\|png\|svg\)\)/.test(fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8')),'build: stamped images carry the build stamp');
}
// The menu sits right after the page's top bar (methods template and tree page); on the map under the panel heading.
for(const f of ['maxima.html','credits.html','methods.html','v62-methods.html','how-alto-is-made.html'])assert.ok(/<\/header>\n<nav class="site-nav"/.test(read(f)),`${f}: under the app bar`);
assert.ok(/<\/header>\n  <nav class="site-nav"/.test(read('tree.html')),'tree.html: under the sticky bar');
{const map=read('index.html');assert.ok(/<\/header>\n      <nav class="site-nav lp-site-nav"/.test(map)&&/id="versionChip"[^\n]*\n        <nav class="site-nav sheet-site-nav"/.test(map),'map: panel heading and sheet foot');
  assert.ok((map.match(/<a href="\.\/kyte\/" data-site-link="kyte\/">KYTE<\/a>/g)||[]).length===2,'map: KYTE follows the site root (beta)');}
// Every link leads to a page that exists (KYTE lives outside web/).
for(const href of [...MENU.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(h=>h!=='./kyte/'))assert.ok(fs.existsSync(web+(href==='./'?'index.html':href.slice(2))),href);
// CSS: not sticky; separators hidden from screen readers; the current page bold as well as coloured; lined up per page.
{const css=read('site-nav.css');
  assert.ok(!/position:\s*sticky|position:\s*fixed/.test(css),'the menu never adds to the sticky bars');
  assert.ok(css.includes('content: "·" / "";')&&/a\[aria-current\] \{[^}]*font-weight: 600/.test(css),'separators silent; current page in bold');
  assert.ok(/@media \(max-width: 599px\) \{ \.site-nav ul \{ column-gap: var\(--space-4\); \} \.site-nav li \+ li::before \{ content: none; \} \}/.test(css),'narrow screens: spaced, no dot at a line start');
  assert.ok(/\.doc, \.app-bar-inner, \.site-nav, \.site-footer-inner \{/.test(read('methods.css'))&&/\.doc, \.app-bar-inner, \.site-nav, \.site-footer-inner \{ --page-col/.test(read('maxima.css')),'methods template: on the app bar\'s columns');
  assert.ok(/\.ti-page nav\.site-nav > ul \{ padding: var\(--space-1\) max\(var\(--space-6\), calc\(\(100vw - 1152px\) \/ 2\)\); \}/.test(read('tree-instrument-page.css')),'tree page: on the bar\'s edges');
  assert.ok(/#explorer\.lp \.sheet-site-nav \{ display: block; \}/.test(read('map.css')),'map: the sheet copy on phones');}

// ---- the methods index: every release, newest first, the current one marked
{
  const html=read('methods.html');
  const rel=[...html.matchAll(/<li class="mi-release[^"]*" data-release="([^"]+)" id="release-[^"]+">\s*<h3><a href="\.\/([^"]+)"/g)].map(m=>[m[1],m[2]]);
  assert.deepEqual(rel,[['6.3','v63-methods.html'],['6.2','v62-methods.html'],['6.1','v61-methods.html'],['6','v6-methods.html'],['5.2','v52-methods.html'],['5.1','v51-methods.html'],['5','v5-methods.html']],'newest first');
  for(const [,f] of rel)assert.ok(fs.existsSync(web+f),f);
  assert.ok(/<li class="mi-release is-current" data-release="6\.2"[^>]*>\s*<h3><a href="\.\/v62-methods\.html" aria-current="true">/.test(html)&&html.includes('<span class="mi-current"> · Current release</span>'),'release 6.2 marked current, in words');
  // Release 6.3 is listed before it goes live (tool 0.2.12 ships ahead of the data); methods-index.js marks it current
  // once the site's release metadata says 6.3.
  assert.equal((html.match(/<span class="mi-current" hidden>/g)||[]).length,6,'the others not marked');
  assert.ok(html.includes('<script src="./methods-index.js?v=')&&!/<script>(?!window\.)/.test(html),'no inline script');
  // methods-index.js moves the mark to the release the site serves.
  const items=rel.map(([r])=>{const a={attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}},mark={hidden:r!=='6.2'},cls=new Set(r==='6.2'?['is-current']:[]);
    return {dataset:{release:r},classList:{toggle:(c,on)=>on?cls.add(c):cls.delete(c),has:c=>cls.has(c)},querySelector:s=>s==='h3 a'?a:mark,a,mark};});
  global.window={ALTO_SITE_ROOT:'.'};global.document={querySelectorAll:()=>items};
  global.fetch=async url=>{assert.equal(url,'./release-metadata.json');return {ok:true,json:async()=>({release:{dataset_version:'metro-2026.10.20-pointcloud-v6.1'}})};};
  require(web+'methods-index.js');
  setTimeout(()=>{
    assert.deepEqual(items.filter(i=>i.classList.has('is-current')).map(i=>i.dataset.release),['6.1'],'the mark follows the release metadata');
    const at=r=>items.find(i=>i.dataset.release===r);
    assert.equal(at('6.1').a.attrs['aria-current'],'true');assert.equal(at('6.2').a.attrs['aria-current'],undefined);
    assert.equal(at('6.1').mark.hidden,false);assert.equal(at('6.2').mark.hidden,true);assert.equal(at('6.3').mark.hidden,true);
    finish();
  },20);
}

function finish(){
  // ---- Species maxima: "Girth is not measured" links KYTE's girth missions; About says what KYTE is
  const mx=read('maxima-page.js');
  assert.ok(mx.includes('`<a href="${esc(SITE_ROOT)}/kyte/missions/#girth">Girth is not measured</a>: KYTE’s girth missions ask for a tape reading at 1.4 m above the ground (on a slope, from mid-slope).`'),'maxima: the girth line links the missions');
  const map=(read('index.html')+read('map-app.js'));
  assert.ok(map.includes('<p id="aboutKyte"><strong>KYTE</strong> (Know Your Tree Explorer) is ALTO’s field app: photograph a tree, match it to its ALTO record and add what you see; accepted visits appear on the tree’s page. <a class="about-link" href="./kyte/" data-site-link="kyte/">Open KYTE</a>.</p>'),'About: one line on KYTE, linked');

  // ---- the build: the changelog gets the menu; a beta build points Methods and KYTE at the site root
  const build=fs.readFileSync(path.join(__dirname,'build_web_beta.py'),'utf8');
  const sn=/SITE_NAV = \(('[^']*'\n\s+'[^']*')\)/.exec(build);
  assert.ok(sn,'build: SITE_NAV');
  assert.equal(sn[1].split('\n').map(x=>x.trim().slice(1,-1)).join(''),MENU,'build: the same menu as the pages');
  assert.ok(build.includes("'</head><body>' + SITE_NAV + '<p>ALTO tool '"),'changelog: the menu at the top');
  { const sl=build.slice(build.indexOf('def site_links(html, root):'),build.indexOf('CREDITS_PAGE ='));
    assert.ok(/if root in \('', '\.'\):\n\s+return html/.test(sl)&&sl.includes(`.replace('href="./methods.html', f'href="{root}/methods.html')`)&&sl.includes(`.replace('href="./kyte/"', f'href="{root}/kyte/"')`)&&
      sl.includes(`.replace('href="./how-alto-is-made.html', f'href="{root}/how-alto-is-made.html')`)&&sl.includes(`re.sub(r'href="\\./(v\\d+-methods\\.html)', lambda m: f'href="{root}/{m.group(1)}'`),'beta: Methods, the release methods pages and KYTE at the site root'); }
  assert.ok(/'v63-methods\.html',\n\s+'methods\.html', 'how-alto-is-made\.html'\)/.test(build)&&/SKIP = \{[^}]*'methods\.html', 'methods-index\.js', 'how-alto-is-made\.html'/.test(build),'methods index: stamped in a public build, read from the site root in a beta build');
  console.log('site menu: the same text menu on every page, the methods index, the girth link, About on KYTE and the build checked');
}
