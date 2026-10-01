"""Deploy freshness gate.

A tileset older than the database was tiled from rows the database no longer
holds. That failure is silent and looks like a healthy deploy, so the bundler
has to refuse it. This exercises the real script against a temporary tree.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "scripts" / "build_web_deploy.sh"

TILES = [
    "trees_map_points.pmtiles",
    "tree_crowns_pilot.pmtiles",
    "low_canopy_candidates.pmtiles",
    "tree_change.pmtiles",
    "tree_root_shapes.pmtiles",
]


class DeployFreshnessGateTests(unittest.TestCase):
    def build_tree(self, tmp: Path, *, tiles_newer: bool) -> Path:
        """Minimal repo layout the deploy script needs."""
        root = tmp / "repo"
        (root / "scripts").mkdir(parents=True)
        (root / "data" / "processed").mkdir(parents=True)
        (root / "web" / "pilot_map").mkdir(parents=True)
        shutil.copy(DEPLOY, root / "scripts" / "build_web_deploy.sh")

        # Stand in for the metadata generator: the gate must trip before it runs.
        (root / "scripts" / "build_web_release_metadata.py").write_text(
            "open(__import__('sys').argv[0] + '.ran', 'w').write('ran')\n", encoding="utf-8"
        )
        (root / "web" / "pilot_map" / "index.html").write_text(
            "<!-- AKL_DATA_BASE: marker -->", encoding="utf-8"
        )
        for asset in ("deploy.htaccess", "observatory.css", "map-analysis.js", "alto-logo.png"):
            (root / "web" / "pilot_map" / asset).write_bytes(b"fixture")
        for asset in ("canopy_cover_by_board.geojson", "kauri_dieback.geojson"):
            (root / "data" / "processed" / asset).write_text("{}", encoding="utf-8")
        exports = root / "data" / "processed" / "exports"
        exports.mkdir()
        for asset in ("akl_trees_metro.parquet", "akl_trees_metro.csv.gz", "akl_trees_data_dictionary.md"):
            (exports / asset).write_bytes(b"fixture")
        (root / "web" / "pilot_map" / "release-metadata.json").write_text("{}", encoding="utf-8")

        db = root / "data" / "processed" / "akl_trees.sqlite"
        db.write_bytes(b"")
        os.utime(db, (1_000_000, 1_000_000))
        (exports / "export-manifest.json").write_text(json.dumps({"database_mtime_ns": db.stat().st_mtime_ns}), encoding="utf-8")
        tile_mtime = 2_000_000 if tiles_newer else 500_000
        for tile in TILES:
            path = root / "data" / "processed" / tile
            path.write_bytes(b"fixture")
            os.utime(path, (tile_mtime, tile_mtime))
        return root

    def run_deploy(self, root: Path, **env_extra: str) -> subprocess.CompletedProcess:
        env = {**os.environ, **env_extra}
        return subprocess.run(
            ["bash", str(root / "scripts" / "build_web_deploy.sh")],
            capture_output=True, text=True, env=env,
        )

    def test_tiles_older_than_the_database_stop_the_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self.build_tree(Path(tmp), tiles_newer=False)
            result = self.run_deploy(root)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn("would publish superseded data", result.stderr)
            for tile in TILES:
                self.assertIn(tile, result.stderr)
            # Nothing may be written once the gate trips.
            self.assertFalse((root / "outputs" / "web_deploy").exists())

    def test_tiles_newer_than_the_database_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self.build_tree(Path(tmp), tiles_newer=True)
            result = self.run_deploy(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("would publish superseded data", result.stderr)
            out = root / "outputs" / "web_deploy"
            self.assertTrue((out / "index.html").exists())
            for asset in ("observatory.css", "map-analysis.js", "alto-logo.png", ".htaccess"):
                self.assertTrue((out / asset).is_file())
            manifest = json.loads((out / "bundle-manifest.json").read_text())
            self.assertTrue(all(len(row["sha256"]) == 64 for row in manifest["files"]))

    def test_missing_asset_keeps_previous_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self.build_tree(Path(tmp), tiles_newer=True)
            out = root / "outputs" / "web_deploy"
            out.mkdir(parents=True)
            (out / "index.html").write_text("previous bundle")
            (root / "web" / "pilot_map" / "alto-logo.png").unlink()
            result = self.run_deploy(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((out / "index.html").read_text(), "previous bundle")

    def test_every_layer_the_map_requests_is_actually_shipped(self) -> None:
        """A source URL that resolves to nothing 404s on every page load, even
        when its layer is hidden, because MapLibre fetches the PMTiles header
        while building the style. The map once shipped with exactly that fault,
        so the reference list and the bundle list are pinned together here."""
        index = (ROOT / "web" / "pilot_map" / "index.html").read_text(encoding="utf-8")
        script = DEPLOY.read_text(encoding="utf-8")

        requested_tiles = set(re.findall(r"pmtiles://\$\{DATA_BASE\}/([\w.-]+\.pmtiles)", index))
        requested_geojson = set(re.findall(r"\$\{DATA_BASE\}/([\w.-]+\.geojson)", index))
        self.assertTrue(requested_tiles, "no PMTiles references found - check the pattern")

        tiles_line = re.search(r"^TILES=\((.*?)\)", script, re.M)
        self.assertIsNotNone(tiles_line)
        shipped_tiles = set(tiles_line.group(1).split())
        geojson_line = re.search(r"for gj in ([^;]+); do", script)
        self.assertIsNotNone(geojson_line)
        shipped_geojson = set(geojson_line.group(1).split())

        self.assertEqual(
            requested_tiles - shipped_tiles, set(),
            "index.html requests PMTiles the deploy bundle does not ship",
        )
        self.assertEqual(
            requested_geojson - shipped_geojson, set(),
            "index.html requests GeoJSON the deploy bundle does not ship",
        )

    def test_override_is_explicit_and_announced(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self.build_tree(Path(tmp), tiles_newer=False)
            result = self.run_deploy(root, ALLOW_STALE_TILES="1")
            self.assertEqual(result.returncode, 0, result.stderr)
            # It still says loudly what it is doing.
            self.assertIn("would publish superseded data", result.stderr)
            self.assertIn("ALLOW_STALE_TILES=1 set", result.stderr)


if __name__ == "__main__":
    unittest.main()
