from pathlib import Path
import re,json,shutil
W=Path('/data/alto/working/alto_v5_20260922');BASE=W/'live_baseline';STAGE=W/'deploy/alto_v5_upload_20260923';STAGE.mkdir(parents=True,exist_ok=True)
V='20260923-v5'
def save(name,text): (STAGE/name).write_text(text)
s=(BASE/'index.html').read_text().replace('20260918015343',V)
s=s.replace('"lidar_pointcloud_v4",','"lidar_pointcloud_v4", "lidar_pointcloud_v5",')
s=s.replace('const UNCERTAIN_TIERS = [','const UNCERTAIN_TIERS = ["location_unverified", "earlier_detection",')
s=s.replace('recorded: "Recorded tree"','recorded: "Recorded tree",\n      location_unverified: "Council position unverified",\n      earlier_detection: "Earlier detection without a unique v5 crown",\n      outside_v5_coverage: "Earlier record outside v5 coverage"')
s=s.replace('Group proposed record matches','One marker per current crown')
s=s.replace('<div>\n          <label>Canopy growth · 2016→2024</label>', '<div hidden>\n          <label>Canopy growth · 2016→2024</label>')
s=s.replace('<span>Canopy by board</span>','<span>Canopy by board · earlier raster</span>')
s=s.replace('<span>Tree change ’13–’24</span>','<span>Canopy history ’13–’24</span>')
s=s.replace('Estimated root space based on the crown, nearby trees and mapped buildings. Red marks where the model estimates less space. Zoom in for detail.','Earlier root-space polygons from the previous crown inputs. Current root scenarios are available in each tree profile.')
s=s.replace('<span>Root-space scenario</span>','<span>Earlier root-space layer</span>')
old='<label class="check candidate-toggle"><input id="showLowCanopy" type="checkbox"><span>Low-canopy candidates</span></label>'
new='''<details class="candidate-layers"><summary>More vegetation &amp; earlier detections</summary>
<label class="check"><input id="showLowBand" type="checkbox"><span>Low canopy · 2–3 m</span></label>
<label class="check"><input id="showSubBand" type="checkbox"><span>Low vegetation · under 2 m</span></label>
<label class="check"><input id="wideCrownOnly" type="checkbox"><span>Only crowns at least 5 m wide</span></label>
<label class="check"><input id="showEarlierDetections" type="checkbox"><span>Earlier unmatched detections</span></label>
<label class="check"><input id="showLowCanopy" type="checkbox"><span>Earlier low-canopy candidates</span></label>
<p class="control-note">The low vegetation layers remain separate from tree counts and service estimates. Earlier detections retain their original records.</p></details>'''
assert old in s;s=s.replace(old,new)
s=s.replace('showLowCanopy: false,','showLowCanopy: false,\n      showLowBand:false, showSubBand:false, wideCrownOnly:false, showEarlierDetections:false,')
s=s.replace('const conditions = ["all"];','const conditions = ["all"];\n      if(!state.showEarlierDetections)conditions.push(["!=",["get","display_role"],"earlier_detection"]);',1)
s=s.replace('conditions.push(["!=", ["get", "species_confidence"], "pointcloud_v4_no_species"]);','conditions.push(["!=", ["get", "species_confidence"], "pointcloud_v4_no_species"]);\n        conditions.push(["!=",["get","species_confidence"],"pointcloud_v5_no_species"]);')
s=s.replace('"akl-points": {','"akl-near-canopy": {type:"vector",url:vq(`pmtiles://${DATA_BASE}/near_canopy.pmtiles`)},\n          "akl-points": {',1)
layer='''{
 id:"near-canopy",type:"fill",source:"akl-near-canopy","source-layer":"near_canopy",minzoom:12,layout:{visibility:"none"},paint:{"fill-color":["match",["get","canopy_class"],"low_canopy","#8fa955","#c0b97f"],"fill-opacity":0.38,"fill-outline-color":"#6b7850"}
 },
 '''
# Place above crown fills but below tree markers.
s=s.replace('id: "low-candidates",', 'id: "low-candidates",',1)
pos=s.index('          {\n            id: "low-candidates",');s=s[:pos]+'          '+layer+s[pos:]
s=s.replace('const filter = buildFilter();','''const filter = buildFilter();
      if(map.getLayer('near-canopy')){
        const bands=[];if(state.showLowBand)bands.push('low_canopy');if(state.showSubBand)bands.push('sub_canopy');
        map.setLayoutProperty('near-canopy','visibility',bands.length?'visible':'none');
        map.setFilter('near-canopy',['all',['in',['get','canopy_class'],['literal',bands]],...(state.wideCrownOnly?[[">=",["get","crown_diameter_m"],5]]:[])]);
      }''',1)
s=s.replace('document.getElementById("colourBy").addEventListener("change", applyColourMode);','''document.getElementById("colourBy").addEventListener("change", applyColourMode);
    for(const key of ['showLowBand','showSubBand','wideCrownOnly','showEarlierDetections'])document.getElementById(key).addEventListener('change',event=>{state[key]=event.target.checked;applyFilters();});
    map.on('click','near-canopy',event=>{const f=event.features?.[0];if(!f)return;const p=f.properties;new maplibregl.Popup({closeButton:true}).setLngLat(event.lngLat).setHTML(`<strong>${p.canopy_class==='low_canopy'?'Low canopy · 2–3 m':'Low vegetation · under 2 m'}</strong><p>Height ${Number(p.height_m).toFixed(1)} m · crown ${Number(p.crown_area_m2).toFixed(1)} m²</p><p>Vegetation candidate; excluded from tree service totals.</p>`).addTo(map);});''')
s=s.replace('state.growthFilters.clear(); state.showUnknown = true;',"state.growthFilters.clear(); state.showEarlierDetections=false;document.getElementById('showEarlierDetections').checked=false; state.showUnknown = true;")
s=s.replace('`${summary.count.toLocaleString("en-NZ")} records · ${grouped.groups.length} proposed groups`','`${summary.count.toLocaleString("en-NZ")} markers · ${grouped.groups.length} crowns with linked records`')
s=s.replace('"Source records drawn"','"Map markers drawn"').replace('"Markers after grouping"','"Current view markers"').replace('"Proposed shared-tree groups"','"Crowns with linked source records"')
s=s.replace('Summarises source records after filters. Grouped markers show proposed matches; counts are provisional. Crown area adds every record’s crown estimate, including overlaps and possible duplicates. Zoomed-out tiles omit records. Taxon counts include genus-only identifications and unresolved common names.','Summarises the drawn map markers after filters. One marker represents each current crown; several source records can share it. Crown area is a sum of footprints, including overlaps, rather than land-cover percentage. Zoomed-out tiles show a sample. Taxon counts include genus-only and unresolved common names.')
s=s.replace('Original source records within the current map bounds after filters and tile sampling. Includes all visible members of proposed groups. Identity hypotheses are separate from raw measurements.','Drawn v5 crown representatives and source records after filters and tile sampling. Linked source records remain in the per-tree details.')
s=s.replace('lidar_pointcloud_v4: "2024 LiDAR point cloud",','lidar_pointcloud_v4: "2024 LiDAR point cloud",\n        lidar_pointcloud_v5: "2024 LiDAR and NDVI crown detection",')
s=s.replace('const extra=document.getElementById(\'profileRichData\');\n        extra.innerHTML=',"let extra=document.getElementById('profileRichData');\n        if(!extra){extra=document.createElement('div');extra.className='pp-section';profileBody.append(extra);}\n        extra.innerHTML=")
s=s.replace('<h3>Coverage and limitations</h3>','''<h3>V5 crown redraw</h3><p>V5 combines the 2024 laser survey with aerial NDVI to redraw the canopy. Fewer or different crowns reflect the new segmentation. Earlier detections, dimensions and field observations remain in each tree’s full record.</p><p>Unverified Council notable-tree positions stay separate from automatic crown matches. Crown boundaries can still split one tree or join several trees. <a href="./v5-methods.html">Read the v5 release notes</a>.</p><h3>Coverage and limitations</h3>''')
s=s.replace('<span>total trees</span>','<span>current map markers</span>')
s=s.replace('Service totals exclude nominal crownless-tree scenarios.','Service totals use current map representatives. Lower vegetation and hidden earlier detections are excluded; estimates depend on the stored model assumptions.')
s=s.replace('Some current trees have no usable laser returns.','Records outside the v5 footprint retain earlier measurements. Unmatched records remain available for review.')
# Totals and species are filled only after exports have passed.
if (W/'web_build/totals.json').exists():
 t=json.loads((W/'web_build/totals.json').read_text());s=re.sub(r'const PILOT_TOTALS = \{.*?\};','const PILOT_TOTALS = '+json.dumps(t['totals'])+';',s,flags=re.S)
 s=re.sub(r'const SPECIES_OPTIONS = \[.*?\];','const SPECIES_OPTIONS = '+json.dumps(t['species_options'],ensure_ascii=False)+';',s,flags=re.S)
save('index.html',s)
for name in ['tree-details.js','tree-evidence.js','tree-model.js','tree-future.js','tree-architecture.js','map-analysis.js','observatory.css']:
 s=(BASE/name).read_text()
 if name=='tree-details.js':
  s=s.replace("['record','lidar','crown','assets','context','pointcloud','species','services']","['record','context','species','assets','services','pointcloud','crown','ground']")
  s=s.replace("if(p){merged.species_class=p.predicted_species_class;merged.species_class_confidence=p.species_class_confidence;}","if(p&&!merged.species_class){merged.species_class=p.predicted_species_class;merged.species_class_confidence=p.species_class_confidence;}")
  s=s.replace('return merged;','if(d.location_review){merged.notable_point_review_required=1;merged.evidence_tier="location_unverified";}if(d.notable_link_review){merged.is_protected_notable=d.notable_link_review.protected_from_verified_or_group_evidence;merged.notable_point_review_required=1;}\n    return merged;',1)
  s=s.replace("name==='foliage_profile'","name==='foliage_profile'||name.endsWith('_json')")
 if name=='tree-evidence.js':
  s=s.replace("const d=r.datasets.record || {};","const d={...(r.datasets.record||{}),...Object.fromEntries(Object.entries(r.datasets.ground||{}).filter(([k,v])=>['species_common','species_latin'].includes(k)&&v))};")
  s=s.replace("const height = number(a.height_p95_m) ?? number(c.crown_max_chm_m) ?? number(d.lidar?.chm_local_max_2m_m);", "const height = number(c.crown_max_chm_m) ?? number(a.height_max_m) ?? number(a.height_p95_m);")
  s=s.replace("const heightBasis = number(a.height_p95_m)!==null ? '95th percentile of canopy raster heights' : number(c.crown_max_chm_m)!==null ? 'Maximum canopy raster height' : 'Local canopy raster maximum';", "const heightBasis = c.crown_source==='v5'?'V5 segmented canopy maximum, 2024 survey':c.crown_source==='v4_outside_v5'?'Earlier crown outside the v5 footprint':'Stored canopy estimate';")
  s=s.replace("d.record?.source_primary==='lidar_inferred_canopy'", "['lidar_inferred_canopy','lidar_pointcloud_v4','lidar_pointcloud_v5'].includes(d.record?.source_primary)")
  s=s.replace('Canopy heights linked across three surveys.','Preserved canopy heights linked across three surveys. The 2024 history uses its original matching geometry; current v5 dimensions are shown above.')
 if name=='tree-architecture.js':
  s=s.replace('not identified|none|null|mixed', 'not identified|species not recorded|0 records found\\.|none|null|mixed')
  s=s.replace("const automatic=id;if(override", "const relatedTemplate=/^metrosideros kermadecensis\\b/.test(latin)&&id==='pohutukawa';const automatic=id;if(override")
  s=s.replace("return {id,...catalogue[id],automatic,basis,", "return {id,...catalogue[id],relatedTemplate,automatic,basis,")
  s=s.replace("r=d.record||{},latin=normal(r.species_latin||r.species_latin_raw),common=normal(r.species_common||r.species_common_raw)","r=d.record||{},observed=d.ground||{},latin=normal(observed.species_latin||r.species_latin||r.species_latin_raw),common=normal(observed.species_common||r.species_common||r.species_common_raw)")
  s=s.replace("basis='recorded_taxon'", "basis=observed.species_latin||observed.species_common?'field_report_taxon':'recorded_taxon'")
  s=s.replace('^metrosideros excelsa', '^metrosideros (?:excelsa|kermadecensis)')
  s=s.replace('recordedName:r.species_latin||r.species_common||null', 'recordedName:observed.species_latin||observed.species_common||r.species_latin||r.species_common||null')
 if name=='tree-model.js':
  s=s.replace("p.architecture.basis==='recorded_taxon'?'Recorded name':'Estimated type'", "p.architecture.basis==='field_report_taxon'?'Field report':p.architecture.basis==='recorded_taxon'?'Recorded name':'Estimated type'")
  s=s.replace("p.architecture.description+(p.assumed", "p.architecture.description+(p.architecture.relatedTemplate?' Uses the related pōhutukawa form as a provisional template for the reported Kermadec species.':'')+(p.assumed")
  s=s.replace("if(host.dataset.mounted)return;host.dataset.mounted='true';","if(host.dataset.mounted)return;host.dataset.mounted='true';\n    if(record.datasets.location_review){host.innerHTML='<p>Locate this source entry before building an individual-tree model. The field-report links above can help identify the right tree.</p>';return;}")
  s=s.replace("const rootRadius=pos(d.roots?.effective_radius_m)","const rootRadius=pos(d.roots?.effective_radius_m)||pos(d.roots?.foraging_radius_m)")
  s=s.replace("'Laser-return canopy top'","'Segmented canopy maximum'").replace("'Canopy raster maximum'","'Segmented canopy maximum'")
 if name=='map-analysis.js':
  s=s.replace('unknown|unidentified|not known|n\\/a|none|null','unknown|unidentified|not known|species not recorded|0 records found\\.|n\\/a|none|null')
  s=s.replace('if (flag(p.pc_canopy_present))','if (flag(p.pc_canopy_present)||p.crown_source===\'v5\')')
 if name=='tree-future.js':
  s=s.replace("if(!model.projection.neighbour_trend_weight)return record;", "if(record.datasets.identity)return {...record,model_context:{local_growth:null,local_growth_unavailable:true}};\n    if(!model.projection.neighbour_trend_weight)return record;")
  s=s.replace('String(model.database_mtime_ns))return','String(model.application_database_mtime_ns||model.database_mtime_ns))return')
  s=s.replace("const h=detected(t.present_2024)&&valid(t.h_2024)?Number(t.h_2024):valid(c.crown_max_chm_m)?Number(c.crown_max_chm_m):null;", "const h=valid(c.crown_max_chm_m)?Number(c.crown_max_chm_m):record.datasets.identity?null:detected(t.present_2024)&&valid(t.h_2024)?Number(t.h_2024):null;")
  s=s.replace('personal=(h-Number(t[\'h_\'+year]))/span;',"personal=(Number(t.h_2024)-Number(t['h_'+year]))/span;")
  s=s.replace('if(detected(t.present_2024)&&valid(t.h_2024)){','if(detected(t.present_2024)&&valid(t.h_2024)&&!(record.datasets.identity?.old_overlapping_crowns>1||record.datasets.identity?.new_overlapping_crowns>1)){')
  s=s.replace("let html='<h3>A possible future</h3>","let html='<h3>A possible future</h3>")
  s=s.replace("html+='</div><details><summary>How this scenario was calculated</summary>';", "html+='</div><details><summary>How this scenario was calculated</summary>';\n    if(record.datasets.identity)html+='<p>The earlier fitted model is applied to the current crown height. Its original benchmark is retained; transfer to the v5 redraw has yet to be tested. Nearby-history weighting is omitted pending a new spatial fit.</p>';" )
 if name=='observatory.css':s+='\n.candidate-layers summary{cursor:pointer;font-weight:600;padding:.35rem 0}.candidate-layers .check{margin:.45rem 0}.candidate-layers .control-note{margin:.4rem 0}\n'
 save(name,s)
shutil.copy(W/'code/tree-identity-v5.js',STAGE/'tree-identity.js')
print(STAGE)
