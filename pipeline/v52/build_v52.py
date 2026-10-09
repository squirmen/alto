#!/usr/bin/env python3
"""Rebuild V5.2 from the verified record-to-crown linking package, on top of V5.1.

V5.1's crowns, polygon geometry, source records and estimates are retained. The
package's published links join source records that V5.1 left unlinked to an
existing V5 crown, or to a crown drawn from the 2024 laser returns at the
record's position. Every link is checked against the V5.1 release database first;
anything V5.1 already decided is reported and excluded, never overridden.
Changed profiles are regenerated from SQL; map features, property aggregates,
nearby choices and totals are rebuilt. No source ID, researcher decision or
submitted visit is removed.
"""
import argparse
import collections
import gzip
import hashlib
import importlib.util
import json
import math
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PIPE = Path(__file__).resolve().parents[1]  # pipeline/ in this repository
ROOT = Path('/data/alto')  # data root: audit outputs, live baseline copy and release receipts
W = Path('/data/alto/working/alto_v52_20261010')
W51 = W.parent / 'alto_v51_20261008'
V5 = W.parent / 'alto_v5_20260922'
PAR = W.parent / 'alto_parcels_20261002'
LINK = W.parent / 'link_v52_20261009'
DB51 = W51 / 'akl_trees.sqlite'
DB = W / 'akl_trees.sqlite'
STAGE51 = W51 / 'deploy/alto_v51_upload_20261008'
STAGE = W / 'deploy/alto_v52_upload_20261010'
PKG = W / 'inputs/v52_package'
OUT = ROOT / 'outputs/alto_v52_release'
VERSION = '20261010-v5.2'
VERSION51 = '20261008-v5.1'
DATASET_VERSION = 'metro-2026.10.10-pointcloud-v5.2'
METHOD = 'record_crown_link_v52'
SEEDED = 'record_seeded_v52'
DETECTION = ('lidar_inferred_canopy', 'lidar_pointcloud_v4', 'lidar_pointcloud_v5', 'low_canopy_promoted', 'pointcloud_missed_promoted')
CLASS_ORDER = {'linked': 0, 'probable': 1, 'drawn_from_record': 2}
# The release's Protected count (export_web_v5.py) plus the stored flag: a protected or notable tree
# never loses its map marker (decision of 10 Oct 2026).
PROTECTED_SQL = '''SELECT 1 FROM trees WHERE tree_id=? AND (source_primary='notable_trees_overlay' OR notable_group_match=1
    OR (notable_point_match=1 AND notable_point_type='1') OR is_protected_notable=1)'''
# Checksums stated in the package's merge note; the UI patch and prebuilt layer must be exactly those.
UI_PATCH_SHA256 = '2e210793c6bf95cb9f75024ff86d0c6a6db2852a6b2615c6c238ec6068dcc9a8'
POSITIONS_SHA256 = '8c6f5374ccc50cf60ae30b8841ec38bc950734916586d36abd81113c7c64150f'
CASES = {'probable': ['akl_tree_trp_ACCT0159885', 'akl_tree_trp_ACCT0257674'],
         'seeded': ['akl_tree_osm_node_7713504718', 'akl_tree_trp_ACCT0248773', 'akl_tree_trp_ACCT0151353'],
         'unchanged': ['akl_tree_trp_ACCT0169814', 'akl_tree_trp_ACCT0109736']}

LINK_FIELDS = ['seg_key', 'link_class', 'link_evidence', 'confidence', 'edge_distance_m', 'top_distance_m', 'shared_crown_n',
               'crown_source', 'display_style', 'review_status', 'source_lon', 'source_lat', 'method_id', 'crown_set_id',
               'status', 'joined_as', 'crown_canopy_class', 'crown_in_service_totals']
STATUS_FIELDS = ['status', 'reason', 'reason_text', 'method_id', 'crown_set_id']
LINK_DATASET = {'key': 'record_link', 'table': 'tree_record_link_v52', 'title': 'Record-to-crown link (v5.2)',
                'evidence': 'Positional matching with size and neighbour evidence',
                'note': 'Joins a source record that v5.1 left unlinked to a v5 crown, or to a crown drawn from the LiDAR returns at its position. The source position is kept unchanged (source_lon, source_lat). joined_as says whether the record became the crown\'s map marker or a member of a tree that already had one.',
                'fields': LINK_FIELDS, 'multiple': False}
STATUS_DATASET = {'key': 'record_link_status', 'table': 'tree_record_link_status_v52', 'title': 'Record-to-crown linking: left unlinked (v5.2)',
                  'evidence': 'Survey coverage', 'note': 'No v5 crowns or 2024 point cloud reach this position, so the record cannot be linked to a crown by any method. The record is unchanged and stays unlinked until the survey coverage is extended.',
                  'fields': STATUS_FIELDS, 'multiple': False}
NOTE_V5 = 'Record-to-crown link (v5.2): position relative to the crown edge, crown size plausible for the recorded taxon and the neighbouring records. The source position is kept. Shared canopy does not prove one organism.'
NOTE_SEEDED = 'Crown drawn in v5.2 from the 2024 laser returns at this record\'s position, where no v5 crown covered it; awaiting confirmation. The source position is kept.'
SEEDED_REASON = 'crown drawn from the source record; awaiting confirmation'
LOW_REASON = 'low canopy 2–3 m, not counted'
LOW_TEXT = 'Crown drawn from the LiDAR returns at this record\'s position (2–3 m low canopy, not counted in tree services); awaiting confirmation'
OUTSIDE_TEXT = 'No v5 crowns or 2024 point cloud reach this position, so it cannot be linked to a crown until the survey coverage is extended.'


def now():
    return datetime.now(timezone.utc).isoformat()


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + '\n')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(8 << 20), b''):
            h.update(b)
    return h.hexdigest()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def module(name):
    if str(W / 'code') not in sys.path:
        sys.path.insert(0, str(W / 'code'))
    spec = importlib.util.spec_from_file_location(name, W / 'code' / (name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def bucket(tid):
    h = 2166136261
    for b in tid.encode():
        h = ((h ^ b) * 16777619) & 0xffffffff
    return f'{(h % 65536) >> 8:02x}/{h & 255:02x}.json.gz'


def ro(path=DB):
    c = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA cache_size=-250000')
    return c


def py(v):
    """Plain Python values for SQLite: numpy scalars and NaN become int/float/None."""
    if v is None:
        return None
    if hasattr(v, 'item'):
        v = v.item()
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def package():
    import pandas as pd
    links = pd.read_parquet(PKG / 'links_publish.parquet')
    crowns = pd.read_parquet(PKG / 'new_crowns_publish.parquet').set_index('seg_key', drop=False)
    outside = pd.read_parquet(PKG / 'unlinked_outside_coverage.parquet', columns=['tree_id', 'status', 'reason', 'method_id', 'crown_set_id', 'lon', 'lat'])
    return links, crowns, outside


_TO2193 = []


def to2193(lon, lat):
    if not _TO2193:
        from pyproj import Transformer
        _TO2193.append(Transformer.from_crs(4326, 2193, always_xy=True).transform)
    return _TO2193[0](lon, lat)


def audit(c, links, crowns, outside):
    """Every published link must still describe a record V5.1 leaves unlinked, on a crown V5.1 has.

    The linker read the continuity-repair working database, not the V5.1 release itself. A record V5.1's continuity
    repair already restored, a moved source point or a missing crown is a conflict: it is reported
    and left out of V5.2 so that no V5.1 association is ever overridden.
    """
    import numpy as np
    import shapely
    from scipy.spatial import cKDTree
    conflicts, counts = [], collections.Counter()
    seeded_ids = {seg: set(json.loads(r)) for seg, r in zip(crowns.seg_key, crowns.record_ids_json)}
    tops = {}
    for r in links.itertuples(index=False):
        why = []
        t = c.execute('SELECT source_primary,source_tree_id,lon,lat FROM trees WHERE tree_id=?', (r.tree_id,)).fetchone()
        d = c.execute('SELECT display_role,crown_source FROM tree_display_v5 WHERE tree_id=?', (r.tree_id,)).fetchone()
        e = c.execute('SELECT link_role,seg_key FROM tree_evidence_v5 WHERE tree_id=?', (r.tree_id,)).fetchone()
        rp = c.execute('SELECT status FROM tree_crown_link_repairs_v5 WHERE tree_id=?', (r.tree_id,)).fetchone()
        lr = c.execute('SELECT automatic_crown_link_allowed FROM tree_location_review_v5 WHERE tree_id=?', (r.tree_id,)).fetchone()
        if t is None:
            why.append('record_missing_from_v51')
        else:
            if t['source_primary'] != r.source or str(t['source_tree_id']) != str(r.source_tree_id):
                why.append('source_identity_differs')
            x0, y0 = to2193(t['lon'], t['lat'])
            x1, y1 = to2193(r.lon, r.lat)
            if math.hypot(x0 - x1, y0 - y1) > 0.01:
                why.append('source_position_changed')
        if d is None or d['display_role'] != 'source_record':
            why.append('not_a_v51_unlinked_marker')
        if e is None or e['link_role'] != 'unlinked' or e['seg_key'] is not None:
            why.append('linked_in_v51')
        if c.execute('SELECT 1 FROM tree_crown_v5_links WHERE tree_id=?', (r.tree_id,)).fetchone():
            why.append('in_v51_crown_links')
        if rp is not None and rp[0] == 'restore_association':
            why.append('restored_by_v51_continuity_repair')
        if lr is not None and lr[0] == 0:
            why.append('source_location_unverified')
        if r.crown_source == 'v5':
            cr = c.execute('SELECT canopy_class,x_2193,y_2193 FROM tree_crown_v5 WHERE seg_key=?', (r.seg_key,)).fetchone()
            if cr is None or cr['canopy_class'] != 'tree':
                why.append('crown_missing_from_v51')
            elif t is not None:
                tops[r.tree_id] = math.hypot(x0 - cr['x_2193'], y0 - cr['y_2193'])
        elif r.crown_source == SEEDED:
            if r.seg_key not in seeded_ids or r.tree_id not in seeded_ids[r.seg_key]:
                why.append('seeded_crown_missing_from_package')
            elif c.execute('SELECT 1 FROM tree_crown_v5 WHERE seg_key=?', (r.seg_key,)).fetchone():
                why.append('seeded_key_collides_with_v5_crown')
            elif t is not None:
                s = crowns.loc[r.seg_key]
                tops[r.tree_id] = math.hypot(x0 - s.x_2193, y0 - s.y_2193)
        else:
            why.append('unknown_crown_source')
        counts['checked'] += 1
        if why:
            conflicts.append({'tree_id': r.tree_id, 'seg_key': r.seg_key, 'link_class': r.link_class, 'reasons': why})
    # The package's top distances are from the same EPSG:2193 points; agreement confirms the join.
    top_error = max(abs(tops[r.tree_id] - r.top_distance_m) for r in links.itertuples() if r.tree_id in tops)
    # Seeded crowns must not overlap any V5 tree or low-canopy crown (the linker drew them on uncovered cells).
    sx, sy = crowns.x_2193.to_numpy(), crowns.y_2193.to_numpy()
    kd = cKDTree(np.column_stack([sx, sy]))
    near = {'tree_crown_v5': [], 'tree_near_canopy_v5': []}
    for table in near:
        cur = c.execute(f'SELECT rowid,x_2193,y_2193 FROM {table}')
        while rows := cur.fetchmany(500000):
            xy = np.array([(r[1], r[2]) for r in rows])
            hit = kd.query_ball_point(xy, 60.0, return_length=True) > 0
            near[table].extend(rows[i][0] for i in np.flatnonzero(hit))
    seeded_geom = shapely.from_wkb(crowns.crown_wkb.to_list())
    overlaps = []
    for table, rowids in near.items():
        for i in range(0, len(rowids), 5000):
            chunk = rowids[i:i + 5000]
            rows = c.execute(f'SELECT seg_key,crown_wkb FROM {table} WHERE rowid IN ({",".join("?" * len(chunk))})', chunk).fetchall()
            g = shapely.make_valid(shapely.from_wkb([r[1] for r in rows]))
            a, b = shapely.STRtree(g).query(seeded_geom, predicate='intersects')
            for si, gi in zip(a, b):
                area = float(shapely.area(shapely.intersection(seeded_geom[si], g[gi])))
                if area > 0.25:
                    overlaps.append({'seeded_seg_key': crowns.seg_key.iloc[si], 'table': table, 'seg_key': rows[gi][0], 'area_m2': round(area, 3)})
    for o in overlaps:
        for tid in seeded_ids[o['seeded_seg_key']]:
            if tid in set(links.tree_id):
                conflicts.append({'tree_id': tid, 'seg_key': o['seeded_seg_key'], 'link_class': 'drawn_from_record', 'reasons': ['seeded_crown_overlaps_' + o['table']]})
    # Records left unlinked outside coverage keep their reason only if V5.1 still leaves them unlinked.
    outside_conflicts = []
    for r in outside.itertuples(index=False):
        d = c.execute('SELECT display_role FROM tree_display_v5 WHERE tree_id=?', (r.tree_id,)).fetchone()
        e = c.execute('SELECT link_role FROM tree_evidence_v5 WHERE tree_id=?', (r.tree_id,)).fetchone()
        if d is None or d[0] != 'source_record' or e is None or e[0] != 'unlinked':
            outside_conflicts.append(r.tree_id)
    return {'checked_utc': now(), 'links_checked': counts['checked'], 'conflicts': conflicts,
            'excluded_links': len({x['tree_id'] for x in conflicts}),
            'top_distance_max_abs_difference_m': round(top_error, 4),
            'seeded_overlap_candidates_within_60m': {k: len(v) for k, v in near.items()}, 'seeded_overlaps_over_0_25_m2': overlaps,
            'outside_coverage_checked': len(outside), 'outside_coverage_conflicts': outside_conflicts,
            'rules': ['record still a V5.1 source_record marker, link_role unlinked, absent from tree_crown_v5_links',
                      'not restored by the V5.1 continuity repair (tree_crown_link_repairs_v5 status restore_association)',
                      'source identity and position unchanged (within 0.01 m)', 'source position not flagged unverified',
                      'V5 crown exists in V5.1 with canopy_class tree', 'seeded crown key unused by V5 and its record listed on it',
                      'seeded crown overlaps no V5 tree or low-canopy crown by more than 0.25 m²']}


def apply(c, links, crowns, outside, stamp):
    """Join every published record to its crown with V5.1's own association conventions.

    One marker per crown, inventory before detection; members stay in the crown's group with
    their own identity, position and history. Services are recomputed once per representative
    with the existing V5 equations, exactly as the V5.1 repair did.
    """
    rp = module('repair_v5_crown_links')
    rp.METHOD = METHOD  # recorded as association_method in each recomputed scenario
    model, ns = rp.model_functions(PIPE / 'v5')
    to4326 = __import__('pyproj').Transformer.from_crs(2193, 4326, always_xy=True).transform
    sources = {}

    def source(tid):
        if tid not in sources:
            sources[tid] = c.execute('SELECT source_primary FROM trees WHERE tree_id=?', (tid,)).fetchone()[0]
        return sources[tid]

    flags = {}

    def protected(tid):
        if tid not in flags:
            flags[tid] = c.execute(PROTECTED_SQL, (tid,)).fetchone() is not None
        return flags[tid]

    def supersede(tid, reason):
        """Archive a representative's service rows before they move to the new representative."""
        n = 0
        for table in ('tree_valuation_v5', 'tree_current_services_v5', 'tree_assets_v5', 'tree_current_assets_v5', 'tree_roots_v5', 'tree_current_roots_v5'):
            row = c.execute(f'SELECT * FROM {table} WHERE tree_id=?', (tid,)).fetchone()
            if row:
                c.execute('INSERT INTO tree_services_superseded_v52 VALUES(?,?,?,?,?)', (tid, table, json.dumps(dict(row)), reason, stamp))
                c.execute(f'DELETE FROM {table} WHERE tree_id=?', (tid,))
                n += 1
        return n

    def regroup(seg, primary, new, tier, height, area, crown_row, pc_row, note, old_overlap, keep, crown_source):
        classes = {r.tree_id: r.link_class for r in new}
        members = [dict(r) for r in c.execute('''SELECT t.tree_id,t.source_primary AS source,t.species_common,t.species_latin,t.source_tree_id
            FROM tree_crown_v5_links l JOIN trees t USING(tree_id) WHERE l.seg_key=? ORDER BY t.tree_id''', (seg,))]
        for m in members:
            if m['tree_id'] in classes:
                m['link_class'] = classes[m['tree_id']]
        member_json = json.dumps(members)
        n, ni = len(members), sum(m['source'] not in DETECTION for m in members)
        rp.insert(c, 'v5_group_summary', dict(seg_key=seg, primary_tree_id=primary, source_records=n, inventory_records=ni, members_json=member_json))
        c.execute('INSERT OR REPLACE INTO v5_primary_selection(seg_key,tree_id) VALUES(?,?)', (seg, primary))
        for m in members:
            tid = m['tree_id']
            fresh = tid in classes
            e = dict(c.execute('SELECT * FROM tree_evidence_v5 WHERE tree_id=?', (tid,)).fetchone())
            e.update(seg_key=seg, current_primary_tree_id=primary, evidence_tier=tier if tid == primary else 'shared_crown_candidate',
                     link_role='primary' if tid == primary else 'same_crown_candidate', current_height_m=height, current_crown_area_m2=area,
                     top_distance_m=c.execute('SELECT top_distance_m FROM tree_crown_v5_links WHERE tree_id=?', (tid,)).fetchone()[0])
            if fresh:
                e['method_id'] = METHOD
            rp.insert(c, 'tree_evidence_v5', e)
            identity = dict(c.execute('SELECT * FROM tree_identity_v5 WHERE tree_id=?', (tid,)).fetchone())
            identity.update(e, source_records=n, inventory_records=ni, members_json=member_json if tid == primary else None)
            if fresh:
                prev = c.execute('SELECT seg_key FROM tree_crown_v4_links WHERE tree_id=?', (tid,)).fetchone()
                identity.update(spatial_evidence_note=note, old_overlapping_crowns=old_overlap,
                                new_overlapping_crowns=c.execute('''SELECT count(*) FROM tree_crown_lineage_v5
                                    WHERE old_seg_key=? AND (old_fraction>=0.1 OR new_fraction>=0.1)''', (prev[0],)).fetchone()[0] if prev and prev[0] else None)
                rp.insert(c, 'tree_current_crown_v5', {**crown_row, 'tree_id': tid, 'current_primary_tree_id': primary})
                rp.insert(c, 'tree_current_pointcloud_v5', {**pc_row, 'tree_id': tid})
            else:
                c.execute('UPDATE tree_current_crown_v5 SET current_primary_tree_id=? WHERE tree_id=?', (primary, tid))
            rp.insert(c, 'tree_identity_v5', identity)
            if tid in keep:
                # A protected tree keeps its own marker where its source recorded it; the crown's
                # estimates stay with the crown's marker, so nothing is counted twice.
                c.execute('UPDATE tree_display_v5 SET display_role=?,crown_source=?,seg_key=? WHERE tree_id=?', ('current_crown', crown_source, seg, tid))
            elif tid != primary:
                c.execute('DELETE FROM tree_display_v5 WHERE tree_id=?', (tid,))
        return members

    c.execute('BEGIN IMMEDIATE')
    try:
        c.execute('CREATE TABLE tree_record_link_v52(tree_id TEXT PRIMARY KEY,' + ','.join(LINK_FIELDS) + ')')
        c.execute('CREATE INDEX idx_record_link_v52_seg ON tree_record_link_v52(seg_key)')
        c.execute('CREATE TABLE tree_record_link_status_v52(tree_id TEXT PRIMARY KEY,status TEXT,reason TEXT,reason_text TEXT,method_id TEXT,crown_set_id TEXT)')
        c.execute('''CREATE TABLE record_link_v52_groups(seg_key TEXT PRIMARY KEY,crown_source TEXT,old_primary_tree_id TEXT,primary_tree_id TEXT,
                     records_joined INTEGER,primary_changed INTEGER,crown_in_service_totals INTEGER,geometry_sha256 TEXT,kept_markers_json TEXT)''')
        c.execute('CREATE TABLE tree_services_superseded_v52(tree_id TEXT,table_name TEXT,row_json TEXT,reason TEXT,superseded_utc TEXT,PRIMARY KEY(tree_id,table_name))')
        types = {'float64': 'REAL', 'int64': 'INTEGER', 'bool': 'INTEGER', 'object': 'BLOB'}
        cols = [k for k in crowns.columns if k != 'seg_key']
        decl = ['seg_key TEXT PRIMARY KEY'] + [f'{k} {types.get(str(crowns[k].dtype), "TEXT")}' for k in cols] + \
               ['lon REAL', 'lat REAL', 'primary_tree_id TEXT', 'evidence_tier TEXT', 'evidence_reasons TEXT', 'in_service_totals INTEGER']
        c.execute('CREATE TABLE tree_crown_seeded_v52(' + ','.join(decl) + ')')
        c.execute('CREATE UNIQUE INDEX idx_crown_seeded_v52_primary ON tree_crown_seeded_v52(primary_tree_id)')
        groups, final, kept = [], {}, set()
        for seg, g in links[links.crown_source == 'v5'].groupby('seg_key', sort=True):
            cr = dict(c.execute('SELECT * FROM tree_crown_v5 WHERE seg_key=?', (seg,)).fetchone())
            old, geom = cr['primary_tree_id'], digest(cr['crown_wkb'])
            # Protected or notable first, then linked before probable, confidence, distance to the crown top.
            new = sorted(g.itertuples(index=False), key=lambda r: (not protected(r.tree_id), CLASS_ORDER[r.link_class], -r.confidence, r.top_distance_m, r.tree_id))
            existing = [r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (seg,))]
            if source(old) in DETECTION:
                # V5 ranks inventory before detection, so a detection marker means no inventory member yet.
                assert not any(source(t) not in DETECTION for t in existing), seg
                primary = new[0].tree_id
            elif protected(new[0].tree_id) and not protected(old):
                # A protected record takes the marker from an ordinary V5.1 record, which stays a member.
                primary = new[0].tree_id
            else:
                primary = old
            keep = {r.tree_id for r in new if r.tree_id != primary and protected(r.tree_id)}
            assert not keep or protected(primary), seg
            if old not in existing:
                # Generated V5 representatives were never in the point-link table; keep them as members.
                assert primary != old, seg
                c.execute('INSERT INTO tree_crown_v5_links VALUES(?,?,?,?,?)', (old, seg, 0.0, 3, 0.0))
            for r in new:
                c.execute('INSERT INTO tree_crown_v5_links VALUES(?,?,?,?,?)', (r.tree_id, seg, float(r.top_distance_m), 1, None))
            template = dict(c.execute('SELECT * FROM tree_current_crown_v5 WHERE tree_id=?', (old,)).fetchone())
            pc = dict(c.execute('SELECT * FROM tree_current_pointcloud_v5 WHERE tree_id=?', (old,)).fetchone())
            marker = c.execute('SELECT lon,lat,display_role FROM tree_display_v5 WHERE tree_id=?', (old,)).fetchone()
            assert marker['display_role'] == 'current_crown', seg
            overlap = c.execute('SELECT count(*) FROM tree_crown_lineage_v5 WHERE new_seg_key=? AND (old_fraction>=0.1 OR new_fraction>=0.1)', (seg,)).fetchone()[0]
            regroup(seg, primary, new, cr['evidence_tier'], cr['height_m'], cr['crown_area_m2'], template, pc, NOTE_V5, overlap, keep, 'v5')
            if primary != old:
                c.execute('UPDATE tree_crown_v5 SET primary_tree_id=? WHERE seg_key=?', (primary, seg))
                # The record's marker is drawn where the crown's marker was; its source point stays in the record.
                rp.insert(c, 'tree_display_v5', dict(tree_id=primary, lon=marker['lon'], lat=marker['lat'], display_role='current_crown', crown_source='v5', seg_key=seg))
                supersede(old, 'representative_changed_v52')
                assert supersede(primary, 'unexpected_prior_rows') == 0, primary
                rp.recalculate_models(c, primary, model, ns, stamp)
            final[seg] = primary
            kept.update(keep)
            groups.append((seg, 'v5', old, primary, len(new), int(primary != old), 1, geom, json.dumps(sorted(keep))))
        for seg, g in links[links.crown_source == SEEDED].groupby('seg_key', sort=True):
            s = crowns.loc[seg]
            counted = s.canopy_class == 'tree'
            recs = sorted(g.itertuples(index=False), key=lambda r: (not protected(r.tree_id), r.top_distance_m, r.tree_id))
            primary = recs[0].tree_id
            keep = {r.tree_id for r in recs if r.tree_id != primary and protected(r.tree_id)}
            lon, lat = to4326(float(s.x_2193), float(s.y_2193))
            reasons = SEEDED_REASON + ('' if counted else '; ' + LOW_REASON)
            row = {k: py(s[k]) for k in cols}
            row.update(seg_key=seg, lon=lon, lat=lat, primary_tree_id=primary, evidence_tier='possible', evidence_reasons=reasons, in_service_totals=int(counted))
            c.execute('INSERT INTO tree_crown_seeded_v52(' + ','.join(row) + ') VALUES(' + ','.join('?' * len(row)) + ')', list(row.values()))
            for r in recs:
                c.execute('INSERT INTO tree_crown_v5_links VALUES(?,?,?,?,?)', (r.tree_id, seg, float(r.top_distance_m), 1, None))
            crown_row = dict(tree_id=None, crown_area_m2=py(s.crown_area_m2), crown_diameter_m=py(s.crown_diameter_m), crown_max_chm_m=py(s.height_m),
                             mean_veg_height_m=py(s.mean_veg_height_m), method_id=s.method_id, crown_source=SEEDED, current_primary_tree_id=primary,
                             gap_filled_fraction=py(s.gap_filled_fraction), ndvi_mean=py(s.ndvi_mean), evidence_tier='possible', evidence_reasons=reasons)
            nveg, nbld = int(s.n_veg_returns), int(s.n_building_returns)
            # V5's own point-cloud class rule (finalize_v5_database.py).
            pclass = 'no_classified_vegetation_returns' if nveg == 0 else 'mixed' if nbld > nveg else 'vegetation'
            pc_row = dict(tree_id=None, canopy_top_m=py(s.height_m), n_veg_returns=nveg, n_building_returns=nbld, n_ground_returns=int(s.n_ground_returns),
                          n_unclassified_returns=int(s.n_unclassified_returns), n_water_returns=int(s.n_water_returns), n_bridge_returns=int(s.n_bridge_returns),
                          multi_return_fraction=py(s.multi_return_fraction), intensity_mean=py(s.intensity_mean), aerial_greenness=py(s.aerial_greenness),
                          ndvi_mean=py(s.ndvi_mean), elongation=py(s.elongation), bbox_fill=py(s.bbox_fill), gap_filled_fraction=py(s.gap_filled_fraction),
                          pointcloud_class=pclass, method_id=s.method_id)
            regroup(seg, primary, recs, 'possible', py(s.height_m), py(s.crown_area_m2), crown_row, pc_row, NOTE_SEEDED, None, keep, SEEDED)
            rp.insert(c, 'tree_display_v5', dict(tree_id=primary, lon=lon, lat=lat, display_role='current_crown', crown_source=SEEDED, seg_key=seg))
            if counted:
                assert supersede(primary, 'unexpected_prior_rows') == 0, primary
                rp.recalculate_models(c, primary, model, ns, stamp)
                # Flag the estimate itself, so totals can be stated with and without record-seeded crowns.
                for table in ('tree_valuation_v5', 'tree_current_services_v5'):
                    v = c.execute(f'SELECT method_id,assumptions_json FROM {table} WHERE tree_id=?', (primary,)).fetchone()
                    a = json.loads(v[1])
                    a['geometry_basis'] = 'record-seeded crown (v5.2) drawn from the 2024 returns at the source record position; awaiting confirmation'
                    c.execute(f'UPDATE {table} SET method_id=?,assumptions_json=? WHERE tree_id=?', (v[0] + '__v52_record_seeded_crown', json.dumps(a), primary))
            final[seg] = primary
            kept.update(keep)
            groups.append((seg, SEEDED, None, primary, len(recs), 1, int(counted), digest(s.crown_wkb), json.dumps(sorted(keep))))
        c.executemany('INSERT INTO record_link_v52_groups VALUES(?,?,?,?,?,?,?,?,?)', groups)
        for r in links.itertuples(index=False):
            seeded = r.crown_source == SEEDED
            low = seeded and crowns.loc[r.seg_key].canopy_class != 'tree'
            c.execute('INSERT INTO tree_record_link_v52 VALUES(' + ','.join('?' * (len(LINK_FIELDS) + 1)) + ')', (
                r.tree_id, r.seg_key, r.link_class, LOW_TEXT if low else r.evidence_text, py(r.confidence), py(r.edge_distance_m), py(r.top_distance_m),
                int(r.shared_crown_n), r.crown_source, 'faint' if seeded else None, 'awaiting_confirmation' if seeded else None, py(r.lon), py(r.lat),
                r.method_id, r.crown_set_id, r.status, 'marker' if final[r.seg_key] == r.tree_id else 'member_keeps_marker' if r.tree_id in kept else 'member',
                crowns.loc[r.seg_key].canopy_class if seeded else 'tree', 0 if low else 1))
        c.executemany('INSERT INTO tree_record_link_status_v52 VALUES(?,?,?,?,?,?)',
                      [(r.tree_id, r.status, r.reason, OUTSIDE_TEXT, r.method_id, r.crown_set_id) for r in outside.itertuples(index=False)])
        # Verify every repaired relationship and the one-estimate-per-crown accounting before commit.
        for seg, kind, old, primary, n, changed, counted, geom, keep_json in groups:
            ids = [r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (seg,))]
            q = ','.join('?' * len(ids))
            assert sorted(r[0] for r in c.execute(f'SELECT tree_id FROM tree_display_v5 WHERE tree_id IN ({q})', ids)) == sorted([primary] + json.loads(keep_json)), seg
            assert [r[0] for r in c.execute(f'SELECT tree_id FROM tree_current_services_v5 WHERE tree_id IN ({q})', ids)] == ([primary] if counted else []), seg
            assert {tuple(r) for r in c.execute(f'SELECT seg_key,current_primary_tree_id FROM tree_evidence_v5 WHERE tree_id IN ({q})', ids)} == {(seg, primary)}, seg
            assert {r[0] for r in c.execute(f'SELECT current_primary_tree_id FROM tree_current_crown_v5 WHERE tree_id IN ({q})', ids)} == {primary}, seg
            if kind == 'v5':
                row = c.execute('SELECT crown_wkb,primary_tree_id FROM tree_crown_v5 WHERE seg_key=?', (seg,)).fetchone()
                assert digest(row[0]) == geom and row[1] == primary, seg
        assert c.execute('SELECT count(*) FROM tree_record_link_v52').fetchone()[0] == len(links)
        assert c.execute('SELECT count(*) FROM tree_crown_v5_links l JOIN tree_record_link_v52 r ON r.tree_id=l.tree_id AND r.seg_key=l.seg_key').fetchone()[0] == len(links)
        c.commit()
    except BaseException:
        c.rollback()
        raise
    return groups


def old_primary_source(db, tid):
    return db.execute('SELECT source_primary FROM trees WHERE tree_id=?', (tid,)).fetchone()[0]


def explain(groups):
    """Release-total deltas, by cause, from the V5.1 and V5.2 databases (unrounded)."""
    old, new = ro(DB51), ro(DB)
    expr = '''SELECT d.display_role,t.source_primary,
        case when t.source_primary='notable_trees_overlay' or t.notable_group_match=1 or (t.notable_point_match=1 and t.notable_point_type='1') then 1 else 0 end,
        v.total_value_nzd_y,v.avoided_runoff_m3_y,v.stored_co2e_tonnes_est
        FROM tree_display_v5 d JOIN trees t USING(tree_id) LEFT JOIN tree_current_services_v5 v USING(tree_id) WHERE d.tree_id=?'''
    causes = collections.defaultdict(collections.Counter)
    for seg, kind, old_primary, primary, n, changed, counted, geom, keep_json in groups:
        ids = [r[0] for r in new.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (seg,))]
        cause = 'record_seeded_crown' if kind == SEEDED and counted else 'record_seeded_low_canopy' if kind == SEEDED else \
            'protected_record_replaces_record_marker' if changed and old_primary_source(old, old_primary) not in DETECTION else \
            'record_replaces_detection_marker' if changed else 'record_joins_existing_inventory_marker'
        causes[cause]['crowns'] += 1
        causes[cause]['records_joined'] += n
        causes[cause]['protected_members_keeping_marker'] += len(json.loads(keep_json))
        for db, sign in ((old, -1), (new, 1)):
            for tid in ids:
                r = db.execute(expr, (tid,)).fetchone()
                if r is None or r[0] == 'earlier_detection':
                    continue
                causes[cause]['trees'] += sign
                causes[cause]['protected'] += sign * r[2]
                causes[cause]['lidarInferred'] += sign * (r[1] in DETECTION)
                for key, i in (('totalValueNzdY', 3), ('runoffM3Y', 4), ('carbonTco2e', 5)):
                    causes[cause][key] += sign * (r[i] or 0)
        if kind == SEEDED and counted:
            causes[cause]['crowns_counted'] += 1
    total = collections.Counter()
    for v in causes.values():
        total.update({k: v[k] for k in v if k not in ('crowns', 'records_joined', 'crowns_counted', 'protected_members_keeping_marker')})
    total['crowns'] = causes['record_seeded_crown']['crowns_counted']
    old.close()
    new.close()
    return {'by_cause': {k: dict(v) for k, v in causes.items()}, 'total_delta': dict(total)}


def prepare():
    if DB.exists():
        raise RuntimeError('Release database already exists; preparation is not destructive.')
    for p in ('code', 'logs', 'tmp', 'verification', 'web_build', 'inputs', 'properties/tmp', 'properties/data', 'properties/tiles', 'properties/logs'):
        (W / p).mkdir(parents=True, exist_ok=True)
    # Freeze the package inputs beside the release, checked against the package's own seal.
    meta = json.loads((LINK / 'out/v52_package/PACKAGE.json').read_text())
    PKG.mkdir(parents=True, exist_ok=True)
    for name, h in meta['sha256'].items():
        shutil.copy2(LINK / 'out/v52_package' / name, PKG / name)
        assert sha(PKG / name) == h, name
    for p in (LINK / 'out/v52_package/PACKAGE.json', LINK / 'out/REPORT.md',
              PIPE / 'v52/linker/package_v52.py', PIPE / 'v52/ui_v52.patch', LINK / 'web/data/council_positions.pmtiles',
              PIPE / 'v52/build_council_positions_tiles.sh'):
        shutil.copy2(p, PKG / p.name)
    note = LINK / 'out/v52_package/MERGE_V52.md'  # optional hand-written merge note for the map build
    if note.exists():
        shutil.copy2(note, PKG / note.name)
    assert sha(PKG / 'ui_v52.patch') == UI_PATCH_SHA256 and sha(PKG / 'council_positions.pmtiles') == POSITIONS_SHA256
    for name in ('export_web_v5', 'build_tree_details_v5', 'build_nearby_v5', 'build_property_tenure_v5', 'build_tenure_tiles_v5'):
        shutil.copy2(W51 / 'code' / (name + '.py'), W / 'code')
    for name in ('repair_v5_crown_links', 'audit_inventory_crown_links'):
        shutil.copy2(PIPE / 'v51' / (name + '.py'), W / 'code')
    snap51 = json.loads((W51 / 'verification/database_snapshot.json').read_text())
    wal = Path(str(DB51) + '-wal')
    assert DB51.stat().st_size == snap51['bytes'] and str(DB51.stat().st_mtime_ns) == snap51['mtime_ns'], 'V5.1 database changed'
    assert not wal.exists() or wal.stat().st_size == 0
    links, crowns, outside = package()
    assert len(links) == sum(meta['published_links'].values()) and len(crowns) == meta['new_crowns_published']
    assert len(outside) == meta['left_unlinked_outside_coverage']
    c51 = ro(DB51)
    report = audit(c51, links, crowns, outside)
    c51.close()
    report['package'] = {k: meta[k] for k in meta if k != 'sha256'}
    report['package_sha256'] = meta['sha256']
    write(W / 'verification/package_audit.json', report)
    print(json.dumps({k: report[k] for k in ('links_checked', 'excluded_links', 'top_distance_max_abs_difference_m', 'seeded_overlaps_over_0_25_m2')}, indent=1), flush=True)
    excluded = {x['tree_id'] for x in report['conflicts']}
    links = links[~links.tree_id.isin(excluded)]
    crowns = crowns[crowns.seg_key.isin(set(links.seg_key))]
    outside = outside[~outside.tree_id.isin(set(report['outside_coverage_conflicts']))]
    # APFS clone: an independent copy of the frozen V5.1 database, written copy-on-write.
    subprocess.run(['cp', '-cp', str(DB51), str(DB)], check=True)
    c = sqlite3.connect(DB, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA journal_mode=DELETE')
    c.execute('PRAGMA synchronous=NORMAL')
    c.execute('PRAGMA cache_size=-200000')
    stamp = now()
    groups = apply(c, links, crowns, outside, stamp)
    c.close()
    deltas = explain(groups)
    summary = {'version': VERSION, 'method_id': METHOD, 'stamp': stamp,
               'published_links': links.link_class.value_counts().to_dict(), 'links_by_source': links.source.value_counts().to_dict(),
               'crowns_with_new_links': {'v5': sum(g[1] == 'v5' for g in groups), SEEDED: sum(g[1] == SEEDED for g in groups)},
               'seeded_crowns_counted': sum(g[1] == SEEDED and g[6] for g in groups),
               'seeded_low_canopy_not_counted': sum(g[1] == SEEDED and not g[6] for g in groups),
               'seeded_counted_crown_area_m2': float(crowns[crowns.canopy_class == 'tree'].crown_area_m2.sum()),
               'seeded_low_canopy_crown_area_m2': float(crowns[crowns.canopy_class != 'tree'].crown_area_m2.sum()),
               'v5_representatives_changed': sum(g[1] == 'v5' and g[5] for g in groups),
               'protected_members_keeping_marker': sum(len(json.loads(g[8])) for g in groups),
               'crowns_touched': len(groups), 'excluded_links': sorted(excluded),
               'outside_coverage_reasons_published': len(outside), 'deltas': deltas}
    c = sqlite3.connect(DB, isolation_level=None)
    c.execute('PRAGMA journal_mode=DELETE')
    c.execute('BEGIN IMMEDIATE')
    c.execute('CREATE TABLE release_snapshot_v52(version TEXT PRIMARY KEY,created_utc TEXT,package_sha256_json TEXT,audit_sha256 TEXT,summary_json TEXT)')
    c.execute('INSERT INTO release_snapshot_v52 VALUES(?,?,?,?,?)', (VERSION, now(), json.dumps(report['package_sha256']), sha(W / 'verification/package_audit.json'), json.dumps(summary)))
    c.execute('COMMIT')
    c.close()
    write(W / 'verification/database_snapshot.json', {'version': VERSION, 'database': str(DB), 'bytes': DB.stat().st_size,
          'mtime_ns': str(DB.stat().st_mtime_ns), 'baseline_database': str(DB51), 'baseline_bytes': snap51['bytes'], 'baseline_mtime_ns': snap51['mtime_ns'],
          'package_audit_sha256': sha(W / 'verification/package_audit.json'), 'summary': summary,
          'geometry_method': 'pointcloud_v5_ndvi_watershed plus record_seeded_crown_v52', 'association_method': METHOD})
    STAGE.mkdir(parents=True, exist_ok=True)
    for p in STAGE51.iterdir():
        if p.is_file():
            shutil.copy2(p, STAGE / p.name)
    print('Frozen V5.2 database prepared:', json.dumps({k: summary[k] for k in ('published_links', 'crowns_with_new_links', 'v5_representatives_changed')}), flush=True)


def link_props(c):
    """Tile fields a V5.2 marker carries; absent everywhere else, so earlier features render as before."""
    extra = {}
    for r in c.execute('SELECT tree_id,link_class,link_evidence,edge_distance_m,crown_source,joined_as,crown_canopy_class FROM tree_record_link_v52'):
        if r['joined_as'] not in ('marker', 'member_keeps_marker'):
            continue
        p = {'link_class': r['link_class'], 'link_evidence': r['link_evidence'], 'link_edge_m': round(r['edge_distance_m'], 2)}
        if r['crown_source'] == SEEDED:
            p['display_style'] = 'faint'
            if r['crown_canopy_class'] != 'tree':
                p['canopy_class'] = r['crown_canopy_class']
        extra[r['tree_id']] = p
    return extra


def maps():
    """Rewrite complete feature streams from V5.1 using SQL for every identity a link touches.

    V5.1's verified features are retained byte for byte everywhere else, and V5 polygon geometry is
    never re-serialised. A marker whose record now represents its crown is emitted at the old
    representative's place in the stream; record-seeded crowns are appended.
    """
    import numpy as np
    import shapely
    m = module('export_web_v5')
    m.W, m.DB, m.OUT = W, DB, W / 'web_build'
    c = ro()
    groups = [dict(r) for r in c.execute('SELECT * FROM record_link_v52_groups ORDER BY seg_key')]
    extra = link_props(c)
    ids, anchor = set(), {}
    for g in groups:
        ids.update(r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (g['seg_key'],)))
        anchor[g['old_primary_tree_id'] if g['crown_source'] == 'v5' else g['primary_tree_id']] = g['primary_tree_id']
        for kid in json.loads(g['kept_markers_json']):
            anchor[kid] = kid  # a protected member keeps its own marker, in its own place
    fresh = {}
    for tid in sorted(set(anchor.values())):
        row = c.execute(m.SQL + ' WHERE d.tree_id=?', (tid,)).fetchone()
        props = m.properties(row)
        props.update(extra.get(tid, {}))
        fresh[tid] = (props, [round(row['lon'], 7), round(row['lat'], 7)])
    shown = set()
    for i in range(0, len(ids), 900):
        chunk = sorted(ids)[i:i + 900]
        shown.update(r[0] for r in c.execute(f'SELECT tree_id FROM tree_display_v5 WHERE tree_id IN ({",".join("?" * len(chunk))})', chunk))
    assert shown == set(fresh), 'every displayed member of a changed crown must be its representative or a protected tree'
    crown_anchor = {g['old_primary_tree_id']: g['primary_tree_id'] for g in groups if g['crown_source'] == 'v5'}
    seeded_counted = {g['primary_tree_id']: g['crown_in_service_totals'] for g in groups if g['crown_source'] == SEEDED}
    totals, roles, species = collections.Counter(), collections.Counter(), collections.Counter()
    before, after = collections.Counter(), collections.Counter()
    receipts, emitted, crowns_found = {}, set(), set()

    def tally(p, counter):
        if p['display_role'] == 'earlier_detection':
            return
        counter['trees'] += 1
        counter['protected'] += p.get('is_protected_notable', 0)
        counter['lidarInferred'] += p['source_primary'] in m.DETECTION
        for a, b in [('totalValueNzdY', 'total_value_nzd_y'), ('runoffM3Y', 'avoided_runoff_m3_y'), ('carbonTco2e', 'stored_co2e_tonnes_est')]:
            counter[a] += p.get(b, 0)

    for kind in ('points', 'crowns'):
        count = changed = dropped = 0
        oldpath, outpath = W51 / 'web_build' / (kind + '.geojsonl'), m.OUT / (kind + '.geojsonl')
        h = hashlib.sha256()
        with oldpath.open('rb') as f, outpath.open('wb') as out:
            for line in f:
                h.update(line)
                if kind == 'crowns':
                    i = line.index(b'"tree_id":"') + 11
                    tid = line[i:line.index(b'"', i)].decode()
                    obj = json.loads(line) if tid in crown_anchor else None
                else:
                    obj = json.loads(line)
                    tid = obj['properties']['tree_id']
                if kind == 'points' and (tid in ids or tid in anchor):
                    tally(obj['properties'], before)
                    if tid not in anchor:
                        dropped += 1  # a member's own marker; the record stays in its crown's group
                        continue
                    props, xy = fresh[anchor[tid]]
                    line = m.feature(props, {'type': 'Point', 'coordinates': xy}).encode()
                    obj = json.loads(line)
                    emitted.add(anchor[tid])
                    tally(props, after)
                    changed += 1
                elif kind == 'crowns' and tid in crown_anchor:
                    assert tid not in crowns_found, tid
                    crowns_found.add(tid)
                    obj['properties'] = fresh[crown_anchor[tid]][0]
                    # Preserve the original geometry JSON byte for byte.
                    geometry = line[line.rindex(b',"geometry":'):]
                    line = b'{"type":"Feature","properties":' + json.dumps(obj['properties'], separators=(',', ':'), ensure_ascii=False).encode() + geometry
                    changed += 1
                out.write(line)
                count += 1
                if kind == 'points':
                    p = obj['properties']
                    roles[p['display_role']] += 1
                    tally(p, totals)
                    if p['display_role'] != 'earlier_detection' and p.get('species_common') and p['species_common'] != 'Species not recorded':
                        species[p['species_common']] += 1
                if count % 500000 == 0:
                    print(kind, count, flush=True)
            if kind == 'crowns':
                rows = c.execute('SELECT seg_key,primary_tree_id,crown_wkb FROM tree_crown_seeded_v52 ORDER BY seg_key').fetchall()
                gs = shapely.from_wkb([r['crown_wkb'] for r in rows])
                valid = shapely.is_valid(gs)
                if (~valid).any():
                    gs[~valid] = shapely.make_valid(gs[~valid])
                for r, geo in zip(rows, shapely.to_geojson(m.lonlat(gs))):
                    out.write(('{"type":"Feature","properties":' + json.dumps(fresh[r['primary_tree_id']][0], separators=(',', ':'), ensure_ascii=False) + ',"geometry":' + geo + '}\n').encode())
                    count += 1
                    changed += 1
        receipts[kind] = {'sha256': h.hexdigest(), 'source': str(oldpath), 'output_count': count, 'changed_features': changed, 'dropped_member_markers': dropped}
    assert emitted == set(fresh) and crowns_found == set(crown_anchor)
    old = json.loads((W51 / 'web_build/totals.json').read_text())
    n_seeded = len(seeded_counted)
    totals['crowns'] = old['totals']['crowns'] + sum(seeded_counted.values())
    assert receipts['crowns']['output_count'] == old['totals']['crowns'] + n_seeded
    assert receipts['points']['output_count'] == sum(old['display_roles'].values()) - receipts['points']['dropped_member_markers']
    delta = {k: after[k] - before[k] for k in set(after) | set(before)}
    for k, v in old['totals'].items():
        if k != 'crowns':
            assert abs(totals[k] - (v + delta.get(k, 0))) <= 1e-6 * max(1, abs(v)), (k, totals[k], v, delta.get(k))
    write(m.OUT / 'totals.json', {'totals': dict(totals), 'display_roles': dict(roles), 'near_canopy': old['near_canopy'],
                                  'species_options': species.most_common(150), 'crown_features': receipts['crowns']['output_count'],
                                  'record_seeded_crowns': {'features': n_seeded, 'counted': sum(seeded_counted.values()),
                                                           'low_canopy_not_counted': n_seeded - sum(seeded_counted.values())}})
    write(STAGE / 'data/species_options.json', {'release': VERSION, 'options': species.most_common()})
    write(W / 'verification/map_feature_rebuild.json', {'strategy': 'Complete V5.1 stream rebuild with SQL-regenerated linked features, unchanged V5 geometry and appended record-seeded crowns',
          'inputs': receipts, 'rounded_feature_delta': delta, 'database_mtime_ns': str(DB.stat().st_mtime_ns)})
    c.close()
    print('Map features rebuilt:', json.dumps(totals), flush=True)


def trim(row):
    row = [None if isinstance(v, float) and not math.isfinite(v) else v for v in row]
    while row and row[-1] is None:
        row.pop()
    return row


def details():
    """SQL rebuild of every record a link touches; hash-verified reuse of every other V5.1 profile."""
    base = STAGE51 / 'data/tree_details'
    out = STAGE / 'data/tree_details'
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        subprocess.run(['cp', '-cRp', str(base), str(out)], check=True)
    before = json.loads((base / 'schema.json').read_text())
    schema = json.loads(json.dumps(before))
    defs = schema['datasets']
    assert not any(d['key'] in ('record_link', 'record_link_status') for d in defs)
    defs.extend([LINK_DATASET, STATUS_DATASET])
    next(d for d in defs if d['key'] == 'identity')['note'] = 'Polygon containment, audited crown continuity (v5.1) and record-to-crown links (v5.2) associate source records with current crowns. A shared crown can contain several trees; original positions, identities and histories remain separate.'
    next(d for d in defs if d['key'] == 'crown')['note'] = 'V5 crown boundaries and maximum height from the 2024 survey; crown_source record_seeded_v52 marks a crown drawn in v5.2 from the returns at a source record\'s position, awaiting confirmation. Earlier v4 crowns remain in areas outside the v5 survey footprint.'
    c = ro()
    c.execute('PRAGMA mmap_size=1073741824')
    group_ids = set()
    for g in c.execute('SELECT seg_key FROM record_link_v52_groups').fetchall():
        group_ids.update(r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (g[0],)))
    outside = [r[0] for r in c.execute('SELECT tree_id FROM tree_record_link_status_v52')]
    updates = collections.defaultdict(dict)
    changed_keys = {'identity', 'crown', 'pointcloud', 'assets', 'roots', 'services', 'record_link'}
    for d in defs:
        if d['key'] not in changed_keys:
            continue
        sql = 'SELECT ' + ','.join(d['fields']) + ' FROM ' + d['table'] + ' WHERE tree_id=?'
        for tid in sorted(group_ids):
            rows = c.execute(sql, (tid,)).fetchall()
            assert len(rows) <= 1, (d['key'], tid)
            updates[bucket(tid)].setdefault(tid, {})[d['key']] = trim(list(rows[0])) if rows else None
        print('Regenerated profile dataset', d['key'], len(group_ids), flush=True)
    sql = 'SELECT ' + ','.join(STATUS_FIELDS) + ' FROM tree_record_link_status_v52 WHERE tree_id=?'
    for tid in outside:
        updates[bucket(tid)].setdefault(tid, {})['record_link_status'] = trim(list(c.execute(sql, (tid,)).fetchone()))
    affected = group_ids | set(outside)
    assert sum(map(len, updates.values())) == len(affected)
    baseline = json.loads((W51 / 'verification/details_manifest.json').read_text())
    indexed = {f['path']: f for f in baseline['files']}
    cov = collections.Counter(schema['coverage'])
    for ix, (name, rows) in enumerate(sorted(updates.items())):
        path = out / name
        assert sha(path) == indexed[name]['sha256'], 'Baseline profile digest mismatch: ' + name
        records = json.loads(gzip.decompress(path.read_bytes()))
        for tid, delta in rows.items():
            previous = records[tid]
            rec = dict(previous)
            for key, value in delta.items():
                if value is None:
                    rec.pop(key, None)
                else:
                    rec[key] = value
            cov.subtract(previous.keys())
            cov.update(rec.keys())
            records[tid] = rec
        path.unlink()  # break the clone before writing, never editing V5.1's file in place
        path.write_bytes(gzip.compress((json.dumps(records, ensure_ascii=False, separators=(',', ':')) + '\n').encode(), compresslevel=7, mtime=0))
        if ix % 2000 == 0:
            print('Rebuilt profile buckets', ix, '/', len(updates), flush=True)
    schema.update(database_mtime_ns=str(DB.stat().st_mtime_ns), generated_utc=now(), coverage={k: v for k, v in cov.items() if v}, release=VERSION,
                  rebuild={'strategy': 'Regenerate every record a v5.2 link touches from SQL; verified reuse of unchanged V5.1 records.',
                           'affected_records': len(affected), 'changed_buckets': len(updates),
                           'baseline_manifest_sha256': sha(W51 / 'verification/details_manifest.json'),
                           'package_audit_sha256': sha(W / 'verification/package_audit.json')})
    write(out / 'schema.json', schema)
    files = []
    for path in sorted(out.rglob('*.json.gz')):
        rel = path.relative_to(out).as_posix()
        h = sha(path)
        if rel not in updates:
            assert h == indexed[rel]['sha256'], 'Unchanged bucket changed: ' + rel
        files.append({'path': rel, 'bytes': path.stat().st_size, 'sha256': h, 'records': indexed[rel]['records']})
    assert len(files) == 65536 and sum(f['records'] for f in files) == schema['records'] == 6238420
    write(W / 'verification/details_manifest.json', {'records': schema['records'], 'files': files, 'changed_buckets': sorted(updates),
          'changed_records': len(affected), 'database_mtime_ns': str(DB.stat().st_mtime_ns)})
    c.close()
    print('All 6,238,420 profiles verified; linked profiles rebuilt.', flush=True)


def properties():
    import pandas as pd
    m = module('build_property_tenure_v5')
    m.W, m.V5, m.WEB, m.DB = W / 'properties', W, W / 'web_build', DB
    m.RAW = PAR / 'data/raw'
    m.TMP, m.DATA = m.W / 'tmp', m.W / 'data'
    m.STATS = m.DATA / 'build_stats.json'
    for p in (m.TMP, m.DATA, m.W / 'tiles', m.W / 'logs'):
        p.mkdir(parents=True, exist_ok=True)
    # Parcel geometry and tenure, and V5 crown intersections, do not change with a link. Crown
    # intersections carry representative IDs, so rekey them; only the counted record-seeded crowns
    # are intersected afresh, with the release's own canopy stage.
    c = ro()
    groups = [dict(r) for r in c.execute('SELECT * FROM record_link_v52_groups')]
    c.close()
    mapping = {g['old_primary_tree_id']: g['primary_tree_id'] for g in groups if g['crown_source'] == 'v5' and g['primary_changed']}
    counted = {g['primary_tree_id'] for g in groups if g['crown_source'] == SEEDED and g['crown_in_service_totals']}
    seeded_dir = m.TMP / 'seeded_canopy'
    seeded_dir.mkdir(exist_ok=True)
    n = 0
    with (W / 'web_build/crowns.geojsonl').open('rb') as f, (seeded_dir / 'crowns.geojsonl').open('wb') as out:
        for line in f:
            if b'"crown_source":"record_seeded_v52"' in line:
                i = line.index(b'"tree_id":"') + 11
                if line[i:line.index(b'"', i)].decode() in counted:
                    out.write(line)
                    n += 1
    assert n == len(counted)
    old_stats = json.loads((W51 / 'properties/data/build_stats.json').read_text())
    saved = m.WEB, m.TMP
    m.WEB = m.TMP = seeded_dir
    m.stage_canopy()
    m.WEB, m.TMP = saved
    seeded_stats = json.loads(m.STATS.read_text())['canopy']
    shutil.copy2(W51 / 'properties/tmp/parcels.parquet', m.TMP / 'parcels.parquet')
    cp = pd.read_parquet(W51 / 'properties/tmp/canopy_pairs.parquet')
    cp['tree_id'] = cp.tree_id.map(lambda t: mapping.get(t, t))
    new = pd.read_parquet(seeded_dir / 'canopy_pairs.parquet')
    assert set(new.tree_id) == counted and not set(new.tree_id) & set(cp.tree_id)
    pd.concat([cp, new.astype(cp.dtypes.to_dict())], ignore_index=True).to_parquet(m.TMP / 'canopy_pairs.parquet', index=False)
    del cp, new
    canopy = dict(old_stats['canopy'])
    canopy['crowns'] += seeded_stats['crowns']
    canopy['crowns_by_display_role'] = dict(collections.Counter(canopy['crowns_by_display_role']) + collections.Counter(seeded_stats['crowns_by_display_role']))
    canopy['v52_record_seeded'] = seeded_stats
    write(m.STATS, {'parcel_tenure': old_stats['parcel_tenure'], 'canopy': canopy})
    m.stage_points()
    m.point_tenure(pd.read_parquet(m.TMP / 'parcels.parquet'))
    m.stage_summaries()
    m.stage_tiles()
    tm = module('build_tenure_tiles_v5')
    tm.W, tm.WEB = m.W, m.WEB
    tm.TMP, tm.TILES, tm.LOGS = m.TMP, m.W / 'tiles', m.W / 'logs'
    tm.SIDECAR, tm.STATS = m.DATA / 'tenure.parquet', m.DATA / 'tenure_tiles_stats.json'
    tm.features()
    tm.tiles()
    for name in ('trees_map_points', 'tree_crowns_pilot', 'properties'):
        target = STAGE / 'data' / (name + '.pmtiles')
        target.unlink(missing_ok=True)
        subprocess.run(['cp', '-cp', str(m.W / 'tiles' / (name + '.pmtiles')), str(target)], check=True)
    if (STAGE / 'data/property_details').exists():
        shutil.rmtree(STAGE / 'data/property_details')
    subprocess.run(['cp', '-cRp', str(m.DATA / 'property_details'), str(STAGE / 'data/property_details')], check=True)
    print('Map and property rebuild complete.', flush=True)


def nearby():
    """KYTE nearby choices: V5.1's cells with every touched identity replaced from SQL."""
    m = module('build_nearby_v5')
    m.W, m.DB = W, DB
    m.OUT, m.SRC = STAGE / 'kyte/data/nearby', STAGE / 'data/tree_details'
    base = STAGE51 / 'kyte/data/nearby'
    baseline = json.loads((base / 'manifest.json').read_text())
    base_records = baseline['records']
    schema = json.loads((m.SRC / 'schema.json').read_text())
    c = ro()
    ids, by_cell = set(), collections.defaultdict(list)
    query = m.SQL[:m.SQL.index('ORDER BY')] + ' AND d.tree_id=?'
    for g in c.execute('SELECT seg_key FROM record_link_v52_groups').fetchall():
        ids.update(r[0] for r in c.execute('SELECT tree_id FROM tree_crown_v5_links WHERE seg_key=?', (g[0],)))
    added = 0
    for tid in sorted(ids):
        r = c.execute(query, (tid,)).fetchone()
        if r is None:
            continue
        cx, cy, tid, lon, lat, common, latin, source, owner, height, diameter = r
        by_cell[f'{cx}_{cy}.json.gz'].append([tid, round(lon, 7), round(lat, 7), m.clean(common), m.clean(latin), m.clean(source), m.clean(owner), m.clean(height), m.clean(diameter)])
        added += 1
    m.OUT.mkdir(parents=True, exist_ok=True)
    files, total, replaced = [], 0, 0
    baseline_files = {f['path']: f for f in baseline['files']}
    for name in sorted((set(baseline_files) | set(by_cell)) - {'groups.json.gz'}):
        path = base / name
        rows = []
        if path.exists():
            assert sha(path) == baseline_files[name]['sha256']
            old = json.loads(gzip.decompress(path.read_bytes()))
            rows = [r for r in old if r[0] not in ids]
            replaced += len(old) - len(rows)
        rows.extend(by_cell.get(name, []))
        rows.sort(key=lambda r: r[0])
        assert len({r[0] for r in rows}) == len(rows)
        if not rows:
            (m.OUT / name).unlink(missing_ok=True)
            continue
        payload = gzip.compress(json.dumps(rows, separators=(',', ':'), ensure_ascii=False).encode(), mtime=0)
        (m.OUT / name).write_bytes(payload)
        files.append({'path': name, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'records': len(rows)})
        total += len(rows)
    assert total == base_records - replaced + added
    population = c.execute('SELECT count(*) FROM (' + m.SQL[:m.SQL.index('ORDER BY')] + ')').fetchone()[0]
    assert total == population, (total, population)
    group_payload = gzip.compress(json.dumps({'groups': [], 'method_id': 'v52_current_crown_representatives', 'database_mtime_ns': schema['database_mtime_ns']}).encode(), mtime=0)
    (m.OUT / 'groups.json.gz').write_bytes(group_payload)
    files.append({'path': 'groups.json.gz', 'bytes': len(group_payload), 'sha256': hashlib.sha256(group_payload).hexdigest()})
    baseline.update(release=VERSION, detail_snapshot=schema['generated_utc'], database_mtime_ns=schema['database_mtime_ns'], records=total, files=files)
    write(m.OUT / 'manifest.json', baseline)
    for p in base.glob('.*'):
        if p.is_file():
            shutil.copy2(p, m.OUT / p.name)
    write(W / 'verification/nearby_rebuild.json', {'records': total, 'population_by_sql': population, 'replaced_rows': replaced, 'added_rows': added,
          'baseline_records': base_records, 'baseline_manifest_sha256': sha(base / 'manifest.json')})
    c.close()
    print('KYTE nearby rebuilt:', total, 'records.', flush=True)


def positions():
    """Council recorded positions: the package's prebuilt layer, after checking each feature against the release.

    Every published link must have exactly one recorded position (its unchanged source point) and one
    line ending at the top of the crown it joined. Rebuilt with the package's recipe only if that fails.
    """
    c = ro()
    link = {r['tree_id']: dict(r) for r in c.execute('SELECT tree_id,seg_key,crown_source,source_lon,source_lat FROM tree_record_link_v52')}
    tops = {r[0]: (r[1], r[2]) for r in c.execute('SELECT seg_key,lon,lat FROM tree_crown_seeded_v52')}
    excluded = set(json.loads((W / 'verification/database_snapshot.json').read_text())['summary']['excluded_links'])
    seen = collections.Counter()
    bad, lines, left_out = [], [], 0
    with (PKG / 'council_positions_publish.geojsonl').open() as f:
        for text in f:
            feat = json.loads(text)
            p, g = feat['properties'], feat['geometry']
            tid = p['tree_id']
            if tid not in link:
                if tid in excluded:
                    left_out += 1  # a link excluded by the V5.1 check; its layer features go with it
                else:
                    bad.append((tid, 'not_published'))
                continue
            lines.append(text)
            seen[(tid, g['type'])] += 1
            t = c.execute('SELECT lon,lat FROM trees WHERE tree_id=?', (tid,)).fetchone()
            start = g['coordinates'] if g['type'] == 'Point' else g['coordinates'][0]
            if abs(start[0] - t[0]) > 2e-7 or abs(start[1] - t[1]) > 2e-7:
                bad.append((tid, 'source_point_moved'))
            if p['seg_key'] != link[tid]['seg_key']:
                bad.append((tid, 'seg_key_differs'))
            if g['type'] == 'LineString':
                seg = link[tid]['seg_key']
                top = tops[seg] if link[tid]['crown_source'] == SEEDED else tuple(c.execute('SELECT lon,lat FROM tree_crown_v5 WHERE seg_key=?', (seg,)).fetchone())
                end = g['coordinates'][-1]
                if abs(end[0] - top[0]) > 2e-6 or abs(end[1] - top[1]) > 2e-6:
                    bad.append((tid, 'line_does_not_end_at_crown_top'))
    complete = all(seen[(t, 'Point')] == 1 and seen[(t, 'LineString')] == 1 for t in link)
    target = STAGE / 'data/council_positions.pmtiles'
    target.parent.mkdir(parents=True, exist_ok=True)
    rebuilt = bool(bad) or not complete or left_out > 0
    if not rebuilt:
        shutil.copy2(PKG / 'council_positions.pmtiles', target)
        assert sha(target) == POSITIONS_SHA256
    else:
        keep = [x for x in lines if json.loads(x)['properties']['tree_id'] in link]
        src = W / 'web_build/council_positions.geojsonl'
        src.write_text(''.join(keep))
        subprocess.run(['/opt/homebrew/bin/tippecanoe', '--force', '-P', '--quiet', '-t', str(W / 'tmp'), '--layer=council_positions',
                        '--minimum-zoom=13', '--maximum-zoom=18', '--base-zoom=13', '--drop-densest-as-needed', '--extend-zooms-if-still-dropping',
                        '-y', 'tree_id', '-y', 'source', '-y', 'status', '-y', 'distance_m', '-y', 'edge_distance_m', '-o', str(target), str(src)], check=True)
    subprocess.run(['/opt/homebrew/bin/pmtiles', 'verify', str(target)], check=True)
    write(W / 'verification/council_positions.json', {'published_links': len(link), 'features_checked': sum(seen.values()),
          'one_point_and_one_line_per_link': complete, 'problems': bad[:50], 'problem_count': len(bad), 'excluded_link_features_left_out': left_out,
          'rebuilt': rebuilt, 'recipe': 'package build_council_positions_tiles.sh (tippecanoe z13-18, base zoom 13)',
          'bytes': target.stat().st_size, 'sha256': sha(target)})
    c.close()
    print('Council positions:', 'rebuilt' if rebuilt else 'prebuilt layer verified', len(link), 'links', flush=True)


def methods_page(s, totals, old_totals):
    nf = lambda v: f'{v:,.0f}'
    pl = s['published_links']
    v5n = pl.get('linked', 0) + pl.get('probable', 0)
    by_cause = s['deltas']['by_cause']
    replaced = by_cause.get('record_replaces_detection_marker', {})
    joined = by_cause.get('record_joins_existing_inventory_marker', {})
    seeded = by_cause.get('record_seeded_crown', {})
    low = by_cause.get('record_seeded_low_canopy', {})
    took = by_cause.get('protected_record_replaces_record_marker', {})
    kept = s.get('protected_members_keeping_marker', 0)
    took_crowns = took.get('crowns', 0)
    protected_text = (f' The one exception: a protected or notable tree never loses its marker. On {nf(took_crowns)} crown{"s" if took_crowns != 1 else ""} a protected record now represents the crown in place of an ordinary record, which stays in the crown’s list; '
                      f'{nf(kept)} protected records whose crown is already represented by another protected tree keep their own marker where their source recorded them, and the crown’s estimates are still counted once.')
    dv = totals['totalValueNzdY'] - old_totals['totalValueNzdY']
    n_ex = len(s['excluded_links'])
    word = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n_ex] if n_ex < 10 else f'{n_ex:,}'
    excluded = (f'<p>{word} further crowns drawn from a record were left out because each enclosed a small existing V5 crown; their records stay unlinked, '
                'unchanged on the map, and in review.</p>') if n_ex else ''
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ALTO · V5.2 record-to-crown links</title><style>body{{font:17px/1.65 system-ui,sans-serif;color:#23372b;background:#f2f5ef;margin:0}}main{{max-width:780px;margin:32px auto;padding:28px;background:white;border-radius:18px}}a{{color:#3e693c}}h1{{line-height:1.2}}h2{{font-size:1.25em}}li{{margin:.5em 0}}table{{border-collapse:collapse;width:100%;font-size:15px;margin:.6em 0}}th,td{{text-align:left;padding:6px 8px;border-bottom:1px solid #dfe6da;vertical-align:top}}th{{font-weight:600}}.n{{text-align:right;white-space:nowrap}}@media (max-width:600px){{main{{margin:0;border-radius:0;padding:20px 16px}}table{{font-size:13px}}}}</style><main><a href="./">← Auckland map</a><h1>V5.2 · Joining records to their crowns</h1><p>10 October 2026. This release joins Council, OpenStreetMap, notable-tree and kauri-survey records that V5.1 left unlinked to the crowns they stand on. Where no V5 crown covered a recorded tree, it draws one from the 2024 laser returns at the record’s position. V5 crown boundaries are not redrawn, and no record, source position or survey history is removed.</p><h2>What changed</h2><p>{nf(sum(pl.values()))} of the 37,409 records V5.1 left unlinked are now joined to a crown: {nf(pl.get('linked', 0))} <em>linked</em> and {nf(pl.get('probable', 0))} <em>probable</em> matches to existing V5 crowns, and {nf(pl.get('drawn_from_record', 0))} on {nf(s['crowns_with_new_links'][SEEDED])} crowns <em>drawn from the record</em>.</p><ul><li>{nf(replaced.get('records_joined', 0))} records joined {nf(replaced.get('crowns', 0))} crowns whose map marker was a LiDAR detection. One record per crown now represents it, drawn where the crown’s marker was; the detection stays in the crown’s list of records.</li><li>{nf(joined.get('records_joined', 0) + took.get('records_joined', 0))} records joined {nf(joined.get('crowns', 0) + took_crowns)} crowns that already had a source record as their marker. They are listed in that tree’s profile and do not get a second marker.{protected_text}</li><li>{nf(seeded.get('crowns', 0))} crowns drawn from a record are 3 m or taller. They are drawn faintly, counted in the totals and service estimates with a flag, and await confirmation. The other {nf(low.get('crowns', 0))} are 2–3 m tall and follow the existing low-canopy rule: shown, but not counted.</li></ul><p>As a result the map shows {nf(old_totals['trees'] - totals['trees'])} fewer separate markers ({nf(totals['trees'])} in all), {nf(totals['crowns'] - old_totals['crowns'])} more counted crowns, and the annual value estimate rises by NZ${dv:,.0f} (record-seeded crowns NZ${seeded.get('totalValueNzdY', 0):,.0f}; crowns now represented by a source record, recalculated for its recorded taxon, NZ${replaced.get('totalValueNzdY', 0) + took.get('totalValueNzdY', 0):,.0f}). The count of protected trees on the map is {nf(totals['protected'])}{' as in V5.1' if totals['protected'] == old_totals['protected'] else ''}.</p>{excluded}<h2>How records were joined</h2><p>For each unlinked record, nearby crowns were scored on the distance from the record to the crown’s edge, weighed with an error model learned by comparing the crowns around unlinked records with those around decoy points nearby; on whether the crown’s height and area suit the recorded taxon; on conflicts with other records’ taxa on the same crown; and on how many records a crown of that size usually carries. Neighbouring records were assigned together, so a small crown cannot take several records when one has its own. A record was linked only when its crown was clearly better than every alternative, including no crown at all. Shifting whole digitised rows of records was tested and is not used.</p><p>Where tree-height laser returns stand at a record and no V5 crown covers them, a crown was drawn with V5’s own recipe, including the unclassified returns of palms V5 could not see where the imagery is green.</p><h2>How precise the links are</h2><table><tr><th>Class</th><th class="n">Hold-out</th><th class="n">Blind audit</th><th class="n">95% interval</th></tr><tr><td>Linked</td><td class="n">0.989</td><td class="n">47 of 48</td><td class="n">0.89–1.00</td></tr><tr><td>Probable</td><td class="n">0.936</td><td class="n">33 of 37</td><td class="n">0.75–0.96</td></tr><tr><td>Linked and probable</td><td class="n">0.965</td><td class="n">80 of 85</td><td class="n">0.87–0.97</td></tr><tr><td>Drawn from the record</td><td class="n">—</td><td class="n">31 of 37</td><td class="n">0.69–0.92</td></tr></table><p>The hold-out hides 31,119 trusted links, moves each record as far from its crown as unlinked records of its source typically are, adds copies whose crown is deleted, and finds them again (0.919 for linked and probable when every unlinked record without a crown is assumed crown-missing). The audit is a blind visual judgement of fresh records under the final rules, from 2024 imagery, near-infrared and laser heights. Cards that could not be decided are left out; counting them as wrong gives floors of 0.76, 0.51 and 0.69. The hold-out cannot measure drawn crowns, so their figure comes from the audit alone.</p><h2>Council recorded positions</h2><p>The <em>Council recorded positions</em> switch in Layers (off by default) shows, for every joined record, where its source recorded the tree and a dashed line to the top of the crown it was joined to. The record’s own position is unchanged in its full record; the map marker sits on the crown.</p><h2>What went to review</h2><p>20,704 records went to the researcher workbench and appear on the map as before: 14,760 with competing crowns to choose between, 4,783 with nothing of tree height within 3 m, 1,021 on tree-height returns no crown could be drawn on, and 140 whose position cannot be matched (for example on a roof). The workbench also asks for confirmation of every crown drawn from a record.</p><h2>What stays unlinked</h2><p>13,613 records lie where there are no V5 crowns and no 2024 point cloud: 12,925 kauri observations in the Waitākere Ranges and other forest, 687 notable trees and one OpenStreetMap tree. Their full records say so. “Crown unlinked” does not mean a tree is absent.</p><h2>What a link means</h2><p>A link is spatial evidence that a record describes the tree on that crown. It does not prove that every record on a shared canopy is the same organism, and a drawn crown is a proposal until it is confirmed.</p><p><a href="./data/record-links-v52.json">Link counts, precision and total changes</a> · <a href="./data/tree_details/schema.json">Full-record schema</a> · <a href="./release-metadata.json">Release metadata</a> · <a href="./v51-methods.html">V5.1 crown associations</a> · <a href="./v5-methods.html">Original V5 methods</a></p></main></html>'''


def assemble():
    schema = json.loads((STAGE / 'data/tree_details/schema.json').read_text())
    totals = json.loads((W / 'web_build/totals.json').read_text())
    old_totals = json.loads((W51 / 'web_build/totals.json').read_text())['totals']
    snapshot = json.loads((W / 'verification/database_snapshot.json').read_text())
    s = snapshot['summary']
    assert schema['database_mtime_ns'] == str(DB.stat().st_mtime_ns) == snapshot['mtime_ns']
    # The package's UI patch, applied to V5.1's deployed copies exactly as it was tested.
    ui = W / 'tmp/ui'
    if ui.exists():
        shutil.rmtree(ui)
    (ui / 'web').mkdir(parents=True)
    for name in ('index.html', 'observatory.css', 'tree-evidence.js'):
        shutil.copy2(STAGE51 / name, ui / 'web' / name)
    subprocess.run(['git', 'init', '-q', str(ui)], check=True)
    subprocess.run(['git', '-C', str(ui), 'apply', str(PKG / 'ui_v52.patch')], check=True)
    index = (ui / 'web/index.html').read_text()
    assert index.count(f'window.AKL_TILE_VERSION="{VERSION51}"') == 1
    index = index.replace(f'window.AKL_TILE_VERSION="{VERSION51}"', f'window.AKL_TILE_VERSION="{VERSION}"')
    assert index.count('?v=20261009-v5.2') == 3
    index = index.replace('?v=20261009-v5.2', '?v=' + VERSION)
    index, n = re.subn(r'const PILOT_TOTALS = \{.*?\};', 'const PILOT_TOTALS = ' + json.dumps(totals['totals'], indent=6) + ';', index, flags=re.S)
    assert n == 1
    note = '<a href="./v51-methods.html">Read the v5 release notes</a>'
    assert index.count(note) == 1
    index = index.replace(note, '<a href="./v52-methods.html">Read the v5.2 release notes</a>')
    (STAGE / 'index.html').write_text(index)
    for name in ('observatory.css', 'tree-evidence.js', 'record-links.js'):
        shutil.copy2(ui / 'web' / name, STAGE / name)
    (W / 'tmp/ui_tests').mkdir(parents=True, exist_ok=True)
    shutil.copy2(ui / 'pipeline/v5/test_record_links_ui.cjs', W / 'tmp/ui_tests/test_record_links_ui.cjs')
    meta = json.loads((STAGE51 / 'release-metadata.json').read_text())
    meta['previous_release'] = json.loads(json.dumps({k: meta[k] for k in ('release', 'dataset', 'headline_scope', 'artifacts', 'assembly', 'derived_products') if k in meta}))
    meta['release'].update(dataset_version=DATASET_VERSION, dataset_last_updated_utc=now(), metadata_generated_utc=now(),
                           source_revision='V5.2 record-to-crown links; method, precision and counts in data/record-links-v52.json')
    c = ro()
    seeded = totals['record_seeded_crowns']
    meta['dataset'].update(current_map_markers=totals['totals']['trees'], crown_records=totals['totals']['crowns'], crown_features=totals['crown_features'],
                           display_roles=totals['display_roles'],
                           evidence_tiers=dict(c.execute('SELECT evidence_tier,count(*) FROM tree_evidence_v5 GROUP BY evidence_tier')),
                           current_service_records=c.execute('SELECT count(*) FROM tree_current_services_v5').fetchone()[0],
                           record_links_v52=c.execute('SELECT count(*) FROM tree_record_link_v52').fetchone()[0],
                           record_seeded_crowns_v52=seeded)
    meta['headline_scope']['description'] += (f' V5.2: {seeded["counted"]:,} crowns drawn from a source record ({s["seeded_counted_crown_area_m2"]:,.0f} m²) are counted with a flag'
                                              f' and await confirmation; {seeded["low_canopy_not_counted"]} drawn crowns 2–3 m tall are low canopy and not counted.')
    meta['assembly'].update(assembled_utc=now(), tile_version=VERSION, database_mtime_ns=schema['database_mtime_ns'], mode='verified_v52_record_link_rebuild',
                            note='Package links verified against the V5.1 release; SQL-regenerated linked records, hash-verified unchanged profiles and geometry; rebuilt map, property summaries, totals and KYTE nearby choices.')
    for model in meta['models']:
        if model['component'] == 'record_identity':
            model['implementations'].append({'id': METHOD})
            model['counts']['source_links'] = c.execute('SELECT count(*) FROM tree_crown_v5_links').fetchone()[0]
            model['counts']['record_links_v52'] = meta['dataset']['record_links_v52']
    pl = s['published_links']
    cause = s['deltas']['by_cause']
    took_n = cause.get('protected_record_replaces_record_marker', {}).get('crowns', 0)
    meta['v52_changes'] = [
        f'Joined {sum(pl.values()):,} records that V5.1 left unlinked to a crown: {pl.get("linked", 0):,} linked and {pl.get("probable", 0):,} probable matches to existing V5 crowns, and {pl.get("drawn_from_record", 0):,} on {s["crowns_with_new_links"][SEEDED]:,} crowns drawn from the 2024 returns at the record position.',
        f'{cause.get("record_replaces_detection_marker", {}).get("crowns", 0):,} crowns are now represented by a register or other source record instead of a LiDAR detection; {cause.get("record_joins_existing_inventory_marker", {}).get("records_joined", 0) + cause.get("protected_record_replaces_record_marker", {}).get("records_joined", 0):,} records joined a tree that already had a marker and are listed in its profile.',
        f'A protected or notable tree never loses its marker: {took_n:,} protected record{"s" if took_n != 1 else ""} now represent{"" if took_n != 1 else "s"} {"their crowns" if took_n != 1 else "its crown"} in place of an ordinary record, and {s["protected_members_keeping_marker"]:,} protected records on a crown already represented by a protected tree keep their own marker; estimates are counted once per crown. Protected trees on the map: {totals["totals"]["protected"]:,} (V5.1 {old_totals["protected"]:,}).',
        f'Record-seeded crowns are drawn faintly and await confirmation. {seeded["counted"]:,} are counted in totals and services with a flag (crown_source record_seeded_v52); {seeded["low_canopy_not_counted"]} are 2–3 m and follow the low-canopy rule.',
        'A new default-off layer, Council recorded positions, shows each joined record\'s original source point and a line to its crown top. Source coordinates are unchanged in the full record.',
        'Recomputed service scenarios once per representative crown with the existing V5 equations; superseded representative estimates are archived in the release database.',
        'Retained all 6,238,420 original source IDs, positions and histories, the V5.1 continuity repair, the two accepted KYTE visits and all researcher review decisions.']
    meta['v52_limits'] = ['Precision by class: linked 0.989 hold-out, 47/48 blind audit; probable 0.936, 33/37; drawn from the record 31/37 audit only. Audit intervals are wide.',
                          '20,704 records went to researcher review and are unchanged on the map, and the drawn-crown links await confirmation there; 13,613 records outside V5 and 2024 point-cloud coverage stay unlinked with that reason.',
                          f'{len(s["excluded_links"])} drawn-crown links were excluded because their crown enclosed an existing V5 crown; those records are unchanged.',
                          'V5 polygon geometry, including known holes and clipped boundaries, is unchanged. Record-seeded crowns are proposals until confirmed.',
                          'A link does not certify that every record on a shared crown describes the same organism.']
    for name in ('trees_map_points', 'tree_crowns_pilot', 'properties', 'council_positions'):
        p = STAGE / 'data' / (name + '.pmtiles')
        artifact = {'path': 'data/' + p.name, 'bytes': p.stat().st_size, 'last_modified_utc': now()}
        meta['artifacts'] = [a for a in meta['artifacts'] if a['path'] != artifact['path']] + [artifact]
    meta['derived_products'].update(record_links='data/record-links-v52.json', council_positions='data/council_positions.pmtiles',
                                    property_summaries='data/property_details/schema.json')
    write(STAGE / 'release-metadata.json', meta)
    precision = {'hold_out_weighted': {'linked': 0.989, 'probable': 0.936, 'linked_and_probable': 0.965},
                 'hold_out_pessimistic': {'linked_and_probable': 0.919},
                 'blind_audit_rounds_2_4': {'linked': [47, 48, 0.89, 1.00], 'probable': [33, 37, 0.75, 0.96], 'linked_and_probable': [80, 85, 0.87, 0.97],
                                            'drawn_from_record': [31, 37, 0.69, 0.92], 'fields': ['correct', 'decided', 'interval_low', 'interval_high']},
                 'audit_floor_cant_tell_as_wrong': {'linked': 0.76, 'probable': 0.51, 'drawn_from_record': 0.69}}
    write(STAGE / 'data/record-links-v52.json', {
        'release': VERSION, 'method_id': METHOD, 'classes': {'linked': 'linked_high', 'probable': 'linked_medium', 'drawn_from_record': 'linked_new_crown'},
        'published_links': pl, 'links_by_source': s['links_by_source'], 'crowns_with_new_links': s['crowns_with_new_links'],
        'record_seeded_crowns': {**seeded, 'counted_crown_area_m2': round(s['seeded_counted_crown_area_m2'], 2), 'low_canopy_crown_area_m2': round(s['seeded_low_canopy_crown_area_m2'], 2)},
        'precision': precision,
        'workbench_review': {'unchanged_on_map': {'needs_review': 14760, 'no_tree_found': 4783, 'tree_no_crown': 1021, 'position_unusable': 140, 'records': 20704},
                             'confirm_drawn_crown': {'queued': 593, 'published_faint': pl.get('drawn_from_record', 0), 'excluded_after_v51_check': len(s['excluded_links'])},
                             'queue_records': 21297},
        'left_unlinked_outside_coverage': {'records': s['outside_coverage_reasons_published'], 'kauri_observations': 12925, 'notable_trees': 687, 'osm': 1},
        'excluded_after_v51_check': s['excluded_links'],
        'totals_v51': old_totals, 'totals_v52': totals['totals'], 'total_delta_by_cause': s['deltas']['by_cause'],
        'decisions': ['linked and probable published as links; the record joins the crown and its marker moves to the crown', 'a record joining a crown that already has a marker becomes a member of that tree',
                      'a protected or notable record never loses its marker: marker precedence is protected first, then linked > probable > confidence > distance to the crown top (nearest the top on drawn crowns); a protected record joining a crown represented by a protected tree keeps its own marker',
                      'drawn crowns that enclose an existing V5 crown are excluded and stay in review',
                      'record-seeded crowns published faintly and counted with a flag, except crowns under 3 m, which follow the low-canopy rule', 'row alignment off',
                      'records outside coverage stay unlinked with their reason', 'review queue not published beyond its current state'],
        'package_sha256': json.loads((W / 'verification/package_audit.json').read_text())['package_sha256']})
    model = json.loads((STAGE51 / 'data/longitudinal/model.json').read_text())
    model.update(application_database_mtime_ns=schema['database_mtime_ns'], application_release=VERSION,
                 application_note='Existing fitted model applied to current V5 dimensions with V5.1 repaired associations and V5.2 record links. Historical matching and original benchmark unchanged; this is not a new model validation.')
    write(STAGE / 'data/longitudinal/model.json', model)
    ps = json.loads((STAGE / 'data/property_details/schema.json').read_text())
    ps.update(release=VERSION, database_mtime_ns=schema['database_mtime_ns'])
    ps['field_notes']['n_uncertain'] += ' Crowns drawn from a record in v5.2 (evidence tier possible) count here until confirmed.'
    write(STAGE / 'data/property_details/schema.json', ps)
    (STAGE / 'kyte').mkdir(exist_ok=True)
    for name in ('config.js', 'sw.js'):
        source = (STAGE51 / 'kyte' / name).read_text()
        assert '20261008-v14c-v51-data' in source
        (STAGE / 'kyte' / name).write_text(source.replace('20261008-v14c-v51-data', '20261010-v14c-v52-data'))
    (STAGE / 'v52-methods.html').write_text(methods_page(s, totals['totals'], old_totals))
    dictionary = ['# ALTO V5.2 full-record data dictionary', '', 'Release: ' + VERSION + '.', '',
                  'Each tree profile exposes the datasets below. The schema gives their exact ordered fields. Blank means unavailable, not zero. All source IDs and original coordinates are retained.', '',
                  '**Current crown area** is the segmented horizontal footprint in square metres. **Crown spread** is a width in metres and is not the same measurement. The area-derived equivalent diameter is a circular approximation, not a measured crown spread.', '',
                  'Only current representative records carry current service estimates. Shared-crown aliases may repeat crown measurements: do not sum areas over every source record. Earlier datasets retain their previous spatial and methodological basis.', '',
                  'V5.2 record-to-crown links are in `record_link`; `source_lon`/`source_lat` are the source position, unchanged, and `crown_source` `record_seeded_v52` marks a crown drawn from the record awaiting confirmation. Records outside survey coverage carry `record_link_status`.', '']
    for d in schema['datasets']:
        dictionary.extend(['## ' + d['title'], '', d['note'], '', '`' + d['key'] + '` → `' + d['table'] + '`', '', 'Fields: ' + ', '.join('`' + f + '`' for f in d['fields']) + '.', ''])
    (STAGE / 'data/exports').mkdir(parents=True, exist_ok=True)
    (STAGE / 'data/exports/akl_trees_data_dictionary.md').write_text('\n'.join(dictionary))
    c.close()
    replace = ['index.html', 'record-links.js', 'tree-evidence.js', 'observatory.css', 'release-metadata.json', 'v52-methods.html',
               'data/trees_map_points.pmtiles', 'data/tree_crowns_pilot.pmtiles', 'data/properties.pmtiles', 'data/council_positions.pmtiles',
               'data/tree_details', 'data/property_details', 'data/species_options.json', 'data/record-links-v52.json',
               'data/exports/akl_trees_data_dictionary.md', 'data/longitudinal/model.json', 'kyte/data/nearby', 'kyte/config.js', 'kyte/sw.js',
               'deployment.json', 'release-checks.json', 'bundle-manifest.json']
    # The live site is V5.1: its sealed manifest says exactly what each replaced path holds now.
    prior = {f['path']: f['sha256'] for f in json.loads((STAGE51 / 'bundle-manifest.json').read_text())['files']}
    baseline = {}
    for path in replace:
        hits = {p: h for p, h in prior.items() if p == path or p.startswith(path + '/')}
        if not hits and (STAGE51 / path).is_file():
            hits = {path: sha(STAGE51 / path)}
        baseline.update(hits)
    new_paths = [p for p in replace if p not in ('bundle-manifest.json',) and not any(q == p or q.startswith(p + '/') for q in baseline)]
    write(STAGE / 'deployment.json', {'version': VERSION, 'previous_version': VERSION51, 'replace_paths': replace, 'new_paths': new_paths,
          'preserve': ['KYTE code except cache version', 'KYTE accounts, uploads, photos and API configuration', 'private research workbench and review ledger',
                       'address index, near-canopy and unchanged historical map layers', 'tree-identity.js and other unchanged UI modules', 'root .htaccess and other applications'],
          'baseline_hashes': baseline})
    print('V5.1 UI with the V5.2 link patch; metadata, notes and cache versions assembled.', flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('stage', choices=['prepare', 'maps', 'details', 'properties', 'nearby', 'positions', 'assemble'])
    globals()[p.parse_args().stage]()
