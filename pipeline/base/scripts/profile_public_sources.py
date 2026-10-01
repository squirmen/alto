#!/usr/bin/env python3
"""Profile downloaded public tree source snapshots."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ARCGIS_ROOT = ROOT / "data" / "raw" / "arcgis"


def read_geojson(slug: str) -> dict[str, Any]:
    return json.loads((ARCGIS_ROOT / slug / "features_4326.geojson").read_text(encoding="utf-8"))


def top_values(features: list[dict[str, Any]], field: str, n: int = 10) -> list[tuple[str, int]]:
    counter = Counter()
    for feature in features:
        value = feature.get("properties", {}).get(field)
        label = str(value).strip() if value is not None else "Blank"
        if not label:
            label = "Blank"
        counter[label] += 1
    return [(label, count) for label, count in counter.most_common(n)]


def point_bbox(features: list[dict[str, Any]]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") == "Point":
            x, y = geometry["coordinates"]
            xs.append(x)
            ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def markdown_table(rows: list[tuple[str, int]]) -> str:
    lines = ["| Value | Count |", "| --- | ---: |"]
    lines.extend(f"| {value} | {count:,} |" for value, count in rows)
    return "\n".join(lines)


def build_report() -> str:
    tree_register = read_geojson("tree_register_points")["features"]
    notable = read_geojson("notable_trees_overlay")["features"]
    notable_groups = read_geojson("notable_group_trees_overlay")["features"]
    kauri = read_geojson("ruru_obskauri_tiaki_public")["features"]

    tree_ids = [feature["properties"].get("TreeID") for feature in tree_register]
    bbox = point_bbox(tree_register)

    lines = [
        f"# Public Source Profile - {date.today().isoformat()}",
        "",
        "## Feature Counts",
        "",
        "| Source | Features |",
        "| --- | ---: |",
        f"| tree_register_points | {len(tree_register):,} |",
        f"| notable_trees_overlay | {len(notable):,} |",
        f"| notable_group_trees_overlay | {len(notable_groups):,} |",
        f"| ruru_obskauri_tiaki_public | {len(kauri):,} |",
        "",
        "## TreeRegisterPoints",
        "",
        f"- Unique TreeID values: {len(set(tree_ids)):,}.",
        f"- Duplicate TreeID values: {len(tree_ids) - len(set(tree_ids)):,}.",
        f"- Missing TreeID values: {sum(not value for value in tree_ids):,}.",
        f"- Bounding box: lon {bbox[0]:.6f} to {bbox[2]:.6f}, lat {bbox[1]:.6f} to {bbox[3]:.6f}.",
        "",
        "### Tree Owner",
        "",
        markdown_table(top_values(tree_register, "TreeOwner", 20)),
        "",
        "### Common Name",
        "",
        markdown_table(top_values(tree_register, "TreeCommon", 20)),
        "",
        "### Latin Name",
        "",
        markdown_table(top_values(tree_register, "TreeLatin", 20)),
        "",
        "## Notable Trees",
        "",
        "### Name",
        "",
        markdown_table(top_values(notable, "NAME", 20)),
        "",
        "### Type Code",
        "",
        markdown_table(top_values(notable, "TYPE", 20)),
        "",
        "## Kauri Survey",
        "",
        "### KDB Field Status Code",
        "",
        markdown_table(top_values(kauri, "KDBFieldStatus", 20)),
        "",
        "### Soil Sample Result",
        "",
        markdown_table(top_values(kauri, "SoilSampleResult", 20)),
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, help="Optional markdown output path.")
    args = parser.parse_args()

    report = build_report()
    if args.output:
        path = args.output if args.output.is_absolute() else ROOT / args.output
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(report + "\n", encoding="utf-8")
        print(f"Wrote {path}")
    else:
        print(report)


if __name__ == "__main__":
    main()
