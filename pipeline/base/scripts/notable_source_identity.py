"""Resolve versioned Council records to ALTO's original notable record IDs.

External OBJECTID and GlobalID can both change. An unchanged schedule, name and
position can identify a source record, but cannot verify the physical tree.
Ambiguous, moved, renamed, new or absent records require explicit review.
"""
from __future__ import annotations
import argparse,copy,hashlib,json,re
from collections import defaultdict,Counter
from pathlib import Path

class IdentityReviewRequired(ValueError):pass

def signature(feature):
    p=feature['properties'];g=feature.get('geometry') or {}
    if g.get('type')!='Point' or len(g.get('coordinates',[]))<2:raise ValueError('A notable record must have point geometry')
    clean=lambda v:re.sub(r'\s+',' ',str(v or '')).strip().casefold()
    return (clean(p.get('SCHEDULE')),clean(p.get('NAME')),*(round(float(x),7) for x in g['coordinates'][:2]))

def alias_key(feature):
    p=feature['properties'];return (str(p.get('OBJECTID')),str(p.get('GlobalID') or '').strip('{}').lower(),signature(feature))

def seed_registry(source_bytes):
    source=json.loads(source_bytes);records=[];seen=set()
    for f in source['features']:
        p=f['properties'];tree_id=f"akl_tree_not_{int(p['OBJECTID'])}"
        if tree_id in seen:raise ValueError('Duplicate original OBJECTID')
        seen.add(tree_id);signature(f)
        records.append({'alto_tree_id':tree_id,'original_feature':f})
    return {'schema_version':1,'baseline_sha256':hashlib.sha256(source_bytes).hexdigest(),'coordinate_decimals':7,'records':records}

def reconcile(source,registry):
    if registry.get('schema_version')!=1:raise ValueError('Unknown notable identity registry version')
    by_sig=defaultdict(list);by_alias=defaultdict(list);by_schedule=defaultdict(list)
    for row in registry['records']:
        f=row['original_feature'];sig=signature(f)
        by_sig[sig].append(row);by_alias[alias_key(f)].append(row);by_schedule[sig[0]].append(row['alto_tree_id'])
    features=source['features'];incoming=Counter(signature(f) for f in features)
    proposed=[];review=[]
    for f in features:
        sig=signature(f);exact=by_alias.get(alias_key(f),[]);semantic=by_sig.get(sig,[])
        method=None;row=None
        if len(exact)==1:row=exact[0];method='unchanged_source_alias_and_content'
        elif len(semantic)==1 and incoming[sig]==1:row=semantic[0];method='unique_unchanged_schedule_name_position'
        if row is None:
            review.append({'feature':f,'reason':'ambiguous_or_changed_source_record','candidate_alto_ids':sorted(set(by_schedule.get(sig[0],[]))),'automatic_action':'none'})
        else:proposed.append((f,row,method))
    counts=Counter(row['alto_tree_id'] for f,row,method in proposed)
    resolved=[];crosswalk=[];seen=set()
    for f,row,method in proposed:
        tid=row['alto_tree_id']
        if counts[tid]!=1:
            review.append({'feature':f,'reason':'multiple_source_records_resolve_to_one_alto_id','candidate_alto_ids':[tid],'automatic_action':'none'});continue
        enriched=copy.deepcopy(f);enriched['properties']['ALTO_TREE_ID']=tid;enriched['properties']['ALTO_IDENTITY_METHOD']=method
        resolved.append(enriched);seen.add(tid);p=f['properties'];o=row['original_feature']['properties']
        crosswalk.append({'alto_tree_id':tid,'schedule':p.get('SCHEDULE'),'original_objectid':o.get('OBJECTID'),'current_objectid':p.get('OBJECTID'),'original_globalid':o.get('GlobalID'),'current_globalid':p.get('GlobalID'),'method':method,'position_verified':str(p.get('TYPE'))=='1'})
    absent=[{'alto_tree_id':r['alto_tree_id'],'original_feature':r['original_feature'],'reason':'not_uniquely_resolved_in_this_snapshot','automatic_action':'retain_existing_record_unchanged'} for r in registry['records'] if r['alto_tree_id'] not in seen]
    return {'schema_version':1,'baseline_sha256':registry['baseline_sha256'],'resolved_source_records':len(resolved),'source_records':len(features),'pending_source_records':len(review),'unresolved_existing_records':len(absent),'safe_for_full_inventory_rebuild':not review and not absent,'crosswalk':crosswalk,'review':review,'unresolved_existing':absent,'resolved_features':resolved}

def resolve_for_import(source,registry_path):
    registry=json.loads(Path(registry_path).read_text());result=reconcile(source,registry)
    if not result['safe_for_full_inventory_rebuild']:
        raise IdentityReviewRequired(f"Council notable IDs need reconciliation: {result['pending_source_records']} source records and {result['unresolved_existing_records']} existing ALTO records need review. No inventory output should be written. Run notable_source_identity.py to create the review report; do not rebuild IDs from OBJECTID.")
    result_source=copy.deepcopy(source);result_source['features']=result['resolved_features'];return result_source

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--source',type=Path,required=True);ap.add_argument('--registry',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    raw=args.source.read_bytes();reg=json.loads(args.registry.read_text());result=reconcile(json.loads(raw),reg);result['source_sha256']=hashlib.sha256(raw).hexdigest();result['source_path']=str(args.source)
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/'reconciliation.json').write_text(json.dumps(result,indent=2))
    (args.out/'crosswalk.json').write_text(json.dumps({'source_sha256':result['source_sha256'],'baseline_sha256':reg['baseline_sha256'],'records':result['crosswalk']},indent=2))
    (args.out/'matched_records_for_review.geojson').write_text(json.dumps({'type':'FeatureCollection','review_only':not result['safe_for_full_inventory_rebuild'],'features':result['resolved_features']}))
    print(json.dumps({k:v for k,v in result.items() if not isinstance(v,(list,dict))},indent=2))
if __name__=='__main__':main()
