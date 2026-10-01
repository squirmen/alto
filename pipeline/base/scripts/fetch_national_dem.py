#!/usr/bin/env python3
"""National DSM/DEM fetcher — full-layer LINZ exports, catalog-driven, to the data drive.

Validated mechanism: a FULL-LAYER export (whole region, no bbox clip) is accepted by the LINZ
Exports API and yields the full regional GeoTIFF archive — the small-bbox clipping that broke
per-tile exports does NOT apply at layer scope. Driven by config/national_dem_layers.json
(build it with catalog_national_dem.py). Archives land on the data drive as zips; the existing
build_historic_chm_from_lds.py reads GeoTIFFs straight out of zips via /vsizip/, so the CHM
build is unchanged.

  python scripts/fetch_national_dem.py --list
  python scripts/fetch_national_dem.py --region "Northland" --year 2024      # current epoch
  python scripts/fetch_national_dem.py --region "Auckland"  --year 2013      # historic epoch
  python scripts/fetch_national_dem.py --all-current                          # every region, latest epoch

Output: $AKL_TREES_DEM_ROOT (default /data/alto/national_dem)/<region>_<year>_<kind>.zip
Resumable (existing archives skipped). Needs LINZ_API_KEY + requests.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "config" / "national_dem_layers.json"
OUT_ROOT = Path(os.environ.get("AKL_TREES_DEM_ROOT", "/data/alto/national_dem"))
API = "https://data.linz.govt.nz/services/api/v1.x"
POLL_S, POLL_MAX_MIN = 15, 60


def key() -> str:
    k = os.environ.get("LINZ_API_KEY")
    if not k and (ROOT / ".env").exists():
        for ln in (ROOT / ".env").read_text().splitlines():
            if ln.startswith("LINZ_API_KEY="):
                k = ln.split("=", 1)[1].strip()
    if not k:
        raise SystemExit("LINZ_API_KEY required")
    return k


def safe(s: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in s).strip("_")


def export_layer(k: str, lid: int, out_path: Path) -> bool:
    if out_path.exists() and out_path.stat().st_size > 0:
        print(f"  {out_path.name}: cached")
        return True
    h = {"Authorization": f"key {k}", "Content-Type": "application/json"}
    payload = {"crs": "EPSG:2193", "items": [{"item": f"{API}/layers/{lid}/"}],
               "formats": {"grid": "image/tiff;subtype=geotiff"}}
    r = requests.post(f"{API}/exports/", headers=h, data=json.dumps(payload), timeout=60)
    if r.status_code not in (200, 201, 202):
        print(f"  layer {lid}: export request failed HTTP {r.status_code} {r.text[:120]}")
        return False
    eid = r.json()["id"]
    print(f"  {out_path.name}: export {eid} …", end="", flush=True)
    deadline = time.time() + POLL_MAX_MIN * 60
    url = None
    while time.time() < deadline:
        d = requests.get(f"{API}/exports/{eid}/", headers={"Authorization": f"key {k}"}, timeout=60).json()
        st = d.get("state")
        if st == "complete":
            url = d.get("download_url") or f"{API}/exports/{eid}/download/"
            break
        if st in ("error", "cancelled", "gone"):
            print(f" FAILED ({st})")
            return False
        print(".", end="", flush=True)
        time.sleep(POLL_S)
    if not url:
        print(" TIMEOUT")
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".part")
    with requests.get(url, headers={"Authorization": f"key {k}"}, stream=True, timeout=2400) as resp:
        resp.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(1 << 20):
                f.write(chunk)
    tmp.rename(out_path)
    print(f" {out_path.stat().st_size/1e6:.0f} MB")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region")
    ap.add_argument("--year")
    ap.add_argument("--kind", choices=["DSM", "DEM", "both"], default="both")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--all-current", action="store_true", help="every region, its latest epoch")
    args = ap.parse_args()
    cat = json.loads(CATALOG.read_text())
    layers = cat["layers"]

    if args.list:
        by_region = defaultdict(set)
        for layer in layers:
            by_region[layer["region"]].add(layer["year"])
        for r in sorted(by_region):
            print(f"  {r}: {', '.join(sorted(by_region[r]))}")
        print(f"\n{len(by_region)} regions; national mosaic DSM/DEM = {cat['national_mosaic']}")
        return

    # selection
    if args.all_current:
        latest = {}
        for layer in layers:
            if layer["year"].isdigit():
                latest.setdefault(layer["region"], layer["year"])
                latest[layer["region"]] = max(latest[layer["region"]], layer["year"])
        sel = [layer for layer in layers if layer["year"] == latest.get(layer["region"])]
    else:
        if not args.region:
            raise SystemExit("--region required (or --all-current / --list)")
        sel = [
            layer
            for layer in layers
            if layer["region"] == args.region and (not args.year or layer["year"] == args.year)
        ]
    if args.kind != "both":
        sel = [layer for layer in sel if layer["kind"] == args.kind]
    if not sel:
        raise SystemExit("no matching layers — check --list")

    k = key()
    print(f"fetching {len(sel)} layer(s) -> {OUT_ROOT}")
    ok = 0
    for layer in sorted(sel, key=lambda x: (x["region"], x["year"], x["kind"])):
        name = f"{safe(layer['region'])}_{layer['year']}_{layer['kind']}.zip"
        if export_layer(k, layer["id"], OUT_ROOT / name):
            ok += 1
    print(f"\ndone: {ok}/{len(sel)} archives on disk")


if __name__ == "__main__":
    main()
