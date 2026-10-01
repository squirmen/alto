from pathlib import Path
import hashlib,json,platform,sys,importlib.metadata,datetime
W=Path('/data/alto/working/alto_v5_20260922')
def item(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(8<<20),b''):h.update(b)
 return {'path':str(p),'bytes':p.stat().st_size,'sha256':h.hexdigest()}
files={p.stem:p for p in Path('/data/alto/working/crowns_v5_full/crowns').glob('*.parquet')}
files.update({p.stem:p for p in (W/'rerun/crowns').glob('*.parquet')});assert len(files)==3149
inputs=[item(p) for _,p in sorted(files.items())]
code=[item(p) for p in sorted((W/'code').iterdir()) if p.is_file()]
review=Path('/data/alto/working/location_review_20260922/results')
refs=[item(p) for p in sorted(review.glob('*.json'))]
r={'built_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'python':sys.version,'platform':platform.platform(),'packages':{k:importlib.metadata.version(k) for k in ['numpy','pandas','pyarrow','shapely','scipy','pyproj','rasterio','pyogrio']},'inputs':inputs,'code':code,'location_review':refs,'configuration':json.loads((W/'code/shipping_config.json').read_text()),'prior_database':json.loads((W/'verification/database_baseline.json').read_text()),'database':{'bytes':(W/'akl_trees.sqlite').stat().st_size,'mtime_ns':str((W/'akl_trees.sqlite').stat().st_mtime_ns)},'scope':'Source crown outputs, including the 16 retry overrides, and the code snapshot used to assemble the release. Original point-cloud and aerial inputs remain in the production archive.'}
(W/'verification/build_provenance.json').write_text(json.dumps(r,indent=2)+'\n');print('Provenance saved:',len(inputs),'tile files,',len(code),'code files')
