#!/usr/bin/env python3
"""Read-only canopy-history export and a spatially held-out height-scenario model.

Predictions concern matched canopy height conditional on continued presence.
They do not estimate survival, tree age, removal responsibility, or future health.
"""
from __future__ import annotations
import argparse, collections, csv, gzip, hashlib, json, math, sqlite3
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
BANDS=[0,5,10,15,20,30,50,1000]
MODEL_ID='alto-canopy-cohort-v1'


def partition(x,y):
    """Whole 5 km NZTM cells share a split; no tree/row random split."""
    block=f'{math.floor(x/5000)}:{math.floor(y/5000)}'
    fold=int(hashlib.sha256(block.encode()).hexdigest()[:8],16)%10
    return (0 if fold<6 else 1 if fold<8 else 2),block


def band(h):return min(len(BANDS)-2,max(0,int(np.searchsorted(BANDS,h,side='right'))-1))


def fit(pairs):
    rates=(pairs[:,1]-pairs[:,0])/8
    global_q=np.quantile(rates,[.1,.5,.9]).tolist()
    cohorts=[]
    for i in range(len(BANDS)-1):
        vals=rates[(pairs[:,0]>=BANDS[i])&(pairs[:,0]<BANDS[i+1])]
        cohorts.append({'low_height_m':BANDS[i],'high_height_m':BANDS[i+1],'n':len(vals),'annual_change_quantiles':np.quantile(vals,[.1,.5,.9]).tolist() if len(vals)>=50 else global_q,'fallback_to_global':len(vals)<50})
    return {'global_quantiles':global_q,'cohorts':cohorts}


def rate(model,h):return model['cohorts'][band(h)]['annual_change_quantiles'][1]


def predict(model,rows,weight):
    cohort=np.array([rate(model,h) for h in rows[:,0]])
    personal=rows[:,2]
    weights=np.where(np.isfinite(personal),weight,0)
    change=(1-weights)*cohort+weights*np.nan_to_num(personal)
    return np.maximum(0,rows[:,0]+8*change)


def score(rows,pred):
    residual=pred-rows[:,1]
    return {'n':len(rows),'mae_m':float(np.abs(residual).mean()),'rmse_m':float(np.sqrt(np.square(residual).mean())),'bias_m':float(residual.mean())}


def build(db,out):
    mtime=db.stat().st_mtime_ns
    c=sqlite3.connect(db.resolve().as_uri()+'?mode=ro',uri=True)
    staging=out.with_name(out.name+'.building');staging.mkdir(parents=True,exist_ok=True)
    fields=['trajectory_id','canonical_tree_id','lon','lat','x_2193','y_2193','present_2013','present_2016','present_2024','h_2013','h_2016','h_2024','growth_2013_2016','growth_2016_2024','fate','implausible','created_at_utc']
    counts=collections.Counter();blocks=[set(),set(),set()];samples=[[],[],[]];interpolation=[[],[],[]];sample_blocks=[[],[],[]]
    digest=hashlib.sha256();total=0
    with gzip.open(staging/'canopy_history.csv.gz','wt',newline='',encoding='utf-8') as stream:
        writer=csv.writer(stream);writer.writerow(fields)
        for r in c.execute('SELECT '+','.join(fields)+' FROM tree_trajectory_pilot ORDER BY trajectory_id'):
            writer.writerow(r);digest.update((json.dumps(r,separators=(',',':'))+'\n').encode());total+=1;counts[r[14]]+=1
            if r[1] is not None:counts['linked_current_tree']+=1
            if r[15]:counts['flagged_implausible']+=1
            # Outcomes need actual matched detections at both endpoints. Retain
            # negative changes and flagged jumps: deleting hard targets biases error down.
            if r[7]!=1 or r[8]!=1 or r[10] is None or r[11] is None or r[10]<=0 or r[11]<=0:continue
            if r[4] is None or r[5] is None:counts['missing_coordinates']+=1;continue
            split,block=partition(r[4],r[5]);blocks[split].add(block)
            old=(r[10]-r[9])/3 if r[6]==1 and r[9] is not None and r[9]>0 else float('nan')
            samples[split].append([r[10],r[11],old]);sample_blocks[split].append(block)
            if np.isfinite(old):interpolation[split].append(r[10]-(r[9]+(r[11]-r[9])*3/11))
            if total%250000==0:print(f'{total:,} histories exported',flush=True)
    rows=[np.asarray(v,dtype=float).reshape((-1,3)) for v in samples]
    if min(map(len,rows))<100:raise ValueError('Insufficient independent spatial partitions for benchmark')
    model=fit(rows[0]); candidates=[0,.25,.5,.75,1]
    validation=[{'weight':w,**score(rows[1],predict(model,rows[1],w))} for w in candidates]
    weight=min(validation,key=lambda r:r['mae_m'])['weight']
    test_pred=predict(model,rows[2],weight)
    # Calibrate residual width on a separate spatial partition, then measure
    # achieved coverage on untouched blocks. No universal coverage guarantee.
    width=float(np.quantile(np.abs(predict(model,rows[1],weight)-rows[1][:,1]),.9,method='higher'))
    empirical_coverage=float(np.mean(np.abs(test_pred-rows[2][:,1])<=width))
    interp_width=float(np.quantile(np.abs(interpolation[1]),.9,method='higher')) if interpolation[1] else None
    interp_error=np.abs(np.array(interpolation[2]))
    test_blocks=np.asarray(sample_blocks[2]);block_metrics=[]
    for block in sorted(blocks[2]):
        mask=test_blocks==block;test=rows[2][mask];pred=test_pred[mask]
        block_metrics.append({'block':block,'model':score(test,pred),'no_change':score(test,test[:,0]),'band_coverage':float(np.mean(np.abs(pred-test[:,1])<=width))})
    # Resample spatial blocks, not thousands of correlated tree rows.
    rng=np.random.default_rng(20260910);improvements=[]
    for _ in range(2000):
        selected=rng.choice(len(block_metrics),len(block_metrics),replace=True)
        n=sum(block_metrics[i]['model']['n'] for i in selected)
        improvements.append(sum(block_metrics[i]['model']['n']*(block_metrics[i]['no_change']['mae_m']-block_metrics[i]['model']['mae_m']) for i in selected)/n)
    block_interval=np.quantile(improvements,[.025,.975]).tolist()
    by_band=[]
    for i in range(len(BANDS)-1):
        mask=(rows[2][:,0]>=BANDS[i])&(rows[2][:,0]<BANDS[i+1])
        if mask.any():by_band.append({'initial_height_band_m':[BANDS[i],BANDS[i+1]],'model':score(rows[2][mask],test_pred[mask]),'no_change':score(rows[2][mask],rows[2][mask,0])})
    final_model=fit(np.concatenate(rows))
    result={'model_id':MODEL_ID,'generated_utc':datetime.now(timezone.utc).isoformat(),'database_mtime_ns':mtime,'history_sha256_uncompressed_rows':digest.hexdigest(),'history_records':total,'fate_counts':dict(counts),
        'fit_id':MODEL_ID+'-'+digest.hexdigest()[:16],
        'target':'Matched canopy height conditional on a matched canopy being present at both endpoints; not survival or field-verified tree growth.',
        'epoch_years':[2013,2016,2024],'split':'SHA256 of 5 km NZTM grid cell; 60% train, 20% validation, 20% test. Adjacent blocks may remain correlated.',
        'split_n':dict(zip(['train','validation','test'],map(len,rows))),'split_blocks':dict(zip(['train','validation','test'],map(len,blocks))),
        'benchmark':{'input_year':2016,'target_year':2024,'duration_years':8,'model':score(rows[2],test_pred),'no_change':score(rows[2],rows[2][:,0]),'validation_candidates':validation,'selected_personal_trend_weight':weight,'heldout_empirical_band_coverage':empirical_coverage,'validation_abs_error_90_m':width,'by_spatial_block':block_metrics,'by_initial_height':by_band,'block_bootstrap_mae_improvement_95_m':block_interval,'bootstrap_note':'2000 resamples of five held-out 5 km cells, seed 20260910; limited geographic replication, not an individual-tree prediction interval.'},
        'interpolation':{'method':'Linear between observed bounding epochs, only when canopy was matched at both endpoints. Does not infer planting or presence outside those endpoints.','validation_abs_error_90_m':interp_width,'test_n':len(interp_error),'test_mae_m':float(interp_error.mean()) if len(interp_error) else None,'test_band_coverage':float(np.mean(interp_error<=interp_width)) if len(interp_error) and interp_width is not None else None},
        'projection':{'last_observation_year':2024,'horizons':[2030,2040],'personal_trend_weight':weight,'annual_band_halfwidth_m':width/8,'cohort_model':final_model,
        'rule':'Blend the most recent per-tree annual height change with its baseline-height cohort median using the validation-selected weight. Height is floored at zero. Empirical error width scales linearly with years since 2024; this scaling is an explicit, unvalidated extrapolation assumption.'},
        'limitations':['The benchmark compares remotely inferred canopy heights, not independent field measurements.','Matched survivors exclude losses, undetected and unmatched trees; outcomes cannot estimate mortality.','2030 and 2040 are conditional scenarios. Error bands have measured historical coverage, not a guaranteed future probability.','Survey epoch labels approximate acquisition time; within-epoch dates are not available here.','The trajectory matcher itself uses height/growth plausibility, so its output can favour smooth histories and bias a growth benchmark.','Training coverage is limited to 21 occupied 5 km cells; cohort transfer outside historic coverage is extrapolation.','No climate, pruning, construction or storm covariates are fitted.','The deployed cohort model is refitted on all eligible histories after selecting its weight; reported test metrics belong to the frozen training model.','No historical species, trunk or service measurements are invented.','An observed lifespan is a minimum observation span, not chronological tree age.']}
    if db.stat().st_mtime_ns!=mtime:raise ValueError('Source database changed during read-only model build')
    (staging/'model.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    (staging/'README.md').write_text('# ALTO canopy history and conditional height scenarios\n\nAll '+str(total)+' trajectory records are included, including unlinked historic detections and review flags. CSV epoch heights are observed model outputs; blank cells remain missing. Coordinates use WGS84 and NZTM (EPSG:2193). Presence flags describe matched detections, not certain biological absence. See model.json for the reproducible split, benchmark, assumptions and coverage.\n\nDo not infer tree age, removal responsibility, historical species diversity or lost ecosystem services from this table alone. The last two require historical species or structural models and uncertainty propagation.\n')
    files=[]
    for p in sorted(staging.iterdir()):
        if p.name=='manifest.json':continue
        h=hashlib.sha256()
        with p.open('rb') as f:
            for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
        files.append({'path':p.name,'bytes':p.stat().st_size,'sha256':h.hexdigest()})
    (staging/'manifest.json').write_text(json.dumps({'database_mtime_ns':mtime,'model_id':MODEL_ID,'files':files},indent=2)+'\n')
    import shutil
    if out.exists():shutil.rmtree(out)
    staging.rename(out);c.close()
    print(json.dumps({k:result[k] for k in ['history_records','fate_counts','split_n','split_blocks','benchmark','interpolation']},indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',type=Path,default=ROOT/'data/processed/akl_trees.sqlite');p.add_argument('--out',type=Path,default=ROOT/'data/processed/longitudinal');a=p.parse_args();build(a.db,a.out)
