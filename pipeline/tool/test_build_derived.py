"""Offline checks for the derived-table builders (tool 0.2.12): build_tree_context.py reads a release's own comparison
population (release 6.3: --population-table, --class-field, --benefit-table, --benefit-field, --count, --texts,
--built-on) or a population file, and still reads the release 6.2 service tables with irreplaceability counts;
build_tree_history.py stamps built_on. A small synthetic release in a temporary folder; nothing else is read.
Usage: python3 pipeline/tool/test_build_derived.py   (pandas, shapely, scipy, pyarrow)"""
import gzip
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CTX, HIST = HERE / 'build_tree_context.py', HERE / 'build_tree_history.py'
BANDS = ['under_5y', '5_15y', '15_40y', '40_80y', '80y_plus']
HCLASS = ['very_small', 'small', 'medium', 'large', 'very_large']


def make_release(d):
    """Eight crowns in one board around one street; v6.3 size and benefit tables and v6.2 service tables."""
    db = d / 'r.sqlite'
    c = sqlite3.connect(db)
    c.execute('CREATE TABLE trees (tree_id TEXT, lon REAL, lat REAL)')
    c.execute('CREATE TABLE tree_size_class_v63 (tree_id TEXT, class_used TEXT, height_m REAL, crown_area_m2 REAL, replacement_band TEXT, '
              'height_class TEXT, in_comparisons INTEGER, crown_key TEXT)')
    c.execute('CREATE TABLE tree_benefits_v63 (tree_id TEXT, headline_value_nzd_y REAL)')
    c.execute('CREATE TABLE tree_current_services_v5 (tree_id TEXT, species_class TEXT, total_value_nzd_y REAL, crown_area_m2 REAL)')
    c.execute('CREATE TABLE tree_current_crown_v5 (tree_id TEXT, crown_max_chm_m REAL, crown_area_m2 REAL)')
    c.execute('CREATE TABLE tree_current_assets_v5 (tree_id TEXT, height_max_m REAL, irreplaceability_class TEXT)')
    rows = [  # id, class, height, area, band, height class, in comparisons, crown key, benefit
        ('t1', 'conifer', 20.0, 50.0, '15_40y', 'medium', 1, 'k1', 30.0),
        ('t2', 'conifer', 30.0, 120.0, '40_80y', 'large', 1, 'k2', 80.0),
        ('t3', 'conifer', 4.0, 10.0, None, 'small', 0, 'k3', 5.0),          # under 5 m: not classed, not compared
        ('t4', 'conifer', 31.0, 18.0, '5_15y', 'large', 0, 'k4', 9.0),      # height to check: not compared
        ('t5', 'evergreen_broadleaf', 12.0, 40.0, '15_40y', 'medium', 1, 'k5', 20.0),
        ('t6', 'evergreen_broadleaf', 15.0, 200.0, '80y_plus', 'large', 1, 'k6', 90.0),
        ('t7', 'evergreen_broadleaf', 15.0, 200.0, '80y_plus', 'large', 1, 'k6', 90.0),  # same crown as t6: counted once
        ('t8', 'palm_other', 8.0, 12.0, '15_40y', 'medium', 1, 'k8', 4.0)]
    for i, (tid, cls, h, a, band, hc, inc, key, ben) in enumerate(rows):
        c.execute('INSERT INTO trees VALUES (?,?,?)', (tid, 174.70 + i * 0.0002, -36.80))
        c.execute('INSERT INTO tree_size_class_v63 VALUES (?,?,?,?,?,?,?,?)', (tid, cls, h, a, band, hc, inc, key))
        c.execute('INSERT INTO tree_benefits_v63 VALUES (?,?)', (tid, ben))
        c.execute('INSERT INTO tree_current_services_v5 VALUES (?,?,?,?)', (tid, cls, ben * 3, a))
        c.execute('INSERT INTO tree_current_crown_v5 VALUES (?,?,?)', (tid, h, a))
        c.execute('INSERT INTO tree_current_assets_v5 VALUES (?,?,?)', (tid, h, 'effectively_irreplaceable' if h >= 25 else 'high'))
    c.commit()
    c.close()
    boards = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'board_name': 'Test Board'},
              'geometry': {'type': 'Polygon', 'coordinates': [[[174.6, -36.9], [174.8, -36.9], [174.8, -36.7], [174.6, -36.7], [174.6, -36.9]]]}}]}
    (d / 'boards.json').write_text(json.dumps(boards))
    with gzip.open(d / 'addr.tsv.gz', 'wt') as f:
        f.write('lat\tlon\taddr:street\taddr:place\n')
        for i in range(8):
            f.write(f'-36.8001\t{174.70 + i * 0.0002}\tTest Street\t\n')
    (d / 'meta.json').write_text(json.dumps({'release': {'dataset_version': 'metro-2026.10.17-pointcloud-v6.3'}}))
    return db


def run(script, *args):
    r = subprocess.run([sys.executable, str(script), *map(str, args)], capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(r.stdout + r.stderr)
    return r


class Context(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.db = make_release(self.d)

    def tearDown(self):
        self.tmp.cleanup()

    def base(self, out):
        return ['--db', self.db, '--metadata', self.d / 'meta.json', '--boards', self.d / 'boards.json', '--addresses', self.d / 'addr.tsv.gz', '--out', out]

    def test_release_63_population(self):
        out = self.d / 'out63'
        run(CTX, *self.base(out), '--population-table', 'tree_size_class_v63', '--population-filter', 'z.in_comparisons = 1',
            '--class-field', 'class_used', '--height-field', 'height_m', '--area-field', 'crown_area_m2', '--unique-field', 'crown_key',
            '--benefit-table', 'tree_benefits_v63', '--benefit-field', 'headline_value_nzd_y',
            '--count', 'bands=replacement_band:' + ','.join(BANDS), '--count', 'height_class=height_class:' + ','.join(HCLASS),
            '--texts', HERE / 'context_texts_v63.json', '--built-on', 'metro-2026.10.17-pointcloud-v6.3')
        c = json.loads((out / 'tree_context' / 'comparisons.json').read_text())
        self.assertEqual(c['population']['n'], 5, 'in comparisons only, each crown once')
        texts = json.loads((HERE / 'context_texts_v63.json').read_text())
        self.assertEqual(c['population']['description'], texts['population']['description'])
        self.assertEqual(c['class_field'], texts['class_field'])
        self.assertEqual(c['metrics']['benefits']['field'], texts['metrics']['benefits']['field'])
        self.assertEqual(c['metrics']['benefits']['unit'], 'NZ$/yr', 'units and decimals stay the script’s')
        conifer = c['auckland']['conifer']
        self.assertEqual(conifer['n'], 2)
        self.assertEqual(conifer['bands'], {'under_5y': 0, '5_15y': 0, '15_40y': 1, '40_80y': 1, '80y_plus': 0})
        self.assertEqual(conifer['height_class'], {'very_small': 0, 'small': 0, 'medium': 1, 'large': 1, 'very_large': 0})
        self.assertNotIn('irr', conifer, 'irreplaceability counts are retired')
        self.assertEqual(c['auckland']['evergreen_broadleaf']['n'], 2)
        self.assertEqual(c['boards']['Test Board']['conifer']['bands']['40_80y'], 1)
        self.assertEqual(list(c['counts_per_group']), ['bands', 'height_class', 'note'])
        self.assertEqual(c['counts_per_group']['bands']['keys'], BANDS)
        self.assertEqual(c['counts_per_group']['bands']['labels']['80y_plus'], '80 years or more')
        self.assertEqual(c['built_on'], 'metro-2026.10.17-pointcloud-v6.3')
        self.assertEqual(c['built_with']['script'], 'pipeline/tool/build_tree_context.py')
        m = json.loads((out / 'manifest.json').read_text())
        self.assertEqual((m['built_on'], m['products']['tree_context']), ('metro-2026.10.17-pointcloud-v6.3', 'tree_context/comparisons.json'))
        # Street groups carry the same counts.
        shard = next((out / 'tree_context' / 'streets' / 's').glob('*.json'))
        street = next(iter(json.loads(shard.read_text()).values()))
        self.assertIn('bands', street['groups']['conifer'])

    def test_release_62_services(self):
        out = self.d / 'out62'
        run(CTX, *self.base(out))
        c = json.loads((out / 'tree_context' / 'comparisons.json').read_text())
        self.assertEqual(c['population']['n'], 8, 'every service record (release 6.2 rule)')
        self.assertEqual(c['auckland']['conifer']['irr']['effectively_irreplaceable'], 2)
        self.assertNotIn('counts_per_group', c)
        self.assertEqual(c['class_field'], 'services.species_class')
        self.assertEqual(c['built_on'], 'metro-2026.10.17-pointcloud-v6.3', 'defaults to the metadata release')

    def test_population_file(self):
        import pandas as pd
        out = self.d / 'outfile'
        df = pd.DataFrame({'tree_id': ['a', 'b'], 'lon': [174.70, 174.7002], 'lat': [-36.80, -36.80], 'cls': ['conifer', 'conifer'],
                           'benefits': [1.0, 2.0], 'height': [10.0, 20.0], 'area': [5.0, 6.0], 'replacement_band': ['5_15y', '80y_plus']})
        df.to_parquet(self.d / 'pop.parquet')
        run(CTX, '--population', self.d / 'pop.parquet', '--metadata', self.d / 'meta.json', '--boards', self.d / 'boards.json',
            '--addresses', self.d / 'addr.tsv.gz', '--out', out, '--count', 'bands=replacement_band:' + ','.join(BANDS))
        c = json.loads((out / 'tree_context' / 'comparisons.json').read_text())
        self.assertEqual(c['auckland']['conifer']['bands']['80y_plus'], 1)

    def test_names_are_checked(self):
        with self.assertRaises(AssertionError):
            run(CTX, *self.base(self.d / 'bad'), '--population-table', 'trees; DROP TABLE trees')
        with self.assertRaises(AssertionError):
            run(CTX, *self.base(self.d / 'bad2'), '--population-table', 'tree_size_class_v63', '--population-filter', 'z.in_comparisons = 1; DELETE FROM trees')


class History(unittest.TestCase):
    def test_built_on(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            (d / 'meta.json').write_text(json.dumps({'release': {'dataset_version': 'metro-2026.10.17-pointcloud-v6.3'}}))
            pq.write_table(pa.table({'tree_id': ['akl_tree_x'], 'change': ['became_rep'], 'denoted_moved_m': [1.5]}), d / 'v61.parquet')
            run(HIST, '--metadata', d / 'meta.json', '--out', d / 'out', '--transition', f'v6.1={d / "v61.parquet"}')
            idx = json.loads((d / 'out' / 'tree_history' / 'index.json').read_text())
            self.assertEqual((idx['release'], idx['built_on'], idx['releases']), ('metro-2026.10.17-pointcloud-v6.3', 'metro-2026.10.17-pointcloud-v6.3', ['v6.1']))
            self.assertEqual(json.loads((d / 'out' / 'manifest.json').read_text())['built_on'], 'metro-2026.10.17-pointcloud-v6.3')


class Facts(unittest.TestCase):
    """build_web_beta.py splits a derived folder's notable_facts.json by tree number (the first character after T)."""
    def test_split(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('bwb', HERE / 'build_web_beta.py')
        bwb = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bwb)
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            (d / 'species_maxima').mkdir()
            facts = {'schema': 'alto-notable-facts/1', 'release': 'metro-2026.10.17-pointcloud-v6.3', 'copy': {'group_area': 'x'},
                     'trees': {'TZ69KK1G': {'schedule': [{'schedule': '866'}]}, 'TZ00AAAA': {'group': []}, 'T162DYHP': {'group_area': [{'schedule': '1186'}]}}}
            (d / 'species_maxima' / 'notable_facts.json').write_text(json.dumps(facts))
            r = bwb.split_facts(d, {'notable_facts': 'species_maxima/notable_facts.json'})
            self.assertEqual(r, {'trees': 3, 'shards': 2})
            idx = json.loads((d / 'species_maxima' / 'notable_facts' / 'index.json').read_text())
            self.assertEqual((idx['release'], idx['copy'], idx['shards']['keys'], idx['shards']['path']), (facts['release'], facts['copy'], ['1', 'Z'], '{shard}.json'))
            self.assertNotIn('trees', idx)
            z = json.loads((d / 'species_maxima' / 'notable_facts' / 'Z.json').read_text())
            self.assertEqual(sorted(z['trees']), ['TZ00AAAA', 'TZ69KK1G'])
            self.assertEqual(json.loads((d / 'species_maxima' / 'notable_facts.json').read_text()), facts, 'the file itself stays')
            self.assertIsNone(bwb.split_facts(d, {}))


if __name__ == '__main__':
    unittest.main()
