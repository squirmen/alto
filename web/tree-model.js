/* Data-informed illustrative geometry. No branches, roots or missing dimensions are claimed as surveyed. */
(function(root){
  'use strict';
  const moduleBase=typeof document!=='undefined'?document.currentScript?.src||location.href:null;
  const architecture=root.ALTOTreeArchitecture||(typeof require==='function'?require('./tree-architecture.js'):null);
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
  function parameters(record,heightOverride,options={}){
    const d=record.datasets,a=d.assets||{},c=d.crown||{},pc=d.pointcloud||{},assumed=[];
    let height=pos(pc.canopy_top_m)||pos(c.crown_max_chm_m)||pos(a.height_p95_m);
    const heightSource=pos(pc.canopy_top_m)?'Segmented canopy maximum':pos(c.crown_max_chm_m)?'Segmented canopy maximum':pos(a.height_p95_m)?'Canopy raster P95':'Illustrative fallback';
    if(!height){height=8;assumed.push('8 m illustrative height; no height estimate available');}
    let width=pos(c.crown_diameter_m)||(pos(c.crown_area_m2)?2*Math.sqrt(c.crown_area_m2/Math.PI):null);
    if(!width){width=4;assumed.push('4 m illustrative crown width; no crown size available');}
    let dbh=pos(a.dbh_cm_crown_est)||pos(d.services?.dbh_cm_est)||pos(d.roots?.dbh_cm),dbhSource='modelled';
    const measured=pos(options.live?.diameter_cm)||(pos(options.live?.circumference_cm)?options.live.circumference_cm/Math.PI:null);
    if(measured){dbh=measured;dbhSource='measured';assumed.push('Trunk diameter '+fmt(dbh)+' cm from a tape measurement recorded in a KYTE visit'+(pos(options.live?.measuring_height_m)?' at '+fmt(options.live.measuring_height_m)+' m':'')+'; the modelled estimate is kept in the record');}
    if(!dbh){dbh=20;assumed.push('20 cm illustrative trunk diameter; no trunk estimate available');}
    const g=d.ground||{};
    if(pos(g.joined_crown_width_m)&&pos(g.joined_height_max_m)&&Number(g.joined_records)>1){width=Number(g.joined_crown_width_m);height=Number(g.joined_height_max_m);assumed.push('Crown width and height use the '+g.joined_records+' crowns a field visit showed to be one tree, measured together');}
    const rootRadius=pos(d.roots?.effective_radius_m)||pos(d.roots?.foraging_radius_m),p=profile(record);
    const form=architecture.identify(record,options.template,options.live);
    const base=pos(pc.height_to_live_crown_m)||height*(form.base??.4);
    if(!pos(pc.height_to_live_crown_m))assumed.push('Crown base set by the template ('+Math.round((form.base??.4)*100)+'% of height); no live-crown height is stored');
    assumed.push('Botanical template (alto-botanical-forms-v3) selected from the recorded name, a field identification or a growth-form hypothesis; branch positions, leaves and stem counts are drawn, not surveyed');
    if(form.id==='pohutukawa')assumed.push('The input DBH is treated as an equivalent diameter; basal area is shared across three assumed stems');
    if((form.id==='nikau'&&height>25)||(form.id==='tree_fern'&&height>20))assumed.push('This height is unusually large for the selected form; check the species and canopy match');
    if(form.needsIdentification)assumed.push('Tree identity needs more data; this template is a placeholder');
    if(options.heightBasis)assumed.push('Current and future views share the matched canopy-height anchor; other height estimates remain in the full record');
    if(heightOverride!=null)assumed.push('Only height changes between epochs; crown width, trunk and root dimensions are held at their current values');
    return {height:heightOverride??height,referenceHeight:height,heightSource:options.heightBasis||heightSource,width,dbh,rootRadius,base:Math.min(base,height*.9),profile:p,architecture:form,foliageMode:options.foliage||'full',assumed};
  }
  function geometry(record,heightOverride,shapeMode='tree',options={}){
    const p=parameters(record,heightOverride,options);
    if(shapeMode==='tree'){
      const mesh=architecture.build(p,record);
      if(options.includeRoots){const below=architecture.roots(p,record,options.rootDepth,options.rootExtent);const offset=mesh.positions.length/3;mesh.positions.push(...below.positions);mesh.normals.push(...below.normals);mesh.colours.push(...below.colours);mesh.parts.push(...below.parts.map(x=>({...x,start:x.start+offset})));mesh.rootInfo=below.rootInfo;}
      return {...mesh,parameters:p,metrics:metrics(record)};
    }
    const positions=[],normals=[],colours=[];const segmentCount=28;
    if(p.height<=0)return {positions,normals,colours,parameters:p,metrics:metrics(record)};
    function triangle(a,b,c,colour){const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);if(length<1e-10)return;for(const point of [a,b,c]){positions.push(...point);normals.push(...n.map(v=>v/length));colours.push(...colour);}}
    function surface(rings,colour,lobes=false){
      const ringPoints=rings.map(([y,r])=>Array.from({length:segmentCount},(_,j)=>{const t=j*2*Math.PI/segmentCount,k=lobes?1+.08*Math.cos(t*3)+.04*Math.sin(t*5+y):1;return [r*k*Math.cos(t),y,r*k*Math.sin(t)];}));
      for(let i=0;i<ringPoints.length-1;i++)for(let j=0;j<segmentCount;j++){const k=(j+1)%segmentCount;triangle(ringPoints[i][j],ringPoints[i+1][j],ringPoints[i][k],colour);triangle(ringPoints[i][k],ringPoints[i+1][j],ringPoints[i+1][k],colour);}
      const first=ringPoints[0],last=ringPoints.at(-1);for(let j=0;j<segmentCount;j++){const k=(j+1)%segmentCount;triangle([0,rings[0][0],0],first[j],first[k],colour);triangle([0,rings.at(-1)[0],0],last[k],last[j],colour);}
    }
    surface([[0,p.dbh/200*1.35],[p.height*.08,p.dbh/200],[p.height*.7,p.dbh/200*.6],[p.height*.95,.02]],[.40,.29,.19,1]);
    let rings=[];const bins=p.profile,maximum=bins?.length?Math.max(...bins):0,scale=p.height/p.referenceHeight;
    if(maximum>0){
      // A return histogram can include a separate understorey layer. The tree
      // illustration uses its dominant contiguous layer; the envelope retains all bins.
      const smooth=bins.map((v,i)=>((bins[i-1]??v)+2*v+(bins[i+1]??v))/4);
      let first=0;
      if(shapeMode==='tree'){
        let start=0,mass=0,bestMass=-1,bestStart=0;
        for(let i=0;i<=smooth.length;i++){
          if(i<smooth.length&&smooth[i]>=maximum*.1){if(!mass)start=i;mass+=smooth[i];}
          else if(mass){if(mass>bestMass){bestMass=mass;bestStart=start;}mass=0;}
        }
        first=bestStart;
        p.assumed.push('Illustrative main crown begins at the dominant contiguous return layer above a 10% peak threshold; this is a display heuristic, not a measured live-crown base. Lower returns remain in the return-envelope view and structure metrics');
      }
      p.shapeMode=shapeMode;
      rings=[[first*scale,.025]];
      for(let i=first;i<bins.length;i++){const h=(i+.5)*scale;if(h>=p.height)break;const radius=p.width/2*Math.sqrt(smooth[i]/maximum);rings.push([h,Math.max(.025,radius)]);}
      rings.sort((a,b)=>a[0]-b[0]);rings.push([p.height,.025]);
    }else{for(let i=0;i<=18;i++){const t=i/18,y=p.base*scale+(p.height-p.base*scale)*t;rings.push([y,Math.max(.025,p.width/2*Math.sin(Math.PI*t)**.7)]);}}
    surface(rings,[.29,.48,.25,.94],true);
    return {positions,normals,colours,parameters:p,metrics:metrics(record)};
  }
  function glb(record,model,epoch='2024'){
    const mesh=model;if(!mesh.positions.length)throw new Error('No positive-height tree geometry to export');const arrays=[new Float32Array(mesh.positions),new Float32Array(mesh.normals),new Float32Array(mesh.colours)],offsets=[0];for(const a of arrays)offsets.push(offsets.at(-1)+a.byteLength);
    const count=mesh.positions.length/3,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<count;i++)for(let k=0;k<3;k++){const v=arrays[0][i*3+k];min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);}
    const doc={asset:{version:'2.0',generator:'ALTO botanical tree model v2'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:record.tree_id}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},material:0,mode:4}]}],materials:[{name:'Illustrative canopy and trunk',pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:1},doubleSided:true}],buffers:[{byteLength:offsets.at(-1)}],bufferViews:arrays.map((a,i)=>({buffer:0,byteOffset:offsets[i],byteLength:a.byteLength,target:34962})),accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min,max},{bufferView:1,componentType:5126,count,type:'VEC3'},{bufferView:2,componentType:5126,count,type:'VEC4'}],extras:{tree_id:record.tree_id,epoch,units:'metres',model_id:'alto-botanical-tree-v2',source_snapshot:record.snapshot,source_database_mtime_ns:record.database_mtime_ns,parameters:mesh.parameters,parts:mesh.parts||[],root_scenario:mesh.rootInfo||null,vertical_structure:mesh.metrics,interpretation:'Illustrative geometry informed by canopy and model dimensions; not a surveyed stem, root or branch reconstruction. Optional root branches are a procedural hypothesis within a stored root radius, with an explicitly assumed depth. The reference person is not included in this tree export.'}};
    const json=new TextEncoder().encode(JSON.stringify(doc)),jsonLength=Math.ceil(json.length/4)*4,total=12+8+jsonLength+8+offsets.at(-1),buffer=new ArrayBuffer(total),view=new DataView(buffer),bytes=new Uint8Array(buffer);
    view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonLength);bytes.set(json,20);const bin=20+jsonLength;view.setUint32(bin,offsets.at(-1),true);view.setUint32(bin+4,0x004e4942,true);arrays.forEach((a,i)=>bytes.set(new Uint8Array(a.buffer),bin+8+offsets[i]));return buffer;
  }
  function captureRequest(record,p){
    const r=record.datasets.record||{};
    return {schema_version:1,kind:'alto_tree_capture_request',tree_id:record.tree_id,source_snapshot:record.snapshot,coordinates:{longitude:r.lon??null,latitude:r.lat??null},template_hypothesis:p.architecture.id,dimensions_to_check:{height_m:p.height,dbh_cm:p.dbh,crown_width_m:p.width},captured_at:null,observed_species:null,stem_count:null,measured_dbh_cm:null,root_depth_m:null,photos:[],requested_views:['Whole tree from two different sides, including its base and top','Trunk and forks, with a tape or other measured scale','Leaves or fronds close enough to help identify the tree','Root flare and visible surface roots'],notes:'Reference photos refine identity and architecture; a single photo is not a measured 3D reconstruction. Preserve tree_id when adding future photos, depth captures or scans.'};
  }
  function mount(host,record,futureModel,live){
    if(host.dataset.mounted)return;host.dataset.mounted='true';
    if(record.datasets.location_review){host.innerHTML='<p>Locate this source entry before building an individual-tree model. The field-report links above can help identify the right tree.</p>';return;}
    const projected=futureModel?ALTOFuture.project(record,futureModel):null;
    const anchor=projected&&!projected.unavailable?projected.anchor_height_m:null;
    const options=[{year:'2024',height:anchor,note:anchor!==null?'2024 canopy height · starting point for the forecast':'Current tree dimensions · forecast unavailable'}],t=record.datasets.trajectory||{};
    for(const year of [2016,2013])if((t['present_'+year]===1||t['present_'+year]===true)&&pos(t['h_'+year]))options.unshift({year:String(year),height:Number(t['h_'+year]),note:'Height from the earlier survey; other dimensions held at 2024'});
    for(const p of projected?.points||[])options.push({year:String(p.year),height:p.height_m,note:'Estimated height; trunk, crown width and roots held at their 2024 size'});
    const rootFields=[['effective_radius_m','Effective extent'],['foraging_radius_m','Foraging extent'],['rpa_radius_m','Protection area'],['stability_radius_m','Stability extent']].filter(([key])=>pos(record.datasets.roots?.[key]));
    const initial=architecture.identify(record,null,live);
    host.innerHTML=`<div class="model-heading"><div><h3>${esc(initial.label)}</h3><p>Tree form · scaled to the available dimensions</p></div><span class="model-evidence-badge"></span></div>
      <div class="model-controls"><label>Year<select class="model-epoch">${options.map(o=>`<option value="${o.year}" ${o.year==='2024'?'selected':''}>${o.year}${Number(o.year)>2024?' · scenario':''}</option>`).join('')}</select></label><label>View<select class="model-view"><option value="tree">Tree + size reference</option><option value="whole" ${rootFields.length?'':'disabled'}>Tree + roots</option><option value="roots" ${rootFields.length?'':'disabled'}>Explore roots</option><option value="envelope">Laser-return envelope</option></select></label></div><div class="model-controls"><label>Foliage<select class="model-foliage"><option value="full">Full crown</option><option value="sparse">Thinned</option><option value="none">Branches only</option></select></label><label class="model-live-note"></label></div>
      <canvas class="tree-model-canvas" aria-label="Illustrative tree beside a 1.7 metre person, with a metre scale"></canvas>
      <label class="model-rotation-label">Rotate<input class="model-rotation" type="range" min="0" max="360" value="35"></label>
      <p class="model-dimensions"></p><p class="model-epoch-note"></p><p class="model-form-note"></p>
      <div class="model-roots-controls" hidden><div class="model-controls"><label>Root extent<select class="model-root-extent">${rootFields.map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>Assumed depth<span class="model-root-depth-value">0.6 m</span><input class="model-root-depth" type="range" min="0.2" max="2" step="0.1" value="0.6"></label></div><p class="model-root-note"></p></div>
      <details class="model-refine"><summary>Refine the tree form</summary><p>Try another tree form to see how it fits. Your choice changes this view; the original identification stays in the record.</p><label>Shape template<select class="model-template"><option value="">Automatic · ${esc(initial.label)}</option>${Object.entries(architecture.catalogue).map(([key,v])=>`<option value="${key}">${esc(v.label)}</option>`).join('')}</select></label><p class="model-reference"></p></details>
      <details><summary>Dimensions and how the model is built</summary><p class="model-assumptions"></p><div class="model-structure"></div><p>The tree’s dimensions set the scale; the template supplies its branches and foliage. Root paths are drawn from the selected root model. Choose the envelope view to see the shape of the laser-return layers, which can include plants beneath the tree.</p></details>
      <details class="model-capture"><summary>Add photos of this tree</summary><p class="model-needed"></p><p>Photograph the whole tree from two sides, its trunk and forks with a measured scale, leaves or fronds, and the root flare. Keep the tree ID with the photos. One image can improve identification and shape; a 3D reconstruction needs overlapping views and scale.</p><button type="button" class="model-capture-download">Download this tree’s photo checklist · JSON</button></details>
      <button type="button" class="model-download">Download this 3D tree · GLB</button>`;
    const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d'),rotation=host.querySelector('.model-rotation'),year=host.querySelector('.model-epoch'),view=host.querySelector('.model-view'),template=host.querySelector('.model-template'),rootExtent=host.querySelector('.model-root-extent'),depth=host.querySelector('.model-root-depth'),foliageSel=host.querySelector('.model-foliage');
    const liveNote=host.querySelector('.model-live-note');if(live?.photos?.length)liveNote.textContent='Photographed from the ground '+(live.observed_on||'')+' · compare with the photos above';else liveNote.textContent='';
    let mesh,yaw=35*Math.PI/180,drawFrame=0,webRenderer=null,disposed=false;
    function draw(){
      drawFrame=0;if(!host.isConnected)return;
      if(webRenderer){webRenderer.render(mesh,{view:view.value,yaw,tree_id:record.tree_id,epoch:year.value});return;}
      const w=host.clientWidth||320,h=340,dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);
      const p=mesh.parameters,rootOnly=view.value==='roots',withRoots=['roots','whole'].includes(view.value),radius=Math.max(p.width/2,withRoots?mesh.rootInfo?.radius_m||0:0),rootDepth=withRoots?mesh.rootInfo?.depth_m||0:0,pitch=rootOnly?.62:.17;
      const top=rootOnly?Math.min(1,p.height):Math.max(p.height,1.7),left=-radius-1.1,right=radius+(rootOnly?1.1:2.3),up=top*Math.cos(pitch)+radius*Math.sin(pitch),down=rootDepth*Math.cos(pitch)+radius*Math.sin(pitch);
      const scale=Math.min((w-35)/(right-left),(h-55)/(up+down)),offsetX=(w-(right-left)*scale)/2-left*scale,groundY=25+up*scale;
      const project=(x,y,z)=>{const X=x*Math.cos(yaw)-z*Math.sin(yaw),Z=x*Math.sin(yaw)+z*Math.cos(yaw);return [offsetX+X*scale,groundY-y*Math.cos(pitch)*scale+Z*Math.sin(pitch)*scale,Z*Math.cos(pitch)+y*Math.sin(pitch)];};
      const bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,'#eef3e9');bg.addColorStop(1,withRoots?'#eee3cf':'#e4ebdc');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
      const ring=(r,colour,dashed=false)=>{ctx.strokeStyle=colour;ctx.lineWidth=1;ctx.setLineDash(dashed?[4,3]:[]);ctx.beginPath();for(let i=0;i<=64;i++){const a=i/64*2*Math.PI,q=project(r*Math.cos(a),0,r*Math.sin(a));i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);}ctx.stroke();ctx.setLineDash([]);};
      ring(radius,'#c2ceb8');if(withRoots)ring(mesh.rootInfo.radius_m,'#a88e62',true);
      const faces=[];for(let i=0;i<mesh.positions.length;i+=9){
        const y1=mesh.positions[i+1],y2=mesh.positions[i+4],y3=mesh.positions[i+7];if(rootOnly&&Math.min(y1,y2,y3)>Math.min(1,p.height))continue;
        const pts=[0,3,6].map(k=>project(...mesh.positions.slice(i+k,i+k+3)));faces.push({pts,depth:pts.reduce((s,q)=>s+q[2],0)/3,i});
      }
      faces.sort((a,b)=>a.depth-b.depth);
      const light=[-.4,.8,.45];
      for(const face of faces){const vertex=face.i/3,c=mesh.colours.slice(vertex*4,vertex*4+3),n=mesh.normals.slice(face.i,face.i+3),rx=n[0]*Math.cos(yaw)-n[2]*Math.sin(yaw),rz=n[0]*Math.sin(yaw)+n[2]*Math.cos(yaw),shade=.68+.32*Math.max(0,rx*light[0]+n[1]*light[1]+rz*light[2]);ctx.fillStyle=`rgb(${c.map(v=>Math.round(v*shade*255)).join(',')})`;ctx.beginPath();face.pts.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.closePath();ctx.fill();}
      // The reference silhouette is at ground level and uses exactly the same metre scale.
      if(!rootOnly){
        const x=offsetX+(radius+1.1)*scale,y=groundY,unit=scale*Math.cos(pitch);ctx.strokeStyle='#627162';ctx.fillStyle='#627162';ctx.lineCap='round';ctx.lineWidth=Math.max(1.2,.10*scale);
        ctx.beginPath();ctx.arc(x,y-1.57*unit,.13*scale,0,Math.PI*2);ctx.fill();
        const segment=(a,b,c,d)=>{ctx.beginPath();ctx.moveTo(x+a*scale,y-b*unit);ctx.lineTo(x+c*scale,y-d*unit);ctx.stroke();};
        segment(0,1.38,0,.79);segment(-.22,1.02,0,1.30);segment(0,1.30,.22,1.02);segment(0,.79,-.17,.05);segment(0,.79,.17,.05);
        ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText('1.7 m',x,y+16);ctx.textAlign='left';
      }
      const rulerX=14;ctx.strokeStyle='#73816b';ctx.fillStyle='#52614b';ctx.lineWidth=1;ctx.font='10px system-ui';
      const maximum=rootOnly?rootDepth:p.height,step=rootOnly?.5:maximum>30?10:maximum>10?5:maximum>4?2:1;
      const yFor=v=>groundY+(rootOnly?1:-1)*v*Math.cos(pitch)*scale;
      ctx.beginPath();ctx.moveTo(rulerX,yFor(0));ctx.lineTo(rulerX,yFor(maximum));ctx.stroke();
      for(let n=0;n<=maximum;n+=step){ctx.beginPath();ctx.moveTo(rulerX-3,yFor(n));ctx.lineTo(rulerX+4,yFor(n));ctx.stroke();ctx.fillText(`${rootOnly&&n?'-':''}${fmt(n)} m`,rulerX+7,yFor(n)+3);}
      ctx.font='10px system-ui';ctx.fillStyle='#58694f';ctx.fillText(rootOnly?'Illustrated roots · depth set below':'Tree template · dimensions in metres',10,h-10);
    }
    const requestDraw=()=>{if(!drawFrame)drawFrame=requestAnimationFrame(draw);};
    function refresh(){
      const option=options.find(o=>o.year===year.value),withRoots=['whole','roots'].includes(view.value),opts={template:template.value,includeRoots:withRoots,rootDepth:Number(depth.value),rootExtent:rootExtent.value||'effective_radius_m',foliage:foliageSel.value,live,heightBasis:anchor!==null?'Matched canopy-height anchor shared with the future scenario':null};
      mesh=geometry(record,option.height,view.value==='envelope'?'envelope':'tree',opts);const p=mesh.parameters;
      host.querySelector('.model-heading h3').textContent=p.architecture.label;
      host.querySelector('.model-evidence-badge').textContent=p.architecture.basis==='user_selected_hypothesis'?'Your choice':p.architecture.basis==='photo_identification_hypothesis'?'Photo identification':p.architecture.needsIdentification?'Needs identification':p.architecture.basis==='field_report_taxon'?'Field report':p.architecture.basis==='recorded_taxon'?'Recorded name':'Estimated type';
      host.querySelector('.model-form-note').textContent=p.architecture.description+(p.architecture.relatedTemplate?' Uses the related pōhutukawa form as a provisional template for the reported Kermadec species.':'')+(p.architecture.basis==='photo_identification_hypothesis'?' The form follows a photo identification ('+esc(live?.species?.name||'')+', '+Math.round((live?.species?.score||0)*100)+'% Pl@ntNet score); it is a lead, not a determination.':'')+(p.architecture.trunkFormEvidence==='multiple'?' Drawn with several stems, as recorded in the field.':'')+(p.assumed.some(a=>a.startsWith('This height'))?' Check this tree: the stored height is unusually large for this form.':'');
      host.querySelector('.model-dimensions').textContent=`Height ${fmt(p.height)} m · crown ${fmt(p.width)} m · DBH ${fmt(p.dbh)} cm`;
      host.querySelector('.model-epoch-note').textContent=option.note+(projected?.annual_change_m<0&&Number(option.year)>2024?' The historical inputs suggest a fall in canopy height. Pruning, survey differences and matching errors could all contribute.':'');
      host.querySelector('.model-download').disabled=!mesh.positions.length;
      host.querySelector('.model-download').textContent=withRoots?'Download tree and roots · GLB':'Download this 3D tree · GLB';
      host.querySelector('.model-assumptions').textContent=`Height basis: ${p.heightSource}. ${p.assumed.join('. ')}.`;
      host.querySelector('.model-roots-controls').hidden=!withRoots;host.querySelector('.model-root-depth-value').textContent=fmt(Number(depth.value))+' m';
      if(withRoots){const ri=mesh.rootInfo,r=record.datasets.roots||{};host.querySelector('.model-root-note').textContent=`${fmt(ri.radius_m)} m radius from the stored ${rootFields.find(x=>x[0]===rootExtent.value)?.[1].toLowerCase()} model. ${ri.architecture.startsWith('fibrous')?'Illustrated fibrous roots':'Illustrated branching roots'}. Use the slider to try a depth; this tree’s root depth has yet to be measured. Root space: ${r.root_constraint_flag==='at_risk'?'estimated space deficit':r.root_constraint_flag||'unrecorded'}. Recorded life stage: ${r.life_stage||'unrecorded'}.`;}
      const reference=host.querySelector('.model-reference');reference.replaceChildren();if(p.architecture.source){const a=document.createElement('a');a.href=p.architecture.source;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Botanical reference for this template';reference.append(a);}else reference.textContent='A general tree form. Photos would help us choose a closer match.';
      host.querySelector('.model-needed').textContent=p.architecture.needsIdentification?'This tree needs identification and reference photos.':'Reference photos would help check the crown, forks and trunk dimensions against this template.';
      const m=mesh.metrics;host.querySelector('.model-structure').innerHTML=m?`<strong>Vertical return structure</strong><p>${fmt(m.return_weighted_height_m)} m return-weighted height · ${fmt(m.effective_1m_bands)} effective 1 m bands · middle 80% of returns: ${fmt(m.return_height_p10_m)}–${fmt(m.return_height_p90_m)} m.</p><p>${m.profile_returns} laser returns grouped by height.${m.profile_may_be_truncated?' Profile capped at 45 m; upper returns may be missing.':''}</p>`:'<p>This tree has no usable laser-return profile. Its shape comes from the selected template.</p>';
      requestDraw();
    }
    rotation.addEventListener('input',()=>{yaw=Number(rotation.value)*Math.PI/180;requestDraw();});[year,view,template,rootExtent,depth,foliageSel].forEach(el=>el.addEventListener('input',refresh));
    let drag=null;canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,yaw};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw=drag.yaw+(e.clientX-drag.x)*.018;rotation.value=((yaw*180/Math.PI)%360+360)%360;requestDraw();});canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
    function download(data,type,name){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    host.querySelector('.model-download').addEventListener('click',async()=>{const bytes=webRenderer?.canExportReference()?await webRenderer.exportReference():glb(record,mesh,year.value);download(bytes,'model/gltf-binary',record.tree_id+'-'+year.value+'-botanical.glb');});
    host.querySelector('.model-capture-download').addEventListener('click',()=>download(JSON.stringify(captureRequest(record,mesh.parameters),null,2),'application/json',record.tree_id+'-photo-checklist.json'));
    const resize=new ResizeObserver(()=>{if(host.isConnected)requestDraw();else resize.disconnect();});resize.observe(host);refresh();
    const rendererURL=new URL('./tree-webgl.mjs',moduleBase);rendererURL.searchParams.set('v',window.AKL_TILE_VERSION||'botanical-v2');
    import(rendererURL.href).then(module=>{
      if(disposed||!host.isConnected)return;
      const enhanced=document.createElement('canvas');enhanced.className=canvas.className;enhanced.setAttribute('aria-label',canvas.getAttribute('aria-label'));canvas.replaceWith(enhanced);
      try{webRenderer=module.create(enhanced,{onRotate:angle=>{yaw=angle;rotation.value=((yaw*180/Math.PI)%360+360)%360;requestDraw();},onReference:ref=>{
        if(disposed)return;
        host.querySelector('.model-form-note').textContent=mesh.parameters.architecture.description+(mesh.parameters.assumed.some(a=>a.startsWith('This height'))?' Check this tree: the stored height is unusually large for this form.':'')+(ref?' Textured reference by '+ref.creator+'. Trunk and canopy have been scaled to ALTO estimates.':'');
        host.querySelector('.model-download').textContent=ref&&!ref.exportAllowed?'Download ALTO tree template · GLB':mesh.rootInfo?.available?'Download tree and roots · GLB':'Download this 3D tree · GLB';
      }});requestDraw();}catch{enhanced.replaceWith(canvas);requestDraw();}
    }).catch(()=>{});
    return ()=>{disposed=true;resize.disconnect();webRenderer?.dispose();if(drawFrame)cancelAnimationFrame(drawFrame);};
  }
  const api={metrics,parameters,geometry,glb,mount,captureRequest};root.ALTOTreeModel=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
