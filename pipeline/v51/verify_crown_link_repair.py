#!/usr/bin/env python3
"""Independent conservation and relationship checks for a repaired V5 copy."""
import argparse
from collections import Counter
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import sqlite3


def connect(path):
    wal=Path(str(path)+'-wal')
    if wal.exists() and wal.stat().st_size:
        raise ValueError('Verification requires a checkpointed immutable snapshot')
    # Checkpointed clones have no writable SHM directory under the read-only
    # sandbox. Immutable mode avoids creating side files; state is checked below.
    c=sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1',uri=True);c.row_factory=sqlite3.Row
    c.execute('BEGIN');return c


def rows_hash(c,table):
    sha=hashlib.sha256();n=0
    for row in c.execute('SELECT * FROM '+table+' ORDER BY rowid'):
        sha.update(json.dumps(tuple(row),separators=(',',':'),ensure_ascii=False).encode()+b'\n');n+=1
    return {'rows':n,'logical_sha256':sha.hexdigest()}


def verify(plan_path,db_path):
    plan=json.loads(plan_path.read_text());paths=[Path(plan['baseline_path']),db_path]
    states=[(p.stat().st_size,p.stat().st_mtime_ns) for p in paths]
    base=connect(paths[0]);fixed=connect(db_path)
    report={'checked_at_utc':datetime.now(timezone.utc).isoformat(),'database':str(db_path),
            'plan_sha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),'counts':{},'history':{},'examples':{}}
    tables=('trees','tree_crown_v4','tree_crown_v5','tree_trajectory_pilot','tree_display_v5',
            'tree_current_services_v5','tree_current_assets_v5','tree_current_roots_v5',
            'tree_current_crown_v5','tree_crown_v5_links')
    for table in tables:
        old=base.execute('SELECT count(*) FROM '+table).fetchone()[0]
        new=fixed.execute('SELECT count(*) FROM '+table).fetchone()[0]
        report['counts'][table]={'before':old,'after':new}
        if table not in ('tree_display_v5','tree_current_crown_v5','tree_crown_v5_links'):
            assert old==new,table
    count=plan['counts']['restored_records']
    assert report['counts']['tree_display_v5']['before']-report['counts']['tree_display_v5']['after']==count
    assert report['counts']['tree_current_crown_v5']['after']-report['counts']['tree_current_crown_v5']['before']==count
    print('Counts conserved; checking affected records and geometry',flush=True)
    affected=set();changes=Counter()
    for group in plan['groups']:
        seg=group['seg_key'];primary=group['primary']
        old=dict(base.execute('SELECT * FROM tree_crown_v5 WHERE seg_key=?',(seg,)).fetchone())
        new=dict(fixed.execute('SELECT * FROM tree_crown_v5 WHERE seg_key=?',(seg,)).fetchone())
        assert new.pop('primary_tree_id')==primary
        old.pop('primary_tree_id');assert old==new,seg
        ids=[r[0] for r in fixed.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?',(seg,))]
        members=json.loads(fixed.execute('SELECT members_json FROM tree_identity_v5 WHERE tree_id=?',(primary,)).fetchone()[0])
        assert set(ids)=={m['tree_id'] for m in members}
        for tid in ids:
            affected.add(tid)
            assert tuple(base.execute('SELECT * FROM trees WHERE tree_id=?',(tid,)).fetchone())==tuple(fixed.execute('SELECT * FROM trees WHERE tree_id=?',(tid,)).fetchone()),tid
            for table in ('tree_evidence_v5','tree_identity_v5'):
                row=fixed.execute('SELECT seg_key,current_primary_tree_id,link_role FROM '+table+' WHERE tree_id=?',(tid,)).fetchone()
                assert tuple(row)==(seg,primary,'primary' if tid==primary else 'same_crown_candidate')
            row=fixed.execute('SELECT crown_area_m2,crown_max_chm_m,current_primary_tree_id FROM tree_current_crown_v5 WHERE tree_id=?',(tid,)).fetchone()
            assert tuple(row)==(old['crown_area_m2'],old['height_m'],primary)
        placeholders=','.join('?' for _ in ids)
        for table in ('tree_display_v5','tree_current_services_v5','tree_current_assets_v5','tree_current_roots_v5'):
            representatives=[r[0] for r in fixed.execute('SELECT tree_id FROM '+table+' WHERE tree_id IN ('+placeholders+')',ids)]
            assert representatives==[primary],(seg,table,representatives)
        changes['verified_crown_geometries']+=1
    report['relationships']={**dict(changes),'source_records_byte_equivalent_as_rows':len(affected),
                             'one_display_and_one_service_asset_root_record_per_repaired_crown':True}
    for tid in ('akl_tree_trp_ACCT0255252','akl_tree_trp_ACCT0060116','akl_tree_trp_ACCT0243631','akl_tree_trp_ACCT0060118'):
        report['examples'][tid]={label:{table:dict(c.execute('SELECT * FROM '+table+' WHERE tree_id=?',(tid,)).fetchone())
                                       for table in ('tree_evidence_v5','tree_identity_v5')}
                                 for label,c in (('before',base),('after',fixed))}
    print('Checking every historical trajectory',flush=True)
    for label,c in (('before',base),('after',fixed)):
        report['history'][label]=rows_hash(c,'tree_trajectory_pilot')
    assert report['history']['before']==report['history']['after']
    assert states==[(p.stat().st_size,p.stat().st_mtime_ns) for p in paths]
    assert not any(Path(str(p)+'-wal').exists() and Path(str(p)+'-wal').stat().st_size for p in paths)
    report['success']=True
    base.close();fixed.close();return report


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--plan',type=Path,required=True)
    ap.add_argument('--db',type=Path,required=True);ap.add_argument('--out',type=Path,required=True)
    a=ap.parse_args();r=verify(a.plan,a.db);a.out.write_text(json.dumps(r,indent=2)+'\n')
    print(json.dumps({k:v for k,v in r.items() if k!='examples'},indent=2))
