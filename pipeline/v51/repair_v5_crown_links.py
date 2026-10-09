#!/usr/bin/env python3
"""Restore conservative V4→V5 crown associations in an isolated database copy.

These are spatial associations, not a biological-tree deduplication or a new
segmentation. Source records, positions, dated measurements and polygon WKB
are never edited. Ambiguous cases receive an explicit review status.
"""
from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sqlite3

from audit_inventory_crown_links import DETECTIONS, SOURCES, digest, state

METHOD = 'v5_crown_continuity_repair_1'
POLICY = {'inventory_edge_m':3.0,'historical_detection_edge_m':1.5,
          'minimum_old_fraction':0.5,'minimum_new_fraction':0.6,
          'minimum_intersection_m2':4.0,'competitor_edge_margin_m':1.0,
          'competitor_old_fraction':0.2,'maximum_height_difference_m':3.0,
          'maximum_height_difference_fraction':0.25,
          'relationship':'restored spatial crown association; organism identity remains separate'}


def taxon(value):
    words=(value or '').lower().replace('×','x').split()
    if len(words)<2 or words[1] in ('sp.','spp.','sp','spp'):
        return None
    return ' '.join(words[:3] if words[1]=='x' else words[:2])


def select_candidate(record, candidates, crowns):
    """Return a supported segment or an auditable reason to abstain."""
    if record['link_role']!='unlinked' or not record['within_v5_footprint']:
        return None,'already_linked_or_outside_coverage'
    if record.get('automatic_crown_link_allowed')==0 or (
            record['source_primary']=='notable_trees_overlay' and record.get('notable_point_type')!='1'):
        return None,'source_location_unverified'
    # Only managed inventories and persistent historical detections are repaired
    # without an individual review. Other source types stay in the review queue.
    detector=record['source_primary'] in DETECTIONS
    if not detector and (record['source_primary']!='tree_register_points' or
            record['owner_class'] not in ('Auckland Transport','Auckland Council Parks')):
        return None,'source_requires_individual_review'
    history=record.get('trajectories',[])
    if len(history)>1 or any(t['present_2024']!=1 or t['fate'] in ('lost','removed','dead') for t in history):
        return None,'historical_presence_conflict'
    if detector and (len(history)!=1 or history[0]['fate']!='persistent'):
        return None,'no_persistent_history'
    old=record.get('previous_crown')
    if not old:
        return None,'no_previous_crown_link'
    edge_limit=POLICY['historical_detection_edge_m' if detector else 'inventory_edge_m']
    strong=[a for a in candidates if a['edge_m']<=edge_limit
            and a['old_fraction']>=POLICY['minimum_old_fraction']
            and a['new_fraction']>=POLICY['minimum_new_fraction']
            and a['intersection_m2']>=POLICY['minimum_intersection_m2']]
    if len(strong)!=1:
        return None,'no_unique_dominant_crown_continuation'
    chosen=strong[0]
    if any(a['seg_key']!=chosen['seg_key'] and (
            a['edge_m']<=chosen['edge_m']+POLICY['competitor_edge_margin_m'] or
            a['old_fraction']>=POLICY['competitor_old_fraction']) for a in candidates):
        return None,'competing_crowns'
    h=crowns[chosen['seg_key']]['height_m']
    heights=[old['height_m']]+[t['h_2024'] for t in history if t.get('h_2024') is not None]
    if any(not isinstance(v,(int,float)) or not math.isfinite(v) or v<=0 or
           abs(h-v)>max(POLICY['maximum_height_difference_m'],
                        POLICY['maximum_height_difference_fraction']*v) for v in heights):
        return None,'height_disagreement'
    return chosen,None


def reconcile_group(proposed, existing_members, records, crown):
    """Keep shared-crown records; never collapse different old crowns/taxa."""
    ids=sorted(set(proposed)|{m['tree_id'] for m in existing_members})
    if any(t not in records for t in ids):
        return None,'unresolved_existing_members'
    if len({records[t].get('old_seg_key') for t in ids})!=1:
        return None,'different_previous_crowns'
    known={taxon(records[t].get('species_latin')) for t in ids}
    known.discard(None)
    genera={(records[t].get('species_latin') or '').strip().lower().split()[0]
            for t in ids if (records[t].get('species_latin') or '').strip()}
    if len(known)>1 or len(genera)>1:
        return None,'conflicting_recorded_taxa'
    current=crown['primary_tree_id']
    # Existing inventory representatives remain stable. Otherwise prefer the
    # former crown representative, then a source with preserved history.
    inventory=[t for t in ids if records[t]['source_primary'] not in DETECTIONS]
    if current in inventory:
        primary=current
    else:
        pool=inventory or ids
        primary=min(pool,key=lambda t:(
            records[t].get('previous_crown',{}).get('primary_tree_id')!=t,
            not bool(records[t].get('trajectories')),t))
    return {'seg_key':crown['seg_key'],'old_primary':current,'primary':primary,
            'restored_ids':sorted(proposed),'existing_inventory_ids':[m['tree_id'] for m in existing_members],
            'old_seg_key':records[ids[0]]['old_seg_key'],
            'geometry_sha256':crown['geometry_sha256']},None


def build_plan(audit_path, out):
    a=sqlite3.connect(audit_path);a.row_factory=sqlite3.Row
    summary=json.loads(a.execute("SELECT value_json FROM metadata WHERE key='summary'").fetchone()[0])
    baseline=Path(summary['baseline_path'])
    if state(baseline)!=summary['baseline_state']:
        raise ValueError('Audit baseline has changed')
    records={r['tree_id']:json.loads(r['payload_json']) for r in a.execute('SELECT * FROM inventory')}
    crowns={r['seg_key']:json.loads(r['payload_json']) for r in a.execute('SELECT seg_key,payload_json FROM crowns')}
    candidates=defaultdict(list)
    for row in a.execute('SELECT payload_json FROM candidates'):
        r=json.loads(row[0]);candidates[r['tree_id']].append(r)
    decisions={};proposals=defaultdict(dict)
    for tid,r in records.items():
        if r['link_role']!='unlinked' or not r['within_v5_footprint']:
            continue
        selected,reason=select_candidate(r,candidates[tid],crowns)
        decisions[tid]={'tree_id':tid,'status':'needs_review','reason':reason,
                        'owner':r['owner_class'],'source':r['source_primary'],
                        'candidate_count':len(candidates[tid]),
                        'nearest_edge_m':min((c['edge_m'] for c in candidates[tid]),default=None)}
        if selected:
            proposals[selected['seg_key']][tid]=selected
    c=sqlite3.connect(baseline.as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
    groups=[]
    for seg,proposed in sorted(proposals.items()):
        group,reason=reconcile_group(proposed,crowns[seg]['inventory_members'],records,crowns[seg])
        if group:
            # Avoid silently consolidating several former canopies just because
            # this version joined them. Tiny incidental edge intersections remain evidence.
            others=list(c.execute('''SELECT old_seg_key FROM tree_crown_lineage_v5
                  WHERE new_seg_key=? AND old_seg_key!=? AND new_fraction>=0.2''',
                                  (seg,group['old_seg_key'])))
            if others:
                group=None;reason='multiple_previous_crowns_contribute'
        for tid in proposed:
            decisions[tid]['reason']=reason or 'dominant_polygon_continuity_and_small_position_offset'
            if group:
                decisions[tid].update(status='restore_association',seg_key=seg,primary=group['primary'],
                                     evidence=proposed[tid],old_seg_key=group['old_seg_key'],
                                     history_records=len(records[tid]['trajectories']))
        if group:groups.append(group)
    plan={'method_id':METHOD,'policy':POLICY,'created_at_utc':datetime.now(timezone.utc).isoformat(),
          'audit_path':str(audit_path.resolve()),'audit_sha256':digest(audit_path.read_bytes()),
          'baseline_path':str(baseline),'baseline_state':summary['baseline_state'],
          'script_sha256':digest(Path(__file__).read_bytes()),'groups':groups,
          'decisions':list(decisions.values()),
          'counts':{'groups':len(groups),'restored_records':sum(len(g['restored_ids']) for g in groups),
                    'changed_representatives':sum(g['primary']!=g['old_primary'] for g in groups),
                    'reasons':dict(Counter(d['reason'] for d in decisions.values())),
                    'restored_by_source':dict(Counter(d['source'] for d in decisions.values() if d['status']=='restore_association')),
                    'restored_by_owner':dict(Counter(d['owner'] for d in decisions.values() if d['status']=='restore_association'))}}
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(plan,indent=2)+'\n');c.close();a.close()
    return plan


def model_functions(code):
    spec=importlib.util.spec_from_file_location('repair_valuation',code/'valuation_baseline.py')
    model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
    tree=ast.parse((code/'assets_baseline.py').read_text());nodes=[]
    for n in tree.body:
        if isinstance(n,ast.FunctionDef) and n.name in ('estimate_dbh_crown','life_stage','replacement_years','irreplaceability'):
            nodes.append(n)
        if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('CLASS_MAX_HEIGHT_M','CLASS_CROWN_GROWTH_M2_Y') for t in n.targets):
            nodes.append(n)
    ns={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'preserved_assets','exec'),ns)
    return model,ns


def insert(c,table,record):
    fields=[r[1] for r in c.execute('PRAGMA table_info('+table+')')]
    c.execute('INSERT OR REPLACE INTO '+table+'('+','.join(fields)+') VALUES('+','.join('?' for _ in fields)+')',
              tuple(record.get(f) for f in fields))


def recalculate_models(c,tid,model,ns,stamp):
    row=c.execute('''SELECT t.tree_id,t.source_primary,
       coalesce(g.species_common,t.species_common) AS species_common,
       coalesce(g.species_latin,t.species_latin) AS species_latin,cr.*,
       ctx.in_flood_prone_area,ctx.in_flood_plain,ctx.fraction_paved_surfaces,ctx.air_temp_mean_c,
       imp.fraction_impervious_30m AS imperv_fraction_30m,
       p.predicted_species_class AS ml_species_class,p.species_class_confidence AS ml_species_class_confidence
       FROM trees t JOIN tree_current_crown_v5 cr USING(tree_id)
       LEFT JOIN tree_ground_evidence g USING(tree_id) LEFT JOIN tree_context_pilot ctx USING(tree_id)
       LEFT JOIN tree_impervious_pilot imp USING(tree_id)
       LEFT JOIN tree_species_class_predictions p USING(tree_id) WHERE t.tree_id=?''',(tid,)).fetchone()
    r=dict(row);mi=dict(r)
    if r['source_primary'] in DETECTIONS and not r['species_latin']:
        mi['source_primary']='lidar_inferred_canopy'
    v=model.compute_tree_valuation(mi)
    if r['source_primary'] in DETECTIONS:
        v.update(valuation_confidence='modelled_low',uncertainty_factor=.6,
                 total_value_nzd_y_low=v['total_value_nzd_y']*.4,total_value_nzd_y_high=v['total_value_nzd_y']*1.6)
    if not r['species_latin'] and (not r['species_common'] or r['species_common'].strip().lower() in
            ('unknown','species not recorded','0 records found.')) and not r['ml_species_class']:
        v['species_class_source']='default_evergreen_broadleaf_assumption'
    v['method_id']=model.VALUATION_ASSUMPTIONS['method_id']+'__v5_crown_inputs'
    v['created_at_utc']=stamp
    v['assumptions_json']=json.dumps({**model.VALUATION_ASSUMPTIONS,
        'geometry_basis':'unchanged v5 crown footprint and maximum height',
        'aggregation_unit':'one segmented crown; can represent one or more trees',
        'height_dbh_calibration':'unchanged uncalibrated sensitivity model',
        'association_method':METHOD})
    h=r['crown_max_chm_m'];diam=r['crown_diameter_m'];k=v['species_class']
    dbh,_=ns['estimate_dbh_crown'](h,diam,k);stage=ns['life_stage'](h,dbh,k)
    years=ns['replacement_years'](r['crown_area_m2'],k)
    assets=dict(tree_id=tid,height_max_m=h,height_mean_m=r['mean_veg_height_m'],dbh_cm_crown_est=dbh,
                dbh_confidence='modelled_low',life_stage=stage,replacement_years_canopy=years,
                irreplaceability_class=ns['irreplaceability'](years,h),method_id='crown_height_dbh_sensitivity_v5_inputs')
    crown_r=diam/2;foraging=1.5*crown_r;imp=r['imperv_fraction_30m']
    effective=foraging*math.sqrt(max(.05,1-.7*imp)) if imp is not None and 0<=imp<=1 else None
    stability=max(3*dbh/100,.12*h);rpaa=min(math.pi*(12*dbh/100)**2,707)
    flag='not_assessed' if effective is None else 'space_deficit_review' if effective<stability else 'constrained_scenario' if effective<.7*foraging else 'unconstrained_scenario'
    roots=dict(tree_id=tid,dbh_cm=dbh,trunk_circumference_cm=math.pi*dbh,crown_radius_m=crown_r,
               foraging_radius_m=foraging,effective_radius_m=effective,
               effective_area_m2=None if effective is None else math.pi*effective**2,
               stability_radius_m=stability,root_constraint_flag=flag,rpa_radius_m=math.sqrt(rpaa/math.pi),
               rpa_area_m2=rpaa,life_stage=stage,method_id='root_space_sensitivity_v5_inputs',
               model_confidence='scenario_only_unvalidated',
               constraint_basis='Known paving fraction only; neighbour partition omitted because crown separation is not root separation.')
    for table in ('tree_valuation_v5','tree_current_services_v5'):insert(c,table,v)
    for table in ('tree_assets_v5','tree_current_assets_v5'):insert(c,table,assets)
    for table in ('tree_roots_v5','tree_current_roots_v5'):insert(c,table,roots)


def apply(plan_path, db_path):
    plan=json.loads(plan_path.read_text());baseline=Path(plan['baseline_path'])
    if plan['script_sha256']!=digest(Path(__file__).read_bytes()):
        raise ValueError('Repair code changed; regenerate the reviewable plan')
    if db_path.resolve()==baseline.resolve() or db_path.samefile(baseline):
        raise ValueError('Repair must target an isolated copy, never the frozen baseline')
    if state(baseline)!=plan['baseline_state'] or state(db_path)!=plan['baseline_state']:
        raise ValueError('Expected a fresh metadata-preserving copy of the audited baseline')
    if digest(Path(plan['audit_path']).read_bytes())!=plan['audit_sha256']:
        raise ValueError('Audit changed after planning')
    a=sqlite3.connect(plan['audit_path']);a.row_factory=sqlite3.Row
    records={r['tree_id']:json.loads(r['payload_json']) for r in a.execute('SELECT * FROM inventory')}
    c=sqlite3.connect(db_path);c.row_factory=sqlite3.Row
    c.execute('PRAGMA cache_size=-100000');c.execute('PRAGMA journal_mode=WAL')
    code=baseline.parent/'code'
    if not (code/'valuation_baseline.py').exists():
        code=Path(__file__).resolve().parents[1]/'v5'  # this repository's copy of the v5 model code
    model,ns=model_functions(code)
    stamp=datetime.now(timezone.utc).isoformat()
    c.execute('BEGIN IMMEDIATE')
    try:
        c.execute('''CREATE TABLE tree_crown_link_repairs_v5(tree_id TEXT PRIMARY KEY,seg_key TEXT,
             primary_tree_id TEXT,old_seg_key TEXT,status TEXT,reason TEXT,evidence_json TEXT,method_id TEXT)''')
        c.execute('''CREATE TABLE crown_link_repair_runs(run_id TEXT PRIMARY KEY,plan_sha256 TEXT,
             baseline_path TEXT,baseline_state_json TEXT,completed_utc TEXT,summary_json TEXT)''')
        affected=set();geometry_receipts={};services_before=services_after=0.0
        for group in plan['groups']:
            seg=group['seg_key'];old=group['old_primary'];primary=group['primary']
            cr=dict(c.execute('SELECT * FROM tree_crown_v5 WHERE seg_key=?',(seg,)).fetchone())
            if cr['primary_tree_id']!=old or digest(cr['crown_wkb'])!=group['geometry_sha256']:
                raise ValueError('Crown changed after auditing: '+seg)
            geometry_receipts[seg]=group['geometry_sha256']
            original_value=c.execute('SELECT total_value_nzd_y FROM tree_current_services_v5 WHERE tree_id=?',(old,)).fetchone()
            services_before+=original_value[0] if original_value else 0
            # Generated V5 primaries were not included in the original point-link
            # table. Preserve them explicitly as aliases when representation changes.
            if not c.execute('SELECT 1 FROM tree_crown_v5_links WHERE tree_id=?',(old,)).fetchone():
                c.execute('INSERT INTO tree_crown_v5_links VALUES(?,?,?,?,?)',(old,seg,0.0,3,0.0))
            for tid in group['restored_ids']:
                e=c.execute('SELECT * FROM tree_evidence_v5 WHERE tree_id=?',(tid,)).fetchone()
                if not e or e['link_role']!='unlinked':
                    raise ValueError('Source association changed: '+tid)
                r=records[tid]
                top=math.hypot(r['x']-cr['x_2193'],r['y']-cr['y_2193'])
                c.execute('INSERT INTO tree_crown_v5_links VALUES(?,?,?,?,?)',
                          (tid,seg,top,3 if r['source_primary'] in DETECTIONS else 1,r['previous_crown']['crown_area_m2']))
            c.execute('UPDATE tree_crown_v5 SET primary_tree_id=? WHERE seg_key=?',(primary,seg))
            c.execute('INSERT OR REPLACE INTO v5_primary_selection(seg_key,tree_id) VALUES(?,?)',(seg,primary))
            members=[dict(r) for r in c.execute('''SELECT t.tree_id,t.source_primary AS source,
               t.species_common,t.species_latin,t.source_tree_id FROM tree_crown_v5_links l
               JOIN trees t USING(tree_id) WHERE l.seg_key=? ORDER BY t.tree_id''',(seg,))]
            member_json=json.dumps(members);n=len(members);ni=sum(m['source'] not in DETECTIONS for m in members)
            c.execute('UPDATE v5_group_summary SET primary_tree_id=?,source_records=?,inventory_records=?,members_json=? WHERE seg_key=?',
                      (primary,n,ni,member_json,seg))
            template=dict(c.execute('SELECT * FROM tree_current_crown_v5 WHERE tree_id=?',(old,)).fetchone())
            pc=dict(c.execute('SELECT * FROM tree_current_pointcloud_v5 WHERE tree_id=?',(old,)).fetchone())
            old_overlap=c.execute('''SELECT count(*) FROM tree_crown_lineage_v5
                  WHERE new_seg_key=? AND (old_fraction>=0.1 OR new_fraction>=0.1)''',(seg,)).fetchone()[0]
            for m in members:
                tid=m['tree_id'];affected.add(tid)
                e=dict(c.execute('SELECT * FROM tree_evidence_v5 WHERE tree_id=?',(tid,)).fetchone())
                e.update(seg_key=seg,current_primary_tree_id=primary,
                         evidence_tier=cr['evidence_tier'] if tid==primary else 'shared_crown_candidate',
                         link_role='primary' if tid==primary else 'same_crown_candidate',
                         current_height_m=cr['height_m'],current_crown_area_m2=cr['crown_area_m2'])
                e['top_distance_m']=c.execute('SELECT top_distance_m FROM tree_crown_v5_links WHERE tree_id=?',(tid,)).fetchone()[0]
                insert(c,'tree_evidence_v5',e)
                identity=dict(c.execute('SELECT * FROM tree_identity_v5 WHERE tree_id=?',(tid,)).fetchone())
                identity.update(e,source_records=n,inventory_records=ni,members_json=member_json if tid==primary else None,
                                old_overlapping_crowns=old_overlap,
                                spatial_evidence_note='Polygon containment and audited V4–V5 continuity associations; source positions and histories retained. Shared canopy does not prove one organism.')
                previous=c.execute('SELECT seg_key FROM tree_crown_v4_links WHERE tree_id=?',(tid,)).fetchone()
                identity['new_overlapping_crowns']=c.execute('''SELECT count(*) FROM tree_crown_lineage_v5
                    WHERE old_seg_key=? AND (old_fraction>=0.1 OR new_fraction>=0.1)''',(previous[0],)).fetchone()[0] if previous else None
                insert(c,'tree_identity_v5',identity)
                insert(c,'tree_current_crown_v5',{**template,'tree_id':tid,'current_primary_tree_id':primary})
                insert(c,'tree_current_pointcloud_v5',{**pc,'tree_id':tid})
                c.execute('DELETE FROM tree_display_v5 WHERE tree_id=?',(tid,))
            insert(c,'tree_display_v5',dict(tree_id=primary,lon=cr['lon'],lat=cr['lat'],display_role='current_crown',crown_source='v5',seg_key=seg))
            if old!=primary:
                for table in ('tree_valuation_v5','tree_current_services_v5','tree_assets_v5','tree_current_assets_v5','tree_roots_v5','tree_current_roots_v5'):
                    c.execute('DELETE FROM '+table+' WHERE tree_id=?',(old,))
                recalculate_models(c,primary,model,ns,stamp)
            services_after+=c.execute('SELECT total_value_nzd_y FROM tree_current_services_v5 WHERE tree_id=?',(primary,)).fetchone()[0]
        for d in plan['decisions']:
            c.execute('INSERT INTO tree_crown_link_repairs_v5 VALUES(?,?,?,?,?,?,?,?)',
                      (d['tree_id'],d.get('seg_key'),d.get('primary'),d.get('old_seg_key'),d['status'],d['reason'],json.dumps(d),METHOD))
        # Verify the repaired relationships and representative accounting before commit.
        for g in plan['groups']:
            seg=g['seg_key'];primary=g['primary']
            row=c.execute('SELECT crown_wkb,primary_tree_id FROM tree_crown_v5 WHERE seg_key=?',(seg,)).fetchone()
            assert digest(row[0])==geometry_receipts[seg] and row[1]==primary
            ids=[r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?',(seg,))]
            for tid in ids:
                e=c.execute('SELECT seg_key,current_primary_tree_id FROM tree_evidence_v5 WHERE tree_id=?',(tid,)).fetchone()
                cr=c.execute('SELECT current_primary_tree_id FROM tree_current_crown_v5 WHERE tree_id=?',(tid,)).fetchone()
                assert tuple(e)==(seg,primary) and cr[0]==primary
            marks=c.execute('SELECT tree_id FROM tree_display_v5 WHERE tree_id IN ('+','.join('?' for _ in ids)+')',ids).fetchall()
            assert [r[0] for r in marks]==[primary]
            services=c.execute('SELECT tree_id FROM tree_current_services_v5 WHERE tree_id IN ('+','.join('?' for _ in ids)+')',ids).fetchall()
            assert [r[0] for r in services]==[primary]
        result={**plan['counts'],'affected_records_including_existing_members':len(affected),
                'affected_service_total_before':services_before,'affected_service_total_after':services_after,
                'canonical_geometry_changed':False,'source_records_changed':False,'histories_changed':False,
                'public_release_changed':False,'database':str(db_path)}
        c.execute('INSERT INTO crown_link_repair_runs VALUES(?,?,?,?,?,?)',
                  (METHOD,digest(plan_path.read_bytes()),str(baseline),json.dumps(plan['baseline_state']),stamp,json.dumps(result)))
        c.commit();c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        if state(baseline)!=plan['baseline_state']:
            raise ValueError('Frozen baseline changed externally')
        return result
    except BaseException:
        c.rollback();raise
    finally:
        c.close();a.close()


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    sub=ap.add_subparsers(dest='command',required=True)
    p=sub.add_parser('plan');p.add_argument('--audit',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p=sub.add_parser('apply');p.add_argument('--plan',type=Path,required=True);p.add_argument('--db',type=Path,required=True);p.add_argument('--receipt',type=Path,required=True)
    args=ap.parse_args()
    if args.command=='plan':
        plan=build_plan(args.audit,args.out);print(json.dumps(plan['counts'],indent=2))
    else:
        result=apply(args.plan,args.db);args.receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
