/* Evidence summaries preserve the source observations and never calibrate model scores. */
(function(root) {
  'use strict';
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = v => v === null || v === undefined || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
  const fmt = (v, places=1) => number(v) === null ? '—' : new Intl.NumberFormat('en-NZ',{maximumFractionDigits:places}).format(Number(v));
  const flag = v => v === true || v === 1 || v === '1';
  const name = r => {
    const d=r.datasets.record || {};
    const common = d.species_common;
    return common && !/^(unknown|unidentified|not known)$/i.test(common.trim()) ? common : 'Tree '+r.tree_id.replace(/^akl_tree_/,'');
  };
  function explain(record) {
    const d=record.datasets, a=d.assets||{}, c=d.crown||{}, pc=d.pointcloud||{}, t=d.trajectory||{}, s=d.services||{};
    const trunks=[['Canopy allometry',a.dbh_cm_crown_est,'tree_assets_pilot.dbh_cm_crown_est'],['Service model',s.dbh_cm_est,'tree_valuation_pilot.dbh_cm_est'],['Root model',d.roots?.dbh_cm,'tree_root_zone_pilot.dbh_cm']]
      .filter(x=>number(x[1])!==null && number(x[1])>0).map(([label,value,source])=>({label,value:Number(value),source}));
    const values=trunks.map(x=>x.value), low=values.length?Math.min(...values):null, high=values.length?Math.max(...values):null;
    const timeline=[2013,2016,2024].map(year=>({year,height:number(t['h_'+year]),present:t['present_'+year]===null||t['present_'+year]===undefined?null:flag(t['present_'+year])}));
    const questions=[];
    if(flag(pc.pc_false_positive)||flag(pc.pc_review_no_canopy)||d.review)questions.push({kind:'Identity',text:'Check what is at this location. Some stored evidence suggests an object other than a tree, or no canopy. Record what you see before changing its identity.'});
    else if(!pc.pointcloud_class||pc.pointcloud_class==='no_data')questions.push({kind:'Canopy',text:'Confirm the tree and its position. Classified laser-return evidence is unavailable for this record.'});
    if(high!==null && high-low>0.01)questions.push({kind:'Trunk size',text:`The models use ${fmt(low)}–${fmt(high)} cm diameter. A trunk circumference, measuring height and stem-form note would test those estimates.`});
    else if(trunks.length)questions.push({kind:'Trunk size',text:'Measure trunk circumference and record the measuring height and stem form to test the modelled diameter.'});
    if(!d.record?.species_latin || /unknown/i.test(d.record.species_latin))questions.push({kind:'Identification',text:'Add leaf, bark and whole-tree observations to test the growth-form guess and propose a species.'});
    if(flag(t.implausible))questions.push({kind:'History',text:'The matching model flagged an unusual trajectory. Compare the same location in each survey before interpreting height change as growth or removal.'});
    const height = number(a.height_p95_m) ?? number(c.crown_max_chm_m) ?? number(d.lidar?.chm_local_max_2m_m);
    const heightBasis = number(a.height_p95_m)!==null ? '95th percentile of canopy raster heights' : number(c.crown_max_chm_m)!==null ? 'Maximum canopy raster height' : 'Local canopy raster maximum';
    return {trunks,low,high,timeline,questions,height,heightBasis,canopyArea:number(c.crown_area_m2)??number(s.crown_area_m2),
      annualValue:number(s.total_value_nzd_y),valueLow:number(s.total_value_nzd_y_low),valueHigh:number(s.total_value_nzd_y_high),
      runoff:number(s.avoided_runoff_m3_y),carbonStored:number(s.stored_co2e_tonnes_est),sequestration:number(s.annual_sequestration_tco2e_y_est),pm25:number(s.pm25_removed_kg_y)};
  }
  function card(label,value,unit,note) {return `<div class="evidence-metric"><span>${escape(label)}</span><strong>${escape(value)} <small>${escape(unit)}</small></strong><p>${escape(note)}</p></div>`;}
  function render(record) {
    const x=explain(record),d=record.datasets,s=d.services||{};
    const treeBasis=d.record?.source_primary==='lidar_inferred_canopy'?'Remote detection':'Source inventory';
    const dbh=x.low===null?'—':Math.abs(x.high-x.low)<.01?fmt(x.low):`${fmt(x.low)}–${fmt(x.high)}`;
    let html=`<section class="evidence-summary" aria-label="Evidence at a glance"><div class="evidence-kicker">${treeBasis} · Auckland release</div><h3>${escape(name(record))}</h3><p class="evidence-id">${escape(record.tree_id)}</p><div class="evidence-metrics">`;
    html+=card('Canopy height',fmt(x.height),'m',x.height===null?'No height estimate':x.heightBasis);
    html+=card('Crown footprint',fmt(x.canopyArea),'m²','Segmented canopy estimate');
    html+=card('Modelled trunk diameter',dbh,'cm',x.high!==null&&x.high-x.low>.01?'Spread across model inputs; not a confidence interval':'Allometric estimate; field measurement needed');
    html+=card('Avoided runoff',fmt(x.runoff),'m³/year','Model estimate under stored assumptions');
    html+='</div><div class="evidence-actions"><button type="button" data-evidence-action="save">Save for comparison</button><button type="button" data-evidence-action="compare">Compare saved trees</button><button type="button" data-evidence-action="share">Link to this tree</button><button type="button" data-evidence-action="3d">3D tree</button></div><p class="evidence-status" aria-live="polite"></p>';
    html+=`<details class="evidence-dates"><summary>Sources, dates &amp; uncertainty</summary><p>Source record timestamp: ${escape(d.record?.as_of_utc||'Not supplied')}. Research snapshot: ${escape(record.snapshot||'Not supplied')}. These are record and processing dates, not a new visit to this tree.</p><p>Canopy dimensions use the 2024 survey product. A canopy raster and the laser returns used to create it provide related evidence; agreement between them is not independent field validation.</p><p>Trunk sizes, root extents, condition and growth form can be hypotheses. Scores are not calibrated probabilities. Monetary lower/upper values are sensitivity scenarios, not confidence intervals. All stored estimates remain available below.</p>`;
    if(s.method_id)html+=`<p>Service method: <code>${escape(s.method_id)}</code>. The full record includes its calculation assumptions.</p>`;
    html+='</details></section>';
    if(d.trajectory){
      const max=Math.max(1,...x.timeline.map(p=>p.height??0));
      html+='<section class="evidence-section"><h3>Canopy through time</h3><div class="evidence-timeline" role="list">';
      for(const p of x.timeline){
        const show=p.height!==null&&p.present!==false;
        html+=`<div role="listitem"><strong>${p.year}</strong><div class="epoch-track"><span style="height:${show?Math.max(2,Math.min(100,p.height/max*100)):0}%"></span></div><b>${show?fmt(p.height)+' m':d.trajectory.fate==='outside_historic_coverage'&&p.year<2024?'Outside coverage':p.present===false?'No matched canopy':'No estimate'}</b></div>`;
      }
      html+=`</div><p>Matched canopy heights at three survey epochs. A missing detection does not establish when a tree was planted or removed.${flag(d.trajectory.implausible)?' This trajectory is flagged for review.':''}</p></section>`;
    }
    if(x.trunks.length>1){
      html+='<details class="evidence-section"><summary>Compare the trunk models</summary>';
      for(const t of x.trunks)html+=`<div class="pp-row"><span class="pp-label">${escape(t.label)}</span><span class="pp-value" title="${escape(t.source)}">${fmt(t.value)} cm</span></div>`;
      html+='<p>These may share inputs and are not independent measurements. The spread shows disagreement, not statistical uncertainty.</p></details>';
    }
    if(x.questions.length)html+='<details class="evidence-section"><summary>What could we learn next?</summary><ul>'+x.questions.map(q=>`<li><strong>${escape(q.kind)}.</strong> ${escape(q.text)}</li>`).join('')+'</ul><p>These are research questions, not a safety inspection or a risk ranking.</p></details>';
    html+='<details class="evidence-section tree-model-details"><summary>Explore this tree in 3D</summary><div class="tree-model-host"></div></details>';
    html+='<section class="evidence-section future-section"><p>Loading the longitudinal scenario model…</p></section>';
    return html;
  }
  const METRICS=[
    ['Height estimate (m)',r=>fmt(explain(r).height)],
    ['Height statistic',r=>explain(r).heightBasis],
    ['Crown area (m²)',r=>fmt(explain(r).canopyArea)],
    ['Trunk inputs (cm)',r=>explain(r).trunks.map(x=>`${x.label}: ${fmt(x.value)}`).join('; ')||'—'],
    ['Avoided runoff (m³/year)',r=>fmt(explain(r).runoff)],
    ['Carbon stored (tCO₂e)',r=>fmt(explain(r).carbonStored,3)],
    ['Carbon sequestration (tCO₂e/year)',r=>fmt(explain(r).sequestration,3)],
    ['PM₂.₅ removed (kg/year)',r=>fmt(explain(r).pm25,3)],
    ['Annual value (NZ$/year)',r=>fmt(explain(r).annualValue,2)],
    ['Value sensitivity scenarios (NZ$/year)',r=>{const x=explain(r);return x.valueLow===null||x.valueHigh===null?'—':`${fmt(x.valueLow,2)}–${fmt(x.valueHigh,2)}`;}],
    ['Service method',r=>r.datasets.services?.method_id||'—'],
    ['Source',r=>r.datasets.record?.source_primary||'—'],
    ['Source record timestamp',r=>r.datasets.record?.as_of_utc||'—'],
    ['Research snapshot',r=>r.snapshot||'—']
  ];
  function comparison(records) {
    if(!records.length)return '<p>Save a tree from its profile, then choose another tree to compare. Up to four trees can be compared.</p>';
    return '<div class="comparison-scroll" tabindex="0" aria-label="Tree comparison; scroll across for all trees"><table><caption>Individual-tree estimates · same measures side by side</caption><thead><tr><th scope="col">Measure</th>'+records.map(r=>`<th scope="col">${escape(name(r))}<small>${escape(r.tree_id)}</small><button type="button" data-remove-tree="${escape(r.tree_id)}">Remove</button></th>`).join('')+'</tr></thead><tbody>'+METRICS.map(([label,read])=>`<tr><th scope="row">${escape(label)}</th>${records.map(r=>`<td>${escape(read(r))}</td>`).join('')}</tr>`).join('')+'</tbody></table></div><p class="comparison-note">Missing means unavailable. Carbon stock and annual flows are different measures. Sensitivity ranges are not confidence intervals. Overlapping crowns and shared assumptions mean these figures should not simply be added together.</p>';
  }
  function csv(records) {
    const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
    return [['tree_id','name',...METRICS.map(x=>x[0])],...records.map(r=>[r.tree_id,name(r),...METRICS.map(x=>x[1](r))])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  const api={number,explain,render,comparison,csv,name};root.ALTOEvidence=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
