/* V5 crown links live in each record; original source identities remain intact. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const parse=v=>{try{return typeof v==='string'?JSON.parse(v):v;}catch{return null;}};
 let options;
 function streetView(r){return Number.isFinite(r.lat)&&Number.isFinite(r.lon)?'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint='+encodeURIComponent(r.lat+','+r.lon):null;}
 function sourceLink(r){if(r.source_primary!=='tree_register_points'||!r.source_tree_id)return null;return 'https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/TreeRegisterPoints/FeatureServer/0/query?'+new URLSearchParams({f:'pjson',where:"TreeID = '"+String(r.source_tree_id).replaceAll("'","''")+"'",outFields:'*',outSR:'4326'});}
 function init(opts){options=opts;const toggle=document.getElementById('groupRecords');toggle.checked=true;toggle.disabled=true;document.getElementById('recordLinksStatus').textContent='One marker per current crown. Open a tree to compare its linked source records.';}
 function update(features){return {hidden:[],groups:features.filter(f=>Number(f.properties.linked_source_records)>1),markers:features.length,records:features.length};}
 function context(record){return {method_id:'v5_actual_polygon_containment',current:record.datasets.identity||null,source_position_review:record.datasets.location_review||null,source_crosswalk:record.datasets.source_crosswalk||null,field_report:parse(record.datasets.field?.observation_json)};}
 function render(record){
  const d=record.datasets,r=d.record||{},x=d.identity||{},s=d.source_crosswalk,f=parse(d.field?.observation_json),members=(parse(x.members_json)||[]).filter(m=>m.tree_id),sv=streetView(r),source=sourceLink(r);
  let html='<section class="pp-section identity-panel"><h3>Identity &amp; source records</h3>';
  if(d.location_review||x.evidence_tier==='location_unverified')html+='<p><strong>The Council position is unverified.</strong> This marker shows the register location. It has not been attached automatically to a nearby crown.</p>';
  if(x.current_primary_tree_id){
   html+=`<p>${Number(x.source_records)>1?`${esc(x.source_records)} source records fall inside this crown.`:'This record is linked to a current crown.'} Separate trunks can share a canopy; the link records their spatial relationship.</p>`;
   if(x.current_primary_tree_id!==record.tree_id)html+=`<p><button type="button" data-identity-open="${esc(x.current_primary_tree_id)}">Open the current crown and its linked records</button></p>`;
   if(members.length)html+='<ul class="identity-members">'+members.map(m=>`<li><button type="button" data-identity-open="${esc(m.tree_id)}" ${m.tree_id===record.tree_id?'disabled':''}>${esc(m.tree_id)}</button><span>${esc(m.species_common||m.species_latin||'Species unrecorded')} · ${esc(m.source)}</span></li>`).join('')+'</ul>';
  }else if(x.within_v5_footprint===0)html+='<p>This position falls outside the v5 survey footprint. Earlier observations remain available.</p>';
  else if(!d.location_review)html+='<p>No unique v5 crown was assigned to this record. The older measurements remain below for comparison.</p>';
  if(x.old_overlapping_crowns>1||x.new_overlapping_crowns>1)html+=`<p class="pp-note">Segmentation comparison: ${esc(x.old_overlapping_crowns??0)} older crowns overlap the current crown; ${esc(x.new_overlapping_crowns??0)} new crowns overlap this record’s earlier crown. These counts describe redraws of the same survey.</p>`;
  if(s)html+=`<p class="pp-note">Council identifier updated: ${esc(s.old_objectid)} → ${esc(s.current_objectid)}. ALTO keeps ${esc(record.tree_id)} so saved links and observations still work.</p>`;
  if(f){
   html+=`<h4>Devonport Primary field report · ${esc(f.reported_on)}</h4><p>${esc(f.description)}</p><p class="pp-note">The plaque was reported on the selected tree. Its association with schedule ${esc(f.candidate_schedule_association?.schedule)} still needs confirmation; the schedule names more than one taxon.</p>`;
   if(f.anchor_tree_id!==record.tree_id)html+=`<button type="button" data-identity-open="${esc(f.anchor_tree_id)}">Open the tree with the reported plaque</button>`;
  }
  if(source)html+=`<p><a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Open the Council tree register record ↗</a></p>`;
  if(sv)html+=`<p><a href="${esc(sv)}" target="_blank" rel="noopener noreferrer">Look nearby in Google Street View ↗</a></p>`;
  return html+'</section>';
 }
 function mount(container,record){const holder=container.querySelector('.identity-slot');if(!holder)return;holder.innerHTML=render(record);holder.querySelectorAll('[data-identity-open]').forEach(b=>b.addEventListener('click',()=>options.open({tree_id:b.dataset.identityOpen})));}
 const api={init,update,context,mount,render,streetView,sourceLink};root.ALTOIdentity=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
