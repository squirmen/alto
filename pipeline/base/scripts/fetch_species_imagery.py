#!/usr/bin/env python3
"""Plan or download LINZ 7.5 cm imagery for weak-label species modelling.

Planning is the default and needs no API key. ``--download`` is resumable and
uses ``LINZ_API_KEY`` from the environment or project ``.env`` without writing
the key into manifests or logs.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pandas as pd
import requests
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "outputs" / "hpc" / "species_training_manifest.parquet"
DEFAULT_OUTPUT = ROOT / "data" / "raw" / "linz_urban_imagery" / "tiles_z21"
DEFAULT_PLAN = ROOT / "outputs" / "hpc" / "species_imagery_tile_plan.json"
LAYER_ID = 121752
ZOOM = 21
TILE_SIZE = 256


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_key() -> str:
    key = os.environ.get("LINZ_API_KEY")
    if not key and (ROOT / ".env").exists():
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("LINZ_API_KEY="):
                key = line.split("=", 1)[1].strip()
                break
    if not key:
        raise RuntimeError("LINZ_API_KEY is required only with --download")
    return key


def lonlat_to_world_pixel(lon: float, lat: float, zoom: int = ZOOM) -> tuple[float, float]:
    latitude = max(-85.05112878, min(85.05112878, lat))
    scale = (2**zoom) * TILE_SIZE
    x = (lon + 180.0) / 360.0 * scale
    sin_lat = math.sin(math.radians(latitude))
    y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * scale
    return x, y


def meters_per_pixel(lat: float, zoom: int = ZOOM) -> float:
    return 156543.03392804097 * math.cos(math.radians(lat)) / (2**zoom)


def tiles_for_chip(lon: float, lat: float, radius_m: float, zoom: int = ZOOM) -> set[tuple[int, int]]:
    world_x, world_y = lonlat_to_world_pixel(lon, lat, zoom)
    radius_px = math.ceil(radius_m / meters_per_pixel(lat, zoom)) + 2
    min_x = math.floor((world_x - radius_px) / TILE_SIZE)
    max_x = math.floor((world_x + radius_px) / TILE_SIZE)
    min_y = math.floor((world_y - radius_px) / TILE_SIZE)
    max_y = math.floor((world_y + radius_px) / TILE_SIZE)
    return {(x, y) for x in range(min_x, max_x + 1) for y in range(min_y, max_y + 1)}


def build_tile_plan(frame: pd.DataFrame, zoom: int = ZOOM) -> list[tuple[int, int]]:
    eligible = frame[
        frame["species_model_eligible"].astype(bool)
        & frame["split"].isin(["train", "calibration", "test"])
        & frame["lon"].notna()
        & frame["lat"].notna()
    ]
    tiles: set[tuple[int, int]] = set()
    for row in eligible.itertuples(index=False):
        tiles.update(tiles_for_chip(float(row.lon), float(row.lat), float(row.chip_radius_m), zoom))
    return sorted(tiles)


def evenly_spaced(items: list[tuple[int, int]], count: int) -> list[tuple[int, int]]:
    if count <= 0 or count >= len(items):
        return items
    if count == 1:
        return [items[len(items) // 2]]
    indices = sorted(
        {round(index * (len(items) - 1) / (count - 1)) for index in range(count)}
    )
    return [items[index] for index in indices]


def tile_path(output_dir: Path, tile: tuple[int, int], zoom: int = ZOOM) -> Path:
    return output_dir / f"{zoom}_{tile[0]}_{tile[1]}.png"


def validate_tile(content: bytes) -> None:
    with Image.open(BytesIO(content)) as image:
        image.verify()
    with Image.open(BytesIO(content)) as image:
        if image.size != (TILE_SIZE, TILE_SIZE):
            raise ValueError(f"unexpected tile dimensions {image.size}")


def fetch_tile(
    key: str,
    tile: tuple[int, int],
    output_dir: Path,
    zoom: int = ZOOM,
) -> tuple[tuple[int, int], str, int]:
    destination = tile_path(output_dir, tile, zoom)
    if destination.exists() and destination.stat().st_size > 0:
        try:
            validate_tile(destination.read_bytes())
            return tile, "cached", destination.stat().st_size
        except (OSError, ValueError):
            destination.unlink(missing_ok=True)
    url = (
        f"https://tiles-cdn.koordinates.com/services;key={key}/tiles/v4/"
        f"layer={LAYER_ID}/EPSG:3857/{zoom}/{tile[0]}/{tile[1]}.png"
    )
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    validate_tile(response.content)
    temporary = destination.with_suffix(".part")
    temporary.write_bytes(response.content)
    temporary.replace(destination)
    return tile, "downloaded", destination.stat().st_size


def write_plan(
    path: Path,
    tiles: list[tuple[int, int]],
    selected: list[tuple[int, int]],
    output_dir: Path,
    results: list[tuple[tuple[int, int], str, int]],
    manifest_path: Path = DEFAULT_MANIFEST,
) -> None:
    counts: dict[str, int] = {}
    for _, status, _ in results:
        counts[status] = counts.get(status, 0) + 1
    payload = {
        "schema_version": "akl-trees-species-imagery-plan/v1",
        "generated_at_utc": utc_now(),
        "source": {
            "provider": "LINZ",
            "layer_id": LAYER_ID,
            "title": "Auckland 0.075m Urban Aerial Photos (2024-2025)",
            "zoom": ZOOM,
            "api_key_embedded": False,
        },
        "manifest": str(manifest_path),
        "output_dir": str(output_dir),
        "all_required_tile_count": len(tiles),
        "selected_tile_count": len(selected),
        "result_counts": counts,
        "selected_tiles": [
            {"x": x, "y": y, "filename": tile_path(output_dir, (x, y)).name}
            for x, y in selected
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--plan-output", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--max-tiles", type=int, default=0,
                        help="deterministic evenly spaced subset; 0 selects every required tile")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    frame = pd.read_parquet(args.manifest)
    tiles = build_tile_plan(frame)
    selected = evenly_spaced(tiles, args.max_tiles)
    results: list[tuple[tuple[int, int], str, int]] = []
    if args.download:
        key = load_key()
        args.output_dir.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(fetch_tile, key, tile, args.output_dir): tile
                for tile in selected
            }
            for future in as_completed(futures):
                results.append(future.result())
    write_plan(args.plan_output, tiles, selected, args.output_dir, results, args.manifest)
    print(
        f"{len(tiles):,} required LINZ z{ZOOM} tiles; selected {len(selected):,}; "
        f"downloaded/cached {len(results):,} -> {args.plan_output}"
    )


if __name__ == "__main__":
    main()
