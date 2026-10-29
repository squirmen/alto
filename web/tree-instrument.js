/* ALTO tree experience ("Instrument dashboard", concept B, chosen 12 Oct 2026): one tree read as a set of linked
 * instruments. Every value shows its kind and its range (design system: estimates carry the Estimate badge and
 * their range; measured and recorded values name their survey or source; rule-based classes say "Inferred");
 * every value opens its provenance in one tap; choosing a survey year highlights that survey in every figure,
 * the key measurements, the measurements by source and the map.
 * With components from concept A (the protection line with its legal basis, the records count as a link to the
 * records, root-space rows, explicit "none for this record" lines) and concept C (numbered links into the tree
 * page, the root protection radius beside the size values, plain sentences for survey change and protection).
 * Reads an alto.tree-record/1 object (web/tree-record.js) and returns markup; bind() wires the links.
 * Shared by the map's tree panel (tree-panel.js) and the tree page (tree-page.js). */
(function(root){
  'use strict';
  const V=()=>root.ALTOViz;
  // Numbers print by the one shared rule set (alto-format.js, FE-16): the panel, the tree page, Area and property agree.
  const F=root.ALTOFormat||(typeof require==='function'?require('./alto-format.js'):null);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=F.num,nf=F.nf,nf1=v=>F.fixed(v,1);   // 0.1 m: "7.0 m", never "7 m"
  const r1=v=>Math.round(v*10)/10;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
  function nice(v){if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v)),m=v/p;return [1,1.2,1.5,2,2.5,3,4,5,6,8,10].find(x=>m<=x+1e-9)*p;}
  function ticks(max,count=4){const step=nice(max/count),out=[];for(let t=0;t<=max+1e-9;t+=step)out.push(+t.toFixed(6));return out;}
  const sig2=v=>F.sig(v,2);
  const s2=v=>F.sigText(v,2);   // two significant figures
  const money=v=>F.money(v);
  const hybrid=s=>String(s||'').replace(/ x /g,' × ');                                            // never the letter x
  // UX-21: ALTO's own pages (the methods pages) open in the same tab; other sites in a new one.
  const newTab=h=>/^https?:/i.test(String(h||''))?' target="_blank" rel="noopener"':'';

  // ---------- data-sheet formatting: precision follows the method (design system 4.7) ----------
  const UNIT_OF={height:'m',crownArea:'m²',crownOutline:'m²',crownDiameter:'m',trunkDiameter:'cm',largestStem:'cm',rootProtection:'m',dripline:'m',rootZone:'m',rootZoneColumnar:'m',crownSpread:'m',
    benefits:'/yr',carbonStored:'t CO₂e',stormwater:'m³/yr',replacementYears:'years'};
  const fmtValue=(key,v,o)=>F.quantity(key,v,o);   // [value, unit] by the rule for its quantity (alto-format.js)
  const areaText=v=>F.area(v);
  // A growth-form class as a title: the class alone; the Estimate badge says it is a model output.
  // A model's growth-form wording without "(model)": the Estimate badge says it ("(model, high confidence)" -> "(high confidence)").
  const cleanForm=t=>String(t||'').replace(/^(Probably|Likely)\s+/i,'').replace(/\s*\(model\)$/,'').replace(/\(model,\s*/,'(').replace(/^./,c=>c.toUpperCase());
  // [value, unit] for a quantity: numbers by the rule above, classes and names as stored.
  function fmt(q){
    if(!q)return ['–',''];
    // The release's wording with its hedge kept ("Probably evergreen broadleaf"); the card's Estimate mark says it is a model's.
    if(q.key==='growthForm')return [String(q.text||'').replace(/\s*\(model\)$/,'').replace(/\(model,\s*/,'('),''];
    const f=fmtValue(q.key,q.value,{measuredTape:q.kind==='measured'&&(!!q.tape||/KYTE/.test(q.provenance?.source||''))});
    if(f)return f;
    const m=String(q.text??'').match(/^(\$?\d[\d.,]*)\s*(.*)$/);return m?[m[1],m[2]]:[String(q.text??''),''];
  }
  const tight=u=>u.startsWith('/')||u==='%';                                                // "$540/yr", "93%"
  const text=q=>{const [v,u]=fmt(q);return u?(tight(u)?`${v}${u}`:`${v} ${u}`):v;};
  // A range as printed, or null when its ends print the same (no zero-width ranges).
  function fmtRange(q){
    const lo=num(q?.range?.low),hi=num(q?.range?.high);if(lo===null||hi===null)return null;
    if(!fmtValue(q.key,lo))return q.range.text||null;
    return F.range(q.key,lo,hi);
  }
  // An estimate's range as said on its card: "Model spread (2 models) 41–44 cm", "Range 4.9–5.3 m from the model spread",
  // or, where the release stores none, "Range not computed in release 6.2". Never an Estimate without one of these.
  function rangeText(q){
    if(!q)return null;
    const r=fmtRange(q);
    if(r)return `${q.rangeLabel||'Range'} ${r}${q.rangeSuffix?` ${q.rangeSuffix}`:''}`;
    return q.rangeNote||null;
  }

  // ---------- kinds: what a number is ----------
  const KINDS={measured:'Measured',recorded:'Recorded',derived:'Derived',model:'Estimate',rule:'Inferred'};
  const estimateBadge='<span class="badge badge-estimate">Estimate</span>';
  const isEstimate=q=>q?.kind==='model';
  // The source a value line names, in the glossary's terms.
  function sourceName(p){
    const s=String(p?.source||'');
    if(/KYTE/.test(s))return 'KYTE ground visit';
    if(/growth-form model/i.test(s))return 'Growth-form model';
    if(/^ALTO release model/.test(s))return 'ALTO release model';
    const m=s.match(/Auckland (\d{4}) (?:aerial )?LiDAR survey/);if(m)return `${m[1]} LiDAR survey`;
    if(/tree register/i.test(s))return 'Council tree register';
    if(/Schedule 10|Notable Trees schedule/i.test(s))return 'Notable Trees schedule';
    if(/aerial imagery/i.test(s))return 'Aerial imagery 2024–25';
    return s;
  }
  // How a computed value was made, in a few words; the popover gives the method.
  const HOW={trunkDiameter:'Not measured',rootProtection:'12 × trunk estimate',lifeStage:'Height as a share of a class reference height',benefits:'Sensitivity scenario',carbonStored:'ALTO benefit scenario',
    stormwater:'ALTO benefit scenario',replacementYears:'Crown area ÷ planning rate',irreplaceability:'Class rule over regrowth time and height',crownReplacement:'Band of the regrowth years',crownDiameter:'Circle with the crown area',
    crownOutline:'Smoothed crown outline',growthForm:'2024 LiDAR survey and aerial imagery',crownSpread:'Mean of the widest width and the width at right angles, 2024 LiDAR, ±1 m'};
  // The line under a value. Estimates start with their range (or say none was computed); measured and recorded values
  // name their source and date (their other estimates stay in the provenance popover, never "range" beside a measurement).
  function line(q){
    if(!q)return '';
    const p=q.provenance||{},rt=rangeText(q);
    if(q.key==='height'&&q.flag==='tall')return `Height ${text(q)} · ${q.caution}`;
    if(q.key==='crownArea'&&q.basis==='segmented')return ['Segmented from 2024 LiDAR',q.segmentations?`other segmentations ${q.segmentations}`:null].filter(Boolean).join(' · ');
    if(q.key==='rootProtection'){const a=num(q.value);return [rt,a!==null?areaText(Math.PI*a*a):null].filter(Boolean).join(' · ')||'From the trunk estimate';}
    if(q.key==='dripline')return q.basis==='equal_area'?'Crown outline not loaded: circle with the crown area':q.basis==='top'?'Crown top to the farthest outline point (the recorded position is outside the outline)':q.basis==='centre'?'Crown centre to the outline (the recorded position is outside it)':'Recorded position to the farthest outline point';
    if(q.key==='rootZone')return `at least ${text(q)}, trunk to canopy edge`;
    if(q.key==='rootZoneColumnar')return `Half the tree height: ${text(q)} (columnar crown)`;
    if(q.key==='largestStem')return `${q.text} · KYTE ground visit · not the tree’s trunk diameter`;
    // A field measurement: who and how are in the field rows under the band (fieldRows).
    if(q.field)return ['Measured in the field',q.field.dates?.text].filter(Boolean).join(' · ');
    // Release 6.3 names what the value adds up (stormwater and carbon).
    if(q.key==='benefits')return [q.components?cap(q.components):null,rt&&!/^Range not/.test(rt)?rt:null,'Sensitivity scenario',num(q.band)!==null?`±${nf(q.band*100)}% band set by confidence tier`:null,rt&&/^Range not/.test(rt)?rt:null].filter(Boolean).join(' · ');
    // Height class (TS-07): "85% of the 22 m evergreen-broadleaf reference height"; the class band when the height shown
    // falls outside it; the range note last.
    if(q.key==='lifeStage'&&q.notClassed)return `${cap(q.notClassed.label)} · values withheld`;
    // Crown replacement time (release 6.3): the years behind the band, or why the crown is not classed.
    if(q.key==='crownReplacement')return q.notClassed?cap(q.notClassed.label):[num(q.years)!==null?`About ${nf(q.years,q.years<10?1:0)} years to regrow this crown area`:null,HOW.crownReplacement,rt].filter(Boolean).join(' · ');
    if(q.key==='lifeStage'){const b=q.basisClass,share=num(q.share)!==null?`${nf(q.share)}%`:q.band;
      return [b&&share?cap(`${share} of the ${nf(b.ref)} m ${b.words.replace(/ /g,'-')} reference height${b.differs?' (this crown’s release 5.2 class)':''}`):q.band?`${cap(q.band)} of the class reference height`:HOW.lifeStage,rt].filter(Boolean).join(' · ');}
    if(q.kind==='model')return [rt,q.how||HOW[q.key]||sourceName(p)].filter(Boolean).join(' · ');
    if(q.kind==='rule')return HOW[q.key]||`Inferred · ${sourceName(p)}`;
    if(q.kind==='derived')return HOW[q.key]||`From ${sourceName(p).toLowerCase()}`;
    if(q.key==='crownSpread')return HOW.crownSpread;
    const date=p.date?.text&&/snapshot/.test(p.date.text)?p.date.text.replace(/^snapshot\s*/,''):null;
    return [KINDS[q.kind]||'',sourceName(p),date].filter(Boolean).join(' · ');
  }
  // Further lines under a value: cautions (55 m or more), the 400 m² limit and the small-crown bias.
  function notes(q){
    if(!q)return [];
    const out=[];
    if(q.key!=='height'&&q.caution)out.push(`Height${q.cautionHeight?` ${q.cautionHeight}`:''} · ${q.caution}`);
    if(q.key==='crownArea'){if(q.nearCap)out.push(root.ALTOTreeRecord?.NEAR_CAP_TEXT||'at or near the 400 m² segmentation limit; the tree may be larger');if(q.bias)out.push(root.ALTOTreeRecord?.SMALL_BIAS_TEXT||'large crowns tend to read about 20% small (release 6 methods)');}
    return out;
  }

  // ---------- uncertainty: a range bar on a 0-based scale ----------
  function rangeBar(q,{max=null}={}){
    const v=num(q?.value);if(v===null)return '';
    const lo=num(q.range?.low),hi=num(q.range?.high),top=max||nice(Math.max(v,hi??v)*1.15);
    const P=x=>r1(clamp(x/top*100,0,100)),f=x=>{const a=fmtValue(q.key,x);return a?(a[1].startsWith('/')?a.join(''):a.join(' ')):nf(x,1);};
    const fr=fmtRange(q);
    const tip=`${fr?`${isEstimate(q)?(q.rangeLabel||'Range'):'Other estimates in this record'} ${fr}`:q.rangeNote||'No range stored for this value'}. Scale 0 to ${f(top)}.`;
    return `<span class="ti-rb" data-kind="${esc(q.kind)}" role="img" aria-label="${esc(tip)}" title="${esc(tip)}"><i class="ti-rb-t"></i>${fr&&lo!==null&&hi!==null&&hi>lo?`<i class="ti-rb-r" style="left:${P(lo)}%;width:${Math.max(1.5,r1(P(hi)-P(lo)))}%"></i>`:''}<i class="ti-rb-v" style="left:${P(v)}%"></i></span>`;
  }
  // Height class (TS-07): height as a share of the reference height of the class the release computed it for (read back
  // from the stored regrowth rate; tree-record.js lifeStage basisClass), on the five stored classes named by size.
  function stageShare(rec){
    const L=rec.lifeStage,q=rec.measures?.lifeStage,b=q?.basisClass,h=num(rec.measures?.height?.value);
    // Release 6.3 stores the share (size.height_share_pct): the bar marks it as stored.
    if(num(q?.shareStored)!==null&&b?.ref)return {share:num(q.shareStored),height:h,ref:b.ref,cls:b.words};
    if(h!==null&&b?.ref)return {share:h/b.ref*100,height:h,ref:b.ref,cls:b.words};
    const cls=rec.benefits?.classUsed?.key,ref=num(L?.referenceHeights?.[cls]);
    return h!==null&&ref?{share:h/ref*100,height:h,ref,cls:rec.benefits.classUsed.label}:null;
  }
  function stageBar(rec){
    const L=rec.lifeStage;if(!L?.key||!Array.isArray(L.scale))return '';
    const s=stageShare(rec),top=Math.max(120,s?Math.ceil(s.share/10)*10+10:120),P=x=>r1(clamp(x/top*100,0,100));
    // The share as the card's line prints it (kept inside the class's band), else the band.
    const pct=num(rec.measures?.lifeStage?.share)??root.ALTOTreeSummary?.sharePct(s?.share,L.scale.find(c=>c.current))??null;
    const tip=`${L.label}: ${s?`${pct!==null?`${nf(pct)}%`:L.band} of the ${nf(s.ref)} m ${String(s.cls).toLowerCase().replace(/ /g,'-')} reference height`:`${L.band} of the class reference height`}. Classes by share of the class reference height: ${L.scale.map(c=>`${c.label.toLowerCase()} ${c.band}`).join(', ')}.`;
    return `<span class="ti-cb" data-kind="model" role="img" aria-label="${esc(tip)}" title="${esc(tip)}">${L.scale.map(c=>`<i class="ti-cb-s${c.current?' is-cur':''}" style="left:${P(c.from)}%;width:${r1(P(c.to??top)-P(c.from))}%"></i>`).join('')}${s?`<i class="ti-rb-v" style="left:${P(s.share)}%"></i>`:''}</span>`;
  }
  function classBar(rec){
    const r=rec.replacement,k=r?.irreplaceability?.key,cl=r?.classes||[];if(!k||!cl.length)return '';
    const w=100/cl.length,tip=`${r.irreplaceability.label}. Classes: ${cl.map(c=>`${c.label} (${c.rule})`).join('; ')}.`;
    return `<span class="ti-cb ti-cb-eq" data-kind="rule" role="img" aria-label="${esc(tip)}" title="${esc(tip)}">${cl.map((c,i)=>`<i class="ti-cb-s${c.key===k?' is-cur':''}" style="left:${r1(i*w)}%;width:${r1(w)}%"></i>`).join('')}</span>`;
  }

  // ---------- identity, in the glossary's terms ----------
  function eyebrow(id){
    if(id.detection)return 'LiDAR-detected tree';
    const c=String(id.category||'');
    return c.replace(/^Tree register · Council Parks$/,'Council tree register · Parks').replace(/^Tree register · /,'Council tree register · ');
  }
  // The name a tree is shown by (H1, tab title, panel): a recorded species in its display form (species-names.js); for a
  // model-named tree the release's own wording (growth-form.js WORDING, e.g. "Likely conifer (model)"), never the top
  // model score; for a record naming several species, "Scheduled notable tree" or the growth form, with the record's
  // string as "Recorded as: …". {text, html (lang="mi" on te reo names), estimate, latin, latinHtml, recordedAs, note}
  const SN=()=>root.ALTOSpeciesNames;
  function title(id){
    if(id.nameKind==='model'&&id.growthForm)return {text:id.growthForm.wording||id.title,html:esc(id.growthForm.wording||id.title),estimate:true,
      note:'Growth form estimated from the 2024 LiDAR survey and aerial imagery. Species not identified.'};
    if(id.nameKind==='none'){const t=id.detection?'LiDAR-detected tree':'Tree';return {text:t,html:esc(t),estimate:false,
      note:/not yet determined/.test(id.nameNote||'')?'Growth form not yet determined. No species recorded.':'No species recorded.'};}
    if(id.nameMulti){const t=id.title==='Tree detected from LiDAR'?'LiDAR-detected tree':id.title;return {text:t,html:esc(t),estimate:!!id.titleEstimate,recordedAs:id.recordedAs,note:null};}
    const N=SN(),t=id.title;
    return {text:t,html:N?N.nameHtml(t,{display:t}):esc(t),estimate:false,latin:id.latin?(N?N.latinText(id.latin):hybrid(id.latin)):null,
      latinHtml:id.latin?(N?N.latinHtml(id.latin):`<i>${esc(hybrid(id.latin))}</i>`):null,note:null};
  }
  // The growth form beside a recorded species: "Crown growth form (model): probably evergreen broadleaf" (the release's
  // wording, its hedge kept), or null.
  function crownForm(id){
    if(id.nameKind!=='recorded'||id.nameMulti&&id.titleEstimate||!id.growthForm?.shown)return null;
    const w=String(id.growthForm.wording||'').replace(/\s*\(model\)$/,'').replace(/\(model,\s*/,'(').replace(/^./,c=>c.toLowerCase());
    return w?`Crown growth form (model): ${w}`:null;
  }
  // The Notable Trees schedule under the name (tree-record.js scheduleWords): a scheduled tree or group with its item
  // number, or that no entry matched and which rules ALTO does not check. Never silence once the record has loaded; never
  // a legal status. facts: notable_facts.json (species-maxima.js) for item numbers and the schedule's date.
  function scheduleLine(rec,{facts=root.ALTOMaxima?.current?.facts||null,tenure=null}={}){
    const R=root.ALTOTreeRecord;if(!R)return null;
    return R.scheduleWords(rec.identity?.protectionStatus,{facts,number:rec.number,tenure:tenure??rec.place?.landType?.key??rec._ctx?.props?.tenure??null});
  }
  // The release's own lines about this tree (tree-record.js releaseLines): the height check, the record-and-crown checks
  // and, from release 6.3, the group area, the Schedule 10 entry, reviewer notes, the kauri survey result and the licence
  // of an OpenStreetMap record. Each is the data's wording, labelled, with its method or source linked.
  function releaseLines(rec,{cls='ti-lines'}={}){
    const ls=rec.lines||[];if(!ls.length)return '';
    return `<ul class="${cls}">${ls.map(l=>`<li data-line="${esc(l.key)}"${l.tone?` data-tone="${esc(l.tone)}"`:''}><b>${esc(l.label)}</b>${l.text?` · ${esc(l.text)}`:''}${l.links?.length?` ${l.links.map(a=>`<a href="${esc(a.href)}"${/^https?:/.test(a.href)?' target="_blank" rel="noopener"':''}>${esc(a.text)}</a>`).join(' · ')}`:l.href?` <a href="${esc(l.href)}">Method</a>`:''}</li>`).join('')}</ul>`;
  }
  // Release 6.3: the map marker lies inside a polygon of Council's Notable Group of Trees Overlay (group_area dataset). The
  // release's own line, which never says the tree is scheduled or protected; left out where the schedule line already
  // places the tree in that scheduled group.
  const GROUP_LAYER='https://www.arcgis.com/home/item.html?id=864f687d7d014aedb7e3dceaa797750e';
  function groupArea(rec){
    const own=rec._ctx?.record?.datasets?.group_area,rep=(rec._ctx?.members||[]).find(m=>m?.tree_id===rec.identity?.crownRepresentative);
    return own||rep?.datasets?.group_area||null;
  }
  function groupAreaLine(rec,w,{tag='p',cls='ti-prot'}={}){
    const g=groupArea(rec);if(!g||w?.kind==='group')return '';
    const line=String(g.line||`Inside a Notable Group of Trees area: Schedule 10 item ${g.schedule_item}${g.group_name?`, “${g.group_name}”`:''}. Whether this tree is one of the scheduled trees has not been established.`)
      .replace(/"([^"]*)"/g,'“$1”');
    const i=line.indexOf(':'),label=i>0?line.slice(0,i):'Inside a Notable Group of Trees area',text=i>0?line.slice(i+1).trim():line;
    return `<${tag} class="${cls} ti-group-area" data-protection="group_area"><b>${esc(label)}</b> · ${esc(text)} <a href="${GROUP_LAYER}" target="_blank" rel="noopener">Council layer</a></${tag}>`;
  }
  function protectionLine(rec,{tag='p',cls='ti-prot',facts,tenure=null,note=true}={}){
    const w=scheduleLine(rec,{facts,tenure}),g=groupAreaLine(rec,w,{tag,cls});if(!w)return g;
    return `<${tag} class="${cls}" data-protection="${esc(w.status)}">${w.label?`<b>${esc(w.label)}</b> · `:''}${esc(w.text)}${note&&w.note?`<small>${esc(w.note)}</small>`:''}</${tag}>`+g;
  }
  // How sure ALTO is, in one row near the top: the 2024 LiDAR detection, the record's link to its crown, where the species
  // name comes from and whether Council verified the recorded position.
  const TIER_WORDS={very_likely:'very likely a tree',probable:'probably a tree',possible:'possibly a tree (could be a hedge or large shrub)',unverified:'unverified',
    possible_duplicate:'possibly the same tree as a nearby record',not_assessed:'not yet checked',location_unverified:'found; Council position unverified',
    earlier_detection:'earlier detection without a crown of its own',outside_v5_coverage:'outside the 2024 crown survey',shared_crown_candidate:'shares a crown with another record'};
  const COUNCIL_SOURCES=['tree_register_points','notable_trees_overlay','ruru_obskauri_tiaki_public'];
  function councilPosition(rec){
    const r=rec._ctx?.record?.datasets||{},src=r.record?.source_primary;
    if(!COUNCIL_SOURCES.includes(src))return 'no Council point';
    if(r.location_review)return 'not verified';
    const t=String(r.record?.notable_point_type??''),label=String(r.record?.notable_point_type_label||'');
    return t==='1'||/^Verified position/i.test(label)?'verified':'not verified';
  }
  function evidence(rec){
    if(!rec.loaded)return null;
    const id=rec.identity||{},o=rec.outline||{},q=rec.summary?.classification?.quality||id.quality;
    const crown=num(rec.measures?.height?.value)!==null||num(rec.measures?.crownArea?.value)!==null;
    const detection=crown?(TIER_WORDS[o.evidenceTier?.key]||'crown found'):'no crown linked';
    const link=id.detection?'the detection is the crown':{linked:'linked to its crown',probable:'probable link',drawn:'crown drawn from the record',unlinked:'no crown linked'}[q]||'linked to its crown';
    const species=id.nameKind==='recorded'?'as supplied by source':'not recorded';
    return {detection,link,species,council:councilPosition(rec),
      text:`Detection: ${detection} (2024 LiDAR) · Record link: ${link} · Species: ${species} · Council position: ${councilPosition(rec)}`};
  }
  function evidenceRow(rec,{cls='ti-evidence'}={}){
    const e=evidence(rec);if(!e)return '';
    const part=(k,v)=>`<span><b>${esc(k)}:</b> ${esc(v)}</span>`;
    return `<p class="${cls}" aria-label="${esc(e.text)}">${part('Detection',`${e.detection} (2024 LiDAR)`)}${part('Record link',e.link)}${part('Species',e.species)}${part('Council position',e.council)}</p>`;
  }
  // Kauri survey records: an earlier build appended the survey's result fields to the name ("Kauri (PA+ PC+ soil:Nil)").
  // They are not the name; they show as their own row, as supplied. Code meanings come from the Council layer's field
  // definitions (raw/arcgis/ruru_obskauri_tiaki_public/layer_0.json, 4 Jun 2026): PhytAgathidicida and PhytCinnamomi
  // are coded 0 NA, 1 Not Detected, 2 Present, and the build wrote PA+ or PC+ for 1 or 2, so a flag means Present or Not
  // detected (the release does not keep which); SoilSampleResult is the layer's free text. -> {raw, codes, flags[], soil,
  // line, explain, explainHtml, fields}, or null.
  const RURU_FIELDS='https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/Ruru_ObsKauri_Tiaki_(Valid_and_Public)/FeatureServer/0';
  const PHYT={'PA+':'Phytophthora agathidicida','PC+':'Phytophthora cinnamomi'};
  function surveyCodes(rec){
    // Release 6.3: the survey dataset holds the result (DB-06: the name reads Kauri, the codes it carried up to release
    // 6.2 are kept as species_name_v62). "recorded": the survey record has a value in that Phytophthora field.
    const sv=rec._ctx?.record?.datasets?.survey;
    if(sv){
      const flags=[sv.p_agathidicida==='recorded'?'PA+':null,sv.p_cinnamomi==='recorded'?'PC+':null].filter(Boolean),soil=sv.soil_sample_result?String(sv.soil_sample_result).trim():null;
      const parts=[...flags.map(f=>`${PHYT[f]} recorded`),soil?`soil sample result: ${soil}`:null].filter(Boolean);
      const say=it=>[flags.length?`“Recorded” means the survey record has a value in its ${flags.map(f=>it(PHYT[f])).join(' or ')} field: Present or Not detected, as the Council layer’s field definitions code it; this release does not keep which.`:'',
        soil?'The soil sample result is the layer’s free text, as supplied.':''].filter(Boolean).join(' ');
      return {raw:sv.species_name_v62||null,codes:parts.join('; ')||'no result recorded',flags,soil,release63:true,credit:sv.credit||null,caveat:sv.caveat||null,
        line:`Council kauri survey (Ruru ObsKauri Tiaki): ${parts.join('; ')||'no result recorded'}`,fields:RURU_FIELDS,explain:say(n=>n),explainHtml:say(n=>`<i>${esc(n)}</i>`)};
    }
    const raw=rec.identity?.nameCodes;if(!raw)return null;
    const codes=String(raw).replace(/soil:\s*/i,'soil: ').replace(/\s+/g,' ').trim();
    const flags=[...new Set(raw.match(/\bP[AC]\+/g)||[])],soil=(/soil:\s*(.+)$/i.exec(raw)||[])[1]?.trim()||null;
    const line=`Council kauri survey (Ruru ObsKauri Tiaki): result codes as supplied: ${codes}`;
    const say=(it)=>{
      const out=[];
      if(flags.length)out.push(`The Council layer’s field definitions code each Phytophthora result as Present, Not detected or NA. ${flags.map(f=>`${f} (${it(PHYT[f])})`).join(' and ')} ${flags.length>1?'mark':'marks'} a result of Present or Not detected; this release does not keep which.`);
      if(soil)out.push('“soil:” is the layer’s Soil Sample Result field, free text as supplied.');
      return out.join(' ');
    };
    return {raw,codes,flags,soil,line,fields:RURU_FIELDS,explain:say(n=>n),explainHtml:say(n=>`<i>${esc(n)}</i>`)};
  }
  const BADGE={'Probable crown link':'Probable link','Crown unlinked':'No crown linked'};
  // recordsHref: where "N records · M sources" leads (the records section of the tree page).
  function badges(rec,{icon=null,loaded=rec.loaded,recordsHref=null}={}){
    const id=rec.identity,out=[];
    for(const b of id.badges||[]){
      if(b.key==='evidence')continue;                      // detection evidence is a data row, not a badge
      if(b.key==='records'){
        if(loaded)out.push(recordsHref?`<li><a class="badge badge-muted badge-link" href="${esc(recordsHref)}">${esc(b.label)}</a></li>`:`<li class="badge badge-muted">${esc(b.label)}</li>`);
        else if(Number(id.recordCount)>1)out.push(`<li class="badge badge-muted">${nf(id.recordCount)} records on this crown</li>`);
      }else if(b.key==='protected')out.push(`<li class="badge badge-protected" title="${esc(b.title||'')}">${icon?icon('shield',12):''}${esc(b.label)}</li>`);
      else if(b.tone==='warn')out.push(`<li class="badge badge-warning">${esc(BADGE[b.label]||b.label)}</li>`);
      else out.push(`<li class="badge badge-muted">${esc(b.label)}</li>`);
    }
    if(title(id).estimate)out.unshift('<li class="badge badge-estimate">Estimate</li>');
    return out.length?`<ul class="tp-badges ti-badges">${out.join('')}</ul>`:'';
  }
  // The release as the interface names it: by its date, the tool version, and Preview for a development build.
  function versionLine(rec){
    const r=rec.release||{};
    if(r.public?.text)return r.public.text+(r.public.preview?' · Preview':'');
    return [r.updated?.text?`Release ${r.updated.text}`:null,r.tool?`Tool ${r.tool}`:null].filter(Boolean).join(' · ')+(r.dev?' · Preview':'');
  }

  // ---------- key measurements ----------
  function yearAlt(rec,key,year){
    const s=(rec.surveys||[]).find(x=>x.year===year);
    if(key==='height'){
      if(s?.height)return {q:s.height,v:fmt(s.height),line:`Measured · ${year} LiDAR survey, matched to this tree`};
      return {v:['–',''],line:s?.line||`No ${year} value`};
    }
    if(key==='crownArea')return {v:['–',''],line:`${year} crown outlines are not in this release`};
    return null;
  }
  // Crown replacement time (release 6.3): the five bands of equal width, this crown's band marked; none when not classed.
  function bandBar(rec){
    const r=rec.replacement,k=r?.band?.key,bl=r?.bands||[];if(!k||!bl.length)return '';
    const w=100/bl.length,tip=`${r.band.label}. Bands of the years a newly planted tree takes to grow a crown of this area: ${bl.map(b=>b.rule).join(', ')}.`;
    return `<span class="ti-cb ti-cb-eq" data-kind="model" role="img" aria-label="${esc(tip)}" title="${esc(tip)}">${bl.map((b,i)=>`<i class="ti-cb-s${b.key===k?' is-cur':''}" style="left:${r1(i*w)}%;width:${r1(w)}%"></i>`).join('')}</span>`;
  }
  const BAR={lifeStage:stageBar,irreplaceability:classBar,crownReplacement:bandBar};
  // Card labels. The dripline card names its own measure (dripline radius, or the equal-area radius when the outline is
  // not loaded), so its label comes from the quantity.
  const LABELS={height:'Height',crownArea:'Crown area',crownDiameter:'Crown diameter (equal-area circle)',crownSpread:'Crown spread',trunkDiameter:'Trunk diameter at 1.4 m',largestStem:'Largest stem at 1.4 m',dripline:'Dripline radius (2024 crown outline)',
    rootProtection:'BS 5837 root protection radius (UK standard; 12 × trunk estimate), for comparison',rootZone:'Unitary Plan protected root zone (Chapter J)',
    rootZoneColumnar:'Unitary Plan protected root zone, columnar crown (Chapter J)',lifeStage:'Height class',benefits:'Benefits',carbonStored:'Carbon stored',stormwater:'Stormwater runoff avoided',
    replacementYears:'Years for a new crown to reach this crown area at the planning rate (crown area only)',irreplaceability:'Irreplaceability',crownReplacement:'Crown replacement time',growthForm:'Growth form'};
  // notes: numbered provenance notes (the tree page): the value's note number, printed beside it (hidden on screen).
  function metric(rec,key,{label=null,id='tiPop',ctx=null,notes:fns=null}={}){
    const q=rec.measures?.[key];if(!q)return '';
    const fn=fns?.get(q.provenance?.id)?`<sup class="ti-fn" aria-hidden="true">${fns.get(q.provenance.id)}</sup>`:'';
    const [v,u]=fmt(q),bar=BAR[key]?BAR[key](rec):rangeBar(q),txt=num(q.value)===null?' is-text':'';
    const alt=key==='height'||key==='crownArea';
    const alts=alt?[2013,2016].map(y=>{const a=yearAlt(rec,key,y);
      return `<span class="ti-m-alt" data-for-year="${y}" hidden><span class="ti-m-v${a.q?'':' is-none'}"><b>${esc(a.v[0])}</b>${a.v[1]?`<small>${esc(a.v[1])}</small>`:''}</span><span class="ti-m-p">${esc(a.line)}</span></span>`;}).join(''):'';
    const extra=notes(q).map(t=>`<span class="ti-m-p ti-m-caution">${esc(cap(t))}</span>`).join('');
    const lab=key==='dripline'||q.field?q.label:label||LABELS[key]||q.label;
    return `<li class="ti-m" data-kind="${esc(q.kind)}" data-q="${esc(key)}"${q.flag?` data-flag="${esc(q.flag)}"`:''}${alt?' data-years="2013 2016 2024"':''}><button type="button" class="ti-m-b" aria-haspopup="dialog" aria-expanded="false" aria-controls="${esc(id)}">
      <span class="ti-m-l">${esc(lab)}</span>
      <span class="ti-m-cur"${alt?' data-for-year="2024"':''}><span class="ti-m-v${txt}"><b>${esc(v)}</b>${u?`<small${tight(u)?' class="is-tight"':''}>${esc(u)}</small>`:''}${fn}${isEstimate(q)?estimateBadge:''}</span>${bar||''}
      <span class="ti-m-p">${esc(line(q))}</span>${extra}${ctx?.[key]?`<span class="ti-m-ctx"><b>${esc(ctx[key].text)}</b> ${esc(ctx[key].where)}</span>`:''}</span>${alts}</button></li>`;
  }
  // The values a band leaves out are named, so an absent value is never silent (concept A's explicit gaps). A record with
  // no crown linked says so once, then what the record holds.
  const WHY={trunkDiameter:'no crown estimate',rootProtection:'no root-space scenario',lifeStage:'no crown estimate',benefits:'no crown estimate',carbonStored:'no crown estimate',
    replacementYears:'no crown estimate',irreplaceability:'no crown estimate',crownReplacement:'no crown estimate',stormwater:'no crown estimate',height:'no crown in the 2024 LiDAR survey',crownArea:'no crown in the 2024 LiDAR survey',
    crownDiameter:'no crown in the 2024 LiDAR survey',dripline:'no crown in the 2024 LiDAR survey'};
  const OPTIONAL=new Set(['rootZone','rootZoneColumnar','crownSpread','largestStem']);
  function holds(rec){
    const id=rec.identity||{},r=(rec.records||[]).find(x=>x.self)||null,out=[];
    if(id.nameKind==='recorded')out.push(id.nameMulti?`the names as supplied (${id.recordedAs})`:`its species as supplied (${[id.title,id.latin].filter(Boolean).join(', ')})`);
    if(r?.source?.name)out.push(`${/^[AEIOU]/.test(r.source.name)?'an':'a'} ${r.source.name} record${r.sourceId?` (${r.sourceId})`:''}${r.snapshot?.text?`, retrieved ${r.snapshot.text}`:''}`);
    if(id.position)out.push('its recorded position');
    return out;
  }
  function missing(rec,keys,labels){
    const crownless=!rec.measures?.height&&!rec.measures?.crownArea;
    if(crownless){
      const h=holds(rec),ps=(rec.surveys||[]).find(x=>x.year===2024)?.pointSample;
      return `<p class="ti-missing">No crown is linked to this record in the 2024 LiDAR survey, so ALTO has no measurements or estimates for it.${h.length?` The record holds ${esc(h.join(', ').replace(/, ([^,]*)$/,' and $1'))}.`:''}</p>`+
        (ps?`<p class="ti-missing ti-point-sample">Canopy-model height at the recorded point: ${esc(ps.text)} (no tree crown linked; may be a structure).</p>`:'');
    }
    // Release 6.3 replaces irreplaceability with the crown replacement time: each release lists only its own.
    const other=rec.release63?'irreplaceability':'crownReplacement';
    const out=keys.filter(k=>!rec.measures?.[k]&&!OPTIONAL.has(k)&&k!==other);
    if(!out.length)return '';
    // Release 6.3 withholds the estimates of a crown whose height is not plausible: said as that, never "no crown".
    const withheld=rec.summary?.benefits?.withheld==='height_not_plausible',EST_KEYS=new Set(['trunkDiameter','rootProtection','benefits','carbonStored','replacementYears','stormwater']);
    return `<p class="ti-missing">${out.map(k=>`${esc(labels[k]||k)}: none for this record (${esc(withheld&&EST_KEYS.has(k)?'withheld: height not plausible':WHY[k]||'not in the release')})`).join('. ')}.</p>`;
  }
  function strip(rec,keys,{id='tiPop',cls='',labels={},ctx=null,title='Key measurements',notes:fns=null}={}){
    if(!rec.loaded)return `<ul class="ti-band ${cls}" aria-busy="true" aria-label="${esc(title)}">${keys.map(()=>'<li class="ti-m ti-m-skel"><i class="ti-skel"></i><i class="ti-skel ti-skel-lg"></i><i class="ti-skel"></i></li>').join('')}</ul><p class="ti-status" role="status">Loading the tree record…</p>`;
    const shown=keys.filter(k=>rec.measures?.[k]);
    return `<ul class="ti-band ${cls}" aria-label="${esc(title)}">${shown.map(k=>metric(rec,k,{id,label:labels[k]||null,ctx,notes:fns})).join('')}</ul>${missing(rec,keys,{...LABELS,...labels})}`;
  }

  // ---------- provenance popover (design system 5): one tap from any value ----------
  function provenance(q,rec){
    const p=q.provenance||{},row=(k,v)=>v?`<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`:'';
    const d=p.date?.text||'',retrieved=/^snapshot/.test(d)?d.replace(/^snapshot\s*/,''):/^Retrieved /.test(d)?d.replace(/^Retrieved\s*/,''):null;
    const observed=/^release/.test(d)?null:/not measured/.test(d)?'Not measured':retrieved?null:d.replace(/\s*survey$/,'');
    const method=p.method?`${esc(p.method.text||'')}${p.method.href?` <a class="ti-mlink" href="${esc(p.method.href)}"${newTab(p.method.href)}>Method</a>`:''}${p.method.id?`<small><code>${esc(p.method.id)}</code></small>`:''}`:null;
    const ids=[p.model?.id,p.model?.version].filter(x=>x&&x!==p.method?.id);
    const model=p.model?(ids.map(x=>`<code>${esc(x)}</code>`).join(' ')+(p.model.validation?`<small>${esc(p.model.validation)}</small>`:''))||null:null;
    // The range as displayed (rounded by the data-sheet rule), with the basis the record gives for it. Measured
    // values call their spread what it is: the other estimates in the record.
    const fr=fmtRange(q),raw=q.range?.text||'',ut=p.uncertainty?.text||'';
    const unc=ut&&raw&&fr&&ut.startsWith(raw)?fr+ut.slice(raw.length):ut||(fr?`${fr}${q.range?.basis?`, ${q.range.basis}`:''}`:null);
    const stored=p.dataset?`<code>${esc(p.dataset)}${p.field?'.'+esc(p.field):''}</code>${num(q.value)!==null?` = ${esc(String(Math.round(q.value*1000)/1000))}`:''}`:null;
    const kind=isEstimate(q)?estimateBadge:`<span class="ti-kind">${esc(KINDS[q.kind]||q.kind)}</span>`;
    return `<div class="ti-pop-head"><h3 id="tiPopT">${esc(q.label)}</h3><button type="button" class="ti-x" data-close aria-label="Close">×</button></div>
      <p class="ti-pop-value"><b>${esc(text(q))}</b> ${kind}</p>
      <dl class="ti-prov">${isEstimate(q)?row('Range',esc(unc||'No range stored for this value')):unc?row('Uncertainty',esc(unc)):''}${row('Source',esc(p.source))}${row('Observed',observed?esc(observed):null)}${row('Retrieved',retrieved?esc(retrieved):null)}
        ${row('Method',method)}${row('Model',model)}${row('Stored as',stored)}${row('Release',esc(versionLine(rec)))}
        ${rec.number?row('Tree number',`<code>${esc(rec.number)}</code> <button type="button" class="ti-copy" data-copy="${esc(rec.number)}">Copy</button>`)+row('Record ID',`<code>${esc(rec.id)}</code>`)
          :row('Tree ID',`<code>${esc(rec.id)}</code> <button type="button" class="ti-copy" data-copy="${esc(rec.id)}">Copy</button>`)}${row('Note',p.note?esc(p.note):null)}</dl>`;
  }

  // ---------- survey years ----------
  // Each survey's height says which measure it is: 2013 and 2016 at the canopy point matched to this tree, 2024 the
  // crown's maximum. Earlier surveys without a link read "not linked" (never "not detected": the crown may be there).
  // A chip is two lines (the year and height; the measure, or why there is no height, under them), so it never needs
  // more width than its share of the strip (TS-15: one line overprinted its neighbours in the 360 px sticky bar).
  const lineShort=s=>s.status==='outside'?'outside survey':s.year===2024?'no crown linked':'not linked';
  const MEASURE={early:'matched point',now:'crown maximum'};
  function years(rec,{sel=2024,label='Survey year',note=false}={}){
    const S=rec.surveys||[];if(!S.length)return '';
    const btns=S.map(s=>{const h=s.height?text(s.height):null,m=s.height?(s.year===2024?MEASURE.now:MEASURE.early):null;
      return `<button type="button" class="ti-yb ti-yb-s${s.height?'':' is-none'}" data-year="${s.year}" aria-pressed="${s.year===sel}" title="${esc(h?`${s.year} LiDAR survey: ${h}, ${m}`:(s.line||''))}"><span class="ti-yb-l"><b>${s.year}</b>${h?`<span>${esc(h)}</span>`:''}</span>${m?`<small class="ti-yb-m">${esc(m)}</small>`:`<small class="ti-yb-x">${esc(lineShort(s))}</small>`}</button>`;}).join('');
    return `<div class="ti-years" role="group" aria-label="${esc(label)}: highlights it in every figure">${btns}</div>${note?yearsNote(rec):''}`;
  }
  // One line under the year strip when the earlier surveys hold no crown linked to the tree.
  function yearsNote(rec){
    const early=(rec.surveys||[]).filter(s=>s.year!==2024);
    if(!early.length||early.some(s=>s.height))return '';
    if(early.every(s=>s.status==='outside'))return `<p class="ti-years-note">Outside the area of the ${early.map(s=>s.year).join(' and ')} LiDAR surveys.</p>`;
    return '<p class="ti-years-note">LiDAR crowns from 2013 and 2016 are not linked to this tree; the aerial photos show the site in each year.</p>';
  }
  // A height change between surveys, like for like (matched canopy point): within ±1 m it is "no detectable change"; a
  // rate never prints as "−0".
  function rateText(value,{change=null,from=null,to=null}={}){
    const NC=root.ALTOTreeRecord?.NO_CHANGE_M??1,v=num(value),dh=num(change);
    if((dh!==null&&Math.abs(dh)<=NC)||v===null||Math.abs(v)<0.005)return `no detectable change${from&&to?` ${from}–${to}`:''}`;
    return `${v>0?'+':'−'}${nf(Math.abs(v),2)} m a year${from&&to?` ${from}–${to}`:''}`;
  }
  // Survey change in plain words (concept C): which surveys hold this tree, and their heights at the matched canopy point
  // (like for like); the 2024 crown maximum, a different measure, said apart.
  function surveySentence(rec){
    const S=rec.surveys||[];if(!S.length)return '';
    const early=S.filter(s=>s.year!==2024),hit=early.filter(s=>s.status==='matched'&&s.height),now=S.find(s=>s.year===2024);
    if(!hit.length){
      if(early.length&&early.every(s=>s.status==='outside'))return `This tree is outside the area of the ${early.map(s=>s.year).join(' and ')} LiDAR surveys, so 2024 is its only survey.`;
      return `No LiDAR crown from ${early.map(s=>s.year).join(' or ')} is linked to this tree in this release, so 2024 is its only survey.`;
    }
    const miss=early.filter(s=>!hit.includes(s)),f1=v=>`${nf1(v)} m`;
    const pts=[...hit.map(s=>`${f1(s.height.value)} ${s.year}`),...(num(now?.matchedHeight)!==null?[`${f1(now.matchedHeight)} 2024`]:[])];
    const rates=(rec.surveyChange?.rates||[]).filter(x=>num(x.value)!==null||num(x.change)!==null).map(x=>rateText(x.value,{change:x.change,from:x.from,to:x.to}));
    const crownMax=now?.height?` 2024 crown maximum ${text(now.height)} (a different measure).`:'';
    return `Height at the matched canopy point: ${pts.join(', ')}${rates.length?` (${rates.join('; ')})`:''}.${crownMax}${miss.length?` No LiDAR crown from ${miss.map(s=>s.year).join(' or ')} is linked to it.`:''}`;
  }
  // Height: the LiDAR returns per 1 m of height (where stored) with each survey's height across it.
  function heightFigure(rec,{width=124,height=232,labels=true}={}){
    const P=rec.lidar?.profile,S=(rec.surveys||[]).filter(s=>num(s.height?.value)!==null);
    const base=(rec.lidar?.measurements||[]).find(x=>x.key==='liveCrownBase');
    const top=Math.max(1,...S.map(s=>s.height.value),P?P.bands.length:0,num(rec.measures?.height?.value)||0);
    if(!S.length&&!P)return '';
    const H=nice(top*1.06),L=26,R=width-(labels?34:8),T=10,B=height-14,y=v=>r1(B-(v/H)*(B-T));
    let s='';
    const tk=ticks(H,4);for(const t of tk)s+=`<path class="ti-grid" d="M${L} ${y(t)}H${R}"/><text class="ti-tk" x="${L-5}" y="${y(t)+3.5}" text-anchor="end">${nf(t)}${t===tk[tk.length-1]?' m':''}</text>`;
    if(P){const mx=Math.max(...P.bands),bh=(B-T)/H;P.bands.forEach((v,i)=>{if(!v)return;s+=`<rect class="ti-pf" x="${L}" y="${r1(y(i+1)+0.5)}" width="${r1(Math.max(0.8,v/mx*(R-L-2)))}" height="${r1(Math.max(0.8,bh-1))}"><title>${i}–${i+1} m: ${nf(v)} returns</title></rect>`;});}
    if(base&&num(base.value)!==null)s+=`<g class="ti-base"><path d="M${L} ${y(base.value)}H${R}"/><title>Live crown base ${esc(text(base))}</title></g>`;
    const ys=S.map(sv=>y(sv.height.value)).sort((a,b)=>a-b),tight=ys.some((v,i)=>i&&v-ys[i-1]<12);
    for(const sv of S){const yy=y(sv.height.value);
      s+=`<g class="ti-yr" data-year="${sv.year}"><title>${sv.year} LiDAR survey: ${esc(text(sv.height))}</title><rect class="ti-hit" x="${L}" y="${r1(yy-6)}" width="${r1(R-L+(labels?30:0))}" height="12"/><path d="M${L} ${yy}H${R}"/>${labels?`<text x="${R+4}" y="${r1(yy+3.5)}">${sv.year}</text>`:''}</g>`;}
    s+=`<path class="ti-ax" d="M${L} ${T}V${B}H${R}"/>`;
    const aria=`Height at each survey${P?' over LiDAR returns per 1 m of height':''}: ${S.map(sv=>`${sv.year} ${text(sv.height)}`).join(', ')}`;
    return `<svg class="ti-fig ti-hfig${tight?' ti-lbl-sel':''}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">${s}</svg>`;
  }
  // Height at each survey on a time axis, like for like: the canopy height at the matched point in 2013, 2016 and 2024
  // (dots joined by a thin trend line); the 2024 crown maximum, a different measure, as its own mark (a diamond with the
  // record's other estimates as a whisker). The height scenario to 2040 is a hatched band when it is loaded (an estimate).
  function surveyChart(rec,{width=300,height=168,scenario=true}={}){
    const S=rec.surveys||[];if(!S.length)return '';
    const sc=scenario&&rec.scenario?.status==='ready'?rec.scenario:null;
    const now=S.find(sv=>sv.year===2024),pt=sv=>sv.year===2024?num(sv.matchedHeight):sv.height?num(sv.height.value):null;
    if(!S.some(sv=>pt(sv)!==null)&&!now?.height&&!sc)return '';
    const vals=[...S.map(pt).filter(v=>v!==null),...(now?.height?[now.height.value]:[])],q=rec.measures?.height,hi=num(q?.range?.high);
    const H=nice(Math.max(1,...vals,hi||0,...(sc?sc.points.map(p=>p.high):[]))*1.12),x0=2011.5,x1=sc?2041:2025.5,L=30,R=width-12,T=14,B=height-26;
    const X=yr=>r1(L+(yr-x0)/(x1-x0)*(R-L)),Y=v=>r1(B-v/H*(B-T));
    let s='';
    const tk=ticks(H,4);for(const t of tk)s+=`<path class="ti-grid" d="M${L} ${Y(t)}H${R}"/><text class="ti-tk" x="${L-5}" y="${Y(t)+3.5}" text-anchor="end">${nf(t)}${t===tk[tk.length-1]?' m':''}</text>`;
    s+=`<path class="ti-ax" d="M${L} ${B}H${R}"/>`;
    if(sc){const pts=[{year:sc.anchor.year,height:sc.anchor.height,low:sc.anchor.height,high:sc.anchor.height},...sc.points],e=pts[pts.length-1];
      s+=`<g class="ti-scen"><title>${esc(`Height scenario, estimate: ${nf(e.height,1)} m in ${e.year}, range ${nf(e.low,1)}–${nf(e.high,1)} m`)}</title><path class="ti-scen-band" d="M${pts.map(p=>`${X(p.year)} ${Y(p.high)}`).join('L')}L${pts.slice().reverse().map(p=>`${X(p.year)} ${Y(p.low)}`).join('L')}Z"/><path class="ti-scen-line" d="M${pts.map(p=>`${X(p.year)} ${Y(p.height)}`).join('L')}"/><text class="ti-tk" x="${X(e.year)}" y="${r1(Y(e.high)-6)}" text-anchor="end">Scenario (estimate)</text></g><text class="ti-tk" x="${X(2040)}" y="${B+16}" text-anchor="middle">2040</text>`;}
    // The trend: matched-point heights only.
    const trend=S.map(sv=>({year:sv.year,v:pt(sv)})).filter(p=>p.v!==null);
    if(trend.length>1)s+=`<path class="ti-trend" d="M${trend.map(p=>`${X(p.year)} ${Y(p.v)}`).join('L')}"/>`;
    // Year labels: 2013 and 2016 sit close together when the scenario stretches the axis to 2040.
    const close=X(2016)-X(2013)<36;
    for(const sv of S){const x=X(sv.year),an=close&&sv.year===2013?'end':close&&sv.year===2016?'start':'middle',dx=close&&sv.year===2013?3:close&&sv.year===2016?-3:0;
      s+=`<text class="ti-tk" x="${x+dx}" y="${B+16}" text-anchor="${an}">${sv.year}</text>`;
      const v=pt(sv),isNow=sv.year===2024;
      let g='';
      if(v!==null){const yy=Y(v);g+=`<circle cx="${x}" cy="${yy}" r="5"><title>${sv.year}: ${esc(`${nf1(v)} m`)} at the matched canopy point</title></circle>${isNow&&now?.height?'':`<text class="ti-val" x="${x}" y="${r1(yy-11)}" text-anchor="middle">${esc(`${nf1(v)} m`)}</text>`}`;}
      if(isNow&&now?.height){const cy=Y(now.height.value),rg=q?.range&&fmtRange(q),dx2=v!==null?9:0;
        const whisk=rg?`<path class="ti-wh" d="M${x+dx2} ${Y(q.range.low)}V${Y(q.range.high)}M${x+dx2-4} ${Y(q.range.low)}h8M${x+dx2-4} ${Y(q.range.high)}h8"/>`:'';
        g+=`<g class="ti-cmax"><title>2024 crown maximum: ${esc(text(now.height))}${rg?` (other estimates in this record ${esc(rg)})`:''}; a different measure from the matched-point heights</title>${whisk}<path d="M${x+dx2} ${r1(cy-6)}l6 6l-6 6l-6-6z"/><text class="ti-val" x="${x+dx2}" y="${r1(cy-11)}" text-anchor="middle">${esc(text(now.height))} max</text></g>`;}
      if(g)s+=`<g class="ti-yr" data-year="${sv.year}"><rect class="ti-hit" x="${x-22}" y="${T}" width="44" height="${B-T}"/>${g}</g>`;
      else s+=`<g class="ti-yr is-none" data-year="${sv.year}"><title>${esc(sv.line||'')}</title><rect class="ti-hit" x="${x-22}" y="${T}" width="44" height="${B-T}"/><circle cx="${x}" cy="${B-1}" r="4.5"/><text class="ti-val" x="${x}" y="${B-10}" text-anchor="middle">${esc(lineShort(sv))}</text></g>`;
    }
    const aria='Height at each LiDAR survey: '+S.map(sv=>{const v=pt(sv);return `${sv.year} ${v!==null?`${nf1(v)} m at the matched point`:sv.year===2024&&now?.height?'':sv.line}${sv.year===2024&&now?.height?`${v!==null?'; ':''}crown maximum ${text(now.height)}`:''}`;}).join('; ');
    return `<svg class="ti-fig ti-sfig${close?' ti-lbl-sel':''}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">${s}</svg>`;
  }
  // The crown over aerial imagery: the 2024 outline, the record's position, and where an earlier survey was matched.
  function crownFigure(rec,geometry,{width=360,height=220}={}){
    const pos=rec.identity?.position,c=V();if(!c)return '';
    const marks=(rec.surveys||[]).filter(s=>s.position).map(s=>({lon:s.position.lon,lat:s.position.lat,cls:'ti-yr',attrs:` data-year="${s.year}"`,label:String(s.year),r:6}));
    return c.aerialChip({geometry,point:pos?[pos.lon,pos.lat]:null,recorded:!rec.identity.detection&&pos?[pos.lon,pos.lat]:null,width,height,marks,cls:'ti-chip'});
  }
  // Its key: marks named by shape (design system 2.11: swatch shape = mark shape), never by colour alone.
  function figureKey(rec,{geometry=true,profile=false}={}){
    const pos=rec.identity?.position,items=[];
    if(geometry)items.push(['outline','2024 crown']);
    if(!rec.identity?.detection&&pos)items.push(['ring','Recorded position']);
    if((rec.surveys||[]).some(s=>s.position))items.push(['dashed-ring','Where the selected survey was matched']);
    if(profile){items.push(['line','Height at each survey']);if(rec.lidar?.profile)items.push(['bar','LiDAR returns per 1 m of height']);}
    return items.length?`<ul class="ti-key" aria-label="Key">${items.map(([m,t])=>`<li><i class="ti-sw ti-sw-${m}" aria-hidden="true"></i>${esc(t)}</li>`).join('')}</ul>`:'';
  }
  // Caption in the figure template: what it shows · source, date · Method.
  // The aerial figure's caption names the capture (Esri's metadata) and the basemap it comes through; the credit the
  // provider asks for (credits.js aerialFigure) follows it in the caption.
  function imageryText(info){const via=root.ALTOCredits?.AERIAL?.name||'Esri World Imagery';return info?`Aerial imagery: ${info.source}, ${info.date}${info.resolution?` (${nf(info.resolution*100,1)} cm)`:''}, via ${via}`:`Aerial imagery: ${via}`;}

  // ---------- if it were lost ----------
  // Years for a new crown to reach this crown area at the planning rate: one division, not a calendar forecast. The
  // figure's years read "if planted in <year>".
  function regrowthLine(rec,{width=340,height=54}={}){
    const r=rec.replacement,T=num(r?.years);if(T===null||T<=0)return '';
    const start=r.startYear||new Date().getFullYear(),L=8,R=width-8,Y=30,X=t=>r1(L+t/T*(R-L));
    let s=`<rect class="ti-rg-bar" x="${L}" y="${Y-4}" width="${R-L}" height="8" rx="2"/>`;
    for(const m of [{share:0,year:start},...(r.marks||[])]){const x=X(m.share/100*T),end=m.share===100,an=m.share===0?'start':end?'end':'middle';
      s+=`<path class="ti-ax" d="M${x} ${Y-8}v16"/><text class="ti-tk${end?' ti-strong':''}" x="${x}" y="${Y-13}" text-anchor="${an}">${m.year}</text><text class="ti-tk" x="${x}" y="${Y+21}" text-anchor="${an}">${m.share}%</text>`;}
    return `<figure class="ti-rgwrap"><svg class="ti-fig ti-rgfig" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Estimate, if planted in ${start}: a new crown at the planning rate reaches ${(r.marks||[]).map(m=>`${m.share}% of this crown area by ${m.year}`).join(', ')}`)}">${s}</svg><figcaption class="ti-cap">Years if planted in ${start}; share of this crown area at the planning rate.</figcaption></figure>`;
  }
  function lost(rec,{variant='panel'}={}){
    const r=rec.replacement,m=rec.measures||{};
    if(!rec.loaded)return '<i class="ti-skel" style="height:64px"></i>';
    const yrs=m.replacementYears,irr=m.irreplaceability,cr=m.crownReplacement,area=m.crownArea;
    if(!yrs&&!irr&&!cr&&!m.benefits)return '<p class="ti-def">None for this record: no crown estimate for regrowth or benefits.</p>';
    const row=(label,value,badge,p,key)=>value?`<div class="ti-row"><dt>${esc(label)}</dt><dd>${key?`<button type="button" class="ti-v" data-q="${esc(key)}" aria-haspopup="dialog"><b>${value}</b></button>`:`<b>${value}</b>`}${badge?estimateBadge:''}${p?`<small>${p}</small>`:''}</dd></div>`:'';
    const b=yrs?.basisClass,caution=m.height?.flag==='tall'?` Height ${m.height.caution}.`:'';
    const rate=b?`at ${nf(b.rate,1)} m² a year, the planning rate for ${b.words}${b.differs?' (this crown’s release 5.2 class)':''}`:num(r?.rate)?`at ${nf(num(r.rate),1)} m² a year, a planning rate`:'';
    const nc=q=>q?.rangeNote?` ${q.rangeNote}.`:'';
    // Release 6.3: the crown replacement band (from the years alone) or why the crown is not classed, and 25 m or taller as
    // its own fact. Release 6.2: the irreplaceability class.
    const crRow=cr?row('Crown replacement time',esc(cr.notClassed?'Not classed':cr.text),!cr.notClassed,esc(cr.notClassed?`Not classed: ${cr.notClassed.label}.${cr.notClassed.key==='under_5m'?' Crowns under 5 m tall are not banded or compared.':''}`:
      `Band of the regrowth years: ${(r?.bands||[]).map(x=>x.rule).join(', ')}.${nc(cr)}${caution}`),'crownReplacement'):'';
    const tallRow=r?.release63&&r.tallTree?row('Tall tree','25 m or taller',false,'A separate fact; it does not set the crown replacement band.',null):'';
    return `${regrowthLine(rec,{width:variant==='page'?560:340})}<dl class="ti-rows">
      ${yrs?row('Years for a new crown to reach this crown area at the planning rate (crown area only)',`About ${esc(text(yrs))}`,true,esc(`Crown area${area?` (${text(area)})`:''}${rate?` grown ${rate}`:' ÷ the planning rate'}; linear; the crown area only, not height, trunk or age.${nc(yrs)}${caution}`),'replacementYears'):''}
      ${crRow}${tallRow}
      ${irr?row('Irreplaceability',esc(irr.text),true,esc(`${r?.irreplaceability?.definition?`Class rule over estimates: ${r.irreplaceability.definition}.`:'Class rule over the estimated regrowth time and the height.'}${nc(irr)}${caution}`),'irreplaceability'):''}
      ${m.benefits?row('Benefits each year',esc(text(m.benefits)),true,esc(`${line(m.benefits)}.${caution}`),'benefits'):''}
      ${m.carbonStored?row('Carbon stored',esc(text(m.carbonStored)),true,esc(`Held in the trunk, branches and roots.${nc(m.carbonStored)}${caution}`),'carbonStored'):''}
      </dl>${variant==='page'?'<p class="ti-def">Replacement cost in dollars: none for this record (not estimated in this release).</p>':''}`;
  }
  // Field measurements as data rows, for the panel and the tree page (tree-record.js field): each reading first (value; the
  // method at its own height, the dates and who measured; how many measured and the spread across teams; the review),
  // newest first, then ALTO's estimate with its own method. '' for a tree without one, so nothing changes for it.
  function fieldRows(rec){
    const list=rec.field?.status==='ready'?rec.field.entries||[]:[];if(!list.length)return '';
    const row=(label,q,badge,lines)=>`<div class="ti-row"><dt>${esc(label)}</dt><dd><button type="button" class="ti-v" data-q="${esc(q.key)}" aria-haspopup="dialog"><b>${esc(text(q))}</b></button>${badge?estimateBadge:''}${lines.filter(Boolean).map(t=>`<small>${esc(t)}</small>`).join('')}</dd></div>`;
    const est=rec.measures?.trunkEstimate;
    return `<dl class="ti-rows ti-field">${list.map(q=>row('Measured',q,false,[[q.words.method,q.field.dates?.text,q.field.by].filter(Boolean).join(' · '),q.words.counts,q.words.review])).join('')}${est?row('ALTO estimate',est,true,[rangeText(est),est.how]):''}</dl>`;
  }
  // Root space as data rows (concept A): the dripline radius (2024 crown outline) and, for a scheduled tree, the Unitary
  // Plan protected root zone (Chapter J); the BS 5837 radius (a UK standard, 12 × the trunk estimate) for comparison; the
  // effective rooting radius and its basis; an explicit line when the release has no scenario for the tree.
  function rootRows(rec){
    const R=rec.roots,q=rec.measures?.rootProtection,M=rec.measures||{};
    const row=(label,value,sub,key,est=false)=>value?`<div class="ti-kv"><dt>${esc(label)}</dt><dd>${key?`<button type="button" class="ti-v" data-q="${esc(key)}" aria-haspopup="dialog">${value}</button>`:value}${est?` ${estimateBadge}`:''}${sub?`<small>${sub}</small>`:''}</dd></div>`:'';
    const top=`${M.dripline?row(M.dripline.label,`${esc(text(M.dripline))}`,esc(line(M.dripline)+'.'),'dripline'):''}
      ${M.rootZone?row(LABELS.rootZone,`at least ${esc(text(M.rootZone))}`,'Trunk to canopy edge, on the 2024 crown outline (Chapter J definition). Auckland Council determines the zone on site.','rootZone'):''}
      ${M.rootZoneColumnar?row(LABELS.rootZoneColumnar,esc(text(M.rootZoneColumnar)),'Half the tree height, for a columnar crown (Chapter J definition).','rootZoneColumnar'):''}`;
    if(!R)return `<dl class="ti-kvs">${top}</dl><p class="ti-def">BS 5837 radius and root-space scenario: none for this record (the release has no root-space scenario for this tree).</p>`;
    const rg=R.rpaRange,fr=q&&fmtRange(q);
    return `<dl class="ti-kvs">${top}
      ${row(LABELS.rootProtection,num(R.rpaRadius)!==null?`${nf1(R.rpaRadius)} m · ${esc(areaText(R.rpaArea))}`:null,
        esc([rg&&fr?`Range ${fr} (${areaText(rg.areaLow).replace(' m²','')}–${areaText(rg.areaHigh)}) from the model spread`:q?.rangeNote||null,`${R.rpaBasis}; area capped at ${R.rule.areaCap} m²`].filter(Boolean).join('. ')+'.'),q?'rootProtection':null,!!q)}
      ${row('Effective rooting radius',num(R.effectiveRadius)!==null?`${nf1(R.effectiveRadius)} m · ${esc(areaText(R.effectiveArea))}`:'<span class="ti-na">None for this record</span>',num(R.effectiveRadius)===null?'Needs the paving around the tree, which this record does not have.':'Scenario from crown size and known paving.')}
      ${row('Foraging radius',num(R.foragingRadius)!==null?`${nf1(R.foragingRadius)} m`:null,'1.5 × the crown radius.')}
      ${row('Constraint',R.constraint?esc(cap(R.constraint)):null,R.basis?esc(R.basis):null)}
      ${row('Status',/scenario only/i.test(R.confidence||'scenario only')?'Scenario only, not validated':esc(cap(R.confidence)),null)}</dl>`;
  }

  // ---------- comparisons: where the tree sits (release comparison tables only; fixed n) ----------
  const METRICS={height:{label:'Height',fmt:v=>`${nf(v,1)} m`,log:false},crownArea:{label:'Crown area',fmt:v=>`${v<10?nf(v,1):nf(Math.round(v))} m²`,log:true},benefits:{label:'Benefits',fmt:v=>`${money(v)}/yr`,log:true}};
  // One strip: the group's spread (quantile bands, or each value as a dot) and this tree's place on it.
  // A quantile strip ends at the group's 99th percentile: the top value can be a crown 55 m or more, a structure or noise,
  // so it is named apart as "highest value (unverified)". A table without a 99th percentile (street groups are stored in
  // 5% steps) ends at its highest stored percentile below the top, named as such ("95th pct"), never at the top value.
  // A tree beyond the strip's end sits at that end.
  const pctWord=p=>{const n=Number(p);if(!Number.isInteger(n))return `${n}th`;const v=n%100,sf=['th','st','nd','rd'];return n+(sf[(v-20)%10]||sf[v]||sf[0]);};
  function distStrip(metric,{value,dist,text:t,n,width=176,height=42}){
    const M=METRICS[metric],v=num(value);if(!M||v===null||!dist)return '';
    let lo,hi,q=null,dots=null,max=null,endP=null;
    if(dist.kind==='values'){const a=dist.values.filter(x=>num(x)!==null).map(Number).sort((x,y)=>x-y);if(!a.length)return '';lo=a[0];hi=a[a.length-1];dots=a;}
    else{const Q=dist.quantiles,Pp=(dist.probabilities||[]).map(Number),at=p=>{const i=Pp.indexOf(p);return i>=0&&num(Q[i])!==null?Number(Q[i]):null;};if(!Q?.length)return '';
      lo=Number(Q[0]);const top=Pp[Pp.length-1]===100?at(100):null,below=Pp.filter(p=>p>=50&&p<100&&at(p)!==null);
      endP=below.includes(99)?99:below.length?Math.max(...below):null;max=endP!==null?top:null;hi=endP!==null?at(endP):(top??Number(Q[Q.length-1]));
      q={p5:at(5)??at(10),p25:at(25),p50:at(50),p75:at(75),p95:at(95)??at(90)};}
    lo=Math.min(lo,v);if(dots)hi=Math.max(hi,v);
    const beyond=!dots&&v>hi,vx=beyond?hi:v;
    const log=M.log&&lo>0,f=log?Math.log10:x=>x,a=f(log?lo:Math.min(0,lo)),b=f(hi)+(f(hi)-a)*0.02||1;
    const L=4,R=width-4,X=x=>r1(L+(f(Math.max(x,log?lo:x))-a)/(b-a||1)*(R-L)),Y=20;
    let s=`<path class="ti-ax" d="M${L} ${Y+8}H${R}"/>`;
    if(q){if(q.p5!==null&&q.p95!==null)s+=`<rect class="ti-q1" x="${X(q.p5)}" y="${Y-4}" width="${r1(Math.max(1,X(q.p95)-X(q.p5)))}" height="8" rx="2"/>`;
      if(q.p25!==null&&q.p75!==null)s+=`<rect class="ti-q2" x="${X(q.p25)}" y="${Y-4}" width="${r1(Math.max(1,X(q.p75)-X(q.p25)))}" height="8" rx="2"/>`;
      if(q.p50!==null)s+=`<path class="ti-q3" d="M${X(q.p50)} ${Y-6}v12"/>`;}
    if(dots)s+=dots.map(d=>`<circle class="ti-dot" cx="${X(d)}" cy="${Y}" r="3"/>`).join('');
    s+=`<g class="ti-me${beyond?' is-beyond':''}"><path d="M${X(vx)} ${Y-9}v18"/><circle cx="${X(vx)}" cy="${Y}" r="4.5"/></g>`;
    const tl=log?[lo,hi]:[Math.min(0,lo),hi];
    s+=`<text class="ti-tk" x="${L}" y="${height-1}">${esc(M.fmt(tl[0]))}</text><text class="ti-tk" x="${R}" y="${height-1}" text-anchor="end">${esc(`${endP!==null?`${pctWord(endP)} pct `:''}${M.fmt(tl[1])}`)}</text>`;
    if(q&&q.p50!==null){const xm=X(q.p50),an=xm<48?'start':xm>width-48?'end':'middle';s+=`<text class="ti-tk" x="${xm}" y="8" text-anchor="${an}">median ${esc(M.fmt(q.p50))}</text>`;}
    const aria=`${M.label}: this tree ${M.fmt(v)}${beyond?' (beyond the strip’s end)':''}; ${t||''}; n = ${nf(n)}${q?`; median ${M.fmt(q.p50)}, middle half ${M.fmt(q.p25)}–${M.fmt(q.p75)}`:''}${endP!==null?`; the strip ends at the ${pctWord(endP)} percentile, ${M.fmt(hi)}`:''}${max!==null?`; highest value (unverified) ${M.fmt(max)}`:''}${log?'; log scale':''}`;
    return `<svg class="ti-fig ti-dist" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">${s}</svg>${max!==null?`<small class="ti-dist-max">highest value (unverified) ${esc(M.fmt(max))}</small>`:''}`;
  }
  // Where the tree sits, for the key measurements: its local board (else Auckland) in the release's comparison tables, the
  // set named in full ("Top 0.5% of conifer crowns in Albert-Eden (n = 1,058)"); an assumed class is said as one.
  const boardName=n=>/Local Board$/.test(n)?n:`${n} Local Board`;
  const shortBoard=n=>String(n||'').replace(/\s+Local Board$/,'');
  // Benefits rank among sensitivity-scenario values, and say so.
  function setWords(c,sc,{short=false,metric=null}={}){
    const cls=(c.class?.label||'similar').toLowerCase(),where=sc.scope==='board'?`in ${short?shortBoard(sc.name):boardName(sc.name)}`:'across Auckland';
    const of=metric==='benefits'?`of sensitivity-scenario values for ${cls} crowns`:`of ${cls} crowns`;
    return c.class?.assumed?`compared with ${metric==='benefits'?`sensitivity-scenario values for ${cls} crowns`:`${cls} crowns`} ${where} (assumed class; growth form not determined; n = ${nf(sc.n)})`:`${of} ${where} (n = ${nf(sc.n)})`;
  }
  function contextLines(rec){
    const c=rec.context;if(c?.status!=='ready')return null;
    if(rec.measures?.height?.flag==='tall')return null;
    const sc=c.scopes.find(x=>x.scope==='board'&&x.status==='ready')||c.scopes.find(x=>x.scope==='auckland'&&x.status==='ready');if(!sc)return null;
    const out={};
    for(const k of ['height','crownArea','benefits'])if(sc.metrics?.[k])out[k]={text:sc.metrics[k].text,where:setWords(c,sc,{short:true,metric:k})};
    return {lines:out,scope:sc,klass:c.class};
  }
  function contextSentence(rec){
    const L=contextLines(rec);if(!L)return rec.context?.status==='excluded'?esc(rec.context.note||''):'';
    const m=L.scope.metrics,parts=['height','crownArea','benefits'].filter(k=>m[k]).map(k=>{const t=m[k].clause||m[k].text;return t.charAt(0).toLowerCase()+t.slice(1)+(k==='benefits'?' (of sensitivity-scenario values)':'');});
    const c=rec.context,cls=esc((L.klass?.label||'similar').toLowerCase()),where=L.scope.scope==='board'?`in ${esc(boardName(L.scope.name))}`:'across Auckland';
    return `${c.class?.assumed?`Compared with ${cls} crowns ${where} (assumed class; growth form not determined)`:`Among ${cls} crowns ${where}`} (n = ${nf(L.scope.n)}): ${esc(parts.join('; '))}.`;
  }

  // ---------- measurements by source: which source says what, when ----------
  const COL={v5:'Crown, current method',v4:'Crown, earlier method',raster:'Raster crown, earlier method',chm:'Height at the record',lidar2016:'2016 LiDAR survey',lidar2013:'2013 LiDAR survey'};
  function colYear(c){const m=String(c.when||'').match(/^(2013|2016|2024)/);return m?Number(m[1]):null;}
  function colWhen(c){const w=String(c.when||'');return w.replace(/, matched canopy$/,', matched to this tree').replace(/^snapshot /,'Retrieved ');}
  function matrix(rec){
    const B=rec.bySource;if(!B?.columns?.length)return '<p class="ti-def">None for this record: no values by source.</p>';
    const fk={height:'height',crownDiameter:'crownDiameter',crownArea:'crownArea',trunk:'trunkDiameter'};
    const cell=(c,r,ci)=>{const v=c[r.key];if(v===null||v===undefined||v==='')return '<td class="ti-na">–</td>';
      if(r.key==='note')return `<td class="ti-note">${esc(v)}</td>`;
      if(r.key==='form')return `<td>${esc(c.formKind==='model'?cleanForm(v):hybrid(v))}${c.formKind==='model'?` ${estimateBadge}`:''}</td>`;
      const nv=num(v);if(nv===null)return `<td>${esc(v)}</td>`;
      const f=fmtValue(fk[r.key]||r.key,nv,{measuredTape:r.key==='trunk'&&c.trunkKind==='measured'})||[nf(nv,1),''],est=r.key==='trunk'&&(c.trunkKind||'model')==='model';
      const note=r.key==='height'&&c.heightNote?`<small>${esc(c.heightNote)}</small>`:'';
      return `<td class="num"><button type="button" class="ti-v" data-cell="${ci}:${esc(r.key)}" aria-haspopup="dialog">${esc(f[1]?`${f[0]} ${f[1]}`:f[0])}</button>${est?` ${estimateBadge}`:''}${note}</td>`;};
    const head=B.columns.map(c=>{const y=colYear(c);return `<th scope="col"${y?` data-year="${y}"`:''}><span>${esc(COL[c.key]||c.label)}</span><small>${esc(colWhen(c))}</small>${c.method?.href?`<a class="ti-mlink" href="${esc(c.method.href)}"${newTab(c.method.href)}>Method</a>`:''}</th>`;}).join('');
    const rows=B.rows.filter(r=>B.columns.some(c=>c[r.key]!==null&&c[r.key]!==undefined&&c[r.key]!=='')).map(r=>`<tr><th scope="row">${esc(r.label)}</th>${B.columns.map((c,ci)=>{const y=colYear(c),td=cell(c,r,ci);return y?td.replace('<td',`<td data-year="${y}"`):td;}).join('')}</tr>`).join('');
    return `<div class="ti-scroll" tabindex="0" role="region" aria-label="Measurements by source"><table class="ti-matrix"><thead><tr><th scope="col">Measurement</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  // A cell of the matrix as a quantity, for its provenance popover.
  function cellQuantity(rec,ref){
    const [ci,key]=String(ref).split(':'),c=rec.bySource?.columns?.[Number(ci)];if(!c)return null;
    const qk={height:'height',crownDiameter:'crownDiameter',crownArea:'crownArea',trunk:'trunkDiameter'}[key]||key;
    const kind=key==='trunk'?(c.trunkKind||'model'):key==='crownDiameter'?'derived':c.key==='source'?'recorded':'measured';
    const trunkQ=key==='trunk'&&kind==='model'&&rec.measures?.trunkDiameter?.kind==='model'?rec.measures.trunkDiameter:null;
    return {key:qk,label:`${({height:'Height',crownDiameter:'Crown diameter',crownArea:'Crown area',trunk:'Trunk diameter'})[key]||key}: ${COL[c.key]||c.label}`,value:c[key],unit:UNIT_OF[qk]||null,text:null,kind,
      range:trunkQ?.range||null,provenance:trunkQ?trunkQ.provenance:{source:c.label,date:c.when?{text:c.when}:null,method:c.method||null,note:key==='height'?c.heightNote||null:c.note||null,release:rec.release?.data||null}};
  }

  // ---------- the tree page's sections, for its navigation and the panel's links into it (concept C) ----------
  const SECTIONS=[['metrics','Key measurements','Measurements'],['structure','Crown by survey','Crown by survey'],['imagery','Aerial imagery through time','Imagery'],['compare','Among similar trees','Similar trees'],['lost','If it were lost','If it were lost'],
    ['roots','Root space','Root space'],['sources','Measurements by source','By source'],['records','Records and identifiers','Records'],['species','Species and growth form','Species'],
    ['benefits','Benefits each year','Benefits'],['mapped','How this tree was mapped','How it was mapped'],['history','Releases and reviews','Releases'],['place','Place and property','Place'],
    ['know','Ground visits and contributions','Ground visits'],['data','Data, versions and citation','Data and citation']];
  // A one-line teaser per section, from the record (what the reader finds there).
  function teasers(rec){
    const m=rec.measures||{},c=rec.context,sv=rec.surveys||[],b=rec.identity?.badges?.find(x=>x.key==='records');
    const matched=sv.filter(s=>s.height).map(s=>s.year),ctx=contextLines(rec),k=ctx?Object.keys(ctx.lines)[0]:null;
    const cols=rec.bySource?.columns?.length||0,rel=rec.history?.releases?.length||0,rev=rec.corrections?.items?.length||0;
    return {
      metrics:[m.height?text(m.height):null,m.crownArea?text(m.crownArea):null,m.trunkDiameter?`trunk ${text(m.trunkDiameter)}${isEstimate(m.trunkDiameter)?' (estimate)':''}`:null].filter(Boolean).join(' · ')||'None for this record',
      structure:matched.length>1?`Height in ${matched.join(', ')}`:matched.length?`${matched[0]} survey only`:'No survey height',
      imagery:'The crown in each aerial survey since 2010',
      compare:ctx&&k?`${ctx.lines[k].text} ${ctx.lines[k].where}`:c?.status==='pending'?'Street, local board and Auckland':c?.status==='ready'?'No group for this tree':c?.status==='excluded'?'Not compared: unusually tall for Auckland':'Comparison tables not yet published',
      lost:m.replacementYears?`About ${text(m.replacementYears)} for a new crown to reach this area (estimate)`:'None for this record',
      roots:m.dripline?`${m.dripline.basis==='equal_area'?'Equal-area crown radius':'Dripline radius'} ${text(m.dripline)}`:m.rootProtection?`BS 5837 radius ${text(m.rootProtection)} (estimate)`:'None for this record',
      sources:cols?'Each value with its source and date':'None for this record',
      records:b?.label||`${nf(rec.identity?.recordCount||1)} record`,
      species:rec.identity?.nameMulti?`Recorded as: ${rec.identity.recordedAs}`:rec.identity?.nameKind==='recorded'?`${rec.identity.title}, as recorded`:rec.identity?.nameKind==='model'?title(rec.identity).text:'No species recorded',
      benefits:m.benefits?`${text(m.benefits)} (estimate)`:'None for this record',
      mapped:'Crown outline, link and LiDAR measurements',
      history:`${nf(rel)} release${rel===1?'':'s'} · ${rev?`${nf(rev)} review${rev===1?'':'s'}`:'no reviews'}`,
      place:rec.place?.board?.name?boardName(rec.place.board.name):'Local board, property and nearby trees',
      know:'Species, planting year, removal, outline',
      data:'Cite this tree · every stored field'};
  }
  function pageLinks(rec,treeUrl,{only=null}={}){
    const t=teasers(rec),base=String(treeUrl||'').replace(/#.*$/,'');
    return `<ol class="ti-pagelinks">${SECTIONS.map(([id,ttl],i)=>only&&!only.includes(id)?'':`<li><a href="${esc(base)}#m-${id}"><span class="ti-pl-n">${i+1}</span><span class="ti-pl-t">${esc(ttl)}</span><span class="ti-pl-d">${esc(t[id])}</span></a></li>`).join('')}</ol>`;
  }

  // ---------- the tree page's sticky stack (A11Y-01) ----------
  // The app bar and the section bar stay on screen while they take at most a fifth of the window's height; past that the
  // section bar scrolls with the page (short windows, the phone's two-row bar), and past that the app bar too. The
  // stack that stays is what focus and section links must clear: html scroll-padding-top and each section's
  // scroll-margin-top are the stack plus 8 px.
  const STACK_GAP=8,STACK_SHARE=0.2;
  function stickyPlan({top=0,bar=0,height=0}={}){
    const cap=Math.max(0,+height||0)*STACK_SHARE,t=Math.max(0,+top||0),b=Math.max(0,+bar||0);
    const barStatic=t+b>cap,topStatic=t>cap,stack=topStatic?0:barStatic?t:t+b;
    return {barStatic,topStatic,stack,offset:stack+STACK_GAP,share:height?+(stack/height).toFixed(3):0};
  }
  // Where the window must scroll for a section's top to sit just below the stack (a section link, "Know this tree?").
  function sectionScroll(sectionTop,scrollY,offset){return Math.max(0,Math.round((+sectionTop||0)+(+scrollY||0)-(+offset||0)));}

  // ---------- binding: one selected survey year across a whole view; provenance on any value ----------
  function quantity(rec,key){return rec.measures?.[key]||(rec.lidar?.measurements||[]).find(x=>x.key===key)||(rec.field?.entries||[]).find(x=>x.key===key)||null;}
  function setYear(scope,year,{preview=false}={}){
    const y=String(year);
    scope.dataset.year=y;
    scope.querySelectorAll('.ti-yb').forEach(b=>{if(!preview)b.setAttribute('aria-pressed',String(b.dataset.year===y));b.classList.toggle('is-preview',preview&&b.dataset.year===y);});
    scope.querySelectorAll('[data-year]:not(.ti-yb)').forEach(el=>el.classList.toggle('is-sel',el.dataset.year===y));
    scope.querySelectorAll('[data-for-year]').forEach(el=>{el.hidden=el.dataset.forYear!==y;});
    scope.querySelectorAll('.ti-m').forEach(el=>el.classList.toggle('is-dim',y!=='2024'&&!(el.dataset.years||'').includes(y)));
  }
  function popover(scope,id){
    // The popover moves next to its trigger when it opens (A11Y-09), so look for it anywhere in the scope.
    let pop=scope.querySelector(`#${id}.ti-pop`)||scope.querySelector(':scope > .ti-pop');
    if(!pop){pop=document.createElement('div');pop.className='ti-pop';pop.id=id;pop.setAttribute('role','dialog');pop.setAttribute('aria-labelledby','tiPopT');pop.hidden=true;scope.append(pop);}
    return pop;
  }
  // One set of document listeners per popover id: a panel that re-renders replaces its own, never adds more.
  const bound=new Map();
  function bind(scope,rec,{onYear=null,initial=2024,popId='tiPop'}={}){
    if(!scope||!rec)return;
    bound.get(popId)?.abort();const ac=new AbortController();bound.set(popId,ac);const sig={signal:ac.signal};
    let current=String(initial),opener=null;
    const apply=(y,preview)=>{setYear(scope,y,{preview});if(onYear)try{onYear(Number(y),{preview});}catch(e){console.error(e);}};
    apply(current,false);
    const pop=popover(scope,popId);
    // Closing returns focus to the value that opened it, unless focus has already moved on (refocus false).
    const close=({refocus=true}={})=>{if(pop.hidden)return;pop.hidden=true;scope.querySelectorAll('[aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'));if(refocus)opener?.focus({preventScroll:true});opener=null;};
    // A11Y-09: the popover sits in the DOM right after its trigger, so Tab and a screen reader meet it where it opened
    // and Tab out of it reaches what follows the value. It stays at the end of the scope only where a positioned box
    // between the trigger and the scope would clip or misplace it.
    const place=btn=>{
      let ok=true;for(let el=btn.parentElement;el&&el!==scope;el=el.parentElement)if(getComputedStyle(el).position!=='static'){ok=false;break;}
      if(ok){if(btn.nextElementSibling!==pop)btn.after(pop);}else if(pop.parentElement!==scope||scope.lastElementChild!==pop)scope.append(pop);
    };
    const open=(q,btn)=>{
      place(btn);
      pop.innerHTML=provenance(q,rec);pop.hidden=false;opener=btn;btn.setAttribute('aria-expanded','true');
      const narrow=matchMedia('(max-width: 759px)').matches;
      pop.classList.toggle('is-sheet',narrow);
      // Offsets within the popover's containing block (the scope, or the page), whichever box that is.
      if(!narrow){const cb=pop.offsetParent||scope,cr=cb.getBoundingClientRect(),sr=scope.getBoundingClientRect(),br=btn.getBoundingClientRect(),w=Math.min(360,sr.width-16);
        const left=Math.max(sr.left+8,Math.min(br.left,sr.right-w-8));
        pop.style.width=`${w}px`;pop.style.left=`${left-cr.left-(cb.clientLeft||0)+(cb===document.body?0:cb.scrollLeft||0)}px`;
        pop.style.top=`${br.bottom-cr.top-(cb.clientTop||0)+(cb===document.body?0:cb.scrollTop||0)+6}px`;}
      else{pop.style.width='';pop.style.left='';pop.style.top='';}
      pop.querySelector('[data-close]')?.focus({preventScroll:true});
      if(!narrow){const pr=pop.getBoundingClientRect();if(pr.bottom>innerHeight-8)pop.scrollIntoView({block:'nearest'});}
    };
    scope.addEventListener('click',e=>{
      if(pop.contains(e.target)){
        if(e.target.closest('[data-close]'))close();
        const c=e.target.closest('[data-copy]');if(c){navigator.clipboard?.writeText(c.dataset.copy).then(()=>{c.textContent='Copied';setTimeout(()=>{c.textContent='Copy';},1600);}).catch(()=>{});}
        return;
      }
      const yb=e.target.closest('[data-year]');
      if(yb&&scope.contains(yb)&&(yb.classList.contains('ti-yb')||yb.closest('.ti-fig, .ti-matrix thead, .ti-table'))){current=yb.dataset.year;apply(current,false);return;}
      const mb=e.target.closest('.ti-m-b, .ti-v');
      if(mb){
        const q=mb.dataset.cell?cellQuantity(rec,mb.dataset.cell):quantity(rec,mb.dataset.q||mb.closest('.ti-m')?.dataset.q);
        const was=mb.getAttribute('aria-expanded')==='true';close();if(!was&&q)open(q,mb);return;
      }
      if(!pop.hidden)close();
    },sig);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pop.hidden){close();e.stopPropagation();}},{...sig,capture:true});
    // A11Y-09: focus leaving the popover (and its trigger) closes it, without pulling focus back.
    pop.addEventListener('focusout',e=>{
      const to=e.relatedTarget;if(pop.hidden||(to&&(pop.contains(to)||to===opener)))return;
      setTimeout(()=>{if(pop.hidden||!document.hasFocus?.())return;const a=document.activeElement;if(pop.contains(a)||a===opener)return;close({refocus:false});},0);
    },sig);
    document.addEventListener('pointerdown',e=>{if(!pop.hidden&&!pop.contains(e.target)&&!e.target.closest?.('.ti-m-b, .ti-v'))close();},sig);
    // Hover previews a year; leaving returns to the selected one.
    const over=e=>{const t=e.target.closest?.('[data-year]');if(!t||!scope.contains(t)||pop.contains(e.target))return;if(t.dataset.year!==scope.dataset.year)apply(t.dataset.year,true);};
    const out=e=>{const t=e.target.closest?.('[data-year]');if(!t||pop.contains(e.target))return;const to=e.relatedTarget?.closest?.('[data-year]');if(to&&to.dataset.year===t.dataset.year)return;if(scope.dataset.year!==current)apply(current,false);};
    scope.addEventListener('pointerover',over,sig);scope.addEventListener('pointerout',out,sig);
    scope.addEventListener('focusin',e=>{if(e.target.classList?.contains('ti-yb'))over(e);},sig);
    scope.addEventListener('keydown',e=>{
      const b=e.target.closest?.('.ti-yb');if(!b||!['ArrowLeft','ArrowRight'].includes(e.key))return;
      const all=[...b.parentElement.querySelectorAll('.ti-yb')],i=all.indexOf(b),n=all[(i+(e.key==='ArrowRight'?1:all.length-1))%all.length];
      n.focus();current=n.dataset.year;apply(current,false);e.preventDefault();
    },sig);
    return {set:y=>{current=String(y);apply(current,false);},get:()=>Number(current),close,isOpen:()=>!pop.hidden};
  }

  // ---------- tree IDs ----------
  // From data release 6.1 the tree number is the tree's ID (Copy, permalink) and the record ID follows on one quieter
  // line; before 6.1 the record ID is the tree ID. Items of the tree page's ID line (dl.ti-idline).
  function idLine(rec){
    if(!rec.number)return `<div><dt>Tree ID</dt><dd><code>${esc(rec.id)}</code><button type="button" class="ti-copy" id="copyId" aria-label="Copy the tree ID">Copy</button></dd></div>`;
    return `<div><dt>Tree number</dt><dd><code class="ti-tn">${esc(rec.number)}</code><button type="button" class="ti-copy" id="copyId" aria-label="Copy the tree number">Copy</button><small><a class="ti-permalink" href="${esc(rec.permalink)}">${esc(rec.permalink)}</a></small></dd>
          <dt class="ti-sub">Record ID</dt> <dd class="ti-sub"><code>${esc(rec.id)}</code></dd></div>`;
  }

  // ---------- a page about an ID that names no current tree ----------
  // r: ALTOTreeId.resolve() of the ID asked for (retired, merged, split, unknown or invalid); typed: the text as given;
  // fix: the one correction of a mistyped number, if any; receipt: the corrections-applied items its reason names.
  // The title states the status and the reason; the trees that took its place are links, with an empty
  // span[data-succ="<number>"] for each tree's name once its record loads. -> {title, primary, mapHref, html}
  const dayText=t=>String(t||'').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,(m,y,mo,d)=>new Date(`${y}-${mo}-${d}T12:00:00Z`).toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}));
  const releaseWords=t=>String(t||'').replace(/^V(\d+(?:\.\d+)?)\b/,'Release $1').replace(/\bv(\d+(?:\.\d+)?)\b/g,'release $1');   // as on the methods pages
  // onMap: the view sits in the map's panel (a ?tree= link), so it offers no "Open the map" and its links stay on the map.
  function statusView(r,{typed='',fix=null,receipt=[],icon=null,onMap=false}={}){
    const Id=root.ALTOTreeId,d=Id.describe(r),t=String(typed||r.input||'').trim(),rows=[];
    const kv=(k,v,sub)=>rows.push(`<div class="ti-kv"><dt>${esc(k)}</dt><dd>${v}${sub?`<small>${sub}</small>`:''}</dd></div>`);
    const link=n=>`<a href="${esc(Id.url(n))}"><code>${esc(n)}</code></a>`,succ=n=>`${link(n)} <span class="ti-succ-what" data-succ="${esc(n)}"></span>`;
    let title=d.heading,lead='',primary=null,eyebrow=Id.label(r.kind);
    // A file that did not load (FE-02): which file and why, and Retry (the page binds [data-retry]); never an absent tree.
    if(r.status==='unavailable'){
      const note=r.note||`Not loaded: ${r.file||'a data file'} (${r.reason||'error'}).`,ic=n=>icon?icon(n,16):'';
      const html=`<div class="ti-id-main ti-status-page" data-status="unavailable"><p class="ti-eyebrow ti-kicker">${esc(eyebrow||'Tree')}</p><h1>Not loaded</h1><p class="ti-lead">${esc(note)}</p>
        ${t?`<dl class="ti-kvs ti-status-kvs"><div class="ti-kv"><dt>Typed</dt><dd><code>${esc(t)}</code></dd></div></dl>`:''}</div>
      <div class="ti-id-actions"><button type="button" class="btn btn-primary" data-retry>Retry</button><a class="btn" href="./">${ic('map')}<span>Open the map</span></a></div>`;
      return {title:'Not loaded',primary:null,mapHref:'./',html};
    }
    if(r.status==='invalid'){
      const shaped=Id.isNumberShaped(t);eyebrow=shaped?'Tree number':'Tree ID';
      if(shaped&&fix){title='Check character doesn’t match';lead=`Did you mean ${link(fix)}?`;primary=fix;}
      else if(shaped&&r.note&&r.note!=='Not a valid tree number.')lead=esc(r.note);   // why it fails: the check character, or a U
      kv('Typed',`<code>${esc(t)}</code>`,shaped?null:'Tree numbers, record IDs and crown keys are accepted');
      if(shaped)kv('Format','<code>T</code> + 6 characters + 1 check character','Example <code>TMCTT6X4</code>; characters 0–9 and A–Z without I, L, O and U');
    }else{
      kv(Id.label(r.kind),`<code>${esc(r.key||t)}</code>`);
      kv('Status',esc({retired:r.successor?'Retired':'Retired; no successor',merged:'Merged',split:`Split into ${nf(r.successors.length)} trees`,unknown:'Not in this release'}[r.status]||r.status));
      if(r.note&&r.status!=='unknown')kv('Reason',esc(releaseWords(r.note)),(receipt||[]).map(x=>`${receipt.length>1?`${esc(x.id)}, `:''}${x.decided_on?`${esc(dayText(x.decided_on))}: `:''}${esc(releaseWords(x.summary||x.reason||''))}`).join('<br>'));
      else if(r.note)kv('Note',esc(r.note));
      if(r.status==='merged'&&r.number){kv('Surviving tree',succ(r.number));primary=r.number;}
      if(r.status==='split'){kv('Parts',`<ol class="ti-succ">${r.successors.map(n=>`<li>${succ(n)}</li>`).join('')}</ol>`,'Largest share first');primary=r.successors[0]||null;}
      if(r.status==='retired'&&r.successor){kv('Successor',succ(r.successor));primary=r.successor;}
      if(r.position)kv('Last position',`${r.position.lat.toFixed(6)}, ${r.position.lon.toFixed(6)}`,'Latitude, longitude (WGS 84)');
      if(r.last_release)kv('Last release',esc(dayText(r.last_release)));
      if(r.source_id)kv('Source ID',`<code>${esc(r.source_id)}</code>`);
    }
    // A tombstone's map link opens the map at its last position, with the reason.
    const tomb=r.status==='retired'&&!r.successor&&!!r.position,mapHref=tomb?Id.url(r.key,{page:'map'}):'./',ic=n=>icon?icon(n,16):'';
    const html=`<div class="ti-id-main ti-status-page" data-status="${esc(r.status)}"><p class="ti-eyebrow ti-kicker">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${lead?`<p class="ti-lead">${lead}</p>`:''}
        <dl class="ti-kvs ti-status-kvs">${rows.join('')}</dl></div>
      <div class="ti-id-actions">${primary?`<a class="btn btn-primary" href="${esc(Id.url(primary,onMap?{page:'map'}:undefined))}"><span>Open tree ${esc(primary)}</span>${ic('arrow')}</a>`:''}
        ${onMap?'':`<a class="btn${primary?'':' btn-primary'}" href="${esc(mapHref)}">${ic('map')}<span>${tomb?'See the place on the map':'Open the map'}</span></a>`}</div>`;
    return {title,primary,mapHref,html};
  }

  const api={KINDS,LABELS,SECTIONS,estimateBadge,fmt,fmtValue,fmtRange,text,line,sourceName,rangeBar,stageBar,classBar,bandBar,stageShare,eyebrow,title,crownForm,scheduleLine,protectionLine,groupAreaLine,releaseLines,evidence,evidenceRow,councilPosition,surveyCodes,badges,versionLine,metric,strip,missing,fieldRows,
    provenance,years,yearsNote,rateText,surveySentence,heightFigure,surveyChart,crownFigure,figureKey,imageryText,regrowthLine,lost,rootRows,METRICS,distStrip,contextLines,contextSentence,boardName,
    matrix,cellQuantity,teasers,pageLinks,setYear,bind,quantity,nice,ticks,money,sig2,areaText,hybrid,esc,idLine,statusView,stickyPlan,sectionScroll};
  root.ALTOInstrument=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
