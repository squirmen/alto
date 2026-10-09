#!/usr/bin/env bash
# Council recorded positions for the v5.2 map: the source point of every published link and a line
# from it to the crown top it was joined to. Same tippecanoe recipe as the v5 exports
# (pipeline/v5/run_v5_exports.py); base zoom 13 keeps every feature from z13 up.
set -euo pipefail
R=${LINK_ROOT:-/data/alto/working/link_v52_20261009}
IN=$R/out/v52_package/council_positions_publish.geojsonl
OUT=$R/web/data/council_positions.pmtiles
mkdir -p "$R/web/data" "$R/web/tmp"
/opt/homebrew/bin/tippecanoe --force -P --quiet -t "$R/web/tmp" \
  --layer=council_positions --minimum-zoom=13 --maximum-zoom=18 --base-zoom=13 \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -y tree_id -y source -y status -y distance_m -y edge_distance_m \
  -o "$OUT" "$IN"
/opt/homebrew/bin/pmtiles verify "$OUT"
shasum -a 256 "$IN" "$OUT"
