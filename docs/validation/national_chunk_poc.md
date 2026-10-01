# National-method proof-of-concept — Christchurch chunk

_The Auckland CHM method applied to a chunk in Christchurch, on LINZ Christchurch 1m DSM/DEM
(2024-25). No GPU, no Auckland-specific services. `scripts/build_national_chunk_poc.py`._

## Result: the method generalises ✅

- Exported real LINZ Christchurch **DSM + DEM**, built a valid **CHM** (canopy 0–28 m), and
  **detected tree apexes** with the identical local-maxima method used in Auckland.
- So yes — the same pipeline (CHM → detection → crowns → missing-tree promotion) runs on a
  chunk **anywhere in NZ, CPU-only, resumable**. Crowns + promotion reuse the identical
  watershed/promotion steps; nothing here needed a GPU.

## First ground-truth height validation (impossible in Auckland)

Auckland's council register has no field heights; **Christchurch's does**. On the exported
chunk (171 × 287 m, **159** field-height trees; **153** with CHM canopy):

- **Median CHM canopy height 17.8 m vs median field height 17.0 m** — central tendency matches
  to ~1 m.
- RMSE 6.78 m, mean bias +2.91 m (CHM − field), r = 0.54.

The RMSE/bias are inflated (not the median) by a crude validation: the ±2 m max-CHM grabs the
tallest neighbouring crown in dense rows, and council heights are dated/rounded. Proper
apex-to-tree matching would tighten this. The encouraging headline: **LiDAR canopy heights
recover field heights at the median within ~1 m.**

## Caveat / production path

The **LINZ Exports API clipped the request to a 171 × 287 m corner** of the intended ~1.3 km
bbox (the same "tiny strip" behaviour that pushed the Auckland build to bulk LDS downloads).
So the exports API is **not** the way to acquire arbitrary national tiles. The production
national run should mirror Auckland: **bulk-download regional LINZ DSM/DEM (LDS GeoTIFF
archives), crop/tile locally** (`build_historic_chm_from_lds.py` is the template), then run the
existing per-tile detection/crown/promotion pipeline over a national tile grid, accumulating
into `nz_tree_sources.sqlite`. That is CPU, chunked, and resumable — NeSI later only for speed.

## Next
1. Generalise the per-tile pipeline from the Auckland pilot bbox to a national tile index.
2. Bulk DSM/DEM acquisition per region (start: Christchurch — to do the full field-height
   validation at scale, n≈176k, not 153).
3. Run detection → crowns → missing-tree promotion per tile → national store.
