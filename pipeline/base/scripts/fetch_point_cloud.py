#!/usr/bin/env python3
"""Download LINZ Auckland 2024 LiDAR **point cloud** (classified LAZ) for the
active pilot bbox, tile by tile, to data/raw/point_cloud_2024 (override the
destination with AKL_TREES_PC_ROOT).

Why this exists: the rest of the pipeline runs on LINZ's 1 m DSM/DEM *raster*
products. Those flatten away the per-point information that best separates real
trees from buildings and ships:

  - Classification (ASPRS): ground / low-med-high vegetation / building / water
  - Return structure (NumberOfReturns > 1 = canopy penetration)
  - Intensity

This script pulls the raw classified point cloud so a downstream step can
confirm/reject detections using those signals.

Source: LINZ Data Service Kart "pointcloud" datasets via the Exports API.
  Part 1: d3VcCb5rKzNsNGk   Part 2: d3W9HT9YGf35Ph8   (2024, CC-BY 4.0)

The Exports API returns only ONE native tile per request, so we drive the
download off the native 1:1,000 tile index (480 m × 720 m) rather than an
arbitrary grid — one export per native tile guarantees complete coverage.

Mechanism per tile:
  1. Fetch the native tile polygons from the index WFS layers (121993 Part 1,
     122590 Part 2) overlapping the pilot bbox; keep tiles that contain trees.
  2. POST /exports/ with both dataset items, format application/vnd.las,
     extent = that tile's polygon (EPSG:2193 corners -> 4326).
  3. Poll until state == complete.
  4. Download the result zip (LINZ redirects to a presigned S3 URL, so the
     Authorization header MUST be dropped on the cross-host redirect).
  5. Extract the .las, convert to compressed .laz (pdal translate), delete
     the zip + .las so peak disk stays ~one tile.

Resumable: a tile whose .laz already exists is skipped. Requires LINZ_API_KEY
(env or .env) and the `pdal` CLI on PATH.
"""

from __future__ import annotations

import argparse
import fcntl
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name, active_pilot_bbox  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
API = "https://data.linz.govt.nz/services/api/v1.x"
DATASETS = ["d3VcCb5rKzNsNGk", "d3W9HT9YGf35Ph8"]  # Auckland Part 1, Part 2 (2024)
# Native point-cloud tile index layers (WFS). The point cloud ships in 1:1,000
# tiles (480 m × 720 m). The Exports API returns only ONE native tile per
# request, so we must drive the download off these exact tile polygons rather
# than an arbitrary grid — otherwise each request silently captures just the
# single native tile it happens to anchor on, leaving ~90% of the area empty.
TILE_INDEX_LAYERS = ["121993", "122590"]  # Part 1, Part 2 index tiles (2024)
WFS = "https://data.linz.govt.nz/services;key={key}/wfs"

# Output root: local data/raw by default; override with AKL_TREES_PC_ROOT
# (e.g. an external drive) without editing this file.
OUT_ROOT = Path(os.environ.get("AKL_TREES_PC_ROOT",
                               ROOT / "data" / "raw" / "point_cloud_2024"))
TO_4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)

POLL_INTERVAL_S = 8
POLL_MAX_MIN = 20
PDAL = shutil.which("pdal")

# Sentinel guarding against the output volume silently ejecting mid-run (an
# external SSD dropping during system sleep). Without it, mkdir(parents=True)
# recreates the output path on the BOOT disk ("phantom" /Volumes/<name> dir)
# and the run keeps "succeeding" while writing to the wrong device. The marker
# is created once at startup on the real volume; if it vanishes, the volume is
# gone and the run aborts immediately so it can be resumed after remount.
VOLUME_MARKER = ".download_volume_ok"
DEFAULT_PLAN_OUTPUT = ROOT / "outputs" / "hpc" / "pointcloud_download_plan.json"


def fsync_full(path: Path) -> None:
    """Force file contents through the drive's write cache to stable storage.
    Plain fsync on macOS only flushes to the drive cache; some external SSDs
    acknowledge writes they then lose on an unclean eject, after which APFS
    rolls the volume back to an older checkpoint (observed: hundreds of
    downloaded tiles evaporating). F_FULLFSYNC asks the drive itself to
    commit; fall back to fsync where unsupported (e.g. some USB bridges)."""
    fd = os.open(str(path), os.O_RDONLY)
    try:
        try:
            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
        except OSError:
            os.fsync(fd)
    finally:
        os.close(fd)


# The Exports API returns ONE native source tile per request. When the request
# polygon edges sit exactly on source-tile boundaries the pick is degenerate
# (it grabs an adjacent tile and returns only the shared edge, or nothing), so
# we inset each request a couple of metres to land strictly inside one tile.
# Verified: an exact-boundary request returns 0 points; the same tile inset 2 m
# returns the full tile (7.7M pts, 100% coverage). The ~2 m border lost per tile
# is immaterial for tree-scale analysis.
TILE_INSET_M = 2.0

# Point thinning on download. The full-coverage native tiles are dense
# (~22 pts/m², ~28 MB each → ~20 GB for the isthmus) which overflows local
# disk. Decimation keeps every Nth point, preserving every per-point attribute
# (class / return / intensity / Z) at a lower density that is still ample for
# per-tree class fractions and canopy structure. Default 4 (~5.5 pts/m²,
# ~5 GB total). Set AKL_TREES_PC_DECIMATE=1 for full density, or --decimate N.
DECIMATE_STEP = int(os.environ.get("AKL_TREES_PC_DECIMATE", "4"))


def load_key() -> str:
    key = os.environ.get("LINZ_API_KEY")
    if not key:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("LINZ_API_KEY="):
                    key = line.split("=", 1)[1].strip()
                    break
    if not key:
        raise SystemExit("LINZ_API_KEY required (env or .env)")
    return key


class _NoAuthRedirect(urllib.request.HTTPRedirectHandler):
    """Drop Authorization on redirect so the S3 presigned URL isn't rejected."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.headers = {k: v for k, v in new.headers.items() if k.lower() != "authorization"}
        return new


def api_post(key: str, path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        API + path, data=json.dumps(payload).encode(),
        headers={"Authorization": f"key {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def api_get(key: str, url: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"key {key}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def tile_polygon(x0: float, y0: float, x1: float, y1: float) -> dict:
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    coords = [[round(lon, 7), round(lat, 7)] for lon, lat in (TO_4326.transform(x, y) for x, y in ring)]
    return {"type": "Polygon", "coordinates": [coords]}


def export_tile(key: str, extent: dict) -> str | None:
    """Create + poll an export, return the download_url (or None if empty)."""
    items = [{"item": f"{API}/datasets/{d}/"} for d in DATASETS]
    payload = {"crs": "EPSG:2193", "items": items, "extent": extent,
               "formats": {"pointcloud": "application/vnd.las"}}
    try:
        exp = api_post(key, "/exports/", payload)
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        # empty extent for all items -> nothing to download here
        if "empty" in body.lower() or e.code == 400:
            return None
        raise
    eid = exp.get("id")
    deadline = time.time() + POLL_MAX_MIN * 60
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL_S)
        d = api_get(key, f"{API}/exports/{eid}/")
        state = d.get("state")
        if state == "complete":
            return d.get("download_url") or f"{API}/exports/{eid}/download/"
        if state in ("error", "cancelled", "gone"):
            print(f"      export {eid} -> {state}", flush=True)
            return None
    print(f"      export {eid} timed out", flush=True)
    return None


def download_and_convert(key: str, url: str, out_laz: Path, keep_docs_dir: Path) -> bool | str:
    """Returns True on success, "empty" when the export has no points in the
    tile (zip carries only metadata docs), or False on a real failure."""
    opener = urllib.request.build_opener(_NoAuthRedirect)
    req = urllib.request.Request(url, headers={"Authorization": f"key {key}"})
    with opener.open(req, timeout=900) as resp:
        content = resp.read()
    if content[:2] != b"PK":
        return False
    zf = zipfile.ZipFile(io.BytesIO(content))
    las_name = next((n for n in zf.namelist() if n.lower().endswith((".las", ".laz"))), None)
    if not las_name:
        return "empty"  # tile outside survey coverage (e.g. over water)
    # Per-tile unique temp dir: a shared _tmp + rmtree races across workers
    # (one worker's cleanup deletes another's in-flight extraction).
    tmp_dir = out_laz.parent / "_tmp" / out_laz.stem
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_las = tmp_dir / Path(las_name).name
    tmp_las.write_bytes(zf.read(las_name))
    # Stash provenance docs once.
    if not (keep_docs_dir / "auckland-lidar-survey-report-2024.pdf").exists():
        keep_docs_dir.mkdir(parents=True, exist_ok=True)
        for n in zf.namelist():
            if n.lower().endswith((".pdf", ".xml", ".txt")):
                (keep_docs_dir / Path(n).name).write_bytes(zf.read(n))
    # Convert to compressed LAZ (pdal writes laszip via .laz extension),
    # optionally thinning with the decimation filter. We always run pdal so
    # thinning applies whether the source arrived as .las or .laz.
    cmd = [PDAL, "translate", str(tmp_las), str(out_laz)]
    if DECIMATE_STEP and DECIMATE_STEP > 1:
        cmd += ["decimation", f"--filters.decimation.step={DECIMATE_STEP}"]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    tmp_las.unlink(missing_ok=True)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    if not (out_laz.exists() and out_laz.stat().st_size > 0):
        return False
    fsync_full(out_laz)
    return True


def fetch_tile_index(key: str, bbox: tuple[float, float, float, float]) -> list:
    """Return native point-cloud tiles overlapping the pilot bbox as
    (tilename, x0, y0, x1, y1) in EPSG:2193, deduped across Part 1 + Part 2."""
    x0, y0, x1, y1 = bbox
    out: dict[str, tuple] = {}
    base = WFS.format(key=key)
    for layer in TILE_INDEX_LAYERS:
        start = 0
        while True:
            params = (
                f"?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-{layer}"
                f"&outputFormat=json&srsName=EPSG:2193&count=1000&startIndex={start}"
                f"&bbox={x0},{y0},{x1},{y1},EPSG:2193"
            )
            with urllib.request.urlopen(base + params, timeout=120) as r:
                d = json.loads(r.read().decode())
            feats = d.get("features", [])
            if not feats:
                break
            for f in feats:
                name = f["properties"].get("tilename") or f.get("id")
                ring = f["geometry"]["coordinates"][0]
                xs = [p[0] for p in ring]
                ys = [p[1] for p in ring]
                out.setdefault(name, (name, min(xs), min(ys), max(xs), max(ys)))
            if len(feats) < 1000:
                break
            start += 1000
    return sorted(out.values(), key=lambda t: (t[2], t[1]))


def process_one(key: str, tdef, out_dir: Path, docs_dir: Path):
    """Export + download + convert a single native tile. tdef is
    (tilename, x0, y0, x1, y1). Returns (status, name, tdef, info)."""
    name, tx0, ty0, tx1, ty1 = tdef
    fname = f"pc_{name}.laz"
    out_laz = out_dir / fname
    if not (out_dir / VOLUME_MARKER).exists():
        return ("volume_gone", fname, tdef, "output volume ejected (marker missing)")
    if out_laz.exists() and out_laz.stat().st_size > 0:
        return ("skip", fname, tdef, 0.0)
    try:
        # Inset so the request sits strictly inside this source tile.
        ins = min(TILE_INSET_M, (tx1 - tx0) / 4, (ty1 - ty0) / 4)
        url = export_tile(key, tile_polygon(tx0 + ins, ty0 + ins, tx1 - ins, ty1 - ins))
        if not url:
            return ("empty", fname, tdef, 0.0)
        ok = download_and_convert(key, url, out_laz, docs_dir)
        if ok == "empty":
            return ("empty", fname, tdef, 0.0)
        if ok:
            return ("done", fname, tdef, out_laz.stat().st_size / 1e6)
        return ("failed", fname, tdef, 0.0)
    except Exception as e:
        return ("error", fname, tdef, f"{type(e).__name__}: {str(e)[:120]}")


def load_tree_points_2193(margin: float = 30.0):
    """Tree easting/northing (EPSG:2193) for filtering tiles to where trees
    are. Returns (xs, ys) arrays or (None, None) if the DB isn't available."""
    try:
        import sqlite3
        import numpy as np
        db = ROOT / "data" / "processed" / "akl_trees.sqlite"
        if not db.exists():
            return None, None
        conn = sqlite3.connect(db)
        try:
            rows = conn.execute(
                "SELECT lon, lat FROM trees WHERE lon IS NOT NULL AND lat IS NOT NULL"
            ).fetchall()
        finally:
            conn.close()
        if not rows:
            return None, None
        to2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
        lons = np.array([r[0] for r in rows])
        lats = np.array([r[1] for r in rows])
        xs, ys = to2193.transform(lons, lats)
        return np.asarray(xs), np.asarray(ys)
    except Exception:
        return None, None


def select_tree_tiles(tiles: list[tuple], txs, tys, margin_m: float = 30.0) -> list[tuple]:
    """Keep native tiles containing a canonical tree or a crown-edge margin."""
    if txs is None or tys is None:
        return list(tiles)
    import numpy as np

    kept = []
    for tile in tiles:
        _, x0, y0, x1, y1 = tile
        hit = (
            (txs >= x0 - margin_m)
            & (txs <= x1 + margin_m)
            & (tys >= y0 - margin_m)
            & (tys <= y1 + margin_m)
        )
        if np.any(hit):
            kept.append(tile)
    return kept


def write_download_plan(
    path: Path,
    *,
    pilot: str,
    bbox: tuple[float, float, float, float],
    tiles: list[tuple],
    decimate_step: int,
    tree_filtered: bool,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "schema_version": "akl-trees-pointcloud-download-plan/v1",
        "pilot": pilot,
        "bbox_epsg2193": list(map(float, bbox)),
        "crs": "EPSG:2193",
        "source_datasets": DATASETS,
        "tile_index_layers": TILE_INDEX_LAYERS,
        "tile_count": len(tiles),
        "tree_filtered_with_30m_margin": tree_filtered,
        "decimation_step": decimate_step,
        "download_estimate_note": (
            "Size is intentionally not asserted before export; stage to cluster/object storage "
            "and validate every decompressed tile before analysis."
        ),
        "tiles": [
            {
                "tilename": tile[0],
                "output_name": f"pc_{tile[0]}.laz",
                "bbox_epsg2193": list(map(float, tile[1:])),
            }
            for tile in tiles
        ],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    global DECIMATE_STEP
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import threading

    ap = argparse.ArgumentParser()
    ap.add_argument("--tile-m", type=float, default=1000.0,
                    help="(deprecated; ignored) kept for Makefile compatibility")
    ap.add_argument("--max-tiles", type=int, default=0, help="limit (0 = all) for testing")
    ap.add_argument("--workers", type=int, default=1, help="concurrent export workers")
    ap.add_argument("--all-tiles", action="store_true",
                    help="download every native tile in the bbox, not just tree-bearing ones")
    ap.add_argument("--decimate", type=int, default=DECIMATE_STEP,
                    help="keep every Nth point on download (1 = full density)")
    ap.add_argument("--plan-only", action="store_true",
                    help="write the exact selected native-tile plan; do not export/download")
    ap.add_argument("--plan-output", type=Path, default=DEFAULT_PLAN_OUTPUT)
    args = ap.parse_args()
    DECIMATE_STEP = args.decimate
    if PDAL is None:
        raise SystemExit(
            "pdal CLI not found on PATH. Install it (the conda environment.yml includes pdal) "
            "or activate the project environment before downloading point clouds."
        )

    key = load_key()
    pilot = active_pilot_name()
    x0, y0, x1, y1 = active_pilot_bbox()
    out_dir = OUT_ROOT / pilot
    docs_dir = out_dir / "_provenance"
    manifest = out_dir / "manifest.jsonl"

    print(f"Pilot '{pilot}': fetching native tile index ...", flush=True)
    tiles = fetch_tile_index(key, (x0, y0, x1, y1))
    print(f"  {len(tiles)} native tiles (480×720 m) in bbox", flush=True)

    # By default restrict to tiles that actually contain trees (skips water /
    # bare tiles, ~halving the export count). --all-tiles disables the filter.
    if not args.all_tiles:
        txs, tys = load_tree_points_2193()
        if txs is not None:
            kept = select_tree_tiles(tiles, txs, tys)
            print(f"  {len(kept)} tiles contain trees (filtered from {len(tiles)}; --all-tiles to override)", flush=True)
            tiles = kept

    if args.max_tiles:
        tiles = tiles[: args.max_tiles]

    if args.plan_only:
        write_download_plan(
            args.plan_output,
            pilot=pilot,
            bbox=(x0, y0, x1, y1),
            tiles=tiles,
            decimate_step=DECIMATE_STEP,
            tree_filtered=not args.all_tiles,
        )
        print(f"wrote {len(tiles):,}-tile download plan -> {args.plan_output}")
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / VOLUME_MARKER).touch()

    dec = f"decimate 1/{DECIMATE_STEP}" if DECIMATE_STEP > 1 else "full density"
    print(f"Pilot '{pilot}': {len(tiles)} tiles, {args.workers} workers, {dec} -> {out_dir}", flush=True)
    counts = {"done": 0, "skip": 0, "empty": 0, "failed": 0, "error": 0}
    lock = threading.Lock()
    t_start = time.time()
    mf = manifest.open("a")

    def record(result, k):
        status, name, tdef, info = result
        if status == "volume_gone":
            # The output volume ejected mid-run. Abort hard: every further
            # write would land on a phantom boot-disk dir or be lost anyway.
            print(f"\nFATAL: {info} — aborting. Remount the volume and rerun "
                  f"(resumable; existing tiles are skipped).", flush=True)
            os._exit(2)
        with lock:
            counts[status] = counts.get(status, 0) + 1
            if status == "done":
                mf.write(json.dumps({"tile": name, "bbox_2193": list(tdef),
                                     "mb": round(info, 2), "ts": time.time()}) + "\n")
                mf.flush()
                os.fsync(mf.fileno())
            if status in ("done", "failed", "error") or k % 20 == 0:
                extra = f"{info:.1f} MB" if status == "done" else (info if isinstance(info, str) else status)
                el = time.time() - t_start
                print(f"  [{k}/{len(tiles)}] {name}: {extra}  "
                      f"(done {counts['done']}, skip {counts['skip']}, empty {counts['empty']}, "
                      f"fail {counts['failed']+counts['error']}, {el:.0f}s)", flush=True)

    if args.workers <= 1:
        for k, tdef in enumerate(tiles, 1):
            record(process_one(key, tdef, out_dir, docs_dir), k)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(process_one, key, tdef, out_dir, docs_dir): k
                    for k, tdef in enumerate(tiles, 1)}
            for fut in as_completed(futs):
                record(fut.result(), futs[fut])
    mf.close()
    print(f"\nDONE: {counts} in {time.time()-t_start:.0f}s", flush=True)


if __name__ == "__main__":
    main()
