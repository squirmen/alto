# Data Directory

`data/raw` contains snapshots from source systems. Treat these as immutable once downloaded.

`data/interim` contains working geospatial products such as tile subsets, canopy height rasters, candidate crown polygons, and join tables.

`data/processed` contains analytical outputs intended for publication or application use.

Large rasters, point clouds, GeoPackages, and tile packages are ignored by Git. Acquisition scripts and manifests should be committed instead.
