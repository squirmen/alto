#!/usr/bin/env bash
# Metro deploy — phase 2: rebuild every derived product off the cleaned inventory
# (after the point-cloud false-positive deletions) and assemble the deploy bundle.
set -euo pipefail
cd "$(dirname "$0")/.."
export AKL_TREES_PILOT=auckland_metro_v1
PY="${PYTHON:-python3}"

step () { echo; echo "########## $(date '+%F %T')  $* ##########"; }

step "1/6 canopy cover (refresh per-board tree counts off cleaned inventory)"
$PY scripts/build_canopy_cover.py

step "2/6 per-tree data export (cleaned inventory)"
$PY scripts/build_data_export.py

step "3/6 refresh baked web totals + species menu"
$PY scripts/refresh_web_totals.py

step "4/6 rebuild web GeoJSON (points + crowns) from cleaned DB"
$PY scripts/build_web_geojson.py

step "5/6 build PMTiles"
scripts/build_pmtiles.sh

step "6/6 assemble deploy bundle"
scripts/build_web_deploy.sh

echo
echo "===== metro deploy rebuild DONE $(date) ====="
$PY - <<'EOF'
import sqlite3
c=sqlite3.connect("data/processed/akl_trees.sqlite")
print("final trees:", f"{c.execute('select count(*) from trees').fetchone()[0]:,}")
EOF
