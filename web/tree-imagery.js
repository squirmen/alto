/* Aerial imagery through time at one tree: the crown in each aerial survey of Auckland that covers it, from the scanned
 * historical surveys (1939–2004) to the surveys since 2010, read in the browser from LINZ's open imagery archive, with
 * the 2024 crown outline drawn on every photograph.
 *
 * No key and no tile server. The archive (https://nz-imagery.s3.ap-southeast-2.amazonaws.com/, LINZ STAC
 * catalogue catalog.json) holds each survey as cloud-optimised GeoTIFFs in NZTM2000 (EPSG:2193), one file per
 * tile of LINZ's map-sheet grid, with internal 512-px WebP tiles and overviews, and allows browser reads (CORS
 * Access-Control-Allow-Origin *, Range allowed). For each survey this module names the file that covers the tree
 * from the sheet grid (no catalogue lookups), reads the file's header (one 16 KB Range request) and then only the
 * internal tiles under a window around the crown, at the overview level that gives about 160-320 pixels across
 * it (one more Range request per row of tiles), and decodes them with the browser's own WebP decoder onto a
 * canvas. The coverage index (imagery-coverage.json) gives each survey's capture area and the files it holds, so a
 * survey whose capture area or files leave the tree out is listed as not covering it with no request; one without
 * pixels at the tree (its alpha band is 0 there) is listed the same way, never drawn.
 *
 * Site requirement: the Content-Security-Policy must allow https://nz-imagery.s3.ap-southeast-2.amazonaws.com
 * in connect-src (the reads are fetch() calls; the pixels are drawn on a canvas, so img-src needs nothing new).
 *
 * Surveys and dates: Auckland's urban and rural aerial surveys since 2010 in the LINZ catalogue (SURVEYS, checked
 * 12 Oct 2026), and its 85 scanned historical surveys, 1939–2004 (the coverage index's historic list, built from the
 * catalogue on 17 Oct 2026 by pipeline/tool/build_imagery_coverage.py: survey number, pixel size, black and white or
 * colour, licensors and producers). LINZ publishes one capture period per survey (start_datetime to end_datetime, NZ
 * dates stored as NZ midnight in UTC), not a date per tile, so a card gives the survey's flying period. Licence
 * CC BY 4.0; the licensors and producers are those LINZ lists for each survey.
 *
 * window.ALTOImagery: SURVEYS, historic(index), covers(index, survey, view), inFootprint(index, survey, [x, y]),
 * nztm(lon, lat), tileName(e, n, scale), tileNamesIn(window, scale), parseTiff(buffer), view(...), read(survey, view),
 * timeline(container, options), and io (open, range, decode: the cached header reader, Range reads and tile decoding,
 * which the larger view in tree-imagery-viewer.js shares). The pure parts also load in Node (tests). */
(function(root){
  'use strict';
  const BUCKET='https://nz-imagery.s3.ap-southeast-2.amazonaws.com';
  const ARCHIVE='https://registry.opendata.aws/nz-imagery/';
  const CATALOGUE=`${BUCKET}/catalog.json`;
  const LICENCE={name:'CC BY 4.0',href:'https://creativecommons.org/licenses/by/4.0/'};
  const HOST='Toitū Te Whenua Land Information New Zealand';
  // Oldest first, by the year each survey began (its title), then by the end of its flying period. gsd: ground
  // sample distance (m);
  // scale: the LINZ tile grid the survey's files are cut on (1:1000 = 480 × 720 m files).
  const S=(id,label,kind,gsd,scale,start,end,licensors,producers,extra={})=>({id,label,kind,gsd,scale,start,end,licensors,producers,
    path:`auckland/${id}/rgb/2193`,collection:`${BUCKET}/auckland/${id}/rgb/2193/collection.json`,...extra});
  const SURVEYS=[
    S('auckland_2010_0.075m','2010','Urban',0.075,1000,'2010-01-06','2010-04-08',['Auckland Council'],['New Zealand Aerial Mapping'],{title:'Auckland 0.075m Urban Aerial Photos (2010)'}),
    S('auckland_2010-2011_0.125m','2010–11','Urban',0.125,1000,'2011-09-06','2011-09-06',['Auckland Council'],['Aerial Surveys'],
      {title:'Auckland 0.125m Urban Aerial Photos (2010-2011)',dateNote:'LINZ lists this one date for the whole 2010–11 survey'}),
    S('auckland_2010-2012_0.5m','2010–12','Rural',0.5,10000,'2010-10-31','2012-05-03',['Auckland Council'],['New Zealand Aerial Mapping'],{title:'Auckland 0.5m Rural Aerial Photos (2010-2012)'}),
    S('auckland_2012_0.075m','2012','Urban',0.075,1000,'2012-01-24','2012-03-05',['Auckland Council'],['New Zealand Aerial Mapping'],{title:'Auckland 0.075m Urban Aerial Photos (2012)'}),
    S('auckland_2015-2016_0.075m','2015–16','Urban',0.075,1000,'2015-11-13','2016-04-27',['Auckland Council'],['AAM NZ'],{title:'Auckland 0.075m Urban Aerial Photos (2015-2016)'}),
    S('auckland_2017_0.075m','2017','Urban',0.075,1000,'2017-03-15','2017-05-06',['AAM NZ','Auckland Council'],['AAM NZ'],{title:'Auckland 0.075m Urban Aerial Photos (2017)'}),
    S('auckland_2020_0.075m','2020','Rural',0.075,1000,'2020-03-15','2020-12-30',['Auckland Council'],['AAM NZ'],{title:'Auckland 0.075m Rural Aerial Photos (2020)'}),
    S('auckland_2022_0.075m','2022','Rural',0.075,1000,'2022-01-04','2022-02-15',['Auckland Council'],['AAM NZ'],{title:'Auckland 0.075m Rural Aerial Photos (2022)'}),
    S('auckland-central_2023_0.06m','2023','Central',0.06,2000,'2023-08-22','2023-08-24',['Auckland Council'],['Recon'],{title:'Auckland Central 0.06m Urban Aerial Photos (2023)'}),
    S('auckland_2024_0.25m','2024','Rural',0.25,5000,'2024-03-20','2024-05-11',['National Institute of Water and Atmospheric Research'],['Aerial Surveys'],{title:'Auckland 0.25m Rural Aerial Photos (2024)'}),
    S('auckland_2024_0.075m','2024–25','Urban',0.075,1000,'2024-02-01','2025-03-06',['Auckland Council'],['Aerial Surveys'],{title:'Auckland 0.075m Urban Aerial Photos (2024-2025)'})
  ];
  const SHORT={'National Institute of Water and Atmospheric Research':'NIWA','Toitū Te Whenua Land Information New Zealand':'Toitū Te Whenua LINZ'};
  const COARSE=0.25; // m: a survey this coarse is read only where no sharper survey of the same years covers the tree

  // ---------- NZTM2000 (EPSG:2193): transverse Mercator on GRS80, central meridian 173°E ----------
  // Snyder's series (USGS Professional Paper 1395, eqs 8-9 to 8-10): millimetres within Auckland. NZGD2000 and
  // WGS84 positions agree to well under the imagery's pixel size here.
  function nztm(lon,lat){
    const a=6378137,f=1/298.257222101,k0=0.9996,lon0=173*Math.PI/180,FE=1600000,FN=10000000;
    const e2=2*f-f*f,ep2=e2/(1-e2),e4=e2*e2,e6=e4*e2;
    const p=lat*Math.PI/180,l=lon*Math.PI/180,s=Math.sin(p),c=Math.cos(p),t=Math.tan(p);
    const N=a/Math.sqrt(1-e2*s*s),T=t*t,C=ep2*c*c,A=(l-lon0)*c;
    const M=a*((1-e2/4-3*e4/64-5*e6/256)*p-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*p)+(15*e4/256+45*e6/1024)*Math.sin(4*p)-(35*e6/3072)*Math.sin(6*p));
    const x=FE+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120);
    const y=FN+k0*(M+N*t*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));
    return [x,y];
  }

  // ---------- LINZ tile names (the NZTopo50 sheet grid and its subdivisions) ----------
  // Sheets are 24 × 36 km; columns count from E 988000, rows from N 6810000 with two letters from an alphabet
  // without I and O (AS is the northernmost row in use). A 1:S file is the sheet divided into 50000/S² parts:
  // 1:1000 = 50 × 50 files of 480 × 720 m, named <sheet>_<scale>_<row><column> from 1 at the top left.
  // Checked against the archive's file origins (e.g. BA31_1000_3707 at E 1734880, N 5920080).
  const LETTERS='ABCDEFGHJKLMNPQRSTUVWXYZ',SHEET_W=24000,SHEET_H=36000,LEFT=988000,TOP=6810000;
  const GRID={500:[240,360],1000:[480,720],2000:[960,1440],5000:[2400,3600],10000:[4800,7200]};
  function tileName(e,n,scale){
    const g=GRID[scale];if(!g)throw new Error(`No LINZ grid at 1:${scale}`);
    const row=Math.floor((TOP-n)/SHEET_H),col=Math.floor((e-LEFT)/SHEET_W);
    if(row<0||col<0||row>=LETTERS.length**2)return null;
    const sheet=LETTERS[Math.floor(row/LETTERS.length)]+LETTERS[row%LETTERS.length]+String(col).padStart(2,'0');
    const x=Math.floor((e-(LEFT+col*SHEET_W))/g[0])+1,y=Math.floor(((TOP-row*SHEET_H)-n)/g[1])+1,d=scale===500?3:2;
    return `${sheet}_${scale}_${String(y).padStart(d,'0')}${String(x).padStart(d,'0')}`;
  }
  // The files a window touches (its corners; a window is far smaller than a file).
  function tileNames(v,scale){
    const out=[];
    for(const [e,n] of [[v.x0,v.y1],[v.x1-1e-6,v.y1],[v.x0,v.y0+1e-6],[v.x1-1e-6,v.y0+1e-6]]){const t=tileName(e,n,scale);if(t&&!out.includes(t))out.push(t);}
    return out;
  }
  // The files under a window of any size: one sample per file width and height, so a frame wider than a file
  // (the larger view's widened frames) names every file it crosses.
  function tileNamesIn(v,scale){
    const g=GRID[scale];if(!g)throw new Error(`No LINZ grid at 1:${scale}`);
    const xs=[],ys=[],out=[];
    for(let x=v.x0;x<v.x1;x+=g[0])xs.push(x);xs.push(v.x1-1e-6);
    for(let y=v.y1;y>v.y0;y-=g[1])ys.push(y);ys.push(v.y0+1e-6);
    for(const n of ys)for(const e of xs){const t=tileName(e,n,scale);if(t&&!out.includes(t))out.push(t);}
    return out;
  }

  // ---------- TIFF / BigTIFF header ----------
  const TYPE_SIZE={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,16:8,17:8,18:8};
  const TAG={254:'subfile',256:'width',257:'height',258:'bits',259:'compression',262:'photometric',277:'samples',284:'planar',
    322:'tileWidth',323:'tileHeight',324:'tileOffsets',325:'tileCounts',338:'extraSamples',347:'jpegTables',33550:'pixelScale',33922:'tiepoint'};
  class NeedMore extends Error{constructor(n){super(`Header needs ${n} bytes`);this.bytes=n;}}
  // Every IFD of a TIFF from the first bytes of the file: each tag as {type, count, pos} (pos: the file offset of
  // its values), so arrays such as the tile offsets can be read entry by entry, from this buffer or by a request.
  function parseTiff(buffer){
    const v=new DataView(buffer),len=v.byteLength;
    if(len<16)throw new NeedMore(16);
    const le=v.getUint16(0)===0x4949;if(!le&&v.getUint16(0)!==0x4d4d)throw new Error('Not a TIFF file');
    const u16=o=>v.getUint16(o,le),u32=o=>v.getUint32(o,le),u64=o=>le?u32(o)+u32(o+4)*2**32:u32(o)*2**32+u32(o+4);
    const big=u16(2)===43;if(!big&&u16(2)!==42)throw new Error('Not a TIFF file');
    const offAt=big?u64:u32,inline=big?8:4,entry=big?20:12;
    const ifds=[];let at=offAt(big?8:4);
    while(at&&ifds.length<64){
      if(at+(big?8:2)>len)throw new NeedMore(at+4096);
      const n=big?u64(at):u16(at),start=at+(big?8:2),end=start+n*entry;
      if(end+(big?8:4)>len)throw new NeedMore(end+4096);
      const tags={};
      for(let i=0;i<n;i++){
        const o=start+i*entry,code=u16(o),type=u16(o+2),count=big?u64(o+4):u32(o+4),size=(TYPE_SIZE[type]||1)*count;
        const pos=size<=inline?o+(big?12:8):offAt(o+(big?12:8));
        if(TAG[code])tags[TAG[code]]={type,count,pos};
      }
      ifds.push(tags);at=offAt(end);
    }
    return {le,big,ifds,buffer};
  }
  // One value of a tag at index i, from a DataView over [base, base + byteLength).
  function valueAt(view,base,le,tag,i){
    const o=tag.pos+i*TYPE_SIZE[tag.type]-base;
    switch(tag.type){case 1:case 2:case 6:case 7:return view.getUint8(o);case 3:return view.getUint16(o,le);case 8:return view.getInt16(o,le);
      case 4:return view.getUint32(o,le);case 9:return view.getInt32(o,le);case 11:return view.getFloat32(o,le);case 12:return view.getFloat64(o,le);
      case 16:case 18:return le?view.getUint32(o,le)+view.getUint32(o+4,le)*2**32:view.getUint32(o,le)*2**32+view.getUint32(o+4,le);
      default:throw new Error(`TIFF type ${tag.type} not read`);}
  }

  // ---------- one cloud-optimised GeoTIFF ----------
  const headers=new Map();
  class HttpError extends Error{constructor(status,url){super(`${status} ${url}`);this.status=status;}}
  async function range(url,a,b,signal=null){
    const ctl=typeof AbortController==='undefined'?null:new AbortController();
    if(signal&&ctl){if(signal.aborted)ctl.abort();else signal.addEventListener('abort',()=>ctl.abort(),{once:true});}
    const res=await fetch(url,{headers:{Range:`bytes=${a}-${b}`},signal:ctl?.signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
    if(res.status===404||res.status===403){throw new HttpError(res.status,url);}
    // A server that ignores Range would send the whole file (tens of MB): stop.
    if(res.status!==206){ctl?.abort();throw new HttpError(res.status,url);}
    return res.arrayBuffer();
  }
  async function open(url){
    if(!headers.has(url))headers.set(url,(async()=>{
      let size=16384,t;
      for(let i=0;i<4;i++){
        const buf=await range(url,0,size-1);
        try{t=parseTiff(buf);break;}catch(e){if(!(e instanceof NeedMore)||i===3)throw e;size=Math.max(size*4,e.bytes);}
      }
      return cog(url,t);
    })().catch(e=>{headers.delete(url);throw e;}));
    return headers.get(url);
  }
  function cog(url,t){
    const view=new DataView(t.buffer),one=(tags,k,i=0)=>tags[k]?valueAt(view,0,t.le,tags[k],i):null;
    const all=(tags,k)=>tags[k]?Array.from({length:tags[k].count},(_,i)=>valueAt(view,0,t.le,tags[k],i)):null;
    const full=t.ifds[0],scale=all(full,'pixelScale'),tie=all(full,'tiepoint');
    if(!scale||!tie)throw new Error('No georeferencing in the GeoTIFF header');
    const res0=scale[0],originX=tie[3]-tie[0]*res0,originY=tie[4]+tie[1]*scale[1],W=one(full,'width');
    const compression=one(full,'compression');
    if(one(full,'planar')===2)throw new Error('Planar GeoTIFF not read');
    const levels=t.ifds.filter((d,i)=>i===0||((one(d,'subfile')||0)&1)&&!((one(d,'subfile')||0)&4)).map(d=>{
      const w=one(d,'width'),h=one(d,'height'),tw=one(d,'tileWidth'),th=one(d,'tileHeight');
      return {width:w,height:h,tw,th,across:Math.ceil(w/tw),down:Math.ceil(h/th),res:res0*W/w,offsets:d.tileOffsets,counts:d.tileCounts};
    }).filter(l=>l.tw&&l.offsets&&l.counts).sort((a,b)=>a.res-b.res);
    const jpegTables=full.jpegTables?new Uint8Array(t.buffer,full.jpegTables.pos,full.jpegTables.count):null;
    // Entries of a tile-offset or byte-count array; out-of-header spans are read with one request each.
    async function entries(tag,idx){
      const sz=TYPE_SIZE[tag.type],out=[];
      const outside=idx.filter(i=>tag.pos+(i+1)*sz>t.buffer.byteLength);
      let extra=null,base=0;
      if(outside.length){const lo=tag.pos+Math.min(...outside)*sz,hi=tag.pos+(Math.max(...outside)+1)*sz-1;extra=new DataView(await range(url,lo,hi));base=lo;}
      for(const i of idx)out.push(tag.pos+(i+1)*sz>t.buffer.byteLength?valueAt(extra,base,t.le,tag,i):valueAt(view,0,t.le,tag,i));
      return out;
    }
    return {url,originX,originY,width:W,height:one(full,'height'),res:res0,compression,photometric:one(full,'photometric'),jpegTables,levels,entries,
      extent:{x0:originX,y1:originY,x1:originX+W*res0,y0:originY-one(full,'height')*res0}};
  }
  // Tile bytes for a set of tiles: neighbouring tiles (a row of a level is stored in order) share one request.
  async function fetchTiles(url,parts){
    const sorted=[...parts].sort((a,b)=>a.off-b.off),groups=[];
    for(const p of sorted){const g=groups[groups.length-1];if(g&&p.off-g.end<=8192){g.items.push(p);g.end=Math.max(g.end,p.off+p.len);}else groups.push({start:p.off,end:p.off+p.len,items:[p]});}
    await Promise.all(groups.map(async g=>{const buf=await range(url,g.start,g.end-1);for(const p of g.items)p.bytes=new Uint8Array(buf,p.off-g.start,p.len);}));
    return parts;
  }
  // One internal tile as an image. WebP (LINZ's archive) and JPEG are decoded by the browser.
  function decode(bytes,c){
    if(c.compression===50001)return createImageBitmap(new Blob([bytes],{type:'image/webp'}));
    if(c.compression===7){
      let b=bytes;
      if(c.jpegTables){const t=c.jpegTables,m=new Uint8Array(t.length-2+bytes.length-2);m.set(t.subarray(0,t.length-2),0);m.set(bytes.subarray(2),t.length-2);b=m;}
      return createImageBitmap(new Blob([b],{type:'image/jpeg'}));
    }
    return Promise.reject(new Error(`Compression ${c.compression} not read`));
  }

  // ---------- a window around the crown ----------
  // Centre and side (m) in NZTM: the crown's outline when known (its box, with a margin), else the recorded
  // position and the crown area; 30 m at least, 90 m at most.
  function view({lon,lat,area=null,geometry=null}){
    let cx,cy,side;
    const rings=geometry?(geometry.type==='Polygon'?[geometry.coordinates[0]]:geometry.type==='MultiPolygon'?geometry.coordinates.map(p=>p[0]):[]):[];
    const pts=rings.flat().map(([x,y])=>nztm(x,y));
    if(pts.length>2){
      const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);
      cx=(Math.max(...xs)+Math.min(...xs))/2;cy=(Math.max(...ys)+Math.min(...ys))/2;side=Math.max(w,h)*1.5+8;
    }else{[cx,cy]=nztm(lon,lat);const d=area>0?2*Math.sqrt(area/Math.PI):8;side=d*2.2;}
    side=Math.min(90,Math.max(30,side));
    const [tx,ty]=nztm(lon,lat);
    return {x0:cx-side/2,x1:cx+side/2,y0:cy-side/2,y1:cy+side/2,side,tree:[tx,ty]};
  }
  // The overview to read: the coarsest with at least 160 pixels across the window.
  function pickLevel(c,side,min=160){
    let best=0;for(let i=0;i<c.levels.length;i++)if(side/c.levels[i].res>=min)best=i;
    return best;
  }
  // On a small screen or with Save-Data on, one overview coarser (at least 80 pixels across) where that reads fewer of
  // the archive's tiles (FE-18). The files are cut in 512-pixel tiles at every overview, so a coarser tile is no
  // smaller: where the window sits in one tile at both overviews, the sharper one costs the same and is read.
  const lite=()=>!!(root.navigator?.connection?.saveData||root.matchMedia?.('(max-width: 760px)').matches);
  function tileCount(files,v,res){
    let n=0;
    for(const c of files){
      const L=c.levels.find(l=>Math.abs(l.res-res)<1e-9);if(!L)continue;
      const px0=(v.x0-c.originX)/res,px1=(v.x1-c.originX)/res,py0=(c.originY-v.y1)/res,py1=(c.originY-v.y0)/res;
      const tx0=Math.max(0,Math.floor(px0/L.tw)),tx1=Math.min(L.across-1,Math.floor((px1-1e-9)/L.tw));
      const ty0=Math.max(0,Math.floor(py0/L.th)),ty1=Math.min(L.down-1,Math.floor((py1-1e-9)/L.th));
      if(tx0<=tx1&&ty0<=ty1)n+=(tx1-tx0+1)*(ty1-ty0+1);
    }
    return n;
  }
  function thumbLevel(files,v,small=lite()){
    const lv=pickLevel(files[0],v.side);if(!small)return lv;
    const lo=pickLevel(files[0],v.side,80),L=files[0].levels;
    return lo>lv&&tileCount(files,v,L[lo].res)<tileCount(files,v,L[lv].res)?lo:lv;
  }

  // ---------- which files each survey holds (imagery-coverage.json, FE-18) ----------
  // Built from each survey's STAC collection in the archive (pipeline/tool/build_imagery_coverage.py): the timeline
  // and the larger view ask only for files that exist, so a survey without a file at the tree is "not covering" with
  // no request and no 404. A survey missing from the index, or no index, is probed as before.
  let coverageRead=null;
  function coverageIndex(){
    if(!coverageRead){
      const url=root.ALTOVersion?.asset?.('./imagery-coverage.json')||'./imagery-coverage.json';
      coverageRead=typeof fetch==='function'?fetch(url).then(r=>r.ok?r.json():null).catch(()=>null):Promise.resolve(null);
    }
    return coverageRead;
  }
  const sheetBits=new Map();
  // true: the survey holds the file; false: it does not; null: not known (probe it).
  function holds(index,survey,name){
    const s=index?.surveys?.[survey.id],g=index?.grid?.[String(survey.scale)];
    const m=/^([A-Z]{2}\d{2})_(\d+)_(\d+)$/.exec(name||'');
    if(!s||!g||s.scale!==survey.scale||!m)return null;
    const b64=s.sheets[m[1]];if(!b64)return false;
    const k=`${survey.id}|${m[1]}`;
    if(!sheetBits.has(k))sheetBits.set(k,Uint8Array.from(atob(b64),c=>c.charCodeAt(0)));
    const d=survey.scale===500?3:2,row=Number(m[3].slice(0,d)),col=Number(m[3].slice(d)),i=(row-1)*g[0]+(col-1);
    return !!(sheetBits.get(k)[i>>3]&(1<<(i&7)));
  }
  // Each survey's capture area (LINZ's capture-area.geojson, grown by 20 m and simplified, so it contains LINZ's
  // outline): bbox and rings of NZTM metres, stored as x0, y0, dx1, dy1, ... and decoded once.
  const footprints=new WeakMap();
  function footprintOf(index,survey){
    const f=index?.surveys?.[survey.id]?.footprint;
    if(!f||!Array.isArray(f.rings)||!f.rings.length||!Array.isArray(f.bbox))return null;
    if(!footprints.has(f))footprints.set(f,f.rings.map(r=>{const out=[];let x=0,y=0;for(let i=0;i+1<r.length;i+=2){x+=r[i];y+=r[i+1];out.push([x,y]);}return out;}));
    return {bbox:f.bbox,rings:footprints.get(f)};
  }
  // true: the point (NZTM) is inside the survey's capture area; false: outside; null: not known.
  function inFootprint(index,survey,[x,y]){
    const f=footprintOf(index,survey);if(!f)return null;
    const [x0,y0,x1,y1]=f.bbox;if(x<x0||x>x1||y<y0||y>y1)return false;
    let inside=false;
    for(const r of f.rings)for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}
    return inside;
  }
  // Whether a survey covers the tree, from the index alone: false (its capture area, or the files it holds, leave the
  // tree out: nothing is requested), true (both hold it), null (not known: read it and see).
  function covers(index,survey,v){
    const fp=inFootprint(index,survey,v.tree);if(fp===false)return false;
    const h=holds(index,survey,tileName(v.tree[0],v.tree[1],survey.scale));if(h===false)return false;
    return fp===true&&h===true?true:null;
  }
  // The scanned historical surveys in the index, oldest first, as surveys this module reads: label (the years of
  // LINZ's title), survey number, black and white or colour, pixel size, sheet scale, flying period, licensors and
  // producers. Entries without a path or a known sheet grid are left out.
  function historic(index){
    return (Array.isArray(index?.historic)?index.historic:[]).filter(h=>h&&h.id&&/^[\w./-]+\/rgb\/2193$/.test(h.path||'')&&GRID[h.scale]&&h.start&&h.end).map(h=>({
      id:h.id,label:String(h.label||h.start.slice(0,4)),kind:'Scanned',scanned:true,colour:!!h.colour,number:String(h.number||''),title:h.title||'',
      gsd:Number(h.gsd),scale:h.scale,start:h.start,end:h.end,licensors:Array.isArray(h.licensors)?h.licensors:[],producers:Array.isArray(h.producers)?h.producers:[],
      path:h.path,collection:`${BUCKET}/${h.path}/collection.json`}));
  }
  // What a survey's photographs are: "Urban survey" (since 2010), "Scanned black-and-white photograph" (historical).
  const kindText=s=>s.scanned?`Scanned ${s.colour?'colour':'black-and-white'} photograph`:`${s.kind} survey`;
  // Labels for a set of surveys shown together (the larger view's year strip): a scanned survey whose label another
  // shown survey shares also names its survey number ("2000 SN9907C").
  function stripLabels(surveys){
    const n=new Map();for(const s of surveys)n.set(s.label,(n.get(s.label)||0)+1);
    return new Map(surveys.map(s=>[s.id,n.get(s.label)>1&&s.scanned&&s.number?`${s.label} ${s.number}`:s.label]));
  }

  const results=new Map();
  // One survey at one window: {status: 'ready' | 'none' | 'error', canvas, res, coverage, files}.
  function read(survey,v,{makeCanvas=null}={}){
    const key=`${survey.id}|${v.x0.toFixed(1)}|${v.y0.toFixed(1)}|${v.side.toFixed(1)}`;
    if(!results.has(key))results.set(key,readNow(survey,v,makeCanvas).catch(e=>{results.delete(key);return {status:'error',survey,error:String(e?.message||e),blocked:e instanceof TypeError};}));
    return results.get(key);
  }
  async function readNow(survey,v,makeCanvas){
    const index=await coverageIndex();
    if(inFootprint(index,survey,v.tree)===false)return {status:'none',survey,reason:'footprint',files:[]};
    const names=tileNames(v,survey.scale),held=names.filter(n=>holds(index,survey,n)!==false);
    if(!held.length)return {status:'none',survey,reason:'no_file',files:names};
    const files=(await Promise.all(held.map(n=>open(`${BUCKET}/${survey.path}/${n}.tiff`).catch(e=>{if(e instanceof HttpError&&(e.status===404||e.status===403))return null;throw e;})))).filter(Boolean);
    if(!files.length)return {status:'none',survey,reason:'no_file',files:names};
    // A scanned survey's film grain makes its tiles the heaviest: it takes the coarser overview whenever that reads
    // fewer tiles, on every screen (FE-18's phone rule).
    const lv=thumbLevel(files,v,survey.scanned||lite()),res=files[0].levels[lv].res,size=Math.max(1,Math.round(v.side/res));
    const canvas=(makeCanvas||(n=>{const c=document.createElement('canvas');c.width=c.height=n;return c;}))(size),ctx=canvas.getContext('2d');
    for(const c of files){
      const L=c.levels.find(l=>Math.abs(l.res-res)<1e-9);if(!L)continue;
      const px0=(v.x0-c.originX)/res,px1=(v.x1-c.originX)/res,py0=(c.originY-v.y1)/res,py1=(c.originY-v.y0)/res;
      const tx0=Math.max(0,Math.floor(px0/L.tw)),tx1=Math.min(L.across-1,Math.floor((px1-1e-9)/L.tw));
      const ty0=Math.max(0,Math.floor(py0/L.th)),ty1=Math.min(L.down-1,Math.floor((py1-1e-9)/L.th));
      if(tx0>tx1||ty0>ty1)continue;
      const idx=[];for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++)idx.push({tx,ty,i:ty*L.across+tx});
      const [offs,cnts]=await Promise.all([c.entries(L.offsets,idx.map(t=>t.i)),c.entries(L.counts,idx.map(t=>t.i))]);
      const parts=idx.map((t,k)=>({...t,off:offs[k],len:cnts[k]})).filter(p=>p.len>0&&p.off>0);
      await fetchTiles(c.url,parts);
      const imgs=await Promise.all(parts.map(p=>decode(p.bytes,c)));
      // Only this file's own extent (edge tiles are padded beyond it).
      ctx.save();ctx.beginPath();ctx.rect(-px0,-py0,L.width,L.height);ctx.clip();
      imgs.forEach((im,k)=>{ctx.drawImage(im,parts[k].tx*L.tw-px0,parts[k].ty*L.th-py0);im.close?.();});
      ctx.restore();
    }
    const coverage=coverageOf(ctx,size,v);
    if(!coverage.atTree)return {status:'none',survey,reason:'outside',coverage,files:names};
    return {status:'ready',survey,canvas,res,coverage,level:lv,files:files.map(f=>f.url)};
  }
  // Alpha at the tree and the share of the window with pixels (a 24 × 24 sample).
  function coverageOf(ctx,size,v){
    const d=ctx.getImageData(0,0,size,size).data,at=(x,y)=>d[(Math.min(size-1,Math.max(0,Math.round(y)))*size+Math.min(size-1,Math.max(0,Math.round(x))))*4+3];
    const tx=(v.tree[0]-v.x0)/v.side*size,ty=(v.y1-v.tree[1])/v.side*size;
    let n=0,k=0;for(let i=0;i<24;i++)for(let j=0;j<24;j++){n++;if(at((i+.5)/24*size,(j+.5)/24*size)>0)k++;}
    return {atTree:at(tx,ty)>0,share:k/n};
  }

  // ---------- the timeline ----------
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const day=(iso,o={day:'numeric',month:'short',year:'numeric'})=>new Date(iso+'T12:00:00Z').toLocaleDateString('en-NZ',{...o,timeZone:'UTC'});
  // "6 Sept 2011", "22–24 Aug 2023", "15 Mar – 6 May 2017", "1 Feb 2024 – 6 Mar 2025".
  function period(s){
    if(s.start===s.end)return day(s.start);
    const [y0,m0]=s.start.split('-'),[y1,m1]=s.end.split('-');
    if(y0===y1&&m0===m1)return `${Number(s.start.slice(8))}–${day(s.end)}`;
    if(y0===y1)return `${day(s.start,{day:'numeric',month:'short'})} – ${day(s.end)}`;
    return `${day(s.start)} – ${day(s.end)}`;
  }
  const cm=m=>`${+(m*100).toFixed(1)} cm`;
  const names=list=>{const a=[...new Set(list)];return a.length<2?a.join(''):`${a.slice(0,-1).join(', ')} and ${a[a.length-1]}`;};
  // one: a single photograph (the larger view), "Aerial photograph: Auckland Council (licensor), ...". The scanned
  // surveys name their survey numbers, licensors and producers as LINZ lists them.
  function attribution(surveys,{one=false}={}){
    const short=(list,key)=>[...new Set(list.flatMap(s=>(s[key]||[]).map(x=>SHORT[x]||x)))];
    const modern=surveys.filter(s=>!s.scanned),scanned=surveys.filter(s=>s.scanned),parts=[];
    if(modern.length){const L=short(modern,'licensors');parts.push(`Aerial photograph${one?'':'s'}: ${esc(names(L))} (licensor${one&&L.length<2?'':'s'}), flown by ${esc(names(short(modern,'producers')))}`);}
    if(scanned.length){const L=short(scanned,'licensors'),P=short(scanned,'producers'),N=[...new Set(scanned.map(s=>s.number))];
      parts.push(`${parts.length?'s':'S'}canned aerial photograph${one?'':'s'} (survey${N.length>1?'s':''} ${esc(names(N))}): ${esc(names(L))} (licensor${L.length<2?'':'s'}), ${esc(names(P))} (producer${P.length<2?'':'s'})`);}
    return `${parts.join('; ')}; from the open imagery archive of ${esc(HOST)} (LINZ), licensed under <a href="${LICENCE.href}" target="_blank" rel="noopener">${LICENCE.name}</a>. ${accessed()}`;
  }
  // LINZ's wording for the archive: when and where the imagery was accessed (this page reads it as it opens), and
  // what ALTO changed (CC BY 4.0 asks re-users to say so).
  function accessed(when=new Date()){
    const day=when.toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric'});
    return `New Zealand Imagery accessed on ${esc(day)} from <a href="https://registry.opendata.aws/nz-imagery/" target="_blank" rel="noopener">registry.opendata.aws/nz-imagery</a>. Cropped and resampled by ALTO, which draws the 2024 crown outline or the recorded position on it.`;
  }
  // Colours come from the design tokens (tokens.css): the crown outline is --viz-overlay-focus, as in the crown
  // figure and the page's map, on the --viz-overlay-halo halo; the scale bar is --neutral-0.
  const token=name=>{try{return getComputedStyle(document.documentElement).getPropertyValue(name).trim()||null;}catch{return null;}};
  // Draw one photograph with the 2024 outline (or the recorded position) and a scale bar.
  function draw(target,r,v,{geometry=null,colours={}}={}){
    const S=target.width,ctx=target.getContext('2d'),k=S/v.side;
    ctx.clearRect(0,0,S,S);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(r.canvas,0,0,S,S);
    const px=([lon,lat])=>{const [x,y]=nztm(lon,lat);return [(x-v.x0)*k,(v.y1-y)*k];};
    const line=colours.focus||token('--viz-overlay-focus')||'yellow',halo=colours.halo||token('--viz-overlay-halo')||'black',white=token('--neutral-0')||'white';
    const rings=geometry?(geometry.type==='Polygon'?geometry.coordinates:geometry.type==='MultiPolygon'?geometry.coordinates.flat():[]):[];
    if(rings.length){
      ctx.lineJoin='round';
      for(const [w,c] of [[S/100*1.1,halo],[S/100*.55,line]]){ctx.lineWidth=w;ctx.strokeStyle=c;
        for(const ring of rings){ctx.beginPath();ring.forEach((p,i)=>{const [x,y]=px(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.stroke();}}
    }else{
      const [x,y]=[(v.tree[0]-v.x0)*k,(v.y1-v.tree[1])*k],rr=S/28;
      for(const [w,c] of [[S/100*1.1,halo],[S/100*.55,line]]){ctx.lineWidth=w;ctx.strokeStyle=c;ctx.beginPath();ctx.arc(x,y,rr,0,Math.PI*2);ctx.stroke();}
    }
    // Scale bar: 5, 10 or 20 m, about a quarter of the width.
    const m=[5,10,20].reduce((b,x)=>Math.abs(x-v.side/4)<Math.abs(b-v.side/4)?x:b,10),x0=S*.05,y0=S*.93,len=m*k;
    ctx.lineCap='butt';
    for(const [w,c] of [[S/100*1.3,halo],[S/100*.5,white]]){ctx.lineWidth=w;ctx.strokeStyle=c;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x0+len,y0);ctx.stroke();}
    ctx.font=`600 ${Math.round(S/17)}px system-ui, sans-serif`;ctx.textBaseline='bottom';ctx.lineWidth=S/80;ctx.strokeStyle=halo;ctx.fillStyle=white;
    ctx.strokeText(`${m} m`,x0,y0-S*.02);ctx.fillText(`${m} m`,x0,y0-S*.02);
  }
  // A timeline in a container: one card per survey covering the tree, oldest first. The scanned historical surveys
  // that cover it (the coverage index: capture area and files) come first, under "Historic surveys (scanned)", a
  // disclosure open on a desktop and closed on a phone; then the surveys since 2010. Read lazily: when the container
  // comes near the viewport, the surveys since 2010 four at a time, newest first; the scanned surveys two at a time,
  // newest first, once those are read and only while their group is open. A survey number LINZ publishes twice
  // (two pixel sizes) is read once, at the finer size. options: {lon, lat, area, geometry: () => GeoJSON | null,
  // colours, historic (false: the surveys since 2010 only), eager, marks, viewer, onDone(summary)}. Returns the handle
  // below; redraw() draws the outline again once the page knows it.
  // Each photograph is a button that opens the larger view (tree-imagery-viewer.js, opt.viewer or
  // window.ALTOImageryViewer) on that survey; the handle gives the viewer the surveys read, their order and the frame.
  const EXPAND='<span class="ti-ix-zoom" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg></span>';
  const PHONE='(max-width: 759px)';
  // The positions caveat for the scanned surveys, said once (under their group heading).
  const SCANNED_NOTE='Scanned from film and orthorectified to a lower positional standard than the surveys since 2010: features can be several metres from their true position, and the 2024 outline may sit beside the crown.';
  function cardHtml(s,shown=false){
    const alt=s.scanned?`${s.label} ${kindText(s).toLowerCase()} of this crown, survey ${s.number}`:`${s.label} aerial photograph (${s.kind.toLowerCase()} survey) of this crown`;
    const lines=s.scanned?`<small>${esc(kindText(s))}</small><small>${esc(s.number)} · ${esc(cm(s.gsd))} pixels</small>`:`<small>${esc(s.kind)} survey · ${esc(cm(s.gsd))}</small>`;
    return `<li class="ti-ix-card" data-survey="${esc(s.id)}" data-state="waiting"${shown?'':' hidden'}>
        <figure><div class="ti-ix-img"><button type="button" class="ti-ix-open" aria-haspopup="dialog"><canvas width="400" height="400" role="img" aria-label="${esc(alt)}"></canvas><span class="sr-only">. Open the larger view</span>${EXPAND}</button></div>
        <figcaption><b>${esc(s.label)}</b><span>${esc(period(s))}</span>${lines}</figcaption></figure></li>`;
  }
  // "14 surveys, 1940–2004": the scanned surveys listed at the tree (one per survey number).
  const span=list=>{if(!list.length)return '';const a=list.map(s=>s.start.slice(0,4)).sort()[0],b=list.map(s=>s.end.slice(0,4)).sort().pop();
    return `${list.length} survey${list.length>1?'s':''}, ${a===b?a:`${a}–${b}`}`;};
  function timeline(el,opt){
    const modern=SURVEYS.slice(),state=new Map(),subs=new Set(),queued=new Set(),withHistoric=opt.historic!==false;
    let list=modern.slice(),groups=[],v=null,index=null,started=false,blocked=false,histStarted=false,modernDone=null;
    el.innerHTML=`<p class="ti-status ti-ix-status" role="status">Aerial photographs are read from LINZ when this section comes into view.</p>
      <details class="ti-ix-group ti-ix-hist" hidden><summary><span class="ti-ix-gt">Historic surveys (scanned)</span> <span class="ti-ix-gn"></span></summary>
        <p class="ti-cap ti-ix-caveat">${esc(SCANNED_NOTE)}</p>
        <ol class="ti-ix ti-ix-scanned" aria-label="The crown in each scanned historical survey, oldest first"></ol></details>
      <p class="ti-ix-gt ti-ix-since" hidden>Surveys since 2010</p>
      <ol class="ti-ix" aria-label="The crown in each aerial survey since 2010, oldest first">${modern.map(s=>cardHtml(s)).join('')}</ol>
      <p class="ti-cap ti-ix-none" hidden></p><p class="ti-cap ti-ix-attr" hidden></p>`;
    el.querySelector('.ti-ix-status').insertAdjacentHTML('afterend','<p class="ti-ix-again" hidden><button type="button" class="btn btn-quiet">Read again</button></p>');
    const status=el.querySelector('.ti-ix-status'),noneEl=el.querySelector('.ti-ix-none'),attrEl=el.querySelector('.ti-ix-attr'),againEl=el.querySelector('.ti-ix-again');
    const hist=el.querySelector('.ti-ix-hist'),histList=el.querySelector('.ti-ix-scanned'),histCount=el.querySelector('.ti-ix-gn'),since=el.querySelector('.ti-ix-since');
    // Each card's picture markup, to put back when a failed survey is read again.
    const imgHtml=new Map();
    const keepPictures=()=>{for(const s of list)if(!imgHtml.has(s.id))imgHtml.set(s.id,el.querySelector(`[data-survey="${s.id}"] .ti-ix-img`)?.innerHTML||'');};
    keepPictures();
    const card=id=>el.querySelector(`[data-survey="${id}"]`);
    // The site's CSP blocking the archive is reported as a securitypolicyviolation event, after the fetch fails.
    const onViolation=e=>{if(String(e.blockedURI||'').startsWith(BUCKET)&&!blocked){blocked=true;if(started)summary();}};
    if(typeof document!=='undefined')document.addEventListener('securitypolicyviolation',onViolation);
    function paint(id){
      const r=state.get(id),c=card(id);if(!r||!c)return;
      c.dataset.state=r.status;
      if(r.status==='ready'){c.hidden=false;draw(c.querySelector('canvas'),r,v,{geometry:opt.geometry?.()||null,colours:opt.colours||{}});
        const s=r.survey,cv=c.querySelector('canvas'),part=r.coverage.share<.98?' Part of the window is outside this survey.':'',ol=opt.geometry?.()?', with the 2024 crown outline':'';
        cv.setAttribute('aria-label',s.scanned?`${s.label} ${kindText(s).toLowerCase()} of this crown, survey ${s.number} flown ${period(s)}, ${cm(s.gsd)} pixels shown at ${cm(r.res)}${ol}.${part}`
          :`${s.label} aerial photograph of this crown, ${s.kind.toLowerCase()} survey flown ${period(s)}, ${cm(s.gsd)} survey shown at ${cm(r.res)}${ol}.${part}`);
        if(part&&!c.querySelector('.ti-ix-part'))c.querySelector('figcaption').insertAdjacentHTML('beforeend','<small class="ti-ix-part">Partly outside this survey</small>');
        if(s.dateNote&&!c.querySelector('.ti-ix-note'))c.querySelector('figcaption').insertAdjacentHTML('beforeend',`<small class="ti-ix-note">${esc(s.dateNote)}</small>`);
      // A blocked request (the site's CSP, or no network) is said once, in the status line; other failures per card.
      }else if(r.status==='error'&&!r.blocked){c.hidden=false;c.querySelector('.ti-ix-img').innerHTML='<p class="ti-def">Could not be read.</p>';}
      else c.hidden=true;
    }
    function summary(){
      const done=[...state.values()],ready=done.filter(r=>r.status==='ready'),none=done.filter(r=>r.status==='none'),err=done.filter(r=>r.status==='error');
      const order=s=>list.indexOf(s);
      none.sort((a,b)=>order(a.survey)-order(b.survey));
      const sup=done.filter(r=>r.status==='superseded').sort((a,b)=>order(a.survey)-order(b.survey)),coarse=sup.filter(r=>!r.same),same=sup.filter(r=>r.same);
      const name=r=>r.survey.scanned?`${r.survey.label} ${r.survey.number} (${cm(r.survey.gsd)})`:`${r.survey.label} ${r.survey.kind.toLowerCase()} (${cm(r.survey.gsd)})`;
      noneEl.hidden=!none.length&&!sup.length;
      noneEl.textContent=[none.length?`Not covering this tree: ${none.map(name).join(', ')}.`:'',
        coarse.length?`Not read: ${coarse.map(name).join(', ')}; sharper photographs of the same years are shown.`:'',
        same.length?`Not read: ${same.map(r=>`${r.survey.number} at ${cm(r.survey.gsd)}`).join(', ')}; the same survey is shown at a finer pixel size.`:''].filter(Boolean).join(' ');
      attrEl.hidden=!ready.length;
      if(ready.length)attrEl.innerHTML=`${attribution(ready.map(r=>r.survey).sort((a,b)=>order(a)-order(b)))} <a href="${ARCHIVE}" target="_blank" rel="noopener">LINZ imagery archive</a>.`;
      // The scanned surveys listed at the tree, less any found not to cover it.
      if(groups.length)histCount.textContent=span(groups.map(g=>g.find(s=>state.get(s.id)?.status==='ready')||g[0]).filter(s=>state.get(s.id)?.status!=='none'));
      const total=queued.size,doneN=[...queued].filter(id=>state.has(id)).length,left=total-doneN,errAll=err.length&&err.length===done.filter(r=>r.status!=='superseded').length;
      if(left)status.textContent=`Reading aerial surveys from LINZ… ${doneN} of ${total}`;
      else if(blocked)status.textContent='The aerial photographs could not be read: this site does not yet allow requests to LINZ’s imagery archive (Content-Security-Policy connect-src).';
      else if(errAll&&err.every(r=>r.blocked))status.textContent='The aerial photographs could not be read: the requests to LINZ’s imagery archive were blocked or the network is unavailable.';
      else if(!ready.length)status.textContent=err.length?`No aerial survey could be read for this tree (${err.length} failed).`:groups.length&&!histStarted?'None of the aerial surveys since 2010 covers this tree.':'None of the aerial surveys covers this tree.';
      else status.textContent=err.length?`${ready.length} surveys cover this tree; ${err.length} could not be read.`:'';
      status.hidden=!status.textContent;
      // A failed read (the network, the archive) offers Read again; a site policy that blocks the archive does not.
      againEl.hidden=!(!left&&err.length&&!blocked);
      if(started&&!left&&el.dataset.state!=='done'){el.dataset.state='done';
        const ids=f=>done.filter(f).map(r=>r.survey.id);
        opt.onDone?.({ready:ids(r=>r.status==='ready'),none:ids(r=>r.status==='none'),superseded:ids(r=>r.status==='superseded'),error:ids(r=>r.status==='error'),blocked,
          historic:{listed:groups.length,read:histStarted,ready:ready.filter(r=>r.survey.scanned).length}});}
      subs.forEach(f=>{try{f();}catch(e){console.error(e);}});
    }
    // Surveys since 2010: sharp surveys first (newest first, four at a time); then each coarse survey (25 cm pixels or
    // more, whose full-resolution tiles are the heaviest to read) only where no sharp survey of the same years covers
    // the tree. Scanned surveys: newest first, two at a time.
    const run=async(queue,n)=>{const worker=async()=>{while(queue.length){const s=queue.shift();
      const by=!s.scanned&&s.gsd>=COARSE?sharperOf(s):null;
      queued.add(s.id);
      const r=by?{status:'superseded',survey:s,by:by.survey}:await read(s,v);
      state.set(s.id,r);paint(s.id);summary();}};
      await Promise.all(Array.from({length:n},worker));};
    const readSet=async surveys=>{const m=surveys.filter(s=>!s.scanned);
      await run(m.filter(s=>s.gsd<COARSE).reverse(),4);await run(m.filter(s=>s.gsd>=COARSE).reverse(),2);
      await run(surveys.filter(s=>s.scanned).reverse(),2);};
    // The scanned surveys that cover the tree, from the index (no request): one group per survey number, finest first.
    function listHistoric(){
      if(!withHistoric||!index)return;
      const covering=historic(index).filter(s=>covers(index,s,v)!==false),byNumber=new Map();
      for(const s of covering){const k=s.number||s.id;if(!byNumber.has(k))byNumber.set(k,[]);byNumber.get(k).push(s);}
      groups=[...byNumber.values()].map(g=>g.sort((a,b)=>a.gsd-b.gsd));
      if(!groups.length)return;
      const first=new Set(groups.map(g=>g[0].id));
      list=[...covering,...modern];
      histList.innerHTML=covering.map(s=>cardHtml(s,first.has(s.id))).join('');
      keepPictures();
      hist.hidden=false;since.hidden=false;
      // Open on a desktop; on a phone the group starts closed and is read when opened.
      hist.open=!root.matchMedia?.(PHONE)?.matches;
      hist.addEventListener('toggle',()=>{if(hist.open&&started)(modernDone||Promise.resolve()).then(readHistoric);});
      summary();
    }
    async function readHistoric(){
      if(histStarted||!groups.length)return;histStarted=true;
      const firsts=groups.map(g=>g[0]);
      for(const s of firsts){queued.add(s.id);const c=card(s.id);if(c)c.dataset.state='loading';}
      el.dataset.state='loading';summary();
      await readSet(firsts);
      // A survey number whose finest copy does not cover the tree after all: its next copy. Once one is shown, the
      // others are not read.
      for(const g of groups.filter(g=>g.length>1)){
        let shown=g.find(s=>state.get(s.id)?.status==='ready')||null;
        for(const s of g){
          if(state.has(s.id))continue;
          if(shown||state.get(g[0].id)?.status==='error'){state.set(s.id,{status:'superseded',survey:s,by:shown||g[0],same:true});paint(s.id);continue;}
          queued.add(s.id);el.dataset.state='loading';
          const r=await read(s,v);state.set(s.id,r);paint(s.id);if(r.status==='ready')shown=s;
        }
      }
      el.dataset.state='loading';summary();
    }
    async function start(){
      if(started)return;started=true;el.dataset.state='loading';
      v=view({lon:opt.lon,lat:opt.lat,area:opt.area,geometry:opt.geometry?.()||null});
      modern.forEach(s=>{queued.add(s.id);const c=card(s.id);if(c){c.dataset.state='loading';}});
      summary();
      if(withHistoric){index=await coverageIndex();listHistoric();}
      modernDone=readSet(modern);
      await modernDone;
      if(groups.length&&hist.open)await readHistoric();
    }
    // Read again: only the surveys that failed (failed reads are never cached), each card back to its picture.
    async function again(){
      const failed=list.filter(s=>state.get(s.id)?.status==='error');
      if(!failed.length)return;
      for(const s of failed){state.delete(s.id);const c=card(s.id);if(c){c.querySelector('.ti-ix-img').innerHTML=imgHtml.get(s.id)||'';c.hidden=!s.scanned;c.dataset.state='loading';}}
      el.dataset.state='loading';againEl.hidden=true;summary();status.tabIndex=-1;status.focus({preventScroll:true});
      await readSet(failed);
    }
    againEl.querySelector('button').addEventListener('click',()=>{again();});
    // A sharp survey since 2010 shown for this tree whose flying period overlaps the coarse one's, give or take a year.
    function sharperOf(s){
      const yr=d=>Number(d.slice(0,4))+(Number(d.slice(5,7))-1)/12,a=yr(s.start)-1,b=yr(s.end)+1;
      return [...state.values()].find(r=>r.status==='ready'&&!r.survey.scanned&&r.survey.gsd<COARSE&&yr(r.survey.end)>=a&&yr(r.survey.start)<=b)||null;
    }
    // A photograph opens the larger view on its survey.
    el.addEventListener('click',e=>{
      const b=e.target.closest?.('.ti-ix-open'),id=b?.closest('[data-survey]')?.dataset.survey,V=opt.viewer||root.ALTOImageryViewer;
      if(id&&V&&state.get(id)?.status==='ready')V.open(handle,id,{opener:b});
    });
    if(typeof IntersectionObserver!=='undefined'&&!opt.eager){
      const io=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){io.disconnect();start();}},{rootMargin:'600px 0px'});io.observe(el);
    }else start();
    // For the larger view: the surveys shown (read and covering the tree), oldest first; each one's survey and
    // reading; the frame; the outline; the surveys to mark (opt.marks: {before, after} survey ids, for a change on
    // the map); changes (another survey read, the outline arriving).
    const handle={start,again,redraw:()=>{for(const id of state.keys())paint(id);subs.forEach(f=>{try{f();}catch(e){console.error(e);}});},view:()=>v,
      order:()=>list.filter(s=>state.get(s.id)?.status==='ready').map(s=>s.id),survey:id=>list.find(s=>s.id===id)||null,
      result:id=>state.get(id)||null,geometry:()=>opt.geometry?.()||null,colours:()=>opt.colours||{},marks:()=>opt.marks||null,
      subscribe:f=>{subs.add(f);return ()=>subs.delete(f);}};
    return handle;
  }

  const api={SURVEYS,BUCKET,CATALOGUE,ARCHIVE,LICENCE,HOST,GRID,COARSE,SCANNED_NOTE,nztm,tileName,tileNames,tileNamesIn,parseTiff,valueAt,view,pickLevel,read,timeline,coverageIndex,holds,inFootprint,covers,historic,kindText,stripLabels,lite,thumbLevel,tileCount,attribution,accessed,period,cm,token,
    io:{open,range,decode,HttpError},_internal:{cog,NeedMore,coverageOf}};
  root.ALTOImagery=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
