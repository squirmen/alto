/* Tree page (tree.html?id=…): one tree as a set of linked instruments ("Instrument dashboard", concept B, chosen
 * 12 Oct 2026), with concept A's protection line, records link, root-space rows, numbered notes and A4 print layout,
 * and concept C's numbered section links (a sticky strip on phones) and plain sentences.
 * A survey year chosen in the bar highlights in the key measurements, every figure, the measurements by source and
 * the map; every value opens its provenance in one tap. Sections, numbered as in the tree panel's links: key
 * measurements · crown by survey · aerial imagery through time · among similar trees · if it were lost · root space ·
 * measurements by source ·
 * records and identifiers · species and growth form · benefits · how this tree was mapped · releases and reviews ·
 * place and property · ground visits and contributions · data, versions and citation.
 * Reads alto.tree-record/1 (tree-record.js); markup from tree-instrument.js; aerial imagery from tree-imagery.js (LINZ);
 * ALTO design system. */
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
  let rec=null,env=null,mini=null,linker=null,yearMarker=null,geometry=null,imageryTL=null;
  const NEAR=40; // metres: the nearby trees listed from the map tiles around the recorded position

  // Key measurements, in order: size; the dripline radius and, for a scheduled tree, the Unitary Plan protected root zone;
  // the trunk; the BS 5837 radius for comparison; the estimates.
  const KEYS=['height','crownArea','crownDiameter','crownSpread','dripline','rootZone','rootZoneColumnar','trunkDiameter','largestStem','rootProtection','lifeStage','benefits','carbonStored','replacementYears','crownReplacement','irreplaceability'];
  // Measures that need the crown outline (from the map tiles) or the release's maxima file (crown spread): added to the
  // record when either arrives, and the key measurements redrawn.
  function spreadOf(){const M=window.ALTOMaxima?.current,t=rec?.number&&M?.trees?.[rec.number];return t&&Number.isFinite(Number(t.s))?Number(t.s):null;}
  function addExtras(){if(rec)R.extras(rec,{geometry,spread:spreadOf()});}
  const MODS=I.SECTIONS,numOf=id=>MODS.findIndex(m=>m[0]===id)+1;
  // A section redrawn in place: its element (observed, focusable, pinned) stays; its contents change.
  const swapMod=(id,html)=>{const old=$(`#m-${id}`);if(!old)return;const t=document.createElement('template');t.innerHTML=String(html).trim();const nu=t.content.firstElementChild;if(nu)old.replaceChildren(...nu.childNodes);};
  const mod=(id,meta,body,cls='')=>{const m=MODS.find(x=>x[0]===id);return `<section class="ti-mod ${cls}" id="m-${id}" aria-labelledby="h-${id}"><header class="ti-mod-head"><h2 id="h-${id}"><span class="ti-mod-n" aria-hidden="true">${numOf(id)}</span>${esc(m[1])}</h2>${meta?`<p>${meta}</p>`:''}</header>${body}</section>`;};
  const kv=(label,value,sub)=>value===null||value===undefined||value===''?'':`<div class="ti-kv"><dt>${esc(label)}</dt><dd>${value}${sub?`<small>${sub}</small>`:''}</dd></div>`;
  const link=(href,t='Method')=>href?`<a${t==='Method'?' class="ti-mlink"':''} href="${esc(href)}"${/^\.|^\//.test(href)?'':' target="_blank" rel="noopener"'}>${esc(t)}</a>`:'';
  // Credits and their links (credits.js; credits.html lists every source).
  const CR=window.ALTOCredits||{URLS:{}},ITREE=CR.URLS.itree||'https://database.itreetools.org/',NZTR=CR.URLS.nzTreeRegister||'https://www.treeregister.nz/',PLANTNET='https://plantnet.org/';
  const iTree=t=>t?esc(t).replace(/^i-Tree\b/,link(ITREE,'i-Tree')):'';
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
  // Source names in the glossary's words (no release numbers in labels).
  const plainSource=n=>String(n||'').replace(/\s*\(v\d+(?:\.\d+)? crown detection\)/,' (crown detection)');
  const plainBasis=t=>String(t||'').replace(/\bv\d+(?:\.\d+)? growth[- ]form model weighted\b/i,'Weighted by the growth-form estimate').replace(/\bv(\d+(?:\.\d+)?)\b/g,'release $1');
  const releaseName=r=>(R.RELEASES.find(x=>x.key===r.release)?.label)||String(r.release||'').replace(/^v/,'');
  function treeTitle(t){
    if(t.nameKind==='model')return `${esc(String(t.title).replace(/^(Probably|Likely)\s+/,'').replace(/\s*\(model\)$/,'').replace(/\(model,\s*/,'(').replace(/^./,c=>c.toUpperCase()))} ${I.estimateBadge}`;
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
  // The Notable Trees schedule line (tree-instrument.js protectionLine; its item numbers and date from notable_facts.json,
  // its rule order from the land type once the map has read it).
  const scheduleHtml=()=>I.protectionLine(rec,{cls:'ti-prot ti-prot-say',facts:window.ALTOMaxima?.current?.facts||null});
  function refreshSchedule(){const el=$('#heroSchedule');if(el)el.innerHTML=scheduleHtml();}
  function hero(){
    const id=rec.identity,t=I.title(id),cf=I.crownForm(id),codes=I.surveyCodes(rec);
    const saved=window.ALTOEvidenceWorkspace?.has(rec.id);
    return `<div class="ti-id-main"><p class="ti-eyebrow ti-kicker">${esc(I.eyebrow(id))}</p><h1>${t.html||esc(t.text)}</h1>${t.latinHtml?`<p class="ti-latin">${t.latinHtml}</p>`:''}${t.recordedAs?`<p class="ti-note ti-recorded-as">Recorded as: ${esc(t.recordedAs)}</p>`:''}${maxBadge()}${t.note?`<p class="ti-note">${esc(t.note)}</p>`:''}
        ${cf?`<p class="ti-note">${esc(cf)}</p>`:''}${codes?`<p class="ti-note ti-survey-codes">${esc(codes.line)} <a href="#m-species">Code meanings</a></p>`:''}<div id="heroSchedule">${scheduleHtml()}</div>${I.releaseLines(rec,{cls:'ti-lines ti-lines-page'})}${I.evidenceRow(rec)}${I.badges(rec,{icon,recordsHref:'#m-records'})}
        <dl class="ti-idline">${I.idLine(rec)}
          <div><dt>Local board</dt><dd id="heroBoard">…</dd></div><div><dt>Release</dt><dd>${esc(rec.release.public?.text||I.versionLine(rec))}${rec.release.public?.preview?' <span class="badge badge-muted">Preview</span>':''}${rec.release.statusText?`<small>${esc(rec.release.statusText)}</small>`:''}<small><a href="#m-history">Releases and reviews</a></small></dd></div>${locationItem()}</dl></div>
      <div class="ti-id-actions"><a class="btn btn-primary" id="openMap" href="${esc(rec.mapUrl||'./')}">${icon('map',16)}<span>See it on the map</span></a>
        <button type="button" class="btn" id="saveCompare" aria-pressed="${saved?'true':'false'}">${icon('bookmark',16)}<span>${saved?'Saved to compare':'Save to compare'}</span></button>
        <a class="btn" href="${esc(R.photoHref(rec,KYTE))}">${icon('camera',16)}<span>Add a photo (KYTE)</span></a>${girthLink()}
        <a class="btn btn-quiet" href="#m-know">Know this tree?</a>${problemLink()}</div>${rec.kauri?`<p class="ti-note ti-kauri-note">Kauri: ${esc(R.KAURI_PHOTO.charAt(0).toLowerCase()+R.KAURI_PHOTO.slice(1))}.</p>`:''}`;
  }
  // Where the tree is: the map pin's position (WGS84) with Copy, what that position is, plain links to Google Maps,
  // Street View and OpenStreetMap (new tab), then the nearest address point's street and the parcel once read.
  const newTab=what=>`<span class="sr-only"> ${what} (opens in a new tab)</span>`;
  function locationItem(){
    const L=R.location(rec);
    if(!L)return `<div class="ti-loc"><dt>Location</dt><dd><span class="ti-na">No position in this record</span></dd></div>`;
    const links=L.links.map(l=>`<a href="${esc(l.href)}" target="_blank" rel="noopener" data-loc="${esc(l.key)}">${esc(l.label)}${newTab('at this position')}</a>`).join('<span aria-hidden="true"> · </span>');
    return `<div class="ti-loc"><dt>Location</dt><dd><code class="ti-coord">${esc(L.text)}</code><button type="button" class="ti-copy" id="copyCoords" aria-label="Copy the coordinates (latitude, longitude)">Copy</button>
      <small>${esc(L.caption)}</small><small class="ti-loc-links">${links}</small><small id="heroNear">${esc(R.nearLine(rec)||'')}</small></dd></div>`;
  }
  // Species maxima (tool 0.2.8): the "Maximum · …" line under the name (clear leads only), the Recognition block under
  // the header and, when KYTE reads girth tasks (kyte-config.js), "Measure its girth (KYTE)". From the release's derived
  // maxima.json and notable_facts.json (species-maxima.js); a release without them shows none of these.
  const MX=()=>{const M=window.ALTOMaxima;return M&&M.current&&rec?.number?M:null;};
  // A tree release 6.3 flags (height or record check, a multi-tree Schedule 10 entry) is never badged (rec.maximaBlocked).
  function maxBadge(){const M=MX();return M?M.badgeHtml(M.current,rec.number,{id:'maxBadge',base:'.',flagged:!!rec.maximaBlocked}):'';}
  // "Report a problem with this record" (KYTE task=problem; kyte-config.js problemTask).
  function problemLink(){const href=R.problemHref(rec,{kyteBase:KYTE});return href?`<a class="btn btn-quiet" id="reportProblem" href="${esc(href)}"><span>Report a problem with this record</span></a>`:'';}
  function girthLink(){const M=MX(),href=M?M.girthHref(M.current,rec.number,{kyteBase:KYTE}):null;return href?`<a class="btn" id="kyteGirth" href="${esc(href)}"><span>Measure its girth (KYTE)</span></a>`:'';}
  // The Council row's crown link in words: how ALTO joined this record to its crown.
  function crownLinkWords(){const l=rec.identity?.crownLink,t=String(l?.text||'').replace(/the v5 crown/,'the crown');
    return /reviewer|correction/i.test(t)?'a reviewer correction':l?.class==='probable'?'probable link':l?.seeded?'crown drawn from the record':'recorded position inside the crown';}
  function recognitionMod(){const M=MX();return M?M.recognitionHtml(M.current,rec.number,{base:'.',crownLink:crownLinkWords(),flagged:!!rec.maximaBlocked}):'';}
  function showMaxima(){
    if(!MX())return;
    const hero=$('#hero');
    if(hero&&!$('#maxBadge')){const html=maxBadge();if(html)(hero.querySelector('.ti-latin')||hero.querySelector('h1'))?.insertAdjacentHTML('afterend',html);}
    if(hero&&!$('#kyteGirth')){const html=girthLink(),kyte=[...hero.querySelectorAll('.ti-id-actions a')].find(a=>/\/kyte\/\?tree=/.test(a.getAttribute('href')||''));if(html&&kyte)kyte.insertAdjacentHTML('afterend',html);}
    const slot=$('#recogSlot');if(slot)slot.innerHTML=recognitionMod();
    refreshSchedule();
    if(spreadOf()!==null){addExtras();const m=$('#m-metrics');if(m){m.outerHTML=metricsMod();keepYear();}refreshNotes();}
  }
  // The sticky bar: the survey year and the numbered section links (a scrolling strip of chips on phones, concept C).
  // On wider screens the strip shows the chips that fit whole and a "More" menu with the rest (never a clipped chip).
  function bar(){
    return `<div class="ti-bar-in"><span class="ti-bar-name" aria-hidden="true">${esc(I.title(rec.identity).text)}</span>${I.years(rec)}
      <div class="ti-bar-navs"><ol class="ti-bar-nav">${MODS.map(([id,,short],i)=>`<li><a href="#m-${id}" data-nav="${id}"><span class="ti-nav-n" aria-hidden="true">${i+1}</span>${esc(short)}</a></li>`).join('')}</ol>
        <div class="ti-nav-more" hidden><button type="button" class="ti-nav-more-btn" aria-expanded="false" aria-controls="navMore">More<span class="ti-nav-more-n"></span></button>
          <ol class="ti-nav-menu" id="navMore" hidden>${MODS.map(([id,ttl],i)=>`<li><a href="#m-${id}" data-nav="${id}"><span class="ti-nav-n" aria-hidden="true">${i+1}</span>${esc(ttl)}</a></li>`).join('')}</ol></div></div>
      <p class="ti-bar-quick"><a href="#m-records">Records</a><a href="#m-history">Releases</a></p></div>`;
  }
  function fitNav(){
    const nav=$('.ti-bar-nav'),more=$('.ti-nav-more');if(!nav||!more)return;
    const chips=[...nav.children],menu=[...more.querySelectorAll('.ti-nav-menu > li')];
    chips.forEach(li=>{li.hidden=false;});
    if(matchMedia('(max-width: 759px)').matches){more.hidden=true;return;}
    more.hidden=false;
    const gap=parseFloat(getComputedStyle(nav).columnGap)||0,room=nav.parentElement.clientWidth-more.offsetWidth-8;
    let used=0,cut=chips.length;
    for(let i=0;i<chips.length;i++){used+=chips[i].offsetWidth+(i?gap:0);if(used>room){cut=i;break;}}
    if(cut===chips.length){more.hidden=true;return;}
    chips.forEach((li,i)=>{li.hidden=i>=cut;});menu.forEach((li,i)=>{li.hidden=i<cut;});
    more.querySelector('.ti-nav-more-n').textContent=` (${chips.length-cut})`;
    markMore();
  }
  // The More button shows when the section in view is one of its items.
  function markMore(){
    const b=$('.ti-nav-more-btn');if(!b)return;
    const cur=[...document.querySelectorAll('.ti-nav-menu > li:not([hidden]) a[aria-current]')][0];
    b.classList.toggle('is-current',!!cur);
    b.setAttribute('aria-label',cur?`More sections (now: ${cur.textContent.replace(/^\d+/,'').trim()})`:'More sections');
  }
  function navMenu(){
    const b=$('.ti-nav-more-btn'),m=$('#navMore');if(!b||!m)return;
    const close=()=>{m.hidden=true;b.setAttribute('aria-expanded','false');};
    b.addEventListener('click',e=>{e.stopPropagation();const open=m.hidden;m.hidden=!open;b.setAttribute('aria-expanded',String(open));if(open)m.querySelector('li:not([hidden]) a')?.focus();});
    m.addEventListener('click',e=>{if(e.target.closest('a'))close();});
    document.addEventListener('click',e=>{if(!m.hidden&&!e.target.closest('.ti-nav-more'))close();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!m.hidden){close();b.focus();}});
    // A11Y-09: focus leaving the button and its menu closes the menu (focus stays where it went).
    const wrap=b.closest('.ti-nav-more');
    wrap?.addEventListener('focusout',e=>{
      if(m.hidden||(e.relatedTarget&&wrap.contains(e.relatedTarget)))return;
      setTimeout(()=>{if(!m.hidden&&document.hasFocus?.()&&!wrap.contains(document.activeElement))close();},0);
    });
    const bar=$('#bar');if(bar&&typeof ResizeObserver!=='undefined')new ResizeObserver(()=>fitNav()).observe(bar);
    fitNav();
    document.fonts?.ready?.then(fitNav);
  }

  // ---------- crown by survey (linked figures) ----------
  function mapKey(){
    const src=PAL?PAL.rows('source'):[];
    return `<ul class="ti-key ti-mapkey" aria-label="Map key"><li><i class="ti-sw ti-sw-outline" aria-hidden="true"></i>This crown</li><li><i class="ti-sw ti-sw-thin" aria-hidden="true"></i>Other crowns</li>
      <li><i class="ti-sw ti-sw-pin" aria-hidden="true"></i>${rec.identity.detection?'Detection point':'Recorded position of this record'}</li>
      ${src.map(r=>`<li><i class="ti-sw ti-sw-${r.mark==='ringed-dot'?'ringed-dot':'dot'}" style="--sw:${esc(r.colour)}" aria-hidden="true"></i>${esc(r.label)}${r.mark==='ringed-dot'?' (with the schedule ring)':''}</li>`).join('')}<li id="mapKeyLinks" hidden><i class="ti-sw ti-sw-link" aria-hidden="true"></i>Council recorded positions and their links</li></ul>`;
  }
  function structure(){
    const P=rec.lidar?.profile,hf=I.heightFigure(rec,{width:176,height:300,labels:true}),S=rec.surveys||[];
    // Like for like: each survey's canopy height at the point matched to this tree; the 2024 crown maximum in its own column.
    const na=s=>`<span class="ti-na" title="${esc(s.line||'')}">${esc(s.status==='outside'?'outside survey':s.year===2024?'no crown linked':'not linked')}</span>`;
    const atPoint=s=>s.year===2024?(num(s.matchedHeight)!==null?`${f1(s.matchedHeight)} m`:'–'):s.height?esc(I.text(s.height)):na(s);
    const rows=S.map(s=>`<tr data-year="${s.year}"><th scope="row">${s.year}</th><td class="num">${atPoint(s)}</td><td class="num">${s.year===2024?(s.height?esc(I.text(s.height)):na(s)):'–'}</td><td class="num">${s.year===2024&&num(s.area)!==null?esc(I.text({key:'crownArea',value:s.area})):'–'}</td><td class="num">${s.year===2024&&s.height&&num(s.cover)!==null?`${nf(s.cover*100)}%`:'–'}</td></tr>`).join('');
    const ps=S.find(s=>s.year===2024)?.pointSample;
    const methodHref=rec.measures.height?.provenance?.method?.href||rec.release.methodsHref;
    return mod('structure','LiDAR surveys of 2013, 2016 and 2024. Select a year in the bar or on any figure.',
      `<p class="ti-say">${esc(I.surveySentence(rec))}</p>${I.yearsNote(rec)}${ps?`<p class="ti-say ti-point-sample">Canopy-model height at the recorded point: ${esc(ps.text)} (no tree crown linked; may be a structure).</p>`:''}<div class="ti-struct">
        <figure class="ti-panel ti-p-height"><figcaption class="ti-eyebrow">Height</figcaption>${hf||'<p class="ti-def">None for this record: no survey height.</p>'}
          <p class="ti-cap">Lines: height at each survey (2013 and 2016 at the matched canopy point; 2024 the crown maximum); the selected survey is darker.${P?` Bars: LiDAR returns per 1 m of height, ${nf(P.total)} returns, 2024 survey.`:''}${(rec.lidar?.measurements||[]).some(x=>x.key==='liveCrownBase')?' Dashed line: live crown base.':''} ${link(methodHref)}</p></figure>
        <figure class="ti-panel ti-p-crown"><figcaption class="ti-eyebrow">Crown</figcaption><div id="chipSlot">${I.crownFigure(rec,geometry,{width:420,height:300})}</div>
          <div id="chipKey">${I.figureKey(rec,{geometry:!!geometry})}</div><p class="ti-cap" id="chipCap"><span class="tp-imagery">${esc(I.imageryText(null))}</span>. ${CR.aerialFigure?CR.aerialFigure():''} ${link(rec.outline?.segmentation?.method?.href||methodHref)}</p></figure>
        <figure class="ti-panel ti-p-map" aria-describedby="miniMapDesc"><figcaption class="ti-eyebrow">Map</figcaption><p class="sr-only" id="miniMapDesc">Map of the crown, the crowns around it and recorded positions. Arrow keys move the map; plus and minus zoom.</p><div id="miniMap" class="ti-minimap"></div>
          <div class="ti-mm" role="group" aria-label="Map layers"><button type="button" data-mm="imagery" aria-pressed="true">Aerial imagery</button><button type="button" data-mm="outline" aria-pressed="true">This crown</button><button type="button" data-mm="others" aria-pressed="true">Other crowns</button><button type="button" data-mm="positions" aria-pressed="true">Recorded positions</button></div>
          ${mapKey()}<p class="ti-cap">Trees within ${NEAR} m are listed under Place and property. Select a dot to open that tree.</p></figure>
        <figure class="ti-panel ti-p-survey"><figcaption class="ti-eyebrow">Height at each survey</figcaption><div id="surveySlot">${I.surveyChart(rec,{width:300,height:170})}</div>
          <table class="ti-table ti-mini"><thead><tr><th scope="col">Survey</th><th scope="col" class="num">At matched point</th><th scope="col" class="num">Crown maximum</th><th scope="col" class="num">Crown area</th><th scope="col" class="num">Cover</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="ti-cap">Dots joined by a line: height at the canopy point matched to this tree in each survey (like for like). Diamond: the 2024 crown maximum, a different measure; its whisker shows the other estimates of its height in this record. Crown outlines are kept for 2024 only. <span id="scenarioCap"></span></p></figure>
      </div>`,'ti-mod-wide');
  }
  // ---------- aerial imagery through time (LINZ's aerial surveys, read in the browser by tree-imagery.js) ----------
  function imageryMod(){
    return mod('imagery','Aerial surveys of Auckland, 1939–2025',
      `<p class="ti-say">The crown in each aerial survey of Auckland that covers this tree, oldest first: scanned historical surveys (1939–2004), then the surveys since 2010. The yellow line is the 2024 crown outline from the LiDAR survey, drawn on every photograph for comparison; where the tree has no outline, a ring marks its position. Select a photograph for a larger view: zoom in, widen the frame and step through the years.</p>
      <div id="imageryBody" class="ti-ix-body"></div>
      <p class="ti-cap">The photographs are orthophotos: a tall crown leans away from the camera, so it can sit a metre or more off its outline, differently in each survey. Each is read at about 15–30 cm per pixel (a coarser survey at its own pixel size, and only where no sharper survey of the same years covers the tree) to keep the page fast; the larger view reads each survey at up to its own pixel size. Dates are each survey’s flying period as LINZ records it; LINZ does not date each photograph. Only surveys whose capture area covers the tree are read.</p>
      <div id="streetSlot">${streetBody()}</div>`,'ti-mod-wide');
  }
  // ---------- street level (one Mapillary photograph chosen ahead of time; linked, never shown) ----------
  function streetBody(){
    const v=rec.streetview||{};if(v.status!=='ready')return '';
    const what=v.pano?'360° photograph':'photograph',far=num(v.metres)!==null?`, about ${nf(Math.round(v.metres))} m from the tree${v.pano?'':' and facing it'}`:v.pano?'':', facing the tree';
    const nw=v.newer,newer=nw?` A newer 360° photograph${nw.date?` taken on ${esc(nw.date.text)}`:''}${num(nw.metres)!==null?`, about ${nf(Math.round(nw.metres))} m from the tree`:''}: ${link(nw.url,'open it on Mapillary')} and turn the view to find the tree.`:'';
    return `<h3 class="ti-h3">Street level</h3><p class="ti-say"><a class="btn btn-quiet" href="${esc(v.url)}" target="_blank" rel="noopener">${icon('camera',16)}<span>See this tree on Mapillary</span></a></p>
      <p class="ti-cap">A ${what} taken from the street${v.date?` on ${esc(v.date.text)}`:''}${far}. Chosen from Mapillary’s public coverage; other trees may be in view.${newer} Image: Mapillary contributors, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>; its page on Mapillary names the contributor. ALTO links to it and does not copy it.</p>`;
  }
  let imageryWaited=false;
  function startImagery(){
    const el=$('#imageryBody'),pos=rec.identity.position,X=window.ALTOImagery;if(!el)return;
    // The reader arrives after the hero (FE-03, later()); the section starts when it has.
    if(pos&&!X&&!imageryWaited){imageryWaited=true;later().then(startImagery);return;}
    if(!pos||!X){el.innerHTML=none(pos?'the aerial imagery reader did not load':'no position');return;}
    imageryTL=X.timeline(el,{lon:pos.lon,lat:pos.lat,area:num(rec.measures?.crownArea?.value)??num(rec.summary?.size?.area),geometry:()=>geometry,
      colours:{focus:tok('--viz-overlay-focus'),halo:tok('--viz-overlay-halo')},onDone:sm=>{document.body.dataset.imagery=JSON.stringify({ready:sm.ready.length,none:sm.none.length,superseded:sm.superseded.length,error:sm.error.length,blocked:sm.blocked,historic:sm.historic});}});
  }

  // ---------- among similar trees (the release's comparison tables; a fixed n for every tree) ----------
  function compareBody(){
    const c=rec.context||{},cls=rec.benefits?.classUsed;
    const head=cls?`<p class="ti-lede">Within its tree class, <b>${esc(cls.label.toLowerCase())}</b> (the class of its benefit estimates). Crown area and benefits on log scales.</p>`:'';
    if(c.status==='ready'){
      const mets=['height','crownArea','benefits'],small=c.scopes.find(sc=>sc.scope==='street'&&sc.status==='small'),rows=c.scopes.filter(sc=>sc!==small);
      return head+`<div class="ti-cmp" role="table" aria-label="Among similar trees"><div class="ti-cmp-row ti-cmp-head" role="row"><span role="columnheader">Group</span>${mets.map(m=>`<span role="columnheader">${esc(I.METRICS[m].label)}${m==='benefits'?` ${I.estimateBadge}`:''}</span>`).join('')}</div>`+
        rows.map(sc=>`<div class="ti-cmp-row" role="row"><span role="rowheader"><b>${esc(sc.scope==='street'?'Street':sc.scope==='board'?'Local board':'Auckland')}</b>${sc.name&&sc.scope!=='auckland'?`<small>${esc(sc.scope==='board'?I.boardName(sc.name):sc.name)}</small>`:''}<small>${sc.status==='ready'?`n = ${nf(sc.n)}`:esc(sc.definition||'No group for this tree')}</small></span>${mets.map(m=>{const e=sc.metrics?.[m];
          return `<span role="cell">${e?`<b>${esc(e.text)}</b>${I.distStrip(m,{value:e.value,dist:e.distribution,text:e.text,n:sc.n})}`:'<span class="ti-na">–</span>'}</span>`;}).join('')}</div>`).join('')+'</div>'+
        // Release 6.3: where this crown's height class stands in each group (comparisons.json height_class counts).
        (()=>{const hc=rec.lifeStage?.label,ls=rows.filter(sc=>sc.heightClass);return hc&&ls.length?`<ul class="ti-list">${ls.map(sc=>`<li>${esc(sc.scope==='street'?`${sc.name}`:sc.scope==='board'?I.boardName(sc.name):'Auckland')}: ${nf(Math.floor(sc.heightClass.shareAtOrAbove))}% of ${esc((cls?.label||'').toLowerCase())} crowns are ${esc(hc.toLowerCase())} or in a larger height class (n = ${nf(sc.heightClass.n)}).</li>`).join('')}</ul>`:'';})()+
        `<p class="ti-cap">Strips: the middle half of the group (dark band), 5–95% (light band) and the median (tick); dots are each tree in a small group; the ring with a line is this tree. ${c.population?esc(String(c.population).replace(/\.?\s*$/,'.')):''}${c.generated?` Comparison tables of ${esc(c.generated.text)}.`:''} Shares are rounded down. Street: trees whose nearest address point is on the same street, compared when at least ${nf(R.MIN_STREET_N||10)} trees of the class share it${small?` (${esc(small.name||'this street')} has ${nf(small.n)}, so it is left out)`:''}.</p>`;
    }
    if(c.status==='pending')return head+pending('Loading comparison tables…');
    if(c.status==='no_class')return head+none('no tree class for comparison (no crown estimate)');
    // Release 6.3: a crown that is not classed, or whose height or record link is flagged, is not compared; the page says why.
    if(c.status==='not_classed'||c.status==='excluded')return head+`<p class="ti-def">${esc(c.note||'Not compared.')}</p>`;
    return head+notPublished(c.status==='release_mismatch'?'for this release: the comparison tables on the site belong to another release.':'for this release: street, local board and Auckland comparison tables.');
  }

  // ---------- if it were lost ----------
  function lostBody(){
    const r=rec.replacement,c=rec.context;
    // Release 6.3: the crown replacement bands with this crown's band marked; release 6.2: the irreplaceability classes.
    const k=r?.release63?r.band?.key:r?.irreplaceability?.key,list=r?.release63?r.bands:r?.classes,what=r?.release63?'Crown replacement bands':'Irreplaceability classes';
    const classes=list?.length&&k?`<ol class="ti-classes" aria-label="${what}">${list.map(x=>`<li${x.key===k?' class="is-cur" aria-current="true"':''}><b>${esc(x.label)}${x.key===k?' · this tree':''}</b><span>${esc(x.rule)}</span></li>`).join('')}</ol>`:'';
    const irr=c?.status==='ready'?c.scopes.filter(sc=>sc.irreplaceability).map(sc=>`<li>${esc(sc.scope==='street'?`${sc.name}`:sc.scope==='board'?I.boardName(sc.name):'Auckland')}: ${nf(Math.floor(sc.irreplaceability.shareAtOrAbove))}% of ${esc((c.class?.label||'').toLowerCase())} crowns are in this ${sc.irreplaceability.band?'band or a longer one':'class or higher'} (n = ${nf(sc.irreplaceability.n)}).</li>`).join(''):'';
    return `${I.lost(rec,{variant:'page'})}${classes}${irr?`<ul class="ti-list">${irr}</ul>`:''}`;
  }

  // ---------- measurements by source; records and identifiers ----------
  function sources(){
    return mod('sources','Each column is one source, dated. Select a value for its provenance.',I.matrix(rec),'ti-mod-wide');
  }
  function records(){
    const rs=rec.records||[];
    const rows=rs.map(r=>`<tr${r.self?' class="is-self"':''}><th scope="row">${esc(plainSource(r.source?.name))}${r.self?' <span class="tag">This record</span>':''}<small>${esc(r.source?.kind||'')}</small></th>
      <td>${r.href?link(r.href,r.sourceId||r.treeId):`<code>${esc(r.sourceId||r.treeId||'')}</code>`}${!r.self&&r.treeId&&(!rec.number||(r.number&&r.number!==rec.number))?`<small><a href="${esc(window.ALTOTreeId.url(r.number||r.treeId))}">Tree page</a></small>`:''}</td>
      <td>${esc(r.role?r.role.charAt(0).toUpperCase()+r.role.slice(1):'')}${r.owner?.class?`<small>${esc(r.owner.class)}</small>`:''}</td><td>${r.species?.common||r.species?.latin?`${esc(r.species.common||'')}${r.species.latin?` <i>${esc(I.hybrid(r.species.latin))}</i>`:''}`:'<span class="ti-na">None recorded</span>'}</td>
      <td>${r.snapshot?.text?esc(r.snapshot.text):'–'}</td><td>${r.link?.text?esc(r.link.text.replace(/the v5 crown/,'the crown')):'–'}${num(r.link?.edgeDistance)!==null?`<small>${f1(r.link.edgeDistance)} m from the crown edge</small>`:''}</td></tr>`).join('');
    // From release 6.1 a record on the crown carries this tree's number (its link opens this page) unless it keeps a
    // marker and a number of its own.
    const more=rec.membersPending?pending('Reading the crown’s other records…'):rec.moreRecords?`<p class="ti-cap">${nf(rec.moreRecords)} more record${rec.moreRecords===1?'':'s'} on this crown${rec.number?'':'; each has its own tree page'}.</p>`:'';
    const ids=(rec.identifiers||[]).map(x=>`<li><span>${esc(x.kind.replace(/\s*\(v\d+\)/,''))}${x.self?' · this record':''}</span><code>${x.href?link(x.href,x.code):esc(x.code)}</code>${x.note?`<small>${esc(x.note)}</small>`:''}</li>`).join('');
    const b=rec.identity.badges.find(x=>x.key==='records');
    // Each dataset behind these records, once, credited as its provider asks and linked to its own page.
    const seen=new Map();for(const c of [...rs.map(r=>r.credit),...(rec.identifiers||[]).map(x=>x.dataset)])if(c&&!seen.has(c.text))seen.set(c.text,c);
    const credits=seen.size?`<p class="ti-cap ti-credits">Sources: ${[...seen.values()].map(c=>esc(c.text)+(c.links.length?` (${c.links.map(l=>link(l.href,l.text)).join(' · ')})`:'')).join('; ')}. ${link('./credits.html','Sources and credits')}</p>`:'';
    return mod('records',b?esc(b.label):'',`<div class="ti-scroll"><table class="ti-table"><thead><tr><th scope="col">Source</th><th scope="col">Record ID</th><th scope="col">Role</th><th scope="col">Species as supplied</th><th scope="col">Retrieved</th><th scope="col">Link to the crown</th></tr></thead><tbody>${rows}</tbody></table></div>${more}
      <p class="ti-cap">Girths: Auckland Unitary Plan and New Zealand Tree Register girths are taken at 1.4 m; ALTO’s and KYTE’s at 1.3 m above the uphill ground.</p>
      <h3 class="ti-h3">Identifiers</h3>${ids?`<ul class="ti-ids">${ids}</ul>`:none('no other identifiers')}${credits}`,'ti-mod-wide');
  }

  // ---------- species ----------
  function species(){
    const s=rec.species||{},r=s.recorded||{},g=s.growthForm,id=rec.identity||{},N=window.ALTOSpeciesNames,codes=I.surveyCodes(rec);
    const recorded=id.nameMulti?`<span class="ti-na">None: the record names several species</span>`:r.name?`${N?N.nameHtml(r.name.common||''):esc(r.name.common||'')}${r.name.latin?` ${N?N.latinHtml(r.name.latin):`<i>${esc(I.hybrid(r.name.latin))}</i>`}`:''}`:'<span class="ti-na">None for this record</span>';
    let h=`<dl class="ti-kvs">${kv('Recorded name',recorded,r.name||id.nameMulti?esc(`${r.source||''}`):'')}
      ${id.nameMulti?kv('Recorded as',esc(id.recordedAs)):''}${r.name?.latinAsSupplied?kv('Latin name',N?N.latinHtml(r.name.latin):esc(r.name.latin),esc(`Accepted name (release 6.3), checked against the iNaturalist taxonomy; supplied as ${r.name.latinAsSupplied}`)):''}${r.asSupplied&&(r.name||id.nameMulti)?kv('Species as supplied',esc(r.asSupplied)):''}${r.classFromName?kv('Tree class from the name',esc(r.classFromName.class.charAt(0).toUpperCase()+r.classFromName.class.slice(1)),iTree(r.classFromName.basis)):''}
      ${codes?kv('Council kauri survey (Ruru ObsKauri Tiaki)',`${codes.release63?'Result as supplied':'Result codes as supplied'}: ${esc(codes.codes)}`,`${codes.explainHtml} Code definitions: ${link(codes.fields,'Council layer')}. Auckland Council kauri survey records (Ruru ObsKauri Tiaki, valid and public), ${esc(codes.credit||'Bio Info Team, Environmental Services, Auckland Council')}. ${esc(codes.caveat||'Not a complete record; verify before relying on it.')}`):''}</dl>`;
    if(g){
      // The release's own call (growth-form.js WORDING), never the top score as a class; a withheld call shows its scores only
      // folded, each named as a model score.
      const scores=V.probabilities((g.probabilities||[]).map(p=>({label:p.label,value:p.p,top:g.shown&&p.top})),{suffix:'model score'});
      h+=g.shown?`<h3 class="ti-h3">Growth form ${I.estimateBadge}</h3><p class="ti-lead">${esc(g.wording)}</p>${scores}`:
        `<h3 class="ti-h3">Growth form</h3><p class="ti-def">${esc(g.wording||'Growth form not yet determined')}. The model’s scores did not reach the release’s bar for a call.</p>${scores?`<details class="ti-details"><summary>Model scores (call withheld)</summary>${scores}</details>`:''}`;
      h+=`<dl class="ti-kvs">${kv('Method',esc('Growth-form model on the 2024 LiDAR survey and aerial imagery'),link(g.method?.href))}${kv('Survey flight',g.flight?esc(g.flight.text):null,g.lateJuneFlight?'Late-June flight: deciduous crowns may be leaf-off.':'')}
        ${g.palmDetector?kv('Palm detector',g.palmDetector.seen?`Score ${nf(g.palmDetector.score,2)}`:'Not triggered'):''}</dl>`;
    }else if(s.growthFormStatus)h+=`<p class="ti-def">Growth form: none for this record (${esc(s.growthFormStatus==='not_scored'?'not estimated for this crown in this release':'not in this release')}).</p>`;
    if(s.legacy?.probabilities?.length)h+=`<details class="ti-details"><summary>Earlier growth-form estimate (uncalibrated)</summary>${V.probabilities(s.legacy.probabilities.map(p=>({label:p.label,value:p.p})))}<p class="ti-cap">Uncalibrated; kept for the record.</p></details>`;
    h+='<div id="photoLead"></div>';
    return mod('species','',h);
  }
  // ---------- benefits ----------
  // A sensitivity scenario, not a valuation: each component says what kind of number it is, and the method is ALTO's own
  // simplified equations adapted from published i-Tree Eco components (not run in i-Tree Eco).
  function benefits(){
    const b=rec.benefits||{},q=rec.measures.benefits;
    if(b.status!=='estimated'||!q)return mod('benefits','',none(b.status==='withheld'?'withheld: height not plausible (height check)':b.status==='scenario_only'?'no measured crown, so the tree is left out of the totals':'no crown estimate'));
    // Release 6.3: the benefit value is stormwater plus carbon; PM2.5 removal and the cooling index (unpriced) are listed
    // apart, and only where the release publishes them.
    const also=(b.also||[]).length?`<dl class="ti-kvs"><div class="ti-kv"><dt>Also estimated, not priced</dt><dd>${b.also.map(x=>`${esc(x.label)}: ${esc(x.text)}`).join('; ')} ${I.estimateBadge}</dd></div></dl>`:'';
    const rows=(b.rows||[]).map(x=>`<tr><th scope="row">${esc(x.label)}${x.mark?`<small>${esc(x.mark)}</small>`:''}</th><td>${x.quantity?esc(x.quantity.text):'–'}${x.quantity?.detail?`<small>${esc(x.quantity.detail)}</small>`:''}</td><td class="num">${x.value!==null&&x.value!==undefined?`${I.money(x.value)}/yr`:'–'}</td></tr>`).join('');
    const note=String(b.note||'').replace(/^ALTO benefit scenario:[^.]*\.\s*/,'');
    return mod('benefits',`${I.estimateBadge} Sensitivity scenario${b.release63?' · stormwater and carbon':''}`,`<p class="ti-big"><button type="button" class="ti-v" data-q="benefits" aria-haspopup="dialog">${esc(I.text(q))}</button><small>${esc(I.line(q))}</small></p>${I.rangeBar(q)}
      <table class="ti-table"><thead><tr><th scope="col">Service</th><th scope="col">Quantity</th><th scope="col" class="num">Value</th></tr></thead><tbody>${rows}</tbody>${b.release63?`<tfoot><tr><th scope="row">Benefit value</th><td>Stormwater and carbon</td><td class="num">${esc(b.total?.text||'')}</td></tr></tfoot>`:''}</table>${also}
      <dl class="ti-kvs">${kv('Tree class used',b.classUsed?esc(b.classUsed.label):null,b.classUsed?.source?esc(plainBasis(b.classUsed.source)):'')}${kv('Leaf area index',num(b.lai)!==null?nf(b.lai,1):null)}${b.biomass?kv('Biomass',`${nf(I.sig2(b.biomass.aboveKg))} kg above ground, ${nf(I.sig2(b.biomass.belowKg))} kg below`):''}${kv('Method',`ALTO benefit scenario: simplified equations adapted from published ${link(ITREE,'i-Tree Eco')} components; not run in i-Tree Eco ${link(b.method?.href)}`)}</dl>
      ${note?`<p class="ti-cap">${esc(note)}</p>`:''}${b.assumptions&&Object.keys(b.assumptions).length?`<details class="ti-details"><summary>Assumptions</summary><dl class="ti-kvs">${Object.entries(b.assumptions).map(([k,v])=>kv(k.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()),esc(plainBasis(String(typeof v==='object'?JSON.stringify(v):v).replace(/\bv\d+(?:\.\d+)? crown\b/g,'crown'))))).join('')}</dl></details>`:''}`);
  }
  // ---------- how this tree was mapped ----------
  function mapped(){
    const o=rec.outline||{},L=rec.lidar||{};
    // The "Highest return" row only when it differs from Height (the release's canopy-top field repeats the crown maximum).
    const H=num(rec.measures?.height?.value);
    const meas=(L.measurements||[]).filter(x=>!(x.key==='canopyTop'&&H!==null&&Math.abs(num(x.value)-H)<0.05)).map(x=>`<tr><th scope="row">${esc(x.label.replace(/Crown maximum/,'Height').replace(/Canopy top \(returns\)/,'Highest return'))}</th><td class="num"><button type="button" class="ti-v" data-q="${esc(x.key)}" aria-haspopup="dialog">${esc(I.text(x))}</button></td><td>${esc((x.provenance?.note||'').replace(/^v5 crown( cells)?$/,'Crown').replace(/^Earlier crown$/,'Crown, earlier method').replace(/^Mean over the crown cells$/,'Mean over the crown'))}</td></tr>`).join('');
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
      <td>${esc(plainMethod(r.crown?.method?.text||''))||'–'}</td><td>${(r.events||[]).map(e=>esc(R.relWords(String(e.text||e.kind).replace(/(\d+\.\d+) → (\d+\.\d+) m²/,(m,a,b)=>`${Math.round(a)} → ${Math.round(b)} m²`)))).join('; ')||(r.noChange?'<span class="ti-na">No change</span>':'–')}</td></tr>`).join('');
    const lin=H.lineageStatus==='ready'?'':`<p class="ti-cap">From this record's own fields.${H.lineageStatus==='not_published'||!H.lineageStatus?' The release-by-release lineage file is not yet published.':''}</p>`;
    const C=rec.corrections||{},items=C.items||[];
    const corr=items.length?`<ul class="ti-list">${items.map(x=>`<li><b>${esc(x.kind?String(x.kind).replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()):'Review')}</b>${x.date?.text?` · ${esc(x.date.text)}`:''}${x.summary?`: ${esc(x.summary)}`:''}${(x.register||[]).map(z=>` ${link(z.href,`New Zealand Tree Register record ${z.code}`)}`).join('')}${x.outcome?` <span class="tag">${esc(OUTCOME[x.outcome]||x.outcome)}</span>`:x.status?` <span class="tag">${esc(x.status)}</span>`:''}${x.by?`<small>${esc(x.by)}${x.id?` · <code>${esc(x.id)}</code>`:''}</small>`:''}${(x.basedOn||[]).map(o=>`<small class="ti-based">Based on the ${esc(String(o.kind||'observation').replace(/_/g,' '))}${o.date?.text?` of ${esc(o.date.text)}`:''}${o.ref?` (<code>${esc(o.ref)}</code>)`:''}</small>`).join('')}</li>`).join('')}</ul>${items.some(x=>x.register?.length)?`<p class="ti-cap">Register records: ${link(NZTR,'New Zealand Tree Register')}, New Zealand Notable Trees Trust. Register recognition has no legal status.</p>`:''}`:none('no reviews or corrections');
    const receipt=C.receiptStatus==='not_published'?notPublished('for this release: the list of applied corrections.'):C.receiptStatus==='release_mismatch'?notPublished('for this release: the corrections list on the site belongs to another release.'):C.receiptStatus==='ready'?`<p class="ti-cap">Checked against this release's list of applied corrections${C.receipt?.generated?.text?` (${esc(C.receipt.generated.text)})`:''}.</p>`:'';
    return `<div class="ti-scroll"><table class="ti-table"><thead><tr><th scope="col">Release</th><th scope="col" class="num">Height</th><th scope="col" class="num">Crown area</th><th scope="col">Crown outline</th><th scope="col">Change</th></tr></thead><tbody>${rows}</tbody></table></div>${lin}
      <h3 class="ti-h3">Reviews and corrections</h3>${C.status==='pending'?pending('Loading reviews…'):corr+receipt}`;
  }
  // ---------- place and property ----------
  function placeBody(){
    const p=rec.place||{},n=rec.nearby||{};
    const parcel=p.parcel?.status==='ready'?`<dl class="ti-kvs">${kv('Property',`LINZ parcel <code>${esc(p.parcel.id)}</code>`)}${kv('Land type',p.parcel.landType?esc(p.parcel.landType.label):null,'Inferred from zoning and parcel records')}${kv('Zone',p.parcel.zone?esc(p.parcel.zone):null)}${kv('Property area',num(p.parcel.area)!==null?`${nf(p.parcel.area)} m²`:null)}${kv('Canopy over it',num(p.parcel.canopy)!==null?`${nf(p.parcel.canopy)} m² · ${nf(Math.round(p.parcel.canopyCover||0))}%`:null)}${kv('Map markers',nf(p.parcel.trees||0))}${kv('Benefits',num(p.parcel.benefits)!==null?`${I.money(p.parcel.benefits)}/yr ${I.estimateBadge}`:null)}</dl><a class="btn btn-quiet" href="${esc(p.parcel.href)}">${icon('map',16)}<span>Open the property on the map</span></a>`:
      p.parcel?`<p class="ti-def">${esc(p.parcel.note||`LINZ parcel ${p.parcel.id||''}: summary unavailable.`)}</p>`:pending('Finding the property on the map…');
    const list=(n.trees||[]).filter(t=>t.distance<=NEAR);
    const near=n.status==='ready'&&list.length?`<div class="ti-scroll"><table class="ti-table"><thead><tr><th scope="col">Tree</th><th scope="col">Source</th><th scope="col" class="num">Height</th><th scope="col" class="num">Crown area</th><th scope="col" class="num">Distance</th></tr></thead><tbody>${list.slice(0,10).map(t=>`<tr><th scope="row"><a href="${esc(t.href)}">${treeTitle(t)}</a>${t.protected?' <span class="badge badge-protected">Protected</span>':''}</th><td>${esc(t.source==='LiDAR crown'?'LiDAR-detected tree':t.source||'')}</td><td class="num">${t.height!==null?`${f1(t.height)} m`:'–'}</td><td class="num">${t.crownArea!==null?esc(I.text({key:'crownArea',value:t.crownArea})):'–'}</td><td class="num">${nf(t.distance)} m</td></tr>`).join('')}</tbody></table></div><p class="ti-cap">${nf(list.length)} mapped tree${list.length===1?'':'s'} within ${NEAR} m${list.length>10?'; nearest 10 listed':''}.</p>`:
      n.status==='ready'||n.status==='none'?none(`no other mapped tree within ${NEAR} m`):pending('Reading nearby trees from the map…');
    return `<dl class="ti-kvs">${kv('Local board',p.board?esc(I.boardName(p.board.name)):p.status==='pending'?'…':p.status==='unavailable'?'<span class="ti-na">Not loaded: data/local_boards.json</span>':'<span class="ti-na">Outside the local board layer</span>',p.board?.canopyCover!==null&&p.board?.canopyCover!==undefined?`Canopy cover ${nf(Math.round(p.board.canopyCover))}%, earlier board-level assessment`:'')}
      ${kv('Land type',p.landType?esc(p.landType.label):null,p.landType?'Inferred from zoning and parcel records':'')}</dl><h3 class="ti-h3">Property</h3>${parcel}<h3 class="ti-h3">Nearby trees</h3>${near}`;
  }
  // ---------- ground visits and contributions ----------
  function know(){
    const tasks=(rec.know||[]).map(k=>`<li><a class="ti-task" href="${esc(k.href)}"><b>${esc(k.title)}</b><span>${esc(k.text)}</span></a></li>`).join('');
    return mod('know','Know this tree? Add what you know in a KYTE ground visit. A reviewer checks it before a release uses it.',
      `<ul class="ti-tasks">${tasks}</ul><h3 class="ti-h3">Photos</h3><div id="photoSlot">${pending('Loading accepted ground visits…')}</div>
      <h3 class="ti-h3">iNaturalist records at this tree</h3><div id="inatSlot">${inatBody()}</div>`);
  }
  // iNaturalist records matched to this tree by location. Each record's licence decides what is shown: species, month
  // and the observer's credit for CC BY (without NC) and CC0 records; a link with its licence for the others.
  function inatBody(){
    const x=rec.inat||{},inat=link('https://www.inaturalist.org/','iNaturalist');
    if(x.status==='pending')return pending('Loading iNaturalist records…');
    if(x.status==='not_published'||x.status==='release_mismatch')return '<p class="ti-def">Not published for this release.</p>';
    if(x.status==='unavailable')return '<p class="ti-def">Not loaded: iNaturalist records (network error).</p>';
    if(x.status!=='ready'||!x.records?.length)return `<p class="ti-def">None matched: no research-grade ${inat} record of a woody plant lies inside this crown or within 5–15 m of it.</p>`;
    const items=x.records.map(r=>{
      const obs=`<a href="${esc(r.url)}" target="_blank" rel="noopener">iNaturalist observation ${esc(String(r.id))}</a>`;
      if(!r.facts)return `<li>${obs} (${esc(r.licenceText)}) · ${esc(r.where)}</li>`;
      const name=r.common?`${esc(r.common[0].toUpperCase()+r.common.slice(1))} (<i>${esc(r.taxon)}</i>)`:`<i>${esc(r.taxon)}</i>`;
      const credit=r.licence==='cc0'?'no rights reserved (CC0)':`© ${esc(r.login||'the observer')}, some rights reserved (${esc(r.licenceText)})`;
      return `<li>${name} · ${[r.monthText,...r.phenology,r.where].filter(Boolean).map(esc).join(' · ')}<small>${credit} · ${obs}</small></li>`;
    }).join('');
    const shown=x.records.length,more=x.count>shown?` Newest ${nf(shown)} of ${nf(x.count)} listed.`:'';
    return `<p class="ti-say">Research-grade records whose public location is inside this crown or within 5–15 m of it (set by each record’s stated accuracy). They are matched by location only: a record may show a plant beneath or beside this tree, and it never changes the species shown here.</p>
      <ul class="ti-inat">${items}</ul>
      <p class="ti-cap">${nf(x.count)} record${x.count===1?'':'s'} matched.${more} From ${inat}, read ${x.fetched?esc(new Date(x.fetched+'T12:00:00').toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric'})):'for this release'}. Each record keeps its own licence: species and dates are shown for CC BY and CC0 records, and the others are linked. No photographs are copied.${x.near?` ${link(x.near,'More iNaturalist records near this tree')}.`:''}</p>`;
  }
  function data(){
    const r=rec.release||{};
    return mod('data','',`<dl class="ti-kvs">${kv('Cite as',`<span id="citeInline">${esc(rec.citation||'')}</span> <button type="button" class="ti-copy" id="copyCiteInline">Copy citation</button>`)}
      ${rec.number?kv('Tree number',`<code>${esc(rec.number)}</code>`,`Record ID <code>${esc(rec.id)}</code>`)+kv('Permalink',`<a class="ti-permalink" href="${esc(rec.permalink)}">${esc(rec.permalink)}</a>`):''}
      ${kv('Release',esc(r.public?.text||I.versionLine(rec)),[esc(r.statusText||''),r.data?`Release number ${esc(String(r.data).replace(/^v/,''))}${r.dev?' (preview)':''}`:null,r.datasetVersion?`Dataset <code>${esc(r.datasetVersion)}</code>`:null].filter(Boolean).join(' · '))}${kv('Record retrieved',r.snapshot?esc(r.snapshot.text):null)}
      ${kv('Methods',`${link(r.methodsHref,'Release methods')}${r.repository?` · ${link(r.repository,'Public repository')}`:''}`)}</dl>
      <div id="notesSlot">${notes()}</div>
      ${DOWNLOADS?`<button type="button" class="btn" id="downloadJson">${icon('download',16)}<span>Download this tree’s record (JSON)</span></button>`:''}
      <details class="ti-details" id="allFields"><summary>Every stored field (${nf(Object.keys(rec._ctx?.record?.datasets||{}).length)} datasets)</summary><div class="all-fields" id="allFieldsBody"></div></details>`);
  }

  // Record IDs in review and measurement notes ("akl_tree_lid_1110327") become links named by the tree's number (T162DYHP),
  // resolved through the release's ID table; the record ID stays in the link's title.
  const RID=/\bakl_tree_[A-Za-z0-9_]+\b/g,ridNumbers=new Map();
  function linkRecordIds(...els){
    for(const el of els.filter(Boolean)){
      const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,{acceptNode:n=>RID.test(n.nodeValue)&&!n.parentElement.closest('a,code,script,style')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
      const nodes=[];while(walk.nextNode())nodes.push(walk.currentNode);RID.lastIndex=0;
      for(const n of nodes){
        const frag=document.createDocumentFragment(),t=n.nodeValue;let last=0;
        for(const m of t.matchAll(RID)){frag.append(t.slice(last,m.index));const a=document.createElement('a');a.className='ti-rid';a.dataset.rid=m[0];a.href=window.ALTOTreeId.url(m[0]);a.title=`Record ID ${m[0]}`;a.textContent=ridNumbers.get(m[0])||m[0];frag.append(a);last=m.index+m[0].length;}
        frag.append(t.slice(last));n.replaceWith(frag);
      }
    }
    const want=[...new Set([...document.querySelectorAll('a.ti-rid')].map(a=>a.dataset.rid))].filter(id=>!ridNumbers.has(id));
    for(const id of want){ridNumbers.set(id,null);window.ALTOTreeId.resolve(id,{base:DATA_BASE,version:VERSION,metadata:env.metadata}).then(r=>{
      if(!r?.number)return;ridNumbers.set(id,r.number);document.querySelectorAll(`a.ti-rid[data-rid="${CSS.escape(id)}"]`).forEach(a=>{a.textContent=r.number;a.href=window.ALTOTreeId.url(r.number);});}).catch(()=>{});}
    for(const a of document.querySelectorAll('a.ti-rid'))if(ridNumbers.get(a.dataset.rid)){a.textContent=ridNumbers.get(a.dataset.rid);a.href=window.ALTOTreeId.url(ridNumbers.get(a.dataset.rid));}
  }
  // ---------- page ----------
  function rootsMod(){return mod('roots','Dripline radius from the 2024 crown outline; the BS 5837 radius and the root-space scenario are estimates from the trunk estimate',I.rootRows(rec),'ti-mod-wide');}
  function metricsMod(){
    const C=I.contextLines(rec);
    numberNotes();
    const foot=`<p class="ti-foot">${C?`Comparison lines: from the release's comparison tables; more in <a href="#m-compare">Among similar trees</a>. `:rec.context?.status==='excluded'?`${esc(rec.context.note)} `:''}Height: ${esc(R.HEIGHT_DEF.charAt(0).toLowerCase()+R.HEIGHT_DEF.slice(1))}; survey vertical accuracy ±0.2 m; airborne LiDAR usually reads below a field hypsometer height on pointed crowns. Trunk diameter is at 1.3 m above the uphill ground. Estimates come from the ALTO release model and are not independently validated.</p>`;
    return mod('metrics','Select any value for its source, date, method and range',I.strip(rec,KEYS,{id:'pgPop',cls:'ti-band-page',ctx:C?.lines||null,notes:pnum})+foot,'ti-mod-wide');
  }
  function render(){
    addExtras();
    $('#hero').innerHTML=hero();$('#hero').removeAttribute('aria-busy');
    $('#bar').innerHTML=bar();
    $('#mods').innerHTML=[
      `<div id="recogSlot">${recognitionMod()}</div>`,
      metricsMod(),
      structure(),
      imageryMod(),
      `<div class="ti-row2">${mod('compare','',`<div id="compareBody">${compareBody()}</div>`)}${mod('lost',I.estimateBadge,lostBody())}</div>`,
      rootsMod(),
      sources(),
      records(),
      `<div class="ti-flow">${species()}${benefits()}${mapped()}${mod('history','The same tree in each data release.',`<div id="historyBody">${historyBody()}</div>`)}${mod('place','',`<div id="placeBody">${placeBody()}</div>`)}${know()}</div>`,
      data()
    ].join('');
    linker=I.bind(document.body,rec,{onYear:(y)=>mapYear(y),popId:'pgPop'});
    linkRecordIds($('#m-history'),$('#m-sources'));
    bind();
    navSpy();
    navMenu();
    startImagery();
    stickyStack();
    printHeader();
  }
  // Print (concept A): an A4 record with the tree number (or ID) and the release in the running header, the permalink and
  // "Page n of N" in the footer; notes printed, map and buttons left out.
  function printHeader(){
    const q=s=>String(s||'').replace(/["\\\n]/g,'');
    const st=document.createElement('style');
    st.textContent=`@page{@top-left{content:"ALTO tree record · ${q(rec.number||rec.id)}";}@top-right{content:"${q(I.versionLine(rec))}";}@bottom-left{content:"${q(rec.permalink||rec.url||location.href)}";}@bottom-right{content:"Page " counter(page) " of " counter(pages);}}`;
    document.head.append(st);
    addEventListener('beforeprint',()=>{const d=$('#notesBox');if(d){d.dataset.wasOpen=d.open?'1':'';d.open=true;}});
    addEventListener('afterprint',()=>{const d=$('#notesBox');if(d&&!d.dataset.wasOpen)d.open=false;});
  }
  // Copying says so on the button and in the page's status line (#pageAlert, role=status), which screen readers announce.
  function copy(text,button,done='Copied',said=null){
    const old=button?.textContent;
    (navigator.clipboard?.writeText(text)||Promise.reject()).then(()=>{if(button){button.textContent=done;setTimeout(()=>{button.textContent=old;},1600);}if(said)showAlert(said);}).catch(()=>window.prompt('Copy:',text));
  }
  function showAlert(t,{keep=false,html=false}={}){const a=$('#pageAlert');a.hidden=false;if(html)a.innerHTML=t;else a.textContent=t;clearTimeout(showAlert.t);if(!keep)showAlert.t=setTimeout(()=>{a.hidden=true;},html?8000:4000);}
  function bind(){
    const idSaid=()=>rec.number?`Tree number ${rec.number} copied.`:`Tree ID ${rec.id} copied.`;
    $('#copyId')?.addEventListener('click',e=>copy(rec.number||rec.id,e.currentTarget,'Copied',idSaid()));
    $('#copyCiteInline')?.addEventListener('click',e=>copy(rec.citation,e.currentTarget,'Copied',`Citation for tree ${rec.number||rec.id} copied.`));
    $('#copyCoords')?.addEventListener('click',e=>{const L=R.location(rec);if(L)copy(L.text,e.currentTarget,'Copied',`Coordinates ${L.text} copied.`);});
    $('#citeText').textContent=rec.citation||'';
    if(rec.number)$('#citeNote').textContent='Cite the tree number and its permalink with the data and tool versions: values change between data releases; the number and the link keep working through them.';
    $('#citeTree').disabled=false;$('#citeTree').addEventListener('click',()=>$('#citeDialog').showModal());
    $('#copyCite').addEventListener('click',e=>copy(rec.citation,e.currentTarget,'Copied',`Citation for tree ${rec.number||rec.id} copied.`));
    $('#shareTree').disabled=false;$('#shareTree').addEventListener('click',async e=>{const url=rec.permalink||rec.url||location.href;try{if(navigator.share){await navigator.share({title:document.title,url});return;}}catch{return;}copy(url,e.currentTarget.querySelector('span')||e.currentTarget,'Link copied',`Link to tree ${rec.number||rec.id} copied.`);});
    // Saving says where the comparison is: a link to the map's comparison (./?compare).
    $('#saveCompare')?.addEventListener('click',e=>{const W=window.ALTOEvidenceWorkspace,r=W.toggle(rec.id);e.currentTarget.setAttribute('aria-pressed',String(r.saved));e.currentTarget.querySelector('span').textContent=r.saved?'Saved to compare':'Save to compare';
      showAlert(`${esc(r.message)}${W.count()?` <a href="${esc(W.compareHref("."))}">Compare saved trees (${nf(W.count())})</a>`:''}`,{html:true});});
    $('#backToMap').href=rec.mapUrl||'./';
    $('#allFields')?.addEventListener('toggle',e=>{const b=$('#allFieldsBody');if(e.target.open&&!b.childElementCount&&rec._ctx?.record)b.innerHTML=window.ALTOTreeDetails.render(rec._ctx.schema,rec._ctx.record,{hide:window.ALTOFields?.pm25CoolingShown(env.metadata)?[]:['benefits.pm25_removed_g_y','benefits.cooling_index']}).replace(/\b[Vv]5 crown\b/g,'crown');});
    $('#downloadJson')?.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(R.toJSON(rec),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`alto_${rec.id}.json`;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);});
    document.querySelectorAll('[data-mm]').forEach(b=>b.addEventListener('click',()=>{b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));miniLayers();}));
  }
  // The section in view is marked in the bar; on phones the strip scrolls to keep it visible.
  function navSpy(){
    const links=[...document.querySelectorAll('[data-nav]')];
    const io=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){const id=e.target.id.slice(2);links.forEach(a=>a.toggleAttribute('aria-current',a.dataset.nav===id));
      const cur=links.find(a=>a.dataset.nav===id&&a.closest('.ti-bar-nav')),nav=cur?.closest('.ti-bar-nav');if(cur&&nav&&nav.scrollWidth>nav.clientWidth)nav.scrollTo({left:cur.offsetLeft-nav.clientWidth/2+cur.offsetWidth/2,behavior:'smooth'});markMore();}},{rootMargin:'-30% 0px -60% 0px'});
    document.querySelectorAll('.ti-mod').forEach(s=>io.observe(s));
  }
  const keepYear=()=>I.setYear(document.body,linker?.get()||2024);
  // A11Y-01: the sticky stack is measured. --ti-top is the app bar's height (the section bar sticks below it); --ti-stack is
  // the stack that stays on screen plus 8 px, which html scroll-padding-top (focus) and each section's scroll-margin-top
  // read. A ResizeObserver keeps both current; past a fifth of the window's height the bars scroll with the page
  // (ALTOInstrument.stickyPlan).
  let stack={stack:0,offset:8};
  function stickyStack(){
    const root=document.documentElement,top=$('.tpg-top'),bar=$('#bar');
    const fit=()=>{
      const t=top?.offsetHeight||0,b=bar?.offsetHeight||0,p=I.stickyPlan({top:t,bar:b,height:Math.max(innerHeight,root.clientHeight)});
      root.classList.toggle('ti-bar-static',p.barStatic);root.classList.toggle('ti-top-static',p.topStatic);
      root.style.setProperty('--ti-top',`${t}px`);root.style.setProperty('--ti-stack',`${p.offset}px`);
      stack=p;
    };
    fit();
    if(typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(fit);if(top)ro.observe(top);if(bar)ro.observe(bar);}
    addEventListener('resize',fit);
  }
  // A link to a section (the section bar, "Know this tree?", a link from the map's tree panel) puts the section's top just
  // below the sticky stack, in script: a browser's own jump adds the scroller's scroll-padding to the section's
  // scroll-margin. The section stays there while later parts change the page above it, until the reader scrolls, types
  // or points elsewhere (or 15 s pass).
  const sectionOf=hash=>/^#m-[a-z]+$/.test(hash||'')?document.getElementById(hash.slice(1)):null;
  let pinned=/^#m-[a-z]+$/.test(location.hash)?location.hash:null,pinnedUntil=pinned?Date.now()+15000:0;
  const goTo=hash=>{const el=sectionOf(hash);if(!el)return false;const r=el.getBoundingClientRect();if(Math.abs(r.top-stack.offset)>1)window.scrollTo({top:I.sectionScroll(r.top,scrollY,stack.offset),behavior:'instant'});return true;};
  const keepPinned=()=>{if(pinned&&Date.now()<pinnedUntil)goTo(pinned);else pinned=null;};
  const unpin=()=>{pinned=null;};
  for(const ev of ['wheel','touchmove','keydown'])addEventListener(ev,unpin,{passive:true});
  addEventListener('pointerdown',e=>{if(!e.target?.closest?.('a[href^="#m-"]'))unpin();},{passive:true});
  function pinTo(hash,{focus=false}={}){
    const el=sectionOf(hash);if(!el)return false;
    pinned=hash;pinnedUntil=Date.now()+15000;goTo(hash);
    if(focus){if(!el.hasAttribute('tabindex'))el.setAttribute('tabindex','-1');el.focus({preventScroll:true});}
    return true;
  }
  document.addEventListener('click',e=>{
    const a=e.target?.closest?.('a[href^="#m-"]');if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    const hash=a.getAttribute('href');if(!sectionOf(hash))return;
    e.preventDefault();
    if(location.hash!==hash)history.pushState(null,'',hash);
    pinTo(hash,{focus:true});
  });
  addEventListener('hashchange',()=>{if(sectionOf(location.hash))pinTo(location.hash);});
  // Focus that Tab moved and a late part then pushed under the bars or off the window (an aerial photograph drawing
  // above it, say) is brought back into view, clear of the bars (WCAG 2.4.11), in the frames right after the move.
  let tabAt=0;
  addEventListener('keydown',e=>{if(e.key==='Tab')tabAt=Date.now();},{capture:true,passive:true});
  const coverBottom=()=>Math.max(0,...[$('.tpg-top'),$('#bar')].filter(Boolean).map(el=>el.getBoundingClientRect()).filter(r=>r.height&&r.top<=(stack.stack||0)+1&&r.top>=-1).map(r=>r.bottom));
  addEventListener('focusin',e=>{
    const el=e.target;if(Date.now()-tabAt>600||!(el instanceof Element)||el.closest('.tpg-top, #bar'))return;
    const check=()=>{if(document.activeElement!==el)return;const r=el.getBoundingClientRect();if(r.height&&(r.top<coverBottom()-1||r.bottom>innerHeight+1))el.scrollIntoView({block:'nearest'});};
    requestAnimationFrame(()=>requestAnimationFrame(check));setTimeout(check,150);setTimeout(check,400);
  });
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>keepPinned()).observe(document.body);
  function refreshNotes(){const s=$('#notesSlot');if(!s)return;const open=$('#notesBox')?.open;s.innerHTML=notes();if(open)$('#notesBox').open=true;}
  // Parts that arrive later redraw their own section only.
  function onPart(name){
    try{
      if(name==='context'||name==='place'){const n=$('#heroNear');if(n)n.textContent=R.nearLine(rec)||'';}
      if(name==='context'){const b=$('#compareBody');if(b)b.innerHTML=compareBody();const l=$('#m-lost');if(l)l.outerHTML=mod('lost',I.estimateBadge,lostBody());
        const m=$('#m-metrics');if(m)m.outerHTML=metricsMod();keepYear();}
      else if(name==='history'||name==='corrections'){const b=$('#historyBody');if(b){b.innerHTML=historyBody();linkRecordIds(b);}}
      else if(name==='place'){const b=$('#placeBody');if(b)b.innerHTML=placeBody();$('#heroBoard').textContent=rec.place?.board?I.boardName(rec.place.board.name):rec.place?.status==='unavailable'?'Not loaded: data/local_boards.json':'Outside the local board layer';
        // The citation names the local board once it is known.
        const ci=$('#citeInline');if(ci)ci.textContent=rec.citation||'';const ct=$('#citeText');if(ct)ct.textContent=rec.citation||'';}
      else if(name==='imagery'){const c=rec.imagery?.current;if(c)document.querySelectorAll('.tp-imagery').forEach(el=>{el.textContent=I.imageryText(c);});}
      else if(name==='photos'){const s=$('#photoSlot'),p=rec.photos||{};
        // KYTE's visits that did not load say so, with Retry; never "no accepted ground visits".
        if(s)s.innerHTML=p.status==='ready'&&p.raw?window.ALTOGround.render(p.raw,rec._ctx.record):`${p.status==='unavailable'?'<p class="ti-def">Not loaded: KYTE ground visits (network error or KYTE unavailable). <button type="button" class="btn btn-quiet" data-photos-retry>Retry</button></p>':'<p class="ti-def">None for this record: no accepted ground visits yet.</p>'}<a class="btn" href="${esc(R.photoHref(rec,KYTE))}">${icon('camera',16)}<span>Add a photo (KYTE)</span></a>`;
        s?.querySelector('[data-photos-retry]')?.addEventListener('click',e=>{e.currentTarget.disabled=true;R.enrich(rec,env,{parts:['photos'],onPart});},{once:true});
        if(p.lead)$('#photoLead').innerHTML=`<p class="ti-cap">Photo identification lead, unconfirmed (${link(PLANTNET,'Pl@ntNet')}): <i>${esc(p.lead.name)}</i>${p.lead.common?` (${esc(p.lead.common)})`:''}, ${Math.round(p.lead.score*100)}%, ${esc(p.lead.organ)} photograph.</p>`;
        if(p.live){addExtras();const m=$('#m-metrics');if(m){m.outerHTML=metricsMod();keepYear();}const r=$('#m-roots');if(r)r.outerHTML=rootsMod();}}
      else if(name==='inat'){const s=$('#inatSlot');if(s)s.innerHTML=inatBody();}
      else if(name==='streetview'){const s=$('#streetSlot');if(s)s.innerHTML=streetBody();}
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
    el.querySelector('span').textContent=`${year} · ${s?.height?`${I.text(s.height)}${year===2024?' crown max':' at matched point'}`:s?.status==='outside'?'outside the survey':year===2024?'no crown linked':'not linked'}`;
    yearMarker=new maplibregl.Marker({element:el,anchor:'left',offset:[-9,0]}).setLngLat([at.lon,at.lat]).addTo(mini);
  }
  // FE-03: the inset map and its libraries start when the map, or Place and property (which lists the trees the map finds
  // nearby), come within a screen of view; the hero never waits for them. The page counts the map among the parts it
  // waits for (data-ready) only when the map starts before the other parts are in.
  function lazyMap(){
    const targets=[$('#miniMap'),$('#placeBody')].filter(Boolean);
    if(!targets.length||typeof IntersectionObserver==='undefined'){miniMap();return;}
    const io=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){io.disconnect();miniMap();}},{rootMargin:'100% 0px'});
    targets.forEach(t=>io.observe(t));
  }
  // The map libraries arrive on demand (map-libs.js: unpkg.com with SRI, then this site's vendor copies); when neither
  // arrives within 10 s the inset says so, in place of the map.
  async function miniMap(){
    if(document.body.dataset.ready!=='true')waiting.add('map');
    const pos=rec.identity.position,el=$('#miniMap');
    if(!pos){if(el)el.innerHTML='<p class="ti-def">None for this record: no position.</p>';done('map');return;}
    try{await mapFiles();if(!window.maplibregl||!window.pmtiles)await window.ALTOLibs.load();}
    catch{if(el)el.innerHTML=`<p class="ti-def" role="status">${esc(window.ALTOLibs?.MESSAGE||'Map library could not be loaded.')}</p>`;done('map');return;}
    // Versioned archives read through this device's tile cache (tile-cache.js, FE-05).
    const TC=window.ALTOTileCache,cached=TC?TC.protocol(pmtiles):null;if(TC)TC.version(VERSION);
    maplibregl.addProtocol('pmtiles',cached?cached.tile:new pmtiles.Protocol().tile);
    // The map's own source factory (map-sources.js, FE-16): the same basemaps and the same versioned archives as the map.
    const MS=window.ALTOMapSources.create({dataBase:DATA_BASE,version:VERSION}),ships=window.ALTORecordLinks.shipped(env.metadata),rep=rec.identity.crownRepresentative||rec.id;
    const style={version:8,sources:{
      // Credits: credits.js (the same words as the map). In Auckland, Esri's imagery is Auckland Council's.
      imagery:MS.raster.aerial({maxzoom:20}),
      base:MS.raster.lightBase(),
      pts:{type:'vector',url:MS.archive('trees_map_points'),attribution:CR.MAP?.data},
      crowns:{type:'vector',url:MS.archive('tree_crowns_pilot')},
      props:{type:'vector',url:MS.archive('properties')},
      'tp-year':{type:'geojson',data:{type:'FeatureCollection',features:[]}}},
      layers:[{id:'imagery',type:'raster',source:'imagery'},{id:'base',type:'raster',source:'base',layout:{visibility:'none'}},
        {id:'parcels',type:'line',source:'props','source-layer':'properties',minzoom:14,paint:{'line-color':tok('--neutral-0'),'line-width':.8,'line-opacity':.55}},
        {id:'crowns',type:'fill',source:'crowns','source-layer':'crowns',minzoom:12,filter:['!=',['get','tree_id'],rep],paint:{'fill-color':tok('--neutral-0'),'fill-opacity':.06}},
        {id:'crowns-line',type:'line',source:'crowns','source-layer':'crowns',minzoom:12,filter:['!=',['get','tree_id'],rep],paint:{'line-color':tok('--viz-overlay-context'),'line-width':1}},
        {id:'crown-this',type:'line',source:'crowns','source-layer':'crowns',filter:['==',['get','tree_id'],rep],paint:{'line-color':tok('--viz-overlay-focus'),'line-width':2.6}},
        {id:'tp-year-dim',type:'line',source:'tp-year',filter:['==',['get','current'],false],paint:{'line-color':tok('--neutral-0'),'line-width':2,'line-dasharray':[2,1.5]}},
        {id:'tp-year-cur',type:'line',source:'tp-year',filter:['==',['get','current'],true],paint:{'line-color':tok('--viz-overlay-focus'),'line-width':2.6}},
        // The schedule ring, as on the map: every tree linked to the Notable Trees schedule.
        {id:'pts',type:'circle',source:'pts','source-layer':'trees',minzoom:15,paint:{'circle-radius':['interpolate',['linear'],['zoom'],15,2,20,5],'circle-color':window.ALTOSources.colourExpr(),
          'circle-stroke-color':['case',window.ALTOSources.protectedExpr,tok('--color-protected'),tok('--neutral-0')],'circle-stroke-width':['case',window.ALTOSources.protectedExpr,2.5,1]}}]};
    mini=new maplibregl.Map({container:el,style,center:[pos.lon,pos.lat],zoom:18.5,maxZoom:21,attributionControl:false,cooperativeGestures:true});
    mini.getCanvas().setAttribute('aria-describedby','miniMapDesc');
    mini.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:CR.MAP?.page}),'bottom-right');
    mini.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    mini.addControl(new maplibregl.ScaleControl({unit:'metric',maxWidth:100}),'bottom-left');
    mini._recMarker=new maplibregl.Marker({color:tok('--viz-overlay-position'),scale:.55}).setLngLat([pos.lon,pos.lat]).setPopup(new maplibregl.Popup({offset:14}).setText(rec.identity.detection?'Detection point':'Recorded position of this record')).addTo(mini);
    mini._recMarker.getElement().setAttribute('aria-label',rec.identity.detection?'Detection point':'Recorded position of this record');
    new ResizeObserver(()=>mini?.resize()).observe(el);
    mini.on('load',()=>{mini.resize();el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      if(ships){try{mini.addSource('akl-council-positions',{type:'vector',url:MS.archive('council_positions')});for(const l of window.ALTORecordLinks.layers())mini.addLayer({...l,layout:{...(l.layout||{}),visibility:'visible'}},'pts');const k=$('#mapKeyLinks');if(k)k.hidden=false;}catch{}}
      miniLayers();});
    mini.on('click','pts',e=>{const p=e.features?.[0]?.properties||{},id=p.tree_id;if(id&&id!==rec.id&&id!==rep)location.href=window.ALTOTreeId.url(p.tn||id);});
    mini.on('mouseenter','pts',()=>mini.getCanvas().style.cursor='pointer');mini.on('mouseleave','pts',()=>mini.getCanvas().style.cursor='');
    let once=false;mini.on('idle',()=>{if(once)return;once=true;afterMap().finally(()=>done('map'));});
  }
  // The rendered tiles hold the crown outline, the trees around it and the property under it.
  const inside=(pt,ring)=>{let ok=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)ok=!ok;}return ok;};
  async function afterMap(){
    const pos=[rec.identity.position.lon,rec.identity.position.lat],rep=rec.identity.crownRepresentative||rec.id;
    const parts=mini.querySourceFeatures('crowns',{sourceLayer:'crowns',filter:['==',['get','tree_id'],rep]});
    if(parts.length){const polys=parts.flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates);geometry=polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys};
      const slot=$('#chipSlot');if(slot){slot.innerHTML=I.crownFigure(rec,geometry,{width:420,height:300});const k=$('#chipKey');if(k)k.innerHTML=I.figureKey(rec,{geometry:true});keepYear();onPart('imagery');}
      imageryTL?.redraw();
      // The dripline radius and the protected root zone are measured on the outline.
      addExtras();const m=$('#m-metrics');if(m){m.outerHTML=metricsMod();keepYear();}const rt=$('#m-roots');if(rt)rt.outerHTML=rootsMod();}
    // Every tree is on the point tiles at this zoom: the trees within NEAR metres, and the land type.
    const feats=mini.querySourceFeatures('pts',{sourceLayer:'trees'});
    const tileProps=feats.find(f=>f.properties.tree_id===rep||f.properties.tree_id===rec.id)?.properties||null;
    R.fromMap(rec,{points:feats,tileProps,radius:NEAR});
    const pl=$('#placeBody');if(pl)pl.innerHTML=placeBody();
    let pid=null;
    for(const f of mini.querySourceFeatures('props',{sourceLayer:'properties'})){const g=f.geometry;for(const poly of g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[]){if(inside(pos,poly[0])&&!poly.slice(1).some(h=>inside(pos,h))){pid=f.properties.pid;break;}}if(pid)break;}
    await R.parcel(rec,env,pid).catch(()=>null);
    if(pl)pl.innerHTML=placeBody();
    const hn=$('#heroNear');if(hn)hn.textContent=R.nearLine(rec)||'';
    refreshNotes();
    mapYear(linker?.get()||2024);
    keepPinned();
  }
  const scripts=new Map();
  // Added scripts run in the order they were added (async=false), as they would from the page's own tags.
  function script(src){if(!scripts.has(src))scripts.set(src,new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=ok;s.onerror=()=>fail(new Error('Could not load '+src));document.head.append(s);}));return scripts.get(src);}
  const asset=p=>window.ALTOVersion?.asset?window.ALTOVersion.asset(p):p;
  // FE-03: files the hero does not read arrive once it is drawn, in their old order: the place and KYTE readers, the
  // aerial-imagery reader with its larger view and stylesheet, and Species maxima (about 150 KB that held the first tree
  // lookup back on a slow phone). The map libraries follow when the inset nears the screen (mapFiles, miniMap).
  let laterFiles=null;
  function later(){
    if(!laterFiles){
      const css=document.createElement('link');css.rel='stylesheet';css.href=asset('./imagery-viewer.css');document.head.append(css);
      laterFiles=Promise.allSettled(['./property.js','./tree-ground.js','./tree-imagery.js','./tree-imagery-viewer.js','./species-maxima.js'].map(f=>script(asset(f))));
    }
    return laterFiles;
  }
  const mapFiles=()=>Promise.all(['./map-libs.js','./tile-cache.js','./map-sources.js'].map(f=>script(asset(f))));

  // ---------- start ----------
  const waiting=new Set(['parts']);
  function done(what){waiting.delete(what);if(!waiting.size){document.body.dataset.ready='true';keepPinned();}}
  function fail(title,text){
    $('#hero').innerHTML=`<div class="ti-id-main"><p class="ti-eyebrow">ALTO tree page</p><h1>${esc(title)}</h1><p class="ti-note">${esc(text)}</p><p><a class="btn btn-primary" href="./">${icon('map',16)}<span>Open the map</span></a></p></div>`;
    $('#hero').removeAttribute('aria-busy');document.title=`${title} · ALTO`;document.body.dataset.ready='true';
    footRelease();
  }
  // The footer names the release and the tool on a page without a tree, too.
  // A release whose metadata did not load reads "Release not loaded", never "Release date unknown".
  let metaFailed=false;
  function footRelease(){const V=window.ALTOVersion;if(V){const t=V.publicLabel(env?.metadata||null).text;$('#footVersion').textContent=metaFailed?t.replace(/^Release date unknown/,'Release not loaded'):t;}}

  // ---------- an ID that names no current tree ----------
  // Retired (a tombstone, or replaced by another tree), merged, split, unknown or mistyped: markup from
  // tree-instrument.js (statusView); here the correction of a mistyped number, the corrections the reason names and
  // the name of each tree that took its place (title and height, from its record).
  async function receiptItems(reason){
    const ids=String(reason||'').match(/C\d{5}/g),path=env.metadata?.derived_products?.corrections_applied;
    if(!ids||!path)return [];
    try{const j=await fetch(`${SITE_ROOT}/${String(path).replace(/^\.?\//,'')}?v=${encodeURIComponent(VERSION)}`).then(r=>r.ok?r.json():null);
      const list=j?.corrections||[];return ids.map(id=>list.find(x=>x.id===id)).filter(Boolean);}catch{return [];}
  }
  // A file that did not load (FE-02): which file and why, with Retry, which reads again in place (failed reads are never
  // cached); never "Tree not found" or "not in this release".
  function unavailablePage(raw,r){
    const v=I.statusView({...r,status:'unavailable'},{typed:raw,icon});
    $('#hero').innerHTML=v.html;
    $('#hero').removeAttribute('aria-busy');document.title=`${v.title} · ALTO`;document.body.dataset.ready='true';
    for(const b of ['#shareTree','#citeTree'])$(b).hidden=true;
    footRelease();
    $('#hero [data-retry]')?.addEventListener('click',()=>{
      $('#hero').setAttribute('aria-busy','true');
      $('#hero').innerHTML='<div class="ti-id-main"><p class="ti-eyebrow">ALTO tree page</p><h1 tabindex="-1">Loading…</h1></div>';
      $('#hero h1').focus({preventScroll:true});delete document.body.dataset.ready;
      main();
    },{once:true});
  }
  async function statusPage(raw,r){
    if(r.status==='unavailable')return unavailablePage(raw,r);
    const Id=window.ALTOTreeId,typed=String(raw??'').trim();
    const fix=r.status==='invalid'&&Id.isNumberShaped(typed)?await Id.suggestNumber(typed,{base:DATA_BASE,version:VERSION,metadata:env.metadata}).catch(()=>null):null;
    const receipt=['retired','merged','split'].includes(r.status)?await receiptItems(r.reason):[];
    const v=I.statusView(r,{typed,fix,receipt,icon});
    $('#hero').innerHTML=v.html;
    $('#hero').removeAttribute('aria-busy');document.title=`${v.title} · ALTO`;document.body.dataset.ready='true';
    for(const b of ['#shareTree','#citeTree'])$(b).hidden=true;
    footRelease();
    await Promise.all([...document.querySelectorAll('[data-succ]')].slice(0,8).map(async el=>{
      try{const x=await R.load(el.dataset.succ,env,{members:0});const h=x.measures?.height;
        el.innerHTML=[treeTitle(x.identity),h?esc(I.text(h)):null].filter(Boolean).join(' · ');}catch{el.textContent='';}
    }));
  }

  async function main(){
    const params=new URL(location.href).searchParams,raw=params.get('id')||params.get('tree');
    // The release metadata: found, absent (404: the page reads the data without it) or unavailable (said, with Retry).
    let metadata=null,metadataError=null;
    try{const url=`${SITE_ROOT}/release-metadata.json`,r=await (window.ALTO_PREFETCH?.take?.(url)||fetch(url,{credentials:'same-origin'}));  // FE-03: started in <head>
      if(r.ok){try{metadata=await r.json();}catch{metadataError={file:'release-metadata.json',reason:'could not be read'};}}
      else if(r.status!==404)metadataError={file:'release-metadata.json',reason:`HTTP ${r.status}`};}
    catch{metadataError={file:'release-metadata.json',reason:'network error'};}
    metaFailed=!!metadataError;
    if(!VERSION&&!metadataError)VERSION=metadata?.assembly?.tile_version||metadata?.release?.dataset_version||`session-${Date.now()}`;
    env={dataBase:DATA_BASE,siteRoot:SITE_ROOT,metadata,version:VERSION};
    if(window.ALTO_CHANNEL==='beta'&&document.body.dataset.channel!=='beta'){document.body.dataset.channel='beta';$('.tpg-brand')?.insertAdjacentHTML('afterend','<span class="beta-pill">Beta</span>');}
    if(!raw)return fail('No tree number','Open a tree from the map, or add ?id= and a tree number to this address.');
    const Id=window.ALTOTreeId,resolved=await Id.resolve(raw,{base:DATA_BASE,version:VERSION,metadata,metadataError});
    if(!resolved.tree_id||['retired','merged','split'].includes(resolved.status))return statusPage(raw,resolved);
    try{rec=await R.load(raw,env,{resolved,later:true});}
    catch(err){
      if(err.code==='invalid'||err.code==='not_found')return fail(err.code==='invalid'?'Not a tree number or record ID':'Tree not found',err.message||'');
      return unavailablePage(raw,{...(err.resolved||{}),input:raw,note:err.code==='unavailable'?err.message:`Not loaded: the tree’s record (${err.message||'error'}).`,file:err.file||null,reason:err.reason||null});
    }
    window.ALTOTreeRecordCurrent=rec;
    // Page internals for checks, only with ?debug.
    if(params.has('debug'))window.ALTOTreePageDebug={get mini(){return mini;},get geometry(){return geometry;},get env(){return env;}};
    // The address names the tree by its number (release 6.1 on); an older ID gets one line saying which tree it is.
    const q=rec.request,typed=String(raw).trim();
    if(rec.number?typed!==rec.number:q&&(Id.normalise(raw)!==q.canonical||q.status!=='current'))history.replaceState(null,'',Id.url(rec.number||q.canonical)+(location.hash||''));
    const said=Id.describe(resolved)?.note;
    if(said)showAlert(said,{keep:true});
    if(rec.permalink){const l=document.createElement('link');l.rel='canonical';l.href=rec.permalink;document.head.append(l);}
    // The tab names the tree and its number ("Pōhutukawa TZ69KK1G · ALTO", "Kauri (Agathis australis) TNQM3W9M · ALTO").
    const t=I.title(rec.identity);
    document.title=`${t.text}${t.latin?` (${t.latin})`:''}${rec.number?` ${rec.number}`:''} · ALTO`;
    $('#footVersion').textContent=I.versionLine(rec);
    render();
    // FE-03: Species maxima and the notable-tree facts (about 170 KB) load after the hero, so they never hold up the tree;
    // showMaxima adds the maximum line, Recognition and the schedule line's facts when they arrive.
    // The page is ready (data-ready) once they have arrived or failed, so the schedule line read then is the facts' one.
    waiting.add('facts');
    // Only this tree's facts are read where the package splits them by tree number (release 6.3's file is 1.4 MB).
    later().then(()=>window.ALTOMaxima?window.ALTOMaxima.load(env,{facts:true,trees:[rec.number].filter(Boolean)}).then(D=>{if(D){window.ALTOMaxima.current=D;showMaxima();}}):null).catch(()=>{}).finally(()=>done('facts'));
    if(pinned)goTo(pinned);
    lazyMap();
    // FE-03: the crown's other records arrive after the hero; the record list fills in then, and the comparisons (which
    // read the crown's representative record) follow them. The public page reads no per-tree LiDAR point crops (the
    // returns viewer is a workbench tool).
    const crown=rec.membersPending?R.loadMembers(rec).catch(()=>{rec.membersPending=false;}).then(()=>swapMod('records',records())):Promise.resolve();
    // The imagery, place and KYTE parts read files that arrive after the hero (later()); so does the comparisons' board.
    const early=Promise.all([R.enrich(rec,env,{parts:['history','corrections'],onPart}),later().then(()=>R.enrich(rec,env,{parts:['imagery','place','photos','inat','streetview'],onPart}))]);
    const context=Promise.all([crown,later()]).then(()=>R.enrich(rec,env,{parts:['context'],onPart}));
    Promise.allSettled([early,context]).finally(()=>done('parts'));
    (window.requestIdleCallback||setTimeout)(()=>script(window.ALTOVersion?.asset?window.ALTOVersion.asset('./tree-future.js'):'./tree-future.js').then(()=>R.enrich(rec,env,{parts:['scenario'],onPart})).catch(()=>{}));
    setTimeout(()=>{if(document.body.dataset.ready!=='true')document.body.dataset.ready='true';},20000);
  }
  main();
})();
