/* The larger view of "Aerial imagery through time" on the tree page. Selecting a photograph opens its survey large
 * (a dialog on a desktop, a full-screen sheet on a phone), in one frame around the crown shared by every survey, so
 * the years can be flipped to see what changed.
 *
 * - Years: ← and → (Home and End for the first and last), the buttons either side of the year strip, the strip
 *   itself, and a swipe on a touch screen when not zoomed in. Oldest first; the surveys the section shows (read
 *   and covering the tree). The zoom and position stay when the year changes.
 * - Zoom: wheel or trackpad pinch, two-finger pinch, double-click or double-tap on a point (again at the closest
 *   zoom: back to the whole frame), + and − (buttons and keys), 0 or the frame button for the whole frame. Drag, or
 *   Shift + arrow keys, to move.
 * - Frame: the crown's frame (the section's) or 2, 4 or 8 times as wide, to see the trees around it.
 * - Outline: the 2024 crown outline, or the ring at the recorded position, drawn on by default; O hides it.
 *
 * Reading: the internal tiles of the open survey under the visible part of the view, from LINZ's archive through
 * tree-imagery.js (its cached file headers and Range reads), at the overview whose pixels match the screen's
 * device pixels (at most 2 per CSS pixel), down to the survey's own resolution (7.5 cm for most surveys), and no
 * more than MAX_TILES tiles per survey per view (a coarser overview when a wide frame needs more), and only the
 * files the survey holds (imagery-coverage.json). The previous and next surveys are read for the same view once the
 * open one is read and the browser is idle, or at once on intent (a pointer on, or focus to, the previous or next
 * control, or a touch on the photograph to swipe; FE-18). At most MAX_ACTIVE requests run at a time; when
 * the view changes, tiles no longer wanted leave the queue and their requests are cancelled. Decoded tiles are kept
 * for the visit; beyond KEEP the least recently used are released. While tiles arrive, coarser tiles and the
 * section's own photograph stand in.
 *
 * window.ALTOImageryViewer: open(timeline, surveyId, {opener}), close(), and the pure parts (Node tests): frame,
 * fitMpp, bounds, clampView, fit, zoomAt, panBy, visibleRect, zoomedIn, scaleBar, order, step, levelFor,
 * tilesUnder, groupRanges. Distances are NZTM2000 metres; mpp is metres per CSS pixel. */
(function(root){
  'use strict';
  const FRAMES=[1,2,4,8],MAX_SIDE=800,MIN_MPP=0.0125,SLACK=1.25,MAX_TILES=40,MAX_ACTIVE=4,GAP=8192,MAX_SPAN=2097152;
  // Decoded tiles kept (about 1 MB each): fewer on a phone.
  const KEEP=()=>((root.innerWidth||1200)<700?60:100);

  // ---------- framing, zoom and the scale bar ----------
  // The frame k times the crown's: the section's window (centred on the crown), k times as wide, at most 800 m.
  function frame(v,k=1){
    const cx=(v.x0+v.x1)/2,cy=(v.y0+v.y1)/2,side=Math.min(MAX_SIDE,v.side*k);
    return {cx,cy,side,k,x0:cx-side/2,x1:cx+side/2,y0:cy-side/2,y1:cy+side/2};
  }
  // The whole frame in a W × H view (CSS px): the view's shorter side spans the frame.
  const fitMpp=(f,W,H)=>f.side/Math.max(1,Math.min(W,H));
  const fit=(f,W,H)=>({cx:f.cx,cy:f.cy,mpp:fitMpp(f,W,H)});
  // What can be seen at all: the view at fit (the frame, and the photograph beyond it along the view's longer side).
  function bounds(f,W,H){const m=fitMpp(f,W,H);return {x0:f.cx-W*m/2,x1:f.cx+W*m/2,y0:f.cy-H*m/2,y1:f.cy+H*m/2,mpp:m};}
  // Zoom from the whole frame (fit) to 1.25 cm per CSS pixel (a 7.5 cm pixel 6 CSS pixels wide).
  const limits=(f,W,H)=>{const m=fitMpp(f,W,H);return {min:Math.min(MIN_MPP,m),max:m};};
  function clampView(s,f,W,H){
    const b=bounds(f,W,H),l=limits(f,W,H),mpp=Math.min(l.max,Math.max(l.min,s.mpp)),hw=W*mpp/2,hh=H*mpp/2;
    const c=(x,lo,hi,h,mid)=>hi-lo<=2*h+1e-9?mid:Math.min(hi-h,Math.max(lo+h,x));
    return {cx:c(s.cx,b.x0,b.x1,hw,f.cx),cy:c(s.cy,b.y0,b.y1,hh,f.cy),mpp};
  }
  // Zoom by factor (2 = twice as close) about the view point (px, py), which stays on the same ground point unless
  // the view meets the edge of what can be seen.
  function zoomAt(s,factor,px,py,f,W,H){
    const l=limits(f,W,H),mpp=Math.min(l.max,Math.max(l.min,s.mpp/factor));
    const wx=s.cx+(px-W/2)*s.mpp,wy=s.cy-(py-H/2)*s.mpp;
    return clampView({cx:wx-(px-W/2)*mpp,cy:wy+(py-H/2)*mpp,mpp},f,W,H);
  }
  // Move the picture by (dx, dy) CSS px, as a drag does.
  const panBy=(s,dx,dy,f,W,H)=>clampView({cx:s.cx-dx*s.mpp,cy:s.cy+dy*s.mpp,mpp:s.mpp},f,W,H);
  const visibleRect=(s,W,H)=>({x0:s.cx-W*s.mpp/2,x1:s.cx+W*s.mpp/2,y0:s.cy-H*s.mpp/2,y1:s.cy+H*s.mpp/2});
  const zoomedIn=(s,f,W,H)=>s.mpp<fitMpp(f,W,H)*0.999;
  // The scale bar: the longest round distance (10 cm to 500 m, steps of 1, 2, 5) that fits in maxPx; its length in
  // CSS px is that distance divided by the metres per pixel, at every zoom.
  const NICE=[0.1,0.2,0.5,1,2,5,10,20,50,100,200,500];
  function scaleBar(mpp,maxPx){
    let m=NICE[0];for(const x of NICE)if(x/mpp<=maxPx)m=x;
    return {m,px:m/mpp,label:m<1?`${Math.round(m*100)} cm`:`${m} m`};
  }

  // ---------- the order of the years ----------
  // The surveys to step through: those the section shows (status 'ready': read, covering the tree), oldest first
  // (the order of the survey list). Not-covering, superseded (coarser, same years) and failed surveys are left out.
  const order=(surveys,statusOf)=>surveys.filter(s=>statusOf(s.id)==='ready').map(s=>s.id);
  // The survey before (dir -1) or after (+1) id, or null at either end (the years do not wrap).
  function step(ids,id,dir){const i=ids.indexOf(id),j=i+Math.sign(dir);return i<0||j<0||j>=ids.length?null:ids[j];}

  // ---------- what to read ----------
  // The overview to read: the coarsest whose pixels are no larger than the screen's device pixels (25% slack);
  // the finest (the survey's own resolution) when the screen asks for more. levels: finest first.
  function levelFor(levels,devMpp){let best=0;for(let i=0;i<levels.length;i++)if(levels[i].res<=devMpp*SLACK)best=i;return best;}
  // The internal tiles of level L of file c under a rectangle: [{tx, ty, i, x0, y1, w, h}] (i: index in the file's
  // tile arrays; x0, y1: the tile's top-left corner; w, h: its size, in metres).
  function tilesUnder(c,L,r){
    const tw=L.tw*L.res,th=L.th*L.res,e=c.extent;
    const x0=Math.max(r.x0,e.x0),x1=Math.min(r.x1,e.x1),y0=Math.max(r.y0,e.y0),y1=Math.min(r.y1,e.y1);
    if(x0>=x1||y0>=y1)return [];
    // (1e-7 of a tile: a rectangle edge on a tile edge, give or take rounding, takes no tile beyond it.)
    const tx0=Math.max(0,Math.floor((x0-c.originX)/tw+1e-7)),tx1=Math.min(L.across-1,Math.floor((x1-c.originX)/tw-1e-7));
    const ty0=Math.max(0,Math.floor((c.originY-y1)/th+1e-7)),ty1=Math.min(L.down-1,Math.floor((c.originY-y0)/th-1e-7));
    const out=[];
    for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++)out.push({tx,ty,i:ty*L.across+tx,x0:c.originX+tx*tw,y1:c.originY-ty*th,w:tw,h:th});
    return out;
  }
  // Byte ranges for tiles of one file: tiles stored close together (within 8 KB) share one request, up to 2 MB.
  function groupRanges(parts,gap=GAP,max=MAX_SPAN){
    const groups=[];
    for(const p of [...parts].sort((a,b)=>a.off-b.off)){
      const g=groups[groups.length-1];
      if(g&&p.off-g.end<=gap&&Math.max(g.end,p.off+p.len)-g.start<=max){g.items.push(p);g.end=Math.max(g.end,p.off+p.len);}
      else groups.push({start:p.off,end:p.off+p.len,items:[p]});
    }
    return groups;
  }

  // ---------- tiles: kept for the visit, read through a bounded queue ----------
  const I=()=>root.ALTOImagery;
  const now=()=>(typeof performance!=='undefined'?performance.now():Date.now());
  const tiles=new Map(),queue=new Set(),active=new Set(),fileP=new Map(),indexes=new Map(),plans=new Map();
  let wanted=new Set(),onTile=null;
  const keyOf=(c,L,t)=>`${c.url}|${L.res}|${t.tx}|${t.ty}`;
  const levelAt=(c,res)=>c.levels.find(l=>Math.abs(l.res-res)<1e-9)||null;
  // A file's header (shared with the section's reads); a file the survey does not have (404) is null.
  function openFile(url){
    if(!fileP.has(url))fileP.set(url,I().io.open(url).catch(e=>{
      if(e instanceof I().io.HttpError&&(e.status===404||e.status===403))return null;
      fileP.delete(url);throw e;}));
    return fileP.get(url);
  }
  // A level's tile offsets and byte counts, read once (from the header, or one request beyond it).
  function indexOf(c,L){
    const k=`${c.url}|${L.res}`;
    if(!indexes.has(k)){
      const all=Array.from({length:L.across*L.down},(_,i)=>i);
      indexes.set(k,Promise.all([c.entries(L.offsets,all),c.entries(L.counts,all)]).then(([offs,cnts])=>({offs,cnts}),e=>{indexes.delete(k);throw e;}));
    }
    return indexes.get(k);
  }
  // One survey for one view: its files under the view, the overview to read and the tiles to read (prio 0 for the
  // open survey, 1 for its neighbours; d: distance from the view's centre, nearest first).
  async function planSurvey(s,rect,devMpp,prio,cx,cy){
    const X=I(),index=X.coverageIndex?await X.coverageIndex():null;
    const urls=X.tileNamesIn(rect,s.scale).filter(n=>!X.holds||X.holds(index,s,n)!==false).map(n=>`${X.BUCKET}/${s.path}/${n}.tiff`);
    const cs=(await Promise.all(urls.map(openFile))).filter(Boolean);
    if(!cs.length)return {files:[],res:null,items:[]};
    const lv=cs[0].levels,count=i=>cs.reduce((n,c)=>{const L=levelAt(c,lv[i].res);return n+(L?tilesUnder(c,L,rect).length:0);},0);
    let li=levelFor(lv,devMpp);
    while(li<lv.length-1&&count(li)>MAX_TILES)li++;
    const res=lv[li].res,items=[];
    for(const c of cs){
      const L=levelAt(c,res),ts=L?tilesUnder(c,L,rect):[];if(!ts.length)continue;
      const ix=await indexOf(c,L);
      for(const t of ts)items.push({key:keyOf(c,L,t),url:c.url,c,off:ix.offs[t.i],len:ix.cnts[t.i],prio,d:Math.hypot(t.x0+t.w/2-cx,t.y1-t.h/2-cy)});
    }
    return {files:cs,res,items};
  }
  // The tiles wanted now. replace: tiles not in the list leave the queue and requests holding only such tiles are
  // cancelled; otherwise the list is added.
  function want(items,{replace=true}={}){
    const t=now(),W=new Set(items.map(i=>i.key));
    if(replace){
      for(const k of [...queue])if(!W.has(k)){queue.delete(k);tiles.delete(k);}
      for(const j of active)if(![...j.keys].some(k=>W.has(k)))j.ctl.abort();
      wanted=W;
    }else for(const k of W)wanted.add(k);
    for(const it of items){
      const e=tiles.get(it.key);
      if(e?.state==='error'&&t-e.at>10000)tiles.delete(it.key);
      const f=tiles.get(it.key);
      if(!f){
        if(!(it.len>0&&it.off>0)){tiles.set(it.key,{state:'empty',used:t});continue;}
        tiles.set(it.key,{...it,state:'queued',used:t});queue.add(it.key);
      }else{f.used=t;if(f.state==='queued'){f.prio=it.prio;f.d=it.d;}}
    }
    pump();
  }
  function pump(){
    while(active.size<MAX_ACTIVE&&queue.size){
      const q=[...queue].map(k=>tiles.get(k)).sort((a,b)=>a.prio-b.prio||a.d-b.d),first=q[0];
      const g=groupRanges(q.filter(e=>e.url===first.url&&e.prio===first.prio)).find(x=>x.items.includes(first));
      const ctl=new AbortController(),job={ctl,keys:new Set(g.items.map(e=>e.key))};
      for(const e of g.items){queue.delete(e.key);e.state='loading';}
      active.add(job);
      I().io.range(first.url,g.start,g.end-1,ctl.signal).then(buf=>Promise.all(g.items.map(async e=>{
        try{
          const bmp=await I().io.decode(new Uint8Array(buf,e.off-g.start,e.len),e.c);
          if(tiles.get(e.key)===e){e.state='ready';e.bmp=bmp;e.used=now();}else bmp.close?.();
        }catch{if(tiles.get(e.key)===e){e.state='error';e.at=now();}}
      }))).catch(()=>{for(const e of g.items)if(tiles.get(e.key)===e){if(ctl.signal.aborted)tiles.delete(e.key);else{e.state='error';e.at=now();}}})
        .finally(()=>{active.delete(job);trim();onTile?.();pump();});
    }
  }
  // Release the least recently used tiles beyond KEEP (never one wanted now).
  function trim(){
    const keep=KEEP();if(tiles.size<=keep)return;
    const old=[...tiles].filter(([k,e])=>e.state!=='queued'&&e.state!=='loading'&&!wanted.has(k)).sort((a,b)=>a[1].used-b[1].used);
    for(const [k,e] of old.slice(0,tiles.size-keep)){e.bmp?.close?.();tiles.delete(k);}
  }
  function cancelAll(){for(const k of queue)tiles.delete(k);queue.clear();for(const j of active)j.ctl.abort();wanted=new Set();}

  // ---------- the dialog ----------
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const ico=(d,w=18)=>`<svg class="ico" viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON={prev:'M15 5l-7 7 7 7',next:'M9 5l7 7-7 7',plus:'M12 5v14M5 12h14',minus:'M5 12h14',fit:'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    close:'M6 6l12 12M18 6L6 18',on:'M4 4h16v16H4zM8 12l3 3 5-6',off:'M4 4h16v16H4z'};
  let dlg=null,el=null,cur=null,raf=0,planTimer=0,gen=0,unsub=null,size={W:1,H:1,dpr:1},outlinePref=true,wasZoomed=false,rings=null;
  const pts=new Map();let pinch=null,lastTap=null,lastType='mouse';

  function build(){
    dlg=document.createElement('dialog');
    dlg.className='ixv';dlg.setAttribute('aria-labelledby','ixv-title');dlg.setAttribute('aria-describedby','ixv-cap ixv-help');
    dlg.innerHTML=`<div class="ixv-head"><h2 class="ixv-title" id="ixv-title"></h2><p class="ixv-n"></p>
        <button type="button" class="btn btn-quiet ixv-ib" data-act="close" aria-label="Close">${ico(ICON.close)}</button></div>
      <div class="ixv-stage" tabindex="0" role="img"><canvas aria-hidden="true"></canvas><p class="ixv-load" aria-hidden="true" hidden>Reading from LINZ…</p><p class="ixv-msg" hidden></p></div>
      <p class="ixv-again" hidden><button type="button" class="btn btn-quiet" data-act="again">Read again</button></p>
      <div class="ixv-bar">
        <div class="ixv-years" role="group" aria-label="Survey year">
          <button type="button" class="btn ixv-ib" data-act="prev">${ico(ICON.prev)}</button>
          <div class="ixv-strip"></div>
          <button type="button" class="btn ixv-ib" data-act="next">${ico(ICON.next)}</button>
        </div>
        <div class="ixv-tools">
          <div class="ixv-seg" role="group" aria-label="Zoom">
            <button type="button" class="ti-yb" data-act="out" aria-label="Zoom out">${ico(ICON.minus,16)}</button>
            <button type="button" class="ti-yb" data-act="in" aria-label="Zoom in">${ico(ICON.plus,16)}</button>
            <button type="button" class="ti-yb" data-act="fit" aria-label="Whole frame">${ico(ICON.fit,16)}</button>
          </div>
          <div class="ixv-seg" role="group" aria-label="Frame width">${FRAMES.map(k=>`<button type="button" class="ti-yb" data-frame="${k}" aria-pressed="false" aria-label="${k===1?'Frame the crown':`Frame ${k} times the crown width`}">${k===1?'Crown':k===2?'2× wider':`${k}×`}</button>`).join('')}</div>
          <div class="ixv-seg"><button type="button" class="ti-yb ixv-ol" data-act="outline" aria-pressed="true"></button></div>
        </div>
      </div>
      <div class="ixv-cap" id="ixv-cap"><p class="ixv-what"></p><p class="ixv-attr"></p></div>
      <p class="ixv-help" id="ixv-help"><span class="ixv-help-k">← → year · scroll, double-click or + − to zoom · drag to move · O outline · Esc close</span><span class="ixv-help-t">Swipe for another year · pinch or double-tap to zoom · drag to move</span></p>
      <p class="sr-only" aria-live="polite"></p>`;
    document.body.appendChild(dlg);
    const q=s=>dlg.querySelector(s);
    el={title:q('.ixv-title'),n:q('.ixv-n'),stage:q('.ixv-stage'),canvas:q('canvas'),load:q('.ixv-load'),msg:q('.ixv-msg'),strip:q('.ixv-strip'),
      prev:q('[data-act="prev"]'),next:q('[data-act="next"]'),zin:q('[data-act="in"]'),zout:q('[data-act="out"]'),zfit:q('[data-act="fit"]'),
      ol:q('.ixv-ol'),what:q('.ixv-what'),attr:q('.ixv-attr'),live:q('[aria-live]'),again:q('.ixv-again')};
    // Intent: a pointer on, or focus to, the previous or next control reads that survey at once; a touch on the
    // photograph (a swipe may follow) reads both.
    for(const [b,d] of [[el.prev,-1],[el.next,1]]){b.addEventListener('pointerenter',()=>nextFor([d]));b.addEventListener('focus',()=>nextFor([d]));}
    el.stage.addEventListener('touchstart',()=>nextFor([1,-1]),{passive:true});
    dlg.addEventListener('click',onClick);
    el.strip.addEventListener('scroll',more,{passive:true});
    dlg.addEventListener('keydown',onKey);
    dlg.addEventListener('cancel',e=>{e.preventDefault();close();});
    dlg.addEventListener('close',cleanup);
    const st=el.stage;
    st.addEventListener('pointerdown',onDown);
    st.addEventListener('pointermove',onMove);
    st.addEventListener('pointerup',e=>onUp(e));
    st.addEventListener('pointercancel',e=>onUp(e,true));
    st.addEventListener('dblclick',e=>{if(lastType!=='mouse'||!cur)return;e.preventDefault();const [x,y]=local(e);dbl(x,y);});
    st.addEventListener('wheel',e=>{
      if(!cur)return;e.preventDefault();
      const [x,y]=local(e),k=e.deltaMode===1?16:e.deltaMode===2?size.H:1;
      // A mouse-wheel notch (100 px) is 1.25 times closer; a trackpad pinch (ctrlKey) follows the fingers.
      setView(zoomAt(cur.st,Math.exp(-e.deltaY*k*(e.ctrlKey?0.01:0.0022)),x,y,cur.f,size.W,size.H));
    },{passive:false});
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(cur)resize();}).observe(st);
    onTile=requestDraw;
  }

  function open(tl,id,{opener=null}={}){
    if(typeof document==='undefined'||!tl?.view())return;
    if(!dlg)build();
    unsub?.();
    cur={tl,id,k:1,f:frame(tl.view(),1),st:null,outline:outlinePref,opener:opener||document.activeElement};
    // Another survey read (or the outline arriving) while open: the strip, the controls and the neighbours to read.
    unsub=tl.subscribe(()=>{if(!cur)return;rings=null;cur.colours=colours();strip();controls();label();requestDraw();
      const key=tl.order().join(',');if(key!==cur.order){cur.order=key;clearTimeout(planTimer);planTimer=setTimeout(planNow,0);}});
    cur.order=tl.order().join(',');
    cur.colours=colours();rings=null;
    if(!dlg.open){dlg.showModal();document.documentElement.classList.add('ixv-lock');}
    resize();
    cur.st=fit(cur.f,size.W,size.H);
    show(id,{announce:false});
    el.stage.focus({preventScroll:true});
  }
  function close(){if(dlg?.open)dlg.close();}
  function cleanup(){
    document.documentElement.classList.remove('ixv-lock');
    clearTimeout(planTimer);gen++;cancelAll();unsub?.();unsub=null;pts.clear();pinch=null;
    const o=cur?.opener;cur=null;
    if(o?.isConnected)o.focus();
  }
  // Show one survey in the current view.
  function show(id,{announce=true}={}){
    const X=I(),s=cur.tl.survey(id);if(!s)return;
    cur.id=id;
    const kind=X.kindText?X.kindText(s):`${s.kind} survey`;
    el.title.innerHTML=`<b>${esc(s.label)}</b> <span>${esc(kind)}</span>`;
    strip();controls();caption();label();
    el.msg.hidden=true;
    if(announce)el.live.textContent=`${s.label}, ${kind.toLowerCase()}${s.scanned?`, survey ${s.number}`:''}, flown ${X.period(s)}.`;
    changed(true);
  }
  function go(dir){if(!cur)return;const n=step(cur.tl.order(),cur.id,dir);if(n)show(n);}
  function goEnd(last){if(!cur)return;const ids=cur.tl.order(),n=last?ids[ids.length-1]:ids[0];if(n&&n!==cur.id)show(n);}
  function setFrame(k){
    if(!cur||k===cur.k)return;
    cur.k=k;cur.f=frame(cur.tl.view(),k);cur.st=fit(cur.f,size.W,size.H);
    controls();caption();label();changed(true);
  }
  function setView(st){if(!cur)return;cur.st=st;changed();}
  function zoomBy(f){if(cur)setView(zoomAt(cur.st,f,size.W/2,size.H/2,cur.f,size.W,size.H));}
  function toggleOutline(){if(!cur)return;cur.outline=outlinePref=!cur.outline;controls();label();requestDraw();}
  // After any change of view: draw now, read once the view settles (at once for a new year or frame).
  function changed(settled=false){
    requestDraw();
    clearTimeout(planTimer);planTimer=setTimeout(planNow,settled?0:160);
    const z=zoomedIn(cur.st,cur.f,size.W,size.H);
    el.stage.classList.toggle('is-zoomed',z);
    zoomControls();
    if(z!==wasZoomed){wasZoomed=z;label();}
  }
  function resize(){
    const r=el.stage.getBoundingClientRect(),dpr=Math.min(2,root.devicePixelRatio||1),W=Math.max(1,r.width),H=Math.max(1,r.height);
    const whole=cur?.st?!zoomedIn(cur.st,cur.f,size.W,size.H):true;
    size={W,H,dpr};more();
    el.canvas.width=Math.round(W*dpr);el.canvas.height=Math.round(H*dpr);
    if(cur?.st){cur.st=whole?fit(cur.f,W,H):clampView(cur.st,cur.f,W,H);changed();}
  }

  // ---------- reading for the view ----------
  // The open survey for this view now; its neighbours when idle or on intent (nextFor).
  async function planNow(){
    if(!cur)return;
    const g=++gen,{W,H,dpr}=size,st=cur.st,rect=visibleRect(st,W,H),id=cur.id;
    for(const k of queue)tiles.get(k).prio=9;
    pending.clear();el.again.hidden=true;
    let p;
    try{p=await planSurvey(cur.tl.survey(id),rect,st.mpp/dpr,0,st.cx,st.cy);}
    catch(e){if(g===gen){message(e instanceof TypeError?'The photograph could not be read: the request to LINZ’s imagery archive was blocked or the network is unavailable.':'The photograph could not be read from LINZ.');el.again.hidden=false;}return;}
    if(g!==gen)return;
    plans.set(id,p);want(p.items);caption();requestDraw();
    if(!p.files.length)message('This survey has no photograph in this view.');
    neighboursWhenIdle(g);
  }
  // The previous and next surveys for the same view: once the open one's tiles are in and the browser is idle.
  const whenIdle=f=>root.requestIdleCallback?root.requestIdleCallback(f,{timeout:5000}):setTimeout(f,300);
  function neighboursWhenIdle(g){whenIdle(()=>{if(g!==gen||!cur)return;if(queue.size||active.size)return void setTimeout(()=>neighboursWhenIdle(g),250);nextFor([1,-1]);});}
  // Plan and queue the surveys either side (dir 1, -1) for the current view, behind the open survey's tiles.
  const pending=new Set();
  async function nextFor(dirs){
    if(!cur?.st)return;
    const g=gen,{W,H,dpr}=size,st=cur.st,rect=visibleRect(st,W,H),ids=cur.tl.order(),i=ids.indexOf(cur.id);
    for(const d of dirs){
      const id=ids[i+d],k=`${g}|${id}`;if(!id||pending.has(k))continue;
      pending.add(k);
      const p=await planSurvey(cur.tl.survey(id),rect,st.mpp/dpr,1,st.cx,st.cy).catch(()=>null);
      if(g!==gen||!cur||!p)continue;
      plans.set(id,p);want(p.items,{replace:false});
    }
  }
  function message(text){el.msg.textContent=text;el.msg.hidden=!text;}

  // ---------- drawing ----------
  function requestDraw(){if(!raf&&typeof requestAnimationFrame!=='undefined')raf=requestAnimationFrame(draw);}
  function colours(){
    const X=I(),c=cur.tl.colours();
    return {line:c.focus||X.token('--viz-overlay-focus')||'#ffe14d',halo:c.halo||X.token('--viz-overlay-halo')||'rgb(0 0 0 / 55%)',
      white:X.token('--neutral-0')||'#fff',font:X.token('--font-sans')||'system-ui, sans-serif'};
  }
  function ringsNow(){
    if(rings)return rings;
    const g=cur.tl.geometry(),X=I();
    const rs=g?(g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():[]):[];
    return (rings=rs.map(r=>r.map(([lon,lat])=>X.nztm(lon,lat))));
  }
  function draw(){
    raf=0;if(!cur||!dlg?.open)return;
    const {W,H,dpr}=size,st=cur.st,cv=el.canvas,ctx=cv.getContext('2d'),t=now(),v=cur.tl.view();
    const k=dpr/st.mpp,ox=W/2*dpr-st.cx*k,oy=H/2*dpr+st.cy*k,dx=x=>x*k+ox,dy=y=>oy-y*k;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);
    // The section's photograph first (it is there at once), then the tiles read, coarsest first.
    const r=cur.tl.result(cur.id);
    if(r?.canvas){ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(r.canvas,dx(v.x0),dy(v.y1),v.side*k,v.side*k);}
    const p=plans.get(cur.id),rect=visibleRect(st,W,H);
    if(p?.res)for(const c of p.files){
      const x0=Math.round(dx(c.extent.x0)),y0=Math.round(dy(c.extent.y1));
      ctx.save();ctx.beginPath();ctx.rect(x0,y0,Math.round(dx(c.extent.x1))-x0,Math.round(dy(c.extent.y0))-y0);ctx.clip();
      for(const L of c.levels.filter(l=>l.res>=p.res-1e-9).sort((a,b)=>b.res-a.res)){
        // Smoothed while a photograph pixel spans at most 4 device pixels; closer, the pixels are shown as they are.
        ctx.imageSmoothingEnabled=L.res*k<=4;ctx.imageSmoothingQuality='high';
        for(const tt of tilesUnder(c,L,rect)){
          const e=tiles.get(keyOf(c,L,tt));if(e?.state!=='ready')continue;e.used=t;
          const a=Math.round(dx(tt.x0)),b=Math.round(dy(tt.y1));
          ctx.drawImage(e.bmp,a,b,Math.round(dx(tt.x0+tt.w))-a,Math.round(dy(tt.y1-tt.h))-b);
        }
      }
      ctx.restore();
    }
    // The 2024 outline (or the ring at the recorded position), then the scale bar; colours from the design tokens.
    const {line,halo,white,font}=cur.colours;
    ctx.lineJoin='round';ctx.lineCap='round';
    if(cur.outline){
      const rs=ringsNow();
      for(const [w,c] of [[4.5*dpr,halo],[2*dpr,line]]){
        ctx.lineWidth=w;ctx.strokeStyle=c;
        if(rs.length)for(const ring of rs){ctx.beginPath();ring.forEach(([x,y],i)=>i?ctx.lineTo(dx(x),dy(y)):ctx.moveTo(dx(x),dy(y)));ctx.closePath();ctx.stroke();}
        else{ctx.beginPath();ctx.arc(dx(v.tree[0]),dy(v.tree[1]),Math.max(10*dpr,v.side/28*k),0,Math.PI*2);ctx.stroke();}
      }
    }
    const sb=scaleBar(st.mpp,Math.min(180,W*.3)),bx=16*dpr,by=(H-16)*dpr;
    ctx.lineCap='butt';
    for(const [w,c] of [[6*dpr,halo],[2.5*dpr,white]]){ctx.lineWidth=w;ctx.strokeStyle=c;ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx+sb.px*dpr,by);ctx.stroke();}
    ctx.font=`600 ${13*dpr}px ${font}`;ctx.textBaseline='bottom';ctx.lineJoin='round';
    ctx.lineWidth=3.5*dpr;ctx.strokeStyle=halo;ctx.fillStyle=white;ctx.strokeText(sb.label,bx,by-6*dpr);ctx.fillText(sb.label,bx,by-6*dpr);
    el.stage.dataset.scale=`${sb.m}|${sb.px.toFixed(2)}`;
    const busy=!p||p.items.some(it=>{const e=tiles.get(it.key);return e&&(e.state==='queued'||e.state==='loading');});
    el.load.hidden=!busy||!el.msg.hidden;
  }

  // ---------- the controls, caption and labels ----------
  function strip(){
    // A change on the map marks the surveys before and after it ("Before", "After": words, not colour). The scanned
    // surveys come first, after the word "Scanned"; a rule separates them from the surveys since 2010. A label two
    // scanned surveys share names each one's survey number.
    const X=I(),ids=cur.tl.order(),mk=cur.tl.marks?.()||{},side=id=>id===mk.before?'Before':id===mk.after?'After':'',key=`${ids.join(',')}|${mk.before||''}|${mk.after||''}`;
    if(el.strip.dataset.ids!==key){
      const had=el.strip.contains(document.activeElement)?document.activeElement.dataset.year:null,all=ids.map(id=>cur.tl.survey(id));
      const names=X.stripLabels?X.stripLabels(all):new Map(all.map(s=>[s.id,s.label])),scanned=all.some(s=>s.scanned),modern=all.some(s=>!s.scanned);
      el.strip.innerHTML=all.map((s,i)=>{const m=side(s.id),prev=all[i-1],kind=X.kindText?X.kindText(s):`${s.kind} survey`;
        const head=s.scanned&&!prev?.scanned?'<span class="ixv-gl" aria-hidden="true">Scanned</span>':!s.scanned&&prev?.scanned?'<span class="ixv-gsep" aria-hidden="true"></span>':'';
        return `${head}<button type="button" class="ti-yb" data-year="${esc(s.id)}" aria-pressed="false" aria-label="${esc(`${names.get(s.id)}, ${kind.toLowerCase()}${m?`, ${m.toLowerCase()} the change`:''}`)}"><b>${esc(names.get(s.id))}</b>${m?`<span class="ixv-mark">${m}</span>`:''}</button>`;}).join('');
      el.strip.dataset.groups=scanned&&modern?'both':scanned?'scanned':'modern';
      el.strip.dataset.ids=key;
      if(had)[...el.strip.querySelectorAll('[data-year]')].find(b=>b.dataset.year===had)?.focus();
    }
    let on=null;
    for(const b of el.strip.querySelectorAll('[data-year]')){const p=b.dataset.year===cur.id;b.setAttribute('aria-pressed',String(p));if(p)on=b;}
    // Keep the open year in sight inside the strip (without scrolling anything else).
    if(on){const sr=el.strip.getBoundingClientRect(),br=on.getBoundingClientRect();
      if(br.left<sr.left)el.strip.scrollLeft-=sr.left-br.left+8;else if(br.right>sr.right)el.strip.scrollLeft+=br.right-sr.right+8;}
    more();
  }
  // Which ends of the year strip have years scrolled out of sight ("start", "end"), for its fades.
  function more(){
    const st=el.strip,m=[];if(st.scrollLeft>1)m.push('start');if(st.scrollLeft+st.clientWidth<st.scrollWidth-1)m.push('end');
    const v=m.join(' ');if(st.dataset.more!==v)st.dataset.more=v;
  }
  const dis=(b,off)=>{b.setAttribute('aria-disabled',String(!!off));};
  function controls(){
    if(!cur)return;
    const ids=cur.tl.order(),i=ids.indexOf(cur.id),S=id=>cur.tl.survey(id)?.label,p=ids[i-1],n=ids[i+1];
    el.n.textContent=i>=0?`${i+1} of ${ids.length}`:'';
    dis(el.prev,!p);el.prev.setAttribute('aria-label',p?`Previous year: ${S(p)}`:'Previous year (this is the first)');
    dis(el.next,!n);el.next.setAttribute('aria-label',n?`Next year: ${S(n)}`:'Next year (this is the last)');
    zoomControls();
    const v=cur.tl.view();
    dlg.querySelectorAll('[data-frame]').forEach(b=>{const k=+b.dataset.frame;b.setAttribute('aria-pressed',String(k===cur.k));b.title=`${Math.round(frame(v,k).side)} m across`;});
    const geom=!!cur.tl.geometry(),olk=`${cur.outline}|${geom}`;
    // "2024 outline" ("Outline" on a phone), or "Ring" for a tree without an outline.
    if(el.ol.dataset.k!==olk){el.ol.dataset.k=olk;el.ol.innerHTML=`${ico(cur.outline?ICON.on:ICON.off,16)}${geom?'<span class="ixv-long">2024 outline</span><span class="ixv-short">Outline</span>':'<span>Ring</span>'}`;}
    el.ol.setAttribute('aria-pressed',String(cur.outline));
    el.ol.setAttribute('aria-label',geom?'Show the 2024 crown outline':'Show the ring at the recorded position');
  }
  function zoomControls(){
    const l=limits(cur.f,size.W,size.H);
    dis(el.zin,cur.st.mpp<=l.min*1.001);dis(el.zout,cur.st.mpp>=l.max*0.999);dis(el.zfit,!zoomedIn(cur.st,cur.f,size.W,size.H));
  }
  function caption(){
    const X=I(),s=cur.tl.survey(cur.id),p=plans.get(cur.id),shown=p?.res&&p.res>s.gsd*1.02?`, shown at ${X.cm(p.res)}`:'';
    const mk=cur.tl.marks?.()||{},m=cur.id===mk.before?'Before the change':cur.id===mk.after?'After the change':'';
    el.what.innerHTML=`<b>${esc(s.label)}</b>${m?` · ${m}`:''} · Flown ${esc(X.period(s))} · ${esc(s.title||`${s.kind} survey`)}${s.scanned?` · ${esc(X.kindText(s))}`:''} · ${esc(X.cm(s.gsd))} pixels${esc(shown)} · Frame ${Math.round(cur.f.side)} m across${s.dateNote?` · ${esc(s.dateNote)}`:''}`;
    el.attr.innerHTML=`${X.attribution([s],{one:true})} <a href="${X.ARCHIVE}" target="_blank" rel="noopener">LINZ imagery archive</a>.`;
  }
  function label(){
    if(!cur)return;
    const X=I(),s=cur.tl.survey(cur.id),geom=!!cur.tl.geometry();
    el.stage.setAttribute('aria-label',`${s.label} ${s.scanned?`${X.kindText(s).toLowerCase()}, survey ${s.number}`:`aerial photograph, ${s.kind.toLowerCase()} survey`} flown ${X.period(s)}, ${X.cm(s.gsd)} pixels, frame ${Math.round(cur.f.side)} m across${zoomedIn(cur.st,cur.f,size.W,size.H)?', zoomed in':''}${cur.outline?(geom?', with the 2024 crown outline':', with a ring at the recorded position'):''}.`);
  }

  // ---------- pointer, wheel and keys ----------
  function local(e){const r=el.stage.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];}
  function onClick(e){
    if(!cur)return;
    if(e.target===dlg){const r=dlg.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();return;}
    const b=e.target.closest('button');if(!b||b.getAttribute('aria-disabled')==='true')return;
    const a=b.dataset.act;
    if(a==='close')close();else if(a==='prev')go(-1);else if(a==='next')go(1);
    else if(a==='again'){for(const [k,t] of [...tiles])if(t.state==='error')tiles.delete(k);message('');planNow();el.stage.focus({preventScroll:true});}
    else if(a==='in')zoomBy(2);else if(a==='out')zoomBy(.5);else if(a==='fit')setView(fit(cur.f,size.W,size.H));
    else if(a==='outline')toggleOutline();
    else if(b.dataset.frame)setFrame(+b.dataset.frame);
    else if(b.dataset.year&&b.dataset.year!==cur.id)show(b.dataset.year);
  }
  function onKey(e){
    if(!cur)return;
    if(e.key==='Tab'){trap(e);return;}
    if(e.altKey||e.metaKey||e.ctrlKey)return;
    const {W,H}=size;
    if(e.shiftKey&&/^Arrow/.test(e.key)){
      const d=Math.min(W,H)/4,m={ArrowLeft:[d,0],ArrowRight:[-d,0],ArrowUp:[0,d],ArrowDown:[0,-d]}[e.key];
      setView(panBy(cur.st,m[0],m[1],cur.f,W,H));e.preventDefault();return;
    }
    switch(e.key){
      case 'ArrowLeft':go(-1);break;
      case 'ArrowRight':go(1);break;
      case 'Home':goEnd(false);break;
      case 'End':goEnd(true);break;
      case '+':case '=':zoomBy(2);break;
      case '-':case '_':zoomBy(.5);break;
      case '0':setView(fit(cur.f,W,H));break;
      case 'o':case 'O':toggleOutline();break;
      default:return;
    }
    e.preventDefault();
  }
  // Focus stays in the dialog: Tab from the last control goes to the first, Shift+Tab from the first to the last.
  function trap(e){
    const f=[...dlg.querySelectorAll('button,a[href],[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);
    if(!f.length)return;
    const a=f[0],z=f[f.length-1],act=document.activeElement;
    if(e.shiftKey&&(act===a||!dlg.contains(act))){z.focus();e.preventDefault();}
    else if(!e.shiftKey&&(act===z||!dlg.contains(act))){a.focus();e.preventDefault();}
  }
  function onDown(e){
    if(!cur)return;
    lastType=e.pointerType||'mouse';
    if(lastType==='mouse'&&e.button!==0)return;
    el.stage.setPointerCapture?.(e.pointerId);
    const [x,y]=local(e);pts.set(e.pointerId,{x,y,x0:x,y0:y,t0:now(),type:lastType,moved:false});
    if(pts.size===2){const [a,b]=[...pts.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,mx:(a.x+b.x)/2,my:(a.y+b.y)/2};lastTap=null;}
    if(pts.size===1&&zoomedIn(cur.st,cur.f,size.W,size.H))el.stage.classList.add('is-drag');
  }
  function onMove(e){
    const p=pts.get(e.pointerId);if(!p||!cur)return;
    const [x,y]=local(e),dx=x-p.x,dy=y-p.y;p.x=x;p.y=y;
    if(pts.size>=2&&pinch){
      const [a,b]=[...pts.values()],d=Math.hypot(a.x-b.x,a.y-b.y)||1,mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
      setView(panBy(zoomAt(cur.st,d/pinch.d,mx,my,cur.f,size.W,size.H),mx-pinch.mx,my-pinch.my,cur.f,size.W,size.H));
      pinch={d,mx,my};
    }else if(pts.size===1&&zoomedIn(cur.st,cur.f,size.W,size.H))setView(panBy(cur.st,dx,dy,cur.f,size.W,size.H));
  }
  function onUp(e,cancelled=false){
    const p=pts.get(e.pointerId);if(!p||!cur)return;
    pts.delete(e.pointerId);el.stage.classList.remove('is-drag');
    if(pinch){if(pts.size<2)pinch=null;for(const q of pts.values())q.moved=true;return;}
    if(cancelled||p.moved||p.type==='mouse')return;
    const [x,y]=local(e),dx=x-p.x0,dy=y-p.y0,dt=now()-p.t0;
    // A swipe across the whole frame steps the year (zoomed in, a drag moves the picture instead).
    if(!zoomedIn(cur.st,cur.f,size.W,size.H)&&Math.abs(dx)>48&&Math.abs(dx)>1.5*Math.abs(dy)&&dt<900){lastTap=null;go(dx<0?1:-1);return;}
    if(Math.abs(dx)<12&&Math.abs(dy)<12&&dt<350){
      if(lastTap&&now()-lastTap.t<350&&Math.hypot(x-lastTap.x,y-lastTap.y)<32){lastTap=null;dbl(x,y);}
      else lastTap={t:now(),x,y};
    }
  }
  // Double-click or double-tap: twice as close about the point; at the closest zoom, back to the whole frame.
  function dbl(x,y){const l=limits(cur.f,size.W,size.H);setView(cur.st.mpp<=l.min*1.001?fit(cur.f,size.W,size.H):zoomAt(cur.st,2,x,y,cur.f,size.W,size.H));}

  const api={FRAMES,MAX_SIDE,MIN_MPP,MAX_TILES,MAX_ACTIVE,frame,fitMpp,fit,bounds,limits,clampView,zoomAt,panBy,visibleRect,zoomedIn,scaleBar,
    order,step,levelFor,tilesUnder,groupRanges,open,close,_state:()=>({cur,size,tiles,queue,active,plans}),
    _internal:{planSurvey,want,cancelAll,tiles,queue,active}};
  root.ALTOImageryViewer=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
