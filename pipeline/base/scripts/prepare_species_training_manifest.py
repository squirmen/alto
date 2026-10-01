#!/usr/bin/env python3
"""Prepare a leakage-resistant weak-label manifest for taxonomic modelling.

This script does not create independent ground truth. It cleans existing inventory
labels, separates exact species from genus-only labels, assigns geographically
buffered data splits, and records crown/LiDAR/high-resolution-imagery eligibility.
The output is read-only with respect to the canonical SQLite database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
DEFAULT_OUTPUT = ROOT / "outputs" / "hpc" / "species_training_manifest.parquet"
LINZ_URBAN_LAYER_ID = 121752
LINZ_URBAN_GSD_M = 0.075

UNKNOWN_TOKENS = {"", "unknown", "unidentified", "not identified", "n/a", "na", "none"}
GENUS_RE = re.compile(r"^[A-Z][A-Za-z-]+$")
SPECIES_RE = re.compile(r"^([A-Z][A-Za-z-]+)\s+((?:x\s+|×\s*)?[a-z][A-Za-z-]+)$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_taxon(value: object) -> tuple[str | None, str | None, str]:
    """Return (genus, species, scope) without inventing precision."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None, None, "unknown"
    text = " ".join(str(value).replace("_", " ").split()).strip(" .")
    if text.lower() in UNKNOWN_TOKENS:
        return None, None, "unknown"
    text = re.sub(r"\s+(?:cf\.|aff\.).*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+(?:subsp\.|ssp\.|var\.).*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+['\"].*['\"]$", "", text)
    tokens = text.split()
    if len(tokens) >= 2 and tokens[1].lower() in {"sp", "sp.", "spp", "spp."}:
        genus = tokens[0] if GENUS_RE.fullmatch(tokens[0]) else None
        return genus, None, "genus_only" if genus else "unknown"
    candidate = " ".join(tokens[:3] if len(tokens) > 1 and tokens[1] in {"x", "×"} else tokens[:2])
    match = SPECIES_RE.fullmatch(candidate)
    if match:
        genus = match.group(1)
        epithet = match.group(2).replace("×", "x ").replace("  ", " ")
        return genus, f"{genus} {epithet}", "species_exact"
    if tokens and GENUS_RE.fullmatch(tokens[0]):
        return tokens[0], None, "genus_only"
    return None, None, "unknown"


def block_split(block_x: int, block_y: int, seed: int) -> str:
    digest = hashlib.sha256(f"{seed}:{block_x}:{block_y}".encode()).digest()
    value = int.from_bytes(digest[:8], "big") / 2**64
    if value < 0.70:
        return "train"
    if value < 0.85:
        return "calibration"
    return "test"


def assign_spatial_splits(
    frame: pd.DataFrame,
    block_size_m: float,
    buffer_m: float,
    seed: int,
) -> pd.DataFrame:
    """Assign whole spatial blocks and exclude a boundary buffer from modelling."""
    result = frame.copy()
    x = result["approx_x_m"].astype(float)
    y = result["approx_y_m"].astype(float)
    bx = np.floor(x / block_size_m).astype("Int64")
    by = np.floor(y / block_size_m).astype("Int64")
    result["spatial_block"] = bx.astype(str) + "_" + by.astype(str)
    local_x = np.mod(x, block_size_m)
    local_y = np.mod(y, block_size_m)
    in_buffer = (
        (local_x < buffer_m)
        | (local_x > block_size_m - buffer_m)
        | (local_y < buffer_m)
        | (local_y > block_size_m - buffer_m)
    )
    result["spatial_buffer_excluded"] = in_buffer
    core_counts = result.loc[~in_buffer, "spatial_block"].value_counts().to_dict()
    blocks = sorted(
        result["spatial_block"].unique(),
        key=lambda block: (
            -core_counts.get(block, 0),
            hashlib.sha256(f"{seed}:{block}".encode()).hexdigest(),
        ),
    )
    total_core = sum(core_counts.values())
    fractions = {"train": 0.70, "calibration": 0.15, "test": 0.15}
    targets = {name: total_core * fraction for name, fraction in fractions.items()}
    assigned = {name: 0 for name in fractions}
    block_splits: dict[str, str] = {}
    for block in blocks:
        split = max(
            fractions,
            key=lambda name: (
                (targets[name] - assigned[name]) / max(targets[name], 1.0),
                hashlib.sha256(f"{seed}:{block}:{name}".encode()).hexdigest(),
            ),
        )
        block_splits[block] = split
        assigned[split] += core_counts.get(block, 0)
    result["split"] = result["spatial_block"].map(block_splits)
    result.loc[in_buffer, "split"] = "buffer_excluded"
    return result


def load_candidates(db: Path) -> pd.DataFrame:
    with sqlite3.connect(db) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        pointcloud_join = (
            "LEFT JOIN tree_pointcloud_pilot p ON p.tree_id=t.tree_id"
            if "tree_pointcloud_pilot" in tables
            else ""
        )
        pointcloud_columns = (
            {
                row[1]
                for row in connection.execute("PRAGMA table_info(tree_pointcloud_pilot)")
            }
            if "tree_pointcloud_pilot" in tables
            else set()
        )
        point_count_column = (
            "n_points_total" if "n_points_total" in pointcloud_columns else "n_points"
        )
        pointcloud_cols = (
            f"p.pointcloud_class, p.{point_count_column} AS point_count"
            if "tree_pointcloud_pilot" in tables
            else "NULL AS pointcloud_class, NULL AS point_count"
        )
        return pd.read_sql_query(
            f"""
            SELECT t.tree_id, t.source_primary, t.species_latin, t.species_confidence,
                   t.lon, t.lat, t.approx_x_m, t.approx_y_m,
                   c.crown_area_m2, c.crown_diameter_m, c.crown_max_chm_m,
                   {pointcloud_cols}
            FROM trees t
            LEFT JOIN tree_crown_pilot c ON c.tree_id=t.tree_id
            {pointcloud_join}
            WHERE t.species_latin IS NOT NULL
              AND TRIM(t.species_latin) <> ''
              AND t.approx_x_m IS NOT NULL AND t.approx_y_m IS NOT NULL
            """,
            connection,
        )


def prepare_manifest(
    candidates: pd.DataFrame,
    block_size_m: float = 2000.0,
    buffer_m: float = 200.0,
    seed: int = 42,
    min_species_samples: int = 40,
) -> pd.DataFrame:
    frame = candidates.copy()
    normalized = frame["species_latin"].map(normalize_taxon)
    frame[["genus", "taxon_species", "taxon_scope"]] = pd.DataFrame(
        normalized.tolist(), index=frame.index
    )

    # Surveillance observations are valuable occurrence records but are not a
    # representative or sufficiently clean supervised species-training source.
    accepted_confidence = frame["species_confidence"].isin({"source_species", "source_taxon"})
    frame["supervised_label_eligible"] = (
        accepted_confidence
        & frame["taxon_scope"].eq("species_exact")
        & ~frame["source_primary"].eq("ruru_obskauri_tiaki_public")
    )

    # Conflicting labels at effectively the same mapped location are excluded.
    frame["location_cell_1m"] = (
        frame["approx_x_m"].round().astype("Int64").astype(str)
        + "_"
        + frame["approx_y_m"].round().astype("Int64").astype(str)
    )
    species_per_cell = frame.groupby("location_cell_1m")["taxon_species"].transform("nunique")
    frame["spatial_label_conflict"] = species_per_cell.gt(1)
    frame["supervised_label_eligible"] &= ~frame["spatial_label_conflict"]

    frame = assign_spatial_splits(frame, block_size_m, buffer_m, seed)
    train_counts = (
        frame.loc[
            frame["supervised_label_eligible"] & frame["split"].eq("train"),
            "taxon_species",
        ]
        .value_counts()
        .to_dict()
    )
    frame["species_train_count"] = frame["taxon_species"].map(train_counts).fillna(0).astype(int)
    frame["species_model_eligible"] = (
        frame["supervised_label_eligible"]
        & frame["species_train_count"].ge(min_species_samples)
        & ~frame["split"].eq("buffer_excluded")
    )
    frame["genus_model_eligible"] = (
        frame["genus"].notna()
        & accepted_confidence
        & ~frame["spatial_label_conflict"]
        & ~frame["split"].eq("buffer_excluded")
    )
    frame["crown_mask_available"] = frame["crown_area_m2"].gt(0)
    frame["pointcloud_available"] = frame["pointcloud_class"].notna() & ~frame[
        "pointcloud_class"
    ].eq("no_data")
    frame["imagery_layer_id"] = LINZ_URBAN_LAYER_ID
    frame["imagery_gsd_m"] = LINZ_URBAN_GSD_M
    radius = frame["crown_diameter_m"].fillna(8.0).clip(lower=4.0, upper=40.0) * 0.75
    frame["chip_radius_m"] = radius.clip(lower=3.0, upper=24.0)
    frame["evidence_scope"] = "inventory_weak_label_not_independent_validation"
    return frame.sort_values(["split", "spatial_block", "tree_id"]).reset_index(drop=True)


def write_outputs(frame: pd.DataFrame, output: Path, parameters: dict[str, object]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.suffix.lower() == ".csv":
        frame.to_csv(output, index=False)
    else:
        frame.to_parquet(output, index=False)
    eligible = frame[frame["species_model_eligible"]]
    summary = {
        "generated_at_utc": utc_now(),
        "manifest": str(output),
        "parameters": parameters,
        "row_count": int(len(frame)),
        "species_model_eligible": int(frame["species_model_eligible"].sum()),
        "genus_model_eligible": int(frame["genus_model_eligible"].sum()),
        "spatial_conflicts_excluded": int(frame["spatial_label_conflict"].sum()),
        "buffer_rows_excluded": int(frame["spatial_buffer_excluded"].sum()),
        "eligible_species": sorted(eligible["taxon_species"].dropna().unique().tolist()),
        "split_counts": eligible["split"].value_counts().sort_index().to_dict(),
        "imagery": {
            "layer_id": LINZ_URBAN_LAYER_ID,
            "gsd_m": LINZ_URBAN_GSD_M,
            "crown_mask_required": True,
        },
        "validation_status": "weak_label_only_not_release_validation",
    }
    output.with_suffix(".summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--block-size-m", type=float, default=2000.0)
    parser.add_argument("--buffer-m", type=float, default=200.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--min-species-samples", type=int, default=40)
    args = parser.parse_args()
    if args.buffer_m * 2 >= args.block_size_m:
        raise SystemExit("--buffer-m must be less than half --block-size-m")
    candidates = load_candidates(args.db)
    parameters = {
        "block_size_m": args.block_size_m,
        "buffer_m": args.buffer_m,
        "seed": args.seed,
        "min_species_samples": args.min_species_samples,
    }
    manifest = prepare_manifest(candidates, **parameters)
    write_outputs(manifest, args.output, parameters)
    print(
        f"wrote {len(manifest):,} weak-label rows; "
        f"{manifest['species_model_eligible'].sum():,} species-eligible -> {args.output}"
    )


if __name__ == "__main__":
    main()
