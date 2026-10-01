#!/usr/bin/env python3
"""Catalog every LINZ national 1m DSM/DEM LiDAR layer → the national CHM-acquisition manifest.

The foundation of the national DSM/DEM fetcher: discovers what elevation data exists (region,
year/epoch, DSM vs DEM, layer id, extent) so the downloader knows what to pull for the
current-state CHM and for the historic timeseries, region by region. Writes
config/national_dem_layers.json. Read-only (LINZ catalog API). Needs LINZ_API_KEY.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "config" / "national_dem_layers.json"
API = "https://data.linz.govt.nz/services/api/v1.x/layers/"


def key() -> str:
    k = os.environ.get("LINZ_API_KEY")
    if not k and (ROOT / ".env").exists():
        for ln in (ROOT / ".env").read_text().splitlines():
            if ln.startswith("LINZ_API_KEY="):
                k = ln.split("=", 1)[1].strip()
    if not k:
        raise SystemExit("LINZ_API_KEY required")
    return k


def fetch_page(k: str, page: int) -> list:
    url = f"{API}?q=LiDAR+1m+DSM+DEM&format=json&page={page}"
    req = urllib.request.Request(url, headers={"Authorization": f"key {k}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def parse(title: str) -> tuple[str, str, str]:
    kind = "DSM" if re.search(r"1m DSM", title, re.I) else ("DEM" if re.search(r"1m DEM", title, re.I) else "?")
    ym = re.search(r"\((\d{4})", title)
    year = ym.group(1) if ym else ("national" if "New Zealand" in title else "?")
    region = re.sub(r"\s*LiDAR.*$", "", title).strip() or ("New Zealand" if "New Zealand" in title else "?")
    return region, year, kind


def main() -> None:
    k = key()
    seen, layers = set(), []
    for page in range(1, 12):
        try:
            batch = fetch_page(k, page)
        except Exception:
            break
        if not batch:
            break
        new = 0
        for layer in batch:
            t = layer.get("title", "")
            if not re.search(r"1m (DSM|DEM)", t, re.I) or "LiDAR" not in t or layer["id"] in seen:
                continue
            seen.add(layer["id"])
            region, year, kind = parse(t)
            layers.append({"id": layer["id"], "title": t, "region": region, "year": year, "kind": kind})
            new += 1
        if new == 0 and page > 1:
            break

    # pair DSM+DEM by region+year (a CHM epoch needs both)
    epochs = defaultdict(dict)
    for x in layers:
        epochs[(x["region"], x["year"])][x["kind"]] = x["id"]
    complete = {f"{r}|{y}": v for (r, y), v in epochs.items() if "DSM" in v and "DEM" in v}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "note": "LINZ national 1m DSM/DEM layers for the national CHM fetcher. A CHM epoch = DSM-DEM.",
        "national_mosaic": {"DSM": 122082, "DEM": 121859},
        "layers": sorted(layers, key=lambda x: (x["region"], x["year"], x["kind"])),
        "chm_epochs_with_both": complete,
    }, indent=1), encoding="utf-8")

    regions = sorted({x["region"] for x in layers})
    years = sorted({x["year"] for x in layers if x["year"].isdigit()})
    print(f"catalogued {len(layers)} layers | {len(regions)} regions | years {years[0]}–{years[-1]}")
    print(f"  complete DSM+DEM CHM epochs: {len(complete)}")
    print(f"  regions: {', '.join(regions[:18])}{' …' if len(regions)>18 else ''}")
    print(f"  -> {OUT}")


if __name__ == "__main__":
    main()
