#!/usr/bin/env bash
# Exports, details and tiles in parallel, then the bundle and pictures.
set -euo pipefail
W=/data/alto/working/alto_v4_20260917
PY="$HOME/miniconda3/envs/akl-trees/bin/python"
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$W/tmp"
export VERSION="${VERSION:-$(date +%Y%m%d%H%M%S)}"
STAGE="$W/deploy/alto_v4_upload_$VERSION"
mkdir -p "$STAGE/data" "$TMPDIR"
cd "$W/code"
step() { echo "[$(date +%H:%M:%S)] $*"; }

step "exports and details (parallel)"
"$PY" export_web_v4.py points > "$W/logs/export_points.log" 2>&1 & p1=$!
"$PY" export_web_v4.py crowns > "$W/logs/export_crowns.log" 2>&1 & p2=$!
"$PY" build_tree_details_v4.py --db "$W/akl_trees.sqlite" --out "$STAGE/data/tree_details" > "$W/logs/details.log" 2>&1 & p3=$!
wait $p1; step "points export done: $(tail -1 "$W/logs/export_points.log")"
wait $p2; step "crowns export done: $(tail -1 "$W/logs/export_crowns.log")"

POINTS_DROP=(air_temp_mean_c canopy_mean_m canopy_relief_ratio chm_local_max_2m_m cluster_size
  crown_area_change_pct dist_overland_flow_path_m dist_stormwater_catchpit_m edge_tree
  fraction_paved_surfaces gap_fraction height_mean_m intensity_mean lidar_pilot notable_group_names
  notable_point_name notable_point_review_required paved_fraction_used pc_false_positive point_density
  vertical_ratio vitality_change_score growth_form_source scenario_name scenario_confidence)
drop=(); for a in "${POINTS_DROP[@]}"; do drop+=(-x "$a"); done
step "tiles (parallel)"
tippecanoe --force -P -t "$TMPDIR" --quiet --layer=trees --minimum-zoom=10 --maximum-zoom=18 --base-zoom=14 \
  --drop-densest-as-needed --extend-zooms-if-still-dropping "${drop[@]}" \
  -o "$W/web_build/trees_map_points.pmtiles" "$W/web_build/points.geojsonl" > "$W/logs/tiles_points.log" 2>&1 & t1=$!
tippecanoe --force -P -t "$TMPDIR" --quiet --layer=crowns --minimum-zoom=12 --maximum-zoom=18 --base-zoom=15 \
  --simplification=3 --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -o "$W/web_build/tree_crowns_pilot.pmtiles" "$W/web_build/crowns.geojsonl" > "$W/logs/tiles_crowns.log" 2>&1 & t2=$!
tippecanoe --force -P -t "$TMPDIR" --quiet --layer=tree_change --minimum-zoom=10 --maximum-zoom=18 --base-zoom=14 \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -o "$W/web_build/tree_change.pmtiles" "$W/web_build/tree_change.geojsonl" > "$W/logs/tiles_change.log" 2>&1 & t3=$!
wait $t1; step "points tiles done"; wait $t2; step "crown tiles done"; wait $t3; step "change tiles done"
wait $p3; step "details done: $(tail -3 "$W/logs/details.log" | tr '\n' ' ')"

step "bundle"
SKIP_TILES=1 SKIP_DETAILS=1 bash assemble_v4.sh > "$W/logs/assemble.log" 2>&1; tail -45 "$W/logs/assemble.log"
step "pictures"
"$PY" render_v4_views.py > "$W/logs/render.log" 2>&1; cat "$W/logs/render.log"
step "all done: $STAGE"
