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
 *                                                        imagery, points, place, photos
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
  const num=v=>v===null||v===undefined||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
  const parse=v=>{try{return typeof v==='string'?JSON.parse(v):v;}catch{return null;}};
  const nf=(v,d=0)=>new Intl.NumberFormat('en-NZ',{maximumFractionDigits:d,minimumFractionDigits:0}).format(v);
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
  const SOURCE={
    lidar2024:'Auckland 2024 LiDAR survey (Woolpert for Auckland Council; published by LINZ)',
    aerial2024:'Auckland 2024–25 aerial imagery (LINZ)',
    lidarEarlier:'Auckland 2013 and 2016 LiDAR surveys (LINZ)',
    impervious:'Auckland Council impervious surfaces, 2017',
    schedule:'Auckland Unitary Plan, Schedule 10 Notable Trees',
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
    crown_height_dbh_sensitivity_v5_inputs:{text:'Trunk diameter, life stage and regrowth time from crown size and height (sensitivity model)',doc:'docs/methods/tree_asset_model.md'},
    root_space_sensitivity_v5_inputs:{text:'Root-space scenario from trunk and crown size',doc:'docs/validation/root_zone_summary.md'},
    arcgis_dsm_dem_2024_chm_sample_2m:{text:'Canopy height (2024 surface minus terrain) sampled within 2 m of the recorded position',doc:'docs/methods/tree_qa_layers.md'},
    pointcloud_v53_outline_B:{text:'Smoothed outline of the v5 crown cells, area-preserving (v6)',notes:'v6'}
  };
  const METHOD_PREFIX=[
    [/^growth_form_v6/,{text:'Growth-form model on the 2024 LiDAR structure and aerial imagery (v6)',notes:'v6'}],
    [/^valuation_/,{text:'i-Tree style service equations with stated unit values; sensitivity scenarios',notes:'v5',anchor:'benefits',doc:'docs/methods/tree_valuation_pilot.md'}],
    [/^trajectory|^ws2_/,{text:'Canopy matched across the 2013, 2016 and 2024 surveys',doc:'docs/validation/ws2_trajectories_v1.md'}],
    [/outline/,{text:'Smoothed outline of the crown cells (v6)',notes:'v6'}]
  ];
  // Release components in release-metadata.json "models", for the validation status of a model value.
  const COMPONENT={crown:'crown_segmentation',growth:'growth_form_classifier',services:'ecosystem_services',roots:'root_space',change:'tree_change'};
  // Model ids, as stored, to a readable name and version.
  function modelOf(env,component,id,version=null){
    const m=(env.metadata?.models||[]).find(x=>x.component===COMPONENT[component]);
    const status=m?.validation_status==='not_independently_validated'?'Not independently validated':m?.validation_status?words(m.validation_status):null;
    return id||version||status?{id:id||null,version:version||null,validation:status}:null;
  }

  // ---------- quantities ----------
  const FMT={m:(v,d=1)=>`${nf(v,d)} m`,m2:(v,d=1)=>`${nf(v,d)} m²`,cm:v=>`${nf(v)} cm`,nzd:v=>money(v),nzdy:v=>`${money(v)}/yr`,
    t:v=>co2(v),years:v=>`${nf(v)} years`,pct:v=>`${nf(v)}%`,m3y:v=>`${nf(v,1)} m³/yr`,kgy:v=>`${nf(v,2)} kg/yr`,n:(v,d=0)=>nf(v,d)};
  const UNIT={m:'m',m2:'m²',cm:'cm',nzd:'NZ$',nzdy:'NZ$/yr',t:'t CO₂e',years:'years',pct:'%',m3y:'m³/yr',kgy:'kg/yr',n:null};
  function money(v){const n=num(v);if(n===null)return '—';return '$'+(n>0&&n<10?n.toFixed(2):nf(Math.round(n)));}
  function co2(t){const n=num(t);if(n===null)return null;return n<1?`${nf(n*1000,0)} kg CO₂e`:`${nf(n,n<10?2:1)} t CO₂e`;}

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
    return {id:m,text:known?.text||words(m),href:known?.notes?`${site}/${known.notes}-methods.html${known.anchor?'#'+known.anchor:''}`:known?.doc?REPO+known.doc:null,
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
  const areaText=v=>v<10?nf(v,1):nf(Math.round(v));
  const spread=(vals,f)=>{if(vals.length<2)return null;const a=f(Math.min(...vals)),b=f(Math.max(...vals));return a===b?null:`${a}–${b}`;};

  // ---------- trunk diameter and root protection ----------
  // The release holds two trunk-diameter (DBH) models: assets.dbh_cm_crown_est (from crown size and height; the
  // root-space scenario repeats it as roots.dbh_cm) and services.dbh_cm_est (the benefit equations). Neither is
  // measured. The central estimate is the median of the distinct model values (design system 4.8: show the
  // central estimate, never the low end) and the range is their spread; a reviewed KYTE tape measurement replaces
  // both. Explained on the release methods page (v5-methods.html#trunk-diameter).
  const TRUNK_MODELS=[['assets','dbh_cm_crown_est','Crown size and height model'],['services','dbh_cm_est','Benefit equations']];
  const median=a=>{const s=[...a].sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};
  function trunk(env,c){
    const live=c.live;
    if(num(live?.diameter_cm)!==null)return {kind:'measured',central:num(live.diameter_cm),low:null,high:null,models:[],basis:'Measured at a reviewed KYTE ground visit'};
    const d=c.record?.datasets||{},models=[];
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
  const trunkMethod=env=>({id:'trunk_central_estimate',text:'Median of the release’s trunk-diameter models (crown size and height; benefit equations); not measured',
    href:`${env.siteRoot||'.'}/v5-methods.html#trunk-diameter`,doc:REPO+'docs/methods/tree_asset_model.md'});
  const rootMethod=(env,id)=>({id:id||'root_space_sensitivity_v5_inputs',text:`Root protection radius: ${RPA_FACTOR} × trunk diameter (central estimate), area capped at ${RPA_AREA_CAP_M2} m²; a planning scenario, not a measured root extent`,
    href:`${env.siteRoot||'.'}/v5-methods.html#roots`,doc:REPO+'docs/validation/root_zone_summary.md'});

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
    if(s.status.protected)out.push({key:'protected',label:'Protected',tone:'protected',title:s.schedule?.label||'Auckland Unitary Plan notable tree schedule'});
    if(s.status.notable)out.push({key:'notable',label:'Notable',tone:'notable'});
    if(s.evidence)out.push({key:'evidence',label:s.evidence.label,tone:s.evidence.tone});
    if(s.link?.cls==='probable')out.push({key:'probable',label:'Probable crown link',tone:'warn'});
    if(s.link?.seeded)out.push({key:'drawn',label:'Crown drawn from the record',tone:'warn'});
    if(s.classification?.quality==='unlinked')out.push({key:'unlinked',label:'No crown linked',tone:'warn'});
    out.push({key:'records',label:`${nf(s.recordCount)} record${s.recordCount===1?'':'s'} · ${nf(rs.length)} source${rs.length===1?'':'s'}`,tone:'muted',records:s.recordCount,sources:rs.length});
    return out;
  }
  // Protection, said for every tree (never silence): protected when the release matches a Notable Trees schedule
  // entry (a scheduled tree or a scheduled group) to this tree; otherwise "Not protected", with what was checked.
  // ALTO checks the Notable Trees schedule only.
  const SCHEDULE_LAW='Auckland Unitary Plan, Schedule 10';
  function protectionStatus(c){
    const s=c.summary,sch=s.schedule,p=c.props||{};
    if(s.status.protected){
      const sentence=sch?.kind==='group'?`Protected: part of a scheduled group of ${sch.approx?`about ${nf(sch.approx)} trees`:'trees'} (${sch.name}) in the Notable Trees schedule (${SCHEDULE_LAW}).`:
        sch?.kind==='tree'?`Protected: a scheduled tree (${sch.name}) in the Notable Trees schedule (${SCHEDULE_LAW}).`:`Protected: in the Notable Trees schedule (${SCHEDULE_LAW}).`;
      return {status:'protected',label:'Protected',entry:sch?.label||null,schedule:'Notable Trees schedule',law:SCHEDULE_LAW,
        line:`${sch?.label||'Scheduled'} · Notable Trees schedule (${SCHEDULE_LAW})`,sentence,checked:null,source:SOURCE.schedule};
    }
    const flag=p.is_protected_notable;
    if(!c.record&&!(flag===0||flag==='0'||flag===false))return {status:'unknown',label:null,entry:null,schedule:'Notable Trees schedule',law:SCHEDULE_LAW,line:null,sentence:null,checked:null,source:SOURCE.schedule};
    return {status:'not_protected',label:'Not protected',entry:null,schedule:'Notable Trees schedule',law:SCHEDULE_LAW,
      line:`Not protected · not on the Notable Trees schedule (${SCHEDULE_LAW}) as published in this release`,
      sentence:`Not protected: no entry in the Notable Trees schedule (${SCHEDULE_LAW}), as published in this release, is matched to this tree.`,
      checked:'The Notable Trees schedule as published in this release: scheduled trees and scheduled groups, matched to this tree’s records and crown. ALTO checks this schedule only.',
      source:SOURCE.schedule};
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
  function identity(env,c){
    const s=c.summary,S=dep('ALTOSources'),src=S?.source(s.classification?.primary),gf=c.record?.datasets?.growth_form||null;
    return {title:s.name.title,latin:s.name.latin,nameKind:s.name.kind,nameNote:s.name.note,
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

  // ---------- key measurements ----------
  function measures(env,c){
    const d=c.record?.datasets||{},s=c.summary,z=s.size,rec=d.record||{},gf=d.growth_form,cr=d.crown||{},a=d.assets||{},v=d.services||{},o=d.outline;
    const S=dep('ALTOSources');
    const flown=gf?.lidar_flight_date?dated(gf.lidar_flight_date,'flown '):SURVEY_2024.captured;
    const snap=dated(rec.as_of_utc,'snapshot ');
    const rel=env.metadata?.release?.dataset_last_updated_utc?dated(env.metadata.release.dataset_last_updated_utc,'release '):null;
    const out={};
    const put=x=>{if(x)out[x.key]=x;};
    // Species: as the source recorded it.
    if(s.name.kind==='recorded')put(q(env,'species','Species',s.name.latin?`${s.name.title} (${s.name.latin})`:s.name.title,null,'recorded',
      prov(env,'species',{source:S?.dataset(rec.source_primary).name||words(rec.source_primary),date:snap,dataset:'record',field:'species_common',
        note:speciesBasis(rec.species_confidence)}),{text:s.name.title}));
    // Growth form: the v6 model, with its top class probability.
    if(s.growth?.shown){
      const g=growthForm(env,s,gf),top=g?.probabilities.find(x=>x.top);
      put(q(env,'growthForm','Growth form',s.growth.wording,null,'model',prov(env,'growthForm',{source:'ALTO growth-form model on the 2024 LiDAR survey and aerial imagery',
        date:flown,method:gf?.method_id||'growth_form_v6',model:modelOf(env,'growth',gf?.model_id||null),dataset:'growth_form',field:'display_key',
        uncertainty:top?{text:`${top.label} ${nf(top.p*100)}%${gf?.band?`; confidence band ${gf.band}`:''}`,low:null,high:null,basis:'class probability'}:null})));
    }
    // Height: the crown maximum, with the other estimates this record holds as its spread.
    const hs=[num(cr.crown_max_chm_m),num(d.previous_crown_v4?.height_m),num(d.previous_crown?.crown_max_chm_m),num(d.lidar?.chm_local_max_2m_m),num(d.pointcloud?.canopy_top_m),num(d.previous_pointcloud?.canopy_top_m)].filter(x=>x!==null&&x>0);
    const hsp=spread(hs,v=>nf(v,1));
    put(q(env,'height','Height',z.height,'m','measured',prov(env,'height',{source:SOURCE.lidar2024,date:flown,method:cr.method_id||null,model:modelOf(env,'crown',cr.method_id||null),
      dataset:'crown',field:'crown_max_chm_m',note:z.heightBasis,
      uncertainty:{text:`Survey specification ${SURVEY_2024.vertical}${hsp?`; ${hsp} m across ${hs.length} estimates in this record (segmentations and canopy height samples)`:''}`,
        low:hsp?Math.min(...hs):null,high:hsp?Math.max(...hs):null,basis:hsp?'spread of this record’s estimates':'survey specification'}}),
      {range:hsp?rangeOf(Math.min(...hs),Math.max(...hs),'m','spread of this record’s height estimates'):null}));
    // Crown area: v5 crown cells; other segmentations of the same survey give the spread.
    const as=[num(cr.crown_area_m2),num(o?.outline_area_m2),num(d.previous_crown_v4?.crown_area_m2),num(d.previous_crown?.crown_area_m2)].filter(x=>x!==null&&x>0);
    const asp=spread(as,areaText);
    put(q(env,'crownArea','Crown area',z.area,'m2','measured',prov(env,'crownArea',{source:`${SOURCE.lidar2024}; ${SOURCE.aerial2024} (NDVI)`,date:flown,method:cr.method_id||null,
      model:modelOf(env,'crown',cr.method_id||null),dataset:'crown',field:'crown_area_m2',
      note:num(cr.gap_filled_fraction)!==null?`${nf(cr.gap_filled_fraction*100)}% of crown cells gap-filled`:null,
      uncertainty:{text:`${asp?`${asp} m² across ${as.length} segmentations of the 2024 survey; `:''}survey specification ${SURVEY_2024.horizontal}`,
        low:asp?Math.min(...as):null,high:asp?Math.max(...as):null,basis:asp?'spread across segmentations':'survey specification'}}),
      {range:asp?rangeOf(Math.min(...as),Math.max(...as),'m2','spread across segmentations'):null}));
    if(o&&num(o.outline_area_m2)!==null)put(q(env,'crownOutline','Crown outline',num(o.outline_area_m2),'m2','derived',prov(env,'crownOutline',{source:'v5 crown cells',
      method:o.method_id||'pointcloud_v53_outline_B',dataset:'outline',field:'outline_area_m2',note:o.outline_method?`Outline method: ${words(o.outline_method)}`:null})));
    put(q(env,'crownDiameter','Crown diameter',z.diameter,'m','derived',prov(env,'crownDiameter',{source:'Derived from the crown area',date:flown,
      method:{id:null,text:'Diameter of the circle with the crown’s area',href:null},dataset:'crown',field:'crown_diameter_m'})));
    // Trunk diameter (DBH, at 1.3 m above the uphill ground): the central estimate of the release's models, with
    // their range, unless a reviewed ground visit measured it.
    const live=c.live,tk=trunk(env,c);
    if(tk?.kind==='measured')put(q(env,'trunkDiameter','Trunk diameter',tk.central,'cm','measured',prov(env,'trunkDiameter',{source:SOURCE.kyte,date:live.observed_on?{iso:null,text:live.observed_on}:null,
      method:{id:null,text:live.circumference_cm?'Circumference tape at 1.3 m above the uphill ground, divided by π':'Diameter tape at 1.3 m above the uphill ground',href:null},dataset:'ground'})));
    else if(tk){
      const tsp=spread(tk.models.map(x=>x.value),v=>nf(Math.round(v)));
      put(q(env,'trunkDiameter','Trunk diameter',tk.central,'cm','model',prov(env,'trunkDiameter',{source:SOURCE.alto,date:{iso:null,text:'not measured'},
        // A computed central value: the stored fields are named in the note, not as the value's own field.
        method:trunkMethod(env),model:modelOf(env,'services',a.method_id||null),dataset:tk.models.length>1?null:tk.models[0].dataset,
        field:tk.models.length>1?null:tk.models[0].field,
        note:`${tk.basis}: ${tk.models.map(x=>`${nf(Math.round(x.value))} cm (${x.label.toLowerCase()}, ${x.dataset}.${x.field})`).join(', ')}.${a.dbh_confidence?` Release confidence: ${words(a.dbh_confidence)}.`:''}`,
        uncertainty:tsp?{text:`${tsp} cm across the release’s ${tk.models.length} trunk-diameter models`,low:tk.low,high:tk.high,basis:'spread across models'}:null}),
        {range:tsp?rangeOf(tk.low,tk.high,'cm','spread across trunk models',0):null}));
    }
    // Root protection radius, beside the size values: a scenario from the trunk estimate (see rpaRadius).
    const rt=d.roots;
    if(rt&&(num(rt.rpa_radius_m)!==null||tk)){
      const r=tk?rpaRadius(tk.central):num(rt.rpa_radius_m),lo=tk?.low!==null&&tk?.low!==undefined?rpaRadius(tk.low):null,hi=tk?.high!==null&&tk?.high!==undefined?rpaRadius(tk.high):null;
      const rsp=lo!==null&&hi!==null?spread([lo,hi],v=>nf(v,1)):null,stored=num(rt.rpa_radius_m);
      put(q(env,'rootProtection','Root protection radius',r,'m','model',prov(env,'rootProtection',{source:SOURCE.alto,date:{iso:null,text:'not measured'},
        method:rootMethod(env,rt.method_id),model:modelOf(env,'roots',rt.method_id||null),dataset:null,field:null,
        note:`Area ${nf(Math.round(Math.PI*r*r))} m². ${tk?.kind==='measured'?'From the measured trunk diameter.':`From the central trunk estimate (${nf(Math.round(tk?.central??0))} cm).`}${stored!==null&&tk&&Math.abs(stored-r)>=0.05?` The release stores ${nf(stored,1)} m (roots.rpa_radius_m), from the ${nf(Math.round(num(rt.dbh_cm)??tk.low))} cm model.`:''}`,
        uncertainty:rsp?{text:`${rsp} m from the trunk-diameter range (${spread(tk.models.map(x=>x.value),v=>nf(Math.round(v)))} cm)`,low:lo,high:hi,basis:'trunk-diameter range'}:null}),
        {range:rsp?rangeOf(lo,hi,'m','trunk-diameter range'):null}));
    }
    if(s.lifeStage)put(q(env,'lifeStage','Life stage',s.lifeStage.label,null,'model',prov(env,'lifeStage',{source:SOURCE.alto,
      method:a.method_id||'crown_height_dbh_sensitivity_v5_inputs',dataset:'assets',field:'life_stage',
      note:`Height as a share of the reference mature height for the class: ${s.lifeStage.band}${s.lifeStage.detail?` (${s.lifeStage.detail})`:''}. Age not estimated.`})));
    const b=s.benefits;
    if(b.total!==null){
      const unc=num(v.uncertainty_factor);
      put(q(env,'benefits','Benefits',b.total,'nzdy','model',prov(env,'benefits',{source:SOURCE.alto,date:rel,method:v.method_id||'valuation_',model:modelOf(env,'services',v.method_id||null),
        dataset:'services',field:'total_value_nzd_y',note:v.valuation_confidence?`Confidence: ${words(v.valuation_confidence)}`:null,
        uncertainty:b.low!==null&&b.high!==null?{text:`${money(b.low)}–${money(b.high)}/yr (release sensitivity range${unc!==null?`; ±${nf(unc*100)}%`:''})`,low:b.low,high:b.high,basis:'sensitivity scenarios'}:null}),
        {range:rangeOf(b.low,b.high,'nzdy','sensitivity scenarios')}));
    }
    if(b.carbonStored!==null)put(q(env,'carbonStored','Carbon stored',b.carbonStored,'t','model',prov(env,'carbonStored',{source:SOURCE.alto,date:rel,method:v.method_id||'valuation_',
      model:modelOf(env,'services',v.method_id||null),dataset:'services',field:'stored_co2e_tonnes_est',note:'Biomass from height and modelled trunk diameter'})));
    if(b.runoffM3!==null)put(q(env,'stormwater','Stormwater runoff avoided',b.runoffM3,'m3y','model',prov(env,'stormwater',{source:`${SOURCE.alto}; ${SOURCE.impervious}`,date:rel,
      method:v.method_id||'valuation_',dataset:'services',field:'avoided_runoff_m3_y',note:num(v.paved_fraction_used)!==null?`${nf(v.paved_fraction_used*100)}% paved within 30 m`:null})));
    const R=s.replacement;
    if(R.years!==null)put(q(env,'replacementYears','Years to regrow this crown',R.years,'years','model',prov(env,'replacementYears',{source:SOURCE.alto,
      method:a.method_id||'crown_height_dbh_sensitivity_v5_inputs',dataset:'assets',field:'replacement_years_canopy',
      note:R.rate?`Crown area ÷ ${nf(R.rate,1)} m² of new crown per year (release planning rate for the class), linear`:'Crown area ÷ class growth rate, linear'})));
    if(R.irrLabel)put(q(env,'irreplaceability','Irreplaceability',R.irrLabel,null,'rule',prov(env,'irreplaceability',{source:SOURCE.alto,
      method:a.method_id||'crown_height_dbh_sensitivity_v5_inputs',dataset:'assets',field:'irreplaceability_class',note:`Class rule: ${R.irrDefinition}`})));
    if(s.status.protected)put(q(env,'protection','Protection',s.schedule?.label||'Notable tree',null,'recorded',prov(env,'protection',{source:SOURCE.schedule,date:snap,
      dataset:'record',field:'is_protected_notable',note:d.notable_link_review?'Position confirmed by review':null})));
    return out;
  }

  // ---------- records and identifiers ----------
  const JOIN={pointcloud_v5_ndvi_watershed:'Recorded position inside the v5 crown',record_crown_link_v52:'v5.2 record-to-crown link',v5_containment_with_v51_continuity_repair:'v5.1 continuity repair'};
  function recordEntry(env,r,c){
    const d=r.datasets||{},rec=d.record||{},rl=d.record_link||{},idn=d.identity||{},S=dep('ALTOSources'),T=dep('ALTOTreeSummary'),L=dep('ALTORecordLinks');
    const ds=S?S.dataset(rec.source_primary):{name:words(rec.source_primary),kind:'Source',group:'other'};
    const isSelf=r.tree_id===c.id,isRep=idn.current_primary_tree_id===r.tree_id,detection=!!S?.DETECTION.includes(rec.source_primary);
    const link=L?.link({},r),sch=T?.schedule(rec);
    const lon=num(rec.lon),lat=num(rec.lat);
    return {treeId:r.tree_id,self:isSelf,mapMarker:isRep,detection,
      source:{key:rec.source_primary||null,name:ds.name,kind:ds.kind,group:ds.group||null},role:words(rec.record_role),
      sourceId:rec.source_tree_id||null,objectId:rec.source_object_id??null,
      href:T?.sourceHref(rec.source_primary,rec.source_tree_id,d.source_crosswalk?.current_objectid??rec.source_object_id)||null,
      species:{common:named(rec.species_common_raw||rec.species_common),latin:named(rec.species_latin_raw||rec.species_latin),basis:speciesBasis(rec.species_confidence)},
      owner:rec.owner_raw||rec.owner_class?{raw:rec.owner_raw||null,class:rec.owner_class||null}:null,
      snapshot:dated(rec.as_of_utc),position:lon!==null&&lat!==null?{lon,lat,basis:'As supplied by the source'}:null,
      link:detection&&isRep?{class:'detection',text:'The detection is the crown',score:null,edgeDistance:null,topDistance:null}:
        link?{class:link.cls||'drawn_from_record',text:link.text||L?.CLASS[link.cls]?.title||null,score:num(rl.confidence),edgeDistance:num(rl.edge_distance_m),topDistance:num(rl.top_distance_m??idn.top_distance_m)}:
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
    if(l)cols.push({key:'chm',label:'Canopy height at record',when:'2024, within 2 m',height:m(l.chm_local_max_2m_m),heightNote:num(l.chm_at_point_m)!==null?`${nf(l.chm_at_point_m,1)} m at the point`:null,method:methodRef(env,l.method_id)});
    if(t)for(const y of [2016,2013])if(num(t['h_'+y])!==null&&t['present_'+y]!==0)cols.push({key:'lidar'+y,label:`LiDAR ${y}`,when:`${y}, matched canopy`,height:m(t['h_'+y]),method:methodRef(env,'trajectory')});
    const rec=d.record||{};
    if(!S?.DETECTION.includes(rec.source_primary)){
      const sp=[rec.species_common,rec.species_latin].map(named).filter(Boolean);
      cols.push({key:'source',label:S?S.dataset(rec.source_primary).name:words(rec.source_primary),when:rec.as_of_utc?dated(rec.as_of_utc,'snapshot ').text:'',form:sp.length?sp.join(' · '):'Not recorded',formKind:'recorded',note:'No dimensions recorded.'});
    }
    if(g)cols.push({key:'kyte',label:'KYTE visit',when:dated(g.observed_on)?.text||'',note:g.presence?`Presence: ${g.presence}`:null});
    if(f)cols.push({key:'field',label:'Field report',when:f.reported_on||'',note:f.description||null});
    const L=c.live;
    if(L&&(L.diameter_cm||L.height_m||L.crown_spread_m))cols.push({key:'kyteMeasure',label:'KYTE measurement',when:L.observed_on||'',height:L.height_m||null,crownDiameter:L.crown_spread_m||null,trunk:L.diameter_cm||null,trunkKind:'measured',form:L.species?.name||null,formKind:'observed'});
    const rows=[['height','Height','m'],['crownDiameter','Crown diameter','m'],['crownArea','Crown area','m²'],['trunk','Trunk diameter','cm'],['form','Species or form',null],['note','Notes',null]].filter(([k])=>cols.some(x=>x[k]!==null&&x[k]!==undefined));
    // One provenance entry per column: where that column's values come from.
    const flown=d.growth_form?.lidar_flight_date?dated(d.growth_form.lidar_flight_date,'flown '):SURVEY_2024.captured;
    const COL={v5:[SOURCE.lidar2024,flown,cr.method_id,'crown'],v4:[SOURCE.lidar2024,flown,pv?.method_id||'pointcloud_v4_vegetation_watershed','previous_crown_v4'],
      raster:[SOURCE.lidar2024,flown,pc?.method_id,'previous_crown'],chm:[SOURCE.lidar2024,flown,l?.method_id,'lidar'],
      lidar2016:['Auckland 2016 LiDAR survey (LINZ)',{iso:'2016',text:'2016'},'trajectory','trajectory'],lidar2013:['Auckland 2013 LiDAR survey (LINZ)',{iso:'2013',text:'2013'},'trajectory','trajectory'],
      source:[S?S.dataset(rec.source_primary).name:words(rec.source_primary),dated(rec.as_of_utc,'snapshot '),null,'record'],
      kyte:[SOURCE.kyte,dated(g?.observed_on),g?.method_id||null,'ground'],field:['Field report (reviewed)',f?.reported_on?dated(f.reported_on):null,null,'field'],
      kyteMeasure:[SOURCE.kyte,L?.observed_on?{iso:null,text:L.observed_on}:null,null,'ground']};
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
      P('crownMax','Crown maximum',num(cr.crown_max_chm_m),'m','crown','crown_max_chm_m','v5 crown'),
      P('meanHeight','Mean vegetation height',num(cr.mean_veg_height_m),'m','crown','mean_veg_height_m','v5 crown cells'),
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
        rl?.link_class?{text:L?.CLASS[rl.link_class]?.title||words(rl.link_class),class:rl.link_class,edgeDistance:num(rl.edge_distance_m),score:num(rl.confidence),method:methodRef(env,rl.method_id||'record_crown_link_v52')}:
        id.method_id?{text:JOIN[id.method_id]||words(id.method_id),class:'contained',method:methodRef(env,id.method_id)}:null,
      evidenceTier:tier?{key:tier,label:T?.TIER[tier]?.[0]||words(tier)}:null,
      review:d.crown_link_review?{status:words(d.crown_link_review.status),reason:words(d.crown_link_review.reason)}:null};
  }

  // ---------- species ----------
  function species(env,c){
    const d=c.record?.datasets||{},rec=d.record||{},sp=d.species||{},pred=d.predictions,s=c.summary,S=dep('ALTOSources');
    return {recorded:{name:s.name.kind==='recorded'?{common:s.name.title,latin:s.name.latin}:null,
        asSupplied:[rec.species_common_raw,rec.species_latin_raw].filter(Boolean).join(' · ')||null,
        source:S?S.dataset(rec.source_primary).name:words(rec.source_primary),basis:speciesBasis(rec.species_confidence),
        classFromName:sp.growth_form_confidence==='known'?{class:words(sp.growth_form),basis:sp.growth_form_source?`i-Tree match: ${words(String(sp.growth_form_source).replace('itree_',''))}`:null}:null},
      growthForm:identity(env,c).growthForm,
      growthFormStatus:d.growth_form?'scored':!dep('ALTOGrowthForm')?.shipped?.(env.metadata)?'not_in_release':'not_scored',
      legacy:pred?{model:pred.model_id||null,calibrated:false,probabilities:[['proba_evergreen_broadleaf','Evergreen broadleaf'],['proba_deciduous_broadleaf','Deciduous broadleaf'],['proba_conifer','Conifer'],['proba_palm_other','Palm / other']]
        .map(([f,label])=>({label,p:num(pred[f])})).filter(x=>x.p!==null)}:null,
      photoLead:null};
  }

  // ---------- surveys, benefits, life stage ----------
  function surveys(env,c){
    return c.summary.surveys.map(e=>({year:e.year,status:e.status,line:e.line,outline:!!e.outline,
      height:e.height!==null?q(env,'survey'+e.year,`Height ${e.year}`,e.height,'m','measured',prov(env,'survey'+e.year,{source:e.year===2024?SOURCE.lidar2024:`Auckland ${e.year} LiDAR survey (LINZ)`,
        date:{iso:String(e.year),text:String(e.year)},method:e.year===2024?c.record?.datasets?.crown?.method_id||null:'trajectory',dataset:e.year===2024?'crown':'trajectory',field:e.year===2024?'crown_max_chm_m':'h_'+e.year,
        note:e.year===2024?null:'Canopy height model, canopy matched to this tree'})):null,
      matchedHeight:e.matchedHeight??null,area:e.area,cover:e.cover,position:surveyPoint(c,e)}));
  }
  // Where an earlier survey's canopy was matched to this tree: the trajectory point (2013, 2016); null for 2024
  // (the crown is the 2024 position) and for years without a match.
  function surveyPoint(c,e){
    const t=c.record?.datasets?.trajectory;
    if(e.year!==2024&&e.status==='matched'&&t&&num(t.lon)!==null&&num(t.lat)!==null)return {lon:num(t.lon),lat:num(t.lat),basis:'Canopy point matched across the 2013, 2016 and 2024 surveys'};
    return null;
  }
  // Height change between surveys, from the matched canopy heights (trajectory build).
  function surveyChange(env,c){
    const t=c.record?.datasets?.trajectory;if(!t)return null;
    const rates=[[2013,2016,'growth_2013_2016'],[2016,2024,'growth_2016_2024']].map(([from,to,f])=>({from,to,value:num(t[f])})).filter(x=>x.value!==null);
    if(!rates.length)return null;
    return {rates,unit:'m/yr',implausible:num(t.implausible)===1,fate:words(t.fate),
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
    if(b.total===null)return {status:b.scenarioOnly?'scenario_only':'not_estimated',scenarioTotal:b.scenarioOnly?b.scenarioTotal:null,rows:[],total:null};
    const row=(key,label,quantity,value)=>({key,label,quantity,value:num(value)});
    return {status:'estimated',
      rows:[row('stormwater','Stormwater',b.runoffM3!==null?{value:b.runoffM3,unit:'m³/yr',text:`${nf(b.runoffM3,1)} m³/yr runoff avoided`,
          detail:num(v.intercepted_rainfall_m3_y)!==null?`${nf(num(v.intercepted_rainfall_m3_y),1)} m³/yr intercepted; ${nf(num(v.paved_fraction_used)*100)}% paved within 30 m`:null}:null,b.stormwaterValue),
        row('carbon','Carbon',b.carbonStored!==null?{value:b.carbonStored,unit:'t CO₂e',text:`${co2(b.carbonStored)} stored`,
          detail:num(v.annual_sequestration_tco2e_y_est)!==null?`${nf(num(v.annual_sequestration_tco2e_y_est)*1000)} kg CO₂e/yr sequestered`:null}:null,b.carbonValue),
        row('air','Air quality',b.pm25!==null?{value:b.pm25,unit:'kg/yr',text:`${nf(b.pm25,2)} kg PM2.5/yr`,detail:null}:null,b.airValue),
        row('cooling','Cooling',null,b.coolingValue)],
      total:{value:b.total,low:b.low,high:b.high,text:`${money(b.total)}/yr`,rangeText:b.low!==null&&b.high!==null?`${money(b.low)}–${money(b.high)}`:null},
      method:methodRef(env,v.method_id||null),classUsed:v.species_class?{key:v.species_class,label:cap(words(v.species_class)),source:words(v.species_class_source)}:null,
      confidence:words(v.valuation_confidence),uncertaintyFactor:num(v.uncertainty_factor),lai:num(v.lai_used),
      biomass:num(v.agb_kg_est)!==null?{aboveKg:num(v.agb_kg_est),belowKg:num(v.bgb_kg_est)}:null,
      growthFormBasis:v.growth_form_basis?words(v.growth_form_basis):null,
      assumptions:parse(v.assumptions_json)||null,
      note:'i-Tree style equations with stated unit values; sensitivity scenarios. Stormwater price and flood uplift: placeholders pending Healthy Waters validation.'};
  }
  const STAGES=[['juvenile','Juvenile',0,18],['young','Young',18,35],['semi-mature','Semi-mature',35,60],['mature','Mature',60,90],['veteran','Veteran',90,null]];
  function lifeStage(env,c){
    const L=c.summary.lifeStage,T=dep('ALTOTreeSummary');
    return {status:L?'estimated':'not_estimated',key:L?.key||null,label:L?.label||null,band:L?.band||null,detail:L?.detail||null,definition:L?.definition||'Height as a share of the reference mature height for the tree class',
      scale:STAGES.map(([key,label,lo,hi])=>({key,label,from:lo,to:hi,current:key===L?.key})),
      referenceHeights:T?.CLASS_MAX_HEIGHT_M||null,age:null};
  }
  function replacement(env,c){
    const R=c.summary.replacement,now=(env.now||new Date()).getFullYear();
    return {years:R.years,startYear:now,reachYear:R.years!==null?Math.round(now+R.years):null,rate:R.rate,
      marks:R.years!==null?[25,50,75,100].map(p=>({share:p,year:Math.round(now+R.years*p/100)})):[],
      irreplaceability:R.irreplaceability?{key:R.irreplaceability,label:R.irrLabel,definition:R.irrDefinition}:null,
      classes:Object.entries(dep('ALTOTreeSummary')?.IRR||{}).map(([key,[label,rule]])=>({key,label,rule})),
      cost:null};
  }
  // Root space: present whenever the release has a root-space scenario for the tree (a LiDAR-detected tree has a
  // protection radius without an effective rooting radius). The protection radius follows the central trunk
  // estimate (rpaRadius), with its range; the release's stored values are kept as `stored`.
  function roots(env,c){
    const r=c.record?.datasets?.roots;if(!r||(r.rpa_radius_m==null&&r.effective_radius_m==null))return null;
    const tk=trunk(env,c),radius=tk?rpaRadius(tk.central):num(r.rpa_radius_m);
    const lo=tk&&tk.low!==null?rpaRadius(tk.low):null,hi=tk&&tk.high!==null?rpaRadius(tk.high):null,ranged=lo!==null&&hi!==null&&spread([lo,hi],v=>nf(v,1));
    const area=radius===null?null:Math.min(Math.PI*radius*radius,RPA_AREA_CAP_M2);
    return {kind:'scenario',provenance:prov(env,'roots',{label:'Root space',kind:'model',source:SOURCE.alto,method:rootMethod(env,r.method_id),
        model:modelOf(env,'roots',r.method_id||null),dataset:'roots',note:r.constraint_basis||null}),
      rpaRadius:radius,rpaArea:area,rpaRange:ranged?{low:lo,high:hi,areaLow:Math.PI*lo*lo,areaHigh:Math.min(Math.PI*hi*hi,RPA_AREA_CAP_M2)}:null,
      rpaBasis:tk?(tk.kind==='measured'?'From the measured trunk diameter':`${RPA_FACTOR} × the central trunk estimate (${nf(Math.round(tk.central))} cm)`):'The release’s stored radius',
      rule:{factor:RPA_FACTOR,areaCap:RPA_AREA_CAP_M2},trunk:tk?{central:tk.central,low:tk.low,high:tk.high,kind:tk.kind}:null,
      stored:{rpaRadius:num(r.rpa_radius_m),rpaArea:num(r.rpa_area_m2),dbh:num(r.dbh_cm)},
      effectiveRadius:num(r.effective_radius_m),effectiveArea:num(r.effective_area_m2),
      foragingRadius:num(r.foraging_radius_m),constraint:words(r.root_constraint_flag),basis:r.constraint_basis||null,method:rootMethod(env,r.method_id),confidence:words(r.model_confidence)};
  }
  // KYTE task links (KYTE docs/REPORTS.md): the tree, the task and the release the person was looking at.
  function know(env,c){
    const rel=env.datasetVersion?`&release=${encodeURIComponent(env.datasetVersion)}`:'';
    const go=task=>`${env.kyteBase}/?tree=${encodeURIComponent(c.id)}&task=${task}${rel}`;
    return [{task:'species',title:'Confirm or correct the species',text:'Photograph leaves, bark and the whole tree; enter the species.',href:go('species')},
      {task:'age',title:'Add the planting year or age',text:'Enter the year or age in the visit notes, with its source (plaque, records, memory).',href:go('age')},
      {task:'removed',title:'Report it removed',text:'Photograph the spot; set Change to “tree has gone”.',href:go('removed')},
      {task:'outline',title:'Flag the crown outline',text:'Photograph the tree; describe the problem with the outline in the notes.',href:go('outline')}];
  }

  // ---------- history across releases (from the record; a published history file adds lineage) ----------
  // Releases this tool knows, oldest first. A record carries what each release left on it.
  const RELEASES=[{key:'v4',label:'v4',date:'2026-09-17'},{key:'v5',label:'v5',date:'2026-09-22'},{key:'v5.1',label:'v5.1',date:'2026-10-08'},
    {key:'v5.2',label:'v5.2',date:'2026-10-10'},{key:'v6',label:'v6',date:null}];
  function historyFromRecord(env,c){
    const d=c.record?.datasets||{},pe=d.previous_evidence,pv=d.previous_crown_v4,id=d.identity||{},cr=d.crown||{},rl=d.record_link,rv=d.crown_link_review,o=d.outline,gf=d.growth_form,cur=env.releaseLabel;
    const rows=[];
    if(pe||pv)rows.push({release:'v4',date:dated('2026-09-17'),crown:{key:pe?.seg_key||pv?.seg_key||null,height:num(pe?.v4_height_m??pv?.height_m),area:num(pe?.v4_crown_area_m2??pv?.crown_area_m2),
      method:methodRef(env,pe?.method_id||pv?.method_id||'pointcloud_v4_vegetation_watershed')},role:words(pe?.link_role),evidence:words(pe?.evidence_tier),
      events:[pe?.restored?{kind:'restored',text:'Restored after an earlier release dropped it'}:null].filter(Boolean)});
    // The record's identity is the current release's, so the v5 row states the crown only; roles are
    // given for v4 (stored with the earlier evidence) and for the release on the page.
    if(id.seg_key||cr.crown_area_m2!=null)rows.push({release:'v5',date:dated('2026-09-22'),crown:{key:id.seg_key||null,height:num(cr.crown_max_chm_m),area:num(cr.crown_area_m2),method:methodRef(env,cr.method_id)},
      role:null,evidence:null,
      events:[num(id.old_overlapping_crowns)>1?{kind:'lineage',text:`${nf(id.old_overlapping_crowns)} v4 crowns overlap this crown`}:null,
        pe?.seg_key&&id.seg_key&&num(pe?.v4_crown_area_m2)!==null&&num(cr.crown_area_m2)!==null?{kind:'resegmented',text:`Crown redrawn: ${nf(pe.v4_crown_area_m2,1)} → ${nf(cr.crown_area_m2,1)} m²`}:null].filter(Boolean)});
    if(rv)rows.push({release:'v5.1',date:dated('2026-10-08'),crown:null,role:null,evidence:null,
      events:[{kind:'repair',text:`Crown continuity repair: ${words(rv.status)}${rv.reason?` (${words(rv.reason)})`:''}`,method:methodRef(env,rv.method_id||'v5_containment_with_v51_continuity_repair')}]});
    if(rl||cr.crown_source==='record_seeded_v52')rows.push({release:'v5.2',date:dated('2026-10-10'),crown:cr.crown_source==='record_seeded_v52'?{key:id.seg_key||null,height:num(cr.crown_max_chm_m),area:num(cr.crown_area_m2),method:methodRef(env,'record_seeded_crown_v52')}:null,
      role:null,evidence:null,events:[rl?.link_class?{kind:'link',text:`Record linked to its crown: ${dep('ALTORecordLinks')?.CLASS[rl.link_class]?.title||words(rl.link_class)}`,method:methodRef(env,rl.method_id||'record_crown_link_v52')}:null,
        cr.crown_source==='record_seeded_v52'?{kind:'drawn',text:'Crown drawn from the record’s LiDAR returns; awaiting confirmation'}:null].filter(Boolean)});
    if(o||gf)rows.push({release:'v6',date:cur==='v6'?dated(env.metadata?.release?.dataset_last_updated_utc):null,crown:o?{key:o.seg_key||id.seg_key||null,height:null,area:num(o.outline_area_m2),method:methodRef(env,o.method_id||'pointcloud_v53_outline_B')}:null,role:null,evidence:null,
      events:[o?{kind:'outline',text:`Smoothed outline: ${nf(num(o.outline_area_m2)??0,1)} m² from ${nf(num(o.cell_area_m2)??0,1)} m² of cells`}:null,
        gf?{kind:'growthForm',text:`Growth form estimated: ${cap(String(gf.wording||words(gf.display_key)||'').replace(/^(Probably|Likely|Possibly)\s+/i,'').replace(/\s*\(model\)$/,''))}`}:null,
        gf?.merged_call==='merged'?{kind:'merged',text:'Crown called merged (several trees) by the v6 model'}:null].filter(Boolean)});
    // The release on the page always has a row: the tree is in it.
    if(cur&&!rows.some(r=>r.release===cur)){
      const md=env.metadata?.release;
      rows.push({release:cur,date:dated(md?.dataset_last_updated_utc),crown:id.seg_key||cr.crown_area_m2!=null?{key:id.seg_key||null,height:num(cr.crown_max_chm_m),area:num(cr.crown_area_m2),method:methodRef(env,cr.method_id)}:null,
        role:words(id.link_role),evidence:words(id.evidence_tier),events:[]});
    }
    const order=r=>['v4','v5','v5.1','v5.2','v6'].indexOf(r.release);
    rows.sort((a,b)=>order(a)-order(b));
    for(const r of rows)r.current=r.release===cur;
    return rows;
  }

  // ---------- reviews and corrections held in the record ----------
  function reviewsFromRecord(env,c){
    const d=c.record?.datasets||{},out=[];
    const f=parse(d.field?.observation_json);
    if(d.field)out.push({id:null,kind:'field_observation',basis:'record',date:dated(d.field.observed_on),summary:f?.description||'Field observation',by:null,status:'applied',appliedIn:[]});
    if(d.ground)out.push({id:null,kind:'ground_visit',basis:'record',date:dated(d.ground.observed_on),summary:`KYTE visit accepted${d.ground.presence?`; presence: ${d.ground.presence}`:''}${d.ground.note?`. ${d.ground.note}`:''}`,by:null,status:'applied',appliedIn:[]});
    if(d.notable_link_review)out.push({id:null,kind:'notable_position',basis:'record',date:null,summary:d.notable_link_review.review_note||'Notable-tree position reviewed',by:null,status:'applied',appliedIn:[]});
    if(d.location_review)out.push({id:null,kind:'position_flag',basis:'record',date:null,summary:d.location_review.review_note||'Council position unverified',by:null,status:'applied',appliedIn:[]});
    // Reviewer corrections the release attached to this tree (dataset "corrections", written by the v6 corrections
    // stage from the append-only ledger; one row per correction).
    const corr=Array.isArray(d.corrections)?d.corrections:d.corrections?[d.corrections]:[];
    for(const x of corr)out.push({id:x.id||null,kind:words(x.type)||'correction',basis:'record',date:dated(x.decided_on),summary:x.summary||null,by:x.reviewer||null,
      status:words(x.status||'accepted'),outcome:words(x.outcome||null),reason:x.reason||null,role:words(x.role||null),appliedIn:[]});
    return out;
  }

  // ---------- assembly ----------
  function envOf(env={},metadata=null){
    const md=metadata||env.metadata||null,V=dep('ALTOVersion');
    const siteRoot=String(env.siteRoot??'.').replace(/\/+$/,'')||'.';
    const dv=md?.release?.dataset_version||null;
    let derived=env.derivedBase??root.ALTO_DERIVED_BASE??`${siteRoot}/derived/{release}`;
    derived=String(derived).replace('{release}',encodeURIComponent(dv||'unknown')).replace(/\/+$/,'');
    return {...env,metadata:md,siteRoot,dataBase:String(env.dataBase||'./data').replace(/\/+$/,''),derivedBase:derived,kyteBase:env.kyteBase||`${siteRoot}/kyte`,
      version:env.version||md?.assembly?.tile_version||dv||'session',releaseLabel:V?V.data(md).label:null,datasetVersion:dv};
  }
  function release(env,c){
    const V=dep('ALTOVersion'),md=env.metadata,r=md?.release||{},dv=V?V.data(md):{label:null,dev:false};
    return {data:dv.label,dev:!!dv.dev,datasetVersion:r.dataset_version||null,updated:dated(r.dataset_last_updated_utc),
      public:V?.publicLabel?V.publicLabel(md):null,
      snapshot:dated(c.schema?.generated_utc||c.record?.snapshot),bucketSchema:c.schema?.version??null,tool:V?.TOOL.version||null,
      status:r.status||null,statusText:r.status==='research_only_not_independently_validated'?'Research release; not independently validated':words(r.status),
      label:V?V.label(md):null,methodsHref:dv.label?`${env.siteRoot}/${String(dv.label).replace('.','')}-methods.html`:null,repository:V?.TOOL.repository||null};
  }
  function assemble({id,record,schema=null,members=[],memberCount=null,metadata=null,resolved=null,env={},live=null,props=null}){
    const T=dep('ALTOTreeSummary'),Id=dep('ALTOTreeId'),V=dep('ALTOVersion');
    const E=envOf(env,metadata);
    const tree_id=id||record?.tree_id||props?.tree_id;
    const summary=T.from(props||{tree_id},record||null);
    const c={id:tree_id,record,schema,members,summary,live,props:props||null};
    const url=Id?Id.url(tree_id):null,mapUrl=Id?Id.url(tree_id,{page:'map'}):null;
    const rec={schema:SCHEMA,loaded:!!record,id:tree_id,shortId:summary.shortId,url,mapUrl,
      request:resolved?{input:resolved.input??null,canonical:resolved.canonical??tree_id,status:resolved.status||'current',resolvedBy:resolved.resolved_by||null,note:resolved.note||null}:null,
      release:release(E,c),
      citation:V?V.citation({treeId:tree_id,url,metadata:E.metadata,title:'ALTO: Aotearoa Long-term Tree Observatory'}):null,
      identity:identity(E,c),measures:{},measureOrder:[],records:[],moreRecords:0,identifiers:summary.ids,bySource:null,
      outline:null,lidar:null,species:null,surveys:[],surveyChange:null,setting:null,benefits:null,lifeStage:null,replacement:null,roots:null,
      context:{status:'pending',scopes:[]},history:{status:'pending',releases:[]},corrections:{status:'pending',items:[]},
      imagery:{status:'pending'},place:{status:'pending'},nearby:{status:'pending',trees:[]},photos:{status:'pending',visits:[]},scenario:{status:'pending'},
      know:know(E,c),provenance:[]};
    Object.defineProperty(rec,'_ctx',{value:c,enumerable:false,writable:true});
    Object.defineProperty(rec,'summary',{value:summary,enumerable:false,writable:true});
    if(record){
      rec.measures=measures(E,c);rec.measureOrder=Object.keys(rec.measures);
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
  // Refresh the parts that read the ground visit (measured trunk, KYTE measurement column).
  function setLive(rec,live,env={}){
    const c=rec._ctx;if(!c||!c.record)return rec;
    c.live=live;const E=envOf(env,env.metadata||null);
    rec.measures=measures(E,c);rec.measureOrder=Object.keys(rec.measures);rec.bySource=bySource(E,c);rec.provenance=collectProvenance(rec);
    return rec;
  }

  // ---------- network ----------
  async function getJSON(url,{optional=false}={}){
    const fx=root.fetch;if(!fx)throw new Error('fetch unavailable');
    const res=await fx(url);
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
  const DERIVED={comparisons:{key:'tree_context'},history:{key:'tree_history'},points:{key:'tree_points'},corrections:{key:'corrections_applied'}};
  const pathOf=x=>String(typeof x==='string'?x:x?.path||'').replace(/^\.?\//,'');
  async function manifest(env){
    try{return await cached(`${env.derivedBase}/manifest.json?v=${encodeURIComponent(env.version)}`,{optional:true});}catch{return null;}
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
      let j=null;try{j=await cached(`${url}?v=${encodeURIComponent(env.version)}`,{optional:true});}catch{j=null;}
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
    // The distribution itself, for a strip: the group's sorted values (small groups) or its quantiles.
    const distribution=vals?{kind:'values',values:vals.slice()}:{kind:'quantiles',quantiles:qs.slice(),probabilities:(group.p||probs||[]).slice()};
    return {metric,value,unit,percentile:pc,share,rank:ex?.rank??null,of:ex?.of??null,exact:!!ex,text,distribution};
  }
  const ordinal=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};
  const IRR_ORDER=['low','moderate','high','very_high','effectively_irreplaceable'];
  function irrEntry(key,group){
    const counts=group?.irr;if(!key||!counts)return null;
    const n=IRR_ORDER.reduce((s,k)=>s+(counts[k]||0),0);if(!n)return null;
    const i=IRR_ORDER.indexOf(key),atOrAbove=IRR_ORDER.slice(Math.max(0,i)).reduce((s,k)=>s+(counts[k]||0),0);
    return {key,inClass:counts[key]||0,shareInClass:(counts[key]||0)/n*100,shareAtOrAbove:atOrAbove/n*100,n,counts};
  }
  // Where this tree sits among comparable crowns (same tree class) on its street, in its local board and
  // across Auckland, from the release's published distributions.
  async function context(rec,env){
    const c=rec._ctx,s=rec.summary;
    if(!c?.record)return {status:'none',scopes:[]};
    const v=c.record.datasets.services||{},rep=(c.members||[]).find(r=>r.tree_id===rec.identity.crownRepresentative);
    const klass=v.species_class||rep?.datasets?.services?.species_class||null;
    const d=await derived(env,'comparisons');
    if(!d)return {status:'not_published',scopes:[],note:'No comparison tables for this release.'};
    const j=d.json;
    if(!d.matches)return {status:'release_mismatch',scopes:[],builtFor:j.release,note:`Comparison tables were built for ${j.release_label||j.release}.`};
    if(!klass||!j.classes?.[klass])return {status:'no_class',scopes:[],note:'No tree class for comparison: this record has no crown estimate.'};
    const vals={height:s.size.height,crownArea:s.size.area,benefits:s.benefits.total??num(rep?.datasets?.services?.total_value_nzd_y)};
    const units={height:'m',crownArea:'m²',benefits:'NZ$/yr'};
    const probs=j.probabilities;
    const irrKey=c.record.datasets.assets?.irreplaceability_class||rep?.datasets?.assets?.irreplaceability_class||null;
    const scopeOf=(scope,name,group,definition)=>group?{scope,name,status:'ready',definition,n:group.n,
      metrics:Object.fromEntries(Object.keys(vals).map(k=>[k,rankEntry(k,vals[k],group,probs,units[k],j.metrics?.[k]?.decimals??null)]).filter(([,x])=>x)),
      irreplaceability:irrEntry(irrKey,group)}:null;
    const out={status:'ready',release:j.release,generated:dated(j.generated_utc),class:{key:klass,label:j.classes[klass],source:'Tree class used for the benefit estimates'},
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
    if(street?.group)out.scopes.push({...scopeOf('street',street.name,street.group,street.definition),distance:street.distance??null,board:street.board||null});
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
    const t=tileOf(pos.lon,pos.lat,spec.zoom||14),v=`?v=${encodeURIComponent(env.version)}`;
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
    try{const j=await cached(`${d.base}${String(idx.path||'{shard}.json').replace('{shard}',shard)}?v=${encodeURIComponent(env.version)}`,{optional:true});entry=j?.[rec.id]||null;}catch{entry=null;}
    const rows=(base.releases||[]).map(r=>({...r,events:[...(r.events||[])]}));
    for(const e of entry||[]){
      let row=rows.find(r=>r.release===e.release);
      if(!row){const R0=RELEASES.find(x=>x.key===e.release);row={release:e.release,date:R0?.date?dated(R0.date):null,crown:null,role:null,evidence:null,events:[],current:e.release===env.releaseLabel};rows.push(row);}
      row.events.push({kind:'id',change:e.change,text:`${cap(idx.changes?.[e.change]||words(e.change))}${num(e.moved_m)?`; its position on the map moved ${nf(e.moved_m,1)} m`:''}`});
    }
    const order=r=>RELEASES.findIndex(x=>x.key===r.release);
    rows.sort((x,y)=>order(x)-order(y));
    return {...base,releases:rows,lineage:entry,lineageStatus:entry?'ready':'none',lineageReleases:idx.releases||null,lineageSource:idx.source||null};
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
        summary:x.summary||x.subject_text||(typeof x.subject==='string'?x.subject:null)||x.note||null,by:x.reviewer||x.by||null,
        status:words(x.status||'accepted'),outcome:words(x.outcome||x.result||null),reason:x.reason||null,
        appliedIn:x.applied_in||x.releases||(j.release_label?[j.release_label]:[])}));
  }
  async function corrections(rec,env){
    const own=(rec.corrections?.items||[]).filter(x=>x.basis==='record');
    const d=await derived(env,'corrections');
    if(!d)return {status:own.length?'ready':'none',items:own,receipt:null,receiptStatus:'not_published'};
    const items=receiptItems(d.json,rec),seen=new Set(items.map(x=>x.id).filter(Boolean));
    const all=[...items,...own.filter(x=>!x.id||!seen.has(x.id))];
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
    if(!e&&idx.shards){try{const j=await cached(`${d.base}${String(idx.shard_path).replace('{shard}',fnvShard(rec.identity.crownRepresentative||rec.id,idx.shards))}?v=${encodeURIComponent(env.version)}`,{optional:true});e=j?.[rec.identity.crownRepresentative||rec.id]||null;}catch{e=null;}}
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

  // Imagery: the capture behind the current aerial tiles (Esri metadata) and, where the site allows it,
  // the dated World Imagery Wayback releases that changed at this point.
  async function imagery(rec,env){
    const pos=rec.summary.position;
    if(!pos)return {status:'none'};
    const V=dep('ALTOViz');
    const current=V?.imageryInfo?await V.imageryInfo(pos.lon,pos.lat).catch(()=>null):null;
    const wb=dep('ALTOWayback');
    let wayback={status:'not_available',releases:[],requirement:null};
    if(wb){try{wayback=await wb.releasesAt(pos.lon,pos.lat,env);}catch(e){wayback={status:'unavailable',releases:[],requirement:null,error:String(e?.message||e)};}}
    return {status:'ready',current:current?{source:current.source,date:current.date,resolution:current.resolution,provider:'Esri World Imagery'}:null,wayback};
  }

  // Place: local board now; land type and parcel come from the map (fromMap).
  async function place(rec,env){
    const pos=rec.summary.position;if(!pos)return {status:'none'};
    let b=null;try{b=dep('ALTOGround')?await dep('ALTOGround').board(pos.lon,pos.lat):null;}catch{return {...rec.place,status:'unavailable'};}
    return {...(rec.place||{}),status:'ready',board:b?{name:b.board_name,canopyCover:num(b.canopy_cover_pct),canopyCoverBasis:'Earlier board-level assessment',
        provenance:prov(env,'board',{label:'Local board',kind:'recorded',source:'Auckland Council local board boundaries (simplified copy in data/local_boards.json)',
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
        model:modelOf(env,'change',p.model_id||null),dataset:'longitudinal'}),anchor:{year:2024,height:p.anchor_height_m},points:p.points.map(x=>({year:x.year,height:x.height_m,low:x.low_m,high:x.high_m})),
      rate:p.annual_change_m,personalRate:p.personal_rate??null,neighbourWeight:p.neighbour_weight||null,model:{id:p.model_id||null,validation:modelOf(env,'change',null)?.validation||null},
      basis:'Height cohort rate'+(p.personal_rate!==null&&p.personal_rate!==undefined?', this tree’s 2013–2024 trend':'')+(p.neighbour_weight?', nearby trees':'')+'; band from hindcast errors'};
  }
  // The parcel under the recorded position (the map finds its id; the property record is published).
  async function parcel(rec,env,pid){
    const Pr=dep('ALTOProperty');if(!pid){rec.place={...(rec.place||{}),parcel:{status:'none',note:'Recorded position outside LINZ parcels (road corridor or foreshore)'}};return rec.place.parcel;}
    let out;
    try{const {record}=await Pr.load(env.dataBase,env.version,pid);const p=record?.property;
      out=p?{status:'ready',id:pid,provenance:prov(env,'parcel',{label:'Property parcel',kind:'derived',source:'LINZ primary parcels (CC BY 4.0); ALTO property summary for this release',
          method:{id:null,text:'Trees and canopy counted on the parcel; land type inferred from zoning and parcel records',href:REPO+'docs/methods/property_tenure.md',doc:REPO+'docs/methods/property_tenure.md'},dataset:'property_details'}),landType:p.tenure?{key:p.tenure,label:Pr.TENURE[p.tenure]||words(p.tenure)}:null,zone:p.zone||null,area:num(p.area_m2),canopy:num(p.canopy_m2),
        canopyCover:num(p.canopy_cover_pct),trees:num(p.n_trees)||0,benefits:num(p.total_value_nzd_y),href:`${env.siteRoot}/?property=${encodeURIComponent(pid)}`}:{status:'none',id:pid,note:'No counted trees or canopy'};}
    catch{out={status:'unavailable',id:pid};}
    rec.place={...(rec.place||{}),parcel:out};rec.provenance=collectProvenance(rec);return out;
  }
  const inited=new WeakSet();
  const PARTS={context,history,corrections,points,imagery,place,photos,scenario};
  async function enrich(rec,env={},{parts=Object.keys(PARTS).filter(p=>p!=='scenario'),onPart=null}={}){
    const E=envOf(env,env.metadata||rec._env?.metadata||null);
    const Gr=dep('ALTOGround');if(Gr?.init&&!inited.has(Gr)){inited.add(Gr);Gr.init({kyteBase:E.kyteBase,dataBase:E.dataBase,version:E.version});}
    const run=async name=>{
      let v;try{v=await PARTS[name](rec,E);}catch(e){v={status:'unavailable',error:String(e?.message||e)};}
      if(name==='points'){rec.lidar=rec.lidar||{measurements:[],profile:null};rec.lidar.points=v;}
      else if(name==='photos'){rec.photos=v;if(v.lead&&rec.species)rec.species.photoLead=v.lead;if(v.live)setLive(rec,v.live,E);}
      else rec[name]=v;
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
          height:s.size.height,crownArea:s.size.area,distance:dd,href:dep('ALTOTreeId')?.url(p.tree_id)||null});}
      near.sort((a,b)=>a.distance-b.distance);
      rec.nearby={status:near.length?'ready':'none',radius,trees:near,basis:'Mapped trees on the loaded map tiles',
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
  async function load(input,env={},{members:maxMembers=15}={}){
    const E=envOf(env,env.metadata||null),Id=dep('ALTOTreeId'),TD=dep('ALTOTreeDetails');
    const resolved=Id?await Id.resolve(input,{base:E.dataBase,version:E.version,metadata:E.metadata}):{tree_id:input,canonical:input,status:'current',resolved_by:'input'};
    if(!resolved.tree_id){const e=new Error(resolved.note||'Not a tree ID');e.code='invalid';e.resolved=resolved;throw e;}
    let loaded;
    try{loaded=await TD.load(E.dataBase,E.version,resolved.tree_id);}
    catch(err){const e=new Error(`No tree ${resolved.tree_id} in this release.`);e.code='not_found';e.resolved=resolved;throw e;}
    const {schema,record}=loaded;
    // The crown's other records; its map marker first (it holds the crown's estimates when this record does not).
    const repId=record.datasets.identity?.current_primary_tree_id;
    const ids=[...new Set([repId,...(parse(record.datasets.identity?.members_json)||[]).map(x=>x.tree_id)])].filter(x=>x&&x!==record.tree_id);
    const got=await Promise.allSettled(ids.slice(0,maxMembers).map(x=>TD.load(E.dataBase,E.version,x).then(r=>r.record)));
    const members=got.filter(x=>x.status==='fulfilled').map(x=>x.value);
    const rec=assemble({id:record.tree_id,record,schema,members,memberCount:ids.length,metadata:E.metadata,resolved,env:E});
    Object.defineProperty(rec,'_env',{value:E,enumerable:false,writable:true});
    return rec;
  }
  // A plain copy for download or inspection (no internal fields).
  const toJSON=rec=>JSON.parse(JSON.stringify(rec));

  const api={SCHEMA,SOURCE,SURVEY_2024,METHODS,RELEASES,decodePoints,loadPoints,load,assemble,fromTile,enrich,fromMap,parcel:(rec,env,pid)=>parcel(rec,envOf(env,env.metadata||rec._env?.metadata||null),pid),setLive,toJSON,percentile,exact,tileOf,fnvShard,methodRef:(m,env={})=>methodRef(envOf(env),m),envOf,
    _internal:{receiptItems,historyFromRecord,rankEntry,irrEntry,derivedUrls,trunk,rpaRadius,RPA_FACTOR,RPA_AREA_CAP_M2,clearCache:()=>cache.clear()}};
  root.ALTOTreeRecord=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
