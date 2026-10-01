# Interpreter resolution, in order: an explicit `make PY=...`, an activated
# conda/virtual environment, then a discoverable geospatial environment, then
# plain python3. A bare python3 usually lacks rasterio/pyproj/geopandas, so
# `make check-env` states which interpreter will run and whether it is usable.
CONDA_PREFIX ?=
VIRTUAL_ENV ?=
_ENV_PY := $(firstword $(wildcard $(VIRTUAL_ENV)/bin/python $(CONDA_PREFIX)/bin/python))
PY ?= $(if $(_ENV_PY),$(_ENV_PY),$(shell command -v python3))

# A stale proj.db elsewhere in the environment triggers a
# "DATABASE.LAYOUT.VERSION" mismatch that breaks GeoTIFF CRS writes. Point PROJ
# at the interpreter's own rasterio-bundled copy when one exists, rather than
# hardcoding a single workstation path. An externally set PROJ_DATA wins.
ifeq ($(origin PROJ_DATA), undefined)
_RASTERIO_PROJ := $(shell $(PY) -c "import pathlib,rasterio;print(pathlib.Path(rasterio.__file__).parent/'proj_data')" 2>/dev/null)
export PROJ_DATA := $(if $(wildcard $(_RASTERIO_PROJ)),$(_RASTERIO_PROJ),)
endif

.PHONY: check-env
check-env:
	@echo "PY        = $(PY)"
	@echo "PROJ_DATA = $(PROJ_DATA)"
	@$(PY) -c "import rasterio, pyproj, geopandas; print('geospatial stack OK')" \
		|| { echo "ERROR: $(PY) lacks the geospatial stack. Activate the project environment or pass PY=/path/to/env/bin/python." >&2; exit 2; }

.PHONY: crown-pilot end-to-end-pilot fetch-public-data fetch-arcgis fetch-linz-metadata fetch-pilot-context guard-pilot lidar-pilot lidar-resample normalize-public-inventory pilot-findings profile-public-sources serve-pilot-map tree-context-pilot tree-valuation-pilot prepare-species-manifest plan-species-imagery hpc-readiness-manifest plan-pointcloud-download remediate-current-database remediate-record-roles
.PHONY: detect-inferred-trees train-species-class build-greenness-mask train-species-cnn train-species-imagery calibrate-species validate-deepforest build-tree-qa-layers enrich-tree-assets build-web-geojson build-pmtiles cleanup-orphans resume-from-resample fetch-historic-lidar build-historic-chm growth-change historic-change merge-web fetch-point-cloud tree-pointcloud apply-pointcloud pointcloud-verify build-web-deploy refresh-web-totals validate-pointcloud-tiles crown-merge apply-crown-merge missed-trees audit-readiness

audit-readiness:
	$(PY) scripts/audit_release_readiness.py --strict

prepare-species-manifest:
	$(PY) scripts/prepare_species_training_manifest.py

plan-species-imagery: prepare-species-manifest
	$(PY) scripts/fetch_species_imagery.py

hpc-readiness-manifest:
	$(PY) scripts/build_hpc_readiness_manifest.py --point-metadata all --write

plan-pointcloud-download: guard-pilot
	$(PY) scripts/fetch_point_cloud.py --plan-only

# Both commands are dry-run by default. Apply only after an external SQLite
# backup has been verified; the explicit flag is intentionally not in Make.
remediate-current-database:
	$(PY) scripts/remediate_current_database.py

remediate-record-roles:
	$(PY) scripts/remediate_record_roles.py

# The project currently uses one mutable SQLite database for every named
# extent. Never let a forgotten default silently rebuild a metro database as
# Waitemata. Long-term, each run should have an isolated database/output root.
guard-pilot:
	@if [ -z "$(AKL_TREES_PILOT)" ]; then \
		echo "ERROR: set AKL_TREES_PILOT explicitly (for example auckland_metro_v1)." >&2; \
		exit 2; \
	fi

normalize-public-inventory lidar-pilot lidar-resample crown-pilot cleanup-orphans \
tree-context-pilot train-species-class tree-valuation-pilot pilot-findings \
detect-inferred-trees build-greenness-mask train-species-imagery train-species-cnn \
calibrate-species validate-deepforest build-tree-qa-layers enrich-tree-assets \
build-web-geojson end-to-end-pilot resume-from-resample build-historic-chm \
fetch-historic-lidar growth-change historic-change fetch-point-cloud tree-pointcloud \
apply-pointcloud pointcloud-verify crown-merge apply-crown-merge missed-trees: guard-pilot

fetch-public-data: fetch-arcgis fetch-linz-metadata

fetch-arcgis:
	$(PY) scripts/fetch_arcgis_features.py

fetch-linz-metadata:
	$(PY) scripts/fetch_linz_metadata.py

fetch-pilot-context:
	$(PY) scripts/fetch_pilot_context_layers.py

profile-public-sources:
	$(PY) scripts/profile_public_sources.py --output docs/source_profile_latest.md

normalize-public-inventory:
	$(PY) scripts/normalize_public_tree_inventory.py

lidar-pilot:
	$(PY) scripts/build_lidar_pilot.py

# Distinct target name so it is NOT deduplicated by Make when listed again
# in end-to-end-pilot (Make treats prerequisites as a set). Same recipe as
# lidar-pilot — re-samples CHM heights for trees added by detect-inferred.
lidar-resample:
	$(PY) scripts/build_lidar_pilot.py

crown-pilot:
	$(PY) scripts/build_tree_crown_pilot.py

cleanup-orphans:
	$(PY) scripts/cleanup_inferred_without_crowns.py

tree-context-pilot:
	$(PY) scripts/build_tree_context_pilot.py

train-species-class:
	$(PY) scripts/train_species_class_model.py

tree-valuation-pilot:
	$(PY) scripts/build_tree_valuation.py

pilot-findings:
	$(PY) scripts/build_pilot_findings.py

detect-inferred-trees:
	$(PY) scripts/detect_inferred_trees.py

build-greenness-mask:
	$(PY) scripts/build_greenness_mask.py

train-species-imagery:
	$(PY) scripts/train_species_class_imagery.py

train-species-cnn:
	KMP_DUPLICATE_LIB_OK=TRUE $(PY) scripts/train_species_class_cnn.py

calibrate-species:
	$(PY) scripts/calibrate_species_predictions.py

validate-deepforest:
	KMP_DUPLICATE_LIB_OK=TRUE $(PY) scripts/validate_with_deepforest.py

build-tree-qa-layers:
	$(PY) scripts/build_tree_qa_layers.py

enrich-tree-assets:
	$(PY) scripts/enrich_tree_assets.py

build-web-geojson:
	$(PY) scripts/build_web_geojson.py

# Recompute the baked-in headline totals / species menu / growth buckets in
# web/pilot_map/index.html from the DB so they can't drift after steps that
# add or delete trees.
refresh-web-totals:
	$(PY) scripts/refresh_web_totals.py

build-pmtiles:
	scripts/build_pmtiles.sh

# Assemble a self-contained, upload-ready map bundle in outputs/web_deploy/
# (index.html + .htaccess + the three .pmtiles) for static Apache hosting.
build-web-deploy:
	scripts/build_web_deploy.sh

# Full pipeline as a SINGLE sequential recipe. This avoids Make's
# prerequisite-deduplication (which silently dropped the second lidar
# sample) and guarantees strict left-to-right ordering. Set AKL_TREES_PILOT
# to pick the bbox, e.g. AKL_TREES_PILOT=auckland_isthmus_v1 make end-to-end-pilot
end-to-end-pilot:
	$(PY) scripts/normalize_public_tree_inventory.py
	$(PY) scripts/build_lidar_pilot.py
	$(PY) scripts/build_greenness_mask.py
	$(PY) scripts/detect_inferred_trees.py
	$(PY) scripts/build_lidar_pilot.py   # resample: now includes inferred trees
	$(PY) scripts/build_tree_crown_pilot.py
	$(PY) scripts/cleanup_inferred_without_crowns.py
	$(PY) scripts/fetch_pilot_context_layers.py
	$(PY) scripts/build_tree_context_pilot.py
	$(PY) scripts/join_impervious_surfaces.py
	KMP_DUPLICATE_LIB_OK=TRUE $(PY) scripts/train_species_class_cnn.py
	$(PY) scripts/build_tree_valuation.py
	$(PY) scripts/enrich_tree_assets.py
	$(PY) scripts/build_pilot_findings.py
	$(PY) scripts/build_tree_qa_layers.py
	$(PY) scripts/build_web_geojson.py
	scripts/build_pmtiles.sh

# Resume the pipeline from the second LiDAR sample onward — for when CHM,
# greenness, and detection are already done but the inferred trees still
# need CHM samples + everything downstream.
resume-from-resample:
	$(PY) scripts/build_lidar_pilot.py
	$(PY) scripts/build_tree_crown_pilot.py
	$(PY) scripts/cleanup_inferred_without_crowns.py
	$(PY) scripts/fetch_pilot_context_layers.py
	$(PY) scripts/build_tree_context_pilot.py
	$(PY) scripts/join_impervious_surfaces.py
	KMP_DUPLICATE_LIB_OK=TRUE $(PY) scripts/train_species_class_cnn.py
	$(PY) scripts/build_tree_valuation.py
	$(PY) scripts/enrich_tree_assets.py
	$(PY) scripts/build_pilot_findings.py
	$(PY) scripts/build_tree_qa_layers.py
	$(PY) scripts/build_web_geojson.py
	scripts/build_pmtiles.sh

# --- Historic LiDAR change analysis (Priorities 3 & 4) ---
# Two ways to get the historic CHM:
#   build-historic-chm   (PREFERRED) reads the manually downloaded LINZ LDS
#                        regional GeoTIFF zips in
#                        data/raw/linz_historic_lidar/DSM_manualDL/ via /vsizip/.
#   fetch-historic-lidar (DEPRECATED) the LINZ Exports API path — returned only
#                        a ~0.37 km2 clipped strip for the isthmus bbox; kept
#                        for reference only.
#   AKL_TREES_PILOT=auckland_isthmus_v1 make historic-change HISTORIC_YEAR=2016
HISTORIC_YEAR ?= 2016

build-historic-chm:
	$(PY) scripts/build_historic_chm_from_lds.py --year $(HISTORIC_YEAR)

fetch-historic-lidar:
	$(PY) scripts/fetch_historic_lidar.py --year $(HISTORIC_YEAR)

growth-change:
	$(PY) scripts/build_growth_change.py \
	  --historic-chm data/interim/historic_chm_$${AKL_TREES_PILOT:-waitemata_v1}/chm_$(HISTORIC_YEAR).tif \
	  --historic-year $(HISTORIC_YEAR)

# Full historic-change run: build historic CHM from LDS zips → difference →
# re-merge web tiles → rebuild PMTiles.
historic-change: build-historic-chm growth-change merge-web build-pmtiles

# --- LiDAR point cloud (classified LAZ) ---
# Downloads LINZ Auckland 2024 point cloud per tile to data/raw/point_cloud_2024
# (override with AKL_TREES_PC_ROOT) for point-level vegetation/building/return
# analysis (false-positive control).
# Requires LINZ_API_KEY in .env and the pdal CLI. Resumable.
#   AKL_TREES_PILOT=auckland_isthmus_v1 make fetch-point-cloud
fetch-point-cloud:
	$(PY) scripts/fetch_point_cloud.py --workers 8

# Prove every downloaded LAZ tile by decompressing it end-to-end (the T7
# incident: dirent listings lie on a damaged volume). --delete-bad unlinks
# failures so a fetch rerun re-downloads them.
validate-pointcloud-tiles:
	$(PY) scripts/validate_pointcloud_tiles.py --workers 8 --delete-bad

tree-pointcloud:
	$(PY) scripts/build_tree_pointcloud_pilot.py

apply-pointcloud:
	$(PY) scripts/apply_pointcloud_verdicts.py

# Crown over-segmentation: find one-canopy-split-across-many-seeds clusters
# (CHM saddle-confirmed), report-only. Then propagate the auto clusters
# (flag duplicate seeds, merge crown slices) into the inventory outputs.
crown-merge:
	$(PY) scripts/merge_split_crowns.py

apply-crown-merge:
	$(PY) scripts/apply_crown_merge.py

# Point-native missed-tree detection (review candidates, NOT inserted into the
# inventory) → tree_pointcloud_missed_pilot + pointcloud_missed_trees_pilot.geojson.
missed-trees:
	$(PY) scripts/build_pointcloud_missed_trees.py

# Full point-cloud verification: sample classified returns per tree, apply
# false-positive deletions + no-canopy review flags, then rebuild web tiles so
# the verdicts and 3-D canopy metrics reach the map.
#   AKL_TREES_PILOT=auckland_isthmus_v1 make pointcloud-verify
pointcloud-verify: tree-pointcloud apply-pointcloud refresh-web-totals build-web-geojson build-pmtiles

merge-web:
	$(PY) scripts/merge_assets_into_web.py

serve-pilot-map:
	$(PY) scripts/serve_pilot_map.py
