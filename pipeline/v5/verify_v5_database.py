from pathlib import Path
import sqlite3,json,hashlib,math,time
W=Path('/data/alto/working/alto_v5_20260922');DB=W/'akl_trees.sqlite';OLD=Path('/data/alto/working/alto_v4_20260917/akl_trees.sqlite')
c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True);o=sqlite3.connect(f'file:{OLD}?mode=ro',uri=True)
r={'checks':{},'counts':{}}
def check(name,condition,detail=None):
 r['checks'][name]={'passed':bool(condition),'detail':detail};print(name,'PASS' if condition else 'FAIL',detail or '',flush=True)
def scalar(sql):return c.execute(sql).fetchone()[0]
def digest(db,sql):
 h=hashlib.sha256();n=0
 for row in db.execute(sql):h.update((str(row[0])+'\n').encode());n+=1
 return {'records':n,'sha256':h.hexdigest()}
a=digest(o,'select tree_id from trees order by tree_id');b=digest(c,"select tree_id from trees where source_primary!='lidar_pointcloud_v5' order by tree_id");check('all_previous_tree_ids_preserved',a==b,{'v4':a,'v5_prior_ids':b})
coverage=json.loads((W/'verification/tile_coverage.json').read_text());check('all_tiles_successful',coverage['complete'] and coverage['done']==3149)
for t in ['trees','tree_crown_v5','tree_near_canopy_v5','tree_evidence_v5','tree_identity_v5','tree_current_crown_v5','tree_valuation_v5','tree_display_v5']:r['counts'][t]=scalar('select count(*) from '+t)
check('one_v5_service_estimate_per_crown',r['counts']['tree_valuation_v5']==r['counts']['tree_crown_v5'])
check('one_identity_record_per_tree',r['counts']['tree_identity_v5']==r['counts']['trees'])
check('no_low_vegetation_in_tree_layer',scalar("select count(*) from tree_crown_v5 where canopy_class!='tree' or height_m<2.995")==0)
check('all_near_canopy_excluded_from_tree_layer',scalar("select count(*) from tree_near_canopy_v5 where canopy_class='tree'")==0)
check('unverified_notable_points_unlinked',scalar("select count(*) from tree_evidence_v5 e join trees t using(tree_id) where t.source_primary='notable_trees_overlay' and coalesce(t.notable_point_type,'')!='1' and e.seg_key is not null")==0)
check('services_match_current_crown_dimensions',scalar('select count(*) from tree_valuation_v5 v join tree_crown_v5 cr on cr.primary_tree_id=v.tree_id where abs(v.crown_area_m2-cr.crown_area_m2)>.001 or abs(v.crown_max_chm_m-cr.height_m)>.001')==0)
check('no_negative_or_inverted_service_ranges',scalar('select count(*) from tree_valuation_v5 where total_value_nzd_y<0 or total_value_nzd_y_low>total_value_nzd_y or total_value_nzd_y_high<total_value_nzd_y')==0)
check('ground_observations_unchanged',list(c.execute('select * from tree_ground_evidence order by tree_id'))==list(o.execute('select * from tree_ground_evidence order by tree_id')))
ids=['akl_tree_lid_1097624','akl_tree_pc4_3520942_11845306','akl_tree_pc4_3520956_11845318','akl_tree_pc4_3520966_11845310','akl_tree_lid_1109173'];dps=list(c.execute('select tree_id,seg_key,current_primary_tree_id,current_height_m,current_crown_area_m2 from tree_evidence_v5 where tree_id in ('+','.join('?'*len(ids))+')',ids))
check('dps_shared_crown',len(dps)==5 and len({x[1] for x in dps})==1 and all(x[2]=='akl_tree_lid_1097624' and x[3]==12.76 and x[4]==191 for x in dps),dps)
notable=c.execute("select evidence_tier,seg_key from tree_evidence_v5 where tree_id='akl_tree_not_336'").fetchone();check('dps_register_position_separate',notable==('location_unverified',None),notable)
cross=c.execute("select current_objectid from notable_source_crosswalk_v5 where tree_id='akl_tree_not_336'").fetchone();check('dps_council_renumbering',cross==('684',),cross)
check('geometry_corrections_logged',scalar('select count(*) from v5_geometry_corrections')==7)
# Original source point-based notable associations are reviewed separately.
check('inherited_unverified_associations_reviewed',scalar('select count(*) from tree_notable_link_review_v5')==22)
base=json.loads((W/'verification/database_baseline.json').read_text());check('v4_database_file_unchanged',OLD.stat().st_mtime_ns==base['source_mtime_ns'] and OLD.stat().st_size==base['source_bytes'])
check('sqlite_quick_check',list(c.execute('pragma quick_check'))==[('ok',)])
r['status']='passed' if all(x['passed'] for x in r['checks'].values()) else 'failed';(W/'verification/database_checks.json').write_text(json.dumps(r,indent=2));print(r['status'],flush=True)
if r['status']!='passed':raise SystemExit(1)
