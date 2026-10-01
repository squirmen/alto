from pathlib import Path
import json,collections
import pyarrow.parquet as pq
W=Path('/data/alto/working/alto_v5_20260922');S=Path('/data/alto/working/crowns_v5_full')
manifest=Path('/data/alto/point_cloud_2024/auckland_metro_v1/manifest.jsonl');expected={Path(json.loads(l)['tile']).stem for l in manifest.read_text().splitlines() if l.strip()}
status={}
for directory in [S,W/'rerun']:
 for f in sorted(directory.glob('status_*.jsonl')):
  for line in f.read_text().splitlines():
   r=json.loads(line);status[r['tile']]=r
files={p.stem:p for p in (S/'crowns').glob('*.parquet')};files.update({p.stem:p for p in (W/'rerun/crowns').glob('*.parquet')})
bad=[k for k in expected if status.get(k,{}).get('status')!='done' or k not in files]
r={'expected':len(expected),'done':len(expected)-len(bad),'complete':not bad,'outstanding':bad,'empty_tiles':sum(pq.ParquetFile(p).metadata.num_rows==0 for p in files.values()),'status_counts':dict(collections.Counter(r['status'] for r in status.values())),'retry_results':[status[r['tile']] for r in json.loads((W/'verification/rerun_requested.json').read_text())]}
(W/'verification/tile_coverage.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
