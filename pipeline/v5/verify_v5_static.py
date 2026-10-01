from pathlib import Path
import json,gzip,hashlib,sys,subprocess,re
W=Path('/data/alto/working/alto_v5_20260922');S=W/'deploy/alto_v5_upload_20260923';results={}
def check(k,v,d=None):
 results[k]={'passed':bool(v),'detail':d};print(k,'PASS' if v else 'FAIL',d or '',flush=True)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(8<<20),b''):h.update(b)
 return h.hexdigest()
s=json.loads((S/'data/tree_details/schema.json').read_text());tot=json.loads((W/'web_build/totals.json').read_text());meta=json.loads((S/'release-metadata.json').read_text());near=json.loads((S/'kyte/data/nearby/manifest.json').read_text())
check('record_counts',s['records']==6238420==meta['dataset']['tree_records'])
check('database_snapshot',s['database_mtime_ns']==str((W/'akl_trees.sqlite').stat().st_mtime_ns)==near['database_mtime_ns'])
check('nearby_snapshot',near['detail_snapshot']==s['generated_utc'] and near['detail_records']==s['records'])
check('nearby_population',near['records']==tot['totals']['trees']-647,{'nearby':near['records'],'current_map_markers':tot['totals']['trees']})
check('detail_buckets',len(list((S/'data/tree_details').glob('*.json.gz')))==4096)
for directory in ['data/tree_details','kyte/data/nearby']:
 manifest=json.loads((S/directory/'manifest.json').read_text());errors=[]
 for f in manifest['files']:
  p=S/directory/f['path']
  if not p.is_file() or p.stat().st_size!=f['bytes'] or digest(p)!=f['sha256']:errors.append(f['path'])
 check(directory+'_manifest',not errors,errors)
def bucket(tid):
 h=2166136261
 for b in tid.encode():h=((h^b)*16777619)&0xffffffff
 return f'{h%4096:03x}'
def record(tid):
 data=json.loads(gzip.decompress((S/'data/tree_details'/f'{bucket(tid)}.json.gz').read_bytes()))[tid];out={}
 for d in s['datasets']:
  if d['key'] not in data:continue
  vals=data[d['key']];expand=lambda v:dict(zip(d['fields'],v+[None]*(len(d['fields'])-len(v))))
  out[d['key']]=[expand(v) for v in vals] if d['multiple'] else expand(vals)
 return out
r=record('akl_tree_lid_1097624');check('dps_current_dimensions',r['crown']['crown_max_chm_m']==12.76 and r['crown']['crown_area_m2']==191)
check('dps_field_report',r['field']['observation_json'] is not None)
ids=['akl_tree_pc4_3520942_11845306','akl_tree_pc4_3520956_11845318','akl_tree_pc4_3520966_11845310','akl_tree_lid_1109173']
check('dps_aliases_preserved',all(record(t)['identity']['current_primary_tree_id']=='akl_tree_lid_1097624' for t in ids))
n=record('akl_tree_not_336');check('notable_location_and_crosswalk',n['identity']['evidence_tier']=='location_unverified' and n['source_crosswalk']['current_objectid']=='684' and n['identity']['current_primary_tree_id'] is None)
g=record('akl_tree_pc4_3517554_11848810');check('ground_species_preserved',g['ground']['species_latin']=='Metrosideros kermadecensis')
check('earlier_measurements_retained',all(k in g for k in ['previous_crown_v4','previous_evidence']) and 'previous_assets' in s['coverage'])
for f in ['trees_map_points','tree_crowns_pilot','near_canopy']:
 p=S/'data'/f'{f}.pmtiles';b=p.open('rb').read(8)
 check(f+'_pmtiles_header',b==b'PMTiles\x03')
 header=subprocess.check_output(['/opt/homebrew/bin/pmtiles','show',str(p),'--header-json'],text=True);j=json.loads(header);(W/'verification'/f'{f}_header.json').write_text(header)
 check(f+'_bounds',170<float(j['bounds'][0])<180 and -40<float(j['bounds'][1])<-30,j)
page=(S/'index.html').read_text();check('ui_v5_cache_version','window.AKL_TILE_VERSION="20260923-v5"' in page)
check('bulk_downloads_absent','id="dlCsv"' not in page and 'id="dlParquet"' not in page)
check('live_account_files_excluded',not list(S.rglob('*.php')) and not list(S.rglob('*.sqlite')))
check('forecast_snapshot',json.loads((S/'data/longitudinal/model.json').read_text())['application_database_mtime_ns']==s['database_mtime_ns'])
legacy=json.loads((W/'verification/legacy_outline_coverage.json').read_text());check('legacy_outlines_preserved',not legacy['missing_ids'],legacy)
status='passed' if all(v['passed'] for v in results.values()) else 'failed';(W/'verification/static_checks.json').write_text(json.dumps({'status':status,'checks':results},indent=2)+'\n')
if status!='passed':raise SystemExit(1)
