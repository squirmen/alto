#!/usr/bin/env bash
# After the metro detection run: database, map export, tiles + bundle, pictures.
set -euo pipefail
W=/data/alto/working/alto_v4_20260917
PY="$HOME/miniconda3/envs/akl-trees/bin/python"
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$W/tmp"
cd "$W/code"
step() { echo "[$(date +%H:%M:%S)] $*"; }

TILES="${TILES_DIR:-$W/tiles}"
export TILES_DIR="$TILES"
while pgrep -f "detect_v4.py run --out $TILES" > /dev/null; do sleep 30; done
"$PY" - "$TILES" <<'PYCODE'
import json, sys
from pathlib import Path
T = Path(sys.argv[1])
rows = [json.loads(l) for l in open(T / "run_log.jsonl")]
names = {json.loads(l)["tile"] for l in open("/data/alto/point_cloud_2024/auckland_metro_v1/manifest.jsonl")}
done = {r["tile"] for r in rows if "error" not in r}
errors = [r for r in rows if "error" in r]
missing = names - done
print(f"detection: {len(done):,} tiles done, {len(errors)} errors, {len(missing)} missing, "
      f"{sum(r.get('crowns', 0) for r in rows if 'error' not in r):,} crowns")
if errors or missing:
    raise SystemExit("detection incomplete; not continuing")
PYCODE

step "database"; "$PY" build_db_v4.py > "$W/logs/build_db.log" 2>&1; tail -3 "$W/logs/build_db.log"
step "coverage labels"; "$PY" mark_coverage_v4.py > "$W/logs/coverage.log" 2>&1; cat "$W/logs/coverage.log"
step "export"; "$PY" export_web_v4.py > "$W/logs/export.log" 2>&1; tail -3 "$W/logs/export.log"
step "tiles and bundle"; VERSION="$(date +%Y%m%d%H%M%S)" bash assemble_v4.sh > "$W/logs/assemble.log" 2>&1; tail -40 "$W/logs/assemble.log"
step "pictures"; "$PY" render_v4_views.py > "$W/logs/render.log" 2>&1; cat "$W/logs/render.log"
step "all done"
