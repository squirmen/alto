#!/usr/bin/env python3
"""Export conditional height scenarios for every current tree without replacing observations."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,sqlite3
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]

def forecast(h,old,span,cohorts,weight,width):
    group=next((c for c in cohorts if c['low_height_m']<=h<c['high_height_m']),None)
    if group is None:return None
    personal=(h-old)/span if old is not None else None
    applied=weight if personal is not None else 0
    rate=(1-applied)*group['annual_change_quantiles'][1]+applied*(personal or 0)
    values=[group['n'],personal,applied,rate]
    for year in (2030,2040):
        dt=year-2024;values.extend([max(0,h+rate*dt),max(0,h+(rate-width)*dt),max(0,h+(rate+width)*dt)])
    return values


def build(db,folder):
    mtime=db.stat().st_mtime_ns;model=json.loads((folder/'model.json').read_text())
    if mtime!=model['database_mtime_ns']:raise ValueError('Model and database snapshots differ')
    c=sqlite3.connect(db.resolve().as_uri()+'?mode=ro',uri=True)
    for table,key in [('tree_trajectory_pilot','canonical_tree_id'),('tree_crown_pilot','tree_id')]:
        if c.execute(f'SELECT {key} FROM {table} WHERE {key} IS NOT NULL GROUP BY {key} HAVING COUNT(*)>1 LIMIT 1').fetchone():raise ValueError('Ambiguous source join '+table)
    fields=['tree_id','model_id','anchor_year','anchor_height_m','anchor_source','history_fate','cohort_n','personal_change_m_y','personal_weight','projected_change_m_y','height_2030_m','height_2030_low_scenario_m','height_2030_high_scenario_m','height_2040_m','height_2040_low_scenario_m','height_2040_high_scenario_m','status']
    path=folder/'current_tree_height_scenarios.csv.gz';temp=path.with_suffix('.tmp');counts=Counter()
    query='''SELECT t.tree_id,tr.present_2013,tr.present_2016,tr.present_2024,tr.h_2013,tr.h_2016,tr.h_2024,tr.fate,c.crown_max_chm_m FROM trees t LEFT JOIN tree_trajectory_pilot tr ON tr.canonical_tree_id=t.tree_id LEFT JOIN tree_crown_pilot c ON c.tree_id=t.tree_id ORDER BY t.tree_id'''
    p=model['projection'];cohorts=p['cohort_model']['cohorts']
    with gzip.open(temp,'wt',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(fields)
        for id,p13,p16,p24,h13,h16,h24,fate,crown in c.execute(query):
            h=h24 if p24==1 and h24 is not None and h24>0 else crown if crown is not None and crown>0 else None
            anchor='matched_canopy_maximum' if p24==1 and h24 is not None and h24>0 else 'current_crown_maximum'
            old,span=(h16,8) if anchor=='matched_canopy_maximum' and p24==1 and p16==1 and h16 is not None and h16>0 else (h13,11) if anchor=='matched_canopy_maximum' and p24==1 and p13==1 and h13 is not None and h13>0 else (None,None)
            values=forecast(h,old,span,cohorts,p['personal_trend_weight'],p['annual_band_halfwidth_m']) if h is not None else None
            status='conditional_with_personal_trend' if values and values[1] is not None else 'cohort_transfer_only' if values else 'no_valid_anchor'
            writer.writerow([id,model['model_id'],2024 if h else None,h,anchor if h else None,fate,*(values or [None]*10),status]);counts[status]+=1
    if mtime!=db.stat().st_mtime_ns:raise ValueError('Database changed during export')
    temp.replace(path);c.close()
    model['current_tree_scenarios']={'records':sum(counts.values()),'status_counts':dict(counts),'file':path.name,'fields':fields,'note':'Modelled values; baseline observations remain separate. Future error bounds are scenarios, not calibrated future probabilities.'}
    (folder/'model.json').write_text(json.dumps(model,indent=2,allow_nan=False)+'\n')
    files=[]
    for f in sorted(folder.iterdir()):
        if f.name=='manifest.json':continue
        h=hashlib.sha256()
        with f.open('rb') as stream:
            for chunk in iter(lambda:stream.read(8*1024*1024),b''):h.update(chunk)
        files.append({'path':f.name,'bytes':f.stat().st_size,'sha256':h.hexdigest()})
    (folder/'manifest.json').write_text(json.dumps({'database_mtime_ns':mtime,'model_id':model['model_id'],'files':files},indent=2)+'\n')
    print(json.dumps(model['current_tree_scenarios'],indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',type=Path,default=ROOT/'data/processed/akl_trees.sqlite');p.add_argument('--folder',type=Path,default=ROOT/'data/processed/longitudinal');a=p.parse_args();build(a.db,a.folder)
