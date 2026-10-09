"""Pull every inventory record (linked and unlinked) of the four external sources out of v5.1.

The linker needs the unlinked records it must place, but it learns everything it scores with
from the records v5.1 already links: their offsets, their crowns' sizes per taxon, how many
records a crown holds. So both come out together, with the link, whether the record is its
crown's primary, the repair verdict and the location-review flag. Read-only on the database.
"""
import json, time
import numpy as np, pandas as pd
from pyproj import Transformer
from common import db, WORK, SOURCES, tname, genus_of

t0 = time.time(); con = db(); WORK.mkdir(parents=True, exist_ok=True)
src = ",".join(f"'{s}'" for s in SOURCES)
q = f"""select t.tree_id, t.source_primary as source, t.source_tree_id, t.species_latin, t.species_common,
  t.owner_class, t.owner_raw, t.lon, t.lat, t.record_role, t.taxon_assertion_status, t.is_protected_notable,
  t.notable_group_count, d.display_role, d.crown_source as display_crown_source,
  l.seg_key as link_seg, l.top_distance_m as link_top_m, c.primary_tree_id as link_primary,
  (c.primary_tree_id = t.tree_id) as is_primary, r.status as repair_status, r.reason as repair_reason,
  v.source_position_status, v.automatic_crown_link_allowed
from trees t left join tree_display_v5 d using(tree_id) left join tree_crown_v5_links l using(tree_id)
  left join tree_crown_v5 c on c.seg_key = l.seg_key left join tree_crown_link_repairs_v5 r using(tree_id)
  left join tree_location_review_v5 v using(tree_id)
where t.source_primary in ({src})"""
df = pd.read_sql(q, con)
tr = Transformer.from_crs(4326, 2193, always_xy=True)
df["x"], df["y"] = tr.transform(df.lon.values, df.lat.values)
df["tile"] = [tname(a, b) for a, b in zip(df.x, df.y)]
df["genus"] = [genus_of(s) for s in df.species_latin]
# notable trees carry only a common name: borrow the genus the register most often gives that name
reg = df[df.source.eq("tree_register_points") & df.genus.notna() & df.species_common.notna()]
c2g = reg.assign(k=reg.species_common.str.strip().str.lower()).groupby("k").genus.agg(lambda s: s.value_counts().index[0])
first = df.species_common.fillna("").str.split(",").str[0].str.strip().str.lower()
df["genus_from_common"] = df.genus.isna() & first.isin(c2g.index)
df.loc[df.genus_from_common, "genus"] = first[df.genus_from_common].map(c2g)
df["n_names"] = df.species_common.fillna("").str.count(",") + 1
df["unlinked"] = df.display_role.eq("source_record")
# register owner groups carry different digitising practice (AT kerbside runs vs Parks)
df["src_group"] = np.select(
    [df.source.eq("tree_register_points") & df.owner_class.eq("Auckland Transport"),
     df.source.eq("tree_register_points"), df.source.eq("notable_trees_overlay"), df.source.eq("osm_natural_tree")],
    ["register_at", "register_parks", "notable", "osm"], "kauri_obs")
df["seq"] = pd.to_numeric(df.source_tree_id.str.extract(r"ACCT(\d+)")[0], errors="coerce")
df.to_parquet(WORK / "records.parquet", index=False)

# the primary of every crown an inventory record links to, with its own taxon, for conflict checks
links = df[df.link_seg.notna()][["tree_id", "link_seg", "genus", "species_latin", "source", "is_primary"]]
itree = pd.read_sql("select scientific_name, genus, growth_form, mature_height_m from itree_species_ref", con)
igen = pd.read_sql("select genus, growth_form, mature_height_m from itree_genus_ref", con)
itree.to_parquet(WORK / "itree_species.parquet", index=False); igen.to_parquet(WORK / "itree_genus.parquet", index=False)
print(json.dumps({"records": len(df), "unlinked": int(df.unlinked.sum()),
                  "by_source_unlinked": df[df.unlinked].source.value_counts().to_dict(),
                  "linked": int(df.link_seg.notna().sum()), "seconds": round(time.time() - t0, 1)}, indent=1))
print(pd.crosstab(df.src_group, [df.unlinked, df.link_seg.notna()]))
