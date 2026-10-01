from pathlib import Path
import subprocess,os,time,sys
W=Path('/data/alto/working/alto_v5_20260922');PY=sys.executable;env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','TMPDIR':str(W/'tmp')}
def run(script,args=()):
 with (W/'logs'/f'{script}.log').open('w') as f:
  p=subprocess.Popen([PY,'-u',str(W/'code'/f'{script}.py'),*args],stdout=f,stderr=subprocess.STDOUT,env=env)
 return p
# The producer must finish all writes before any snapshot-based exports start.
while not (W/'verification/enrichment_summary.json').exists():
 pid=os.environ.get('ALTO_ENRICH_PID')  # optional: stop waiting if the enrichment process has died
 result=subprocess.run(['kill','-0',pid],capture_output=True) if pid else None
 if result is not None and result.returncode:raise RuntimeError('Enrichment stopped before recording successful completion; inspect enrich.log')
 time.sleep(15)
# Finalization already succeeded; it must not touch the database during snapshot exports.
assert (W/'logs/finalize_v5_database.log').exists() and 'finalized' in (W/'logs/finalize_v5_database.log').read_text()
stage=W/'deploy/alto_v5_upload_20260923';a=run('export_web_v5');b=run('build_tree_details_v5',['--db',str(W/'akl_trees.sqlite'),'--out',str(stage/'data/tree_details')])
print('Export processes',a.pid,b.pid,flush=True)
# Keep the supervisor alive while both workers run.
assert a.wait()==0,'map export failed';print('Map export finished',flush=True)
# Tile builds can run while the detail buckets finish. Limit the thread fan-out.
commands=[('trees_map_points','trees',10,14,'points.geojsonl'),('tree_crowns_pilot','crowns',12,15,'crowns.geojsonl'),('near_canopy','near_canopy',12,15,'near_canopy.geojsonl')]
for name,layer,z,base,file in commands:
 log=W/'logs'/f'tiles_{name}.log';out=stage/'data'/f'{name}.pmtiles';out.parent.mkdir(parents=True,exist_ok=True)
 with log.open('w') as f:
  cmd=['/opt/homebrew/bin/tippecanoe','--force','-P','--quiet','-t',str(W/'tmp'),'--layer='+layer,'--minimum-zoom='+str(z),'--maximum-zoom=18','--base-zoom='+str(base),'--drop-densest-as-needed','--extend-zooms-if-still-dropping','-o',str(out),str(W/'web_build'/file)]
  if layer!='trees':cmd.insert(3,'--simplification=3')
  p=subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT,env={**env,'TIPPECANOE_MAX_THREADS':'6'});assert p.returncode==0,log
 print('Tiles complete',name,flush=True)
assert b.wait()==0,'tree-detail export failed';print('Tree details finished',flush=True)
p=run('build_nearby_v5');assert p.wait()==0,'KYTE nearby export failed'
(W/'verification/exports_complete.txt').write_text(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())+'\n');print('All exports complete',flush=True)
