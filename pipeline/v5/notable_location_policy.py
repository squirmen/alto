"""Keep uncertain register positions out of automatic crown identity links.

The original source is retained. Only the point-to-crown association is gated;
being inside a crown does not verify a location or identify a scheduled tree.
"""
import hashlib,json
from pathlib import Path
BASELINE_SHA256='d7b87e2682c1c92e60465be5b04edd8be65a0d77734c741de93ae8a9284ce643'
DEFAULT_SOURCE=Path('/data/alto/auckland_council_open_data/notable_trees_overlay/derived/notable_trees_overlay.geojson')

def load_locations(source=DEFAULT_SOURCE, expected_sha256=BASELINE_SHA256):
    raw=Path(source).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_sha256:
        raise ValueError('Notable source snapshot changed. Reconcile its IDs before linking crowns; OBJECTID and GlobalID have changed between Council releases.')
    return {f"akl_tree_not_{f['properties']['OBJECTID']}":f['properties'] for f in json.loads(raw)['features']}

def reason_for_review(tree_id, source_primary, locations):
    notable=str(tree_id).startswith('akl_tree_not_') or source_primary=='notable_trees_overlay'
    if not notable:return None
    record=locations.get(tree_id)
    if record is None:return 'missing_source_location_metadata'
    if str(record.get('TYPE'))!='1':return 'unverified_source_position'
    return None

def prepare_existing(existing, locations):
    required={'tree_id','source_primary','exist_idx','x','y'}
    if not required.issubset(existing.columns):raise ValueError(f'Existing records need location identity metadata: {sorted(required)}')
    out=existing.copy()
    out['location_review_reason']=[reason_for_review(t,s,locations) for t,s in zip(out.tree_id,out.source_primary)]
    out['location_match_allowed']=out.location_review_reason.isna()
    return out

def unique_covering_crown(point, polygons, index):
    """Use real boundaries; retain ambiguous overlaps for review."""
    hits=sorted(int(i) for i in index.query(point) if polygons[i].covers(point))
    return (hits[0],None) if len(hits)==1 else (None,'multiple_covering_crowns' if hits else 'no_covering_crown')
