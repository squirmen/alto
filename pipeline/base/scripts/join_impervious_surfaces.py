#!/usr/bin/env python3
"""Sample Auckland Council 2017 impervious-surface polygons per tree.

Replaces the heat-grid `fraction_paved_surfaces` (which is one number per
~240 m polygon) with a per-tree impervious fraction computed against
Auckland Council's authoritative 1 m surface cover dataset. The result
flows into the avoided-runoff valuation: more impervious surface around a
tree means more rainfall that would have become runoff if the tree wasn't
intercepting it.

Implementation:
1. Extract the File Geodatabase (already downloaded) and read the
   impervious-surface polygons via Fiona / pyogrio.
2. Filter to polygons inside the pilot bbox + a halo (so trees near the
   boundary still see the full neighbourhood).
3. Build an STRtree spatial index keyed by the impervious polygons.
4. For each tree, intersect a 30 m × 30 m square neighbourhood (a typical
   tree's catchment in residential blocks) with the impervious polygons,
   and divide the impervious area by the neighbourhood area.

Result is written to a new SQLite column on ``tree_context_pilot`` and
to ``tree_valuation_pilot`` via the existing runoff pipeline.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
from shapely.geometry import box
from shapely.strtree import STRtree


ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
RAW_ROOT = ROOT / "data" / "raw" / "auckland_impervious"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"

from _pilot_config import DEFAULT_PILOT_BBOX_2193  # noqa: E402
SAMPLE_HALF_M = 15.0  # 30 m × 30 m sampling square around each tree

# Class IDs in the Auckland Council 2017 impervious dataset:
#   0 = buildings, 2 = other impervious (driveways, carparks, etc),
#   3 = roads
IMPERVIOUS_CLASS_IDS = {0, 2, 3}


def extract_gdb() -> Path:
    """Unzip the downloaded GDB if not already unpacked. Returns the .gdb path."""
    zip_path = RAW_ROOT / "Impervious_Surfaces_2017.zip"
    if not zip_path.exists():
        raise FileNotFoundError(f"GDB zip not found at {zip_path}. Download it first.")
    extract_dir = RAW_ROOT / "extracted"
    extract_dir.mkdir(parents=True, exist_ok=True)
    gdb_candidates = list(extract_dir.glob("*.gdb"))
    if not gdb_candidates:
        print(f"Extracting {zip_path.name} ...")
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)
        gdb_candidates = list(extract_dir.glob("*.gdb"))
    if not gdb_candidates:
        raise FileNotFoundError("No .gdb folder found after extraction")
    return gdb_candidates[0]


def load_impervious_polygons(gdb_path: Path, bbox: tuple[float, float, float, float], halo_m: float) -> list[dict[str, Any]]:
    """Read polygons inside bbox+halo, attaching the impervious class.

    Uses pyogrio if available (fastest), else fiona.
    """
    bbox_with_halo = (
        bbox[0] - halo_m, bbox[1] - halo_m,
        bbox[2] + halo_m, bbox[3] + halo_m,
    )
    print(f"Reading {gdb_path.name} clipped to bbox + {halo_m:.0f} m halo...")
    try:
        import pyogrio
        layers = pyogrio.list_layers(str(gdb_path))
        print(f"  layers: {[layer[0] for layer in layers]}")
        layer = next(name for name, _ in layers if "imperv" in name.lower())
        print(f"  using layer: {layer}")
        info = pyogrio.read_info(str(gdb_path), layer=layer)
        fields = set(info.get("fields", []))
        preferred_cols = [col for col in ("ClassName", "Class_Name") if col in fields]
        df = pyogrio.read_dataframe(
            str(gdb_path), layer=layer,
            bbox=bbox_with_halo, columns=preferred_cols or None,
        )
        polygons: list[dict[str, Any]] = []
        # Find a class id column robustly.
        class_col = None
        for col in df.columns:
            if col.lower() in {"classname", "class_name", "class", "class_id", "value", "gridcode"}:
                class_col = col
                break
        for _, row in df.iterrows():
            cls = row[class_col] if class_col else 2
            try:
                cls_int = int(cls)
            except (TypeError, ValueError):
                cls_int = 2  # treat unknown as "other impervious"
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue
            if not geom.is_valid:
                geom = geom.buffer(0)
                if geom.is_empty:
                    continue
            polygons.append({"geometry": geom, "class": cls_int})
        return polygons
    except ImportError:
        import fiona
        from shapely.geometry import shape as shp_shape
        with fiona.open(str(gdb_path)):
            layer = next((n for n in fiona.listlayers(str(gdb_path)) if "imperv" in n.lower()), None)
        polygons: list[dict[str, Any]] = []
        with fiona.open(str(gdb_path), layer=layer) as src:
            for f in src.filter(bbox=bbox_with_halo):
                geom = shp_shape(f["geometry"])
                if geom.is_empty:
                    continue
                if not geom.is_valid:
                    geom = geom.buffer(0)
                cls = f["properties"].get("ClassName") or f["properties"].get("Class_Name") or f["properties"].get("Class") or 2
                polygons.append({"geometry": geom, "class": int(cls)})
        return polygons


def sample_impervious_per_tree(
    polygons: list[dict[str, Any]],
    trees: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """For each tree, compute impervious fraction in a 30 m square."""
    print("Building STRtree of impervious polygons ...")
    geoms = [p["geometry"] for p in polygons]
    tree_index = STRtree(geoms) if geoms else None
    geom_to_class = {id(p["geometry"]): p["class"] for p in polygons}
    sq_area = (2 * SAMPLE_HALF_M) ** 2
    out = []
    print(f"Sampling {len(trees):,} trees ...")
    t0 = time.time()
    for i, t in enumerate(trees, start=1):
        tx, ty = t["x_2193"], t["y_2193"]
        sample_box = box(tx - SAMPLE_HALF_M, ty - SAMPLE_HALF_M, tx + SAMPLE_HALF_M, ty + SAMPLE_HALF_M)
        impervious_area = 0.0
        building_area = 0.0
        road_area = 0.0
        other_area = 0.0
        if tree_index is not None:
            for idx in tree_index.query(sample_box):
                poly = geoms[idx]
                if not poly.intersects(sample_box):
                    continue
                clipped = poly.intersection(sample_box)
                if clipped.is_empty:
                    continue
                area = clipped.area
                cls = geom_to_class.get(id(poly), 2)
                if cls in IMPERVIOUS_CLASS_IDS:
                    impervious_area += area
                if cls == 0:
                    building_area += area
                elif cls == 3:
                    road_area += area
                elif cls == 2:
                    other_area += area
        out.append({
            "tree_id": t["tree_id"],
            "fraction_impervious_30m": float(min(1.0, impervious_area / sq_area)),
            "fraction_buildings_30m": float(min(1.0, building_area / sq_area)),
            "fraction_roads_30m": float(min(1.0, road_area / sq_area)),
            "fraction_other_imperv_30m": float(min(1.0, other_area / sq_area)),
        })
        if i % 5000 == 0 or i == len(trees):
            dt = time.time() - t0
            print(f"  {i:,}/{len(trees):,} ({dt:.0f}s elapsed)")
    return out


def load_trees() -> list[dict[str, Any]]:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        rows = conn.execute(
            """
            SELECT t.tree_id, l.x_2193, l.y_2193
            FROM trees t
            JOIN tree_lidar_pilot l ON l.tree_id = t.tree_id
            WHERE l.x_2193 IS NOT NULL
            """
        ).fetchall()
    finally:
        conn.close()
    return [{"tree_id": r[0], "x_2193": r[1], "y_2193": r[2]} for r in rows]


def persist(values: list[dict[str, Any]]) -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_impervious_pilot")
        conn.execute(
            """
            CREATE TABLE tree_impervious_pilot (
                tree_id TEXT PRIMARY KEY,
                fraction_impervious_30m REAL,
                fraction_buildings_30m REAL,
                fraction_roads_30m REAL,
                fraction_other_imperv_30m REAL,
                source TEXT,
                created_at_utc TEXT
            )
            """
        )
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        source = "auckland_council_impervious_2017_30m_window"
        conn.executemany(
            """INSERT INTO tree_impervious_pilot VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [(v["tree_id"], v["fraction_impervious_30m"], v["fraction_buildings_30m"],
              v["fraction_roads_30m"], v["fraction_other_imperv_30m"], source, now)
             for v in values]
        )
        conn.execute("CREATE INDEX idx_tree_imperv_frac ON tree_impervious_pilot(fraction_impervious_30m)")
        conn.commit()
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, default=list(DEFAULT_PILOT_BBOX_2193))
    args = parser.parse_args()
    bbox = tuple(float(v) for v in args.bbox)
    gdb_path = extract_gdb()
    polygons = load_impervious_polygons(gdb_path, bbox, halo_m=SAMPLE_HALF_M * 2)
    print(f"  loaded {len(polygons):,} impervious polygons")
    trees = load_trees()
    print(f"  trees with positions: {len(trees):,}")
    values = sample_impervious_per_tree(polygons, trees)
    persist(values)
    fractions = [v["fraction_impervious_30m"] for v in values]
    print(json.dumps({
        "trees": len(values),
        "fraction_impervious_30m_mean": float(np.mean(fractions)),
        "fraction_impervious_30m_p50": float(np.percentile(fractions, 50)),
        "fraction_impervious_30m_p90": float(np.percentile(fractions, 90)),
    }, indent=2))


if __name__ == "__main__":
    main()
