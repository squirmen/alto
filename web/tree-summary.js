/* One normalised description of a tree for the panel, the tree page and the Area dashboard.
 *
 * from(props, record) reads the map tile's properties (instant) and, when it has loaded, the full
 * record (one detail bucket). The full record wins where both have a value. Nothing here computes a
 * new estimate: every number is a stored release value, and each carries its basis so the interface
 * can say whether it was measured, recorded or modelled. */
(function(root){
  'use strict';
  const G=()=>root.ALTOGrowthForm,S=()=>root.ALTOSources,L=()=>root.ALTORecordLinks;
  const num=v=>v===null||v===undefined||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
  const flag=v=>v===true||v===1||v==='1';
  const UNKNOWN=/^(unknown|unidentified( tree)?|not known|species not recorded|species unrecorded|0 records found\.?|n\/a|none)$/i;
  const named=v=>typeof v==='string'&&v.trim()&&!UNKNOWN.test(v.trim())?v.trim():null;
  const parse=v=>{try{return typeof v==='string'?JSON.parse(v):v;}catch{return null;}};
  const TIER={very_likely:['Very likely a tree','good'],probable:['Probably a tree','good'],possible:['Possibly a tree (could be a hedge or large shrub)','warn'],
    unverified:['Unverified: no canopy in the 2024 survey','warn'],possible_duplicate:['Possibly the same tree as a nearby record','warn'],
    not_assessed:['Not yet checked against the 2024 survey','muted'],location_unverified:['Council position unverified','warn'],
    earlier_detection:['Earlier detection without a current crown','muted'],outside_v5_coverage:['Earlier record outside the 2024 crown survey','muted']};
  const CLASS_KIND={conifer:'conifer',palm_other:'palm',evergreen_broadleaf:'broadleaf',deciduous_broadleaf:'broadleaf'};
  function shapeKind(gfKey,speciesClass,name){
    if(gfKey){if(/conifer/.test(gfKey))return 'conifer';if(gfKey==='tree_fern')return 'fern';if(/palm/.test(gfKey))return 'palm';return 'broadleaf';}
    if(name&&/palm|nikau|cabbage tree|ti kouka/i.test(name))return 'palm';
    if(name&&/pine|kauri|totara|rimu|kahikatea|cypress|redwood|cedar|fir|matai|miro|araucaria/i.test(name))return 'conifer';
    if(name&&/fern|ponga|mamaku/i.test(name))return 'fern';
    return CLASS_KIND[speciesClass]||'broadleaf';
  }

  // The release's planning constants (pipeline/v5/assets_baseline.py), used to state how life stage
  // and replacement time were derived. They describe the stored values; nothing is recomputed.
  const CLASS_MAX_HEIGHT_M={evergreen_broadleaf:22,deciduous_broadleaf:25,conifer:35,palm_other:14};
  const CLASS_LABEL={evergreen_broadleaf:'evergreen broadleaf',deciduous_broadleaf:'deciduous broadleaf',conifer:'conifer',palm_other:'palm or palm-like'};
  const STAGE_BAND={juvenile:[0,.18],young:[.18,.35],'semi-mature':[.35,.6],mature:[.6,.9],veteran:[.9,Infinity]};
  const STAGE_NAME={juvenile:'Juvenile',young:'Young','semi-mature':'Semi-mature',mature:'Mature',veteran:'Veteran'};
  // Class rules (assets_baseline.irreplaceability): years for a new tree to regrow this crown area, or height.
  const IRR={low:['Low','under 5 years to regrow'],moderate:['Moderate','5–15 years to regrow'],
    high:['High','15–40 years to regrow'],very_high:['Very high','40–80 years to regrow'],
    effectively_irreplaceable:['Effectively irreplaceable','80+ years to regrow, or 25 m or taller']};
  function lifeStage(stage,height,klass){
    if(!STAGE_BAND[stage])return null;
    const ref=CLASS_MAX_HEIGHT_M[klass],frac=ref&&num(height)!==null?height/ref:null,[a,b]=STAGE_BAND[stage];
    const consistent=frac!==null&&frac>=a&&frac<b;
    return {key:stage,label:STAGE_NAME[stage],band:b===Infinity?`at least ${a*100}%`:`${a*100}–${b*100}%`,
      definition:'Height as a share of the reference mature height for the tree class',
      detail:consistent?`${(Math.round(height*10)/10).toLocaleString('en-NZ')} m of ${ref} m (${CLASS_LABEL[klass]}): ${Math.round(frac*100)}%`:null,age:null};
  }
  function replacement(years,area,irr,height){
    const y=num(years),a=num(area),h=num(height),i=IRR[irr]||null;
    // Effectively irreplaceable is set by either rule; say which one applies to this tree.
    let def=i?i[1]:null;
    if(irr==='effectively_irreplaceable'&&y!==null){def=y>=80?'80+ years to regrow':h!==null&&h>=25?'25 m or taller':def;}
    return {years:y,rate:y&&a?a/y:null,irreplaceability:irr||null,irrLabel:i?i[0]:null,irrDefinition:def};
  }
  // "London Plane (approx. 112)" is a scheduled group of about 112 trees; a single entry is one tree.
  function schedule(rec){
    if(rec?.notable_point_name)return {kind:'tree',name:rec.notable_point_name,label:`Scheduled tree: ${rec.notable_point_name}`,objectid:rec.notable_point_objectid??null};
    const g=rec?.notable_group_names;
    if(g){const m=String(g).match(/^(.*?)\s*\(approx\.?\s*(\d+)\)\s*$/i),name=m?m[1].trim():String(g),n=m?Number(m[2]):null;
      return {kind:'group',name,approx:n,label:n?`Scheduled group of about ${n} trees: ${name}`:`Scheduled group: ${name}`,objectid:rec.notable_group_objectids??null};}
    return null;
  }
  // Public pages or queries for a source record, where the source publishes one.
  const ARCGIS='https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services';
  function sourceHref(source,id,objectid){
    // The Council tree register service (TreeRegisterPoints) requires a token since October 2026, so
    // register IDs are shown without a link.
    if(source==='notable_trees_overlay'&&objectid!=null)return `${ARCGIS}/Notable_Trees_Overlay/FeatureServer/0/query?`+new URLSearchParams({f:'pjson',where:`OBJECTID = ${Number(objectid)}`,outFields:'*',outSR:'4326'});
    if(source==='notable_group'&&objectid!=null)return `${ARCGIS}/Notable_Group_of_Trees_Overlay/FeatureServer/0/query?`+new URLSearchParams({f:'pjson',where:`OBJECTID = ${Number(objectid)}`,outFields:'*',returnGeometry:'false'});
    if(source==='ruru_obskauri_tiaki_public'&&objectid!=null)return `${ARCGIS}/Ruru_ObsKauri_Tiaki_(Valid_and_Public)/FeatureServer/0/query?`+new URLSearchParams({f:'pjson',where:`OBJECTID = ${Number(objectid)}`,outFields:'*',outSR:'4326'});
    if(source==='osm_natural_tree'&&id){const m=String(id).match(/(node|way)\/(\d+)/);if(m)return `https://www.openstreetmap.org/${m[1]}/${m[2]}`;}
    return null;
  }
  const DATASET_SHORT={tree_register_points:'Council tree register',notable_trees_overlay:'Notable Trees schedule',osm_natural_tree:'OpenStreetMap',ruru_obskauri_tiaki_public:'Kauri survey (RŪRU)',
    lidar_pointcloud_v5:'LiDAR detection (v5)',lidar_pointcloud_v4:'LiDAR detection (v4)',lidar_inferred_canopy:'LiDAR canopy-model detection',low_canopy_promoted:'LiDAR low-canopy detection',pointcloud_missed_promoted:'LiDAR detection'};
  // Every record and code that identifies this tree, linked where the source is public.
  function identifiers(record,props,members){
    const d=record?.datasets||{},rec=d.record||{},id=d.identity||{},tree_id=record?.tree_id||props?.tree_id,out=[];
    const list=members.length?members:[{tree_id,source:rec.source_primary||props?.source_primary,source_tree_id:rec.source_tree_id||props?.source_tree_id}];
    for(const m of list){
      const self=m.tree_id===tree_id,src=m.source;
      const objectid=self?(d.source_crosswalk?.current_objectid??rec.source_object_id):null;
      out.push({kind:DATASET_SHORT[src]||String(src||'Source').replaceAll('_',' '),code:m.source_tree_id||String(m.tree_id).replace(/^akl_tree_/,''),
        href:sourceHref(src,m.source_tree_id,objectid),tree_id:m.tree_id,self,detection:/lidar|pointcloud|canopy_promoted/.test(src||'')});
    }
    if(id.seg_key&&!out.some(x=>x.code===id.seg_key))out.push({kind:'LiDAR crown',code:id.seg_key,href:null,crown:true});
    const sch=schedule(rec);
    if(sch?.kind==='group'&&sch.objectid!=null)out.push({kind:'Notable group of trees',code:`group ${sch.objectid}`,note:sch.approx?`about ${sch.approx} trees: ${sch.name}`:sch.name,href:sourceHref('notable_group',null,String(sch.objectid).split(',')[0])});
    else if(sch?.kind==='tree'&&rec.source_primary!=='notable_trees_overlay'&&sch.objectid!=null)out.push({kind:'Notable Trees schedule',code:`object ${sch.objectid}`,note:sch.name,href:sourceHref('notable_trees_overlay',null,sch.objectid)});
    const rank=x=>x.self?0:x.crown?3:x.detection?4:x.kind.startsWith('Notable')?2:1;
    out.sort((a,b)=>rank(a)-rank(b));
    if(d.source_crosswalk)out.push({kind:'Council renumbering',code:`${d.source_crosswalk.old_objectid} → ${d.source_crosswalk.current_objectid}`,href:null});
    if(d.ground)out.push({kind:'KYTE visit',code:d.ground.observed_on||'accepted',href:null});
    return out;
  }
  // One entry per canopy survey: what the release holds for it.
  function surveys(record,props){
    const d=record?.datasets||{},t=d.trajectory||null,cr=d.crown||{},ppc=d.previous_pointcloud||{},pa=d.previous_assets||{};
    return [2013,2016,2024].map(year=>{
      const h=t?num(t['h_'+year]):null,present=t?t['present_'+year]:null;
      const e={year,height:null,area:null,cover:null,outline:false,status:'matched',line:null};
      if(year===2024){
        e.height=num(cr.crown_max_chm_m)??num(props?.crown_max_chm_m)??h;e.area=num(cr.crown_area_m2)??num(props?.crown_area_m2);
        e.cover=num(ppc.canopy_cover)??num(pa.canopy_density_proxy);e.outline=e.area!==null;e.matchedHeight=h;
        if(e.height===null&&e.area===null){e.status='none';e.line='No crown in the 2024 survey';}
        return e;
      }
      if(!t){e.status='none';e.line=`No ${year} match in this release`;return e;}
      if(t.fate==='outside_historic_coverage'&&present!==1){e.status='outside';e.line=`Outside the ${year} survey area`;return e;}
      if(present===0||h===null){e.status='absent';e.line=`Not detected in the ${year} survey`;return e;}
      e.height=h;return e;
    });
  }

  function from(props={},record=null){
    const d=record?.datasets||{},rec=d.record||{},crown=d.crown||{},assets=d.assets||{},svc=d.services||{},id=d.identity||{},traj=d.trajectory||null,pc=d.pointcloud||{};
    const p={...props};
    const pick=(...vals)=>{for(const v of vals){if(v!==null&&v!==undefined&&v!=='')return v;}return null;};
    const tree_id=record?.tree_id||p.tree_id;
    const source_primary=pick(rec.source_primary,p.source_primary);
    const cls=S()?S().classify({...p,source_primary,owner_class:pick(rec.owner_class,p.owner_class),crown_pilot:pick(p.crown_pilot,crown.crown_area_m2!=null?1:null),is_protected_notable:pick(rec.is_protected_notable,p.is_protected_notable),crown_source:pick(crown.crown_source,p.crown_source),link_class:pick(d.record_link?.link_class,p.link_class)}):{};
    const detection=S()?S().DETECTION.includes(source_primary):/lidar|pointcloud|canopy_promoted/.test(source_primary||'');

    // What it is: a recorded name stays the name; otherwise the model's growth form, worded as a model.
    const common=named(pick(rec.species_common,p.species_common)),latin=named(pick(rec.species_latin,p.species_latin));
    const gfKey=G()?G().key(p,record):null,gfWording=gfKey&&G()?G().wording(gfKey):null;
    let name;
    if(common||latin)name={title:common||latin,latin:common&&latin&&latin!==common?latin:null,kind:'recorded',note:`Recorded by ${S()?S().dataset(source_primary).name:'its source'}`};
    else if(gfKey&&gfKey!=='not_determined')name={title:gfWording,latin:null,kind:'model',note:G().NOTE};
    else name={title:detection?'Tree detected from LiDAR':'Tree',latin:null,kind:'none',note:gfKey==='not_determined'?'Growth form not yet determined; no species recorded.':'No species is recorded for this tree.'};
    const growth=gfKey?{key:gfKey,wording:gfWording,shown:gfKey!=='not_determined',data:d.growth_form||null}:null;

    // Size. Height and crown are 2024 survey values; trunk is a model unless a ground visit measured it.
    const height=num(pick(crown.crown_max_chm_m,assets.height_max_m,p.height_max_m,p.crown_max_chm_m,pc.canopy_top_m));
    const area=num(pick(crown.crown_area_m2,svc.crown_area_m2,p.crown_area_m2));
    const diameter=num(pick(crown.crown_diameter_m,p.crown_diameter_m))??(area?2*Math.sqrt(area/Math.PI):null);
    const trunks=[num(assets.dbh_cm_crown_est),num(svc.dbh_cm_est),num(d.roots?.dbh_cm),num(p.dbh_cm_crown_est)].filter(v=>v!==null&&v>0);
    const dbh=num(pick(assets.dbh_cm_crown_est,p.dbh_cm_crown_est,svc.dbh_cm_est));
    const heightBasis=crown.crown_source==='record_seeded_v52'||p.crown_source==='record_seeded_v52'?'2024 survey, crown drawn from the record (awaiting confirmation)':
      (crown.crown_source||p.crown_source)==='v4_outside_v5'?'Earlier crown outside the 2024 v5 survey':height!==null?'2024 LiDAR survey, highest return in the crown':null;
    const size={height,heightBasis,area,diameter,dbh,dbhLow:trunks.length?Math.min(...trunks):null,dbhHigh:trunks.length?Math.max(...trunks):null,
      dbhBasis:'Modelled from crown size and height (not measured)',kind:shapeKind(gfKey,pick(svc.species_class,p.species_class),common||latin)};

    // Over time: the three linked surveys, honestly, with a reason for each gap.
    const fate=traj?.fate;
    const history=traj?[2013,2016,2024].map(year=>{
      const present=traj['present_'+year],h=num(traj['h_'+year]);
      const note=h!==null&&present!==0?null:fate==='outside_historic_coverage'&&year<2024?'Outside that survey':present===0?'No matching canopy':'No estimate';
      return {year,value:h!==null&&present!==0?h:null,note};
    }):null;

    // Benefits: the release's per-tree service estimates (sensitivity scenarios).
    const b={total:num(pick(svc.total_value_nzd_y,p.total_value_nzd_y)),low:num(svc.total_value_nzd_y_low),high:num(svc.total_value_nzd_y_high),
      runoffM3:num(pick(svc.avoided_runoff_m3_y,p.avoided_runoff_m3_y)),stormwaterValue:num(pick(svc.stormwater_value_nzd_y,p.stormwater_value_nzd_y)),
      carbonStored:num(pick(svc.stored_co2e_tonnes_est,p.stored_co2e_tonnes_est)),carbonValue:num(pick(svc.carbon_value_nzd_y,p.carbon_value_nzd_y)),
      sequestration:num(svc.annual_sequestration_tco2e_y_est),pm25:num(pick(svc.pm25_removed_kg_y,p.pm25_removed_kg_y)),airValue:num(pick(svc.air_quality_value_nzd_y,p.air_quality_value_nzd_y)),
      coolingValue:num(pick(svc.cooling_value_nzd_y,p.cooling_value_nzd_y)),confidence:pick(svc.valuation_confidence,p.valuation_confidence),method:svc.method_id||null,
      basis:svc.species_class_source||null,scenarioOnly:false};
    if(b.total===null&&d.scenarios?.length){b.scenarioOnly=true;b.scenarioTotal=num(d.scenarios[0].total_value_nzd_y);}

    // Status: protected is the Unitary Plan schedule; the schedule entry's name when matched.
    const isProtected=flag(pick(d.notable_link_review?.protected_from_verified_or_group_evidence,rec.is_protected_notable,p.is_protected_notable));
    const scheduleName=pick(rec.notable_point_name,rec.notable_group_names,p.notable_point_name);
    const status={protected:isProtected,schedule:isProtected?scheduleName:null,notable:false};

    // Records and sources on this crown.
    const members=(parse(id.members_json)||[]).filter(m=>m&&m.tree_id);
    const recordCount=members.length||num(p.linked_source_records)||1;
    const sourceSet=new Map();
    const add=(key,label,n=1)=>sourceSet.set(key,{key,label,count:(sourceSet.get(key)?.count||0)+n});
    if(members.length)for(const m of members){const ds=S()?S().dataset(m.source):{name:m.source};add(ds.group==='detected'?'lidar':m.source,ds.group==='detected'?'LiDAR detections':ds.name);}
    else if(source_primary)add(detection?'lidar':source_primary,detection?'LiDAR detections':(S()?S().dataset(source_primary).name:source_primary));
    if(!detection&&(crown.crown_area_m2!=null||num(p.crown_pilot)===1)&&!sourceSet.has('lidar'))add('lidar','LiDAR crown');
    if(traj&&[2013,2016].some(y=>num(traj['h_'+y])!==null))add('history','2013 / 2016 LiDAR surveys');
    if(isProtected&&source_primary!=='notable_trees_overlay'&&!members.some(m=>m.source==='notable_trees_overlay'))add('notable_match','Notable Trees schedule (matched)');
    if(d.ground)add('kyte','KYTE ground visit');
    if(d.field)add('field','Field report');
    if(d.growth_form)add('growth_form','v6 growth-form model');
    const sources=[...sourceSet.values()];

    const tierKey=pick(id.evidence_tier,crown.evidence_tier,p.evidence_tier);
    const evidence=detection&&TIER[tierKey]?{key:tierKey,label:TIER[tierKey][0],tone:TIER[tierKey][1]}:(tierKey==='location_unverified'?{key:tierKey,label:TIER[tierKey][0],tone:'warn'}:null);
    const link=L()?L().link(p,record):null;
    const lon=num(pick(rec.lon,p.lon)),lat=num(pick(rec.lat,p.lat));

    const klass=pick(svc.species_class,p.species_class);
    return {tree_id,shortId:String(tree_id||'').replace(/^akl_tree_/,''),loaded:!!record,source_primary,detection,classification:cls,
      lifeStage:lifeStage(pick(assets.life_stage,p.life_stage),height,klass),schedule:schedule({...p,...rec}),
      ids:identifiers(record,p,members),surveys:surveys(record,p),
      profile:d.previous_pointcloud?.foliage_profile||null,profileBasis:d.previous_crown?{area:num(d.previous_crown.crown_area_m2),method:d.previous_crown.method_id}:null,
      outlineInfo:{source:pick(crown.crown_source,p.crown_source),method:crown.method_id||null,smoothed:d.outline?.outline_method||null,outlineArea:num(d.outline?.outline_area_m2),cellArea:num(d.outline?.cell_area_m2),
        gapFilled:num(crown.gap_filled_fraction),merged:d.growth_form?.merged_call||null,structure:d.growth_form?.structure_call||null,records:num(id.source_records),
        oldOverlap:num(id.old_overlapping_crowns),newOverlap:num(id.new_overlapping_crowns)},
      name,growth,size,stage:pick(assets.life_stage,p.life_stage),history,fate,benefits:b,
      replacement:replacement(pick(assets.replacement_years_canopy,p.replacement_years_canopy),area,pick(assets.irreplaceability_class,p.irreplaceability_class),height),
      status,evidence,link,members,recordCount,sources,
      owner:pick(rec.owner_class,p.owner_class),sourceId:pick(rec.source_tree_id,p.source_tree_id),asOf:rec.as_of_utc||null,
      position:lon!==null&&lat!==null?{lon,lat}:null,crownSource:pick(crown.crown_source,p.crown_source),
      ground:d.ground||null,snapshot:record?.snapshot||null};
  }
  const api={from,named,TIER,schedule,sourceHref,identifiers,surveys,lifeStage,replacement,IRR,CLASS_MAX_HEIGHT_M};
  root.ALTOTreeSummary=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
