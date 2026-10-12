/* The LiDAR returns of one crown, drawn as points: the 2024 survey's own returns inside the crown,
 * from the tree's alto-points/1 file (ALTOTreeRecord.loadPoints). Side view at a true metre scale
 * (orthographic camera, no perspective), turning about the vertical; drag to turn by hand.
 * Colours by LAS class: ground, vegetation (shaded by height), building, unclassified. */
import * as THREE from './vendor/three/three.module.js';

const CLASS_COLOUR={2:'#8d7a5b',6:'#8f979e',1:'#b9c1b5'};
const LOW=new THREE.Color('#a9cf9a'),HIGH=new THREE.Color('#2f5a2a');

export function mount(host,pts,{onState}={}){
  host.innerHTML='';
  const wrap=document.createElement('div');wrap.className='pts-view';
  const canvas=document.createElement('canvas');canvas.className='pts-canvas';
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`LiDAR returns inside this crown: ${pts.n} points, side view`);
  const axis=document.createElementNS('http://www.w3.org/2000/svg','svg');axis.setAttribute('class','pts-axis');axis.setAttribute('aria-hidden','true');
  wrap.append(canvas,axis);host.append(wrap);
  const styles=getComputedStyle(host);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  const scene=new THREE.Scene();scene.background=new THREE.Color(styles.getPropertyValue('--card').trim()||'#f6f8f4');

  // Positions in metres: x east, y up (height above the ground under the crown), z south.
  const n=pts.n,pos=new Float32Array(n*3),col=new Float32Array(n*3);
  let mx=0,my=0;for(let i=0;i<n;i++){mx+=pts.x[i];my+=pts.y[i];}mx/=n||1;my/=n||1;
  let top=0,radius=1;
  for(let i=0;i<n;i++){top=Math.max(top,pts.z[i]);radius=Math.max(radius,Math.hypot(pts.x[i]-mx,pts.y[i]-my));}
  const c=new THREE.Color();
  for(let i=0;i<n;i++){
    pos[i*3]=pts.x[i]-mx;pos[i*3+1]=pts.z[i];pos[i*3+2]=-(pts.y[i]-my);
    const k=pts.classification[i];
    if(CLASS_COLOUR[k])c.set(CLASS_COLOUR[k]);else if(k>=3&&k<=5)c.copy(LOW).lerp(HIGH,Math.max(0,Math.min(1,pts.z[i]/(top||1))));else c.set('#a7aea4');
    col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));geometry.setAttribute('color',new THREE.BufferAttribute(col,3));
  const cloud=new THREE.Points(geometry,new THREE.PointsMaterial({size:2.4,sizeAttenuation:false,vertexColors:true}));
  const group=new THREE.Group();group.add(cloud);scene.add(group);
  const ground=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:64},(_,i)=>new THREE.Vector3(radius*Math.cos(i*Math.PI/32),0,radius*Math.sin(i*Math.PI/32)))),
    new THREE.LineBasicMaterial({color:'#b4bfae'}));
  scene.add(ground);

  const camera=new THREE.OrthographicCamera(-1,1,1,-1,-1000,1000);
  const H=Math.max(top,2)*1.08,PAD=46;
  function size(){
    const w=Math.max(220,host.clientWidth),h=Math.round(Math.min(420,Math.max(280,w*.62)));
    renderer.setSize(w,h,false);canvas.style.width='100%';canvas.style.height=h+'px';
    // Same metres per pixel on both axes; the left margin holds the height scale.
    const mpp=Math.max(H/(h-24),(2*radius*1.15)/(w-PAD-8)),cx=(PAD-8)/2*mpp;
    camera.left=-w/2*mpp-cx;camera.right=w/2*mpp-cx;camera.top=H+12*mpp;camera.bottom=camera.top-h*mpp;
    camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
    drawAxis(w,h,mpp);draw();
  }
  function drawAxis(w,h,mpp){
    const step=top>30?10:top>12?5:top>5?2:1,y=v=>((camera.top-v)/mpp).toFixed(1),x=PAD-14;
    let s=`<path d="M${x} ${y(0)}V${y(Math.ceil(top/step)*step)}"/>`;
    for(let v=0;v<=top+1e-6;v+=step)s+=`<path d="M${x-4} ${y(v)}h4"/><text x="${x-7}" y="${(Number(y(v))+4).toFixed(1)}" text-anchor="end">${v}</text>`;
    axis.setAttribute('viewBox',`0 0 ${w} ${h}`);axis.innerHTML=s+`<text x="4" y="${Number(y(Math.ceil(top/step)*step))-8}">m</text>`;
  }
  let disposed=false;
  function draw(){if(!disposed)renderer.render(scene,camera);}
  // Turning: automatic unless the reader prefers reduced motion or takes over with the pointer.
  const still=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let spinning=!still,raf=null,last=performance.now();
  const tick=t=>{if(disposed||!spinning)return;group.rotation.y+=(t-last)*0.00035;last=t;draw();raf=requestAnimationFrame(tick);};
  function spin(on){spinning=on;onState?.({spinning});if(on){last=performance.now();raf=requestAnimationFrame(tick);}else if(raf)cancelAnimationFrame(raf);}
  let drag=null;
  canvas.addEventListener('pointerdown',e=>{spin(false);drag={x:e.clientX,r:group.rotation.y};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;group.rotation.y=drag.r+(e.clientX-drag.x)*.012;draw();});
  canvas.addEventListener('pointerup',()=>{drag=null;});
  const ro=new ResizeObserver(size);ro.observe(host);size();
  if(spinning)spin(true);
  return {spin,get spinning(){return spinning;},dispose(){disposed=true;ro.disconnect();if(raf)cancelAnimationFrame(raf);geometry.dispose();renderer.dispose();}};
}
