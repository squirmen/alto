"""Current v5 products alongside preserved earlier datasets; no source records removed."""
from pathlib import Path
import sqlite3,json,time,math,sys,ast,importlib.util
import numpy as np,pyarrow.parquet as pq
from scipy.spatial import cKDTree
W=Path('/data/alto/working/alto_v5_20260922');DB=W/'akl_trees.sqlite'
DETECTION=('lidar_inferred_canopy','lidar_pointcloud_v4','lidar_pointcloud_v5','low_canopy_promoted','pointcloud_missed_promoted')
D=','.join("'"+s+"'" for s in DETECTION)
def log(*a):print(time.strftime('%H:%M:%S'),*a,flush=True)
def module(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def main():
 c=sqlite3.connect(DB);c.row_factory=sqlite3.Row;c.execute('pragma journal_mode=WAL');c.execute('pragma synchronous=NORMAL');c.execute('pragma cache_size=-300000');c.execute("pragma temp_store_directory='"+str(W/'tmp')+"'")
 assert c.execute('select count(*) from v5_tile_build').fetchone()[0]==3149
 # Coverage uses the original survey-tile rectangles, including valid empty tiles.
 log('Classifying source positions against completed tile footprint')
 manifest=Path('/data/alto/point_cloud_2024/auckland_metro_v1/manifest.jsonl')
 boxes=np.array([json.loads(l)['bbox_2193'][-4:] for l in manifest.read_text().splitlines() if l.strip()],float);centres=(boxes[:,:2]+boxes[:,2:])/2
 assert np.allclose(boxes[:,2:]-boxes[:,:2],[480,720])
 assert np.allclose(np.mod(boxes[:,:2]-boxes[0,:2],[480,720]),0)
 kd=cKDTree(centres);ex=pq.read_table(W/'existing_v5.parquet').to_pandas();xy=ex[['x','y']].to_numpy();_,j=kd.query(xy);bb=boxes[j];inside=((xy>=bb[:,:2])&(xy<bb[:,2:])).all(axis=1)
 c.execute('create table if not exists tree_coverage_v5(tree_id text primary key,within_v5_footprint integer)')
 c.executemany('insert or replace into tree_coverage_v5 values(?,?)',zip(ex.tree_id.to_numpy(),map(int,inside)));c.commit();del ex,xy,kd
 c.execute("insert or ignore into tree_coverage_v5 select primary_tree_id,1 from tree_crown_v5");c.commit()
 # Current crown evidence supplies new measurements; aliases retain a pointer to its representative.
 log('Building current views and identity summaries')
 c.executescript(f'''
 create table if not exists v5_group_summary as select cv.seg_key,cv.primary_tree_id,count(l.tree_id) as source_records,sum(case when t.source_primary not in ({D}) then 1 else 0 end) as inventory_records,
 json_group_array(json_object('tree_id',l.tree_id,'source',t.source_primary,'species_common',t.species_common,'species_latin',t.species_latin,'source_tree_id',t.source_tree_id)) as members_json
 from tree_crown_v5 cv left join tree_crown_v5_links l on l.seg_key=cv.seg_key left join trees t on t.tree_id=l.tree_id group by cv.seg_key;
 create unique index if not exists idx_v5_group_key on v5_group_summary(seg_key);
 create table if not exists v5_lineage_old_summary as select old_tree_id,count(*) as new_overlapping_crowns,sum(old_fraction) as old_area_overlap_fraction from tree_crown_lineage_v5 where old_fraction>=.1 or new_fraction>=.1 group by old_tree_id;
 create unique index if not exists idx_v5_old_summary on v5_lineage_old_summary(old_tree_id);
 create table if not exists v5_lineage_new_summary as select new_seg_key,count(*) as old_overlapping_crowns from tree_crown_lineage_v5 where old_fraction>=.1 or new_fraction>=.1 group by new_seg_key;
 create unique index if not exists idx_v5_new_summary on v5_lineage_new_summary(new_seg_key);
 create table if not exists tree_identity_v5 as select e.*,g.source_records,g.inventory_records,
 case when e.tree_id=e.current_primary_tree_id then g.members_json end as members_json,
 os.new_overlapping_crowns,ns.old_overlapping_crowns,co.within_v5_footprint,
 'Actual crown containment and polygon intersections; shared crowns can contain several trees.' as spatial_evidence_note
 from tree_evidence_v5 e join tree_coverage_v5 co using(tree_id) left join v5_group_summary g on g.seg_key=e.seg_key left join v5_lineage_old_summary os on os.old_tree_id=e.tree_id left join v5_lineage_new_summary ns on ns.new_seg_key=e.seg_key;
 create unique index if not exists idx_v5_identity_tree on tree_identity_v5(tree_id);
 create table if not exists tree_current_crown_v5 as
 select e.tree_id,cv.crown_area_m2,cv.crown_diameter_m,cv.height_m as crown_max_chm_m,cv.mean_veg_height_m,cv.method_id,'v5' as crown_source,e.current_primary_tree_id,cv.gap_filled_fraction,cv.ndvi_mean,cv.evidence_tier,cv.evidence_reasons
 from tree_evidence_v5 e join tree_crown_v5 cv on cv.seg_key=e.seg_key
 union all
 select t.tree_id,cv.crown_area_m2,cv.crown_diameter_m,cv.height_m,cv.mean_veg_height_m,cv.method_id,'v4_outside_v5',cv.primary_tree_id,cv.gap_filled_fraction,null,cv.evidence_tier,cv.evidence_reasons
 from trees t join tree_coverage_v5 co using(tree_id) join tree_crown_v4 cv on cv.primary_tree_id=t.tree_id where co.within_v5_footprint=0;
 create unique index if not exists idx_v5_current_crown on tree_current_crown_v5(tree_id);
 create table if not exists tree_current_pointcloud_v5 as select e.tree_id,cv.height_m as canopy_top_m,cv.n_veg_returns,cv.n_building_returns,cv.n_ground_returns,cv.n_unclassified_returns,cv.n_water_returns,cv.n_bridge_returns,cv.multi_return_fraction,cv.intensity_mean,cv.aerial_greenness,cv.ndvi_mean,cv.elongation,cv.bbox_fill,cv.gap_filled_fraction,'vegetation' as pointcloud_class,cv.method_id from tree_evidence_v5 e join tree_crown_v5 cv on cv.seg_key=e.seg_key;
 create unique index if not exists idx_v5_current_pc on tree_current_pointcloud_v5(tree_id);
 create table if not exists tree_display_v5(tree_id text primary key,lon real,lat real,display_role text,crown_source text,seg_key text);
 insert or ignore into tree_display_v5 select primary_tree_id,lon,lat,'current_crown','v5',seg_key from tree_crown_v5;
 insert or ignore into tree_display_v5 select t.tree_id,t.lon,t.lat,case when t.source_primary not in ({D}) then 'source_record' when co.within_v5_footprint=0 then 'outside_v5_coverage' else 'earlier_detection' end,case when co.within_v5_footprint=0 then 'v4_outside_v5' else null end,null from trees t join tree_evidence_v5 e using(tree_id) join tree_coverage_v5 co using(tree_id) where e.link_role='unlinked';
 ''');c.commit()
 # Keep the earlier products in their original tables. Re-evaluate the same existing
 # sensitivity equations with v5 inputs, once per current crown, never once per alias.
 model=module(W/'code/valuation_baseline.py')
 src=ast.parse((W/'code/assets_baseline.py').read_text());keep=[]
 for node in src.body:
  if isinstance(node,ast.FunctionDef) and node.name in {'estimate_dbh_crown','life_stage','replacement_years','irreplaceability'}:keep.append(node)
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in {'CLASS_MAX_HEIGHT_M','CLASS_CROWN_GROWTH_M2_Y'} for t in node.targets):keep.append(node)
 ns={};exec(compile(ast.Module(body=keep,type_ignores=[]),'assets_baseline','exec'),ns)
 cols=[tuple(r)[1:3] for r in c.execute('pragma table_info(tree_valuation_pilot)')]
 c.execute('create table if not exists tree_valuation_v5('+','.join(n+' '+typ+(' primary key' if n=='tree_id' else '') for n,typ in cols)+')')
 c.execute('create table if not exists tree_assets_v5(tree_id text primary key,height_max_m real,height_mean_m real,dbh_cm_crown_est real,dbh_confidence text,life_stage text,replacement_years_canopy real,irreplaceability_class text,method_id text)')
 c.execute('create table if not exists tree_roots_v5(tree_id text primary key,dbh_cm real,trunk_circumference_cm real,crown_radius_m real,foraging_radius_m real,effective_radius_m real,effective_area_m2 real,stability_radius_m real,root_constraint_flag text,rpa_radius_m real,rpa_area_m2 real,life_stage text,method_id text,model_confidence text,constraint_basis text)')
 read=sqlite3.connect(f'file:{DB}?mode=ro',uri=True);read.row_factory=sqlite3.Row
 sql='''select t.tree_id,t.source_primary,coalesce(g.species_common,t.species_common) as species_common,coalesce(g.species_latin,t.species_latin) as species_latin,
 cr.crown_area_m2,cr.crown_diameter_m,cr.crown_max_chm_m,cr.mean_veg_height_m,cr.crown_source,
 ctx.in_flood_prone_area,ctx.in_flood_plain,ctx.fraction_paved_surfaces,ctx.air_temp_mean_c,imp.fraction_impervious_30m as imperv_fraction_30m,
 p.predicted_species_class as ml_species_class,p.species_class_confidence as ml_species_class_confidence
 from tree_current_crown_v5 cr join trees t using(tree_id) left join tree_context_pilot ctx using(tree_id) left join tree_impervious_pilot imp using(tree_id) left join tree_species_class_predictions p using(tree_id) left join tree_ground_evidence g using(tree_id)
 where cr.tree_id=cr.current_primary_tree_id and cr.crown_source='v5' and cr.tree_id not in (select tree_id from tree_valuation_v5)'''
 cur=read.execute(sql);n=0;log('Updating service, trunk and root sensitivity scenarios')
 for batch in iter(lambda:cur.fetchmany(10000),[]):
  vals=[];assets=[];roots=[]
  for raw in batch:
   r=dict(raw);model_input=dict(r)
   if r['source_primary'] in DETECTION and not r['species_latin']:model_input['source_primary']='lidar_inferred_canopy'
   value=model.compute_tree_valuation(model_input);tid=r['tree_id'];h=r['crown_max_chm_m'];diam=r['crown_diameter_m'];k=value['species_class']
   if r['source_primary'] in DETECTION:
    value['valuation_confidence']='modelled_low';value['uncertainty_factor']=.60;value['total_value_nzd_y_low']=value['total_value_nzd_y']*.4;value['total_value_nzd_y_high']=value['total_value_nzd_y']*1.6
   if not r['species_latin'] and (not r['species_common'] or r['species_common'].strip().lower() in {'unknown','species not recorded','0 records found.'}) and not r['ml_species_class']:
    value['species_class_source']='default_evergreen_broadleaf_assumption'
   value['method_id']=model.VALUATION_ASSUMPTIONS['method_id']+'__v5_crown_inputs';value['created_at_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
   value['assumptions_json']=json.dumps({**model.VALUATION_ASSUMPTIONS,'geometry_basis':'v5 crown footprint and maximum height','aggregation_unit':'one segmented crown; can represent one or more trees','height_dbh_calibration':'unchanged uncalibrated sensitivity model'},separators=(',',':'))
   vals.append(tuple(value.get(n) for n,_ in cols))
   dbh,_=ns['estimate_dbh_crown'](h,diam,k);stage=ns['life_stage'](h,dbh,k);years=ns['replacement_years'](r['crown_area_m2'],k)
   assets.append((tid,h,r['mean_veg_height_m'],dbh,'modelled_low',stage,years,ns['irreplaceability'](years,h),'crown_height_dbh_sensitivity_v5_inputs'))
   crown_r=diam/2;foraging=1.5*crown_r;imp=r['imperv_fraction_30m'];valid_imp=imp is not None and 0<=imp<=1
   effective=foraging*math.sqrt(max(.05,1-.7*imp)) if valid_imp else None
   stability=max(3*dbh/100,.12*h);rpaa=min(math.pi*(12*dbh/100)**2,707);rpar=math.sqrt(rpaa/math.pi)
   flag='not_assessed' if effective is None else 'space_deficit_review' if effective<stability else 'constrained_scenario' if effective<.7*foraging else 'unconstrained_scenario'
   roots.append((tid,dbh,math.pi*dbh,crown_r,foraging,effective,None if effective is None else math.pi*effective**2,stability,flag,rpar,rpaa,stage,'root_space_sensitivity_v5_inputs','scenario_only_unvalidated','Known paving fraction only; neighbour partition omitted because crown separation is not root separation.'))
  c.executemany('insert into tree_valuation_v5 values('+','.join('?'*len(cols))+')',vals);c.executemany('insert into tree_assets_v5 values('+','.join('?'*9)+')',assets);c.executemany('insert into tree_roots_v5 values('+','.join('?'*15)+')',roots);c.commit();n+=len(batch)
  if n%100000==0:log('Modelled',n)
 read.close()
 # Materialized presentation tables also preserve prior products outside the new coverage.
 for target,new,old in [('tree_current_services_v5','tree_valuation_v5','tree_valuation_pilot'),('tree_current_assets_v5','tree_assets_v5','tree_assets_pilot'),('tree_current_roots_v5','tree_roots_v5','tree_root_zone_pilot')]:
  fields=[r[1] for r in c.execute('pragma table_info('+new+')')];oldfields={r[1] for r in c.execute('pragma table_info('+old+')')}
  oldselect=','.join('o.'+f if f in oldfields else 'null as '+f for f in fields)
  c.execute(f'create table if not exists {target} as select * from {new} union all select {oldselect} from {old} o join tree_coverage_v5 co using(tree_id) where co.within_v5_footprint=0')
  c.execute(f'create unique index if not exists idx_{target} on {target}(tree_id)')
 c.commit();c.execute('pragma wal_checkpoint(TRUNCATE)')
 summary={t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['tree_display_v5','tree_identity_v5','tree_valuation_v5','tree_assets_v5','tree_roots_v5','tree_current_crown_v5']};summary['display_roles']=dict(c.execute('select display_role,count(*) from tree_display_v5 group by 1'));summary['coverage']=dict(c.execute('select within_v5_footprint,count(*) from tree_coverage_v5 group by 1'))
 (W/'verification/enrichment_summary.json').write_text(json.dumps(summary,indent=2));log(summary);c.close()
if __name__=='__main__':main()
