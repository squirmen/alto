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
  const nf=(v,d=0)=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:d}).format(v);
  const KEYS=['height','crownArea','trunkDiameter','rootProtection','lifeStage','benefits'];

  // ---- entity header (design system 2.7; the block approved in the v0.2 review) ----
  function identity(rec,{treeUrl}){
    const id=rec.identity,t=I().title(id);
    let h=`<header class="tp-id"><p class="tp-kicker">${esc(I().eyebrow(id))}</p><h3 class="tp-name" id="tpName">${esc(t.text)}</h3>`;
    if(t.latin)h+=`<p class="tp-latin">${esc(t.latin)}</p>`;
    if(t.note)h+=`<p class="tp-model">${esc(t.note)}</p>`;
    if(id.nameKind==='recorded'&&id.growthForm?.shown){const top=(id.growthForm.probabilities||[]).find(p=>p.top);if(top)h+=`<p class="tp-gf">Growth form: ${esc(top.label)} <span class="badge badge-estimate">Estimate</span></p>`;}
    if(rec.loaded||id.protectionStatus?.status==='protected')h+=I().protectionLine(rec,{cls:'ti-prot tp-prot'});
    return h+I().badges(rec,{icon:V().icon,recordsHref:`${String(treeUrl).replace(/#.*$/,'')}#m-records`})+'</header>';
  }
  function actions(rec,{treeUrl,saved,kyteBase='./kyte'}){
    return `<div class="tp-actions"><a class="btn btn-primary tp-open" href="${esc(treeUrl)}"><span>Open tree page</span>${V().icon('arrow',18)}</a>
      <div class="tp-actions-row"><button type="button" class="btn" data-panel-action="share">${V().icon('share',16)}<span>Share</span></button>
      <button type="button" class="btn" data-panel-action="save" aria-pressed="${saved?'true':'false'}">${V().icon('bookmark',16)}<span>${saved?'Saved to compare':'Save to compare'}</span></button>
      <a class="btn" href="${esc(kyteBase)}/?tree=${encodeURIComponent(rec.id)}">${V().icon('camera',16)}<span>Add a photo (KYTE)</span></a></div>
      <p class="tp-status" role="status" aria-live="polite"></p></div>`;
  }

  // ---- instrument sections ----
  const sec=(id,title,meta,body,more='')=>body?`<section class="ti-sec" aria-labelledby="${id}"><div class="ti-sec-head"><h4 class="ti-h" id="${id}">${esc(title)}</h4>${meta?`<span>${meta}</span>`:''}</div>${body}${more}</section>`:'';
  function metrics(rec){
    const body=I().strip(rec,KEYS,{id:'tpPop'});
    return sec('tpMetrics','Key measurements',rec.loaded?'Select a value for its source':'',body+(rec.loaded?`<p class="ti-ctx" id="tpCtx" aria-live="polite">${I().contextSentence(rec)}</p>`:''));
  }
  function linked(rec,{geometry=null,treeUrl}){
    if(!rec.loaded)return sec('tpLinked','Crown by survey','','<i class="ti-skel" style="height:220px"></i>');
    const hf=I().heightFigure(rec,{width:92,height:220,labels:true}),chip=I().crownFigure(rec,geometry,{width:300,height:220});
    const P=rec.lidar?.profile,base=String(treeUrl).replace(/#.*$/,'');
    const cap=`<p class="ti-cap"><span class="tp-imagery">Aerial imagery</span>.${P?` LiDAR returns per 1 m of height: ${nf(P.total)}.`:''} <a href="${esc(base)}#m-structure">Method</a></p>`;
    return sec('tpLinked','Crown by survey','Select a year',`${I().years(rec)}<div class="ti-linked${hf?'':' no-height'}">${chip}${hf?`<figure style="margin:0">${hf}</figure>`:''}</div>${I().figureKey(rec,{geometry:!!geometry,profile:!!hf})}${cap}<p class="ti-say">${esc(I().surveySentence(rec))}</p>`);
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
  function render(rec,{treeUrl,saved=false,kyteBase='./kyte',geometry=null}={}){
    return `<article class="tp ti-scope" data-loaded="${rec.loaded?'true':'false'}" aria-labelledby="tpName">`+identity(rec,{treeUrl})+actions(rec,{treeUrl,saved,kyteBase})+
      metrics(rec)+lost(rec)+linked(rec,{geometry,treeUrl})+know(rec)+pageLinks(rec,treeUrl)+
      `<footer class="tp-foot"><code>${esc(rec.id)}</code><span>${esc(I().versionLine(rec))}</span></footer></article>`;
  }
  const api={render,KEYS};
  root.ALTOTreePanel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
