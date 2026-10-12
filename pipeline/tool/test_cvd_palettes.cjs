// Colour-vision check for every map legend (web/palette.js), so a palette that some readers cannot tell
// apart can never return. Usage: node pipeline/tool/test_cvd_palettes.cjs [--table]
//
// Method. Each legend colour is taken from web/tokens.css (the design system's tokens, light theme). Area
// fills are composited at the opacity the map draws them over the light basemap (#ebebe8). Each colour is
// simulated for protanopia, deuteranopia and tritanopia with the Machado, Oliveira & Fernandes (2009)
// matrices at severity 1.0 (complete dichromacy, the hardest case; anomalous trichromats see more),
// applied to linear RGB. Colour difference is CIEDE2000 (CIELAB, D65).
//
// Rule. Within everything the map can show at once (a colour mode, its marks, and the layers that can be
// on with it at the same zoom), any two categories drawn with the same mark must differ by at least
// ΔE2000 9 for normal vision and for each simulation. Categories with different marks (dot, ring, hollow,
// dashed ring, triangle, diamond, crown, dashed crown, fill, outline) are told apart by shape, as the design
// system specifies. Why 9: several just-noticeable differences (about 1 ΔE2000 for large flat patches) for
// marks a few pixels across. It fails every palette the design-system audit rejected (tool v0.2's red
// against green for "Change since 2013": 6.2 under deuteranopia; Data quality's drawn against probable: 3.2
// under protanopia; LiDAR violet against Auckland Transport blue: 2.9 under deuteranopia), and it passes the
// design system's ordinal ramps, whose neighbouring steps are 9.8–10.3 for every reader. Brick (Notable
// Trees schedule) against green (Council Parks) is 17.4 under deuteranopia and 25.0 under protanopia.
// Ordinal legends must also keep lightness monotone, so their order reads without hue.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web');
const P=require(path.join(web,'palette.js'));
const THRESHOLD=9, BASEMAP='#ebebe8';
const VISION=[null,'protanopia','deuteranopia','tritanopia'];
const MACHADO={ // Machado et al. 2009, Table "severity 1.0"
  protanopia:[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
  deuteranopia:[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
  tritanopia:[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]};

// ---- colour maths
const hex=h=>{h=String(h).trim().replace('#','');if(h.length===3)h=[...h].map(c=>c+c).join('');assert.match(h,/^[0-9a-f]{6}$/i,`not a hex colour: ${h}`);return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);};
const toLinear=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
const clamp=x=>Math.min(1,Math.max(0,x));
function simulate(rgb,type){const l=rgb.map(toLinear);if(!type)return l;return MACHADO[type].map(r=>clamp(r[0]*l[0]+r[1]*l[1]+r[2]*l[2]));}
function lab([r,g,b]){
  const X=(0.4124564*r+0.3575761*g+0.1804375*b)/0.95047,Y=0.2126729*r+0.7151522*g+0.0721750*b,Z=(0.0193339*r+0.1191920*g+0.9503041*b)/1.08883;
  const f=t=>t>216/24389?Math.cbrt(t):(24389/27*t+16)/116;return [116*f(Y)-16,500*(f(X)-f(Y)),200*(f(Y)-f(Z))];}
function de2000([L1,a1,b1],[L2,a2,b2]){ // Sharma, Wu & Dalal (2005)
  const rad=Math.PI/180,C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cb=(C1+C2)/2,G=0.5*(1-Math.sqrt(Cb**7/(Cb**7+25**7)));
  const a1p=(1+G)*a1,a2p=(1+G)*a2,C1p=Math.hypot(a1p,b1),C2p=Math.hypot(a2p,b2);
  const hue=(x,y)=>{if(!x&&!y)return 0;const t=Math.atan2(y,x)/rad;return t<0?t+360:t;},h1=hue(a1p,b1),h2=hue(a2p,b2);
  let dh=0;if(C1p*C2p){dh=h2-h1;if(dh>180)dh-=360;else if(dh<-180)dh+=360;}
  const dL=L2-L1,dC=C2p-C1p,dH=2*Math.sqrt(C1p*C2p)*Math.sin(dh*rad/2),Lb=(L1+L2)/2,Cbp=(C1p+C2p)/2;
  let hb=h1+h2;if(C1p*C2p)hb=Math.abs(h1-h2)>180?(h1+h2+(h1+h2<360?360:-360))/2:(h1+h2)/2;
  const T=1-0.17*Math.cos((hb-30)*rad)+0.24*Math.cos(2*hb*rad)+0.32*Math.cos((3*hb+6)*rad)-0.20*Math.cos((4*hb-63)*rad);
  const Rc=2*Math.sqrt(Cbp**7/(Cbp**7+25**7)),Sl=1+0.015*(Lb-50)**2/Math.sqrt(20+(Lb-50)**2),Sc=1+0.045*Cbp,Sh=1+0.015*Cbp*T;
  const Rt=-Math.sin(2*30*Math.exp(-(((hb-275)/25)**2))*rad)*Rc;
  return Math.sqrt((dL/Sl)**2+(dC/Sc)**2+(dH/Sh)**2+Rt*(dC/Sc)*(dH/Sh));}
const dE=(x,y,type)=>de2000(lab(simulate(hex(x),type)),lab(simulate(hex(y),type)));
// Reference values (Sharma et al. 2005, pairs 1 and 17) and a known failure: the old change palette.
assert.ok(Math.abs(de2000([50,2.6772,-79.7751],[50,0,-82.7485])-2.0425)<1e-3,'CIEDE2000 pair 1');
assert.ok(Math.abs(de2000([50,2.5,0],[73,25,-18])-27.1492)<1e-3,'CIEDE2000 pair 17');
for(const [a,b,v] of [['#d6322b','#2f9e44','deuteranopia'],['#d9a33a','#7fae4e','protanopia'],['#8a4ea8','#4267ac','deuteranopia']])
  assert.ok(dE(a,b,v)<THRESHOLD,`tool v0.2's ${a} against ${b} must fail for ${v}`);

// ---- the tokens the browser uses
const css=fs.readFileSync(path.join(web,'tokens.css'),'utf8');
const rootBlock=css.slice(css.indexOf(':root {'),css.indexOf('/* Dark theme'));
const TOK={};for(const m of rootBlock.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))TOK[m[1]]=m[2].trim();
function resolve(name,seen=new Set()){
  assert.ok(!seen.has(name),`token cycle at ${name}`);seen.add(name);
  const v=TOK[name];assert.ok(v!==undefined,`${name} is not in web/tokens.css`);
  const m=/^var\((--[a-z0-9-]+)\)$/.exec(v);return m?resolve(m[1],seen):v;}
// palette.js's built-in values (Node, first paint) are the tokens' values.
for(const [name,value] of Object.entries(P.FALLBACK))assert.equal(resolve(name).toLowerCase().replace(/\s+/g,' '),value.toLowerCase(),`palette.js FALLBACK ${name}`);
for(const [name,target] of Object.entries(P.ALIAS))assert.equal(resolve(name),resolve(target),`palette.js ALIAS ${name}`);

// ---- each category as the reader sees it
const over=(c,a)=>{if(a==null||a>=1)return c;const x=hex(c),y=hex(BASEMAP);return '#'+x.map((v,i)=>Math.round((a*v+(1-a)*y[i])*255).toString(16).padStart(2,'0')).join('');};
const seenAs=(legend)=>P.legend(legend).rows.map(r=>({legend,key:r.key,label:r.label,mark:r.mark,token:r.token,colour:over(resolve(r.token),r.mark==='fill'?r.alpha??1:1)}));
for(const k of Object.keys(P.LEGENDS))for(const r of P.legend(k).rows){
  assert.ok(r.label&&!/\bv\d|\(model\)|dev\b/i.test(r.label),`${k}.${r.key}: label "${r.label}"`);
  if(r.mark==='fill')assert.ok(r.alpha>0&&r.alpha<=1,`${k}.${r.key}: a fill needs its map opacity`);
}
function check(name,rows){
  const worst={};
  for(const v of VISION){
    let w={d:Infinity};
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
      const a=rows[i],b=rows[j];if(a.mark!==b.mark)continue;
      const d=dE(a.colour,b.colour,v);if(d<w.d)w={d,a,b};
      assert.ok(d>=THRESHOLD,`${name}: "${a.label}" (${a.legend}) and "${b.label}" (${b.legend}) are ΔE2000 ${d.toFixed(1)} apart for ${v||'normal vision'} (minimum ${THRESHOLD})`);
    }
    worst[v||'normal']=w;
  }
  return worst;
}
const report=[];
// 1. Every legend on its own.
for(const k of Object.keys(P.LEGENDS))report.push([k,check(k,seenAs(k))]);
// 2. Everything that can be on the map together: a colour mode, its marks, and up to two layers whose zooms
//    overlap (area fills are one at a time).
const overlap=(a,b)=>{const [x0,x1]=P.ZOOMS[a],[y0,y1]=P.ZOOMS[b];return Math.max(x0,y0)<Math.min(x1,y1);};
const combos=[[],...P.OVERLAYS.map(o=>[o])];
for(let i=0;i<P.OVERLAYS.length;i++)for(let j=i+1;j<P.OVERLAYS.length;j++){
  const a=P.OVERLAYS[i],b=P.OVERLAYS[j];
  if(P.FILL_THEMES.includes(a)&&P.FILL_THEMES.includes(b))continue;
  if(overlap(a,b))combos.push([a,b]);
}
let views=0;
for(const mode of P.MODES)for(const layers of combos){
  if(layers.some(l=>!overlap('markers',l)))continue;
  const rows=[...seenAs(mode),...P.marksFor(mode).map(r=>({legend:'marks',key:r.key,label:r.label,mark:r.mark,colour:resolve(r.token)})),...layers.flatMap(seenAs)];
  const w=check([mode,...layers].join(' + '),rows);views++;
  if(!layers.length)report.push([`${mode} + marks`,w]);
}
// 3. Ordered legends read in order without hue: lightness moves one way along the rows (fold rows aside).
const L=c=>lab(simulate(hex(c),null))[0];
for(const [k,leg] of Object.entries(P.LEGENDS)){
  if(leg.kind!=='ordinal')continue;
  const ls=seenAs(k).filter(r=>!/neutral|conf-none|--viz-other/.test(r.token)&&!['hollow','dashed-ring','dashed-outline'].includes(r.mark)).map(r=>L(r.colour));
  const up=ls.every((x,i)=>!i||x>ls[i-1]),down=ls.every((x,i)=>!i||x<ls[i-1]);
  assert.ok(up||down,`${k}: lightness is not monotone (${ls.map(x=>x.toFixed(0)).join(', ')})`);
}
// 4. No colour outside the palette: map paint colours in index.html and the modules that draw categories
//    come from palette.js (tokens), never from a literal.
const page=fs.readFileSync(path.join(web,'index.html'),'utf8');
const literal=page.match(/"(?:circle|fill|line|icon|text)-(?:color|stroke-color|outline-color|halo-color)"\s*:\s*"#[0-9a-f]{3,8}"/gi);
assert.equal(literal,null,`map paint colours must come from palette.js: ${literal}`);
for(const f of ['sources.js','growth-form.js','area.js','record-links.js','tree-page.js','tree-instrument.js','tree-panel.js','tree-imagery.js']){
  const hexes=fs.readFileSync(path.join(web,f),'utf8').match(/['"`]#[0-9a-f]{6}['"`;]/gi);
  assert.equal(hexes,null,`${f}: colour literals ${hexes}`);
}
assert.ok(/FILL_THEME_FLAGS/.test(page)&&/exclusiveFill\(/.test(page),'index.html keeps area fills one at a time');

// 5. The tree panel and tree page draw marks over aerial imagery: the crown figure, the page's map and the survey
//    year chosen in the panel, on the map. Each mark has its own shape, named in the figure's key (tree-instrument.js
//    figureKey: outline, ring, dashed ring). The two ring-shaped marks must also differ by colour for every reader,
//    so a reader who misses the dash still tells the recorded position from an earlier survey's match.
const FIG=[{key:'crown',label:'This crown, 2024',mark:'outline',token:'--viz-overlay-focus'},
  {key:'dim',label:'2024 crown while an earlier survey is selected',mark:'dashed-outline',token:'--neutral-0'},
  {key:'recorded',label:'Recorded position',mark:'ring',token:'--viz-overlay-position'},
  {key:'matched',label:'Where an earlier survey was matched (dashed)',mark:'ring',token:'--viz-overlay-alt'}].map(r=>({...r,legend:'tree figure',colour:resolve(r.token)}));
report.push(['tree figures',check('tree figures',FIG)]);
const instCss=fs.readFileSync(path.join(web,'tree-instrument.css'),'utf8');
for(const r of FIG.filter(x=>x.key!=='dim'))assert.ok(instCss.includes(`var(${r.token})`),`tree-instrument.css draws ${r.key} with ${r.token}`);
assert.ok(/\.chip-mark circle \{[^}]*stroke-dasharray/.test(instCss),'an earlier survey\'s match is a dashed ring');

if(process.argv.includes('--table')){
  const f=w=>`${w.d.toFixed(1).padStart(5)} ${w.a?`${w.a.key}/${w.b.key}`:'(one per mark)'}`;
  console.log(`Minimum CIEDE2000 between same-mark categories (threshold ${THRESHOLD})`);
  console.log('legend or view'.padEnd(26),VISION.map(v=>(v||'normal').padEnd(30)).join(''));
  for(const [name,w] of report)console.log(name.padEnd(26),VISION.map(v=>{const x=w[v||'normal'];return (x.d===Infinity?'  –':f(x)).padEnd(30);}).join(''));
}
console.log(`Colour vision: ${Object.keys(P.LEGENDS).length} legends and ${views} map views pass ΔE2000 ≥ ${THRESHOLD} for normal vision, protanopia, deuteranopia and tritanopia (Machado 2009).`);
