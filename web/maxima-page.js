/* Species maxima list (maxima.html, tool 0.2.8): the largest measured tree of each species by height, crown spread
 * and crown area, Auckland-wide or in a local board, from the release's maxima.json (species-maxima.js).
 * Filters: measure (tabs), species (common or Latin name, accents ignored) and area; the table sorts on any column.
 * Each row: the tree's own 2024 crown outline at one scale for the page, the value with its margin and unit, the
 * tree number linked to its page and a map link. A near-tie's rank reads "near-tie: within ±2 m of the next measured
 * tree (21.9 m)", never "1 of N". The scope note above the list (#scope) is where every Maximum line links.
 * The address keeps the view (?measure=spread&area=Ōrākei&species=tōtara). Methods template (methods.css). */
(function(){
  'use strict';
  const M=window.ALTOMaxima,Ver=window.ALTOVersion;
  const SITE_ROOT=(window.ALTO_SITE_ROOT||'.').replace(/\/+$/,'')||'.';
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=(v,d=1)=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:d}).format(v);
  const VALUE_HEAD={max_height:'Height',max_crown_spread:'Crown spread',max_crown_area:'Crown area'};
  const view={measure:'max_height',area:M.AUCKLAND,q:'',sort:'value',dir:'desc'};
  let D=null,span=30,maxH=1;

  function readAddress(){
    const p=new URL(location.href).searchParams;
    view.measure=M.MEASURE_KEYS[p.get('measure')]||(M.MEASURES.includes(p.get('measure'))?p.get('measure'):'max_height');
    const a=p.get('area');if(a){const hit=M.areaList(D).find(x=>M.fold(x)===M.fold(a));if(hit)view.area=hit;}
    view.q=p.get('species')||'';
  }
  function writeAddress(){
    const u=new URL(location.href),key=Object.keys(M.MEASURE_KEYS).find(k=>M.MEASURE_KEYS[k]===view.measure);
    u.searchParams.delete('measure');u.searchParams.delete('area');u.searchParams.delete('species');
    if(key!=='height')u.searchParams.set('measure',key);
    if(view.area!==M.AUCKLAND)u.searchParams.set('area',view.area);
    if(view.q.trim())u.searchParams.set('species',view.q.trim());
    history.replaceState(null,'',u.pathname+(u.search?u.search:'')+u.hash);
  }

  // ---------- page text from the data ----------
  function intro(){
    const boards=M.areaList(D).filter(a=>a!==M.AUCKLAND);
    $('#scope').textContent=M.scopeNote(D);
    $('#mxCoverage').innerHTML=`<b>Coverage.</b> Only trees whose species comes from a record are included: Auckland Council’s tree register or its Notable Trees schedule. Most are on the central isthmus, where the register names species. ${nf(boards.length,0)} local ${boards.length===1?'board qualifies':'boards qualify'} so far${boards.length?`: ${esc(listAnd(boards))}`:''}.`;
    const margins=key=>[...new Set(D.maxima.filter(m=>m.measure===key).map(m=>m.margin))];
    const fixed=key=>{const ms=margins(key),m=D.maxima.find(x=>x.measure===key);return ms.length===1&&m?` Margin ±${nf(ms[0],m.unit==='m²'?0:1)}\u00a0${m.unit}.`:'';};
    const note=D.copy.margin_note||{};
    // Height and the two crown widths in the words the tree page and the methods use (M.DEFINITIONS); the release's
    // own notes add how each is measured.
    const D_=M.DEFINITIONS,hm=margins('max_height');
    // Release 6.3's maxima file (version 2) carries its checks note and the release's flags among its checks.
    const v2=!!D.copy.checks_note;
    const items=[
      ['Height',`${D_.height}. The highest single laser return is usually 0.3–1.9\u00a0m higher; airborne LiDAR usually reads below a field (hypsometer) height on a pointed crown.${hm.length===1?` ±${nf(hm[0],Number.isInteger(hm[0])?0:1)}\u00a0m is the ${M.HEIGHT_MARGIN_NOTE}.`:''}`],
      ['Crown spread',`${D_.crownSpread}, 2024 LiDAR.${fixed('max_crown_spread')} Ranked here; a tree page’s Maximum line calls it the “widest crown spread”.`],
      ['Crown diameter (equal-area circle)',`${D_.crownDiameter}, shown on tree pages beside the crown spread; not ranked here. A crown that is not round usually has a crown spread wider than its equal-area diameter.`],
      ['Crown area',`${note.max_crown_area||''}${fixed('max_crown_area')} ${M.MERGE_CAP_TEXT} Crown areas of ${nf(M.NEAR_CAP_M2,0)}\u00a0m² or more${D.maxima.some(m=>m.segmentation_cap===true)?', and the crown spreads of those crowns,':''} read “${D.copy.segmentation_cap||M.NEAR_CAP_TEXT}”.`],
      ['Which trees',`A species is ranked across Auckland when at least 20 of its crowns pass ALTO’s checks, and in a local board when at least 10 do. The checks leave out crowns that hold more than one tree, crowns cut at a LiDAR tile edge, and crowns whose species record sits near the crown’s edge.${v2?' From release 6.3 they also leave out crowns whose height or record-to-crown link is flagged, and crowns holding a Schedule 10 entry that lists more trees than ALTO maps there.':''}`],
      ['Checks',D.copy.checks_note||'Each maximum was checked against the 2024 aerial imagery and LiDAR profile by a machine-learning image-interpretation model (one pass; no independent second check yet).'],
      ['Near-ties',`Where the next measured tree is within the margin, the row says “${D.copy.within_margin||'within the margin of the next measured tree'}” and the tree page shows no Maximum label.`],
      ['Season','The ranked crowns were flown from late April to June 2024. Deciduous trees were partly bare, so their crown spread and area may read low.']
    ];
    $('#mxMethod').innerHTML=items.map(([k,v])=>`<li><strong>${esc(k)}.</strong> ${esc(v)}</li>`).join('');
    $('#mxMethodLink').innerHTML=`How ALTO draws crowns from the 2024 LiDAR survey and aerial imagery: <a href="${esc(SITE_ROOT)}/v5-methods.html#crown-outline">Release 5 methods</a>.`;
    $('#mxSources').innerHTML=(D.sources||[]).map(s=>`<li><strong>${esc(s.name)}</strong>. ${esc(s.by)}; ${esc(s.licence)}.${s.url?` <a href="${esc(s.url)}">${esc(linkText(s.url))}</a>`:''}</li>`).join('');
    const built=M.dateText(D.built),from=releaseOf(D.dataset),live=releaseOf(D.liveRelease);
    const check=D.check;
    // Girth is not measured: the line links KYTE's girth missions (UX-01), where a tape reading can be added.
    $('#mxReleaseNote').innerHTML=[from?esc(`Computed on release ${from}${built?` (${built})`:''}.`):null,
      check&&live&&live!==from?esc(`${check.text||`Checked against release ${live}`}${check.on?`; checked ${M.dateText(check.on)}`:''}.`):null,
      `<a href="${esc(SITE_ROOT)}/kyte/missions/#girth">Girth is not measured</a>: KYTE’s girth missions ask for a tape reading at 1.4 m above the ground (on a slope, from mid-slope).`].filter(Boolean).join(' ');
    const sel=$('#mxArea');
    sel.innerHTML=M.areaList(D).map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
    const names=Object.entries(D.species||{}).filter(([sp])=>D.maxima.some(m=>m.species===sp));
    $('#mxSpeciesList').innerHTML=names.sort((a,b)=>M.fold(a[1].name).localeCompare(M.fold(b[1].name),'en-NZ')).map(([sp,s])=>`<option value="${esc(s.name)}">${esc(M.latin(sp))}</option>`).join('');
    span=M.sharedSpan(D);
    maxH=Math.max(1,...D.maxima.filter(m=>m.measure==='max_height').map(m=>m.value));
    $('#mxScale').textContent=`Crown outlines from the 2024 LiDAR survey, each drawn around its own centre at one scale for the page: the box is ${nf(span,0)} m across. Height bars share one scale, 0 to ${nf(Math.ceil(maxH/5)*5,0)} m.`;
  }
  const listAnd=a=>a.length<2?a.join(''):`${a.slice(0,-1).join(', ')} and ${a[a.length-1]}`;
  const releaseOf=dv=>{const m=/-v(\d+(?:\.\d+)?)$/.exec(String(dv||''));return m?m[1]:null;};

  // ---------- table ----------
  function render(){
    for(const b of document.querySelectorAll('.mx-tabs [data-measure]'))b.setAttribute('aria-pressed',String(b.dataset.measure===view.measure));
    $('#mxValueHead').textContent=VALUE_HEAD[view.measure];
    $('#mxArea').value=view.area;
    if($('#mxSpecies').value!==view.q)$('#mxSpecies').value=view.q;
    $('#mxSort').value=`${view.sort}:${view.dir}`;
    for(const th of document.querySelectorAll('#mxTable thead th[aria-sort]')){const k=th.querySelector('[data-sort]')?.dataset.sort;th.setAttribute('aria-sort',k===view.sort?(view.dir==='desc'?'descending':'ascending'):'none');}
    $('#mxMap').href=`./?maxima=${encodeURIComponent(view.area)}`;
    const rows=M.listRows(D,{measure:view.measure,area:view.area,q:view.q,sort:view.sort,dir:view.dir});
    const all=M.areaMaxima(D,{measure:view.measure,area:view.area}).length;
    const ties=rows.filter(r=>r.within).length;
    $('#mxCount').textContent=!all?'No species has enough checked trees in this area yet.':!rows.length?`No species maximum matches “${view.q.trim()}” in ${view.area}.`:
      `${nf(rows.length,0)} species, ${VALUE_HEAD[view.measure].toLowerCase()}, ${view.area}${ties?` · ${nf(ties,0)} within the margin of the next measured tree`:''}`;
    $('#mxTable').hidden=!rows.length;
    // What the ± after each value is (TS-19: the height margin is captioned as the ranking margin, beside the survey's).
    const ms=[...new Set(D.maxima.filter(m=>m.measure===view.measure).map(m=>m.margin))],u=view.measure==='max_crown_area'?'m²':'m';
    const pm=ms.length===1?`±${nf(ms[0],Number.isInteger(ms[0])?0:1)}\u00a0${u}`:'±';
    $('#mxMargin').textContent=!rows.length?'':view.measure==='max_height'?`${pm} after each height is the ${M.HEIGHT_MARGIN_NOTE}.`
      :view.measure==='max_crown_spread'?`${pm} after each crown spread is the ranking margin.`:'± after each crown area is the ranking margin: the crown perimeter × 0.5\u00a0m.';
    $('#mxRows').innerHTML=rows.map(row).join('');
    writeAddress();
  }
  function row(r){
    const latin=r.name!==r.species?` <i>${esc(M.latin(r.species))}</i>`:'';
    const d=r.unit==='m²'?0:1;
    const bar=r.measure==='max_height'?`<span class="mx-bar" aria-hidden="true"><i style="width:${Math.min(100,r.value/(Math.ceil(maxH/5)*5)*100).toFixed(1)}%"></i></span>`:'';

    const crown=M.outlineSvg(r.outline,{size:44,span,label:`Crown outline of ${r.tree}, 2024`});
    return `<tr${r.within?' class="is-tie"':''}><td class="mx-c">${crown}</td>`+
      `<th scope="row"><span class="mx-sp">${window.ALTOSpeciesNames?window.ALTOSpeciesNames.nameHtml(r.name,{display:r.name}):esc(r.name)}</span>${latin}${r.recordedAs?`<small class="mx-as">recorded as ${r.recordedAs.map(x=>`<i>${esc(M.latin(x))}</i>`).join(', ')}</small>`:''}</th>`+
      `<td class="mx-v"><span class="mx-num"><b>${nf(r.value,d)}\u00a0${esc(r.unit)}</b> <span class="mx-pm">±${nf(r.margin,d)}\u00a0${esc(r.unit)}</span></span>${bar}${r.nearCap?`<small class="mx-cap">${esc(M.current?.copy?.segmentation_cap||M.NEAR_CAP_TEXT)}</small>`:''}</td>`+
      `<td class="mx-t"><a href="./tree.html?id=${encodeURIComponent(r.tree)}"><code>${esc(r.tree)}</code></a> <a class="mx-pin" href="./?tree=${encodeURIComponent(r.tree)}" aria-label="Tree ${esc(r.tree)} on the map">Map</a></td>`+
      `<td class="mx-b">${esc(r.board||'')}</td>`+(r.within?`<td class="mx-n mx-n-tie">${esc(M.rankText(r))}<small>${nf(r.n,0)} measured</small></td>`:`<td class="num mx-n">${esc(M.rankText(r))}</td>`)+'</tr>';
  }

  function bind(){
    document.querySelector('.mx-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-measure]');if(!b)return;view.measure=b.dataset.measure;render();});
    $('#mxArea').addEventListener('change',e=>{view.area=e.target.value;render();});
    $('#mxSpecies').addEventListener('input',e=>{view.q=e.target.value;render();});
    $('#mxSort').addEventListener('change',e=>{[view.sort,view.dir]=e.target.value.split(':');render();});
    $('#mxTable thead').addEventListener('click',e=>{
      const b=e.target.closest('[data-sort]');if(!b)return;const k=b.dataset.sort;
      if(view.sort===k)view.dir=view.dir==='desc'?'asc':'desc';else{view.sort=k;view.dir=k==='value'||k==='n'?'desc':'asc';}
      render();b.focus();
    });
  }

  // Found, absent or unavailable (FE-02): a release without maxima says so; a file that did not load says which and why,
  // with Retry (reads again in place), never "not published".
  function notLoaded(e){
    $('#mxControls').hidden=true;settled();
    const c=$('#mxCount');
    c.innerHTML=`${esc(e?.message||'Not loaded: Species maxima (network error).')} <button type="button" class="btn mx-retry">Retry</button>`;
    c.querySelector('.mx-retry').addEventListener('click',()=>{c.textContent='Loading…';c.tabIndex=-1;c.focus({preventScroll:true});main();},{once:true});
    document.body.dataset.ready='true';
  }
  // A source's link by the name of the place it goes (A11Y-07: a bare host name ran past a phone's edge), or its host.
  const LINK_NAMES=[[/^https?:\/\/data-aucklandcouncil\.opendata\.arcgis\.com\/?$/i,'Auckland Council open data'],[/^https?:\/\/data\.linz\.govt\.nz\/?$/i,'LINZ Data Service'],
    [/^https?:\/\/registry\.opendata\.aws\/nz-imagery\/?$/i,'LINZ imagery archive'],[/^https?:\/\/datafinder\.stats\.govt\.nz\/?$/i,'Stats NZ Geographic Data Service']];
  function linkText(url){
    const hit=LINK_NAMES.find(([re])=>re.test(String(url)));
    if(hit)return hit[1];
    try{return new URL(url).host.replace(/^www\./,'');}catch{return String(url);}
  }
  // Below 600 px the table's header is clipped (each row is a card) and "Sort by" sorts: the header's buttons leave the
  // tab order there (tabindex -1) and stay in the table for screen readers.
  function headTabOrder(narrow){
    for(const b of document.querySelectorAll('#mxTable thead button[data-sort]')){if(narrow)b.tabIndex=-1;else b.removeAttribute('tabindex');}
  }
  const NARROW=window.matchMedia?.('(max-width: 599px)');
  headTabOrder(!!NARROW?.matches);
  NARROW?.addEventListener?.('change',e=>headTabOrder(e.matches));
  let bound=false;
  // FE-09: the controls show (disabled) and the list keeps its room from the first paint; a link naming one species
  // reserves room for a few rows. ready() enables them; settled() releases the room, whatever happened.
  {const w=$('.mx-wrap');if(w&&new URL(location.href).searchParams.get('species'))w.dataset.loading='few';}
  function ready(){
    const c=$('#mxControls');c.hidden=false;delete c.dataset.loading;
    for(const el of c.querySelectorAll('button, input, select'))el.disabled=false;
    const m=$('#mxMap');m.removeAttribute('aria-disabled');m.removeAttribute('tabindex');
  }
  const settled=()=>{const w=$('.mx-wrap');if(w)delete w.dataset.loading;};
  async function main(){
    let metadata=null;
    try{metadata=await M.fetchJSON(`${SITE_ROOT}/release-metadata.json`);}
    catch(e){$('#mxRelease').textContent='Not loaded';return notLoaded(e);}
    const version=metadata?.assembly?.tile_version||metadata?.release?.dataset_version||`session-${Date.now()}`;
    // UX-07: the same label as the map chip and the tree page: "Release 6.2 · 13 Oct 2026 · Tool 0.2.12".
    if(Ver&&metadata){const v=Ver.publicLabel(metadata);$('#mxRelease').textContent=v.text;}
    else $('#mxRelease').textContent='Unknown';
    if(window.ALTO_CHANNEL==='beta')document.body.dataset.channel='beta';
    try{D=await M.load({siteRoot:SITE_ROOT,metadata,version});}
    catch(e){D=null;return notLoaded(e.unavailable?e:M.unavailable('maxima.json','could not be read'));}
    if(!D||!D.maxima.length){$('#mxControls').hidden=true;settled();$('#mxCount').textContent='Species maxima are not published for this data release.';document.body.dataset.ready='true';return;}
    M.current=D;
    readAddress();intro();if(!bound){bind();bound=true;}
    ready();
    render();settled();
    document.body.dataset.ready='true';
  }
  main();
})();
