/* The Area tab: what the trees in a place add up to, for nested places that follow the map: the region,
 * the local board under the map centre, the current view and a selected property. The same summary and
 * components serve a later collection page (a park, a development, a portfolio of sites).
 *
 * View and board figures count the markers the map has drawn after filters. Below zoom 16 the tiles carry a
 * sample: the count says so, and crown area, height, the tallest, benefits, carbon and stormwater are not summed
 * over it ("Zoom in to 16 to total this view"). Auckland's figures are the release's own totals (release
 * metadata). Property figures are the property record's own totals. Board figures from the earlier canopy
 * assessment are labelled with that source. Heights of 55 m or more are left out of "tallest" and listed apart
 * (they may be a power line, a structure or noise). At zoom 16 or more the tallest, largest and highest-benefit rows
 * say "in this view". Auckland and a local board show their Species maxima (the release's maxima.json), never a maximum
 * over the markers drawn. Segments, columns and the tallest, largest and highest-benefit trees carry data attributes
 * the map uses to highlight or fly to them. */
(function(root){
  'use strict';
  const V=()=>root.ALTOViz,S=()=>root.ALTOSources,G=()=>root.ALTOGrowthForm,P=()=>root.ALTOPalette;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Numbers print by the one shared rule set (alto-format.js, FE-16): the panel, the tree page, Area and property agree.
  const F=root.ALTOFormat||(typeof require==='function'?require('./alto-format.js'):null);
  const num=F.num,nf=F.nf,NONE=F.MISSING;
  const UNKNOWN=/^(unknown|unidentified( tree)?|not known|species not recorded|species unrecorded|0 records found\.?)$/i;
  // Model values follow the design system's precision (section 4.7): area totals to 3 significant figures,
  // one tree's benefit to 2; an Estimate badge marks every model value.
  const money=(v,n=3)=>F.money(v,{sig:n});
  const tonnes=(t,n=3)=>F.co2(t,{sig:n});
  const EST='<span class="badge-estimate">Estimate</span>';
  const NOT_RANGED='Estimate · range not computed';
  // Heights of 55 m or more are listed apart: tree-record.js TALL_M is the one constant for "unusually tall for Auckland".
  const REC=()=>root.ALTOTreeRecord||(typeof require==='function'?require('./tree-record.js'):null);
  const tallM=()=>REC().TALL_M;
  const tallNote=()=>`${REC().TALL_TEXT.replace(/; not used in rankings$/,'')}; not in the figures above`;
  // Height classes (decision TS-07): tree-summary.js HEIGHT_CLASS, named by size; release 6.3 stores height_class,
  // release 6.2 the same classes as life_stage (release-fields.js reads either).
  const SUM=()=>root.ALTOTreeSummary||(typeof require==='function'?require('./tree-summary.js'):null);
  const FD=()=>root.ALTOFields||(typeof require==='function'?require('./release-fields.js'):null);
  // "about NZ$295 million", "about 20.5 million m³": release totals rounded, never to the dollar.
  const about=F.about;
  const HEIGHT_BINS=[[0,5,'<5'],[5,10,'5–10'],[10,15,'10–15'],[15,20,'15–20'],[20,25,'20–25'],[25,1e9,'25+']];
  const UNCERTAIN=['possible','unverified','possible_duplicate','location_unverified'];

  function summarise(features){
    const seen=new Set(),a={count:0,crownArea:0,crownCount:0,heightSum:0,heightCount:0,tallest:null,tall:[],flagged:0,largest:null,topValue:null,value:0,valueCount:0,valueBasis:null,runoff:0,carbon:0,pm25:0,
      protected:0,quality:{linked:0,probable:0,drawn:0,unlinked:0},uncertain:0,sources:{},stages:{},heights:HEIGHT_BINS.map(()=>0),growth:{},species:new Map(),recorded:0,multi:new Map(),multiCount:0};
    const best=(slot,v,p,f)=>{if(v!==null&&(a[slot]===null||v>a[slot].value))a[slot]={value:v,id:p.tree_id,coords:f.geometry?.type==='Point'?f.geometry.coordinates:null,props:p};};
    for(const f of features){
      const p=f.properties||f,id=p.tree_id;if(!id||seen.has(id))continue;seen.add(id);a.count++;
      const c=S()?S().classify(p):{primary:'lidar',quality:'linked',protected:false};
      a.sources[c.primary]=(a.sources[c.primary]||0)+1;a.quality[c.quality]++;if(c.protected)a.protected++;
      if(UNCERTAIN.includes(p.evidence_tier))a.uncertain++;
      // Release 6.3 flags (release-fields.js): a marker whose height or record link is flagged never ranks as the largest,
      // tallest or highest-benefit tree in view; its counted values stay in the sums (a height not plausible carries none).
      const flagged=FD().flagged(p),hc=FD().heightCheck(p);
      const area=num(p.crown_area_m2);if(area!==null&&area>0){a.crownArea+=area;a.crownCount++;if(!flagged)best('largest',area,p,f);}
      const h=num(p.height_max_m)??num(p.crown_max_chm_m)??num(p.height_m);
      // 55 m or more, or a height the release's height check flags: listed apart, never the tallest or in the mean.
      if(h!==null&&(hc||h>=tallM()))a.tall.push({value:h,id,check:hc,coords:f.geometry?.type==='Point'?f.geometry.coordinates:null,props:p});
      else if(h!==null&&h>=0){a.heightSum+=h;a.heightCount++;if(!flagged)best('tallest',h,p,f);a.heights[HEIGHT_BINS.findIndex(b=>h>=b[0]&&h<b[1])]++;}
      // Benefits: release 6.3's benefit_value_nzd_y (stormwater and carbon), release 6.2's total_value_nzd_y.
      const fb=FD().benefit(p),v=fb?.value??null;if(v!==null){a.value+=v;a.valueCount++;a.valueBasis=a.valueBasis||fb.basis;if(!flagged)best('topValue',v,p,f);}
      if(flagged)a.flagged++;
      a.runoff+=num(p.avoided_runoff_m3_y)||0;a.carbon+=num(p.stored_co2e_tonnes_est)||0;a.pm25+=num(p.pm25_removed_kg_y)||0;
      const stage=FD().heightClassKey(p);if(stage)a.stages[stage]=(a.stages[stage]||0)+1;
      if(G()){const g=G().group(G().key(p));a.growth[g]=(a.growth[g]||0)+1;}
      const name=typeof p.species_common==='string'&&p.species_common.trim()&&!UNKNOWN.test(p.species_common.trim())?p.species_common.trim():null;
      // One entry per species, its spellings together (Species filter's grouping: species-names.js key); a source string
      // naming several species ("Rata,Rimu") is not a species: counted apart, as the filter's "Recorded as: …" options.
      if(name){
        a.recorded++;const N=root.ALTOSpeciesNames;
        if(N?N.isMulti(name):/,/.test(name)){a.multiCount++;a.multi.set(name,(a.multi.get(name)||0)+1);}
        else{const latin=typeof p.species_latin==='string'&&p.species_latin.trim()?p.species_latin.trim():null,k=N?N.key(name,{latin}):name.toLowerCase(),g=a.species.get(k)||{n:0,names:new Map(),latin:new Map(),pairs:new Map()};
          g.n++;g.names.set(name,(g.names.get(name)||0)+1);if(latin&&!g.latin.has(name))g.latin.set(name,latin);
          const pk=`${name}\u0000${latin||''}`;if(!g.pairs.has(pk))g.pairs.set(pk,[name,latin]);a.species.set(k,g);}
      }
    }
    a.meanHeight=a.heightCount?a.heightSum/a.heightCount:null;
    a.tall.sort((x,y)=>y.value-x.value);
    // The group's name as the tree pages give it: its commonest spelling, beside that spelling's Latin name ("Cherry" with
    // Prunus serrulata is Japanese flowering cherry, species-names.js).
    const shown=g=>{const N=root.ALTOSpeciesNames,raw=[...g.names].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]))[0][0];return N?N.display(raw,{latin:g.latin.get(raw)||null})||raw:raw;};
    // A group holding a name that some Latin names turn into another species ("Cherry": Prunus serrulata is Japanese
    // flowering cherry) is shown on the map by its records' name and Latin name pairs, so the two groups ring apart.
    const split=g=>{const N=root.ALTOSpeciesNames;return !!N?.splits&&[...g.names.keys()].some(n=>N.splits(n));};
    a.topSpecies=[...a.species.values()].map(g=>({label:shown(g),n:g.n,names:[...g.names.keys()].sort(),pairs:split(g)?[...g.pairs.values()].sort((x,y)=>(x[0]+(x[1]||'')).localeCompare(y[0]+(y[1]||''))):null}))
      .sort((x,y)=>y.n-x.n||x.label.localeCompare(y.label)).slice(0,6);
    a.speciesCount=a.species.size;
    return a;
  }
  // Map expressions for each highlight key, so a click on a segment rings those trees.
  function highlightExpr(kind,value){
    const h=['coalesce',['get','height_max_m'],['get','crown_max_chm_m'],-1];
    if(kind==='source'){const keys=P()?.legend('source')?.rows.find(r=>r.key===value)?.keys;return keys?['in',S().primaryExpr(),['literal',keys]]:['==',S().primaryExpr(),value];}
    if(kind==='stage')return FD().heightClassExpr(value);
    if(kind==='height'){const b=HEIGHT_BINS[Number(value)];return b?['all',['>=',h,b[0]],['<',h,b[1]]]:null;}
    if(kind==='growth'){if(!G())return null;const keys=P()?.legend('structure')?.rows.find(r=>r.key===value)?.keys;return keys?['in',G().groupExpr(),['literal',keys]]:['==',G().groupExpr(),value];}
    // A species' spellings as a JSON list ("species:[\"London Plane\",\"London Plane Tree\"]"), or one name; or its records'
    // name and Latin name pairs ("species:{\"pairs\":[[\"Cherry\",\"Prunus serrulata\"]]}"), a missing Latin name as null.
    if(kind==='species'){let names=null;if(/^[[{]/.test(value)){try{names=JSON.parse(value);}catch{}}
      if(names&&Array.isArray(names.pairs))return ['any',...names.pairs.map(([c,l])=>['all',['==',['get','species_common'],c],['==',['coalesce',['get','species_latin'],''],l||'']])];
      return Array.isArray(names)?(names.length===1?['==',['get','species_common'],names[0]]:['in',['get','species_common'],['literal',names]]):['==',['get','species_common'],value];}
    if(kind==='quality')return S().quality(value)?.match||null;
    if(kind==='protected')return S().protectedExpr;
    if(kind==='uncertain')return ['in',['coalesce',['get','evidence_tier'],''],['literal',UNCERTAIN]];
    if(kind==='tree')return ['==',['get','tree_id'],value];
    return null;
  }
  // Release 6.3's benefit value names what it adds up; release 6.2's total is said as before.
  const basisWords=b=>b==='stormwater_carbon'?'stormwater and carbon; ':'';
  const row=(label,value,sub,go)=>`<div class="ar-row"><dt>${esc(label)}</dt><dd>${value}${sub?`<small>${sub}</small>`:''}${go?`<button type="button" class="link-button ar-go" data-area-go="${go}">Show on map</button>`:''}</dd></div>`;
  const ha=m2=>F.land(m2);
  const swatch=(colour,mark='dot')=>`<i class="sw sw-${mark}" style="--sw:${esc(colour)}"></i>`;
  const card=(title,body,note)=>`<section class="area-card"><h3>${title}</h3>${body}${note?`<p class="area-note">${note}</p>`:''}</section>`;

  function breakdowns(a,{sample=false}={}){
    let h=sample?'<p class="area-note">Composition of the markers drawn at this zoom (a sample):</p>':'';
    // Categories as the map legend shows them (OpenStreetMap and the Ruru kauri survey are one colour, community records).
    const sum=(rec,keys)=>keys.reduce((t,k)=>t+(rec[k]||0),0);
    const src=P()?P().rows('source').map(x=>({key:x.key,label:x.label,value:sum(a.sources,x.keys||[x.key]),colour:x.colour,mark:x.mark})):[];
    h+=card('Map markers by source',V().composition(src,{label:'Map markers by source',key:'source'}));
    const T=SUM(),classes=T.HEIGHT_CLASS.map(([k,label])=>({key:k,label,full:`${label} height class`,value:a.stages[k]||0}));
    if(classes.some(x=>x.value))h+=card(`Height class ${EST}`,V().columns(classes,{label:'Map markers by height class',key:'stage'}),`Height as a share of the class reference height: ${T.scaleText()}.`);
    if(a.heightCount)h+=card('Height (m)',V().columns(HEIGHT_BINS.map((b,i)=>({key:String(i),label:b[2],full:`${b[2]} m tall`,value:a.heights[i]})),{label:'Map markers by height',key:'height'}),`Highest point of the 2024 LiDAR canopy height model within the crown.${a.tall.length?(a.tall.some(t=>t.check)?` ${nf(a.tall.length)} flagged by the height check left out.`:` ${nf(a.tall.length)} at ${tallM()} m or more left out (flagged).`):''}`);
    if(G()&&Object.entries(a.growth).some(([k,v])=>k!=='none'&&v))
      h+=card(`Growth form ${EST}`,V().composition((P()?P().rows('structure'):[]).map(x=>({key:x.key,label:x.label,value:sum(a.growth,x.keys||[x.key]),colour:x.colour})),{label:'Map markers by estimated growth form',key:'growth'}),'Estimated from the 2024 LiDAR survey and aerial imagery.');
    const multiNote=a.multiCount?` Not listed: ${nf(a.multiCount)} ${a.multiCount===1?'marker whose record names':'markers whose records name'} several species (as supplied: ${[...a.multi.keys()].slice(0,2).map(n=>`‘${esc(n)}’`).join(', ')}${a.multi.size>2?', …':''}).`:'';
    if(a.topSpecies.length)h+=card('Recorded species',`<ol class="area-species">${a.topSpecies.map(g=>{const N=root.ALTOSpeciesNames,name=N?N.nameHtml(g.names[0],{display:g.label}):esc(g.label);
      return `<li><button type="button" data-highlight="species:${esc(JSON.stringify(g.pairs?{pairs:g.pairs}:g.names))}" data-label="${esc(g.label)} (${nf(g.n)})"><span>${name}</span><b>${nf(g.n)}</b></button></li>`;}).join('')}</ol>`,`${nf(a.recorded)} of ${nf(a.count)} map markers with a recorded species; ${nf(a.speciesCount)} species.${multiNote}`);
    else h+=card('Recorded species',`<p class="area-note">No recorded species in this area.${multiNote}</p>`);
    const q=a.quality;
    const C=(l,k)=>P()?P().colour(l,k):'';
    const li=(hl,label,value,sw)=>`<li><button type="button" data-highlight="${hl}" data-label="${esc(label)} (${nf(value)})">${sw}<span>${esc(label)}</span><b>${nf(value)}</b></button></li>`;
    h+=card('Schedule and links',`<ul class="area-quality">
      ${li('protected:1','Linked to Schedule 10',a.protected,swatch(P()?P().token('--color-protected'):'','ring'))}
      ${li('quality:unlinked','No crown linked',q.unlinked,swatch(C('quality','unlinked'),'hollow'))}
      ${li('quality:probable','Probable link',q.probable,swatch(C('quality','probable')))}
      ${li('quality:drawn','Crown drawn from the record',q.drawn,swatch(C('quality','drawn')))}
      ${li('uncertain:1','Possible or unverified detection',a.uncertain,swatch(C('evidence','unverified')))}</ul>`);
    return h;
  }
  // Crown area under 0.1 ha in m².
  const areaText=m2=>{const a=F.viewArea(m2);return a?`${a[0]} ${a[1]}`:NONE;};
  // Species maxima for Auckland and a local board (AREA-01): the area's clear leads from the release's maxima.json
  // (species-maxima.js), the three largest for each measure with their margins, the list for the area and a button that
  // rings them on the map. Only trees of a named species with a checked 2024 crown are ranked; nothing here is a maximum
  // over the markers drawn. D: ALTOMaxima.current (null until maxima.json loads); area: "Auckland" or a board's name.
  const MX_TOP=3;
  const joinAnd=l=>l.length<2?l.join(''):`${l.slice(0,-1).join(', ')} and ${l[l.length-1]}`;
  function maximaCard(D,area,{base='.'}={}){
    const M=root.ALTOMaxima;if(!M||!D||!area)return '';
    const key=M.areaList(D).find(a=>M.fold(a)===M.fold(area))||null,title='Species maxima';
    if(!key){
      const boards=M.areaList(D).filter(a=>a!==M.AUCKLAND);
      return card(title,`<p class="area-note">None for ${esc(area)} in this release. Species maxima are ranked for Auckland${boards.length?` and in ${esc(joinAnd(boards))} local boards`:''}.</p>
        <p class="area-links"><a href="${esc(M.listHref(base))}">Species maxima for Auckland</a></p>`);
    }
    const groups=M.MEASURES.map(measure=>({measure,clear:M.areaMaxima(D,{measure,area:key}).filter(m=>m.within_margin===false).sort((a,b)=>b.value-a.value)}));
    const links=`<p class="area-links"><a href="${esc(M.listHref(base,{area:key}))}">Species maxima for ${esc(key)}</a>${groups.some(g=>g.clear.length)?` <button type="button" class="link-button" data-area-maxima="${esc(key)}">Ring them on the map</button>`:''}</p>`;
    if(!groups.some(g=>g.clear.length))return card(title,`<p class="area-note">No clear lead in ${esc(key)}: each species maximum there is within the margin of the next measured tree.</p>${links}`);
    const body=groups.filter(g=>g.clear.length).map(g=>`<h4>${esc(M.MEASURE_NAMES[g.measure])} <span class="area-max-n">${nf(g.clear.length)} species</span></h4><ol class="area-max">${g.clear.slice(0,MX_TOP).map(m=>{
      const t=D.trees?.[m.tree]||{},name=M.speciesName(D,m.species,{html:true,lower:false}),plain=M.speciesName(D,m.species,{lower:false});
      const near=m.measure==='max_crown_area'&&Number(m.value)>=M.NEAR_CAP_M2;
      return `<li><button type="button" data-area-tree="${esc(m.tree)}"${Number.isFinite(t.lon)&&Number.isFinite(t.lat)?` data-lon="${t.lon}" data-lat="${t.lat}"`:''} aria-label="${esc(`${plain}, ${M.value(m.value,m.unit)} ${M.margin(m)}, tree ${m.tree}: open on the map`)}"><span>${name}<code>${esc(m.tree)}</code></span><b>${esc(M.value(m.value,m.unit))}<small>${esc(M.margin(m))}${near?' · at the 400 m² limit':''}</small></b></button></li>`;}).join('')}</ol>`).join('');
    const scope=M.typo(D.copy?.scope_note||'Trees without a named species are not ranked; larger trees may stand elsewhere.');
    return card(`${title} · ${esc(key)}`,`<p class="area-note area-max-lead">Clear leads only: the largest measured tree of each species, ahead of the next by more than the margin (2024 LiDAR). The three largest of each measure:</p>${body}${links}`,`${esc(scope)} Not field-verified.`);
  }
  // The three tallest, then how many more (0.2.10: a view can hold 20). Release 6.3's height check names its level.
  const CHECK_WORDS={implausible:'not plausible',check:'to check'};
  function tallLine(a){if(!a.tall.length)return '';const more=a.tall.length-3,checked=a.tall.some(t=>t.check);
    return row(checked?'Heights flagged by the height check':`Heights of ${tallM()} m or more`,a.tall.slice(0,3).map(t=>`${nf(t.value,1)} m · ${t.check?`height ${CHECK_WORDS[t.check]}`:'flagged'}`).join('<br>')+(more>0?`<br>and ${nf(more)} more`:''),
      checked?'not in the tallest or the mean; left out of rankings and Species maxima':tallNote(),a.tall[0].coords?'tall':null);}
  function liveRows(a,{sample=false}={}){
    if(sample)return `<dl class="ar">${row('Map markers drawn',`${nf(a.count)}`,'a sample at this zoom')}${a.protected?row('Linked to Schedule 10',nf(a.protected),'of the markers drawn'):''}</dl>
      <p class="area-sample" role="note">Zoom in to 16 to total this view: crown area, height, the tallest tree, benefits, carbon and stormwater are not summed over a sample.</p>`;
    return `<dl class="ar">${row('Map markers',nf(a.count),a.protected?`${nf(a.protected)} linked to Schedule 10`:'')}
      ${row('Crown area',areaText(a.crownArea),'sum of crowns, overlaps included')}
      ${row('Tallest in this view',a.tallest?`${nf(a.tallest.value,1)} m`:NONE,a.meanHeight!==null?`mean ${nf(a.meanHeight,1)} m`:'',a.tallest?.coords?'tallest':null)}
      ${tallLine(a)}
      ${row('Largest crown in this view',a.largest?`${nf(a.largest.value)} m²`:NONE,a.flagged?`${nf(a.flagged)} ${a.flagged===1?'marker':'markers'} flagged by the height or record check not ranked`:'',a.largest?.coords?'largest':null)}
      ${row('Benefits',a.value?`${money(a.value)}/yr ${EST}`:NONE,`${basisWords(a.valueBasis)}sum of the markers’ yearly estimates; sensitivity scenario; ${NOT_RANGED}`,null)}
      ${row('Highest single benefit in this view',a.topValue?`${money(a.topValue.value,2)}/yr ${EST}`:NONE,'sensitivity scenario',a.topValue?.coords?'topValue':null)}
      ${row('Carbon stored',a.carbon?`${tonnes(a.carbon)} ${EST}`:NONE,NOT_RANGED)}
      ${row('Stormwater',a.runoff?`${F.volume(a.runoff,{total:true})} ${EST}`:NONE,`runoff avoided; ${NOT_RANGED}`)}</dl>`;
  }
  // scope: {kind:'region'|'board'|'view'|'property', title, subtitle, sample, property, board, totals, empty, error}
  function render(a,scope){
    let h=`<header class="area-head"><p class="area-kicker">${esc({region:'Region',board:'Local board',view:'Map view',property:'Property'}[scope.kind]||'Area')}</p><h2>${esc(scope.title)}</h2>${scope.subtitle?`<p class="area-sub">${esc(scope.subtitle)}</p>`:''}</header>`;
    if(scope.kind==='region'){
      if(scope.error)return h+`<p class="area-note" role="status">${esc(scope.error)}</p>`;
      const t=scope.totals||{};
      h+=`<dl class="ar">${row('Map markers',t.markers!=null?nf(t.markers):NONE,t.lidar!=null?`${nf(t.lidar)} found in the 2024 LiDAR survey`:'')}${row('Crowns',t.crowns!=null?nf(t.crowns):NONE,'LiDAR crowns 3 m or taller; a crown can hold several trees')}${row('Linked to Schedule 10',t.schedule!=null?nf(t.schedule):NONE,'map markers linked to the Notable Trees schedule')}
        ${row('Benefits',t.value!=null?`${about(t.value,{prefix:'NZ$'})} a year ${EST}`:NONE,`${basisWords(t.valueBasis)}sum of the markers’ yearly estimates; sensitivity scenario; ${NOT_RANGED}`)}${row('Stormwater',t.runoff!=null?`${about(t.runoff,{unit:'m³'})} a year ${EST}`:NONE,`runoff avoided; ${NOT_RANGED}`)}${row('Carbon stored',t.carbon!=null?`${about(t.carbon,{unit:'t CO₂e'})} ${EST}`:NONE,NOT_RANGED)}</dl>
        <p class="area-note">Totals for ${esc(scope.release||'the current release')}, from its release metadata. For composition by source, height class and species, choose a local board or this view at zoom 16.</p>`;
      return h+maximaCard(scope.maxima,'Auckland',{base:scope.base});
    }
    if(scope.kind==='board'&&scope.board){
      const b=scope.board;
      h+=`<dl class="ar">${row('Land area',num(b.land_area_km2)!==null?`${nf(b.land_area_km2,1)} km²`:NONE,'')}${row('Canopy cover',num(b.canopy_cover_pct)!==null?`${nf(b.canopy_cover_pct)}%`:NONE,`earlier canopy assessment${b.fully_assessed?'':'; the board is partly outside the assessed area'}`)}
        ${row('Map markers',num(b.tree_count)!==null?nf(b.tree_count):NONE,'in the earlier map, Sep 2026')}</dl>${maximaCard(scope.maxima,b.board_name,{base:scope.base})}<h3 class="ar-sub">Markers drawn inside the board</h3>`;
    }
    const P=scope.property?.property||null;
    if(P){
      // The tallest listed tree under 55 m; a taller listed one is flagged apart.
      const listed=(scope.property?.trees||[]).map(t=>num(t.height_m)).filter(v=>v!==null);
      const flagged=listed.filter(v=>v>=tallM()).sort((x,y)=>y-x),okTall=listed.filter(v=>v<tallM()).sort((x,y)=>y-x)[0]??null;
      const tallest=num(P.tallest_m)!==null&&num(P.tallest_m)>=tallM()?okTall:num(P.tallest_m);
      // The parcel's benefit total: release 6.3 benefit_value_nzd_y (stormwater and carbon), release 6.2 total_value_nzd_y.
      const pb=FD().benefit(P)||{value:null,low:null,high:null};
      h+=`<dl class="ar">${row('Map markers',nf(num(P.n_trees)||0),`${nf(num(P.n_confident)||0)} confident · ${nf(num(P.n_uncertain)||0)} possible`)}
        ${row('Canopy over the parcel',`${nf(num(P.canopy_m2)||0)} m²`,`${nf(num(P.canopy_cover_pct)||0)}% of ${ha(num(P.area_m2)||0)}`)}
        ${row('Tallest',tallest!==null?`${nf(tallest,1)} m`:NONE,'',a.tallest?.coords?'tallest':null)}
        ${flagged.length||(num(P.tallest_m)!==null&&num(P.tallest_m)>=tallM())?row(`Heights of ${tallM()} m or more`,(flagged.length?flagged:[num(P.tallest_m)]).slice(0,3).map(v=>`${nf(v,1)} m · flagged`).join('<br>'),'unusually tall for Auckland: possibly a power line, structure or noise'):''}
        ${row('Benefits',pb.value?`${money(pb.value)}/yr ${EST}`:NONE,pb.value&&pb.low!==null?`${basisWords(pb.basis)}range ${money(pb.low)}–${money(pb.high)}/yr; sensitivity scenario`:num(P.n_trees)?NOT_RANGED:'no map markers on the parcel')}
        ${row('Carbon stored',num(P.stored_co2e_tonnes_est)?`${tonnes(num(P.stored_co2e_tonnes_est))} ${EST}`:NONE,num(P.stored_co2e_tonnes_est)?NOT_RANGED:'')}
        ${row('Stormwater',num(P.avoided_runoff_m3_y)?`${F.volume(P.avoided_runoff_m3_y,{total:true})} ${EST}`:NONE,`runoff avoided${num(P.avoided_runoff_m3_y)?`; ${NOT_RANGED}`:''}`)}</dl>`;
      if(a.count)h+=breakdowns(a);
      return h;
    }
    if(!a.count)return h+`<p class="area-note">${esc(scope.empty||'No markers drawn here. Move the map, zoom in or clear filters.')}</p>`;
    return h+liveRows(a,{sample:!!scope.sample})+breakdowns(a,{sample:!!scope.sample});
  }
  const api={summarise,render,highlightExpr,maximaCard,HEIGHT_BINS,about,get TALL_M(){return tallM();}};
  root.ALTOArea=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
