import gzip, importlib.util, json, sqlite3, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('details',ROOT/'scripts/build_tree_details.py');details=importlib.util.module_from_spec(spec);spec.loader.exec_module(details)
class TreeDetailsTests(unittest.TestCase):
 def test_all_current_trees_zeroes_and_all_scenarios_survive(self):
  with tempfile.TemporaryDirectory() as tmp:
   db=Path(tmp)/'db';out=Path(tmp)/'details';c=sqlite3.connect(db)
   c.executescript("CREATE TABLE trees(tree_id TEXT PRIMARY KEY, species_common TEXT); INSERT INTO trees VALUES('a','Unknown'),('b','Kauri'); CREATE TABLE tree_assets_pilot(tree_id TEXT, condition_proxy TEXT, neighbours_25m INTEGER); INSERT INTO tree_assets_pilot VALUES('a','declining',0); CREATE TABLE tree_valuation_scenarios(tree_id TEXT, scenario_name TEXT, total_value_nzd_y REAL); INSERT INTO tree_valuation_scenarios VALUES('a','guess one',0),('a','guess two',25);")
   c.commit();c.close();before=db.read_bytes();details.build(db,out)
   schema=json.loads((out/'schema.json').read_text());self.assertEqual(schema['records'],2)
   with gzip.open(out/(details.bucket_id('a')+'.json.gz'),'rt') as f:record=json.load(f)['a']
   self.assertEqual(record['assets'],['declining',0]);self.assertEqual(len(record['scenarios']),2);self.assertEqual(record['scenarios'][0][1],0)
   self.assertEqual(before,db.read_bytes())
 def test_ambiguous_join_fails_without_replacing_export(self):
  with tempfile.TemporaryDirectory() as tmp:
   db=Path(tmp)/'db';out=Path(tmp)/'details';out.mkdir();(out/'previous').write_text('usable')
   c=sqlite3.connect(db);c.executescript("CREATE TABLE trees(tree_id TEXT PRIMARY KEY);INSERT INTO trees VALUES('a');CREATE TABLE tree_assets_pilot(tree_id TEXT,height_max_m REAL);INSERT INTO tree_assets_pilot VALUES('a',2),('a',3);");c.close()
   with self.assertRaisesRegex(ValueError,'Ambiguous'):details.build(db,out)
   self.assertEqual((out/'previous').read_text(),'usable')
if __name__=='__main__':unittest.main()
