/* A canopy change on the map (tree_change v1): its permalink and its aerial photographs (FTA-16).
 *
 * - Permalink: ?change=<change_id>&map=<zoom>/<lat>/<lon>&colour=change (the camera as view-link.js writes it, on the
 *   change at zoom 18). The map turns on Colour by change, and opens the change's popup once its tiles are in.
 *   change_id is "13:<LINZ tile>:<n>" or "16:<LINZ tile>:<n>" for a canopy gone by 2024 (the 2013 or 2016 survey's
 *   crown on that 1:1000 tile) and "cr:<n>" for canopy grown since (a 2024 crown); a link without map= is placed on
 *   its tile when the ID names one.
 * - Aerial photos of this spot: the imagery viewer (tree-imagery-viewer.js) on the change's position, opening on the
 *   last aerial survey before the change, with every survey that covers the spot in its year strip; the surveys
 *   before and after the change are marked. Before: the last sharp survey flown by the end of the year the canopy
 *   was last seen (removals) or last absent (canopy grown since), from the 2013 and 2016 LiDAR surveys. After: the
 *   first sharp survey flown from 2024, the survey year of the 2024 LiDAR.
 *
 * window.ALTOChangeLink: parseId, tileBounds, tileCentre, surveyYears, surveysFor, href. Pure; loads in Node (tests). */
(function(root){
  'use strict';
  // The LINZ sheet grid (as tree-imagery.js): sheets 24 × 36 km from E 988000, N 6810000, rows named with two letters
  // without I and O; a 1:1000 tile is the sheet cut into 50 × 50 tiles of 480 × 720 m, numbered from 1 at the top left.
  const LETTERS='ABCDEFGHJKLMNPQRSTUVWXYZ',SHEET_W=24000,SHEET_H=36000,LEFT=988000,TOP=6810000;
  const GRID={500:[240,360],1000:[480,720],2000:[960,1440],5000:[2400,3600],10000:[4800,7200]};
  const ID=/^(?:(13|16):([A-Z]{2}\d{2})_(500|1000|2000|5000|10000)_(\d{4,6}):(\d{1,7})|cr:(\d{1,9}))$/;
  function parseId(raw){
    const m=ID.exec(String(raw||'').trim());
    if(!m)return null;
    if(m[6])return {id:m[0],kind:'grown',n:Number(m[6])};
    return {id:m[0],kind:'gone',year:2000+Number(m[1]),tile:`${m[2]}_${m[3]}_${m[4]}`,n:Number(m[5])};
  }
  // NZTM2000 bounds of a LINZ tile ("BA31_1000_3040"), or null.
  function tileBounds(name){
    const m=/^([A-Z])([A-Z])(\d{2})_(\d+)_(\d+)$/.exec(String(name||''));
    if(!m)return null;
    const g=GRID[m[4]],d=m[4]==='500'?3:2,r1=LETTERS.indexOf(m[1]),r2=LETTERS.indexOf(m[2]);
    if(!g||r1<0||r2<0||m[5].length!==2*d)return null;
    const row=r1*LETTERS.length+r2,col=Number(m[3]),y=Number(m[5].slice(0,d)),x=Number(m[5].slice(d));
    const per=Math.round(SHEET_W/g[0]);
    if(x<1||y<1||x>per||y>per)return null;
    const e0=LEFT+col*SHEET_W+(x-1)*g[0],n1=TOP-row*SHEET_H-(y-1)*g[1];
    return {e0,e1:e0+g[0],n0:n1-g[1],n1};
  }
  // The LiDAR years either side of the change: before (the canopy last seen, or last absent) and after (2024).
  function surveyYears(p){
    const gone=p?.fate==='removed_to_open';
    const before=gone?(p.h_2016!=null?2016:2013):(p?.fate==='established_since_2016'?2016:2013);
    return {before,after:2024};
  }
  // The aerial surveys to mark (ids from tree-imagery.js SURVEYS, oldest first): the last sharp survey flown by the end
  // of the before year, and the first sharp survey flown from the after year. coarse: the gsd (m) from which a
  // survey is coarse (ALTOImagery.COARSE).
  function surveysFor(p,surveys,coarse=0.25){
    const y=surveyYears(p),sharp=(surveys||[]).filter(s=>s.gsd<coarse);
    const before=sharp.filter(s=>s.end<=`${y.before}-12-31`).sort((a,b)=>a.end<b.end?-1:a.end>b.end?1:0).pop()||null;
    const after=sharp.filter(s=>s.start>=`${y.after}-01-01`).sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:0)[0]||null;
    return {before:before?.id||null,after:after?.id||null,years:y};
  }

  // The centre of a LINZ tile in NZTM2000 ([e, n]), or null.
  function tileCentre(name){
    const b=tileBounds(name);
    return b?[(b.e0+b.e1)/2,(b.n0+b.n1)/2]:null;
  }
  // The change's permalink: the page's path with ?change=, the camera on the change at zoom 18 and Colour by change.
  // Colons and slashes read better unescaped; both are allowed in a query.
  function href(url,id,lon,lat,{zoom=18,cameraText=null}={}){
    const u=new URL(String(url)),p=parseId(id);
    if(!p)return null;
    const cam=cameraText?cameraText(zoom,lat,lon):`${zoom}/${Number(lat).toFixed(6)}/${Number(lon).toFixed(6)}`;
    const q=new URLSearchParams();
    q.set('change',p.id);
    if(Number.isFinite(Number(lon))&&Number.isFinite(Number(lat)))q.set('map',cam);
    q.set('colour','change');
    return u.pathname+'?'+q.toString().replace(/%3A/gi,':').replace(/%2F/gi,'/');
  }

  const api={parseId,tileBounds,tileCentre,surveyYears,surveysFor,href};
  root.ALTOChangeLink=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
