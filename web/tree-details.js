/* Per-tree research details. The map tiles remain the fast visual index.
 *
 * Records are hashed into 65,536 buckets of about 60 KB (FNV-1a of the tree id, mod 65536,
 * four hex digits as {hh}/{hh}.json.gz). A release that still carries the earlier 4,096
 * flat buckets says so in schema.json, and the loader follows the schema rather than
 * assuming. */
(function(root) {
  const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function fnv(id) {
    let h=2166136261;
    for (const b of new TextEncoder().encode(id)) h=Math.imul(h ^ b,16777619) >>> 0;
    return h;
  }
  function bucketPath(id, algorithm) {
    const h=fnv(id);
    if (/mod4096/.test(algorithm||'')) return (h % 4096).toString(16).padStart(3,'0')+'.json.gz';
    const n=(h % 65536).toString(16).padStart(4,'0');
    return n.slice(0,2)+'/'+n.slice(2)+'.json.gz';
  }
  const bucketId = id => (fnv(id) % 4096).toString(16).padStart(3,'0');
  const caches=new Map();
  // Found, absent or unavailable: a 404 bucket is an absent record; a network error, a server error or a file that cannot
  // be read is unavailable, and says which file and why (never "not in this release").
  const fileOf=url=>String(url).replace(/\?.*$/,'').replace(/^.*?\/data\//,'data/').replace(/^\.\//,'');
  const failure=(url,reason,extra={})=>Object.assign(new Error(`Not loaded: ${fileOf(url)} (${reason}).`),{unavailable:true,file:fileOf(url),reason},extra);
  // A file's text: fetched (or taken from the tree page's early fetch), gunzipped when it is gzip.
  async function readText(url) {
    let res;
    try{res=await (root.ALTO_PREFETCH?.take?.(url)||fetch(url));}catch{throw failure(url,'network error');}  // FE-03: a schema tree.html started early
    if (!res.ok) {
      if(res.status===404)throw Object.assign(new Error(`Detail request failed (${res.status})`),{absent:true,status:404});
      throw failure(url,`HTTP ${res.status}`,{status:res.status});
    }
    try{
      let bytes=new Uint8Array(await res.arrayBuffer());
      // Works with Apache Content-Encoding and plain static servers alike.
      if (bytes[0]===31 && bytes[1]===139) {
        const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes=new Uint8Array(await new Response(stream).arrayBuffer());
      }
      return new TextDecoder().decode(bytes);
    }catch{throw failure(url,'could not be read');}
  }
  const readJSON=url=>readText(url).then(t=>{try{return JSON.parse(t);}catch{throw failure(url,'could not be read');}});
  function remember(url,read) {
    if (!caches.has(url)) {
      caches.set(url,read(url).catch(err=>{caches.delete(url);throw err;}));
      if(caches.size>40)caches.delete(caches.keys().next().value);
    }
    return caches.get(url);
  }
  const cached=url=>remember(url,readJSON);
  // FE-17: a bucket (about 60 KB gzipped, several hundred KB of JSON) is kept as text and only the record asked for is
  // parsed: about a millisecond on a phone-class CPU where parsing the whole bucket blocked the page for over 100 ms.
  // Buckets are written by json.dumps, so an ASCII tree id is its own key, top level, after "{" or ",". The value ends
  // where its brackets close (strings and escapes skipped). An id that is not plain ASCII parses the whole bucket.
  const bucketText=url=>remember(url,u=>readText(u).then(text=>({text,parsed:null})));
  const PLAIN=/^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/;
  function pick(bucket,id) {
    const text=bucket.text;
    if (!PLAIN.test(id)) { if(!bucket.parsed)bucket.parsed=JSON.parse(text); return bucket.parsed[id]; }
    const key=`"${id}"`;
    for (let at=text.indexOf(key); at>=0; at=text.indexOf(key,at+key.length)) {
      let p=at-1; while(p>=0&&(text[p]===' '||text[p]==='\n'||text[p]==='\r'||text[p]==='\t'))p--;
      if (p<0||(text[p]!=='{'&&text[p]!==','))continue;                       // not a key of the bucket
      let i=at+key.length; while(text[i]===' '||text[i]==='\n'||text[i]==='\r'||text[i]==='\t')i++;
      if (text[i]!==':')continue;
      i++; while(text[i]===' '||text[i]==='\n'||text[i]==='\r'||text[i]==='\t')i++;
      const start=i;
      if (text[i]==='{'||text[i]==='[') {
        let depth=0;
        for (;i<text.length;i++) {
          const c=text[i];
          if (c==='"') { for (i++;i<text.length&&text[i]!=='"';i++) if(text[i]==='\\')i++; continue; }
          if (c==='{'||c==='[') depth++;
          else if ((c==='}'||c===']')&&--depth===0) { i++; break; }
        }
      } else {
        while (i<text.length&&text[i]!==','&&text[i]!=='}')i++;
      }
      return JSON.parse(text.slice(start,i));
    }
    return undefined;
  }
  function decode(schema, id, packed) {
    if(!packed)throw Object.assign(new Error('No detailed record for this tree'),{absent:true});
    const datasets={};
    for(const d of schema.datasets) {
      if(!Object.prototype.hasOwnProperty.call(packed,d.key))continue;
      const expand=values=>Object.fromEntries(d.fields.map((name,i)=>[name,values[i]??null]));
      datasets[d.key]=d.multiple?packed[d.key].map(expand):expand(packed[d.key]);
    }
    return {tree_id:id,snapshot:schema.generated_utc,database_mtime_ns:schema.database_mtime_ns,datasets};
  }
  // The schema, read ahead (a shared tree link reads it while its number is looked up).
  function prefetch(base,version){return cached(`${base}/tree_details/schema.json?v=${encodeURIComponent(version)}`).catch(()=>null);}
  async function load(base,version,id) {
    const dir=`${base}/tree_details`,q=`?v=${encodeURIComponent(version)}`;
    const schema=await cached(`${dir}/schema.json${q}`);
    const url=`${dir}/${bucketPath(id,schema.bucket_algorithm)}${q}`,bucket=await bucketText(url);
    let packed;
    try{packed=pick(bucket,id);}catch{throw failure(url,'could not be read');}
    return {schema,record:decode(schema,id,packed)};
  }
  const RETIRED_63=['total_value_nzd_y','total_value_nzd_y_low','total_value_nzd_y_high','air_quality_value_nzd_y','cooling_value_nzd_y','cooling_value_nzd_y_temp',
    'cooling_value_nzd_y_paved','pm25_removed_kg_y','life_stage','irreplaceability_class'];
  function overviewProps(record,original) {
    const d=record.datasets;
    const merged={...original};
    for(const k of ['record','context','species','assets','services','pointcloud','crown','ground'])
      for(const [name,value] of Object.entries(d[k]||{})) if(value!==null)merged[name]=value;
    const p=d.predictions;
    if(p&&!merged.species_class){merged.species_class=p.predicted_species_class;merged.species_class_confidence=p.species_class_confidence;}
    // Release 6.3: the benefits and size datasets hold the current values, under the map's field names; the retired ones
    // (services total, air-quality and cooling dollars, the v6 PM2.5 rule; assets life_stage, irreplaceability_class and
    // the regrowth years on the v5.2 class) stay in the full record only.
    if(d.benefits||d.size){
      for(const k of RETIRED_63)delete merged[k];
      const b=d.benefits,z=d.size;
      if(b)for(const k of ['benefit_value_nzd_y','benefit_value_nzd_y_low','benefit_value_nzd_y_high'])merged[k]=b[k]??null;
      if(z){merged.height_class=z.height_class??null;merged.crown_replacement=z.crown_replacement??null;merged.replacement_years_canopy=z.regrowth_years??null;merged.species_class=z.class_used||merged.species_class;}
    }
    if(d.scenarios?.length && merged.total_value_nzd_y==null && merged.benefit_value_nzd_y==null && !d.benefits?.withheld_reason)merged.scenario_total_value_nzd_y=d.scenarios[0].total_value_nzd_y;
    if(d.location_review){merged.notable_point_review_required=1;merged.evidence_tier="location_unverified";}if(d.notable_link_review){merged.is_protected_notable=d.notable_link_review.protected_from_verified_or_group_evidence;merged.notable_point_review_required=1;}
    return merged;
  }
  const LABELS={
    h_2013:'Canopy height in 2013 (m)',h_2016:'Canopy height in 2016 (m)',h_2024:'Canopy height in 2024 (m)',
    growth_2013_2016:'Height change 2013–2016 (m/year)',growth_2016_2024:'Height change 2016–2024 (m/year)',
    dbh_cm:'Trunk diameter used by root model (cm)',dbh_cm_est:'Trunk diameter used (cm)',dbh_cm_crown_est:'Trunk diameter from crown (cm)',
    rpa_radius_m:'Root-protection radius scenario (m)',rpa_area_m2:'Root-protection area scenario (m²)',
    stability_radius_m:'Assumed anchorage radius (m)',foraging_radius_m:'Foraging radius estimate (m)',effective_radius_m:'Effective root radius estimate (m)',effective_area_m2:'Effective root area estimate (m²)',
    total_value_nzd_y:'Annual value estimate (NZ$/year)',total_value_nzd_y_low:'Lower value scenario (NZ$/year)',total_value_nzd_y_high:'Upper value scenario (NZ$/year)',
    annual_sequestration_tco2e_y_est:'Annual carbon sequestration (tCO₂e/year)',stored_co2e_tonnes_est:'Carbon stored (tCO₂e)',
    agb_kg_est:'Above-ground biomass estimate (kg)',bgb_kg_est:'Below-ground biomass estimate (kg)',
    assumptions_json:'Calculation assumptions',foliage_profile:'Foliage profile by height',
    proba_evergreen_broadleaf:'Evergreen broadleaf score',proba_deciduous_broadleaf:'Deciduous broadleaf score',proba_conifer:'Conifer score',proba_palm_other:'Palm / other score',
    release_eligible:'Stored legacy release flag',score_semantics:'Meaning of the stored scores',mature_height_m:'Species reference mature height (m)',
    condition_proxy:'Condition guess',condition_confidence:'Condition confidence',pc_false_positive:'Possible false detection flag',
    life_stage:'Height class',
    // Release 6.3 size dataset.
    height_class:'Height class',height_share_pct:'Height as a share of the reference height (%)',reference_height_m:'Reference height for the growth form (m)',
    class_used:'Growth form used (the benefit estimates’ class)',regrowth_years:'Years for a new crown to reach this crown area at the planning rate',planning_rate_m2_y:'Planning rate (m² of new crown a year)',
    replacement_band:'Crown replacement band',crown_replacement:'Crown replacement time',not_classed_reason:'Not classed because',tall_tree:'Tall tree (25 m or taller)',
    in_comparisons:'In comparisons',comparisons_excluded_by:'Left out of comparisons by',withheld_reason:'Estimates withheld because'
  };
  function label(name) {return LABELS[name] || name.replace(/_nzd_y$/, ' (NZ$/year)').replace(/_m3_y$/, ' (m³/year)').replace(/_m2$/, ' (m²)').replace(/_m$/, ' (m)').replace(/_cm$/, ' (cm)').replace(/_kg$/, ' (kg)').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());}
  const FT=0.3048;
  function formatted(name,v,ds=null) {
    // DB-11: up to release 6.2 the i-Tree species reference stored mature height in feet under a metres name (Agathis
    // australis 165): shown converted (× 0.3048), and the plausibility flag was computed against the unconverted value.
    // Release 6.3 stores metres (mature_height_m) beside the value as supplied (mature_height_ft_as_supplied).
    const metres=!!ds?.fields?.includes('mature_height_ft_as_supplied');
    if(name==='mature_height_m'&&metres&&Number.isFinite(Number(v))&&v!==''&&v!==null)return esc(new Intl.NumberFormat('en-NZ',{maximumFractionDigits:1}).format(Number(v)));
    if(name==='mature_height_m'&&Number.isFinite(Number(v))&&v!==''&&v!==null)return `${esc(new Intl.NumberFormat('en-NZ',{maximumFractionDigits:1}).format(Number(v)*FT))} <small class="pp-sub">(i-Tree value in feet, converted)</small>`;
    if(name==='height_plausibility'&&!ds?.retired_fields?.height_plausibility)return `${esc(v)} <small class="pp-sub">(computed in release 6.2 against the unconverted value; to be recomputed)</small>`;
    // Release 6.3 yes/no flags (size and benefits datasets), before numbers.
    if(name==='tall_tree'||name==='in_comparisons')return v===1||v==='1'||v===true?'Yes':v===0||v==='0'||v===false?'No':esc(v);
    if(name==='release_eligible'&&ds?.key==='benefits')return v===1||v==='1'?'Yes':v===0||v==='0'?'No: kept in the record only':esc(v);
    if(typeof v==='number')return esc(new Intl.NumberFormat('en-NZ',{maximumFractionDigits:/score|proba|fraction|confidence/.test(name)?3:2}).format(v));
    if(name==='assumptions_json'||name==='foliage_profile'||name.endsWith('_json')){
      let parsed=v;try{parsed=JSON.parse(v);}catch{}
      return `<pre class="pp-raw-value">${esc(typeof parsed==='string'?parsed:JSON.stringify(parsed,null,2))}</pre>`;
    }
    if(name==='root_constraint_flag'&&v==='at_risk')return 'Space deficit (model flag; stored as at_risk)';
    // TS-07: the release stores the height class as life_stage; shown by its size name (tree-summary.js HEIGHT_CLASS).
    if(name==='life_stage'){const c=root.ALTOTreeSummary?.heightClass(v);if(c)return `${esc(c.label)} <small class="pp-sub">(stored as ${esc(v)})</small>`;}
    // Release 6.3 size dataset: classes, bands and reasons by their names.
    const T=root.ALTOTreeSummary;
    if(name==='height_class'){const c=T?.heightClass(v);if(c)return esc(c.label);}
    if(name==='replacement_band'||name==='crown_replacement'){if(v==='not_classed')return 'Not classed';const b=T?.band(v);if(b)return esc(b.label);}
    if(name==='not_classed_reason'||name==='withheld_reason'){const w=T?.NOT_CLASSED?.[v];if(w)return esc(w.charAt(0).toUpperCase()+w.slice(1));}
    if(name==='comparisons_excluded_by'||name==='excluded_from')return esc(String(v).split(',').map(x=>({height_check:'height check',link_check:'record and crown check',under_5m:'crown under 5 m',height_not_plausible:'height not plausible',no_estimate:'no crown estimate',
      comparisons:'comparisons',maxima:'Species maxima',property_tallest:'property tallest tree',estimates:'estimates',totals:'totals'}[x.trim()]||x.trim().replace(/_/g,' '))).join(', '));
    if(name==='class_used'){const W={evergreen_broadleaf:'Evergreen broadleaf',deciduous_broadleaf:'Deciduous broadleaf',conifer:'Conifer',palm_other:'Palm or palm-like'};if(W[v])return W[v];}
    return esc(v);
  }
  // opts.hide: "dataset.field" names left out of the view (release 6.3: PM2.5 removal and the cooling index while the
  // release does not publish them; they stay in the record).
  function render(schema,record,opts={}) {
    const hide=new Set(opts.hide||[]);
    let html='<div class="pp-section pp-research"><h3>All evidence &amp; estimates</h3><p class="pp-note">Browse the source records, survey observations and estimates behind this tree. Alternative estimates and review flags are included. Values are rounded for display.</p></div>';
    const crownDBH=record.datasets.assets?.dbh_cm_crown_est,rootDBH=record.datasets.roots?.dbh_cm;
    if(crownDBH!=null&&rootDBH!=null&&Math.abs(crownDBH-rootDBH)>0.01)html+=`<div class="pp-section"><p class="pp-note"><strong>The models disagree:</strong> the crown-based trunk estimate is ${formatted('dbh',crownDBH)} cm; the root model used ${formatted('dbh',rootDBH)} cm. Both are retained here so their inputs can be compared and checked on the ground.</p></div>`;
    for(const d of schema.datasets) {
      const data=record.datasets[d.key];
      if(!data)continue;
      const rows=d.multiple?data:[data];
      const available=rows.reduce((n,r)=>n+Object.values(r).filter(v=>v!==null&&v!=='').length,0);
      html+=`<details class="pp-dataset" ${['roots','trajectory'].includes(d.key)?'open':''}><summary>${esc(d.title)} <span>${esc(d.evidence)} · ${available} values</span></summary><p class="pp-note">${esc(d.note)}</p>`;
      rows.forEach((r,i)=>{
        if(rows.length>1)html+=`<h4>${d.key==='scenarios'?'Scenario':'Entry'} ${i+1}</h4>`;
        for(const [key,value] of Object.entries(r)) {
          if(value===null||value===''||hide.has(`${d.key}.${key}`))continue;
          // Release 6.3: a field's own label from the schema, and a retired field's note (kept for provenance; not
          // release-eligible) beside its value.
          const retired=d.retired_fields?.[key];
          html+=`<div class="pp-row${retired?' pp-retired':''}" title="${esc(d.table+'.'+key)}"><span class="pp-label">${esc(d.field_labels?.[key]||label(key))}</span><span class="pp-value">${formatted(key,value,d)}${retired?` <small class="pp-sub">${esc(retired)}</small>`:''}</span></div>`;
        }
      });
      html+=`<p class="pp-note">Source table: ${esc(d.table)}</p></details>`;
    }
    return html;
  }
  const api={bucketId,bucketPath,decode,load,overviewProps,render,prefetch,pick};
  root.ALTOTreeDetails=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
