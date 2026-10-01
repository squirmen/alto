#!/usr/bin/env bash
# Resume the metro finish pipeline at steps 8-11 (steps 1-7 already done; the
# i-Tree reference tables have been rebuilt). Research layers: species attrs,
# root zone, root shapes (full metro), multi-epoch trajectories (full metro).
set -euo pipefail
cd "$(dirname "$0")/.."
export AKL_TREES_PILOT=auckland_metro_v1
PY="${PYTHON:-python3}"

step () { echo; echo "########## $(date '+%F %T')  $* ##########"; }
rowcount () { $PY - "$1" <<'EOF'
import sqlite3,sys
t=sys.argv[1]
try:
    n=sqlite3.connect("data/processed/akl_trees.sqlite").execute(f"select count(*) from {t}").fetchone()[0]
    print(f"    -> {t}: {n:,} rows")
except Exception as e:
    print(f"    -> {t}: (missing) {e}")
EOF
}

echo "===== metro finish RESUME (8-11) START $(date) ====="

step "8/11 i-Tree species attributes (growth-form + mature-height QA)"
$PY scripts/build_species_attributes.py
rowcount tree_species_attributes

step "9/11 root zone (foraging radius + stormwater)"
$PY scripts/build_root_zone_pilot.py
rowcount tree_root_zone_pilot

step "10/11 root shapes v3 (asymmetric polygons, whole metro)"
$PY scripts/build_root_shapes_v3.py --full
ls -la data/processed/tree_root_shapes.geojson 2>/dev/null || echo "    (no root_shapes geojson?)"

step "11/11 multi-epoch trajectories (2013/2016/2024, whole metro)"
$PY scripts/build_tree_trajectories.py --full
rowcount tree_trajectory_pilot

echo
echo "===== metro finish RESUME (8-11) DONE $(date) ====="
