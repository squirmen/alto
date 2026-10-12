// Offline checks for tree-imagery.js (aerial imagery through time from LINZ's open imagery archive): NZTM2000,
// LINZ tile names, the TIFF/BigTIFF header reader, the window and overview choice, and one survey read end to end
// through a stub fetch and canvas (the header, the internal tiles under the window, 404 = not covering the tree).
// Usage: node pipeline/tool/test_tree_imagery.cjs
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
const web=path.join(__dirname,'..','..','web')+'/';
const X=require(web+'tree-imagery.js');

// NZTM2000: corners of archive file AY30_1000_4447 as GDAL reports them (DMS to 0.01", about 0.3 m).
const dms=(d,m,s)=>d+m/60+s/3600;
for(const [lon,lat,e,n] of [[dms(174,26,52.35),-dms(36,15,10.07),1730080,5987040],[dms(174,27,12.01),-dms(36,15,33.20),1730560,5986320]]){
  const [x,y]=X.nztm(lon,lat);assert.ok(Math.abs(x-e)<0.35&&Math.abs(y-n)<0.35,`nztm ${x},${y} vs ${e},${n}`);
}
// Tile names: the archive's own files at 1:1000, 1:2000, 1:5000 and 1:10000 (top-left corners from GDAL).
for(const [e,n,scale,name] of [[1734880,5920080,1000,'BA31_1000_3707'],[1730080,5987040,1000,'AY30_1000_4447'],[1755040,5924400,2000,'BA31_2000_1625'],
  [1729600,5960400,5000,'AZ30_5000_0710'],[1784800,6032400,10000,'AX33_10000_0402']])assert.equal(X.tileName(e+0.5,n-0.5,scale),name);
// A window across a file edge needs both files; the surveys are in date order, each with its own LINZ collection.
assert.deepEqual(X.tileNames({x0:1734870,x1:1734900,y0:5920000,y1:5920030},1000),['BA31_1000_3706','BA31_1000_3707']);
assert.equal(X.SURVEYS.length,11);
// Surveys of 25 cm pixels or more are read only where no sharper survey of the same years covers the tree.
assert.equal(X.COARSE,0.25);
assert.deepEqual(X.SURVEYS.filter(s=>s.gsd>=X.COARSE).map(s=>s.label),['2010–12','2024']);
assert.ok(X.SURVEYS.every(s=>/^auckland\/[\w.-]+\/rgb\/2193$/.test(s.path)&&s.collection.endsWith('/collection.json')&&s.licensors.length&&s.start<=s.end&&X.GRID[s.scale]));
assert.deepEqual(X.SURVEYS.map(s=>s.label),['2010','2010–11','2010–12','2012','2015–16','2017','2020','2022','2023','2024','2024–25']);
assert.equal(X.period(X.SURVEYS.find(s=>s.id==='auckland_2024_0.075m')),'1 Feb 2024 – 6 Mar 2025');
assert.equal(X.period(X.SURVEYS.find(s=>s.id==='auckland-central_2023_0.06m')),'22–24 Aug 2023');
assert.equal(X.period(X.SURVEYS.find(s=>s.id==='auckland_2017_0.075m')),'15 Mar – 6 May 2017');
assert.ok(X.attribution(X.SURVEYS.slice(-2)).includes('NIWA')&&X.attribution(X.SURVEYS).includes('CC BY 4.0'));

// The window: the crown outline's box with a margin when known, else the crown area; 30 m at least, 90 m at most.
const v0=X.view({lon:174.7633,lat:-36.8485,area:50});
assert.equal(v0.side,30);
assert.equal(X.view({lon:174.7633,lat:-36.8485,area:20000}).side,90);
const ring=[[174.7632,-36.8486],[174.7634,-36.8486],[174.7634,-36.8484],[174.7632,-36.8484],[174.7632,-36.8486]];
const vg=X.view({lon:174.7633,lat:-36.8485,geometry:{type:'Polygon',coordinates:[ring]}});
assert.ok(vg.side>41&&vg.side<42.5,`outline window ${vg.side}: 1.5 × the 22 m box + 8 m`);

// A synthetic cloud-optimised GeoTIFF: 1024 px at 0.075 m in 512-px WebP tiles, one 512-px overview.
function tiff({big=false,le=true}={}){
  const ifds=[
    {254:[4,[0]],256:[4,[1024]],257:[4,[1024]],259:[3,[50001]],262:[3,[2]],277:[3,[4]],284:[3,[1]],322:[3,[512]],323:[3,[512]],324:[4,[0,0,0,0]],325:[4,[10,11,12,13]],
      33550:[12,[0.075,0.075,0]],33922:[12,[0,0,0,1756960,5920800,0]]},
    {254:[4,[1]],256:[4,[512]],257:[4,[512]],259:[3,[50001]],322:[3,[512]],323:[3,[512]],324:[4,[0]],325:[4,[20]]}];
  const SZ={3:2,4:4,12:8,16:8},entry=big?20:12,inline=big?8:4,head=big?16:8;
  const bytes=new Uint8Array(4096),dv=new DataView(bytes.buffer);
  const put=(o,t,x)=>{if(t===3)dv.setUint16(o,x,le);else if(t===4)dv.setUint32(o,x,le);else if(t===12)dv.setFloat64(o,x,le);else{dv.setUint32(o+(le?0:4),x,le);dv.setUint32(o+(le?4:0),0,le);}};
  const off=(o,x)=>big?put(o,16,x):put(o,4,x);
  bytes.set(le?[0x49,0x49]:[0x4d,0x4d],0);dv.setUint16(2,big?43:42,le);
  if(big){dv.setUint16(4,8,le);off(8,head);}else off(4,head);
  let at=head,data=1024,tiles=2048;const tileAt=[];
  ifds.forEach((ifd,k)=>{
    const tags=Object.keys(ifd).map(Number).sort((a,b)=>a-b);
    if(big)put(at,16,tags.length);else dv.setUint16(at,tags.length,le);
    let o=at+(big?8:2);
    for(const tag of tags){
      let [type,vals]=ifd[tag];
      if(tag===324)vals=vals.map((_,i)=>{const p=tiles;tiles+=ifd[325][1][i];tileAt.push({level:k,i,off:p,len:ifd[325][1][i]});return p;});
      dv.setUint16(o,tag,le);dv.setUint16(o+2,type,le);if(big)put(o+4,16,vals.length);else dv.setUint32(o+4,vals.length,le);
      const vo=o+(big?12:8),size=SZ[type]*vals.length;
      if(size<=inline)vals.forEach((x,i)=>put(vo+i*SZ[type],type,x));
      else{off(vo,data);vals.forEach((x,i)=>put(data+i*SZ[type],type,x));data+=size;}
      o+=entry;
    }
    const next=k<ifds.length-1?o+(big?8:4):0;off(o,next);at=next;
  });
  for(const t of tileAt)for(let j=0;j<t.len;j++)bytes[t.off+j]=t.level*16+t.i;
  return {bytes,tileAt};
}
for(const opt of [{},{big:true},{le:false}]){
  const {bytes}=tiff(opt),t=X.parseTiff(bytes.buffer);
  assert.equal(t.ifds.length,2,JSON.stringify(opt));
  const c=X._internal.cog('u',t);
  assert.deepEqual([c.originX,c.originY,c.res,c.compression],[1756960,5920800,0.075,50001]);
  assert.deepEqual(c.levels.map(l=>[l.res,l.across,l.down]),[[0.075,2,2],[0.15,1,1]]);
  assert.equal(X.pickLevel(c,30),1,'about 200 px across a 30 m window: the 15 cm overview');
  assert.equal(X.pickLevel(c,20),0,'a smaller window needs full resolution');
}
assert.throws(()=>X.parseTiff(tiff().bytes.buffer.slice(0,40)),e=>e instanceof X._internal.NeedMore);
assert.throws(()=>X.parseTiff(new ArrayBuffer(64)),/Not a TIFF/);

// One survey end to end: the header (one Range request), then only the overview tile under the window.
(async()=>{
  const {bytes,tileAt}=tiff(),reqs=[];
  const SURVEY={...X.SURVEYS[X.SURVEYS.length-1],id:'test',path:'test/rgb/2193'};
  globalThis.fetch=async(url,init)=>{
    const m=/bytes=(\d+)-(\d+)/.exec(init?.headers?.Range||'');reqs.push([String(url).split('/').pop(),m?+m[1]:null,m?+m[2]:null]);
    if(!String(url).endsWith('/BA32_1000_3603.tiff'))return {status:404,ok:false,arrayBuffer:async()=>new ArrayBuffer(0)};
    const a=+m[1],b=Math.min(+m[2],bytes.length-1);
    return {status:206,ok:true,arrayBuffer:async()=>bytes.slice(a,b+1).buffer};
  };
  const drawn=[];
  globalThis.createImageBitmap=async blob=>{const b=new Uint8Array(await blob.arrayBuffer());return {first:b[0],len:b.length,type:blob.type,close(){}};};
  const canvas=n=>({width:n,height:n,getContext:()=>({save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage:(im,x,y)=>drawn.push([im.first,im.len,im.type,x,y]),
    getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)})})});
  // A tree inside the synthetic file (origin E 1756960, N 5920800; 76.8 m square).
  const v={x0:1756980,x1:1757010,y0:5920750,y1:5920780,side:30,tree:[1756995,5920765]};
  const r=await X.read(SURVEY,v,{makeCanvas:canvas});
  assert.equal(r.status,'ready',JSON.stringify(r));
  assert.equal(r.res,0.15);
  assert.deepEqual(reqs[0],['BA32_1000_3603.tiff',0,16383],'one header request');
  const ov=tileAt.find(t=>t.level===1);
  assert.deepEqual(reqs.slice(1),[['BA32_1000_3603.tiff',ov.off,ov.off+ov.len-1]],'then only the overview tile under the window');
  assert.deepEqual(drawn,[[16,ov.len,'image/webp',-(v.x0-1756960)/0.15,-(5920800-v.y1)/0.15]]);
  // Cached: the same survey and window is not read twice.
  const n=reqs.length;await X.read(SURVEY,v,{makeCanvas:canvas});assert.equal(reqs.length,n);
  // A survey without a file at the tree: not covering it (404), never an error.
  const none=await X.read({...SURVEY,id:'none',path:'none/rgb/2193'},{...v,x0:1700000,x1:1700030,y0:5900000,y1:5900030,tree:[1700015,5900015]},{makeCanvas:canvas});
  assert.deepEqual([none.status,none.reason],['none','no_file']);
  // The page wiring: the imagery section, its script and the site requirement are in place.
  const page=fs.readFileSync(web+'tree-page.js','utf8'),html=fs.readFileSync(web+'tree.html','utf8'),mod=fs.readFileSync(web+'tree-imagery.js','utf8');
  assert.ok(page.includes("mod('imagery'")&&page.includes('X.timeline(el,'),'tree page: aerial imagery section');
  assert.ok(html.indexOf('tree-imagery.js')>0&&html.indexOf('tree-imagery.js')<html.indexOf('tree-page.js'),'tree.html loads tree-imagery.js before tree-page.js');
  assert.ok(/Content-Security-Policy must allow https:\/\/nz-imagery\.s3\.ap-southeast-2\.amazonaws\.com in connect-src/.test(mod.replace(/\s*\n\s*\*\s*/g,' ')),'the CSP requirement is stated');
  assert.ok(!fs.existsSync(web+'wayback.js'),'the Esri Wayback attempt is gone');
  console.log('tree-imagery checks passed (NZTM, LINZ tile names, TIFF/BigTIFF headers, windows, one survey read through Range requests)');
})().catch(e=>{console.error(e);process.exit(1);});
