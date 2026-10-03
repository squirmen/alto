#!/usr/bin/env python3
"""Property summaries and land-tenure classes for the v5 map trees.

The map says who recorded a tree (the Council parks register, Auckland Transport,
a LiDAR detection), not whose land it stands on: a LiDAR-detected street tree is
"inferred", and a homeowner cannot ask what the trees on their section do. This
build places every map feature on a LINZ primary parcel, infers a tenure class
for each parcel from Council park extents, DOC conservation land, Unitary Plan
designations and base zones, and the parcel's intent and statutory actions, gives
every tree the class of the parcel it stands in (register trees on a road or park
just over a boundary aside), measures crown canopy over each parcel (including
neighbours' overhanging crowns), and sums the release's own per-tree service
estimates per parcel with the release's counting rule, so property figures add back
up to the map totals.

Tenure is inferred from zoning, designations and parcel records, not from ownership
records: Council-owned housing sits in residential zones, some schools are private,
and an Open Space zone also covers private golf courses and bush, so open space
counts as park only where an ownership signal backs it. The class says what kind of
land a tree most likely stands on, and tenure_basis says why.

Inputs are read-only: the v5 web export (points/crowns GeoJSONL, the features the
tiles were built from), four service columns the export left out from the v5
database, LINZ primary parcels, and the open layers cached by property_sources.py.
Stages cache their outputs; run all or name them, e.g. `--stage canopy summaries`.
"""
import argparse, collections, gzip, json, math, os, re, sqlite3, subprocess, time, unicodedata
from pathlib import Path
import numpy as np, pandas as pd, pyarrow as pa, pyarrow.parquet as pq
import duckdb, pyogrio, shapely
from pyproj import Transformer

W = Path('/data/alto/working/alto_parcels_20261002')
V5 = Path('/data/alto/working/alto_v5_20260922')
WEB = V5 / 'web_build'
DB = V5 / 'akl_trees.sqlite'
PARCELS = Path('/data/alto/raw/linz/primary_parcels_auckland.gpkg')
RAW, TMP, DATA = W / 'data/raw', W / 'tmp', W / 'data'
STATS = DATA / 'build_stats.json'
TO2193 = Transformer.from_crs(4326, 2193, always_xy=True)
TO4326 = Transformer.from_crs(2193, 4326, always_xy=True)

# The map's own lists (web/index.html), so property counts match what the map shows.
UNCERTAIN_TIERS = {'location_unverified', 'earlier_detection', 'possible', 'unverified', 'possible_duplicate'}
NOT_COUNTED_ROLE = 'earlier_detection'  # export_web_v5.py: every other display role counts toward the totals
VALUE_FIELDS = ['total_value_nzd_y', 'total_value_nzd_y_low', 'total_value_nzd_y_high', 'stormwater_value_nzd_y',
                'avoided_runoff_m3_y', 'intercepted_rainfall_m3_y', 'stored_co2e_tonnes_est',
                'annual_sequestration_tco2e_y_est', 'carbon_value_nzd_y', 'cooling_value_nzd_y',
                'pm25_removed_kg_y', 'air_quality_value_nzd_y']
EXTRA_FIELDS = ['intercepted_rainfall_m3_y', 'annual_sequestration_tco2e_y_est', 'total_value_nzd_y_low', 'total_value_nzd_y_high']
POINT_FIELDS = {'tree_id': 'VARCHAR', 'display_role': 'VARCHAR', 'crown_source': 'VARCHAR', 'source_primary': 'VARCHAR',
                'owner_class': 'VARCHAR', 'evidence_tier': 'VARCHAR', 'species_common': 'VARCHAR', 'species_latin': 'VARCHAR',
                'growth_form': 'VARCHAR', 'species_class': 'VARCHAR', 'is_protected_notable': 'INTEGER',
                'crown_area_m2': 'DOUBLE', 'crown_max_chm_m': 'DOUBLE', 'valuation_confidence': 'VARCHAR',
                **{f: 'DOUBLE' for f in VALUE_FIELDS if f not in EXTRA_FIELDS}}
TENURES = ['street', 'park', 'institutional', 'private', 'other', 'unknown']
TREE_CAP, STREET_CAP, STREET_REACH_M, ADDRESS_SNAP_M, REGISTER_SNAP_M = 300, 50, 10.0, 15.0, 5.0
GRID_M = 500.0  # zone and park polygons are cut to this grid so point and area tests stay cheap
VERGE_MAX_AREA_M2, VERGE_MAX_WIDTH_M, VERGE_EDGE_M, VERGE_MIN_ROAD_EDGE = 3000.0, 8.0, 1.5, 0.3
MOJIBAKE = re.compile('[\u0080-\u009f]|[\u00c2-\u00f4][\u0080-\u00bf]')  # UTF-8 read as Latin-1: ā becomes Ä plus a C1 control
SCHOOL_NAME = re.compile(r'school|scool|college|collegiate|\bkura\b|tkkm|\bkkm\b|intermediate|gramm[ae]r|academy|campus|education|'
                         r'parent unit|\bhigh\b|kindergarten|wharekura|kohanga', re.I)

# Park extent asset groups that mean public open space; cemeteries and older-persons villages go to the zone rule.
PARK_GROUPS = {'Park', 'Regional', 'Owned NotMaint', 'Maint NotOwned', 'Stormwater', 'Blue/Green Network Properties', 'Holiday'}
# ParkExtentPublic rows with no asset group are decided by their asset description (see extent_kind).
THIRD_PARTY = ('PROPERTY - OTHERS - THIRD PARTY', 'PROPERTY - OTHERS - CHURCH', 'PROPERTY - OTHERS - COMMUNITY ORGANISATION',
               'PROPERTY - OTHERS - COMMERCIAL LEASE')
# Designations whose requiring authority is a Minister hold Crown land for that purpose (Defence, Education,
# Corrections ...). Network utilities, NZTA and KiwiRail designate routes across private land, so they are not used;
# Auckland Council's only back an Open Space zone. The air weapons range danger template is a hazard overlay on farms.
DESIGNATION_SKIP = re.compile(r'danger template', re.I)
PUBLIC_SIGNAL_SHARE, ISLAND_ROAD_M = 0.2, 10.0
# LINZ statutory actions, sentence by sentence; a sentence that revokes, exchanges or stops a reserve or road is ignored.
STAT_SPLIT = re.compile(r'(?<=[.\]])\s+|\[(?:Create|Referenced)\]\s*|\r?\n')
STAT_PARK = re.compile(r'\b(recreation|scenic|historic|nature|scientific|esplanade|wildlife)\b[^.]*\breserve\b|\bdomain\b|\brecreation ground\b', re.I)
STAT_PUBLIC = re.compile(r'\breserve\b|\broad\b[^.]*\bvest|\bvest[^.]*\broad\b', re.I)
STAT_UNDONE = re.compile(r'revok|revoc|cancel|uplift|stop|clos|cease|exchange|no longer|dispos', re.I)


def zone_tenure(name):
    """Unitary Plan base zone name -> tenure class (None: the zone says nothing, e.g. Hauraki Gulf Islands)."""
    if not isinstance(name, str) or name in ('DELETED', 'Hauraki Gulf Islands'):
        return None
    if name in ('Road', 'Strategic Transport Corridor Zone'):
        return 'street'
    if name.startswith('Open Space') or name == 'Green Infrastructure Corridor':
        return 'park'
    if name in ('Special Purpose - Quarry Zone', 'Special Purpose - Landfill Zone', 'Ardmore Airport Residential'):
        return 'private'  # quarries, landfills and the airport's housing area are held by their operators
    if name.startswith('Special Purpose') or name == 'Ardmore Airport':
        return 'institutional'
    if name.startswith('Coastal') or name == 'Water':
        return 'other'
    if name.startswith(('Residential', 'Business', 'Rural', 'Future Urban', 'Two-Storey')):
        return 'private'
    return None


def intent_class(intent):
    """LINZ parcel_intent -> title / reserve / railway / other. DCDB parcels predate recorded intent and are titled land."""
    if intent in ('Fee Simple Title', 'DCDB', 'Maori', 'Strata', 'Lease'):
        return 'title'
    if intent and 'Reserve' in intent:
        return 'reserve'
    if intent == 'Railway':
        return 'railway'
    return 'other'


# The host maps no type for .json.gz and deflates application/json, so every folder of gzipped JSON
# carries the rules the live tree_details/.htaccess uses: gzip-encoded JSON, cached as immutable (the
# page asks with ?v=), never compressed twice. Without them Safari before 16.4, which lacks
# DecompressionStream, could not read the address shards or property buckets.
GZ_JSON_HTACCESS = r'''<IfModule mod_headers.c>
  <FilesMatch "\.json\.gz$">
    Header set Content-Encoding gzip
    Header set Content-Type application/json
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
<IfModule mod_setenvif.c>
  SetEnvIfNoCase Request_URI "\.json\.gz$" no-gzip dont-vary
</IfModule>
'''


def log(*s): print(time.strftime('%H:%M:%S'), *s, flush=True)


def stats_update(key, value):
    s = json.loads(STATS.read_text()) if STATS.exists() else {}
    s[key] = value
    STATS.write_text(json.dumps(s, indent=1, default=lambda v: v.item() if hasattr(v, 'item') else str(v)))


def to2193(lon, lat):
    x, y = TO2193.transform(np.asarray(lon, float), np.asarray(lat, float))
    return np.asarray(x), np.asarray(y)


def reproject(geoms, tf):
    return shapely.transform(geoms, lambda xy: np.column_stack(tf.transform(xy[:, 0], xy[:, 1])))


def fnv(text):
    h = 2166136261
    for b in text.encode('utf-8'):
        h = ((h ^ b) * 16777619) & 0xffffffff
    return h


def bucket_path(pid):
    n = format(fnv(pid) % 65536, '04x')
    return f'{n[:2]}/{n[2:]}.json.gz'


def r(v, places=3):
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return None
    return round(float(v), places)


# ---------------------------------------------------------------- inputs
def load_parcels():
    df = pyogrio.read_dataframe(PARCELS, columns=['id', 'parcel_intent'])
    g = df.geometry.values
    bad = ~shapely.is_valid(g)
    if bad.any():
        g[bad] = shapely.make_valid(g[bad])
    return pd.DataFrame({'pid': df['id'].astype('int64').astype(str).values, 'intent': df['parcel_intent'].values,
                         'area_m2': shapely.area(g)}), np.asarray(g)


def statutory_flags():
    """Per parcel (LINZ order): (open-space reserve, any public reserve or road vesting) from statutory_actions.
    Rangitoto is a Legalisation parcel 'Declared a Reserve and Classified as a Scenic Reserve'; the text itself is never written out."""
    df = pyogrio.read_dataframe(PARCELS, columns=['statutory_actions'], read_geometry=False)
    park, public = np.zeros(len(df), bool), np.zeros(len(df), bool)
    for i, text in enumerate(df.statutory_actions.values):
        if isinstance(text, str):
            live = [x for x in STAT_SPLIT.split(text) if x and not STAT_UNDONE.search(x)]
            park[i] = any(STAT_PARK.search(x) for x in live)
            public[i] = park[i] or any(STAT_PUBLIC.search(x) for x in live)
    return park, public


def gridded(geoms, attrs):
    """Cut polygons to a GRID_M grid so prepared point-in-polygon and overlay stay local."""
    out_g, out_i = [], []
    b = shapely.bounds(geoms)
    for i, (g, (x0, y0, x1, y1)) in enumerate(zip(geoms, b)):
        if (x1 - x0) <= GRID_M and (y1 - y0) <= GRID_M:
            out_g.append(g); out_i.append(i); continue
        for gx in np.arange(math.floor(x0 / GRID_M) * GRID_M, x1, GRID_M):
            for gy in np.arange(math.floor(y0 / GRID_M) * GRID_M, y1, GRID_M):
                piece = shapely.clip_by_rect(g, gx, gy, gx + GRID_M, gy + GRID_M)
                if not piece.is_empty and shapely.area(piece) > 0:
                    out_g.append(piece); out_i.append(i)
    out = attrs.iloc[out_i].reset_index(drop=True)
    return out, np.array(out_g, dtype=object)


def load_zones():
    """Base zones with a label per polygon. Many state schools sit under a residential or rural zone with the
    school's name on the polygon (Bayswater School is Mixed Housing Urban); those polygons are institutional."""
    z = pyogrio.read_dataframe(RAW / 'unitary_plan_base_zone.gpkg', columns=['OBJECTID', 'ZONE_NAME', 'GROUPZONE_NAME', 'NAME'])
    name = z['NAME'].fillna('').str.strip()
    zn = z['ZONE_NAME'].fillna('')
    school = name.str.contains(SCHOOL_NAME) & ~zn.str.startswith(('Special Purpose', 'Coastal', 'Open Space', 'Road', 'Strategic', 'Water'))
    z['label'] = np.where(school, zn + ' (' + name + ')', z['ZONE_NAME'].astype(object))
    z['tenure'] = [('institutional' if sc else zone_tenure(n)) for sc, n in zip(school, z['ZONE_NAME'])]
    z['school'] = school.values
    attrs, g = gridded(z.geometry.values, pd.DataFrame(z.drop(columns='geometry')))
    return attrs, g


def zone_lookup(zones):
    """label -> (tenure, group zone, school flag), for labels chosen by area or by point."""
    d = zones.drop_duplicates('label')
    return {l: (t if isinstance(t, str) else None, g if isinstance(g, str) else None, bool(sc))
            for l, t, g, sc in zip(d.label, d.tenure, d.GROUPZONE_NAME, d.school) if isinstance(l, str)}


def extent_kind(group, desc):
    """Council extent row -> park, street, council_property (institutional), council_land (Council-owned, no class of its
    own: the zone decides, but it backs an Open Space zone) or None (third-party land, marae, wharves, unclassified)."""
    if isinstance(group, str):
        return 'park' if group in PARK_GROUPS else 'council_land'  # Active Cemetery, OYO Village
    d = re.sub(r'\s+', ' ', desc if isinstance(desc, str) else '').strip().upper()
    if d.startswith(('RESERVE - ROAD RESERVE', 'NOT A SITE - STREET CORRIDOR', 'NOT A SITE - STREETSCAPE')):
        return 'street'
    if d.startswith(('PARK -', 'RESERVE -')):
        return 'park'
    if d.startswith('PROPERTY - HOUSING FOR THE OLDER PEOPLE') or 'LANDFILL' in d or d.startswith(('NOT A SITE - WALKWAY', 'ACCESSWAY')):
        return 'council_land'  # Haumaru and own-your-own housing, closed landfills, walkways
    if d.startswith(THIRD_PARTY):
        return None
    if d.startswith('PROPERTY'):
        return 'council_property'  # community facilities, car parks, offices, depots, Panuku and vacant Council land
    return None


EXTENT_ORDER = ['park', 'conservation_land', 'street', 'council_property', 'council_land']


def load_parks():
    """Council park and property extents and DOC public conservation land, each row with a kind (EXTENT_ORDER)."""
    frames = []
    for key, name_col, group_col, desc_col in [('park_extent_public', 'SiteName', 'AssetGroup', 'TLA_AssetDes'),
                                               ('park_extents', 'DESCRIPTION', 'AssetGroup', None),
                                               ('doc_public_conservation_land', 'Name', 'Type', None)]:
        p = pyogrio.read_dataframe(RAW / f'{key}.gpkg', columns=[c for c in (group_col, name_col, desc_col) if c])
        kind = (['conservation_land'] * len(p) if key.startswith('doc') else
                [extent_kind(g, d) for g, d in zip(p[group_col], p[desc_col] if desc_col else [None] * len(p))])
        frames.append(pd.DataFrame({'park_name': p[name_col].values, 'asset_group': p[group_col].values, 'kind': kind,
                                    'geometry': p.geometry.values}))
    df = pd.concat(frames, ignore_index=True)
    df = df[df.kind.notna()].reset_index(drop=True)
    df['priority'] = df.kind.map({k: i for i, k in enumerate(EXTENT_ORDER)}).astype(float)
    attrs, g = gridded(df.geometry.values, df.drop(columns='geometry'))
    return attrs, g


def load_designations():
    """Unitary Plan designations: ministerial (Crown purpose land) and Auckland Council ones."""
    d = pyogrio.read_dataframe(RAW / 'designation.gpkg', columns=['SUBTYPE_NAME', 'NAME', 'SCHEDULE'])
    auth = d.SUBTYPE_NAME.fillna('')
    kind = np.where(auth.str.startswith(('Minister', 'Prime Minister')) & ~d.NAME.fillna('').str.contains(DESIGNATION_SKIP), 'ministerial',
                    np.where(auth == 'Auckland Council', 'council', None))
    d = d.assign(kind=kind)[kind != None].reset_index(drop=True)  # noqa: E711 (element-wise)
    attrs, g = gridded(d.geometry.values, pd.DataFrame(d.drop(columns='geometry')))
    return attrs, g


def load_osm(key):
    """Cached OSM golf course outlines or island road centrelines (EPSG:2193)."""
    g = np.asarray(pyogrio.read_dataframe(RAW / f'{key}.gpkg').geometry.values)
    bad = ~shapely.is_valid(g)
    g[bad] = shapely.make_valid(g[bad])
    return g


def point_in(polys, x, y, choose_area=None):
    """Index of the polygon containing each point (-1 if none); ties go to the smallest polygon."""
    shapely.prepare(polys)
    tree = shapely.STRtree(polys)
    out = np.full(len(x), -1, dtype=np.int64)
    step = 400_000
    for s in range(0, len(x), step):
        pts = shapely.points(x[s:s + step], y[s:s + step])
        pi, gi = tree.query(pts)
        hit = shapely.intersects(polys[gi], pts[pi])
        pi, gi = pi[hit], gi[hit]
        if choose_area is not None and len(pi):
            order = np.lexsort((choose_area[gi], pi))
            pi, gi = pi[order], gi[order]
        first = np.unique(pi, return_index=True)[1]
        out[s + pi[first]] = gi[first]
    return out


# ---------------------------------------------------------------- stage: points
def stage_points():
    """The map's point features plus the four service columns the export did not carry."""
    t = time.time()
    extra = TMP / 'services_extra.parquet'
    if not extra.exists():
        con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
        cur = con.execute('select tree_id,' + ','.join(EXTRA_FIELDS) + ' from tree_current_services_v5')
        schema = pa.schema([('tree_id', pa.string())] + [(f, pa.float64()) for f in EXTRA_FIELDS])
        n = 0
        with pq.ParquetWriter(extra, schema, compression='zstd') as wr:
            while rows := cur.fetchmany(250_000):
                cols = list(zip(*rows))
                wr.write_table(pa.table([pa.array(cols[0], pa.string())] +
                                        [pa.array([None if v is None or not math.isfinite(v) else round(v, 3) for v in c], pa.float64()) for c in cols[1:]],
                                        schema=schema))
                n += len(rows)
        con.close()
        log('services extra', n)
    con = duckdb.connect()
    con.execute("set threads=4; set memory_limit='3GB'")
    struct = 'STRUCT(' + ', '.join(f'{k} {v}' for k, v in POINT_FIELDS.items()) + ')'
    con.execute(f"""copy (
      select p.*, e.{', e.'.join(EXTRA_FIELDS)} from (
        select properties.*, geometry.coordinates[1] as lon, geometry.coordinates[2] as lat
        from read_json('{WEB / 'points.geojsonl'}', format='newline_delimited', maximum_object_size=1048576,
             columns={{'properties': '{struct}', 'geometry': 'STRUCT(coordinates DOUBLE[])'}})) p
      left join read_parquet('{extra}') e using (tree_id) order by p.tree_id
    ) to '{TMP / 'points.parquet'}' (format parquet, compression zstd)""")
    n, u = con.execute(f"select count(*), count(distinct tree_id) from read_parquet('{TMP / 'points.parquet'}')").fetchone()
    assert n == u, 'tree ids repeat in points.geojsonl'
    roles = dict(con.execute(f"select display_role, count(*) from read_parquet('{TMP / 'points.parquet'}') group by 1").fetchall())
    owners = dict(con.execute(f"select coalesce(owner_class,'(none)'), count(*) from read_parquet('{TMP / 'points.parquet'}') group by 1 order by 2 desc").fetchall())
    stats_update('points', {'features': n, 'display_roles': roles, 'owner_class': owners, 'seconds': round(time.time() - t)})
    log('points', n, roles)


# ---------------------------------------------------------------- stage: assign
def stage_assign():
    """Tenure of every parcel, then of every map point by the first rule with evidence."""
    parcels = parcel_tenure()
    point_tenure(parcels)


def parcel_tenure():
    """Tenure of each parcel by the first rule with evidence, each test by share of the parcel's area."""
    t = time.time()
    parcels, pg = load_parcels()
    zones, zg = load_zones()
    parks, kg = load_parks()
    desig, dg = load_designations()
    golf = load_osm('osm_golf_courses')
    stat_park, stat_public = statutory_flags()
    area = np.maximum(parcels.area_m2.values, 1e-9)

    def majority(polys, attrs_n):
        tree = shapely.STRtree(polys)
        pi, gi = tree.query(pg, predicate='intersects')
        a = np.zeros(len(pi))
        step = 200_000
        for s in range(0, len(pi), step):
            a[s:s + step] = shapely.area(shapely.intersection(pg[pi[s:s + step]], polys[gi[s:s + step]]))
        df = pd.DataFrame({'p': pi, 'k': attrs_n[gi], 'a': a})
        return df.groupby(['p', 'k'], as_index=False)['a'].sum().sort_values(['p', 'a'], ascending=[True, False])

    def shares(polys, attrs_n, keys):
        out = {k: np.zeros(len(pg)) for k in keys}
        for k, d in majority(polys, attrs_n).groupby('k'):
            out[k][d.p.values] = np.minimum(d.a.values / area[d.p.values], 1.0)  # overlapping extents can sum past the parcel
        return out

    zdf = majority(zg, zones.label.values)
    look = zone_lookup(zones)
    best = zdf.drop_duplicates('p')
    zone = np.full(len(pg), None, dtype=object); zone_share = np.zeros(len(pg))
    zone[best.p.values] = best.k.values
    zone_share[best.p.values] = best.a.values / area[best.p.values]
    share = shares(kg, parks.kind.values, EXTENT_ORDER)
    dshare = shares(dg, desig.kind.values, ['ministerial', 'council'])
    golf_share = shares(golf, np.zeros(len(golf), dtype=object), [0])[0]
    park_share = np.minimum(share['park'] + share['conservation_land'], 1.0)
    log('parcel overlays done', round(time.time() - t))

    icls = np.array([intent_class(v) for v in parcels.intent.values], dtype=object)
    ztn = np.array([look.get(z, (None,))[0] for z in zone], dtype=object)
    school = np.array([look.get(z, (None, None, False))[2] for z in zone])
    tenure = np.full(len(pg), 'unknown', dtype=object); basis = np.full(len(pg), 'no_evidence', dtype=object)
    todo = np.ones(len(pg), bool)

    def fire(mask, value, why):
        m = todo & mask
        tenure[m] = value if np.ndim(value) == 0 else value[m]
        basis[m] = why
        todo[m] = False

    open_space = ztn == 'park'
    fire(share['park'] >= 0.5, 'park', 'park_extent')
    fire(park_share >= 0.5, 'park', 'conservation_land')
    fire(share['street'] >= 0.5, 'street', 'council_road_reserve')
    fire(share['council_property'] >= 0.5, 'institutional', 'council_property')
    fire(dshare['ministerial'] >= 0.5, 'institutional', 'designation')
    # A golf club's course outside the Council park extents is private land, whatever reserve history or zone it has.
    fire((golf_share >= 0.5) & (share['park'] < PUBLIC_SIGNAL_SHARE) & (open_space | (ztn == 'private')), 'private', 'golf_course')
    # A reserve vesting, a statutory reserve or a railway parcel is stronger than a residential or business zone drawn over it.
    fire((ztn == 'private') & (icls == 'reserve'), 'park', 'parcel_intent')
    fire((ztn == 'private') & (icls == 'railway'), 'institutional', 'parcel_intent')
    fire(stat_park & ~np.isin(ztn.astype(str), ['street', 'institutional']), 'park', 'statutory_reserve')
    fire(school, 'institutional', 'zone_school_name')
    # An Open Space zone is park only with a sign of public ownership; otherwise it stays open, not public.
    public = ((share['park'] + share['conservation_land'] + share['street'] + share['council_property'] + share['council_land'] >= PUBLIC_SIGNAL_SHARE)
              | (dshare['council'] >= PUBLIC_SIGNAL_SHARE) | (icls == 'reserve') | stat_public)
    fire(open_space & public, 'park', 'open_space_zone_public')
    fire(open_space, 'unknown', 'open_space_zone_unconfirmed')
    fire(ztn != None, ztn, 'zone')  # noqa: E711 (element-wise)
    fire(icls == 'reserve', 'park', 'parcel_intent')
    fire(icls == 'railway', 'institutional', 'parcel_intent')
    fire((zone == 'Hauraki Gulf Islands') & (icls == 'title'), 'private', 'parcel_title_unzoned')
    fire(np.array([z is None for z in zone]), 'unknown', 'outside_plan_zones')

    # Narrow reserve strips along a road are berms in practice (Guiniven Reserve, Bayswater: a 280 m2 strip
    # of grass and palms between the kerb and the houses). They read as street, so their trees do too.
    perim = shapely.length(pg)
    width = 2 * parcels.area_m2.values / np.maximum(perim, 1e-9)
    strip = (tenure == 'park') | (basis == 'open_space_zone_unconfirmed')
    cand = np.where(strip & (parcels.area_m2.values < VERGE_MAX_AREA_M2) & (width < VERGE_MAX_WIDTH_M))[0]
    road = zg[zones.tenure.values == 'street']
    ci, ri = shapely.STRtree(road).query(pg[cand], predicate='dwithin', distance=VERGE_EDGE_M)
    edge = np.zeros(len(cand))
    for c_, g in pd.DataFrame({'c': ci, 'r': ri}).groupby('c'):
        near = shapely.buffer(shapely.union_all(road[g.r.values]), VERGE_EDGE_M)
        edge[c_] = shapely.length(shapely.intersection(shapely.boundary(pg[cand[c_]]), near)) / perim[cand[c_]]
    verge = cand[edge >= VERGE_MIN_ROAD_EDGE]
    tenure[verge] = 'street'; basis[verge] = 'verge_reserve'
    log('verge strips', len(verge), 'of', len(cand), 'narrow park or open space parcels')

    out = parcels.assign(intent_class=icls, zone=zone, zone_group=[look.get(z, (None, None))[1] for z in zone], zone_share=np.round(zone_share, 3),
                         park_share=np.round(park_share, 3), designation_share=np.round(dshare['ministerial'], 3), golf_share=np.round(golf_share, 3),
                         statutory_reserve=stat_park, tenure=tenure, tenure_basis=basis)
    c = shapely.centroid(pg)
    cx, cy = TO4326.transform(shapely.get_x(c), shapely.get_y(c))
    b = shapely.bounds(pg)
    w, s = TO4326.transform(b[:, 0], b[:, 1]); e, n = TO4326.transform(b[:, 2], b[:, 3])
    out = out.assign(lon=np.round(cx, 6), lat=np.round(cy, 6), w=np.round(w, 6), s=np.round(s, 6), e=np.round(e, 6), n=np.round(n, 6))
    out.to_parquet(TMP / 'parcels.parquet', index=False)
    stats_update('parcel_tenure', {'parcels': len(out), 'by_class': out.tenure.value_counts().to_dict(),
                                   'by_basis': out.tenure_basis.value_counts().to_dict(), 'verge_candidates': len(cand),
                                   'class_by_basis': {k: {b_: int(v) for b_, v in row.items() if v} for k, row in pd.crosstab(out.tenure, out.tenure_basis).iterrows()},
                                   'by_intent_class': out.intent_class.value_counts().to_dict(),
                                   'statutory_reserve_parcels': int(stat_park.sum()), 'statutory_public_parcels': int(stat_public.sum()),
                                   'open_space_zone_parcels': int(open_space.sum()), 'seconds': round(time.time() - t)})
    log('parcel tenure', out.tenure.value_counts().to_dict())
    return out


def point_tenure(parcels):
    """Every point in a parcel takes the parcel's class, except register trees on a road or park just over a boundary;
    points outside every parcel (roads, foreshore, island roads) are placed by extent, designation and zone."""
    t = time.time()
    pts = pd.read_parquet(TMP / 'points.parquet', columns=['tree_id', 'lon', 'lat', 'display_role', 'owner_class'])
    x, y = to2193(pts.lon.values, pts.lat.values)
    _, pg = load_parcels()
    ip = point_in(pg, x, y, choose_area=parcels.area_m2.values)
    log('parcels assigned', int((ip >= 0).sum()), 'of', len(ip))
    zones, zg = load_zones()
    iz = point_in(zg, x, y)
    parks, kg = load_parks()
    ik = point_in(kg, x, y, choose_area=parks.priority.values)  # park before conservation land before street ... where extents overlap
    log('zones', int((iz >= 0).sum()), 'extents', int((ik >= 0).sum()))
    # A parks register tree recorded just inside a private or institutional section belongs to the public land
    # beside it (Guiniven Avenue: a verge palm is placed 2 m inside the neighbouring section). The nearest road,
    # verge or park parcel within REGISTER_SNAP_M decides; beyond that the register stands.
    owner = pts.owner_class.values
    ptn_at = np.where(ip >= 0, parcels.tenure.values[np.maximum(ip, 0)], None)
    snap = np.where((owner == 'Auckland Council Parks') & np.isin(ptn_at.astype(str), ['private', 'institutional']))[0]
    reg_near = np.full(len(pts), None, dtype=object)
    if len(snap):
        pub = np.isin(parcels.tenure.values, ['street', 'park'])
        road = zones.tenure.values == 'street'
        public = np.concatenate([zg[road], pg[pub]])
        public_tn = np.concatenate([np.full(int(road.sum()), 'street', dtype=object), parcels.tenure.values[pub]])
        qi, gi = shapely.STRtree(public).query_nearest(shapely.points(x[snap], y[snap]), max_distance=REGISTER_SNAP_M, all_matches=False)
        reg_near[snap[qi]] = public_tn[gi]
    log('parks register trees in private sections', len(snap), 'next to public land', pd.Series(reg_near).value_counts().to_dict())
    del pg, zg, kg

    def strings(values):
        return np.array([v if isinstance(v, str) else None for v in values], dtype=object)

    zname = strings(np.where(iz >= 0, zones.label.values[np.maximum(iz, 0)], None))
    ztn = strings(np.where(iz >= 0, zones.tenure.values[np.maximum(iz, 0)], None))
    zschool = (iz >= 0) & zones.school.values[np.maximum(iz, 0)]
    in_parcel, in_extent = ip >= 0, ik >= 0
    ptn = strings(np.where(in_parcel, parcels.tenure.values[np.maximum(ip, 0)], None))
    pbasis = strings(np.where(in_parcel, parcels.tenure_basis.values[np.maximum(ip, 0)], None))
    kind = strings(np.where(in_extent, parks.kind.values[np.maximum(ik, 0)], None))
    hgi = zname == 'Hauraki Gulf Islands'

    # Designations, golf courses and island roads matter only off the parcels: in a parcel the parcel decides.
    off = np.where(~in_parcel)[0]
    desig, dg = load_designations()
    idg = point_in(dg, x[off], y[off])
    dkind = np.full(len(pts), None, dtype=object); dkind[off] = np.where(idg >= 0, desig.kind.values[np.maximum(idg, 0)], None)
    golf = np.zeros(len(pts), bool); golf[off] = point_in(load_osm('osm_golf_courses'), x[off], y[off]) >= 0
    isl = off[hgi[off]]
    near_road = np.zeros(len(pts), bool)
    if len(isl):
        qi, _ = shapely.STRtree(load_osm('osm_island_roads')).query(shapely.points(x[isl], y[isl]), predicate='dwithin', distance=ISLAND_ROAD_M)
        near_road[isl[np.unique(qi)]] = True

    tenure = np.full(len(pts), 'unknown', dtype=object)
    basis = np.full(len(pts), 'no_evidence', dtype=object)
    todo = np.ones(len(pts), bool)

    def fire(mask, value, why):
        m = todo & mask
        tenure[m] = value if np.ndim(value) == 0 else value[m]
        basis[m] = why if np.ndim(why) == 0 else why[m]
        todo[m] = False

    fire(owner == 'Auckland Transport', 'street', 'owner_register')
    fire(pbasis == 'verge_reserve', 'street', 'verge_reserve')
    fire(~in_parcel & (ztn == 'street'), 'street', 'road_corridor')  # outside every parcel and zoned road
    # The parks register also holds street trees, so location decides first; elsewhere the register means park.
    fire(reg_near != None, reg_near, 'register_boundary')  # noqa: E711 (element-wise)
    fire(owner == 'Auckland Council Parks', 'park', 'owner_register')
    fire(in_parcel, ptn, pbasis)  # one title, one class: the parcel's
    fire(kind == 'park', 'park', 'park_extent')
    fire(kind == 'conservation_land', 'park', 'conservation_land')
    fire(kind == 'street', 'street', 'council_road_reserve')
    fire(kind == 'council_property', 'institutional', 'council_property')
    fire(dkind == 'ministerial', 'institutional', 'designation')
    fire(golf & ((ztn == 'park') | (ztn == 'private')), 'private', 'golf_course')
    fire(hgi & near_road, 'street', 'island_road')  # within 10 m of an island road centreline, outside every parcel
    fire(zschool, 'institutional', 'zone_school_name')
    fire((ztn == 'park') & ((kind == 'council_land') | (dkind == 'council')), 'park', 'open_space_zone_public')
    fire(ztn == 'park', 'unknown', 'open_space_zone_unconfirmed')
    fire(ztn != None, ztn, 'zone')  # noqa: E711 (element-wise)
    fire(hgi, 'unknown', 'unparcelled_unzoned')  # foreshore or stream on the islands, away from any road
    fire(iz < 0, 'unknown', 'outside_plan_zones')  # beyond the Unitary Plan maps: the parcel layer runs into Kaipara and Waikato

    out = pd.DataFrame({'tree_id': pts.tree_id.values, 'tenure': tenure, 'tenure_basis': basis,
                        'parcel_id': np.where(in_parcel, parcels.pid.values[np.maximum(ip, 0)], None)})
    register = np.isin(basis, ['owner_register', 'register_boundary'])
    assert (tenure[in_parcel & ~register] == ptn[in_parcel & ~register]).all(), 'a non-register point differs from its parcel'
    out.to_parquet(DATA / 'tenure.parquet', index=False, compression='zstd')
    side = pd.DataFrame({'x': x, 'y': y, 'zone': zname, 'zone_tenure': ztn, 'parcel_ix': ip, 'park_ix': ik,
                         'park_name': np.where(in_extent, parks.park_name.values[np.maximum(ik, 0)], None)})
    side.to_parquet(TMP / 'points_assign.parquet', index=False)

    counted = pts.display_role.values != NOT_COUNTED_ROLE
    ct = pd.crosstab(out.tenure, out.tenure_basis)
    stats_update('tenure', {
        'by_class': out.tenure.value_counts().to_dict(),
        'by_class_counted': out.tenure[counted].value_counts().to_dict(),
        'by_basis': out.tenure_basis.value_counts().to_dict(),
        'class_by_basis': {k: {b: int(v) for b, v in row.items() if v} for k, row in ct.iterrows()},
        'by_display_role': {k: g.value_counts().to_dict() for k, g in out.tenure.groupby(pts.display_role.values)},
        'outside_parcels': int((~in_parcel).sum()), 'outside_parcels_by_zone_tenure': pd.Series(ztn[~in_parcel]).fillna('none').value_counts().to_dict(),
        'outside_parcels_by_basis': pd.Series(basis[~in_parcel]).value_counts().to_dict(),
        'register_points_differing_from_parcel': int((in_parcel & register & (tenure != ptn)).sum()),
        'inside_extent_or_conservation_land': int(in_extent.sum()), 'zone_found': int((iz >= 0).sum()),
        'seconds': round(time.time() - t)})
    log('tenure', out.tenure.value_counts().to_dict())


# ---------------------------------------------------------------- stage: canopy
def stage_canopy():
    """Area of every map crown over every parcel it touches, streamed from crowns.geojsonl."""
    t = time.time()
    parcels, pg = load_parcels()
    shapely.prepare(pg)
    tree = shapely.STRtree(pg)
    writer = None
    seen = collections.Counter()
    overlap = {'pairs': 0, 'area_m2': 0.0, 'crown_area_m2': 0.0}
    ids, roles, texts = [], [], []

    def flush():
        nonlocal writer
        if not ids:
            return
        g = reproject(shapely.from_geojson(texts), TO2193)
        bad = ~shapely.is_valid(g)
        if bad.any():
            g[bad] = shapely.make_valid(g[bad])
        area = shapely.area(g)
        counted = np.array([r != NOT_COUNTED_ROLE for r in roles])
        # Crowns of one batch are neighbours in the export order; their mutual overlap measures double counting.
        cg = g[counted]
        if len(cg):
            a, b = shapely.STRtree(cg).query(cg, predicate='overlaps')
            keep = a < b
            if keep.any():
                overlap['pairs'] += int(keep.sum())
                overlap['area_m2'] += float(shapely.area(shapely.intersection(cg[a[keep]], cg[b[keep]])).sum())
            overlap['crown_area_m2'] += float(area[counted].sum())
        ci, pi = tree.query(g)
        inside = shapely.contains_properly(pg[pi], g[ci])
        hit = inside | shapely.intersects(pg[pi], g[ci])
        ci, pi, inside = ci[hit], pi[hit], inside[hit]
        part = area[ci].copy()
        cut = ~inside
        if cut.any():
            part[cut] = shapely.area(shapely.intersection(g[ci[cut]], pg[pi[cut]]))
        tab = pa.table({'tree_id': pa.array([ids[i] for i in ci]), 'parcel_ix': pa.array(pi, pa.int32()),
                        'area_m2': pa.array(part), 'crown_area_m2': pa.array(area[ci]), 'counted': pa.array(counted[ci])})
        # Crowns over no parcel at all (road, foreshore) still count toward the unassigned canopy.
        none = np.setdiff1d(np.arange(len(g)), ci)
        if len(none):
            tab = pa.concat_tables([tab, pa.table({'tree_id': pa.array([ids[i] for i in none]), 'parcel_ix': pa.array(np.full(len(none), -1), pa.int32()),
                                                   'area_m2': pa.array(np.zeros(len(none))), 'crown_area_m2': pa.array(area[none]), 'counted': pa.array(counted[none])})])
        if writer is None:
            writer = pq.ParquetWriter(TMP / 'canopy_pairs.parquet', tab.schema, compression='zstd')
        writer.write_table(tab)
        ids.clear(); roles.clear(); texts.clear()

    with open(WEB / 'crowns.geojsonl', encoding='utf-8') as fh:
        for n, line in enumerate(fh, 1):
            i = line.index('"tree_id":"') + 11
            j = line.index('"display_role":"') + 16
            k = line.rindex(',"geometry":') + 12
            ids.append(line[i:line.index('"', i)])
            role = line[j:line.index('"', j)]
            roles.append(role); seen[role] += 1
            texts.append(line[k:line.rstrip().rindex('}')])
            if len(ids) == 40_000:
                flush()
            if n % 400_000 == 0:
                log('crowns', n, round(time.time() - t))
    flush()
    writer.close()
    stats_update('canopy', {'crowns': sum(seen.values()), 'crowns_by_display_role': dict(seen), 'within_batch_overlap': overlap,
                            'seconds': round(time.time() - t)})
    log('canopy done', dict(seen), overlap)


# ---------------------------------------------------------------- stage: summaries
def stage_summaries():
    """Per-parcel records in 65,536 static buckets, plus a reconciliation against the release totals."""
    t = time.time()
    P = pd.read_parquet(TMP / 'parcels.parquet')
    cols = ['tree_id', 'display_role', 'evidence_tier', 'species_common', 'crown_max_chm_m', 'crown_area_m2', *VALUE_FIELDS]
    pts = pd.read_parquet(TMP / 'points.parquet', columns=cols)
    for k in ['display_role', 'evidence_tier', 'species_common']:
        pts[k] = pts[k].astype('category')
    ten = pd.read_parquet(DATA / 'tenure.parquet', columns=['tree_id', 'tenure', 'tenure_basis', 'parcel_id'])
    side = pd.read_parquet(TMP / 'points_assign.parquet', columns=['x', 'y', 'parcel_ix'])
    assert (pts.tree_id.values == ten.tree_id.values).all()
    pts['tenure'] = ten.tenure.astype('category').values
    # A register street or park tree whose point sits a metre inside a section (AT positions cluster on the
    # boundary) belongs to the street or park, not to the section: it is listed as a street tree there.
    pix_all = side.parcel_ix.values
    ptn = np.where(pix_all >= 0, P.tenure.values[np.maximum(pix_all, 0)], None)
    register_elsewhere = np.isin(ten.tenure_basis.values, ['owner_register', 'register_boundary']) & (pix_all >= 0) & (ten.tenure.values != ptn)
    pts['parcel_ix'] = np.where(register_elsewhere, -1, pix_all)
    ten['in_property'] = pts.parcel_ix.values >= 0
    # One title, one class: every tree summed into a parcel carries that parcel's tenure.
    assert (ten.tenure.values[ten.in_property.values] == ptn[ten.in_property.values]).all(), 'a parcel holds trees of another tenure'
    ten.to_parquet(DATA / 'tenure.parquet', index=False, compression='zstd')
    log('register trees inside a parcel of another tenure, kept out of its figures', int(register_elsewhere.sum()))
    pts['counted'] = (pts.display_role != NOT_COUNTED_ROLE).values
    pts['confident'] = ~pts.evidence_tier.astype(object).fillna('recorded').isin(UNCERTAIN_TIERS).values
    x, y = side.x.values, side.y.values
    del ten, side
    nP = len(P)

    # Canopy per parcel from counted crowns: all crowns, and those rooted in the parcel itself.
    cp = pd.read_parquet(TMP / 'canopy_pairs.parquet')
    cp = cp[cp.counted.values]
    canopy_total = float(cp.drop_duplicates('tree_id').crown_area_m2.sum())
    root = pd.Series(pts.parcel_ix.values, index=pts.tree_id.values)
    on = cp[cp.parcel_ix.values >= 0]
    own = root.reindex(on.tree_id.values).values == on.parcel_ix.values
    canopy = np.bincount(on.parcel_ix.values, weights=on.area_m2.values, minlength=nP)
    canopy_own = np.bincount(on.parcel_ix.values[own], weights=on.area_m2.values[own], minlength=nP)
    canopy_on_parcels = float(on.area_m2.sum())
    del cp, on, root, own

    c = pts.counted.values
    inp = c & (pts.parcel_ix.values >= 0)
    pix = pts.parcel_ix.values
    n_trees = np.bincount(pix[inp], minlength=nP)
    n_conf = np.bincount(pix[inp & pts.confident.values], minlength=nP)
    n_earlier = np.bincount(pix[~c & (pix >= 0)], minlength=nP)
    sums = {f: np.bincount(pix[inp], weights=np.nan_to_num(pts[f].values[inp].astype(float)), minlength=nP) for f in VALUE_FIELDS}
    conf_value = np.bincount(pix[inp & pts.confident.values], weights=np.nan_to_num(pts.total_value_nzd_y.values[inp & pts.confident.values].astype(float)), minlength=nP)

    # Street trees on the road reserve near each boundary: listed, never added to the property.
    _, pg = load_parcels()
    srow = np.where(c & (pts.tenure.values == 'street'))[0]
    sp = shapely.points(x[srow], y[srow])
    si, pj = shapely.STRtree(pg).query(sp, predicate='dwithin', distance=STREET_REACH_M)
    keep = pix[srow[si]] != pj
    si, pj = si[keep], pj[keep]
    dist = np.round(shapely.distance(pg[pj], sp[si]), 1)
    del pg, sp
    near_rows = srow[si]
    order = np.lexsort((near_rows, dist, pj))
    near_p, near_rows, near_d = pj[order], near_rows[order], dist[order]
    n_street = np.bincount(near_p, minlength=nP)
    street_value = np.bincount(near_p, weights=np.nan_to_num(pts.total_value_nzd_y.values[near_rows].astype(float)), minlength=nP)
    log('street trees near boundaries', len(near_p), 'pairs for', int((n_street > 0).sum()), 'parcels')

    has = (n_trees > 0) | (canopy > 0) | (n_street > 0) | (n_earlier > 0)
    # Trees per parcel, highest value first, as contiguous slices.
    rows_in = np.where(inp)[0]
    val = np.nan_to_num(pts.total_value_nzd_y.values[rows_in].astype(float), nan=-1.0)
    order = np.lexsort((pts.tree_id.values[rows_in], -val, pix[rows_in]))
    rows_in = rows_in[order]
    tree_start = np.searchsorted(pix[rows_in], np.arange(nP + 1))
    street_start = np.searchsorted(near_p, np.arange(nP + 1))
    tid = pts.tree_id.values; tv = pts.total_value_nzd_y.values; th = pts.crown_max_chm_m.values
    spc = pts.species_common.astype(object).values; tier = pts.evidence_tier.astype(object).values
    ttn = pts.tenure.astype(object).values; tca = pts.crown_area_m2.values

    def species(v):
        return v if isinstance(v, str) and v and v != 'Species not recorded' else None

    fields = ['pid', 'area_m2', 'intent', 'intent_class', 'tenure', 'tenure_basis', 'zone', 'lon', 'lat', 'bbox',
              'n_trees', 'n_confident', 'n_uncertain', 'n_earlier_not_counted', 'canopy_m2', 'canopy_cover_pct', 'canopy_own_m2',
              'canopy_overhang_m2', *VALUE_FIELDS, 'total_value_confident_nzd_y', 'tallest_m', 'tallest_tree_id',
              'trees_listed', 'trees_truncated', 'n_street_nearby', 'street_nearby_value_nzd_y', 'street_nearby_truncated']
    tree_fields = ['tree_id', 'total_value_nzd_y', 'height_m', 'species_common', 'evidence_tier', 'tenure', 'crown_area_m2']
    street_fields = ['tree_id', 'distance_m', 'total_value_nzd_y', 'height_m', 'species_common', 'evidence_tier']
    buckets = collections.defaultdict(dict)
    nt_tile = np.zeros(nP, int); cc_tile = np.zeros(nP); v_tile = np.zeros(nP, int)
    Pv = {k: P[k].values for k in P.columns}
    for ix in np.where(has)[0]:
        rws = rows_in[tree_start[ix]:tree_start[ix + 1]]
        trees = [[tid[j], r(tv[j], 2), r(th[j], 1), species(spc[j]), tier[j], ttn[j], r(tca[j], 1)] for j in rws[:TREE_CAP]]
        tallest_id, tallest = None, None
        if len(rws):
            hh = th[rws].astype(float)
            if np.isfinite(hh).any():
                k = int(np.nanargmax(hh)); tallest_id, tallest = tid[rws[k]], hh[k]
        sl = slice(street_start[ix], street_start[ix + 1])
        streets = [[tid[j], float(d), r(tv[j], 2), r(th[j], 1), species(spc[j]), tier[j]] for j, d in zip(near_rows[sl][:STREET_CAP], near_d[sl][:STREET_CAP])]
        area = float(Pv['area_m2'][ix])
        cov = min(100.0, 100.0 * canopy[ix] / area) if area > 0 else None
        pid = Pv['pid'][ix]
        rec = [pid, r(area, 1), text(Pv['intent'][ix]), Pv['intent_class'][ix], Pv['tenure'][ix], Pv['tenure_basis'][ix], text(Pv['zone'][ix]),
               float(Pv['lon'][ix]), float(Pv['lat'][ix]), [float(Pv[k][ix]) for k in ('w', 's', 'e', 'n')],
               int(n_trees[ix]), int(n_conf[ix]), int(n_trees[ix] - n_conf[ix]), int(n_earlier[ix]), r(canopy[ix], 1), r(cov, 1),
               r(canopy_own[ix], 1), r(max(0.0, canopy[ix] - canopy_own[ix]), 1), *[r(sums[f][ix], 3) for f in VALUE_FIELDS],
               r(conf_value[ix], 3), r(tallest, 1), tallest_id, len(trees), int(len(rws) > TREE_CAP),
               int(n_street[ix]), r(street_value[ix], 2), int(n_street[ix] > STREET_CAP)]
        obj = {'property': rec}
        if trees:
            obj['trees'] = trees
        if streets:
            obj['street_trees'] = streets
        buckets[bucket_path(pid)][pid] = obj
        nt_tile[ix] = n_conf[ix]; cc_tile[ix] = r(cov, 1) or 0.0; v_tile[ix] = int(round(sums['total_value_nzd_y'][ix]))
    log('records built', int(has.sum()), round(time.time() - t))

    out = DATA / 'property_details'
    files = []
    for path, recs in sorted(buckets.items()):
        f = out / path
        f.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(recs, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')
        f.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
        files.append((path, f.stat().st_size, len(recs)))
    pd.DataFrame({'parcel_ix': np.arange(nP), 'nt': nt_tile, 'cc': cc_tile, 'v': v_tile}).to_parquet(TMP / 'parcel_tile_values.parquet', index=False)

    # Reconciliation: every counted tree lands in exactly one parcel or in the unassigned remainder.
    release = json.loads((WEB / 'totals.json').read_text())['totals']
    un = c & (pix < 0)
    recon = {}
    for key, field in [('trees', None), ('totalValueNzdY', 'total_value_nzd_y'), ('runoffM3Y', 'avoided_runoff_m3_y'), ('carbonTco2e', 'stored_co2e_tonnes_est')]:
        par = float(n_trees.sum()) if field is None else float(sums[field].sum())
        una = float(un.sum()) if field is None else float(np.nansum(pts[field].values[un].astype(float)))
        recon[key] = {'parcels': par, 'unassigned': una, 'sum': par + una, 'release': release[key], 'difference': par + una - release[key]}
    for f in VALUE_FIELDS:
        recon[f] = {'parcels': float(sums[f].sum()), 'unassigned': float(np.nansum(pts[f].values[un].astype(float))),
                    'all_counted': float(np.nansum(pts[f].values[c].astype(float)))}
    ub = pd.DataFrame({'tenure': pts.tenure.astype(object).values[un], 'v': pts.total_value_nzd_y.values[un]})
    unassigned_by = ub.groupby('tenure').agg(n=('v', 'size'), value=('v', 'sum')).reset_index().to_dict('records')
    sizes = np.array([b for _, b, _ in files])
    stats_update('summaries', {'parcel_records': int(has.sum()), 'parcels_with_trees': int((n_trees > 0).sum()),
                               'parcels_with_canopy': int((canopy > 0).sum()),
                               'parcels_with_trees_or_canopy': int(((n_trees > 0) | (canopy > 0)).sum()),
                               'parcels_street_or_earlier_only': int((has & (n_trees == 0) & (canopy == 0)).sum()),
                               'buckets': len(files), 'bucket_bytes': {'total': int(sizes.sum()), 'median': int(np.median(sizes)), 'max': int(sizes.max())},
                               'truncated_tree_lists': int((n_trees > TREE_CAP).sum()), 'reconciliation': recon, 'unassigned_by_tenure': unassigned_by,
                               'canopy': {'counted_crown_area_m2': canopy_total, 'over_parcels_m2': canopy_on_parcels,
                                          'parcels_cover_capped_at_100': int((canopy > P.area_m2.values + 0.5).sum())},
                               'street_nearby_pairs': int(len(near_p)), 'register_trees_kept_out_of_parcels': int(register_elsewhere.sum()),
                               'register_trees_kept_out_value_nzd_y': float(np.nansum(pts.total_value_nzd_y.values[register_elsewhere & c].astype(float))),
                               'seconds': round(time.time() - t)})
    write_schema(fields, tree_fields, street_fields, int(has.sum()), files)
    log('summaries written', int(has.sum()), 'buckets', len(files), recon['trees'], recon['totalValueNzdY'])


def write_schema(fields, tree_fields, street_fields, records, files):
    units = {'area_m2': 'm²', 'lon': 'degrees (WGS84)', 'lat': 'degrees (WGS84)', 'bbox': '[west, south, east, north] degrees (WGS84)',
             'canopy_m2': 'm²', 'canopy_cover_pct': '% of parcel area', 'canopy_own_m2': 'm²', 'canopy_overhang_m2': 'm²',
             'total_value_nzd_y': 'NZ$/year', 'total_value_nzd_y_low': 'NZ$/year', 'total_value_nzd_y_high': 'NZ$/year',
             'stormwater_value_nzd_y': 'NZ$/year', 'avoided_runoff_m3_y': 'm³/year', 'intercepted_rainfall_m3_y': 'm³/year',
             'stored_co2e_tonnes_est': 't CO₂e', 'annual_sequestration_tco2e_y_est': 't CO₂e/year', 'carbon_value_nzd_y': 'NZ$/year',
             'cooling_value_nzd_y': 'NZ$/year', 'pm25_removed_kg_y': 'kg/year', 'air_quality_value_nzd_y': 'NZ$/year',
             'total_value_confident_nzd_y': 'NZ$/year', 'tallest_m': 'm', 'street_nearby_value_nzd_y': 'NZ$/year',
             'height_m': 'm', 'crown_area_m2': 'm²', 'distance_m': 'm'}
    notes = {
        'pid': 'LINZ primary parcel id (persistent across LINZ updates).',
        'intent': 'LINZ parcel_intent as recorded. DCDB means a legacy parcel whose intent was never captured.',
        'intent_class': 'title, reserve, railway or other, from parcel_intent (DCDB, Fee Simple Title, Maori, Strata, Lease count as title).',
        'tenure': 'Inferred class of the land: street, park, institutional, private, other or unknown. Not an ownership record.',
        'tenure_basis': 'Rule that set the parcel tenure (first with evidence, by share of the parcel area): park_extent (Council park extents cover at least half), conservation_land (park extents and DOC public conservation land together cover at least half), council_road_reserve (Council extents describing road reserve or street corridor cover at least half), council_property (Council-held non-park property such as community facilities and car parks covers at least half), designation (a ministerial designation such as Defence, Education, Corrections, Police or Courts covers at least half), golf_course (an OpenStreetMap golf course outside the Council park extents covers at least half), parcel_intent (reserve vesting or railway parcel under a residential, business or rural zone, or with no zone), statutory_reserve (LINZ statutory actions declare or vest a recreation, scenic, historic, nature, scientific or esplanade reserve or domain), zone_school_name (the zone covering most of the parcel is a residential or rural polygon named for a school), open_space_zone_public (Open Space or Green Infrastructure Corridor zone with a public-ownership signal: a park, property or conservation extent over a fifth of it, an Auckland Council designation, reserve intent or a statutory reserve or road vesting), open_space_zone_unconfirmed (Open Space zone with none of those signals: tenure unknown, not counted as public), zone (Unitary Plan base zone covering most of the parcel), verge_reserve (narrow reserve or open space strip along a road, classed street), parcel_title_unzoned (titled land in the Hauraki Gulf Islands zone, which the Unitary Plan leaves to its own plan), outside_plan_zones (no Unitary Plan zone: beyond the Auckland boundary), no_evidence.',
        'zone': 'Unitary Plan base zone covering the largest share of the parcel; a school name in brackets when the zone polygon carries one.',
        'lon': 'Parcel centroid (may fall outside an irregular parcel).',
        'n_trees': 'Map trees whose point lies in the parcel, counted with the release rule (every display role except earlier_detection). Auckland Transport or Council parks register trees whose point falls inside a parcel of another tenure (typically within a metre of the boundary) are not counted here; street-tenure ones are listed in street_trees at distance 0.',
        'n_confident': 'Counted trees whose evidence tier is not in the map\'s uncertain list.',
        'n_uncertain': 'Counted trees with tier location_unverified, possible, unverified or possible_duplicate. Included in the sums, as in the release totals.',
        'n_earlier_not_counted': 'Earlier detections without a unique v5 crown in the parcel. Shown on the map only on request; never counted or valued.',
        'canopy_m2': 'Area of counted map crowns over the parcel, including crowns of trees rooted next door or on the street. Lower vegetation (near-canopy layer) is excluded.',
        'canopy_own_m2': 'Part of canopy_m2 from trees whose point lies in the parcel.',
        'canopy_overhang_m2': 'Part of canopy_m2 from trees rooted outside the parcel.',
        'total_value_confident_nzd_y': 'total_value_nzd_y restricted to the confident trees.',
        'tallest_m': 'Highest crown top (LiDAR canopy height maximum) among the counted trees in the parcel.',
        'trees_listed': 'Rows in the trees dataset (capped at 300, highest value first).',
        'trees_truncated': '1 when the parcel has more than 300 counted trees.',
        'n_street_nearby': 'Street-tenure trees not counted in this parcel whose point is within 10 m of its boundary (distance 0: a register street tree positioned just inside the boundary). Never added to the property figures.',
        'street_nearby_value_nzd_y': 'Sum of their annual value. Shown separately; never added to the property figures.',
    }
    schema = {
        'version': 1, 'generated_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'records': records,
        'bucket_algorithm': 'fnv1a_utf8_mod65536_hex4_split2',
        'bucket_note': 'FNV-1a (32-bit, UTF-8 bytes) of the pid string, mod 65536, four hex digits as {hh}/{hh}.json.gz; same as tree_details v2.',
        'record_layout': 'Each bucket maps pid -> {dataset key: values}; values follow the dataset field order. Multiple datasets hold a list of rows.',
        'datasets': [
            {'key': 'property', 'title': 'Property summary', 'multiple': False, 'fields': fields},
            {'key': 'trees', 'title': 'Trees on this property', 'multiple': True, 'fields': tree_fields,
             'note': 'Counted trees whose point lies in the parcel, highest annual value first, at most 300. height_m is the LiDAR crown top. species_common is empty when no species was recorded.'},
            {'key': 'street_trees', 'title': 'Street trees outside your boundary', 'multiple': True, 'fields': street_fields,
             'note': 'Street-tenure trees within 10 m of the boundary and not counted in this parcel, nearest first, at most 50. Never added to the property figures.'},
        ],
        'units': units, 'field_notes': notes,
        'counting_rule': 'A tree counts when its display_role is not earlier_detection, exactly as the release totals in web_build/totals.json (export_web_v5.py). Every counted tree belongs to one parcel by point-in-polygon or to none (roads, foreshore). Sum over all parcels plus the unassigned remainder equals the release totals.',
        'tenure_rules': [
            'Parcels first. Each parcel takes the first rule with evidence (see field_notes.tenure_basis), then narrow park or open space strips along a road become street (verge_reserve).',
            'Every map feature inside a parcel takes that parcel\'s tenure and tenure_basis, so one title never holds two classes. The exceptions are register trees: Auckland Transport register trees are street (owner_register); an Auckland Council Parks register tree inside a private or institutional parcel takes the class of the nearest road zone, verge strip or park parcel within 5 m (register_boundary), and otherwise is park (owner_register). A register tree whose class differs from its parcel\'s is not counted in that parcel (see n_trees).',
            'Features outside every LINZ parcel (road corridors, foreshore, island roads) take, in order: road_corridor (Road or Strategic Transport Corridor zone: street), park_extent, conservation_land, council_road_reserve, council_property, designation (ministerial), golf_course, island_road (Hauraki Gulf Islands zone within 10 m of an OpenStreetMap road centreline: street), zone_school_name, open_space_zone_public (Open Space zone under Council-owned land or an Auckland Council designation), open_space_zone_unconfirmed, zone, unparcelled_unzoned (island foreshore or stream: unknown), outside_plan_zones (unknown).',
            'Classes for a public/private filter: street, park and institutional are public land; private is private; other (coastal and water zones) and unknown (including open_space_zone_unconfirmed) are neither.'],
        'caveats': [
            'Tenure is inferred from zoning, designations, park extents and parcel records, not from ownership records. Council-owned housing sits in residential zones, some schools are private, Crown land can be zoned for any use, and an Open Space zone without a public-ownership signal is left unknown because private golf courses and bush are zoned that way too.',
            'Tree points come from the Council and Auckland Transport registers and from LiDAR crown peaks. A LiDAR point is the crown top, which for a leaning or boundary tree can sit over the neighbouring section, so a tree near a boundary may be listed on the wrong side. Register trees inside a parcel of another tenure are kept out of that parcel (see n_trees).',
            'Values are the release\'s modelled per-tree estimates (i-Tree style stormwater, carbon, cooling and air quality) summed per parcel. They are indicative, not a valuation of the property, and include trees whose evidence tier is uncertain, as the release totals do.',
            'Canopy counts the map crowns only. Hedges and lower vegetation in the near-canopy layer are not included, so cover is a floor for woody canopy.',
            'Cross-lease and unit-title properties share one parcel; every address on such a parcel shows the same trees.',
        ],
        'sources': [
            {'name': 'ALTO v5 release map features (web_build/points.geojsonl, crowns.geojsonl) and v5 services table', 'licence': 'CC BY-NC 4.0 (ALTO data)'},
            {'name': 'LINZ NZ Primary Parcels', 'url': 'https://data.linz.govt.nz/layer/50823', 'licence': 'CC BY 4.0', 'attribution': 'Sourced from LINZ. CC BY 4.0.'},
            {'name': 'Auckland Council Unitary Plan Base Zone', 'url': f'{"https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services"}/Unitary_Plan_Base_Zone/FeatureServer/0', 'licence': 'CC BY 4.0', 'attribution': 'Auckland Council, CC BY 4.0.'},
            {'name': 'Auckland Council park and property extents (ParkExtentPublic, Park_Extents)', 'licence': 'CC BY 4.0', 'attribution': 'Auckland Council, CC BY 4.0.'},
            {'name': 'Auckland Council Unitary Plan Designation', 'url': 'https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/Designation/FeatureServer/0', 'licence': 'CC BY 4.0', 'attribution': 'Auckland Council, CC BY 4.0.'},
            {'name': 'OpenStreetMap golf courses (leisure=golf_course) and Hauraki Gulf island road centrelines', 'licence': 'ODbL 1.0', 'attribution': '© OpenStreetMap contributors, ODbL.'},
            {'name': 'DOC Public Conservation Land', 'url': 'https://services1.arcgis.com/3JjYDyG3oajxU6HO/arcgis/rest/services/DOC_Public_Conservation_Land/FeatureServer/0', 'licence': 'CC BY 4.0', 'attribution': 'Department of Conservation, CC BY 4.0.'},
        ],
        'privacy': 'No owner names, titles, appellations or statutory action text are included. Parcels are identified by their LINZ parcel id only.',
    }
    (DATA / 'property_details' / 'schema.json').write_text(json.dumps(schema, indent=1, ensure_ascii=False))
    (DATA / 'property_details' / '.htaccess').write_text(GZ_JSON_HTACCESS)
    manifest = {'bucket_algorithm': schema['bucket_algorithm'], 'records': records,
                'files': [{'path': f'property_details/{p}', 'bytes': b, 'records': n} for p, b, n in sorted(files)]}
    (DATA / 'property_details_manifest.json').write_text(json.dumps(manifest, indent=1))


# ---------------------------------------------------------------- stage: tiles
def stage_tiles():
    """Parcel polygons for the map, z14 to z18, with the few properties a style or click needs.

    Parcels beyond the Unitary Plan maps (the LINZ extract runs into Kaipara and Waikato districts) are
    left out unless a map tree or crown touches them."""
    t = time.time()
    P = pd.read_parquet(TMP / 'parcels.parquet', columns=['pid', 'tenure', 'tenure_basis'])
    vals = pd.read_parquet(TMP / 'parcel_tile_values.parquet').set_index('parcel_ix').reindex(range(len(P))).fillna(0)
    nt, cc, v = vals.nt.astype(int).values, vals.cc.values, vals.v.astype(int).values
    keep = (P.tenure_basis.values != 'outside_plan_zones') | (nt > 0) | (cc > 0) | (v > 0)
    _, pg = load_parcels()
    idx = np.where(keep)[0]
    g4 = reproject(pg[idx], TO4326)
    src = TMP / 'properties.geojsonl'
    with src.open('w') as fh:
        for i, geo in zip(idx, shapely.to_geojson(g4)):
            props = {'pid': P.pid.values[i], 'tn': P.tenure.values[i], 'nt': int(nt[i]), 'cc': round(float(cc[i]), 1), 'v': int(v[i])}
            fh.write('{"type":"Feature","properties":' + json.dumps(props, separators=(',', ':')) + ',"geometry":' + geo + '}\n')
    out = W / 'tiles/properties.pmtiles'
    cmd = ['/opt/homebrew/bin/tippecanoe', '--force', '-P', '--quiet', '-t', str(TMP), '--layer=properties',
           '--minimum-zoom=14', '--maximum-zoom=18', '--detect-shared-borders', '--no-tiny-polygon-reduction',
           '--no-feature-limit', '--no-tile-size-limit', '--name=properties',
           '--description=ALTO property parcels: inferred tenure, confident tree count, canopy cover and annual tree value per LINZ primary parcel.',
           '--attribution=Parcels: LINZ NZ Primary Parcels, CC BY 4.0. Tenure inferred from Auckland Council Unitary Plan zones, designations and park extents and DOC conservation land, CC BY 4.0, and OpenStreetMap golf courses and roads, © OpenStreetMap contributors, ODbL.',
           '-o', str(out), str(src)]
    with (W / 'logs/tiles_properties.log').open('w') as lf:
        p = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, env={**os.environ, 'TIPPECANOE_MAX_THREADS': '6'})
    assert p.returncode == 0, 'tippecanoe failed; see logs/tiles_properties.log'
    stats_update('tiles', {'features': int(keep.sum()), 'left_out_outside_plan_zones': int((~keep).sum()), 'bytes': out.stat().st_size,
                           'zooms': '14-18', 'seconds': round(time.time() - t)})
    log('tiles', int(keep.sum()), out.stat().st_size)


# ---------------------------------------------------------------- stage: addresses
ABBREV = {'ave': 'avenue', 'av': 'avenue', 'st': 'street', 'rd': 'road', 'dr': 'drive', 'drv': 'drive', 'cres': 'crescent', 'cr': 'crescent',
          'crs': 'crescent', 'pl': 'place', 'tce': 'terrace', 'terr': 'terrace', 'hwy': 'highway', 'ln': 'lane', 'ct': 'court', 'cl': 'close',
          'gr': 'grove', 'gro': 'grove', 'pde': 'parade', 'esp': 'esplanade', 'sq': 'square', 'blvd': 'boulevard', 'hts': 'heights',
          'mews': 'mews', 'wy': 'way', 'rise': 'rise', 'cir': 'circle', 'crt': 'court'}
LEADING = {'st': 'saint', 'mt': 'mount', 'pt': 'point'}


def norm_text(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"[’'`]", '', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def norm_street(s):
    """Lower case, macrons and punctuation stripped, a final street type spelled out, St/Mt/Pt at the start as Saint/Mount/Point."""
    words = norm_text(s).split()
    if len(words) > 1 and words[-1] in ABBREV:
        words[-1] = ABBREV[words[-1]]
    if len(words) > 1 and words[0] in LEADING:
        words[0] = LEADING[words[0]]
    return ' '.join(words)


def shard_key(street_norm):
    k = re.sub(r'[^a-z0-9]', '', street_norm)[:2]
    return k if len(k) == 2 else (k + '_' if k else '__')


def split_number(num, unit):
    """'2/15A' -> unit 2, number 15A; 'Flat 3' units and plain numbers pass through."""
    num = (num or '').strip().replace(' ', '')
    unit = re.sub(r'(?i)^(unit|flat|apartment|apt)\s*', '', (unit or '').strip())
    m = re.fullmatch(r'([A-Za-z0-9]+)/([0-9]+[A-Za-z]?)', num)
    if m and not unit:
        unit, num = m.group(1), m.group(2)
    return num.upper(), unit.upper() or None


def text(v):
    return v if isinstance(v, str) and v else None


def stage_addresses():
    t = time.time()
    src = RAW / 'osm_addresses_auckland.tsv.gz'
    a = pd.read_csv(src, sep='\t', dtype=str, keep_default_na=False, quoting=3)
    n_raw = len(a)
    a['street'] = np.where(a['addr:street'] != '', a['addr:street'], a['addr:place'])
    a = a[(a['addr:housenumber'] != '') & (a.street != '')].copy()
    for col in ['street', 'addr:housenumber', 'addr:unit', 'addr:suburb', 'addr:hamlet', 'addr:city', 'addr:postcode']:
        bad = a[col].str.contains(MOJIBAKE)
        assert not bad.any(), f'garbled text in {col}: {a[col][bad].head(3).tolist()} (rerun property_sources.py addresses)'
    parts = [split_number(n, u) for n, u in zip(a['addr:housenumber'], a['addr:unit'])]
    a['number'] = [p[0] for p in parts]; a['unit'] = [p[1] for p in parts]
    a['suburb'] = np.where(a['addr:suburb'] != '', a['addr:suburb'], np.where(a['addr:hamlet'] != '', a['addr:hamlet'], a['addr:city']))
    a['street_norm'] = [norm_street(s) for s in a.street]
    a['lon'] = a.lon.astype(float); a['lat'] = a.lat.astype(float)
    a = a.sort_values(['osm_type']).drop_duplicates(['street_norm', 'number', 'unit', 'suburb'], keep='first')  # nodes before ways
    parcels, pg = load_parcels()
    x, y = to2193(a.lon.values, a.lat.values)
    ip = point_in(pg, x, y, choose_area=parcels.area_m2.values)
    miss = np.where(ip < 0)[0]
    snapped = 0
    if len(miss):
        pts = shapely.points(x[miss], y[miss])
        qi, gi = shapely.STRtree(pg).query_nearest(pts, max_distance=ADDRESS_SNAP_M, all_matches=False)
        ip[miss[qi]] = gi; snapped = len(qi)
    a['pid'] = np.where(ip >= 0, parcels.pid.values[np.maximum(ip, 0)], None)
    a = a[a.pid.notna()]
    a['key'] = [shard_key(s) for s in a.street_norm]
    out = DATA / 'address_index'
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob('*.json.gz'):
        f.unlink()
    fields = ['number', 'unit', 'street', 'street_norm', 'suburb', 'postcode', 'lon', 'lat', 'pid']
    a = a.sort_values(['street_norm', 'suburb', 'number', 'unit'], key=lambda s: s.fillna(''))
    shards = {}
    for key, g in a.groupby('key'):
        rows = [[n, text(u), s, sn, text(sb), text(pc), round(lo, 6), round(la, 6), pid] for n, u, s, sn, sb, pc, lo, la, pid in
                zip(g.number, g.unit, g.street, g.street_norm, g.suburb, g['addr:postcode'], g.lon, g.lat, g.pid)]
        (out / f'{key}.json.gz').write_bytes(gzip.compress(json.dumps(rows, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode(), 9, mtime=0))
        shards[key] = len(rows)
    P = pd.read_parquet(TMP / 'parcels.parquet', columns=['pid', 'zone_group', 'tenure'])
    res = P[P.zone_group == 'Residential']
    with_addr = res.pid.isin(set(a.pid)).sum()
    meta = {
        'source': 'OpenStreetMap address points and building/parcel outlines with addr:housenumber (mostly the LINZ NZ Addresses import), fetched from the Overpass API',
        'licence': 'ODbL 1.0', 'attribution': 'Addresses © OpenStreetMap contributors, ODbL',
        'fetched': time.strftime('%Y-%m-%d', time.localtime(src.stat().st_mtime)),
        'fields': fields,
        'sharding': 'One gzipped JSON array per key; key = first two characters [a-z0-9] of street_norm (one-character streets pad with _).',
        'parcel_match': f'Point in LINZ primary parcel; addresses on the road within {ADDRESS_SNAP_M:g} m of a parcel take the nearest parcel; others are dropped.',
        'normalisation': {
            'text': 'NFKD, combining marks removed (macrons stripped: Māngere -> mangere), lower case, apostrophes removed, other punctuation to spaces.',
            'street_type': 'Final word spelled out: ' + ', '.join(f'{k}->{v}' for k, v in ABBREV.items() if k != v),
            'leading': 'First word St/Mt/Pt -> saint/mount/point (St Heliers Bay Rd -> saint heliers bay road).',
            'unit': 'A housenumber written 2/15 or 2/15A becomes unit 2, number 15 / 15A; addr:unit values drop Unit/Flat/Apt prefixes; numbers and units are upper case.',
            'query': 'Clients parse "[unit/]number street [, suburb]" (also "Unit 2, 15 ..." and "Flat 2 15 ..."), normalise the street the same way, load the shard for its first two characters, and match street_norm by prefix.'},
        'counts': {'osm_rows': n_raw, 'indexed': len(a), 'snapped_within_15m': snapped, 'shards': len(shards), 'largest_shard_rows': max(shards.values())},
        'coverage': {'residential_zone_parcels': len(res), 'with_address': int(with_addr), 'share': round(with_addr / max(len(res), 1), 4)},
        'shards': shards,
    }
    (out / 'meta.json').write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    (out / '.htaccess').write_text(GZ_JSON_HTACCESS)
    stats_update('addresses', {k: meta[k] for k in ['counts', 'coverage']} | {'seconds': round(time.time() - t)})
    log('addresses', meta['counts'], meta['coverage'])


STAGES = {'points': stage_points, 'assign': stage_assign, 'canopy': stage_canopy,
          'summaries': stage_summaries, 'tiles': stage_tiles, 'addresses': stage_addresses}

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', nargs='*', default=['points', 'assign', 'canopy', 'summaries', 'tiles', 'addresses'])
    args = ap.parse_args()
    for d in (TMP, DATA, W / 'tiles', W / 'logs'):
        d.mkdir(parents=True, exist_ok=True)
    for s in args.stage:
        t0 = time.time()
        log('stage', s)
        STAGES[s]()
        log('stage', s, 'done in', round(time.time() - t0), 's')
