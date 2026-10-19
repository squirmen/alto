// Offline checks for the map libraries (FE-08, web/map-libs.js): MapLibre GL JS 4.7.1 and PMTiles 3.0.7 come from
// unpkg.com with their SRI hashes, or from this site's vendor copies (web/vendor/, byte-identical: the same hashes) when
// unpkg cannot be reached, on the map and on the tree page; when neither arrives the page says "Map library could not be
// loaded" within 10 s. The tree page loads them on demand (ALTOLibs.load), never from its own unpkg tags.
// Usage: node pipeline/tool/test_map_libs.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');

// A small stand-in for the browser: scripts and stylesheets "load" or "fail" by URL.
function browser({fail=()=>false,hang=()=>false}={}){
  const appended=[];
  const el=tag=>({tag,dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},remove(){}});
  const doc={
    currentScript:{getAttribute:()=>'./map-libs.js?v=test',hasAttribute:()=>false},
    createElement:el,
    querySelector:sel=>{const m=/data-alto-lib="([^"]+)"/.exec(sel);return m?appended.find(x=>x.dataset.altoLib===m[1])||null:null;},
    head:{append(node){appended.push(node);const url=node.src||node.href;
      setTimeout(()=>{if(hang(url))return;if(fail(url)){node.onerror?.();return;}
        if(node.tag==='script'){if(/maplibre-gl\.js$/.test(url))win.maplibregl={};if(/pmtiles\.js$/.test(url))win.pmtiles={};}
        node.onload?.();},1);}},
    body:{append(){}},
    getElementById:()=>null,
  };
  const win={};
  global.window=win;global.document=doc;global.getComputedStyle=()=>({overflow:'hidden'});
  delete require.cache[require.resolve(web+'map-libs.js')];
  require(web+'map-libs.js');
  return {win,appended};
}

(async()=>{
  // 1. The vendor copies are the files unpkg serves: their SHA-384 is the SRI hash the pages ask unpkg for.
  {const {win}=browser();const L=win.ALTOLibs.LIBS;
    for(const k of ['maplibre','pmtiles','css']){
      const h='sha384-'+crypto.createHash('sha384').update(fs.readFileSync(web+L[k].local)).digest('base64');
      assert.equal(h,L[k].sri,`${k}: the vendor copy has the SRI hash of the unpkg file`);
    }
    for(const f of ['vendor/maplibre-gl@4.7.1/LICENSE.txt','vendor/maplibre-gl@4.7.1/NOTICE.txt','vendor/pmtiles@3.0.7/NOTICE.txt'])assert.ok(fs.existsSync(web+f),f);
  }
  // 2. The map: the watch before the unpkg tags, the vendor fallback after them; the tags carry the same hashes.
  {const html=(read('index.html')+read('map-app.js')),{win}=browser(),L=win.ALTOLibs.LIBS;
    const w=html.indexOf('<script src="./map-libs.js?v=tool-0.2.9" data-watch></script>'),f=html.indexOf('<script src="./map-libs.js?v=tool-0.2.9" data-fallback></script>');
    const m=html.indexOf(`src="${L.maplibre.cdn}"`),p=html.indexOf(`src="${L.pmtiles.cdn}"`);
    assert.ok(w>0&&w<m&&m<p&&p<f,'map: watch, unpkg tags, fallback, in that order');
    assert.ok(html.includes(`integrity="${L.maplibre.sri}"`)&&html.includes(`integrity="${L.pmtiles.sri}"`),'map: the unpkg tags carry the SRI hashes');
    assert.ok(html.includes('throw new Error("Map library could not be loaded");')&&html.includes('st.textContent = window.ALTOLibs?.MESSAGE'),'map: says so when neither copy arrives');
  }
  // 3. The tree page: no unpkg tags of its own; map-libs.js (with tile-cache.js and map-sources.js) arrives when the inset
  // nears the screen (FE-03), before the libraries; the inset says "Map library could not be loaded" when either fails.
  {const html=read('tree.html'),page=read('tree-page.js');
    assert.ok(!/<script[^>]+unpkg\.com|<link[^>]+unpkg\.com/.test(html),'tree page: no unpkg tags');
    assert.ok(!html.includes('<script src="./map-libs.js'),'tree page: map-libs.js is not loaded with the page');
    assert.ok(page.includes("const mapFiles=()=>Promise.all(['./map-libs.js','./tile-cache.js','./map-sources.js'].map(f=>script(asset(f))));"),'tree page: the inset map files, in order');
    assert.ok(/try\{await mapFiles\(\);if\(!window\.maplibregl\|\|!window\.pmtiles\)await window\.ALTOLibs\.load\(\);\}\n\s+catch\{if\(el\)el\.innerHTML=`<p class="ti-def" role="status">\$\{esc\(window\.ALTOLibs\?\.MESSAGE/.test(page),'tree page: the inset map waits for its files and the libraries, and says when they fail');
  }
  // 4. load(): unpkg first; the vendor copy when unpkg fails; rejected with the message when neither arrives, or after the
  // timeout when nothing answers. The stylesheet falls back as soon as unpkg's fails.
  {const {win,appended}=browser({fail:u=>/unpkg\.com/.test(u)});
    await win.ALTOLibs.load({timeout:500});
    assert.ok(win.maplibregl&&win.pmtiles,'unpkg blocked: the vendor copies load');
    const srcs=appended.map(n=>n.src||n.href);
    assert.ok(srcs.some(u=>u==='./vendor/maplibre-gl@4.7.1/maplibre-gl.js')&&srcs.some(u=>u==='./vendor/pmtiles@3.0.7/pmtiles.js'),'unpkg blocked: vendor scripts requested');
    assert.ok(srcs.includes('./vendor/maplibre-gl@4.7.1/maplibre-gl.css'),'unpkg blocked: the vendor stylesheet, at once');
    const cdn=appended.find(n=>n.src===win.ALTOLibs.LIBS.maplibre.cdn);
    assert.ok(cdn&&cdn.integrity===win.ALTOLibs.LIBS.maplibre.sri&&cdn.crossOrigin==='anonymous','unpkg is asked with SRI');
  }
  {const {win}=browser({fail:()=>true});
    await assert.rejects(win.ALTOLibs.load({timeout:500}),e=>e.message===win.ALTOLibs.MESSAGE&&/Map library could not be loaded/.test(e.message),'both blocked: the message');
  }
  {const {win}=browser({hang:()=>true});const t=Date.now();
    await assert.rejects(win.ALTOLibs.load({timeout:120}),e=>e.message===win.ALTOLibs.MESSAGE,'nothing answers: the message after the timeout');
    assert.ok(Date.now()-t<1000,'rejected at the timeout');
  }
  {const {win}=browser();
    assert.equal(win.ALTOLibs.MESSAGE,'Map library could not be loaded. Check the connection, then reload the page.');
    const src=read('map-libs.js');assert.ok(/function load\(\{timeout=10000\}=\{\}\)/.test(src)&&/function watch\(ms=10000/.test(src),'10 s on both pages');
  }
  console.log('map libraries: vendor copies with the unpkg hashes, the map\'s watch and fallback, the tree page on demand, and load() checked');
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
