"""The repair attestation must never become a general stale-tile bypass."""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from verify_tile_repair import verified, VERSION, digest_file


class TileRepairVerificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.db = root / 'akl_trees.sqlite'
        self.tile = root / 'trees_map_points.pmtiles'
        self.report = root / 'tile-integrity-repair.json'
        self.db.write_bytes(b'repaired database')
        self.tile.write_bytes(b'unchanged map payload')
        before = self.db.stat().st_mtime_ns - 2_000_000_000
        self.report.write_text(json.dumps({
            'version': VERSION, 'status': 'applied',
            'database_mtime_ns': self.db.stat().st_mtime_ns,
            'database_before_mtime_ns': before,
            'unchanged_tiles': [{'path': self.tile.name,
                                 'bytes': self.tile.stat().st_size,
                                 'sha256': digest_file(self.tile)}],
        }))

    def test_only_original_payload_passes(self):
        self.assertTrue(verified(self.db, self.tile, self.report))
        self.tile.write_bytes(b'changed---map payload')
        self.assertFalse(verified(self.db, self.tile, self.report))

    def test_later_database_write_invalidates_attestation(self):
        later = self.db.stat().st_mtime_ns + 1_000_000_000
        os.utime(self.db, ns=(later, later))
        self.assertFalse(verified(self.db, self.tile, self.report))

    def test_change_tiles_cannot_be_carried_forward(self):
        change = self.tile.with_name('tree_change.pmtiles')
        self.tile.rename(change)
        report = json.loads(self.report.read_text())
        report['unchanged_tiles'][0]['path'] = change.name
        self.report.write_text(json.dumps(report))
        self.assertFalse(verified(self.db, change, self.report))

    def test_preexisting_stale_tile_cannot_be_attested(self):
        before = json.loads(self.report.read_text())['database_before_mtime_ns'] - 1
        os.utime(self.tile, ns=(before, before))
        self.assertFalse(verified(self.db, self.tile, self.report))


if __name__ == '__main__':
    unittest.main()
