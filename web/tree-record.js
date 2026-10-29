/* ALTO tree record: one tree and everything the release holds about it, as plain data.
 *
 * Schema alto.tree-record/1, documented in docs/tool/tree-record.md. Built for any presentation (the tree
 * page, the map's tree panel, a later collection page): nothing here writes HTML, and nothing here
 * estimates anything new. Every value is a stored release value, a value from a published derived file,
 * or a stated formula over them (equivalent-circle diameter, percentile within a published distribution, the
 * median of the release's trunk-diameter models, the release's root protection rule of 12 × trunk diameter).
 *
 *   const rec = await ALTOTreeRecord.load(input, env)    resolve the ID, read the record and its crown's
 *                                                        other records, assemble
 *   ALTOTreeRecord.assemble({...})                       the synchronous core (used by load and tests)
 *   ALTOTreeRecord.fromTile(props, env)                  a record from map-tile properties alone (loaded:false)
 *   await ALTOTreeRecord.enrich(rec, env, {parts, onPart})   network parts: context, history, corrections,
 *                                                        imagery, points, place, photos, field (field measurements)
 *   ALTOTreeRecord.fromMap(rec, {points, parcelId, tileProps})   nearby trees and land type from a map
 *
 * env = {dataBase:'./data', siteRoot:'.', derivedBase (default <siteRoot>/derived/<dataset_version>),
 *        version (cache stamp), metadata (release-metadata.json), kyteBase (default <siteRoot>/kyte)}
 *
 * Every number is a Quantity {key,label,value,unit,text,kind,range,provenance}. kind is measured |
 * recorded | model | derived | rule, so a presentation can always say which values are model estimates.
 * Parts filled later carry a status: pending | ready | none | not_published | release_mismatch |
 * unavailable. */
(function(root){
  'use strict';
  const SCHEMA='alto.tree-record/1';
  const dep=name=>root[name]||null;
  // Numbers print by the one shared rule set (alto-format.js, FE-16), so a record's texts match the panel and the page.
  const F=root.ALTOFormat||(typeof require==='function'?require('./alto-format.js'):null);
  const num=F.num,nf=F.nf;
  const parse=v=>{try{return typeof v==='string'?JSON.parse(v):v;}catch{return null;}};
  const words=s=>s===null||s===undefined||s===''?null:String(s).replaceAll('_',' ');
  const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
  const UNKNOWN=/^(unknown|unidentified( tree)?|not known|species not recorded|species unrecorded|0 records found\.?|n\/a|none)$/i;
  const named=v=>typeof v==='string'&&v.trim()&&!UNKNOWN.test(v.trim())?v.trim():null;
  // How a record's species name was obtained (record.species_confidence).
  const SPECIES_BASIS={source_species:'As named by the source',source_notable_name:'Name from the Notable Trees schedule',source_common_only:'Common name only, as supplied by the source',
    source_genus:'Genus only, as supplied by the source',source_taxon:'Taxon as supplied by the source',source_kauri_observation:'Kauri, as recorded by the survey',
    source_explicitly_not_kauri:'Recorded by the survey as not kauri',field_confirmed_observer:'Confirmed on site by an observer',unknown:'Not recorded'};
  const speciesBasis=v=>!v||/_no_species$/.test(v)?null:SPECIES_BASIS[v]||cap(words(v));

  // ---------- dates ----------
  function dated(iso,prefix=''){
    if(!iso)return null;
    const s=String(iso),d=new Date(s.length===10?s+'T12:00:00':s);
    if(Number.isNaN(d.getTime()))return {iso:s,text:prefix+s};
    const two=n=>String(n).padStart(2,'0');
    return {iso:`${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`,text:prefix+d.toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric'}).replace(/\bSept\b/,'Sep')};
  }

  // ---------- sources, methods and models ----------
  const REPO='https://github.com/squirmen/alto/blob/main/';
  // Data sources a value can come from. Records name their own dataset (ALTOSources.dataset).
  // Each names the licensor as LINZ's layer metadata does, with LINZ's wording (credits.html lists every source).
  const SOURCE={
    lidar2024:'Auckland 2024 LiDAR survey, flown by Woolpert; licensed by Regional Software Holdings Limited and Auckland Council; sourced from LINZ, CC BY 4.0',
    aerial2024:'Auckland 2024–25 aerial imagery, flown by Aerial Surveys; licensed by Auckland Council; sourced from LINZ, CC BY 4.0',
    lidarEarlier:'Auckland 2013 and 2016–18 LiDAR surveys (Auckland Council; sourced from LINZ, CC BY 4.0)',
    impervious:'Auckland Council impervious surfaces 2017 (Lynker Analytics and Healthy Waters, Auckland Council; CC BY 4.0)',
    schedule:'Auckland Unitary Plan, Schedule 10 Notable Trees (Notable Trees Overlay, Plans and Places, Auckland Council; CC BY 4.0)',
    alto:'ALTO release model',
    kyte:'KYTE ground visit (reviewed)'
  };
  // The 2024 survey's own specification (LINZ metadata for Auckland parts 1 and 2): captured 30 Apr –
  // 4 Nov 2024, at least 8 pulses/m², vertical ±0.2 m and horizontal ±1.0 m (95%).
  const SURVEY_2024={captured:{iso:'2024',text:'captured 30 Apr – 4 Nov 2024'},vertical:'±0.2 m vertical (95%)',horizontal:'±1.0 m horizontal (95%)',density:'at least 8 pulses/m²'};
  // Method ids stored in the release, with a plain description and where the method is written up.
  // notes: the release methods page (v5, v51, v52, v6) and anchor: the method's section on it (the methods pages'
  // stable anchors); doc: a method document in the public repository.
  const METHODS={
    pointcloud_v5_ndvi_watershed:{text:'Watershed segmentation of the 2024 point cloud, masked by aerial NDVI (v5)',notes:'v5',anchor:'crown-outline',doc:'docs/v5/segmentation.md'},
    pointcloud_v4_vegetation_watershed:{text:'Watershed segmentation of the 2024 vegetation returns (v4)',notes:'v5',anchor:'earlier-records',doc:'docs/v5/segmentation.md'},
    chm_point_constrained_chunked_v1:{text:'Canopy height model around the recorded position (earlier raster method)',doc:'docs/methods/tree_crown_service_pilot.md'},
    pointcloud_promoted_circular_v1:{text:'Circular crown from the point-cloud detection (earlier method)',doc:'docs/methods/inferred_tree_detection.md'},
    record_seeded_crown_v52:{text:'Crown drawn from the LiDAR returns at the recorded position (v5.2)',notes:'v52',anchor:'drawn-crowns',doc:'docs/v52/linking.md'},
    record_seeded_v52:{text:'Crown drawn from the LiDAR returns at the recorded position (v5.2)',notes:'v52',anchor:'drawn-crowns',doc:'docs/v52/linking.md'},
    record_crown_link_v52:{text:'Record joined to its crown by position, expected size and neighbouring records (v5.2)',notes:'v52',anchor:'record-links',doc:'docs/v52/linking.md'},
    v5_containment_with_v51_continuity_repair:{text:'Recorded position inside the crown, with the v5.1 continuity repair',notes:'v51',anchor:'record-links',doc:'docs/v51/crown-continuity.md'},
    crown_height_dbh_sensitivity_v5_inputs:{text:'Trunk diameter, height class and regrowth time from crown size and height (sensitivity model)',doc:'docs/methods/tree_asset_model.md'},
    root_space_sensitivity_v5_inputs:{text:'Root-space scenario from trunk and crown size',doc:'docs/validation/root_zone_summary.md'},
    arcgis_dsm_dem_2024_chm_sample_2m:{text:'Canopy height (2024 surface minus terrain) sampled within 2 m of the recorded position',doc:'docs/methods/tree_qa_layers.md'},
    pointcloud_v53_outline_B:{text:'Smoothed outline of the crown cells, area-preserving (v6)',notes:'v6',anchor:'outlines'},
    // Release 6.3 (tool 0.2.12).
    size_v63:{text:'Height class and crown replacement time from the 2024 crown height and area, on the growth form the benefit estimates use (release 6.3)',notes:'v63',anchor:'size'},
    benefits_v63:{text:'Benefit value: stormwater plus carbon, from the v6 service functions (release 6.3)',notes:'v63',anchor:'benefits'},
    height_check_v63:{text:'Height checks on the crown’s measured height (release 6.3)',notes:'v63',anchor:'height-checks'},
    link_check_v63:{text:'Checks that a record and its crown describe the same tree (release 6.3)',notes:'v63',anchor:'height-checks'}
  };
  const METHOD_PREFIX=[
    [/^growth_form_v6/,{text:'Growth-form model on the 2024 LiDAR structure and aerial imagery (v6)',notes:'v6',anchor:'growth-form'}],
    [/^valuation_/,{text:'ALTO benefit scenario: simplified equations adapted from published i-Tree Eco components; not run in i-Tree Eco',notes:'v5',anchor:'benefits',doc:'docs/methods/tree_valuation_pilot.md'}],
    [/^trajectory|^ws2_/,{text:'Canopy matched across the 2013, 2016 and 2024 surveys',doc:'docs/validation/ws2_trajectories_v1.md'}],
    [/outline/,{text:'Smoothed outline of the crown cells (v6)',notes:'v6',anchor:'outlines'}]
  ];
  // Release components in release-metadata.json "models", for the validation status of a model value.
  // Each kind of model value resolves its own release component (the 2040 height scenario is the canopy height
  // forecast, never the change layer, whose status is its photo check).
  const COMPONENT={crown:'crown_segmentation',growth:'growth_form_classifier',services:'ecosystem_services',roots:'root_space',change:'tree_change',forecast:'canopy_height_forecast'};
  // Model ids, as stored, to a readable name and version.
  function modelOf(env,component,id,version=null){
    const m=(env.metadata?.models||[]).find(x=>x.component===COMPONENT[component]);
    let status=m?.validation_status==='not_independently_validated'?'Not independently validated':m?.validation_status?cap(words(m.validation_status)):null;
    if(component==='forecast'&&status){
      const tr=m?.v5_transfer_validation;
      status=`${status}; transfer to release 5 ${!tr||tr==='not_yet_tested'?'not validated':words(tr)}`;
    }
    return id||version||status?{id:id?String(id).replace(/_not_release_eligible/,''):null,version:version||null,validation:status,component:COMPONENT[component]||null}:null;
  }

  // ---------- quantities ----------
  const FMT={m:(v,d=1)=>`${nf(v,d)} m`,m2:(v,d=1)=>`${nf(v,d)} m²`,cm:v=>`${nf(v)} cm`,nzd:v=>money(v),nzdy:v=>`${money(v)}/yr`,
    t:v=>co2(v),years:v=>`${nf(v)} years`,pct:v=>`${nf(v)}%`,m3y:v=>F.volume(v),kgy:v=>`${F.sigText(v,2)} kg/yr`,n:(v,d=0)=>nf(v,d)};
  const UNIT={m:'m',m2:'m²',cm:'cm',nzd:'NZ$',nzdy:'NZ$/yr',t:'t CO₂e',years:'years',pct:'%',m3y:'m³/yr',kgy:'kg/yr',n:null};
  const money=v=>F.money(v);                                   // one tree: 2 significant figures ("$540", "$4.60")
  const co2=t=>num(t)===null?null:F.co2(t);                     // "28 t CO₂e", "550 kg CO₂e"

  // One provenance entry. Ids are stable per record (p-<key>) so a presentation can number footnotes.
  function prov(env,key,{source=null,date=null,method=null,model=null,uncertainty=null,dataset=null,field=null,note=null,label=null,kind=null}={}){
    return {id:`p-${key}`,label,kind,source,date:date||null,method:methodRef(env,method),model:model||null,uncertainty:uncertainty||null,
      release:env.releaseLabel||null,dataset,field,note};
  }
  function methodRef(env,m){
    if(!m)return null;
    if(typeof m==='object')return m;
    const known=METHODS[m]||(METHOD_PREFIX.find(([re])=>re.test(m))||[])[1]||null;
    const site=env.siteRoot||'.';
    // A stored id that says "not release eligible" is shown without that clause (the release status is said in words).
    return {id:String(m).replace(/_not_release_eligible/,''),text:known?.text||words(m),href:known?.notes?`${site}/${known.notes}-methods.html${known.anchor?'#'+known.anchor:''}`:known?.doc?REPO+known.doc:null,
      doc:known?.doc?REPO+known.doc:null};
  }
  function q(env,key,label,value,unit,kind,provenance,{text=null,range=null,digits}={}){
    if(value===null||value===undefined||value==='')return null;
    const v=value;
    const t=text??(typeof v==='number'&&FMT[unit]?FMT[unit](v,digits):String(v));
    if(provenance&&!provenance.label)provenance.label=label;
    if(provenance&&!provenance.kind)provenance.kind=kind;
    return {key,label,value:v,unit:UNIT[unit]??null,text:t,kind,range:range||null,provenance};
  }
  // A range shown with a value: label says what spread it is (e.g. "Segmentations 134.5–315.5 m²").
  const RANGE_LABEL={'spread of this record’s height estimates':'Estimates in this record','spread across segmentations':'Segmentations',
    'spread across trunk models':'Trunk models','sensitivity scenarios':'Sensitivity range','trunk-diameter range':'From the trunk range'};
  // No zero-width ranges: a range exists only when its ends differ as printed ("23.7–23.7 m" never appears).
  const rangeOf=(low,high,unit,basis,digits)=>{
    const a=num(low),b=num(high);if(a===null||b===null||Math.abs(b-a)<1e-9)return null;
    const f=FMT[unit]||(v=>nf(v,digits??1));
    const ta=unit==='nzdy'?money(a):f(a,digits).replace(/ .*$/,''),tb=unit==='nzdy'?money(b):f(b,digits).replace(/ .*$/,'');
    if(ta===tb)return null;
    return {low:a,high:b,text:unit==='nzdy'?`${ta}–${tb}/yr`:`${ta}–${f(b,digits)}`,basis,label:RANGE_LABEL[basis]||'Range'};
  };
  // The spread of several values at the design system's display precision, or null when the ends print the same.
  const areaText=v=>F.areaValue(v);
  const spread=(vals,f)=>{if(vals.length<2)return null;const a=f(Math.min(...vals)),b=f(Math.max(...vals));return a===b?null:`${a}–${b}`;};

  // ---------- trunk diameter and root protection ----------
  // The release holds two trunk-diameter (DBH) models: assets.dbh_cm_crown_est (from crown size and height; the
  // root-space scenario repeats it as roots.dbh_cm) and services.dbh_cm_est (the benefit equations). Neither is
  // measured. The central estimate is the median of the distinct model values (design system 4.8: show the
  // central estimate, never the low end) and the range is their spread; a reviewed KYTE tape measurement replaces
  // both, and next a field measurement (field/measurements_v1.json, below), which keeps the models beside it as ALTO's
  // estimate. Explained on the release methods page (v5-methods.html#trunk-diameter).
  // Where a trunk is measured: 1.4 m above the ground, on a slope from mid-slope, the New Zealand convention (NZ Tree
  // Register, Unitary Plan), from tool 0.2.15 and KYTE v22; before, ALTO and KYTE said 1.3 m above the uphill ground.
  // A KYTE visit stores the height its tape was read at, so a measured value names that height.
  const TRUNK_HEIGHT_M=1.4,TRUNK_AT=`${TRUNK_HEIGHT_M} m above the ground (on a slope, from mid-slope)`;
  const tapeAt=h=>num(h)!==null?`${nf(num(h),2)} m above the ground`:TRUNK_AT;
  const TRUNK_MODELS=[['assets','dbh_cm_crown_est','Crown size and height model'],['services','dbh_cm_est','Benefit equations']];
  const median=a=>{const s=[...a].sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};
  function trunk(env,c){
    const live=c.live;
    // A multi-stem tape reading is the largest stem, not the tree's trunk: the models stay the trunk estimate.
    if(num(live?.diameter_cm)!==null&&!live.multiStem)return {kind:'measured',central:num(live.diameter_cm),low:null,high:null,models:[],basis:'Measured at a reviewed KYTE ground visit'};
    // A field measurement (the newest, when a tree has several) unless a KYTE visit measured the trunk.
    const fm=c.field?.[0];
    if(fm)return {kind:'measured',central:fm.value,low:null,high:null,models:[],basis:`Measured in the field by ${fm.by}`,field:fm};
    return trunkModels(env,c);
  }
  // The release's trunk-diameter models alone: their central estimate and spread, or null.
  function trunkModels(env,c){
    const d=c.record?.datasets||{},models=[];
    // Release 6.3 withholds every estimate of a crown whose height is not plausible, and values the 103 crowns drawn
    // outside the v5 survey on their drawn crown (services_drawn).
    if(c.summary?.benefits?.withheld)return null;
    const drawn=num(d.services_drawn?.dbh_cm_crown_est);
    if(drawn!==null&&drawn>0)return {kind:'model',central:drawn,low:drawn,high:drawn,models:[{dataset:'services_drawn',field:'dbh_cm_crown_est',label:'Crown size and height model, on the drawn crown',value:drawn}],basis:'The release’s trunk-diameter model on the drawn crown'};
    for(const [dataset,field,label] of TRUNK_MODELS){const v=num(d[dataset]?.[field]);if(v!==null&&v>0&&!models.some(x=>Math.abs(x.value-v)<0.05))models.push({dataset,field,label,value:v});}
    if(!models.length){const v=num(c.props?.dbh_cm_crown_est);if(v!==null&&v>0)models.push({dataset:'tile',field:'dbh_cm_crown_est',label:'Crown size and height model',value:v});}
    if(!models.length)return null;
    const vals=models.map(x=>x.value);
    return {kind:'model',central:median(vals),low:Math.min(...vals),high:Math.max(...vals),models,
      basis:models.length>1?`Median of the release’s ${models.length} trunk-diameter models`:'The release’s trunk-diameter model'};
  }
  // Root protection radius: 12 × trunk diameter, the area capped at 707 m² (a 15 m radius): the release's rule
  // (pipeline/v5/enrich_v5.py, after BS 5837). Drawn here from the central trunk estimate, with the range the trunk
  // range implies; the release's stored radius (from one model) stays in the provenance.
  const RPA_FACTOR=12,RPA_AREA_CAP_M2=707;
  const rpaRadius=dbhCm=>num(dbhCm)===null?null:Math.min(RPA_FACTOR*num(dbhCm)/100,Math.sqrt(RPA_AREA_CAP_M2/Math.PI));
  // From release 6 the benefit-equation model follows the growth form; its methods page explains both models.
  const releaseNumber=env=>parseFloat(String(env.releaseLabel||'').replace(/^v/,''))||0;
  const trunkMethod=env=>({id:'trunk_central_estimate',text:'Median of the release’s trunk-diameter models (crown size and height; benefit equations); not measured',
    href:`${env.siteRoot||'.'}/${releaseNumber(env)>=6?'v6':'v5'}-methods.html#trunk-diameter`,doc:REPO+'docs/methods/tree_asset_model.md'});
  const rootMethod=(env,id)=>({id:id||'root_space_sensitivity_v5_inputs',text:`Root protection radius: ${RPA_FACTOR} × trunk diameter (central estimate), area capped at ${RPA_AREA_CAP_M2} m²; a planning scenario, not a measured root extent`,
    href:`${env.siteRoot||'.'}/v5-methods.html#roots`,doc:REPO+'docs/validation/root_zone_summary.md'});

  // ---------- field measurements ----------
  // Trunk diameters measured on the ground by a named group (the first: primary school students with diameter tapes),
  // checked, and published apart from data and tool releases in <siteRoot>/field/measurements_v1.json; a data release
  // replaces data/, so the file has a top-level folder of its own. {version:'field_measurements_v1', updated, trees:{<tree
  // number>:[{kind:'trunk_diameter', value_cm, n_measurements, n_teams, n_classes, spread_cm, height_m, method, date_from,
  // date_to, by, review, ref}]}}. Trunk diameters only; an entry without its value, the height it was read at or who read
  // it is left out, as is a file of another version. Each value names its own height (the first pilot measured at 1.3 m;
  // ALTO's own trunk values are at TRUNK_HEIGHT_M).
  const FIELD_VERSION='field_measurements_v1',FIELD_PATH='field/measurements_v1.json';
  const own=(o,k)=>!!o&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,k);
  const isoDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v??''))?String(v):null;
  const said=v=>typeof v==='string'&&v.trim()?v.trim():null;
  const whole=v=>{const n=num(v);return n!==null&&n>0&&Number.isInteger(n)?n:null;};
  // "28–30 Oct 2026", "28 Oct – 2 Nov 2026", "30 Dec 2026 – 2 Jan 2027": a measuring period from its first and last days.
  function dayRange(from,to){
    const [a,b]=[from,to].filter(Boolean).sort(),ta=dayText(a),tb=dayText(b);if(!ta)return null;
    if(!tb||ta===tb)return {iso:a,text:ta};
    const [da,ma,ya]=ta.split(' '),[,mb,yb]=tb.split(' ');
    return {iso:a,text:ya!==yb?`${ta} – ${tb}`:ma!==mb?`${da} ${ma} – ${tb}`:`${da}–${tb}`};
  }
  function fieldEntry(e){
    if(!e||typeof e!=='object'||e.kind!=='trunk_diameter')return null;
    const value=num(e.value_cm),height=num(e.height_m),by=said(e.by),sp=num(e.spread_cm),from=isoDay(e.date_from),to=isoDay(e.date_to);
    if(value===null||value<=0||value>=1000||height===null||height<=0||height>5||!by)return null;
    return {kind:'trunk_diameter',value,height,measurements:whole(e.n_measurements),teams:whole(e.n_teams),classes:whole(e.n_classes),spread:sp!==null&&sp>=0?sp:null,
      method:said(e.method),from,to,dates:dayRange(from,to),by,review:said(e.review),ref:said(e.ref)};
  }
  // A tree's entries, the newest first (by the last day measured; undated entries last, in file order).
  const fieldEntries=list=>(Array.isArray(list)?list:[]).map(fieldEntry).filter(Boolean).sort((a,b)=>String(b.to||b.from||'').localeCompare(String(a.to||a.from||'')));
  // A tape reading as measured, to 0.1 cm ("21.5 cm", "2 cm").
  const tapeText=v=>F.quantityText('trunkDiameter',v,{measuredTape:true});
  const plural=(n,one,many=one+'s')=>`${nf(n)} ${n===1?one:many}`;
  // An entry in words: the method at its height, who took part with the spread across teams, and the review.
  function fieldWords(e){
    const who=[e.measurements?plural(e.measurements,'measurement'):null,e.teams?`by ${plural(e.teams,'team')}`:null,e.classes?`in ${plural(e.classes,'class','classes')}`:null].filter(Boolean).join(' ');
    return {method:`${cap(e.method||'tape')} at ${tapeAt(e.height)}`,counts:cap([who,e.spread!==null?`spread across teams ${tapeText(e.spread)}`:null].filter(Boolean).join('; '))||null,
      review:e.review?cap(e.review):null};
  }
  const fieldNote=e=>{const w=fieldWords(e);return [w.counts,w.review].filter(Boolean).map(s=>`${s.replace(/\.$/,'')}.`).join(' ')||null;};
  // One entry as a measured Quantity: the tree's trunkDiameter, or field1, field2… in rec.field.
  function fieldQ(env,key,e){
    const w=fieldWords(e);
    return Object.assign(q(env,key,`Trunk diameter at ${nf(e.height,2)} m`,e.value,'cm','measured',prov(env,key,{source:e.by,date:e.dates,method:{id:null,text:w.method,href:null},
      note:fieldNote(e)}),{text:tapeText(e.value)}),{field:e,words:w,tape:true});
  }

  // ---------- identity ----------
  // The sources of the records counted on this crown (one per dataset; LiDAR detections are one source). The
  // summary's wider list (s.sources) also names evidence that is not a record (the crown, earlier surveys, a
  // schedule match, the growth-form model); the count beside "N records" uses records only.
  function recordSources(s){
    const S=dep('ALTOSources'),seen=new Map();
    const add=src=>{if(!src)return;const ds=S?S.dataset(src):{name:words(src),group:null},det=ds.group==='detected'||!!S?.DETECTION.includes(src);
      const key=det?'lidar':src;if(!seen.has(key))seen.set(key,{key,label:det?'LiDAR-detected tree':ds.name});};
    if(s.members?.length)for(const m of s.members)add(m.source);else add(s.source_primary);
    return [...seen.values()];
  }
  function badges(s){
    const out=[],rs=recordSources(s);
    // A schedule match is said as the schedule's name (never "Protected": ALTO does not decide protection).
    if(s.status.protected)out.push({key:'protected',label:'Notable Trees schedule',tone:'protected',title:s.schedule?.label||'Auckland Unitary Plan, Schedule 10'});
    if(s.status.notable)out.push({key:'notable',label:'Notable',tone:'notable'});
    if(s.evidence)out.push({key:'evidence',label:s.evidence.label,tone:s.evidence.tone});
    if(s.link?.cls==='probable')out.push({key:'probable',label:'Probable crown link',tone:'warn'});
    if(s.link?.seeded)out.push({key:'drawn',label:'Crown drawn from the record',tone:'warn'});
    if(s.classification?.quality==='unlinked')out.push({key:'unlinked',label:'No crown linked',tone:'warn'});
    out.push({key:'records',label:`${nf(s.recordCount)} record${s.recordCount===1?'':'s'} · ${nf(rs.length)} source${rs.length===1?'':'s'}`,tone:'muted',records:s.recordCount,sources:rs.length});
    return out;
  }
  // The Notable Trees schedule, said for every tree once its record has loaded (never silence). ALTO checks one thing:
  // whether the release matches an entry of Auckland Council's Notable Trees schedule (Auckland Unitary Plan, Schedule 10)
  // to this tree. It never says whether a tree is protected or whether consent is needed: the Unitary Plan's other tree
  // rules (trees in roads, E17; open space zones, E16; overlays) are not checked, and Auckland Council determines
  // whether a tree is protected. Item numbers and the schedule's date come from the release's notable_facts.json when a
  // page has it (scheduleWords); a notable-tree record carries its own item number.
  const SCHEDULE_LAW='Auckland Unitary Plan, Schedule 10';
  function protectionStatus(c){
    const s=c.summary,sch=s.schedule,p=c.props||{},r=c.record?.datasets?.record||{};
    const species=named(r.species_common_raw||r.species_common||p.species_common)||named(r.species_latin_raw||r.species_latin||p.species_latin);
    const latin=named(r.species_latin_raw||r.species_latin||p.species_latin);
    const owner=r.owner_class||p.owner_class||null;
    if(s.status.protected){
      const own=(r.source_primary||p.source_primary)==='notable_trees_overlay'?r.source_tree_id||p.source_tree_id||null:null;
      const groupName=(r.notable_group_names||p.notable_group_names)?String(r.notable_group_names||p.notable_group_names).trim():null;
      return {status:'scheduled',kind:sch?.kind==='group'?'group':'tree',name:sch?.kind==='group'?groupName:sch?.name||null,item:own?String(own).trim():null,
        species,latin,owner,schedule:'Notable Trees schedule',law:SCHEDULE_LAW,source:SOURCE.schedule};
    }
    const flag=p.is_protected_notable;
    if(!c.record&&!(flag===0||flag==='0'||flag===false))return {status:'unknown',kind:null,name:null,item:null,species,latin,owner,schedule:'Notable Trees schedule',law:SCHEDULE_LAW,source:SOURCE.schedule};
    return {status:'unmatched',kind:null,name:null,item:null,species,latin,owner,schedule:'Notable Trees schedule',law:SCHEDULE_LAW,source:SOURCE.schedule};
  }
  // "London Planes (approx. 80)" and a record's "London Plane Tree" name the same species; "Pin Oak" does not.
  const nameWords=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\(approx\.?\s*\d+\)/g,' ')
    .replace(/[^a-z ]+/g,' ').split(/\s+/).filter(w=>w&&!['tree','trees','and','the','of','x','approx'].includes(w)).map(w=>w.length>3&&!/ss$/.test(w)?w.replace(/s$/,''):w);
  function sameSpecies(groupName,...names){
    const g=nameWords(groupName);if(!g.length)return false;
    return names.filter(Boolean).some(n=>{const w=new Set(nameWords(n));return w.size>0&&g.every(x=>w.has(x));});
  }
  const dayText=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));return m?new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).replace(/\bSept\b/,'Sep'):null;};
  // The Unitary Plan's other tree rules, the one for the tree's setting first: a street tree (street land, or a record
  // owned by Auckland Transport) names E17 first; a park tree (park land, or a record owned by Council Parks) E16 first.
  function otherRules(owner,tenure){
    const park=tenure==='park'||(tenure!=='street'&&/Parks/i.test(owner||''));
    const rules=park?['open space zones E16','trees in roads E17','overlays']:['trees in roads E17','open space zones E16','overlays'];
    return `ALTO checks this schedule only. Other Unitary Plan tree rules (${rules.join(', ')}) are not checked; Auckland Council determines whether a tree is protected.`;
  }
  // "a pin oak", "an English oak", "a pōhutukawa": a species inside a sentence.
  function asSpecies(name){
    const N=dep('ALTOSpeciesNames'),d=N?N.display(name,{lower:true}):String(name||'');
    return `${/^[aeiouāēīōū]/i.test(d)?'an':'a'} ${d}`;
  }
  // The schedule line under a tree's name, as plain text: {status, kind, label (the lead, in bold), text, note (a second
  // line), item}. facts: notable_facts.json as species-maxima.js prepares it ({trees, credits}); number: the tree number;
  // tenure: the land type key, when the page knows it (map tiles). No sentence says whether consent is required.
  function scheduleWords(ps,{facts=null,number=null,tenure=null}={}){
    if(!ps||ps.status==='unknown')return null;
    const f=number&&facts?.trees?.[number]||null,held=new Set((f?.held_schedule||[]).map(String));
    const entry=list=>(list||[]).find(x=>x&&x.schedule&&!held.has(String(x.schedule)))||null;
    const asAt=dayText(facts?.credits?.council_schedule_10?.as_at);
    const where=`Notable Trees schedule (${SCHEDULE_LAW}${asAt?`, as published ${asAt}`:''})`;
    // A record the release did not flag, while notable_facts.json (what the page's Recognition block reads) holds a
    // Council schedule entry or group area for this tree number: the schedule's wording, so one page never says both.
    const kind=ps.status==='scheduled'?(ps.kind==='tree'?'tree':'group'):entry(f?.schedule)?'tree':entry(f?.group)?'group':null;
    if(kind==='tree'){
      const e=entry(f?.schedule);
      const item=e?.schedule||ps.item||null,name=String(e?.name||ps.name||'').trim();
      return {status:'scheduled',kind:'tree',label:'Scheduled notable tree',item,text:`${item?`Schedule 10 item ${item}`:'Schedule 10'}${name?` (${name})`:''}`,note:`${where}.`};
    }
    if(kind==='group'){
      const e=entry(f?.group);
      const item=e?.schedule||null,name=String(e?.name||ps.name||'').trim();
      const part=!!ps.species&&sameSpecies(name,ps.species,ps.latin);
      const text=`${part?'Part of':'Inside the mapped area of'} scheduled group${item?` item ${item}`:''}${name?`, ‘${name}’`:''}`+
        (!part&&ps.species?`; recorded here as ${asSpecies(ps.species)}; group coverage for Council to confirm`:'');
      return {status:'scheduled',kind:'group',label:'Notable Trees schedule',item,text,note:`${where}.`};
    }
    return {status:'unmatched',kind:null,label:null,item:null,text:`${where}: no entry matched to this tree.`,note:otherRules(ps.owner,tenure)};
  }
  const GF_PROB=[['p_evergreen_broadleaf','evergreen_broadleaf','Evergreen broadleaf'],['p_deciduous_broadleaf','deciduous_broadleaf','Deciduous broadleaf'],
    ['p_conifer','conifer','Conifer'],['p_palm','palm','Palm'],['p_palm_like','palm_like','Cabbage tree or similar'],['p_tree_fern','tree_fern','Tree fern']];
  function growthForm(env,s,gf){
    if(!s.growth)return null;
    const probs=gf?GF_PROB.map(([f,key,label])=>({key,label,p:num(gf[f])})).filter(x=>x.p!==null):[];
    const top=probs.reduce((b,x)=>!b||x.p>b.p?x:b,null);
    if(top)top.top=true;
    const G=dep('ALTOGrowthForm');
    return {key:s.growth.key,wording:s.growth.wording,shown:s.growth.shown,note:s.growth.key==='not_determined'?G?.NOTE_UNDETERMINED||null:G?.NOTE||null,
      call:gf?.call||null,band:gf?.band||null,probabilities:probs,
      model:modelOf(env,'growth',gf?.model_id||null,gf?.method_id||null),method:methodRef(env,gf?.method_id||'growth_form_v6'),
      flight:dated(gf?.lidar_flight_date),lateJuneFlight:num(gf?.late_june_flight)===1,leafOn:gf?num(gf.leaf_on)===1:null,
      palmDetector:gf?{seen:num(gf.c1_override)===1,setAside:num(gf.guard_v2)===1,score:num(gf.p_palm_det)}:null,
      displayRule:words(gf?.display_reason),structure:gf?.structure_call||null,merged:gf?.merged_call||null};
  }
  // Lines under the schedule line on the tree page and the panel, each from the tree's own release data (release 6.3):
  // the height check and the record-and-crown checks. [{key, label, text, tone, href}]
  function releaseLines(env,c){
    const out=[],chk=checksOf(c),site=env.siteRoot||'.';
    const after=(note,label)=>note?cap(String(note).replace(new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':\\s*','i'),'')):null;
    if(chk.height)out.push({key:'height_check',label:chk.height.label,tone:'warn',text:after(chk.height.note,chk.height.label)||
      (chk.height.level==='implausible'?'Left out of comparisons, maxima, property tallest tree, estimates and totals.':'Counted in totals; left out of comparisons, maxima and property tallest tree.'),
      href:`${site}/v63-methods.html#height-checks`});
    for(const l of chk.links)out.push({key:'link_check',label:l.label,tone:'warn',text:(after(l.note,l.label)||'Left out of comparisons and maxima.')+(l.self||!l.treeId?'':' (another record on this crown)'),
      href:`${site}/v63-methods.html#height-checks`});
    // Release 6.3: the Schedule 10 entry whose Council point this tree holds, as the July 2026 schedule lists it (trees
    // listed, names, address; a multi-tree entry whose points ALTO maps on one crown says so), and a reviewer's note the
    // corrections ledger carries (tree_note).
    const SCH10='https://unitaryplan.aucklandcouncil.govt.nz/images/Auckland%20Unitary%20Plan%20Operative/Chapter%20L%20Schedules/Schedule%2010%20Notable%20Trees%20Schedule.pdf';
    const rep0=(c.members||[]).find(m=>m?.tree_id&&m.tree_id===c.record?.datasets?.identity?.current_primary_tree_id)||null;
    const entries=[...(c.record?.datasets?.schedule_entry||rep0?.datasets?.schedule_entry||[])].sort((a,b)=>Number(a.item)-Number(b.item));
    for(const e of entries)if(e?.line||e?.item)out.push({key:'schedule_entry',label:'Schedule 10 entry',tone:null,
      text:cap(String(e.line||`Schedule 10 item ${e.item}: ${e.trees_listed??'?'} ${Number(e.trees_listed)===1?'tree':'trees'}`).replace(/^Schedule 10 item/,'item')),
      links:[{text:'Schedule 10',href:SCH10}]});
    for(const n of c.record?.datasets?.notes||[])if(n?.text)out.push({key:'note',label:'Reviewer note',tone:null,text:`${n.text}${n.decided_on?` (${dayText(n.decided_on)||n.decided_on})`:''}`,
      href:'#m-history'});
    // A record derived from OpenStreetMap stays under the Open Database Licence (release 6.3 licence dataset; the licence
    // is the same for such records in every release): its attribution, that ALTO's noncommercial terms do not apply, the
    // share-alike condition on exports, and the script that derives it.
    const d=c.record?.datasets||{},lic=d.licence||null;
    if(lic||(d.record?.source_primary||c.props?.source_primary)==='osm_natural_tree')
      out.push({key:'licence',label:'Licence',tone:null,text:`${lic?.attribution||'© OpenStreetMap contributors'}. This record is available under the ${lic?.licence_name||'Open Database Licence (ODbL) 1.0'}; ALTO’s noncommercial terms do not apply to it, and exports that contain it carry the ODbL’s share-alike condition.`,
        links:[{text:'ODbL 1.0',href:lic?.licence_url||'https://opendatacommons.org/licenses/odbl/1-0/'},{text:'OpenStreetMap copyright',href:lic?.attribution_url||'https://www.openstreetmap.org/copyright'},
          {text:'Method',href:lic?.method_url||'https://github.com/squirmen/alto/blob/main/pipeline/base/scripts/fetch_osm_natural_trees.py'}]});
    return out;
  }
  // Release 6.3 leaves out of rankings a crown whose height or record-to-crown link is flagged, and one holding a Schedule
  // 10 entry that lists more trees than ALTO maps there (collapsed, or fewer Council points than trees): such a tree is
  // never badged as a species maximum, whatever a maxima file lists.
  function maximaBlocked(c){
    const chk=checksOf(c),se=[...(c.record?.datasets?.schedule_entry||[])];
    return !!(chk.height||chk.links.length||se.some(e=>Number(e?.collapsed)===1||Number(e?.fewer_points_than_trees)===1));
  }
  function identity(env,c){
    const s=c.summary,S=dep('ALTOSources'),src=S?.source(s.classification?.primary),gf=c.record?.datasets?.growth_form||null;
    return {title:s.name.title,latin:s.name.latin,nameKind:s.name.kind,nameNote:s.name.note,nameMulti:!!s.name.multi,recordedAs:s.name.recordedAs||null,
      titleEstimate:!!s.name.titleEstimate,nameCodes:s.name.codes||null,asSupplied:s.name.asSupplied||null,
      category:s.detection?'LiDAR-detected tree':src?src.label:'Source record',detection:s.detection,
      growthForm:growthForm(env,s,gf),
      protection:s.status.protected?{label:s.schedule?.label||'Notable tree',kind:s.schedule?.kind||null,name:s.schedule?.name||null,approx:s.schedule?.approx??null,
        objectId:s.schedule?.objectid??null,source:SOURCE.schedule}:null,
      protectionStatus:protectionStatus(c),
      notable:!!s.status.notable,evidence:s.evidence||null,
      crownLink:s.link?{class:s.link.cls||(s.link.seeded?'drawn_from_record':null),text:s.link.text||null,edgeDistance:s.link.edge??null,seeded:!!s.link.seeded}:null,
      quality:s.classification?.quality||null,primarySource:s.classification?.primary||null,
      badges:badges(s),recordCount:s.recordCount,sources:s.sources,recordSources:recordSources(s),
      position:s.position?{lon:s.position.lon,lat:s.position.lat,basis:s.detection?'Detection point':'Recorded position of this record'}:null,
      crownRepresentative:c.record?.datasets?.identity?.current_primary_tree_id||null};
  }

  // ---------- release cautions (tool 0.2.9) ----------
  // Heights of 55 m or more are unusually tall for Auckland: possibly a power line, a structure or noise in the LiDAR.
  // They are shown with that caution, and kept out of rankings, maxima and "tallest" lines (the data flag is a later
  // data release's).
  const TALL_M=55;
  const isTall=h=>num(h)!==null&&num(h)>=TALL_M;
  const TALL_TEXT='unusually tall for Auckland: possibly a power line, structure or noise; not used in rankings';
  // Release 6.3 flags heights and record links in the data (height_check, link_check; map features hchk, lchk): the
  // flag replaces the page's own 55 m rule, a height not plausible withholds the crown's estimates, and every flagged crown
  // stays out of rankings and maxima while its counted values follow the data.
  const HEIGHT_IMPLAUSIBLE_TEXT='height not plausible (height check): left out of rankings, maxima, estimates and totals';
  const HEIGHT_CHECK_TEXT='height to check (height check): left out of rankings and maxima';
  // The record's height check (the crown's, held by its map marker) and every record-and-crown check on this crown that
  // fired: {height:{level,label,note}|null, links:[{level,label,note,treeId,self}]}.
  function checksOf(c){
    const d=c.record?.datasets||{},p=c.props||{},rep=(c.members||[]).find(m=>m?.tree_id&&m.tree_id===d.identity?.current_primary_tree_id)||null;
    const hc=d.height_check||rep?.datasets?.height_check||null,FD=dep('ALTOFields');
    const level=hc?.level==='implausible'||hc?.level==='check'?hc.level:FD?.heightCheck(p)||null;
    const height=level?{level,label:level==='implausible'?'Height not plausible':'Height to check',note:hc?.note||null,rules:hc?.rules||null}:null;
    const links=[];
    for(const r of [c.record,...(c.members||[])]){
      const lc=r?.datasets?.link_check;if(!lc||!['check','likely_different'].includes(lc.level))continue;
      if(links.some(x=>x.treeId===r.tree_id))continue;
      links.push({level:lc.level,label:lc.level==='likely_different'?'Record and crown may be different trees':'Record and crown to check',note:lc.note||null,treeId:r.tree_id,self:r===c.record});
    }
    if(!links.length&&FD?.linkCheck(p))links.push({level:FD.linkCheck(p),label:FD.linkCheck(p)==='likely_different'?'Record and crown may be different trees':'Record and crown to check',note:null,treeId:null,self:false});
    return {height,links};
  }
  // Crown segmentation merges no crowns beyond 400 m² (pipeline/v5/core.py merge_max_area_m2): a larger tree can be split
  // into several crowns, and areas of 360 m² or more sit at or near that limit. Crowns over 60 m² read about 20% smaller
  // than reference outlines (release 6 methods).
  const MERGE_CAP_M2=400,NEAR_CAP_M2=360,SMALL_BIAS_M2=60;
  const NEAR_CAP_TEXT='at or near the 400 m² segmentation limit; the tree may be larger';
  const SMALL_BIAS_TEXT='large crowns tend to read about 20% small (release 6 methods)';
  // One definition of height, the stored value's: the highest point of the 2024 LiDAR canopy height model within the crown.
  const HEIGHT_DEF='Highest point of the 2024 LiDAR canopy height model within the crown';
  const HEIGHT_FIELD_NOTE='Airborne LiDAR usually reads below a field hypsometer height on pointed crowns.';
  // The release's planning constants (pipeline/v5/assets_baseline.py) for height class and regrowth time; the class a stored
  // regrowth time was computed for is read back from its rate (crown area ÷ years).
  const CLASS_RATE={evergreen_broadleaf:2.2,deciduous_broadleaf:2.6,conifer:2.0,palm_other:0.6};
  const CLASS_REF_M={evergreen_broadleaf:22,deciduous_broadleaf:25,conifer:35,palm_other:14};
  const CLASS_WORDS={evergreen_broadleaf:'evergreen broadleaf',deciduous_broadleaf:'deciduous broadleaf',conifer:'conifer',palm_other:'palm-type'};
  // Class words before a noun: "the 22 m evergreen-broadleaf reference height".
  const modifier=w=>String(w).replace(/ /g,'-');
  function rateClass(rate){
    const r=num(rate);if(r===null)return null;
    let best=null;for(const [k,v] of Object.entries(CLASS_RATE)){const d=Math.abs(v-r);if(d<=0.15&&(!best||d<best.d))best={k,d};}
    return best?best.k:null;
  }
  // The class of the page's own growth form (or recorded species, through the benefit class), for comparison with the
  // class a stored value was computed for.
  const GF_CLASS=k=>!k?null:/^evergreen/.test(k)?'evergreen_broadleaf':/^deciduous/.test(k)?'deciduous_broadleaf':/conifer/.test(k)?'conifer':/palm|fern/.test(k)?'palm_other':null;
  const releaseNum=env=>String(env.releaseLabel||'').replace(/^v/,'')||null;
  const notComputed=env=>`Range not computed in release ${releaseNum(env)||'this release'}`;
  // The setting a stored estimate was computed for: {cls, words, ref, rate, differs}.
  function assetBasis(env,c){
    const s=c.summary,R=s.replacement,v=c.record?.datasets?.services||{};
    // Release 6.3: the class the size dataset used (class_used, the published services class) with its reference height and
    // planning rate as stored.
    if(R.release63){const k=c.record?.datasets?.size?.class_used||s.lifeStage?.klass||null;
      return {cls:k,words:k?CLASS_WORDS[k]:null,ref:num(c.record?.datasets?.size?.reference_height_m)??(k?CLASS_REF_M[k]:null),rate:num(c.record?.datasets?.size?.planning_rate_m2_y)??(k?CLASS_RATE[k]:null),differs:false,v63:true};}
    const cls=rateClass(R.rate);
    const page=s.growth?.shown?GF_CLASS(s.growth.key):v.species_class||null;
    return {cls,words:cls?CLASS_WORDS[cls]:null,ref:cls?CLASS_REF_M[cls]:null,rate:cls?CLASS_RATE[cls]:null,differs:!!cls&&!!page&&page!==cls};
  }

  // ---------- key measurements ----------
  function measures(env,c){
    const d=c.record?.datasets||{},s=c.summary,z=s.size,rec=d.record||{},gf=d.growth_form,cr=d.crown||{},a=d.assets||{},v=d.services||{},o=d.outline;
    const S=dep('ALTOSources');
    const flown=gf?.lidar_flight_date?dated(gf.lidar_flight_date,'flown '):SURVEY_2024.captured;
    const snap=dated(rec.as_of_utc,'snapshot ');
    const rel=env.metadata?.release?.dataset_last_updated_utc?dated(env.metadata.release.dataset_last_updated_utc,'release '):null;
    // A flagged height (release 6.3 height check) or, in releases without the flag, the page's 55 m rule: the caution
    // every value computed from the height carries.
    const chk=checksOf(c),NC=notComputed(env),tall=chk.height?true:!s.release63&&isTall(z.height);
    const tallText=chk.height?(chk.height.level==='implausible'?HEIGHT_IMPLAUSIBLE_TEXT:HEIGHT_CHECK_TEXT):TALL_TEXT;
    const out={};
    const put=(x,extra={})=>{if(x){Object.assign(x,extra);out[x.key]=x;}return x;};
    // Species: as the source recorded it, in its display form (the source's own text is kept as "Species as supplied").
    if(s.name.kind==='recorded'&&!s.name.multi)put(q(env,'species','Species',s.name.latin?`${s.name.title} (${s.name.latin})`:s.name.title,null,'recorded',
      prov(env,'species',{source:S?.dataset(rec.source_primary).name||words(rec.source_primary),date:snap,dataset:'record',field:'species_common',
        note:[speciesBasis(rec.species_confidence),s.name.asSupplied&&s.name.asSupplied!==s.name.title?`As supplied: ${s.name.asSupplied}`:null].filter(Boolean).join('. ')||null}),{text:s.name.title}));
    // Growth form: the release's own call (growth-form.js WORDING); the model's scores stay in the provenance.
    if(s.growth?.shown){
      const g=growthForm(env,s,gf),top=g?.probabilities.find(x=>x.top);
      put(q(env,'growthForm','Growth form',s.growth.wording,null,'model',prov(env,'growthForm',{source:'ALTO growth-form model on the 2024 LiDAR survey and aerial imagery',
        date:flown,method:gf?.method_id||'growth_form_v6',model:modelOf(env,'growth',gf?.model_id||null),dataset:'growth_form',field:'display_key',
        uncertainty:top?{text:`Highest model score: ${top.label} ${nf(top.p*100)}%${gf?.band?`; confidence band ${gf.band}`:''}`,low:null,high:null,basis:'model score'}:null})),{rangeNote:NC});
    }
    // Height: the crown maximum, with the other estimates this record holds as its spread. 55 m or more: the caution.
    const hs=[num(cr.crown_max_chm_m),num(d.previous_crown_v4?.height_m),num(d.previous_crown?.crown_max_chm_m),num(d.lidar?.chm_local_max_2m_m),num(d.pointcloud?.canopy_top_m),num(d.previous_pointcloud?.canopy_top_m)].filter(x=>x!==null&&x>0);
    const hsp=spread(hs,v=>nf(v,1));
    put(q(env,'height','Height',z.height,'m','measured',prov(env,'height',{source:SOURCE.lidar2024,date:flown,method:cr.method_id||null,model:modelOf(env,'crown',cr.method_id||null),
      dataset:'crown',field:'crown_max_chm_m',note:[z.heightBasis,`${HEIGHT_DEF}. ${HEIGHT_FIELD_NOTE}`,tall?`${cap(tallText)}.`:null].filter(Boolean).join('. '),
      uncertainty:{text:`Survey vertical accuracy ${SURVEY_2024.vertical}${hsp?`; ${hsp} m across ${hs.length} estimates in this record (segmentations and canopy height samples)`:''}`,
        low:hsp?Math.min(...hs):null,high:hsp?Math.max(...hs):null,basis:hsp?'spread of this record’s estimates':'survey specification'}}),
      {range:hsp?rangeOf(Math.min(...hs),Math.max(...hs),'m','spread of this record’s height estimates'):null}),{flag:tall?'tall':null,caution:tall?tallText:null,check:chk.height?.level||null});
    // Crown area: segmented crown cells; other segmentations of the same survey give the spread. The 400 m² limit and the
    // small-crown bias are said with it.
    const as=[num(cr.crown_area_m2),num(o?.outline_area_m2),num(d.previous_crown_v4?.crown_area_m2),num(d.previous_crown?.crown_area_m2)].filter(x=>x!==null&&x>0);
    const asp=spread(as,areaText),area=num(z.area);
    const nearCap=area!==null&&area>=NEAR_CAP_M2,bias=area!==null&&area>SMALL_BIAS_M2;
    put(q(env,'crownArea','Crown area',z.area,'m2','measured',prov(env,'crownArea',{source:`${SOURCE.lidar2024}; ${SOURCE.aerial2024} (NDVI)`,date:flown,method:cr.method_id||null,
      model:modelOf(env,'crown',cr.method_id||null),dataset:'crown',field:'crown_area_m2',
      note:[num(cr.gap_filled_fraction)!==null?`${nf(cr.gap_filled_fraction*100)}% of crown cells gap-filled`:null,`Crowns are not merged beyond ${MERGE_CAP_M2} m²; a larger tree can be split into several crowns`,
        nearCap?cap(NEAR_CAP_TEXT):null,bias?cap(SMALL_BIAS_TEXT):null].filter(Boolean).join('. '),
      uncertainty:{text:`${asp?`${asp} m² across ${as.length} segmentations of the 2024 survey; `:''}survey specification ${SURVEY_2024.horizontal}`,
        low:asp?Math.min(...as):null,high:asp?Math.max(...as):null,basis:asp?'spread across segmentations':'survey specification'}}),
      {range:asp?rangeOf(Math.min(...as),Math.max(...as),'m2','spread across segmentations'):null}),{basis:'segmented',segmentations:asp?`${asp} m²`:null,nearCap,bias,flag:nearCap?'near_cap':null});
    if(o&&num(o.outline_area_m2)!==null)put(q(env,'crownOutline','Crown outline',num(o.outline_area_m2),'m2','derived',prov(env,'crownOutline',{source:'Crown cells from the 2024 LiDAR survey',
      method:o.method_id||'pointcloud_v53_outline_B',dataset:'outline',field:'outline_area_m2',note:o.outline_method?`Outline method: ${words(o.outline_method)}`:null})));
    put(q(env,'crownDiameter','Crown diameter (equal-area circle)',z.diameter,'m','derived',prov(env,'crownDiameter',{source:'Derived from the crown area',date:flown,
      method:{id:null,text:'Diameter of the circle with the crown’s area (equal-area circle); a crown spread is measured across the crown instead',href:`${env.siteRoot||'.'}/how-alto-is-made.html#crown-measures`},dataset:'crown',field:'crown_diameter_m'})));
    // Trunk diameter at 1.4 m above the ground (on a slope, from mid-slope): the central estimate of the release's models,
    // with their spread, unless a reviewed ground visit or a field measurement measured a single trunk. A multi-stem tape
    // reading is its largest stem, not the tree's trunk diameter, and is shown as that. A tape reading's method names the
    // height it was read at; a field measurement's label does too.
    const live=c.live,tk=trunk(env,c);
    if(live?.multiStem&&num(live.diameter_cm)!==null)put(q(env,'largestStem',`Largest stem at ${TRUNK_HEIGHT_M} m`,num(live.diameter_cm),'cm','measured',prov(env,'largestStem',{source:SOURCE.kyte,
      date:live.observed_on?{iso:null,text:live.observed_on}:null,method:{id:null,text:`Tape round the largest stem at ${tapeAt(live.measuring_height_m)}; several stems`,href:null},dataset:'ground',
      note:`${live.stems?`${nf(live.stems)} stems`:'Several stems'}; not the tree’s trunk diameter, and not used for the root protection radius`}),{text:`${nf(Math.round(num(live.diameter_cm)))} cm${live.stems?` (${nf(live.stems)} stems)`:''}`}));
    // The release's models as a Quantity: the trunk diameter itself, or (trunkEstimate) ALTO's estimate beside a field
    // measurement, with its own method (how).
    const modelled=(key,label,tk,extra={})=>{
      const tsp=spread(tk.models.map(x=>x.value),v=>nf(Math.round(v))),n=tk.models.length;
      put(q(env,key,label,tk.central,'cm','model',prov(env,key,{source:SOURCE.alto,date:{iso:null,text:'not measured'},
        // A computed central value: the stored fields are named in the note, not as the value's own field.
        method:trunkMethod(env),model:modelOf(env,'services',a.method_id||null),dataset:n>1?null:tk.models[0].dataset,
        field:n>1?null:tk.models[0].field,
        note:`${tk.basis}: ${tk.models.map(x=>`${nf(Math.round(x.value))} cm (${x.label.toLowerCase()}, ${x.dataset}.${x.field})`).join(', ')}.${a.dbh_confidence?` Release confidence: ${words(a.dbh_confidence)}.`:''} Not calibrated on measured trunks.`,
        uncertainty:tsp?{text:`Model spread (${n} models) ${tsp} cm; not a calibrated range`,low:tk.low,high:tk.high,basis:'spread across models'}:null}),
        {range:tsp?rangeOf(tk.low,tk.high,'cm','spread across trunk models',0):null}),{rangeLabel:`Model spread (${n} models)`,rangeNote:tsp?null:NC,...extra});
    };
    if(tk?.field)put(fieldQ(env,'trunkDiameter',tk.field));
    else if(tk?.kind==='measured')put(q(env,'trunkDiameter',`Trunk diameter at ${TRUNK_HEIGHT_M} m`,tk.central,'cm','measured',prov(env,'trunkDiameter',{source:SOURCE.kyte,date:live.observed_on?{iso:null,text:live.observed_on}:null,
      method:{id:null,text:live.circumference_cm?`Circumference tape at ${tapeAt(live.measuring_height_m)}, divided by π`:`Diameter tape at ${tapeAt(live.measuring_height_m)}`,href:null},dataset:'ground'})));
    else if(tk)modelled('trunkDiameter',`Trunk diameter at ${TRUNK_HEIGHT_M} m`,tk);
    // A tree measured in the field keeps ALTO's estimate (each value at its own height).
    const est=c.field?.length?trunkModels(env,c):null;
    if(est)modelled('trunkEstimate',`Trunk diameter at ${TRUNK_HEIGHT_M} m, ALTO estimate`,est,{how:`${est.basis}, at ${TRUNK_AT}`});
    // BS 5837 root protection radius (a UK standard): 12 × the trunk estimate, kept for comparison below the dripline radius
    // and, for a scheduled tree, the Unitary Plan protected root zone (extras()).
    const rt=d.roots;
    if(rt&&!s.benefits.withheld&&(num(rt.rpa_radius_m)!==null||tk)){
      const r=tk?rpaRadius(tk.central):num(rt.rpa_radius_m),lo=tk?.low!==null&&tk?.low!==undefined?rpaRadius(tk.low):null,hi=tk?.high!==null&&tk?.high!==undefined?rpaRadius(tk.high):null;
      const rsp=lo!==null&&hi!==null?spread([lo,hi],v=>nf(v,1)):null,stored=num(rt.rpa_radius_m);
      put(q(env,'rootProtection','BS 5837 root protection radius (UK standard; 12 × trunk estimate), for comparison',r,'m','model',prov(env,'rootProtection',{source:SOURCE.alto,date:{iso:null,text:'not measured'},
        method:rootMethod(env,rt.method_id),model:modelOf(env,'roots',rt.method_id||null),dataset:null,field:null,
        note:`Area ${nf(Math.round(Math.PI*r*r))} m². ${tk?.field?`From the trunk diameter measured in the field (${tapeAt(tk.field.height)}).`:tk?.kind==='measured'?'From the measured trunk diameter.':`From the central trunk estimate (${nf(Math.round(tk?.central??0))} cm).`}${stored!==null&&tk&&Math.abs(stored-r)>=0.05?` The release stores ${nf(stored,1)} m (roots.rpa_radius_m), from the ${nf(Math.round(num(rt.dbh_cm)??tk.low))} cm model.`:''} A UK planning standard, for comparison; it is not the Unitary Plan protected root zone.`,
        uncertainty:rsp?{text:`${rsp} m from the model spread of the trunk estimate (${spread(tk.models.map(x=>x.value),v=>nf(Math.round(v)))} cm)`,low:lo,high:hi,basis:'trunk-diameter range'}:null}),
        {range:rsp?rangeOf(lo,hi,'m','trunk-diameter range'):null}),{rangeLabel:'Range',rangeSuffix:'from the model spread',rangeNote:rsp||tk?.kind==='measured'?null:NC});
    }
    // Height class (decision TS-07): height as a share of the reference height of the class the release computed it for,
    // named by size. Release 6.3 stores the class and its share (size dataset; the share printed rounded down); release 6.2
    // stored the class as life_stage, and the page divides the height by the reference height of the class read back from
    // the stored regrowth rate, named when it differs from the page's growth form. share: the per cent printed, or null
    // when the height shown falls outside the stored class's band (the band is printed then). A crown whose height is not
    // plausible is not classed (release 6.3), and says so.
    const AB=assetBasis(env,c),TS=dep('ALTOTreeSummary');
    if(s.lifeStage&&TS){
      const v63=!!s.lifeStage.release63;
      const pct=v63?s.lifeStage.share:AB.ref&&num(z.height)!==null?TS.sharePct(z.height/AB.ref*100,TS.heightClass(s.lifeStage.key)):null;
      const ref=AB.cls?`the ${nf(AB.ref)} m ${modifier(AB.words)} reference height${AB.differs?' (this crown’s release 5.2 class)':''}`:null;
      put(q(env,'lifeStage','Height class',s.lifeStage.label,null,'model',prov(env,'lifeStage',{source:SOURCE.alto,
        method:v63?'size_v63':a.method_id||'crown_height_dbh_sensitivity_v5_inputs',dataset:v63?'size':'assets',field:v63?'height_class':'life_stage',
        note:`${!ref?`Height as a share of the reference height for the tree class: ${s.lifeStage.band}${s.lifeStage.detail?` (${s.lifeStage.detail})`:''}`:pct!==null?`Height ${nf(z.height,1)} m, ${pct}% of ${ref}`:`${cap(s.lifeStage.band)} of ${ref}`}. Classes by share of the class reference height: ${TS.scaleText()}.${v63?' The share is rounded down, so it never reads as the next class.':''} From height only; age not estimated.${tall?` ${cap(tallText)}.`:''}`})),
        {rangeNote:NC,basisClass:AB.cls?{key:AB.cls,words:AB.words,ref:AB.ref,differs:AB.differs}:null,share:pct,shareStored:v63?num(c.record?.datasets?.size?.height_share_pct):null,band:s.lifeStage.band,caution:tall?tallText:null});
    }else if(s.replacement.release63&&s.replacement.notClassed?.key==='height_not_plausible'&&TS){
      put(q(env,'lifeStage','Height class','Not classed',null,'model',prov(env,'lifeStage',{source:SOURCE.alto,method:'size_v63',dataset:'size',field:'not_classed_reason',
        note:'Not classed: height not plausible (height check). The height class, crown replacement time and benefit estimates are withheld for this crown; its values stay in the full record.'})),
        {rangeNote:null,notClassed:s.replacement.notClassed,text:'Not classed'});
    }
    const b=s.benefits;
    if(b.total!==null){
      const unc=num(v.uncertainty_factor);
      // Release 6.3: the benefit value is stormwater plus carbon (benefits dataset), its band set by the valuation
      // confidence; air-quality and cooling dollars stay in the full record, not release-eligible. Release 6.2: the
      // services total of stormwater, carbon, air quality and cooling.
      const v63=b.basis==='stormwater_carbon',bd=c.record?.datasets?.benefits||null;
      put(q(env,'benefits','Benefits',b.total,'nzdy','model',prov(env,'benefits',{source:SOURCE.alto,date:rel,method:v63?(bd?.method_id||'benefits_v63'):v.method_id||'valuation_',model:modelOf(env,'services',v.method_id||null),
        dataset:v63?(bd?'benefits':null):'services',field:v63?'benefit_value_nzd_y':'total_value_nzd_y',
        note:[v63?'Stormwater and carbon. Air-quality and cooling dollars are kept in the full record, not release-eligible from release 6.3':null,
          v.valuation_confidence?`Confidence tier: ${words(v.valuation_confidence)}`:null,'Sensitivity scenario: simplified equations adapted from published i-Tree Eco components, with stated unit values; not run in i-Tree Eco and not a valuation',tall?cap(tallText):null].filter(Boolean).join('. '),
        uncertainty:b.low!==null&&b.high!==null?{text:`${money(b.low)}–${money(b.high)}/yr (${unc!==null?`±${nf(unc*100)}% band set by the confidence tier`:'release sensitivity band'})`,low:b.low,high:b.high,basis:'sensitivity scenarios'}:null}),
        {range:rangeOf(b.low,b.high,'nzdy','sensitivity scenarios')}),{band:unc,components:v63?'stormwater and carbon':null,rangeNote:b.low!==null&&b.high!==null?null:NC,caution:tall?tallText:null});
    }
    if(b.carbonStored!==null)put(q(env,'carbonStored','Carbon stored',b.carbonStored,'t','model',prov(env,'carbonStored',{source:SOURCE.alto,date:rel,method:v.method_id||'valuation_',
      model:modelOf(env,'services',v.method_id||null),dataset:'services',field:'stored_co2e_tonnes_est',note:`Biomass from height and the modelled trunk diameter. ${NC}.${tall?` ${cap(tallText)}.`:''}`})),{rangeNote:NC,caution:tall?tallText:null});
    if(b.runoffM3!==null)put(q(env,'stormwater','Stormwater runoff avoided',b.runoffM3,'m3y','model',prov(env,'stormwater',{source:`${SOURCE.alto}; ${SOURCE.impervious}`,date:rel,
      method:v.method_id||'valuation_',dataset:'services',field:'avoided_runoff_m3_y',note:[num(v.paved_fraction_used)!==null?`${nf(v.paved_fraction_used*100)}% paved within 30 m`:null,`${NC}`].filter(Boolean).join('. ')})),{rangeNote:NC,caution:tall?tallText:null});
    // Regrowth: one division, crown area ÷ the planning rate of the class the release used (read back from the stored
    // rate), for a new crown to reach this crown area; not a calendar forecast.
    const R=s.replacement;
    if(R.years!==null)put(q(env,'replacementYears','Years for a new crown to reach this crown area at the planning rate (crown area only)',R.years,'years','model',prov(env,'replacementYears',{source:SOURCE.alto,
      method:R.release63?'size_v63':a.method_id||'crown_height_dbh_sensitivity_v5_inputs',dataset:R.release63?'size':'assets',field:R.release63?'regrowth_years':'replacement_years_canopy',
      note:AB.cls?`Crown area ÷ ${nf(AB.rate,1)} m² of new crown a year, the planning rate for ${AB.words}${AB.differs?' (this crown’s release 5.2 class)':''}; linear; crown area only`:R.rate?`Crown area ÷ ${nf(R.rate,1)} m² of new crown a year; linear; crown area only`:'Crown area ÷ a class planning rate; linear; crown area only'})),
      {rangeNote:NC,basisClass:AB.cls?{key:AB.cls,words:AB.words,rate:AB.rate,differs:AB.differs}:null,caution:tall?tallText:null});
    // Crown replacement time (release 6.3): the band of the regrowth years, from the years alone, or not classed with its
    // reason; 25 m or taller is its own fact (tallTree), never a band.
    if(R.release63&&(R.band||R.notClassed)){
      const nc=R.notClassed,why=nc?nc.label:null;
      put(q(env,'crownReplacement','Crown replacement time',R.band?R.band.label:'Not classed',null,'model',prov(env,'crownReplacement',{source:SOURCE.alto,method:'size_v63',dataset:'size',
        field:nc?'not_classed_reason':'crown_replacement',note:nc?`Not classed: ${why}.${nc.key==='under_5m'&&R.years!==null?` The regrowth years (${nf(R.years,1)}) are kept; crowns under 5 m are not banded or compared.`:''}`:
        `${R.years!==null?`About ${nf(R.years,R.years<10?1:0)} years for a newly planted tree to grow a crown of this area${AB.cls?` at ${nf(AB.rate,1)} m² a year, the planning rate for ${AB.words}`:' at the planning rate'}. `:''}Bands: under 5, 5–15, 15–40, 40–80, 80 years or more; the band follows the years alone.${R.tallTree?' Tall tree: 25 m or taller (a separate fact).':''}`})),
        {rangeNote:nc?null:NC,band:R.band,notClassed:nc,tallTree:R.tallTree,years:R.years,text:R.band?R.band.label:'Not classed'});
    }
    // Irreplaceability (releases up to 6.2): a class rule over the estimated regrowth time and the height, so an estimate too.
    if(R.irrLabel)put(q(env,'irreplaceability','Irreplaceability',R.irrLabel,null,'model',prov(env,'irreplaceability',{source:SOURCE.alto,
      method:a.method_id||'crown_height_dbh_sensitivity_v5_inputs',dataset:'assets',field:'irreplaceability_class',note:`Class rule over estimates: ${R.irrDefinition}.${tall?` ${cap(tallText)}.`:''}`})),{rangeNote:NC,caution:tall?tallText:null});
    if(s.status.protected)put(q(env,'protection','Notable Trees schedule',s.schedule?.label||'Schedule 10 entry',null,'recorded',prov(env,'protection',{source:SOURCE.schedule,date:snap,
      dataset:'record',field:'is_protected_notable',note:d.notable_link_review?'Position confirmed by review':null})));
    if(tall)for(const x of Object.values(out))if(x.caution)x.cautionHeight=`${nf(z.height,1)} m`;
    return out;
  }

  // ---------- measures from the crown outline and the maxima file (added when a page has them) ----------
  // dripline: the greatest distance from the recorded trunk position (or, when the record lies outside the outline, the
  // crown top) to the 2024 crown outline; without an outline, the equal-area crown radius, so labelled.
  // rootZone (scheduled trees): the Unitary Plan protected root zone (Chapter J): at least that distance, trunk to canopy
  // edge; for a columnar species (Araucaria) also half the tree height.
  // crownSpread: the crown spread the release's maxima file holds (mean of the widest width and the width at right angles).
  const COLUMNAR=/^araucaria\b|norfolk island pine|monkey puzzle|bunya|cook pine|hoop pine/i;
  function ringsOf(g){return !g?[]:g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];}
  function insideRing(pt,ring){let ok=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)ok=!ok;}return ok;}
  function inOutline(pt,g){return ringsOf(g).some(p=>insideRing(pt,p[0])&&!p.slice(1).some(h=>insideRing(pt,h)));}
  // The area-weighted centre of the outline's outer rings (tile pieces can wind either way, so each ring's centre is
  // weighted by its absolute area).
  function outlineCentre(g){
    let sx=0,sy=0,sw=0;
    // Coordinates relative to the first vertex: products of raw longitudes and latitudes cancel badly in floating point.
    const o=ringsOf(g)[0]?.[0]?.[0];if(!o)return null;
    for(const p of ringsOf(g)){const r=p[0].map(([x,y])=>[x-o[0],y-o[1]]);let a=0,cx=0,cy=0;
      for(let i=0,j=r.length-1;i<r.length;j=i++){const f=r[j][0]*r[i][1]-r[i][0]*r[j][1];a+=f;cx+=(r[j][0]+r[i][0])*f;cy+=(r[j][1]+r[i][1])*f;}
      if(!a)continue;const w=Math.abs(a/2);sx+=cx/(3*a)*w;sy+=cy/(3*a)*w;sw+=w;}
    return sw?[o[0]+sx/sw,o[1]+sy/sw]:null;
  }
  // The greatest distance from a WGS84 point to the outline, in NZTM metres (scale within 0.01% of true here).
  function farthest(pt,g){return farthestFromTop(nztm(pt[0],pt[1]),g);}
  // NZTM2000 (EPSG:2193) from WGS84: the transverse Mercator series tree-imagery.js uses (Snyder 1987, eqs 8-9 to 8-10;
  // millimetres within Auckland; test_tree_record.cjs checks the two agree), so the map and the tree page can measure an
  // outline from the crown key's own grid position.
  function nztm(lon,lat){
    const a=6378137,f=1/298.257222101,k0=0.9996,lon0=173*Math.PI/180,FE=1600000,FN=10000000;
    const e2=2*f-f*f,ep2=e2/(1-e2),e4=e2*e2,e6=e4*e2;
    const p=lat*Math.PI/180,l=lon*Math.PI/180,s=Math.sin(p),c=Math.cos(p),t=Math.tan(p);
    const N=a/Math.sqrt(1-e2*s*s),T=t*t,C=ep2*c*c,A=(l-lon0)*c;
    const M=a*((1-e2/4-3*e4/64-5*e6/256)*p-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*p)+(15*e4/256+45*e6/1024)*Math.sin(4*p)-(35*e6/3072)*Math.sin(6*p));
    return [FE+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120),
      FN+k0*(M+N*t*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720))];
  }
  // WGS84 from NZTM2000: the forward series inverted by Newton steps (to well under a millimetre within Auckland).
  function fromNztm(e,n){
    let lat=(n-10000000)/110950,lon=173+(e-1600000)/(111320*Math.cos(lat*Math.PI/180));
    for(let i=0;i<8;i++){
      const [x,y]=nztm(lon,lat),h=1e-6,[xa,ya]=nztm(lon+h,lat),[xb,yb]=nztm(lon,lat+h);
      const a=(xa-x)/h,b=(xb-x)/h,c=(ya-y)/h,d=(yb-y)/h,det=a*d-b*c,dx=e-x,dy=n-y;
      if(!det)break;lon+=(d*dx-b*dy)/det;lat+=(a*dy-c*dx)/det;
      if(Math.abs(dx)<1e-4&&Math.abs(dy)<1e-4)break;
    }
    return [lon,lat];
  }
  // The crown top: the highest cell of the 2024 crown, which names the crown ("<tile>:<x>:<y>", NZTM metres;
  // pipeline/v5/produce_crowns.py). From the record's crown key (identity, outline or growth-form dataset).
  function crownTop(rec){
    const d=rec?._ctx?.record?.datasets||{};
    for(const k of [d.identity?.seg_key,d.outline?.seg_key,d.growth_form?.seg_key]){
      const m=/:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(k||''));
      if(m&&Number(m[1])>1e6&&Number(m[2])>4e6)return [Number(m[1]),Number(m[2])];
    }
    return null;
  }
  function farthestFromTop(top,g){
    let best=0;for(const p of ringsOf(g))for(const [x,y] of p[0]){const [e,n]=nztm(x,y),dd=Math.hypot(e-top[0],n-top[1]);if(dd>best)best=dd;}
    return best||null;
  }
  function extras(rec,{geometry=null,spread:sp=null}={}){
    const c=rec._ctx;if(!c||!c.record)return rec;
    if(Object.prototype.hasOwnProperty.call(rec,'_extras'))rec._extras={geometry,spread:sp};
    const E=rec._env||envOf({},null),flown=SURVEY_2024.captured,out=rec.measures;
    for(const k of ['dripline','rootZone','rootZoneColumnar','crownSpread'])delete out[k];
    const area=num(rec.summary?.size?.area),pos=rec.identity?.position;
    if(geometry&&pos&&ringsOf(geometry).length){
      // From the recorded position when it lies inside the outline; otherwise from the crown top (the trunk is taken to
      // stand under it); the outline's centre only when the record holds no crown key.
      const pt=[pos.lon,pos.lat],inside=inOutline(pt,geometry),top=inside?null:crownTop(rec);
      const r=inside?farthest(pt,geometry):top?farthestFromTop(top,geometry):farthest(outlineCentre(geometry)||pt,geometry);
      if(r){
        const basis=inside?(rec.identity.detection?'from the detection point':'from the recorded position'):
          top?'from the crown top (the highest point of the 2024 crown; the recorded position lies outside the outline)':'from the crown’s centre (the recorded position lies outside the outline)';
        out.dripline=q(E,'dripline','Dripline radius (2024 crown outline)',r,'m','derived',prov(E,'dripline',{source:`Crown outline from the ${SOURCE.lidar2024}`,date:flown,
          method:{id:null,text:'Greatest distance from the trunk position to the 2024 crown outline',href:null},dataset:null,field:null,
          note:`Measured on the outline ${basis}. ${cap(SMALL_BIAS_TEXT)}.`}));
        out.dripline.basis=inside?'position':top?'top':'centre';
      }
    }
    if(!out.dripline&&area!==null&&area>0)out.dripline=Object.assign(q(E,'dripline','Equal-area crown radius',Math.sqrt(area/Math.PI),'m','derived',prov(E,'dripline',{source:'Derived from the crown area',date:flown,
      method:{id:null,text:'Radius of the circle with the crown’s area; the crown outline is not loaded',href:null},dataset:'crown',field:'crown_area_m2'})),{basis:'equal_area'});
    const ps=rec.identity?.protectionStatus;
    if(ps?.status==='scheduled'&&out.dripline){
      const r=out.dripline.value,eq=out.dripline.basis==='equal_area';
      out.rootZone=Object.assign(q(E,'rootZone','Unitary Plan protected root zone (Chapter J)',r,'m','derived',prov(E,'rootZone',{source:'Auckland Unitary Plan, Chapter J (definition of protected root zone); this tree’s 2024 crown outline',
        date:flown,method:{id:null,text:'The greatest distance between the trunk and the outer edge of the canopy (Chapter J definition), measured on the 2024 crown outline',href:null},dataset:null,field:null,
        note:`At least this distance${eq?' (from the equal-area radius; the outline is not loaded)':''}: crown outlines can read small. Auckland Council determines the zone on site.`}),{text:`at least ${nf(r,1)} m`}),{basis:out.dripline.basis});
      const name=[ps.species,ps.latin,ps.name,rec.identity?.title].filter(Boolean).join(' ');
      const h=num(rec.measures.height?.value);
      if(COLUMNAR.test(name)&&h!==null)out.rootZoneColumnar=q(E,'rootZoneColumnar','Unitary Plan protected root zone, columnar crown (Chapter J)',h/2,'m','derived',prov(E,'rootZoneColumnar',{source:'Auckland Unitary Plan, Chapter J; the 2024 LiDAR height',
        date:flown,method:{id:null,text:'For columnar crown species the protected root zone is half the height of the tree (Chapter J definition)',href:null},dataset:'crown',field:'crown_max_chm_m',note:`Half the tree height: ${nf(h,1)} m ÷ 2.`}));
    }
    const s=num(sp);
    if(s!==null&&s>0)out.crownSpread=q(E,'crownSpread','Crown spread',s,'m','measured',prov(E,'crownSpread',{source:`${SOURCE.lidar2024} (Species maxima file of this release)`,date:flown,
      method:{id:null,text:'Mean of the widest width and the width at right angles, from the 0.5 m crown cells',href:`${E.siteRoot||'.'}/how-alto-is-made.html#crown-measures`},dataset:'species_maxima',field:'s',
      uncertainty:{text:'±1 m',low:null,high:null,basis:'margin'},note:'Crown spread is measured across the crown; crown diameter is the circle with the crown’s area.'}));
    rec.measureOrder=Object.keys(out);rec.provenance=collectProvenance(rec);
    return rec;
  }

  // ---------- records and identifiers ----------
  const JOIN={pointcloud_v5_ndvi_watershed:'Recorded position inside the crown',record_crown_link_v52:'v5.2 record-to-crown link',v5_containment_with_v51_continuity_repair:'v5.1 continuity repair'};
  function recordEntry(env,r,c){
    const d=r.datasets||{},rec=d.record||{},rl=d.record_link||{},idn=d.identity||{},S=dep('ALTOSources'),T=dep('ALTOTreeSummary'),L=dep('ALTORecordLinks');
    const ds=S?S.dataset(rec.source_primary):{name:words(rec.source_primary),kind:'Source',group:'other'};
    const isSelf=r.tree_id===c.id,isRep=idn.current_primary_tree_id===r.tree_id,detection=!!S?.DETECTION.includes(rec.source_primary);
    const link=L?.link({},r),sch=T?.schedule(rec);
    const lon=num(rec.lon),lat=num(rec.lat);
    return {treeId:r.tree_id,number:d.tree_number?.number||null,self:isSelf,mapMarker:isRep,detection,
      source:{key:rec.source_primary||null,name:ds.name,kind:ds.kind,group:ds.group||null},role:words(rec.record_role),
      sourceId:rec.source_tree_id||null,objectId:rec.source_object_id??null,
      href:T?.sourceHref(rec.source_primary,rec.source_tree_id,d.source_crosswalk?.current_objectid??rec.source_object_id)||null,
      credit:dep('ALTOCredits')?.dataset(rec.source_primary)||null,
      species:{common:named(rec.species_common_raw||rec.species_common),latin:named(rec.species_latin_raw||rec.species_latin),basis:speciesBasis(rec.species_confidence)},
      owner:rec.owner_raw||rec.owner_class?{raw:rec.owner_raw||null,class:rec.owner_class||null}:null,
      snapshot:dated(rec.as_of_utc),position:lon!==null&&lat!==null?{lon,lat,basis:'As supplied by the source'}:null,
      link:detection&&isRep?{class:'detection',text:'The detection is the crown',score:null,edgeDistance:null,topDistance:null}:
        link?{class:link.cls||'drawn_from_record',text:relWords(link.text||L?.CLASS[link.cls]?.title||'')||null,score:num(rl.confidence),edgeDistance:num(rl.edge_distance_m),topDistance:num(rl.top_distance_m??idn.top_distance_m)}:
        idn.current_primary_tree_id?{class:'contained',text:JOIN[idn.method_id]||'Inside the crown outline',score:null,edgeDistance:null,topDistance:num(idn.top_distance_m)}:null,
      protection:sch?{label:sch.label,type:rec.notable_point_type_label||null}:null,
      crosswalk:d.source_crosswalk?{from:d.source_crosswalk.old_objectid,to:d.source_crosswalk.current_objectid}:null,
      review:d.crown_link_review?words(d.crown_link_review.status):d.location_review?'Position unverified':null,
      streetView:lon!==null&&lat!==null?'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint='+encodeURIComponent(lat+','+lon):null};
  }
  function records(env,c){
    const S=dep('ALTOSources'),all=[c.record,...(c.members||[]).filter(r=>r.tree_id!==c.id)];
    const self=all[0],selfDet=S?.DETECTION.includes(self.datasets?.record?.source_primary);
    const inv=all.filter(r=>!S?.DETECTION.includes(r.datasets?.record?.source_primary));
    const list=[...(selfDet?[self]:[]),...inv];
    return list.map(r=>recordEntry(env,r,c));
  }

  // ---------- measurements by source ----------
  function bySource(env,c){
    const d=c.record?.datasets||{},cr=d.crown||{},a=d.assets||{},pv=d.previous_crown_v4,pc=d.previous_crown,l=d.lidar,t=d.trajectory,g=d.ground,f=parse(d.field?.observation_json),o=d.outline,S=dep('ALTOSources');
    const cols=[],m=v=>num(v)===null?null:num(v);
    if(cr.crown_area_m2!=null||cr.crown_max_chm_m!=null)cols.push({key:'v5',label:'LiDAR crown v5',when:'2024',height:m(cr.crown_max_chm_m),crownDiameter:m(cr.crown_diameter_m),crownArea:m(cr.crown_area_m2),
      outlineArea:m(o?.outline_area_m2),trunk:(t=>t?.kind==='model'?t.central:m(a.dbh_cm_crown_est))(trunk(env,c)),trunkKind:'model',form:c.summary.growth?.shown?c.summary.growth.wording:null,formKind:'model',method:methodRef(env,cr.method_id)});
    if(pv)cols.push({key:'v4',label:'LiDAR crown v4',when:'2024',height:m(pv.height_m),crownDiameter:m(pv.crown_diameter_m),crownArea:m(pv.crown_area_m2),method:methodRef(env,pv.method_id||'pointcloud_v4_vegetation_watershed')});
    if(pc)cols.push({key:'raster',label:'Canopy raster crown',when:'2024',height:m(pc.crown_max_chm_m),crownDiameter:m(pc.crown_diameter_m),crownArea:m(pc.crown_area_m2),method:methodRef(env,pc.method_id)});
    const crownless=cr.crown_area_m2==null&&cr.crown_max_chm_m==null;
    if(l&&crownless)cols.push({key:'chm',label:'Canopy height at record',when:'2024, within 2 m',note:num(l.chm_at_point_m)!==null?`Canopy-model height at the recorded point: ${nf(l.chm_at_point_m,1)} m (no tree crown linked; may be a structure)`:null,method:methodRef(env,l.method_id)});
    else if(l)cols.push({key:'chm',label:'Canopy height at record',when:'2024, within 2 m',height:m(l.chm_local_max_2m_m),heightNote:num(l.chm_at_point_m)!==null?`${nf(l.chm_at_point_m,1)} m at the point`:null,method:methodRef(env,l.method_id)});
    if(t)for(const y of [2016,2013])if(num(t['h_'+y])!==null&&t['present_'+y]!==0)cols.push({key:'lidar'+y,label:`LiDAR ${y}`,when:`${y}, matched canopy`,height:m(t['h_'+y]),method:methodRef(env,'trajectory')});
    const rec=d.record||{};
    if(!S?.DETECTION.includes(rec.source_primary)){
      const sp=[rec.species_common,rec.species_latin].map(named).filter(Boolean);
      cols.push({key:'source',label:S?S.dataset(rec.source_primary).name:words(rec.source_primary),when:rec.as_of_utc?dated(rec.as_of_utc,'snapshot ').text:'',form:sp.length?sp.join(' · '):'Not recorded',formKind:'recorded',note:'No dimensions recorded.'});
    }
    if(g)cols.push({key:'kyte',label:'KYTE visit',when:dated(g.observed_on)?.text||'',note:g.presence?`Presence: ${g.presence}`:null});
    if(f)cols.push({key:'field',label:'Field report',when:f.reported_on||'',note:f.description||null});
    const L=c.live;
    if(L&&(L.diameter_cm||L.height_m||L.crown_spread_m))cols.push({key:'kyteMeasure',label:'KYTE measurement',when:L.observed_on||'',height:L.height_m||null,crownDiameter:L.crown_spread_m||null,
      trunk:L.multiStem?null:L.diameter_cm||null,trunkKind:'measured',form:L.species?.name||null,formKind:'observed',
      note:L.multiStem&&L.diameter_cm?`Largest stem at ${TRUNK_HEIGHT_M} m: ${nf(Math.round(L.diameter_cm))} cm${L.stems?` (${nf(L.stems)} stems)`:''}; not the tree’s trunk diameter`:null});
    // A column for each field measurement: who measured and when; the note gives the method at its height.
    (c.field||[]).forEach((e,i)=>cols.push({key:`fieldMeasure${i+1}`,label:e.by,when:e.dates?.text||'',trunk:e.value,trunkKind:'measured',
      note:[`${fieldWords(e).method}.`,fieldNote(e)].filter(Boolean).join(' '),method:{id:null,text:fieldWords(e).method,href:null}}));
    const rows=[['height','Height','m'],['crownDiameter','Crown diameter','m'],['crownArea','Crown area','m²'],['trunk',`Trunk diameter at ${TRUNK_HEIGHT_M} m`,'cm'],['form','Species or form',null],['note','Notes',null]].filter(([k])=>cols.some(x=>x[k]!==null&&x[k]!==undefined));
    // One provenance entry per column: where that column's values come from.
    const flown=d.growth_form?.lidar_flight_date?dated(d.growth_form.lidar_flight_date,'flown '):SURVEY_2024.captured;
    const COL={v5:[SOURCE.lidar2024,flown,cr.method_id,'crown'],v4:[SOURCE.lidar2024,flown,pv?.method_id||'pointcloud_v4_vegetation_watershed','previous_crown_v4'],
      raster:[SOURCE.lidar2024,flown,pc?.method_id,'previous_crown'],chm:[SOURCE.lidar2024,flown,l?.method_id,'lidar'],
      lidar2016:['Auckland 2016 LiDAR survey (LINZ)',{iso:'2016',text:'2016'},'trajectory','trajectory'],lidar2013:['Auckland 2013 LiDAR survey (LINZ)',{iso:'2013',text:'2013'},'trajectory','trajectory'],
      source:[S?S.dataset(rec.source_primary).name:words(rec.source_primary),dated(rec.as_of_utc,'snapshot '),null,'record'],
      kyte:[SOURCE.kyte,dated(g?.observed_on),g?.method_id||null,'ground'],field:['Field report (reviewed)',f?.reported_on?dated(f.reported_on):null,null,'field'],
      kyteMeasure:[SOURCE.kyte,L?.observed_on?{iso:null,text:L.observed_on}:null,null,'ground']};
    (c.field||[]).forEach((e,i)=>{COL[`fieldMeasure${i+1}`]=[e.by,e.dates,{id:null,text:fieldWords(e).method,href:null},null];});
    for(const col of cols){const x=COL[col.key];if(x)col.provenance=prov(env,'col-'+col.key,{label:col.label,kind:col.key==='source'?'recorded':'measured',source:x[0],date:x[1],method:x[2]||null,dataset:x[3],
      uncertainty:['v5','v4','raster','chm'].includes(col.key)?{text:`Survey specification ${SURVEY_2024.vertical}, ${SURVEY_2024.horizontal}`,low:null,high:null,basis:'survey specification'}:null});}
    return {columns:cols,rows:rows.map(([key,label,unit])=>({key,label,unit}))};
  }

  // ---------- LiDAR ----------
  function lidar(env,c){
    const d=c.record?.datasets||{},pc=d.pointcloud||{},ppc=d.previous_pointcloud||{},cr=d.crown||{},s=c.summary;
    const flown=d.growth_form?.lidar_flight_date?dated(d.growth_form.lidar_flight_date,'flown '):SURVEY_2024.captured;
    const bands=parse(ppc.foliage_profile);
    const ok=Array.isArray(bands)&&bands.length&&bands.every(v=>typeof v==='number'&&v>=0)&&bands.some(v=>v>0);
    const P=(key,label,value,unit,dataset,field,note,digits)=>q(env,key,label,value,unit,'measured',prov(env,'lidar-'+key,{source:SOURCE.lidar2024,date:flown,dataset,field,note,method:dataset==='crown'?cr.method_id:null,
      uncertainty:unit==='m'?{text:`Survey specification ${SURVEY_2024.vertical}`,low:null,high:null,basis:'survey specification'}:null}),{digits});
    const rows=[
      P('crownMax','Crown maximum',num(cr.crown_max_chm_m),'m','crown','crown_max_chm_m','Crown'),
      P('meanHeight','Mean vegetation height',num(cr.mean_veg_height_m),'m','crown','mean_veg_height_m','Crown cells'),
      P('canopyTop','Canopy top (returns)',num(pc.canopy_top_m??ppc.canopy_top_m),'m',pc.canopy_top_m!=null?'pointcloud':'previous_pointcloud','canopy_top_m',null),
      P('liveCrownBase','Live crown base',num(ppc.height_to_live_crown_m),'m','previous_pointcloud','height_to_live_crown_m','Earlier crown'),
      P('vegReturns','Vegetation returns',num(pc.n_veg_returns??ppc.n_vegetation),'n',pc.n_veg_returns!=null?'pointcloud':'previous_pointcloud','n_veg_returns',num(pc.n_ground_returns??ppc.n_ground)!==null?`${nf(num(pc.n_ground_returns??ppc.n_ground))} ground returns`:null),
      P('multiReturn','Multi-return fraction',num(pc.multi_return_fraction??ppc.multireturn_fraction)!==null?num(pc.multi_return_fraction??ppc.multireturn_fraction)*100:null,'pct','pointcloud','multi_return_fraction',null),
      P('cover','Canopy cover (first returns)',num(ppc.canopy_cover)!==null?ppc.canopy_cover*100:null,'pct','previous_pointcloud','canopy_cover','Earlier crown'),
      q(env,'ndvi','NDVI (aerial)',num(cr.ndvi_mean??pc.ndvi_mean),'n','measured',prov(env,'lidar-ndvi',{source:SOURCE.aerial2024,date:null,dataset:'crown',field:'ndvi_mean',note:'Mean over the crown cells'}),{digits:2}),
      pc.pointcloud_class?q(env,'class','Point classification',cap(words(pc.pointcloud_class)),null,'measured',prov(env,'lidar-class',{source:SOURCE.lidar2024,dataset:'pointcloud',field:'pointcloud_class'})):null
    ].filter(Boolean);
    return {profile:ok?{bands,bandHeight:1,total:bands.reduce((x,y)=>x+y,0),basis:s.profileBasis?.area?`Earlier crown, ${nf(s.profileBasis.area)} m²`:'Earlier crown',crownTop:s.size.height,source:SOURCE.lidar2024,
      dataset:'previous_pointcloud',field:'foliage_profile'}:null,measurements:rows,
      points:{status:'pending',format:null,href:null,n:null,bytes:null,note:null}};
  }

  // ---------- how the crown and its links were drawn ----------
  function outline(env,c){
    const d=c.record?.datasets||{},cr=d.crown||{},o=c.summary.outlineInfo||{},id=d.identity||{},gf=d.growth_form,rl=d.record_link,T=dep('ALTOTreeSummary'),L=dep('ALTORecordLinks');
    const tier=cr.evidence_tier||id.evidence_tier;
    return {segmentation:cr.crown_source==='record_seeded_v52'?{text:'Drawn from the record’s LiDAR returns (v5.2)',method:methodRef(env,'record_seeded_crown_v52')}:
        cr.crown_source==='v4_outside_v5'?{text:'v4 crown (outside the v5 survey)',method:methodRef(env,'pointcloud_v4_vegetation_watershed')}:
        cr.method_id?{text:METHODS[cr.method_id]?.text||words(cr.method_id),method:methodRef(env,cr.method_id)}:null,
      crownKey:id.seg_key||null,
      cellArea:num(o.cellArea??cr.crown_area_m2),gapFilled:num(o.gapFilled),
      smoothed:o.smoothed?{area:o.outlineArea,method:words(o.smoothed),methodRef:methodRef(env,d.outline?.method_id||'pointcloud_v53_outline_B')}:null,
      structure:gf?.structure_call?{call:gf.structure_call,merged:gf.merged_call||null,kind:'model'}:null,
      recordsOnCrown:num(id.source_records)??1,inventoryRecords:num(id.inventory_records),
      earlierCrownsOverlapping:num(id.old_overlapping_crowns),laterCrownsOverlapping:num(id.new_overlapping_crowns),
      recordLink:c.summary.detection?{text:'The detection is the crown',class:'detection'}:
        rl?.link_class?{text:relWords(L?.CLASS[rl.link_class]?.title||words(rl.link_class)),class:rl.link_class,edgeDistance:num(rl.edge_distance_m),score:num(rl.confidence),method:methodRef(env,rl.method_id||'record_crown_link_v52')}:
        id.method_id?{text:JOIN[id.method_id]||words(id.method_id),class:'contained',method:methodRef(env,id.method_id)}:null,
      evidenceTier:tier?{key:tier,label:T?.TIER[tier]?.[0]||words(tier)}:null,
      review:d.crown_link_review?{status:words(d.crown_link_review.status),reason:words(d.crown_link_review.reason)}:null};
  }

  // ---------- species ----------
  function species(env,c){
    const d=c.record?.datasets||{},rec=d.record||{},sp=d.species||{},pred=d.predictions,s=c.summary,S=dep('ALTOSources');
    return {recorded:{name:s.name.kind==='recorded'?{common:s.name.title,latin:s.name.latin,latinAsSupplied:s.name.latinAsSupplied||null}:null,
        asSupplied:[rec.species_common_raw,rec.species_latin_raw].filter(Boolean).join(' · ')||null,
        source:S?S.dataset(rec.source_primary).name:words(rec.source_primary),basis:speciesBasis(rec.species_confidence),
        classFromName:sp.growth_form_confidence==='known'?{class:words(sp.growth_form),basis:sp.growth_form_source?`i-Tree match: ${words(String(sp.growth_form_source).replace('itree_',''))}`:null}:null},
      growthForm:identity(env,c).growthForm,
      growthFormStatus:d.growth_form?'scored':!dep('ALTOGrowthForm')?.shipped?.(env.metadata)?'not_in_release':'not_scored',
      legacy:pred?{model:pred.model_id||null,calibrated:false,probabilities:[['proba_evergreen_broadleaf','Evergreen broadleaf'],['proba_deciduous_broadleaf','Deciduous broadleaf'],['proba_conifer','Conifer'],['proba_palm_other','Palm / other']]
        .map(([f,label])=>({label,p:num(pred[f])})).filter(x=>x.p!==null)}:null,
      photoLead:null};
  }

  // ---------- surveys, benefits, height class ----------
  function surveys(env,c){
    return c.summary.surveys.map(e=>({year:e.year,status:e.status,line:e.line,outline:!!e.outline,
      height:e.height!==null?q(env,'survey'+e.year,`Height ${e.year}`,e.height,'m','measured',prov(env,'survey'+e.year,{source:e.year===2024?SOURCE.lidar2024:e.year===2013?'Auckland 2013 LiDAR survey (copyright in the underlying dataset owned by Auckland Council; sourced from LINZ)':`Auckland ${e.year} LiDAR survey (Auckland North 2016–18 and South 2016–17; licensed by Auckland Council; sourced from LINZ, CC BY 4.0)`,
        date:{iso:String(e.year),text:String(e.year)},method:e.year===2024?c.record?.datasets?.crown?.method_id||null:'trajectory',dataset:e.year===2024?'crown':'trajectory',field:e.year===2024?'crown_max_chm_m':'h_'+e.year,
        note:e.year===2024?null:'Canopy height model, canopy matched to this tree'})):null,
      matchedHeight:e.matchedHeight??null,area:e.area,cover:e.cover,position:surveyPoint(c,e),
      pointSample:e.pointSample!=null?{value:e.pointSample,vegReturns:e.vegReturns??null,text:`${nf(e.pointSample,1)} m`}:null}));
  }
  // Where an earlier survey's canopy was matched to this tree: the trajectory point (2013, 2016); null for 2024
  // (the crown is the 2024 position) and for years without a match.
  function surveyPoint(c,e){
    const t=c.record?.datasets?.trajectory;
    if(e.year!==2024&&e.status==='matched'&&t&&num(t.lon)!==null&&num(t.lat)!==null)return {lon:num(t.lon),lat:num(t.lat),basis:'Canopy point matched across the 2013, 2016 and 2024 surveys'};
    return null;
  }
  // Height change between surveys, like for like: the canopy height model at the matched canopy point in each survey
  // (trajectory build). A change within ±1 m between two surveys is no detectable change.
  const NO_CHANGE_M=1;
  function surveyChange(env,c){
    const t=c.record?.datasets?.trajectory;if(!t)return null;
    const at=y=>num(t['h_'+y])!==null&&t['present_'+y]!==0?num(t['h_'+y]):null;
    const rates=[[2013,2016,'growth_2013_2016'],[2016,2024,'growth_2016_2024']].map(([from,to,f])=>{const a=at(from),b=at(to),dh=a!==null&&b!==null?b-a:null;
      return {from,to,value:num(t[f])??(dh!==null?dh/(to-from):null),fromHeight:a,toHeight:b,change:dh,detectable:dh!==null&&Math.abs(dh)>NO_CHANGE_M};}).filter(x=>x.value!==null&&x.change!==null);
    if(!rates.length)return null;
    const pc=c.record?.datasets?.pointcloud,ppc=c.record?.datasets?.previous_pointcloud,veg=num(pc?.n_veg_returns??ppc?.n_vegetation);
    // Release 6.3 labels an "established since" fate without a current crown or vegetation returns not assessed
    // (trajectory_label); its display text replaces the stored fate.
    const tl=c.record?.datasets?.trajectory_label;
    return {rates,unit:'m/yr',implausible:num(t.implausible)===1,fate:tl?.display||(veg===0&&/^established/.test(t.fate||'')?null:words(t.fate)),
      provenance:prov(env,'survey-change',{label:'Height change between surveys',kind:'derived',source:SOURCE.lidarEarlier+'; '+SOURCE.lidar2024,method:'trajectory',dataset:'trajectory',
        note:'Difference of matched canopy heights divided by the years between surveys'})};
  }
  // Where the tree stands: flood and stormwater layers, the heat grid, impervious surfaces within 30 m,
  // and the neighbourhood of the earlier crown. Values as joined by earlier builds; each part says when.
  function setting(env,c){
    const d=c.record?.datasets||{},x=d.context,im=d.impervious,pa=d.previous_assets;
    if(!x&&!im&&!pa)return null;
    const ctxDoc={id:null,text:'Spatial join of the earlier crown to public layers (June 2026)',href:REPO+'docs/methods/tree_context_pilot.md',doc:REPO+'docs/methods/tree_context_pilot.md'};
    return {
      water:x?{floodPlain:num(x.in_flood_plain)===1,floodProne:num(x.in_flood_prone_area)===1,floodProneMaxDepth:num(x.flood_prone_max_depth_m),
        overlandFlowDistance:num(x.dist_overland_flow_path_m),stormwaterPipeDistance:num(x.dist_stormwater_pipe_m),catchpitDistance:num(x.dist_stormwater_catchpit_m),
        provenance:prov(env,'setting-water',{label:'Flood and stormwater setting',kind:'recorded',source:'Auckland Council flood plains, flood-prone areas, overland flow paths and stormwater network',
          date:dated(x.created_at_utc,'joined '),method:ctxDoc,dataset:'context',note:x.context_confidence?cap(words(x.context_confidence)):null})}:null,
      heat:x&&(num(x.air_temp_mean_c)!==null||num(x.fraction_paved_surfaces)!==null)?{airTempMean:num(x.air_temp_mean_c),airTempMax:num(x.air_temp_max_c),
        paved:num(x.fraction_paved_surfaces),buildings:num(x.fraction_buildings),trees:num(x.fraction_trees),
        provenance:prov(env,'setting-heat',{label:'Heat grid',kind:'recorded',source:'Auckland urban heat grid (air temperature and surface cover per grid cell)',date:dated(x.created_at_utc,'joined '),method:ctxDoc,dataset:'context'})}:null,
      surface:im?{impervious:num(im.fraction_impervious_30m),roads:num(im.fraction_roads_30m),buildings:num(im.fraction_buildings_30m),other:num(im.fraction_other_imperv_30m),radius:30,
        provenance:prov(env,'setting-surface',{label:'Impervious surface within 30 m',kind:'recorded',source:SOURCE.impervious,date:dated(im.created_at_utc,'joined '),
          method:{id:null,text:'Share of impervious cover in a 30 m window around the tree',href:REPO+'docs/methods/tree_valuation_pilot.md'},dataset:'impervious'})}:null,
      neighbourhood:pa&&(num(pa.neighbours_25m)!==null||pa.growth_setting)?{neighbours25:num(pa.neighbours_25m),neighbours50:num(pa.neighbours_50m),nearestTree:num(pa.nearest_tree_m),
        canopy25:num(pa.local_canopy_density_25m),canopy50:num(pa.local_canopy_density_50m),growthSetting:words(pa.growth_setting),edgeTree:pa.edge_tree===null||pa.edge_tree===undefined?null:String(pa.edge_tree)==='1',
        dominance:words(pa.dominance_class),clusterSize:num(pa.cluster_size),
        provenance:prov(env,'setting-neighbourhood',{label:'Neighbourhood of the earlier crown',kind:'derived',source:'ALTO earlier crown set (canopy raster method)',date:dated(pa.created_at_utc,'computed '),
          method:{id:null,text:'Counts and canopy density around the earlier crown',href:REPO+'docs/methods/tree_asset_model.md'},dataset:'previous_assets'})}:null};
  }
  function benefits(env,c){
    const b=c.summary.benefits,v=c.record?.datasets?.services||{};
    if(b.total===null)return {status:b.withheld?'withheld':b.scenarioOnly?'scenario_only':'not_estimated',withheld:b.withheld||null,scenarioTotal:b.scenarioOnly?b.scenarioTotal:null,rows:[],total:null};
    // Each component says what kind of number it is (release 6.2): stormwater uses a placeholder unit value; air quality
    // is a sensitivity scenario whose coefficient is under review; cooling is an exploratory index with no physical quantity.
    const MARK={stormwater:'placeholder unit value',carbon:'sensitivity scenario',air:'sensitivity scenario; coefficient under review',cooling:'exploratory index; no physical quantity'};
    const row=(key,label,quantity,value)=>({key,label,quantity,value:num(value),mark:MARK[key]||null});
    // Release 6.3: the benefit value is stormwater plus carbon; air-quality and cooling dollars stay in the full record (not
    // release-eligible). PM2.5 removal and the cooling index (unpriced) are listed only where the release publishes them.
    const v63=b.basis==='stormwater_carbon',FD=dep('ALTOFields'),shown=!!FD?.pm25CoolingShown(env.metadata);
    const rows=[row('stormwater','Stormwater',b.runoffM3!==null?{value:b.runoffM3,unit:'m³/yr',text:`${F.volume(b.runoffM3)} runoff avoided`,
          detail:num(v.intercepted_rainfall_m3_y)!==null?`${F.volume(v.intercepted_rainfall_m3_y)} intercepted; ${nf(num(v.paved_fraction_used)*100)}% paved within 30 m`:null}:null,b.stormwaterValue),
        row('carbon','Carbon',b.carbonStored!==null?{value:b.carbonStored,unit:'t CO₂e',text:`${co2(b.carbonStored)} stored`,
          detail:num(v.annual_sequestration_tco2e_y_est)!==null?`${F.co2Rate(v.annual_sequestration_tco2e_y_est)} sequestered`:null}:null,b.carbonValue)];
    if(!v63)rows.push(row('air','Air quality',b.pm25!==null?{value:b.pm25,unit:'kg/yr',text:`${F.sigText(b.pm25,2)} kg PM2.5/yr`,detail:null}:null,b.airValue),row('cooling','Cooling',null,b.coolingValue));
    const also=v63&&shown?[b.pm25g!==null?{key:'pm25',label:'PM2.5 removed',text:`${F.sigText(b.pm25g,2)} g a year`}:null,
      b.coolingIndex!==null?{key:'coolingIndex',label:'Cooling index',text:`${F.sigText(b.coolingIndex,2)} (no unit)`}:null].filter(Boolean):[];
    return {status:'estimated',release63:v63,components:v63?'stormwater and carbon':null,also,pm25CoolingShown:v63?shown:null,
      rows,
      total:{value:b.total,low:b.low,high:b.high,text:`${money(b.total)}/yr`,rangeText:b.low!==null&&b.high!==null?`${money(b.low)}–${money(b.high)}`:null},
      method:methodRef(env,v63?'benefits_v63':v.method_id||null),classUsed:v.species_class?{key:v.species_class,label:cap(words(v.species_class)),source:words(v.species_class_source)}:null,
      confidence:words(v.valuation_confidence),uncertaintyFactor:num(v.uncertainty_factor),lai:num(v.lai_used),
      biomass:num(v.agb_kg_est)!==null?{aboveKg:num(v.agb_kg_est),belowKg:num(v.bgb_kg_est)}:null,
      growthFormBasis:v.growth_form_basis?words(v.growth_form_basis):null,
      assumptions:parse(v.assumptions_json)||null,
      note:v63?`ALTO benefit scenario: simplified equations adapted from published i-Tree Eco components, with stated unit values; not run in i-Tree Eco, and not a valuation. Benefit value: stormwater plus carbon (release 6.3). Air-quality and cooling dollars are kept in the full record, not release-eligible.${shown?'':' PM2.5 removal and the cooling index are not published in this release.'} Stormwater price and flood uplift: placeholders pending Healthy Waters validation.`:
        'ALTO benefit scenario: simplified equations adapted from published i-Tree Eco components, with stated unit values; not run in i-Tree Eco, and not a valuation. Stormwater price and flood uplift: placeholders pending Healthy Waters validation.'};
  }
  // Height class: the stored class (release 6.3 height_class, release 6.2 life_stage) on the five classes of
  // tree-summary.js HEIGHT_CLASS, each with its band; a crown release 6.3 does not class says why.
  function lifeStage(env,c){
    const L=c.summary.lifeStage,T=dep('ALTOTreeSummary'),nc=c.summary.replacement?.release63&&!L?c.summary.replacement.notClassed:null;
    return {status:L?'estimated':nc?'not_classed':'not_estimated',notClassed:nc||null,release63:!!(L?.release63||c.summary.replacement?.release63),
      key:L?.key||null,label:L?.label||null,band:L?.band||null,detail:L?.detail||null,definition:L?.definition||'Height as a share of the reference height for the tree class',
      scale:(T?.HEIGHT_CLASS||[]).map(([key,label,lo,hi])=>({key,label,from:lo,to:hi,band:T.bandText({from:lo,to:hi}),current:key===L?.key})),
      referenceHeights:T?.CLASS_MAX_HEIGHT_M||null,age:null};
  }
  // Regrowth and its class: release 6.3 the crown replacement band (or not classed, with its reason) and the tall-tree
  // fact; release 6.2 the irreplaceability class.
  function replacement(env,c){
    const R=c.summary.replacement,now=(env.now||new Date()).getFullYear(),T=dep('ALTOTreeSummary');
    return {years:R.years,startYear:now,reachYear:R.years!==null?Math.round(now+R.years):null,rate:R.rate,
      marks:R.years!==null?[25,50,75,100].map(p=>({share:p,year:Math.round(now+R.years*p/100)})):[],
      release63:!!R.release63,band:R.band||null,notClassed:R.notClassed||null,tallTree:R.release63?!!R.tallTree:null,
      bands:R.release63?(T?.BANDS||[]).map(([key,label,rule])=>({key,label,rule})):[],
      irreplaceability:R.irreplaceability?{key:R.irreplaceability,label:R.irrLabel,definition:R.irrDefinition}:null,
      classes:R.release63?[]:Object.entries(T?.IRR||{}).map(([key,[label,rule]])=>({key,label,rule})),
      cost:null};
  }
  // Root space: present whenever the release has a root-space scenario for the tree (a LiDAR-detected tree has a
  // protection radius without an effective rooting radius). The protection radius follows the central trunk
  // estimate (rpaRadius), with its range; the release's stored values are kept as `stored`.
  function roots(env,c){
    const r=c.record?.datasets?.roots;if(!r||(r.rpa_radius_m==null&&r.effective_radius_m==null))return null;
    if(c.summary?.benefits?.withheld)return null;   // release 6.3: estimates withheld (height not plausible)
    const tk=trunk(env,c),radius=tk?rpaRadius(tk.central):num(r.rpa_radius_m);
    const lo=tk&&tk.low!==null?rpaRadius(tk.low):null,hi=tk&&tk.high!==null?rpaRadius(tk.high):null,ranged=lo!==null&&hi!==null&&spread([lo,hi],v=>nf(v,1));
    const area=radius===null?null:Math.min(Math.PI*radius*radius,RPA_AREA_CAP_M2);
    return {kind:'scenario',provenance:prov(env,'roots',{label:'Root space',kind:'model',source:SOURCE.alto,method:rootMethod(env,r.method_id),
        model:modelOf(env,'roots',r.method_id||null),dataset:'roots',note:r.constraint_basis||null}),
      rpaRadius:radius,rpaArea:area,rpaRange:ranged?{low:lo,high:hi,areaLow:Math.PI*lo*lo,areaHigh:Math.min(Math.PI*hi*hi,RPA_AREA_CAP_M2)}:null,
      rpaBasis:tk?(tk.field?'From the trunk diameter measured in the field':tk.kind==='measured'?'From the measured trunk diameter':`${RPA_FACTOR} × the central trunk estimate (${nf(Math.round(tk.central))} cm)`):'The release’s stored radius',
      rule:{factor:RPA_FACTOR,areaCap:RPA_AREA_CAP_M2},trunk:tk?{central:tk.central,low:tk.low,high:tk.high,kind:tk.kind}:null,
      stored:{rpaRadius:num(r.rpa_radius_m),rpaArea:num(r.rpa_area_m2),dbh:num(r.dbh_cm)},
      effectiveRadius:num(r.effective_radius_m),effectiveArea:num(r.effective_area_m2),
      foragingRadius:num(r.foraging_radius_m),constraint:words(r.root_constraint_flag),basis:r.constraint_basis||null,method:rootMethod(env,r.method_id),confidence:words(r.model_confidence)};
  }
  // KYTE task links (KYTE docs/REPORTS.md): the tree (by its number), the task and the release the person was looking
  // at. The texts say what KYTE's forms ask for. Kauri: a whole-tree photograph from the track or footpath only, never bark
  // or leaf close-ups (kauri dieback hygiene).
  const isKauri=c=>{const r=c.record?.datasets?.record||c.props||{};return /^agathis\b/i.test(String(r.species_latin||r.species_latin_raw||''))||/^kauri\b/i.test(String(r.species_common_raw||r.species_common||''));};
  const KAURI_PHOTO='A whole-tree photo from the track or footpath only; no bark or leaf close-ups (kauri dieback hygiene)';
  function know(env,c,number=null){
    const rel=env.datasetVersion?`&release=${encodeURIComponent(env.datasetVersion)}`:'';
    const go=task=>`${env.kyteBase}/?tree=${encodeURIComponent(number||c.id)}&task=${task}${rel}`;
    const kauri=isKauri(c);
    return [{task:'species',title:'Confirm or correct the species',text:kauri?`Type the species. ${KAURI_PHOTO}.`:'Type the species; a leaf photo helps.',href:go('species')},
      {task:'age',title:'Add the planting year or age',text:'Planting year or age, and how you know.',href:go('age')},
      {task:'removed',title:'Report it removed',text:'Say what is there now; a photo of the spot helps.',href:go('removed')},
      {task:'outline',title:'Flag the crown outline',text:'Say what is wrong with the outline; no visit needed.',href:go('outline')}];
  }
  // "Report a problem with this record": a KYTE task, offered only once KYTE reads it (kyte-config.js problemTask).
  function problemHref(rec,{config=root.ALTO_KYTE_CONFIG,kyteBase=null}={}){
    if(!config||config.problemTask!==true)return null;
    const E=rec._env||{},base=String(kyteBase||E.kyteBase||'./kyte').replace(/\/+$/,'');
    return `${base}/?tree=${encodeURIComponent(rec.number||rec.id)}&task=problem${E.datasetVersion?`&release=${encodeURIComponent(E.datasetVersion)}`:''}`;
  }
  // The general photo link: the tree by its number.
  const photoHref=(rec,kyteBase)=>`${String(kyteBase||rec._env?.kyteBase||'./kyte').replace(/\/+$/,'')}/?tree=${encodeURIComponent(rec.number||rec.id)}`;

  // ---------- history across releases (from the record; a published history file adds lineage) ----------
  // Releases this tool knows, oldest first, each dated from one source: the New Zealand date of its dataset ID (as the
  // methods pages and the changelog give it). A record carries what each release left on it.
  const RELEASES=[{key:'v4',label:'4',date:'2026-09-18'},{key:'v5',label:'5',date:'2026-09-23'},{key:'v5.1',label:'5.1',date:'2026-10-08'},
    {key:'v5.2',label:'5.2',date:'2026-10-10'},{key:'v6',label:'6',date:'2026-10-12'},{key:'v6.1',label:'6.1',date:'2026-10-13'},{key:'v6.2',label:'6.2',date:'2026-10-13'},
    {key:'v6.3',label:'6.3',date:'2026-10-17'}];
  const relOrder=key=>RELEASES.findIndex(x=>x.key===key);
  const relDate=key=>{const r=RELEASES.find(x=>x.key===key);return r?dated(r.date):null;};
  // "reviewer correction v61" -> "reviewer correction release 6.1": releases are named in words.
  const relWords=t=>String(t??'').replace(/\bv(\d)(\d)\b/g,'release $1.$2').replace(/\bv(\d+(?:\.\d+)?)\b/g,'release $1');
  // Newest first; every release from the tree's first row to the page's own is listed, a release that changed nothing
  // about the tree marked so.
  function completeRows(rows,cur){
    const keys=new Set(rows.map(r=>r.release)),known=rows.map(r=>relOrder(r.release)).filter(i=>i>=0);
    const last=Math.max(relOrder(cur),...known);
    if(known.length)for(let i=Math.min(...known);i<=last;i++){const k=RELEASES[i].key;if(!keys.has(k))rows.push({release:k,date:relDate(k),crown:null,role:null,evidence:null,events:[],noChange:true});}
    for(const r of rows){r.date=relDate(r.release)||r.date||null;r.current=r.release===cur;if(!(r.events||[]).length&&!r.crown)r.noChange=true;}
    rows.sort((a,b)=>relOrder(b.release)-relOrder(a.release));
    return rows;
  }
  function historyFromRecord(env,c){
    const d=c.record?.datasets||{},pe=d.previous_evidence,pv=d.previous_crown_v4,id=d.identity||{},cr=d.crown||{},rl=d.record_link,rv=d.crown_link_review,o=d.outline,gf=d.growth_form,cur=env.releaseLabel;
    const rows=[];
    if(pe||pv)rows.push({release:'v4',crown:{key:pe?.seg_key||pv?.seg_key||null,height:num(pe?.v4_height_m??pv?.height_m),area:num(pe?.v4_crown_area_m2??pv?.crown_area_m2),
      method:methodRef(env,pe?.method_id||pv?.method_id||'pointcloud_v4_vegetation_watershed')},role:words(pe?.link_role),evidence:words(pe?.evidence_tier),
      events:[pe?.restored?{kind:'restored',text:'Restored after an earlier release dropped it'}:null].filter(Boolean)});
    // The record's identity is the current release's, so the v5 row states the crown only; roles are
    // given for v4 (stored with the earlier evidence) and for the release on the page.
    if(id.seg_key||cr.crown_area_m2!=null)rows.push({release:'v5',crown:{key:id.seg_key||null,height:num(cr.crown_max_chm_m),area:num(cr.crown_area_m2),method:methodRef(env,cr.method_id)},
      role:null,evidence:null,
      events:[num(id.old_overlapping_crowns)>1?{kind:'lineage',text:`${nf(id.old_overlapping_crowns)} release 4 crowns overlap this crown`}:null,
        pe?.seg_key&&id.seg_key&&num(pe?.v4_crown_area_m2)!==null&&num(cr.crown_area_m2)!==null?{kind:'resegmented',text:`Crown redrawn: ${nf(pe.v4_crown_area_m2,1)} → ${nf(cr.crown_area_m2,1)} m²`}:null].filter(Boolean)});
    if(rv)rows.push({release:'v5.1',crown:null,role:null,evidence:null,
      events:[{kind:'repair',text:`Crown continuity repair: ${words(rv.status)}${rv.reason?` (${words(rv.reason)})`:''}`,method:methodRef(env,rv.method_id||'v5_containment_with_v51_continuity_repair')}]});
    if(rl||cr.crown_source==='record_seeded_v52')rows.push({release:'v5.2',crown:cr.crown_source==='record_seeded_v52'?{key:id.seg_key||null,height:num(cr.crown_max_chm_m),area:num(cr.crown_area_m2),method:methodRef(env,'record_seeded_crown_v52')}:null,
      role:null,evidence:null,events:[rl?.link_class?{kind:'link',text:`Record linked to its crown: ${relWords(dep('ALTORecordLinks')?.CLASS[rl.link_class]?.title||words(rl.link_class))}`,method:methodRef(env,rl.method_id||'record_crown_link_v52')}:null,
        cr.crown_source==='record_seeded_v52'?{kind:'drawn',text:'Crown drawn from the record’s LiDAR returns; awaiting confirmation'}:null].filter(Boolean)});
    if(o||gf)rows.push({release:'v6',crown:o?{key:o.seg_key||id.seg_key||null,height:null,area:num(o.outline_area_m2),method:methodRef(env,o.method_id||'pointcloud_v53_outline_B')}:null,role:null,evidence:null,
      events:[o?{kind:'outline',text:`Smoothed outline: ${nf(num(o.outline_area_m2)??0,1)} m² from ${nf(num(o.cell_area_m2)??0,1)} m² of cells`}:null,
        gf?{kind:'growthForm',text:`Growth form estimated: ${cap(String(gf.wording||words(gf.display_key)||'').replace(/^(Probably|Likely|Possibly)\s+/i,'').replace(/\s*\(model\)$/,'').replace(/\(model,\s*/,'('))}`}:null,
        gf?.merged_call==='merged'?{kind:'merged',text:'Crown called merged (several trees) by the release 6 model'}:null].filter(Boolean)});
    // The release on the page always has a row: the tree is in it.
    if(cur&&!rows.some(r=>r.release===cur)){
      rows.push({release:cur,crown:id.seg_key||cr.crown_area_m2!=null?{key:id.seg_key||null,height:num(cr.crown_max_chm_m),area:num(cr.crown_area_m2),method:methodRef(env,cr.method_id)}:null,
        role:words(id.link_role),evidence:words(id.evidence_tier),events:[],page:true});
    }
    return completeRows(rows,cur);
  }

  // ---------- reviews and corrections held in the record ----------
  function reviewsFromRecord(env,c){
    const d=c.record?.datasets||{},out=[];
    const f=parse(d.field?.observation_json);
    if(d.field)out.push({id:null,ref:f?.observation_id||null,kind:'field_observation',basis:'record',date:dated(d.field.observed_on),summary:f?.description||'Field observation',by:null,status:'applied',appliedIn:[]});
    if(d.ground)out.push({id:null,kind:'ground_visit',basis:'record',date:dated(d.ground.observed_on),summary:`KYTE visit accepted${d.ground.presence?`; presence: ${d.ground.presence}`:''}${d.ground.note?`. ${d.ground.note}`:''}`,by:null,status:'applied',appliedIn:[]});
    if(d.notable_link_review)out.push({id:null,kind:'notable_position',basis:'record',date:null,summary:d.notable_link_review.review_note||'Notable-tree position reviewed',by:null,status:'applied',appliedIn:[]});
    if(d.location_review)out.push({id:null,kind:'position_flag',basis:'record',date:null,summary:d.location_review.review_note||'Council position unverified',by:null,status:'applied',appliedIn:[]});
    // Reviewer corrections the release attached to this tree (dataset "corrections", written by the v6 corrections
    // stage from the append-only ledger; one row per correction).
    const corr=Array.isArray(d.corrections)?d.corrections:d.corrections?[d.corrections]:[];
    // Release 6.3: each row carries the receipt's public summary (tree numbers and plain names); the summary as recorded
    // in the ledger stays beside it.
    for(const x of corr)out.push({id:x.id||null,kind:words(x.type)||'correction',basis:'record',date:dated(x.decided_on),summary:x.public_summary||x.summary||null,
      summaryAsRecorded:x.public_summary&&x.summary&&x.public_summary!==x.summary?x.summary:null,by:x.reviewer||null,
      status:words(x.status||'accepted'),outcome:words(x.outcome||null),reason:x.reason||null,role:words(x.role||null),evidence:evidenceList(x.evidence),appliedIn:[]});
    // Release 6.3: reviewer notes from the ledger (tree_note): wording only; protection and every value stay as they are.
    const known=new Set(out.map(x=>x.id).filter(Boolean));
    for(const n of d.notes||[])if(n?.text&&!known.has(n.correction_id))out.push({id:n.correction_id||null,kind:'reviewer note',basis:'record',date:dated(n.decided_on),summary:n.text,by:n.reviewer||null,status:'applied',appliedIn:[]});
    return out.map(withRegister);
  }
  // A review that names a New Zealand Tree Register record ("NZ Tree Register AR/0177 is ...") links that record's
  // page on the register; the page credits the register under the list.
  function withRegister(x){const C=dep('ALTOCredits');return {...x,register:C?C.registerRecords(x.summary,x.reason,x.evidence||[]):[]};}

  // ---------- assembly ----------
  function envOf(env={},metadata=null){
    const md=metadata||env.metadata||null,V=dep('ALTOVersion');
    const siteRoot=String(env.siteRoot??'.').replace(/\/+$/,'')||'.';
    const dv=md?.release?.dataset_version||null;
    let derived=env.derivedBase??root.ALTO_DERIVED_BASE??`${siteRoot}/derived/{release}`;
    derived=String(derived).replace('{release}',encodeURIComponent(dv||'unknown')).replace(/\/+$/,'');
    const version=env.version||md?.assembly?.tile_version||dv||'session';
    // The derived folder travels inside the tool build, and the site keeps /derived/<release>/ for a year: its files are
    // asked for with the data stamp and the tool version, so a tool update that adds or refreshes a product is read.
    return {...env,metadata:md,siteRoot,dataBase:String(env.dataBase||'./data').replace(/\/+$/,''),derivedBase:derived,kyteBase:env.kyteBase||`${siteRoot}/kyte`,
      version,derivedVersion:env.derivedVersion||`${version}.t${V?.TOOL?.version||'0'}`,releaseLabel:V?V.data(md).label:null,datasetVersion:dv};
  }
  function release(env,c){
    const V=dep('ALTOVersion'),md=env.metadata,r=md?.release||{},dv=V?V.data(md):{label:null,dev:false};
    return {data:dv.label,dev:!!dv.dev,datasetVersion:r.dataset_version||null,updated:dated(r.dataset_last_updated_utc),
      public:V?.publicLabel?V.publicLabel(md):null,
      snapshot:dated(c.schema?.generated_utc||c.record?.snapshot),bucketSchema:c.schema?.version??null,tool:V?.TOOL.version||null,
      status:r.status||null,statusText:r.status==='research_only_not_independently_validated'?'Research release; not independently validated':words(r.status),
      label:V?V.label(md):null,methodsHref:dv.label?`${env.siteRoot}/${String(dv.label).replace('.','')}-methods.html`:null,repository:V?.TOOL.repository||null};
  }
  // The name a citation gives a tree: its recorded species (display form), "Scheduled notable tree" for a schedule entry
  // naming several species, otherwise none ("Tree T…").
  function citeName(s){
    if(s.name.kind==='recorded'&&!s.name.multi)return s.name.title;
    if(s.name.multi&&s.status.protected)return 'Scheduled notable tree';
    return null;
  }
  // The citation again once the local board is known.
  function recite(rec){
    const V=dep('ALTOVersion'),E=rec._env;if(!V||!E)return rec.citation;
    const b=rec.place?.board?.name;
    rec.citation=V.citation({treeId:rec.number||rec.id,url:rec.permalink||rec.url,metadata:E.metadata,title:'ALTO: Aotearoa Long-term Tree Observatory',name:citeName(rec.summary),
      place:b?(/Local Board$/.test(b)?b:`${b} Local Board`):null,at:coordText(rec.summary?.position?.lat,rec.summary?.position?.lon)});
    return rec.citation;
  }

  // ---------- location ----------
  // Where the tree is: the map pin's position in WGS84 (latitude, longitude; 5 decimals, about 1 m), what that position
  // is, and plain links to the same point on Google Maps, Street View and OpenStreetMap (6 decimals). A 2024 LiDAR
  // crown's pin is its crown top; an earlier detection's pin is its detection point; a source record's pin is its
  // recorded position as the source supplied it.
  const COORD_DP=5;
  const coord=(lat,lon)=>{const a=num(lat),o=num(lon);return a!==null&&o!==null&&Math.abs(a)<=90&&Math.abs(o)<=180?[a,o]:null;};
  function coordText(lat,lon,dp=COORD_DP){const c=coord(lat,lon);return c?`${c[0].toFixed(dp)}, ${c[1].toFixed(dp)}`:null;}
  function mapLinks(lat,lon){
    const c=coord(lat,lon);if(!c)return [];
    const a=c[0].toFixed(6),o=c[1].toFixed(6);
    return [{key:'google',label:'Google Maps',href:`https://www.google.com/maps/search/?api=1&query=${a},${o}`},
      {key:'streetview',label:'Street View',href:`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${a},${o}`},
      {key:'osm',label:'OpenStreetMap',href:`https://www.openstreetmap.org/?mlat=${a}&mlon=${o}#map=19/${a}/${o}`}];
  }
  const DETECTION_POINT={lidar_pointcloud_v5:'Crown top in the 2024 LiDAR survey',lidar_pointcloud_v4:'Detection point (earlier LiDAR point-cloud method)',
    lidar_inferred_canopy:'Detection point (LiDAR canopy model)',low_canopy_promoted:'Detection point (LiDAR low-canopy detection)',
    pointcloud_missed_promoted:'Detection point (LiDAR point-cloud detection)'};
  const POSITION_BY={tree_register_points:'Auckland Council’s tree register',notable_trees_overlay:'Auckland Council’s Notable Trees schedule',
    osm_natural_tree:'OpenStreetMap',ruru_obskauri_tiaki_public:'Auckland Council’s kauri survey (Ruru ObsKauri Tiaki)',kyte:'a KYTE ground visit',nz_tree_register:'the NZ Tree Register'};
  // -> {lat, lon, text, datum, basis, council, unverified, caption, links} or null when the record has no position.
  function location(rec){
    const p=rec?.identity?.position||rec?.summary?.position,c=coord(p?.lat,p?.lon);if(!c)return null;
    const id=rec.identity||{},r=rec._ctx?.record?.datasets?.record||{},src=r.source_primary||rec._ctx?.props?.source_primary||null;
    const by=POSITION_BY[src]||(src?dep('ALTOSources')?.dataset(src)?.name||null:null);
    const basis=id.detection?DETECTION_POINT[src]||'Detection point (LiDAR)':`Recorded position as supplied by ${by||'the source'}`;
    // A Council point says whether Council verified it (as the evidence row does: a location review or a notable point
    // type other than "Verified position" leaves it unverified).
    const d=rec._ctx?.record?.datasets||{},council=['tree_register_points','notable_trees_overlay','ruru_obskauri_tiaki_public'].includes(src)?
      (!d.location_review&&id.quality!=='location_unverified'&&(String(r.notable_point_type??'')==='1'||/^Verified position/i.test(String(r.notable_point_type_label||'')))?'verified':'not verified'):null;
    const caption=`${basis}${council?` (Council position ${council})`:''}; the map pin. Latitude, longitude (WGS84).`;
    return {lat:c[0],lon:c[1],text:coordText(c[0],c[1]),datum:'WGS84',basis,council,unverified:council==='not verified',caption,links:mapLinks(c[0],c[1])};
  }
  // The nearest address point's street and the parcel under the pin, once the page has read them: one line, or null
  // while neither is known.
  function nearLine(rec){
    const st=(rec?.context?.scopes||[]).find(s=>s.scope==='street'),pc=rec?.place?.parcel,out=[];
    if(st?.name)out.push(`Nearest address point on ${st.name} (OpenStreetMap)${num(st.distance)!==null?`, ${Math.round(st.distance)} m away`:''}`);
    else if(st&&st.status==='none'&&st.definition)out.push(st.definition);
    if(pc?.status==='ready'&&pc.id)out.push(`LINZ parcel ${pc.id}`);
    else if(pc?.status==='none'&&!pc.id)out.push('Not on a LINZ parcel (road corridor or foreshore)');
    return out.length?out.join(' · '):null;
  }
  function assemble({id,record,schema=null,members=[],memberCount=null,metadata=null,resolved=null,env={},live=null,props=null}){
    const T=dep('ALTOTreeSummary'),Id=dep('ALTOTreeId'),V=dep('ALTOVersion');
    const E=envOf(env,metadata);
    const tree_id=id||record?.tree_id||props?.tree_id;
    const summary=T.from(props||{tree_id},record||null);
    const c={id:tree_id,record,schema,members,summary,live,props:props||null};
    // The tree's permanent number (data release 6.1 on): the full record's tree_number, the map feature's tn, or the
    // number the request resolved to. Before 6.1 there is none and the record ID stays the tree's only ID.
    const tn=record?.datasets?.tree_number||null;
    const number=[tn?.number,props?.tn,resolved?.status==='current'?resolved.number:null].find(n=>n&&(!Id||Id.isNumber(n)))||null;
    const url=Id?Id.url(number||tree_id):null,mapUrl=Id?Id.url(number||tree_id,{page:'map'}):null,permalink=number&&Id?Id.permalink(number):null;
    const rec={schema:SCHEMA,loaded:!!record,id:tree_id,number,permalink,shortId:summary.shortId,url,mapUrl,
      numberRole:tn?{role:tn.role||null,kind:tn.kind||null,minted:tn.minted_release||null}:null,
      request:resolved?{input:resolved.input??null,key:resolved.key??null,kind:resolved.kind||null,canonical:resolved.canonical??tree_id,number:resolved.number||null,status:resolved.status||'current',
        relation:resolved.relation||null,resolvedBy:resolved.resolved_by||null,note:resolved.note||null,reason:resolved.reason||null}:null,
      release:release(E,c),
      citation:V?V.citation({treeId:number||tree_id,url:permalink||url,metadata:E.metadata,title:'ALTO: Aotearoa Long-term Tree Observatory',name:citeName(summary),at:coordText(summary.position?.lat,summary.position?.lon)}):null,
      identity:identity(E,c),measures:{},measureOrder:[],records:[],moreRecords:0,identifiers:summary.ids,bySource:null,
      outline:null,lidar:null,species:null,surveys:[],surveyChange:null,setting:null,benefits:null,lifeStage:null,replacement:null,roots:null,
      context:{status:'pending',scopes:[]},history:{status:'pending',releases:[]},corrections:{status:'pending',items:[]},
      imagery:{status:'pending'},place:{status:'pending'},nearby:{status:'pending',trees:[]},photos:{status:'pending',visits:[]},scenario:{status:'pending'},
      inat:{status:'pending',records:[]},streetview:{status:'pending'},field:{status:'pending',updated:null,entries:[]},
      know:know(E,c,number),kauri:isKauri(c),release63:!!summary.release63,lines:[],provenance:[]};
    rec.maximaBlocked=maximaBlocked(c);
    Object.defineProperty(rec,'_ctx',{value:c,enumerable:false,writable:true});
    Object.defineProperty(rec,'_env',{value:E,enumerable:false,writable:true,configurable:true});
    Object.defineProperty(rec,'summary',{value:summary,enumerable:false,writable:true});
    // What a page last gave extras() (the outline, the crown spread), so refresh() draws the measures again with them.
    Object.defineProperty(rec,'_extras',{value:null,enumerable:false,writable:true});
    if(record){
      // The crown's own measures first; extras() adds the dripline radius (equal-area until a page has the outline) and,
      // for a scheduled tree, the protected root zone, so every surface that shows the record has them.
      rec.measures=measures(E,c);rec.measureOrder=Object.keys(rec.measures);extras(rec);rec.lines=releaseLines(E,c);
      rec.records=records(E,c);rec.moreRecords=Math.max(0,(memberCount??members.length)-members.length);
      rec.bySource=bySource(E,c);rec.outline=outline(E,c);rec.lidar=lidar(E,c);rec.species=species(E,c);
      rec.surveys=surveys(E,c);rec.surveyChange=surveyChange(E,c);rec.setting=setting(E,c);rec.benefits=benefits(E,c);rec.lifeStage=lifeStage(E,c);rec.replacement=replacement(E,c);rec.roots=roots(E,c);
      rec.history={status:'ready',source:'record',releases:historyFromRecord(E,c),lineage:null,note:null};
      rec.corrections={status:'pending',items:reviewsFromRecord(E,c),receipt:null};
    }
    rec.provenance=collectProvenance(rec);
    return rec;
  }
  function collectProvenance(rec){
    const out=[],seen=new Set();
    const add=x=>{if(x?.provenance&&!seen.has(x.provenance.id)){seen.add(x.provenance.id);out.push(x.provenance);}};
    for(const k of rec.measureOrder)add(rec.measures[k]);
    for(const x of rec.field?.entries||[])add(x);
    for(const x of rec.lidar?.measurements||[])add(x);
    for(const s of rec.surveys||[])add(s.height);
    add(rec.surveyChange);
    for(const k of ['water','heat','surface','neighbourhood'])add(rec.setting?.[k]);
    for(const col of rec.bySource?.columns||[])add(col);
    add(rec.roots);
    for(const k of ['context','scenario','nearby'])add(rec[k]);
    add(rec.place?.board);add(rec.place?.parcel);
    return out;
  }
  function fromTile(props,env={}){return assemble({id:props?.tree_id,record:null,props,env});}
  // The parts that read the trunk diameter, again, when a ground measurement arrives: the key measurements (with the
  // outline and spread a page last gave extras()), the measurements by source and root space.
  function refresh(rec,E){
    const c=rec._ctx;
    rec.measures=measures(E,c);rec.measureOrder=Object.keys(rec.measures);extras(rec,rec._extras||{});rec.bySource=bySource(E,c);rec.roots=roots(E,c);rec.provenance=collectProvenance(rec);
    return rec;
  }
  // A reviewed KYTE ground visit (measured trunk, KYTE measurement column).
  function setLive(rec,live,env={}){
    const c=rec._ctx;if(!c||!c.record)return rec;
    c.live=live;return refresh(rec,envOf(env,env.metadata||null));
  }

  // ---------- network ----------
  async function getJSON(url,{optional=false,init=null}={}){
    const fx=root.fetch;if(!fx)throw new Error('fetch unavailable');
    const res=await (init?fx(url,init):fx(url));
    if(!res.ok){if(optional&&(res.status===404||res.status===403))return null;throw new Error(`${url}: ${res.status}`);}
    let bytes=new Uint8Array(await res.arrayBuffer());
    if(bytes[0]===31&&bytes[1]===139&&root.DecompressionStream){
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes=new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const cache=new Map();
  function cached(url,opts){if(!cache.has(url)){cache.set(url,getJSON(url,opts).catch(e=>{cache.delete(url);throw e;}));if(cache.size>60)cache.delete(cache.keys().next().value);}return cache.get(url);}
  // A derived product: listed in release-metadata.json "derived_products" (path from the site root), or
  // in the manifest of this tool's derived folder for the release (<derivedBase>/manifest.json), so a
  // page asks only for files that exist. Every derived file states the release it was built for.
  const DERIVED={comparisons:{key:'tree_context'},history:{key:'tree_history'},points:{key:'tree_points'},corrections:{key:'corrections_applied'},
    inat:{key:'tree_inat'},streetview:{key:'tree_streetview'}};
  const pathOf=x=>String(typeof x==='string'?x:x?.path||'').replace(/^\.?\//,'');
  async function manifest(env){
    try{return await cached(`${env.derivedBase}/manifest.json?v=${encodeURIComponent(env.derivedVersion||env.version)}`,{optional:true});}catch{return null;}
  }
  async function derivedUrls(env,name){
    const key=DERIVED[name].key,out=[];
    const listed=env.metadata?.derived_products?.[key];
    if(listed)out.push(`${env.siteRoot}/${pathOf(listed)}`);
    const mf=await manifest(env),own=mf?.products?.[key];
    if(own)out.push(`${env.derivedBase}/${pathOf(own)}`);
    return [...new Set(out)];
  }
  async function derived(env,name){
    for(const url of await derivedUrls(env,name)){
      let j=null;try{j=await cached(`${url}?v=${encodeURIComponent(env.derivedVersion||env.version)}`,{optional:true});}catch{j=null;}
      if(j)return {url,base:url.replace(/[^/]*$/,''),json:j,matches:!j.release||!env.datasetVersion||j.release===env.datasetVersion};
    }
    return null;
  }

  // Percentile of a value in a distribution published as quantiles q at probabilities p (0–100):
  // the share of the group below the value, ties split evenly.
  function percentile(value,q,p){
    const v=num(value);if(v===null||!Array.isArray(q)||!q.length)return null;
    if(v<q[0])return 0;if(v>q[q.length-1])return 100;
    let lo=q.findIndex(x=>x>=v),hi=-1;for(let i=q.length-1;i>=0;i--)if(q[i]<=v){hi=i;break;}
    if(lo<=hi)return (p[lo]+p[hi])/2;
    const a=hi,b=lo,f=(v-q[a])/(q[b]-q[a]||1);return p[a]+f*(p[b]-p[a]);
  }
  // Exact rank in a small group published as its sorted values.
  function exact(value,values){
    const v=num(value);if(v===null||!Array.isArray(values)||!values.length)return null;
    let below=0,equal=0,above=0;for(const x of values){if(x<v)below++;else if(x===v)equal++;else above++;}
    return {percentile:(below+equal/2)/values.length*100,rank:above+1,of:values.length};
  }
  // Wording for a rank: [comparison for a share, superlative for an exact rank].
  const METRIC_TEXT={height:['Taller than','tallest'],crownArea:['Larger crown than','largest crown'],benefits:['Higher estimated benefits than','highest estimated benefits']};
  const METRIC_NAME={height:'Height',crownArea:'Crown area',benefits:'Estimated benefits'};
  function rankEntry(metric,value,group,probs,unit,decimals=null){
    if(value===null||value===undefined||!group)return null;
    // Compare at the precision the file publishes, so a tree meets its own published value.
    const v=decimals===null?value:Math.round(value*10**decimals)/10**decimals;
    const vals=group.values?.[metric],qs=group.q?.[metric];
    const ex=vals?exact(v,vals):null,pc=ex?ex.percentile:qs&&qs.length?percentile(v,qs,group.p||probs):null;
    if(pc===null)return null;
    const [cmp,sup]=METRIC_TEXT[metric]||['Above',''];
    // Shares are rounded down, so a percentile is never overstated.
    const share=Math.max(0,Math.min(100,Math.floor(pc)));
    const text=ex?(ex.rank===1&&ex.of>1?`${cap(sup)} of ${nf(ex.of)}`:`${ordinal(ex.rank)} ${sup} of ${nf(ex.of)}`):
      pc>=99.5?'Top 0.5%':pc>=99?'Top 1%':`${cmp} ${nf(share)}%`;
    // The same rank as a clause that keeps its measure, for a sentence that joins several ("crown area in the top 0.5%").
    const clause=!ex&&pc>=99?`${METRIC_NAME[metric]||metric} in the ${pc>=99.5?'top 0.5%':'top 1%'}`:text;
    // The distribution itself, for a strip: the group's sorted values (small groups) or its quantiles.
    const distribution=vals?{kind:'values',values:vals.slice()}:{kind:'quantiles',quantiles:qs.slice(),probabilities:(group.p||probs||[]).slice()};
    return {metric,value,unit,percentile:pc,share,rank:ex?.rank??null,of:ex?.of??null,exact:!!ex,text,clause,distribution};
  }
  const ordinal=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};
  const IRR_ORDER=['low','moderate','high','very_high','effectively_irreplaceable'];
  function irrEntry(key,group){
    const counts=group?.irr;if(!key||!counts)return null;
    const n=IRR_ORDER.reduce((s,k)=>s+(counts[k]||0),0);if(!n)return null;
    const i=IRR_ORDER.indexOf(key),atOrAbove=IRR_ORDER.slice(Math.max(0,i)).reduce((s,k)=>s+(counts[k]||0),0);
    return {key,inClass:counts[key]||0,shareInClass:(counts[key]||0)/n*100,shareAtOrAbove:atOrAbove/n*100,n,counts};
  }
  // Release 6.3: the share of the group's classed crowns in this crown replacement band or a longer one (group.bands), and
  // in this height class or a larger one (group.height_class); comparisons.json counts both per group.
  const BAND_ORDER=['under_5y','5_15y','15_40y','40_80y','80y_plus'];
  const HEIGHT_ORDER=['very_small','small','medium','large','very_large'];
  function countEntry(key,counts,order){
    if(!key||!counts||!order.includes(key))return null;
    const n=order.reduce((s,k)=>s+(counts[k]||0),0);if(!n)return null;
    const i=order.indexOf(key),atOrAbove=order.slice(i).reduce((s,k)=>s+(counts[k]||0),0);
    return {key,inClass:counts[key]||0,shareInClass:(counts[key]||0)/n*100,shareAtOrAbove:atOrAbove/n*100,n,counts};
  }
  const bandEntry=(key,group)=>{const e=countEntry(key,group?.bands,BAND_ORDER);return e?{...e,band:true}:null;};
  const heightClassEntry=(key,group)=>countEntry(key,group?.height_class,HEIGHT_ORDER);
  const MIN_STREET_N=10;
  // Where this tree sits among comparable crowns (same tree class) on its street, in its local board and
  // across Auckland, from the release's published distributions.
  async function context(rec,env){
    const c=rec._ctx,s=rec.summary;
    if(!c?.record)return {status:'none',scopes:[]};
    const v=c.record.datasets.services||{},rep=(c.members||[]).find(r=>r.tree_id===rec.identity.crownRepresentative);
    const klass=c.record.datasets.size?.class_used||v.species_class||rep?.datasets?.size?.class_used||rep?.datasets?.services?.species_class||null;
    const d=await derived(env,'comparisons');
    if(!d)return {status:'not_published',scopes:[],note:'No comparison tables for this release.'};
    const j=d.json;
    if(!d.matches)return {status:'release_mismatch',scopes:[],builtFor:j.release,note:`Comparison tables were built for ${j.release_label||j.release}.`};
    // Release 6.3: a crown that is not classed (under 5 m, height not plausible, no estimate) is not compared.
    const nc=s.replacement?.release63?s.replacement.notClassed:null;
    if(nc)return {status:'not_classed',scopes:[],reason:nc,note:`Not classed: ${nc.label}. Crowns that are not classed are not compared.`};
    if(!klass||!j.classes?.[klass])return {status:'no_class',scopes:[],note:'No tree class for comparison: this record has no crown estimate.'};
    // A crown 55 m or taller is not ranked: its height may be a power line, a structure or noise.
    if(!s.release63&&isTall(s.size.height))return {status:'excluded',scopes:[],note:`Not compared: ${nf(s.size.height,1)} m is ${TALL_TEXT.replace(/; not used in rankings$/,'')}.`};
    // Release 6.3: a crown whose height or record link is flagged is left out of comparisons (size.in_comparisons 0).
    const ex=c.record.datasets.size?.comparisons_excluded_by||rep?.datasets?.size?.comparisons_excluded_by||null,chk=checksOf(c);
    if(s.release63&&(ex||chk.height||chk.links.length)){const why=[chk.height||/height_check/.test(ex||'')?(chk.height?.label||'Height to check').toLowerCase():null,chk.links.length||/link_check/.test(ex||'')?'record and crown to check':null].filter(Boolean);
      return {status:'excluded',scopes:[],note:`Not compared: ${why.join('; ')||String(ex).replace(/_/g,' ')} (left out of comparisons and Species maxima).`};}
    const repB=rep?.datasets?.benefits?num(rep.datasets.benefits.benefit_value_nzd_y):num(rep?.datasets?.services?.total_value_nzd_y);
    const vals={height:s.size.height,crownArea:s.size.area,benefits:s.benefits.total??repB};
    const units={height:'m',crownArea:'m²',benefits:'NZ$/yr'};
    const probs=j.probabilities;
    // Release 6.3: the crown replacement band among the group's bands (comparisons.json bands); release 6.2: the
    // irreplaceability class among its classes (irr).
    const v63=!!s.replacement?.release63;
    const irrKey=v63?s.replacement.band?.key||null:c.record.datasets.assets?.irreplaceability_class||rep?.datasets?.assets?.irreplaceability_class||null;
    const scopeOf=(scope,name,group,definition)=>group?{scope,name,status:'ready',definition,n:group.n,
      metrics:Object.fromEntries(Object.keys(vals).map(k=>[k,rankEntry(k,vals[k],group,probs,units[k],j.metrics?.[k]?.decimals??null)]).filter(([,x])=>x)),
      irreplaceability:v63?bandEntry(irrKey,group):irrEntry(irrKey,group),heightClass:v63?heightClassEntry(s.lifeStage?.key||null,group):null}:null;
    // A class the benefit build assumed (no growth form determined) is said as an assumption.
    const assumed=/default/.test(String(v.species_class_source||''))||num(v.growth_form_default)===1;
    const out={status:'ready',release:j.release,generated:dated(j.generated_utc),class:{key:klass,label:j.classes[klass],source:'Tree class used for the benefit estimates',assumed},
      provenance:prov(env,'context',{label:'Among similar trees',kind:'derived',source:`ALTO comparison tables built for this release${j.streets?'; OpenStreetMap address points (ODbL)':''}`,
        date:dated(j.generated_utc,'built '),method:{id:'build_tree_context',text:'Quantiles of each measure per tree class, across Auckland and per local board; street groups by nearest address point',href:REPO+'pipeline/tool/build_tree_context.py',doc:REPO+'docs/tool/tree-record.md'},
        dataset:'tree_context',note:j.population?.description||null}),
      population:j.population?.description||null,populationShort:j.population?.short||null,metrics:j.metrics||null,scopes:[],
      self:{inPopulation:!!v.species_class,basis:rec.identity.crownRepresentative&&rec.identity.crownRepresentative!==rec.id?'This record’s crown, whose estimates are held by its map marker':'This crown'}};
    // Street: the trees whose nearest address point is on the same street (published per map cell).
    let street=null;
    if(j.streets&&s.position){
      try{street=await streetGroup(env,d.base,j.streets,s.position,klass);}catch{street={status:'unavailable'};}
    }
    // A street group is compared only from MIN_STREET_N trees of the class: "Tallest of 2" says nothing.
    if(street?.group&&num(street.group.n)>=MIN_STREET_N)out.scopes.push({...scopeOf('street',street.name,street.group,street.definition),distance:street.distance??null,board:street.board||null});
    else if(street?.group)out.scopes.push({scope:'street',status:'small',name:street.name,definition:street.definition,n:street.group.n,minN:MIN_STREET_N,metrics:{},irreplaceability:null,distance:street.distance??null,board:street.board||null});
    else out.scopes.push({scope:'street',status:street?.status||(j.streets?'none':'not_published'),name:street?.name||null,definition:street?.definition||null,n:street?.n??null,metrics:{},irreplaceability:null});
    // Local board, from the same polygons the tables were built with.
    let board=null;
    try{board=s.position&&dep('ALTOGround')?await dep('ALTOGround').board(s.position.lon,s.position.lat):null;}catch{board=null;}
    const bg=board?j.boards?.[board.board_name]?.[klass]:null;
    out.scopes.push(bg?scopeOf('board',board.board_name,bg,`${j.classes[klass]} crowns in ${board.board_name} local board`):
      {scope:'board',status:board?'none':'unavailable',name:board?.board_name||null,definition:null,n:0,metrics:{},irreplaceability:null});
    const ag=j.auckland?.[klass];
    if(ag)out.scopes.push(scopeOf('auckland','Auckland',ag,`${j.classes[klass]} crowns across the mapped Auckland area`));
    return out;
  }
  // Web-mercator tile of a point, for the street cells.
  function tileOf(lon,lat,z){const n=2**z,x=Math.floor((lon+180)/360*n),r=lat*Math.PI/180,y=Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);return {z,x,y};}
  async function streetGroup(env,base,spec,pos,klass){
    const t=tileOf(pos.lon,pos.lat,spec.zoom||14),v=`?v=${encodeURIComponent(env.derivedVersion||env.version)}`;
    const fill=(path,o)=>String(path).replace(/\{(\w+)\}/g,(_,k)=>o[k]);
    const cell=await cached(`${base}${fill(spec.cell_path||'streets/cells/{z}/{x}/{y}.json',t)}${v}`,{optional:true});
    const max=spec.max_distance_m||60;
    if(!cell)return {status:'none',definition:`No address point within ${max} m`};
    const kx=Math.cos(pos.lat*Math.PI/180)*111320,ky=110540;
    let best=null;
    for(const a of cell.addresses||[]){const dd=Math.hypot((a[0]-pos.lon)*kx,(a[1]-pos.lat)*ky);if(dd<=max&&(!best||dd<best.d))best={d:dd,street:a[2]};}
    if(!best)return {status:'none',definition:`No address point within ${max} m`};
    let st=cell.streets?.[best.street]||null;
    if(!st&&spec.street_path){
      const n=spec.shards||256,w=Math.max(1,Math.ceil(Math.log(n)/Math.log(16)));
      const shard=await cached(`${base}${fill(spec.street_path,{shard:(best.street%n).toString(16).padStart(w,'0')})}${v}`,{optional:true});
      st=shard?.[String(best.street)]||null;
    }
    if(!st)return {status:'none',definition:null};
    const definition=`Trees whose nearest address point (OpenStreetMap) is on ${st.name}${st.board?`, ${st.board}`:''}, within ${max} m`;
    const group=st.groups?.[klass]||null;
    return {status:group?'ready':'none',name:st.name,board:st.board||null,definition,group,n:group?.n??0,distance:best.d};
  }

  // History: the published per-tree ID lineage (what each release changed about this ID), merged into
  // the release rows the record already gives.
  async function history(rec,env){
    const base=rec.history&&rec.history.releases?rec.history:{status:'ready',source:'record',releases:[]};
    const d=await derived(env,'history');
    if(!d)return {...base,lineage:null,lineageStatus:'not_published'};
    if(!d.matches)return {...base,lineage:null,lineageStatus:'release_mismatch'};
    const idx=d.json,shard=fnvShard(rec.id,idx.shards||4096);
    let entry=null;
    try{const j=await cached(`${d.base}${String(idx.path||'{shard}.json').replace('{shard}',shard)}?v=${encodeURIComponent(env.derivedVersion||env.version)}`,{optional:true});entry=j?.[rec.id]||null;}catch{entry=null;}
    const rows=(base.releases||[]).map(r=>({...r,events:[...(r.events||[])]}));
    for(const e of entry||[]){
      let row=rows.find(r=>r.release===e.release);
      if(!row){row={release:e.release,date:relDate(e.release),crown:null,role:null,evidence:null,events:[],current:e.release===env.releaseLabel};rows.push(row);}
      row.noChange=false;
      row.events.push({kind:'id',change:e.change,text:`${cap(relWords(idx.changes?.[e.change]||words(e.change)))}${num(e.moved_m)?`; its position on the map moved ${nf(e.moved_m,1)} m`:''}`});
    }
    completeRows(rows,env.releaseLabel);
    return {...base,releases:rows,lineage:entry,lineageStatus:entry?'ready':'none',lineageReleases:idx.releases||null,lineageSource:idx.source||null};
  }
  // A derived product sharded by tree number (FNV-1a mod its shard count): this tree's entry, or why there is none.
  async function byNumber(env,name,key){
    if(!key)return {status:'none'};
    const d=await derived(env,name);
    if(!d)return {status:'not_published'};
    if(!d.matches)return {status:'release_mismatch'};
    const idx=d.json,shard=fnvShard(key,idx.shards||256);
    try{const j=await cached(`${d.base}${String(idx.path||'{shard}.json').replace('{shard}',shard)}?v=${encodeURIComponent(env.derivedVersion||env.version)}`,{optional:true});
      if(!j)return {status:'unavailable',index:idx};
      return j[key]?{status:'ready',entry:j[key],index:idx}:{status:'none',index:idx};}
    catch{return {status:'unavailable',index:idx};}
  }
  // iNaturalist records matched to this tree by location (tree_inat). The record's licence decides what the page may
  // show: names and dates for CC BY (any variant without NC) and CC0, a link only for NC and all-rights-reserved records.
  const INAT_LICENCE={'cc-by':'CC BY','cc-by-sa':'CC BY-SA','cc-by-nd':'CC BY-ND','cc0':'CC0','cc-by-nc':'CC BY-NC','cc-by-nc-sa':'CC BY-NC-SA','cc-by-nc-nd':'CC BY-NC-ND'};
  const PHENOLOGY={f:'flowers',r:'fruits or seeds',b:'flower buds'};
  async function inat(rec,env){
    const r=await byNumber(env,'inat',rec.number);
    if(r.status!=='ready')return {status:r.status,records:[],source:r.index?.source||null};
    const e=r.entry;
    // No licence code (iNaturalist's "none", or empty) means all rights reserved.
    const records=(e.r||[]).map(([id,lic,month,where,metres,taxon,common,phen,login])=>{lic=lic&&lic!=='none'?lic:null;return {id,url:`https://www.inaturalist.org/observations/${id}`,
      licence:lic,licenceText:lic?INAT_LICENCE[lic]||String(lic).toUpperCase():'all rights reserved',facts:!!taxon,
      month:month||null,monthText:month?new Date(`${month}-15T00:00:00Z`).toLocaleDateString('en-NZ',{month:'short',year:'numeric',timeZone:'UTC'}).replace(/\bSept\b/,'Sep'):null,
      where:where==='c'?'inside this crown':where==='n'?`${metres} m from this crown`:`${metres} m from this tree’s map position`,
      taxon:taxon||null,common:common||null,phenology:(phen||'').split('').map(k=>PHENOLOGY[k]).filter(Boolean),login:login||null};});
    const pos=rec.summary?.position;
    return {status:'ready',count:e.n||records.length,records,source:r.index.source||null,fetched:r.index.source?.fetched||null,
      near:pos?`https://www.inaturalist.org/observations?lat=${pos.lat.toFixed(5)}&lng=${pos.lon.toFixed(5)}&radius=0.05&taxon_id=47126`:null};
  }
  // One street-level photograph of this tree on Mapillary (tree_streetview), chosen ahead of time: the newest
  // photograph taken 6–25 m away facing the tree, else the newest 360° photograph within 20 m.
  async function streetview(rec,env){
    const r=await byNumber(env,'streetview',rec.number);
    if(r.status!=='ready')return {status:r.status};
    // A perspective choice may carry a 360° photograph taken at least two years later as a second option.
    const [id,date,kind,metres,offset,panoId,panoDate,panoMetres]=r.entry,idx=r.index;
    const href=x=>String(idx.link||'https://www.mapillary.com/app/?pKey={id}&focus=photo').replace('{id}',encodeURIComponent(String(x)));
    return {status:'ready',id:String(id),url:href(id),date:date?dated(date):null,pano:kind==='360',metres:num(metres),offset:num(offset),
      newer:panoId?{id:String(panoId),url:href(panoId),date:panoDate?dated(panoDate):null,metres:num(panoMetres)}:null,
      licence:idx.licence||'Mapillary contributors, CC BY-SA 4.0',queried:idx.source?.queried||null};
  }
  // Field measurements (above): the file is read once a page load and shared by every tree, revalidated with the server
  // (no cache stamp: it changes without a tool or data release). {status: ready|not_published|unavailable, updated, trees}
  let fieldRead=null,fieldNow=null;
  function fieldFile(env){
    if(!fieldRead)fieldRead=getJSON(`${env.siteRoot||'.'}/${FIELD_PATH}`,{optional:true,init:{cache:'no-cache'}})
      .then(j=>!j?{status:'not_published'}:j.version!==FIELD_VERSION||!j.trees||typeof j.trees!=='object'?{status:'not_published',version:j.version??null}:
        {status:'ready',updated:dated(isoDay(j.updated)),trees:j.trees},()=>({status:'unavailable'}))
      .then(f=>(fieldNow=f));
    return fieldRead;
  }
  // The newest trunk-diameter entry for a tree number once the file is read (for pages that hold no tree record), else null.
  const fieldTrunk=number=>fieldNow?.status==='ready'&&own(fieldNow.trees,number)?fieldEntries(fieldNow.trees[number])[0]||null:null;
  // This tree's entries as measured Quantities (field1, field2…, the newest first); a tree with one is measured from then on
  // (trunk(): after a reviewed KYTE tape reading, before the models). A tree without one is left as it was.
  async function field(rec,env){
    const f=await fieldFile(env);
    if(f.status!=='ready')return {status:f.status,updated:null,entries:[]};
    const list=own(f.trees,rec.number)?fieldEntries(f.trees[rec.number]):[];
    if(!list.length)return {status:'none',updated:f.updated,entries:[]};
    const c=rec._ctx;if(c?.record){c.field=list;refresh(rec,env);}
    return {status:'ready',updated:f.updated,entries:list.map((e,i)=>fieldQ(env,`field${i+1}`,e))};
  }
  function fnv(id){let h=2166136261;for(const b of new TextEncoder().encode(id))h=Math.imul(h^b,16777619)>>>0;return h;}
  function fnvShard(id,n){const w=Math.max(1,Math.ceil(Math.log(n)/Math.log(16)));return (fnv(id)%n).toString(16).padStart(w,'0');}

  // Human reviews and corrections: those held on the record, plus the release's receipt of applied
  // corrections (corrections-applied.json) when it ships one.
  // The receipt follows the corrections ledger (alto-corrections/1): each item names its subject and
  // object as tree IDs, crowns ({seg_key, anchor_tree_id}), observations ({filed_under_tree_id}) or
  // external records. An item belongs to this tree when any tree ID in it is this tree or one of its
  // crown's records, or any crown key in it is this crown.
  function refs(x,ids=new Set(),keys=new Set(),depth=0){
    if(depth>6||x===null||x===undefined)return {ids,keys};
    if(typeof x==='string'){if(/^akl_tree_[A-Za-z0-9_]+$/.test(x))ids.add(x);return {ids,keys};}
    if(Array.isArray(x)){for(const v of x)refs(v,ids,keys,depth+1);return {ids,keys};}
    if(typeof x==='object')for(const [k,v] of Object.entries(x)){
      if((k==='seg_key'||k==='old_seg_key'||k==='new_seg_key')&&typeof v==='string')keys.add(v);
      else if(k==='seg_keys'&&Array.isArray(v))v.forEach(z=>keys.add(z));
      else if(!['summary','note','reason','evidence'].includes(k))refs(v,ids,keys,depth+1);
    }
    return {ids,keys};
  }
  function receiptItems(j,rec){
    const mine=new Set([rec.id,rec.identity.crownRepresentative,...(rec.records||[]).map(r=>r.treeId)].filter(Boolean));
    const seg=rec.outline?.crownKey||null;
    const list=Array.isArray(j)?j:j.corrections||j.applied||j.items||j.decisions||[];
    return list.filter(x=>{const r=refs(x);return [...r.ids].some(i=>mine.has(i))||(seg&&r.keys.has(seg));})
      .map(x=>({id:x.id||x.decision_id||null,kind:words(x.type||x.kind),basis:'ledger',date:dated(x.decided_on||x.date||x.decided_utc),
        summary:x.public_summary||x.summary||x.subject_text||(typeof x.subject==='string'?x.subject:null)||x.note||null,
        summaryAsRecorded:x.public_summary&&x.summary&&x.public_summary!==x.summary?x.summary:null,by:x.reviewer||x.by||null,
        status:words(x.status||'accepted'),outcome:words(x.outcome||x.result||null),reason:x.reason||null,evidence:evidenceList(x.evidence),
        appliedIn:x.applied_in||x.releases||(j.release_label?[j.release_label]:[])})).map(withRegister);
  }
  // A decision's evidence as a list ("a; b" in a record, a list in the receipt).
  const evidenceList=e=>(Array.isArray(e)?e:typeof e==='string'?e.split(/;\s*/):[]).map(x=>String(x).trim()).filter(Boolean);
  // One entry per review: a field observation the record holds and a ledger decision that cites it as evidence
  // (e.g. "tree_field_observation_v5:<observation id>") are the same review, so the observation is folded
  // into the decision (as basedOn) instead of being listed again.
  function mergeObservations(list){
    const cites=new Map();
    for(const x of list)for(const e of x.evidence||[]){const id=e.split(':').pop();if(id&&!cites.has(id))cites.set(id,x);}
    const out=[];
    for(const x of list){
      const by=x.ref?cites.get(x.ref):null;
      if(by&&by!==x){by.basedOn=[...(by.basedOn||[]),{kind:x.kind,ref:x.ref,date:x.date,summary:x.summary}];continue;}
      out.push(x);
    }
    return out;
  }
  async function corrections(rec,env){
    const own=(rec.corrections?.items||[]).filter(x=>x.basis==='record');
    const d=await derived(env,'corrections');
    if(!d){const items=mergeObservations(own.map(x=>({...x})));return {status:items.length?'ready':'none',items,receipt:null,receiptStatus:'not_published'};}
    const items=receiptItems(d.json,rec),seen=new Set(items.map(x=>x.id).filter(Boolean));
    const all=mergeObservations([...items,...own.filter(x=>!x.id||!seen.has(x.id)).map(x=>({...x}))]);
    return {status:all.length?'ready':'none',items:all,receipt:{release:d.json.release||null,generated:dated(d.json.generated_utc||d.json.created_utc),ledger:d.json.ledger||null,matches:d.matches,url:d.url},
      receiptStatus:d.matches?'ready':'release_mismatch'};
  }

  // LiDAR points: per-tree point crops, where this release publishes them.
  async function points(rec,env){
    const d=await derived(env,'points');
    if(!d)return {status:'not_published',format:null,href:null,n:null,bytes:null,note:'Point crops are not published for this release.'};
    if(!d.matches)return {status:'release_mismatch',format:null,href:null,n:null,bytes:null,note:null};
    const idx=d.json,crown=rec.outline?.crownKey||null,key=idx.key==='seg_key'?crown:rec.id;
    let e=idx.trees?.[key]||idx.trees?.[rec.identity.crownRepresentative]||null;
    if(!e&&idx.shards){try{const j=await cached(`${d.base}${String(idx.shard_path).replace('{shard}',fnvShard(rec.identity.crownRepresentative||rec.id,idx.shards))}?v=${encodeURIComponent(env.derivedVersion||env.version)}`,{optional:true});e=j?.[rec.identity.crownRepresentative||rec.id]||null;}catch{e=null;}}
    if(!e)return {status:'not_in_subset',format:idx.format||null,href:null,n:null,bytes:null,note:idx.subset||null};
    const id=rec.identity.crownRepresentative||rec.id,file=e.file||e.path||String(idx.file_path||'p/{shard}/{id}.bin').replace('{shard}',fnvShard(id,idx.shards||256)).replace('{id}',id);
    return {status:'ready',format:idx.format||null,href:`${d.base}${file}`,n:e.n??null,of:e.of??null,bytes:e.bytes??null,note:idx.subset||null,
      source:idx.source||SOURCE.lidar2024,crs:idx.crs||null,quantum:idx.quantum||null,origin:e.origin||null,ground:e.ground??null,top:e.top??null,maxPoints:idx.max_points||null};
  }
  // alto-points/1: 16-byte header ("ALP1", uint32 n, float32 quantum, uint32 0), then int16 x, y, z
  // (offsets from the crown top and the ground under the crown), uint8 class, returns, intensity.
  function decodePoints(buffer){
    const v=new DataView(buffer);
    if(v.byteLength<16||String.fromCharCode(v.getUint8(0),v.getUint8(1),v.getUint8(2),v.getUint8(3))!=='ALP1')throw new Error('Not an alto-points/1 file');
    const n=v.getUint32(4,true),qn=v.getFloat32(8,true),need=16+n*9;
    if(v.byteLength<need)throw new Error('Truncated point file');
    const i16=o=>{const a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=v.getInt16(o+i*2,true)*qn;return a;};
    const x=i16(16),y=i16(16+2*n),z=i16(16+4*n),o=16+6*n;
    return {n,quantum:qn,x,y,z,classification:new Uint8Array(buffer.slice(o,o+n)),returns:new Uint8Array(buffer.slice(o+n,o+2*n)),intensity:new Uint8Array(buffer.slice(o+2*n,o+3*n))};
  }
  async function loadPoints(rec){
    const p=rec.lidar?.points;if(p?.status!=='ready')throw new Error('No point crop for this tree');
    const res=await root.fetch(p.href);if(!res.ok)throw new Error(`Point crop request failed (${res.status})`);
    return {...decodePoints(await res.arrayBuffer()),meta:p};
  }

  // Imagery: the capture behind the current aerial tiles (Esri metadata), and the aerial surveys of Auckland since
  // 2010 that a page can read at this tree from LINZ's open imagery archive (tree-imagery.js reads the pixels).
  async function imagery(rec,env){
    const pos=rec.summary.position;
    if(!pos)return {status:'none'};
    const V=dep('ALTOViz'),X=dep('ALTOImagery');
    const current=V?.imageryInfo?await V.imageryInfo(pos.lon,pos.lat).catch(()=>null):null;
    const surveys=X?{status:'available',provider:X.HOST,archive:X.ARCHIVE,catalogue:X.CATALOGUE,licence:X.LICENCE.name,
      surveys:X.SURVEYS.map(s=>({id:s.id,label:s.label,kind:s.kind,gsd:s.gsd,start:s.start,end:s.end,title:s.title,licensors:s.licensors,collection:s.collection}))}:{status:'not_available',surveys:[]};
    return {status:'ready',current:current?{source:current.source,date:current.date,resolution:current.resolution,provider:'Esri World Imagery'}:null,surveys};
  }

  // Place: local board now; land type and parcel come from the map (fromMap).
  async function place(rec,env){
    const pos=rec.summary.position;if(!pos)return {status:'none'};
    let b=null;try{b=dep('ALTOGround')?await dep('ALTOGround').board(pos.lon,pos.lat):null;}catch{return {...rec.place,status:'unavailable'};}
    return {...(rec.place||{}),status:'ready',board:b?{name:b.board_name,canopyCover:num(b.canopy_cover_pct),canopyCoverBasis:'Earlier board-level assessment',
        provenance:prov(env,'board',{label:'Local board',kind:'recorded',source:'Stats NZ Territorial Authority Local Board 2026 boundaries (Stats NZ – Tatauranga Aotearoa, CC BY 4.0; simplified copy in data/local_boards.json)',
          method:{id:null,text:'Board whose boundary contains the recorded position',href:null},note:'Canopy cover: earlier board-level assessment (docs/validation/canopy_cover_by_board.md)'})}:null,
      outsideBoards:!b};
  }
  async function photos(rec,env){
    const Gr=dep('ALTOGround');if(!Gr)return {status:'unavailable',visits:[]};
    try{const d=await Gr.load(rec.id);const visits=d?.visits||[];const lead=Gr.lead(d);
      return {status:visits.length?'ready':'none',visits,raw:d,lead:lead&&lead.score>=.3?{name:lead.name,common:lead.common||null,score:lead.score,organ:lead.organ,source:'Pl@ntNet photo identification'}:null,live:Gr.live(d,rec._ctx?.record)};}
    catch{return {status:'unavailable',visits:[]};}
  }
  // Height scenario to 2040 (tree-future.js must be loaded; the page loads it on demand).
  async function scenario(rec,env){
    const F=dep('ALTOFuture');if(!F)return {status:'unavailable',note:'Scenario model not loaded.'};
    const model=await F.load(env.dataBase,env.version),prepared=await F.prepare(rec._ctx.record,model,env.dataBase,env.version);
    rec._ctx.futureModel=model;rec._ctx.prepared=prepared;
    const p=F.project(prepared,model);
    if(p.unavailable)return {status:'none',note:p.unavailable};
    return {status:'ready',kind:'scenario',provenance:prov(env,'scenario',{label:'Height scenario',kind:'model',source:`${SOURCE.alto} (longitudinal)`,
        method:{id:p.model_id||null,text:'Height cohort growth rate with this tree’s 2013–2024 trend and nearby trees where available; band from hindcast errors',href:REPO+'docs/methods/growth_change.md',doc:REPO+'docs/methods/growth_change.md'},
        model:modelOf(env,'forecast',p.model_id||null),dataset:'longitudinal'}),anchor:{year:2024,height:p.anchor_height_m},points:p.points.map(x=>({year:x.year,height:x.height_m,low:x.low_m,high:x.high_m})),
      rate:p.annual_change_m,personalRate:p.personal_rate??null,neighbourWeight:p.neighbour_weight||null,model:{id:p.model_id||null,validation:modelOf(env,'forecast',null)?.validation||null},
      basis:'Height cohort rate'+(p.personal_rate!==null&&p.personal_rate!==undefined?', this tree’s 2013–2024 trend':'')+(p.neighbour_weight?', nearby trees':'')+'; band from hindcast errors'};
  }
  // The parcel under the recorded position (the map finds its id; the property record is published).
  async function parcel(rec,env,pid){
    const Pr=dep('ALTOProperty');if(!pid){rec.place={...(rec.place||{}),parcel:{status:'none',note:'Recorded position outside LINZ parcels (road corridor or foreshore)'}};return rec.place.parcel;}
    let out;
    try{const {record}=await Pr.load(env.dataBase,env.version,pid);const p=record?.property;
      out=p?{status:'ready',id:pid,provenance:prov(env,'parcel',{label:'Property parcel',kind:'derived',source:'LINZ primary parcels (CC BY 4.0); ALTO property summary for this release',
          method:{id:null,text:'Trees and canopy counted on the parcel; land type inferred from zoning and parcel records',href:REPO+'docs/methods/property_tenure.md',doc:REPO+'docs/methods/property_tenure.md'},dataset:'property_details'}),landType:p.tenure?{key:p.tenure,label:Pr.TENURE[p.tenure]||words(p.tenure)}:null,zone:p.zone||null,area:num(p.area_m2),canopy:num(p.canopy_m2),
        canopyCover:num(p.canopy_cover_pct),trees:num(p.n_trees)||0,benefits:dep('ALTOFields')?.benefitValue(p)??num(p.total_value_nzd_y),href:`${env.siteRoot}/?property=${encodeURIComponent(pid)}`}:{status:'none',id:pid,note:'No counted trees or canopy'};}
    catch{out={status:'unavailable',id:pid};}
    rec.place={...(rec.place||{}),parcel:out};rec.provenance=collectProvenance(rec);return out;
  }
  const inited=new WeakSet();
  const PARTS={context,history,corrections,points,imagery,place,photos,scenario,inat,streetview,field};
  async function enrich(rec,env={},{parts=Object.keys(PARTS).filter(p=>p!=='scenario'),onPart=null}={}){
    const E=envOf(env,env.metadata||rec._env?.metadata||null);
    const Gr=dep('ALTOGround');if(Gr?.init&&!inited.has(Gr)){inited.add(Gr);Gr.init({kyteBase:E.kyteBase,dataBase:E.dataBase,version:E.version});}
    const run=async name=>{
      let v;try{v=await PARTS[name](rec,E);}catch(e){v={status:'unavailable',error:String(e?.message||e)};}
      if(name==='points'){rec.lidar=rec.lidar||{measurements:[],profile:null};rec.lidar.points=v;}
      else if(name==='photos'){rec.photos=v;if(v.lead&&rec.species)rec.species.photoLead=v.lead;if(v.live)setLive(rec,v.live,E);}
      else rec[name]=v;
      if(name==='place')recite(rec);
      rec.provenance=collectProvenance(rec);
      if(onPart)try{onPart(name,rec);}catch(e){console.error(e);}
      return v;
    };
    await Promise.all(parts.filter(p=>PARTS[p]).map(run));
    return rec;
  }

  // Nearby trees and land type from a map: points are rendered features ({properties, geometry}).
  function fromMap(rec,{points=[],tileProps=null,parcel=null,radius=40}={}){
    const pos=rec.summary.position,T=dep('ALTOTreeSummary'),S=dep('ALTOSources'),Pr=dep('ALTOProperty');
    if(pos){
      const rep=rec.identity.crownRepresentative||rec.id,seen=new Set(),near=[];
      const k=Math.cos(pos.lat*Math.PI/180)*111320;
      for(const f of points){const p=f.properties||{};if(p.tree_id===rep||p.tree_id===rec.id||seen.has(p.tree_id)||p.display_role==='earlier_detection')continue;seen.add(p.tree_id);
        const [x,y]=f.geometry.coordinates,dd=Math.hypot((x-pos.lon)*k,(y-pos.lat)*110540);if(dd>radius)continue;
        const s=T.from(p,null);near.push({treeId:p.tree_id,title:s.name.title,nameKind:s.name.kind,protected:!!s.status.protected,source:S?.source(s.classification.primary)?.short||null,
          height:s.size.height,crownArea:s.size.area,distance:dd,href:dep('ALTOTreeId')?.url(p.tn||p.tree_id)||null});}
      near.sort((a,b)=>a.distance-b.distance);
      rec.nearby={status:near.length?'ready':'none',radius,trees:near,basis:'Map markers on the loaded map tiles',
        provenance:prov(rec._env||envOf({},null),'nearby',{label:'Nearby trees',kind:'derived',source:'ALTO map tiles for this release',method:{id:null,text:`Map markers within ${radius} m of the recorded position (straight-line distance)`,href:null}})};
    }
    const pl=rec.place||{};
    rec.place={...pl,status:pl.status==='pending'?'partial':pl.status,landType:tileProps?.tenure?{key:tileProps.tenure,label:Pr?.TENURE?.[tileProps.tenure]||words(tileProps.tenure),basis:'Inferred from zoning and parcel records'}:pl.landType||null,
      parcel:parcel||pl.parcel||null};
    rec.provenance=collectProvenance(rec);
    return rec;
  }

  // ---------- one call for a page ----------
  // members: how many of the crown's other records to read (0 for a quick panel; each is one bucket).
  // resolved: the page's own ALTOTreeId.resolve() of the input, when it has one (saves a second lookup).
  // later: true returns the tree before the crown's other records arrive (rec.membersPending); loadMembers(rec) reads them
  // and completes the record list (FE-03: the tree page shows the tree first).
  async function load(input,env={},{members:maxMembers=15,resolved:given=null,later=false}={}){
    const E=envOf(env,env.metadata||null),Id=dep('ALTOTreeId'),TD=dep('ALTOTreeDetails');
    const resolved=given||(Id?await Id.resolve(input,{base:E.dataBase,version:E.version,metadata:E.metadata}):{tree_id:input,canonical:input,status:'current',resolved_by:'input'});
    if(resolved.status==='unavailable'){const e=new Error(resolved.note||'Not loaded');e.code='unavailable';e.file=resolved.file||null;e.reason=resolved.reason||null;e.resolved=resolved;throw e;}
    if(!resolved.tree_id){const e=new Error(resolved.note||'Not a tree number or record ID');e.code='invalid';e.resolved=resolved;throw e;}
    let loaded;
    try{loaded=await TD.load(E.dataBase,E.version,resolved.tree_id);}
    catch(err){
      // A file that did not load is said as that, never as an absent tree.
      if(err?.unavailable){const e=new Error(err.message);e.code='unavailable';e.file=err.file;e.reason=err.reason;e.resolved=resolved;throw e;}
      const e=new Error(`No tree ${resolved.tree_id} in this release.`);e.code='not_found';e.resolved=resolved;throw e;}
    const {schema,record}=loaded;
    // The crown's other records; its map marker first (it holds the crown's estimates when this record does not).
    const repId=record.datasets.identity?.current_primary_tree_id;
    const ids=[...new Set([repId,...(parse(record.datasets.identity?.members_json)||[]).map(x=>x.tree_id)])].filter(x=>x&&x!==record.tree_id);
    if(later&&ids.length&&maxMembers>0){
      const rec=assemble({id:record.tree_id,record,schema,members:[],memberCount:ids.length,metadata:E.metadata,resolved,env:E});
      rec.membersPending=true;
      Object.defineProperty(rec,'_memberIds',{value:{ids,maxMembers},enumerable:false,writable:true,configurable:true});
      return rec;
    }
    const got=await Promise.allSettled(ids.slice(0,maxMembers).map(x=>TD.load(E.dataBase,E.version,x).then(r=>r.record)));
    const members=got.filter(x=>x.status==='fulfilled').map(x=>x.value);
    const rec=assemble({id:record.tree_id,record,schema,members,memberCount:ids.length,metadata:E.metadata,resolved,env:E});
    return rec;
  }
  // The crown's other records for a tree loaded with later: true: the record list and the count of records not read.
  async function loadMembers(rec){
    const c=rec?._ctx,E=rec?._env,TD=dep('ALTOTreeDetails'),m=rec?._memberIds;
    if(!c||!m||!TD){if(rec)rec.membersPending=false;return rec;}
    const got=await Promise.allSettled(m.ids.slice(0,m.maxMembers).map(x=>TD.load(E.dataBase,E.version,x).then(r=>r.record)));
    c.members=got.filter(x=>x.status==='fulfilled').map(x=>x.value);
    rec.records=records(E,c);rec.moreRecords=Math.max(0,m.ids.length-c.members.length);rec.membersPending=false;
    return rec;
  }
  // A plain copy for download or inspection (no internal fields).
  const toJSON=rec=>JSON.parse(JSON.stringify(rec));

  const api={SCHEMA,SOURCE,SURVEY_2024,METHODS,RELEASES,MIN_STREET_N,scheduleWords,otherRules,decodePoints,loadPoints,load,loadMembers,assemble,fromTile,enrich,fromMap,parcel:(rec,env,pid)=>parcel(rec,envOf(env,env.metadata||rec._env?.metadata||null),pid),setLive,toJSON,percentile,exact,tileOf,fnvShard,methodRef:(m,env={})=>methodRef(envOf(env),m),envOf,
    TALL_M,TALL_TEXT,HEIGHT_IMPLAUSIBLE_TEXT,HEIGHT_CHECK_TEXT,checksOf,releaseLines,maximaBlocked,MERGE_CAP_M2,NEAR_CAP_M2,NEAR_CAP_TEXT,SMALL_BIAS_TEXT,HEIGHT_DEF,NO_CHANGE_M,isTall,extras,modelOf:(env,component,id)=>modelOf(envOf(env),component,id),
    relWords,recite,problemHref,photoHref,KAURI_PHOTO,COORD_DP,coordText,mapLinks,location,nearLine,nztm,fromNztm,
    FIELD_PATH,fieldFile:(env={})=>fieldFile(envOf(env,env.metadata||null)),fieldTrunk,_internal:{receiptItems,historyFromRecord,completeRows,rankEntry,irrEntry,derivedUrls,trunk,rpaRadius,RPA_FACTOR,RPA_AREA_CAP_M2,rateClass,farthest,farthestFromTop,crownTop,nztm,inOutline,outlineCentre,clearCache:()=>cache.clear(),clearField:()=>{fieldRead=null;fieldNow=null;},fieldEntries,dayRange,trunkModels}};
  root.ALTOTreeRecord=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
