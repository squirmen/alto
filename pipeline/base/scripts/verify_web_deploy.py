#!/usr/bin/env python3
"""Verify an assembled web-deploy bundle before it is uploaded.

The bundle is a few gigabytes of opaque binary, so most faults in it are
invisible until a browser hits them: a tileset that predates the database, a
layer the map requests but the bundle does not carry, headline totals that no
longer match the database, or a PMTiles archive whose header will not parse.

This runs those checks against the assembled bundle and the live database, and
exits non-zero on any failure. It reads the database read-only and never writes
to it.

    python scripts/verify_web_deploy.py [--bundle outputs/web_deploy]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
SRC_INDEX = ROOT / "web" / "pilot_map" / "index.html"

# Headline constants baked into index.html by refresh_web_totals.py, mapped to
# the query that must reproduce each one.
TOTAL_QUERIES = {
    "trees": "SELECT COUNT(*) FROM trees",
    "crowns": "SELECT COUNT(*) FROM tree_crown_pilot",
    "protected": "SELECT COUNT(*) FROM trees WHERE is_protected_notable = 1",
    "totalValueNzdY": (
        "SELECT CAST(ROUND(SUM(total_value_nzd_y)) AS INTEGER) FROM tree_valuation_pilot "
        "WHERE valuation_confidence != 'modelled_nominal'"
    ),
    "runoffM3Y": (
        "SELECT CAST(ROUND(SUM(avoided_runoff_m3_y)) AS INTEGER) FROM tree_valuation_pilot "
        "WHERE valuation_confidence != 'modelled_nominal'"
    ),
    "carbonTco2e": (
        "SELECT CAST(ROUND(SUM(stored_co2e_tonnes_est)) AS INTEGER) FROM tree_valuation_pilot "
        "WHERE valuation_confidence != 'modelled_nominal'"
    ),
}


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.warnings: list[str] = []

    def check(self, ok: bool, label: str, detail: str = "") -> bool:
        suffix = f"  {detail}" if detail else ""
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{suffix}")
        if not ok:
            self.failures.append(label)
        return ok

    def warn(self, label: str, detail: str = "") -> None:
        suffix = f"  {detail}" if detail else ""
        print(f"  WARN  {label}{suffix}")
        self.warnings.append(label)


def duplicate_free(counts: dict[str, int]) -> str:
    return ", ".join(f"{k}={v:,}" for k, v in counts.items())


def check_layers(bundle: Path, report: Report) -> None:
    """Every source the map builds must resolve to a file in the bundle.

    MapLibre fetches a PMTiles header while assembling the style, so a missing
    archive 404s on every page load even when its layer is switched off.
    """
    print("\nLayer references")
    index = (bundle / "index.html").read_text(encoding="utf-8")
    tiles = set(re.findall(r"pmtiles://\$\{DATA_BASE\}/([\w.-]+\.pmtiles)", index))
    geojson = set(re.findall(r"\$\{DATA_BASE\}/([\w.-]+\.geojson)", index))
    report.check(bool(tiles), "map references at least one tileset")
    for name in sorted(tiles | geojson):
        path = bundle / "data" / name
        size = path.stat().st_size / 1048576 if path.exists() else 0
        report.check(path.exists() and size > 0, f"bundled: {name}", f"{size:,.1f} MB")


def check_pmtiles(bundle: Path, report: Report) -> None:
    print("\nPMTiles archives")
    if not shutil.which("pmtiles"):
        report.warn("pmtiles CLI not on PATH", "header checks skipped")
        return
    for path in sorted((bundle / "data").glob("*.pmtiles")):
        result = subprocess.run(
            ["pmtiles", "show", str(path)], capture_output=True, text=True
        )
        ok = result.returncode == 0 and "zoom" in result.stdout.lower()
        detail = ""
        if ok:
            zooms = re.search(r"min zoom:\s*(\d+).*?max zoom:\s*(\d+)", result.stdout,
                              re.S | re.I)
            entries = re.search(r"tile entries:\s*([\d,]+)", result.stdout, re.I)
            bits = []
            if zooms:
                bits.append(f"z{zooms.group(1)}-{zooms.group(2)}")
            if entries:
                bits.append(f"{entries.group(1)} tiles")
            detail = " · ".join(bits)
        report.check(ok, f"header parses: {path.name}", detail)


def check_freshness(bundle: Path, report: Report) -> None:
    print("\nFreshness against the database")
    if not DB.exists():
        report.warn("database not found", str(DB))
        return
    db_mtime = DB.stat().st_mtime
    for path in sorted((bundle / "data").glob("*.pmtiles")):
        report.check(
            path.stat().st_mtime >= db_mtime,
            f"newer than the database: {path.name}",
        )


def check_totals(bundle: Path, report: Report) -> None:
    """The headline numbers are baked into index.html because vector tiles
    cannot be aggregated in the browser. They must still match the database."""
    print("\nHeadline totals versus the database")
    if not DB.exists():
        report.warn("database not found", "totals not checked")
        return
    index = (bundle / "index.html").read_text(encoding="utf-8")
    match = re.search(r"const PILOT_TOTALS = (\{.*?\});", index, re.S)
    if not report.check(match is not None, "PILOT_TOTALS block present in index.html"):
        return
    baked = json.loads(re.sub(r"(\w+):", r'"\1":', match.group(1)))

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        for key, sql in TOTAL_QUERIES.items():
            if key not in baked:
                report.warn(f"total absent from index.html: {key}")
                continue
            live = conn.execute(sql).fetchone()[0]
            report.check(
                int(baked[key]) == int(live),
                f"total matches: {key}",
                f"page={int(baked[key]):,} db={int(live):,}",
            )
    finally:
        conn.close()


def check_release_metadata(bundle: Path, report: Report) -> None:
    print("\nRelease metadata")
    path = bundle / "release-metadata.json"
    if not report.check(path.exists(), "release-metadata.json present"):
        return
    meta = json.loads(path.read_text(encoding="utf-8"))
    release = meta.get("release", {})
    report.check(bool(release.get("dataset_version")), "dataset version set",
                 str(release.get("dataset_version")))
    report.check(release.get("status") == "research_only_not_independently_validated",
                 "release status is research-only", str(release.get("status")))
    report.check(release.get("public_claims_enabled") is False,
                 "public claims disabled")
    if DB.exists():
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        try:
            trees = conn.execute("SELECT COUNT(*) FROM trees").fetchone()[0]
        finally:
            conn.close()
        report.check(meta.get("dataset", {}).get("tree_records") == trees,
                     "metadata tree count matches the database",
                     f"meta={meta.get('dataset', {}).get('tree_records'):,} db={trees:,}")
    if release.get("source_dirty"):
        report.warn("built from a dirty working tree",
                    "commit before the upload so the revision is reproducible")


def check_page_wiring(bundle: Path, report: Report) -> None:
    print("\nPage wiring")
    index = (bundle / "index.html").read_text(encoding="utf-8")
    report.check('window.AKL_DATA_BASE="./data"' in index,
                 "data base points at the bundled ./data")
    version = re.search(r'window\.AKL_TILE_VERSION="(\d+)"', index)
    report.check(version is not None, "per-build tile version injected",
                 version.group(1) if version else "")
    report.check("integrity=" in index, "CDN assets carry integrity hashes")
    htaccess = bundle / ".htaccess"
    if report.check(htaccess.exists(), ".htaccess present"):
        text = htaccess.read_text(encoding="utf-8")
        report.check("Content-Security-Policy" in text, "CSP header configured")
        report.check("AddType application/octet-stream .pmtiles" in text,
                     "pmtiles MIME type declared")
    # The deployed copy must not have drifted from the source page.
    if SRC_INDEX.exists():
        src = SRC_INDEX.read_text(encoding="utf-8")
        marker = "<!-- AKL_DATA_BASE:"
        injected = re.sub(r'<script>window\.AKL_DATA_BASE.*?</script>\n  ', "", index,
                          count=1, flags=re.S)
        report.check(injected == src,
                     "deployed page matches web/pilot_map/index.html",
                     "" if injected == src else "rebuild the bundle")
        del marker


def check_exports(bundle: Path, report: Report) -> None:
    print("\nPer-tree downloads")
    exports = bundle / "data" / "exports"
    if not report.check(exports.is_dir(), "exports directory present"):
        return
    for name in ("akl_trees_metro.parquet", "akl_trees_metro.csv.gz",
                 "akl_trees_data_dictionary.md"):
        path = exports / name
        size = path.stat().st_size / 1048576 if path.exists() else 0
        report.check(path.exists() and size > 0, f"download present: {name}",
                     f"{size:,.1f} MB")
    if DB.exists():
        newest = max((p.stat().st_mtime for p in exports.iterdir()), default=0)
        report.check(newest >= DB.stat().st_mtime,
                     "downloads are newer than the database")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", default=str(ROOT / "outputs" / "web_deploy"))
    args = ap.parse_args()
    bundle = Path(args.bundle)

    if not (bundle / "index.html").exists():
        print(f"No bundle at {bundle}. Run scripts/build_web_deploy.sh first.")
        return 2

    print(f"Verifying {bundle}")
    report = Report()
    check_page_wiring(bundle, report)
    check_layers(bundle, report)
    check_pmtiles(bundle, report)
    check_freshness(bundle, report)
    check_totals(bundle, report)
    check_release_metadata(bundle, report)
    check_exports(bundle, report)

    total = sum(f.stat().st_size for f in bundle.rglob("*") if f.is_file())
    print(f"\nBundle size: {total / 1073741824:.2f} GB")
    if report.warnings:
        print(f"{len(report.warnings)} warning(s): {', '.join(report.warnings)}")
    if report.failures:
        print(f"\nFAILED {len(report.failures)} check(s):")
        for name in report.failures:
            print(f"  - {name}")
        return 1
    print("\nAll checks passed. Bundle is ready to upload.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
