/* One normalised description of a tree for the panel, the tree page and the Area dashboard.
 *
 * from(props, record) reads the map tile's properties (instant) and, when it has loaded, the full
 * record (one detail bucket). The full record wins where both have a value. Nothing here computes a
 * new estimate: every number is a stored release value, and each carries its basis so the interface
 * can say whether it was measured, recorded or modelled. */
(function(root){
  'use strict';
  const G=()=>root.ALTOGrowthForm,S=()=>root.ALTOSources,L=()=>root.ALTORecordLinks;
  const F=root.ALTOFormat||(typeof require==='function'?require('./alto-format.js'):null);   // one rule set (FE-16)
  const num=F.num;
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

  // The release's planning constants (pipeline/v5/assets_baseline.py), used to state how the height class
  // and replacement time were derived. They describe the stored values; nothing is recomputed.
  const CLASS_MAX_HEIGHT_M={evergreen_broadleaf:22,deciduous_broadleaf:25,conifer:35,palm_other:14};
  const CLASS_LABEL={evergreen_broadleaf:'evergreen broadleaf',deciduous_broadleaf:'deciduous broadleaf',conifer:'conifer',palm_other:'palm or palm-like'};
  // Height class (decision TS-07, 16 Oct 2026): height as a share of the class reference height, in five classes named
  // by size, from height only. Release 6.3 stores height_class (the keys below) with its share in the size dataset;
  // releases up to 6.2 stored the same classes as life_stage under life-stage words (the fifth column). The interface
  // shows only the size names; "veteran" is kept for veteran features recorded in the field.
  // [key, name, from %, to % (null: no upper bound), release 6.2 life_stage key]; the one table for the panel, the tree
  // page and Area.
  const HEIGHT_CLASS=[['very_small','Very small',0,18,'juvenile'],['small','Small',18,35,'young'],['medium','Medium',35,60,'semi-mature'],
    ['large','Large',60,90,'mature'],['very_large','Very large',90,null,'veteran']];
  // A class by its key or by the life_stage key release 6.2 stored it under.
  const heightClass=key=>{const c=HEIGHT_CLASS.find(x=>x[0]===key||x[4]===key);return c?{key:c[0],label:c[1],from:c[2],to:c[3],stored62:c[4]}:null;};
  // "under 18%", "18–35%", "90% or more".
  const bandText=c=>c.from===0?`under ${c.to}%`:c.to===null?`${c.from}% or more`:`${c.from}–${c.to}%`;
  const scaleText=()=>HEIGHT_CLASS.map(c=>`${c[1].toLowerCase()} ${bandText(heightClass(c[0]))}`).join(', ');
  // A height share as printed: whole per cent rounded down, so it never reads as the next class (84.8% of a large tree
  // prints 84%; 89.9% prints 89%, never 90%); null when the share falls outside the band of the stored class, so a number
  // never contradicts the class.
  function sharePct(share,c){
    const s=num(share);if(s===null||!c||s<c.from||(c.to!==null&&s>=c.to))return null;
    const p=Math.max(Math.floor(s+1e-9),c.from);return c.to===null?p:Math.min(p,c.to-1);
  }
  // Class rules (assets_baseline.irreplaceability, releases up to 6.2): years for a new tree to regrow this crown area,
  // or height (every crown 25 m or taller was placed in the top class: retired in release 6.3).
  const IRR={low:['Low','under 5 years to regrow'],moderate:['Moderate','5–15 years to regrow'],
    high:['High','15–40 years to regrow'],very_high:['Very high','40–80 years to regrow'],
    effectively_irreplaceable:['Effectively irreplaceable','80+ years to regrow, or 25 m or taller']};
  // Crown replacement time (release 6.3): the band of the years a newly planted tree would take to grow a crown of this
  // area at its class's planning rate, from the years alone. [key, name, rule]
  const BANDS=[['under_5y','Under 5 years','under 5 years'],['5_15y','5–15 years','5 to 15 years'],['15_40y','15–40 years','15 to 40 years'],
    ['40_80y','40–80 years','40 to 80 years'],['80y_plus','80 years or more','80 years or more']];
  const band=key=>{const b=BANDS.find(x=>x[0]===key);return b?{key:b[0],label:b[1],rule:b[2]}:null;};
  // Why a crown is not classed (release 6.3 size.not_classed_reason).
  const NOT_CLASSED={under_5m:'crown under 5 m tall',height_not_plausible:'height not plausible',production_forest:'LCDB Exotic Forest',no_estimate:'no crown estimate'};
  // The stored class as its height class: release 6.3 gives the share (rounded down to 0.1% so it lies in its class);
  // release 6.2's share is the page's own division of the crown height by the class reference height.
  function lifeStage(stage,height,klass,stored=null){
    const c=heightClass(stage);if(!c)return null;
    const ref=num(stored?.ref)??CLASS_MAX_HEIGHT_M[klass]??null,given=num(stored?.share);
    const pct=given!==null?sharePct(given,c):ref&&num(height)!==null?sharePct(height/ref*100,c):null;
    const k=stored?.klass||klass;
    return {key:c.key,label:c.label,band:bandText(c),stored62:c.stored62,share:pct,ref,klass:k||null,release63:!!stored,
      definition:'Height as a share of the reference height for the tree class',
      detail:pct!==null&&ref&&num(height)!==null?`${(Math.round(height*10)/10).toLocaleString('en-NZ')} m of ${ref} m (${CLASS_LABEL[k]||'tree class'}): ${pct}%`:null,age:null};
  }
  function replacement(years,area,irr,height,v63=null){
    const y=num(years),a=num(area),h=num(height);
    if(v63){
      // Release 6.3: a band from the years alone, or not classed with its reason; 25 m or taller is a separate fact.
      const b=band(v63.band),why=v63.notClassed||null;
      return {years:y,rate:num(v63.rate)??(y&&a?a/y:null),release63:true,band:b,notClassed:why?{key:why,label:NOT_CLASSED[why]||String(why).replace(/_/g,' ')}:null,
        tallTree:v63.tallTree===null||v63.tallTree===undefined?(h!==null?h>=25:null):!!Number(v63.tallTree),irreplaceability:null,irrLabel:null,irrDefinition:null};
    }
    const i=IRR[irr]||null;
    // Effectively irreplaceable is set by either rule; say which one applies to this tree.
    let def=i?i[1]:null;
    if(irr==='effectively_irreplaceable'&&y!==null){def=y>=80?'80+ years to regrow':h!==null&&h>=25?'25 m or taller':def;}
    return {years:y,rate:y&&a?a/y:null,release63:false,band:null,notClassed:null,tallTree:null,irreplaceability:irr||null,irrLabel:i?i[0]:null,irrDefinition:def};
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
    // register IDs are shown without a link; the record names the copy ALTO uses (retrieved June 2026).
    // Each dataset's own page and credit come from credits.js (ALTOCredits.dataset).
    if(source==='notable_trees_overlay'&&objectid!=null)return `${ARCGIS}/Notable_Trees_Overlay/FeatureServer/0/query?`+new URLSearchParams({f:'pjson',where:`OBJECTID = ${Number(objectid)}`,outFields:'*',outSR:'4326'});
    if(source==='notable_group'&&objectid!=null)return `${ARCGIS}/Notable_Group_of_Trees_Overlay/FeatureServer/0/query?`+new URLSearchParams({f:'pjson',where:`OBJECTID = ${Number(objectid)}`,outFields:'*',returnGeometry:'false'});
    if(source==='ruru_obskauri_tiaki_public'&&objectid!=null)return `${ARCGIS}/Ruru_ObsKauri_Tiaki_(Valid_and_Public)/FeatureServer/0/query?`+new URLSearchParams({f:'pjson',where:`OBJECTID = ${Number(objectid)}`,outFields:'*',outSR:'4326'});
    if(source==='osm_natural_tree'&&id){const m=String(id).match(/(node|way)\/(\d+)/);if(m)return `https://www.openstreetmap.org/${m[1]}/${m[2]}`;}
    // A New Zealand Tree Register record ("AR/0177", groups "AR/G0905") links its own page on the register.
    if(source==='nz_tree_register'&&id){const r=root.ALTOCredits?.registerRecords(id)[0];if(r)return r.href;}
    return null;
  }
  const DATASET_SHORT={tree_register_points:'Council tree register',notable_trees_overlay:'Notable Trees schedule',osm_natural_tree:'OpenStreetMap',ruru_obskauri_tiaki_public:'Kauri survey (Ruru)',
    lidar_pointcloud_v5:'LiDAR detection (v5)',lidar_pointcloud_v4:'LiDAR detection (v4)',lidar_inferred_canopy:'LiDAR canopy-model detection',low_canopy_promoted:'LiDAR low-canopy detection',pointcloud_missed_promoted:'LiDAR detection'};
  // Every record and code that identifies this tree, linked where the source is public.
  function identifiers(record,props,members){
    const d=record?.datasets||{},rec=d.record||{},id=d.identity||{},tree_id=record?.tree_id||props?.tree_id,out=[];
    const list=members.length?members:[{tree_id,source:rec.source_primary||props?.source_primary,source_tree_id:rec.source_tree_id||props?.source_tree_id}];
    for(const m of list){
      const self=m.tree_id===tree_id,src=m.source;
      const objectid=self?(d.source_crosswalk?.current_objectid??rec.source_object_id):null;
      out.push({kind:DATASET_SHORT[src]||String(src||'Source').replaceAll('_',' '),code:m.source_tree_id||String(m.tree_id).replace(/^akl_tree_/,''),
        href:sourceHref(src,m.source_tree_id,objectid),dataset:root.ALTOCredits?.dataset(src)||null,tree_id:m.tree_id,self,detection:/lidar|pointcloud|canopy_promoted/.test(src||'')});
    }
    if(id.seg_key&&!out.some(x=>x.code===id.seg_key))out.push({kind:'LiDAR crown',code:id.seg_key,href:null,crown:true});
    const sch=schedule(rec);
    if(sch?.kind==='group'&&sch.objectid!=null)out.push({kind:'Notable group of trees',code:`group ${sch.objectid}`,note:sch.approx?`about ${sch.approx} trees: ${sch.name}`:sch.name,href:sourceHref('notable_group',null,String(sch.objectid).split(',')[0]),dataset:root.ALTOCredits?.dataset('notable_group')||null});
    else if(sch?.kind==='tree'&&rec.source_primary!=='notable_trees_overlay'&&sch.objectid!=null)out.push({kind:'Notable Trees schedule',code:`object ${sch.objectid}`,note:sch.name,href:sourceHref('notable_trees_overlay',null,sch.objectid),dataset:root.ALTOCredits?.dataset('notable_trees_overlay')||null});
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
        // The 2024 height is the crown's; a record with no crown linked has none (the canopy model's value at its point
        // can be a building or a neighbour: it is kept apart as pointSample, never plotted as the tree's height).
        e.height=num(cr.crown_max_chm_m)??num(props?.crown_max_chm_m);e.area=num(cr.crown_area_m2)??num(props?.crown_area_m2);
        e.cover=num(ppc.canopy_cover)??num(pa.canopy_density_proxy);e.outline=e.area!==null;e.matchedHeight=h;
        if(e.height===null&&e.area===null){e.status='none';e.line='No crown linked in the 2024 survey';e.matchedHeight=null;
          e.pointSample=num(d.lidar?.chm_at_point_m);e.vegReturns=num(d.pointcloud?.n_veg_returns??d.previous_pointcloud?.n_vegetation);}
        return e;
      }
      if(!t){e.status='none';e.line=`No ${year} LiDAR crown is linked to this tree`;return e;}
      if(t.fate==='outside_historic_coverage'&&present!==1){e.status='outside';e.line=`Outside the ${year} survey area`;return e;}
      if(present===0||h===null){e.status='absent';e.line=`No ${year} LiDAR crown is linked to this tree`;return e;}
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

    // What it is: a recorded name stays the name, in its display form (species-names.js: macrons, sentence case; survey
    // result codes an earlier build appended to kauri survey names are left out of it; a genus-only name such as "Cherry"
    // beside Prunus serrulata takes that species' name, Japanese flowering cherry); otherwise the model's growth
    // form in the release's own wording (growth-form.js WORDING), worded as a model. A source string naming several
    // species ("Oak, Coral tree") is not a name: the title falls back to "Scheduled notable tree" or the growth form, and
    // the string is shown as "Recorded as: …".
    const N=root.ALTOSpeciesNames;
    const common=named(pick(rec.species_common,p.species_common)),latinRaw=named(pick(rec.species_latin,p.species_latin));
    // Release 6.3: the map feature's species key (sp) is the accepted binomial. Where it renames the species (11 misspelled
    // or outdated names: Platanus x acerifolia is Platanus × hispanica, Racosperma sp. is Acacia sp.) the page shows the
    // accepted name and keeps the name as supplied; a key that only drops a cultivar or names a common name changes nothing.
    const spKey=root.ALTOFields?.speciesKey(p)||null,N0=root.ALTOSpeciesNames;
    const accepted=spKey&&latinRaw&&N0&&/^(×\s?)?[A-Z][a-z-]+ ((×\s)?[a-z][a-z-]+|sp\.)$/.test(spKey)&&N0.binomial(spKey)!==N0.binomial(latinRaw)?spKey:null;
    const latin=accepted||latinRaw;
    const gfKey=G()?G().key(p,record):null,gfWording=gfKey&&G()?G().wording(gfKey):null;
    const isProtectedEarly=flag(pick(d.notable_link_review?.protected_from_verified_or_group_evidence,rec.is_protected_notable,p.is_protected_notable));
    const parsed=common&&N?N.parse(common,{latin}):{display:common,codes:null,multi:false};
    let name;
    if(common&&parsed.multi){
      const gfShown=!!gfKey&&gfKey!=='not_determined';
      name={title:isProtectedEarly?'Scheduled notable tree':gfShown?gfWording:detection?'Tree detected from LiDAR':'Tree',latin:null,kind:'recorded',multi:true,recordedAs:common,
        titleEstimate:!isProtectedEarly&&gfShown,note:`Recorded by ${S()?S().dataset(source_primary).name:'its source'}`};
    }
    else if(common||latin){const title=(common&&(parsed.display||common))||latin;
      name={title,latin:common&&latin&&(N?N.fold(latin)!==N.fold(title):latin!==common)?latin:null,kind:'recorded',multi:false,
      codes:parsed.codes||null,asSupplied:common||null,latinAsSupplied:accepted?latinRaw:null,note:`Recorded by ${S()?S().dataset(source_primary).name:'its source'}`};}
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
      (crown.crown_source||p.crown_source)==='v4_outside_v5'?'Earlier crown outside the 2024 v5 survey':height!==null?'2024 LiDAR survey, highest point of the canopy height model within the crown':null;
    const size={height,heightBasis,area,diameter,dbh,dbhLow:trunks.length?Math.min(...trunks):null,dbhHigh:trunks.length?Math.max(...trunks):null,
      dbhBasis:'Modelled from crown size and height (not measured)',kind:shapeKind(gfKey,pick(svc.species_class,p.species_class),common||latin)};

    // Over time: the three linked surveys, honestly, with a reason for each gap.
    const fate=traj?.fate;
    const history=traj?[2013,2016,2024].map(year=>{
      const present=traj['present_'+year],h=num(traj['h_'+year]);
      const note=h!==null&&present!==0?null:fate==='outside_historic_coverage'&&year<2024?'Outside that survey':present===0?'No matching canopy':'No estimate';
      return {year,value:h!==null&&present!==0?h:null,note};
    }):null;

    // Benefits: the release's per-tree service estimates (sensitivity scenarios). Release 6.3: the benefits dataset
    // (benefit_value_nzd_y, stormwater and carbon, with its band; withheld where the height is not plausible) or the map
    // feature's benefit_value_nzd_y; air-quality and cooling dollars stay in the full record only. Release 6.2: the
    // services total (stormwater, carbon, air quality and cooling). release-fields.js reads whichever the release carries.
    const FD=root.ALTOFields||(typeof require==='function'?require('./release-fields.js'):null);
    const own=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
    const hb=d.benefits?FD.benefit(d.benefits):own(p,'benefit_value_nzd_y')?FD.benefit(p):svc.total_value_nzd_y!=null?FD.benefit(svc):FD.benefit(p);
    const v63=!!d.benefits||own(p,'benefit_value_nzd_y')||!!d.size||own(p,'height_class')||own(p,'crown_replacement');
    const withheld=d.benefits?.withheld_reason||d.size?.withheld_reason||(FD.implausible(p)?'height_not_plausible':null);
    // Release 6.3 values the 103 crowns drawn outside the v5 survey on their drawn crown (services_drawn); the services
    // dataset keeps the earlier values. A withheld estimate shows no component.
    const comp=v63?(d.services_drawn||svc):svc,cut=v63&&!!withheld;
    const val=(k,...more)=>cut?null:num(pick(comp[k],p[k],...more));
    const b={total:hb?.value??null,low:hb?.low??null,high:hb?.high??null,basis:hb?.basis||null,release63:v63,withheld:withheld||null,
      components:d.benefits?.components||null,method63:d.benefits?.method_id||null,
      runoffM3:val('avoided_runoff_m3_y'),stormwaterValue:val('stormwater_value_nzd_y'),
      carbonStored:val('stored_co2e_tonnes_est'),carbonValue:val('carbon_value_nzd_y'),
      sequestration:cut?null:num(svc.annual_sequestration_tco2e_y_est),
      pm25:v63?null:num(pick(svc.pm25_removed_kg_y,p.pm25_removed_kg_y)),airValue:v63?null:num(pick(svc.air_quality_value_nzd_y,p.air_quality_value_nzd_y)),
      coolingValue:v63?null:num(pick(svc.cooling_value_nzd_y,p.cooling_value_nzd_y)),
      // Release 6.3's PM2.5 removal (g a year) and cooling index (no unit): shown only where the release publishes them.
      pm25g:cut?null:num(pick(d.benefits?.pm25_removed_g_y,p.pm25_removed_g_y)),coolingIndex:cut?null:num(pick(d.benefits?.cooling_index,p.cooling_index)),
      pm25CoolingEligible:d.benefits?num(d.benefits.release_eligible)===1:null,
      confidence:pick(svc.valuation_confidence,p.valuation_confidence),method:svc.method_id||null,
      basisSource:svc.species_class_source||null,scenarioOnly:false};
    if(b.total===null&&!withheld&&d.scenarios?.length){b.scenarioOnly=true;b.scenarioTotal=num(d.scenarios[0].total_value_nzd_y);}

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

    const klass=pick(d.size?.class_used,svc.species_class,p.species_class);
    // Height class and crown replacement time. Release 6.3: the size dataset (height_class with its share, regrowth years,
    // the band or why the crown is not classed, tall tree) or the map feature (height_class, crown_replacement,
    // replacement_years_canopy); the retired life_stage and irreplaceability_class stay in the full record only.
    // Release 6.2: life_stage, replacement_years_canopy and irreplaceability_class (assets or the map feature).
    const sz=d.size||null,size63=!!sz||own(p,'height_class')||own(p,'crown_replacement');
    const stageKey=size63?(sz?sz.height_class:FD.heightClassKey(p)):pick(assets.life_stage,p.life_stage);
    const stage=size63?lifeStage(stageKey,height,klass,{share:sz?.height_share_pct??null,ref:sz?.reference_height_m??null,klass:sz?.class_used||klass}):lifeStage(stageKey,height,klass);
    const cr=sz?sz.crown_replacement:FD.crownReplacement(p);
    const notClassed=sz?sz.not_classed_reason:cr==='not_classed'?(FD.implausible(p)?'height_not_plausible':height!==null&&height<5?'under_5m':'no_estimate'):null;
    const repl=size63?replacement(sz?sz.regrowth_years:p.replacement_years_canopy,area,null,height,{band:sz?sz.replacement_band||(cr!=='not_classed'?cr:null):cr!=='not_classed'?cr:null,
        notClassed,tallTree:sz?sz.tall_tree:null,rate:sz?.planning_rate_m2_y??null}):
      replacement(pick(assets.replacement_years_canopy,p.replacement_years_canopy),area,pick(assets.irreplaceability_class,p.irreplaceability_class),height);
    return {tree_id,shortId:String(tree_id||'').replace(/^akl_tree_/,''),loaded:!!record,source_primary,detection,classification:cls,
      lifeStage:stage,schedule:schedule({...p,...rec}),
      ids:identifiers(record,p,members),surveys:surveys(record,p),
      profile:d.previous_pointcloud?.foliage_profile||null,profileBasis:d.previous_crown?{area:num(d.previous_crown.crown_area_m2),method:d.previous_crown.method_id}:null,
      outlineInfo:{source:pick(crown.crown_source,p.crown_source),method:crown.method_id||null,smoothed:d.outline?.outline_method||null,outlineArea:num(d.outline?.outline_area_m2),cellArea:num(d.outline?.cell_area_m2),
        gapFilled:num(crown.gap_filled_fraction),merged:d.growth_form?.merged_call||null,structure:d.growth_form?.structure_call||null,records:num(id.source_records),
        oldOverlap:num(id.old_overlapping_crowns),newOverlap:num(id.new_overlapping_crowns)},
      name,growth,size,stage:stage?.key||null,history,fate,benefits:b,
      replacement:repl,release63:v63||size63,
      status,evidence,link,members,recordCount,sources,
      owner:pick(rec.owner_class,p.owner_class),sourceId:pick(rec.source_tree_id,p.source_tree_id),asOf:rec.as_of_utc||null,
      position:lon!==null&&lat!==null?{lon,lat}:null,crownSource:pick(crown.crown_source,p.crown_source),
      ground:d.ground||null,snapshot:record?.snapshot||null};
  }
  const api={from,named,TIER,schedule,sourceHref,identifiers,surveys,lifeStage,replacement,IRR,BANDS,band,NOT_CLASSED,CLASS_MAX_HEIGHT_M,HEIGHT_CLASS,heightClass,bandText,scaleText,sharePct};
  root.ALTOTreeSummary=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
