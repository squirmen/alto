import copy
import sys
import sqlite3
import tempfile
import unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path[:0]=[str(HERE),str(HERE.parent/'base'/'scripts')]
from repair_v5_crown_links import select_candidate,reconcile_group
from cleanup_inferred_without_crowns import report


class CrownContinuityTests(unittest.TestCase):
    def setUp(self):
        self.r={'tree_id':'inventory','source_primary':'tree_register_points',
                'owner_class':'Auckland Transport','link_role':'unlinked',
                'within_v5_footprint':1,'automatic_crown_link_allowed':None,
                'old_seg_key':'v4','species_latin':'Erythrina sp.',
                'previous_crown':{'height_m':15.75,'primary_tree_id':'inventory'},
                'trajectories':[{'fate':'persistent','present_2024':1,'h_2024':14.8}]}
        # The audited AR/0177 relationship: a point 9 cm inside a polygon hole,
        # with almost half the earlier crown excluded but unique continuation.
        self.a={'seg_key':'v5','edge_m':.0899005,'old_fraction':.5057678,
                'new_fraction':1.,'intersection_m2':101.25,'in_hole':True}
        self.c={'v5':{'seg_key':'v5','height_m':14.76,'primary_tree_id':'detector',
                      'geometry_sha256':'unchanged'}}

    def choose(self,r=None,cs=None):
        return select_candidate(r or self.r,cs if cs is not None else [self.a],self.c)

    def test_point_in_hole_restores_link_without_modifying_boundary_or_record(self):
        original=copy.deepcopy((self.r,self.a,self.c))
        self.assertEqual(self.choose(),(self.a,None))
        self.assertEqual(original,(self.r,self.a,self.c))

    def test_nearest_alone_does_not_establish_link(self):
        a={**self.a,'old_fraction':0,'new_fraction':0,'intersection_m2':0}
        self.assertIsNone(self.choose(cs=[a])[0])

    def test_two_close_crowns_require_review(self):
        other={**self.a,'seg_key':'other','edge_m':.5,'old_fraction':.01}
        self.assertEqual(self.choose(cs=[self.a,other])[1],'competing_crowns')

    def test_fragmented_old_crown_not_assigned_to_only_largest_piece(self):
        other={**self.a,'seg_key':'other','edge_m':5,'old_fraction':.3}
        self.assertEqual(self.choose(cs=[self.a,other])[1],'competing_crowns')

    def test_unverified_notable_and_outside_coverage_stay_unlinked(self):
        for r in ({**self.r,'automatic_crown_link_allowed':0},
                  {**self.r,'source_primary':'notable_trees_overlay','notable_point_type':'2'},
                  {**self.r,'within_v5_footprint':0}):
            self.assertIsNone(self.choose(r=r)[0])

    def test_old_tree_gone_or_history_ambiguous_not_restored(self):
        for history in ([{'present_2024':0,'fate':'lost'}], self.r['trajectories']*2):
            self.assertEqual(self.choose(r={**self.r,'trajectories':history})[1],'historical_presence_conflict')

    def test_height_conflict_is_not_ignored(self):
        self.c['v5']['height_m']=7
        self.assertEqual(self.choose()[1],'height_disagreement')

    def test_history_detection_has_stricter_position_tolerance(self):
        r={**self.r,'source_primary':'lidar_pointcloud_v4'}
        self.assertIsNotNone(self.choose(r=r)[0])
        self.assertIsNone(self.choose(r=r,cs=[{**self.a,'edge_m':2}])[0])
        self.assertIsNone(self.choose(r={**r,'trajectories':[]})[0])

    def test_same_previous_crown_keeps_existing_inventory_representative(self):
        records={'inventory':self.r,'alias':{**self.r,'tree_id':'alias'}}
        cr={**self.c['v5'],'primary_tree_id':'inventory'}
        group,reason=reconcile_group({'alias':self.a},[{'tree_id':'inventory'}],records,cr)
        self.assertIsNone(reason)
        self.assertEqual(group['primary'],'inventory')
        self.assertEqual(group['restored_ids'],['alias'])

    def test_different_old_crowns_or_different_genera_not_collapsed(self):
        for other in ({**self.r,'old_seg_key':'different'},
                      {**self.r,'species_latin':'Magnolia grandiflora'}):
            group,_=reconcile_group({'inventory':self.a},[{'tree_id':'other'}],
                                    {'inventory':self.r,'other':other},self.c['v5'])
            self.assertIsNone(group)

    def test_inventory_replaces_detector_but_keeps_alias(self):
        group,reason=reconcile_group({'inventory':self.a},[],{'inventory':self.r},self.c['v5'])
        self.assertIsNone(reason)
        self.assertEqual(group['primary'],'inventory')
        self.assertEqual(group['old_primary'],'detector')


class CleanupPreservationTests(unittest.TestCase):
    def test_legacy_cleanup_preserves_unlinked_identity_and_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'fixture.sqlite'
            c=sqlite3.connect(path)
            c.executescript('''CREATE TABLE trees(tree_id TEXT PRIMARY KEY,source_primary TEXT);
              CREATE TABLE tree_crown_pilot(tree_id TEXT PRIMARY KEY);
              CREATE TABLE tree_trajectory_pilot(canonical_tree_id TEXT,h_2024 REAL);
              INSERT INTO trees VALUES('historic','lidar_inferred_canopy');
              INSERT INTO tree_trajectory_pilot VALUES('historic',15.0);''')
            c.commit();c.close();original=path.read_bytes()
            result=report(path)
            self.assertEqual(result['unlinked_records_by_source'],{'lidar_inferred_canopy':1})
            self.assertEqual(result['records_deleted'],0)
            self.assertEqual(path.read_bytes(),original)

    def test_current_link_wins_over_missing_legacy_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'fixture.sqlite';c=sqlite3.connect(path)
            c.executescript('''CREATE TABLE trees(tree_id TEXT PRIMARY KEY,source_primary TEXT);
              CREATE TABLE tree_crown_pilot(tree_id TEXT PRIMARY KEY);
              CREATE TABLE tree_evidence_v5(tree_id TEXT PRIMARY KEY,seg_key TEXT);
              INSERT INTO trees VALUES('current','lidar_pointcloud_v5');
              INSERT INTO tree_evidence_v5 VALUES('current','actual_crown');''')
            c.commit();c.close()
            self.assertEqual(report(path)['unlinked_records_by_source'],{})


if __name__=='__main__':unittest.main()
