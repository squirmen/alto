/* Evidence summaries preserve the source observations and never calibrate model scores. */
(function(root) {
  'use strict';
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = v => v === null || v === undefined || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
  const fmt = (v, places=1) => number(v) === null ? '—' : new Intl.NumberFormat('en-NZ',{maximumFractionDigits:places}).format(Number(v));
  const flag = v => v === true || v === 1 || v === '1';
  const name = r => {
    const d={...(r.datasets.record||{}),...Object.fromEntries(Object.entries(r.datasets.ground||{}).filter(([k,v])=>['species_common','species_latin'].includes(k)&&v))};
    const common = d.species_common && !/^(unknown|unidentified|not known)$/i.test(d.species_common.trim()) ? d.species_common : d.species_latin;
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
    if(!d.record?.species_latin || /unknown/i.test(d.record.species_latin))questions.push({kind:'Identification',text:'Photograph the leaves, bark and whole tree to refine its identification.'});
    if(flag(t.implausible))questions.push({kind:'History',text:'The matching model flagged an unusual trajectory. Compare the same location in each survey before interpreting height change as growth or removal.'});
    const height = number(c.crown_max_chm_m) ?? number(a.height_max_m) ?? number(a.height_p95_m);
    const heightBasis = c.crown_source==='v5'?'V5 segmented canopy maximum, 2024 survey':c.crown_source==='v4_outside_v5'?'Earlier crown outside the v5 footprint':c.crown_source==='record_seeded_v52'?'Crown drawn from the record, 2024 survey; awaiting confirmation':'Stored canopy estimate';
    return {trunks,low,high,timeline,questions,height,heightBasis,canopyArea:number(c.crown_area_m2)??number(s.crown_area_m2),
      // Release 6.3: the benefits dataset (stormwater and carbon; withheld where the height is not plausible), the drawn
      // crown's values for the 103 crowns release 6.3 values on their drawn outline; release 6.2: the services total.
      ...(()=>{const b=d.benefits,w=!!b?.withheld_reason,v=d.services_drawn||s;
        if(!b)return {annualValue:number(s.total_value_nzd_y),valueLow:number(s.total_value_nzd_y_low),valueHigh:number(s.total_value_nzd_y_high),
          runoff:number(s.avoided_runoff_m3_y),carbonStored:number(s.stored_co2e_tonnes_est),sequestration:number(s.annual_sequestration_tco2e_y_est),pm25:number(s.pm25_removed_kg_y),release63:false};
        return {annualValue:number(b.benefit_value_nzd_y),valueLow:number(b.benefit_value_nzd_y_low),valueHigh:number(b.benefit_value_nzd_y_high),
          runoff:w?null:number(v.avoided_runoff_m3_y),carbonStored:w?null:number(v.stored_co2e_tonnes_est),sequestration:w?null:number(s.annual_sequestration_tco2e_y_est),
          pm25:null,release63:true,withheld:b.withheld_reason||null};})()};
  }
  function card(label,value,unit,note) {return `<div class="evidence-metric"><span>${escape(label)}</span><strong>${escape(value)} <small>${escape(unit)}</small></strong><p>${escape(note)}</p></div>`;}
  function render(record) {
    const x=explain(record),d=record.datasets,s=d.services||{};
    const treeBasis=['lidar_inferred_canopy','lidar_pointcloud_v4','lidar_pointcloud_v5'].includes(d.record?.source_primary)?'Remote detection':'Source inventory';
    const dbh=x.low===null?'—':Math.abs(x.high-x.low)<.01?fmt(x.low):`${fmt(x.low)}–${fmt(x.high)}`;
    let html=`<section class="evidence-summary" aria-label="Evidence at a glance"><div class="evidence-kicker">${treeBasis} · Auckland release</div><h3>${escape(name(record))}</h3><p class="evidence-id">${escape(record.tree_id)}</p><div class="evidence-metrics">`;
    html+=card('Canopy height',fmt(x.height),'m',x.height===null?'No height estimate':x.heightBasis);
    html+=card('Crown footprint',fmt(x.canopyArea),'m²','Segmented canopy estimate');
    html+=card('Modelled trunk diameter',dbh,'cm',x.high!==null&&x.high-x.low>.01?'Range of estimates used by the models':'Estimated from canopy size; a trunk measurement would help');
    html+=card('Avoided runoff',fmt(x.runoff),'m³/year','Model estimate under stored assumptions');
    html+='</div><div class="evidence-actions"><button type="button" data-evidence-action="save">Save for comparison</button><button type="button" data-evidence-action="compare">Compare saved trees</button><button type="button" data-evidence-action="share">Link to this tree</button><button type="button" data-evidence-action="3d">3D tree</button></div><p class="evidence-status" aria-live="polite"></p>';
    html+=`<details class="evidence-dates"><summary>Sources, dates &amp; uncertainty</summary><p>Source record timestamp: ${escape(d.record?.as_of_utc||'Not supplied')}. Research snapshot: ${escape(record.snapshot||'Not supplied')}. These dates describe when the source record and research dataset were updated.</p><p>Canopy dimensions use the 2024 survey product. The canopy surface and its underlying laser returns come from the same survey. Field observations would give us a separate check.</p><p>Trunk size, roots, condition and tree type include estimates. Model scores show relative support for each option. The low and high dollar values show how changing the assumptions affects the result. The full record below keeps all of these estimates and their inputs.</p>`;
    if(s.method_id)html+=`<p>Service method: <code>${escape(s.method_id)}</code>. The full record includes its calculation assumptions.</p>`;
    html+='</details></section>';
    if(d.trajectory){
      const max=Math.max(1,...x.timeline.map(p=>p.height??0));
      html+='<section class="evidence-section"><h3>Canopy through time</h3><div class="evidence-timeline" role="list">';
      for(const p of x.timeline){
        const show=p.height!==null&&p.present!==false;
        html+=`<div role="listitem"><strong>${p.year}</strong><div class="epoch-track"><span style="height:${show?Math.max(2,Math.min(100,p.height/max*100)):0}%"></span></div><b>${show?fmt(p.height)+' m':d.trajectory.fate==='outside_historic_coverage'&&p.year<2024?'Outside coverage':p.present===false?'No matched canopy':'No estimate'}</b></div>`;
      }
      html+=`</div><p>Preserved canopy heights linked across three surveys. The 2024 history uses its original matching geometry; current v5 dimensions are shown above. Gaps can reflect survey coverage or a failed match; dated photos can help establish when a tree appeared or disappeared.${flag(d.trajectory.implausible)?' This trajectory is flagged for review.':''}</p></section>`;
    }
    if(x.trunks.length>1){
      html+='<details class="evidence-section"><summary>Compare the trunk models</summary>';
      for(const t of x.trunks)html+=`<div class="pp-row"><span class="pp-label">${escape(t.label)}</span><span class="pp-value" title="${escape(t.source)}">${fmt(t.value)} cm</span></div>`;
      html+='<p>Each model uses a trunk estimate for its own calculation. Some share inputs. Comparing them shows where a field measurement could resolve a disagreement.</p></details>';
    }
    if(x.questions.length)html+='<details class="evidence-section"><summary>What could we learn next?</summary><ul>'+x.questions.map(q=>`<li><strong>${escape(q.kind)}.</strong> ${escape(q.text)}</li>`).join('')+'</ul><p>Your observations can help check and improve this tree’s record.</p></details>';
    html+='<details class="evidence-section tree-model-details"><summary>Explore this tree in 3D</summary><div class="tree-model-host"></div></details>';
    html+='<section class="evidence-section future-section"><p>Calculating possible future heights…</p></section>';
    return html;
  }
  // ---------- comparison of saved trees ----------
  // The same words and rounding as the tree page and panel (0.2.9): trees by their tree number and species display name
  // (species-names.js), values rounded by the design system's rules (alto-format.js), benefits as the ALTO benefit
  // scenario's sensitivity scenario with its band, plain words for the height measure, and no method or release IDs.
  const FMT=()=>root.ALTOFormat||null,SN=()=>root.ALTOSpeciesNames||null,SRC=()=>root.ALTOSources||null;
  const DASH='–';
  const qty=(key,v)=>{const F=FMT();return number(v)===null?DASH:F?F.quantityText(key,v):fmt(v);};
  const numberOf=r=>r?.datasets?.tree_number?.number||null;
  // The column's name: the recorded species as ALTO shows it; a record naming several species, or none, is "Tree".
  function shown(r){
    const d={...(r.datasets.record||{}),...Object.fromEntries(Object.entries(r.datasets.ground||{}).filter(([k,v])=>['species_common','species_latin'].includes(k)&&v))};
    const ok=v=>typeof v==='string'&&v.trim()&&!/^(unknown|unidentified|not known)$/i.test(v.trim());
    const N=SN(),common=ok(d.species_common)?d.species_common.trim():null,latin=ok(d.species_latin)?d.species_latin.trim():null;
    if(common&&!(N?N.isMulti(common):/,/.test(common))){const t=N?N.display(common,{latin})||common:common;return {text:t,html:N?N.nameHtml(common,{display:t}):escape(t)};}
    if(!common&&latin){const t=N?N.latinText(latin):latin;return {text:t,html:N?N.latinHtml(latin):`<i>${escape(t)}</i>`};}
    return {text:'Tree',html:'Tree'};
  }
  const HEIGHT_MEASURE={v5:'2024 LiDAR survey, highest point of the crown',v4_outside_v5:'Earlier crown, outside the 2024 crown survey',
    legacy_outside_v5:'Earlier crown, outside the 2024 crown survey',
    record_seeded_v52:'2024 survey, crown drawn from the record (awaiting confirmation)'};
  const dateText=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));return m?new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).replace(/\bSept\b/,'Sep'):DASH;};
  function sourceText(r){
    const d=r.datasets.record||{},S=SRC();if(!d.source_primary)return DASH;
    const s=S?S.source(S.classify(d).primary):null;return s?s.label:String(d.source_primary).replace(/_/g,' ');
  }
  const EST=' <span class="badge-estimate">Estimate</span>';
  // [label, estimate?, value as text]
  const METRICS=[
    ['Source',false,r=>sourceText(r)],
    ['Height',false,r=>qty('height',explain(r).height)],
    ['Height measure',false,r=>explain(r).height===null?DASH:HEIGHT_MEASURE[r.datasets.crown?.crown_source]||'Stored canopy estimate'],
    ['Crown area',false,r=>qty('crownArea',explain(r).canopyArea)],
    // A tree measured in the field (tree-record.js field measurements): the newest reading as measured, at its own height,
    // with its dates, then ALTO's estimate.
    ['Trunk diameter',true,r=>{const x=explain(r),F=FMT(),fm=fieldOf(r);
      const t=x.low===null?null:Math.round(x.low)===Math.round(x.high)?qty('trunkDiameter',x.low):(F?.range('trunkDiameter',x.low,x.high)||`${fmt(x.low,0)}–${fmt(x.high,0)} cm`);
      if(fm)return `${F?F.quantityText('trunkDiameter',fm.value,{measuredTape:true}):`${fmt(fm.value)} cm`} · measured at ${fmt(fm.height,2)} m${fm.dates?`, ${fm.dates.text}`:''}${t?`; ALTO estimate ${t}`:''}`;
      if(t===null)return DASH;return `${t} · not measured${x.trunks.length>1?`; ${x.trunks.length} models`:''}`;}],
    // Release 6.3: stormwater and carbon (withheld where the height is not plausible); release 6.2: the services total.
    ['Benefits',true,r=>{const x=explain(r),v=x.annualValue;return v===null?(x.withheld?'withheld: height not plausible':DASH):`${qty('benefits',v)} · ${x.release63?'stormwater and carbon':'sensitivity scenario'}`;}],
    ['Benefits band',true,r=>{const x=explain(r),F=FMT();if(x.valueLow===null||x.valueHigh===null)return DASH;return F?.range('benefits',x.valueLow,x.valueHigh)||`${qty('benefits',x.valueLow)}–${qty('benefits',x.valueHigh)}`;}],
    ['Stormwater runoff avoided',true,r=>qty('stormwater',explain(r).runoff)],
    ['Carbon stored',true,r=>qty('carbonStored',explain(r).carbonStored)],
    ['Carbon taken up a year',true,r=>{const v=explain(r).sequestration,F=FMT();return v===null?DASH:F?F.co2Rate(v):fmt(v,3);}],
    ['PM2.5 removed a year',true,r=>{const v=explain(r).pm25,F=FMT();return v===null?DASH:`${F?F.sigText(v,2):fmt(v,3)} kg · coefficient under review`;}],
    ['Benefit method',false,r=>r.datasets.services?'ALTO benefit scenario':DASH],
    ['Source record date',false,r=>dateText(r.datasets.record?.as_of_utc)],
    ['Record ID',false,r=>r.tree_id||DASH]
  ];
  const NOTE='– means not available for this record. Benefits: ALTO benefit scenario (simplified equations adapted from published i-Tree Eco components; not run in i-Tree Eco), a sensitivity scenario rather than a valuation; from release 6.3, stormwater plus carbon; its band is ±30%, or ±60% for a tree found only by LiDAR. Carbon stored is a total; the other benefits are yearly. Summing trees needs care where crowns overlap or models share inputs.';
  // Heights of 55 m or more (tree-record.js TALL_M, the one constant) as the tree page gives them (SKP-03 interim): the
  // height with its caution, and each estimate computed from it marked "flagged height", as the tree page puts the
  // caution on those cards; the note under the table says what the flag means.
  const REC=()=>root.ALTOTreeRecord||null;
  // The newest field measurement of a tree's trunk, once the map has read the file (evidence-workspace.js waits for it).
  const fieldOf=r=>REC()?.fieldTrunk?.(numberOf(r))||null;
  const tallM=()=>REC()?.TALL_M??55;
  const tallText=()=>REC()?.TALL_TEXT||'unusually tall for Auckland: possibly a power line, structure or noise; not used in rankings';
  // Release 6.3: the height check in the record (height_check: implausible or check) flags the height instead.
  const checked=r=>['implausible','check'].includes(r.datasets?.height_check?.level)?r.datasets.height_check.level:null;
  const flagged=r=>{if(checked(r))return true;const h=explain(r).height;return !r.datasets?.size&&h!==null&&h>=tallM();};
  function cell([label,est,read],r){
    const v=read(r);if(v===DASH||!flagged(r))return v;
    const c=checked(r);
    return label==='Height'?`${v} · ${c?(c==='implausible'?'height not plausible (height check)':'height to check (height check)'):tallText()}`:est?`${v} · flagged height`:v;
  }
  const tallNote=()=>`A flagged height is ${tallM()} m or more: ${tallText().replace(/: /,', ').replace(/; not used in rankings$/,'')}, and is not used in rankings. Estimates computed from it carry the same flag.`;
  // The PM2.5 row is a release 6.2 measure: shown only when a compared record holds it (release 6.3 does not publish
  // PM2.5 removal).
  const metricsFor=records=>METRICS.filter(m=>m[0]!=='PM2.5 removed a year'||records.some(r=>explain(r).pm25!==null));
  function comparison(records) {
    if(!records.length)return '<p>Save a tree from its panel or page, then choose another tree to compare. Up to four trees can be compared.</p>';
    const head=r=>{const n=numberOf(r),nm=shown(r);
      return `<th scope="col"><span class="comparison-name">${nm.html}</span><small>${n?`Tree ${escape(n)}`:`Record ID ${escape(r.tree_id)}`}</small><button type="button" data-remove-tree="${escape(r.tree_id)}" aria-label="Remove ${escape(nm.text)}${n?` ${escape(n)}`:''} from the comparison">Remove</button></th>`;};
    return '<div class="comparison-scroll" tabindex="0" aria-label="Tree comparison; scroll across for all trees"><table><caption>Individual-tree values · same measures side by side</caption><thead><tr><th scope="col">Measure</th>'+records.map(head).join('')+'</tr></thead><tbody>'+
      metricsFor(records).map(m=>{const [label,est]=m;return `<tr><th scope="row">${escape(label)}${est?EST:''}</th>${records.map(r=>`<td>${label==='Record ID'?`<code>${escape(cell(m,r))}</code>`:escape(cell(m,r))}</td>`).join('')}</tr>`;}).join('')+
      `</tbody></table></div><p class="comparison-note">${escape(NOTE)}${records.some(flagged)?` ${escape(records.some(checked)?'A flagged height is one the release’s height check marks not plausible or to check; it is not used in rankings, and estimates computed from it carry the same flag.':tallNote())}`:''}</p>`;
  }
  function csv(records) {
    const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
    const M=metricsFor(records);
    return [['tree_number','record_id','name',...M.map(x=>x[0])],...records.map(r=>[numberOf(r)||'',r.tree_id,shown(r).text,...M.map(m=>cell(m,r))])].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
  }
  const api={number,explain,render,comparison,csv,name};root.ALTOEvidence=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
