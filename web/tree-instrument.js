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
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>v===null||v===undefined||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
  const nf=(v,d=0)=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:d,minimumFractionDigits:0}).format(v);
  const NF1=new Intl.NumberFormat('en-NZ',{minimumFractionDigits:1,maximumFractionDigits:1}),nf1=v=>NF1.format(v);   // 0.1 m: "7.0 m", never "7 m"
  const r1=v=>Math.round(v*10)/10;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
  function nice(v){if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v)),m=v/p;return [1,1.2,1.5,2,2.5,3,4,5,6,8,10].find(x=>m<=x+1e-9)*p;}
  function ticks(max,count=4){const step=nice(max/count),out=[];for(let t=0;t<=max+1e-9;t+=step)out.push(+t.toFixed(6));return out;}
  const sig2=v=>{const n=num(v);if(n===null||n===0)return n;const p=10**(1-Math.floor(Math.log10(Math.abs(n))));return Math.round(n*p)/p;};
  const SIG2=new Intl.NumberFormat('en-NZ',{minimumSignificantDigits:2,maximumSignificantDigits:2});
  const s2=v=>{const n=num(v);return n===null?'–':Math.abs(n)>=100?nf(sig2(n)):SIG2.format(n);};   // two significant figures
  const money=v=>{const n=num(v);return n===null?'–':'$'+s2(n);};
  const hybrid=s=>String(s||'').replace(/ x /g,' × ');                                            // never the letter x

  // ---------- data-sheet formatting: precision follows the method (design system 4.7) ----------
  const UNIT_OF={height:'m',crownArea:'m²',crownOutline:'m²',crownDiameter:'m',trunkDiameter:'cm',rootProtection:'m',benefits:'/yr',carbonStored:'t CO₂e',stormwater:'m³/yr',replacementYears:'years'};
  function fmtValue(key,v,{measuredTape=false}={}){
    const n=num(v);if(n===null)return null;
    if(/^survey|^height$|crownMax|meanHeight|canopyTop|liveCrownBase|rootProtection/.test(key))return [nf1(n),'m'];
    switch(key){
      case 'crownArea':case 'crownOutline':return [n<10?nf(n,1):nf(Math.round(n)),'m²'];
      case 'crownDiameter':return [nf(Math.round(n)),'m'];
      case 'trunkDiameter':return [measuredTape?nf(n,1):nf(Math.round(n)),'cm'];
      case 'benefits':return [money(n),'/yr'];
      case 'carbonStored':return n<1?[s2(n*1000),'kg CO₂e']:[s2(n),'t CO₂e'];
      case 'stormwater':return [s2(n),'m³/yr'];
      case 'replacementYears':return [nf(Math.round(n)),'years'];
      default:return null;
    }
  }
  const areaText=v=>{const n=num(v);return n===null?'–':`${n<10?nf(n,1):nf(Math.round(n))} m²`;};
  // A growth-form class as a title: the class alone; the Estimate badge says it is a model output.
  // A model's growth-form wording without "(model)": the Estimate badge says it ("(model, high confidence)" -> "(high confidence)").
  const cleanForm=t=>String(t||'').replace(/^(Probably|Likely)\s+/i,'').replace(/\s*\(model\)$/,'').replace(/\(model,\s*/,'(').replace(/^./,c=>c.toUpperCase());
  // [value, unit] for a quantity: numbers by the rule above, classes and names as stored.
  function fmt(q){
    if(!q)return ['–',''];
    if(q.key==='growthForm')return [cleanForm(q.text),''];
    const f=fmtValue(q.key,q.value,{measuredTape:q.kind==='measured'&&/KYTE/.test(q.provenance?.source||'')});
    if(f)return f;
    const m=String(q.text??'').match(/^(\$?\d[\d.,]*)\s*(.*)$/);return m?[m[1],m[2]]:[String(q.text??''),''];
  }
  const tight=u=>u.startsWith('/')||u==='%';                                                // "$540/yr", "93%"
  const text=q=>{const [v,u]=fmt(q);return u?(tight(u)?`${v}${u}`:`${v} ${u}`):v;};
  // A range as printed, or null when its ends print the same (no zero-width ranges).
  function fmtRange(q){
    const lo=num(q?.range?.low),hi=num(q?.range?.high);if(lo===null||hi===null)return null;
    const a=fmtValue(q.key,lo),b=fmtValue(q.key,hi);if(!a||!b)return q.range.text||null;
    if(a[0]===b[0])return null;
    return b[1].startsWith('/')?`${a[0]}–${b[0]}${b[1]}`:a[1]===b[1]?`${a[0]}–${b[0]} ${b[1]}`:`${a[0]} ${a[1]}–${b[0]} ${b[1]}`;
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
  const HOW={trunkDiameter:'Not measured',rootProtection:'12 × trunk diameter',lifeStage:'From height and tree class',benefits:'i-Tree style equations',carbonStored:'i-Tree style equations',
    stormwater:'i-Tree style equations',replacementYears:'Crown area ÷ class growth rate',irreplaceability:'Inferred from regrowth time and height',crownDiameter:'Circle with the crown area',
    crownOutline:'Smoothed crown outline',growthForm:'2024 LiDAR survey and aerial imagery'};
  // The line under a value. Estimates start with their range; measured and recorded values name their source and
  // date (their other estimates stay in the provenance popover, never "range" beside a measurement).
  function line(q){
    if(!q)return '';
    const p=q.provenance||{},r=fmtRange(q);
    if(q.key==='rootProtection'){const a=num(q.value);return [r?`Range ${r}`:null,a!==null?areaText(Math.PI*a*a):null].filter(Boolean).join(' · ')||'From the trunk estimate';}
    if(q.kind==='model')return [r?`Range ${r}`:null,HOW[q.key]||sourceName(p)].filter(Boolean).join(' · ');
    if(q.kind==='rule')return HOW[q.key]||`Inferred · ${sourceName(p)}`;
    if(q.kind==='derived')return HOW[q.key]||`From ${sourceName(p).toLowerCase()}`;
    const date=p.date?.text&&/snapshot/.test(p.date.text)?p.date.text.replace(/^snapshot\s*/,''):null;
    return [KINDS[q.kind]||'',sourceName(p),date].filter(Boolean).join(' · ');
  }

  // ---------- uncertainty: a range bar on a 0-based scale ----------
  function rangeBar(q,{max=null}={}){
    const v=num(q?.value);if(v===null)return '';
    const lo=num(q.range?.low),hi=num(q.range?.high),top=max||nice(Math.max(v,hi??v)*1.15);
    const P=x=>r1(clamp(x/top*100,0,100)),f=x=>{const a=fmtValue(q.key,x);return a?(a[1].startsWith('/')?a.join(''):a.join(' ')):nf(x,1);};
    const fr=fmtRange(q);
    const tip=`${fr?`${isEstimate(q)?'Range':'Other estimates in this record'} ${fr}`:'No range stored for this value'}. Scale 0 to ${f(top)}.`;
    return `<span class="ti-rb" data-kind="${esc(q.kind)}" role="img" aria-label="${esc(tip)}" title="${esc(tip)}"><i class="ti-rb-t"></i>${fr&&lo!==null&&hi!==null&&hi>lo?`<i class="ti-rb-r" style="left:${P(lo)}%;width:${Math.max(1.5,r1(P(hi)-P(lo)))}%"></i>`:''}<i class="ti-rb-v" style="left:${P(v)}%"></i></span>`;
  }
  // Life stage: height as a share of the class reference height, on the five stored classes.
  function stageShare(rec){
    const L=rec.lifeStage,h=num(rec.measures?.height?.value),cls=rec.benefits?.classUsed?.key,ref=num(L?.referenceHeights?.[cls]);
    return h!==null&&ref?{share:h/ref*100,height:h,ref,cls:rec.benefits.classUsed.label}:null;
  }
  function stageBar(rec){
    const L=rec.lifeStage;if(!L?.key||!Array.isArray(L.scale))return '';
    const s=stageShare(rec),top=Math.max(120,s?Math.ceil(s.share/10)*10+10:120),P=x=>r1(clamp(x/top*100,0,100));
    const tip=`${L.label}: ${s?`height ${nf(s.share)}% of the ${nf(s.ref)} m reference height for ${s.cls.toLowerCase()}`:L.band}. Classes: ${L.scale.map(c=>`${c.label} ${c.to===null?`${c.from}% and over`:`${c.from}–${c.to}%`}`).join(', ')}.`;
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
  function title(id){
    if(id.nameKind==='model'&&id.growthForm){const top=(id.growthForm.probabilities||[]).find(p=>p.top);return {text:top?.label||cleanForm(id.title),estimate:true,
      note:`Growth form estimated from the 2024 LiDAR survey and aerial imagery${top?` (${nf(top.p*100)}%)`:''}. Species not identified.`};}
    if(id.nameKind==='none')return {text:id.detection?'LiDAR-detected tree':'Tree',estimate:false,note:/not yet determined/.test(id.nameNote||'')?'Growth form not yet estimated. No species recorded.':'No species recorded.'};
    return {text:id.title,estimate:false,latin:id.latin?hybrid(id.latin):null,note:null};
  }
  // Protection under the name (concept A): the schedule entry and its legal basis, or "Not protected" with what was
  // checked. Never silence once the record has loaded.
  function protectionLine(rec,{tag='p',cls='ti-prot'}={}){
    const p=rec.identity?.protectionStatus;if(!p||p.status==='unknown'||!p.line)return '';
    return `<${tag} class="${cls}" data-protection="${esc(p.status)}">${p.status==='protected'?`<b>${esc(p.entry||'Scheduled')}</b> · ${esc(p.schedule)} (${esc(p.law)})`:
      `<b>Not protected</b> · checked against the ${esc(p.schedule)} (${esc(p.law)}) as published in this release`}</${tag}>`;
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
      }else if(b.key==='protected')out.push(`<li class="badge badge-protected">${icon?icon('shield',12):''}Protected</li>`);
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
  const BAR={lifeStage:stageBar,irreplaceability:classBar};
  const LABELS={height:'Height',crownArea:'Crown area',crownDiameter:'Crown diameter',trunkDiameter:'Trunk diameter',rootProtection:'Root protection radius',lifeStage:'Life stage',
    benefits:'Benefits',carbonStored:'Carbon stored',stormwater:'Stormwater',replacementYears:'Regrowth time',irreplaceability:'Irreplaceability',growthForm:'Growth form'};
  // notes: numbered provenance notes (the tree page): the value's note number, printed beside it (hidden on screen).
  function metric(rec,key,{label=null,id='tiPop',ctx=null,notes=null}={}){
    const q=rec.measures?.[key];if(!q)return '';
    const fn=notes?.get(q.provenance?.id)?`<sup class="ti-fn" aria-hidden="true">${notes.get(q.provenance.id)}</sup>`:'';
    const [v,u]=fmt(q),bar=BAR[key]?BAR[key](rec):rangeBar(q),txt=num(q.value)===null?' is-text':'';
    const alt=key==='height'||key==='crownArea';
    const alts=alt?[2013,2016].map(y=>{const a=yearAlt(rec,key,y);
      return `<span class="ti-m-alt" data-for-year="${y}" hidden><span class="ti-m-v${a.q?'':' is-none'}"><b>${esc(a.v[0])}</b>${a.v[1]?`<small>${esc(a.v[1])}</small>`:''}</span><span class="ti-m-p">${esc(a.line)}</span></span>`;}).join(''):'';
    return `<li class="ti-m" data-kind="${esc(q.kind)}" data-q="${esc(key)}"${alt?' data-years="2013 2016 2024"':''}><button type="button" class="ti-m-b" aria-haspopup="dialog" aria-expanded="false" aria-controls="${esc(id)}">
      <span class="ti-m-l">${esc(label||LABELS[key]||q.label)}</span>
      <span class="ti-m-cur"${alt?' data-for-year="2024"':''}><span class="ti-m-v${txt}"><b>${esc(v)}</b>${u?`<small${tight(u)?' class="is-tight"':''}>${esc(u)}</small>`:''}${fn}${isEstimate(q)?estimateBadge:''}</span>${bar||''}
      <span class="ti-m-p">${esc(line(q))}</span>${ctx?.[key]?`<span class="ti-m-ctx"><b>${esc(ctx[key].text)}</b> ${esc(ctx[key].where)}</span>`:''}</span>${alts}</button></li>`;
  }
  // The values a band leaves out are named, so an absent value is never silent (concept A's explicit gaps).
  const WHY={trunkDiameter:'no crown estimate',rootProtection:'no root-space scenario',lifeStage:'no crown estimate',benefits:'no crown estimate',carbonStored:'no crown estimate',
    replacementYears:'no crown estimate',irreplaceability:'no crown estimate',stormwater:'no crown estimate',height:'no crown in the 2024 LiDAR survey',crownArea:'no crown in the 2024 LiDAR survey',crownDiameter:'no crown in the 2024 LiDAR survey'};
  function missing(rec,keys,labels){
    const out=keys.filter(k=>!rec.measures?.[k]);
    if(!out.length)return '';
    return `<p class="ti-missing">${out.map(k=>`${esc(labels[k]||k)}: none for this record (${esc(WHY[k]||'not in the release')})`).join('. ')}.</p>`;
  }
  function strip(rec,keys,{id='tiPop',cls='',labels={},ctx=null,title='Key measurements',notes=null}={}){
    if(!rec.loaded)return `<ul class="ti-band ${cls}" aria-busy="true" aria-label="${esc(title)}">${keys.map(()=>'<li class="ti-m ti-m-skel"><i class="ti-skel"></i><i class="ti-skel ti-skel-lg"></i><i class="ti-skel"></i></li>').join('')}</ul><p class="ti-status" role="status">Loading the tree record…</p>`;
    const shown=keys.filter(k=>rec.measures?.[k]);
    return `<ul class="ti-band ${cls}" aria-label="${esc(title)}">${shown.map(k=>metric(rec,k,{id,label:labels[k]||LABELS[k]||null,ctx,notes})).join('')}</ul>${missing(rec,keys,{...LABELS,...labels})}`;
  }

  // ---------- provenance popover (design system 5): one tap from any value ----------
  function provenance(q,rec){
    const p=q.provenance||{},row=(k,v)=>v?`<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`:'';
    const d=p.date?.text||'',retrieved=/^snapshot/.test(d)?d.replace(/^snapshot\s*/,''):/^Retrieved /.test(d)?d.replace(/^Retrieved\s*/,''):null;
    const observed=/^release/.test(d)?null:/not measured/.test(d)?'Not measured':retrieved?null:d.replace(/\s*survey$/,'');
    const method=p.method?`${esc(p.method.text||'')}${p.method.href?` <a href="${esc(p.method.href)}" target="_blank" rel="noopener">Method</a>`:''}${p.method.id?`<small><code>${esc(p.method.id)}</code></small>`:''}`:null;
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
  const lineShort=s=>s.status==='outside'?'outside survey':s.status==='absent'?'not detected':'no match';
  function years(rec,{sel=2024,label='Survey year'}={}){
    const S=rec.surveys||[];if(!S.length)return '';
    return `<div class="ti-years" role="group" aria-label="${esc(label)}: highlights it in every figure">${S.map(s=>{const h=s.height?text(s.height):null;
      return `<button type="button" class="ti-yb${s.height?'':' is-none'}" data-year="${s.year}" aria-pressed="${s.year===sel}" title="${esc(h?`${s.year} LiDAR survey: ${h}`:(s.line||''))}"><b>${s.year}</b><span>${esc(h||lineShort(s))}</span></button>`;}).join('')}</div>`;
  }
  // Survey change in plain words (concept C): which surveys hold this tree, and what their heights are.
  function surveySentence(rec){
    const S=rec.surveys||[];if(!S.length)return '';
    const early=S.filter(s=>s.year!==2024),hit=early.filter(s=>s.status==='matched'&&s.height),now=S.find(s=>s.year===2024);
    if(!hit.length){
      if(early.length&&early.every(s=>s.status==='outside'))return `This tree is outside the area of the ${early.map(s=>s.year).join(' and ')} LiDAR surveys, so 2024 is its only survey.`;
      return `No canopy in the ${early.map(s=>s.year).join(' or ')} LiDAR surveys is matched to this tree in this release, so 2024 is its only survey.`;
    }
    const miss=early.filter(s=>!hit.includes(s));
    const parts=[...hit,...(now?.height?[now]:[])].map(s=>`${text(s.height)} in ${s.year}`);
    const rate=(rec.surveyChange?.rates||[]).filter(x=>num(x.value)!==null).map(x=>`${x.value>=0?'+':'−'}${nf(Math.abs(x.value),2)} m a year ${x.from}–${x.to}`);
    return `Height ${parts.join(', ')}${rate.length?` (${rate.join('; ')})`:''}.${miss.length?` No canopy in the ${miss.map(s=>s.year).join(' or ')} survey is matched to it.`:''} Each survey measured height its own way: 2013 and 2016 at the matched canopy point, 2024 as the highest return in the crown.`;
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
  // Height at each survey as dots on a time axis (three surveys, three methods, no line between them),
  // and the height scenario to 2040 as a hatched band when it is loaded (an estimate).
  function surveyChart(rec,{width=300,height=168,scenario=true}={}){
    const S=rec.surveys||[];if(!S.length)return '';
    const sc=scenario&&rec.scenario?.status==='ready'?rec.scenario:null;
    const vals=S.filter(s=>s.height).map(s=>s.height.value),q=rec.measures?.height,hi=num(q?.range?.high);
    const H=nice(Math.max(1,...vals,hi||0,...(sc?sc.points.map(p=>p.high):[]))*1.12),x0=2011.5,x1=sc?2041:2025.5,L=30,R=width-12,T=14,B=height-26;
    const X=yr=>r1(L+(yr-x0)/(x1-x0)*(R-L)),Y=v=>r1(B-v/H*(B-T));
    let s='';
    const tk=ticks(H,4);for(const t of tk)s+=`<path class="ti-grid" d="M${L} ${Y(t)}H${R}"/><text class="ti-tk" x="${L-5}" y="${Y(t)+3.5}" text-anchor="end">${nf(t)}${t===tk[tk.length-1]?' m':''}</text>`;
    s+=`<path class="ti-ax" d="M${L} ${B}H${R}"/>`;
    if(sc){const pts=[{year:sc.anchor.year,height:sc.anchor.height,low:sc.anchor.height,high:sc.anchor.height},...sc.points],e=pts[pts.length-1];
      s+=`<g class="ti-scen"><title>${esc(`Height scenario, estimate: ${nf(e.height,1)} m in ${e.year}, range ${nf(e.low,1)}–${nf(e.high,1)} m`)}</title><path class="ti-scen-band" d="M${pts.map(p=>`${X(p.year)} ${Y(p.high)}`).join('L')}L${pts.slice().reverse().map(p=>`${X(p.year)} ${Y(p.low)}`).join('L')}Z"/><path class="ti-scen-line" d="M${pts.map(p=>`${X(p.year)} ${Y(p.height)}`).join('L')}"/><text class="ti-tk" x="${X(e.year)}" y="${r1(Y(e.high)-6)}" text-anchor="end">Scenario (estimate)</text></g><text class="ti-tk" x="${X(2040)}" y="${B+16}" text-anchor="middle">2040</text>`;}
    // Year labels: 2013 and 2016 sit close together when the scenario stretches the axis to 2040.
    const close=X(2016)-X(2013)<36;
    for(const sv of S){const x=X(sv.year),an=close&&sv.year===2013?'end':close&&sv.year===2016?'start':'middle',dx=close&&sv.year===2013?3:close&&sv.year===2016?-3:0;
      s+=`<text class="ti-tk" x="${x+dx}" y="${B+16}" text-anchor="${an}">${sv.year}</text>`;
      if(sv.height){const yy=Y(sv.height.value),rg=sv.year===2024&&q?.range&&fmtRange(q);
        const whisk=rg?`<path class="ti-wh" d="M${x} ${Y(q.range.low)}V${Y(q.range.high)}M${x-4} ${Y(q.range.low)}h8M${x-4} ${Y(q.range.high)}h8"/>`:'';
        s+=`<g class="ti-yr" data-year="${sv.year}"><title>${sv.year} LiDAR survey: ${esc(text(sv.height))}${rg?` (other estimates in this record ${esc(rg)})`:''}</title><rect class="ti-hit" x="${x-22}" y="${T}" width="44" height="${B-T}"/>${whisk}<circle cx="${x}" cy="${yy}" r="5"/><text class="ti-val" x="${x}" y="${r1(yy-11)}" text-anchor="middle">${esc(text(sv.height))}</text></g>`;}
      else s+=`<g class="ti-yr is-none" data-year="${sv.year}"><title>${esc(sv.line||'')}</title><rect class="ti-hit" x="${x-22}" y="${T}" width="44" height="${B-T}"/><circle cx="${x}" cy="${B-1}" r="4.5"/><text class="ti-val" x="${x}" y="${B-10}" text-anchor="middle">${esc(lineShort(sv))}</text></g>`;
    }
    return `<svg class="ti-fig ti-sfig${close?' ti-lbl-sel':''}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc('Height at each LiDAR survey: '+S.map(sv=>`${sv.year} ${sv.height?text(sv.height):sv.line}`).join('; '))}">${s}</svg>`;
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
  function imageryText(info){return info?`Aerial imagery, ${info.source}, ${info.date}${info.resolution?` (${nf(info.resolution*100,1)} cm)`:''}`:'Aerial imagery';}

  // ---------- if it were lost ----------
  function regrowthLine(rec,{width=340,height=54}={}){
    const r=rec.replacement,T=num(r?.years);if(T===null||T<=0)return '';
    const start=r.startYear||new Date().getFullYear(),L=8,R=width-8,Y=30,X=t=>r1(L+t/T*(R-L));
    let s=`<rect class="ti-rg-bar" x="${L}" y="${Y-4}" width="${R-L}" height="8" rx="2"/>`;
    for(const m of [{share:0,year:start},...(r.marks||[])]){const x=X(m.share/100*T),end=m.share===100,an=m.share===0?'start':end?'end':'middle';
      s+=`<path class="ti-ax" d="M${x} ${Y-8}v16"/><text class="ti-tk${end?' ti-strong':''}" x="${x}" y="${Y-13}" text-anchor="${an}">${m.year}</text><text class="ti-tk" x="${x}" y="${Y+21}" text-anchor="${an}">${m.share}%</text>`;}
    return `<svg class="ti-fig ti-rgfig" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Estimate: a tree planted in ${start} reaches ${(r.marks||[]).map(m=>`${m.share}% of this crown area by ${m.year}`).join(', ')}`)}">${s}</svg>`;
  }
  function lost(rec,{variant='panel'}={}){
    const r=rec.replacement,m=rec.measures||{};
    if(!rec.loaded)return '<i class="ti-skel" style="height:64px"></i>';
    const yrs=m.replacementYears,irr=m.irreplaceability,area=m.crownArea;
    if(!yrs&&!irr&&!m.benefits)return '<p class="ti-def">None for this record: no crown estimate for regrowth or benefits.</p>';
    const row=(label,value,badge,p,key)=>value?`<div class="ti-row"><dt>${esc(label)}</dt><dd><button type="button" class="ti-v" data-q="${esc(key)}" aria-haspopup="dialog"><b>${value}</b></button>${badge?estimateBadge:''}${p?`<small>${p}</small>`:''}</dd></div>`:'';
    const rate=num(r?.rate),cls=(rec.benefits?.classUsed?.label||'its class').toLowerCase();
    return `${regrowthLine(rec,{width:variant==='page'?560:340})}<dl class="ti-rows">
      ${yrs?row('Regrowth time',`About ${esc(text(yrs))} (${r.startYear}–${r.reachYear})`,true,`For a new tree to reach this crown area${area?` (${esc(text(area))})`:''}${rate?` at ${esc(nf(rate,1))} m² a year, the release planning rate for ${esc(cls)}`:''}; crown area grows linearly.`,'replacementYears'):''}
      ${irr?row('Irreplaceability',esc(irr.text),false,esc(r?.irreplaceability?.definition?`Inferred: ${r.irreplaceability.definition}.`:'Inferred from regrowth time and height.'),'irreplaceability'):''}
      ${m.benefits?row('Benefits each year',esc(text(m.benefits)),true,esc(fmtRange(m.benefits)?`Range ${fmtRange(m.benefits)}.`:''),'benefits'):''}
      ${m.carbonStored?row('Carbon stored',esc(text(m.carbonStored)),true,'Held in the trunk, branches and roots.','carbonStored'):''}
      </dl>${variant==='page'?'<p class="ti-def">Replacement cost in dollars: none for this record (not estimated in this release).</p>':''}`;
  }
  // Root space as data rows (concept A): the protection radius and area with their range, the effective rooting
  // radius, the basis; an explicit line when the release has no scenario for the tree.
  function rootRows(rec){
    const R=rec.roots,q=rec.measures?.rootProtection;
    if(!R)return '<p class="ti-def">None for this record: the release has no root-space scenario for this tree.</p>';
    const rg=R.rpaRange,row=(label,value,sub,key)=>value?`<div class="ti-kv"><dt>${esc(label)}</dt><dd>${key?`<button type="button" class="ti-v" data-q="${esc(key)}" aria-haspopup="dialog">${value}</button>`:value}${key?` ${estimateBadge}`:''}${sub?`<small>${sub}</small>`:''}</dd></div>`:'';
    return `<dl class="ti-kvs">
      ${row('Root protection radius',num(R.rpaRadius)!==null?`${nf1(R.rpaRadius)} m · ${esc(areaText(R.rpaArea))}`:null,
        esc([rg&&q&&fmtRange(q)?`Range ${fmtRange(q)} (${areaText(rg.areaLow).replace(' m²','')}–${areaText(rg.areaHigh)}) from the trunk range`:null,`${R.rpaBasis}; area capped at ${R.rule.areaCap} m²`].filter(Boolean).join('. ')+'.'),q?'rootProtection':null)}
      ${row('Effective rooting radius',num(R.effectiveRadius)!==null?`${nf1(R.effectiveRadius)} m · ${esc(areaText(R.effectiveArea))}`:'<span class="ti-na">None for this record</span>',num(R.effectiveRadius)===null?'Needs the paving around the tree, which this record does not have.':'Scenario from crown size and known paving.')}
      ${row('Foraging radius',num(R.foragingRadius)!==null?`${nf1(R.foragingRadius)} m`:null,'1.5 × the crown radius.')}
      ${row('Constraint',R.constraint?esc(cap(R.constraint)):null,R.basis?esc(R.basis):null)}
      ${row('Status',/scenario only/i.test(R.confidence||'scenario only')?'Scenario only, not validated':esc(cap(R.confidence)),null)}</dl>`;
  }

  // ---------- comparisons: where the tree sits (release comparison tables only; fixed n) ----------
  const METRICS={height:{label:'Height',fmt:v=>`${nf(v,1)} m`,log:false},crownArea:{label:'Crown area',fmt:v=>`${v<10?nf(v,1):nf(Math.round(v))} m²`,log:true},benefits:{label:'Benefits',fmt:v=>`${money(v)}/yr`,log:true}};
  // One strip: the group's spread (quantile bands, or each value as a dot) and this tree's place on it.
  function distStrip(metric,{value,dist,text:t,n,width=176,height=42}){
    const M=METRICS[metric],v=num(value);if(!M||v===null||!dist)return '';
    let lo,hi,q=null,dots=null;
    if(dist.kind==='values'){const a=dist.values.filter(x=>num(x)!==null).map(Number).sort((x,y)=>x-y);if(!a.length)return '';lo=a[0];hi=a[a.length-1];dots=a;}
    else{const Q=dist.quantiles,Pp=dist.probabilities,at=p=>{const i=Pp.indexOf(p);return i>=0?Q[i]:null;};if(!Q?.length)return '';lo=Q[0];hi=Q[Q.length-1];q={p5:at(5)??at(10),p25:at(25),p50:at(50),p75:at(75),p95:at(95)??at(90)};}
    lo=Math.min(lo,v);hi=Math.max(hi,v);
    const log=M.log&&lo>0,f=log?Math.log10:x=>x,a=f(log?lo:Math.min(0,lo)),b=f(hi)+(f(hi)-a)*0.02||1;
    const L=4,R=width-4,X=x=>r1(L+(f(Math.max(x,log?lo:x))-a)/(b-a||1)*(R-L)),Y=20;
    let s=`<path class="ti-ax" d="M${L} ${Y+8}H${R}"/>`;
    if(q){if(q.p5!==null&&q.p95!==null)s+=`<rect class="ti-q1" x="${X(q.p5)}" y="${Y-4}" width="${r1(Math.max(1,X(q.p95)-X(q.p5)))}" height="8" rx="2"/>`;
      if(q.p25!==null&&q.p75!==null)s+=`<rect class="ti-q2" x="${X(q.p25)}" y="${Y-4}" width="${r1(Math.max(1,X(q.p75)-X(q.p25)))}" height="8" rx="2"/>`;
      if(q.p50!==null)s+=`<path class="ti-q3" d="M${X(q.p50)} ${Y-6}v12"/>`;}
    if(dots)s+=dots.map(d=>`<circle class="ti-dot" cx="${X(d)}" cy="${Y}" r="3"/>`).join('');
    s+=`<g class="ti-me"><path d="M${X(v)} ${Y-9}v18"/><circle cx="${X(v)}" cy="${Y}" r="4.5"/></g>`;
    const tl=log?[lo,hi]:[Math.min(0,lo),hi];
    s+=`<text class="ti-tk" x="${L}" y="${height-1}">${esc(M.fmt(tl[0]))}</text><text class="ti-tk" x="${R}" y="${height-1}" text-anchor="end">${esc(M.fmt(tl[1]))}</text>`;
    if(q&&q.p50!==null){const xm=X(q.p50),an=xm<48?'start':xm>width-48?'end':'middle';s+=`<text class="ti-tk" x="${xm}" y="8" text-anchor="${an}">median ${esc(M.fmt(q.p50))}</text>`;}
    const aria=`${M.label}: this tree ${M.fmt(v)}; ${t||''}; n = ${nf(n)}${q?`; median ${M.fmt(q.p50)}, middle half ${M.fmt(q.p25)}–${M.fmt(q.p75)}`:''}${log?'; log scale':''}`;
    return `<svg class="ti-fig ti-dist" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">${s}</svg>`;
  }
  // Where the tree sits, for the key measurements: its local board (else Auckland) in the release's comparison tables.
  const boardName=n=>/Local Board$/.test(n)?n:`${n} Local Board`;
  function contextLines(rec){
    const c=rec.context;if(c?.status!=='ready')return null;
    const sc=c.scopes.find(x=>x.scope==='board'&&x.status==='ready')||c.scopes.find(x=>x.scope==='auckland'&&x.status==='ready');if(!sc)return null;
    const where=sc.scope==='board'?`in ${boardName(sc.name)}`:'in Auckland',out={};
    for(const k of ['height','crownArea','benefits'])if(sc.metrics?.[k])out[k]={text:sc.metrics[k].text,where};
    return {lines:out,scope:sc,klass:c.class};
  }
  function contextSentence(rec){
    const L=contextLines(rec);if(!L)return '';
    const m=L.scope.metrics,parts=['height','crownArea','benefits'].filter(k=>m[k]).map(k=>m[k].text.charAt(0).toLowerCase()+m[k].text.slice(1));
    return `Among ${esc((L.klass?.label||'similar').toLowerCase())} crowns ${L.scope.scope==='board'?`in ${esc(boardName(L.scope.name))}`:'across Auckland'} (n = ${nf(L.scope.n)}): ${esc(parts.join('; '))}.`;
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
    const head=B.columns.map(c=>{const y=colYear(c);return `<th scope="col"${y?` data-year="${y}"`:''}><span>${esc(COL[c.key]||c.label)}</span><small>${esc(colWhen(c))}</small>${c.method?.href?`<a href="${esc(c.method.href)}" target="_blank" rel="noopener">Method</a>`:''}</th>`;}).join('');
    const rows=B.rows.filter(r=>B.columns.some(c=>c[r.key]!==null&&c[r.key]!==undefined&&c[r.key]!=='')).map(r=>`<tr><th scope="row">${esc(r.label)}</th>${B.columns.map((c,ci)=>{const y=colYear(c),td=cell(c,r,ci);return y?td.replace('<td',`<td data-year="${y}"`):td;}).join('')}</tr>`).join('');
    return `<div class="ti-scroll" tabindex="0" role="region" aria-label="Measurements by source"><table class="ti-matrix"><thead><tr><th scope="col">Measurement</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  // A cell of the matrix as a quantity, for its provenance popover.
  function cellQuantity(rec,ref){
    const [ci,key]=String(ref).split(':'),c=rec.bySource?.columns?.[Number(ci)];if(!c)return null;
    const qk={height:'height',crownDiameter:'crownDiameter',crownArea:'crownArea',trunk:'trunkDiameter'}[key]||key;
    const kind=key==='trunk'?(c.trunkKind||'model'):key==='crownDiameter'?'derived':c.key==='source'?'recorded':'measured';
    const trunkQ=key==='trunk'&&kind==='model'?rec.measures?.trunkDiameter:null;
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
      compare:ctx&&k?`${ctx.lines[k].text} ${ctx.lines[k].where}`:c?.status==='pending'?'Street, local board and Auckland':c?.status==='ready'?'No group for this tree':'Comparison tables not yet published',
      lost:m.replacementYears?`About ${text(m.replacementYears)} to regrow (estimate)`:'None for this record',
      roots:m.rootProtection?`Radius ${text(m.rootProtection)} (estimate)`:'None for this record',
      sources:cols?'Each value with its source and date':'None for this record',
      records:b?.label||`${nf(rec.identity?.recordCount||1)} record`,
      species:rec.identity?.nameKind==='recorded'?`${rec.identity.title}, as recorded`:rec.identity?.nameKind==='model'?`${title(rec.identity).text} (estimate)`:'No species recorded',
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

  // ---------- binding: one selected survey year across a whole view; provenance on any value ----------
  function quantity(rec,key){return rec.measures?.[key]||(rec.lidar?.measurements||[]).find(x=>x.key===key)||null;}
  function setYear(scope,year,{preview=false}={}){
    const y=String(year);
    scope.dataset.year=y;
    scope.querySelectorAll('.ti-yb').forEach(b=>{if(!preview)b.setAttribute('aria-pressed',String(b.dataset.year===y));b.classList.toggle('is-preview',preview&&b.dataset.year===y);});
    scope.querySelectorAll('[data-year]:not(.ti-yb)').forEach(el=>el.classList.toggle('is-sel',el.dataset.year===y));
    scope.querySelectorAll('[data-for-year]').forEach(el=>{el.hidden=el.dataset.forYear!==y;});
    scope.querySelectorAll('.ti-m').forEach(el=>el.classList.toggle('is-dim',y!=='2024'&&!(el.dataset.years||'').includes(y)));
  }
  function popover(scope,id){
    let pop=scope.querySelector(':scope > .ti-pop');
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
    const close=()=>{if(pop.hidden)return;pop.hidden=true;scope.querySelectorAll('[aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'));opener?.focus({preventScroll:true});opener=null;};
    const open=(q,btn)=>{
      pop.innerHTML=provenance(q,rec);pop.hidden=false;opener=btn;btn.setAttribute('aria-expanded','true');
      const narrow=matchMedia('(max-width: 759px)').matches;
      pop.classList.toggle('is-sheet',narrow);
      if(!narrow){const sr=scope.getBoundingClientRect(),br=btn.getBoundingClientRect(),w=Math.min(360,sr.width-16);
        let left=br.left-sr.left;left=Math.max(8,Math.min(left,sr.width-w-8));
        pop.style.width=`${w}px`;pop.style.left=`${left}px`;pop.style.top=`${br.bottom-sr.top+6}px`;}
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
    document.addEventListener('pointerdown',e=>{if(!pop.hidden&&!pop.contains(e.target)&&!e.target.closest?.('.ti-m-b, .ti-v'))close();},sig);
    // Hover previews a year; leaving returns to the selected one.
    const over=e=>{const t=e.target.closest?.('[data-year]');if(!t||!scope.contains(t)||pop.contains(t))return;if(t.dataset.year!==scope.dataset.year)apply(t.dataset.year,true);};
    const out=e=>{const t=e.target.closest?.('[data-year]');if(!t)return;const to=e.relatedTarget?.closest?.('[data-year]');if(to&&to.dataset.year===t.dataset.year)return;if(scope.dataset.year!==current)apply(current,false);};
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
  function statusView(r,{typed='',fix=null,receipt=[],icon=null}={}){
    const Id=root.ALTOTreeId,d=Id.describe(r),t=String(typed||r.input||'').trim(),rows=[];
    const kv=(k,v,sub)=>rows.push(`<div class="ti-kv"><dt>${esc(k)}</dt><dd>${v}${sub?`<small>${sub}</small>`:''}</dd></div>`);
    const link=n=>`<a href="${esc(Id.url(n))}"><code>${esc(n)}</code></a>`,succ=n=>`${link(n)} <span class="ti-succ-what" data-succ="${esc(n)}"></span>`;
    let title=d.heading,lead='',primary=null,eyebrow=Id.label(r.kind);
    if(r.status==='invalid'){
      const shaped=Id.isNumberShaped(t);eyebrow=shaped?'Tree number':'Tree ID';
      if(shaped&&fix){title='Check character doesn’t match';lead=`Did you mean ${link(fix)}?`;primary=fix;}
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
      <div class="ti-id-actions">${primary?`<a class="btn btn-primary" href="${esc(Id.url(primary))}"><span>Open tree ${esc(primary)}</span>${ic('arrow')}</a>`:''}
        <a class="btn${primary?'':' btn-primary'}" href="${esc(mapHref)}">${ic('map')}<span>${tomb?'See the place on the map':'Open the map'}</span></a></div>`;
    return {title,primary,mapHref,html};
  }

  const api={KINDS,LABELS,SECTIONS,estimateBadge,fmt,fmtValue,fmtRange,text,line,sourceName,rangeBar,stageBar,classBar,stageShare,eyebrow,title,protectionLine,badges,versionLine,metric,strip,missing,
    provenance,years,surveySentence,heightFigure,surveyChart,crownFigure,figureKey,imageryText,regrowthLine,lost,rootRows,METRICS,distStrip,contextLines,contextSentence,boardName,
    matrix,cellQuantity,teasers,pageLinks,setYear,bind,quantity,nice,ticks,money,sig2,areaText,hybrid,esc,idLine,statusView};
  root.ALTOInstrument=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
