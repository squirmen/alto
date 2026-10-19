/* Species maxima and the tree page's Recognition block (tool 0.2.8).
 *
 * Reads two derived products of the data release, listed in derived/<dataset_version>/manifest.json:
 *   species_maxima  maxima.json        (alto-species-maxima/1): the largest measured tree of each species by height,
 *                                      crown spread and crown area, Auckland-wide and per local board (2024 LiDAR);
 *   notable_facts   notable_facts.json (alto-notable-facts/1): Council's Notable Trees schedule entries and group areas,
 *                                      and New Zealand Tree Register identities, for the trees ALTO links them to.
 * Every sentence pattern comes from the files' own "copy", so a wording change is a data edit.
 *
 * Rules (13 Oct 2026):
 *  - The badge ("Maximum · …") marks clear leads only (within_margin false). One line per tree: Auckland-wide before
 *    local board; several measures joined with "and", each with its own margin.
 *  - Near-ties (within_margin true) appear on the list page only, marked "within the margin of the next measured
 *    tree". They get no badge, no ring on the map and no Recognition row.
 *  - Kauri maxima are held: never shown, whatever a file says.
 *  - Recognition: facts only, each source credited and linked, and one row saying why ALTO shows the tree. NZ Tree
 *    Register: identifier and link only. Held Council entries (held_schedule) are never shown, and Council's
 *    DocumentURL (one plan-modification link that now ends in a 404) is never used.
 *  - KYTE girth missions (trees[...].kyte_girth) link only when ALTO_KYTE_CONFIG.girthTask is true (kyte-config.js).
 * The functions are pure (prepared data in, text or HTML out), so the map, the panel, the tree page and maxima.html
 * share them. */
(function(root){
  'use strict';
  const MEASURES=['max_height','max_crown_spread','max_crown_area'];
  // Short keys for addresses (maxima.html?measure=height).
  const MEASURE_KEYS={height:'max_height',spread:'max_crown_spread',area:'max_crown_area'};
  const MEASURE_NAMES={max_height:'Height',max_crown_spread:'Crown spread',max_crown_area:'Crown area'};
  // The measure words of a Maximum line (tool 0.2.9): crown spread is "widest crown spread", never "widest crown".
  const MEASURE_WORDS={max_height:'tallest',max_crown_spread:'widest crown spread',max_crown_area:'largest crown area'};
  // Who is ranked: trees whose species is named in Council records and whose 2024 crown passed ALTO's checks.
  const POPULATION='named in Council records with a checked 2024 crown';
  // Crown areas at or near the 400 m² segmentation limit (pipeline/v5/core.py merge_max_area_m2).
  const NEAR_CAP_M2=360,NEAR_CAP_TEXT='at or near the 400 m² segmentation limit; the tree may be larger';
  const MERGE_CAP_TEXT='Crowns are not merged beyond 400 m²; a larger tree can be split into several crowns.';
  const HEIGHT_MARGIN_NOTE='ranking margin (method and crown-edge differences); survey vertical accuracy ±0.2 m';
  // One wording for each crown measure, as the tree page (tree-record.js), the map legend (palette.js), Species maxima's
  // "How these are measured" and the methods (How ALTO is made, Table 2) give it (TS-18, TS-19).
  const DEFINITIONS={
    height:'Highest point of the 2024 LiDAR canopy height model within the crown',
    crownSpread:'Mean of the widest width and the width at right angles, from the 0.5 m crown cells',
    crownDiameter:'Diameter of the circle with the crown’s area (equal-area circle)'
  };
  const AUCKLAND='Auckland';
  const KAURI=/^Agathis(\s|$)/i;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=(v,d=1)=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:d}).format(v);
  const fill=(pattern,vals)=>String(pattern||'').replace(/\{(\w+)\}/g,(m,k)=>k in vals?vals[k]:m);
  // The files' sentences in the site's typography: ’ for an apostrophe, “ ” around a quoted name.
  const typo=t=>String(t??'').replace(/(\w)'(\w)/g,'$1’$2').replace(/"([^"]*)"/g,'“$1”');
  const cap=s=>String(s||'').replace(/^./,c=>c.toUpperCase());
  const joinAnd=list=>list.length<2?list.join(''):`${list.slice(0,-1).join(', ')} and ${list[list.length-1]}`;
  const ext=(href,text)=>`<a href="${esc(href)}" target="_blank" rel="noopener">${text} ↗</a>`;
  const fold=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  const dateText=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));return m?new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):null;};
  const digits=unit=>unit==='m²'?0:1;
  // A number and its unit never part at a line end.
  const value=(v,unit)=>`${nf(v,digits(unit))}\u00a0${unit}`;
  const margin=m=>`±${nf(m.margin,digits(m.unit))}\u00a0${m.unit}`;

  // A maximum that must never be shown: kauri (held until Council advises), or one a file marks as held.
  const held=m=>!m||KAURI.test(m.species||'')||!!m.hold_reason||m.held===true||m.publishable===false;

  // ---------- data ----------
  function prepare(maxima,facts=null){
    const M=maxima&&Array.isArray(maxima.maxima)?maxima:null;
    const list=M?M.maxima.filter(m=>m&&m.tree&&MEASURES.includes(m.measure)&&!held(m)).map(m=>({...m,within_margin:m.within_margin!==false})):[];
    const byTree=new Map();
    for(const m of list){if(!byTree.has(m.tree))byTree.set(m.tree,[]);byTree.get(m.tree).push(m);}
    const F=facts&&facts.trees?facts:null;
    return {schema:M?.schema||null,release:M?.release||null,dataset:M?.dataset||null,built:M?.built||null,
      label:M?.label||'Maximum',title:M?.list_title||'Species maxima',copy:M?.copy||{},measures:M?.measures||{},
      species:M?.species||{},areas:M?.areas||{},trees:M?.trees||{},sources:M?.sources||[],maxima:list,byTree,
      facts:F?{schema:F.schema||null,release:F.release||null,links:F.links||{},credits:F.credits||{},copy:F.copy||{},trees:F.trees,shardsRead:F.shardsRead||null}:null};
  }
  const has=(D,tree)=>!!(D&&tree&&D.byTree.has(tree));
  // A hybrid's Latin name with the multiplication sign (Platanus × acerifolia); the files write "x".
  const latin=sp=>String(sp||'').replace(/\s+x\s+/,' × ');
  const SN=()=>root.ALTOSpeciesNames||null;
  // The species as the files name it, in the site's display form (species-names.js; lower case inside a sentence), the
  // Latin name following in italics when two ranked species share the name.
  function speciesName(D,sp,{html=false,lower=true,plural=false}={}){
    const s=D?.species?.[sp]||{},N=SN();
    let name=N?N.display(s.name||sp,{lower}):(s.name||sp);
    if(plural)name=pluralName(name);
    const named=html&&N&&N.isMaori(s.name||sp)?`<span lang="mi">${esc(name)}</span>`:html?esc(name):name;
    if(!s.latin_needed)return named;
    return html?`${named} ${N?N.latinHtml(sp):`<i>${esc(latin(sp))}</i>`}`:`${name} (${latin(sp)})`;
  }
  // "Norfolk Island pine" -> "Norfolk Island pines", "cedar of Lebanon" -> "cedars of Lebanon"; te reo Māori names
  // take no plural s (tītoki, pōhutukawa).
  function pluralName(name){
    const N=SN(),t=String(name||'');
    if(N&&N.isMaori(t))return t;
    const of=t.match(/^(.*?)( of .*)$/);if(of)return pluralName(of[1])+of[2];
    const ws=t.split(' '),w=ws.pop();
    const p=/[^aeiou]y$/i.test(w)?w.replace(/y$/i,'ies'):/(s|x|z|ch|sh)$/i.test(w)?w+'es':w+'s';
    return [...ws,p].join(' ');
  }
  const partial=(D,area)=>Number(D?.areas?.[area]?.coverage??1)<1;
  // Auckland first, then the local boards alphabetically.
  function areaList(D){
    const boards=Object.keys(D?.areas||{}).filter(a=>a!==AUCKLAND).sort((a,b)=>fold(a).localeCompare(fold(b),'en-NZ'));
    return Object.prototype.hasOwnProperty.call(D?.areas||{},AUCKLAND)?[AUCKLAND,...boards]:boards;
  }
  const byMeasure=(a,b)=>MEASURES.indexOf(a.measure)-MEASURES.indexOf(b.measure);
  const byArea=(a,b)=>(a.area===AUCKLAND?-1:b.area===AUCKLAND?1:fold(a.area).localeCompare(fold(b.area),'en-NZ'));

  // ---------- badge ----------
  // A tree's clear leads (no near-ties), widest area first.
  function clearLeads(D,tree){return (D?.byTree.get(tree)||[]).filter(m=>m.within_margin===false).sort((a,b)=>byArea(a,b)||byMeasure(a,b));}
  // The maxima the badge names: Auckland-wide when the tree holds any, otherwise its local board's.
  function badgeMaxima(D,tree){
    const clear=clearLeads(D,tree);if(!clear.length)return [];
    const area=clear.some(m=>m.area===AUCKLAND)?AUCKLAND:clear[0].area;
    return clear.filter(m=>m.area===area).sort(byMeasure);
  }
  // One line naming the ranked population and its count (tool 0.2.9): "Maximum · tallest of 83 Norfolk Island pines named
  // in Council records with a checked 2024 crown (2024 LiDAR, ±2 m)"; a local board's adds "in <board>"; several measures
  // "Maximum · tallest (±2 m), widest crown spread (±1 m) and largest crown area (±23 m²) of 61 tītoki named in Council
  // records with a checked 2024 crown in Ōrākei (2024 LiDAR)". A crown area at or near the 400 m² limit says so.
  // lead is the line up to the population (kept when the panel has no room), rest the area and margins.
  // At or near the 400 m² segmentation limit: the release's own flag (segmentation_cap, from release 6.3: crown-area and
  // crown-spread values of crowns of 360 m² or more), else a crown area of 360 m² or more.
  const capped=m=>!!m&&(m.segmentation_cap===true||(m.measure==='max_crown_area'&&Number(m.value)>=NEAR_CAP_M2));
  const capText=D=>D?.copy?.segmentation_cap||NEAR_CAP_TEXT;
  // flagged: the page's tree carries a flag release 6.3 leaves out of rankings (a height or record-to-crown check, a
  // Schedule 10 entry listing more trees than ALTO maps there): never badged, whatever a maxima file lists.
  function badge(D,tree,{flagged=false}={}){
    if(flagged)return null;
    const set=badgeMaxima(D,tree);if(!set.length)return null;
    const area=set[0].area,sp=set[0].species,n=Math.max(...set.map(m=>Number(m.n)||0)),cut='\u0000';
    const label=D.label||'Maximum';
    const where=area===AUCKLAND?'':` in ${partial(D,area)?'the surveyed part of ':''}${area}`;
    const cap=set.some(capped)?`; crown ${set.some(m=>m.measure==='max_crown_area'&&capped(m))?'area ':''}${capText(D)}`:'';
    const words=set.length===1?MEASURE_WORDS[set[0].measure]:joinAnd(set.map(m=>`${MEASURE_WORDS[m.measure]} (${margin(m)})`));
    const tail=set.length===1?` ${POPULATION}${where} (2024 LiDAR, ${margin(set[0])})${cap}`:` ${POPULATION}${where} (2024 LiDAR)${cap}`;
    const line=`${label} · ${words} of ${nf(n,0)} ${cut}${tail}`;
    const [head,rest]=line.split(cut);
    const text=head+speciesName(D,sp,{plural:true})+rest,html=esc(head)+speciesName(D,sp,{html:true,plural:true})+esc(rest);
    return {tree,area,species:sp,n,maxima:set,text,html,lead:head+speciesName(D,sp,{plural:true}),leadHtml:esc(head)+speciesName(D,sp,{html:true,plural:true}),rest,restHtml:esc(rest)};
  }
  // The chip: the line in a 1 px outline (no icon, no fill colour), a link to the list page's scope note. {panel:true}:
  // the map panel's copy, at most two lines there (tree-instrument.css), with the full line in the tooltip.
  function badgeHtml(D,tree,{panel=false,id=null,base='.',flagged=false}={}){
    const b=badge(D,tree,{flagged});if(!b)return '';
    const idAttr=id?` id="${esc(id)}"`:'',href=`${String(base||'.').replace(/\/+$/,'')}/maxima.html#scope`;
    const tip=`${b.text}. Scope: ${b.n} trees ranked; trees without a named species are not ranked; larger trees may stand elsewhere; not field-verified.${b.maxima.some(m=>m.measure==='max_height')?` ±2 m: ${HEIGHT_MARGIN_NOTE}.`:''}`;
    if(panel)return `<p class="ti-max tp-max"${idAttr}><a class="max-chip" href="${esc(href)}" title="${esc(tip)}">${b.html}</a></p>`;
    return `<p class="ti-max"${idAttr}><a class="max-chip" href="${esc(href)}" title="${esc(tip)}">${b.html}</a></p>`;
  }

  // ---------- links ----------
  function listHref(base,{measure=null,area=null,species=null}={}){
    const q=new URLSearchParams();
    const key=Object.keys(MEASURE_KEYS).find(k=>MEASURE_KEYS[k]===measure);
    if(key&&key!=='height')q.set('measure',key);
    if(area&&area!==AUCKLAND)q.set('area',area);
    if(species)q.set('species',species);
    const s=q.toString();
    return `${String(base||'.').replace(/\/+$/,'')}/maxima.html${s?`?${s}`:''}`;
  }
  // "Measure its girth (KYTE)": street and park maxima, never kauri; only when the KYTE release that reads task=girth is
  // live (ALTO_KYTE_CONFIG.girthTask, kyte-config.js; off by default).
  function girthHref(D,tree,{kyteBase='./kyte',config=root.ALTO_KYTE_CONFIG}={}){
    if(!config||config.girthTask!==true||!has(D,tree))return null;
    const t=D.trees?.[tree];
    if(!t||t.kyte_girth!==true||(D.byTree.get(tree)||[]).some(m=>KAURI.test(m.species||'')))return null;
    return `${String(kyteBase).replace(/\/+$/,'')}/?tree=${encodeURIComponent(tree)}&task=girth`;
  }

  // ---------- Recognition (tree page) ----------
  // Rows: {key, label, html, lines[], links[{text, href}], credit}. Council's schedule entries and group areas; the
  // New Zealand Tree Register entry (identifier and link only); ALTO's clear-lead maxima; why ALTO shows the tree.
  // crownLink: how ALTO joined the record to its crown, in words ("recorded position inside the crown"), for the Council
  // row's second line. Held Council entries (held_schedule) are never shown, as a tree entry or as a group.
  function recognition(D,tree,{base='.',crownLink='recorded position inside the crown',flagged=false}={}){
    if(!D||!tree)return null;
    const F=D.facts,f=F?.trees?.[tree]||null,L=F?.links||{},C=F?.copy||{},CR=F?.credits||{},rows=[];
    const held=new Set((f?.held_schedule||[]).map(String));
    const credits=root.ALTOCredits||null;
    const council=CR.council_schedule_10||{},asAt=dateText(council.as_at),checked=dateText(council.checked);
    const dated=[asAt?`as at ${asAt}`:null,checked?`checked ${checked}`:null].filter(Boolean).join('; ');
    const councilCredit=key=>{
      const d=credits?.dataset?.(key);
      const name=key==='notable_group'?'Notable Group of Trees Overlay':'Notable Trees Overlay';
      return `${esc(d?.text||`${name}, ${council.by||'Auckland Council'}; ${council.licence||'CC BY 4.0'}`)}${dated?`; ${esc(dated)}`:''}`;
    };
    const pdf=L.schedule_10_pdf?{text:'Schedule 10 (PDF)',href:L.schedule_10_pdf}:null;
    for(const e of f?.schedule||[]){
      if(!e||!e.schedule||held.has(String(e.schedule)))continue;
      const href=e.gid&&L.council_entry_by_gid?fill(L.council_entry_by_gid,{gid:encodeURIComponent(e.gid)}):L.council_entry_by_schedule?fill(L.council_entry_by_schedule,{schedule:encodeURIComponent(e.schedule)}):null;
      // Two facts apart: Council's position of its overlay point (its own field), and ALTO's link from the record to a crown.
      const pos=e.position==='verified'?'verified position':e.position==='unverified'?'position not verified':null;
      // Release 6.3: the entry as the July 2026 schedule lists it (trees listed, address), and whether ALTO maps its Council
      // points on fewer crowns than it lists trees.
      const listed=Number(e.trees)>1?`The schedule lists ${nf(Number(e.trees),0)} trees for item ${e.schedule}${e.address?`, ${e.address}${e.locality?`, ${e.locality}`:''}`:''}${e.collapsed?'; its Council points lie on this crown, where ALTO maps one crown':''}.`:null;
      rows.push({key:'council_schedule',label:'Council schedule',html:esc(typo(fill(C.council_schedule_10,{schedule:e.schedule,name:e.name}))),
        lines:[listed,pos?`Council’s overlay point: ${pos} (Council field). Crown link: ALTO’s (${crownLink}).`:`Crown link: ALTO’s (${crownLink}).`].filter(Boolean),
        links:[href?{text:'Council entry',href}:null,pdf].filter(Boolean),credit:councilCredit('notable_trees_overlay')});
    }
    for(const g of f?.group||[]){
      if(!g||!g.schedule||held.has(String(g.schedule)))continue;
      const href=L.council_group_by_schedule?fill(L.council_group_by_schedule,{schedule:encodeURIComponent(g.schedule)}):null;
      rows.push({key:'council_group',label:'Council group',html:esc(typo(fill(C.council_group,{schedule:g.schedule,name:g.name}))),lines:[],
        links:[href?{text:'Council group entry',href}:null,pdf].filter(Boolean),credit:councilCredit('notable_group')});
    }
    // Release 6.3: the map marker lies inside a Notable Group of Trees area (group_area), in the release's words with its
    // caveat; never a schedule entry, a group row or a reason ALTO highlights the tree.
    for(const g of f?.group_area||[]){
      if(!g||!g.schedule||held.has(String(g.schedule))||(f?.group||[]).some(x=>String(x?.schedule)===String(g.schedule)))continue;
      const href=L.council_group_by_schedule?fill(L.council_group_by_schedule,{schedule:encodeURIComponent(g.schedule)}):null;
      rows.push({key:'group_area',label:'Group area',html:esc(typo(fill(C.group_area||'Inside a Notable Group of Trees area: Schedule 10 item {schedule}, "{name}". Whether this tree is one of the scheduled trees has not been established.',{schedule:g.schedule,name:g.name}))),
        lines:[],links:[href?{text:'Council group entry',href}:null,pdf].filter(Boolean),credit:councilCredit('notable_group')});
    }
    const nz=(f?.nztr||[]).filter(z=>z&&z.id&&z.url&&(z.status==='accepted'||z.status==='former_site'));
    const NZTR=CR.nz_tree_register||{},register=NZTR.url||credits?.URLS?.nzTreeRegister||'https://www.treeregister.nz/';
    const nzCredit=`${esc(NZTR.name||'New Zealand Tree Register')}, ${esc(NZTR.by||'New Zealand Notable Trees Trust')}`;
    for(const z of nz){
      const id=`<a href="${esc(z.url)}" target="_blank" rel="noopener">${esc(z.id)} ↗</a>`;
      const sentence=typo(fill(z.status==='former_site'?C.nz_former_site:C.nz_tree_register,{id:'\u0000'})).split('\u0000').map(esc).join(id);
      rows.push({key:'nz_tree_register',label:'NZ Tree Register',html:sentence,lines:[z.reviewed?`Link reviewed ${dateText(z.reviewed)}`:null].filter(Boolean),
        links:[],credit:`${nzCredit} · ${ext(register,'treeregister.nz')}`});
    }
    // ALTO's maxima: one row per measure, its areas together ("in Auckland and in Albert-Eden"), the widest area's figures,
    // and who was ranked.
    // A tree release 6.3 flags (height or record check, a multi-tree Schedule 10 entry) holds no maximum on its page.
    const clear=flagged?[]:clearLeads(D,tree),measures=[...new Set(clear.map(m=>m.measure))].sort((a,b)=>MEASURES.indexOf(a)-MEASURES.indexOf(b));
    for(const key of measures){
      const set=clear.filter(m=>m.measure===key).sort(byArea),m=set[0];
      const areas=set.map(m=>partial(D,m.area)?`the surveyed part of ${m.area}`:m.area);
      const html=`${esc(cap(MEASURE_WORDS[key]||key))} of ${nf(m.n,0)} ${speciesName(D,m.species,{html:true,plural:true})} ${POPULATION}, in ${esc(areas.join(' and in '))}`;
      const marg=key==='max_height'?`${margin(m)} ${HEIGHT_MARGIN_NOTE}`:`${margin(m)} ranking margin`;
      const line=`${value(m.value,m.unit)} (2024 LiDAR) · ${marg}${capped(m)?` · ${capText(D)}`:''}${m.next!=null?` · next ${value(m.next,m.unit)}`:''}`;
      rows.push({key:'maximum',label:'Species maximum',html,lines:[line],links:[{text:'Species maxima',href:listHref(base,{measure:key,area:m.area}),internal:true}],
        credit:credits?.MAP?.lidar2024?`${credits.MAP.lidar2024}; species from Auckland Council records`:'ALTO, from the Auckland 2024 LiDAR survey; species from Auckland Council records'});
    }
    if(!rows.length)return null;
    // Rows of one kind share a credit: it is given once, under the last of them.
    for(let i=0;i<rows.length-1;i++)if(rows[i].credit&&rows[i].key===rows[i+1].key&&rows[i].credit===rows[i+1].credit)rows[i].credit=null;
    // Why ALTO shows it: the sources that list it (only those with a row shown), then ALTO's own maxima.
    const sources=[];
    if(rows.some(r=>r.key==='council_schedule'||r.key==='council_group'))sources.push(L.schedule_10_pdf?`Council’s <a href="${esc(L.schedule_10_pdf)}" target="_blank" rel="noopener">Notable Trees schedule</a>`:'Council’s Notable Trees schedule');
    const nzListed=nz.some(z=>z.status==='accepted');
    if(nzListed)sources.push(`the <a href="${esc(register)}" target="_blank" rel="noopener">New Zealand Tree Register</a>`);
    const said=[];
    if(sources.length){
      const s=typo(fill(C.flagged||'ALTO highlights this tree because {sources} list it.',{sources:'\u0000'})).split('\u0000');
      said.push(esc(s[0])+joinAnd(sources)+esc(sources.length===1?s[1].replace(/\blist it\b/,'lists it'):s[1]));
    }else if(nz.length)said.push(`ALTO shows this tree because the <a href="${esc(register)}" target="_blank" rel="noopener">New Zealand Tree Register</a> records a former registered tree at its site.`);
    if(clear.length)said.push(sources.length||nz.length?'It also holds a species maximum in ALTO’s measurements from the 2024 LiDAR survey.':'ALTO highlights this tree because it holds a species maximum in ALTO’s measurements from the 2024 LiDAR survey.');
    if(said.length)rows.push({key:'why',label:'Why ALTO shows this',html:said.join(' '),lines:[],links:[],credit:null});
    return {tree,rows};
  }
  function recognitionHtml(D,tree,{base='.',id='m-recognition',crownLink,flagged=false}={}){
    const R=recognition(D,tree,{base,flagged,...(crownLink?{crownLink}:{})});if(!R)return '';
    const link=l=>l.internal?`<a href="${esc(l.href)}">${esc(l.text)}</a>`:ext(l.href,esc(l.text));
    const row=r=>`<div class="ti-kv" data-recognition="${esc(r.key)}"><dt>${esc(r.label)}</dt><dd><span class="ti-rc-say">${r.html}</span>`+
      r.lines.map(t=>`<small>${esc(t)}</small>`).join('')+(r.links.length?`<small class="ti-rc-links">${r.links.map(link).join(' · ')}</small>`:'')+
      (r.credit?`<small class="ti-rc-credit">${r.credit}</small>`:'')+'</dd></div>';
    return `<section class="ti-mod ti-mod-wide ti-recog" id="${esc(id)}" aria-labelledby="h-recognition"><header class="ti-mod-head"><h2 id="h-recognition">Recognition</h2><p>Each source credited and linked</p></header><dl class="ti-kvs">${R.rows.map(row).join('')}</dl></section>`;
  }

  // ---------- list page and map ----------
  // The list page's rank cell (tool 0.2.9): a clear lead is "1 of N"; a near-tie never reads as first, it says how close
  // the next measured tree is: "near-tie: within ±2 m of the next measured tree (21.9 m)". row: a listRows() row.
  function rankText(row){
    if(!row)return '';
    if(!row.within)return `1 of ${nf(Number(row.n)||0,0)}`;
    const next=row.next!=null&&Number.isFinite(Number(row.next))?` (${value(Number(row.next),row.unit)})`:'';
    return `near-tie: within ${margin(row)} of the next measured tree${next}`;
  }
  // The scope note above the list (maxima.html#scope, where every Maximum line links): who is ranked, from the file's
  // copy, then what the ranking cannot say.
  const SCOPE_LIMITS='Trees without a named species are not ranked; larger trees may stand elsewhere; not field-verified.';
  function scopeNote(D){
    const first=typo(String(D?.copy?.scope_note||'').split(/(?<=\.)\s+/)[0]||'').trim();
    return `${first||`Ranks trees ${POPULATION}.`} ${SCOPE_LIMITS}`;
  }
  function areaMaxima(D,{measure=null,area=AUCKLAND}={}){return (D?.maxima||[]).filter(m=>(!measure||m.measure===measure)&&m.area===area);}
  // Rows for maxima.html: one per species for the measure and area; q matches common or Latin names (accents ignored).
  const SORTS={species:r=>fold(r.name),value:r=>r.value,tree:r=>r.tree,board:r=>fold(r.board||''),n:r=>r.n};
  function listRows(D,{measure='max_height',area=AUCKLAND,q='',sort='value',dir=null}={}){
    const want=fold(q).trim();
    const rows=areaMaxima(D,{measure,area}).map(m=>{
      const s=D.species?.[m.species]||{},t=D.trees?.[m.tree]||{};
      return {measure:m.measure,area:m.area,species:m.species,name:SN()?SN().display(s.name||m.species):(s.name||m.species),latinNeeded:!!s.latin_needed,
        recordedAs:Array.isArray(s.recorded_as)&&s.recorded_as.length?s.recorded_as:null,tree:m.tree,value:m.value,margin:m.margin,unit:m.unit,
        nearCap:capped(m),
        n:m.n,next:m.next??null,within:m.within_margin!==false,board:t.board||null,lon:t.lon??null,lat:t.lat??null,h:t.h??null,outline:Array.isArray(t.outline)?t.outline:null};
    }).filter(r=>!want||fold(r.name).includes(want)||fold(r.species).includes(want));
    const key=SORTS[sort]?sort:'value',d=dir||(key==='value'||key==='n'?'desc':'asc'),k=SORTS[key],sign=d==='desc'?-1:1;
    rows.sort((a,b)=>{const x=k(a),y=k(b);return (x<y?-1:x>y?1:0)*sign||fold(a.name).localeCompare(fold(b.name),'en-NZ');});
    return rows;
  }
  // The trees the map rings for an area: clear leads only, with their bounds.
  function mapSet(D,area=AUCKLAND){
    const trees=[...new Set(areaMaxima(D,{area}).filter(m=>m.within_margin===false).map(m=>m.tree))].sort();
    const pts=trees.map(t=>D.trees?.[t]).filter(t=>t&&Number.isFinite(t.lon)&&Number.isFinite(t.lat));
    const bounds=pts.length?[[Math.min(...pts.map(p=>p.lon)),Math.min(...pts.map(p=>p.lat))],[Math.max(...pts.map(p=>p.lon)),Math.max(...pts.map(p=>p.lat))]]:null;
    return {area,trees,bounds};
  }
  // The tree's own crown outline (metres east and north of its centre) as a small SVG, at a scale shared by the page:
  // span metres across the box.
  function outlineSvg(outline,{size=44,span=40,label=''}={}){
    if(!Array.isArray(outline)||outline.length<3)return '';
    const k=size/span,c=size/2;
    const pts=outline.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])).map(([x,y])=>`${(c+x*k).toFixed(1)},${(c-y*k).toFixed(1)}`).join(' ');
    return `<svg class="mx-crown" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)}"><polygon points="${pts}"/></svg>`;
  }
  // The widest crown on the page, rounded up to 10 m: one scale for every thumbnail.
  function sharedSpan(D){
    let r=0;for(const t of Object.values(D?.trees||{}))for(const p of t.outline||[])if(Array.isArray(p))r=Math.max(r,Math.abs(p[0]),Math.abs(p[1]));
    return Math.max(10,Math.ceil(2*r/10)*10);
  }

  // ---------- loading ----------
  // The products come from the release metadata's derived_products (paths from the site root) or the manifest of this
  // tool's derived folder for the live release (<derivedBase>/manifest.json); a release without them shows nothing.
  const cache=new Map();
  // Found, absent or unavailable (FE-02): a 404 is absent (null); a network error, any other HTTP error or a file that
  // cannot be read is unavailable, and the promise rejects with {unavailable, file, reason} ("Not loaded: <file>
  // (<reason>).", never "not published"). A failed read is not kept, so Retry reads the file again.
  const fileOf=url=>String(url).replace(/\?.*$/,'').replace(/^.*?\/(derived|data)\//,'$1/').replace(/^\.\//,'');
  function unavailable(url,reason){return Object.assign(new Error(`Not loaded: ${fileOf(url)} (${reason}).`),{unavailable:true,file:fileOf(url),reason});}
  async function fetchJSON(url,init){
    const fx=root.fetch;if(!fx)throw unavailable(url,'no network access');
    let r;try{r=await fx(url,init);}catch{throw unavailable(url,'network error');}
    if(r.status===404)return null;
    if(!r.ok)throw unavailable(url,`HTTP ${r.status}`);
    try{return await r.json();}catch{throw unavailable(url,'could not be read');}
  }
  function getJSON(url){
    if(!cache.has(url))cache.set(url,fetchJSON(url).catch(e=>{cache.delete(url);throw e;}));
    return cache.get(url);
  }
  const pathOf=x=>String(typeof x==='string'?x:x?.path||'').replace(/^\.?\//,'');
  function derivedBase(env={}){
    const siteRoot=String(env.siteRoot??root.ALTO_SITE_ROOT??'.').replace(/\/+$/,'')||'.';
    const dv=env.metadata?.release?.dataset_version||'unknown';
    return String(env.derivedBase??root.ALTO_DERIVED_BASE??`${siteRoot}/derived/{release}`).replace('{release}',encodeURIComponent(dv)).replace(/\/+$/,'');
  }
  // Notable facts by tree number (tool 0.2.12): release 6.3's notable_facts.json is 1.4 MB (group areas), so the tool
  // package also carries it split by the first character after T of the tree number (build_web_beta.py writes
  // <facts>/index.json, the file's header with the shard list, and <facts>/{shard}.json, {trees}); a page reads the header
  // and the shards of the trees it shows. A derived folder without the split (release 6.2's) is read whole.
  const shardOf=n=>{const c=String(n||'').trim().toUpperCase().charAt(1);return /^[0-9A-Z]$/.test(c)?c:'_';};
  async function factsFor(fu,numbers,v){
    const dir=String(fu).replace(/\.json$/,''),idx=await getJSON(`${dir}/index.json?v=${v}`).catch(()=>null);
    if(!idx?.shards||!Array.isArray(idx.shards.keys))return null;
    const keys=[...new Set((numbers||[]).filter(Boolean).map(shardOf))].filter(k=>idx.shards.keys.includes(k));
    const parts=await Promise.all(keys.map(k=>getJSON(`${dir}/${String(idx.shards.path||'{shard}.json').replace('{shard}',k)}?v=${v}`)));
    const {shards,...head}=idx;
    return {...head,trees:Object.assign({},...parts.map(x=>x?.trees||{})),shardsRead:keys};
  }
  // -> the release's maxima (and notable facts), null when the release publishes none (absent), or a rejection with
  // {unavailable, file, reason} when a file it lists did not load. Facts that loaded are kept when the maxima did not
  // (D.unavailable says which file failed). trees: the tree numbers a page shows, so only their facts are read where the
  // package splits them.
  async function load(env={},{facts=false,trees=null}={}){
    const siteRoot=String(env.siteRoot??root.ALTO_SITE_ROOT??'.').replace(/\/+$/,'')||'.',base=derivedBase(env);
    // The derived folder travels inside the tool build (cached a year at one address): the tool version is in the stamp.
    const tool=root.ALTOVersion?.TOOL?.version,v=encodeURIComponent((env.version||env.metadata?.assembly?.tile_version||env.metadata?.release?.dataset_version||'session')+(tool?`.t${tool}`:''));
    let mf=null,mfError=null;
    try{mf=await getJSON(`${base}/manifest.json?v=${v}`);}catch(e){mfError=e;}
    const url=key=>{const listed=env.metadata?.derived_products?.[key];if(listed)return `${siteRoot}/${pathOf(listed)}`;const own=mf?.products?.[key];return own?`${base}/${pathOf(own)}`:null;};
    const mu=url('species_maxima'),fu=facts?url('notable_facts'):null;
    if(!mu&&!fu){if(mfError)throw mfError;return null;}
    const readFacts=async()=>(trees&&trees.length?await factsFor(fu,trees,v):null)||getJSON(`${fu}?v=${v}`);
    const got=await Promise.allSettled([mu?getJSON(`${mu}?v=${v}`):null,fu?readFacts():null]);
    const [m,f]=got.map(g=>g.status==='fulfilled'?g.value:null),err=got.find(g=>g.status==='rejected')?.reason||null;
    if(!m&&!f){if(err)throw err;return null;}
    const D=prepare(m,f);
    D.check=mf?.checks?.species_maxima||null;
    D.liveRelease=env.metadata?.release?.dataset_version||null;
    D.unavailable=err;
    return D;
  }

  const api={MEASURES,MEASURE_KEYS,MEASURE_NAMES,MEASURE_WORDS,POPULATION,NEAR_CAP_M2,NEAR_CAP_TEXT,MERGE_CAP_TEXT,HEIGHT_MARGIN_NOTE,DEFINITIONS,pluralName,AUCKLAND,KAURI,current:null,prepare,held,has,speciesName,areaList,clearLeads,badgeMaxima,badge,badgeHtml,
    listHref,girthHref,recognition,typo,latin,recognitionHtml,areaMaxima,listRows,rankText,scopeNote,SCOPE_LIMITS,mapSet,outlineSvg,sharedSpan,derivedBase,load,factsFor,shardOf,fetchJSON,unavailable,value,margin,dateText,fold};
  root.ALTOMaxima=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
