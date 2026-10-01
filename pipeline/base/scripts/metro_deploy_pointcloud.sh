#!/usr/bin/env bash
# Metro deploy — phase 1: point-cloud verification pass.
# Backs up the metro DB (verify-by-read, T7 has prior corruption), samples the
# classified LAZ per tree, then applies false-positive deletions + no-canopy
# flags. Heavy step (3,149 LAZ tiles); run in background.
set -euo pipefail
cd "$(dirname "$0")/.."
export AKL_TREES_PILOT=auckland_metro_v1
export AKL_TREES_PC_ROOT=/data/alto/point_cloud_2024
PY="${PYTHON:-python3}"
BK=/data/alto/metro_predeploy_backup_2026-06-23

step () { echo; echo "########## $(date '+%F %T')  $* ##########"; }

step "0/2 back up metro DB before destructive verdicts (verify-by-read)"
mkdir -p "$BK"
cp data/processed/akl_trees.sqlite "$BK/akl_trees.sqlite"
$PY - <<EOF
import sqlite3
n = sqlite3.connect("$BK/akl_trees.sqlite").execute("select count(*) from trees").fetchone()[0]
print(f"  backup verified readable: {n:,} trees")
assert n > 1_000_000, "backup looks wrong"
EOF

step "1/2 per-tree point-cloud sampling (3,149 LAZ tiles)"
$PY scripts/build_tree_pointcloud_pilot.py
$PY - <<'EOF'
import sqlite3
c=sqlite3.connect("data/processed/akl_trees.sqlite")
n=c.execute("select count(*) from tree_pointcloud_pilot").fetchone()[0]
fp=c.execute("select count(*) from tree_pointcloud_pilot where pc_false_positive=1").fetchone()[0]
print(f"  tree_pointcloud_pilot: {n:,} rows; flagged false-positive: {fp:,}")
EOF

step "2/2 apply verdicts (delete false positives + flag no-canopy)"
$PY scripts/apply_pointcloud_verdicts.py
$PY - <<'EOF'
import sqlite3
c=sqlite3.connect("data/processed/akl_trees.sqlite")
print("  trees after verdicts:", f"{c.execute('select count(*) from trees').fetchone()[0]:,}")
EOF

echo
echo "===== metro point-cloud pass DONE $(date) ====="
