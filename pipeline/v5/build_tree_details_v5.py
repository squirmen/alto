#!/usr/bin/env python3
"""Build static, on-demand per-tree analytical records, preserving estimates and zeroes.

Map tiles stay small. A shared schema and 4096 hash buckets carry the public
research tables, including competing predictions, assumptions and scenarios.
No confidence/release flag suppresses a stored record. The database is read-only.
"""
from __future__ import annotations
import argparse, collections, gzip, hashlib, json, math, shutil, sqlite3
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
TABLES=[
 ('record','trees','Original tree record','Source record','Original source IDs, names and coordinates remain unchanged. See current crown and identity evidence for the v5 association.'),
 ('identity','tree_identity_v5','Current crown and record links','Spatial evidence','Actual polygon containment links a record to a crown. A shared crown can contain several trees; original records remain separate.'),
 ('crown','tree_current_crown_v5','Current canopy dimensions','Remote sensing','V5 crown boundaries and maximum height from the 2024 survey. Earlier v4 crowns remain in areas outside the v5 survey footprint.'),
 ('pointcloud','tree_current_pointcloud_v5','Current laser-return evidence','Remote sensing','Return counts and structure within the v5 crown. Interpolated area is reported as gap_filled_fraction.'),
 ('assets','tree_current_assets_v5','Current trunk and life-stage estimates','Hypothesis','Existing height and crown sensitivity equations applied to current dimensions. Trunk diameter and life stage still need field measurements.'),
 ('roots','tree_current_roots_v5','Current root scenarios','Hypothesis','Crown and estimated trunk dimensions set exploratory root extents. Known paving can constrain the scenario; missing paving leaves effective extent unknown. Root depth is unmeasured.'),
 ('services','tree_current_services_v5','Current ecosystem-service scenarios','Modelled','Existing sensitivity equations updated with current crown dimensions, once per representative crown. Several trees may share a crown. Monetary coefficients and height-based biomass remain uncalibrated.'),
 ('ground','tree_ground_evidence','Field observations','Reported / photographed','Dated field observations retain their provenance. Joined-crown dimensions derived from earlier segmentation are distinct from field measurements.'),
 ('field','tree_field_observation_v5','Recent field report','Observer report','Devonport Primary plaque observation and record links reported by the observer. Tentative identities and the schedule association remain marked for checking.'),
 ('location_review','tree_location_review_v5','Source location review','Source metadata','Unverified Council points remain register entries and are excluded from automatic crown matching.'),
 ('notable_link_review','tree_notable_link_review_v5','Earlier notable-point association','Needs checking','The source notable point is unverified. This review concerns the notable association, while the inventory record keeps its own position.'),
 ('source_crosswalk','notable_source_crosswalk_v5','Council source-ID reconciliation','Provenance','Original ALTO identity and current Council IDs, matched by unchanged schedule, name and position. Renumbering does not create a new tree.'),
 ('trajectory','tree_trajectory_pilot','Earlier canopy history 2013–2024','Estimated','Preserved historical matching results. V5 redraws the same 2024 survey; differences between v4 and v5 crown counts do not establish tree loss or growth.'),
 ('species','tree_species_attributes','Species references and growth form','Mixed evidence','Recorded identifications, reference matches and model guesses retain separate provenance.'),
 ('predictions','tree_species_class_predictions','Earlier growth-form guesses','Prediction','Stored class scores from the previous inputs. These are not calibrated species probabilities and have not been rerun on v5 crowns.'),
 ('context','tree_context_pilot','Mapped surroundings','Mapped / modelled','Source-position context retained from the previous release. Absent values remain missing.'),
 ('impervious','tree_impervious_pilot','Paving, buildings and roads','Mapped','Stored surface-cover samples at the original tree position.'),
 ('previous_crown_v4','tree_previous_crown_v4','Previous v4 crown measurements','Earlier segmentation','Original v4 geometry statistics, retained to compare redraws of the same 2024 survey.'),
 ('previous_assets','tree_assets_pilot','Earlier dimensions and neighbourhood estimates','Previous model','Preserved earlier canopy structure, neighbourhood, condition, diversity and life-stage estimates. Their inputs predate v5.'),
 ('previous_roots','tree_root_zone_pilot','Earlier root scenarios','Previous model','Preserved root assumptions and estimates based on the earlier crown inputs.'),
 ('previous_services','tree_valuation_pilot','Earlier service estimates','Previous model','Preserved service and monetary scenarios from the earlier geometry; excluded from v5 headline totals within the new footprint.'),
 ('scenarios','tree_valuation_scenarios','Earlier alternative service scenarios','Scenario','Includes nominal-crown scenarios for records without a segmented crown. Excluded from headline totals.'),
 ('previous_pointcloud','tree_pointcloud_pilot','Earlier laser-return profiles','Previous analysis','Original point-cloud classifications and foliage profiles remain available with their original spatial basis.'),
 ('previous_crown','tree_crown_pilot','Earlier raster crown','Previous segmentation','Stored raster-derived canopy footprint measurements.'),
 ('lidar','tree_lidar_pilot','Earlier canopy raster sample','Remote sensing','Height samples at the original point, separate from the v5 segmented crown maximum.'),
 ('previous_evidence','tree_evidence_v4','Previous detection assessment','Previous analysis','V4 assessment retained for comparison. Current location and identity review takes precedence.'),
 ('restoration','tree_restoration_log','Restored record','Provenance','Records restored after an earlier processing error.'),
 ('review','tree_hard_negative_candidates','Earlier alternative detection explanation','Hypothesis','Stored suggestions that a detection may represent another object, available for comparison with current evidence.'),
]

def bucket_id(tree_id):
 h=2166136261
 for b in tree_id.encode('utf-8'):h=((h^b)*16777619)&0xffffffff
 return f'{h%4096:03x}'

def build(db,out,limit=None):
 initial_mtime=db.stat().st_mtime_ns
 c=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
 tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type in ('table','view')")}
 defs=[];joins=[];select=['t.tree_id'];offset=1
 for key,table,title,evidence,note in TABLES:
  if table not in tables:continue
  fields=[r[1] for r in c.execute(f'PRAGMA table_info({table})') if r[1] not in {'tree_id','canonical_tree_id','crown_wkb'}]
  alias='t' if key=='record' else key
  multi=key=='scenarios'
  if key!='record':
   join_key='canonical_tree_id' if key=='trajectory' else 'tree_id'
   if multi:
    expr=','.join('s.'+f for f in fields)
    joins.append(f'LEFT JOIN (SELECT tree_id,json_group_array(json_array({expr})) AS records FROM {table} s GROUP BY tree_id) {alias} ON {alias}.tree_id=t.tree_id')
   else:
    duplicate=c.execute(f'SELECT {join_key} FROM {table} WHERE {join_key} IS NOT NULL GROUP BY {join_key} HAVING COUNT(*)>1 LIMIT 1').fetchone()
    if duplicate:raise ValueError(f'Ambiguous {table} join for {duplicate[0]}')
    joins.append(f'LEFT JOIN {table} {alias} ON {alias}.{join_key}=t.tree_id')
  names=[f'{alias}.records'] if multi else [f'{alias}.{f}' for f in fields]
  select.extend(names)
  defs.append(dict(key=key,table=table,title=title,evidence=evidence,note=note,fields=fields,multiple=multi,start=offset,stop=offset+len(names)))
  offset+=len(names)
 staging=out.with_name(out.name+'.building')
 if staging.exists():shutil.rmtree(staging)
 staging.mkdir(parents=True)
 # Ordinary values are compressed within each bucket, keeping the shared schema
 # small and preserving exact stored numbers, strings, nulls and zeroes.
 def encode(value):
  if isinstance(value,float) and not math.isfinite(value):return None
  return value
 def values(row):
  result=[encode(v) for v in row]
  while result and result[-1] is None:result.pop()
  return result
 query='SELECT '+','.join(select)+' FROM trees t '+' '.join(joins)+' ORDER BY t.tree_id'+(f' LIMIT {int(limit)}' if limit else '')
 count=0;bucket_counts=collections.Counter();coverage=collections.Counter();streams={}
 try:
  cursor=c.execute(query)
  while batch:=cursor.fetchmany(4000):
   chunks=collections.defaultdict(list)
   for row in batch:
    record={}
    for d in defs:
     raw=row[d['start']:d['stop']]
     if not any(v is not None for v in raw):continue
     record[d['key']]=[values(r) for r in json.loads(raw[0])] if d['multiple'] else values(raw)
     coverage[d['key']]+=1
    bid=bucket_id(row[0]);chunks[bid].append(json.dumps([row[0],record],separators=(',',':'),ensure_ascii=False,allow_nan=False));bucket_counts[bid]+=1;count+=1
   for bid,lines in chunks.items():
    if bid not in streams:streams[bid]=(staging/(bid+'.json')).open('w',encoding='utf-8')
    streams[bid].write('\n'.join(lines)+'\n')
   if count%100000==0:print(f'{count:,} detailed tree records',flush=True)
  for f in streams.values():f.close()
  # Convert NDJSON staging to an ordinary JSON object one small bucket at a time.
  for bid in bucket_counts:
   p=staging/(bid+'.json');records=dict(json.loads(line) for line in p.read_text().splitlines());
   with gzip.open(p.with_suffix('.json.gz'),'wt',encoding='utf-8',compresslevel=6) as f:f.write(json.dumps(records,separators=(',',':'),ensure_ascii=False)+'\n')
   p.unlink()
  if db.stat().st_mtime_ns!=initial_mtime:raise ValueError('Database changed during detail export')
  expected=c.execute('SELECT count(*) FROM trees').fetchone()[0]
  if not limit and count!=expected:raise ValueError('Incomplete tree detail export')
  schema={'version':1,'database_mtime_ns':str(initial_mtime),'records':count,'generated_utc':datetime.now(timezone.utc).isoformat(),'bucket_algorithm':'fnv1a_utf8_mod4096_hex3','datasets':[{k:v for k,v in d.items() if k not in {'start','stop'}} for d in defs],'coverage':dict(coverage)}
  (staging/'schema.json').write_text(json.dumps(schema,separators=(',',':'),ensure_ascii=False)+'\n')
  (staging/'.htaccess').write_text('<IfModule mod_headers.c>\n  <FilesMatch "\\.json\\.gz$">\n    Header set Content-Encoding gzip\n    Header set Content-Type application/json\n    Header set Cache-Control "public, max-age=31536000, immutable"\n  </FilesMatch>\n</IfModule>\n<IfModule mod_setenvif.c>\n  SetEnvIfNoCase Request_URI "\\.json\\.gz$" no-gzip dont-vary\n</IfModule>\n')
  manifest={'database_mtime_ns':str(initial_mtime),'records':count,'datasets':len(defs),'fields':sum(len(d['fields']) for d in defs),'files':[{'path':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(p for p in staging.iterdir() if p.is_file())]}
  (staging/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
  if out.exists():shutil.rmtree(out)
  staging.rename(out)
  print(json.dumps({k:v for k,v in manifest.items() if k!='files'},indent=2),flush=True)
 finally:
  for f in streams.values():f.close()
  c.close()

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--db',type=Path,default=ROOT/'data/processed/akl_trees.sqlite');ap.add_argument('--out',type=Path,default=ROOT/'data/processed/tree_details');ap.add_argument('--limit',type=int);a=ap.parse_args();build(a.db,a.out,a.limit)
