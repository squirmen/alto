/* V6 growth form: the model's estimate of a crown's growth form (A2 + C1 palm detector), never an identified species.
 *
 * Tree and crown tiles carry gf6, a display key, on every tree whose crown was scored. Full records carry the
 * growth_form dataset (display_key, wording, probabilities, band, flight date). A recorded species always
 * stays the species shown; the model's growth form is a separate line labelled "(model)". Records and tiles
 * without these fields render nothing here, so an earlier release looks exactly as before.
 *
 * The wording is PHASE2B_RESULT.md section 9 / PHASE2_DECISION.md 13.10 with the v6 decisions; it must match
 * release_tools/v6_common.py WORDING (tests/test_v6_release.py checks). */
(function(root){
  'use strict';
  const WORDING={
    evergreen_high:"Evergreen broadleaf (model, high confidence)",
    evergreen_medium:"Probably evergreen broadleaf (model)",
    deciduous_high:"Deciduous broadleaf (model, high confidence; bare in late-autumn LiDAR)",
    deciduous_likely:"Likely deciduous (bare in late-autumn LiDAR)",
    broadleaf:"Broadleaf (model)",
    conifer:"Likely conifer (model)",
    possibly_conifer:"Possibly conifer (model)",
    palm_c1:"Likely palm or cabbage tree (palm-type crown seen in 2024 aerial imagery)",
    palm_or_cabbage_tree:"Likely palm or cabbage tree (model)",
    tree_fern:"Likely tree fern (model)",
    possibly_palm_type:"Possibly palm, cabbage tree or tree fern (model)",
    not_determined:"Growth form not yet determined"
  };
  // Filter and colour groups: [group, label, colour, display keys]. Colours from the design system
  // (palette.js, growth form legend); "not determined" and "not estimated" share the fold colour.
  const P=root.ALTOPalette||(typeof require==='function'?require('./palette.js'):null);
  const C=k=>P.colour('structure',k);
  const GROUPS=[
    ['evergreen','Evergreen broadleaf',C('evergreen'),['evergreen_high','evergreen_medium']],
    ['conifer','Conifer',C('conifer'),['conifer','possibly_conifer']],
    ['deciduous','Deciduous broadleaf',C('deciduous'),['deciduous_high','deciduous_likely']],
    ['palm_type','Palm, cabbage tree or tree fern',C('palm_type'),['palm_c1','palm_or_cabbage_tree','tree_fern','possibly_palm_type']],
    ['broadleaf','Broadleaf, leaf habit not determined',C('broadleaf'),['broadleaf']],
    ['not_determined','Growth form not determined',C('not_determined'),['not_determined']],
    ['none','Not estimated',C('none'),[]]
  ];
  const GROUP_KEYS=GROUPS.map(g=>g[0]);
  const NOTE='A model estimate from the 2024 laser survey and aerial imagery, not an identified species.';
  const NOTE_UNDETERMINED='The model could not yet tell this crown\u2019s growth form from the 2024 laser survey and aerial imagery.';
  const PROB=[['p_evergreen_broadleaf','Evergreen broadleaf'],['p_deciduous_broadleaf','Deciduous broadleaf'],['p_conifer','Conifer'],
    ['p_palm','Palm'],['p_palm_like','Cabbage tree or similar'],['p_tree_fern','Tree fern']];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const UNKNOWN=/^(unknown|unidentified( tree)?|not known|species not recorded|species unrecorded|0 records found\.?)$/i;

  // The display key, from the full record when loaded and otherwise from the map tile.
  function key(props,record){
    const g=record?.datasets?.growth_form;
    if(g&&WORDING[g.display_key])return g.display_key;
    return WORDING[props?.gf6]?props.gf6:null;
  }
  const wording=k=>WORDING[k]||null;
  function group(k){for(const g of GROUPS)if(g[3].includes(k))return g[0];return 'none';}
  // The species a source recorded, or null.
  function recorded(props,record){
    const r={...(record?.datasets?.record||{}),...(props||{})};
    for(const v of [r.species_common,r.species_latin]){
      if(typeof v==='string'&&v.trim()&&!UNKNOWN.test(v.trim()))return v.trim();
    }
    return null;
  }
  // One profile row for the quick (tile) view: label and value, or null.
  function row(props){
    const k=key(props);
    return k?{label:'Growth form (model)',value:WORDING[k],note:'model estimate'}:null;
  }
  function render(record,props){
    const k=key(props,record);
    if(!k)return '';
    const g=record?.datasets?.growth_form||{},s=record?.datasets?.services||{},name=recorded(props,record);
    let html=`<section class="pp-section growth-form" data-growth-form="${esc(k)}"><div class="pp-section-title">Growth form (model)</div>`+
      `<p class="growth-form-call">${esc(WORDING[k])}</p><p class="pp-note">${k==='not_determined'?NOTE_UNDETERMINED:NOTE}`;
    if(name)html+=` The species recorded for this tree, ${esc(name)}, stays its species.`;
    html+='</p>';
    if(k==='not_determined'&&(s.growth_form_default===1||s.species_class_source==='default_evergreen_broadleaf_assumption'||s.species_class_source==='v6_default_evergreen_growth_form_not_determined'))
      html+='<p class="pp-note">Benefit estimate assumes an evergreen broadleaf tree (growth form not yet determined).</p>';
    const probs=PROB.filter(([f])=>g[f]!==null&&g[f]!==undefined);
    if(probs.length){
      html+='<details class="growth-form-scores"><summary>How the model scored this crown</summary>';
      for(const [f,label] of probs)html+=`<div class="pp-row"><span class="pp-label">${esc(label)}</span><span class="pp-value">${Math.round(Number(g[f])*100)}%</span></div>`;
      const facts=[];
      if(g.band)facts.push(g.band==='abstained'?'no class reached 50%':`${g.band} confidence band`);
      if(g.c1_override===1||g.c1_override===true)facts.push(g.guard_v2?'a palm detection on this wide crown was set aside':'the palm detector saw a palm crown in the 2024 aerial imagery');
      if(g.lidar_flight_date)facts.push(`laser survey flown ${esc(g.lidar_flight_date)}`);
      if(facts.length)html+=`<p class="pp-note">${esc(facts.join('; '))}.</p>`;
      html+='<p class="pp-note">Scores are calibrated model probabilities for the crown. A growth form is shown only where calls like this one were right at least 8 times in 10 on checked crowns (6 in 10 for “possibly”).</p></details>';
    }
    return html+'</section>';
  }
  // One line at the top of the full record, under its heading, so the growth form is seen without scrolling.
  function line(record,props){
    const k=key(props,record);
    return k?`<p class="growth-form-line"><span>Growth form (model)</span> ${esc(WORDING[k])}</p>`:'';
  }
  // After the full record loads: the line under the heading, and the section under the record link or the summary.
  function mount(container,record,props){
    const html=render(record,props);
    if(!html)return;
    const head=container.querySelector('.evidence-summary .evidence-place')||container.querySelector('.evidence-summary .evidence-id');
    if(head)head.insertAdjacentHTML('afterend',line(record,props));
    const anchor=container.querySelector('.record-link')||container.querySelector('.evidence-summary');
    if(anchor)anchor.insertAdjacentHTML('afterend',html);
  }
  // Map expressions: the group of a feature's display key.
  function groupExpr(){
    const e=['match',['coalesce',['get','gf6'],'__none__']];
    for(const g of GROUPS)if(g[3].length)e.push(g[3],g[0]);
    e.push('none');
    return e;
  }
  function filter(visible){
    if(!visible||visible.size===GROUP_KEYS.length)return null;
    const on=GROUP_KEYS.filter(k=>visible.has(k));
    if(!on.length)return ['==',['get','tree_id'],'__none__'];
    return ['match',groupExpr(),on,true,false];
  }
  function colour(){
    const e=['match',['coalesce',['get','gf6'],'__none__']];
    for(const g of GROUPS)if(g[3].length)e.push(g[3],g[2]);
    e.push(GROUPS[GROUPS.length-1][2]);
    return e;
  }
  const legend=()=>P.rows('structure').map(x=>[x.colour,x.label]);
  function toggles(visible){
    return GROUPS.map(([k,label,colour])=>`<button class="legend-row" type="button" data-growth-form="${k}" aria-pressed="${visible.has(k)}"><span class="dot" style="background:${colour}"></span><span>${esc(label)}</span></button>`).join('');
  }
  // The filter appears only when the release metadata lists the growth-form product.
  const shipped=m=>!!m&&!!(m.derived_products?.growth_form||(m.models||[]).some(x=>x?.component==='growth_form_v6'));

  const api={WORDING,GROUPS,GROUP_KEYS,NOTE,NOTE_UNDETERMINED,key,wording,group,recorded,row,render,line,mount,groupExpr,filter,colour,legend,toggles,shipped};
  root.ALTOGrowthForm=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
