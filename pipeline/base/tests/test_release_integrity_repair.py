import importlib.util
import sqlite3
import unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('repair',Path(__file__).resolve().parents[1]/'scripts/repair_release_integrity.py')
r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
class RepairTests(unittest.TestCase):
 def db(self):
  c=sqlite3.connect(':memory:')
  c.executescript('''CREATE TABLE itree_species_ref(scientific_name TEXT,mature_height_m REAL);
  INSERT INTO itree_species_ref VALUES('Agathis australis',165);
  CREATE TABLE itree_genus_ref(genus TEXT,mature_height_m REAL);INSERT INTO itree_genus_ref VALUES('Agathis',165);
  CREATE TABLE trees(tree_id TEXT);INSERT INTO trees VALUES('current');
  CREATE TABLE tree_species_attributes(tree_id TEXT,growth_form TEXT,growth_form_source TEXT,growth_form_confidence TEXT,mature_height_m REAL,lidar_height_m REAL,height_plausibility TEXT);
  INSERT INTO tree_species_attributes VALUES('current','conifer','itree_species','known',165,70,'ok');
  CREATE TABLE tree_trajectory_pilot(trajectory_id TEXT,canonical_tree_id TEXT);
  INSERT INTO tree_trajectory_pilot VALUES('a','current'),('b','retired');''');return c
 def test_conversion_audit_orphan_and_idempotence(self):
  c=self.db();d=r.repair(c)
  self.assertEqual(c.execute('SELECT mature_height_m FROM itree_species_ref').fetchone()[0],50.29)
  self.assertEqual(c.execute('SELECT height_plausibility FROM tree_species_attributes').fetchone()[0],'implausibly_tall')
  self.assertEqual(c.execute("SELECT canonical_tree_id FROM tree_trajectory_pilot WHERE trajectory_id='b'").fetchone()[0],None)
  self.assertEqual(c.execute('SELECT old_canonical_tree_id FROM alto_orphan_trajectory_audit').fetchone()[0],'retired')
  self.assertEqual(d['counts']['orphan_links_unlinked'],1)
  self.assertEqual(r.repair(c)['status'],'already_applied')
 def test_refuses_unrecognised_units(self):
  c=self.db();c.execute('UPDATE itree_species_ref SET mature_height_m=50.29');c.commit()
  with self.assertRaises(ValueError):r.repair(c)
 def test_duplicate_identity_rolls_back_entire_repair(self):
  c=self.db();c.execute("INSERT INTO tree_trajectory_pilot VALUES('c','current')");c.commit()
  with self.assertRaises(sqlite3.IntegrityError):r.repair(c)
  self.assertEqual(c.execute('SELECT mature_height_m FROM itree_species_ref').fetchone()[0],165)
if __name__=='__main__':unittest.main()
