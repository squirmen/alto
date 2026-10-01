/* Explicitly conditional scenarios, separate from the stored observations. */
(function(root){
  'use strict';
  const valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0;
  const detected=v=>v===true||v===1||v==='1';
  const fmt=v=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:1}).format(v);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let modelPromise;
  async function load(base,version){
    if(!modelPromise)modelPromise=fetch(`${base}/longitudinal/model.json?v=${encodeURIComponent(version)}`).then(r=>{if(!r.ok)throw new Error('Longitudinal model unavailable');return r.json();}).catch(e=>{modelPromise=null;throw e;});
    return modelPromise;
  }
  const contextCache=new Map();
  function cachedJSON(url){
    if(!contextCache.has(url)){contextCache.set(url,fetch(url).then(async response=>{if(!response.ok)throw new Error('Growth context unavailable');let bytes=new Uint8Array(await response.arrayBuffer());if(bytes[0]===31&&bytes[1]===139)bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());return JSON.parse(new TextDecoder().decode(bytes));}).catch(error=>{contextCache.delete(url);throw error;}));if(contextCache.size>12)contextCache.delete(contextCache.keys().next().value);}
    return contextCache.get(url);
  }
  async function prepare(record,model,base,version){
    if(record.datasets.identity)return {...record,model_context:{local_growth:null,local_growth_unavailable:true}};
    if(!model.projection.neighbour_trend_weight)return record;
    const dir=`${base}/growth_context`,q=`?v=${encodeURIComponent(version)}`;
    try{
      const [manifest,bucket]=await Promise.all([cachedJSON(`${dir}/manifest.json${q}`),cachedJSON(`${dir}/${ALTOTreeDetails.bucketId(record.tree_id)}.json.gz${q}`)]);
      if(String(manifest.database_mtime_ns)!==String(record.database_mtime_ns)||manifest.fit_id!==model.fit_id)throw new Error('Growth context describes a different model fit');
      const values=bucket[record.tree_id];
      return {...record,model_context:{local_growth:values?{n:values[0],median_change_m_y:values[1],nearest_m:values[2],furthest_m:values[3],fit_id:model.fit_id}:null}};
    }catch{return {...record,model_context:{local_growth:null,local_growth_unavailable:true}};}
  }
  function project(record,model){
    if(String(record.database_mtime_ns)!==String(model.application_database_mtime_ns||model.database_mtime_ns))return {unavailable:'The forecast and tree record describe different releases.'};
    const t=record.datasets.trajectory||{},c=record.datasets.crown||{};
    const h=valid(c.crown_max_chm_m)?Number(c.crown_max_chm_m):record.datasets.identity?null:detected(t.present_2024)&&valid(t.h_2024)?Number(t.h_2024):null;
    if(h===null)return {unavailable:'A 2024 canopy maximum is needed to anchor a height scenario.'};
    const cohort=model.projection.cohort_model.cohorts.find(c=>h>=c.low_height_m&&h<c.high_height_m);
    if(!cohort)return {unavailable:'This height is outside the fitted cohort range.'};
    let personal=null,span=null;
    if(detected(t.present_2024)&&valid(t.h_2024)&&!(record.datasets.identity?.old_overlapping_crowns>1||record.datasets.identity?.new_overlapping_crowns>1)){
      for(const year of [2016,2013])if(detected(t['present_'+year])&&valid(t['h_'+year])){span=2024-year;personal=(Number(t.h_2024)-Number(t['h_'+year]))/span;break;}
    }
    const weight=personal===null?0:model.projection.personal_trend_weight;
    const local=record.model_context?.local_growth,hasLocal=Boolean(local&&local.fit_id===model.fit_id&&local.n>=8&&Number.isFinite(local.median_change_m_y));
    const neighbourWeight=hasLocal?(model.projection.neighbour_trend_weight||0):0;
    const rate=(1-weight-neighbourWeight)*cohort.annual_change_quantiles[1]+weight*(personal??0)+neighbourWeight*(hasLocal?local.median_change_m_y:0);
    const points=model.projection.horizons.map(year=>{const delta=year-2024,central=Math.max(0,h+rate*delta),half=model.projection.annual_band_halfwidth_m*delta;return {year,height_m:central,low_m:Math.max(0,h+rate*delta-half),high_m:Math.max(0,h+rate*delta+half)};});
    const observed=[2013,2016,2024].filter(y=>detected(t['present_'+y])&&valid(t['h_'+y]));
    let interpolated=null;
    if(observed.includes(2013)&&observed.includes(2024)&&!observed.includes(2016)){
      const height=Number(t.h_2013)+(Number(t.h_2024)-Number(t.h_2013))*3/11,w=model.interpolation.validation_abs_error_90_m;
      interpolated={year:2016,height_m:height,low_m:w===null?null:Math.max(0,height-w),high_m:w===null?null:height+w,kind:'interpolated',assumption:'Same canopy persisted between the bounding detections.'};
    }
    return {model_id:model.model_id,fit_id:model.fit_id,anchor_year:2024,anchor_height_m:h,cohort_n:cohort.n,cohort_rate:cohort.annual_change_quantiles[1],personal_rate:personal,personal_span:span,personal_weight:weight,neighbour_weight:neighbourWeight,neighbour_n:hasLocal?local.n:0,neighbour_rate:hasLocal?local.median_change_m_y:null,local_context_unavailable:record.model_context?.local_growth_unavailable||false,annual_change_m:rate,points,interpolated,observed_span_years:observed.length>1?observed.at(-1)-observed[0]:null};
  }
  function render(record,model){
    const p=project(record,model);
    if(p.unavailable)return `<p>${esc(p.unavailable)}</p>`;
    let html='<h3>A possible future</h3><p>How tall might this canopy become if recent patterns continue? These estimates assume the tree remains in place. They leave future pruning, storms, development and climate changes open.</p><div class="future-points">';
    for(const row of p.points)html+=`<div><span>${row.year}</span><strong>${fmt(row.height_m)} m</strong><small>${fmt(row.low_m)}–${fmt(row.high_m)} m<br>range based on past errors</small></div>`;
    html+='</div><details><summary>How this scenario was calculated</summary>';
    if(record.datasets.identity)html+='<p>The earlier fitted model is applied to the current crown height. Its original benchmark is retained; transfer to the v5 redraw has yet to be tested. Nearby-history weighting is omitted pending a new spatial fit.</p>';
    if(record.datasets.trajectory?.fate==='outside_historic_coverage'||!record.datasets.trajectory)html+='<p>This tree has no linked earlier canopy record. Its forecast draws on other trees with recorded histories.</p>';
    html+=`<p>Starts from ${fmt(p.anchor_height_m)} m in 2024. The group of trees used for this height estimate contains ${new Intl.NumberFormat('en-NZ').format(p.cohort_n)} matched histories.${p.personal_rate===null?' No earlier height is linked to this tree.':` This tree’s observed canopy change was ${fmt(p.personal_rate)} m/year across ${p.personal_span} years; the historical benchmark selected a ${Math.round(p.personal_weight*100)}% weight on that trend.`}</p>`;
    if(p.neighbour_weight)html+=`<p>${p.neighbour_n} nearby matched histories contribute a median change of ${fmt(p.neighbour_rate)} m/year, with ${Math.round(p.neighbour_weight*100)}% weight. These are the nearest available other histories within 500 m, requiring at least eight. Their recorded changes help estimate what could happen here.</p>`;
    else if(model.projection.neighbour_trend_weight)html+=`<p>${p.local_context_unavailable?'Nearby-history data could not load; the cohort fallback is shown.':'Fewer than eight qualifying nearby histories are available; the cohort fallback is shown.'}</p>`;
    if(record.datasets.roots?.root_constraint_flag)html+=`<p>The current root-space model is labelled ${esc(record.datasets.roots.root_constraint_flag)}. We still need dated information about paving and root space to test how these conditions affect growth.</p>`;
    const b=model.benchmark;
    html+=`<p>On held-out geographic blocks, an eight-year hindcast had ${fmt(b.model.mae_m)} m mean absolute error; carrying the old height forward had ${fmt(b.no_change.mae_m)} m error. The model’s empirical band covered ${fmt(b.heldout_empirical_band_coverage*100)}% of those later canopy estimates. The test covers five geographic blocks. Neighbour locations come from linked survey records; we still need to check which survey supplied each position. The matching algorithm already favours plausible height changes. Field measurements and tests in more areas would help check how well these results transfer.</p><p>The range widens with time in proportion to errors in the eight-year test. We have yet to test that assumption over the longer period to 2040. Each forecast uses one annual change from the 2024 height. A falling height may reflect pruning, survey differences or a mismatched canopy; tree survival requires a separate model.</p><p>Method: <code>${esc(model.model_id)}</code>. All observations remain unchanged.</p></details>`;
    if(p.interpolated){const i=p.interpolated;html+=`<details><summary>Estimate a missing historical height</summary><p><strong>2016: approximately ${fmt(i.height_m)} m</strong> — linearly interpolated between the 2013 and 2024 detections, assuming the same canopy persisted.${i.low_m===null?'':` Empirical error scenario: ${fmt(i.low_m)}–${fmt(i.high_m)} m.`} A dated photo or another survey could help check this estimate.</p></details>`;}
    if(p.observed_span_years!==null)html+=`<p class="observed-span">Time between linked surveys: ${p.observed_span_years} years. The tree may be much older.</p>`;
    return html;
  }
  const api={load,prepare,project,render};root.ALTOFuture=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
