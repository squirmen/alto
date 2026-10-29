/* The map's right-hand tree panel ("Instrument dashboard", concept B, chosen 12 Oct 2026): the entity header with
 * the protection line and its legal basis (concept A), a band of key measurements (each value with its kind and
 * range; provenance one tap away; the root protection radius beside the size values, concept C), where it sits
 * among similar trees, If it were lost, one linked figure (the crown over aerial imagery and the height at each
 * survey; a survey year highlights in the figure, the measurements and the map), Know this tree?, then numbered
 * links into the tree page's sections (concept C).
 * Reads an alto.tree-record/1 object: it renders from the map tile at once (loaded: false) and again when the
 * full record arrives. Styled on the ALTO design system (tokens.css; tree-instrument.css). */
(function(root){
  'use strict';
  const V=()=>root.ALTOViz,I=()=>root.ALTOInstrument;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const F=root.ALTOFormat||(typeof require==='function'?require('./alto-format.js'):null);   // one rule set (FE-16)
  const nf=F.nf;
  // The dripline radius (2024 crown outline) stands for the root space here; the BS 5837 radius is on the tree page.
  const KEYS=['height','crownArea','trunkDiameter','dripline','lifeStage','benefits'];

  // ---- entity header (design system 2.7; the block approved in the v0.2 review) ----
  function identity(rec,{treeUrl,note=null}){
    const id=rec.identity,t=I().title(id);
    let h=`<header class="tp-id"><p class="tp-kicker">${esc(I().eyebrow(id))}</p><h3 class="tp-name" id="tpName">${t.html||esc(t.text)}</h3>`;
    if(t.latinHtml)h+=`<p class="tp-latin">${t.latinHtml}</p>`;
    if(t.recordedAs)h+=`<p class="tp-model">Recorded as: ${esc(t.recordedAs)}</p>`;
    if(t.note)h+=`<p class="tp-model">${esc(t.note)}</p>`;
    h+=maxBadge(rec);
    const cf=I().crownForm(id);if(cf)h+=`<p class="tp-gf">${esc(cf)}</p>`;
    if(rec.loaded||id.protectionStatus?.status==='scheduled')h+=`<div class="tp-sched">${I().protectionLine(rec,{cls:'ti-prot tp-prot'})}</div>`;
    if(rec.loaded)h+=I().releaseLines(rec,{cls:'ti-lines tp-lines'});
    return h+I().badges(rec,{icon:V().icon,recordsHref:`${String(treeUrl).replace(/#.*$/,'')}#m-records`})+ids(rec,{note})+'</header>';
  }
  // Species maxima (tool 0.2.8): the tree page's "Maximum · …" line, kept to one line (species-maxima.js; clear leads
  // only). The page sets ALTOMaxima.current once the release's maxima.json has loaded.
  function maxBadge(rec){const M=root.ALTOMaxima;return M&&M.current&&rec.number?M.badgeHtml(M.current,rec.number,{panel:true,flagged:!!rec.maximaBlocked}):'';}
  // "Measure its girth (KYTE)", only when kyte-config.js switches KYTE girth tasks on.
  function girthLink(rec,kyteBase){const M=root.ALTOMaxima,href=M&&M.current&&rec.number?M.girthHref(M.current,rec.number,{kyteBase}):null;
    return href?`<a class="btn" href="${esc(href)}"><span>Measure its girth (KYTE)</span></a>`:'';}
  // "Report a problem with this record" (KYTE task=problem), when kyte-config.js switches it on.
  function problemLink(rec,kyteBase){const href=root.ALTOTreeRecord?.problemHref?.(rec,{kyteBase})||null;return href?`<a class="btn btn-quiet" href="${esc(href)}"><span>Report a problem with this record</span></a>`:'';}
  // The tree's IDs from data release 6.1: its number (Copy, permalink) and, second, the record ID. note: one line
  // when the tree was opened by another of its IDs ("Record ID akl_tree_… is tree T…").
  function ids(rec,{note=null}={}){
    const said=note?`<p class="tp-idnote" role="status">${esc(note)}</p>`:'';
    if(!rec.number)return location(rec)?`<dl class="tp-ids">${location(rec)}</dl>${said}`:said;
    return `<dl class="tp-ids"><dt>Tree number</dt><dd><code class="tp-tn">${esc(rec.number)}</code><button type="button" class="ti-copy" data-panel-action="copy-number" aria-label="Copy the tree number">Copy</button>
      <a class="tp-permalink" href="${esc(rec.permalink)}">${esc(rec.permalink)}</a></dd><dt class="tp-sub">Record ID</dt> <dd class="tp-sub"><code>${esc(rec.id)}</code></dd>${location(rec)}</dl>${said}`;
  }
  // Location: the map pin's position (WGS84) with Copy, what that position is, and plain links to Google Maps, Street
  // View and OpenStreetMap in a new tab (tree-record.js location).
  function location(rec){
    const L=root.ALTOTreeRecord?.location?.(rec);if(!L)return '';
    const links=L.links.map(l=>`<a href="${esc(l.href)}" target="_blank" rel="noopener" data-loc="${esc(l.key)}">${esc(l.label)}<span class="sr-only"> at this position (opens in a new tab)</span></a>`).join('<span aria-hidden="true"> · </span>');
    return `<dt class="tp-sub tp-loc">Location</dt> <dd class="tp-sub tp-loc"><code>${esc(L.text)}</code> <button type="button" class="ti-copy" data-panel-action="copy-coords" aria-label="Copy the coordinates (latitude, longitude)">Copy</button>
      <small>${esc(L.caption)}</small><small class="tp-loc-links">${links}</small></dd>`;
  }
  function actions(rec,{treeUrl,saved,savedCount=0,kyteBase='./kyte'}){
    return `<div class="tp-actions"><a class="btn btn-primary tp-open" href="${esc(treeUrl)}"><span>Open tree page</span>${V().icon('arrow',18)}</a>
      <div class="tp-actions-row"><button type="button" class="btn" data-panel-action="share">${V().icon('share',16)}<span>Share</span></button>
      <button type="button" class="btn" data-panel-action="save" aria-pressed="${saved?'true':'false'}">${V().icon('bookmark',16)}<span>${saved?'Saved to compare':'Save to compare'}</span></button>
      <button type="button" class="btn" data-panel-action="compare" data-saved-trees aria-haspopup="dialog" aria-controls="treeComparison"${savedCount?'':' hidden'}><span data-saved-count>Saved trees (${nf(savedCount)})</span></button>
      <a class="btn" href="${esc(root.ALTOTreeRecord?.photoHref?root.ALTOTreeRecord.photoHref(rec,kyteBase):`${kyteBase}/?tree=${encodeURIComponent(rec.number||rec.id)}`)}">${V().icon('camera',16)}<span>Add a photo (KYTE)</span></a>${girthLink(rec,kyteBase)}${problemLink(rec,kyteBase)}</div>${rec.kauri?`<p class="tp-model">Kauri: ${esc(String(root.ALTOTreeRecord?.KAURI_PHOTO||'').replace(/^./,c=>c.toLowerCase()))}.</p>`:''}
      <p class="tp-status" role="status" aria-live="polite"></p></div>`;
  }

  // ---- instrument sections ----
  const sec=(id,title,meta,body,more='')=>body?`<section class="ti-sec" aria-labelledby="${id}"><div class="ti-sec-head"><h4 class="ti-h" id="${id}">${esc(title)}</h4>${meta?`<span>${meta}</span>`:''}</div>${body}${more}</section>`:'';
  // A tree measured in the field has its readings and ALTO's estimate under the band (the map draws this section again
  // when the field measurements arrive).
  function metrics(rec){
    const body=I().strip(rec,KEYS,{id:'tpPop'}),field=rec.loaded?I().fieldRows(rec):'';
    return sec('tpMetrics','Key measurements',rec.loaded?'Select a value for its source':'',body+(rec.loaded?`<p class="ti-ctx" id="tpCtx" aria-live="polite">${I().contextSentence(rec)}</p>`:'')+
      (field?`<h5 class="ti-h ti-field-h">Field measurements</h5>${field}`:''));
  }
  function linked(rec,{geometry=null,treeUrl}){
    if(!rec.loaded)return sec('tpLinked','Crown by survey','','<i class="ti-skel" style="height:220px"></i>');
    const hf=I().heightFigure(rec,{width:92,height:220,labels:true}),chip=I().crownFigure(rec,geometry,{width:300,height:220});
    const P=rec.lidar?.profile,base=String(treeUrl).replace(/#.*$/,'');
    const cap=`<p class="ti-cap"><span class="tp-imagery">${esc(I().imageryText(null))}</span>. ${root.ALTOCredits?.aerialFigure()||''}${P?` LiDAR returns per 1 m of height: ${nf(P.total)}.`:''} <a class="ti-mlink" href="${esc(base)}#m-structure">Method</a></p>`;
    return sec('tpLinked','Crown by survey','Select a year',`${I().years(rec,{note:true})}<div class="ti-linked${hf?'':' no-height'}">${chip}${hf?`<figure style="margin:0">${hf}</figure>`:''}</div>${I().figureKey(rec,{geometry:!!geometry,profile:!!hf})}${cap}<p class="ti-say">${esc(I().surveySentence(rec))}</p>`);
  }
  function lost(rec){
    return sec('tpLost','If it were lost',rec.loaded&&(rec.measures?.replacementYears||rec.measures?.benefits)?'Estimates':'',I().lost(rec,{variant:'panel'}));
  }
  function know(rec){
    if(!rec.know?.length)return '';
    return sec('tpKnow','Know this tree?','Through a KYTE ground visit',`<div class="ti-know">${rec.know.map(k=>`<a href="${esc(k.href)}" title="${esc(k.text)}">${esc(k.title)}</a>`).join('')}</div>`);
  }
  function pageLinks(rec,treeUrl){
    if(!rec.loaded)return '';
    return sec('tpPage','On the tree page','',I().pageLinks(rec,treeUrl));
  }
  function render(rec,{treeUrl,saved=false,savedCount=0,kyteBase='./kyte',geometry=null,note=null}={}){
    // The crown outline from the map tiles gives the dripline radius (and a scheduled tree's protected root zone).
    if(geometry&&rec.loaded)root.ALTOTreeRecord?.extras?.(rec,{geometry});
    return open(rec)+identity(rec,{treeUrl,note})+actions(rec,{treeUrl,saved,savedCount,kyteBase})+rest(rec,{treeUrl,geometry})+'</article>';
  }
  const open=rec=>`<article class="tp ti-scope" data-loaded="${rec.loaded?'true':'false'}" aria-labelledby="tpName">`;
  const rest=(rec,{treeUrl,geometry=null}={})=>metrics(rec)+lost(rec)+linked(rec,{geometry,treeUrl})+know(rec)+pageLinks(rec,treeUrl)+
    `<footer class="tp-foot"><code>${esc(rec.number||rec.id)}</code><span>${esc(I().versionLine(rec))}</span></footer>`;
  // FE-17: the panel's header alone (name, numbers, location, actions), painted as soon as a tree is tapped; the map
  // renders the whole panel after it has yielded to the browser.
  function header(rec,{treeUrl,saved=false,savedCount=0,kyteBase='./kyte',note=null}={}){
    return open(rec)+identity(rec,{treeUrl,note})+actions(rec,{treeUrl,saved,savedCount,kyteBase})+'</article>';
  }
  const api={render,header,ids,maxBadge,metrics,KEYS};
  root.ALTOTreePanel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
