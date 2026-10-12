/* Tree page (tree.html?id=…): one tree as a set of linked instruments ("Instrument dashboard", concept B, chosen
 * 12 Oct 2026), with concept A's protection line, records link, root-space rows, numbered notes and A4 print layout,
 * and concept C's numbered section links (a sticky strip on phones) and plain sentences.
 * A survey year chosen in the bar highlights in the key measurements, every figure, the measurements by source and
 * the map; every value opens its provenance in one tap. Sections, numbered as in the tree panel's links: key
 * measurements · crown by survey · among similar trees · if it were lost · root space · measurements by source ·
 * records and identifiers · species and growth form · benefits · how this tree was mapped · releases and reviews ·
 * place and property · ground visits and contributions · data, versions and citation.
 * Reads alto.tree-record/1 (tree-record.js); markup from tree-instrument.js; ALTO design system. */
(function(){
  'use strict';
  const V=window.ALTOViz,I=window.ALTOInstrument,R=window.ALTOTreeRecord,PAL=window.ALTOPalette;
  const DATA_BASE=(window.AKL_DATA_BASE||'./data').replace(/\/+$/,''),SITE_ROOT=(window.ALTO_SITE_ROOT||'.').replace(/\/+$/,'');
  let VERSION=window.AKL_TILE_VERSION==='auto'?null:(window.AKL_TILE_VERSION||null);
  const KYTE=`${SITE_ROOT}/kyte`,DOWNLOADS=window.ALTO_ENABLE_DOWNLOADS===true;
  const esc=V.esc,num=V.num,nf=V.nf,icon=V.icon,$=s=>document.querySelector(s);
  const f1=v=>nf(v,1);
  // Map colours come from the design-system tokens (palette.js), never literals.
  const tok=name=>PAL?PAL.map(name):null;
  let rec=null,env=null,mini=null,linker=null,yearMarker=null,geometry=null;
  const NEAR=40; // metres: the nearby trees listed from the map tiles around the recorded position

  const KEYS=['height','crownArea','crownDiameter','trunkDiameter','rootProtection','lifeStage','benefits','carbonStored','replacementYears','irreplaceability'];
  const MODS=I.SECTIONS,numOf=id=>MODS.findIndex(m=>m[0]===id)+1;
  const mod=(id,meta,body,cls='')=>{const m=MODS.find(x=>x[0]===id);return `<section class="ti-mod ${cls}" id="m-${id}" aria-labelledby="h-${id}"><header class="ti-mod-head"><h2 id="h-${id}"><span class="ti-mod-n" aria-hidden="true">${numOf(id)}</span>${esc(m[1])}</h2>${meta?`<p>${meta}</p>`:''}</header>${body}</section>`;};
  const kv=(label,value,sub)=>value===null||value===undefined||value===''?'':`<div class="ti-kv"><dt>${esc(label)}</dt><dd>${value}${sub?`<small>${sub}</small>`:''}</dd></div>`;
  const link=(href,t='Method')=>href?`<a href="${esc(href)}"${/^\.|^\//.test(href)?'':' target="_blank" rel="noopener"'}>${esc(t)}</a>`:'';
  const pending=t=>`<p class="ti-status" role="status">${esc(t)}</p>`;
  const notPublished=what=>`<p class="ti-np"><b>Not yet published</b> ${esc(what)}</p>`;
  const none=what=>`<p class="ti-def">None for this record: ${esc(what)}.</p>`;
  // Method names in plain words; method IDs and release numbers stay in the provenance popover and methods pages.
  function plainMethod(t){
    const s=String(t||'');
    if(/NDVI \(v5\)/.test(s))return 'Segmented from the 2024 LiDAR survey and aerial imagery';
    if(/vegetation returns \(v4\)/.test(s))return 'Segmented from the 2024 LiDAR survey, earlier method';
    if(/^Canopy height model around/.test(s))return 'Drawn from the canopy height model around the recorded position, earlier method';
    if(/Smoothed outline/.test(s))return 'Smoothed outline of the crown, area kept';
    if(/^Canopy height \(2024 surface minus terrain\)/.test(s))return 'Height of the 2024 surface above the ground within 2 m of the recorded position';
    if(/LiDAR returns at the recorded position/.test(s))return 'Drawn from the LiDAR returns at the recorded position';
    return s.replace(/\s*\(v\d+(\.\d+)?\)/g,'');
  }
  const releaseName=r=>({v4:'4',v5:'5','v5.1':'5.1','v5.2':'5.2',v6:'6'})[r.release]||String(r.release||'').replace(/^v/,'');
  function treeTitle(t){
    if(t.nameKind==='model')return `${esc(String(t.title).replace(/^(Probably|Likely)\s+/,'').replace(/\s*\(model\)$/,'').replace(/^./,c=>c.toUpperCase()))} ${I.estimateBadge}`;
    return esc(t.title==='Tree detected from LiDAR'?'LiDAR-detected tree':t.title);
  }

  // ---------- numbered notes (concept A): every value's source, date, method and range, for citation and print ----------
  const pnum=new Map();
  function numberNotes(){for(const p of rec.provenance)if(!pnum.has(p.id))pnum.set(p.id,pnum.size+1);}
  // Notes are provenance, so a release number may appear; labels and notes still use the glossary's words.
  const plain=s=>String(s||'').replace(/^LiDAR crown v5$/,'Crown, current method').replace(/^LiDAR crown v4$/,'Crown, earlier method').replace(/\bv5 crown( cells)?\b/g,'crown$1')
    .replace(/\s*\(v\d+(\.\d+)?\)/g,'').replace(/\bv(\d+(?:\.\d+)?) dev\b/g,'release $1 (preview)');
  function noteItem(p){
    const meth=p.method?`${esc(plainMethod(p.method.text||''))}${p.method.href?` ${link(p.method.href)}`:''}`:'';
    return `<li id="note-${esc(p.id)}" value="${pnum.get(p.id)}"><b>${esc(plain(p.label))}</b>: ${esc(plain(p.source))}${p.date?.text?`, ${esc(p.date.text)}`:''}${meth?`; ${meth}`:''}${p.model?.id?`; model <code>${esc(p.model.id)}</code>${p.model.validation?` (${esc(p.model.validation.toLowerCase())})`:''}`:''}${p.uncertainty?.text?`; ${esc(plain(p.uncertainty.text))}`:''}${p.note?`. ${esc(plain(p.note).replace(/\.$/,''))}`:''}.</li>`;
  }
  function notes(){
    numberNotes();
    const list=[...rec.provenance].sort((a,b)=>pnum.get(a.id)-pnum.get(b.id));
    return `<details class="ti-details ti-notes-d" id="notesBox"><summary>Notes: source, date, method and range of each value (${nf(list.length)})</summary><ol class="ti-notes">${list.map(noteItem).join('')}</ol></details>`;
  }

  // ---------- entity header ----------
  function hero(){
    const id=rec.identity,t=I.title(id),ps=id.protectionStatus;
    const gf=id.nameKind==='recorded'&&id.growthForm?.shown?(id.growthForm.probabilities||[]).find(p=>p.top):null;
    const prot=ps?.sentence?`<p class="ti-prot ti-prot-say" data-protection="${esc(ps.status)}">${ps.status==='protected'?`<b>Protected</b>${esc(ps.sentence.replace(/^Protected/,''))}`:`<b>Not protected</b>${esc(ps.sentence.replace(/^Not protected/,''))}`}${ps.checked?`<small>Checked: ${esc(ps.checked)}</small>`:''}</p>`:'';
    const saved=window.ALTOEvidenceWorkspace?.has(rec.id);
    return `<div class="ti-id-main"><p class="ti-eyebrow ti-kicker">${esc(I.eyebrow(id))}</p><h1>${esc(t.text)}</h1>${t.latin?`<p class="ti-latin">${esc(t.latin)}</p>`:''}${t.note?`<p class="ti-note">${esc(t.note)}</p>`:''}
        ${gf?`<p class="ti-note">Growth form: ${esc(gf.label)} ${I.estimateBadge}</p>`:''}${prot}${I.badges(rec,{icon,recordsHref:'#m-records'})}
        <dl class="ti-idline"><div><dt>Tree ID</dt><dd><code>${esc(rec.id)}</code><button type="button" class="ti-copy" id="copyId" aria-label="Copy the tree ID">Copy</button></dd></div>
          <div><dt>Local board</dt><dd id="heroBoard">…</dd></div><div><dt>Release</dt><dd>${esc(rec.release.public?.text||I.versionLine(rec))}${rec.release.public?.preview?' <span class="badge badge-muted">Preview</span>':''}${rec.release.statusText?`<small>${esc(rec.release.statusText)}</small>`:''}<small><a href="#m-history">Releases and reviews</a></small></dd></div></dl></div>
      <div class="ti-id-actions"><a class="btn btn-primary" id="openMap" href="${esc(rec.mapUrl||'./')}">${icon('map',16)}<span>See it on the map</span></a>
        <button type="button" class="btn" id="saveCompare" aria-pressed="${saved?'true':'false'}">${icon('bookmark',16)}<span>${saved?'Saved to compare':'Save to compare'}</span></button>
        <a class="btn" href="${esc(KYTE)}/?tree=${encodeURIComponent(rec.id)}">${icon('camera',16)}<span>Add a photo (KYTE)</span></a>
        <a class="btn btn-quiet" href="#m-know">Know this tree?</a></div>`;
  }
  // The sticky bar: the survey year and the numbered section links (a scrolling strip of chips on phones, concept C).
  function bar(){
    return `<div class="ti-bar-in"><span class="ti-bar-name" aria-hidden="true">${esc(I.title(rec.identity).text)}</span>${I.years(rec)}
      <ol class="ti-bar-nav">${MODS.map(([id,,short],i)=>`<li><a href="#m-${id}" data-nav="${id}"><span class="ti-nav-n" aria-hidden="true">${i+1}</span>${esc(short)}</a></li>`).join('')}</ol>
      <p class="ti-bar-quick"><a href="#m-records">Records</a><a href="#m-history">Releases</a></p></div>`;
  }

  // ---------- crown by survey (linked figures) ----------
  function mapKey(){
    const src=PAL?PAL.rows('source'):[];
    return `<ul class="ti-key ti-mapkey" aria-label="Map key"><li><i class="ti-sw ti-sw-outline" aria-hidden="true"></i>This crown</li><li><i class="ti-sw ti-sw-thin" aria-hidden="true"></i>Other crowns</li>
      <li><i class="ti-sw ti-sw-pin" aria-hidden="true"></i>${rec.identity.detection?'Detection point':'Recorded position of this record'}</li>
      ${src.map(r=>`<li><i class="ti-sw ti-sw-dot" style="--sw:${esc(r.colour)}" aria-hidden="true"></i>${esc(r.label)}</li>`).join('')}<li id="mapKeyLinks" hidden><i class="ti-sw ti-sw-link" aria-hidden="true"></i>Council recorded positions and their links</li></ul>`;
  }
  function structure(){
    const P=rec.lidar?.profile,hf=I.heightFigure(rec,{width:176,height:300,labels:true}),S=rec.surveys||[];
    const rows=S.map(s=>`<tr data-year="${s.year}"><th scope="row">${s.year}</th><td class="num">${s.height?esc(I.text(s.height)):`<span class="ti-na" title="${esc(s.line||'')}">${esc(s.status==='outside'?'outside survey':s.status==='absent'?'not detected':'no match')}</span>`}</td><td class="num">${s.year===2024&&num(s.area)!==null?esc(I.text({key:'crownArea',value:s.area})):'–'}</td><td class="num">${s.year===2024&&num(s.cover)!==null?`${nf(s.cover*100)}%`:'–'}</td></tr>`).join('');
    const methodHref=rec.measures.height?.provenance?.method?.href||rec.release.methodsHref;
    return mod('structure','LiDAR surveys of 2013, 2016 and 2024. Select a year in the bar or on any figure.',
      `<p class="ti-say">${esc(I.surveySentence(rec))}</p><div class="ti-struct">
        <figure class="ti-panel ti-p-height"><figcaption class="ti-eyebrow">Height</figcaption>${hf||'<p class="ti-def">None for this record: no survey height.</p>'}
          <p class="ti-cap">Lines: height at each survey; the selected survey is darker.${P?` Bars: LiDAR returns per 1 m of height, ${nf(P.total)} returns, 2024 survey.`:''}${(rec.lidar?.measurements||[]).some(x=>x.key==='liveCrownBase')?' Dashed line: live crown base.':''} ${link(methodHref)}</p></figure>
        <figure class="ti-panel ti-p-crown"><figcaption class="ti-eyebrow">Crown</figcaption><div id="chipSlot">${I.crownFigure(rec,geometry,{width:420,height:300})}</div>
          <div id="chipKey">${I.figureKey(rec,{geometry:!!geometry})}</div><p class="ti-cap" id="chipCap"><span class="tp-imagery">Aerial imagery</span>. ${link(rec.outline?.segmentation?.method?.href||methodHref)}</p></figure>
        <figure class="ti-panel ti-p-map"><figcaption class="ti-eyebrow">Map</figcaption><div id="miniMap" class="ti-minimap" role="img" aria-label="Map of the crown, the crowns around it and recorded positions"></div>
          <div class="ti-mm" role="group" aria-label="Map layers"><button type="button" data-mm="imagery" aria-pressed="true">Aerial imagery</button><button type="button" data-mm="outline" aria-pressed="true">This crown</button><button type="button" data-mm="others" aria-pressed="true">Other crowns</button><button type="button" data-mm="positions" aria-pressed="true">Recorded positions</button></div>
          ${mapKey()}<p class="ti-cap">Trees within ${NEAR} m are listed under Place and property. Select a dot to open that tree.</p></figure>
        <figure class="ti-panel ti-p-survey"><figcaption class="ti-eyebrow">Height at each survey</figcaption><div id="surveySlot">${I.surveyChart(rec,{width:300,height:170})}</div>
          <table class="ti-table ti-mini"><thead><tr><th scope="col">Survey</th><th scope="col" class="num">Height</th><th scope="col" class="num">Crown area</th><th scope="col" class="num">Cover</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="ti-cap">Dots: height at each survey. Whisker on 2024: other estimates of its height in this record. Crown outlines are kept for 2024 only. <span id="scenarioCap"></span></p></figure>
      </div>`,'ti-mod-wide');
  }

  // ---------- among similar trees (the release's comparison tables; a fixed n for every tree) ----------
  function compareBody(){
    const c=rec.context||{},cls=rec.benefits?.classUsed;
    const head=cls?`<p class="ti-lede">Within its tree class, <b>${esc(cls.label.toLowerCase())}</b> (the class of its benefit estimates). Crown area and benefits on log scales.</p>`:'';
    if(c.status==='ready'){
      const mets=['height','crownArea','benefits'];
      return head+`<div class="ti-cmp" role="table" aria-label="Among similar trees"><div class="ti-cmp-row ti-cmp-head" role="row"><span role="columnheader">Group</span>${mets.map(m=>`<span role="columnheader">${esc(I.METRICS[m].label)}${m==='benefits'?` ${I.estimateBadge}`:''}</span>`).join('')}</div>`+
        c.scopes.map(sc=>`<div class="ti-cmp-row" role="row"><span role="rowheader"><b>${esc(sc.scope==='street'?'Street':sc.scope==='board'?'Local board':'Auckland')}</b>${sc.name&&sc.scope!=='auckland'?`<small>${esc(sc.scope==='board'?I.boardName(sc.name):sc.name)}</small>`:''}<small>${sc.status==='ready'?`n = ${nf(sc.n)}`:esc(sc.definition||'No group for this tree')}</small></span>${mets.map(m=>{const e=sc.metrics?.[m];
          return `<span role="cell">${e?`<b>${esc(e.text)}</b>${I.distStrip(m,{value:e.value,dist:e.distribution,text:e.text,n:sc.n})}`:'<span class="ti-na">–</span>'}</span>`;}).join('')}</div>`).join('')+'</div>'+
        `<p class="ti-cap">Strips: the middle half of the group (dark band), 5–95% (light band) and the median (tick); dots are each tree in a small group; the ring with a line is this tree. ${esc(c.population||'')}${c.generated?` Comparison tables of ${esc(c.generated.text)}.`:''} Shares are rounded down. Street: trees whose nearest address point is on the same street.</p>`;
    }
    if(c.status==='pending')return head+pending('Loading comparison tables…');
    if(c.status==='no_class')return head+none('no tree class for comparison (no crown estimate)');
    return head+notPublished(c.status==='release_mismatch'?'for this release: the comparison tables on the site belong to another release.':'for this release: street, local board and Auckland comparison tables.');
  }

  // ---------- if it were lost ----------
  function lostBody(){
    const r=rec.replacement,k=r?.irreplaceability?.key,c=rec.context;
    const classes=r?.classes?.length&&k?`<ol class="ti-classes" aria-label="Irreplaceability classes">${r.classes.map(x=>`<li${x.key===k?' class="is-cur" aria-current="true"':''}><b>${esc(x.label)}${x.key===k?' · this tree':''}</b><span>${esc(x.rule)}</span></li>`).join('')}</ol>`:'';
    const irr=c?.status==='ready'?c.scopes.filter(sc=>sc.irreplaceability).map(sc=>`<li>${esc(sc.scope==='street'?`${sc.name}`:sc.scope==='board'?I.boardName(sc.name):'Auckland')}: ${nf(Math.floor(sc.irreplaceability.shareAtOrAbove))}% of ${esc((c.class?.label||'').toLowerCase())} crowns are in this class or higher (n = ${nf(sc.irreplaceability.n)}).</li>`).join(''):'';
    return `${I.lost(rec,{variant:'page'})}${classes}${irr?`<ul class="ti-list">${irr}</ul>`:''}`;
  }

  // ---------- measurements by source; records and identifiers ----------
  function sources(){
    return mod('sources','Each column is one source, dated. Select a value for its provenance.',I.matrix(rec),'ti-mod-wide');
  }
  function records(){
    const rs=rec.records||[];
    const rows=rs.map(r=>`<tr${r.self?' class="is-self"':''}><th scope="row">${esc(r.source?.name||'')}${r.self?' <span class="tag">This record</span>':''}<small>${esc(r.source?.kind||'')}</small></th>
      <td>${r.href?link(r.href,r.sourceId||r.treeId):`<code>${esc(r.sourceId||r.treeId||'')}</code>`}${!r.self&&r.treeId?`<small><a href="${esc(window.ALTOTreeId.url(r.treeId))}">Tree page</a></small>`:''}</td>
      <td>${esc(r.role?r.role.charAt(0).toUpperCase()+r.role.slice(1):'')}${r.owner?.class?`<small>${esc(r.owner.class)}</small>`:''}</td><td>${r.species?.common||r.species?.latin?`${esc(r.species.common||'')}${r.species.latin?` <i>${esc(I.hybrid(r.species.latin))}</i>`:''}`:'<span class="ti-na">None recorded</span>'}</td>
      <td>${r.snapshot?.text?esc(r.snapshot.text):'–'}</td><td>${r.link?.text?esc(r.link.text.replace(/the v5 crown/,'the crown')):'–'}${num(r.link?.edgeDistance)!==null?`<small>${f1(r.link.edgeDistance)} m from the crown edge</small>`:''}</td></tr>`).join('');
    const more=rec.moreRecords?`<p class="ti-cap">${nf(rec.moreRecords)} more record${rec.moreRecords===1?'':'s'} on this crown; each has its own tree page.</p>`:'';
    const ids=(rec.identifiers||[]).map(x=>`<li><span>${esc(x.kind.replace(/\s*\(v\d+\)/,''))}${x.self?' · this record':''}</span><code>${x.href?link(x.href,x.code):esc(x.code)}</code>${x.note?`<small>${esc(x.note)}</small>`:''}</li>`).join('');
    const b=rec.identity.badges.find(x=>x.key==='records');
    return mod('records',b?esc(b.label):'',`<div class="ti-scroll"><table class="ti-table"><thead><tr><th scope="col">Source</th><th scope="col">Record ID</th><th scope="col">Role</th><th scope="col">Species as supplied</th><th scope="col">Retrieved</th><th scope="col">Link to the crown</th></tr></thead><tbody>${rows}</tbody></table></div>${more}
      <h3 class="ti-h3">Identifiers</h3>${ids?`<ul class="ti-ids">${ids}</ul>`:none('no other identifiers')}`,'ti-mod-wide');
  }

  // ---------- species ----------
  function species(){
    const s=rec.species||{},r=s.recorded||{},g=s.growthForm;
    let h=`<dl class="ti-kvs">${kv('Recorded name',r.name?`${esc(r.name.common||'')}${r.name.latin?` <i>${esc(I.hybrid(r.name.latin))}</i>`:''}`:'<span class="ti-na">None for this record</span>',r.name?esc(`${r.source||''}`):'')}
      ${r.asSupplied&&r.name&&r.asSupplied!==[r.name.common,r.name.latin].filter(Boolean).join(' · ')?kv('As supplied',esc(r.asSupplied)):''}${r.classFromName?kv('Tree class from the name',esc(r.classFromName.class.charAt(0).toUpperCase()+r.classFromName.class.slice(1)),esc(r.classFromName.basis||'')):''}</dl>`;
    if(g){const top=(g.probabilities||[]).find(p=>p.top);
      h+=`<h3 class="ti-h3">Growth form ${I.estimateBadge}</h3><p class="ti-lead">${esc(top?.label||g.wording)}${top?` <small>${nf(top.p*100)}%</small>`:''}</p>${V.probabilities((g.probabilities||[]).map(p=>({label:p.label,value:p.p,top:p.top})))}
        <dl class="ti-kvs">${kv('Method',esc('Growth-form model on the 2024 LiDAR survey and aerial imagery'),link(g.method?.href))}${kv('Survey flight',g.flight?esc(g.flight.text):null,g.lateJuneFlight?'Late-June flight: deciduous crowns may be leaf-off.':'')}
        ${g.palmDetector?kv('Palm detector',g.palmDetector.seen?`Score ${nf(g.palmDetector.score,2)}`:'Not triggered'):''}</dl>`;
    }else if(s.growthFormStatus)h+=`<p class="ti-def">Growth form: none for this record (${esc(s.growthFormStatus==='not_scored'?'not estimated for this crown in this release':'not in this release')}).</p>`;
    if(s.legacy?.probabilities?.length)h+=`<details class="ti-details"><summary>Earlier growth-form estimate (uncalibrated)</summary>${V.probabilities(s.legacy.probabilities.map(p=>({label:p.label,value:p.p})))}<p class="ti-cap">Uncalibrated; kept for the record.</p></details>`;
    h+='<div id="photoLead"></div>';
    return mod('species','',h);
  }
  // ---------- benefits ----------
  function benefits(){
    const b=rec.benefits||{},q=rec.measures.benefits;
    if(b.status!=='estimated'||!q)return mod('benefits','',none(b.status==='scenario_only'?'no measured crown, so the tree is left out of the totals':'no crown estimate'));
    const rows=(b.rows||[]).map(x=>`<tr><th scope="row">${esc(x.label)}</th><td>${x.quantity?esc(x.quantity.text.replace(/(\d+\.\d\d+)/,m=>I.money(Number(m)).slice(1))):'–'}${x.quantity?.detail?`<small>${esc(x.quantity.detail)}</small>`:''}</td><td class="num">${x.value!==null&&x.value!==undefined?`${I.money(x.value)}/yr`:'–'}</td></tr>`).join('');
    const note=String(b.note||'').replace(/^i-Tree style equations with stated unit values; sensitivity scenarios\.\s*/,'');
    return mod('benefits',I.estimateBadge,`<p class="ti-big"><button type="button" class="ti-v" data-q="benefits" aria-haspopup="dialog">${esc(I.text(q))}</button>${I.fmtRange(q)?`<small>Range ${esc(I.fmtRange(q))}</small>`:''}</p>${I.rangeBar(q)}
      <table class="ti-table"><thead><tr><th scope="col">Service</th><th scope="col">Quantity</th><th scope="col" class="num">Value</th></tr></thead><tbody>${rows}</tbody></table>
      <dl class="ti-kvs">${kv('Tree class used',b.classUsed?esc(b.classUsed.label):null,b.classUsed?.source?esc(b.classUsed.source):'')}${kv('Leaf area index',num(b.lai)!==null?nf(b.lai,1):null)}${b.biomass?kv('Biomass',`${nf(I.sig2(b.biomass.aboveKg))} kg above ground, ${nf(I.sig2(b.biomass.belowKg))} kg below`):''}${kv('Method',`i-Tree style equations with stated unit values ${link(b.method?.href)}`)}</dl>
      ${note?`<p class="ti-cap">${esc(note)}</p>`:''}${b.assumptions&&Object.keys(b.assumptions).length?`<details class="ti-details"><summary>Assumptions</summary><dl class="ti-kvs">${Object.entries(b.assumptions).map(([k,v])=>kv(k.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()),esc(typeof v==='object'?JSON.stringify(v):v))).join('')}</dl></details>`:''}`);
  }
  // ---------- how this tree was mapped ----------
  function mapped(){
    const o=rec.outline||{},L=rec.lidar||{};
    const meas=(L.measurements||[]).map(x=>`<tr><th scope="row">${esc(x.label.replace(/Crown maximum/,'Height').replace(/Canopy top \(returns\)/,'Highest return'))}</th><td class="num"><button type="button" class="ti-v" data-q="${esc(x.key)}" aria-haspopup="dialog">${esc(I.text(x))}</button></td><td>${esc((x.provenance?.note||'').replace(/^v5 crown( cells)?$/,'Crown').replace(/^Earlier crown$/,'Crown, earlier method').replace(/^Mean over the crown cells$/,'Mean over the crown'))}</td></tr>`).join('');
    return mod('mapped','',`<dl class="ti-kvs">
      ${kv('Crown outline',o.segmentation?`${esc(plainMethod(o.segmentation.text))} ${link(o.segmentation.method?.href)}`:'<span class="ti-na">None for this record</span>')}
      ${kv('Crown cells',num(o.cellArea)!==null?esc(I.text({key:'crownArea',value:o.cellArea})):null,num(o.gapFilled)!==null?`${nf(o.gapFilled*100)}% gap-filled`:'')}
      ${o.smoothed?kv('Smoothed outline',esc(I.text({key:'crownArea',value:o.smoothed.area})),esc(plainMethod(o.smoothed.methodRef?.text||''))):''}
      ${o.structure?kv('Crown structure',`${esc(String(o.structure.call||'').replace(/^./,c=>c.toUpperCase()))} ${I.estimateBadge}`,esc(o.structure.merged?`${o.structure.merged} crown`:'')):''}
      ${kv('Records on this crown',num(o.recordsOnCrown)!==null?nf(o.recordsOnCrown):null,num(o.inventoryRecords)!==null?`${nf(o.inventoryRecords)} from inventories`:'')}
      ${kv('Link to the crown',o.recordLink?esc(o.recordLink.text.replace(/the v5 crown/,'the crown')):'<span class="ti-na">None for this record</span>',num(o.recordLink?.edgeDistance)!==null?`${f1(o.recordLink.edgeDistance)} m from the edge`:'')}
      ${kv('Detection evidence',o.evidenceTier?esc(o.evidenceTier.label.replace(/ a tree$/,'')):null)}
      ${kv('Crowns in other releases',num(o.earlierCrownsOverlapping)!==null?`${nf(o.earlierCrownsOverlapping)} earlier and ${nf(o.laterCrownsOverlapping||0)} later overlap this crown`:null)}${o.review?kv('Review',esc(o.review.status||''),esc(o.review.reason||'')):''}</dl>
      <h3 class="ti-h3">LiDAR measurements</h3>${meas?`<table class="ti-table"><tbody>${meas}</tbody></table>`:none('no LiDAR measurements stored with the crown')}`);
  }
  // ---------- releases and reviews ----------
  const OUTCOME={applied:'Applied: the map and the record show it','recorded in release':'Recorded with the tree; map and values unchanged','already in release':'The release already reflected it',pending:'Not yet applied'};
  function historyBody(){
    const H=rec.history||{},rel=H.releases||[],maxA=Math.max(1,...rel.map(r=>num(r.crown?.area)||0));
    const rows=rel.map(r=>`<tr${r.current?' class="is-self"':''}><th scope="row">${esc(r.date?.text||'')}<small>Release ${esc(releaseName(r))}${r.current?' · this page':''}</small></th>
      <td class="num">${num(r.crown?.height)!==null?`${f1(r.crown.height)} m`:'–'}</td><td class="num"><span class="ti-hbar" style="--w:${Math.round((num(r.crown?.area)||0)/maxA*100)}%"></span>${num(r.crown?.area)!==null?esc(I.text({key:'crownArea',value:r.crown.area})):'–'}</td>
      <td>${esc(plainMethod(r.crown?.method?.text||''))||'–'}</td><td>${(r.events||[]).map(e=>esc(String(e.text||e.kind).replace(/(\d+\.\d+) → (\d+\.\d+) m²/,(m,a,b)=>`${Math.round(a)} → ${Math.round(b)} m²`).replace(/\bv(\d+(?:\.\d+)?)\b/g,'release $1'))).join('; ')||'–'}</td></tr>`).join('');
    const lin=H.lineageStatus==='ready'?'':`<p class="ti-cap">From this record's own fields.${H.lineageStatus==='not_published'||!H.lineageStatus?' The release-by-release lineage file is not yet published.':''}</p>`;
    const C=rec.corrections||{},items=C.items||[];
    const corr=items.length?`<ul class="ti-list">${items.map(x=>`<li><b>${esc(x.kind?x.kind.charAt(0).toUpperCase()+x.kind.slice(1):'Review')}</b>${x.date?.text?` · ${esc(x.date.text)}`:''}${x.summary?`: ${esc(x.summary)}`:''}${x.outcome?` <span class="tag">${esc(OUTCOME[x.outcome]||x.outcome)}</span>`:x.status?` <span class="tag">${esc(x.status)}</span>`:''}${x.by?`<small>${esc(x.by)}${x.id?` · <code>${esc(x.id)}</code>`:''}</small>`:''}</li>`).join('')}</ul>`:none('no reviews or corrections');
    const receipt=C.receiptStatus==='not_published'?notPublished('for this release: the list of applied corrections.'):C.receiptStatus==='release_mismatch'?notPublished('for this release: the corrections list on the site belongs to another release.'):C.receiptStatus==='ready'?`<p class="ti-cap">Checked against this release's list of applied corrections${C.receipt?.generated?.text?` (${esc(C.receipt.generated.text)})`:''}.</p>`:'';
    return `<div class="ti-scroll"><table class="ti-table"><thead><tr><th scope="col">Release</th><th scope="col" class="num">Height</th><th scope="col" class="num">Crown area</th><th scope="col">Crown outline</th><th scope="col">Change</th></tr></thead><tbody>${rows}</tbody></table></div>${lin}
      <h3 class="ti-h3">Reviews and corrections</h3>${C.status==='pending'?pending('Loading reviews…'):corr+receipt}`;
  }
  // ---------- place and property ----------
  function placeBody(){
    const p=rec.place||{},n=rec.nearby||{};
    const parcel=p.parcel?.status==='ready'?`<dl class="ti-kvs">${kv('Property',`LINZ parcel <code>${esc(p.parcel.id)}</code>`)}${kv('Land type',p.parcel.landType?esc(p.parcel.landType.label):null,'Inferred from zoning and parcel records')}${kv('Zone',p.parcel.zone?esc(p.parcel.zone):null)}${kv('Property area',num(p.parcel.area)!==null?`${nf(p.parcel.area)} m²`:null)}${kv('Canopy over it',num(p.parcel.canopy)!==null?`${nf(p.parcel.canopy)} m² · ${nf(Math.round(p.parcel.canopyCover||0))}%`:null)}${kv('Trees counted',nf(p.parcel.trees||0))}${kv('Benefits',num(p.parcel.benefits)!==null?`${I.money(p.parcel.benefits)}/yr ${I.estimateBadge}`:null)}</dl><a class="btn btn-quiet" href="${esc(p.parcel.href)}">${icon('map',16)}<span>Open the property on the map</span></a>`:
      p.parcel?`<p class="ti-def">${esc(p.parcel.note||`LINZ parcel ${p.parcel.id||''}: summary unavailable.`)}</p>`:pending('Finding the property on the map…');
    const list=(n.trees||[]).filter(t=>t.distance<=NEAR);
    const near=n.status==='ready'&&list.length?`<div class="ti-scroll"><table class="ti-table"><thead><tr><th scope="col">Tree</th><th scope="col">Source</th><th scope="col" class="num">Height</th><th scope="col" class="num">Crown area</th><th scope="col" class="num">Distance</th></tr></thead><tbody>${list.slice(0,10).map(t=>`<tr><th scope="row"><a href="${esc(t.href)}">${treeTitle(t)}</a>${t.protected?' <span class="badge badge-protected">Protected</span>':''}</th><td>${esc(t.source==='LiDAR crown'?'LiDAR-detected tree':t.source||'')}</td><td class="num">${t.height!==null?`${f1(t.height)} m`:'–'}</td><td class="num">${t.crownArea!==null?esc(I.text({key:'crownArea',value:t.crownArea})):'–'}</td><td class="num">${nf(t.distance)} m</td></tr>`).join('')}</tbody></table></div><p class="ti-cap">${nf(list.length)} mapped tree${list.length===1?'':'s'} within ${NEAR} m${list.length>10?'; nearest 10 listed':''}.</p>`:
      n.status==='ready'||n.status==='none'?none(`no other mapped tree within ${NEAR} m`):pending('Reading nearby trees from the map…');
    return `<dl class="ti-kvs">${kv('Local board',p.board?esc(I.boardName(p.board.name)):p.status==='pending'?'…':'<span class="ti-na">Outside the local board layer</span>',p.board?.canopyCover!==null&&p.board?.canopyCover!==undefined?`Canopy cover ${nf(Math.round(p.board.canopyCover))}%, earlier board-level assessment`:'')}
      ${kv('Land type',p.landType?esc(p.landType.label):null,p.landType?'Inferred from zoning and parcel records':'')}</dl><h3 class="ti-h3">Property</h3>${parcel}<h3 class="ti-h3">Nearby trees</h3>${near}`;
  }
  // ---------- ground visits and contributions ----------
  function know(){
    const tasks=(rec.know||[]).map(k=>`<li><a class="ti-task" href="${esc(k.href)}"><b>${esc(k.title)}</b><span>${esc(k.text)}</span></a></li>`).join('');
    return mod('know','Know this tree? Add what you know in a KYTE ground visit. A reviewer checks it before a release uses it.',
      `<ul class="ti-tasks">${tasks}</ul><h3 class="ti-h3">Photos</h3><div id="photoSlot">${pending('Loading accepted ground visits…')}</div>`);
  }
  function data(){
    const r=rec.release||{};
    return mod('data','',`<dl class="ti-kvs">${kv('Cite as',`<span id="citeInline">${esc(rec.citation||'')}</span> <button type="button" class="ti-copy" id="copyCiteInline">Copy citation</button>`)}
      ${kv('Release',esc(r.public?.text||I.versionLine(rec)),[esc(r.statusText||''),r.data?`Release number ${esc(String(r.data).replace(/^v/,''))}${r.dev?' (preview)':''}`:null,r.datasetVersion?`Dataset <code>${esc(r.datasetVersion)}</code>`:null].filter(Boolean).join(' · '))}${kv('Record retrieved',r.snapshot?esc(r.snapshot.text):null)}
      ${kv('Methods',`${link(r.methodsHref,'Release methods')}${r.repository?` · ${link(r.repository,'Public repository')}`:''}`)}</dl>
      <div id="notesSlot">${notes()}</div>
      ${DOWNLOADS?`<button type="button" class="btn" id="downloadJson">${icon('download',16)}<span>Download this tree’s record (JSON)</span></button>`:''}
      <details class="ti-details" id="allFields"><summary>Every stored field (${nf(Object.keys(rec._ctx?.record?.datasets||{}).length)} datasets)</summary><div class="all-fields" id="allFieldsBody"></div></details>`);
  }

  // ---------- page ----------
  function metricsMod(){
    const C=I.contextLines(rec);
    numberNotes();
    const foot=`<p class="ti-foot">${C?`Comparison lines: ${esc((C.klass?.label||'').toLowerCase())} crowns ${C.scope.scope==='board'?`in ${esc(I.boardName(C.scope.name))}`:'across Auckland'} (n = ${nf(C.scope.n)}), from the release's comparison tables; more in <a href="#m-compare">Among similar trees</a>. `:''}Trunk diameter (DBH) is at 1.3 m above the uphill ground. Estimates come from the ALTO release model and are not independently validated.</p>`;
    return mod('metrics','Select any value for its source, date, method and range',I.strip(rec,KEYS,{id:'pgPop',cls:'ti-band-page',ctx:C?.lines||null,notes:pnum})+foot,'ti-mod-wide');
  }
  function render(){
    $('#hero').innerHTML=hero();$('#hero').removeAttribute('aria-busy');
    $('#bar').innerHTML=bar();
    $('#mods').innerHTML=[
      metricsMod(),
      structure(),
      `<div class="ti-row2">${mod('compare','',`<div id="compareBody">${compareBody()}</div>`)}${mod('lost',I.estimateBadge,lostBody())}</div>`,
      mod('roots',`${I.estimateBadge} A planning scenario from the trunk estimate`,I.rootRows(rec),'ti-mod-wide'),
      sources(),
      records(),
      `<div class="ti-flow">${species()}${benefits()}${mapped()}${mod('history','The same tree in each data release.',`<div id="historyBody">${historyBody()}</div>`)}${mod('place','',`<div id="placeBody">${placeBody()}</div>`)}${know()}</div>`,
      data()
    ].join('');
    linker=I.bind(document.body,rec,{onYear:(y)=>mapYear(y),popId:'pgPop'});
    bind();
    navSpy();
    const top=$('.tpg-top'),setTop=()=>document.documentElement.style.setProperty('--ti-top',`${top?.offsetHeight||56}px`);
    setTop();addEventListener('resize',setTop);
    printHeader();
  }
  // Print (concept A): an A4 record with the tree ID and the release in the running header, the address and
  // "Page n of N" in the footer; notes printed, map and buttons left out.
  function printHeader(){
    const q=s=>String(s||'').replace(/["\\\n]/g,'');
    const st=document.createElement('style');
    st.textContent=`@page{@top-left{content:"ALTO tree record · ${q(rec.id)}";}@top-right{content:"${q(I.versionLine(rec))}";}@bottom-left{content:"${q(rec.url||location.href)}";}@bottom-right{content:"Page " counter(page) " of " counter(pages);}}`;
    document.head.append(st);
    addEventListener('beforeprint',()=>{const d=$('#notesBox');if(d){d.dataset.wasOpen=d.open?'1':'';d.open=true;}});
    addEventListener('afterprint',()=>{const d=$('#notesBox');if(d&&!d.dataset.wasOpen)d.open=false;});
  }
  function copy(text,button,done='Copied'){
    const old=button?.textContent;
    (navigator.clipboard?.writeText(text)||Promise.reject()).then(()=>{if(button){button.textContent=done;setTimeout(()=>{button.textContent=old;},1600);}}).catch(()=>window.prompt('Copy:',text));
  }
  function showAlert(t){const a=$('#pageAlert');a.hidden=false;a.textContent=t;clearTimeout(showAlert.t);showAlert.t=setTimeout(()=>{a.hidden=true;},4000);}
  function bind(){
    $('#copyId')?.addEventListener('click',e=>copy(rec.id,e.currentTarget));
    $('#copyCiteInline')?.addEventListener('click',e=>copy(rec.citation,e.currentTarget));
    $('#citeText').textContent=rec.citation||'';
    $('#citeTree').disabled=false;$('#citeTree').addEventListener('click',()=>$('#citeDialog').showModal());
    $('#copyCite').addEventListener('click',e=>copy(rec.citation,e.currentTarget));
    $('#shareTree').disabled=false;$('#shareTree').addEventListener('click',async e=>{const url=rec.url||location.href;try{if(navigator.share){await navigator.share({title:document.title,url});return;}}catch{return;}copy(url,e.currentTarget.querySelector('span')||e.currentTarget,'Link copied');});
    $('#saveCompare')?.addEventListener('click',e=>{const r=window.ALTOEvidenceWorkspace.toggle(rec.id);e.currentTarget.setAttribute('aria-pressed',String(r.saved));e.currentTarget.querySelector('span').textContent=r.saved?'Saved to compare':'Save to compare';showAlert(r.message);});
    $('#backToMap').href=rec.mapUrl||'./';
    $('#allFields')?.addEventListener('toggle',e=>{const b=$('#allFieldsBody');if(e.target.open&&!b.childElementCount&&rec._ctx?.record)b.innerHTML=window.ALTOTreeDetails.render(rec._ctx.schema,rec._ctx.record);});
    $('#downloadJson')?.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(R.toJSON(rec),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`alto_${rec.id}.json`;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);});
    document.querySelectorAll('[data-mm]').forEach(b=>b.addEventListener('click',()=>{b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));miniLayers();}));
  }
  // The section in view is marked in the bar; on phones the strip scrolls to keep it visible.
  function navSpy(){
    const links=[...document.querySelectorAll('[data-nav]')];
    const io=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){const id=e.target.id.slice(2);links.forEach(a=>a.toggleAttribute('aria-current',a.dataset.nav===id));
      const cur=links.find(a=>a.dataset.nav===id),nav=cur?.closest('.ti-bar-nav');if(cur&&nav&&nav.scrollWidth>nav.clientWidth)nav.scrollTo({left:cur.offsetLeft-nav.clientWidth/2+cur.offsetWidth/2,behavior:'smooth'});}},{rootMargin:'-30% 0px -60% 0px'});
    document.querySelectorAll('.ti-mod').forEach(s=>io.observe(s));
  }
  const keepYear=()=>I.setYear(document.body,linker?.get()||2024);
  // A link into a section (from the tree panel) stays on its section while later parts change the page above it.
  let pinned=location.hash&&/^#m-[a-z]+$/.test(location.hash)?location.hash:null;
  for(const ev of ['wheel','touchstart','keydown','pointerdown'])addEventListener(ev,()=>{pinned=null;},{once:true,passive:true});
  const keepPinned=()=>{if(pinned)document.querySelector(pinned)?.scrollIntoView();};
  function refreshNotes(){const s=$('#notesSlot');if(!s)return;const open=$('#notesBox')?.open;s.innerHTML=notes();if(open)$('#notesBox').open=true;}
  // Parts that arrive later redraw their own section only.
  function onPart(name){
    try{
      if(name==='context'){const b=$('#compareBody');if(b)b.innerHTML=compareBody();const l=$('#m-lost');if(l)l.outerHTML=mod('lost',I.estimateBadge,lostBody());
        const m=$('#m-metrics');if(m)m.outerHTML=metricsMod();keepYear();}
      else if(name==='history'||name==='corrections'){const b=$('#historyBody');if(b)b.innerHTML=historyBody();}
      else if(name==='place'){const b=$('#placeBody');if(b)b.innerHTML=placeBody();$('#heroBoard').textContent=rec.place?.board?I.boardName(rec.place.board.name):'Outside the local board layer';}
      else if(name==='imagery'){const c=rec.imagery?.current;if(c)document.querySelectorAll('.tp-imagery').forEach(el=>{el.textContent=I.imageryText(c);});}
      else if(name==='photos'){const s=$('#photoSlot'),p=rec.photos||{};
        if(s)s.innerHTML=p.status==='ready'&&p.raw?window.ALTOGround.render(p.raw,rec._ctx.record):`<p class="ti-def">None for this record: no accepted ground visits yet.</p><a class="btn" href="${esc(KYTE)}/?tree=${encodeURIComponent(rec.id)}">${icon('camera',16)}<span>Add a photo (KYTE)</span></a>`;
        if(p.lead)$('#photoLead').innerHTML=`<p class="ti-cap">Photo identification lead, unconfirmed (Pl@ntNet): <i>${esc(p.lead.name)}</i>${p.lead.common?` (${esc(p.lead.common)})`:''}, ${Math.round(p.lead.score*100)}%, ${esc(p.lead.organ)} photograph.</p>`;
        if(p.live){const m=$('#m-metrics');if(m){m.outerHTML=metricsMod();keepYear();}const r=$('#m-roots');if(r)r.outerHTML=mod('roots',`${I.estimateBadge} A planning scenario from the trunk estimate`,I.rootRows(rec),'ti-mod-wide');}}
      else if(name==='scenario')scenarioDraw();
      refreshNotes();keepPinned();
    }catch(err){console.error(name,err);}
  }
  function scenarioDraw(){
    const s=rec.scenario,c=$('#scenarioCap');if(!c)return;
    if(s?.status!=='ready'){c.textContent='';return;}
    const last=s.points[s.points.length-1],slot=$('#surveySlot');
    if(slot){slot.innerHTML=I.surveyChart(rec,{width:300,height:170});keepYear();}
    c.innerHTML=`Hatched band: height scenario to ${last.year}, an estimate: ${esc(nf(last.height,1))} m, range ${esc(nf(last.low,1))}–${esc(nf(last.high,1))} m, from the height-cohort growth rate${s.personalRate!==null&&s.personalRate!==undefined?' and this tree’s 2013–2024 trend':''}; range from hindcast errors.`;
  }

  // ---------- the map in "Crown by survey" ----------
  function miniLayers(){
    if(!mini||!mini.isStyleLoaded())return;
    const on=k=>document.querySelector(`[data-mm="${k}"]`)?.getAttribute('aria-pressed')==='true';
    const vis=(id,v)=>{if(mini.getLayer(id))mini.setLayoutProperty(id,'visibility',v?'visible':'none');};
    vis('imagery',on('imagery'));vis('base',!on('imagery'));vis('crown-this',on('outline'));vis('crowns',on('others'));vis('crowns-line',on('others'));
    for(const id of window.ALTORecordLinks.LAYER_IDS)vis(id,on('positions'));
    if(mini._recMarker)mini._recMarker.getElement().style.display=on('positions')?'':'none';
  }
  function mapYear(year){
    if(!mini||!mini.getSource('tp-year'))return;
    const s=(rec.surveys||[]).find(x=>x.year===year),current=year===2024;
    mini.getSource('tp-year').setData({type:'FeatureCollection',features:geometry?[{type:'Feature',geometry,properties:{current}}]:[]});
    yearMarker?.remove();yearMarker=null;
    const at=s?.position||(!current?rec.identity.position:null);if(!at)return;
    const el=document.createElement('div');el.className='tp-map-year'+(s?.height?'':' is-none');el.innerHTML='<i></i><span></span>';
    el.querySelector('span').textContent=`${year} · ${s?.height?I.text(s.height):s?.status==='outside'?'outside the survey':'no match'}`;
    yearMarker=new maplibregl.Marker({element:el,anchor:'left',offset:[-9,0]}).setLngLat([at.lon,at.lat]).addTo(mini);
  }
  function miniMap(){
    const pos=rec.identity.position,el=$('#miniMap');
    if(!pos||!window.maplibregl){if(el)el.innerHTML='<p class="ti-def">None for this record: no position.</p>';done('map');return;}
    const protocol=new pmtiles.Protocol();maplibregl.addProtocol('pmtiles',protocol.tile);
    const v=u=>`${u}?v=${VERSION}`,ships=window.ALTORecordLinks.shipped(env.metadata),rep=rec.identity.crownRepresentative||rec.id;
    const style={version:8,sources:{
      imagery:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:20,attribution:'Imagery © Esri; Auckland Council'},
      base:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:16,attribution:'Tiles © Esri'},
      pts:{type:'vector',url:v(`pmtiles://${DATA_BASE}/trees_map_points.pmtiles`),attribution:'Land data: LINZ, Auckland Council (CC BY 4.0)'},
      crowns:{type:'vector',url:v(`pmtiles://${DATA_BASE}/tree_crowns_pilot.pmtiles`)},
      props:{type:'vector',url:v(`pmtiles://${DATA_BASE}/properties.pmtiles`)},
      'tp-year':{type:'geojson',data:{type:'FeatureCollection',features:[]}}},
      layers:[{id:'imagery',type:'raster',source:'imagery'},{id:'base',type:'raster',source:'base',layout:{visibility:'none'}},
        {id:'parcels',type:'line',source:'props','source-layer':'properties',minzoom:14,paint:{'line-color':tok('--neutral-0'),'line-width':.8,'line-opacity':.55}},
        {id:'crowns',type:'fill',source:'crowns','source-layer':'crowns',minzoom:12,filter:['!=',['get','tree_id'],rep],paint:{'fill-color':tok('--neutral-0'),'fill-opacity':.06}},
        {id:'crowns-line',type:'line',source:'crowns','source-layer':'crowns',minzoom:12,filter:['!=',['get','tree_id'],rep],paint:{'line-color':tok('--viz-overlay-context'),'line-width':1}},
        {id:'crown-this',type:'line',source:'crowns','source-layer':'crowns',filter:['==',['get','tree_id'],rep],paint:{'line-color':tok('--viz-overlay-focus'),'line-width':2.6}},
        {id:'tp-year-dim',type:'line',source:'tp-year',filter:['==',['get','current'],false],paint:{'line-color':tok('--neutral-0'),'line-width':2,'line-dasharray':[2,1.5]}},
        {id:'tp-year-cur',type:'line',source:'tp-year',filter:['==',['get','current'],true],paint:{'line-color':tok('--viz-overlay-focus'),'line-width':2.6}},
        {id:'pts',type:'circle',source:'pts','source-layer':'trees',minzoom:15,paint:{'circle-radius':['interpolate',['linear'],['zoom'],15,2,20,5],'circle-color':window.ALTOSources.colourExpr(),'circle-stroke-color':tok('--neutral-0'),'circle-stroke-width':1}}]};
    mini=new maplibregl.Map({container:el,style,center:[pos.lon,pos.lat],zoom:18.5,maxZoom:21,attributionControl:false,cooperativeGestures:true});
    mini.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
    mini.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    mini.addControl(new maplibregl.ScaleControl({unit:'metric',maxWidth:100}),'bottom-left');
    mini._recMarker=new maplibregl.Marker({color:tok('--viz-overlay-position'),scale:.55}).setLngLat([pos.lon,pos.lat]).setPopup(new maplibregl.Popup({offset:14}).setText(rec.identity.detection?'Detection point':'Recorded position of this record')).addTo(mini);
    new ResizeObserver(()=>mini?.resize()).observe(el);
    mini.on('load',()=>{mini.resize();el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      if(ships){try{mini.addSource('akl-council-positions',{type:'vector',url:v(`pmtiles://${DATA_BASE}/council_positions.pmtiles`)});for(const l of window.ALTORecordLinks.layers())mini.addLayer({...l,layout:{...(l.layout||{}),visibility:'visible'}},'pts');const k=$('#mapKeyLinks');if(k)k.hidden=false;}catch{}}
      miniLayers();});
    mini.on('click','pts',e=>{const id=e.features?.[0]?.properties?.tree_id;if(id&&id!==rec.id&&id!==rep)location.href=window.ALTOTreeId.url(id);});
    mini.on('mouseenter','pts',()=>mini.getCanvas().style.cursor='pointer');mini.on('mouseleave','pts',()=>mini.getCanvas().style.cursor='');
    let once=false;mini.on('idle',()=>{if(once)return;once=true;afterMap().finally(()=>done('map'));});
  }
  // The rendered tiles hold the crown outline, the trees around it and the property under it.
  const inside=(pt,ring)=>{let ok=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)ok=!ok;}return ok;};
  async function afterMap(){
    const pos=[rec.identity.position.lon,rec.identity.position.lat],rep=rec.identity.crownRepresentative||rec.id;
    const parts=mini.querySourceFeatures('crowns',{sourceLayer:'crowns',filter:['==',['get','tree_id'],rep]});
    if(parts.length){const polys=parts.flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates);geometry=polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys};
      const slot=$('#chipSlot');if(slot){slot.innerHTML=I.crownFigure(rec,geometry,{width:420,height:300});const k=$('#chipKey');if(k)k.innerHTML=I.figureKey(rec,{geometry:true});keepYear();onPart('imagery');}}
    // Every tree is on the point tiles at this zoom: the trees within NEAR metres, and the land type.
    const feats=mini.querySourceFeatures('pts',{sourceLayer:'trees'});
    const tileProps=feats.find(f=>f.properties.tree_id===rep||f.properties.tree_id===rec.id)?.properties||null;
    R.fromMap(rec,{points:feats,tileProps,radius:NEAR});
    const pl=$('#placeBody');if(pl)pl.innerHTML=placeBody();
    let pid=null;
    for(const f of mini.querySourceFeatures('props',{sourceLayer:'properties'})){const g=f.geometry;for(const poly of g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[]){if(inside(pos,poly[0])&&!poly.slice(1).some(h=>inside(pos,h))){pid=f.properties.pid;break;}}if(pid)break;}
    await R.parcel(rec,env,pid).catch(()=>null);
    if(pl)pl.innerHTML=placeBody();
    refreshNotes();
    mapYear(linker?.get()||2024);
    keepPinned();
  }
  const scripts=new Map();
  function script(src){if(!scripts.has(src))scripts.set(src,new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>fail(new Error('Could not load '+src));document.head.append(s);}));return scripts.get(src);}

  // ---------- start ----------
  const waiting=new Set(['map','parts']);
  function done(what){waiting.delete(what);if(!waiting.size){document.body.dataset.ready='true';keepPinned();}}
  function fail(title,text){
    $('#hero').innerHTML=`<div class="ti-id-main"><p class="ti-eyebrow">ALTO tree page</p><h1>${esc(title)}</h1><p class="ti-note">${esc(text)}</p><p><a class="btn btn-primary" href="./">${icon('map',16)}<span>Open the map</span></a></p></div>`;
    $('#hero').removeAttribute('aria-busy');document.title=`${title} · ALTO`;document.body.dataset.ready='true';
  }
  async function main(){
    const params=new URL(location.href).searchParams,raw=params.get('id')||params.get('tree');
    const metadata=await fetch(`${SITE_ROOT}/release-metadata.json`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
    if(!VERSION)VERSION=metadata?.assembly?.tile_version||metadata?.release?.dataset_version||`session-${Date.now()}`;
    env={dataBase:DATA_BASE,siteRoot:SITE_ROOT,metadata,version:VERSION};
    if(window.ALTO_CHANNEL==='beta'){document.body.dataset.channel='beta';$('.tpg-brand')?.insertAdjacentHTML('afterend','<span class="beta-pill">Beta</span>');}
    if(!raw)return fail('No tree ID','Open a tree from the map, or add ?id= and a tree ID to this address.');
    try{rec=await R.load(raw,env);}
    catch(err){return fail(err.code==='invalid'?'Not a tree ID':'Tree not found',err.message||'');}
    window.ALTOTreeRecordCurrent=rec;
    const q=rec.request;
    if(q&&(window.ALTOTreeId.normalise(raw)!==q.canonical||q.status!=='current')){
      history.replaceState(null,'',window.ALTOTreeId.url(q.canonical)+(location.hash||''));
      if(q.status!=='current')showAlert(`ID ${raw}: ${q.status}; now ${q.canonical}.${q.note?' '+q.note:''}`);
    }
    const t=I.title(rec.identity);
    document.title=`${t.text}${t.latin?` (${t.latin})`:''} · ALTO`;
    $('#footVersion').textContent=I.versionLine(rec);
    render();
    if(location.hash)document.querySelector(location.hash)?.scrollIntoView();
    miniMap();
    // The public page reads no per-tree LiDAR point crops (the returns viewer is a workbench tool).
    R.enrich(rec,env,{parts:['context','history','corrections','imagery','place','photos'],onPart}).finally(()=>done('parts'));
    (window.requestIdleCallback||setTimeout)(()=>script('./tree-future.js?v=20260928-v5b').then(()=>R.enrich(rec,env,{parts:['scenario'],onPart})).catch(()=>{}));
    setTimeout(()=>{if(document.body.dataset.ready!=='true')document.body.dataset.ready='true';},20000);
  }
  main();
})();
