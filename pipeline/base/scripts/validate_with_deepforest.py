#!/usr/bin/env python3
"""Stage 2 validation: compare CHM-based detection against DeepForest.

DeepForest (Weecology) is a pretrained tree-crown detector trained on US
NEON aerial imagery. It will not be perfectly calibrated to Auckland's
canopy but it's the strongest off-the-shelf benchmark we can run without
training new ML. We sample a handful of 256 m × 256 m blocks across the
pilot, load the matching mosaic from the cached Esri World Imagery tiles,
ask DeepForest to draw bounding boxes, then compare those counts with our
own crowns (from ``tree_crown_pilot``).

The output is a small reproducibility report, not a replacement for our
detection pipeline.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
from deepforest import main as df_main  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
TILE_DIR = ROOT / "data" / "raw" / "esri_world_imagery" / "tiles_z18"
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"

from _pilot_config import DEFAULT_PILOT_BBOX_2193  # noqa: E402
TILE_ZOOM = 18
TILE_SIZE = 256


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def tile_xy_to_lonlat(x: int, y: int, zoom: int) -> tuple[float, float]:
    n = 2 ** zoom
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def lonlat_to_tile_xy(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    sin_lat = math.sin(math.radians(lat))
    y = int((1 - math.log((1 + sin_lat) / (1 - sin_lat)) / (2 * math.pi)) / 2 * n)
    return x, y


def pilot_tile_range(bbox_2193: tuple[float, float, float, float], zoom: int) -> tuple[int, int, int, int]:
    from pyproj import Transformer
    tf = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    xmin, ymin, xmax, ymax = bbox_2193
    corners = [
        tf.transform(xmin, ymin),
        tf.transform(xmax, ymin),
        tf.transform(xmin, ymax),
        tf.transform(xmax, ymax),
    ]
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    tx_min, ty_max = lonlat_to_tile_xy(min(lons), min(lats), zoom)
    tx_max, ty_min = lonlat_to_tile_xy(max(lons), max(lats), zoom)
    return min(tx_min, tx_max), min(ty_min, ty_max), max(tx_min, tx_max), max(ty_min, ty_max)


def load_tile(x: int, y: int) -> np.ndarray | None:
    path = TILE_DIR / f"{TILE_ZOOM}_{x}_{y}.jpg"
    if not path.exists():
        return None
    try:
        with Image.open(path) as image:
            return np.array(image.convert("RGB"))
    except Exception:
        return None


def tile_bounds_2193(x: int, y: int) -> tuple[float, float, float, float]:
    from pyproj import Transformer
    tf = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    nw_lon, nw_lat = tile_xy_to_lonlat(x, y, TILE_ZOOM)
    se_lon, se_lat = tile_xy_to_lonlat(x + 1, y + 1, TILE_ZOOM)
    nw_x, nw_y = tf.transform(nw_lon, nw_lat)
    se_x, se_y = tf.transform(se_lon, se_lat)
    return (
        min(nw_x, se_x),
        min(nw_y, se_y),
        max(nw_x, se_x),
        max(nw_y, se_y),
    )


def our_crowns_in_bbox(bbox_2193: tuple[float, float, float, float]) -> int:
    """Count crowns whose seed point falls in the bbox."""
    from pyproj import Transformer
    tf = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        rows = conn.execute(
            """
            SELECT t.lon, t.lat
            FROM tree_crown_pilot c
            JOIN trees t ON t.tree_id = c.tree_id
            """
        ).fetchall()
    finally:
        conn.close()
    xmin, ymin, xmax, ymax = bbox_2193
    count = 0
    for lon, lat in rows:
        x, y = tf.transform(lon, lat)
        if xmin <= x < xmax and ymin <= y < ymax:
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()

    print("Loading DeepForest pretrained tree-crown model...")
    deep = df_main.deepforest()
    deep.load_model(model_name="weecology/deepforest-tree", revision="main")

    tx_min, ty_min, tx_max, ty_max = pilot_tile_range(DEFAULT_PILOT_BBOX_2193, TILE_ZOOM)
    print(f"Tile range: x [{tx_min}..{tx_max}], y [{ty_min}..{ty_max}]")

    rng = random.Random(args.seed)
    all_tiles = [(x, y) for x in range(tx_min, tx_max + 1) for y in range(ty_min, ty_max + 1)]
    rng.shuffle(all_tiles)

    sampled = []
    rows = []
    for x, y in all_tiles:
        tile = load_tile(x, y)
        if tile is None:
            continue
        bbox = tile_bounds_2193(x, y)

        # DeepForest expects a numpy uint8 RGB image (HWC).
        df_predictions = deep.predict_image(image=tile)
        df_count = 0 if df_predictions is None or len(df_predictions) == 0 else int(len(df_predictions))

        our_count = our_crowns_in_bbox(bbox)
        sampled.append((x, y, bbox, df_count, our_count))
        rows.append(
            {
                "tile_x": x,
                "tile_y": y,
                "bbox_xmin": bbox[0],
                "bbox_ymin": bbox[1],
                "bbox_xmax": bbox[2],
                "bbox_ymax": bbox[3],
                "deepforest_count": df_count,
                "our_count": our_count,
                "abs_diff": abs(df_count - our_count),
                "ratio_ours_to_df": (our_count / df_count) if df_count else None,
            }
        )
        print(f"  tile {len(sampled):,}/{args.samples}: DeepForest {df_count} vs ours {our_count}")
        if len(sampled) >= args.samples:
            break

    df = pd.DataFrame(rows)
    csv_path = PROCESSED_ROOT / "deepforest_vs_chm_validation.csv"
    df.to_csv(csv_path, index=False)

    total_df = int(df["deepforest_count"].sum())
    total_ours = int(df["our_count"].sum())
    median_ratio = float(df["ratio_ours_to_df"].median(skipna=True)) if df["ratio_ours_to_df"].notna().any() else float("nan")
    mean_abs_diff = float(df["abs_diff"].mean())
    correlation = float(df[["deepforest_count", "our_count"]].corr().iloc[0, 1])

    lines = [
        "# Stage 2 Validation: DeepForest vs CHM-based Detection",
        "",
        f"Generated at: {utc_now()}",
        "",
        "## What This Tests",
        "",
        "Stage 2 doesn't replace our pipeline — it benchmarks it. We sample random 256 m × 256 m blocks from the pilot, run the Weecology DeepForest pretrained tree-crown detector against the matching cached aerial mosaic, then count the crowns our CHM + greenness pipeline assigned in the same block. Ratios > 1 mean our pipeline over-detects, ratios < 1 mean it under-detects, relative to DeepForest.",
        "",
        "DeepForest was trained on US NEON aerial imagery; it may under-recall NZ-native canopy and under-detect dense forest interiors. Treat as a sanity check, not ground truth.",
        "",
        "## Results",
        "",
        f"- Samples taken: {len(df):,} tiles ({TILE_SIZE} × {TILE_SIZE} px each at z=18).",
        f"- DeepForest total detections: {total_df:,}.",
        f"- Our pipeline total crowns in same tiles: {total_ours:,}.",
        f"- Median ratio (ours / DeepForest): {median_ratio:.2f}.",
        f"- Mean absolute difference per tile: {mean_abs_diff:.1f}.",
        f"- Pearson correlation of per-tile counts: {correlation:.3f}.",
        "",
        "## Per-tile counts (head)",
        "",
        "| tile_x | tile_y | DeepForest | Ours | |Δ| |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for row in rows[:25]:
        lines.append(f"| {row['tile_x']} | {row['tile_y']} | {row['deepforest_count']} | {row['our_count']} | {row['abs_diff']} |")
    lines.extend([
        "",
        "## Interpretation",
        "",
        "- High Pearson correlation suggests both methods agree on which tiles have more trees, even if absolute counts differ.",
        "- A ratio above 1.0 indicates our LiDAR-derived pipeline picks up more crowns per tile (often the case in dense canopy where DeepForest under-segments).",
        "- A ratio below 1.0 in residential blocks suggests we miss isolated garden trees DeepForest can see directly in the aerial.",
        "",
        f"Per-tile CSV: `{csv_path.relative_to(ROOT)}`",
    ])
    (DOCS_ROOT / "deepforest_validation.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"DeepForest total: {total_df}, ours: {total_ours}, median ratio: {median_ratio:.2f}, corr: {correlation:.3f}")


if __name__ == "__main__":
    main()
