/* The Area tab: what the trees in a place add up to, for nested places that follow the map: the region,
 * the local board under the map centre, the current view and a selected property. The same summary and
 * components serve a later collection page (a park, a development, a portfolio of sites).
 *
 * View and board figures sum the markers the map has drawn after filters; below zoom 16 the tiles carry
 * a sample, and the figures say so. Property figures are the property record's own totals. Board figures
 * from the earlier canopy assessment are labelled with that source. Segments, columns and the tallest,
 * largest and highest-benefit trees carry data attributes the map uses to highlight or fly to them. */
(function(root){
  'use strict';
  const V=()=>root.ALTOViz,S=()=>root.ALTOSources,G=()=>root.ALTOGrowthForm,P=()=>root.ALTOPalette;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>v===null||v===undefined||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
  const nf=(v,d=0)=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:d}).format(v);
  const UNKNOWN=/^(unknown|unidentified( tree)?|not known|species not recorded|species unrecorded|0 records found\.?)$/i;
  // Model values follow the design system's precision (section 4.7): area totals to 3 significant figures,
  // one tree's benefit to 2; an Estimate badge marks every model value.
  const sig=(v,n)=>{if(!v)return 0;const k=Math.pow(10,n-Math.ceil(Math.log10(Math.abs(v))));return Math.round(v*k)/k;};
  const money=(v,n=3)=>'$'+nf(sig(v,n));
  const tonnes=(t,n=3)=>t<1?`${nf(sig(t*1000,2))} kg CO₂e`:`${nf(sig(t,n),1)} t CO₂e`;
  const EST='<span class="badge-estimate">Estimate</span>';
  const HEIGHT_BINS=[[0,5,'<5'],[5,10,'5–10'],[10,15,'10–15'],[15,20,'15–20'],[20,25,'20–25'],[25,1e9,'25+']];
  const UNCERTAIN=['possible','unverified','possible_duplicate','location_unverified'];

  function summarise(features){
    const seen=new Set(),a={count:0,crownArea:0,crownCount:0,heightSum:0,heightCount:0,tallest:null,largest:null,topValue:null,value:0,valueCount:0,runoff:0,carbon:0,pm25:0,
      protected:0,quality:{linked:0,probable:0,drawn:0,unlinked:0},uncertain:0,sources:{},stages:{},heights:HEIGHT_BINS.map(()=>0),growth:{},species:new Map(),recorded:0};
    const best=(slot,v,p,f)=>{if(v!==null&&(a[slot]===null||v>a[slot].value))a[slot]={value:v,id:p.tree_id,coords:f.geometry?.type==='Point'?f.geometry.coordinates:null,props:p};};
    for(const f of features){
      const p=f.properties||f,id=p.tree_id;if(!id||seen.has(id))continue;seen.add(id);a.count++;
      const c=S()?S().classify(p):{primary:'lidar',quality:'linked',protected:false};
      a.sources[c.primary]=(a.sources[c.primary]||0)+1;a.quality[c.quality]++;if(c.protected)a.protected++;
      if(UNCERTAIN.includes(p.evidence_tier))a.uncertain++;
      const area=num(p.crown_area_m2);if(area!==null&&area>0){a.crownArea+=area;a.crownCount++;best('largest',area,p,f);}
      const h=num(p.height_max_m)??num(p.crown_max_chm_m)??num(p.height_m);
      if(h!==null&&h>=0){a.heightSum+=h;a.heightCount++;best('tallest',h,p,f);a.heights[HEIGHT_BINS.findIndex(b=>h>=b[0]&&h<b[1])]++;}
      const v=num(p.total_value_nzd_y);if(v!==null){a.value+=v;a.valueCount++;best('topValue',v,p,f);}
      a.runoff+=num(p.avoided_runoff_m3_y)||0;a.carbon+=num(p.stored_co2e_tonnes_est)||0;a.pm25+=num(p.pm25_removed_kg_y)||0;
      if(p.life_stage)a.stages[p.life_stage]=(a.stages[p.life_stage]||0)+1;
      if(G()){const g=G().group(G().key(p));a.growth[g]=(a.growth[g]||0)+1;}
      const name=typeof p.species_common==='string'&&p.species_common.trim()&&!UNKNOWN.test(p.species_common.trim())?p.species_common.trim():null;
      if(name){a.recorded++;a.species.set(name,(a.species.get(name)||0)+1);}
    }
    a.meanHeight=a.heightCount?a.heightSum/a.heightCount:null;
    a.topSpecies=[...a.species].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0])).slice(0,6);
    a.speciesCount=a.species.size;
    return a;
  }
  // Map expressions for each highlight key, so a click on a segment rings those trees.
  function highlightExpr(kind,value){
    const h=['coalesce',['get','height_max_m'],['get','crown_max_chm_m'],-1];
    if(kind==='source'){const keys=P()?.legend('source')?.rows.find(r=>r.key===value)?.keys;return keys?['in',S().primaryExpr(),['literal',keys]]:['==',S().primaryExpr(),value];}
    if(kind==='stage')return ['==',['get','life_stage'],value];
    if(kind==='height'){const b=HEIGHT_BINS[Number(value)];return b?['all',['>=',h,b[0]],['<',h,b[1]]]:null;}
    if(kind==='growth'){if(!G())return null;const keys=P()?.legend('structure')?.rows.find(r=>r.key===value)?.keys;return keys?['in',G().groupExpr(),['literal',keys]]:['==',G().groupExpr(),value];}
    if(kind==='species')return ['==',['get','species_common'],value];
    if(kind==='quality')return S().quality(value)?.match||null;
    if(kind==='protected')return S().protectedExpr;
    if(kind==='uncertain')return ['in',['coalesce',['get','evidence_tier'],''],['literal',UNCERTAIN]];
    if(kind==='tree')return ['==',['get','tree_id'],value];
    return null;
  }
  const row=(label,value,sub,go)=>`<div class="ar-row"><dt>${esc(label)}</dt><dd>${value}${sub?`<small>${sub}</small>`:''}${go?`<button type="button" class="link-button ar-go" data-area-go="${go}">Show on map</button>`:''}</dd></div>`;
  const ha=m2=>m2>=10000?`${nf(m2/10000,m2>=1e6?0:1)} ha`:`${nf(m2)} m²`;
  const swatch=(colour,mark='dot')=>`<i class="sw sw-${mark}" style="--sw:${esc(colour)}"></i>`;
  const card=(title,body,note)=>`<section class="area-card"><h3>${title}</h3>${body}${note?`<p class="area-note">${note}</p>`:''}</section>`;

  function breakdowns(a){
    let h='';
    // Categories as the map legend shows them (OpenStreetMap and the RŪRU kauri survey are one colour, community records).
    const sum=(rec,keys)=>keys.reduce((t,k)=>t+(rec[k]||0),0);
    const src=P()?P().rows('source').map(x=>({key:x.key,label:x.label,value:sum(a.sources,x.keys||[x.key]),colour:x.colour})):[];
    h+=card('Trees by source',V().composition(src,{label:'Trees by source',key:'source'}));
    const stages=V().STAGES.map(([k,label])=>({key:k,full:label,label:label.replace('Semi-mature','Semi').replace('Juvenile','Juv.'),value:a.stages[k]||0}));
    if(stages.some(x=>x.value))h+=card(`Life stage ${EST}`,V().columns(stages,{label:'Trees by life stage',key:'stage'}),'Height as a share of the class reference height.');
    if(a.heightCount)h+=card('Height (m)',V().columns(HEIGHT_BINS.map((b,i)=>({key:String(i),label:b[2],full:`${b[2]} m tall`,value:a.heights[i]})),{label:'Trees by height',key:'height'}),'Highest LiDAR return in the crown, 2024 LiDAR survey.');
    if(G()&&Object.entries(a.growth).some(([k,v])=>k!=='none'&&v))
      h+=card(`Growth form ${EST}`,V().composition((P()?P().rows('structure'):[]).map(x=>({key:x.key,label:x.label,value:sum(a.growth,x.keys||[x.key]),colour:x.colour})),{label:'Trees by estimated growth form',key:'growth'}),'Estimated from the 2024 LiDAR survey and aerial imagery.');
    if(a.topSpecies.length)h+=card('Recorded species',`<ol class="area-species">${a.topSpecies.map(([n,c])=>`<li><button type="button" data-highlight="species:${esc(n)}" data-label="${esc(n)} (${nf(c)})"><span>${esc(n)}</span><b>${nf(c)}</b></button></li>`).join('')}</ol>`,`${nf(a.recorded)} of ${nf(a.count)} trees with a recorded species; ${nf(a.speciesCount)} names.`);
    else h+=card('Recorded species','<p class="area-note">No recorded species in this area.</p>');
    const q=a.quality;
    const C=(l,k)=>P()?P().colour(l,k):'';
    const li=(hl,label,value,sw)=>`<li><button type="button" data-highlight="${hl}" data-label="${esc(label)} (${nf(value)})">${sw}<span>${esc(label)}</span><b>${nf(value)}</b></button></li>`;
    h+=card('Protection and links',`<ul class="area-quality">
      ${li('protected:1','Protected',a.protected,swatch(P()?P().token('--color-protected'):'','ring'))}
      ${li('quality:unlinked','No crown linked',q.unlinked,swatch(C('quality','unlinked'),'hollow'))}
      ${li('quality:probable','Probable link',q.probable,swatch(C('quality','probable')))}
      ${li('quality:drawn','Crown drawn from the record',q.drawn,swatch(C('quality','drawn')))}
      ${li('uncertain:1','Possible or unverified detection',a.uncertain,swatch(C('evidence','unverified')))}</ul>`);
    return h;
  }
  function liveRows(a){
    return `<dl class="ar">${row('Trees',nf(a.count),a.protected?`${nf(a.protected)} protected`:'')}
      ${row('Crown area',ha(a.crownArea),'sum of crowns, overlaps included')}
      ${row('Tallest',a.tallest?`${nf(a.tallest.value,1)} m`:'—',a.meanHeight!==null?`mean ${nf(a.meanHeight,1)} m`:'',a.tallest?.coords?'tallest':null)}
      ${row('Largest crown',a.largest?`${nf(a.largest.value)} m²`:'—','',a.largest?.coords?'largest':null)}
      ${row('Benefits',a.value?`${money(a.value)}/yr ${EST}`:'—','sum of the trees’ yearly estimates',null)}
      ${row('Highest single benefit',a.topValue?`${money(a.topValue.value,2)}/yr ${EST}`:'—','',a.topValue?.coords?'topValue':null)}
      ${row('Carbon stored',a.carbon?`${tonnes(a.carbon)} ${EST}`:'—','')}
      ${row('Stormwater',a.runoff?`${nf(sig(a.runoff,3))} m³/yr ${EST}`:'—','runoff avoided')}</dl>`;
  }
  // scope: {kind:'region'|'board'|'view'|'property', title, subtitle, sample, property, board, totals, empty}
  function render(a,scope){
    let h=`<header class="area-head"><p class="area-kicker">${esc({region:'Region',board:'Local board',view:'Map view',property:'Property'}[scope.kind]||'Area')}</p><h2>${esc(scope.title)}</h2>${scope.subtitle?`<p class="area-sub">${esc(scope.subtitle)}</p>`:''}</header>`;
    if(scope.kind==='region'){
      const t=scope.totals||{};
      h+=`<dl class="ar">${row('Trees on the map',t.trees!=null?nf(t.trees):'—','')}${row('Crowns',t.crowns!=null?nf(t.crowns):'—','')}${row('Protected',t.protected!=null?nf(t.protected):'—','')}
        ${row('Benefits',t.value!=null?`${money(t.value)}/yr ${EST}`:'—','sum of the trees’ yearly estimates')}${row('Stormwater',t.runoff!=null?`${nf(sig(t.runoff,3))} m³/yr ${EST}`:'—','runoff avoided')}${row('Carbon stored',t.carbon!=null?`${tonnes(t.carbon)} ${EST}`:'—','')}</dl>
        <p class="area-note">Totals for ${esc(scope.release||'the current release')}. For composition by source, life stage and species, choose a local board or this view.</p>`;
      return h;
    }
    if(scope.kind==='board'&&scope.board){
      const b=scope.board;
      h+=`<dl class="ar">${row('Land area',num(b.land_area_km2)!==null?`${nf(b.land_area_km2,1)} km²`:'—','')}${row('Canopy cover',num(b.canopy_cover_pct)!==null?`${nf(b.canopy_cover_pct)}%`:'—',`earlier canopy assessment${b.fully_assessed?'':'; the board is partly outside the assessed area'}`)}
        ${row('Mapped trees',num(b.tree_count)!==null?nf(b.tree_count):'—','earlier map, Sep 2026')}</dl><h3 class="ar-sub">Trees drawn inside the board</h3>`;
    }
    const P=scope.property?.property||null;
    if(P){
      h+=`<dl class="ar">${row('Trees counted',nf(num(P.n_trees)||0),`${nf(num(P.n_confident)||0)} confident · ${nf(num(P.n_uncertain)||0)} possible`)}
        ${row('Canopy over the parcel',`${nf(num(P.canopy_m2)||0)} m²`,`${nf(num(P.canopy_cover_pct)||0)}% of ${ha(num(P.area_m2)||0)}`)}
        ${row('Tallest',num(P.tallest_m)!==null?`${nf(P.tallest_m,1)} m`:'—','',a.tallest?.coords?'tallest':null)}
        ${row('Benefits',num(P.total_value_nzd_y)?`${money(P.total_value_nzd_y,2)}/yr ${EST}`:'—',num(P.total_value_nzd_y)&&num(P.total_value_nzd_y_low)!==null?`range ${money(P.total_value_nzd_y_low,2)}–${money(P.total_value_nzd_y_high,2)}/yr`:num(P.n_trees)?'':'no trees counted')}
        ${row('Carbon stored',num(P.stored_co2e_tonnes_est)?`${tonnes(num(P.stored_co2e_tonnes_est),2)} ${EST}`:'—','')}
        ${row('Stormwater',num(P.avoided_runoff_m3_y)?`${nf(sig(P.avoided_runoff_m3_y,2),1)} m³/yr ${EST}`:'—','runoff avoided')}</dl>`;
      if(a.count)h+=breakdowns(a);
      return h;
    }
    if(!a.count)return h+`<p class="area-note">${esc(scope.empty||'No trees drawn here. Move the map, zoom in or clear filters.')}</p>`;
    if(scope.sample)h+='<p class="area-sample" role="note">Showing a sample at this zoom. Zoom in to see every tree.</p>';
    return h+liveRows(a)+breakdowns(a);
  }
  const api={summarise,render,highlightExpr,HEIGHT_BINS};
  root.ALTOArea=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
