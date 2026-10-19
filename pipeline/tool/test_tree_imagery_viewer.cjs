// Offline checks for tree-imagery-viewer.js (the larger view of "Aerial imagery through time"): the frame shared by
// every survey, the zoom maths, the scale bar, the order of the years, the overview and tiles read for a view, and
// the reading queue (one request for neighbouring tiles, at most MAX_ACTIVE at a time, stale requests cancelled),
// through a stub fetch. Usage: node pipeline/tool/test_tree_imagery_viewer.cjs
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
const web=path.join(__dirname,'..','..','web')+'/';
const X=require(web+'tree-imagery.js');
const V=require(web+'tree-imagery-viewer.js');
const near=(a,b,eps=1e-6,msg='')=>assert.ok(Math.abs(a-b)<=eps,`${msg} ${a} vs ${b}`);

// ---------- framing: one frame for every survey, centred on the section's window, widened 2, 4 or 8 times ----------
const v=X.view({lon:174.7633,lat:-36.8485,area:50}); // the section's window: 30 m at least
assert.deepEqual(V.FRAMES,[1,2,4,8]);
for(const k of V.FRAMES){
  const f=V.frame(v,k);
  near(f.cx,(v.x0+v.x1)/2,1e-9,'centre x');near(f.cy,(v.y0+v.y1)/2,1e-9,'centre y');
  near(f.side,v.side*k,1e-9,`side ×${k}`);near(f.x1-f.x0,f.side,1e-9);near(f.y1-f.y0,f.side,1e-9);
}
assert.equal(V.frame({...v,side:150},8).side,V.MAX_SIDE,'a widened frame is 800 m at most');
// Same window, same frame: the survey plays no part (the viewer frames every year alike).
assert.deepEqual(V.frame(v,2),V.frame({...v},2));

// ---------- zoom ----------
const f=V.frame(v,1),W=600,H=400,fitMpp=V.fitMpp(f,W,H);
near(fitMpp,30/400,1e-12,'the shorter side of the view spans the frame');
const b=V.bounds(f,W,H),s0=V.fit(f,W,H),r0=V.visibleRect(s0,W,H);
for(const k of ['x0','x1','y0','y1'])near(r0[k],b[k],1e-9,`at fit the view is what can be seen (${k})`);
assert.ok(!V.zoomedIn(s0,f,W,H));
// Zoom keeps the ground point under the pointer where it was.
const ground=(s,px,py)=>[s.cx+(px-W/2)*s.mpp,s.cy-(py-H/2)*s.mpp];
const s1=V.zoomAt(s0,2,W/2,H/2,f,W,H);near(s1.mpp,fitMpp/2,1e-12);assert.ok(V.zoomedIn(s1,f,W,H));
for(const [px,py,factor] of [[100,80,1.5],[520,300,2],[300,200,0.7],[10,390,1.1]]){
  const g0=ground(s1,px,py),s2=V.zoomAt(s1,factor,px,py,f,W,H),g1=ground(s2,px,py);
  near(g1[0],g0[0],1e-6,`ground x under (${px},${py}) ×${factor}`);near(g1[1],g0[1],1e-6,`ground y under (${px},${py}) ×${factor}`);
  const back=V.zoomAt(s2,1/factor,px,py,f,W,H);near(back.mpp,s1.mpp,1e-12);near(back.cx,s1.cx,1e-6);near(back.cy,s1.cy,1e-6);
}
// Limits: no further out than the whole frame (back at its centre), no closer than 1.25 cm per CSS pixel.
const out=V.zoomAt(s1,1e-6,30,30,f,W,H);near(out.mpp,fitMpp,1e-12);near(out.cx,f.cx,1e-9);near(out.cy,f.cy,1e-9);
near(V.zoomAt(s1,1e6,300,200,f,W,H).mpp,V.MIN_MPP,1e-12,'closest zoom');
// Panning stops at the edge of what can be seen; at fit it does nothing.
const far=V.panBy(s1,-1e6,1e6,f,W,H),rf=V.visibleRect(far,W,H);
near(rf.x1,b.x1,1e-6,'right edge');near(rf.y1,b.y1,1e-6,'top edge (dragging down shows what is north)');
assert.deepEqual(V.panBy(s0,120,-80,f,W,H),s0);
const p1=V.panBy(s1,40,-25,f,W,H);near(p1.cx,s1.cx-40*s1.mpp,1e-9);near(p1.cy,s1.cy-25*s1.mpp,1e-9);
// A taller-than-wide view (a phone): the narrower side spans the frame.
near(V.fitMpp(f,390,520),30/390,1e-12);

// ---------- the scale bar: right at every zoom ----------
for(let mpp=V.MIN_MPP;mpp<4;mpp*=1.07){
  for(const maxPx of [117,180]){
    const sb=V.scaleBar(mpp,maxPx);
    near(sb.px*mpp,sb.m,1e-9,'bar length × metres per pixel = the distance it names');
    assert.ok(sb.px<=maxPx+1e-9,`fits (${mpp})`);
    if(sb.m<500&&mpp*maxPx>0.1)assert.ok(sb.px>=maxPx/2.5-1e-9,`not too short (${mpp}, ${sb.px})`);
    assert.ok([0.1,0.2,0.5,1,2,5,10,20,50,100,200,500].includes(sb.m));
  }
}
assert.equal(V.scaleBar(0.005,100).label,'50 cm');
assert.equal(V.scaleBar(0.01,150).label,'1 m');
assert.equal(V.scaleBar(0.05,180).label,'5 m');
assert.equal(V.scaleBar(1,180).label,'100 m');
// The bar follows the zoom: twice as close, the same distance is twice as long (or the next round distance).
const z1=V.scaleBar(s1.mpp,180),z2=V.scaleBar(s1.mpp/2,180);assert.ok(z2.m<=z1.m);near(z2.px*s1.mpp/2,z2.m,1e-9);

// ---------- the order of the years ----------
const status={'auckland_2010_0.075m':'none','auckland_2010-2011_0.125m':'ready','auckland_2010-2012_0.5m':'superseded','auckland_2012_0.075m':'ready',
  'auckland_2015-2016_0.075m':'ready','auckland_2017_0.075m':'error','auckland_2020_0.075m':'loading','auckland_2022_0.075m':'none',
  'auckland-central_2023_0.06m':'ready','auckland_2024_0.25m':'superseded','auckland_2024_0.075m':'ready'};
const ids=V.order(X.SURVEYS,id=>status[id]);
assert.deepEqual(ids.map(id=>X.SURVEYS.find(s=>s.id===id).label),['2010–11','2012','2015–16','2023','2024–25'],'shown surveys only, oldest first');
assert.equal(V.step(ids,'auckland_2012_0.075m',1),'auckland_2015-2016_0.075m');
assert.equal(V.step(ids,'auckland_2012_0.075m',-1),'auckland_2010-2011_0.125m');
assert.equal(V.step(ids,ids[0],-1),null,'no year before the first');
assert.equal(V.step(ids,ids[ids.length-1],1),null,'no year after the last (no wrap)');
assert.equal(V.step(ids,'auckland_2017_0.075m',1),null,'a survey not shown has no neighbours');
// Stepping through every year from the first reaches the last in order.
const walk=[ids[0]];while(V.step(ids,walk[walk.length-1],1))walk.push(V.step(ids,walk[walk.length-1],1));
assert.deepEqual(walk,ids);

// ---------- what is read for a view ----------
const levels=[0.075,0.15,0.3,0.6].map(res=>({res}));
assert.equal(V.levelFor(levels,0.02),0,'a fine screen: the survey’s own resolution');
assert.equal(V.levelFor(levels,0.075/2*1.25),0);
assert.equal(V.levelFor(levels,0.13),1,'15 cm pixels for 13 cm screen pixels (25% slack)');
assert.equal(V.levelFor(levels,0.25),2);
assert.equal(V.levelFor(levels,10),3,'the coarsest overview at most');
// Tiles under a rectangle: a file at E 1756960, N 5920800, 0.075 m, 512-px tiles (38.4 m), 4 × 3 of them.
const cog={originX:1756960,originY:5920800,extent:{x0:1756960,x1:1756960+4*38.4,y0:5920800-3*38.4,y1:5920800}};
const L={res:0.075,tw:512,th:512,across:4,down:3};
const t1=V.tilesUnder(cog,L,{x0:1756990,x1:1757000,y0:5920750,y1:5920790});
assert.deepEqual(t1.map(t=>[t.tx,t.ty,t.i]),[[0,0,0],[1,0,1],[0,1,4],[1,1,5]]);
near(t1[3].x0,1756960+38.4,1e-9);near(t1[3].y1,5920800-38.4,1e-9);near(t1[0].w,38.4,1e-9);
assert.deepEqual(V.tilesUnder(cog,L,{x0:1756960+38.4,x1:1756960+76.8,y0:5920800-38.4,y1:5920800}).map(t=>t.i),[1],'edges: one tile, not its neighbours');
assert.equal(V.tilesUnder(cog,L,{x0:1700000,x1:1700010,y0:5900000,y1:5900010}).length,0,'outside the file');
assert.equal(V.tilesUnder(cog,L,{x0:1756900,x1:1758000,y0:5920000,y1:5921000}).length,12,'clipped to the file');
// Byte ranges: tiles within 8 KB of each other share a request, up to 2 MB.
const g=V.groupRanges([{off:100,len:50},{off:160,len:40},{off:20000,len:10},{off:150,len:10}]);
assert.deepEqual(g.map(x=>[x.start,x.end,x.items.length]),[[100,200,3],[20000,20010,1]]);
assert.equal(V.groupRanges([{off:0,len:1.5e6},{off:1.5e6,len:1e6}]).length,2,'a request is 2 MB at most');
// Files under a widened frame: every file it crosses, not only those at its corners.
const wide={x0:1734780,x1:1735500,y0:5919700,y1:5920100}; // 720 m across three 480 m files
const all=X.tileNamesIn(wide,1000),corners=X.tileNames(wide,1000);
assert.ok(all.length>corners.length&&corners.every(n=>all.includes(n)),`${all} / ${corners}`);
assert.equal(new Set(all).size,all.length);
assert.deepEqual(X.tileNamesIn({x0:1734870,x1:1734900,y0:5920000,y1:5920030},1000),X.tileNames({x0:1734870,x1:1734900,y0:5920000,y1:5920030},1000),'a small window: the same files');
// One photograph's attribution names its licensor (singular when there is one).
assert.ok(X.attribution([X.SURVEYS.find(s=>s.id==='auckland_2012_0.075m')],{one:true}).startsWith('Aerial photograph: Auckland Council (licensor), flown by New Zealand Aerial Mapping'));
assert.ok(X.attribution([X.SURVEYS.find(s=>s.id==='auckland_2017_0.075m')],{one:true}).includes('(licensors)'));
assert.ok(X.attribution(X.SURVEYS).startsWith('Aerial photographs: '),'the section’s attribution is unchanged');

// ---------- the reading queue, through a stub fetch ----------
(async()=>{
  // A synthetic cloud-optimised GeoTIFF (classic TIFF, little-endian): 1024 px at 0.075 m in 512-px tiles (2 × 2),
  // one 512-px overview; tile bytes stored one after another.
  const ifds=[
    {254:[4,[0]],256:[4,[1024]],257:[4,[1024]],259:[3,[50001]],262:[3,[2]],277:[3,[4]],284:[3,[1]],322:[3,[512]],323:[3,[512]],324:[4,[0,0,0,0]],325:[4,[10,11,12,13]],
      33550:[12,[0.075,0.075,0]],33922:[12,[0,0,0,1756960,5920800,0]]},
    {254:[4,[1]],256:[4,[512]],257:[4,[512]],259:[3,[50001]],322:[3,[512]],323:[3,[512]],324:[4,[0]],325:[4,[20]]}];
  const SZ={3:2,4:4,12:8},bytes=new Uint8Array(4096),dv=new DataView(bytes.buffer);
  const put=(o,t,x)=>{if(t===3)dv.setUint16(o,x,true);else if(t===4)dv.setUint32(o,x,true);else dv.setFloat64(o,x,true);};
  bytes.set([0x49,0x49],0);dv.setUint16(2,42,true);put(4,4,8);
  let at=8,data=1024,tilesAt=2048;const tileAt=[];
  ifds.forEach((ifd,k)=>{
    const tags=Object.keys(ifd).map(Number).sort((a,b)=>a-b);dv.setUint16(at,tags.length,true);let o=at+2;
    for(const tag of tags){
      let [type,vals]=ifd[tag];
      if(tag===324)vals=vals.map((_,i)=>{const q=tilesAt;tilesAt+=ifd[325][1][i];tileAt.push({level:k,i,off:q,len:ifd[325][1][i]});return q;});
      dv.setUint16(o,tag,true);dv.setUint16(o+2,type,true);dv.setUint32(o+4,vals.length,true);
      const size=SZ[type]*vals.length;
      if(size<=4)vals.forEach((x,i)=>put(o+8+i*SZ[type],type,x));else{put(o+8,4,data);vals.forEach((x,i)=>put(data+i*SZ[type],type,x));data+=size;}
      o+=12;
    }
    const next=k<ifds.length-1?o+4:0;put(o,4,next);at=next;
  });
  const reqs=[],held=[];let hold=false;
  globalThis.fetch=(url,init)=>new Promise((resolve,reject)=>{
    const m=/bytes=(\d+)-(\d+)/.exec(init?.headers?.Range||''),a=+m[1],e=Math.min(+m[2],bytes.length-1);
    const r={url:String(url).split('/').pop(),a,b:+m[2],aborted:false};reqs.push(r);
    const answer=()=>String(url).endsWith('/BA32_1000_3603.tiff')?resolve({status:206,ok:true,arrayBuffer:async()=>bytes.slice(a,e+1).buffer}):resolve({status:404,ok:false,arrayBuffer:async()=>new ArrayBuffer(0)});
    init?.signal?.addEventListener('abort',()=>{r.aborted=true;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});
    if(hold&&a>=2048)held.push(answer);else setTimeout(answer,1);
  });
  globalThis.createImageBitmap=async blob=>{const u=new Uint8Array(await blob.arrayBuffer());return {first:u[0],len:u.length,close(){this.closed=true;}};};
  const T=V._internal,survey={...X.SURVEYS.find(s=>s.id==='auckland_2024_0.075m'),id:'test',path:'test/rgb/2193'};
  const settle=()=>new Promise(r=>setTimeout(r,20));
  // The whole file at a fine screen: the four full-resolution tiles, nearest the centre first, one request for all.
  const rect={x0:1756960,x1:1757036.8,y0:5920723.2,y1:5920800},cx=1756998.4,cy=5920761.6;
  const plan=await T.planSurvey(survey,rect,0.03,0,cx,cy);
  assert.equal(plan.res,0.075);assert.equal(plan.files.length,1);assert.equal(plan.items.length,4);
  const before=reqs.length;
  T.want(plan.items);await settle();
  const tileReqs=reqs.slice(before);
  const full=tileAt.filter(t=>t.level===0);
  assert.deepEqual(tileReqs.map(r=>[r.a,r.b]),[[full[0].off,full[3].off+full[3].len-1]],'neighbouring tiles: one request');
  assert.ok(plan.items.every(i=>T.tiles.get(i.key).state==='ready'),'all four tiles decoded');
  assert.deepEqual(plan.items.map(i=>T.tiles.get(i.key).bmp.len).sort(),[10,11,12,13]);
  // Already read: wanting them again asks for nothing.
  const n=reqs.length;T.want(plan.items);await settle();assert.equal(reqs.length,n);
  // A wide view on a coarse screen: the overview, one tile.
  const coarse=await T.planSurvey(survey,rect,0.2,0,cx,cy);
  assert.equal(coarse.res,0.15);assert.equal(coarse.items.length,1);
  // Stale requests are cancelled: the overview is asked for, then the view changes to tiles already read before
  // its bytes arrive; its request holds no wanted tile, so it is aborted and the tile leaves the cache.
  hold=true;const m0=reqs.length;
  T.want(coarse.items);await settle();
  assert.equal(reqs.length,m0+1,'the overview requested');
  T.want(plan.items);await settle();
  assert.equal(reqs[m0].aborted,true,'the stale request was cancelled');
  assert.equal(T.tiles.has(coarse.items[0].key),false,'the cancelled tile can be asked for again');
  assert.equal(T.active.size,0);assert.equal(T.queue.size,0);
  // At most MAX_ACTIVE requests at a time: many separate tiles (not neighbours) wait their turn.
  const spread=Array.from({length:9},(_,i)=>({key:`k${i}`,url:'https://example.invalid/test/BA32_1000_3603.tiff',c:plan.files[0],off:2048+i*20000,len:8,prio:0,d:i}));
  T.want(spread);
  assert.equal(T.active.size,V.MAX_ACTIVE,`${T.active.size} requests at once`);
  assert.equal(T.queue.size,9-V.MAX_ACTIVE);
  hold=false;while(held.length)held.shift()();
  for(let i=0;i<40&&(T.active.size||T.queue.size);i++){await settle();while(held.length)held.shift()();}
  assert.equal(T.active.size+T.queue.size,0,'the queue drains');
  T.cancelAll();

  // The page wiring: the viewer script loads after tree-imagery.js and before tree-page.js; each photograph is a
  // button that opens it; the copy names the larger view.
  const html=fs.readFileSync(web+'tree.html','utf8'),mod=fs.readFileSync(web+'tree-imagery.js','utf8'),page=fs.readFileSync(web+'tree-page.js','utf8'),
    viewer=fs.readFileSync(web+'tree-imagery-viewer.js','utf8'),css=fs.readFileSync(web+'imagery-viewer.css','utf8');
  // The viewer's styles have a file of their own (the map loads it for a change's photos); on the tree page the viewer,
  // its stylesheet and the reader arrive after the hero (FE-03: tree-page.js later()), the viewer after the reader.
  assert.ok(!/imagery-viewer\.css\?v=/.test(html)&&page.includes("css.href=asset('./imagery-viewer.css')")&&!/\.ixv \{ box-sizing/.test(fs.readFileSync(web+'tree-instrument-page.css','utf8')),'tree-page.js links imagery-viewer.css; the rules left tree-instrument-page.css');
  assert.ok(!html.includes('<script src="./tree-imagery-viewer.js')&&page.includes("'./tree-imagery.js','./tree-imagery-viewer.js'")&&page.includes('s.async=false'),'tree-page.js loads the viewer after the reader, in order');
  assert.ok(mod.includes('class="ti-ix-open" aria-haspopup="dialog"')&&mod.includes('V.open(handle,id,{opener:b})'),'photographs open the viewer');
  assert.ok(page.includes('Select a photograph for a larger view'),'the section says how to open it');
  // Accessibility: a modal dialog named by its title, Esc closes (cancel), focus kept inside and returned, ARIA
  // labels on the image and every icon button, a live region for the year.
  for(const s of ["dlg.showModal()","aria-labelledby','ixv-title'","addEventListener('cancel'","o?.isConnected)o.focus()","function trap(e)",'role="img"','aria-live="polite"',
    'aria-label="Close"','aria-label="Zoom in"','aria-label="Zoom out"','aria-label="Whole frame"','aria-label="Frame width"',"case 'ArrowLeft'","case 'ArrowRight'","case 'Home'","case 'End'"])assert.ok(viewer.includes(s),s);
  // Phone: a full-screen sheet; the image does not scroll the page (touch-action none).
  assert.ok(/@media screen and \(max-width: 640px\) \{\s*\.ixv \{ width: 100vw; height: 100vh; height: 100dvh;/.test(css),'full-screen sheet on a phone');
  assert.ok(css.includes('.ixv-stage { position: relative; min-height: 0; overflow: hidden; background: var(--neutral-900); touch-action: none;'));
  // FE-18: the open survey is read for a view at once; the surveys either side only when the browser is idle (after the
  // open survey's tiles) or on intent; only files the survey holds are asked for; a failed read offers Read again.
  {const plan=viewer.slice(viewer.indexOf('async function planNow(){'),viewer.indexOf('function message('));
    assert.ok(plan.includes('p=await planSurvey(cur.tl.survey(id),rect,st.mpp/dpr,0,st.cx,st.cy)')&&!/ids\[i\+1\]|ids\[i-1\]/.test(plan.slice(0,plan.indexOf('neighboursWhenIdle(g);'))),'planNow reads the open survey only');
    assert.ok(plan.includes('root.requestIdleCallback(f,{timeout:5000})')&&plan.includes('if(queue.size||active.size)return void setTimeout(()=>neighboursWhenIdle(g),250);nextFor([1,-1]);'),'neighbours when idle, after the open survey');
    assert.ok(viewer.includes("b.addEventListener('pointerenter',()=>nextFor([d]));b.addEventListener('focus',()=>nextFor([d]));")&&viewer.includes("el.stage.addEventListener('touchstart',()=>nextFor([1,-1]),{passive:true});"),'or on intent');
    assert.ok(viewer.includes('.filter(n=>!X.holds||X.holds(index,s,n)!==false)'),'only files the survey holds');
    assert.ok(viewer.includes('<p class="ixv-again" hidden><button type="button" class="btn btn-quiet" data-act="again">Read again</button></p>')&&viewer.includes("else if(a==='again'){")&&plan.includes('el.again.hidden=false;'),'Read again after a failed read, outside the photograph');}
  console.log('tree-imagery-viewer checks passed (frame, zoom, scale bar, year order, overview and tiles, request queue and cancelling, wiring, neighbours on idle or intent)');
})().catch(e=>{console.error(e);process.exit(1);});
