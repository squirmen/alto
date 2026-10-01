#!/usr/bin/env bash
# Assemble a self-contained, upload-ready copy of the pilot map for any static
# Apache/Nginx host under outputs/web_deploy/.
#
#   outputs/web_deploy/
#     index.html            (data base rewritten to ./data)
#     .htaccess             (range + caching, from deploy.htaccess)
#     observatory.css + map-analysis.js
#     data/*.pmtiles        (five vector-tile archives)
#
# Upload the whole folder's CONTENTS to your public_html/trees (or similar).
# Re-run after a tile rebuild. Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/web/pilot_map"
PROCESSED="$ROOT/data/processed"
OUT="$ROOT/outputs/web_deploy"
DB="$PROCESSED/akl_trees.sqlite"

# Same interpreter rule as the Makefile: an activated environment wins over a
# bare python3, which normally lacks the geospatial stack.
PY="${PY:-}"
if [[ -z "$PY" ]]; then
  if [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/bin/python" ]]; then
    PY="$VIRTUAL_ENV/bin/python"
  elif [[ -n "${CONDA_PREFIX:-}" && -x "$CONDA_PREFIX/bin/python" ]]; then
    PY="$CONDA_PREFIX/bin/python"
  else
    PY="$(command -v python3)"
  fi
fi

# ---- Freshness gate ---------------------------------------------------------
# A tileset older than the database was built from superseded rows, so bundling
# it publishes numbers the current database no longer supports. This has to fail
# loudly: the failure mode is a deploy that looks complete and is quietly wrong.
# Override only for a deliberate re-bundle of unchanged tiles.
ALLOW_STALE_TILES="${ALLOW_STALE_TILES:-0}"

# Hedges intentionally excluded from the deploy: the per-tile LiDAR heuristic
# fragments hedges at tile seams and confuses other linear low vegetation, so it
# is held back pending the imagery+ML approach in docs/methods/hedge_detection.md.
# missed_trees_high held back: its tileset is still the isthmus build and there is
# no clean metro regeneration yet (fast-follow: rebuild from the metro point cloud).
TILES=(trees_map_points.pmtiles tree_crowns_pilot.pmtiles low_canopy_candidates.pmtiles tree_change.pmtiles tree_root_shapes.pmtiles)

if [[ -f "$DB" ]]; then
  db_mtime=$(stat -f %m "$DB" 2>/dev/null || stat -c %Y "$DB")
  stale=()
  for t in "${TILES[@]}"; do
    [[ -f "$PROCESSED/$t" ]] || continue
    t_mtime=$(stat -f %m "$PROCESSED/$t" 2>/dev/null || stat -c %Y "$PROCESSED/$t")
    if (( t_mtime < db_mtime )); then
      if [[ -f "$PROCESSED/tile-integrity-repair.json" ]] && "$PY" "$ROOT/scripts/verify_tile_repair.py" "$DB" "$PROCESSED/$t"; then
        echo "Verified unchanged tile inputs after audited unit/link repair: $t"
      else
        stale+=("$t")
      fi
    fi
  done
  if (( ${#stale[@]} > 0 )); then
    echo "ERROR: these tilesets predate $DB and would publish superseded data:" >&2
    for t in "${stale[@]}"; do echo "  - $t" >&2; done
    if [[ "$ALLOW_STALE_TILES" != "1" ]]; then
      echo "Rebuild with scripts/build_web_geojson.py + scripts/build_pmtiles.sh," >&2
      echo "or set ALLOW_STALE_TILES=1 to bundle them deliberately." >&2
      exit 1
    fi
    echo "ALLOW_STALE_TILES=1 set — continuing with stale tiles." >&2
  fi
fi

# Regenerate release identity/provenance on every bundle so the public About
# panel cannot silently describe a previous database or model build.
"$PY" "$ROOT/scripts/build_web_release_metadata.py"

# Validate inputs before replacing a previously usable upload folder.
for asset in "${TILES[@]}" canopy_cover_by_board.geojson kauri_dieback.geojson; do
  [[ -s "$PROCESSED/$asset" ]] || { echo "ERROR: required data missing: $asset" >&2; exit 1; }
done
for asset in akl_trees_metro.parquet akl_trees_metro.csv.gz akl_trees_data_dictionary.md export-manifest.json; do
  [[ -s "$PROCESSED/exports/$asset" ]] || { echo "ERROR: export missing: $asset; run build_data_export.py" >&2; exit 1; }
done
for asset in index.html observatory.css map-analysis.js alto-logo.png deploy.htaccess; do
  [[ -s "$SRC/$asset" ]] || { echo "ERROR: app asset missing: $asset" >&2; exit 1; }
done

# Catch outdated exports using the source database identity, not release-note gates.
"$PY" - "$DB" "$PROCESSED/exports/export-manifest.json" <<'PYCODE'
import json, pathlib, sys
source, manifest = map(pathlib.Path, sys.argv[1:])
if json.loads(manifest.read_text())["database_mtime_ns"] != source.stat().st_mtime_ns:
    raise SystemExit("Export predates this database: run scripts/build_data_export.py")
PYCODE

echo "Building deploy bundle -> $OUT"
rm -rf "$OUT"
mkdir -p "$OUT/data"

# index.html with the data base pointed at the bundled ./data folder. We inject
# the window.AKL_DATA_BASE script at the AKL_DATA_BASE marker comment.
"$PY" - "$SRC/index.html" "$OUT/index.html" <<'PY'
import sys, time, re
src, dst = sys.argv[1], sys.argv[2]
html = open(src, encoding="utf-8").read()
marker = "<!-- AKL_DATA_BASE:"
# Stamp the data base AND a per-build tile version, so a redeploy forces browsers
# off the year-cached .pmtiles (whose stale header would otherwise mismatch the
# rebuilt file). The version is the build epoch.
ver = str(int(time.time()))
inject = f'<script>window.AKL_DATA_BASE="./data";window.AKL_TILE_VERSION="{ver}";</script>\n  '
i = html.find(marker)
if i == -1:
    raise SystemExit("AKL_DATA_BASE marker not found in index.html")
# Insert the script just before the marker comment.
html = html[:i] + inject + html[i:]
for asset in ("observatory.css", "map-analysis.js", "alto-logo.png"):
    html = re.sub(r'\./' + re.escape(asset) + r'(?:\?[^"]*)?"', f'./{asset}?v={ver}"', html)
open(dst, "w", encoding="utf-8").write(html)
print("  index.html written")
PY

cp "$SRC/deploy.htaccess" "$OUT/.htaccess"
echo "  .htaccess written"
cp "$SRC/observatory.css" "$SRC/map-analysis.js" "$SRC/alto-logo.png" "$OUT/"

cp "$SRC/release-metadata.json" "$OUT/release-metadata.json"
echo "  release-metadata.json written"

missing=0
for t in "${TILES[@]}"; do
  if [[ -f "$PROCESSED/$t" ]]; then
    cp "$PROCESSED/$t" "$OUT/data/$t"
    sz=$(du -h "$OUT/data/$t" | cut -f1)
    echo "  data/$t ($sz)"
  else
    echo "  WARNING: missing $PROCESSED/$t" >&2
    missing=1
  fi
done

# Per-tree data export (GeoParquet + gzipped CSV + data dictionary) for the
# About panel download links. Built by scripts/build_data_export.py.
if [[ -d "$PROCESSED/exports" ]]; then
  mkdir -p "$OUT/data/exports"
  for asset in akl_trees_metro.parquet akl_trees_metro.csv.gz akl_trees_data_dictionary.md export-manifest.json; do
    cp "$PROCESSED/exports/$asset" "$OUT/data/exports/"
  done
  echo "  data/exports/ ($(du -sh "$OUT/data/exports" | cut -f1))"
else
  echo "  WARNING: no exports/ — run scripts/build_data_export.py for the download links" >&2
fi

# Small GeoJSON overlays the map loads directly (not tiled).
for gj in canopy_cover_by_board.geojson kauri_dieback.geojson; do
  if [[ -f "$PROCESSED/$gj" ]]; then
    cp "$PROCESSED/$gj" "$OUT/data/"
    echo "  data/$gj ($(du -h "$OUT/data/$gj" | cut -f1))"
  fi
done

"$PY" - "$OUT" <<'PYCODE'
import hashlib, json, pathlib, sys
from datetime import datetime, timezone
root = pathlib.Path(sys.argv[1])
files = []
for path in sorted(root.rglob("*")):
    if not path.is_file(): continue
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""): digest.update(block)
    files.append({"path": str(path.relative_to(root)), "bytes": path.stat().st_size, "sha256": digest.hexdigest()})
(root / "bundle-manifest.json").write_text(json.dumps({"built_utc": datetime.now(timezone.utc).isoformat(), "files": files}, indent=2) + "\n")
PYCODE

total=$(du -sh "$OUT" | cut -f1)
echo
echo "Deploy bundle ready: $OUT  (total $total)"
echo "Upload the CONTENTS of that folder to your web server's document root."
[[ $missing -eq 0 ]] || { echo "Some tiles were missing — run build-pmtiles first." >&2; exit 1; }
