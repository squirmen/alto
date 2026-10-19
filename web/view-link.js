/* The map's view in its address: the centre and zoom, the colour mode, the filters, the layers and the species
 * maxima area, so a copied address opens the same view (FTA-23). The map writes it with history.replaceState as the
 * view changes and reads it once at start; "Copy link to this view" copies it.
 *
 * Parameters, each written only when it differs from the default view:
 *   map=<zoom>/<lat>/<lon>     the camera ("17.25/-36.85123/174.76321"; more decimals the closer the zoom)
 *   colour=<mode>              the Colour by mode (source is the default)
 *   src=<keys>                 sources shown, when not all of them (comma-separated keys; "none" for none)
 *   status=<keys>              status: show only (protected)
 *   quality=<keys>             link status shown, when not all
 *   land=<keys>                land groups shown, when not all
 *   forms=<keys>               growth forms shown, when not all
 *   species=<name>             one per selected species spelling (repeated)
 *   named=1                    recorded species only
 *   uncertain=0                possible and unverified detections hidden
 *   minh=<m>                   height at least
 *   layers=<names>             layers switched on (parcels, landtype, positions, canopy, kauri, rootzone, low, sub, wide,
 *                              earlier, lowcandidates)
 *   crowns=0                   crown outlines off
 *   trunk=1                    markers sized by trunk
 *   maxima=<area>              the Species maxima filter on, in that area (read by the map once the maxima load)
 * Every other parameter (tree, property, change, q, debug) is left as it is.
 *
 * window.ALTOViewLink: OWNED, LAYERS, cameraText, parseCamera, encode, decode, href. Pure; loads in Node (tests). */
(function(root){
  'use strict';
  const OWNED=['map','colour','src','status','quality','land','forms','species','named','uncertain','minh','layers','crowns','trunk','maxima'];
  // Map state keys and their names in the address.
  const LAYERS={showProperties:'parcels',showLandType:'landtype',showCouncilPositions:'positions',showCanopy:'canopy',showKauri:'kauri',
    showRootZone:'rootzone',showLowBand:'low',showSubBand:'sub',wideCrownOnly:'wide',showEarlierDetections:'earlier',showLowCanopy:'lowcandidates',showGroupAreas:'groupareas'};
  const BY_NAME=Object.fromEntries(Object.entries(LAYERS).map(([k,v])=>[v,k]));
  const MAX_SPECIES=200,MAX_NAME=120;

  // Decimals for a position at a zoom: about a pixel's ground size (5 decimals ≈ 1 m).
  const digits=z=>z>=16?6:z>=12?5:4;
  const trim=(n,d)=>String(Number(n.toFixed(d)));
  function cameraText(zoom,lat,lon){
    const z=Number(zoom),d=digits(z);
    return `${trim(z,2)}/${trim(Number(lat),d)}/${trim(Number(lon),d)}`;
  }
  function parseCamera(text){
    const m=/^\s*(\d{1,2}(?:\.\d+)?)\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(text||''));
    if(!m)return null;
    const zoom=Number(m[1]),lat=Number(m[2]),lon=Number(m[3]);
    if(!(zoom>=0&&zoom<=22)||!(lat>=-85&&lat<=85)||!(lon>=-180&&lon<=180))return null;
    return {zoom,lat,lon};
  }
  const list=v=>String(v||'').split(',').map(s=>s.trim()).filter(Boolean);
  const same=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
  // A set of keys against all the keys it can hold: null when it holds all of them (the default).
  function keys(on,all){const k=all.filter(x=>on.includes(x));return same(k,all)?null:(k.length?k.join(','):'none');}

  // The view → [[name, value], …] in a fixed order, defaults left out.
  // view: {camera:{zoom,lat,lon}|null, colour, sources, statusOnly, quality, land, forms, species, showUnknown,
  //        showUncertain, minHeight, layers: {stateKey: bool}, showCrowns, showTrunk, maxima: area|null}
  // all: {sources, quality, land, forms, status} (every key each can hold), colour: the default mode.
  function encode(view,all){
    const out=[],put=(k,v)=>{if(v!==null&&v!==undefined&&v!=='')out.push([k,String(v)]);};
    if(view.camera)put('map',cameraText(view.camera.zoom,view.camera.lat,view.camera.lon));
    if(view.colour&&view.colour!==(all.colour||'source'))put('colour',view.colour);
    if(view.sources)put('src',keys(view.sources,all.sources||[]));
    if(view.statusOnly?.length)put('status',(all.status||view.statusOnly).filter(k=>view.statusOnly.includes(k)).join(','));
    if(view.quality)put('quality',keys(view.quality,all.quality||[]));
    if(view.land)put('land',keys(view.land,all.land||[]));
    if(view.forms)put('forms',keys(view.forms,all.forms||[]));
    for(const n of [...(view.species||[])].sort().slice(0,MAX_SPECIES))if(n&&String(n).length<=MAX_NAME)put('species',n);
    if(view.showUnknown===false)put('named','1');
    if(view.showUncertain===false)put('uncertain','0');
    if(Number(view.minHeight)>0)put('minh',trim(Number(view.minHeight),1));
    const on=Object.keys(LAYERS).filter(k=>view.layers?.[k]).map(k=>LAYERS[k]);
    if(on.length)put('layers',on.join(','));
    if(view.showCrowns===false)put('crowns','0');
    if(view.showTrunk===true)put('trunk','1');
    if(view.maxima)put('maxima',view.maxima);
    return out;
  }

  // URLSearchParams → the parts of a view it names, each checked against what the map can show; anything unknown is
  // dropped. known: {colours, sources, status, quality, land, forms}.
  function decode(params,known={}){
    const v={},get=k=>params.get(k),has=k=>params.has(k);
    if(has('map')){const c=parseCamera(get('map'));if(c)v.camera=c;}
    if(has('colour')&&(known.colours||[]).includes(get('colour')))v.colour=get('colour');
    const set=(name,field,all)=>{if(!has(name))return;const raw=get(name);if(raw==='none'){v[field]=[];return;}
      const k=list(raw).filter(x=>(all||[]).includes(x));if(k.length)v[field]=k;};
    set('src','sources',known.sources);set('status','statusOnly',known.status);set('quality','quality',known.quality);
    set('land','land',known.land);set('forms','forms',known.forms);
    const sp=params.getAll('species').map(s=>s.trim()).filter(s=>s&&s.length<=MAX_NAME).slice(0,MAX_SPECIES);
    if(sp.length)v.species=sp;
    if(get('named')==='1')v.showUnknown=false;
    if(get('uncertain')==='0')v.showUncertain=false;
    if(has('minh')){const h=Number(get('minh'));if(Number.isFinite(h)&&h>0&&h<=100)v.minHeight=Math.round(h*10)/10;}
    if(has('layers')){const on=list(get('layers')).map(n=>BY_NAME[n]).filter(Boolean);if(on.length)v.layers=Object.fromEntries(on.map(k=>[k,true]));}
    if(get('crowns')==='0')v.showCrowns=false;
    if(get('trunk')==='1')v.showTrunk=true;
    return v;
  }

  // The address with this view: the owned parameters replaced, every other one kept in its place.
  function href(url,view,all){
    const u=new URL(String(url));
    for(const k of OWNED)u.searchParams.delete(k);
    for(const [k,val] of encode(view,all))u.searchParams.append(k,val);
    // Commas, slashes and colons (a change's ID) read better unescaped; all are allowed in a query.
    const q=u.searchParams.toString().replace(/%2C/gi,',').replace(/%2F/gi,'/').replace(/%3A/gi,':');
    return u.pathname+(q?`?${q}`:'')+u.hash;
  }

  const api={OWNED,LAYERS,cameraText,parseCamera,encode,decode,href};
  root.ALTOViewLink=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
