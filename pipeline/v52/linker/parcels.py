"""Is a candidate crown on a property parcel or on the road reserve?

Auckland Transport's register is street trees: they stand on the road reserve, which the LINZ primary
parcel layer leaves out (roads are not primary parcels). The first audit rounds showed the commonest
wrong link: an AT point on an empty berm (tree removed, or too small to have a crown) taken to the
garden tree two metres away behind the fence. The simulation cannot show this - it never removes a
tree - so it is measured here, geometrically and crown-set-agnostically: the share of each crown's area
and whether its top lie inside any primary parcel, and whether each record point does.
Usage: parcels.py (writes work/crown_parcel.parquet, work/record_parcel.parquet)
"""
import numpy as np, pandas as pd, pyogrio
from shapely import from_wkb, STRtree, points as P_, intersection, area
from common import WORK

PARCELS = "/data/alto/raw/linz/primary_parcels_auckland.gpkg"


def main():
    K = pd.concat([pd.read_parquet(WORK / f, columns=["seg_key", "x_2193", "y_2193", "crown_wkb"]) for f in ("crowns.parquet", "sim_crowns.parquet")])
    K = K.drop_duplicates("seg_key").reset_index(drop=True)
    R = pd.read_parquet(WORK / "records.parquet", columns=["tree_id", "x", "y"])
    Q = pd.read_parquet(WORK / "sim_queries.parquet", columns=["qid", "x", "y"])
    x0, y0 = min(K.x_2193.min(), R.x.min()) - 50, min(K.y_2193.min(), R.y.min()) - 50
    x1, y1 = max(K.x_2193.max(), R.x.max()) + 50, max(K.y_2193.max(), R.y.max()) + 50
    P = pyogrio.read_dataframe(PARCELS, bbox=(x0, y0, x1, y1), columns=["parcel_intent"])
    geo = P.geometry.values._data if hasattr(P.geometry.values, "_data") else np.asarray(P.geometry.values)
    tree = STRtree(geo)
    def inside(x, y):
        pi, _ = tree.query(P_(x, y), predicate="within")
        out = np.zeros(len(x), bool); out[np.unique(pi)] = True
        return out
    K["top_in_parcel"] = inside(K.x_2193.values, K.y_2193.values)
    cg = from_wkb(K.crown_wkb.values)
    ci, pj = tree.query(cg, predicate="intersects")
    ia = area(intersection(cg[ci], geo[pj]))
    frac = np.bincount(ci, weights=ia, minlength=len(K)) / np.maximum(area(cg), 1e-9)
    K["parcel_frac"] = np.clip(frac, 0, 1).round(3)
    K[["seg_key", "top_in_parcel", "parcel_frac"]].to_parquet(WORK / "crown_parcel.parquet", index=False)
    rp = pd.DataFrame({"qid": np.r_[R.tree_id.values, Q.qid.values], "point_in_parcel": np.r_[inside(R.x.values, R.y.values), inside(Q.x.values, Q.y.values)]})
    rp.to_parquet(WORK / "record_parcel.parquet", index=False)
    print(len(P), "parcels;", len(K), "crowns; tops in a parcel", round(K.top_in_parcel.mean(), 3))


if __name__ == "__main__":
    main()
