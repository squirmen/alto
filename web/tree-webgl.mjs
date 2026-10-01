import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from './vendor/three/addons/exporters/GLTFExporter.js';

const libraryURL=new URL('./models/manifest.json',import.meta.url),cache=new Map();let libraryPromise;
const library=()=>libraryPromise||(libraryPromise=fetch(libraryURL,{cache:'no-cache'}).then(r=>r.ok?r.json():{models:{}}).catch(()=>({models:{}})));
function loadReference(id){if(!cache.has(id))cache.set(id,library().then(async meta=>{const entry=meta.models?.[id];if(!entry)return null;const gltf=await new GLTFLoader().loadAsync(new URL(entry.file+'?v='+entry.sha256,libraryURL).href);return {scene:gltf.scene,entry,meta};}).catch(()=>null));return cache.get(id);}
function clear(group){for(const child of [...group.children]){group.remove(child);child.traverse(n=>{if(n.isMesh||n.isLine||n.isSprite){n.userData.labelTexture?.dispose();n.geometry?.dispose();if(n.userData.sharedMaterial)return;for(const m of Array.isArray(n.material)?n.material:[n.material])m?.dispose();}});}}
function buffer(mesh,parts){
  let positions=mesh.positions,normals=mesh.normals,colours=mesh.colours;
  if(parts){positions=[];normals=[];colours=[];for(const p of parts){positions.push(...mesh.positions.slice(p.start*3,(p.start+p.count)*3));normals.push(...mesh.normals.slice(p.start*3,(p.start+p.count)*3));colours.push(...mesh.colours.slice(p.start*4,(p.start+p.count)*4));}}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,4));return geometry;
}
function person(){
  const group=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:'#647368',roughness:1});
  const limb=(a,b,r)=>{const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,va.distanceTo(vb),8),material);mesh.position.copy(va).add(vb).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),vb.sub(va).normalize());group.add(mesh);};
  const head=new THREE.Mesh(new THREE.SphereGeometry(.12,12,8),material);head.position.y=1.58;group.add(head);
  limb([0,.82,0],[0,1.36,0],.115);limb([-.07,.82,0],[-.16,.06,0],.065);limb([.07,.82,0],[.16,.06,0],.065);limb([-.10,1.30,0],[-.27,.90,.01],.045);limb([.10,1.30,0],[.27,.90,.01],.045);return group;
}
function label(text,height){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const c=canvas.getContext('2d');c.font='28px system-ui';c.textAlign='center';c.fillStyle='#41563f';c.fillText(text,128,42);const texture=new THREE.CanvasTexture(canvas),sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));sprite.scale.set(height*4,height,1);sprite.userData.labelTexture=texture;return sprite;}

export function create(canvas,{onRotate,onReference}={}){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(canvas.clientWidth||320,340,false);renderer.localClippingEnabled=true;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#edf2e7');scene.add(new THREE.HemisphereLight(0xffffff,0x8f8065,1.8));const sun=new THREE.DirectionalLight(0xffffff,2.0);sun.position.set(-10,30,20);scene.add(sun);
  const tree=new THREE.Group(),context=new THREE.Group();scene.add(tree,context);let camera=new THREE.OrthographicCamera(-10,10,10,-10,.01,5000),lastMesh=null,lastState=null,disposed=false,reference=null,serial=0,contextKey='';
  const rootClip=new THREE.Plane(new THREE.Vector3(0,-1,0),1);
  function draw(){if(!disposed)renderer.render(scene,camera);}
  function frame(mesh,state){
    const p=mesh.parameters,rootOnly=state.view==='roots',withRoots=['roots','whole'].includes(state.view),R=Math.max(p.width/2,withRoots?mesh.rootInfo?.radius_m||0:0),depth=withRoots?mesh.rootInfo?.depth_m||0:0,H=rootOnly?Math.min(1,p.height):Math.max(p.height,1.7),width=canvas.clientWidth||320,aspect=width/340,pitch=rootOnly?.62:.16;
    renderer.setSize(width,340,false);
    const centre=new THREE.Vector3(rootOnly?0:.4,(H-depth)/2,0),fullHeight=H+depth+R*2*Math.sin(pitch),fullWidth=R*2+(rootOnly?1.8:3.2),half=Math.max(fullHeight/2,fullWidth/(2*aspect))*1.12;
    camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.position.copy(centre).add(new THREE.Vector3(0,Math.sin(pitch),Math.cos(pitch)).multiplyScalar(Math.max(H,R,1)*4+10));camera.lookAt(centre);camera.updateProjectionMatrix();tree.rotation.y=state.yaw;
    const key=JSON.stringify([H,R,depth,width,rootOnly]);
    if(key!==contextKey){contextKey=key;clear(context);
    const circle=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:64},(_,i)=>new THREE.Vector3(R*Math.cos(i*Math.PI/32),0,R*Math.sin(i*Math.PI/32)))),new THREE.LineBasicMaterial({color:withRoots?'#ad956e':'#bccbb0'}));context.add(circle);
    const textSize=half*2/340*12;
    if(!rootOnly){const ref=person();ref.position.x=R+1.0;context.add(ref);const title=label('1.7 m person',textSize);title.position.set(R+1.0,-textSize*.6,0);context.add(title);}
    const maximum=rootOnly?depth:p.height,step=rootOnly?.5:maximum>30?10:maximum>10?5:maximum>4?2:1,x=-R-.65;
    const points=[new THREE.Vector3(x,0,0),new THREE.Vector3(x,rootOnly?-maximum:maximum,0)];
    for(let h=0;h<=maximum;h+=step){const y=rootOnly?-h:h;points.push(new THREE.Vector3(x-.08,y,0),new THREE.Vector3(x+.08,y,0));const t=label(`${rootOnly&&h?'-':''}${h} m`,textSize);t.position.set(x-textSize*1.1,y,0);context.add(t);}
    context.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#8a9a7c'})));
    }
    tree.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])m.clippingPlanes=rootOnly?[rootClip]:[];});draw();
  }
  function procedural(mesh,rootsOnly=false){const parts=rootsOnly?(mesh.parts||[]).filter(p=>p.name==='roots_hypothesis'):null;const geometry=buffer(mesh,parts);if(!geometry.attributes.position.count)return;const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0,side:THREE.DoubleSide});tree.add(new THREE.Mesh(geometry,material));}
  function fitReference(source,mesh){
    const p=mesh.parameters,entry=source.entry,copy=source.scene.clone(true),xz=p.width/entry.template_crown_width_m,vertical=p.height/entry.template_height_m,dbhRatio=(p.dbh/100)/entry.template_dbh_m;
    copy.traverse(n=>{if(!n.isMesh)return;n.geometry=n.geometry.clone();n.material=n.material.clone();n.material.side=THREE.DoubleSide;n.material.roughness=.92;n.material.metalness=0;
      const isBark=/bark/i.test(n.name),isFlower=/flower/i.test(n.name);if(isFlower)n.visible=false;
      if(!isBark&&!isFlower){const old=n.material;n.material=new THREE.MeshLambertMaterial({map:old.map,color:old.color,emissive:0x244e19,emissiveIntensity:.4,side:THREE.DoubleSide,alphaTest:old.alphaTest});old.dispose();}
      const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){let x=a.getX(i),y=a.getY(i)*vertical,z=a.getZ(i);let horizontal=xz;if(isBark){const above=Math.max(0,Math.min(1,(y-1.4)/Math.max(.2,p.height*.22))),smooth=above*above*(3-2*above);horizontal=dbhRatio+(xz-dbhRatio)*smooth;}a.setXYZ(i,x*horizontal,y,z*horizontal);}a.needsUpdate=true;n.geometry.computeVertexNormals();n.geometry.computeBoundingSphere();
    });
    copy.userData={tree_id:source.tree_id,model_kind:'scaled artistic reference',creator:entry.creator,template:entry.file,template_scaling:{height:p.height,crown_width:p.width,dbh_cm:p.dbh,lower_stem_warp:'Equivalent diameter applied below 1.4 m with smooth transition to the upper template; branch positions remain artistic'},flowering_state:'Not observed; flower mesh hidden',assumptions:p.assumed};tree.add(copy);return copy;
  }
  async function render(mesh,state){
    if(disposed)return;lastState=state;
    if(mesh!==lastMesh){lastMesh=mesh;serial++;const current=serial;reference=null;clear(tree);procedural(mesh);onReference?.(null);frame(mesh,state);
      if(state.view!=='envelope'){
        const imported=await loadReference(mesh.parameters.architecture.id);if(disposed||current!==serial||!imported)return;
        reference={...imported,tree_id:state.tree_id};clear(tree);fitReference(reference,mesh);if(mesh.rootInfo?.available)procedural(mesh,true);onReference?.({creator:imported.entry.creator,exportAllowed:imported.meta.public_geometry_export===true});frame(mesh,lastState);
      }
    }else frame(mesh,state);
  }
  let drag=null;canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,yaw:lastState?.yaw||0};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(drag)onRotate?.(drag.yaw+(e.clientX-drag.x)*.018);});canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
  return {render,canExportReference:()=>Boolean(reference?.meta.public_geometry_export),exportReference:async()=>{if(!reference?.meta.public_geometry_export)throw new Error('Reference geometry export has not been authorized');const copy=tree.clone(true);copy.rotation.y=0;copy.userData={...copy.userData,tree_id:lastState.tree_id,epoch:lastState.epoch,units:'metres',parameters:lastMesh.parameters,root_scenario:lastMesh.rootInfo||null};return new GLTFExporter().parseAsync(copy,{binary:true,onlyVisible:true});},dispose(){disposed=true;serial++;clear(tree);clear(context);renderer.dispose();}};
}
