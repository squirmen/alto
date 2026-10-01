"""Stream v5 map tiles with current estimates; older detections stay selectable separately."""
from pathlib import Path
import sqlite3,json,time,math,sys,collections
import numpy as np,shapely
from pyproj import Transformer
W=Path('/data/alto/working/alto_v5_20260922');DB=W/'akl_trees.sqlite';OUT=W/'web_build';TO=Transformer.from_crs(2193,4326,always_xy=True)
DETECTION=('lidar_inferred_canopy','lidar_pointcloud_v4','lidar_pointcloud_v5','low_canopy_promoted','pointcloud_missed_promoted')
SQL='''select d.tree_id,d.lon,d.lat,d.display_role,d.crown_source,t.source_primary,t.source_tree_id,
 coalesce(g.species_common,t.species_common) as species_common,coalesce(g.species_latin,t.species_latin) as species_latin,t.species_confidence,t.owner_class,t.record_role,
 case when t.source_primary='notable_trees_overlay' or t.notable_group_match=1 or (t.notable_point_match=1 and t.notable_point_type='1') then 1 else 0 end as is_protected_notable,
 case when t.notable_point_type='2' then 1 else t.notable_point_review_required end as notable_point_review_required,t.notable_point_type,t.notable_point_name,
 cr.crown_area_m2,cr.crown_diameter_m,cr.crown_max_chm_m,cr.gap_filled_fraction,cr.ndvi_mean,
 case when t.source_primary='notable_trees_overlay' and coalesce(t.notable_point_type,'')!='1' then 'location_unverified' when d.display_role='earlier_detection' then 'earlier_detection' when d.display_role='outside_v5_coverage' then 'outside_v5_coverage' else coalesce(cr.evidence_tier,'recorded') end as evidence_tier,
 cr.evidence_reasons,ctx.in_flood_prone_area,ctx.in_flood_plain,ctx.air_temp_mean_c,ctx.fraction_paved_surfaces,
 v.species_class,v.avoided_runoff_m3_y,v.stormwater_value_nzd_y,v.stored_co2e_tonnes_est,v.carbon_value_nzd_y,v.cooling_value_nzd_y,v.air_quality_value_nzd_y,v.pm25_removed_kg_y,v.total_value_nzd_y,v.valuation_confidence,
 a.dbh_cm_crown_est,a.life_stage,a.replacement_years_canopy,a.irreplaceability_class,
 sa.growth_form,sa.growth_form_source,sa.growth_form_confidence,
 coalesce(ig.source_records,0) as linked_source_records,coalesce(ig.inventory_records,0) as linked_inventory_records
 from tree_display_v5 d join trees t using(tree_id)
 left join tree_current_crown_v5 cr using(tree_id) left join tree_current_services_v5 v using(tree_id) left join tree_current_assets_v5 a using(tree_id)
 left join tree_context_pilot ctx using(tree_id) left join tree_species_attributes sa using(tree_id) left join tree_ground_evidence g using(tree_id)
 left join tree_identity_v5 ig using(tree_id)'''
def log(*s):print(time.strftime('%H:%M:%S'),*s,flush=True)
def properties(r):
 d=dict(r);d.pop('crown_wkb',None);d.pop('lon',None);d.pop('lat',None)
 if d.get('species_common') in {'0 records found.','Unknown','unknown'}:d['species_common']='Species not recorded'
 d['crown_pilot']=int(d.get('crown_area_m2') is not None);d['lidar_pilot']=d['crown_pilot']
 return {k:(round(v,3) if isinstance(v,float) else v) for k,v in d.items() if v is not None and not(isinstance(v,float) and not math.isfinite(v))}
def feature(props,geometry):return json.dumps({'type':'Feature','id':props.get('tree_id',props.get('candidate_id')),'properties':props,'geometry':geometry},ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'
def lonlat(geoms):return shapely.transform(geoms,lambda xy:np.column_stack(TO.transform(xy[:,0],xy[:,1])))
def main():
 OUT.mkdir(exist_ok=True);c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True);c.row_factory=sqlite3.Row;c.execute('pragma cache_size=-250000')
 stats=collections.Counter();totals=collections.Counter();species=collections.Counter()
 with (OUT/'points.geojsonl').open('w') as f:
  for r in c.execute(SQL):
   p=properties(r);f.write(feature(p,{'type':'Point','coordinates':[round(r['lon'],7),round(r['lat'],7)]}));stats[p['display_role']]+=1
   if p['display_role']!='earlier_detection':
    totals['trees']+=1;totals['protected']+=p['is_protected_notable'];totals['lidarInferred']+=p['source_primary'] in DETECTION
    for a,b in [('totalValueNzdY','total_value_nzd_y'),('runoffM3Y','avoided_runoff_m3_y'),('carbonTco2e','stored_co2e_tonnes_est')]:totals[a]+=p.get(b,0)
    if p.get('species_common') and p['species_common']!='Species not recorded':species[p['species_common']]+=1
   if sum(stats.values())%500000==0:log('Points',sum(stats.values()))
 # Reuse the exact point properties for crowns, so values and filters agree.
 count=0
 crown_sql='select p.*,coalesce(cv.crown_wkb,old.crown_wkb) as crown_wkb from ('+SQL+") p left join tree_crown_v5 cv on cv.primary_tree_id=p.tree_id left join tree_crown_v4 old on old.primary_tree_id=p.tree_id and p.crown_source='v4_outside_v5' where cv.crown_wkb is not null or old.crown_wkb is not null"
 with (OUT/'crowns.geojsonl').open('w') as f:
  cursor=c.execute(crown_sql)
  while rows:=cursor.fetchmany(15000):
   gs=shapely.from_wkb([r['crown_wkb'] for r in rows]);valid=shapely.is_valid(gs)
   if (~valid).any():gs[~valid]=shapely.make_valid(gs[~valid])
   gs=lonlat(gs);texts=shapely.to_geojson(gs)
   for r,geo in zip(rows,texts):
    f.write('{"type":"Feature","properties":'+json.dumps(properties(r),separators=(',',':'),ensure_ascii=False)+',"geometry":'+geo+'}\n');count+=1
   if count%300000==0:log('Crowns',count)
 # Older raster crowns beyond the new footprint remain visible in their original location.
 import pyogrio,pyarrow,pyarrow.compute as pc
 legacy={r['tree_id']:properties(r) for r in c.execute(SQL+" where d.crown_source='legacy_outside_v5'")}
 log('Legacy crowns to retain',len(legacy));seen=set()
 if legacy:
  path=Path('/data/alto/working/alto_v4_20260917/legacy/tree_crowns_pilot.slim.geojson')
  with pyogrio.open_arrow(path,columns=['tree_id'],batch_size=20000,use_pyarrow=True) as source:
   meta,reader=source;geomcol=meta.get('geometry_name') or 'wkb_geometry';allowed=pyarrow.array(list(legacy))
   with (OUT/'crowns.geojsonl').open('a') as f:
    for batch in reader:
     sub=batch.filter(pc.is_in(batch.column('tree_id'),value_set=allowed))
     if not len(sub):continue
     gs=shapely.from_wkb(sub.column(geomcol).to_numpy(zero_copy_only=False));valid=shapely.is_valid(gs)
     if (~valid).any():gs[~valid]=shapely.make_valid(gs[~valid])
     for tid,geo in zip(sub.column('tree_id').to_pylist(),shapely.to_geojson(gs)):
      if tid in seen:continue
      seen.add(tid);f.write('{"type":"Feature","properties":'+json.dumps(legacy[tid],separators=(',',':'))+',"geometry":'+geo+'}\n');count+=1
 log('Legacy crowns retained',len(seen),'missing outlines',len(legacy)-len(seen))
 (W/'verification/legacy_outline_coverage.json').write_text(json.dumps({'wanted':len(legacy),'written':len(seen),'missing_ids':sorted(set(legacy)-seen)}))
 totals['crowns']=count
 count=0;classes=collections.Counter()
 with (OUT/'near_canopy.geojsonl').open('w') as f:
  cursor=c.execute('select seg_key,canopy_class,height_m,crown_area_m2,crown_diameter_m,ndvi_mean,aerial_greenness,multi_return_fraction,n_veg_returns,gap_filled_fraction,crown_wkb from tree_near_canopy_v5')
  while rows:=cursor.fetchmany(20000):
   gs=lonlat(shapely.from_wkb([r['crown_wkb'] for r in rows]));bounds=shapely.total_bounds(gs);assert 170<bounds[0]<180 and -40<bounds[1]<-30
   for r,geo in zip(rows,shapely.to_geojson(gs)):
    p={k:v for k,v in dict(r).items() if k!='crown_wkb' and v is not None};p['candidate_id']=p.pop('seg_key');p['in_valuation']=False
    f.write('{"type":"Feature","properties":'+json.dumps(p,separators=(',',':'))+',"geometry":'+geo+'}\n');count+=1;classes[r['canopy_class']]+=1
 log('Near canopy',count,dict(classes))
 (OUT/'totals.json').write_text(json.dumps({'totals':dict(totals),'display_roles':dict(stats),'near_canopy':dict(classes),'species_options':species.most_common(150)},indent=2));c.close()
if __name__=='__main__':main()
