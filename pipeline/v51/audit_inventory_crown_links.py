#!/usr/bin/env python3
"""Audit V5 source-to-crown continuity without changing the source database.

Inventory points, old crown links, actual polygon lineage, current point links,
and dated trajectories are kept as separate evidence. Nearby crowns are search
candidates, not assertions of organism identity. All distances use EPSG:2193.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sqlite3

import numpy as np
import pyarrow.parquet as pq
from scipy.spatial import cKDTree
from pyproj import Transformer
import shapely
from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

SOURCES = ('tree_register_points', 'notable_trees_overlay',
           'ruru_obskauri_tiaki_public', 'osm_natural_tree')
DETECTIONS = ('lidar_inferred_canopy', 'lidar_pointcloud_v4', 'lidar_pointcloud_v5',
              'low_canopy_promoted', 'pointcloud_missed_promoted')
ROOT = Path('/data/alto')
WORK = ROOT / 'working/alto_v5_20260922'


def log(*values):
    print(datetime.now().strftime('%H:%M:%S'), *values, flush=True)


def state(path):
    s = path.stat()
    wal = Path(str(path) + '-wal')
    return {'bytes': s.st_size, 'mtime_ns': str(s.st_mtime_ns),
            'wal_bytes': wal.stat().st_size if wal.exists() else 0}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def exterior_covers(geom, point):
    parts = [geom] if geom.geom_type == 'Polygon' else list(geom.geoms)
    return any(Polygon(p.exterior).covers(point) for p in parts)


def run(db_path, out, radius=6.0):
    out.mkdir(parents=True, exist_ok=True)
    target = out / 'audit.sqlite'
    if target.exists():
        raise ValueError(f'Existing audit is immutable; choose a new output: {target}')
    initial = state(db_path)
    if initial['wal_bytes']:
        raise ValueError('Use a checkpointed, stable baseline for a reproducible audit')
    c = sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    c.execute('BEGIN')
    output = sqlite3.connect(target)
    output.executescript('''
      CREATE TABLE inventory(tree_id TEXT PRIMARY KEY,source TEXT,owner TEXT,
        role TEXT,coverage INTEGER,old_seg_key TEXT,trajectory INTEGER,payload_json TEXT);
      CREATE TABLE candidates(tree_id TEXT,seg_key TEXT,edge_m REAL,old_fraction REAL,
        new_fraction REAL,in_hole INTEGER,payload_json TEXT,PRIMARY KEY(tree_id,seg_key));
      CREATE TABLE crowns(seg_key TEXT PRIMARY KEY,geometry_sha256 TEXT,payload_json TEXT,crown_wkb BLOB);
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value_json TEXT);
    ''')
    work = db_path.parent
    source = work / 'existing_v5.parquet'
    inventories = {p['tree_id']: p for p in pq.read_table(
        source, filters=[('source_primary', 'in', list(SOURCES))]).to_pylist()}
    inventory_count = len(inventories)
    log('Inventory source points', inventory_count)
    history = defaultdict(list)
    # A single sequential trajectory pass avoids the unindexed canonical_tree_id join.
    for r in c.execute('SELECT * FROM tree_trajectory_pilot WHERE canonical_tree_id IS NOT NULL'):
        if r['canonical_tree_id'] in inventories:
            history[r['canonical_tree_id']].append(dict(r))
    # Also inspect historical detections whose persistent trajectory became
    # detached. Preserve all their trajectory rows, including contradictions.
    detached = defaultdict(list)
    for r in c.execute('''SELECT tr.* FROM tree_trajectory_pilot tr
            JOIN tree_evidence_v5 e ON e.tree_id=tr.canonical_tree_id
            WHERE e.link_role='unlinked' '''):
        if r['canonical_tree_id'] not in inventories:
            detached[r['canonical_tree_id']].append(dict(r))
    to2193 = Transformer.from_crs(4326,2193,always_xy=True)
    for tid, trajectories in detached.items():
        if not any(t['fate']=='persistent' and t['present_2024']==1 for t in trajectories):
            continue
        row=c.execute('''SELECT t.lon,t.lat,t.source_primary,co.within_v5_footprint
              FROM trees t JOIN tree_coverage_v5 co USING(tree_id) WHERE t.tree_id=?''',(tid,)).fetchone()
        if row['source_primary'] not in DETECTIONS or not row['within_v5_footprint']:
            continue
        x,y=to2193.transform(row['lon'],row['lat'])
        inventories[tid]={'x':x,'y':y}
        history[tid]=trajectories
    log('Detached persistent historical detections added',len(inventories)-inventory_count)
    query = '''SELECT t.*,e.seg_key AS current_seg_key,e.link_role,
       e.current_primary_tree_id,e.evidence_tier,co.within_v5_footprint,
       v4.seg_key AS old_seg_key,v4.dist_to_crown_m AS old_edge_m,
       v4.dist_to_top_m AS old_top_m,lr.automatic_crown_link_allowed,
       d.display_role FROM trees t JOIN tree_evidence_v5 e USING(tree_id)
       JOIN tree_coverage_v5 co USING(tree_id)
       LEFT JOIN tree_crown_v4_links v4 USING(tree_id)
       LEFT JOIN tree_location_review_v5 lr USING(tree_id)
       LEFT JOIN tree_display_v5 d USING(tree_id) WHERE t.tree_id=?'''
    old_cache, records, targets = {}, {}, {}
    populations = Counter()
    for tid, p in inventories.items():
        r = dict(c.execute(query, (tid,)).fetchone())
        r.update(x=p['x'], y=p['y'], trajectories=history.get(tid, []))
        r['current_point_candidates'] = [dict(a) for a in c.execute(
            'SELECT * FROM v5_point_candidates WHERE tree_id=?', (tid,))]
        old = r['old_seg_key']
        if old:
            if old not in old_cache:
                row = dict(c.execute('SELECT seg_key,primary_tree_id,height_m,crown_area_m2,crown_wkb '
                                     'FROM tree_crown_v4 WHERE seg_key=?', (old,)).fetchone())
                row['geometry_sha256'] = digest(row.pop('crown_wkb'))
                row['lineage'] = [dict(a) for a in c.execute(
                    'SELECT * FROM tree_crown_lineage_v5 WHERE old_seg_key=?', (old,))]
                old_cache[old] = row
            r['previous_crown'] = old_cache[old]
        records[tid] = r
        populations[(r['source_primary'], r['owner_class'], r['link_role'],
                     r['within_v5_footprint'], bool(old))] += 1
        if r['link_role'] == 'unlinked' and r['within_v5_footprint']:
            targets[tid] = r
        output.execute('INSERT INTO inventory VALUES(?,?,?,?,?,?,?,?)',
                       (tid,r['source_primary'],r['owner_class'],r['link_role'],
                        r['within_v5_footprint'],old,len(r['trajectories']),json.dumps(r)))
    output.commit()
    log('Unlinked inventory and historical positions in coverage', len(targets))
    keys = list(targets)
    xy = np.array([[targets[t]['x'], targets[t]['y']] for t in keys])
    spatial = cKDTree(xy)
    manifest = ROOT / 'point_cloud_2024/auckland_metro_v1/manifest.jsonl'
    boxes = {Path(t['tile']).stem: t['bbox_2193'][-4:] for t in
             (json.loads(line) for line in manifest.read_text().splitlines() if line.strip())}
    # Use each tile's recorded build input, including production reruns.
    tiles = [dict(r) for r in c.execute('SELECT * FROM v5_tile_build ORDER BY tile')]
    candidates = defaultdict(dict)
    source_receipts = {}
    for i, tile in enumerate(tiles):
        bb = boxes[tile['tile']]
        centre = [(bb[0]+bb[2])/2, (bb[1]+bb[3])/2]
        # Segments belong to their survey tile; the extra 40 m also admits halo boundaries.
        idx = spatial.query_ball_point(centre, math.hypot(bb[2]-bb[0],bb[3]-bb[1])/2+radius+40)
        if not idx or not tile['trees']:
            continue
        path = Path(tile['source_file'])
        source_receipts[str(path)] = digest(path.read_bytes())
        rows = pq.read_table(path, columns=['x_2193','y_2193','crown_wkb'],
                             filters=[('canopy_class','=','tree')]).to_pylist()
        gs = shapely.from_wkb([r['crown_wkb'] for r in rows])
        tree = STRtree(gs)
        near = tree.query(shapely.points(xy[idx]), predicate='dwithin', distance=radius)
        for a,b in near.T:
            tid = keys[idx[a]]
            seg = f"{tile['tile']}:{rows[b]['x_2193']:.2f}:{rows[b]['y_2193']:.2f}"
            candidates[tid][seg] = True
        if i % 200 == 0:
            log('Spatial tiles', i, '/', len(tiles))
    # Follow actual old-segment lineage as well as proximity. This is essential
    # when a source point was offset from its previous canopy.
    for tid, r in targets.items():
        for a in r.get('previous_crown', {}).get('lineage', []):
            candidates[tid][a['new_seg_key']] = True
    crown_cache = {}

    def crown(seg):
        if seg not in crown_cache:
            r = dict(c.execute('SELECT * FROM tree_crown_v5 WHERE seg_key=?', (seg,)).fetchone())
            blob = r.pop('crown_wkb')
            r['geometry_sha256'] = digest(blob)
            r['primary_record'] = dict(c.execute('SELECT tree_id,source_primary,species_latin,owner_class '
                                                'FROM trees WHERE tree_id=?', (r['primary_tree_id'],)).fetchone())
            r['inventory_members'] = [dict(a) for a in c.execute(
                'SELECT t.tree_id,t.source_primary,t.species_latin,t.lon,t.lat FROM tree_crown_v5_links l '
                'JOIN trees t USING(tree_id) WHERE l.seg_key=? AND t.source_primary NOT IN (' +
                ','.join('?' for _ in DETECTIONS) + ')', (seg, *DETECTIONS))]
            output.execute('INSERT INTO crowns VALUES(?,?,?,?)',
                           (seg,r['geometry_sha256'],json.dumps(r),blob))
            crown_cache[seg] = (r, shapely.from_wkb(blob))
        return crown_cache[seg]

    issues = Counter()
    for tid,r in targets.items():
        pt = Point(r['x'],r['y'])
        lineage = {a['new_seg_key']:a for a in r.get('previous_crown',{}).get('lineage',[])}
        actual = []
        for seg in sorted(candidates[tid]):
            cr,g = crown(seg)
            edge = pt.distance(g)
            a = {'tree_id':tid,'seg_key':seg,'edge_m':edge,
                 'top_m':math.hypot(r['x']-cr['x_2193'],r['y']-cr['y_2193']),
                 'in_hole':not g.covers(pt) and exterior_covers(g,pt),
                 'contains_point':g.covers(pt),
                 **{k:lineage.get(seg,{}).get(k,0) for k in ('intersection_m2','old_fraction','new_fraction')}}
            output.execute('INSERT INTO candidates VALUES(?,?,?,?,?,?,?)',
                           (tid,seg,edge,a['old_fraction'],a['new_fraction'],int(a['in_hole']),json.dumps(a)))
            actual.append(a)
        close = [a for a in actual if a['edge_m'] <= radius]
        persistent = any(t['fate']=='persistent' and t['present_2024']==1 for t in r['trajectories'])
        if close:
            issues['nearby_current_crown'] += 1
            if r['old_seg_key']:issues['nearby_current_crown_previously_linked'] += 1
            if persistent:issues['nearby_current_crown_persistent_history'] += 1
            if any(crown(a['seg_key'])[0]['primary_record']['source_primary'] in DETECTIONS for a in close):
                issues['nearby_current_crown_with_detection_primary'] += 1
            distance = min(a['edge_m'] for a in close)
            issues['nearest_edge_le_1m' if distance <= 1 else 'nearest_edge_1_to_3m' if distance <= 3 else 'nearest_edge_3_to_6m'] += 1
        else:issues['no_tree_class_crown_within_6m'] += 1
        if any(a['in_hole'] for a in actual):issues['point_in_polygon_hole'] += 1
        if len(r['current_point_candidates'])>1:issues['multiple_exact_containment_candidates'] += 1
        if r['automatic_crown_link_allowed']==0 or (r['source_primary']=='notable_trees_overlay' and r['notable_point_type']!='1'):
            issues['source_location_unverified'] += 1
    output.commit()
    log('Checking preserved histories of earlier detections')
    # Indexed evidence lookup per trajectory; output is a small aggregate, not a
    # duplicate trajectory table. Spatial repair of detector-only records remains separate.
    histories = [dict(r) for r in c.execute('''SELECT t.source_primary,e.link_role,tr.fate,
        tr.present_2013,tr.present_2016,tr.present_2024,count(*) AS n
        FROM tree_trajectory_pilot tr JOIN trees t ON t.tree_id=tr.canonical_tree_id
        JOIN tree_evidence_v5 e ON e.tree_id=tr.canonical_tree_id
        WHERE tr.canonical_tree_id IS NOT NULL
        GROUP BY t.source_primary,e.link_role,tr.fate,tr.present_2013,tr.present_2016,tr.present_2024''')]
    summary = {'schema_version':1,'created_at_utc':datetime.now(timezone.utc).isoformat(),
               'baseline_path':str(db_path),'baseline_state':initial,
               'source_points_sha256':digest(source.read_bytes()),
               'manifest_sha256':digest(manifest.read_bytes()),
               'spatial_search_radius_m':radius,'inventory_records':inventory_count,
               'additional_historical_detection_records':len(records)-inventory_count,
               'unlinked_inventory_in_coverage':sum(r['source_primary'] in SOURCES for r in targets.values()),
               'unlinked_records_spatially_audited':len(targets),
               'populations':[{'source':k[0],'owner':k[1],'role':k[2],'coverage':k[3],'previous_v4_link':k[4],'n':v}
                              for k,v in sorted(populations.items())],
               'issues':dict(issues),'histories':histories,'tile_input_sha256':source_receipts,
               'limitations':['No nearby crown is automatically a confirmed biological match.',
                 'Historical trajectories are earlier spatial matching estimates, not independent field truth.',
                 'Six metre spatial search plus all intersecting V4 lineage; lower vegetation is not relabelled as a tree.',
                 'No crown geometries, original points, source identities, trajectories or canonical data changed.']}
    if initial != state(db_path):
        raise ValueError('Baseline changed during audit')
    output.execute('INSERT INTO metadata VALUES(?,?)',('summary',json.dumps(summary)))
    output.commit();output.close();c.close()
    (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    log('Audit complete', {k:v for k,v in summary.items() if k in ('inventory_records','unlinked_inventory_in_coverage','issues')})
    return summary


if __name__ == '__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--db',type=Path,default=WORK/'akl_trees.sqlite')
    ap.add_argument('--out',type=Path,required=True)
    a=ap.parse_args();run(a.db,a.out)
