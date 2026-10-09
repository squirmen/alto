#!/usr/bin/env bash
# Rerun the whole v5.2 record-to-crown linking chain, e.g. on a redrawn crown set:
#   LINK_CROWNS=/path/to/new/crowns LINK_DB=/path/to/v5x.sqlite ./run_all.sh
# The database is opened read-only. Outputs go to $LINK_ROOT/work, eval, out and logs (overwritten).
# Steps that depend only on the point cloud and imagery are per crown set (crowns enter the
# candidate lists, the cover mask and the seeded-crown gaps), so a redrawn set needs the full chain.
set -euo pipefail
cd "$(dirname "$0")"
export KMP_DUPLICATE_LIB_OK=TRUE OMP_NUM_THREADS=1
PY=${PYTHON:-python3}
export LINK_ROOT=${LINK_ROOT:-/data/alto/working/link_v52_20261009}
R=$LINK_ROOT
mkdir -p "$R/work" "$R/eval" "$R/out" "$R/logs"
W=${LINK_WORKERS:-8}
rm -rf $R/work/tiles $R/work/tiles_sim
$PY extract.py                                   # records, links, taxa from the DB (read-only)
$PY features.py --workers $W                     # evidence at every record (~40 min)
$PY assemble.py
$PY saddle.py $R/work/newcrowns.parquet $R/work/saddle.parquet 4
$PY errmodel.py                                  # offset model per source (EM with decoys)
$PY runs_real.py                                 # register runs, first pass (no null threshold yet)
$PY runs_null.py                                 # null-calibrated acceptance threshold
$PY runs_real.py                                 # register runs with the calibrated threshold
$PY simulate.py                                  # displaced trusted records with known answers
$PY features.py --workers $W --queries $R/work/sim_queries.parquet --out $R/work/tiles_sim --log features_sim.log
$PY assemble.py $R/work/tiles_sim sim_
$PY saddle.py $R/work/sim_newcrowns.parquet $R/work/sim_saddle.parquet 4
$PY evaluate.py --configs full                   # 5-fold hold-out, calibration
$PY final.py                                     # production links and companions in $R/out
$PY evaluate.py --configs no_error_model no_run_alignment no_plausibility no_capacity_conflict no_new_crowns
$PY summarize.py > $R/logs/summarize.txt
$PY report_stats.py
$PY parcels.py                                   # diagnostic only: crowns on property parcels vs road reserve
# The blind audit has to be redone by eye on a new crown set: audit.py sample4 (or sample2/sample3), audit.py render
# --sample $R/eval/audit_sample_r4.csv --cards audit_cards_r4, judge the sheets into eval/audit_judgments_r4.csv,
# then audit_score.py _r4. report.py reads the audit summaries of every round present.
$PY report.py
