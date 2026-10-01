from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def load_script(name: str):
    script = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MANIFEST = load_script("build_hpc_readiness_manifest")
RUNNER = load_script("run_hpc_benchmark_task")


def test_deterministic_sample_is_stable_and_spans_input() -> None:
    values = list(range(101))
    first = MANIFEST.deterministic_sample(values, 7)
    second = MANIFEST.deterministic_sample(values, 7)

    assert first == second
    assert first[0] == 0
    assert first[-1] == 100
    assert len(first) == 7
    assert MANIFEST.deterministic_sample(values, 0) == []


def test_inventory_full_hash_is_content_hash(tmp_path: Path) -> None:
    imagery = tmp_path / "imagery"
    imagery.mkdir()
    payload = b"not-an-image-but-valid-for-inventory"
    (imagery / "tile.jpg").write_bytes(payload)

    dataset = MANIFEST.inventory_root("imagery", imagery, 1, "full")

    assert dataset["file_count"] == 1
    assert dataset["files"][0]["integrity"] == {
        "algorithm": "sha256",
        "mode": "full_content",
        "value": hashlib.sha256(payload).hexdigest(),
        "content_verified": True,
    }


def test_las_header_density_uses_xy_header_extent(tmp_path: Path) -> None:
    laspy = pytest.importorskip("laspy")
    numpy = pytest.importorskip("numpy")
    path = tmp_path / "four_points.las"
    las = laspy.create(point_format=3, file_version="1.2")
    las.x = numpy.array([0.0, 10.0, 0.0, 10.0])
    las.y = numpy.array([0.0, 0.0, 10.0, 10.0])
    las.z = numpy.array([1.0, 2.0, 3.0, 4.0])
    las.write(path)

    header = MANIFEST.read_las_header(path)

    assert header["point_count"] == 4
    assert header["bbox"] == pytest.approx([0.0, 0.0, 10.0, 10.0])
    assert header["bbox_area_m2_assuming_projected_crs"] == pytest.approx(100.0)
    assert header["header_density_points_m2"] == pytest.approx(0.04)


def test_manifest_and_scaffold_are_read_only_and_fail_closed(tmp_path: Path) -> None:
    laspy = pytest.importorskip("laspy")
    numpy = pytest.importorskip("numpy")
    point_root = tmp_path / "point_cloud"
    imagery_root = tmp_path / "imagery"
    raster_root = tmp_path / "rasters"
    model_root = tmp_path / "models"
    for root in (point_root, imagery_root, raster_root, model_root):
        root.mkdir()

    las = laspy.create(point_format=3, file_version="1.2")
    las.x = numpy.array([0.0, 10.0])
    las.y = numpy.array([0.0, 10.0])
    las.z = numpy.array([2.0, 8.0])
    las.write(point_root / "tile.las")
    (imagery_root / "tile.jpg").write_bytes(b"imagery")
    (raster_root / "chm.tif").write_bytes(b"raster")
    (model_root / "weights.pt").write_bytes(b"weights")
    production_database = tmp_path / "akl_trees.sqlite"
    production_database.write_bytes(b"do-not-touch")
    before = production_database.stat()

    roots = {
        "point_cloud": [point_root],
        "imagery": [imagery_root],
        "raster": [raster_root],
        "model": [model_root],
    }
    manifest = MANIFEST.build_manifest(
        project_root=tmp_path,
        roots=roots,
        hash_mode="full",
        point_metadata="all",
        point_sample_size=1,
        run_id="unit-test",
    )
    output_dir = tmp_path / "outputs" / "unit-test"
    outputs = MANIFEST.write_outputs(output_dir, manifest)
    after = production_database.stat()

    assert manifest["production_database_accessed"] is False
    assert before.st_size == after.st_size
    assert before.st_mtime_ns == after.st_mtime_ns
    assert "git_worktree_clean" in manifest["readiness"]["blockers"]
    assert Path(outputs["manifest"]).is_file()
    assert Path(outputs["experiments"]).is_file()
    assert "#SBATCH --array=0-4" in Path(outputs["slurm_gpu"]).read_text()
    experiments = json.loads(Path(outputs["experiments"]).read_text())
    assert experiments["selection_gate"]["requires_independent_reference_labels"] is True
    assert all(
        candidate["command"] == ["REQUIRED_CONFIGURE_COMMAND"]
        for candidate in experiments["candidates"]
    )


def test_main_defaults_to_no_write(tmp_path: Path) -> None:
    roots = []
    for name in ("point", "imagery", "raster", "model"):
        root = tmp_path / name
        root.mkdir()
        roots.append(root)
    output = tmp_path / "must-not-exist"

    result = MANIFEST.main(
        [
            "--project-root",
            str(tmp_path),
            "--laz-root",
            str(roots[0]),
            "--imagery-root",
            str(roots[1]),
            "--raster-root",
            str(roots[2]),
            "--model-root",
            str(roots[3]),
            "--point-metadata",
            "none",
            "--output-dir",
            str(output),
        ]
    )

    assert result == 0
    assert not output.exists()


def ready_manifest(project_root: Path) -> dict:
    return {
        "schema_version": MANIFEST.SCHEMA_VERSION,
        "project_root": str(project_root),
        "production_database_accessed": False,
        "git": {"commit": "abc123"},
        "readiness": {
            "status": "ready_to_stage",
            "blockers": [],
            "checks": {
                "all_discovered_files_content_hashed": True,
                "all_point_cloud_headers_read": True,
            },
        },
    }


def runner_config(manifest_path: Path, command: list[str]) -> dict:
    return {
        "schema_version": RUNNER.EXPERIMENT_SCHEMA_VERSION,
        "input_manifest": str(manifest_path),
        "project_git_commit": "abc123",
        "output_root": "outputs/test",
        "candidates": [
            {
                "id": "cpu-test",
                "enabled": True,
                "scheduler_group": "cpu",
                "resources": {"gpus": 0},
                "command": command,
            }
        ],
    }


def test_runner_selects_valid_command_without_executing(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(ready_manifest(tmp_path)))
    config_path = tmp_path / "experiments.json"
    command = [sys.executable, "-c", "raise SystemExit(99)"]
    config_path.write_text(json.dumps(runner_config(manifest_path, command)))

    result = RUNNER.main(
        [
            "--config",
            str(config_path),
            "--scheduler-group",
            "cpu",
            "--array-index",
            "0",
        ]
    )

    assert result == 0


def test_runner_refuses_placeholders_and_incomplete_manifests(tmp_path: Path) -> None:
    manifest = ready_manifest(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    config_path = tmp_path / "experiments.json"
    config_path.write_text(
        json.dumps(runner_config(manifest_path, ["REQUIRED_CONFIGURE_COMMAND"]))
    )
    with pytest.raises(RUNNER.ConfigurationError, match="placeholder"):
        RUNNER.build_execution_plan(config_path, "cpu", 0, False)

    manifest["readiness"]["status"] = "incomplete"
    manifest["readiness"]["blockers"] = ["all_point_cloud_headers_read"]
    manifest_path.write_text(json.dumps(manifest))
    config_path.write_text(json.dumps(runner_config(manifest_path, [sys.executable, "-V"])))
    with pytest.raises(RUNNER.ConfigurationError, match="incomplete"):
        RUNNER.build_execution_plan(config_path, "cpu", 0, False)


def test_runner_refuses_scheduler_resource_mismatch(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(ready_manifest(tmp_path)))
    config = runner_config(manifest_path, [sys.executable, "-V"])
    config["candidates"][0]["resources"]["gpus"] = 1
    config_path = tmp_path / "experiments.json"
    config_path.write_text(json.dumps(config))

    with pytest.raises(RUNNER.ConfigurationError, match="CPU candidate.*requests a GPU"):
        RUNNER.build_execution_plan(config_path, "cpu", 0, False)
