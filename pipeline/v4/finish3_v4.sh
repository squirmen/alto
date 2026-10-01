#!/usr/bin/env bash
set -euo pipefail
W=/data/alto/working/alto_v4_20260917
PY="$HOME/miniconda3/envs/akl-trees/bin/python"
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$W/tmp" VERSION=20260918015343
cd "$W/code"
step() { echo "[$(date +%H:%M:%S)] $*"; }
while pgrep -f "tippecanoe .*layer=trees" > /dev/null; do sleep 20; done
step "points tiles finished: $(ls -la "$W/web_build/trees_map_points.pmtiles" | awk '{print $5}') bytes"; tail -3 "$W/logs/tiles_points.log" || true
step "crown tiles"
tippecanoe --force -P -t "$TMPDIR" --quiet --layer=crowns --minimum-zoom=12 --maximum-zoom=18 --base-zoom=15 \
  --simplification=3 --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -o "$W/web_build/tree_crowns_pilot.pmtiles" "$W/web_build/crowns.geojsonl" "$W/web_build/crowns_legacy.geojsonl" > "$W/logs/tiles_crowns.log" 2>&1
step "crown tiles finished: $(ls -la "$W/web_build/tree_crowns_pilot.pmtiles" | awk '{print $5}') bytes"
pmtiles show "$W/web_build/trees_map_points.pmtiles" | head -8
pmtiles show "$W/web_build/tree_crowns_pilot.pmtiles" | head -8
step "bundle"; SKIP_TILES=1 SKIP_DETAILS=1 bash assemble_v4.sh > "$W/logs/assemble.log" 2>&1; tail -45 "$W/logs/assemble.log"
step "pictures"; "$PY" render_v4_views.py > "$W/logs/render.log" 2>&1; cat "$W/logs/render.log"
step "all done"
