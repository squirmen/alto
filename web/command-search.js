/* One search box for everything the map can find or do: addresses, tree IDs, species, local boards and map
 * commands ("protected trees", "colour by height", "show parcels", "pōhutukawa in Kaipātiki").
 *
 * The page supplies the items (index.html builds them from its own state, so a toggle's label always says
 * what selecting it will do). This module ranks them against the text, renders an ARIA 1.2 combobox with a
 * grouped listbox, and runs the chosen item. Matching ignores case and macrons, tolerates one typo in a
 * longer word, and reads "show", "hide" and "only" as the intent of a command. Nothing typed here leaves the
 * browser: addresses are looked up in the release's own address index (property.js). */
(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Lower case, macrons and other marks removed, "color" read as "colour", punctuation as spaces.
  const fold=s=>String(s??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();
  const normalise=s=>fold(s).replace(/\bcolou?r(s|ed|ing)?\b/g,'colour').replace(/[’'`]/g,'').replace(/[^a-z0-9+&.]+/g,' ').replace(/\s+/g,' ').trim();
  const INTENT={show:'on',display:'on',add:'on',on:'on',enable:'on',hide:'off',remove:'off',off:'off',without:'off',disable:'off',clear:'off',only:'only',just:'only'};
  const STOP=new Set(['the','a','an','of','to','for','me','please','map','layer','layers','filter','filters','turn','set','view','see','trees','tree','all']);
  const words=s=>normalise(s).split(' ').filter(Boolean);
  // A query's intent ("show", "hide", "only") and the words that remain for matching.
  function parse(text){
    const all=words(text);let intent=null;const rest=[];
    for(const w of all){if(!intent&&INTENT[w]&&rest.length===0){intent=INTENT[w];continue;}if(!STOP.has(w))rest.push(w);}
    return {intent,tokens:rest.length?rest:all.filter(w=>!INTENT[w]),text:normalise(text)};
  }
  function lev1(a,b){// true when a and b differ by at most one edit (insert, delete, substitute or swap two neighbours)
    if(a===b)return true;const la=a.length,lb=b.length;if(Math.abs(la-lb)>1)return false;
    let i=0;while(i<la&&i<lb&&a[i]===b[i])i++;
    if(la===lb){if(a.slice(i+1)===b.slice(i+1))return true;return a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2);}
    return la>lb?a.slice(i+1)===b.slice(i):a.slice(i)===b.slice(i+1);
  }
  // 0..100: how well query tokens match one phrase.
  function phraseScore(q,phrase){
    const p=words(phrase).filter(w=>!STOP.has(w)),ps=p.join(' '),qs=q.join(' ');
    if(!q.length||!p.length)return 0;
    if(ps===qs)return 100;
    if(ps.startsWith(qs))return 92-Math.min(10,(ps.length-qs.length)*0.25);
    let k=0,gaps=0,inOrder=true;
    for(const t of q){let found=false;while(k<p.length){if(p[k++].startsWith(t)){found=true;break;}gaps++;}if(!found){inOrder=false;break;}}
    if(inOrder)return 80-Math.min(10,gaps*2);
    if(q.every(t=>p.some(w=>w.startsWith(t))))return 70;
    if(q.every(t=>ps.includes(t)))return 55;
    if(q.every(t=>p.some(w=>w.startsWith(t)||(t.length>=5&&(lev1(t,w)||lev1(t,w.slice(0,t.length)))))))return 45;
    return 0;
  }
  const itemScore=(q,item)=>Math.max(0,...(item.words||[item.label]).map(w=>phraseScore(q,w)))+(item.boost||0);
  // "pōhutukawa in Kaipātiki": the text before the last " in " and the place after it.
  function splitPlace(text){
    const t=normalise(text),i=t.lastIndexOf(' in ');
    return i>0?{left:t.slice(0,i),right:t.slice(i+4)}:null;
  }
  // "taller than 25 m", "over 20m", "height 15+", "30 m or more": a minimum height in metres, or null.
  function parseHeight(text){
    const t=normalise(text);
    let m=t.match(/(?:taller than|higher than|over|above|at least|min(?:imum)?(?: height)?|height(?: over| above)?|>=?)\s*(\d{1,2})(?:\s*m(?:etres?)?)?\b/);
    if(!m)m=t.match(/\b(\d{1,2})\s*m(?:etres?)?\s*(?:\+|or more|and over|and above|plus|or taller)/);
    if(!m)m=t.match(/\b(\d{1,2})\s*m?\s*\+/);
    const n=m?Number(m[1]):NaN;
    return Number.isFinite(n)&&n>=2&&n<=60?n:null;
  }
  const GROUP_ORDER=['Tree','Presets','Filters','Map','Species','Places','Combined','Addresses','Examples'];
  /* Rank items for a query.
     ctx.items(intent) -> [{id, group, label, words[], meta, run(intent), boost}]  (presets, filters, map commands)
     ctx.species() -> [[name, count]]; ctx.places() -> [{name, words[], run()}]
     ctx.height(n) -> item or null; ctx.treeId(text) -> item or null; ctx.combine(item, place) -> item */
  function suggest(text,ctx,limit=10){
    const raw=String(text??'').trim();
    if(!raw)return ctx.examples?ctx.examples():[];
    const {intent,tokens}=parse(raw),out=[];
    const id=ctx.treeId?.(raw);if(id)out.push({...id,group:'Tree',score:120});
    const base=ctx.items(intent).map(it=>({...it,score:itemScore(tokens,it)})).filter(it=>it.score>=45);
    const h=parseHeight(raw);if(h&&ctx.height){const it=ctx.height(h);if(it)base.push({...it,score:95});}
    // Common species first; names that bundle several species or carry lab notes, and names with only a few
    // records, rank after them.
    const spScore=(q,name,count)=>phraseScore(q,name)+Math.min(6,Math.log10((count||0)+1))-(/[(,]/.test(name)?12:0)-((count||0)<10?10:0);
    let sp=(ctx.species?.()||[]).map(([name,count,names])=>({id:'species:'+name,group:'Species',label:name,count,names,score:spScore(tokens,name,count)})).filter(it=>it.score>=50);
    if(sp.some(it=>it.score>=100))sp=sp.filter(it=>it.score>=100||(it.count||0)>=10);// an exact name: keep the rare variants out of the way
    const pl=(ctx.places?.()||[]).map(p=>({...p,group:'Places',score:itemScore(tokens,p)})).filter(it=>it.score>=55);
    const split=splitPlace(raw);
    if(split&&ctx.combine){
      const place=(ctx.places?.()||[]).map(p=>({p,s:itemScore(words(split.right).filter(w=>!STOP.has(w)),p)})).filter(x=>x.s>=70).sort((a,b)=>b.s-a.s)[0];
      if(place){
        const lt=parse(split.left).tokens,li=parse(split.left).intent;
        const left=[...(ctx.species?.()||[]).map(([name,count,names])=>({id:'species:'+name,group:'Species',label:name,count,names,score:spScore(lt,name,count)})),
          ...ctx.items(li).filter(it=>it.combinable).map(it=>({...it,score:itemScore(lt,it)}))].filter(x=>x.score>=75).sort((a,b)=>b.score-a.score).slice(0,3);
        if(ctx.speciesItem)for(const l of left)if(l.group==='Species')Object.assign(l,ctx.speciesItem(l.label,l.count,l.names));
        for(const l of left)out.push({...ctx.combine(l,place.p),group:'Combined',score:110+l.score/100});
      }
    }
    if(ctx.speciesItem)for(const s of sp)Object.assign(s,ctx.speciesItem(s.label,s.count,s.names));
    const all=[...out,...base,...sp,...pl];
    // Best items first; at most a few per group; groups in the order of their best item.
    const per={Tree:1,Presets:3,Filters:4,Map:4,Species:3,Places:3,Combined:3,Addresses:5};
    all.sort((a,b)=>b.score-a.score||String(a.label).localeCompare(String(b.label)));
    const seen=new Set(),kept=[],count={};
    for(const it of all){if(seen.has(it.id))continue;seen.add(it.id);count[it.group]=(count[it.group]||0)+1;if(count[it.group]>(per[it.group]||4))continue;kept.push(it);if(kept.length>=limit)break;}
    return kept;
  }
  // Items to groups, in the order of each group's best score (ties: GROUP_ORDER).
  function grouped(items){
    const g=new Map();
    for(const it of items){if(!g.has(it.group))g.set(it.group,{name:it.group,best:-1,items:[]});const x=g.get(it.group);x.items.push(it);x.best=Math.max(x.best,it.score??0);}
    return [...g.values()].sort((a,b)=>b.best-a.best||GROUP_ORDER.indexOf(a.name)-GROUP_ORDER.indexOf(b.name));
  }
  const LABEL={Tree:'Tree',Presets:'Presets',Filters:'Filters',Map:'Map',Species:'Species',Places:'Local boards',Combined:'Filter and place',Addresses:'Addresses',Examples:'Try'};
  // The label with the typed words marked (macron-insensitive).
  function mark(label,text){
    const q=words(text).filter(w=>!STOP.has(w)&&!INTENT[w]);
    if(!q.length)return esc(label);
    const chars=[...String(label)],folded=chars.map(c=>fold(c).replace(/[^a-z0-9]/g,'')||' ');
    const on=new Array(chars.length).fill(false);
    let i=0;
    while(i<chars.length){
      if(folded[i]===' '||(i>0&&/[a-z0-9]/.test(folded[i-1]))){i++;continue;}// word starts only
      for(const t of q){
        let j=i,k=0;
        while(j<chars.length&&k<t.length){const f=folded[j];if(f===' '||!t.startsWith(f,k))break;k+=f.length;j++;}
        if(k>=t.length){for(let x=i;x<j;x++)on[x]=true;break;}
      }
      i++;
    }
    let html='',open=false;
    chars.forEach((c,x)=>{if(on[x]&&!open){html+='<mark>';open=true;}if(!on[x]&&open){html+='</mark>';open=false;}html+=esc(c);});
    return html+(open?'</mark>':'');
  }

  /* The combobox. opts: input, list, status (visible line), live (screen-reader count), ctx (above),
     addresses(text) -> Promise<items>, onOpen(), onRun(item, message). */
  function bind(opts){
    const {input,list,status,live,ctx}=opts;
    let items=[],active=-1,seq=0,timer=null,addrTimer=null,lastText=null,statusTimer=null;
    const say=(text,{keep=false}={})=>{clearTimeout(statusTimer);status.textContent=text||'';status.hidden=!text;if(text&&!keep)statusTimer=setTimeout(()=>{status.textContent='';status.hidden=true;},5000);};
    const isOpen=()=>!list.hidden;
    function close(){list.hidden=true;list.replaceChildren();input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');items=[];active=-1;lastText=null;opts.onClose?.();}
    function setActive(i){
      active=i;
      list.querySelectorAll('[role=option]').forEach(o=>o.setAttribute('aria-selected',String(Number(o.dataset.index)===i)));
      const o=list.querySelector(`[data-index="${i}"]`);
      if(o){input.setAttribute('aria-activedescendant',o.id);o.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
    }
    function render(text,note){
      list.replaceChildren();
      const groups=grouped(items);let n=0;
      groups.forEach((g,gi)=>{
        const box=document.createElement('div');box.className='cmd-group';box.setAttribute('role','group');box.setAttribute('aria-labelledby',`${list.id}-g${gi}`);
        box.innerHTML=`<div class="cmd-group-label" id="${list.id}-g${gi}" role="presentation">${esc(LABEL[g.name]||g.name)}</div>`;
        for(const it of g.items){
          const i=items.indexOf(it),o=document.createElement('div');
          o.className='cmd-opt'+(it.current?' is-current':'');o.id=`${list.id}-o${i}`;o.dataset.index=String(i);o.setAttribute('role','option');o.setAttribute('aria-selected','false');
          o.innerHTML=`<span class="cmd-opt-label">${mark(it.label,text)}</span>${it.meta?`<span class="cmd-opt-meta">${esc(it.meta)}</span>`:''}`;
          o.addEventListener('pointerdown',e=>e.preventDefault());
          o.addEventListener('click',()=>run(i));
          box.append(o);n++;
        }
        list.append(box);
      });
      if(note){const p=document.createElement('p');p.className='cmd-note';p.textContent=note;list.append(p);}
      list.hidden=!n&&!note;input.setAttribute('aria-expanded',String(n>0));
      if(live)live.textContent=n?`${n} suggestion${n===1?'':'s'}. Up and down arrows to move, Enter to choose.`:(note||'');
      if(n)opts.onOpen?.();
    }
    function compute(){
      const text=input.value,id=++seq;
      items=suggest(text,ctx);
      const empty=!text.trim();
      active=-1;
      render(text,empty?ctx.exampleNote?.():(!items.length?'Searching…':null));
      setActive(empty?-1:firstIndex());
      // Addresses: the release's address index, after a short pause in typing.
      clearTimeout(addrTimer);
      if(empty||!opts.addresses||!/[a-z]{2}/i.test(text))return finish(text,id);
      addrTimer=setTimeout(async()=>{
        let rows=[];
        try{rows=await opts.addresses(text,items.slice());}catch{rows=null;}
        if(id!==seq)return;
        const keepId=items[active]?.id;
        if(rows===null){say('Address search is not available right now.');}
        else if(rows.length){
          const lead=/^\s*(unit|flat|apt)?\s*\d/i.test(text);
          const best=items.length?Math.max(...items.map(x=>x.score||0)):0;
          rows.forEach((r,k)=>items.push({...r,group:'Addresses',score:lead?130-k:Math.min(best-1,60)-k}));
          items=items.sort((a,b)=>(b.score||0)-(a.score||0));
        }
        finish(text,id,keepId);
      },160);
    }
    function finish(text,id,keepId){
      if(id!==seq)return;
      const empty=!text.trim();
      render(text,empty?ctx.exampleNote?.():(!items.length?'No match. Try an address with a house number, a tree ID, a species, a local board, or a command such as “colour by height”.':null));
      const k=keepId?items.findIndex(x=>x.id===keepId):-1;
      setActive(empty?-1:(k>=0?k:firstIndex()));
    }
    // The first option as rendered (groups are ordered by their best match).
    const firstIndex=()=>items.length?items.indexOf(grouped(items)[0].items[0]):-1;
    async function run(i){
      const it=items[i];if(!it)return;
      const text=input.value;
      close();
      input.value=it.keepText?it.keepText:'';
      opts.onClear?.(!input.value);
      try{
        const msg=await it.run(parse(text).intent);
        if(msg)say(msg);
        opts.onRun?.(it,msg);
      }catch(err){say(err?.message||'That did not work. Try again.');}
    }
    input.addEventListener('input',()=>{clearTimeout(timer);opts.onClear?.(!input.value);timer=setTimeout(compute,70);});
    input.addEventListener('focus',()=>{if(!isOpen())compute();});
    input.addEventListener('keydown',e=>{
      const opts2=[...list.querySelectorAll('[role=option]')].map(o=>Number(o.dataset.index));
      if(e.key==='ArrowDown'){e.preventDefault();if(!isOpen()){compute();return;}const p=opts2.indexOf(active);setActive(opts2[(p+1)%opts2.length]??-1);}
      else if(e.key==='ArrowUp'){e.preventDefault();if(!isOpen())return;const p=opts2.indexOf(active);setActive(opts2[(p-1+opts2.length)%opts2.length]??-1);}
      else if(e.key==='Enter'){
        e.preventDefault();
        if(isOpen()&&active>=0)run(active);
        else{clearTimeout(timer);compute();}
      }
      else if(e.key==='Escape'){
        // The box uses Escape to close its list, then to clear the text; after that Escape belongs to the
        // page (cancel selecting a parcel, close a panel).
        if(isOpen()){e.stopPropagation();close();}
        else if(input.value){e.stopPropagation();input.value='';opts.onClear?.(true);}
        else input.blur();
      }
      else if(e.key==='Tab'&&isOpen())close();
    });
    input.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==input)close();},120));
    return {close,say,refresh:()=>{if(isOpen())compute();}};
  }

  const api={normalise,fold,parse,phraseScore,itemScore,splitPlace,parseHeight,suggest,grouped,mark,bind,lev1};
  root.ALTOCommand=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
