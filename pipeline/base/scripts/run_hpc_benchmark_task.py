#!/usr/bin/env python3
"""Select and safely run one configured HPC benchmark-array task.

The runner is fail-closed: it refuses placeholder commands, incomplete input manifests,
unhashed inputs, unpinned container placeholders and any manifest that claims production
database access. Commands are passed directly to ``subprocess.run`` without a shell.
The default is inspection only; execution requires ``--execute``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence


EXPERIMENT_SCHEMA_VERSION = "akl-trees-hpc-experiments/v1"
MANIFEST_SCHEMA_VERSION = "akl-trees-hpc-input-manifest/v1"
PLACEHOLDER = re.compile(r"(?:REQUIRED|TODO|REPLACE_ME|CONFIGURE)", re.IGNORECASE)


class ConfigurationError(ValueError):
    """Raised when a benchmark configuration is unsafe or incomplete."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigurationError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ConfigurationError(f"expected a JSON object in {path}")
    return value


def resolve_reference(value: str, relative_to: Path) -> Path:
    path = Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (relative_to / path).resolve()


def enabled_candidates(config: dict[str, Any], scheduler_group: str) -> list[dict[str, Any]]:
    raw_candidates = config.get("candidates")
    if not isinstance(raw_candidates, list):
        raise ConfigurationError("config.candidates must be a list")
    candidates = [
        candidate
        for candidate in raw_candidates
        if isinstance(candidate, dict)
        and candidate.get("enabled") is True
        and candidate.get("scheduler_group") == scheduler_group
    ]
    if not candidates:
        raise ConfigurationError(
            f"no enabled candidates for scheduler group {scheduler_group!r}"
        )
    return candidates


def candidate_for_index(
    config: dict[str, Any], scheduler_group: str, array_index: int
) -> dict[str, Any]:
    candidates = enabled_candidates(config, scheduler_group)
    if not 0 <= array_index < len(candidates):
        raise ConfigurationError(
            f"array index {array_index} is outside 0..{len(candidates) - 1} "
            f"for {scheduler_group}"
        )
    return candidates[array_index]


def validate_candidate(candidate: dict[str, Any], scheduler_group: str) -> list[str]:
    candidate_id = candidate.get("id")
    if not isinstance(candidate_id, str) or not candidate_id.strip():
        raise ConfigurationError("candidate.id must be a non-empty string")
    command = candidate.get("command")
    if (
        not isinstance(command, list)
        or not command
        or not all(isinstance(argument, str) and argument for argument in command)
    ):
        raise ConfigurationError(f"candidate {candidate_id!r} must define a command list")
    inspected = command + [str(candidate.get("container_image", ""))]
    if any(PLACEHOLDER.search(value) for value in inspected):
        raise ConfigurationError(
            f"candidate {candidate_id!r} still contains a REQUIRED/TODO placeholder"
        )

    resources = candidate.get("resources")
    if not isinstance(resources, dict):
        raise ConfigurationError(f"candidate {candidate_id!r} has no resources object")
    gpu_count = resources.get("gpus")
    if not isinstance(gpu_count, int) or gpu_count < 0:
        raise ConfigurationError(f"candidate {candidate_id!r} has an invalid GPU count")
    if scheduler_group == "gpu" and gpu_count < 1:
        raise ConfigurationError(f"GPU candidate {candidate_id!r} requests no GPU")
    if scheduler_group == "cpu" and gpu_count != 0:
        raise ConfigurationError(f"CPU candidate {candidate_id!r} requests a GPU")
    return command


def validate_manifest(
    manifest: dict[str, Any], config: dict[str, Any], allow_incomplete: bool
) -> None:
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise ConfigurationError("unsupported or missing input-manifest schema_version")
    if manifest.get("production_database_accessed") is not False:
        raise ConfigurationError("input manifest does not attest read-only DB isolation")
    readiness = manifest.get("readiness")
    if not isinstance(readiness, dict):
        raise ConfigurationError("input manifest has no readiness object")
    if readiness.get("status") != "ready_to_stage" and not allow_incomplete:
        blockers = readiness.get("blockers", [])
        raise ConfigurationError(f"input manifest is incomplete; blockers={blockers!r}")
    checks = readiness.get("checks", {})
    if not allow_incomplete and checks.get("all_discovered_files_content_hashed") is not True:
        raise ConfigurationError("input files do not have full content hashes")
    if not allow_incomplete and checks.get("all_point_cloud_headers_read") is not True:
        raise ConfigurationError("not all point-cloud headers were read")

    manifest_commit = manifest.get("git", {}).get("commit")
    config_commit = config.get("project_git_commit")
    if manifest_commit != config_commit:
        raise ConfigurationError("experiment and input-manifest git commits differ")


def build_execution_plan(
    config_path: Path,
    scheduler_group: str,
    array_index: int,
    allow_incomplete_manifest: bool,
) -> tuple[dict[str, Any], list[str], Path]:
    config_path = config_path.expanduser().resolve()
    config = load_json(config_path)
    if config.get("schema_version") != EXPERIMENT_SCHEMA_VERSION:
        raise ConfigurationError("unsupported or missing experiment schema_version")
    candidate = candidate_for_index(config, scheduler_group, array_index)
    command = validate_candidate(candidate, scheduler_group)

    manifest_value = config.get("input_manifest")
    if not isinstance(manifest_value, str) or not manifest_value:
        raise ConfigurationError("config.input_manifest must be a path string")
    manifest_path = resolve_reference(manifest_value, config_path.parent)
    manifest = load_json(manifest_path)
    validate_manifest(manifest, config, allow_incomplete_manifest)

    project_root = Path(manifest.get("project_root", "")).expanduser().resolve()
    if not project_root.is_dir():
        raise ConfigurationError(f"project root does not exist: {project_root}")
    output_root = config.get("output_root")
    if not isinstance(output_root, str) or not output_root:
        raise ConfigurationError("config.output_root must be a non-empty path string")
    return candidate, command, project_root


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--scheduler-group", choices=("cpu", "gpu"), required=True)
    parser.add_argument("--array-index", type=int, required=True)
    parser.add_argument(
        "--allow-incomplete-manifest",
        action="store_true",
        help="explicit development override; never use for a frozen production run",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="execute the selected command; default only prints the validated plan",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        candidate, command, project_root = build_execution_plan(
            config_path=args.config,
            scheduler_group=args.scheduler_group,
            array_index=args.array_index,
            allow_incomplete_manifest=args.allow_incomplete_manifest,
        )
    except ConfigurationError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2

    plan = {
        "candidate_id": candidate["id"],
        "scheduler_group": args.scheduler_group,
        "array_index": args.array_index,
        "project_root": str(project_root),
        "command": shlex.join(command),
        "execute": args.execute,
    }
    print(json.dumps(plan, indent=2))
    if not args.execute:
        return 0

    environment = os.environ.copy()
    environment["AKL_TREES_BENCHMARK_ID"] = candidate["id"]
    result = subprocess.run(command, cwd=project_root, env=environment, check=False)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
