#!/usr/bin/env python3
"""Repair the confirmed legacy feet/metres error and dangling trajectory links.

Dry-run by default. Apply only to the recognised legacy reference, with an
existing verified local backup. Preserve original values and links in audit
 tables. No re-identification, growth-form change or historic fate inference.
"""
import argparse
import csv
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'alto_release_integrity_v1'
SOURCE = 'https://www.itreetools.org/eco/resources/international/iTreeEcoUserInputManualv2.8.pdf'
UNCHANGED_TILES = ('trees_map_points.pmtiles', 'tree_crowns_pilot.pmtiles',
                   'low_canopy_candidates.pmtiles', 'tree_root_shapes.pmtiles')

def digest_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(8*1024*1024), b''): h.update(block)
    return h.hexdigest()

def species_map_digest(con):
    h = hashlib.sha256()
    for row in con.execute('SELECT tree_id,growth_form,growth_form_source,growth_form_confidence FROM tree_species_attributes ORDER BY tree_id'):
        h.update((json.dumps(row, separators=(',', ':'))+'\n').encode())
    return h.hexdigest()

def repair(con):
    """Transactional, idempotent repair. Caller records database/file provenance."""
    if con.execute("SELECT 1 FROM sqlite_master WHERE name='alto_integrity_runs'").fetchone():
        if con.execute('SELECT 1 FROM alto_integrity_runs WHERE version=?', (VERSION,)).fetchone():
            return {'status': 'already_applied'}
    sentinel = con.execute("SELECT mature_height_m FROM itree_species_ref WHERE scientific_name='Agathis australis'").fetchone()
    if sentinel != (165.0,):
        raise ValueError('Reference is not the recognised legacy feet build; refusing a second or ambiguous conversion.')
    before = species_map_digest(con)
    now = datetime.now(timezone.utc).isoformat()
    with con:
        con.execute('BEGIN IMMEDIATE')
        con.execute('CREATE TABLE IF NOT EXISTS alto_integrity_runs (version TEXT PRIMARY KEY, applied_utc TEXT, details_json TEXT)')
        con.execute('CREATE TABLE IF NOT EXISTS alto_height_unit_audit (version TEXT, source_table TEXT, record_id TEXT, old_height REAL, new_height_m REAL, old_plausibility TEXT, PRIMARY KEY(version,source_table,record_id))')
        counts = {}
        for table, key in [('itree_species_ref','scientific_name'),('itree_genus_ref','genus'),('tree_species_attributes','tree_id')]:
            old_flag = 'height_plausibility' if table == 'tree_species_attributes' else 'NULL'
            con.execute(f'INSERT INTO alto_height_unit_audit SELECT ?, ?, {key}, mature_height_m, ROUND(mature_height_m*0.3048,2), {old_flag} FROM {table} WHERE mature_height_m IS NOT NULL', (VERSION,table))
            counts[table] = con.execute(f'UPDATE {table} SET mature_height_m=ROUND(mature_height_m*0.3048,2) WHERE mature_height_m IS NOT NULL').rowcount
        con.execute("UPDATE tree_species_attributes SET height_plausibility=CASE WHEN mature_height_m IS NULL OR mature_height_m<=0 THEN 'no_ceiling' WHEN lidar_height_m IS NULL OR lidar_height_m<=0 THEN 'no_height' WHEN lidar_height_m>1.3*mature_height_m THEN 'implausibly_tall' ELSE 'ok' END")
        con.execute('CREATE TABLE IF NOT EXISTS alto_orphan_trajectory_audit (version TEXT, trajectory_id TEXT, old_canonical_tree_id TEXT, reason TEXT, PRIMARY KEY(version,trajectory_id))')
        con.execute("INSERT INTO alto_orphan_trajectory_audit SELECT ?,tr.trajectory_id,tr.canonical_tree_id,'Canonical record absent from current trees; original link retained here' FROM tree_trajectory_pilot tr LEFT JOIN trees t ON t.tree_id=tr.canonical_tree_id WHERE tr.canonical_tree_id IS NOT NULL AND t.tree_id IS NULL", (VERSION,))
        counts['orphan_links_unlinked'] = con.execute('UPDATE tree_trajectory_pilot SET canonical_tree_id=NULL WHERE trajectory_id IN (SELECT trajectory_id FROM alto_orphan_trajectory_audit WHERE version=?)', (VERSION,)).rowcount
        con.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_trajectory_current_canonical ON tree_trajectory_pilot(canonical_tree_id) WHERE canonical_tree_id IS NOT NULL')
        after = species_map_digest(con)
        if before != after: raise ValueError('Map species attributes unexpectedly changed; rolling back.')
        details = dict(status='applied', counts=counts, height_source_unit='feet', height_output_unit='metres', factor=0.3048,
                       source_manual=SOURCE, species_map_fields_sha256=after,
                       historic_fates='unchanged; no new raster classification implied')
        con.execute('INSERT INTO alto_integrity_runs VALUES (?,?,?)',(VERSION,now,json.dumps(details,sort_keys=True)))
    return details

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--db',type=Path,default=ROOT/'data/processed/akl_trees.sqlite')
    ap.add_argument('--apply',action='store_true')
    ap.add_argument('--backup-manifest',type=Path,default=ROOT/'outputs/backups/alto_before_release_20260909.sqlite.gz.json')
    args = ap.parse_args()
    con = sqlite3.connect(f'file:{args.db}?mode={"rw" if args.apply else "ro"}',uri=True)
    if not args.apply:
        print(json.dumps({'kauri_stored_height':con.execute("SELECT mature_height_m FROM itree_species_ref WHERE scientific_name='Agathis australis'").fetchone()[0], 'orphan_links':con.execute('SELECT count(*) FROM tree_trajectory_pilot tr LEFT JOIN trees t ON t.tree_id=tr.canonical_tree_id WHERE tr.canonical_tree_id IS NOT NULL AND t.tree_id IS NULL').fetchone()[0]},indent=2));return
    if con.execute("SELECT 1 FROM sqlite_master WHERE name='alto_integrity_runs'").fetchone() and con.execute('SELECT 1 FROM alto_integrity_runs WHERE version=?',(VERSION,)).fetchone():
        print('Already applied; no database or file changes.');return
    backup = json.loads(args.backup_manifest.read_text())
    before_mtime = args.db.stat().st_mtime_ns
    if backup['source_mtime_ns'] != before_mtime or backup['quick_check'] != 'ok' or not args.backup_manifest.with_suffix('').is_file():
        raise SystemExit('A verified backup of this exact database is required.')
    source_path = Path('/data/alto/itree_database_2026-06-19/derived/itree_species_all.csv')
    raw = {}
    with source_path.open(encoding='utf-8') as stream:
        for row in csv.DictReader(stream):
            name = f"{(row.get('Genus') or '').strip()} {(row.get('ScientificName') or '').strip()}".strip()
            if name in raw: continue
            try: raw[name] = float(row.get('MatureHeight'))
            except (ValueError, TypeError): raw[name] = None
    for name, height in con.execute('SELECT scientific_name,mature_height_m FROM itree_species_ref'):
        if name not in raw or raw[name] != height:
            raise SystemExit('Original i-Tree file does not match stored legacy reference: '+name)
    original_source = dict(path=str(source_path), sha256=digest_file(source_path), species_rows=len(raw), mismatches=0)
    preserved = []
    for name in UNCHANGED_TILES:
        path = args.db.parent/name
        if path.stat().st_mtime_ns < before_mtime: raise SystemExit(f'{name} was already stale before repair')
        preserved.append({'path':name,'bytes':path.stat().st_size,'sha256':digest_file(path)})
    details = repair(con);con.close()
    report = dict(version=VERSION,database_before_mtime_ns=before_mtime,database_mtime_ns=args.db.stat().st_mtime_ns,
                  unchanged_tiles=preserved, original_source=original_source, **details)
    # A bounded carry-forward record: these four tile inputs did not change.
    # Mature heights/QA flags are not in their schemas. Only tree_change must rebuild.
    out = args.db.parent/'tile-integrity-repair.json'
    out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()
