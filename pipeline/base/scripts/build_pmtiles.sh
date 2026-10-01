#!/usr/bin/env bash
# Build PMTiles vector tilesets from the slim GeoJSONs so the web map can
# load only the visible viewport at each zoom instead of 140 MB upfront.
#
# Requires tippecanoe + pmtiles in PATH (brew install tippecanoe pmtiles).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROCESSED="$ROOT/data/processed"
OUT_DIR="$PROCESSED"

POINTS_GEOJSON="$PROCESSED/trees_map_points.slim.geojson"
CROWNS_GEOJSON="$PROCESSED/tree_crowns_pilot.slim.geojson"
LOW_GEOJSON="$PROCESSED/low_canopy_candidates.slim.geojson"
MISSED_GEOJSON="$PROCESSED/missed_trees_high.slim.geojson"
HEDGES_GEOJSON="$PROCESSED/hedges_pilot.slim.geojson"
CHANGE_GEOJSON="$PROCESSED/tree_trajectory_pilot.geojson"
SIZE_GEOJSON="$PROCESSED/tree_root_shapes.geojson"  # v3 asymmetric root-zone polygons

POINTS_MBT="$OUT_DIR/trees_map_points.mbtiles"
CROWNS_MBT="$OUT_DIR/tree_crowns_pilot.mbtiles"
LOW_MBT="$OUT_DIR/low_canopy_candidates.mbtiles"
MISSED_MBT="$OUT_DIR/missed_trees_high.mbtiles"
HEDGES_MBT="$OUT_DIR/hedges_pilot.mbtiles"
CHANGE_MBT="$OUT_DIR/tree_change.mbtiles"
SIZE_MBT="$OUT_DIR/tree_root_shapes.mbtiles"
POINTS_PMT="$OUT_DIR/trees_map_points.pmtiles"
CROWNS_PMT="$OUT_DIR/tree_crowns_pilot.pmtiles"
LOW_PMT="$OUT_DIR/low_canopy_candidates.pmtiles"
MISSED_PMT="$OUT_DIR/missed_trees_high.pmtiles"
HEDGES_PMT="$OUT_DIR/hedges_pilot.pmtiles"
CHANGE_PMT="$OUT_DIR/tree_change.pmtiles"
SIZE_PMT="$OUT_DIR/tree_root_shapes.pmtiles"

echo "Building points tileset..."
# Attributes baked into the slim GeoJSON that the web map never reads — drop
# them from the tiles so 300k+ features don't each carry ~22 dead fields
# (smaller tiles → faster first paint and panning). Audited against every
# props.* reference in index.html; keep this list in sync if the profile grows.
POINTS_DROP_ATTRS=(
    air_temp_mean_c canopy_mean_m canopy_relief_ratio chm_local_max_2m_m
    cluster_size crown_area_change_pct dist_overland_flow_path_m
    dist_stormwater_catchpit_m edge_tree fraction_paved_surfaces gap_fraction
    height_mean_m intensity_mean lidar_pilot notable_group_names
    notable_point_name notable_point_review_required paved_fraction_used
    pc_false_positive point_density vertical_ratio vitality_change_score
    # The profile derives its "Basis" line and its scenario wording from
    # growth_form_confidence alone, so these three stay in the slim GeoJSON and
    # the per-tree export but do not need to ride in every tile.
    growth_form_source scenario_name scenario_confidence
)
points_exclude=()
for attr in "${POINTS_DROP_ATTRS[@]}"; do points_exclude+=( -x "$attr" ); done
# Points: keep all features down to z12, drop sparser features at lower
# zooms, no clustering (we want individual markers; supercluster handles
# visual clustering in the renderer).
tippecanoe \
    --force \
    --layer=trees \
    --minimum-zoom=10 \
    --maximum-zoom=18 \
    --base-zoom=14 \
    --drop-densest-as-needed \
    --extend-zooms-if-still-dropping \
    "${points_exclude[@]}" \
    -o "$POINTS_MBT" \
    "$POINTS_GEOJSON"

echo "Building crowns tileset..."
# Crowns: simplify aggressively at low zooms, full detail at high zoom.
tippecanoe \
    --force \
    --layer=crowns \
    --minimum-zoom=12 \
    --maximum-zoom=18 \
    --base-zoom=15 \
    --simplification=3 \
    --drop-densest-as-needed \
    --extend-zooms-if-still-dropping \
    -o "$CROWNS_MBT" \
    "$CROWNS_GEOJSON"

if [[ -s "$LOW_GEOJSON" ]]; then
    echo "Building low-canopy candidate tileset..."
    tippecanoe \
        --force \
        --layer=low_canopy \
        --minimum-zoom=12 \
        --maximum-zoom=18 \
        --base-zoom=14 \
        --drop-densest-as-needed \
        --extend-zooms-if-still-dropping \
        -o "$LOW_MBT" \
        "$LOW_GEOJSON"
fi

if [[ -s "$MISSED_GEOJSON" ]]; then
    echo "Building missed-tree candidate tileset..."
    tippecanoe \
        --force \
        --layer=missed_trees \
        --minimum-zoom=12 \
        --maximum-zoom=18 \
        --base-zoom=14 \
        --drop-densest-as-needed \
        --extend-zooms-if-still-dropping \
        -o "$MISSED_MBT" \
        "$MISSED_GEOJSON"
fi

if [[ -s "$HEDGES_GEOJSON" ]]; then
    echo "Building hedge tileset..."
    tippecanoe \
        --force \
        --layer=hedges \
        --minimum-zoom=13 \
        --maximum-zoom=18 \
        --base-zoom=15 \
        --drop-densest-as-needed \
        --extend-zooms-if-still-dropping \
        -o "$HEDGES_MBT" \
        "$HEDGES_GEOJSON"
fi

if [[ -s "$CHANGE_GEOJSON" ]]; then
    echo "Building tree-change (WS2 trajectory) tileset..."
    tippecanoe \
        --force \
        --layer=tree_change \
        --minimum-zoom=10 \
        --maximum-zoom=18 \
        --base-zoom=14 \
        --drop-densest-as-needed \
        --extend-zooms-if-still-dropping \
        -o "$CHANGE_MBT" \
        "$CHANGE_GEOJSON"
fi

if [[ -s "$SIZE_GEOJSON" ]]; then
    echo "Building root-zone shapes (v3) tileset..."
    tippecanoe \
        --force \
        --layer=tree_root_shapes \
        --minimum-zoom=13 \
        --maximum-zoom=18 \
        --base-zoom=15 \
        --simplification=4 \
        --drop-densest-as-needed \
        --extend-zooms-if-still-dropping \
        -o "$SIZE_MBT" \
        "$SIZE_GEOJSON"
fi

echo "Converting mbtiles → pmtiles..."
pmtiles convert "$POINTS_MBT" "$POINTS_PMT"
pmtiles convert "$CROWNS_MBT" "$CROWNS_PMT"
if [[ -s "$LOW_MBT" ]]; then
    pmtiles convert "$LOW_MBT" "$LOW_PMT"
fi
if [[ -s "$MISSED_MBT" ]]; then
    pmtiles convert "$MISSED_MBT" "$MISSED_PMT"
fi
if [[ -s "$CHANGE_MBT" ]]; then
    pmtiles convert "$CHANGE_MBT" "$CHANGE_PMT"
fi
if [[ -s "$SIZE_MBT" ]]; then
    pmtiles convert "$SIZE_MBT" "$SIZE_PMT"
fi
if [[ -s "$HEDGES_MBT" ]]; then
    pmtiles convert "$HEDGES_MBT" "$HEDGES_PMT"
fi

echo "Final sizes:"
ls -lh "$POINTS_PMT" "$CROWNS_PMT" "$LOW_PMT" "$MISSED_PMT" "$HEDGES_PMT" 2>/dev/null || ls -lh "$POINTS_PMT" "$CROWNS_PMT"

# Remove the intermediates to save space.
rm -f "$POINTS_MBT" "$CROWNS_MBT" "$LOW_MBT" "$MISSED_MBT" "$HEDGES_MBT" "$CHANGE_MBT" "$SIZE_MBT"

echo "Done. Vector tiles ready:"
echo "  - $POINTS_PMT"
echo "  - $CROWNS_PMT"
if [[ -s "$LOW_PMT" ]]; then
    echo "  - $LOW_PMT"
fi
if [[ -s "$MISSED_PMT" ]]; then
    echo "  - $MISSED_PMT"
fi
