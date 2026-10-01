import importlib.util
from pathlib import Path
import unittest
import numpy as np
spec=importlib.util.spec_from_file_location('longitudinal',Path(__file__).resolve().parents[1]/'scripts/build_longitudinal_model.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class LongitudinalTests(unittest.TestCase):
    def test_whole_geographic_block_shares_partition(self):
        self.assertEqual(m.partition(1740001,5910001),m.partition(1744999,5914999))
        self.assertEqual(m.partition(1740001,5910001),m.partition(1740001,5910001))
    def test_future_targets_do_not_enter_prediction(self):
        train=np.array([[10,12,0]]*100+[[20,24,0]]*100,dtype=float)
        model=m.fit(train)
        test=np.array([[10,999,.5],[20,-999,np.nan]],dtype=float)
        pred=m.predict(model,test,.25)
        test[:,1]=0
        np.testing.assert_array_equal(pred,m.predict(model,test,.25))
        self.assertAlmostEqual(pred[0],12.5)
        self.assertAlmostEqual(pred[1],24)
    def test_decline_and_error_not_deleted(self):
        data=np.array([[10,8,0]]*100,dtype=float);model=m.fit(data)
        self.assertLess(m.rate(model,10),0)
        self.assertEqual(m.score(data,np.full(100,10))['mae_m'],2)
    def test_sparse_band_falls_back_and_values_stay_finite(self):
        model=m.fit(np.array([[10,12,0]]*100,dtype=float))
        self.assertTrue(model['cohorts'][0]['fallback_to_global'])
        self.assertTrue(all(np.isfinite(c['annual_change_quantiles']).all() for c in model['cohorts']))

if __name__=='__main__':unittest.main()
