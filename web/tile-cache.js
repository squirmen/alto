/* PMTiles range reads kept on this device (FE-05). The archives are served "public, max-age=31536000, immutable", and a
 * browser's HTTP cache may keep the byte-range responses PMTiles reads: Chrome and WebKit kept them for a second visit,
 * and after a restart, in emulated runs (16 Oct 2026). Nothing obliges it to; a cleared or evicted cache, or one turned
 * off, reads them all again (1.8 MB for the first map view at an iPhone 13's size, 3.1 MB at a Pixel 7's). This file
 * keeps each range read of a versioned archive (a URL with ?v=, which the site never changes in place) in Cache Storage,
 * keyed by the URL and the byte range, and reads it back on the next visit.
 *
 *   ALTOTileCache.protocol(pmtiles) -> {protocol, tile(params, abort)}: a PMTiles protocol for maplibregl.addProtocol
 *     whose archives with ?v= read through this cache (unversioned URLs, and browsers without Cache Storage, read the
 *     network as before).
 *   ALTOTileCache.version(v): the release's tile_version; a different one from last time clears the cache.
 *
 * The cache holds at most about 50 MB, least recently used first out. No service worker: nothing else on the site
 * (KYTE included) is intercepted. */
(function(root){
  'use strict';
  // The index sits at the site root's key, so the map, tree pages and a beta build under a sub-path share one index.
  const CACHE='alto-pmtiles-v1',INDEX='/alto-pmtiles-index.json',MAX_BYTES=50*1024*1024,KEEP=0.8,SAVE_MS=1500;
  const versioned=url=>/[?&]v=(?!__auto__|session-)[^&#]+/.test(String(url||''));
  const available=()=>typeof root.caches!=='undefined'&&typeof root.caches.open==='function'&&typeof root.Response!=='undefined';
  const abs=u=>{try{return new URL(u,root.location?.href).href;}catch{return String(u);}};
  const keyOf=(url,offset,length)=>{const u=abs(url);return `${u}${u.includes('?')?'&':'?'}alto-range=${offset}-${offset+length-1}`;};
  const prefixOf=url=>{const u=abs(url);return `${u}${u.includes('?')?'&':'?'}alto-range=`;};
  let opened=null,wanted=null;
  // The cache and its index ({version, entries: {key: [bytes, lastUsed]}, total}); an index that is missing or cannot be
  // read means the cache is in an unknown state, so it starts empty.
  function open(){
    if(!opened)opened=(async()=>{
      let cache=await root.caches.open(CACHE),index=null;
      try{const r=await cache.match(abs(INDEX));index=r?await r.json():null;}catch{index=null;}
      if(!index||typeof index!=='object'||!index.entries||typeof index.total!=='number'){
        await root.caches.delete(CACHE);cache=await root.caches.open(CACHE);index={version:null,entries:{},total:0};
      }
      const S={cache,index,timer:null};
      if(wanted)await setVersion(S,wanted);
      return S;
    })().catch(e=>{opened=null;throw e;});
    return opened;
  }
  function save(S){
    clearTimeout(S.timer);
    S.timer=setTimeout(()=>{S.cache.put(abs(INDEX),new root.Response(JSON.stringify(S.index),{headers:{'content-type':'application/json'}})).catch(()=>{});},SAVE_MS);
  }
  async function clear(S,version){
    await root.caches.delete(CACHE);
    S.cache=await root.caches.open(CACHE);S.index={version:version||null,entries:{},total:0};save(S);
  }
  async function setVersion(S,v){
    if(!v||S.index.version===v)return;
    if(S.index.version)await clear(S,v);else{S.index.version=v;save(S);}
  }
  // Least recently used first out, down to 80% of the cap.
  async function evict(S){
    if(S.index.total<=MAX_BYTES)return;
    const order=Object.entries(S.index.entries).sort((a,b)=>a[1][1]-b[1][1]);
    for(const [k,[bytes]] of order){
      if(S.index.total<=MAX_BYTES*KEEP)break;
      delete S.index.entries[k];S.index.total-=bytes;await S.cache.delete(k).catch(()=>{});
    }
    save(S);
  }
  async function drop(S,url){
    const p=prefixOf(url);
    for(const k of Object.keys(S.index.entries))if(k.startsWith(p)){S.index.total-=S.index.entries[k][0];delete S.index.entries[k];await S.cache.delete(k).catch(()=>{});}
    save(S);
  }
  // A PMTiles source: the cached copy of a range when there is one, the network (and then the cache) when not.
  class CachedSource{
    constructor(url,inner){this.url=url;this.inner=inner;}
    getKey(){return this.url;}
    setHeaders(h){this.inner?.setHeaders?.(h);}
    async getBytes(offset,length,signal,etag){
      const S=await open().catch(()=>null),key=keyOf(this.url,offset,length);
      if(S){
        try{
          const hit=await S.cache.match(key);
          if(hit){const data=await hit.arrayBuffer(),e=S.index.entries[key];if(e)e[1]=Date.now();else{S.index.entries[key]=[data.byteLength,Date.now()];S.index.total+=data.byteLength;}save(S);
            return {data,etag:hit.headers.get('x-alto-etag')||undefined};}
        }catch{}
      }
      let res;
      // A changed archive behind an unchanged ?v= (never expected): forget its cached ranges, so PMTiles' one retry reads
      // the archive afresh.
      try{res=await this.inner.getBytes(offset,length,signal,etag);}
      catch(err){if(S&&/etag/i.test(String(err?.name||'')+String(err?.message||'')))await drop(S,this.url).catch(()=>{});throw err;}
      if(S&&res?.data){
        try{
          const bytes=res.data.byteLength;
          await S.cache.put(key,new root.Response(res.data.slice(0),{headers:{'content-type':'application/octet-stream','x-alto-etag':res.etag||''}}));
          if(!S.index.entries[key])S.index.total+=bytes;
          S.index.entries[key]=[bytes,Date.now()];save(S);
          if(S.index.total>MAX_BYTES)evict(S).catch(()=>{});
        }catch{}
      }
      return res;
    }
  }
  function urlOf(params){
    if(params?.type==='json')return String(params.url||'').slice(10);
    const m=/^pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/.exec(String(params?.url||''));
    return m?m[1]:null;
  }
  function protocol(P){
    const proto=new P.Protocol();
    const ensure=url=>{if(url&&!proto.get(url)&&versioned(url)&&available())proto.add(new P.PMTiles(new CachedSource(url,new P.FetchSource(url))));};
    return {protocol:proto,tile:(params,abort)=>{ensure(urlOf(params));return proto.tile(params,abort);}};
  }
  function version(v){
    if(!v||String(v).startsWith('__')||String(v).startsWith('session-'))return;
    wanted=String(v);
    if(available())open().then(S=>setVersion(S,wanted)).catch(()=>{});
  }
  const api={protocol,version,CachedSource,versioned,keyOf,urlOf,MAX_BYTES,CACHE,_reset:()=>{opened=null;wanted=null;}};
  root.ALTOTileCache=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
