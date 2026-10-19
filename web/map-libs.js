/* MapLibre GL JS 4.7.1 and PMTiles 3.0.7: from unpkg.com with their SRI hashes, or from this site's vendor copies when
 * unpkg cannot be reached (web/vendor/: byte-identical files with the same hashes, and their licences).
 *
 *  The map (index.html) loads the libraries with ordinary script tags; this file goes once before them (it starts a
 *  10 s watch that says "Map library could not be loaded" if neither copy arrives) and once after them, where
 *  ALTOLibs.fallback() writes the vendor copies into the page in place of any that did not load, before the map's own
 *  script runs.
 *  The tree page loads them only when its inset map is needed: ALTOLibs.load() -> Promise (unpkg first, the vendor copy
 *  next, rejected after `timeout` ms). */
(function(root){
  'use strict';
  const LIBS={
    maplibre:{global:'maplibregl',cdn:'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',local:'vendor/maplibre-gl@4.7.1/maplibre-gl.js',sri:'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj'},
    pmtiles:{global:'pmtiles',cdn:'https://unpkg.com/pmtiles@3.0.7/dist/pmtiles.js',local:'vendor/pmtiles@3.0.7/pmtiles.js',sri:'sha384-MjejsnWXHmuz93aE35YWLh5AbS/6ceRB3Vb+ukOwqFzJRTpQ8vvbkLbNV7I0QK4f'},
    css:{cdn:'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',local:'vendor/maplibre-gl@4.7.1/maplibre-gl.css',sri:'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V'}
  };
  const MESSAGE='Map library could not be loaded. Check the connection, then reload the page.';
  const base=()=>{const s=document.currentScript?.getAttribute('src')||'';return s.includes('/')?s.replace(/[^/]*$/,''):'./';};
  const BASE=typeof document!=='undefined'?base():'./';
  const ready=()=>!!(root.maplibregl&&root.pmtiles);
  // The map: one watch, started by the first copy of this file.
  function watch(ms=10000,{status='status'}={}){
    if(root.ALTOLibs?.watching)return;
    setTimeout(()=>{if(ready())return;const el=document.getElementById(status);if(el){el.textContent=MESSAGE;el.dataset.error='libraries';}root.ALTOLibs.failed=true;},ms);
  }
  // A stylesheet that did not load leaves .maplibregl-map without its overflow rule: then add the vendor copy.
  function cssLoaded(){
    const d=document.createElement('div');d.className='maplibregl-map';d.style.cssText='position:absolute;visibility:hidden;width:1px;height:1px';
    document.body.append(d);const ok=getComputedStyle(d).overflow==='hidden';d.remove();return ok;
  }
  function addCss(href,sri,onError){
    if(document.querySelector(`link[data-alto-lib="${href}"]`))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href=href;l.dataset.altoLib=href;if(sri&&/^https:/.test(href)){l.integrity=sri;l.crossOrigin='anonymous';}
    if(onError)l.onerror=onError;document.head.append(l);
  }
  // The map's second copy of this file: vendor scripts in place of any library that did not arrive (document.write keeps
  // them in order, before the page's own script).
  function fallback(){
    for(const k of ['maplibre','pmtiles']){const L=LIBS[k];if(!root[L.global])document.write(`<script src="${BASE}${L.local}"><\/script>`);}
    if(document.body&&!cssLoaded())addCss(BASE+LIBS.css.local);
  }
  // The tree page: load on demand, unpkg first, the vendor copy next; reject after `timeout` ms.
  function script(src,sri){
    return new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;if(sri&&/^https:/.test(src)){s.integrity=sri;s.crossOrigin='anonymous';}
      s.onload=ok;s.onerror=()=>{s.remove();fail(new Error(src));};document.head.append(s);});
  }
  async function one(L){
    if(root[L.global])return;
    try{await script(L.cdn,L.sri);}catch{}
    if(!root[L.global])await script(BASE+L.local,L.sri).catch(()=>{});
    if(!root[L.global])throw new Error(MESSAGE);
  }
  let loading=null;
  function load({timeout=10000}={}){
    if(ready())return Promise.resolve();
    if(!loading){
      // The stylesheet: unpkg first; the vendor copy as soon as unpkg fails, or after 4 s without it.
      addCss(LIBS.css.cdn,LIBS.css.sri,()=>addCss(BASE+LIBS.css.local));
      setTimeout(()=>{if(!cssLoaded())addCss(BASE+LIBS.css.local);},4000);
      loading=Promise.race([Promise.all([one(LIBS.maplibre),one(LIBS.pmtiles)]),new Promise((_,fail)=>setTimeout(()=>fail(new Error(MESSAGE)),timeout))])
        .catch(e=>{loading=null;throw e;});
    }
    return loading;
  }
  const me=typeof document!=='undefined'?document.currentScript:null;
  if(!root.ALTOLibs){
    root.ALTOLibs={LIBS,MESSAGE,ready,watch,fallback,load,watching:false,failed:false};
    if(me&&me.hasAttribute('data-watch')){watch();root.ALTOLibs.watching=true;}
  }
  // The second copy, after the libraries' script tags.
  else if(me&&me.hasAttribute('data-fallback'))root.ALTOLibs.fallback();
})(window);
