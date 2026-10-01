"""Build additive v5 crown, identity and evidence tables in an isolated v4 copy.
No historical tree record or older measurement is deleted. Point links and polygon
lineage are spatial evidence, not assertions that crowns are individual organisms.
"""
from pathlib import Path
import sqlite3,json,math,time,sys
from datetime import datetime,timezone
import numpy as np,pandas as pd,pyarrow.parquet as pq,shapely
from shapely.geometry import Point,box
from shapely.strtree import STRtree
from scipy.spatial import cKDTree
from pyproj import Transformer
W=Path('/data/alto/working/alto_v5_20260922');DB=W/'akl_trees.sqlite'
SOURCE=Path('/data/alto/working/crowns_v5_full/crowns')
STAMP=datetime.now(timezone.utc).isoformat();TO4326=Transformer.from_crs(2193,4326,always_xy=True)
DETECTION={'lidar_inferred_canopy','lidar_pointcloud_v4','lidar_pointcloud_v5','low_canopy_promoted','pointcloud_missed_promoted'}
def log(*a):print(time.strftime('%H:%M:%S'),*a,flush=True)
def setup(c):
 c.executescript('''
 create table if not exists tree_crown_v5(seg_key text primary key,tile text,x_2193 real,y_2193 real,lon real,lat real,height_m real,crown_area_m2 real,crown_diameter_m real,mean_veg_height_m real,n_veg_returns integer,n_building_returns integer,n_unclassified_returns integer,n_bridge_returns integer,n_water_returns integer,n_ground_returns integer,multi_return_fraction real,intensity_mean real,aerial_greenness real,ndvi_mean real,elongation real,bbox_fill real,gap_filled_fraction real,canopy_class text,crown_wkb blob,primary_tree_id text,evidence_tier text,evidence_reasons text,method_id text,created_at_utc text);
 create table if not exists tree_near_canopy_v5 as select * from tree_crown_v5 where 0;
 create table if not exists v5_point_candidates(tree_id text,seg_key text,top_distance_m real,priority integer,old_area_m2 real,primary key(tree_id,seg_key));
 create table if not exists tree_crown_lineage_v5(old_tree_id text,old_seg_key text,new_seg_key text,intersection_m2 real,old_fraction real,new_fraction real,primary key(old_seg_key,new_seg_key));
 create table if not exists v5_geometry_corrections(seg_key text primary key,original_valid integer,original_reported_area_m2 real,published_polygon_area_m2 real);
 create table if not exists v5_tile_build(tile text primary key,trees integer,near_canopy integer,links integer,lineage integer,source_file text);
 ''');c.commit()
def tier(r):
 h,a,n=r.height_m,r.crown_area_m2,r.n_veg_returns
 reasons=[]
 if h<5:reasons.append('under 5 m tall')
 if a<4:reasons.append('small crown')
 if n<25:reasons.append('few vegetation returns')
 if r.elongation>3.5:reasons.append('elongated crown')
 if (r.multi_return_fraction or 0)<.2:reasons.append('few multiple returns')
 if r.n_building_returns>.5*max(n,1):reasons.append('many building returns in footprint')
 possible=a<2 or n<8 or r.elongation>5 or r.n_building_returns>n or (r.multi_return_fraction or 0)<.1
 return ('possible' if possible else 'probable' if reasons else 'very_likely','; '.join(reasons))
def main():
 c=sqlite3.connect(DB);c.execute('pragma journal_mode=WAL');c.execute('pragma synchronous=NORMAL');c.execute('pragma cache_size=-250000');setup(c)
 coverage=json.loads((W/'verification/tile_coverage.json').read_text());assert coverage['complete'] and coverage['done']==3149,coverage
 log('Loading preserved source positions')
 ex=pq.read_table(W/'existing_v5.parquet').to_pandas();xy=ex[['x','y']].to_numpy();spatial=cKDTree(xy);ids=ex.tree_id.to_numpy();oldareas=ex.old_area.to_numpy();src=ex.source_primary.to_numpy()
 allowed=~((src=='notable_trees_overlay')&(ex.notable_type.fillna('').to_numpy()!='1'))
 priority=np.where(np.isin(src,list(DETECTION)),3,1)
 ground={r[0] for r in c.execute('select tree_id from tree_ground_evidence')};ground.discard('akl_tree_not_336');ground.add('akl_tree_lid_1097624')
 priority[np.isin(ids,list(ground))]=0
 files={p.stem:p for p in SOURCE.glob('*.parquet')};files.update({p.stem:p for p in (W/'rerun/crowns').glob('*.parquet')})
 assert len(files)==3149, len(files)
 completed={r[0] for r in c.execute('select tile from v5_tile_build')}
 for ii,(tile,f) in enumerate(sorted(files.items()),1):
  if tile in completed:continue
  d=pq.read_table(f).to_pandas()
  if d.empty:c.execute('insert into v5_tile_build values(?,?,?,?,?,?)',(tile,0,0,0,0,str(f)));c.commit();continue
  gs=shapely.from_wkb(d.crown_wkb.to_numpy());valid=shapely.is_valid(gs);reported=d.crown_area_m2.to_numpy().copy()
  if (~valid).any():gs[~valid]=shapely.make_valid(gs[~valid])
  measured=shapely.area(gs);fixed=(~valid)|(abs(measured-reported)>.01)
  assert shapely.is_valid(gs).all() and (measured>0).all(),tile
  assert np.isin(shapely.get_type_id(gs),[3,6]).all(),tile
  d['crown_area_m2']=measured;d['crown_diameter_m']=2*np.sqrt(measured/np.pi);d['crown_wkb']=shapely.to_wkb(gs)
  ll=TO4326.transform(d.x_2193,d.y_2193);keys=[f'{tile}:{x:.2f}:{y:.2f}' for x,y in zip(d.x_2193,d.y_2193)];d['seg_key']=keys
  c.executemany('insert into v5_geometry_corrections values(?,?,?,?)',[(keys[j],int(valid[j]),float(reported[j]),float(measured[j])) for j in np.flatnonzero(fixed)])
  rows=[];near=[]
  for j,r in enumerate(d.itertuples()):
   evidence,reason=tier(r)
   row=(r.seg_key,tile,r.x_2193,r.y_2193,float(ll[0][j]),float(ll[1][j]),r.height_m,r.crown_area_m2,r.crown_diameter_m,r.mean_veg_height_m,r.n_veg_returns,r.n_building_returns,r.n_unclassified_returns,r.n_bridge_returns,r.n_water_returns,r.n_ground_returns,r.multi_return_fraction,r.intensity_mean,r.aerial_greenness,r.ndvi_mean,r.elongation,r.bbox_fill,r.gap_filled_fraction,r.canopy_class,r.crown_wkb,None,evidence,reason,r.method_id,r.created_at_utc)
   (rows if r.canopy_class=='tree' else near).append(row)
  c.executemany('insert into tree_crown_v5 values('+','.join('?'*30)+')',rows);c.executemany('insert into tree_near_canopy_v5 values('+','.join('?'*30)+')',near)
  mask=d.canopy_class.to_numpy()=='tree';polys=gs[mask];tree=STRtree(polys);td=d[mask].reset_index(drop=True);tkeys=td.seg_key.to_numpy();tx=td.x_2193.to_numpy();ty=td.y_2193.to_numpy();linkrows=[];lineage=[]
  if len(polys):
   bounds=shapely.total_bounds(polys);cx=(bounds[0]+bounds[2])/2;cy=(bounds[1]+bounds[3])/2;rad=math.hypot(bounds[2]-bounds[0],bounds[3]-bounds[1])/2+.01
   q=np.asarray(spatial.query_ball_point([cx,cy],rad),dtype=np.int64);q=q[allowed[q]]
   if len(q):
    matches=tree.query(shapely.points(xy[q]),predicate='covered_by')
    for a,b in matches.T:
     j=int(q[a]);linkrows.append((str(ids[j]),str(tkeys[b]),float(math.hypot(xy[j,0]-tx[b],xy[j,1]-ty[b])),int(priority[j]),float(oldareas[j])))
   # Actual polygon intersections, using an R-tree over the old polygons' bounds.
   old=c.execute('''select o.primary_tree_id,o.seg_key,o.crown_wkb from v5_old_crown_bounds b join tree_crown_v4 o on o.rowid=b.crown_rowid where b.minx<=? and b.maxx>=? and b.miny<=? and b.maxy>=?''',(float(bounds[2]),float(bounds[0]),float(bounds[3]),float(bounds[1]))).fetchall()
   if old:
    og=shapely.from_wkb([r[2] for r in old]);ov=shapely.is_valid(og)
    if (~ov).any():og[~ov]=shapely.make_valid(og[~ov])
    pairs=tree.query(og,predicate='intersects')
    if pairs.shape[1]:
     areas=shapely.area(shapely.intersection(og[pairs[0]],polys[pairs[1]]));oa=shapely.area(og);na=shapely.area(polys)
     for (a,b),area in zip(pairs.T,areas):
      if area<.25:continue
      lineage.append((old[a][0],old[a][1],str(tkeys[b]),float(area),float(area/oa[a]),float(area/na[b])))
  c.executemany('insert or ignore into v5_point_candidates values(?,?,?,?,?)',linkrows);c.executemany('insert or ignore into tree_crown_lineage_v5 values(?,?,?,?,?,?)',lineage)
  c.execute('insert into v5_tile_build values(?,?,?,?,?,?)',(tile,len(rows),len(near),len(linkrows),len(lineage),str(f)));c.commit()
  if ii%50==0:log('Processed tiles',ii,'of',len(files))
 log('All available tile geometry loaded; assigning stable display identities')
 c.executescript('''
 create index if not exists idx_v5_candidates_seg on v5_point_candidates(seg_key);
 create index if not exists idx_v5_lineage_old on tree_crown_lineage_v5(old_tree_id);
 create index if not exists idx_v5_lineage_new on tree_crown_lineage_v5(new_seg_key);
 create table if not exists tree_crown_v5_links as select p.* from v5_point_candidates p join (select tree_id from v5_point_candidates group by tree_id having count(*)=1) u using(tree_id);
 create unique index if not exists idx_v5_links_tree on tree_crown_v5_links(tree_id);
 create index if not exists idx_v5_links_seg on tree_crown_v5_links(seg_key);
 create table if not exists v5_primary_selection as select seg_key,tree_id from (select seg_key,tree_id,row_number() over(partition by seg_key order by priority,old_area_m2 desc,top_distance_m,tree_id) as rank from tree_crown_v5_links) where rank=1;
 create unique index if not exists idx_v5_primary_seg on v5_primary_selection(seg_key);
 update tree_crown_v5 set primary_tree_id=(select p.tree_id from v5_primary_selection p where p.seg_key=tree_crown_v5.seg_key) where primary_tree_id is null;
 ''');c.commit()
 # Names for genuinely unclaimed new detections use a new prefix, never reusing a v4 grid ID.
 import hashlib
 unnamed=c.execute('select seg_key,x_2193,y_2193,lon,lat from tree_crown_v5 where primary_tree_id is null').fetchall();log('New crown IDs',len(unnamed))
 newrows=[];up=[]
 for key,x,y,lon,lat in unnamed:
  tid='akl_tree_pc5_'+hashlib.sha256(key.encode()).hexdigest()[:20];up.append((tid,key));newrows.append((tid,'lidar_pointcloud_v5',key,'Unknown','pointcloud_v5_no_species','LiDAR point-cloud detection',lon,lat,'remote_sensing_detection',STAMP))
 c.executemany('insert into trees(tree_id,source_primary,source_tree_id,species_common,species_confidence,owner_class,lon,lat,record_role,as_of_utc) values(?,?,?,?,?,?,?,?,?,?)',newrows)
 c.executemany('update tree_crown_v5 set primary_tree_id=? where seg_key=?',up);c.execute('create unique index if not exists idx_v5_crown_primary on tree_crown_v5(primary_tree_id)');c.commit()
 # One current evidence record per original ID, plus every new detection; ambiguous links are retained separately.
 c.executescript('''
 create table if not exists tree_evidence_v5 as
 select t.tree_id,coalesce(l.seg_key,p.seg_key) as seg_key,coalesce(cv.primary_tree_id,p.primary_tree_id) as current_primary_tree_id,
 case when t.source_primary='notable_trees_overlay' and coalesce(t.notable_point_type,'')!='1' then 'location_unverified'
 when p.primary_tree_id is not null then p.evidence_tier when l.seg_key is not null then 'shared_crown_candidate' else 'unmatched' end as evidence_tier,
 case when p.primary_tree_id is not null then 'primary' when l.seg_key is not null then 'same_crown_candidate' else 'unlinked' end as link_role,
 coalesce(cv.height_m,p.height_m) as current_height_m,coalesce(cv.crown_area_m2,p.crown_area_m2) as current_crown_area_m2,
 l.top_distance_m,'pointcloud_v5_ndvi_watershed' as method_id
 from trees t left join tree_crown_v5_links l on l.tree_id=t.tree_id left join tree_crown_v5 cv on cv.seg_key=l.seg_key left join tree_crown_v5 p on p.primary_tree_id=t.tree_id;
 create unique index if not exists idx_v5_evidence_tree on tree_evidence_v5(tree_id);
 create index if not exists idx_v5_evidence_primary on tree_evidence_v5(current_primary_tree_id);
 ''');c.commit()
 location=Path('/data/alto/working/location_review_20260922/results')
 c.execute('create table if not exists tree_location_review_v5(tree_id text primary key,source_position_status text,source_schedule text,automatic_crown_link_allowed integer,review_note text)')
 rows=json.loads((location/'notable_location_overrides.json').read_text())['records']
 c.executemany('insert or replace into tree_location_review_v5 values(?,?,?,?,?)',[(r['tree_id'],'unverified',r['schedule'],0,'Council source position needs checking; preserve the register entry separately from crown identity.') for r in rows])
 c.execute('create table if not exists tree_field_observation_v5(tree_id text primary key,observed_on text,observation_json text)')
 obs=json.loads((location/'dps_field_observation.json').read_text())
 for tid in [obs['candidate_schedule_association']['alto_source_record_id'],*obs['reported_same_tree_ids'],*obs['possible_same_tree_ids']]:c.execute('insert or replace into tree_field_observation_v5 values(?,?,?)',(tid,obs['reported_on'],json.dumps(obs)))
 c.execute('create table if not exists notable_source_crosswalk_v5(tree_id text primary key,old_objectid text,current_objectid text,old_globalid text,current_globalid text,source_snapshot_sha256 text,match_method text)')
 cross=json.loads((location/'identity_reconciliation/crosswalk.json').read_text())
 c.executemany('insert or replace into notable_source_crosswalk_v5 values(?,?,?,?,?,?,?)',[(r['alto_tree_id'],str(r['original_objectid']),str(r['current_objectid']),r['original_globalid'],r['current_globalid'],cross['source_sha256'],r['method']) for r in cross['records']])
 c.commit();c.execute('pragma wal_checkpoint(TRUNCATE)')
 summary={t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['trees','tree_crown_v5','tree_near_canopy_v5','tree_crown_v5_links','tree_crown_lineage_v5','tree_evidence_v5']};summary['evidence_tiers']=dict(c.execute('select evidence_tier,count(*) from tree_evidence_v5 group by 1'))
 (W/'verification/build_summary.json').write_text(json.dumps(summary,indent=2));log(summary);c.close()
if __name__=='__main__':main()
