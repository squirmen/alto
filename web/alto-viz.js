/* Graphics drawn from one tree's own data, shared by the map panel, the tree page and the Area tab.
 *
 * Every figure here is computed from values the caller passes in (the crown outline, the aerial
 * imagery at the crown, the LiDAR return profile, survey heights, the release's growth constants).
 * Nothing is illustrative. Missing inputs return a one-line statement instead of a drawing. Icons
 * are only for buttons. Colours come from CSS classes so the tree page's dark theme applies. */
(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Numbers print by the one shared rule set (alto-format.js, FE-16).
  const F=root.ALTOFormat||(typeof require==='function'?require('./alto-format.js'):null);
  const num=F.num,nf=F.nf;
  const r1=v=>Math.round(v*10)/10;
  const parse=v=>{try{return typeof v==='string'?JSON.parse(v):v;}catch{return null;}};

  // ---- button icons (24 px grid, stroke) ----
  const P={
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    external:'<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    share:'<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
    bookmark:'<path d="M6 3.5h12v17l-6-4-6 4z"/>',
    cube:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    camera:'<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    download:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    shield:'<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    layers:'<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
    map:'<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5l-5.5 2.5-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    close:'<path d="M6 6l12 12M18 6L6 18"/>',
    back:'<path d="M15 5l-7 7 7 7"/>',
    copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    target:'<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    tree:'<path d="M12 21v-6"/><path d="M12 15c-4 0-6.5-2.3-6.5-5.3 0-2.6 1.9-4.4 4-4.7C10.3 3.6 11.1 3 12 3s1.7.6 2.5 2c2.1.3 4 2.1 4 4.7 0 3-2.5 5.3-6.5 5.3z"/>',
    play:'<path d="M8 5l11 7-11 7z"/>',
    pause:'<path d="M8 5v14M16 5v14"/>'
  };
  const icon=(name,size=18,cls='')=>`<svg class="ico ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name]||''}</svg>`;

  // ---- geometry helpers ----
  const rings=g=>!g?[]:g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():[];
  const mercX=lon=>(lon+180)/360;
  const mercY=lat=>{const r=lat*Math.PI/180;return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2;};
  function niceBar(metresPerPx,maxPx){for(const m of [1,2,5,10,20,25,50,100,200])if(m/metresPerPx>=maxPx*0.35)return m;return 200;}

  // Aerial imagery around the crown with its outline and the record's recorded position, at a stated
  // scale. Tiles: the aerial basemap in credits.js (Esri World Imagery unless basemap-config.js switches to LINZ
  // Basemaps); the caption names the capture (see imageryInfo) and the provider's credit.
  const ESRI='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
  const aerialTiles=()=>root.ALTOCredits?.AERIAL?.tiles||null;
  const pc=(v,of)=>Math.round(v/of*100000)/1000;
  function aerialChip({geometry=null,point=null,recorded=null,width=360,height=220,minSide=14,zoomMax=20,cls='',tiles=null,marks=[]}={}){
    const rs=rings(geometry),pts=rs.flat();
    const c=point||(pts.length?[pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length]:null);
    if(!c)return '<p class="viz-none">No position for this record.</p>';
    const lat=c[1],mPerUnit=40075016.686*Math.cos(lat*Math.PI/180); // metres per normalised mercator unit
    const xs=pts.map(p=>mercX(p[0])),ys=pts.map(p=>mercY(p[1]));
    let w=xs.length?Math.max(...xs)-Math.min(...xs):0,h=ys.length?Math.max(...ys)-Math.min(...ys):0;
    const cx=xs.length?(Math.max(...xs)+Math.min(...xs))/2:mercX(c[0]),cy=ys.length?(Math.max(...ys)+Math.min(...ys))/2:mercY(c[1]);
    const minU=minSide/mPerUnit;w=Math.max(w*1.5,minU);h=Math.max(h*1.5,minU);
    const scaleWorld=Math.min(width/w,height/h);                       // px per normalised unit
    const z=Math.max(15,Math.min(zoomMax,Math.floor(Math.log2(scaleWorld/256))));
    const k=scaleWorld/(256*2**z),W=256*2**z;                          // css px per tile px
    const left=cx*W-width/(2*k),top=cy*W-height/(2*k);
    const list=[];
    for(let tx=Math.floor(left/256);tx<=Math.floor((left+width/k)/256);tx++)for(let ty=Math.floor(top/256);ty<=Math.floor((top+height/k)/256);ty++)
      list.push(`<img src="${(tiles=tiles||aerialTiles())?esc(tiles.replace('{z}',z).replace('{y}',ty).replace('{x}',tx)):`${ESRI}/${z}/${ty}/${tx}`}" alt="" loading="lazy" decoding="async" style="left:${pc((tx*256-left)*k,width)}%;top:${pc((ty*256-top)*k,height)}%;width:${pc(256*k+0.6,width)}%;height:${pc(256*k+0.6,height)}%">`);
    const X=lon=>r1((mercX(lon)*W-left)*k),Y=la=>r1((mercY(la)*W-top)*k);
    const path=rs.map(ring=>'M'+ring.map(([lo,la])=>`${X(lo)} ${Y(la)}`).join('L')+'Z').join('');
    const mpp=mPerUnit/(W*k),bar=niceBar(mpp,width),barPx=bar/mpp;
    const rec=recorded?`<circle class="chip-recorded" cx="${X(recorded[0])}" cy="${Y(recorded[1])}" r="4.5"/>`:'';
    // Extra positions (e.g. where an earlier survey's canopy was matched), each with its own class, attributes and label.
    const extra=(marks||[]).filter(m=>num(m.lon)!==null&&num(m.lat)!==null).map(m=>`<g class="chip-mark ${esc(m.cls||'')}"${m.attrs||''}><circle cx="${X(m.lon)}" cy="${Y(m.lat)}" r="${m.r||6}"/>${m.label?`<text x="${r1(X(m.lon)+(m.r||6)+4)}" y="${r1(Y(m.lat)+4)}">${esc(m.label)}</text>`:''}</g>`).join('');
    const aria=`Aerial image of the crown with its outline${recorded?' and the recorded position':''}; scale bar ${bar} m`;
    return `<figure class="chip ${cls}"><div class="chip-frame" style="aspect-ratio:${width}/${height}">${list.join('')}
      <svg class="chip-overlay" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">${path?`<g class="chip-outline">${unionOutline(path,'#ffe14d',1.4,0.12)}</g>`:''}${rec}${extra}
      <g class="chip-scale" transform="translate(10 ${height-12})"><rect x="-4" y="-14" width="${r1(barPx)+34}" height="20" rx="3"/><path d="M0 0h${r1(barPx)}M0 -4v4M${r1(barPx)} -4v4"/><text x="${r1(barPx)+5}" y="2">${bar} m</text></g></svg></div></figure>`;
  }
  // Crowns arrive from the map tiles in pieces that overlap along tile edges. The outline of their union is
  // drawn with a dilate-and-cut filter, so tile seams never show as lines inside the crown.
  let uid=0;
  function unionOutline(d,colour,width,fillOpacity){
    const id='alto-ol-'+(++uid);
    return `<defs><filter id="${id}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="${width}" result="grown"/><feComposite in="grown" in2="SourceAlpha" operator="out" result="ring"/><feFlood flood-color="${colour}"/><feComposite in2="ring" operator="in"/></filter></defs>`+
      `<g opacity="${fillOpacity}"><path d="${d}" fill="#fff"/></g><path d="${d}" fill="#000" filter="url(#${id})"/>`;
  }
  // The capture behind the Esri tiles at a point (source, date, resolution), from Esri's own metadata. None when the
  // aerial basemap is LINZ Basemaps (its own credit names the imagery).
  const infoCache=new Map();
  function imageryInfo(lon,lat){
    if(root.ALTOCredits&&root.ALTOCredits.AERIAL?.provider!=='esri')return Promise.resolve(null);
    const key=`${lon.toFixed(4)},${lat.toFixed(4)}`;
    if(!infoCache.has(key)){
      const d=0.002,url=`https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify?geometry=${lon},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1&mapExtent=${lon-d},${lat-d},${lon+d},${lat+d}&imageDisplay=400,400,96&returnGeometry=false&f=json`;
      infoCache.set(key,fetch(url).then(r=>r.ok?r.json():null).then(j=>{
        const a=(j?.results||[]).map(x=>x.attributes||{}).find(x=>x.SOURCE_INFO&&x.SOURCE_INFO!=='Null'&&String(x['DATE (YYYYMMDD)']||'').length===8)||null;
        if(!a)return null;
        const s=String(a['DATE (YYYYMMDD)']),date=new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T12:00:00`);
        return {source:a.SOURCE_INFO,date:date.toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric'}),resolution:num(a['RESOLUTION (M)'])};
      }).catch(()=>null));
    }
    return infoCache.get(key);
  }
  const imageryCaption=i=>{const C=root.ALTOCredits,name=C?.AERIAL?.name||'Esri World Imagery',credit=C?` ${C.aerialFigure()}`:'';
    return (i?`Aerial: ${esc(i.source)}${i.resolution?`, ${nf(i.resolution*100,1)} cm`:''}, ${esc(i.date)} (${name}).`:`Aerial: ${name}.`)+credit;};

  // The crown outline alone, at a stated scale (for comparisons at one scale).
  function outline({geometry=null,width=120,height=96,metresAcross=null}={}){
    const rs=rings(geometry),pts=rs.flat();
    if(!pts.length)return '';
    const lat0=pts.reduce((s,p)=>s+p[1],0)/pts.length,lon0=pts.reduce((s,p)=>s+p[0],0)/pts.length,kx=Math.cos(lat0*Math.PI/180)*111320;
    const m=rs.map(ring=>ring.map(([lo,la])=>[(lo-lon0)*kx,-(la-lat0)*110540]));
    const all=m.flat(),minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1]));
    const across=metresAcross||Math.max(maxX-minX,maxY-minY)*1.15,s=Math.min(width,height-16)/across;
    const ox=width/2-(minX+maxX)/2*s,oy=(height-16)/2-(minY+maxY)/2*s;
    const d=m.map(ring=>'M'+ring.map(([x,y])=>`${r1(ox+x*s)} ${r1(oy+y*s)}`).join('L')+'Z').join('');
    const bar=niceBar(1/s,width),bp=bar*s;
    return `<svg class="viz viz-outline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Crown outline; scale bar ${bar} m">${unionOutline(d,'#4a6f46',1.1,0.22).replace('fill="#fff"','fill="#4a6f46"')}<path class="v-axis" d="M4 ${height-5}h${r1(bp)}M4 ${height-8}v6M${r1(4+bp)} ${height-8}v6"/><text class="v-tick" x="${r1(8+bp)}" y="${height-2}">${bar} m</text></svg>`;
  }

  // LiDAR returns by 1 m height band (the stored foliage profile), drawn as a side profile.
  function profile(foliage,{width=150,height=180,top=null,label=true}={}){
    const p=parse(foliage);
    if(!Array.isArray(p)||!p.length||!p.every(v=>typeof v==='number'&&v>=0))return '';
    const total=p.reduce((a,b)=>a+b,0);if(!total)return '';
    const max=Math.max(...p),bands=p.length,L=28,B=height-16,T=6,rowH=(B-T)/bands,Wd=width-L-6;
    let s='';
    p.forEach((v,i)=>{const y=B-(i+1)*rowH,w=v/max*Wd;if(v)s+=`<rect class="v-band-bar" x="${L}" y="${r1(y+0.5)}" width="${r1(w)}" height="${r1(Math.max(0.8,rowH-1))}"/>`;});
    const step=bands>30?10:bands>12?5:bands>5?2:1;
    for(let hgt=0;hgt<=bands;hgt+=step)s+=`<path class="v-axis" d="M${L-4} ${r1(B-hgt*rowH)}h4"/><text class="v-tick" x="${L-6}" y="${r1(B-hgt*rowH+3)}" text-anchor="end">${hgt}</text>`;
    if(num(top)!==null&&top<=bands)s+=`<path class="v-ref" d="M${L} ${r1(B-top*rowH)}H${width-4}"/>`;
    return `<svg class="viz viz-profile" viewBox="0 0 ${width} ${height}" role="img" aria-label="LiDAR returns by height band, ${nf(total)} returns, ${bands} one-metre bands"><path class="v-axis" d="M${L} ${T}V${B}H${width-4}"/>${s}${label?`<text class="v-tick" x="${L}" y="${height-3}">returns per 1 m band (n = ${nf(total)})</text>`:''}<text class="v-tick" x="2" y="${T+4}">m</text></svg>`;
  }

  // Height class (TS-07): the five stored classes as a plain scale named by size, with the tree's class marked. The
  // classes are tree-summary.js HEIGHT_CLASS; stage is a release 6.3 height_class key or a release 6.2 life_stage key.
  function stageScale(stage){
    const T=root.ALTOTreeSummary,C=T?T.HEIGHT_CLASS.map(c=>T.heightClass(c[0])):[],cur=T?.heightClass(stage),i=C.findIndex(c=>c.key===cur?.key);
    if(i<0)return '<p class="viz-none">Height class not estimated.</p>';
    return `<ol class="stage-scale" aria-label="Height class scale; this tree: ${esc(C[i].label)}">`+C.map((c,j)=>`<li${j===i?' class="is-current" aria-current="true"':''}><b>${esc(c.label)}</b><span>${esc(T.bandText(c))}</span></li>`).join('')+'</ol>';
  }

  // Years for a newly planted tree to reach this crown area at the release's planning growth rate
  // (crown area grows linearly at a class rate, as in replacement_years_canopy), with 25-100% marks.
  function replacementLine({years,startYear=new Date().getFullYear(),width=320,height=58}={}){
    const T=num(years);
    if(T===null||T<=0)return '';
    const L=12,R=width-14,Y=22,X=t=>L+(t/T)*(R-L);
    let s=`<path class="v-axis" d="M${L} ${Y}H${R}"/>`;
    for(const f of [0,0.25,0.5,0.75,1]){const x=r1(X(f*T)),yr=Math.round(startYear+f*T);s+=`<path class="v-axis" d="M${x} ${Y-5}v10"/><text class="v-tick${f===1?' v-strong':''}" x="${x}" y="${Y-9}" text-anchor="${f===0?'start':f===1?'end':'middle'}">${f===0?startYear:yr}</text><text class="v-tick" x="${x}" y="${Y+18}" text-anchor="${f===0?'start':f===1?'end':'middle'}">${f===0?'planted':Math.round(f*100)+'%'}</text>`;}
    return `<svg class="viz viz-replace" viewBox="0 0 ${width} ${height}" role="img" aria-label="A new tree planted in ${startYear} reaches this crown area in about ${nf(T)} years, by ${Math.round(startYear+T)}">${s}</svg>`;
  }

  // Composition of a set of trees: one stacked bar and its legend; segments can be made clickable.
  function composition(segments,{label='Composition',unit='trees',key=null}={}){
    const total=segments.reduce((s,x)=>s+(x.value||0),0);
    if(!total)return '<p class="viz-none">None in this area.</p>';
    const shown=segments.filter(x=>x.value>0);
    // A clickable row is a button inside its list item, so the list stays a list.
    const row=x=>{const inner=`<i${x.mark==='ringed-dot'?' class="is-ringed"':''} style="background:${esc(x.colour)}"></i><span>${esc(x.label)}</span><b>${nf(x.value)}</b><small>${nf(x.value/total*100,x.value/total<0.1?1:0)}%</small>`;
      return key&&x.key?`<li><button type="button" class="comp-row" data-highlight="${esc(key)}:${esc(x.key)}" data-label="${esc(x.label)} (${nf(x.value)})">${inner}</button></li>`:`<li>${inner}</li>`;};
    return `<div class="comp" role="group" aria-label="${esc(label)}"><div class="comp-bar" aria-hidden="true">`+
      shown.map(x=>`<span${x.mark==='ringed-dot'?' class="is-ringed"':''} style="flex:${x.value};background:${esc(x.colour)}" title="${esc(x.label)}: ${nf(x.value)} ${esc(unit)}"></span>`).join('')+
      `</div><ul class="comp-legend">`+shown.map(row).join('')+'</ul></div>';
  }
  // Binned counts as columns; each column can be made clickable.
  function columns(bins,{label='Distribution',width=280,height=96,key=null}={}){
    const max=Math.max(1,...bins.map(b=>b.value||0)),n=bins.length,gap=6,bw=(width-gap*(n-1))/n;
    let s='';bins.forEach((b,i)=>{const h=(b.value||0)/max*(height-34),x=i*(bw+gap);const hit=key&&b.key&&b.value?` data-highlight="${esc(key)}:${esc(b.key)}" data-label="${esc(b.full||b.label)} (${nf(b.value)})" role="button" tabindex="0" class="v-hit"`:'';
      s+=`<g${hit}><title>${esc(b.label)}: ${nf(b.value||0)}</title><rect class="v-col" x="${r1(x)}" y="${r1(height-20-h)}" width="${r1(bw)}" height="${r1(Math.max(h,b.value?1.5:0))}" rx="2"/><rect x="${r1(x)}" y="0" width="${r1(bw)}" height="${height}" fill="transparent"/><text class="v-tick" x="${r1(x+bw/2)}" y="${height-6}" text-anchor="middle">${esc(b.label)}</text>${b.value?`<text class="v-value" x="${r1(x+bw/2)}" y="${r1(height-24-h)}" text-anchor="middle">${nf(b.value)}</text>`:''}</g>`;});
    // A group, not an image, when its columns are buttons.
    return `<svg class="viz viz-cols" viewBox="0 0 ${width} ${height}" role="${key?'group':'img'}" aria-label="${esc(label)}: ${bins.map(b=>`${b.label} ${nf(b.value||0)}`).join(', ')}">${s}</svg>`;
  }
  // Calibrated class scores as horizontal bars. suffix names what each number is ("model score").
  function probabilities(rows,{suffix=null}={}){
    const shown=rows.filter(r=>num(r.value)!==null);
    if(!shown.length)return '';
    return '<ul class="prob-bars">'+shown.map(r=>`<li${r.top?' class="is-top"':''}><span>${esc(r.label)}</span><span class="prob-track"><span style="width:${Math.max(1,num(r.value)*100)}%"></span></span><b>${nf(num(r.value)*100,0)}%${suffix?` <small>${esc(suffix)}</small>`:''}</b></li>`).join('')+'</ul>';
  }
  const money=v=>F.money(v);
  function litres(m3){const n=num(m3);if(n===null)return null;const l=n*1000;return l>=1e6?`${nf(l/1000,0)} m³`:l>=1000?`${nf(Math.round(l/100)*100)} L`:`${nf(Math.round(l/10)*10)} L`;}
  const co2=t=>num(t)===null?null:F.co2(t,{unit:false});
  const profileCount=f=>{const p=parse(f);return Array.isArray(p)?p.reduce((a,b)=>a+(Number(b)||0),0):null;};
  const api={esc,num,nf,icon,parse,rings,profileCount,aerialChip,imageryInfo,imageryCaption,outline,profile,stageScale,replacementLine,composition,columns,probabilities,money,litres,co2};
  root.ALTOViz=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
