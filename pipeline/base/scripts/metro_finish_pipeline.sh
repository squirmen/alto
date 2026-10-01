#!/usr/bin/env bash
# Metro (auckland_metro_v1) post-detection finish pipeline.
#
# Runs every downstream + research-grade layer the isthmus got, in dependency
# order, against the already-built metro DB (trees/lidar/crown/context done) +
# the metro greenness imagery (z18 tiles, full metro coverage) + the metro
# historic CHMs (2013/2016, already built). Does NOT build web tiles or the
# point-cloud layers — those run after the LAZ download finishes.
#
# Idempotent-ish: each script drops/recreates its own table. set -e stops on
# the first failure so a scale/OOM issue is caught at a known step.
set -euo pipefail
cd "$(dirname "$0")/.."

export AKL_TREES_PILOT=auckland_metro_v1
export KMP_DUPLICATE_LIB_OK=TRUE
PY="${PYTHON:-python3}"
DB=data/processed/akl_trees.sqlite

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

echo "===== metro finish pipeline START $(date) ====="

step "1/11 impervious join"
$PY scripts/join_impervious_surfaces.py
rowcount tree_impervious_pilot

step "2/11 species CNN (train + predict over all metro trees)"
$PY scripts/train_species_class_cnn.py
rowcount tree_species_class_predictions

step "3/11 growth-form calibration held (requires out-of-fold probability calibration)"
echo "    -> using raw model scores; no heuristic target-prior forcing"

step "4/11 valuation"
$PY scripts/build_tree_valuation.py
rowcount tree_valuation_pilot

step "5/11 enrich tree assets (3D structure / life-stage / health)"
$PY scripts/enrich_tree_assets.py
rowcount tree_assets_pilot

step "6/11 pilot findings"
$PY scripts/build_pilot_findings.py

step "7/11 tree QA layers"
$PY scripts/build_tree_qa_layers.py

step "8/11 i-Tree species attributes (growth-form + mature-height QA)"
# species_attributes needs the i-Tree reference tables; (re)build them if the
# DB is fresh (they live in the active akl_trees.sqlite, not pilot-namespaced).
$PY scripts/build_itree_species_reference.py
$PY scripts/build_species_attributes.py
rowcount tree_species_attributes

step "9/11 root zone (foraging radius + stormwater)"
$PY scripts/build_root_zone_pilot.py
rowcount tree_root_zone_pilot

step "10/11 root shapes v3 (asymmetric polygons, whole metro)"
$PY scripts/build_root_shapes_v3.py --full
rowcount tree_root_shapes_pilot

step "11/11 multi-epoch trajectories (2013/2016/2024, whole metro)"
$PY scripts/build_tree_trajectories.py --full
rowcount tree_trajectory_pilot

echo
echo "===== metro finish pipeline DONE $(date) ====="
