/* What people have recorded at this tree, and where it stands.
 *
 * Ground evidence comes from KYTE: only visits a person has reviewed and accepted, with
 * photographs re-encoded without camera metadata and never a contributor's name. It is
 * fetched live from the KYTE API so an accepted visit shows here within minutes, without
 * a data release. The local-board context is a point-in-polygon lookup on a simplified
 * board file, cached for the session. */
(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const fmt=(v,places=1)=>num(v)===null?'—':new Intl.NumberFormat('en-NZ',{maximumFractionDigits:places}).format(Number(v));
  const cache=new Map();let boardsPromise=null,config={kyteBase:'./kyte',dataBase:'./data',version:''};
  function init(options){config={...config,...options};}
  async function load(treeId){
    if(!cache.has(treeId)){
      const url=`${config.kyteBase}/api/index.php?action=tree&tree_id=${encodeURIComponent(treeId)}`;
      cache.set(treeId,fetch(url,{credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('ground '+r.status);return r.json();}).catch(err=>{cache.delete(treeId);throw err;}));
      if(cache.size>40)cache.delete(cache.keys().next().value);
    }
    return cache.get(treeId);
  }
  const VIEWS={whole_tree:'Whole tree',second_angle:'Second angle',trunk:'Trunk',leaves:'Leaves',site:'Setting',identity:'Label or plaque'};
  const FIELD={leaves:{new:'new leaves',green:'leaves mostly green',turning:'leaves changing colour',bare:'bare branches'},flowers:{yes:'flowers visible',no:'no flowers'},fruit:{yes:'fruit or cones visible',no:'no fruit or cones'},change:{none:'nothing obviously changed',pruned:'recently pruned',damage:'broken or damaged branches',regrowth:'new growth',removed:'the tree has gone'}};
  function dateLabel(iso){if(!iso)return '';const plain=iso.length===10,d=new Date(plain?iso+'T12:00:00':iso);return Number.isNaN(d.getTime())?esc(iso):d.toLocaleDateString('en-NZ',{day:'numeric',month:'long',year:'numeric',...(plain?{}:{timeZone:'Pacific/Auckland'})});}
  // Best photo-identification lead across a tree's accepted visits: leaf, flower and fruit
  // photographs are trusted over bark, which Pl@ntNet gets wrong often.
  function lead(data){
    let best=null;
    for(const v of data?.visits||[])for(const s of v.identification||[]){
      if(s.rank!==1||!s.scientific_name)continue;
      const weight=(s.organ==='bark'?.6:1)*(num(s.score)||0);
      if(!best||weight>best.weight)best={weight,score:num(s.score)||0,organ:s.organ,name:s.scientific_name,common:s.common_name,family:s.family,observed_on:v.observed_on};
    }
    return best;
  }
  // What the 3D model may take from the ground: a measured trunk, the stem form, a species
  // lead when the record has none, and the fact that photographs exist.
  function live(data,record){
    const visits=data?.visits||[];if(!visits.length)return null;
    const out={photos:[],observed_on:null,trunk_form:null,circumference_cm:null,diameter_cm:null,measuring_height_m:null,crown_spread_m:null,height_m:null,species:null};
    for(const v of visits){
      out.photos.push(...(v.photos||[]));if(!out.observed_on)out.observed_on=dateLabel(v.observed_on);
      const m=v.measurements||{};
      if(!out.diameter_cm&&(num(m.diameter_cm)||num(m.circumference_cm))){out.diameter_cm=num(m.diameter_cm)??num(m.circumference_cm)/Math.PI;out.circumference_cm=num(m.circumference_cm);out.measuring_height_m=num(m.measuring_height_m);}
      const spread=[m.crown_spread_1_m,m.crown_spread_2_m].map(num).filter(v=>v!==null);if(!out.crown_spread_m&&spread.length)out.crown_spread_m=spread.reduce((a,b)=>a+b,0)/spread.length;
      if(!out.height_m&&num(m.height_m))out.height_m=num(m.height_m);
      if(!out.trunk_form&&m.trunk_form&&m.trunk_form!=='unknown')out.trunk_form=m.trunk_form;
    }
    const r=record?.datasets?.record||{},recorded=r.species_latin||r.species_common,usable=recorded&&!/^(unknown|unidentified|species not recorded|0 records found\.)$/i.test(String(recorded).trim());
    if(!usable){
      const named=visits.map(v=>v.species_suggestion).find(Boolean);
      const l=lead(data);
      if(named)out.species={name:named,latin:named,common:named,score:null,basis:'observer'};
      else if(l&&l.score>=.3)out.species={name:l.name,latin:l.name,common:l.common,score:l.score,organ:l.organ,basis:'photo'};
    }
    return out;
  }
  function render(data,record){
    const visits=data?.visits||[];
    let html='<section class="evidence-section ground-section"><h3>Seen from the ground</h3>';
    if(!visits.length){
      html+='<p>No accepted ground visit yet. A photograph of the whole tree, its trunk and its leaves, taken with KYTE, checks the record and improves the model. A tape around the trunk tests the diameter estimate.</p>';
      html+=`<p><a class="ground-cta" href="${esc(config.kyteBase)}/?tree=${encodeURIComponent(record.tree_id)}">Photograph this tree with KYTE ↗</a></p></section>`;
      return html;
    }
    const l=lead(data);
    for(const v of visits){
      html+=`<article class="ground-visit"><h4>${dateLabel(v.observed_on)}${v.presence&&v.presence!=='present'?` · <span class="ground-flag">${esc(v.presence)}</span>`:''}</h4>`;
      if(v.photos?.length)html+='<div class="ground-photos">'+v.photos.map(p=>`<a href="${esc(config.kyteBase)}/${esc(p.large)}" target="_blank" rel="noopener"><img src="${esc(config.kyteBase)}/${esc(p.small)}" alt="${esc(VIEWS[p.view]||p.view)} photograph" loading="lazy" width="${esc(p.width?Math.round(p.width*160/Math.max(p.width,p.height)):160)}" height="${esc(p.height?Math.round(p.height*160/Math.max(p.width,p.height)):160)}"><span>${esc(VIEWS[p.view]||p.view)}</span></a>`).join('')+'</div>';
      const facts=[];
      const m=v.measurements||{};
      const METHOD={tape:'with a tape or cord',paced:'paced out',app:'with a phone measuring app',estimate:'judged by eye',sighting:'by the stick method',shadow:'by the shadow method',instrument:'with a clinometer or app'};
      if(num(m.diameter_cm)||num(m.circumference_cm)){const dia=num(m.diameter_cm)??num(m.circumference_cm)/Math.PI;facts.push(m.trunk_tape==='diameter'?`Trunk ${fmt(dia,0)} cm through, read from a diameter tape${num(m.measuring_height_m)?` at ${fmt(m.measuring_height_m,2)} m`:''}`:`Trunk ${fmt(m.circumference_cm,0)} cm around${num(m.measuring_height_m)?` at ${fmt(m.measuring_height_m,2)} m`:''}, so about ${fmt(dia,0)} cm through`);}
      const spread=[m.crown_spread_1_m,m.crown_spread_2_m].map(num).filter(v=>v!==null);if(spread.length)facts.push(`Crown ${spread.map(v=>fmt(v,1)).join(' × ')} m ${METHOD[m.crown_method]||''}`.trim());
      if(m.trunk_form&&m.trunk_form!=='unknown')facts.push(m.trunk_form==='multiple'?'Several trunks from the ground':'One trunk');
      if(num(m.height_m))facts.push(`Height ${fmt(m.height_m)} m ${METHOD[m.height_method]||esc(m.height_method||'')}`.trim());
      // The survey's own figures beside the tape, which is what a measurement is for.
      const rec=record?.datasets||{},sDbh=num(rec.assets?.dbh_cm_crown_est)??num(rec.services?.dbh_cm_est),sCrown=num(rec.crown?.crown_diameter_m),sHeight=num(rec.crown?.crown_max_chm_m)??num(rec.pointcloud?.canopy_top_m);const vs=[];
      if((num(m.diameter_cm)||num(m.circumference_cm))&&sDbh!==null)vs.push(`trunk ${fmt(sDbh,0)} cm through`);if(spread.length&&sCrown!==null)vs.push(`crown ${fmt(sCrown,1)} m across`);if(num(m.height_m)&&sHeight!==null)vs.push(`height ${fmt(sHeight,1)} m`);
      if(vs.length)facts.push(`ALTO’s own estimate for comparison: ${vs.join(', ')}`);
      for(const [k,val] of Object.entries(v.field_observations||{}))if(FIELD[k]?.[val])facts.push(FIELD[k][val]);
      if(v.species_suggestion)facts.push(`Identified by the visitor as ${esc(v.species_suggestion)}`);
      if(facts.length)html+='<ul class="ground-facts">'+facts.map(f=>`<li>${f}</li>`).join('')+'</ul>';
      if(v.notes)html+=`<p class="ground-notes">“${esc(v.notes)}”</p>`;
      const ident=(v.identification||[]).filter(s=>s.rank<=3);
      if(ident.length){
        const byPhoto=new Map();for(const s of ident){if(!byPhoto.has(s.photo))byPhoto.set(s.photo,[]);byPhoto.get(s.photo).push(s);}
        html+='<details class="ground-ident"><summary>Photo identification (Pl@ntNet)</summary>';
        for(const [,rows] of byPhoto)html+=`<p><strong>${esc(rows[0].organ)}</strong>: `+rows.sort((a,b)=>a.rank-b.rank).map(s=>`<em>${esc(s.scientific_name)}</em>${s.common_name?` (${esc(s.common_name)})`:''} ${Math.round((num(s.score)||0)*100)}%`).join(' · ')+'</p>';
        html+='<p class="pp-note">A score from a photograph alone. Leaf, flower and fruit photographs identify better than bark. This is a lead for checking, not a determination, and it is not written into the tree’s record.</p></details>';
      }
      html+=`<p class="pp-note">Accepted by an ALTO reviewer${v.accepted_at?' on '+dateLabel(v.accepted_at):''}. Photographs are re-encoded without camera metadata; contributors are not named.</p></article>`;
    }
    if(l&&l.score>=.3){const r=record?.datasets?.record||{};const recorded=r.species_latin||r.species_common;if(!recorded||/^(unknown|unidentified|species not recorded|0 records found\.)$/i.test(String(recorded).trim()))html+=`<p class="ground-lead">The record has no species. The best photo lead is <em>${esc(l.name)}</em>${l.common?` (${esc(l.common)})`:''}, ${Math.round(l.score*100)}% from a ${esc(l.organ)} photograph; the 3D form below follows it until someone confirms.</p>`;}
    html+=`<p><a class="ground-cta" href="${esc(config.kyteBase)}/?tree=${encodeURIComponent(record.tree_id)}">Add your own visit with KYTE ↗</a></p></section>`;
    return html;
  }
  // ---- local board context ----
  function boards(){
    if(!boardsPromise)boardsPromise=fetch(`${config.dataBase}/local_boards.json?v=${encodeURIComponent(config.version)}`).then(r=>{if(!r.ok)throw new Error('boards '+r.status);return r.json();}).catch(err=>{boardsPromise=null;throw err;});
    return boardsPromise;
  }
  function inside(pt,ring){let x=pt[0],y=pt[1],ok=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)ok=!ok;}return ok;}
  async function board(lon,lat){
    if(!Number.isFinite(lon)||!Number.isFinite(lat))return null;
    const fc=await boards();
    for(const f of fc.features){const g=f.geometry,polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;for(const p of polys)if(inside([lon,lat],p[0])&&!p.slice(1).some(h=>inside([lon,lat],h)))return f.properties;}
    return null;
  }
  function renderBoard(b){
    if(!b)return '';
    return `${esc(b.board_name)} local board${num(b.canopy_cover_pct)!==null?` · ${fmt(b.canopy_cover_pct,1)}% canopy cover in the board-level assessment`:''}`;
  }
  const api={init,load,lead,live,render,board,renderBoard};
  root.ALTOGround=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
