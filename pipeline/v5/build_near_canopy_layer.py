#!/usr/bin/env python3
"""Export lower vegetation in geographic GeoJSON coordinates for vector tiles.

Accepts full production or adapter Parquet columns. Preserves valid zero NDVI,
ignores empty-schema tiles, and excludes the tree class from this candidate layer.
"""
from pathlib import Path
import argparse,json,math
import pandas as pd
from pyproj import Transformer
import shapely
from shapely.geometry import mapping
from shapely.ops import transform
TO4326=Transformer.from_crs(2193,4326,always_xy=True)
def number(row,*keys):
 for key in keys:
  value=row.get(key)
  if value is not None:
   try:
    v=float(value)
    if math.isfinite(v):return v
   except (ValueError,TypeError):pass
 return None

def feature(row,tile=''):
 if row.get('canopy_class') not in {'low_canopy','sub_canopy'}:return None
 geom=shapely.from_wkb(row['crown_wkb'])
 if geom.is_empty:return None
 if not geom.is_valid:geom=shapely.make_valid(geom)
 area=geom.area;diam=2*math.sqrt(area/math.pi)
 geom=transform(TO4326.transform,geom);x0,y0,x1,y1=geom.bounds
 if not (165<=x0<=x1<=180 and -48<=y0<=y1<=-30):raise ValueError('Crown is outside the expected NZ longitude/latitude bounds')
 props={'candidate_id':str(row.get('seg_key') or f"{tile}:{row.get('x_2193')}:{row.get('y_2193')}"),'canopy_class':row['canopy_class'],
 'height_m':number(row,'height_m'),'crown_area_m2':round(area,3),'crown_diameter_m':round(diam,3),
 'aerial_greenness':number(row,'aerial_greenness','gli'),'ndvi_mean':number(row,'ndvi_mean','img_gli'),
 'multi_return_fraction':number(row,'multi_return_fraction','multi_return'),'n_veg_returns':number(row,'n_veg_returns','n_veg'),
 'gap_filled_fraction':number(row,'gap_filled_fraction','gap_frac'),'in_valuation':False}
 return {'type':'Feature','geometry':mapping(geom),'properties':props}
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--src',default='/data/alto/working/crowns_v5_full/near_canopy');ap.add_argument('--out',required=True);a=ap.parse_args();counts={}
 out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
 with out.open('w') as fh:
  for p in sorted(Path(a.src).glob('*.parquet')):
   d=pd.read_parquet(p)
   for row in d.to_dict('records'):
    f=feature(row,p.stem)
    if f is None:continue
    k=f['properties']['canopy_class'];counts[k]=counts.get(k,0)+1;fh.write(json.dumps(f,separators=(',',':'),allow_nan=False)+'\n')
 print(json.dumps({'output':str(out),'counts':counts}))
if __name__=='__main__':main()
