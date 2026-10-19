// Offline checks for the tile cache (FE-05, web/tile-cache.js): PMTiles range reads of versioned archives (?v=) are kept
// in Cache Storage keyed by URL and byte range, read back on the next visit, held to about 50 MB least recently used
// first out, and cleared when the release's tile_version changes; unversioned archives read the network as before. The
// map and the tree page's inset map read through it; there is no service worker.
// Storage that keeps nothing, rejects a write or cannot be opened leaves every read on the network.
// Usage: node pipeline/tool/test_tile_cache.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';

// Cache Storage, in memory.
function fakeCaches(){
  const stores=new Map();
  const store=()=>{const m=new Map();return {
    async match(k){const r=m.get(String(k));return r?r.clone():undefined;},
    async put(k,r){m.set(String(k),r.clone());},
    async delete(k){return m.delete(String(k));},
    async keys(){return [...m.keys()];},_m:m};};
  return {stores,async open(n){if(!stores.has(n))stores.set(n,store());return stores.get(n);},async delete(n){return stores.delete(n);},async keys(){return [...stores.keys()];}};
}
const fresh=()=>{delete require.cache[require.resolve(web+'tile-cache.js')];globalThis.caches=fakeCaches();return require(web+'tile-cache.js');};
const settle=()=>new Promise(r=>setTimeout(r,5));
class Inner{constructor(){this.calls=[];this.etag='"e1"';}async getBytes(o,l){this.calls.push([o,l]);const b=new Uint8Array(l);b.fill(o%251);return {data:b.buffer,etag:this.etag};}}
const URL1='./data/trees_map_points.pmtiles?v=20261013-v6.2';

(async()=>{
  {const TC=fresh();
    assert.ok(TC.versioned(URL1)&&TC.versioned('./data/x.pmtiles?v=1&rev=v1-20261013'),'versioned archives');
    assert.ok(!TC.versioned('./data/x.pmtiles')&&!TC.versioned('./data/x.pmtiles?v=__auto__')&&!TC.versioned('./data/x.pmtiles?v=session-17'),'unversioned, not yet stamped and per-session URLs are not cached');
    assert.equal(TC.keyOf(URL1,0,16384),URL1+'&alto-range=0-16383','keyed by URL and byte range');
    assert.equal(TC.urlOf({type:'json',url:'pmtiles://'+URL1}),URL1);
    assert.equal(TC.urlOf({url:`pmtiles://${URL1}/14/16141/10032`}),URL1);
  }
  // A miss reads the network and keeps the range; the next visit reads it back, bytes and ETag, without the network.
  {const TC=fresh(),inner=new Inner(),src=new TC.CachedSource(URL1,inner);
    const a=await src.getBytes(0,16384);
    assert.equal(inner.calls.length,1);
    const inner2=new Inner(),src2=new TC.CachedSource(URL1,inner2);
    const b=await src2.getBytes(0,16384);
    assert.equal(inner2.calls.length,0,'warm: no network read');
    assert.deepEqual(new Uint8Array(b.data),new Uint8Array(a.data),'warm: the same bytes');
    assert.equal(b.etag,'"e1"','warm: the same ETag');
    await src2.getBytes(16384,1000);
    assert.equal(inner2.calls.length,1,'another range is another read');
  }
  // About 50 MB at most, least recently used first out (down to 80%).
  {const TC=fresh(),inner=new Inner(),src=new TC.CachedSource(URL1,inner),MB=1024*1024;
    for(let i=0;i<5;i++){await src.getBytes(i*20*MB,12*MB);await settle();}
    const keys=await (await caches.open(TC.CACHE)).keys(),ranges=keys.filter(k=>k.includes('alto-range='));
    const held=ranges.length*12;
    assert.ok(held<=50&&held>=24,`held ${held} MB`);
    assert.ok(!ranges.some(k=>k.endsWith('alto-range=0-12582911')),'the oldest range went first');
    assert.ok(ranges.some(k=>k.includes(`alto-range=${80*MB}-`)),'the newest range stays');
  }
  // A new tile_version clears the cache; the first version seen is only recorded.
  {const TC=fresh(),inner=new Inner(),src=new TC.CachedSource(URL1,inner);
    TC.version('20261013-v6.2');await settle();
    await src.getBytes(0,100);
    TC.version('20261013-v6.2');await settle();
    assert.equal((await (await caches.open(TC.CACHE)).keys()).filter(k=>k.includes('alto-range=')).length,1,'same version: kept');
    TC.version('20261020-v6.3');await settle();await settle();
    assert.equal((await (await caches.open(TC.CACHE)).keys()).filter(k=>k.includes('alto-range=')).length,0,'new version: cleared');
    TC.version('__auto__');TC.version('session-9');await settle();
  }
  // An archive changed behind an unchanged ?v= (an ETag mismatch): its cached ranges are forgotten before PMTiles retries.
  {const TC=fresh(),inner=new Inner(),src=new TC.CachedSource(URL1,inner);
    await src.getBytes(0,100);
    inner.getBytes=async()=>{const e=new Error('Server returned non-matching ETag');e.name='EtagMismatch';throw e;};
    await assert.rejects(src.getBytes(500,100),/ETag/);
    await settle();
    assert.equal((await (await caches.open(TC.CACHE)).keys()).filter(k=>k.includes('alto-range=')).length,0,'mismatch: the archive’s ranges dropped');
  }
  // Storage that fails reads the network, two visits running: a Cache Storage that keeps nothing (as WebKit 2272 under
  // Playwright does in a persistent profile: put() resolves, keys stay empty), one whose put() rejects (a full quota) and
  // one that cannot be opened. Each read returns the network's bytes and ETag; none is answered from an empty cache.
  {const failing=mode=>{const c=fakeCaches(),open=c.open.bind(c);
      if(mode==='cannot open')c.open=async()=>{const e=new Error('storage blocked');e.name='SecurityError';throw e;};
      else c.open=async n=>{const s=await open(n);s.put=mode==='keeps nothing'?async()=>{}:async()=>{const e=new Error('quota');e.name='QuotaExceededError';throw e;};return s;};
      return c;};
    for(const mode of ['keeps nothing','put rejects','cannot open']){
      globalThis.caches=failing(mode);
      for(const visit of [1,2]){
        delete require.cache[require.resolve(web+'tile-cache.js')];
        const TC=require(web+'tile-cache.js');TC.version('20261013-v6.2');
        const inner=new Inner(),r=await new TC.CachedSource(URL1,inner).getBytes(0,16384);
        assert.equal(inner.calls.length,1,`${mode}, visit ${visit}: read from the network`);
        assert.equal(r.data.byteLength,16384,`${mode}, visit ${visit}: the network's bytes`);
        assert.equal(r.etag,'"e1"',`${mode}, visit ${visit}: the network's ETag`);
        await settle();
      }
    }
  }
  // The protocol: versioned archives get a cached source; others keep PMTiles' own.
  {const TC=fresh(),added=[];
    const P={Protocol:class{constructor(){this.m=new Map();this.tile=(p,a)=>['tile',p.url];}add(x){this.m.set(x.source.getKey(),x);added.push(x);}get(u){return this.m.get(u);}},
      PMTiles:class{constructor(s){this.source=s;}},FetchSource:class{constructor(u){this.url=u;}getKey(){return this.url;}}};
    const pr=TC.protocol(P);
    pr.tile({type:'json',url:'pmtiles://'+URL1});pr.tile({url:`pmtiles://${URL1}/14/1/2`});pr.tile({url:'pmtiles://./data/x.pmtiles/14/1/2'});
    assert.equal(added.length,1,'one cached source per versioned archive');
    assert.ok(added[0].source instanceof TC.CachedSource&&added[0].source.inner instanceof P.FetchSource,'reads the network through PMTiles’ own source');
  }
  // Wiring: the map and the tree page load tile-cache.js and read their archives through it; no service worker.
  {const idx=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8')),tree=fs.readFileSync(web+'tree.html','utf8'),page=fs.readFileSync(web+'tree-page.js','utf8');
    assert.ok(idx.includes('<script src="./tile-cache.js?v=')&&idx.includes('const tileCache = window.ALTOTileCache ? window.ALTOTileCache.protocol(pmtiles) : null;')&&idx.includes('window.ALTOTileCache.version(TILE_VERSION); return tileCache.tile(params, abort);'),'map: archives through the cache, cleared on a new tile_version');
    assert.ok(!tree.includes('<script src="./tile-cache.js')&&page.includes("['./map-libs.js','./tile-cache.js','./map-sources.js']")&&page.includes("const TC=window.ALTOTileCache,cached=TC?TC.protocol(pmtiles):null;if(TC)TC.version(VERSION);"),'tree page: the inset map too (tile-cache.js arrives with the inset, FE-03)');
    for(const f of fs.readdirSync(web).filter(f=>/\.(html|js)$/.test(f)))assert.ok(!/serviceWorker\.register/.test(fs.readFileSync(web+f,'utf8')),`${f}: no service worker`);
  }
  console.log('tile cache: keys, warm reads, the 50 MB cap, version clearing, ETag mismatch, storage that fails, the protocol and the wiring checked');
  setTimeout(()=>process.exit(0),1600);
})().catch(e=>{console.error(e);process.exit(1);});
