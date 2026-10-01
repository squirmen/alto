import importlib.util,json,sys,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
if not (HERE/'normalize_public_tree_inventory.py').exists():HERE=HERE.parent/'scripts'
sys.path.insert(0,str(HERE))
from notable_source_identity import seed_registry,IdentityReviewRequired
spec=importlib.util.spec_from_file_location('normalizer_under_test',HERE/'normalize_public_tree_inventory.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ImportTests(unittest.TestCase):
 def fixture(self,root,verified=False,park=False):
  m.ROOT=root;m.ARCGIS_ROOT=root/'raw';(root/'config').mkdir()
  f={'type':'Feature','geometry':{'type':'Point','coordinates':[174.8,-36.8]},'properties':{'OBJECTID':336,'GlobalID':'old','SCHEDULE':'1186','NAME':'Oak','TYPE':'1' if verified else '2'}}
  (root/'config/notable_tree_identity_registry.json').write_text(json.dumps(seed_registry(json.dumps({'features':[f]}).encode())))
  f['properties'].update(OBJECTID=684,GlobalID='new')
  reg={'type':'Feature','geometry':f['geometry'],'properties':{'TreeID':'P1','TreeCommon':'Oak','TreeLatin':'Quercus robur','TreeOwner':'Parks'}}
  for slug,rows in [(m.TREE_REGISTER,[reg] if park else []),(m.NOTABLE_TREES,[f]),(m.NOTABLE_GROUPS,[]),(m.KAURI_OBS,[])]:
   d=root/'raw'/slug;d.mkdir(parents=True);(d/'features_4326.geojson').write_text(json.dumps({'features':rows}))
 def test_stable_id_and_position_uncertainty(self):
  with tempfile.TemporaryDirectory() as d:
   self.fixture(Path(d));records,_=m.build_canonical_records();r=records[0]
   self.assertEqual(r['tree_id'],'akl_tree_not_336');self.assertEqual(r['source_object_id'],684);self.assertEqual(r['notable_point_match_confidence'],'unverified');self.assertEqual(r['notable_point_review_required'],1)
 def test_unverified_position_does_not_mark_nearby_park_tree(self):
  with tempfile.TemporaryDirectory() as d:
   self.fixture(Path(d),park=True);records,_=m.build_canonical_records();by={r['tree_id']:r for r in records}
   self.assertIn('akl_tree_not_336',by);r=by['akl_tree_trp_P1'];self.assertFalse(r['notable_point_match']);self.assertFalse(r['is_protected_notable']);self.assertTrue(r['notable_point_review_required'])
 def test_verified_matching_still_works(self):
  with tempfile.TemporaryDirectory() as d:
   self.fixture(Path(d),verified=True,park=True);records,_=m.build_canonical_records();r=next(r for r in records if r['tree_id']=='akl_tree_trp_P1');self.assertTrue(r['notable_point_match']);self.assertEqual(r['notable_point_match_confidence'],'high')
 def test_removed_record_cannot_trigger_destructive_refresh(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);(root/'raw'/m.NOTABLE_TREES/'features_4326.geojson').write_text('{"features":[]}')
   with self.assertRaises(IdentityReviewRequired):m.build_canonical_records()
   self.assertFalse(list(root.rglob('*.sqlite')))
if __name__=='__main__':unittest.main()
