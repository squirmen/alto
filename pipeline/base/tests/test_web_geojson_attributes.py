"""Web-export attribute contract.

The slim GeoJSONs are the only tree-level data the public map ever sees, so the
fields that carry provenance have to survive the export. These tests pin the
behaviour that was previously missing: audited growth form reaching the map,
crownless authoritative records keeping their nominal scenario instead of going
out blank, and the unit-affected i-Tree height ceilings staying out.
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "build_web_geojson.py"


def load_builder():
    spec = importlib.util.spec_from_file_location("build_web_geojson", BUILDER)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SCHEMA = """
CREATE TABLE trees(
    tree_id TEXT, source_primary TEXT, species_common TEXT, species_latin TEXT,
    species_confidence TEXT, owner_class TEXT, is_protected_notable INTEGER,
    notable_point_review_required INTEGER, notable_point_name TEXT,
    notable_group_names TEXT, record_role TEXT, lon REAL, lat REAL);
CREATE TABLE tree_lidar_pilot(tree_id TEXT, chm_local_max_2m_m REAL);
CREATE TABLE tree_crown_pilot(
    tree_id TEXT, crown_area_m2 REAL, crown_max_chm_m REAL, crown_diameter_m REAL);
CREATE TABLE tree_context_pilot(
    tree_id TEXT, in_flood_prone_area INTEGER, in_flood_plain INTEGER,
    fraction_paved_surfaces REAL, air_temp_mean_c REAL,
    dist_overland_flow_path_m REAL, dist_stormwater_catchpit_m REAL);
CREATE TABLE tree_valuation_pilot(
    tree_id TEXT, species_class TEXT, paved_fraction_used REAL,
    paved_fraction_source TEXT, avoided_runoff_m3_y REAL,
    stormwater_value_nzd_y REAL, stored_co2e_tonnes_est REAL,
    carbon_value_nzd_y REAL, cooling_value_nzd_y REAL,
    air_quality_value_nzd_y REAL, pm25_removed_kg_y REAL,
    total_value_nzd_y REAL, valuation_confidence TEXT);
CREATE TABLE tree_species_attributes(
    tree_id TEXT, growth_form TEXT, growth_form_source TEXT,
    growth_form_confidence TEXT, model_confidence REAL, mature_height_m REAL,
    lidar_height_m REAL, height_plausibility TEXT);
CREATE TABLE tree_valuation_scenarios(
    tree_id TEXT, scenario_name TEXT, total_value_nzd_y REAL,
    valuation_confidence TEXT);
"""

# 'crowned' is an ordinary detected tree; 'crownless' is an authoritative
# register record with no segmented canopy, which is the population that was
# previously exported with nothing attached.
FIXTURE = """
INSERT INTO trees VALUES
    ('crowned','lidar_inferred_canopy',NULL,NULL,NULL,'public',0,0,NULL,NULL,
     'remote_sensing_detection',174.76,-36.85),
    ('crownless','tree_register_points','Kauri','Agathis australis','high','public',1,0,
     NULL,NULL,'managed_inventory',174.77,-36.86);
INSERT INTO tree_lidar_pilot VALUES ('crowned',12.5),('crownless',NULL);
INSERT INTO tree_crown_pilot VALUES ('crowned',44.0,12.5,7.5);
INSERT INTO tree_context_pilot VALUES ('crowned',0,0,0.25,17.5,40.0,25.0);
INSERT INTO tree_valuation_pilot VALUES
    ('crowned','conifer',0.25,'measured',3.5,120.0,0.8,40.0,25.0,10.0,0.4,195.0,'modelled_low');
INSERT INTO tree_species_attributes VALUES
    ('crowned','conifer','cnn_rgb','model_inferred',0.51,165.0,12.5,'no_ceiling'),
    ('crownless','conifer','itree_species','known',NULL,165.0,NULL,'no_ceiling');
INSERT INTO tree_valuation_scenarios VALUES
    ('crownless','legacy_modelled_nominal_v1',84.88,'modelled_nominal');
"""


class WebGeoJsonAttributeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_builder()
        self._tmp = tempfile.TemporaryDirectory()
        processed = Path(self._tmp.name)
        db = processed / "akl_trees.sqlite"
        with sqlite3.connect(db) as conn:
            conn.executescript(SCHEMA)
            conn.executescript(FIXTURE)
        self._patches = [
            mock.patch.object(self.module, "PROCESSED_ROOT", processed),
            mock.patch.object(self.module, "SQLITE_PATH", db),
        ]
        for patch in self._patches:
            patch.start()
        self.processed = processed

    def tearDown(self) -> None:
        for patch in self._patches:
            patch.stop()
        self._tmp.cleanup()

    def points(self) -> dict[str, dict]:
        self.module.write_points()
        data = json.loads(
            (self.processed / "trees_map_points.slim.geojson").read_text(encoding="utf-8")
        )
        return {f["id"]: f["properties"] for f in data["features"]}

    def test_audited_growth_form_and_its_provenance_reach_the_map(self) -> None:
        props = self.points()
        self.assertEqual(props["crownless"]["growth_form"], "conifer")
        self.assertEqual(props["crownless"]["growth_form_confidence"], "known")
        self.assertEqual(props["crownless"]["growth_form_source"], "itree_species")
        # A model guess must never be exported as if it were an identification.
        self.assertEqual(props["crowned"]["growth_form_confidence"], "model_inferred")

    def test_crownless_authoritative_record_keeps_its_nominal_scenario(self) -> None:
        props = self.points()
        crownless = props["crownless"]
        # No primary valuation: it has no measured canopy.
        self.assertNotIn("total_value_nzd_y", crownless)
        # But the nominal scenario travels with it, clearly namespaced.
        self.assertAlmostEqual(crownless["scenario_total_value_nzd_y"], 84.88, places=2)
        self.assertEqual(crownless["scenario_confidence"], "modelled_nominal")
        self.assertEqual(crownless["record_role"], "managed_inventory")

    def test_scenario_values_never_leak_into_the_primary_valuation_field(self) -> None:
        props = self.points()
        self.assertEqual(props["crowned"]["total_value_nzd_y"], 195.0)
        self.assertNotIn("scenario_total_value_nzd_y", props["crowned"])

    def test_feet_based_itree_height_ceiling_is_not_published(self) -> None:
        # itree_species_ref stores MatureHeight in feet under a metres column
        # name, so neither the ceiling nor the flag derived from it may ship.
        props = self.points()
        for tree in props.values():
            self.assertNotIn("mature_height_m", tree)
            self.assertNotIn("height_plausibility", tree)

    def test_every_tree_is_exported_including_crownless_records(self) -> None:
        self.assertEqual(set(self.points()), {"crowned", "crownless"})

    def test_build_never_opens_the_database_for_writing(self) -> None:
        conn = self.module.connect_readonly()
        try:
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute("CREATE TABLE should_not_exist(x)")
        finally:
            conn.close()

    def write_crown_intermediate(self) -> None:
        """The full crown file that write_crowns slims. Includes a crown whose
        tree is gone from the database, which is what point-cloud deletions
        leave behind."""
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "crowned",
                    "properties": {"tree_id": "crowned"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[174.76, -36.85], [174.761, -36.85],
                                         [174.761, -36.851], [174.76, -36.85]]],
                    },
                },
                {
                    "type": "Feature",
                    "id": "deleted_phantom",
                    "properties": {"tree_id": "deleted_phantom"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[175.5, -36.6], [175.501, -36.6],
                                         [175.501, -36.601], [175.5, -36.6]]],
                    },
                },
            ],
        }
        (self.processed / "tree_crowns_pilot.geojson").write_text(
            json.dumps(document, separators=(",", ":")), encoding="utf-8"
        )

    def crowns(self) -> dict[str, dict]:
        self.module.write_crowns()
        data = json.loads(
            (self.processed / "tree_crowns_pilot.slim.geojson").read_text(encoding="utf-8")
        )
        return {f["id"]: f for f in data["features"]}

    def test_crown_export_runs_and_carries_growth_form(self) -> None:
        # Regression guard: this path was previously never exercised, because
        # the fixture had no crown intermediate for it to slim.
        self.write_crown_intermediate()
        crowns = self.crowns()
        self.assertIn("crowned", crowns)
        props = crowns["crowned"]["properties"]
        self.assertEqual(props["growth_form"], "conifer")
        self.assertEqual(props["growth_form_confidence"], "model_inferred")
        self.assertEqual(props["total_value_nzd_y"], 195.0)
        self.assertEqual(crowns["crowned"]["geometry"]["type"], "Polygon")

    def test_crowns_without_a_tree_row_are_dropped(self) -> None:
        # Root shapes shipped 151,764 polygons for deleted trees by keeping
        # exactly these. The slimmer must not.
        self.write_crown_intermediate()
        self.assertNotIn("deleted_phantom", self.crowns())

    def test_crown_export_is_skipped_when_the_intermediate_is_absent(self) -> None:
        self.module.write_crowns()
        self.assertFalse((self.processed / "tree_crowns_pilot.slim.geojson").exists())

    def test_optional_tables_may_be_absent(self) -> None:
        # A database built before the remediation has neither table; the export
        # must still succeed rather than fail the whole web build.
        with sqlite3.connect(self.processed / "akl_trees.sqlite") as conn:
            conn.execute("DROP TABLE tree_species_attributes")
            conn.execute("DROP TABLE tree_valuation_scenarios")
        props = self.points()
        self.assertEqual(set(props), {"crowned", "crownless"})
        self.assertNotIn("growth_form", props["crowned"])


class StreamingGeoJsonReaderTests(unittest.TestCase):
    """The crown intermediate is a single multi-gigabyte line, so it is parsed
    incrementally. Features must survive chunk boundaries, escapes and unicode
    exactly, because a mis-parse here silently corrupts crown attributes."""

    def setUp(self) -> None:
        self.module = load_builder()
        self.features = [
            {
                "type": "Feature",
                "id": f"t{i}",
                # Braces, brackets and escaped quotes inside string values are
                # the case a naive brace counter gets wrong.
                "properties": {
                    "name": 'awkward {"} [ ] \\" value' if i % 7 == 0 else f"n{i}",
                    "note": "pohutukawa 🌳 \\\\ backslash" if i % 5 == 0 else None,
                    "n": i,
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[174.7 + i * 1e-5, -36.8], [174.8, -36.9], [174.7, -36.8]]],
                },
            }
            for i in range(200)
        ]
        self.document = {
            "type": "FeatureCollection",
            # An object in the envelope before "features" must not be mistaken
            # for the first feature.
            "crs": {"type": "name"},
            "features": self.features,
        }

    def write(self, tmp: Path, **dump_kwargs) -> Path:
        path = tmp / "crowns.geojson"
        path.write_text(json.dumps(self.document, **dump_kwargs), encoding="utf-8")
        return path

    def test_features_survive_every_chunk_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(Path(tmp), separators=(",", ":"))
            for chunk_size in (16, 64, 997, 1 << 20):
                parsed = list(self.module.iter_geojson_features(path, chunk_size=chunk_size))
                self.assertEqual(parsed, self.features, f"chunk_size={chunk_size}")

    def test_pretty_printed_input_parses(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(Path(tmp), indent=2)
            parsed = list(self.module.iter_geojson_features(path, chunk_size=101))
            self.assertEqual(parsed, self.features)

    def test_writer_removes_a_partial_file_on_failure(self) -> None:
        # A truncated but syntactically plausible collection would otherwise be
        # tiled and deployed as if it were complete.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "partial.geojson"
            with self.assertRaises(RuntimeError):
                with self.module.FeatureWriter(out) as writer:
                    writer.add(self.features[0])
                    raise RuntimeError("interrupted")
            self.assertFalse(out.exists())

    def test_writer_round_trips_through_the_reader(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "written.geojson"
            with self.module.FeatureWriter(out) as writer:
                for feature in self.features:
                    writer.add(feature)
            self.assertEqual(writer.count, len(self.features))
            self.assertEqual(
                json.loads(out.read_text(encoding="utf-8"))["features"], self.features
            )
            self.assertEqual(list(self.module.iter_geojson_features(out)), self.features)


if __name__ == "__main__":
    unittest.main()
