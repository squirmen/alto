/* Property summaries: the trees on one LINZ parcel and what they are estimated to provide.
 *
 * Address search reads gzipped shards of OpenStreetMap addresses keyed by the first two letters
 * of the normalised street, so a lookup is one request of a few hundred kilobytes at most and no
 * geocoding service ever sees the query. Parcel records sit in the same 65,536 hashed buckets as
 * the tree details. Every figure is the release's per-tree estimate summed over the counted trees
 * whose point lies in the parcel, so parcels plus the unassigned remainder (roads, foreshore) add
 * up to the release totals. Land type is inferred from zoning, designations and park extents; it
 * is never an ownership record. */
(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const nf=(v,d=0)=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:d}).format(v);
  const money=v=>{const n=num(v);if(n===null)return '—';return '$'+(n>0&&n<10?n.toFixed(2):nf(Math.round(n)));};
  const co2=t=>{const n=num(t);if(n===null)return '—';return n<0.0005&&n>0?'under 1 kg':n<1?`${nf(n*1000)} kg`:`${nf(n,n<10?2:1)} t`;};
  const vol=m3=>{const n=num(m3);return n===null?'—':`${nf(n,n<100?1:0)} m³`;};
  const area=m2=>{const n=num(m2);if(n===null)return '—';return n>=10000?`${nf(n/10000,n>=1e6?0:2)} ha`:`${nf(n)} m²`;};

  // Same rules as the address build (build_property_tenure_v5.py: norm_text, norm_street, shard_key).
  const ABBREV={ave:'avenue',av:'avenue',st:'street',rd:'road',dr:'drive',drv:'drive',cres:'crescent',cr:'crescent',crs:'crescent',pl:'place',tce:'terrace',terr:'terrace',hwy:'highway',ln:'lane',ct:'court',cl:'close',gr:'grove',gro:'grove',pde:'parade',esp:'esplanade',sq:'square',blvd:'boulevard',hts:'heights',wy:'way',cir:'circle',crt:'court'};
  const LEADING={st:'saint',mt:'mount',pt:'point'};
  const normText=s=>String(s??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’'`]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  function normStreet(s){
    const w=normText(s).split(' ').filter(Boolean);
    if(w.length>1&&ABBREV[w[w.length-1]])w[w.length-1]=ABBREV[w[w.length-1]];
    if(w.length>1&&LEADING[w[0]])w[0]=LEADING[w[0]];
    return w.join(' ');
  }
  function shardKey(streetNorm){const k=streetNorm.replace(/[^a-z0-9]/g,'').slice(0,2);return k.length===2?k:(k?k+'_':'__');}
  // "[unit/]number street [, suburb]", also "Unit 2, 15 ..." and "Flat 2 15 ...".
  function parseQuery(query){
    let s=String(query??'').trim(),unit=null,number=null,m;
    if((m=s.match(/^(?:unit|flat|apartment|apt)\.?\s*([a-z0-9]+)\s*[,\s]\s*/i))){unit=m[1].toUpperCase();s=s.slice(m[0].length);}
    if((m=s.match(/^([a-z0-9]+)\s*\/\s*(\d+[a-z]?)(?![a-z0-9])\s*,?\s*/i))){unit=m[1].toUpperCase();number=m[2].toUpperCase();s=s.slice(m[0].length);}
    else if((m=s.match(/^(\d+[a-z]?)(?![a-z0-9])\s*,?\s*/i))){number=m[1].toUpperCase();s=s.slice(m[0].length);}
    const [street,...rest]=s.split(',');
    return {unit,number,street:street.trim(),suburb:rest.join(' ').trim()};
  }
  const FIELDS=['number','unit','street','street_norm','suburb','postcode','lon','lat','pid'];
  const asAddress=r=>Object.fromEntries(FIELDS.map((f,i)=>[f,r[i]??null]));
  const label=a=>`${a.unit?a.unit+'/':''}${a.number} ${a.street}`;
  const fullLabel=a=>label(a)+(a.suburb?`, ${a.suburb}`:'');

  const caches=new Map();
  async function readJSON(url){
    const res=await fetch(url);
    if(!res.ok){const e=new Error(`Request failed (${res.status})`);e.status=res.status;throw e;}
    let bytes=new Uint8Array(await res.arrayBuffer());
    if(bytes[0]===31&&bytes[1]===139){
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes=new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function cached(url,limit=40){
    if(!caches.has(url)){
      caches.set(url,readJSON(url).catch(err=>{caches.delete(url);throw err;}));
      if(caches.size>limit)caches.delete(caches.keys().next().value);
    }
    return caches.get(url);
  }
  const q=v=>`?v=${encodeURIComponent(v)}`;
  const meta=(base,version)=>cached(`${base}/address_index/meta.json${q(version)}`);
  const shard=(base,version,key)=>cached(`${base}/address_index/${key}.json.gz${q(version)}`);
  const sameParcel=new WeakMap();
  function sharedCount(rows,pid){
    if(!sameParcel.has(rows)){const m=new Map();for(const r of rows)m.set(r[8],(m.get(r[8])||0)+1);sameParcel.set(rows,m);}
    return sameParcel.get(rows).get(pid)||1;
  }
  const numberOrder=(a,b)=>(parseInt(a,10)||0)-(parseInt(b,10)||0)||String(a).localeCompare(String(b));

  async function search(base,version,query,limit=8){
    const p=parseQuery(query),words=normText(p.street).split(' ').filter(Boolean),suburbText=normText(p.suburb);
    if(words.join('').length<2)return {rows:[],total:0,short:true};
    const index=await meta(base,version);
    // The whole text as the street first, then shorter streets with the remaining words read as the suburb.
    for(let k=words.length;k>=1;k--){
      const street=words.slice(0,k).join(' '),suburb=[...words.slice(k),suburbText].filter(Boolean).join(' ');
      const cands=[...new Set([normStreet(street),street])];
      const keys=[...new Set(cands.map(shardKey))].filter(key=>index.shards?.[key]);
      if(!keys.length)continue;
      const hits=[];
      for(const rows of await Promise.all(keys.map(key=>shard(base,version,key))))for(const r of rows){
        if(!cands.some(c=>r[3].startsWith(c)))continue;
        if(suburb){const s=normText(r[4]);if(!s.startsWith(suburb)&&!s.includes(' '+suburb))continue;}
        let rank=cands.includes(r[3])?0:1;
        if(p.number&&r[0]!==p.number){if(r[0].startsWith(p.number))rank+=4;else continue;}
        if(p.unit&&r[1]!==p.unit)rank+=2;
        hits.push([rank,r,rows]);
      }
      if(!hits.length)continue;
      hits.sort((a,b)=>a[0]-b[0]||a[1][3].localeCompare(b[1][3])||String(a[1][4]).localeCompare(String(b[1][4]))||numberOrder(a[1][0],b[1][0])||numberOrder(a[1][1]||'',b[1][1]||''));
      return {rows:hits.slice(0,limit).map(([,r,rows])=>({...asAddress(r),shared:sharedCount(rows,r[8])})),total:hits.length,streetOnly:!p.number};
    }
    return {rows:[],total:0};
  }

  function decode(schema,packed){
    if(!packed)return null;
    const out={};
    for(const d of schema.datasets){
      if(!Object.prototype.hasOwnProperty.call(packed,d.key))continue;
      const expand=values=>Object.fromEntries(d.fields.map((name,i)=>[name,values[i]??null]));
      out[d.key]=d.multiple?packed[d.key].map(expand):expand(packed[d.key]);
    }
    return out;
  }
  // A parcel with no tree, crown or nearby street tree has no record, and some buckets are empty.
  async function load(base,version,pid){
    const dir=`${base}/property_details`,schema=await cached(`${dir}/schema.json${q(version)}`);
    let pack={};
    try{pack=await cached(`${dir}/${root.ALTOTreeDetails.bucketPath(String(pid),schema.bucket_algorithm)}${q(version)}`);}
    catch(err){if(err.status!==404)throw err;}
    return {schema,record:decode(schema,pack[String(pid)])};
  }

  const TENURE={street:'Street or road',park:'Park or reserve',institutional:'School or institution',private:'Private property',other:'Coastal or water',unknown:'Land type unknown'};
  const BASIS={zone:'the Unitary Plan zone',park_extent:'Council park extents',conservation_land:'park and conservation land records',council_road_reserve:'Council road reserve records',council_property:'Council property records',designation:'a public works designation',golf_course:'a golf course outline',parcel_intent:'the parcel’s recorded purpose',statutory_reserve:'a recorded reserve',zone_school_name:'a school’s zone',open_space_zone_public:'an open space zone on public land',open_space_zone_unconfirmed:'an open space zone without a public-ownership record',verge_reserve:'a narrow roadside strip',parcel_title_unzoned:'a titled island parcel',outside_plan_zones:'no plan zone',no_evidence:'no usable record'};
  const TIER={very_likely:'very likely',probable:'probable',possible:'possible',unverified:'unverified',possible_duplicate:'possible duplicate',recorded:'recorded tree',not_assessed:'not yet checked',location_unverified:'position unverified',outside_v5_coverage:'earlier record'};
  const row=(name,value,sub)=>`<div class="pp-row"><span class="pp-label">${name}</span><span class="pp-value">${value}${sub?`<span class="pp-sub">${sub}</span>`:''}</span></div>`;
  function treeButton(t,i,street){
    const facts=[street?(num(t.distance_m)>0?`${nf(t.distance_m,1)} m outside`:'on the boundary'):null,num(t.height_m)!==null?`${nf(t.height_m,1)} m tall`:null,TIER[t.evidence_tier]||t.evidence_tier].filter(Boolean).join(' · ');
    return `<li><button type="button" data-property-tree="${esc(t.tree_id)}" data-index="${i}" data-street="${street?1:0}"><span class="pt-rank">${street?'':i+1}</span><span class="pt-name">${esc(t.species_common||'Species not recorded')}<small>${esc(facts)}</small></span>${num(t.total_value_nzd_y)===null?'<span class="pt-value pt-none">not valued</span>':`<span class="pt-value">${money(t.total_value_nzd_y)}<small>/yr</small></span>`}</button></li>`;
  }
  function list(rows,street,first=10){
    const head=rows.slice(0,first).map((t,i)=>treeButton(t,i,street)).join(''),rest=rows.slice(first).map((t,i)=>treeButton(t,i+first,street)).join('');
    return `<ol class="property-trees">${head}</ol>`+(rest?`<ol class="property-trees" hidden>${rest}</ol><button type="button" class="property-more" data-property-more>Show all ${nf(rows.length)}</button>`:'');
  }
  const SOURCES='<p class="pp-note property-sources">Parcels: <a href="https://data.linz.govt.nz/layer/50823" target="_blank" rel="noopener noreferrer">LINZ NZ Primary Parcels</a>, CC BY 4.0. Zones, designations and park extents: Auckland Council, CC BY 4.0. Conservation land: Department of Conservation, CC BY 4.0. Addresses, golf courses and island roads © OpenStreetMap contributors, ODbL.</p>';
  const CAVEAT='<p class="property-caveat"><strong>Estimates, not a valuation.</strong> Trees and their services come from aerial surveys and models. Land type is inferred from zoning and parcel records, not ownership.</p>';

  function render(record,{pid,address=null,tile=null}={}){
    const p=record?.property,trees=record?.trees||[],street=record?.street_trees||[];
    const tenure=p?.tenure||tile?.tn||null,id=p?.pid||pid;
    let html=`<div class="evidence-summary property-summary"><div class="evidence-kicker">${esc(tenure?TENURE[tenure]||tenure:'Property')}</div><h3>${esc(address?label(address):'Land parcel')}</h3><p class="evidence-id">${esc([address?.suburb,`LINZ parcel ${id}`].filter(Boolean).join(' · '))}</p>`;
    if(!p)return html+'<p class="pp-note">No counted trees, canopy or nearby street trees are mapped on this parcel.</p></div><div class="pp-section">'+CAVEAT+SOURCES+'</div>';
    const conf=num(p.total_value_confident_nzd_y),total=num(p.total_value_nzd_y);
    html+=`<div class="evidence-metrics">
      <div class="evidence-metric"><span>Trees on the property</span><strong>${nf(p.n_trees)}</strong><p>${nf(p.n_confident)} confident · ${nf(p.n_uncertain)} possible</p></div>
      <div class="evidence-metric"><span>Canopy over the property</span><strong>${nf(p.canopy_m2)}<small> m²</small></strong><p>${nf(p.canopy_cover_pct,1)}% of ${area(p.area_m2)}</p></div>
      ${p.n_trees>0?`<div class="evidence-metric property-metric-wide"><span>Estimated services each year</span><strong>${money(total)}<small>/yr</small></strong><p>Likely range ${money(p.total_value_nzd_y_low)} to ${money(p.total_value_nzd_y_high)}</p></div>`:''}
    </div></div>`;
    if(p.n_trees>0){
      html+=`<div class="pp-section"><div class="pp-section-title">Estimated annual services</div>
        ${row('Stormwater',money(p.stormwater_value_nzd_y)+'/yr',`${vol(p.avoided_runoff_m3_y)} of runoff avoided`)}
        ${row('Carbon',money(p.carbon_value_nzd_y)+'/yr',`${co2(p.stored_co2e_tonnes_est)} CO₂e stored · ${co2(p.annual_sequestration_tco2e_y_est)} absorbed a year`)}
        ${row('Air quality',money(p.air_quality_value_nzd_y)+'/yr',`${nf(p.pm25_removed_kg_y,p.pm25_removed_kg_y<10?2:0)} kg of PM2.5 removed`)}
        ${row('Cooling',money(p.cooling_value_nzd_y)+'/yr','shade and evaporative cooling')}
        <div class="pp-row property-total"><span class="pp-label">Total</span><span class="pp-value">${money(total)}/yr<span class="pp-sub">range ${money(p.total_value_nzd_y_low)} to ${money(p.total_value_nzd_y_high)}</span></span></div>
        ${conf!==null&&total!==null&&Math.abs(conf-total)>=0.5?`<p class="pp-note">From the ${nf(p.n_confident)} confident trees alone: ${money(conf)}/yr.</p>`:''}
      </div>`;
    }
    html+=`<div class="pp-section"><div class="pp-section-title">Land &amp; canopy</div>
      ${row('Land type',esc(TENURE[p.tenure]||p.tenure||'—'),`inferred from ${esc(BASIS[p.tenure_basis]||String(p.tenure_basis||'').replaceAll('_',' '))}`)}
      ${p.zone?row('Zone',esc(p.zone)):''}
      ${row('Parcel area',area(p.area_m2))}
      ${row('Canopy',`${nf(p.canopy_m2)} m² · ${nf(p.canopy_cover_pct,1)}%`,`${nf(p.canopy_own_m2)} m² from its own trees · ${nf(p.canopy_overhang_m2)} m² overhanging from neighbours or the street`)}
      ${num(p.tallest_m)!==null&&p.n_trees>0?row('Tallest tree',`${nf(p.tallest_m,1)} m`):''}
      ${address?.shared>1?`<p class="pp-note">${nf(address.shared)} addresses share this parcel, so each shows the same trees.</p>`:''}
    </div>`;
    if(trees.length){
      html+=`<div class="pp-section"><div class="pp-section-title">Trees on this property · highest value first</div>${list(trees,false)}
        ${p.trees_truncated?`<p class="pp-note">Listing the ${nf(trees.length)} highest-value of ${nf(p.n_trees)} trees; the totals above include them all.</p><p class="pp-note" data-property-rings>At this zoom the map may ring only these ${nf(trees.length)}. Zoom in until the parcel outline appears to ring all ${nf(p.n_trees)}.</p>`:''}
        ${p.n_earlier_not_counted?`<p class="pp-note">${nf(p.n_earlier_not_counted)} earlier ${p.n_earlier_not_counted===1?'detection is':'detections are'} not counted (see Layers › Earlier unmatched detections).</p>`:''}
      </div>`;
    }else html+=`<div class="pp-section"><p class="pp-note">No counted tree stands on this parcel.${p.canopy_m2>0?' The canopy above comes from trees rooted next door or on the street.':''}</p></div>`;
    if(street.length){
      html+=`<div class="pp-section"><div class="pp-section-title">Street trees just outside · not counted above</div>${list(street,true,5)}
        <p class="pp-note">${nf(p.n_street_nearby)} street ${p.n_street_nearby===1?'tree stands':'trees stand'} within 10 m of the boundary, worth about ${money(p.street_nearby_value_nzd_y)} a year to the street.</p></div>`;
    }
    return html+'<div class="pp-section">'+CAVEAT+SOURCES+'</div>';
  }
  function bind(container,record,{open}){
    container.querySelectorAll('[data-property-more]').forEach(b=>b.addEventListener('click',()=>{b.previousElementSibling.hidden=false;b.remove();}));
    container.querySelectorAll('[data-property-tree]').forEach(b=>b.addEventListener('click',()=>{
      const t=(b.dataset.street==='1'?record.street_trees:record.trees)[Number(b.dataset.index)]||{};
      open({tree_id:t.tree_id,species_common:t.species_common,evidence_tier:t.evidence_tier,total_value_nzd_y:t.total_value_nzd_y,crown_area_m2:t.crown_area_m2,crown_max_chm_m:t.height_m});
    }));
  }

  // Combobox over the address shards: arrow keys move, Enter picks, Escape closes.
  function bindSearch({input,list,status,base,version,onSelect}){
    let timer=null,seq=0,rows=[],active=-1;
    const say=text=>{status.textContent=text||'';status.hidden=!text;};
    function close(){list.hidden=true;list.replaceChildren();input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');rows=[];active=-1;}
    function highlight(i){
      active=i;
      list.querySelectorAll('[role=option]').forEach((o,j)=>o.setAttribute('aria-selected',String(j===i)));
      const o=list.children[i];
      if(o){input.setAttribute('aria-activedescendant',o.id);o.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
    }
    function pick(i){const a=rows[i];if(!a)return;input.value=fullLabel(a);close();say('');onSelect(a);}
    async function run(){
      const id=++seq,text=input.value;
      if(!text.trim()){close();say('');return;}
      let res;
      try{res=await search(base,version,text);}
      catch{if(id===seq){close();say('Address search is not available right now.');}return;}
      if(id!==seq)return;
      if(res.short){close();say('');return;}
      rows=res.rows;list.replaceChildren();
      rows.forEach((a,i)=>{
        const o=document.createElement('li');o.id=`${list.id}-${i}`;o.className='property-option';o.setAttribute('role','option');o.setAttribute('aria-selected','false');
        o.innerHTML=`<span>${esc(label(a))}</span><small>${esc(a.suburb||'Auckland')}</small>`;
        o.addEventListener('pointerdown',e=>e.preventDefault());o.addEventListener('click',()=>pick(i));
        list.append(o);
      });
      list.hidden=!rows.length;input.setAttribute('aria-expanded',String(!!rows.length));active=-1;
      say(!rows.length?'No matching address. Check the spelling or try the street name alone.'
        :res.streetOnly&&res.total>rows.length?`First ${rows.length} of ${nf(res.total)} addresses. Add a house number to narrow.`
        :res.total>rows.length?`Top ${rows.length} of ${nf(res.total)} matches.`:'');
    }
    input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,140);});
    input.addEventListener('keydown',e=>{
      if(e.key==='ArrowDown'&&rows.length){e.preventDefault();highlight((active+1)%rows.length);}
      else if(e.key==='ArrowUp'&&rows.length){e.preventDefault();highlight((active-1+rows.length)%rows.length);}
      else if(e.key==='Enter'){e.preventDefault();if(rows.length)pick(Math.max(active,0));else{clearTimeout(timer);run().then(()=>rows.length===1&&pick(0));}}
      else if(e.key==='Escape'&&!list.hidden){e.stopPropagation();close();}
    });
    input.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==input)close();},150));
    input.addEventListener('focus',()=>{if(input.value.trim()&&list.hidden)run();});
  }

  const api={normText,normStreet,shardKey,parseQuery,label,fullLabel,search,decode,load,render,bind,bindSearch,TENURE};
  root.ALTOProperty=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
