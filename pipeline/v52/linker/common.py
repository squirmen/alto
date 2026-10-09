"""Shared paths, tile naming and crown loading for the v5.2 record-to-crown linker.

Everything that names an input lives here so the whole chain can be pointed at a redrawn
crown set by changing CROWNS (or the env var LINK_CROWNS) and nothing else. The v5.1
database is only ever opened read-only; the crown set is identified by a hash of its
file listing so every output row says which crowns it was matched against.
"""
from __future__ import annotations
import hashlib, os, sqlite3
from functools import lru_cache
from pathlib import Path
import numpy as np, pandas as pd, pyarrow.parquet as pq

ROOT = Path(os.environ.get("LINK_ROOT", "/data/alto/working/link_v52_20261009"))
WORK, OUT, EVAL, LOGS = ROOT / "work", ROOT / "out", ROOT / "eval", ROOT / "logs"
DB = Path(os.environ.get("LINK_DB", "/data/alto/working/alto_v5_link_repair_20261008/akl_trees.sqlite"))
CROWNS = Path(os.environ.get("LINK_CROWNS", "/data/alto/working/crowns_v5_full/crowns"))
LAZ = Path("/data/alto/point_cloud_2024/auckland_metro_v1")
S3 = "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/auckland/auckland_2024_0.075m/rgbnir/2193"
PALM_DET = Path("/data/alto/working/species_lab/p2/models/C1/metro")
METHOD_ID = "record_crown_link_v52"
SOURCES = ("tree_register_points", "notable_trees_overlay", "osm_natural_tree", "ruru_obskauri_tiaki_public")
LET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; SW, SH, TW, TH, X0, Y0 = 24000., 36000., 480., 720., 988000., 6810000.


def db():
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True)


def tname(x, y):
    """LINZ 1:1000 sheet tile holding an NZTM point, as the point-cloud and crown files name it."""
    col = int((x - X0) // SW); si = int((Y0 - y) // SH); sheet = LET[si // 24] + LET[si % 24] + f"{col:02d}"
    sx = X0 + col * SW; sy = Y0 - si * SH; c = int((x - sx) // TW) + 1; r = int((sy - y) // TH) + 1
    return f"pc_{sheet}_1000_{r:02d}{c:02d}"


def tiles_around(x, y, pad):
    return sorted({tname(x + dx, y + dy) for dx in (-pad, 0, pad) for dy in (-pad, 0, pad)})


def seg_key(tile, x, y):
    return f"{tile}:{x}:{y}"


@lru_cache(maxsize=64)
def load_crowns(tile):
    """One tile's crowns with the seg_key exactly as tree_crown_v5 spells it."""
    f = CROWNS / f"{tile}.parquet"
    if not f.exists():
        return None
    cols = ["x_2193", "y_2193", "height_m", "crown_area_m2", "crown_diameter_m", "n_veg_returns",
            "n_unclassified_returns", "n_building_returns", "ndvi_mean", "elongation", "canopy_class", "crown_wkb"]
    have = set(pq.read_schema(f).names)
    if "x_2193" not in have:          # a tile with no crowns at all (open water) was written without columns
        return None
    c = pq.read_table(f, columns=[k for k in cols if k in have]).to_pandas()
    c["seg_key"] = [seg_key(tile, a, b) for a, b in zip(c.x_2193, c.y_2193)]
    c["tile"] = tile
    return c


def crown_set_id():
    """Identify the crown set by name, size and mtime of every tile file (cheap, changes on any redraw)."""
    h = hashlib.sha256()
    for f in sorted(CROWNS.glob("pc_*.parquet")):
        s = f.stat(); h.update(f"{f.name}:{s.st_size}:{s.st_mtime_ns}\n".encode())
    return f"{CROWNS.parent.name}@{h.hexdigest()[:16]}"


def code_sha256():
    h = hashlib.sha256()
    for f in sorted(Path(__file__).resolve().parent.glob("*.py")):
        h.update(f.read_bytes())
    return h.hexdigest()


def genus_of(latin):
    if not isinstance(latin, str) or not latin.strip() or latin.strip().lower() in ("unknown", "none", "n/a"):
        return None
    g = latin.strip().split()[0].strip("'\"").capitalize()
    return None if g.lower() in ("unknown", "x", "sp", "sp.", "dead", "vacant") else g
