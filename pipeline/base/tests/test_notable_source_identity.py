import unittest,json,tempfile,copy
from pathlib import Path
import sys
scripts = Path(__file__).resolve().parents[1] / "scripts"
if scripts.is_dir():
 sys.path.insert(0, str(scripts))
from notable_source_identity import *
def feature(oid=336,gid='old',schedule='1186',name='Oak, Coral tree',xy=None):
 return {'type':'Feature','geometry':{'type':'Point','coordinates':xy or [174.799863322469,-36.8283693819764]},'properties':{'OBJECTID':oid,'GlobalID':gid,'SCHEDULE':schedule,'NAME':name,'TYPE':'2'}}
def collection(*fs):return {'type':'FeatureCollection','features':list(fs)}
class IdentityTests(unittest.TestCase):
 def setUp(self):self.reg=seed_registry(json.dumps(collection(feature())).encode())
 def test_both_ids_changed_preserves_alto(self):
  r=reconcile(collection(feature(684,'new')),self.reg)
  self.assertEqual(r['crosswalk'][0]['alto_tree_id'],'akl_tree_not_336');self.assertTrue(r['safe_for_full_inventory_rebuild']);self.assertFalse(r['crosswalk'][0]['position_verified'])
 def test_reused_objectid_cannot_steal_history(self):
  r=reconcile(collection(feature(336,'new','900','Totara, Rimu',[174.712,-36.903]),feature(684,'new2')),self.reg)
  self.assertEqual(len(r['crosswalk']),1);self.assertEqual(r['crosswalk'][0]['current_objectid'],684);self.assertEqual(r['pending_source_records'],1)
 def test_moved_point_requires_review_even_when_ids_unchanged(self):
  r=reconcile(collection(feature(xy=[174.81,-36.82])),self.reg);self.assertEqual(r['resolved_source_records'],0)
 def test_renamed_record_requires_review(self):
  self.assertEqual(reconcile(collection(feature(name='Oak')),self.reg)['resolved_source_records'],0)
 def test_duplicate_original_signature_not_collapsed(self):
  reg=seed_registry(json.dumps(collection(feature(),feature(337,'other'))).encode())
  self.assertEqual(reconcile(collection(feature(684,'new')),reg)['resolved_source_records'],0)
  self.assertEqual(reconcile(collection(feature(),feature(337,'other')),reg)['resolved_source_records'],2)
 def test_duplicate_incoming_records_not_auto_linked(self):
  self.assertEqual(reconcile(collection(feature(684,'new'),feature(685,'new2')),self.reg)['resolved_source_records'],0)
 def test_absence_does_not_delete_history(self):
  r=reconcile(collection(),self.reg);self.assertEqual(r['unresolved_existing'][0]['alto_tree_id'],'akl_tree_not_336');self.assertFalse(r['safe_for_full_inventory_rebuild'])
 def test_import_stops_on_pending(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'registry.json';p.write_text(json.dumps(self.reg))
   with self.assertRaises(IdentityReviewRequired):resolve_for_import(collection(feature(name='Different')),p)
 def test_idempotent_and_input_unchanged(self):
  s=collection(feature(684,'new'));original=copy.deepcopy(s);one=reconcile(s,self.reg);two=reconcile(s,self.reg)
  self.assertEqual(one,two);self.assertEqual(s,original)
if __name__=='__main__':unittest.main()
