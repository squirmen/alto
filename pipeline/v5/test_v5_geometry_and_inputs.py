import unittest,importlib.util,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,'/data/alto/working/seg_lab')
import build_base,notable_location_policy
class Geometry(unittest.TestCase):
 def test_empty_canopy_contract(self):
  a=np.full((5,7),np.nan);out,mask=build_base._fill_canopy(a,.5,return_mask=True)
  self.assertEqual(out.shape,a.shape);self.assertFalse(out.any());self.assertFalse(mask.any());self.assertEqual(build_base._fill_canopy(a,.5).shape,a.shape)
 def test_preserve_measured_cells(self):
  a=np.full((9,9),np.nan);a[4,4]=5.0;out,mask=build_base._fill_canopy(a,.5,return_mask=True);self.assertEqual(out[4,4],5);self.assertFalse(mask[4,4]);self.assertTrue(mask.any())
if __name__=='__main__':unittest.main()
