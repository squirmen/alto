from pathlib import Path
import json,time,collections
import numpy as np,pyarrow.parquet as pq,shapely
W=Path('/data/alto/working/alto_v5_20260922')
files={p.stem:p for p in Path('/data/alto/working/crowns_v5_full/crowns').glob('*.parquet')};files.update({p.stem:p for p in (W/'rerun/crowns').glob('*.parquet')})
s=collections.Counter();examples=[]
for i,(tile,p) in enumerate(sorted(files.items()),1):
 if pq.ParquetFile(p).metadata.num_rows==0:s['empty_tiles']+=1;continue
 d=pq.read_table(p,columns=['crown_wkb','crown_area_m2','canopy_class']).to_pandas();g=shapely.from_wkb(d.crown_wkb.to_numpy());valid=shapely.is_valid(g);a=shapely.area(g);wrong=abs(a-d.crown_area_m2.to_numpy())>.01
 s['crowns']+=len(g);s['invalid']+=int((~valid).sum());s['area_mismatch']+=int(wrong.sum());s.update(d.canopy_class.value_counts().to_dict())
 if (~valid|wrong).any() and len(examples)<8:examples.append({'tile':tile,'invalid':int((~valid).sum()),'area_mismatch':int(wrong.sum()),'reason':shapely.is_valid_reason(g[~valid][0]) if (~valid).any() else None})
 if i%500==0:print(i,dict(s),flush=True)
out={'files':len(files),'counts':dict(s),'examples':examples};(W/'verification/geometry_audit.json').write_text(json.dumps(out,indent=2));print(out,flush=True)
