/* Where a tree's records come from, what legal status it has, and how well its records are tied to
 * a crown. These were one legend ("Tree sources") with one priority category per tree; they are
 * three separate questions and a tree can answer several of them at once.
 *
 * Facts from the release (v5.2 map tiles, 4.2 M features):
 *  - "Council Parks" and "Transport" are the owner field of the Council tree register
 *    (source tree_register_points: owner Auckland Council Parks 10,358 records, Auckland Transport
 *    28,365, owner not recorded 488). It is not a land type; the Land filter is.
 *  - The Notable Trees overlay (3,178 records) is the Unitary Plan schedule of notable trees. Every one
 *    is linked to its schedule entry; 392 register records matched to the schedule are linked too: 3,570 in all.
 *  - A crown's marker is the inventory record on it when there is one (no LiDAR-only marker carries a
 *    linked inventory record), so an inventory marker with crown_pilot = 1 has two sources: its own
 *    record and the LiDAR crown.
 *  - "No crown linked": an inventory record with no crown (crown_pilot 0); it does not mean the tree
 *    is absent. v5.2 link classes (linked, probable, drawn from the record) are on the tile. */
(function(root){
  'use strict';
  const DETECTION=['lidar_inferred_canopy','lidar_pointcloud_v4','lidar_pointcloud_v5','low_canopy_promoted','pointcloud_missed_promoted'];
  const sp=['get','source_primary'],owner=['get','owner_class'];
  const hasCrown=['==',['coalesce',['to-number',['get','crown_pilot']],0],1];
  const isDetection=['in',sp,['literal',DETECTION]];
  const COUNCIL_OWNERS=['Auckland Council Parks','Auckland Transport'];
  // Colours come from the design system through palette.js (one colour per category in every view).
  const P=root.ALTOPalette||(typeof require==='function'?require('./palette.js'):null);
  const C=(legend,key)=>P.colour(legend,key);

  // Sources. `match` is a MapLibre expression that is true when the marker has this source.
  const SOURCES=[
    {key:'register_parks',group:'council',label:'Council tree register · Parks',short:'Council tree register · Parks',colour:C('source','register_parks'),
      note:'Auckland Council tree register, owner recorded as Auckland Council Parks (parks, reserves and other Council land). Retrieved June 2026.',
      match:['all',['==',sp,'tree_register_points'],['==',owner,'Auckland Council Parks']]},
    {key:'register_at',group:'council',label:'Council tree register · Auckland Transport',short:'Council tree register · Auckland Transport',colour:C('source','register_at'),
      note:'Auckland Council tree register (incl. Auckland Transport), owner recorded as Auckland Transport (street trees). Retrieved June 2026.',
      match:['all',['==',sp,'tree_register_points'],['==',owner,'Auckland Transport']]},
    {key:'register_other',group:'council',label:'Council tree register · owner not recorded',short:'Council tree register · owner not recorded',colour:C('source','register_other'),
      note:'Auckland Council tree register records with no owner recorded. Retrieved June 2026.',
      match:['all',['==',sp,'tree_register_points'],['!',['in',['coalesce',owner,''],['literal',COUNCIL_OWNERS]]]]},
    {key:'notable',group:'council',label:'Notable Trees schedule',short:'Notable Trees schedule',colour:C('source','notable'),mark:'ringed-dot',
      note:'The Auckland Unitary Plan schedule of notable trees (Schedule 10): Notable Trees Overlay, Plans and Places, Auckland Council, CC BY 4.0. Drawn with the schedule ring.',
      match:['==',sp,'notable_trees_overlay']},
    {key:'osm',group:'community',label:'OpenStreetMap',short:'OpenStreetMap',colour:C('source','osm'),
      note:'Trees mapped by OpenStreetMap contributors. © OpenStreetMap contributors, ODbL.',match:['==',sp,'osm_natural_tree']},
    {key:'kauri',group:'community',label:'Ruru kauri survey (Auckland Council)',short:'Ruru kauri survey (Auckland Council)',colour:C('source','kauri'),
      note:'Auckland Council kauri survey records (Ruru ObsKauri Tiaki, valid and public), Bio Info Team, Environmental Services, Auckland Council. Used for kauri dieback surveillance. Not a complete record; verify before relying on it.',match:['==',sp,'ruru_obskauri_tiaki_public']},
    {key:'kyte',group:'community',label:'KYTE ground visits',short:'KYTE ground visits',colour:C('source','osm'),soon:true,
      note:'Accepted KYTE visits: on each tree page. Map filter: planned for a data release.'},
    {key:'nztr',group:'community',label:'NZ Tree Register',short:'NZ Tree Register',colour:C('source','osm'),soon:true,
      note:'New Zealand Tree Register records: planned source. Register recognition has no legal status.'},
    {key:'lidar',group:'detected',label:'LiDAR-detected tree',short:'LiDAR-detected tree',colour:C('source','lidar'),
      note:'A tree found in the 2024 LiDAR survey (airborne laser survey) that no record describes. Turning this source off hides those trees; recorded trees stay.',
      match:['any',isDetection,hasCrown]}
  ];
  const GROUPS=[['council','Council'],['community','Community records'],['detected','LiDAR survey']];
  const ACTIVE=SOURCES.filter(s=>!s.soon);
  const SOURCE_KEYS=ACTIVE.map(s=>s.key);

  // The marker's fill: its own record's source (a LiDAR colour only for LiDAR-only markers).
  function primaryExpr(){
    return ['case',
      ['==',sp,'notable_trees_overlay'],'notable',
      ['==',sp,'tree_register_points'],['match',['coalesce',owner,''],'Auckland Council Parks','register_parks','Auckland Transport','register_at','register_other'],
      ['==',sp,'osm_natural_tree'],'osm',
      ['==',sp,'ruru_obskauri_tiaki_public'],'kauri',
      'lidar'];
  }
  function colourExpr(){
    const e=['match',primaryExpr()];
    for(const s of ACTIVE)e.push(s.key,s.colour);
    e.push(C('source','lidar'));
    return e;
  }
  // Visible when any selected source is present.
  function sourceFilter(visible){
    if(!visible||SOURCE_KEYS.every(k=>visible.has(k)))return null;
    const on=ACTIVE.filter(s=>visible.has(s.key));
    if(!on.length)return ['==',['get','tree_id'],'__none__'];
    return ['any',...on.map(s=>s.match)];
  }

  // Status: linked to an entry of the Notable Trees schedule (Auckland Unitary Plan, Schedule 10). ALTO checks that
  // schedule only and never says whether a tree is protected; NZ Tree Register recognition has no legal status.
  const protectedExpr=['==',['coalesce',['to-number',['get','is_protected_notable']],0],1];
  const STATUS=[
    {key:'protected',label:'Notable Trees schedule',colour:P.token('--color-protected'),note:'Map markers linked to an entry of the Notable Trees schedule (Auckland Unitary Plan, Schedule 10): scheduled trees and scheduled groups.',match:protectedExpr},
    {key:'notable',label:'Notable (NZ Tree Register)',colour:C('source','osm'),soon:true,note:'Recognised by the New Zealand Tree Register (no legal status). Planned with the register as a source.'}
  ];
  function statusFilter(only){
    const on=STATUS.filter(s=>!s.soon&&only?.has(s.key));
    return on.length?['any',...on.map(s=>s.match)]:null;
  }

  // Data quality: how a marker's record is tied to a crown.
  const linkClass=['coalesce',['get','link_class'],''];
  const seeded=['any',['==',['get','crown_source'],'record_seeded_v52'],['==',linkClass,'drawn_from_record']];
  const unlinked=['all',['!',isDetection],['!',hasCrown]];
  const QUALITY=[
    {key:'linked',label:'Linked',colour:C('quality','linked'),note:'The record’s position falls inside a crown found in the 2024 LiDAR survey, or ALTO matched it to that crown. A LiDAR-detected tree is its own crown.',
      match:['all',['!',unlinked],['!',seeded],['!=',linkClass,'probable']]},
    {key:'probable',label:'Probable link',colour:C('quality','probable'),note:'ALTO joined the record to the most likely crown, with less certainty than a linked match.',
      match:['all',['==',linkClass,'probable'],['!',seeded]]},
    {key:'drawn',label:'Crown drawn from the record',colour:C('quality','drawn'),note:'No crown covered the record, so ALTO drew one from the 2024 LiDAR survey at its recorded position. Drawn faintly with a dashed outline until it is confirmed.',
      match:seeded},
    {key:'unlinked',label:'No crown linked',colour:C('quality','unlinked'),note:'No crown is linked to this record. The tree may still be there: the survey can miss it, or the recorded position can be off.',
      match:unlinked}
  ];
  const QUALITY_KEYS=QUALITY.map(q=>q.key);
  function qualityFilter(visible){
    if(!visible||QUALITY_KEYS.every(k=>visible.has(k)))return null;
    const on=QUALITY.filter(q=>visible.has(q.key));
    if(!on.length)return ['==',['get','tree_id'],'__none__'];
    return ['any',...on.map(q=>q.match)];
  }
  function qualityExpr(){return ['case',QUALITY[3].match,'unlinked',QUALITY[2].match,'drawn',QUALITY[1].match,'probable','linked'];}
  function qualityColourExpr(){const e=['match',qualityExpr()];for(const q of QUALITY)e.push(q.key,q.colour);e.push(C('quality','linked'));return e;}

  // The same classification for a plain properties object (counts, panels, tests).
  const num=v=>v===null||v===undefined||v===''?null:Number(v);
  function classify(p){
    const s=p?.source_primary||'',o=p?.owner_class||'',det=DETECTION.includes(s),crown=num(p?.crown_pilot)===1;
    const primary=s==='notable_trees_overlay'?'notable':s==='tree_register_points'?(o==='Auckland Council Parks'?'register_parks':o==='Auckland Transport'?'register_at':'register_other'):s==='osm_natural_tree'?'osm':s==='ruru_obskauri_tiaki_public'?'kauri':'lidar';
    const sources=new Set([primary]);if(det||crown)sources.add('lidar');
    const lc=p?.link_class||'',seed=p?.crown_source==='record_seeded_v52'||lc==='drawn_from_record';
    const quality=!det&&!crown?'unlinked':seed?'drawn':lc==='probable'?'probable':'linked';
    return {primary,sources:[...sources],protected:num(p?.is_protected_notable)===1,quality,detection:det};
  }
  const byKey=Object.fromEntries([...SOURCES,...QUALITY.map(q=>({...q,key:'q_'+q.key}))].map(s=>[s.key,s]));
  const source=k=>SOURCES.find(s=>s.key===k)||null;
  const quality=k=>QUALITY.find(q=>q.key===k)||null;

  // Names of the datasets behind a full record (tree page, panel source list).
  const DATASET={
    tree_register_points:{name:'Auckland Council tree register',kind:'Council inventory',group:'council'},
    notable_trees_overlay:{name:'Notable Trees schedule (Unitary Plan)',kind:'Council schedule',group:'council'},
    osm_natural_tree:{name:'OpenStreetMap',kind:'Community mapping',group:'community'},
    ruru_obskauri_tiaki_public:{name:'Kauri survey records (Ruru ObsKauri Tiaki, Auckland Council)',kind:'Community survey',group:'community'},
    lidar_pointcloud_v5:{name:'2024 LiDAR point cloud (v5 crown detection)',kind:'Remote sensing',group:'detected'},
    lidar_pointcloud_v4:{name:'2024 LiDAR point cloud (v4 detection)',kind:'Remote sensing',group:'detected'},
    lidar_inferred_canopy:{name:'LiDAR canopy model detection',kind:'Remote sensing',group:'detected'},
    low_canopy_promoted:{name:'LiDAR low-canopy detection',kind:'Remote sensing',group:'detected'},
    pointcloud_missed_promoted:{name:'LiDAR point-cloud detection (promoted candidate)',kind:'Remote sensing',group:'detected'},
    kyte:{name:'KYTE ground visit',kind:'Ground observation',group:'community'},
    nz_tree_register:{name:'NZ Tree Register',kind:'Community register',group:'community'}
  };
  const dataset=s=>DATASET[s]||{name:String(s||'Unknown source').replaceAll('_',' '),kind:'Source',group:'other'};

  const api={DETECTION,SOURCES,ACTIVE,GROUPS,SOURCE_KEYS,STATUS,QUALITY,QUALITY_KEYS,primaryExpr,colourExpr,sourceFilter,statusFilter,
    qualityFilter,qualityExpr,qualityColourExpr,protectedExpr,classify,source,quality,dataset,byKey};
  root.ALTOSources=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
