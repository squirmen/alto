#!/usr/bin/env python3
"""Build a read-only, reproducible input manifest for HPC benchmark runs.

The default invocation is deliberately lightweight: it inventories files, computes a
metadata fingerprint, and reads a deterministic sample of LAS/LAZ headers.  A transfer
freeze must be created explicitly with ``--hash-mode full --point-metadata all --write``.

This script never opens or modifies ``akl_trees.sqlite``.  Its only writes are new files
under ``--output-dir``:

* ``input_manifest.json`` -- file inventory, integrity and point-cloud metadata;
* ``laz_coverage.geojson`` -- union of LAS/LAZ header rectangles when all headers are read;
* ``experiment_matrix.json`` -- benchmark candidates and reproducibility contract;
* ``slurm_cpu_array.sbatch`` / ``slurm_gpu_array.sbatch`` -- safe array-job scaffolds.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = "akl-trees-hpc-input-manifest/v1"
EXPERIMENT_SCHEMA_VERSION = "akl-trees-hpc-experiments/v1"
HASH_CHUNK_BYTES = 8 * 1024 * 1024

KIND_SUFFIXES = {
    "point_cloud": {".las", ".laz"},
    "imagery": {".tif", ".tiff", ".jp2", ".jpg", ".jpeg", ".png", ".vrt"},
    "raster": {".tif", ".tiff", ".vrt"},
    "model": {".pt", ".pth", ".ckpt", ".safetensors", ".onnx", ".engine"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path: Path, chunk_bytes: int = HASH_CHUNK_BYTES) -> str:
    """Return a full streaming SHA-256 without loading the file into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(chunk_bytes):
            digest.update(chunk)
    return digest.hexdigest()


def metadata_fingerprint(path: Path, relative_path: str) -> str:
    """Fast change detector; explicitly not a content-integrity hash."""
    stat = path.stat()
    payload = f"{relative_path}\0{stat.st_size}\0{stat.st_mtime_ns}".encode()
    return hashlib.sha256(payload).hexdigest()


def _walk_files(root: Path, suffixes: set[str]) -> list[Path]:
    """Discover regular files without following directory symlinks."""
    if root.is_file():
        return [root] if root.suffix.lower() in suffixes else []
    if not root.is_dir():
        return []
    paths: list[Path] = []
    for directory, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames.sort()
        for filename in sorted(filenames):
            path = Path(directory) / filename
            if path.suffix.lower() in suffixes and path.is_file():
                paths.append(path)
    return paths


def deterministic_sample(items: Sequence[Any], count: int) -> list[Any]:
    """Select an evenly distributed, deterministic sample including both endpoints."""
    if count <= 0 or not items:
        return []
    if count >= len(items):
        return list(items)
    if count == 1:
        return [items[len(items) // 2]]
    indices = {
        int(round(index * (len(items) - 1) / (count - 1)))
        for index in range(count)
    }
    return [items[index] for index in sorted(indices)]


def git_state(project_root: Path) -> dict[str, Any]:
    def run(*args: str) -> str | None:
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=project_root,
                check=True,
                capture_output=True,
                text=True,
            )
        except (OSError, subprocess.CalledProcessError):
            return None
        return result.stdout.strip()

    commit = run("rev-parse", "HEAD")
    status = run("status", "--porcelain=v1", "--untracked-files=normal")
    return {
        "commit": commit,
        "worktree_clean": status == "" if status is not None else None,
        "status_porcelain": status.splitlines() if status else [],
    }


def software_environment() -> dict[str, Any]:
    packages: dict[str, str | None] = {}
    for name in ("laspy", "lazrs", "numpy", "pyproj", "rasterio", "shapely"):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    return {
        "python": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "packages": packages,
    }


def read_las_header(path: Path) -> dict[str, Any]:
    """Read metadata only; LAZ point decompression is not performed."""
    try:
        import laspy
    except ImportError as exc:  # pragma: no cover - exercised when lidar extra absent
        raise RuntimeError("laspy is required for LAS/LAZ header metadata") from exc

    with laspy.open(path) as reader:
        header = reader.header
        mins = [float(value) for value in header.mins]
        maxs = [float(value) for value in header.maxs]
        width = max(0.0, maxs[0] - mins[0])
        height = max(0.0, maxs[1] - mins[1])
        area = width * height
        point_count = int(header.point_count)
        try:
            parsed_crs = header.parse_crs()
            crs = parsed_crs.to_string() if parsed_crs is not None else None
        except Exception:  # noqa: BLE001 - malformed/missing VLR should be recorded, not fatal
            crs = None
        return {
            "point_count": point_count,
            "point_format": int(header.point_format.id),
            "las_version": str(header.version),
            "bbox": [mins[0], mins[1], maxs[0], maxs[1]],
            "z_range": [mins[2], maxs[2]],
            "bbox_area_m2_assuming_projected_crs": area,
            "header_density_points_m2": point_count / area if area > 0 else None,
            "scales": [float(value) for value in header.scales],
            "offsets": [float(value) for value in header.offsets],
            "crs": crs,
        }


def _root_label(kind: str, root: Path, index: int) -> str:
    name = root.name or f"root_{index}"
    return f"{kind}_{index:02d}_{name}"


def inventory_root(
    kind: str,
    root: Path,
    index: int,
    hash_mode: str,
) -> dict[str, Any]:
    resolved = root.expanduser().resolve()
    exists = resolved.exists()
    files = _walk_files(resolved, KIND_SUFFIXES[kind]) if exists else []
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    base = resolved if resolved.is_dir() else resolved.parent

    for path in files:
        try:
            stat = path.stat()
            relative = path.relative_to(base).as_posix()
            if hash_mode == "full":
                integrity = {
                    "algorithm": "sha256",
                    "mode": "full_content",
                    "value": sha256_file(path),
                    "content_verified": True,
                }
            else:
                integrity = {
                    "algorithm": "sha256",
                    "mode": "path_size_mtime_metadata",
                    "value": metadata_fingerprint(path, relative),
                    "content_verified": False,
                }
            rows.append(
                {
                    "relative_path": relative,
                    "size_bytes": int(stat.st_size),
                    "mtime_ns": int(stat.st_mtime_ns),
                    "suffix": path.suffix.lower(),
                    "integrity": integrity,
                }
            )
        except (OSError, ValueError) as exc:
            errors.append({"path": str(path), "error": f"{type(exc).__name__}: {exc}"})

    rows.sort(key=lambda row: row["relative_path"])
    return {
        "dataset_id": _root_label(kind, resolved, index),
        "kind": kind,
        "root": str(resolved),
        "root_exists": exists,
        "suffixes": sorted(KIND_SUFFIXES[kind]),
        "file_count": len(rows),
        "total_bytes": sum(row["size_bytes"] for row in rows),
        "inventory_errors": errors,
        "files": rows,
    }


def attach_point_metadata(
    datasets: list[dict[str, Any]],
    mode: str,
    sample_size: int,
) -> dict[str, Any]:
    point_datasets = [dataset for dataset in datasets if dataset["kind"] == "point_cloud"]
    refs: list[tuple[dict[str, Any], dict[str, Any], Path]] = []
    for dataset in point_datasets:
        root = Path(dataset["root"])
        base = root if root.is_dir() else root.parent
        for row in dataset["files"]:
            refs.append((dataset, row, base / row["relative_path"]))
    refs.sort(key=lambda item: (item[0]["dataset_id"], item[1]["relative_path"]))

    if mode == "all":
        selected = refs
    elif mode == "sample":
        selected = deterministic_sample(refs, sample_size)
    else:
        selected = []

    failures: list[dict[str, str]] = []
    headers: list[dict[str, Any]] = []
    for dataset, row, path in selected:
        try:
            header = read_las_header(path)
            row["las_header"] = header
            headers.append(header)
        except Exception as exc:  # noqa: BLE001 - one corrupt tile must not abort the inventory
            error = f"{type(exc).__name__}: {exc}"
            row["las_header_error"] = error
            failures.append(
                {
                    "dataset_id": dataset["dataset_id"],
                    "relative_path": row["relative_path"],
                    "error": error,
                }
            )

    densities = [
        header["header_density_points_m2"]
        for header in headers
        if header["header_density_points_m2"] is not None
    ]
    point_counts = [header["point_count"] for header in headers]
    crs_counts = Counter(header["crs"] or "unknown" for header in headers)
    coverage = coverage_metadata(headers, complete=(mode == "all" and len(selected) == len(refs)))
    return {
        "mode": mode,
        "available_file_count": len(refs),
        "selected_header_count": len(selected),
        "successful_header_count": len(headers),
        "failed_header_count": len(failures),
        "failures": failures,
        "sample_is_deterministic_evenly_spaced": mode == "sample",
        "point_count_in_read_headers": sum(point_counts),
        "header_density_points_m2": distribution_summary(densities),
        "crs_counts": dict(sorted(crs_counts.items())),
        "coverage": coverage,
    }


def distribution_summary(values: Iterable[float]) -> dict[str, float | int | None]:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return {"n": 0, "min": None, "median": None, "max": None, "mean": None}
    middle = len(ordered) // 2
    median = (
        ordered[middle]
        if len(ordered) % 2
        else (ordered[middle - 1] + ordered[middle]) / 2
    )
    return {
        "n": len(ordered),
        "min": ordered[0],
        "median": median,
        "max": ordered[-1],
        "mean": sum(ordered) / len(ordered),
    }


def coverage_metadata(headers: list[dict[str, Any]], complete: bool) -> dict[str, Any]:
    if not headers:
        return {
            "status": "not_computed",
            "complete": False,
            "bounds": None,
            "sum_tile_bbox_area_m2": 0.0,
            "union_tile_bbox_area_m2": None,
            "geometry": None,
        }
    bounds = [header["bbox"] for header in headers]
    overall = [
        min(value[0] for value in bounds),
        min(value[1] for value in bounds),
        max(value[2] for value in bounds),
        max(value[3] for value in bounds),
    ]
    result: dict[str, Any] = {
        "status": "complete_header_rectangles" if complete else "sampled_header_rectangles",
        "complete": complete,
        "bounds": overall,
        "sum_tile_bbox_area_m2": sum(
            header["bbox_area_m2_assuming_projected_crs"] for header in headers
        ),
        "union_tile_bbox_area_m2": None,
        "geometry": None,
        "warning": "Header rectangles describe acquisition extents, not valid-point coverage.",
    }
    try:
        from shapely.geometry import box, mapping
        from shapely.ops import unary_union

        geometry = unary_union([box(*bbox) for bbox in bounds])
        result["union_tile_bbox_area_m2"] = float(geometry.area)
        result["geometry"] = mapping(geometry)
    except ImportError:  # pragma: no cover - Shapely is a declared project dependency
        result["status"] += "_no_shapely_union"
    return result


def _dataset_files(datasets: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [row for dataset in datasets if dataset["kind"] == kind for row in dataset["files"]]


def readiness_checks(
    datasets: list[dict[str, Any]],
    point_summary: dict[str, Any],
    git: dict[str, Any],
    hash_mode: str,
) -> dict[str, Any]:
    all_files = [row for dataset in datasets for row in dataset["files"]]
    inventory_errors = [error for dataset in datasets for error in dataset["inventory_errors"]]
    full_hashes = [
        row["integrity"]["value"]
        for row in all_files
        if row["integrity"]["mode"] == "full_content"
    ]
    duplicate_hashes = sorted(
        digest for digest, count in Counter(full_hashes).items() if count > 1
    )
    crs_known = {
        crs for crs in point_summary["crs_counts"] if crs != "unknown"
    }
    checks = {
        "point_cloud_files_present": bool(_dataset_files(datasets, "point_cloud")),
        "imagery_files_present": bool(_dataset_files(datasets, "imagery")),
        "raster_files_present": bool(_dataset_files(datasets, "raster")),
        "model_artifacts_present": bool(_dataset_files(datasets, "model")),
        "all_discovered_files_content_hashed": bool(all_files)
        and hash_mode == "full"
        and len(full_hashes) == len(all_files),
        "all_point_cloud_headers_read": point_summary["available_file_count"] > 0
        and point_summary["mode"] == "all"
        and point_summary["successful_header_count"] == point_summary["available_file_count"],
        "point_cloud_crs_single_known_value": len(crs_known) == 1
        and "unknown" not in point_summary["crs_counts"],
        "inventory_error_count": len(inventory_errors),
        "point_header_error_count": point_summary["failed_header_count"],
        "duplicate_full_content_hashes": duplicate_hashes,
        "git_commit_recorded": bool(git.get("commit")),
        "git_worktree_clean": git.get("worktree_clean"),
    }
    blockers = [
        name
        for name in (
            "point_cloud_files_present",
            "imagery_files_present",
            "raster_files_present",
            "model_artifacts_present",
            "all_discovered_files_content_hashed",
            "all_point_cloud_headers_read",
            "point_cloud_crs_single_known_value",
            "git_commit_recorded",
            "git_worktree_clean",
        )
        if not checks[name]
    ]
    if checks["inventory_error_count"]:
        blockers.append("inventory_errors")
    if checks["point_header_error_count"]:
        blockers.append("point_header_errors")
    return {
        "status": "ready_to_stage" if not blockers else "incomplete",
        "blockers": blockers,
        "checks": checks,
        "notes": [
            "Model selection still requires an independently labelled Auckland test set.",
            "Header density is total points divided by the XY header rectangle; it is not pulse density.",
            "A metadata fingerprint detects local changes but is not a transfer-integrity hash.",
        ],
    }


def default_roots(project_root: Path) -> dict[str, list[Path]]:
    point_root = Path(os.environ.get("AKL_TREES_PC_ROOT", project_root / "data/raw/point_cloud_2024"))
    return {
        "point_cloud": [point_root],
        "imagery": [
            project_root / "data/raw/linz/linz_auckland_urban_aerial_2024_2025",
            project_root / "data/raw/esri_world_imagery/tiles_z18",
        ],
        "raster": [project_root / "data/interim"],
        "model": [project_root / "models", project_root / "checkpoints"],
    }


def build_manifest(
    project_root: Path,
    roots: dict[str, list[Path]],
    hash_mode: str,
    point_metadata: str,
    point_sample_size: int,
    run_id: str,
) -> dict[str, Any]:
    datasets: list[dict[str, Any]] = []
    for kind in ("point_cloud", "imagery", "raster", "model"):
        for index, root in enumerate(roots.get(kind, []), start=1):
            datasets.append(inventory_root(kind, root, index, hash_mode))
    point_summary = attach_point_metadata(datasets, point_metadata, point_sample_size)
    git = git_state(project_root)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "generated_at_utc": utc_now(),
        "project_root": str(project_root.resolve()),
        "production_database_accessed": False,
        "git": git,
        "software_environment": software_environment(),
        "settings": {
            "hash_mode": hash_mode,
            "point_metadata": point_metadata,
            "point_sample_size": point_sample_size,
        },
        "datasets": datasets,
        "point_cloud_summary": point_summary,
    }
    manifest["readiness"] = readiness_checks(datasets, point_summary, git, hash_mode)
    return manifest


def experiment_scaffold(manifest: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    run_id = manifest["run_id"]
    candidates = [
        {
            "id": "pitfree_chm_watershed",
            "task": "tree_instance_segmentation",
            "family": "classical_chm",
            "scheduler_group": "cpu",
            "enabled": True,
            "resources": {"cpus": 16, "memory_gb": 64, "gpus": 0, "time": "08:00:00"},
            "command": ["REQUIRED_CONFIGURE_COMMAND"],
            "variants": ["native_resolution", "parameter_sensitivity"],
        },
        {
            "id": "segmentanytree_pretrained",
            "task": "tree_instance_segmentation",
            "family": "point_cloud_dl",
            "scheduler_group": "gpu",
            "enabled": True,
            "resources": {"cpus": 8, "memory_gb": 96, "gpus": 1, "time": "12:00:00"},
            "container_image": "REQUIRED_PINNED_IMAGE@sha256:REQUIRED",
            "command": ["REQUIRED_CONFIGURE_COMMAND"],
            "variants": ["published_weights_native_density", "density_robustness"],
        },
        {
            "id": "forainet_pretrained",
            "task": "tree_instance_segmentation",
            "family": "point_cloud_dl",
            "scheduler_group": "gpu",
            "enabled": True,
            "resources": {"cpus": 8, "memory_gb": 96, "gpus": 1, "time": "12:00:00"},
            "container_image": "REQUIRED_PINNED_IMAGE@sha256:REQUIRED",
            "command": ["REQUIRED_CONFIGURE_COMMAND"],
            "variants": ["published_weights_native_density", "density_robustness"],
        },
        {
            "id": "its_net_pretrained",
            "task": "tree_instance_segmentation",
            "family": "aerial_point_cloud_dl",
            "scheduler_group": "gpu",
            "enabled": True,
            "resources": {"cpus": 8, "memory_gb": 96, "gpus": 1, "time": "12:00:00"},
            "container_image": "REQUIRED_PINNED_IMAGE@sha256:REQUIRED",
            "command": ["REQUIRED_CONFIGURE_COMMAND"],
            "variants": ["published_weights_native_density", "density_robustness"],
        },
        {
            "id": "linz_rgb_instance_model",
            "task": "tree_crown_instance_segmentation",
            "family": "image_dl",
            "scheduler_group": "gpu",
            "enabled": True,
            "resources": {"cpus": 8, "memory_gb": 64, "gpus": 1, "time": "08:00:00"},
            "container_image": "REQUIRED_PINNED_IMAGE@sha256:REQUIRED",
            "command": ["REQUIRED_CONFIGURE_COMMAND"],
            "variants": ["deepforest_local_baseline", "mask2former_or_detr"],
        },
        {
            "id": "crown_masked_multimodal_taxonomy",
            "task": "growth_form_genus_species_classification",
            "family": "multimodal_dl",
            "scheduler_group": "gpu",
            "enabled": True,
            "resources": {"cpus": 8, "memory_gb": 96, "gpus": 1, "time": "12:00:00"},
            "container_image": "REQUIRED_PINNED_IMAGE@sha256:REQUIRED",
            "command": ["REQUIRED_CONFIGURE_COMMAND"],
            "variants": ["rgb_only", "rgb_plus_lidar", "open_set_abstention"],
        },
    ]
    return {
        "schema_version": EXPERIMENT_SCHEMA_VERSION,
        "run_id": run_id,
        "input_manifest": str(manifest_path),
        "input_manifest_readiness": manifest["readiness"]["status"],
        "project_git_commit": manifest["git"]["commit"],
        "crs": "EPSG:2193",
        "random_seeds": [42, 31415, 271828],
        "output_root": f"outputs/hpc_benchmarks/{run_id}",
        "selection_gate": {
            "requires_independent_reference_labels": True,
            "status": "blocked_until_reference_set_is_locked",
            "metrics": [
                "detection_precision_recall_f1",
                "matched_crown_iou",
                "over_under_segmentation",
                "macro_f1",
                "expected_calibration_error",
                "accuracy_coverage_curve",
            ],
            "strata": ["canopy_position", "height", "point_density", "land_use", "tile_edge"],
        },
        "reproducibility_requirements": {
            "pinned_container_digest": True,
            "content_hashed_inputs": True,
            "immutable_per_tile_outputs": True,
            "saved_checkpoint_and_config": True,
            "saved_spatial_split_and_seed": True,
            "workers_must_not_write_to_production_sqlite": True,
        },
        "candidates": candidates,
    }


def render_slurm(
    group: str,
    experiment_path: Path,
    project_root: Path,
    array_max: int,
) -> str:
    if group not in {"cpu", "gpu"}:
        raise ValueError(f"unsupported scheduler group: {group}")
    if array_max < 0:
        raise ValueError(f"no enabled candidates for scheduler group: {group}")
    gpu_line = "#SBATCH --gres=gpu:1\n" if group == "gpu" else ""
    return f"""#!/usr/bin/env bash
# Generated scaffold: review partition/account/resources before submission.
#SBATCH --job-name=akl-trees-{group}
#SBATCH --array=0-{array_max}
#SBATCH --cpus-per-task={8 if group == 'gpu' else 16}
#SBATCH --mem={96 if group == 'gpu' else 64}G
#SBATCH --time={"12:00:00" if group == "gpu" else "08:00:00"}
{gpu_line}#SBATCH --output=logs/hpc/%x-%A_%a.out

set -euo pipefail
PROJECT_ROOT={json.dumps(str(project_root))}
CONFIG={json.dumps(str(experiment_path))}
cd "$PROJECT_ROOT"
mkdir -p logs/hpc

# The runner refuses REQUIRED/TODO placeholders and does not use a shell for the
# configured command. This template is therefore safe to inspect before it is configured.
python scripts/run_hpc_benchmark_task.py \\
  --config "$CONFIG" \\
  --scheduler-group {group} \\
  --array-index "$SLURM_ARRAY_TASK_ID" \\
  --execute
"""


def write_outputs(output_dir: Path, manifest: dict[str, Any]) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=False)
    manifest_path = output_dir / "input_manifest.json"
    experiment_path = output_dir / "experiment_matrix.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    coverage = manifest["point_cloud_summary"]["coverage"]
    coverage_path = output_dir / "laz_coverage.geojson"
    if coverage.get("geometry") is not None:
        coverage_feature = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "run_id": manifest["run_id"],
                        "status": coverage["status"],
                        "complete": coverage["complete"],
                    },
                    "geometry": coverage["geometry"],
                }
            ],
        }
        coverage_path.write_text(json.dumps(coverage_feature), encoding="utf-8")

    experiments = experiment_scaffold(manifest, manifest_path)
    experiment_path.write_text(json.dumps(experiments, indent=2), encoding="utf-8")
    cpu_path = output_dir / "slurm_cpu_array.sbatch"
    gpu_path = output_dir / "slurm_gpu_array.sbatch"
    project_root = Path(manifest["project_root"])
    counts = Counter(
        candidate["scheduler_group"]
        for candidate in experiments["candidates"]
        if candidate.get("enabled", False)
    )
    cpu_path.write_text(
        render_slurm("cpu", experiment_path, project_root, counts["cpu"] - 1),
        encoding="utf-8",
    )
    gpu_path.write_text(
        render_slurm("gpu", experiment_path, project_root, counts["gpu"] - 1),
        encoding="utf-8",
    )
    return {
        "manifest": str(manifest_path),
        "coverage": str(coverage_path) if coverage_path.exists() else "not_written",
        "experiments": str(experiment_path),
        "slurm_cpu": str(cpu_path),
        "slurm_gpu": str(gpu_path),
    }


def _add_roots(parser: argparse.ArgumentParser, flag: str, help_text: str) -> None:
    parser.add_argument(flag, action="append", type=Path, default=None, help=help_text)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=ROOT)
    _add_roots(parser, "--laz-root", "LAS/LAZ root; repeat for multiple volumes")
    _add_roots(parser, "--imagery-root", "Imagery root; repeat for multiple sources")
    _add_roots(parser, "--raster-root", "CHM/DSM/DEM/greenness root; repeat as needed")
    _add_roots(parser, "--model-root", "Model/checkpoint root; repeat as needed")
    parser.add_argument("--hash-mode", choices=("stat", "full"), default="stat")
    parser.add_argument(
        "--point-metadata", choices=("none", "sample", "all"), default="sample"
    )
    parser.add_argument("--point-sample-size", type=int, default=32)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument(
        "--write",
        action="store_true",
        help="write a new output directory; default is a no-write dry run",
    )
    parser.add_argument("--dry-run", action="store_true", help="explicit alias for no writes")
    parser.add_argument("--strict", action="store_true", help="exit 2 unless ready_to_stage")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    project_root = args.project_root.expanduser().resolve()
    roots = default_roots(project_root)
    overrides = {
        "point_cloud": args.laz_root,
        "imagery": args.imagery_root,
        "raster": args.raster_root,
        "model": args.model_root,
    }
    for kind, override in overrides.items():
        if override is not None:
            roots[kind] = override

    short_sha = (git_state(project_root).get("commit") or "nogit")[:10]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = args.run_id or f"hpc-readiness-{stamp}-{short_sha}"
    manifest = build_manifest(
        project_root=project_root,
        roots=roots,
        hash_mode=args.hash_mode,
        point_metadata=args.point_metadata,
        point_sample_size=max(0, args.point_sample_size),
        run_id=run_id,
    )

    summary = {
        "run_id": run_id,
        "status": manifest["readiness"]["status"],
        "blockers": manifest["readiness"]["blockers"],
        "dataset_counts": {
            dataset["dataset_id"]: dataset["file_count"]
            for dataset in manifest["datasets"]
        },
        "point_cloud_summary": {
            key: manifest["point_cloud_summary"][key]
            for key in (
                "available_file_count",
                "selected_header_count",
                "successful_header_count",
                "failed_header_count",
                "header_density_points_m2",
            )
        },
        "write_mode": bool(args.write and not args.dry_run),
    }
    if args.write and not args.dry_run:
        output_dir = args.output_dir or project_root / "outputs/hpc_readiness" / run_id
        summary["outputs"] = write_outputs(output_dir.expanduser().resolve(), manifest)
    print(json.dumps(summary, indent=2))
    if args.strict and manifest["readiness"]["status"] != "ready_to_stage":
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
