/* Release fields: what a map feature, a parcel record or a tree's full record carries in data releases 6.2 and 6.3,
 * read one way on every surface (map, tree panel, tree page, Area, property, Species maxima).
 *
 * Release 6.3 renamed or replaced fields: benefit_value_nzd_y (stormwater and carbon) for total_value_nzd_y, which also
 * counted air-quality and cooling dollars; height_class for life_stage; crown_replacement (a band of years, or
 * not_classed) for irreplaceability_class; parcels carry benefit_value_nzd_y(_low/_high/_confident) and
 * n_height_not_plausible. It added hchk (height check: implausible or check), lchk (record and crown check: check or
 * likely_different), grp (the Schedule 10 item of a Notable Group of Trees area holding the marker) and sp (the species
 * key, an accepted binomial). The tool reads whichever a feature carries, so the same build serves release 6.3 and,
 * after a rollback, release 6.2. Page-wide choices (PM2.5 and the cooling index, the release's methods page) follow the
 * release metadata. Nothing here computes an estimate.
 * UMD: window.ALTOFields, or require(). */
(function(root){
  'use strict';
  const num=v=>{if(v===null||v===undefined||v===''||typeof v==='boolean')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const has=(o,k)=>!!o&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,k)&&o[k]!==undefined;

  // ---------- benefits ----------
  // A feature's or a parcel's benefit value a year, with its band: release 6.3's benefit_value_nzd_y (stormwater and
  // carbon), else release 6.2's total_value_nzd_y (stormwater, carbon, air quality and cooling). basis names which.
  // A 6.3 feature whose estimates are withheld (height not plausible) carries neither: null.
  function benefit(p){
    if(has(p,'benefit_value_nzd_y'))return {value:num(p.benefit_value_nzd_y),low:num(p.benefit_value_nzd_y_low),high:num(p.benefit_value_nzd_y_high),
      confident:num(p.benefit_value_confident_nzd_y),basis:'stormwater_carbon'};
    if(has(p,'total_value_nzd_y'))return {value:num(p.total_value_nzd_y),low:num(p.total_value_nzd_y_low),high:num(p.total_value_nzd_y_high),
      confident:num(p.total_value_confident_nzd_y),basis:'total_v62'};
    return null;
  }
  const benefitValue=p=>benefit(p)?.value??null;
  // Release 6.3 names the services it adds up; release 6.2's total also held air quality and cooling.
  const BASIS_WORDS={stormwater_carbon:'stormwater and carbon',total_v62:'stormwater, carbon, air quality and cooling'};
  // Auckland's benefit total from the metadata's headline totals (dataset.headline_totals).
  function headlineBenefit(h){
    if(num(h?.benefitValueNzdY)!==null)return {value:num(h.benefitValueNzdY),basis:'stormwater_carbon'};
    if(num(h?.totalValueNzdY)!==null)return {value:num(h.totalValueNzdY),basis:'total_v62'};
    return null;
  }

  // ---------- height class ----------
  // Release 6.3 stores height_class (very_small … very_large); release 6.2 stored the same classes from height under
  // the life_stage keys of tree-summary.js HEIGHT_CLASS (the one table), shown by the same size names.
  const CLASSES=['very_small','small','medium','large','very_large'];
  const SUMMARY=()=>root.ALTOTreeSummary||(typeof require==='function'?require('./tree-summary.js'):null);
  function heightClassKey(p){
    if(has(p,'height_class'))return CLASSES.includes(p.height_class)?p.height_class:null;
    const k=p?.life_stage;return k?SUMMARY()?.heightClass(k)?.key||null:null;
  }
  // A map expression for one height class: release 6.3's height_class, or the life_stage key release 6.2 stored.
  function heightClassExpr(key){
    const c=SUMMARY()?.heightClass(key);if(!c)return null;
    return ['any',['==',['get','height_class'],c.key],['==',['get','life_stage'],c.stored62]];
  }

  // ---------- crown replacement time ----------
  // Release 6.3: crown_replacement is a band of years (under_5y, 5_15y, 15_40y, 40_80y, 80y_plus) or not_classed.
  const BANDS=['under_5y','5_15y','15_40y','40_80y','80y_plus'];
  function crownReplacement(p){
    if(!has(p,'crown_replacement'))return null;
    const v=p.crown_replacement;return v==='not_classed'||BANDS.includes(v)?v:null;
  }

  // ---------- flags (release 6.3) ----------
  const heightCheck=p=>p?.hchk==='implausible'||p?.hchk==='check'?p.hchk:null;
  const linkCheck=p=>p?.lchk==='likely_different'||p?.lchk==='check'?p.lchk:null;
  // A marker flagged by either check stays out of rankings, maxima and "largest/tallest/highest in this view"; its
  // values stay in the totals the release counts (a height not plausible carries no estimates, so adds none).
  const flagged=p=>!!(heightCheck(p)||linkCheck(p));
  const implausible=p=>heightCheck(p)==='implausible';
  // The Schedule 10 item of the Notable Group of Trees area holding the marker (release 6.3), or null.
  const groupItem=p=>{const n=num(p?.grp);return n!==null&&n>0?n:null;};
  const speciesKey=p=>typeof p?.sp==='string'&&p.sp.trim()?p.sp.trim():null;

  // ---------- the release ----------
  // The data release a metadata file describes: {label:'v6.3', number:6.3}; data_release first, else the dataset_version
  // ("metro-2026.10.17-pointcloud-v6.3").
  function release(meta){
    const r=meta?.release||{};
    for(const s of [r.data_release,r.dataset_version]){
      const m=/v(\d+)(?:\.(\d+))?\s*$/.exec(String(s||''));
      if(m)return {label:`v${m[1]}${m[2]!==undefined?`.${m[2]}`:''}`,number:Number(`${m[1]}.${m[2]||0}`)};
    }
    return null;
  }
  const atLeast=(meta,n)=>{const r=release(meta);return !!r&&r.number>=n-1e-9;};
  // PM2.5 removal and the cooling index are shown only when the release says they are published: benefits.
  // pm25_cooling_approved (the release switch) and benefits.pm25_cooling_published (the build's result), top level or under
  // dataset. Either one false, or neither present, keeps both hidden (release 6.3: false).
  function pm25CoolingShown(meta){
    const b=meta?.benefits||meta?.dataset?.benefits||null;if(!b)return false;
    const a=b.pm25_cooling_approved,p=b.pm25_cooling_published;
    return (a===true||p===true)&&a!==false&&p!==false;
  }

  // ---------- the species filter ----------
  // species_options.json as filter groups. Release 6.3 (version 2): options keyed by species (sp on the map: the
  // accepted binomial, or the common name where no Latin name is recorded), grouped by common name, each Latin name a
  // sub-option; release 6.2 (version 1): one option per common name. Spellings, macrons and the kauri survey's old result
  // codes fold into one group (species-names.js); a source string naming several species is its own group, "Recorded
  // as: …". -> {keyed, groups:[{key, label, count, names, multi, subs:[{key, latin, count}], keys}]}; keys are the filter
  // values a group selects (species keys, or its source spellings).
  function speciesGroups(d,N){
    const keyed=!!d&&d.version===2&&Array.isArray(d.options)&&!!d.common_names,g=new Map();
    const groupOf=name=>{
      const multi=N?N.isMulti(name):/,/.test(name),key=multi?'multi:'+name:(N?N.key(name):name.toLowerCase());
      if(!g.has(key))g.set(key,{key,label:multi?`Recorded as: ${name}`:(N?N.display(name):name),count:0,names:[],multi,subs:new Map()});
      return g.get(key);
    };
    if(keyed){
      const latinOf=new Map(d.options.map(o=>[o.key,o.latin??null]));
      for(const [name,list] of Object.entries(d.common_names)){
        if(!name||name==='Unknown'||!Array.isArray(list))continue;
        const x=groupOf(name);x.names.push(name);
        for(const [k,n] of list){x.count+=n;const s=x.subs.get(k)||{key:k,latin:latinOf.get(k)??null,count:0};s.count+=n;x.subs.set(k,s);}
      }
    }else for(const [name,count] of (Array.isArray(d?.options)?d.options:[])){
      if(!name||name==='Unknown')continue;
      const x=groupOf(name);x.count+=count;x.names.push(name);
    }
    for(const x of g.values()){x.subs=[...x.subs.values()].sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));x.keys=keyed?x.subs.map(s=>s.key):x.names;}
    return {keyed,groups:[...g.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))};
  }
  // The filter on the map features: release 6.3 species keys (sp), release 6.2 common names (species_common).
  const speciesExpr=(values,keyed)=>keyed?['match',['coalesce',['get','sp'],'__none__'],[...values],true,false]:['match',['coalesce',['get','species_common'],'Unknown'],[...values],true,false];

  const api={num,benefit,benefitValue,BASIS_WORDS,headlineBenefit,CLASSES,heightClassKey,heightClassExpr,BANDS,crownReplacement,
    heightCheck,linkCheck,flagged,implausible,groupItem,speciesKey,speciesGroups,speciesExpr,release,atLeast,pm25CoolingShown};
  root.ALTOFields=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
