// FE-15: no page runs inline script, so the site's Content-Security-Policy allows scripts from this site's files and the two
// pinned library paths on unpkg only. The site settings are a file (site-config.js) that the tool build writes and stamps
// with a hash of its content; the map's script is map-app.js; the tree page's early fetches are tree-prefetch.js.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');
const INLINE_SCRIPT=/<script\b(?![^>]*\bsrc=)[^>]*>/i,HANDLER=/<[a-z][^>]*\son[a-z]+\s*=/i;
const UNPKG_SCRIPTS=['https://unpkg.com/maplibre-gl@4.7.1/','https://unpkg.com/pmtiles@3.0.7/'];

// 1. The policy (web/htaccess.example, the template for the live .htaccess).
const csp=/Header always set Content-Security-Policy "([^"]+)"/.exec(read('htaccess.example'))[1];
const dir=Object.fromEntries(csp.split(';').map(s=>s.trim().split(/\s+/)).filter(a=>a[0]).map(([k,...v])=>[k,v]));
assert.deepEqual(dir['script-src'],["'self'",...UNPKG_SCRIPTS],'script-src: this site and the two pinned unpkg paths');
assert.ok(!dir['script-src'].some(v=>/unsafe-(inline|eval)/.test(v)),'script-src: no unsafe-inline or unsafe-eval');
assert.ok(!dir['connect-src'].some(v=>/unpkg/.test(v)),'connect-src: unpkg is never fetched from script');
assert.deepEqual(dir['style-src'].filter(v=>/unpkg/.test(v)),['https://unpkg.com/maplibre-gl@4.7.1/'],'style-src: the MapLibre stylesheet path only');
assert.ok(dir['connect-src'].includes('https://nz-imagery.s3.ap-southeast-2.amazonaws.com')&&dir['worker-src'].includes('blob:'),'imagery archive and the map\'s blob workers stay allowed');
const allowedScript=src=>!/^[a-z]+:/i.test(src)||src.startsWith('/')||UNPKG_SCRIPTS.some(p=>src.startsWith(p));

// 2. Every page: scripts from files only, no inline handlers or javascript: URLs, external scripts within the policy.
const pages=fs.readdirSync(web).filter(f=>f.endsWith('.html'));
assert.ok(pages.length>=12,'pages found');
for(const f of pages){
  const html=read(f);
  assert.ok(!INLINE_SCRIPT.test(html),`${f}: no inline script`);
  assert.ok(!HANDLER.test(html),`${f}: no inline event handler`);
  assert.ok(!/href="javascript:/i.test(html),`${f}: no javascript: link`);
  for(const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g))assert.ok(allowedScript(m[1]),`${f}: ${m[1]} is allowed by script-src`);
  for(const m of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g))assert.ok(!/^https?:/.test(m[1])||m[1].startsWith('https://unpkg.com/maplibre-gl@4.7.1/'),`${f}: ${m[1]} is allowed by style-src`);
}
// Modules never build inline handlers, evaluate strings or add inline script.
for(const f of fs.readdirSync(web).filter(f=>/\.(m?js)$/.test(f))){
  const js=read(f);
  assert.ok(!/["'`\s]on(click|error|load|change|input|submit|keydown|keyup|mouse\w+|pointer\w+|focus|blur)\s*=\s*["'\\]/.test(js),`${f}: no inline handler in markup`);
  assert.ok(!/\beval\(|new Function\(|set(Timeout|Interval)\(\s*["'`]/.test(js),`${f}: no string evaluation`);
  assert.ok(!/createElement\(\s*["']script["']\)[\s\S]{0,200}\.(text|textContent|innerHTML)\s*=/.test(js),`${f}: no inline script element`);
}

// 3. Load order: the settings first; the map's own script last, after the libraries and the tile cache.
{const map=read('index.html'),at=s=>map.indexOf(s);
  const firstScript=map.search(/<script\b/);
  assert.equal(firstScript,at('<script src="./site-config.js?v='),'map: the site settings are its first script');
  assert.ok(at('<script src="./map-libs.js?v=tool-0.2.9" data-fallback>')<at('<script src="./tile-cache.js?v=')&&at('<script src="./tile-cache.js?v=')<at('<script src="./map-app.js?v='),'map: libraries, tile cache, then map-app.js');
  assert.ok(at('<script src="./map-app.js?v=')<at('<dialog id="treeComparison"'),'map: map-app.js runs where the inline script ran, before the comparison dialog and About');
  const app=read('map-app.js');
  assert.ok(/^\/\*[\s\S]*?\*\/\n    \/\/ The libraries \(map-libs\.js/.test(app)&&app.includes('throw new Error("Map library could not be loaded");'),'map-app.js: starts with the libraries check');
  assert.ok(!/<\/script>/i.test(app),'map-app.js: no script tags left in the file');
}
for(const f of ['tree.html','maxima.html']){
  const html=read(f);
  assert.equal(html.search(/<script\b/),html.indexOf('<script src="./site-config.js?v='),`${f}: the site settings are its first script`);
}
{const sb={window:{}};vm.runInNewContext(read('site-config.js'),sb);
  assert.equal(sb.window.AKL_DATA_BASE,'./data');assert.ok(sb.window.AKL_TILE_VERSION,'site-config.js: the data base and a tile stamp');}

// 4. The build writes site-config.js for its site and stamps its URL with a hash of its content.
const py=['python3','python'].find(c=>{try{execFileSync(c,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
if(!py)console.log('csp: python not found; the build check is skipped');
else for(const [label,args,root,channel] of [['public',['--public','--channel','release','--site-root','.'],'.','release'],['beta',['--channel','beta'],'..','beta']]){
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'alto-csp-'))+'/b';
  try{
    execFileSync(py,[path.join(__dirname,'build_web_beta.py'),'--out',out,'--version','0.0.0-test',...args],{stdio:'pipe'});
    const cfg=fs.readFileSync(out+'/site-config.js','utf8'),h=crypto.createHash('sha256').update(cfg).digest('hex').slice(0,10);
    const sb={window:{}};vm.runInNewContext(cfg,sb);
    assert.equal(sb.window.AKL_DATA_BASE,`${root}/data`,`${label}: data base`);
    assert.equal(sb.window.AKL_TILE_VERSION,'auto',`${label}: the tile stamp is read at run time`);
    assert.equal(sb.window.ALTO_SITE_ROOT,root,`${label}: site root`);
    assert.equal(sb.window.ALTO_CHANNEL,channel,`${label}: channel`);
    for(const f of ['index.html','tree.html','maxima.html']){
      const html=fs.readFileSync(path.join(out,f),'utf8');
      assert.ok(html.includes(`<script src="./site-config.js?v=tool-0.0.0-test.${h}"></script>`),`${label} ${f}: site-config.js stamped with its content hash`);
    }
    for(const f of fs.readdirSync(out).filter(f=>f.endsWith('.html'))){
      const html=fs.readFileSync(path.join(out,f),'utf8');
      assert.ok(!INLINE_SCRIPT.test(html)&&!HANDLER.test(html),`${label} ${f}: no inline script in the build`);
    }
    assert.ok(fs.readFileSync(path.join(out,'index.html'),'utf8').includes('<script src="./map-app.js?v=tool-0.0.0-test"></script>'),`${label}: map-app.js carries the build stamp`);
  }finally{fs.rmSync(path.dirname(out),{recursive:true,force:true});}
}
console.log('csp: scripts from files only on every page, the pinned unpkg paths, settings in site-config.js with a content-hash stamp');
