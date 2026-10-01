/* Data-informed illustrative geometry. No branches, roots or missing dimensions are claimed as surveyed. */
(function(root){
  'use strict';
  const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
  const pos=v=>num(v)!==null&&Number(v)>0?Number(v):null;
  const fmt=v=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:1}).format(v);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function profile(record){let p=record.datasets.pointcloud?.foliage_profile;try{if(typeof p==='string')p=JSON.parse(p);}catch{return null;}return Array.isArray(p)&&p.length&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)?p:null;}
  function metrics(record){
    const p=profile(record),total=p?.reduce((a,b)=>a+b,0)||0;if(!total)return null;
    const entropy=-p.reduce((s,v)=>v?s+(v/total)*Math.log(v/total):s,0);
    const quantile=q=>{let sum=0;for(let i=0;i<p.length;i++){sum+=p[i];if(sum>=q*total)return i+.5;}return p.length-.5;};
    return {method_id:'alto-return-profile-structure-v1',profile_returns:total,profile_bins:p.length,entropy_nats:entropy,effective_1m_bands:Math.exp(entropy),return_weighted_height_m:p.reduce((s,v,i)=>s+v*(i+.5),0)/total,return_height_p10_m:quantile(.1),return_height_p90_m:quantile(.9),profile_may_be_truncated:(pos(record.datasets.pointcloud?.canopy_top_m)||0)>45};
  }
  function parameters(record,heightOverride){
    const d=record.datasets,a=d.assets||{},c=d.crown||{},pc=d.pointcloud||{},assumed=[];
    let height=pos(pc.canopy_top_m)||pos(c.crown_max_chm_m)||pos(a.height_p95_m);
    const heightSource=pos(pc.canopy_top_m)?'Laser-return canopy top':pos(c.crown_max_chm_m)?'Canopy raster maximum':pos(a.height_p95_m)?'Canopy raster P95':'Illustrative fallback';
    if(!height){height=8;assumed.push('8 m illustrative height; no height estimate available');}
    let width=pos(c.crown_diameter_m)||(pos(c.crown_area_m2)?2*Math.sqrt(c.crown_area_m2/Math.PI):null);
    if(!width){width=4;assumed.push('4 m illustrative crown width; no crown size available');}
    let dbh=pos(a.dbh_cm_crown_est)||pos(d.services?.dbh_cm_est)||pos(d.roots?.dbh_cm);
    if(!dbh){dbh=20;assumed.push('20 cm illustrative trunk diameter; no trunk estimate available');}
    const rootRadius=pos(d.roots?.effective_radius_m),p=profile(record),base=pos(pc.height_to_live_crown_m)||height*.4;
    assumed.push('Circular horizontal footprint with illustrative lobes; branch positions and stem taper are assumed');
    if(heightOverride!=null)assumed.push('Only height changes between epochs; crown width, trunk and root dimensions are held at their current values');
    return {height:heightOverride??height,referenceHeight:height,heightSource,width,dbh,rootRadius,base:Math.min(base,height*.9),profile:p,assumed};
  }
  function geometry(record,heightOverride){
    const p=parameters(record,heightOverride),positions=[],normals=[],colours=[];const segmentCount=28;
    function triangle(a,b,c,colour){const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);if(length<1e-10)return;for(const point of [a,b,c]){positions.push(...point);normals.push(...n.map(v=>v/length));colours.push(...colour);}}
    function surface(rings,colour,lobes=false){
      const ringPoints=rings.map(([y,r])=>Array.from({length:segmentCount},(_,j)=>{const t=j*2*Math.PI/segmentCount,k=lobes?1+.08*Math.cos(t*3)+.04*Math.sin(t*5+y):1;return [r*k*Math.cos(t),y,r*k*Math.sin(t)];}));
      for(let i=0;i<ringPoints.length-1;i++)for(let j=0;j<segmentCount;j++){const k=(j+1)%segmentCount;triangle(ringPoints[i][j],ringPoints[i+1][j],ringPoints[i][k],colour);triangle(ringPoints[i][k],ringPoints[i+1][j],ringPoints[i+1][k],colour);}
      const first=ringPoints[0],last=ringPoints.at(-1);for(let j=0;j<segmentCount;j++){const k=(j+1)%segmentCount;triangle([0,rings[0][0],0],first[j],first[k],colour);triangle([0,rings.at(-1)[0],0],last[k],last[j],colour);}
    }
    surface([[0,p.dbh/200*1.35],[p.height*.08,p.dbh/200],[p.height*.7,p.dbh/200*.6],[p.height*.95,.02]],[.40,.29,.19,1]);
    let rings=[];const bins=p.profile,maximum=bins?.length?Math.max(...bins):0,scale=p.height/p.referenceHeight;
    if(maximum>0){
      rings=[[Math.min(p.base,p.referenceHeight*.1)*scale,.025]];
      for(let i=0;i<bins.length;i++){const h=(i+.5)*scale;if(h>=p.height)break;const smooth=((bins[i-1]??bins[i])+2*bins[i]+(bins[i+1]??bins[i]))/4;const radius=p.width/2*Math.sqrt(smooth/maximum);rings.push([h,Math.max(.025,radius)]);}
      rings.sort((a,b)=>a[0]-b[0]);rings.push([p.height,.025]);
    }else{for(let i=0;i<=18;i++){const t=i/18,y=p.base*scale+(p.height-p.base*scale)*t;rings.push([y,Math.max(.025,p.width/2*Math.sin(Math.PI*t)**.7)]);}}
    surface(rings,[.29,.48,.25,.94],true);
    return {positions,normals,colours,parameters:p,metrics:metrics(record)};
  }
  function glb(record,model,epoch='2024'){
    const mesh=model,arrays=[new Float32Array(mesh.positions),new Float32Array(mesh.normals),new Float32Array(mesh.colours)],offsets=[0];for(const a of arrays)offsets.push(offsets.at(-1)+a.byteLength);
    const count=mesh.positions.length/3,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<count;i++)for(let k=0;k<3;k++){const v=arrays[0][i*3+k];min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);}
    const doc={asset:{version:'2.0',generator:'ALTO illustrative tree model v1'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:record.tree_id}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},material:0,mode:4}]}],materials:[{name:'Illustrative canopy and trunk',pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:1},doubleSided:true}],buffers:[{byteLength:offsets.at(-1)}],bufferViews:arrays.map((a,i)=>({buffer:0,byteOffset:offsets[i],byteLength:a.byteLength,target:34962})),accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min,max},{bufferView:1,componentType:5126,count,type:'VEC3'},{bufferView:2,componentType:5126,count,type:'VEC4'}],extras:{tree_id:record.tree_id,epoch,units:'metres',model_id:'alto-illustrative-tree-v1',source_snapshot:record.snapshot,source_database_mtime_ns:record.database_mtime_ns,parameters:mesh.parameters,vertical_structure:mesh.metrics,interpretation:'Illustrative geometry informed by canopy and model dimensions; not a surveyed stem, root or branch reconstruction. Root extent is drawn as a reference ring in the viewer and is not a root mesh.'}};
    const json=new TextEncoder().encode(JSON.stringify(doc)),jsonLength=Math.ceil(json.length/4)*4,total=12+8+jsonLength+8+offsets.at(-1),buffer=new ArrayBuffer(total),view=new DataView(buffer),bytes=new Uint8Array(buffer);
    view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonLength);bytes.set(json,20);const bin=20+jsonLength;view.setUint32(bin,offsets.at(-1),true);view.setUint32(bin+4,0x004e4942,true);arrays.forEach((a,i)=>bytes.set(new Uint8Array(a.buffer),bin+8+offsets[i]));return buffer;
  }
  function mount(host,record,futureModel){
    if(host.dataset.mounted)return;host.dataset.mounted='true';
    const options=[{year:'2024',height:null,note:'Current structure'}],t=record.datasets.trajectory||{};
    for(const year of [2013,2016])if((t['present_'+year]===1||t['present_'+year]===true)&&pos(t['h_'+year]))options.unshift({year:String(year),height:Number(t['h_'+year]),note:'Matched historic canopy height; other dimensions held fixed'});
    if(futureModel){const projection=ALTOFuture.project(record,futureModel);for(const p of projection.points||[])options.push({year:String(p.year),height:p.height_m,note:'Conditional height scenario; other dimensions held fixed'});}
    host.innerHTML='<p>Drag to rotate, or use the rotation control. Shape is illustrative; dimensions and return profiles provide its anchors.</p><label class="model-epoch-label">View year <select class="model-epoch">'+options.map(o=>`<option value="${o.year}" ${o.year==='2024'?'selected':''}>${o.year}${Number(o.year)>2024?' · scenario':''}</option>`).join('')+'</select></label><canvas class="tree-model-canvas" aria-label="Illustrative 3D tree, using stored dimensions"></canvas><label class="model-rotation-label">Rotate <input class="model-rotation" type="range" min="0" max="360" value="35"></label><p class="model-dimensions"></p><p class="model-epoch-note"></p><div class="model-structure"></div><details><summary>Measured inputs and assumed shape</summary><p class="model-assumptions"></p><p>The radial silhouette follows smoothed relative laser-return counts, where available. These are not measured branch positions or horizontal widths at each height. Low returns can belong to understorey. A generic crown is used when no vertical profile is available.</p></details><button type="button" class="model-download">Download this 3D model · GLB</button>';
    const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d'),rotation=host.querySelector('.model-rotation'),select=host.querySelector('select');let mesh=geometry(record),yaw=.6;
    function draw(){
      if(!host.isConnected)return;const w=host.clientWidth||320,h=290,dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
      const p=mesh.parameters,extent=Math.max(p.width,p.rootRadius?2*p.rootRadius:0),s=Math.min((w-45)/(extent*1.3),235/Math.max(p.height,1)),pitch=.23;
      const project=(x,y,z)=>{const X=x*Math.cos(yaw)-z*Math.sin(yaw),Z=x*Math.sin(yaw)+z*Math.cos(yaw);return [w/2+X*s,h-35-y*Math.cos(pitch)*s+Z*Math.sin(pitch)*s,Z*Math.cos(pitch)+y*Math.sin(pitch)];};
      ctx.fillStyle='#f2f5ed';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#d5ddcc';
      const ring=r=>{ctx.beginPath();for(let i=0;i<=70;i++){const a=i/70*2*Math.PI,v=project(r*Math.cos(a),0,r*Math.sin(a));i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]);}ctx.stroke();};
      ring(Math.max(p.width/2,p.rootRadius||0));if(p.rootRadius){ctx.setLineDash([4,4]);ctx.strokeStyle='#ad9362';ring(p.rootRadius);ctx.setLineDash([]);}
      const faces=[];for(let i=0;i<mesh.positions.length;i+=9){const pts=[0,3,6].map(k=>project(...mesh.positions.slice(i+k,i+k+3)));faces.push({pts,depth:pts.reduce((s,p)=>s+p[2],0)/3,i});}
      faces.sort((a,b)=>a.depth-b.depth);
      for(const face of faces){const vertex=face.i/3,c=mesh.colours.slice(vertex*4,vertex*4+3),n=mesh.normals.slice(face.i,face.i+3),shade=.72+.28*Math.abs(n[0]*.4+n[1]*.7+n[2]*.5);ctx.fillStyle=`rgb(${c.map(v=>Math.round(v*shade*255)).join(',')})`;ctx.beginPath();face.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fill();}
      ctx.fillStyle='#55644e';ctx.font='10px system-ui';ctx.fillText(p.rootRadius?'Dashed ring: modelled effective root extent':'Crown and trunk illustration',10,h-10);
    }
    function refresh(){const option=options.find(o=>o.year===select.value);mesh=geometry(record,option.height);const p=mesh.parameters;
      host.querySelector('.model-dimensions').textContent=`Height ${fmt(p.height)} m · crown width ${fmt(p.width)} m · trunk ${fmt(p.dbh)} cm`;
      host.querySelector('.model-epoch-note').textContent=option.note;
      host.querySelector('.model-assumptions').textContent=`Height basis: ${p.heightSource}. ${p.assumed.join('. ')}.`;
      const m=mesh.metrics;host.querySelector('.model-structure').innerHTML=m?`<strong>Vertical return structure</strong><p>${fmt(m.return_weighted_height_m)} m return-weighted height · ${fmt(m.effective_1m_bands)} effective 1 m bands · middle 80% of returns: ${fmt(m.return_height_p10_m)}–${fmt(m.return_height_p90_m)} m.</p><p>Calculated from ${m.profile_returns} stored vegetation returns. Effective bands = exp(Shannon entropy) of the 1 m return histogram; this is vertical structure, not species diversity.${m.profile_may_be_truncated?' The profile is capped at 45 m and may omit the upper canopy.':''}</p>`:'<p>No vertical return profile is available. Crown shape is generic.</p>';
      draw();
    }
    rotation.addEventListener('input',()=>{yaw=Number(rotation.value)*Math.PI/180;draw();});select.addEventListener('change',refresh);
    let drag=null;canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,yaw};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw=drag.yaw+(e.clientX-drag.x)*.018;rotation.value=((yaw*180/Math.PI)%360+360)%360;draw();});canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
    host.querySelector('.model-download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([glb(record,mesh,select.value)],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=url;a.download=record.tree_id+'-'+select.value+'-illustrative.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    const resize=new ResizeObserver(()=>{if(host.isConnected)draw();else resize.disconnect();});resize.observe(host);refresh();
  }
  const api={metrics,parameters,geometry,glb,mount};root.ALTOTreeModel=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
