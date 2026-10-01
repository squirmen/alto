#!/usr/bin/env python3
"""Fetch configured LINZ Data Service metadata snapshots."""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "config" / "sources.json"
RAW_ROOT = ROOT / "data" / "raw" / "linz"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_json(url: str, retries: int = 3) -> Any:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "akl-trees-data-collector/0.1",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - keep script dependency-free.
            last_error = exc
            if attempt == retries:
                break
            time.sleep(2 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}") from last_error


def load_sources(only: set[str] | None) -> list[dict[str, Any]]:
    with SOURCES_PATH.open("r", encoding="utf-8") as f:
        config = json.load(f)
    sources = [source for source in config["sources"] if source.get("type") == "linz_layer"]
    if only:
        sources = [source for source in sources if source["slug"] in only]
    return sources


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="Optional LINZ source slugs to fetch.")
    args = parser.parse_args()

    RAW_ROOT.mkdir(parents=True, exist_ok=True)
    manifests = []
    fetched_at = utc_now()

    for source in load_sources(set(args.only) if args.only else None):
        out_dir = RAW_ROOT / source["slug"]
        out_dir.mkdir(parents=True, exist_ok=True)
        layer = fetch_json(source["api_url"])
        services = fetch_json(layer["services"]) if layer.get("services") else None

        (out_dir / "layer.json").write_text(json.dumps(layer, indent=2), encoding="utf-8")
        if services is not None:
            (out_dir / "services.json").write_text(json.dumps(services, indent=2), encoding="utf-8")

        manifest = {
            "slug": source["slug"],
            "name": source["name"],
            "layer_id": source["layer_id"],
            "api_url": source["api_url"],
            "fetched_at_utc": fetched_at,
            "public_access": layer.get("public_access"),
            "published_at": layer.get("published_at"),
            "title": layer.get("title"),
            "outputs": {
                "layer_metadata": str((out_dir / "layer.json").relative_to(ROOT)),
                "services_metadata": str((out_dir / "services.json").relative_to(ROOT)),
            },
        }
        manifests.append(manifest)
        print(f"Fetched LINZ metadata: {source['slug']}")

    (RAW_ROOT / "fetch_manifest.json").write_text(json.dumps(manifests, indent=2), encoding="utf-8")
    print(f"Wrote {RAW_ROOT / 'fetch_manifest.json'}")


if __name__ == "__main__":
    main()
