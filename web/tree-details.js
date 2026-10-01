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
  async function readJSON(url) {
    const res=await fetch(url);
    if (!res.ok) throw new Error(`Detail request failed (${res.status})`);
    let bytes=new Uint8Array(await res.arrayBuffer());
    // Works with Apache Content-Encoding and plain static servers alike.
    if (bytes[0]===31 && bytes[1]===139) {
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes=new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function cached(url) {
    if (!caches.has(url)) {
      caches.set(url,readJSON(url).catch(err=>{caches.delete(url);throw err;}));
      if(caches.size>40)caches.delete(caches.keys().next().value);
    }
    return caches.get(url);
  }
  function decode(schema, id, packed) {
    if(!packed)throw new Error('No detailed record for this tree');
    const datasets={};
    for(const d of schema.datasets) {
      if(!Object.prototype.hasOwnProperty.call(packed,d.key))continue;
      const expand=values=>Object.fromEntries(d.fields.map((name,i)=>[name,values[i]??null]));
      datasets[d.key]=d.multiple?packed[d.key].map(expand):expand(packed[d.key]);
    }
    return {tree_id:id,snapshot:schema.generated_utc,database_mtime_ns:schema.database_mtime_ns,datasets};
  }
  async function load(base,version,id) {
    const dir=`${base}/tree_details`,q=`?v=${encodeURIComponent(version)}`;
    const schema=await cached(`${dir}/schema.json${q}`);
    const pack=await cached(`${dir}/${bucketPath(id,schema.bucket_algorithm)}${q}`);
    return {schema,record:decode(schema,id,pack[id])};
  }
  function overviewProps(record,original) {
    const d=record.datasets;
    const merged={...original};
    for(const k of ['record','context','species','assets','services','pointcloud','crown','ground'])
      for(const [name,value] of Object.entries(d[k]||{})) if(value!==null)merged[name]=value;
    const p=d.predictions;
    if(p&&!merged.species_class){merged.species_class=p.predicted_species_class;merged.species_class_confidence=p.species_class_confidence;}
    if(d.scenarios?.length && merged.total_value_nzd_y==null)merged.scenario_total_value_nzd_y=d.scenarios[0].total_value_nzd_y;
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
    condition_proxy:'Condition guess',condition_confidence:'Condition confidence',pc_false_positive:'Possible false detection flag'
  };
  function label(name) {return LABELS[name] || name.replace(/_nzd_y$/, ' (NZ$/year)').replace(/_m3_y$/, ' (m³/year)').replace(/_m2$/, ' (m²)').replace(/_m$/, ' (m)').replace(/_cm$/, ' (cm)').replace(/_kg$/, ' (kg)').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());}
  function formatted(name,v) {
    if(typeof v==='number')return esc(new Intl.NumberFormat('en-NZ',{maximumFractionDigits:/score|proba|fraction|confidence/.test(name)?3:2}).format(v));
    if(name==='assumptions_json'||name==='foliage_profile'||name.endsWith('_json')){
      let parsed=v;try{parsed=JSON.parse(v);}catch{}
      return `<pre class="pp-raw-value">${esc(typeof parsed==='string'?parsed:JSON.stringify(parsed,null,2))}</pre>`;
    }
    if(name==='root_constraint_flag'&&v==='at_risk')return 'Space deficit (model flag; stored as at_risk)';
    return esc(v);
  }
  function render(schema,record) {
    let html='<div class="pp-section pp-research"><h3>All evidence &amp; estimates</h3><p class="pp-note">Browse the source records, survey observations and estimates behind this tree. Alternative estimates and review flags are included. Values are rounded here; the JSON download keeps full precision.</p><button type="button" class="pp-download-record">Download this tree’s full record</button></div>';
    const crownDBH=record.datasets.assets?.dbh_cm_crown_est,rootDBH=record.datasets.roots?.dbh_cm;
    if(crownDBH!=null&&rootDBH!=null&&Math.abs(crownDBH-rootDBH)>0.01)html+=`<div class="pp-section"><p class="pp-note"><strong>The models disagree:</strong> the crown-based trunk estimate is ${formatted('dbh',crownDBH)} cm; the root model used ${formatted('dbh',rootDBH)} cm. Both are retained here so their inputs can be compared and checked on the ground.</p></div>`;
    for(const d of schema.datasets) {
      const data=record.datasets[d.key];
      if(!data)continue;
      const rows=d.multiple?data:[data];
      const available=rows.reduce((n,r)=>n+Object.values(r).filter(v=>v!==null&&v!=='').length,0);
      html+=`<details class="pp-dataset" ${['roots','trajectory'].includes(d.key)?'open':''}><summary>${esc(d.title)} <span>${esc(d.evidence)} · ${available} values</span></summary><p class="pp-note">${esc(d.note)}</p>`;
      rows.forEach((r,i)=>{
        if(rows.length>1)html+=`<h4>Scenario ${i+1}</h4>`;
        for(const [key,value] of Object.entries(r)) {
          if(value===null||value==='')continue;
          html+=`<div class="pp-row" title="${esc(d.table+'.'+key)}"><span class="pp-label">${esc(label(key))}</span><span class="pp-value">${formatted(key,value)}</span></div>`;
        }
      });
      html+=`<p class="pp-note">Source table: ${esc(d.table)}</p></details>`;
    }
    return html;
  }
  const api={bucketId,bucketPath,decode,load,overviewProps,render};
  root.ALTOTreeDetails=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
