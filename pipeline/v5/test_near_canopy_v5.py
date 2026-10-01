import unittest,importlib.util,tempfile,subprocess,sys,json
from pathlib import Path
import shapely
from shapely.geometry import box
spec=importlib.util.spec_from_file_location('near',str(Path(__file__).with_name('build_near_canopy_layer.py')));near=importlib.util.module_from_spec(spec);spec.loader.exec_module(near)
class Near(unittest.TestCase):
 def row(self):return {'canopy_class':'low_canopy','height_m':2.5,'crown_wkb':shapely.to_wkb(box(1760000,5920000,1760005,5920005)),'x_2193':1760002,'y_2193':5920002,'ndvi_mean':0,'n_veg_returns':0}
 def test_coordinates_and_zero(self):
  f=near.feature(self.row(),'tile');x,y=f['geometry']['coordinates'][0][0];self.assertTrue(174<x<175);self.assertTrue(-37<y<-36);self.assertEqual(f['properties']['ndvi_mean'],0);self.assertEqual(f['properties']['n_veg_returns'],0);self.assertFalse(f['properties']['in_valuation']);self.assertEqual(f['properties']['crown_area_m2'],25)
 def test_tree_excluded(self):
  r=self.row();r['canopy_class']='tree';self.assertIsNone(near.feature(r))
 def test_adapter_columns(self):
  r=self.row();del r['ndvi_mean'];r['img_gli']=.4;r['gli']=.3;self.assertEqual(near.feature(r)['properties']['ndvi_mean'],.4)
if __name__=='__main__':unittest.main()
