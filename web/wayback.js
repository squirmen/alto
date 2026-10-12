/* Dated aerial captures at a point from Esri World Imagery Wayback (archived World Imagery releases
 * since February 2014).
 *
 * Off unless window.ALTO_ENABLE_WAYBACK is true. To switch it on for the public site:
 *  - Content-Security-Policy: add https://wayback.maptiles.arcgis.com to img-src, and
 *    https://s3-us-west-2.amazonaws.com https://wayback.maptiles.arcgis.com
 *    https://metadata.maptiles.arcgis.com to connect-src (the site allows server.arcgisonline.com only);
 *  - terms: World Imagery and its Wayback releases are licensed under the Esri Master License
 *    Agreement; Esri documents use in non-ArcGIS web maps through an ArcGIS Location Platform account
 *    and access token. Confirm keyless use with Esri, or add a token.
 *
 * releasesAt(lon, lat) walks the Wayback releases that changed the tile at the point (the tilemap
 * service names the release each tile comes from), reads each release's capture metadata at the
 * point (date, source, resolution, accuracy) and returns one entry per distinct capture. */
(function(root){
  'use strict';
  const CONFIG='https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
  const TILEMAP='https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap';
  const HOSTS={'img-src':['https://wayback.maptiles.arcgis.com'],'connect-src':['https://s3-us-west-2.amazonaws.com','https://wayback.maptiles.arcgis.com','https://metadata.maptiles.arcgis.com']};
  const REQUIREMENT='Dated imagery needs two changes to the site: its Content-Security-Policy must allow wayback.maptiles.arcgis.com (images) and s3-us-west-2.amazonaws.com, wayback.maptiles.arcgis.com and metadata.maptiles.arcgis.com (requests); and use of World Imagery Wayback outside ArcGIS must be confirmed under the Esri Master License Agreement (Esri documents an ArcGIS Location Platform account with an access token). Alternative: LINZ Basemaps historical Auckland aerial imagery (CC BY 4.0) with a LINZ Basemaps API key and basemaps.linz.govt.nz in img-src.';
  const ATTRIBUTION='Esri World Imagery Wayback: Esri, Vantor, Earthstar Geographics, and the GIS User Community';
  const enabled=()=>root.ALTO_ENABLE_WAYBACK===true;
  async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json();}
  let releases=null;
  function catalogue(){
    if(!releases)releases=json(CONFIG).then(c=>Object.entries(c).map(([k,v])=>({id:Number(k),title:v.itemTitle,date:(String(v.itemTitle).match(/\d{4}-\d{2}-\d{2}/)||[''])[0],
      tiles:String(v.itemURL).replace('{level}','{z}').replace('{row}','{y}').replace('{col}','{x}'),metadata:v.metadataLayerUrl})).sort((a,b)=>b.date.localeCompare(a.date)))
      .catch(err=>{releases=null;throw err;});
    return releases;
  }
  function tile(lon,lat,z){const n=2**z,r=lat*Math.PI/180;return {z,x:Math.floor((lon+180)/360*n),y:Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n)};}
  // Releases whose tile at this point differs from the next newer one, newest first.
  async function changes(lon,lat,{zoom=18,max=60}={}){
    const items=await catalogue(),t=tile(lon,lat,zoom),out=[];
    let i=0,calls=0;
    while(i<items.length&&calls<max){
      calls++;
      const it=items[i],j=await json(`${TILEMAP}/${it.id}/${t.z}/${t.y}/${t.x}/1/1`);
      const sel=j.select?.[0]??(j.data?.[0]?it.id:null);
      if(sel===null||sel===undefined)break;
      const rel=items.find(x=>x.id===Number(sel))||it;
      out.push(rel);i=items.indexOf(rel)+1;
    }
    return out;
  }
  // Capture metadata at the point for one release: the finest metadata layer that has a record.
  async function capture(rel,lon,lat){
    const geometry=encodeURIComponent(JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}));
    for(const layer of [2,1,3,4,5,6]){
      try{
        const m=await json(`${rel.metadata}/${layer}/query?f=json&where=1%3D1&outFields=SRC_DATE2,NICE_DESC,SRC_DESC,SAMP_RES,SRC_ACC&geometry=${geometry}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&returnGeometry=false`);
        const a=m.features?.[0]?.attributes;
        // Esri stores a missing capture date as 30 Dec 1899; treat anything before 1950 as not recorded.
        if(a){const d=a.SRC_DATE2&&a.SRC_DATE2>Date.UTC(1950,0,1)?new Date(a.SRC_DATE2):null;
          return {date:d?d.toISOString().slice(0,10):null,source:a.NICE_DESC||null,description:a.SRC_DESC||null,resolution:Number.isFinite(a.SAMP_RES)?a.SAMP_RES:null,
            accuracy:Number.isFinite(a.SRC_ACC)&&a.SRC_ACC<1000?a.SRC_ACC:null};}
      }catch{/* next layer */}
    }
    return null;
  }
  async function releasesAt(lon,lat){
    if(!enabled())return {status:'not_enabled',releases:[],requirement:REQUIREMENT,hosts:HOSTS};
    const rels=await changes(lon,lat);
    const caps=await Promise.all(rels.map(r=>capture(r,lon,lat).catch(()=>null)));
    // One entry per capture (same date and source), shown from the newest release that carries it.
    const byCapture=new Map();
    rels.forEach((r,i)=>{const c=caps[i],key=c?`${c.date}|${c.description}`:`release ${r.id}`;
      if(!byCapture.has(key))byCapture.set(key,{capture:c,release:{id:r.id,date:r.date,title:r.title},tiles:r.tiles,releasesShowing:0});
      byCapture.get(key).releasesShowing++;});
    const list=[...byCapture.values()].sort((a,b)=>(b.capture?.date||'0000').localeCompare(a.capture?.date||'0000')||b.release.date.localeCompare(a.release.date));
    return {status:list.length?'ready':'none',releases:list,tileVersions:rels.length,provider:'Esri World Imagery Wayback',attribution:ATTRIBUTION,requirement:REQUIREMENT,hosts:HOSTS};
  }
  const api={enabled,releasesAt,changes,capture,catalogue,tile,REQUIREMENT,HOSTS,ATTRIBUTION};
  root.ALTOWayback=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
