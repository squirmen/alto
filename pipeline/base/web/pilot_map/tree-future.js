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
  function project(record,model){
    if(String(record.database_mtime_ns)!==String(model.database_mtime_ns))return {unavailable:'The forecast and tree record describe different releases.'};
    const t=record.datasets.trajectory||{},c=record.datasets.crown||{};
    const h=detected(t.present_2024)&&valid(t.h_2024)?Number(t.h_2024):valid(c.crown_max_chm_m)?Number(c.crown_max_chm_m):null;
    if(h===null)return {unavailable:'A 2024 canopy maximum is needed to anchor a height scenario.'};
    const cohort=model.projection.cohort_model.cohorts.find(c=>h>=c.low_height_m&&h<c.high_height_m);
    if(!cohort)return {unavailable:'This height is outside the fitted cohort range.'};
    let personal=null,span=null;
    if(detected(t.present_2024)&&valid(t.h_2024)){
      for(const year of [2016,2013])if(detected(t['present_'+year])&&valid(t['h_'+year])){span=2024-year;personal=(h-Number(t['h_'+year]))/span;break;}
    }
    const weight=personal===null?0:model.projection.personal_trend_weight;
    const rate=(1-weight)*cohort.annual_change_quantiles[1]+weight*(personal??0);
    const points=model.projection.horizons.map(year=>{const delta=year-2024,central=Math.max(0,h+rate*delta),half=model.projection.annual_band_halfwidth_m*delta;return {year,height_m:central,low_m:Math.max(0,h+rate*delta-half),high_m:Math.max(0,h+rate*delta+half)};});
    const observed=[2013,2016,2024].filter(y=>detected(t['present_'+y])&&valid(t['h_'+y]));
    let interpolated=null;
    if(observed.includes(2013)&&observed.includes(2024)&&!observed.includes(2016)){
      const height=Number(t.h_2013)+(Number(t.h_2024)-Number(t.h_2013))*3/11,w=model.interpolation.validation_abs_error_90_m;
      interpolated={year:2016,height_m:height,low_m:w===null?null:Math.max(0,height-w),high_m:w===null?null:height+w,kind:'interpolated',assumption:'Same canopy persisted between the bounding detections.'};
    }
    return {model_id:model.model_id,fit_id:model.fit_id,anchor_year:2024,anchor_height_m:h,cohort_n:cohort.n,cohort_rate:cohort.annual_change_quantiles[1],personal_rate:personal,personal_span:span,personal_weight:weight,annual_change_m:rate,points,interpolated,observed_span_years:observed.length>1?observed.at(-1)-observed[0]:null};
  }
  function render(record,model){
    const p=project(record,model);
    if(p.unavailable)return `<p>${esc(p.unavailable)}</p>`;
    let html='<h3>A possible future</h3><p>Conditional on this canopy remaining present, with past patterns continuing. These are exploratory scenarios; storms, pruning, redevelopment and climate change are not predicted.</p><div class="future-points">';
    for(const row of p.points)html+=`<div><span>${row.year}</span><strong>${fmt(row.height_m)} m</strong><small>${fmt(row.low_m)}–${fmt(row.high_m)} m<br>empirical error scenario</small></div>`;
    html+='</div><details><summary>How this scenario was calculated</summary>';
    if(record.datasets.trajectory?.fate==='outside_historic_coverage'||!record.datasets.trajectory)html+='<p>No linked historic coverage at this location. This is a transfer from the observed height cohorts, not a locally verified growth trajectory.</p>';
    html+=`<p>Anchored at ${fmt(p.anchor_height_m)} m in 2024. The fitted height cohort contains ${new Intl.NumberFormat('en-NZ').format(p.cohort_n)} matched histories.${p.personal_rate===null?' No personal height trend is available; this uses the cohort alone.':` This tree’s observed canopy change was ${fmt(p.personal_rate)} m/year across ${p.personal_span} years; the historical benchmark selected a ${Math.round(p.personal_weight*100)}% weight on that trend.`}</p>`;
    const b=model.benchmark;
    html+=`<p>On held-out geographic blocks, an eight-year hindcast had ${fmt(b.model.mae_m)} m mean absolute error; carrying the old height forward had ${fmt(b.no_change.mae_m)} m error. The model’s empirical band covered ${fmt(b.heldout_empirical_band_coverage*100)}% of those later canopy estimates. The test covers five geographic blocks. The matching algorithm also uses height plausibility, so this is not independent field validation or a guaranteed probability for this tree.</p><p>Error width is scaled linearly beyond 2024, an explicit assumption that has not been tested over the 2040 horizon. Negative trends may reflect pruning, matching or survey differences. Zero does not predict death.</p><p>Method: <code>${esc(model.model_id)}</code>. All observations remain unchanged.</p></details>`;
    if(p.interpolated){const i=p.interpolated;html+=`<details><summary>Estimate a missing historical height</summary><p><strong>2016: approximately ${fmt(i.height_m)} m</strong> — linearly interpolated between the 2013 and 2024 detections, assuming the same canopy persisted.${i.low_m===null?'':` Empirical error scenario: ${fmt(i.low_m)}–${fmt(i.high_m)} m.`} This is a modelled gap, not a recovered observation or evidence of continuous presence.</p></details>`;}
    if(p.observed_span_years!==null)html+=`<p class="observed-span">Matched observation span: ${p.observed_span_years} years. This is not the tree’s age.</p>`;
    return html;
  }
  const api={load,project,render};root.ALTOFuture=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
