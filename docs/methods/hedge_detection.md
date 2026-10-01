# Hedge and screening-row detection: method, limitations, and forward plan

## Status

The hedge layer is held out of the public Aotearoa Long-term Tree Observatory release. The
current detector produces fragmentary and inconsistent output, and publishing a
layer at that quality would misrepresent the rest of the model. This note records
the method that was built, the reasons it underperforms, and the approach that
should replace it.

## Why hedges belong in the inventory

Hedges and screening rows are a distinct part of the urban forest. They provide
privacy, shelter, noise attenuation, and habitat connectivity, and they occupy a
different structural niche from individual trees: long, low, continuous strips of
clipped vegetation rather than compact crowns. A complete inventory records them
as their own asset class. The barrier here is detection quality.

## The method that was built

The detector works on the LINZ 2024 Auckland classified point cloud, one native
LAZ tile at a time. For each tile it:

1. builds a 1 metre vegetation-canopy-height grid (maximum vegetation-class return
   height minus a coarse ground surface);
2. keeps grid cells inside a hedge height band of 1.5 to 5.0 metres;
3. removes cells that sit beneath an existing tree crown, so the trace follows
   hedges instead of the linear edge of a tree canopy;
4. groups the remaining cells into connected components;
5. accepts a component as a hedge when it is long (at least 8 metres), narrow (no
   wider than 4 metres), and elongated (length at least three times the width),
   then emits its major axis as a centreline carrying length and mean height.

The output is a set of LineStrings with per-hedge length, width, and height.

## Why it underperforms

Four limitations are structural, and parameter tuning will not resolve them.

The first is tiling. Detection runs per tile with no stitching across tile seams.
A hedge that crosses a boundary between native tiles is cut, and any fragment that
then falls below the 8 metre length threshold is dropped. Continuous hedges appear
as broken segments or disappear at tile edges. This accounts for most of the
scattered output.

The second is the straight-line assumption. The principal-axis elongation test
rejects hedges that bend or turn, which describes most boundary hedges around
residential sections. L-shaped and curving hedges fail the test.

The third is the height band. The 1.5 to 5.0 metre window misses tall privacy
hedges above 5 metres and low clipped hedges below 1.5 metres, and it admits
linear low vegetation that is not a hedge at all: road verges, garden borders,
riparian margins, and vegetated walls. These drive the false positives.

The fourth is the limit of the data. Point-cloud geometry separates a strip from a
crown, yet it carries little signal for separating a hedge from a row of small
trees, a fence line with weed growth, or linear scrub. Shape alone cannot make
that call reliably.

## The approach that should replace it

A dependable hedge layer needs three changes.

Mosaic before detection. The strip mask should be assembled across the full pilot
extent and connected-component-labelled on the mosaic, so hedges are traced as
continuous features and tile seams stop fragmenting them. The per-tile design
should be retired.

Trace centrelines by skeletonisation. Replacing the principal-axis line with a
morphological skeleton lets the trace follow curves and corners, which recovers
the bending and L-shaped hedges that the elongation test discards. Skeleton branch
points then mark hedge junctions.

Classify with imagery and geometry together. High-resolution aerial imagery
carries the texture and colour cues that separate a maintained hedge from a road
verge or a fence line. A supervised classifier trained on a labelled sample, using
the LiDAR strip geometry alongside aerial spectral features, should set the
accept and reject decision. A first labelled set of several hundred hedges drawn
across a range of suburbs would support both training and a defensible accuracy
estimate.

Until those three changes are in place, the layer stays out of the public release.

## Parameters of record (current detector)

- Height band: 1.5 to 5.0 metres
- Minimum length: 8 metres
- Maximum width: 4 metres
- Minimum elongation (length divided by width): 3.0
- Area bounds: 10 to 3000 square metres
- Source: LINZ 2024 Auckland classified point cloud
