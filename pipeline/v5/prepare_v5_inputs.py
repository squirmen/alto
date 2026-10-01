from pathlib import Path
import sqlite3,time,json
import numpy as np,pyarrow as pa,pyarrow.parquet as pq,shapely
from pyproj import Transformer
W=Path('/data/alto/working/alto_v5_20260922');DB=W/'akl_trees.sqlite'
c=sqlite3.connect(DB);c.execute('pragma journal_mode=WAL');c.execute('pragma synchronous=NORMAL');c.execute('pragma cache_size=-200000')
trans=Transformer.from_crs(4326,2193,always_xy=True);out=W/'existing_v5.parquet';writer=None
if not out.exists():
 cur=c.execute('''select t.tree_id,t.source_primary,t.lon,t.lat,t.notable_point_type,coalesce(v.crown_area_m2,0) as old_area from trees t left join tree_crown_v4 v on v.primary_tree_id=t.tree_id where t.lon is not null and t.lat is not null''');n=0
 for rows in iter(lambda:cur.fetchmany(50000),[]):
  cols=list(zip(*rows));x,y=trans.transform(cols[2],cols[3]);t=pa.table({'tree_id':pa.array(cols[0],type=pa.string()),'source_primary':pa.array(cols[1],type=pa.string()),'x':pa.array(x),'y':pa.array(y),'notable_type':pa.array(cols[4],type=pa.string()),'old_area':pa.array(cols[5],type=pa.float64())})
  if writer is None:writer=pq.ParquetWriter(out.with_suffix('.building'),t.schema,compression='zstd')
  writer.write_table(t);n+=len(rows)
  if n%500000==0:print('Source positions',n,flush=True)
 writer.close();out.with_suffix('.building').rename(out)
if not c.execute("select 1 from sqlite_master where name='v5_old_crown_bounds'").fetchone():
 c.execute('create virtual table v5_old_crown_bounds using rtree(crown_rowid,minx,maxx,miny,maxy)');n=0
 reader=sqlite3.connect(f'file:{DB}?mode=ro',uri=True);cur=reader.execute('select rowid,crown_wkb from tree_crown_v4')
 for batch in iter(lambda:cur.fetchmany(20000),[]):
  gs=shapely.from_wkb([r[1] for r in batch]);bounds=shapely.bounds(gs)
  c.executemany('insert into v5_old_crown_bounds values(?,?,?,?,?)',((r[0],float(b[0]),float(b[2]),float(b[1]),float(b[3])) for r,b in zip(batch,bounds)));n+=len(batch)
  if n%500000==0:c.commit();print('Indexed original crown boundaries',n,flush=True)
 reader.close();c.commit()
c.execute('pragma wal_checkpoint(TRUNCATE)');c.close();print('V5 inputs ready',flush=True)
