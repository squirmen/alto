from pathlib import Path
import sqlite3,json,time,hashlib
W=Path('/data/alto/working/alto_v5_20260922');c=sqlite3.connect(W/'akl_trees.sqlite');c.execute('pragma synchronous=NORMAL');c.execute('pragma cache_size=-300000')
# Complete scalar v4 crown statistics remain accessible; geometric blobs stay local.
fields=[r[1] for r in c.execute('pragma table_info(tree_crown_v4)') if r[1] not in {'primary_tree_id','crown_wkb'}]
c.execute('create view if not exists tree_previous_crown_v4 as select primary_tree_id as tree_id,'+','.join(fields)+' from tree_crown_v4')
c.execute("update tree_current_pointcloud_v5 set pointcloud_class=case when n_veg_returns=0 then 'no_classified_vegetation_returns' when n_building_returns>n_veg_returns then 'mixed' else 'vegetation' end where n_veg_returns=0 or n_building_returns>n_veg_returns")
# Retain raster crowns outside the new footprint where v4 has no point-cloud crown.
c.execute("""insert or ignore into tree_current_crown_v5
 select p.tree_id,p.crown_area_m2,p.crown_diameter_m,p.crown_max_chm_m,p.crown_mean_chm_m,p.method_id,'legacy_outside_v5',p.tree_id,null,null,'outside_v5_coverage','Earlier raster crown outside the v5 survey footprint'
 from tree_crown_pilot p join tree_coverage_v5 co using(tree_id) where co.within_v5_footprint=0""")
c.execute("""update tree_display_v5 set crown_source=(select cr.crown_source from tree_current_crown_v5 cr where cr.tree_id=tree_display_v5.tree_id) where crown_source='v4_outside_v5' """)
# Clear any inherited point-only notable status on the presentation side; the raw
# imported record and verified/group protections stay intact.
c.execute('''create table if not exists tree_notable_link_review_v5 as select tree_id,notable_point_objectid as original_notable_objectid,
 'unverified' as notable_source_position,'The earlier notable-point association needs checking. The inventory tree remains at its own recorded position.' as review_note,
 case when notable_group_match=1 then 1 else 0 end as protected_from_verified_or_group_evidence
 from trees where source_primary!='notable_trees_overlay' and notable_point_type='2' ''')
c.execute('create unique index if not exists idx_v5_notable_link_review on tree_notable_link_review_v5(tree_id)')
c.commit();c.execute('pragma wal_checkpoint(TRUNCATE)');c.close()
print('Database presentation finalized',flush=True)
