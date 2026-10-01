from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "web" / "pilot_map" / "index.html"
HTACCESS = ROOT / "web" / "pilot_map" / "deploy.htaccess"
DEPLOY = ROOT / "scripts" / "build_web_deploy.sh"
GENERATOR = ROOT / "scripts" / "build_web_release_metadata.py"
METADATA = ROOT / "web" / "pilot_map" / "release-metadata.json"


def load_generator():
    spec = importlib.util.spec_from_file_location("build_web_release_metadata", GENERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ExternalAssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.external_assets: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        url = attributes.get("src") if tag == "script" else attributes.get("href")
        if tag in {"script", "link"} and url and url.startswith("https://"):
            self.external_assets.append(attributes)


class WebReleaseTests(unittest.TestCase):
    def test_generator_builds_versioned_scope_metadata_offline(self) -> None:
        module = load_generator()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "akl_trees.sqlite"
            (root / "pyproject.toml").write_text(
                '[project]\nname = "fixture"\nversion = "9.8.7"\n', encoding="utf-8"
            )
            with sqlite3.connect(db) as conn:
                conn.executescript(
                    """
                    CREATE TABLE trees(tree_id TEXT, as_of_utc TEXT);
                    INSERT INTO trees VALUES ('a','2026-01-01T00:00:00+00:00'),
                                             ('b','2026-01-01T00:00:00+00:00');
                    CREATE TABLE tree_crown_pilot(tree_id TEXT, method_id TEXT, created_at_utc TEXT);
                    INSERT INTO tree_crown_pilot VALUES ('a','crown_v1','2026-01-02T00:00:00+00:00');
                    CREATE TABLE tree_species_class_predictions(tree_id TEXT, model_id TEXT, created_at_utc TEXT);
                    INSERT INTO tree_species_class_predictions VALUES ('a','species_v1','2026-01-03T00:00:00+00:00');
                    CREATE TABLE tree_root_zone_pilot(tree_id TEXT, method_id TEXT, created_at_utc TEXT);
                    INSERT INTO tree_root_zone_pilot VALUES ('a','root_v1','2026-01-04T00:00:00+00:00');
                    CREATE TABLE tree_valuation_pilot(tree_id TEXT, method_id TEXT, valuation_confidence TEXT, created_at_utc TEXT);
                    INSERT INTO tree_valuation_pilot VALUES ('a','value_v1','modelled_medium','2026-01-05T00:00:00+00:00'),
                                                            ('b','value_v1','modelled_nominal','2026-01-05T00:00:00+00:00');
                    CREATE TABLE tree_pointcloud_pilot(tree_id TEXT, created_at_utc TEXT);
                    INSERT INTO tree_pointcloud_pilot VALUES ('a','2026-01-06T00:00:00+00:00');
                    CREATE TABLE tree_trajectory_pilot(tree_id TEXT, created_at_utc TEXT);
                    INSERT INTO tree_trajectory_pilot VALUES ('a','2026-02-01T00:00:00+00:00');
                    """
                )
            timestamp = datetime(2026, 2, 1, tzinfo=timezone.utc).timestamp()
            os.utime(db, (timestamp, timestamp))
            with mock.patch.object(module, "ROOT", root), mock.patch.object(module, "DB", db):
                metadata = module.build_metadata()
            self.assertEqual(metadata["release"]["software_version"], "9.8.7")
            self.assertEqual(metadata["release"]["status"], "research_only_not_independently_validated")
            self.assertFalse(metadata["release"]["public_claims_enabled"])
            self.assertEqual(metadata["release"]["dataset_version"], "metro-2026.02.01")
            self.assertEqual(metadata["dataset"]["tree_records"], 2)
            self.assertEqual(metadata["headline_scope"]["valuation_records_included"], 1)
            self.assertEqual(metadata["headline_scope"]["modelled_nominal_records_excluded"], 1)
            self.assertEqual(len(metadata["models"]), 6)

    def test_committed_metadata_has_required_release_fields(self) -> None:
        metadata = json.loads(METADATA.read_text(encoding="utf-8"))
        self.assertEqual(metadata["schema_version"], 1)
        self.assertTrue(metadata["release"]["dataset_version"])
        self.assertTrue(metadata["release"]["software_version"])
        self.assertTrue(metadata["release"]["dataset_last_updated_utc"])
        self.assertEqual(metadata["release"]["status"], "research_only_not_independently_validated")
        self.assertFalse(metadata["release"]["public_claims_enabled"])
        self.assertIn(metadata["release"]["source_dirty"], (True, False, None))
        self.assertGreater(metadata["dataset"]["tree_records"], 0)
        scope = metadata["headline_scope"]
        self.assertIn("exclude", scope["description"].lower())
        self.assertGreaterEqual(scope["modelled_nominal_records_excluded"], 0)
        generator = load_generator()
        expected_components = {component for component, _, _ in generator.MODEL_SOURCES}
        actual_components = {model["component"] for model in metadata["models"]}
        self.assertEqual(actual_components, expected_components)
        for model in metadata["models"]:
            self.assertEqual(model["validation_status"], "not_independently_validated")
            self.assertFalse(model["release_eligible"])
            self.assertTrue(model["implementations"][0]["id"])

    def test_about_panel_is_metadata_driven_and_scope_is_visible(self) -> None:
        html = INDEX.read_text(encoding="utf-8")
        self.assertIn('id="releaseMeta"', html)
        self.assertIn('id="releaseManifestLink"', html)
        self.assertIn('id="headlineScopeCaption"', html)
        self.assertIn('new URL("./release-metadata.json", window.location.href)', html)
        self.assertIn("modelled_nominal_records_excluded", html)
        self.assertNotIn("Stage 3 CNN", html)
        self.assertNotIn("ResNet18 CNN", html)
        self.assertNotIn("Annual service value", html)
        self.assertNotIn("planning-grade ecosystem-service", html)

    def test_external_runtime_assets_use_subresource_integrity(self) -> None:
        parser = ExternalAssetParser()
        parser.feed(INDEX.read_text(encoding="utf-8"))
        self.assertEqual(len(parser.external_assets), 3)
        for asset in parser.external_assets:
            self.assertTrue(asset.get("integrity", "").startswith("sha384-"))
            self.assertEqual(asset.get("crossorigin"), "anonymous")

    def test_csp_and_baseline_security_headers_are_shipped(self) -> None:
        config = HTACCESS.read_text(encoding="utf-8")
        for directive in (
            "Content-Security-Policy",
            "default-src 'self'",
            "object-src 'none'",
            "frame-ancestors 'self'",
            "worker-src 'self' blob:",
            "X-Content-Type-Options",
            "Referrer-Policy",
            "Permissions-Policy",
        ):
            self.assertIn(directive, config)

    def test_default_light_basemap_does_not_require_a_carto_key(self) -> None:
        html = INDEX.read_text(encoding="utf-8")
        config = HTACCESS.read_text(encoding="utf-8")
        self.assertNotIn("basemaps.cartocdn.com", html)
        self.assertNotIn("basemaps.cartocdn.com", config)
        self.assertIn("Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", html)
        self.assertIn("Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", html)
        self.assertIn('let activeBasemapKey = "light"', html)

    def test_deploy_regenerates_and_copies_release_metadata(self) -> None:
        script = DEPLOY.read_text(encoding="utf-8")
        self.assertIn("build_web_release_metadata.py", script)
        self.assertIn('cp "$SRC/release-metadata.json" "$OUT/release-metadata.json"', script)

    @unittest.skipUnless(shutil.which("node"), "Node.js is unavailable")
    def test_inline_browser_script_parses_without_network(self) -> None:
        program = r"""
          const fs = require('fs');
          const vm = require('vm');
          const html = fs.readFileSync(process.argv[1], 'utf8');
          const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
            .map(match => match[1]).filter(source => source.trim());
          for (const source of scripts) new vm.Script(source);
          if (!scripts.length) throw new Error('no inline application script found');
        """
        completed = subprocess.run(
            ["node", "-e", program, str(INDEX)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == "__main__":
    unittest.main()
