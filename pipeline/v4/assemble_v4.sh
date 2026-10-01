#!/usr/bin/env bash
# Build the ALTO v4 upload folder (only files that change) and a local preview.
# Runs after build_db_v4.py, export_web_v4.py and build_change_v4.py.
set -euo pipefail
W=/data/alto/working/alto_v4_20260917
PY="$HOME/miniconda3/envs/akl-trees/bin/python"
LIVE=/data/alto/working/alto_live_20260915
PREV=/data/alto/web_deploy_20260910
DB="${V4_DB:-$W/akl_trees.sqlite}"
BUILD="${V4_BUILD:-$W/web_build}"
DEPLOY="${V4_DEPLOY:-$W/deploy}"
VERSION="${VERSION:-$(date +%Y%m%d%H%M%S)}"
STAGE="$DEPLOY/alto_v4_upload_$VERSION"
PREVIEW="$DEPLOY/preview_$VERSION"
export TMPDIR="$W/tmp"
mkdir -p "$STAGE/data" "$TMPDIR"
step() { echo "[$(date +%H:%M:%S)] $*"; }

POINTS_DROP=(air_temp_mean_c canopy_mean_m canopy_relief_ratio chm_local_max_2m_m cluster_size
  crown_area_change_pct dist_overland_flow_path_m dist_stormwater_catchpit_m edge_tree
  fraction_paved_surfaces gap_fraction height_mean_m intensity_mean lidar_pilot notable_group_names
  notable_point_name notable_point_review_required paved_fraction_used pc_false_positive point_density
  vertical_ratio vitality_change_score growth_form_source scenario_name scenario_confidence)
drop=(); for a in "${POINTS_DROP[@]}"; do drop+=(-x "$a"); done

if [[ "${SKIP_TILES:-0}" != 1 ]]; then
  step "points tiles"
  tippecanoe --force -P -t "$TMPDIR" --quiet --layer=trees --minimum-zoom=10 --maximum-zoom=18 --base-zoom=14 \
    --drop-densest-as-needed --extend-zooms-if-still-dropping "${drop[@]}" \
    -o "$BUILD/trees_map_points.pmtiles" "$BUILD/points.geojsonl"
  step "crown tiles"
  tippecanoe --force -P -t "$TMPDIR" --quiet --layer=crowns --minimum-zoom=12 --maximum-zoom=18 --base-zoom=15 \
    --simplification=3 --drop-densest-as-needed --extend-zooms-if-still-dropping \
    -o "$BUILD/tree_crowns_pilot.pmtiles" "$BUILD/crowns.geojsonl"
  step "change tiles"
  tippecanoe --force -P -t "$TMPDIR" --quiet --layer=tree_change --minimum-zoom=10 --maximum-zoom=18 --base-zoom=14 \
    --drop-densest-as-needed --extend-zooms-if-still-dropping \
    -o "$BUILD/tree_change.pmtiles" "$BUILD/tree_change.geojsonl"
fi

if [[ "${SKIP_DETAILS:-0}" != 1 ]]; then
  step "tree details"
  PYTHONDONTWRITEBYTECODE=1 "$PY" "$W/code/build_tree_details_v4.py" --db "$DB" --out "$STAGE/data/tree_details"
fi

step "totals, page and release metadata"
"$PY" "$W/code/release_meta_v4.py" totals "$BUILD/totals.json"
"$PY" "$W/code/patch_ui_v4.py" "$LIVE/index.html" "$STAGE/index.html" "$BUILD/totals.json" "$VERSION"
"$PY" "$W/code/release_meta_v4.py" meta "$LIVE/release-metadata.json" "$STAGE/release-metadata.json" "$BUILD/totals.json" "$VERSION"
for t in trees_map_points tree_crowns_pilot tree_change; do cp "$BUILD/$t.pmtiles" "$STAGE/data/"; done

step "manifest"
"$PY" - "$STAGE" <<'PYCODE'
import hashlib, json, pathlib, sys
from datetime import datetime, timezone
root = pathlib.Path(sys.argv[1]); files = []
for p in sorted(root.rglob("*")):
    if not p.is_file() or p.name == "bundle-manifest.json": continue
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""): h.update(block)
    files.append({"path": str(p.relative_to(root)), "bytes": p.stat().st_size, "sha256": h.hexdigest()})
(root / "bundle-manifest.json").write_text(json.dumps({"built_utc": datetime.now(timezone.utc).isoformat(), "files": files}, indent=2) + "\n")
print(f"{len(files)} files, {sum(f['bytes'] for f in files)/1e9:.2f} GB")
PYCODE

step "upload notes"
"$PY" - "$STAGE" "$BUILD/totals.json" "$VERSION" <<'PYCODE'
import json, pathlib, sys
root, totals, version = pathlib.Path(sys.argv[1]), json.loads(pathlib.Path(sys.argv[2]).read_text()), sys.argv[3]
size = lambda p: f"{p.stat().st_size/1e6:,.0f} MB"
details = sum(p.stat().st_size for p in (root/"data/tree_details").rglob("*") if p.is_file())
tiers = totals["evidence_tiers"]
text = f"""# ALTO upload {version}

Copy everything in this folder into the site folder that holds index.html, replacing files with the same names.

Replaces:
- index.html
- release-metadata.json
- data/trees_map_points.pmtiles ({size(root/'data/trees_map_points.pmtiles')})
- data/tree_crowns_pilot.pmtiles ({size(root/'data/tree_crowns_pilot.pmtiles')})
- data/tree_change.pmtiles ({size(root/'data/tree_change.pmtiles')})
- data/tree_details/ (whole folder, {details/1e6:,.0f} MB, including its .htaccess)

Everything else on the server stays as it is: the other data files (low_canopy_candidates.pmtiles,
tree_root_shapes.pmtiles, longitudinal, exports, identity), the scripts and styles, .htaccess, kyte/ and field/.

Order: upload the data folder first and index.html last. Keep copies of the current index.html,
release-metadata.json, the three .pmtiles files and tree_details/ until the new version checks out.

What is in this release:
- {totals['trees']:,} trees on the map (was 1,677,438) and {totals['crowns']:,} crowns.
- {totals['new_pointcloud_trees']:,} trees found only in the 2024 point cloud, each labelled by evidence:
  very likely {tiers.get('very_likely', 0):,}, probably {tiers.get('probable', 0):,}, possibly {tiers.get('possible', 0):,} a tree
  (counts include existing detections matched to the same crowns).
- {totals['restored']:,} island and shoreline records restored.
- Existing records kept. {tiers.get('unverified', 0):,} earlier detections have no 2024 laser canopy and are labelled
  unverified; {tiers.get('possible_duplicate', 0):,} are labelled as possible duplicates.
- Crown outlines traced from the 2024 laser returns.
- Port container-terminal removals in the change layer shown as unverified.
- The per-tree data download (exports) is unchanged and still describes the previous release.

bundle-manifest.json lists every file with its size and SHA-256.
"""
(root / "UPLOAD_README.md").write_text(text)
print(text)
PYCODE

step "local preview"
mkdir -p "$PREVIEW/data"
rsync -a --exclude data "$LIVE/" "$PREVIEW/"
rsync -a "$LIVE/data/" "$PREVIEW/data/"
for f in low_canopy_candidates.pmtiles tree_root_shapes.pmtiles; do ln -sf "$PREV/data/$f" "$PREVIEW/data/$f"; done
for f in "$PREV"/data/*.geojson; do [[ -e "$f" ]] && ln -sf "$f" "$PREVIEW/data/$(basename "$f")"; done
cp "$STAGE/index.html" "$STAGE/release-metadata.json" "$PREVIEW/"
for f in "$STAGE"/data/*.pmtiles; do ln -sf "$f" "$PREVIEW/data/$(basename "$f")"; done
ln -sfn "$STAGE/data/tree_details" "$PREVIEW/data/tree_details"
step "done: upload $STAGE ; preview $PREVIEW"
du -sh "$STAGE"
