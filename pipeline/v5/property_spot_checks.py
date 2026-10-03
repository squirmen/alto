#!/usr/bin/env python3
"""Spot checks for the property and tenure build, read the way a browser would read them.

Addresses resolve through the address shards, properties through the hashed buckets and
schema, and trees through the tenure sidecar, so a check that passes here means the static
files alone answer the question. Cases: a house (110 Bayswater Avenue), the Guiniven Avenue
palms, a Council park tree, a school and a tree on a residential section. Then the tenure
cases the review raised: macron street names in the address shards, designated Crown land,
golf courses under an Open Space zone, Council housing, Rangitoto and Motutapu, island roads,
and the rule that a parcel's trees share its class. A last pass reads every bucket and adds
the parcel figures back up against the release totals.
"""
import gzip, json, re, sys
from pathlib import Path
import numpy as np, pandas as pd, pyogrio, shapely

sys.path.insert(0, str(Path(__file__).parent))
from build_property_tenure_v5 import DATA, TMP, WEB, RAW, MOJIBAKE, NOT_COUNTED_ROLE, bucket_path, norm_street, shard_key, split_number  # noqa: E402

SCHEMA = json.loads((DATA / 'property_details/schema.json').read_text())
GUINIVEN = ['akl_tree_trp_NSCC14188', 'akl_tree_trp_NSCC14189', 'akl_tree_trp_NSCC14190', 'akl_tree_trp_NSCC14191',
            'akl_tree_trp_NSCC66844', 'akl_tree_trp_NSCC66845', 'akl_tree_trp_NSCC66846']


def unpack(pack, pid):
    out = {}
    for d in SCHEMA['datasets']:
        if d['key'] in pack[pid]:
            v = pack[pid][d['key']]
            out[d['key']] = [dict(zip(d['fields'], row)) for row in v] if d['multiple'] else dict(zip(d['fields'], v))
    return out


def record(pid):
    f = DATA / 'property_details' / bucket_path(pid)
    pack = json.loads(gzip.decompress(f.read_bytes())) if f.exists() else {}
    return unpack(pack, pid) if pid in pack else None


def address(number, street, unit=None):
    sn = norm_street(street)
    rows = json.loads(gzip.decompress((DATA / 'address_index' / f'{shard_key(sn)}.json.gz').read_bytes()))
    num, un = split_number(number, unit)
    return [r for r in rows if r[3].startswith(sn) and r[0] == num and (un is None or r[1] == un)]


def summary(rec, trees=8):
    if rec is None:
        return 'no record: no counted tree, crown or nearby street tree on this parcel'
    p = rec['property']
    keys = ['pid', 'area_m2', 'intent', 'tenure', 'tenure_basis', 'zone', 'n_trees', 'n_confident', 'n_uncertain', 'n_earlier_not_counted',
            'canopy_m2', 'canopy_cover_pct', 'canopy_own_m2', 'canopy_overhang_m2', 'total_value_nzd_y', 'total_value_nzd_y_low',
            'total_value_nzd_y_high', 'total_value_confident_nzd_y', 'stormwater_value_nzd_y', 'avoided_runoff_m3_y', 'intercepted_rainfall_m3_y',
            'stored_co2e_tonnes_est', 'annual_sequestration_tco2e_y_est', 'carbon_value_nzd_y', 'cooling_value_nzd_y', 'pm25_removed_kg_y',
            'air_quality_value_nzd_y', 'tallest_m', 'tallest_tree_id', 'trees_listed', 'trees_truncated', 'n_street_nearby', 'street_nearby_value_nzd_y']
    out = {k: p[k] for k in keys}
    out['trees'] = rec.get('trees', [])[:trees]
    out['street_trees'] = rec.get('street_trees', [])[:trees]
    return out


def bucket_totals():
    """Every bucket read back: parcel sums plus the unassigned remainder against web_build/totals.json."""
    n, value, runoff, carbon, records, listed, files = 0, 0.0, 0.0, 0.0, 0, 0, 0
    fields = SCHEMA['datasets'][0]['fields']
    ix = {k: fields.index(k) for k in ['n_trees', 'total_value_nzd_y', 'avoided_runoff_m3_y', 'stored_co2e_tonnes_est', 'trees_listed']}
    for f in sorted((DATA / 'property_details').glob('*/*.json.gz')):
        files += 1
        for pid, obj in json.loads(gzip.decompress(f.read_bytes())).items():
            assert bucket_path(pid) == f'{f.parent.name}/{f.name}', pid
            p = obj['property']; records += 1
            n += p[ix['n_trees']]; value += p[ix['total_value_nzd_y']] or 0; runoff += p[ix['avoided_runoff_m3_y']] or 0
            carbon += p[ix['stored_co2e_tonnes_est']] or 0
            assert len(obj.get('trees', [])) == p[ix['trees_listed']]
    pts = pd.read_parquet(TMP / 'points.parquet', columns=['display_role', 'total_value_nzd_y', 'avoided_runoff_m3_y', 'stored_co2e_tonnes_est'])
    ten = pd.read_parquet(DATA / 'tenure.parquet', columns=['in_property'])
    un = (pts.display_role.values != NOT_COUNTED_ROLE) & ~ten.in_property.values
    rel = json.loads((WEB / 'totals.json').read_text())['totals']
    out = {'buckets_read': files, 'records': records}
    for key, par, col in [('trees', n, None), ('totalValueNzdY', value, 'total_value_nzd_y'), ('runoffM3Y', runoff, 'avoided_runoff_m3_y'),
                          ('carbonTco2e', carbon, 'stored_co2e_tonnes_est')]:
        una = float(un.sum()) if col is None else float(np.nansum(pts[col].values[un]))
        out[key] = {'parcels_from_buckets': round(par, 3), 'unassigned': round(una, 3), 'sum': round(par + una, 3), 'release': rel[key],
                    'difference': round(par + una - rel[key], 3)}
    return out


def street_rows(street):
    """Every address row whose street_norm starts with the normalised query, from its shard only."""
    sn = norm_street(street)
    rows = json.loads(gzip.decompress((DATA / 'address_index' / f'{shard_key(sn)}.json.gz').read_bytes()))
    return [r for r in rows if r[3].startswith(sn)]


def review_checks(ten, pts, side, P):
    out = {}
    # Address text: macron streets reachable with or without macrons, and no garbled text anywhere.
    garbled = 0
    for f in (DATA / 'address_index').glob('*.json.gz'):
        garbled += sum(1 for r in json.loads(gzip.decompress(f.read_bytes())) if any(isinstance(v, str) and MOJIBAKE.search(v) for v in r))
    out['Address text'] = {'rows_with_garbled_text': garbled, **{
        q: {'rows': len(rr), 'streets': sorted({r[2] for r in rr})[:4], 'suburbs': sorted({r[4] or '' for r in rr})[:4]}
        for q in ['Onehunga Mall', 'Ōnehunga Mall', 'Okura River Road', 'Ōkura River Road', 'Bader Drive']
        for rr in [street_rows(q)]}}
    sub = pd.Series([r[4] for r in json.loads(gzip.decompress((DATA / 'address_index' / 'ba.json.gz').read_bytes()))]).value_counts()
    out['Address text']['suburbs_in_shard_ba_with_macrons'] = {k: int(v) for k, v in sub.items() if re.search('[āēīōūĀĒĪŌŪ]', k or '')}

    # Tenure by place: trees whose point falls in a named polygon, counted with the release rule.
    counted = (pts.display_role != NOT_COUNTED_ROLE).values
    xy = shapely.points(side.x.values, side.y.values)

    def inside(geom):
        ix = shapely.STRtree(xy).query(geom, predicate='contains')
        m = np.zeros(len(pts), bool); m[ix] = True
        m &= counted
        v = pts.total_value_nzd_y.values
        return {'counted_trees': int(m.sum()), 'value_nzd_y': round(float(np.nansum(v[m])), 2),
                'by_tenure': pd.Series(ten.tenure.values[m]).value_counts().to_dict(),
                'by_basis': pd.Series(ten.tenure_basis.values[m]).value_counts().head(4).to_dict()}

    d = pyogrio.read_dataframe(RAW / 'designation.gpkg', columns=['SUBTYPE_NAME', 'NAME'])
    for name in ['Defence purposes (Ardmore Training Camp)', 'Defence purposes (Kauri Point Storage Facility)', 'Auckland Prison',
                 'Auckland University of Technology North Campus', 'Defence purposes - air weapons range danger template']:
        out[f'Designation: {name}'] = inside(shapely.union_all(d.geometry[d.NAME == name].values))
    g = pyogrio.read_dataframe(RAW / 'osm_golf_courses.gpkg', columns=['name'])
    for name in ['Royal Auckland Golf Course', 'The Grange Golf Course', 'Pakuranga Golf Club', 'Howick Golf Club',
                 'Chamberlain Park Golf Course', 'Takapuna Golf Course']:
        out[f'Golf: {name}'] = inside(shapely.union_all(g.geometry[g.name == name].values))
    k = pyogrio.read_dataframe(RAW / 'park_extent_public.gpkg', columns=['AssetGroup', 'TLA_AssetDes'])
    haumaru = k.TLA_AssetDes.fillna('').str.startswith('PROPERTY - HOUSING FOR THE OLDER PEOPLE') & k.AssetGroup.isna()
    out['Council housing for older people (ParkExtentPublic)'] = inside(shapely.union_all(k.geometry[haumaru].values))
    out['Council non-park property (ParkExtentPublic, no asset group)'] = inside(shapely.union_all(
        k.geometry[k.AssetGroup.isna() & k.TLA_AssetDes.fillna('').str.match(r'PROPERTY - (?!HOUSING FOR THE OLDER PEOPLE|OTHERS - (THIRD PARTY|CHURCH|COMMUNITY ORG|COMMERCIAL))')].values))
    out['Rangitoto and Motutapu parcels'] = P[P.pid.isin(['7397239', '7658960'])][['pid', 'tenure', 'tenure_basis']].to_dict('records')
    out['Rangitoto parcel record'] = summary(record('7397239'), trees=2)
    isl = ten.tenure_basis.values == 'island_road'
    out['Island roads'] = {'features': int(isl.sum()), 'counted': int((isl & counted).sum()),
                           'unparcelled_unzoned_left': int((ten.tenure_basis.values == 'unparcelled_unzoned').sum())}
    # One title, one class.
    ptn = P.set_index('pid').tenure.reindex(ten.parcel_id.values).values
    inprop = ten.in_property.values & counted
    out['Parcel and tree tenure agree'] = {'counted_trees_in_properties': int(inprop.sum()),
                                           'differing_from_parcel': int((ten.tenure.values[inprop] != ptn[inprop]).sum())}
    return out


def main():
    ten = pd.read_parquet(DATA / 'tenure.parquet').set_index('tree_id')
    pts = pd.read_parquet(TMP / 'points.parquet', columns=['tree_id', 'owner_class', 'display_role', 'evidence_tier', 'species_common',
                                                            'total_value_nzd_y', 'crown_max_chm_m', 'lon', 'lat']).set_index('tree_id')
    side = pd.read_parquet(TMP / 'points_assign.parquet', columns=['zone', 'park_name', 'x', 'y'])
    side.index = pts.index

    def tree(tid):
        r = pts.loc[tid]
        return {'tree_id': tid, 'owner_class': r.owner_class, 'display_role': r.display_role, 'evidence_tier': r.evidence_tier,
                'species_common': r.species_common if isinstance(r.species_common, str) else None,
                'total_value_nzd_y': None if pd.isna(r.total_value_nzd_y) else round(float(r.total_value_nzd_y), 2),
                'zone_at_point': side.zone[tid], 'park_or_conservation_land': side.park_name[tid] if isinstance(side.park_name[tid], str) else None,
                **{k: (v.item() if hasattr(v, 'item') else v) for k, v in ten.loc[tid].items()}}

    checks = {}
    # 1. A house: every address row for 110 Bayswater Avenue and the parcel each resolves to.
    rows = address('110', 'Bayswater Ave')
    checks['110 Bayswater Avenue'] = {'addresses': [dict(zip(['number', 'unit', 'street', 'street_norm', 'suburb', 'postcode', 'lon', 'lat', 'pid'], r))
                                                    for r in rows],
                                      'properties': {pid: summary(record(pid)) for pid in dict.fromkeys(r[8] for r in rows)}}

    # 2. The Guiniven Avenue palms: four palms, each in the Council parks register and most also in Auckland Transport's.
    recs = [tree(t) for t in GUINIVEN]
    checks['Guiniven Avenue palms'] = {'all_street': all(r['tenure'] == 'street' for r in recs), 'records': recs,
                                       'guiniven_reserve_parcel': summary(record('5050183')),
                                       'neighbour_4804092_street_list': (record('4804092') or {}).get('street_trees', [])[:8]}

    # 3. Council park trees: the highest-value LiDAR tree in Bayswater Park (no parks register trees there) and the
    #    highest-value parks register tree in Albert Park.
    def park(name, register):
        ix = side.index[(side.park_name == name).values & (pts.display_role != NOT_COUNTED_ROLE).values]
        sub = pts.loc[ix]
        sub = sub[(sub.owner_class == 'Auckland Council Parks') == register].sort_values('total_value_nzd_y', ascending=False)
        out = {'park_tenure_counts': ten.loc[ix].tenure.value_counts().to_dict(), 'tree': tree(sub.index[0]) if len(sub) else None}
        if len(sub):
            out['parcel'] = summary(record(out['tree']['parcel_id']), trees=3)
        return out
    checks['Council park tree'] = {'Bayswater Park (LiDAR)': park('Bayswater Park', False), 'Albert Park (parks register)': park('Albert Park', True)}

    # 4. A school: Bayswater School, zoned Mixed Housing Urban with the school's name on the zone polygon.
    P = pd.read_parquet(TMP / 'parcels.parquet', columns=['pid', 'zone', 'tenure', 'tenure_basis', 'area_m2'])
    sch = P[P.zone.fillna('').str.contains('Bayswater School')]
    recs = {pid: record(pid) for pid in sch.pid}
    have = {k: v for k, v in recs.items() if v}
    best = max(have.values(), key=lambda v: v['property']['n_trees']) if have else None
    checks['School'] = {'parcels': sch[['pid', 'tenure', 'tenure_basis']].to_dict('records'),
                        'campus': {'parcels': len(sch), 'area_m2': round(float(sch.area_m2.sum())),
                                   'n_trees': sum(v['property']['n_trees'] for v in have.values()),
                                   'canopy_m2': round(sum(v['property']['canopy_m2'] or 0 for v in have.values()), 1),
                                   'total_value_nzd_y': round(sum(v['property']['total_value_nzd_y'] or 0 for v in have.values()), 2)},
                        'parcel_with_most_trees': summary(best, trees=3)}
    if best and best.get('trees'):
        checks['School tree'] = tree(best['trees'][0]['tree_id'])

    # 5. A tree on a residential section: the highest-value tree on the first 110 Bayswater Avenue parcel with trees.
    for pid in dict.fromkeys(r[8] for r in rows):
        rec = record(pid)
        if rec and rec.get('trees'):
            checks['Residential tree'] = tree(rec['trees'][0]['tree_id'])
            break

    checks.update(review_checks(ten, pts, side, P))
    checks['Bucket reconciliation'] = bucket_totals()
    (DATA / 'spot_checks.json').write_text(json.dumps(checks, indent=1, ensure_ascii=False, default=str))
    print(json.dumps(checks, indent=1, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()
