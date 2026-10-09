"""Blind visual audit cards: 2024 RGB, NIR false colour and a LiDAR height view around each sampled record.

Each card shows the record point (red), any run-shifted position (orange, with an arrow), the
proposed crown (cyan for an existing v5 crown, magenta for a record-seeded crown), neighbouring
crowns (thin yellow) and other inventory records nearby (small blue). The status, band and score
are deliberately not printed: the card id is all that links a judgment back to the matcher, so the
reviewer judges the picture, not the number. The LiDAR panel is the maximum height of every
non-ground return (LAS 1, 3, 4, 5) at 0.5 m, with unclassified-only cells outlined in magenta and
building returns in grey - so a palm v5 could not see shows up.

Usage: audit.py sample | audit.py render [--ids ...] | audit.py sample2 (fresh validation round, after the rules
were revised on round one) | audit.py render --sample ../eval/audit_sample_r2.csv --cards audit_cards_r2
"""
from __future__ import annotations
import argparse, json, os
import numpy as np, pandas as pd
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from shapely import from_wkb
from common import WORK, OUT, EVAL, S3, tname
from features import read_laz, tiles_over, rasterise, fill_nearest

CARDS = EVAL / "audit_cards"; rng = np.random.default_rng(152)
SCREEN = {"akl_tree_trp_ACCT0159885": "Fan Palm", "akl_tree_trp_ACCT0257674": "Wattle", "akl_tree_trp_ACCT0248773": "Kowhai",
          "akl_tree_trp_ACCT0169814": "Cabbage Tree", "akl_tree_osm_node_7713504718": "OSM golden tree",
          "akl_tree_trp_ACCT0109736": "Matipo roof row", "akl_tree_trp_ACCT0151353": "Trachycarpus palm"}


def sample():
    L = pd.read_parquet(OUT / "links_v52.parquet")
    picks = []
    def take(df, n, stratum):
        if len(df):
            picks.append(df.sample(min(n, len(df)), random_state=int(rng.integers(1e9))).assign(stratum=stratum))
    for band, n in (("linked_high", 12), ("linked_medium", 12)):
        for g in ["register_at", "register_parks", "notable", "osm", "kauri_obs"]:
            take(L[(L.status == band) & (L.src_group == g)], n, f"{band}|{g}")
    take(L[(L.status == "needs_review") & L.crown_source.eq("v5")], 25, "needs_review_crown|all")
    nc = L[L.status == "linked_new_crown"].copy()
    palm = nc.species_latin.fillna("").str.split().str[0].isin(
        ["Washingtonia", "Phoenix", "Trachycarpus", "Archontophoenix", "Howea", "Syagrus", "Livistona", "Butia", "Rhopalostylis", "Chamaerops", "Cordyline"])
    take(nc[palm], 15, "linked_new_crown|palmlike"); take(nc[~palm], 25, "linked_new_crown|other")
    for st, n in (("tree_no_crown", 18), ("no_tree_found", 16), ("position_unusable", 8), ("needs_review", 0)):
        take(L[L.status == st], n, f"{st}|all")
    take(L[(L.status == "needs_review") & L.crown_source.isna()], 10, "needs_review_none|all")
    S = pd.concat(picks).drop_duplicates("tree_id").sample(frac=1, random_state=3).reset_index(drop=True)
    S["card"] = [f"C{i:03d}" for i in range(1, len(S) + 1)]
    sc = L[L.tree_id.isin(SCREEN)].assign(stratum="screenshot")
    sc["card"] = [f"S{i}" for i in range(1, len(sc) + 1)]
    S = pd.concat([S, sc], ignore_index=True)
    S[["card", "tree_id", "stratum", "status", "src_group"]].to_csv(EVAL / "audit_sample.csv", index=False)
    print(S.stratum.value_counts().to_string())


def sample2():
    """Validation round: fresh records only, drawn after the gates and guards were revised on round one."""
    L = pd.read_parquet(OUT / "links_v52.parquet")
    seen = set(pd.read_csv(EVAL / "audit_sample.csv").tree_id)
    L = L[~L.tree_id.isin(seen)]
    picks = []
    def take(df, n, stratum):
        if len(df):
            picks.append(df.sample(min(n, len(df)), random_state=int(rng.integers(1e9))).assign(stratum=stratum))
    for g, n in (("register_at", 10), ("register_parks", 8), ("osm", 3), ("notable", 3)):
        take(L[(L.status == "linked_medium") & (L.src_group == g)], n, f"linked_medium|{g}")
    take(L[L.status == "linked_high"], 12, "linked_high|all")
    nc = L[L.status == "linked_new_crown"]
    palm = nc.species_latin.fillna("").str.split().str[0].isin(
        ["Washingtonia", "Phoenix", "Trachycarpus", "Archontophoenix", "Howea", "Syagrus", "Livistona", "Butia", "Rhopalostylis", "Chamaerops", "Cordyline"])
    take(nc[palm], 10, "linked_new_crown|palmlike"); take(nc[~palm], 20, "linked_new_crown|other")
    take(L[L.status == "tree_no_crown"], 10, "tree_no_crown|all")
    S = pd.concat(picks).drop_duplicates("tree_id").sample(frac=1, random_state=11).reset_index(drop=True)
    S["card"] = [f"V{i:03d}" for i in range(1, len(S) + 1)]
    S[["card", "tree_id", "stratum", "status", "src_group"]].to_csv(EVAL / "audit_sample_r2.csv", index=False)
    print(S.stratum.value_counts().to_string())


def sample3():
    """Third round: more existing-crown links under the final rules, drawn in proportion to production by source."""
    L = pd.read_parquet(OUT / "links_v52.parquet")
    seen = set(pd.read_csv(EVAL / "audit_sample.csv").tree_id) | set(pd.read_csv(EVAL / "audit_sample_r2.csv").tree_id)
    L = L[~L.tree_id.isin(seen)]
    picks = []
    for band in ("linked_high", "linked_medium"):
        b = L[L.status == band]
        picks.append(b.sample(36, random_state=int(rng.integers(1e9)), weights=None).assign(stratum=b.status.iloc[0] + "|proportional"))
    S = pd.concat(picks).sample(frac=1, random_state=13).reset_index(drop=True)
    S["card"] = [f"W{i:03d}" for i in range(1, len(S) + 1)]
    S[["card", "tree_id", "stratum", "status", "src_group"]].to_csv(EVAL / "audit_sample_r3.csv", index=False)
    print(S.groupby(["stratum", "src_group"]).size().to_string())


def sample4():
    """Fourth round, the validation of the final rules: fresh linked records in proportion to production."""
    L = pd.read_parquet(OUT / "links_v52.parquet")
    seen = set()
    for r in ("", "_r2", "_r3"):
        seen |= set(pd.read_csv(EVAL / f"audit_sample{r}.csv").tree_id)
    L = L[~L.tree_id.isin(seen)]
    picks = [L[L.status == b].sample(n, random_state=int(rng.integers(1e9))).assign(stratum=b + "|proportional")
             for b, n in (("linked_high", 30), ("linked_medium", 30), ("linked_new_crown", 15))]
    S = pd.concat(picks).sample(frac=1, random_state=17).reset_index(drop=True)
    S["card"] = [f"X{i:03d}" for i in range(1, len(S) + 1)]
    S[["card", "tree_id", "stratum", "status", "src_group"]].to_csv(EVAL / "audit_sample_r4.csv", index=False)
    print(S.groupby(["stratum", "src_group"]).size().to_string())


def chip(x0, y0, x1, y1, px):
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.enums import Resampling
    w = h = px; acc = np.zeros((5, h, w), "float32")
    for t in tiles_over(x0, y0, x1, y1):
        try:
            with rasterio.open(f"/vsicurl/{S3}/{t.replace('pc_', '')}.tiff") as r:
                bx0, by0, bx1, by1 = r.bounds
                ox0, oy0, ox1, oy1 = max(x0, bx0), max(y0, by0), min(x1, bx1), min(y1, by1)
                if ox1 - ox0 < 0.2 or oy1 - oy0 < 0.2:
                    continue
                c0 = int(round((ox0 - x0) / (x1 - x0) * w)); r0 = int(round((y1 - oy1) / (y1 - y0) * h))
                cw = max(1, int(round((ox1 - ox0) / (x1 - x0) * w))); rh = max(1, int(round((oy1 - oy0) / (y1 - y0) * h)))
                a = r.read((1, 2, 3, 4, 5), window=from_bounds(ox0, oy0, ox1, oy1, r.transform), out_shape=(5, rh, cw),
                           resampling=Resampling.bilinear).astype("float32")
                acc[:, r0:r0 + rh, c0:c0 + cw] = a[:, :min(rh, h - r0), :min(cw, w - c0)]
        except Exception:
            pass
    rgb = np.clip(np.moveaxis(acc[:3], 0, -1) / 255 * 1.15, 0, 1)
    fc = np.clip(np.moveaxis(acc[[3, 0, 1]], 0, -1) / 255 * 1.15, 0, 1)
    return rgb, fc


def lidar(x0, y0, x1, y1):
    res = 0.5; w, h = int((x1 - x0) / res), int((y1 - y0) / res)
    xs = []
    for t in tiles_over(x0 - 10, y0 - 10, x1 + 10, y1 + 10):
        P = read_laz(t)
        if P is None:
            continue
        k = (P["x"] >= x0 - 10) & (P["x"] < x1 + 10) & (P["y"] >= y0 - 10) & (P["y"] < y1 + 10)
        xs.append({a: b[k] for a, b in P.items()})
    if not xs:
        return None
    P = {a: np.concatenate([d[a] for d in xs]) for a in xs[0]}
    X0, Y1 = x0 - 10, y1 + 10; W, H = w + 40, h + 40
    g = P["cls"] == 2
    dem = fill_nearest(rasterise(P["x"][g], P["y"][g], P["z"][g], X0, Y1, W, H, "min"))
    col = np.clip(((P["x"] - X0) / res).astype(int), 0, W - 1); row = np.clip(((Y1 - P["y"]) / res).astype(int), 0, H - 1)
    agl = P["z"] - dem[row, col]
    ng = np.isin(P["cls"], (1, 3, 4, 5)); veg = np.isin(P["cls"], (3, 4, 5)); c1 = P["cls"] == 1; b = P["cls"] == 6
    hng = rasterise(P["x"][ng], P["y"][ng], agl[ng], X0, Y1, W, H, "max")
    hveg = rasterise(P["x"][veg & (agl > 2)], P["y"][veg & (agl > 2)], agl[veg & (agl > 2)], X0, Y1, W, H, "max")
    hc1 = rasterise(P["x"][c1 & (agl > 2)], P["y"][c1 & (agl > 2)], agl[c1 & (agl > 2)], X0, Y1, W, H, "max")
    hb = rasterise(P["x"][b], P["y"][b], agl[b], X0, Y1, W, H, "count")
    sl = (slice(20, 20 + h), slice(20, 20 + w))
    return hng[sl], np.isfinite(hc1[sl]) & ~np.isfinite(hveg[sl]), hb[sl] > 0


def draw_geoms(ax, geoms, ext, **kw):
    for g in geoms:
        if g is None or g.is_empty:
            continue
        for p in getattr(g, "geoms", [g]):
            x, y = p.exterior.xy
            ax.plot(x, y, **kw)


def render(ids=None, links=None, sample_csv=None, cards=None):
    global CARDS
    if cards:
        CARDS = EVAL / cards
    CARDS.mkdir(parents=True, exist_ok=True)
    S = pd.read_csv(sample_csv or EVAL / "audit_sample.csv")
    if ids:
        S = S[S.card.isin(ids) | S.tree_id.isin(ids)]
    L = pd.read_parquet(links or OUT / "links_v52.parquet").set_index("tree_id")
    R = pd.read_parquet(WORK / "records.parquet")
    K = pd.read_parquet(WORK / "crowns.parquet")
    NC = pd.read_parquet(OUT / "new_crowns_v52.parquet").set_index("seg_key") if (OUT / "new_crowns_v52.parquet").exists() else None
    from common import load_crowns
    cards = []
    for r in S.itertuples(index=False):
        l = L.loc[r.tree_id]
        px, py = l.x_2193, l.y_2193
        sx, sy = px + (l.applied_row_shift_dx or 0), py + (l.applied_row_shift_dy or 0)
        tgt = None
        if isinstance(l.seg_key, str):
            if l.crown_source == "v5":
                kk = K[K.seg_key == l.seg_key]
                tgt = from_wkb(kk.crown_wkb.iloc[0]) if len(kk) else None
            elif NC is not None and l.seg_key in NC.index:
                tgt = from_wkb(NC.loc[l.seg_key, "crown_wkb"])
        pts = [(px, py), (sx, sy)] + ([tgt.centroid.coords[0]] if tgt is not None else [])
        cx, cy = np.mean([p[0] for p in pts]), np.mean([p[1] for p in pts])
        half = max(20.0, 0.5 * max(abs(p[0] - cx) for p in pts) * 2 + 8, 0.5 * max(abs(p[1] - cy) for p in pts) * 2 + 8)
        half = min(half, 40.0)
        x0, x1, y0, y1 = cx - half, cx + half, cy - half, cy + half
        rgb, fc = chip(x0, y0, x1, y1, 420)
        ld = lidar(x0, y0, x1, y1)
        cs = [c for t in tiles_over(x0 - 30, y0 - 30, x1 + 30, y1 + 30) if (c := load_crowns(t)) is not None]
        cc = pd.concat(cs) if cs else pd.DataFrame(columns=["x_2193", "y_2193", "crown_wkb", "canopy_class"])
        cc = cc[(cc.x_2193 > x0 - 25) & (cc.x_2193 < x1 + 25) & (cc.y_2193 > y0 - 25) & (cc.y_2193 < y1 + 25)]
        neigh = from_wkb(cc.crown_wkb.values)
        others = R[(R.x > x0) & (R.x < x1) & (R.y > y0) & (R.y < y1) & (R.tree_id != r.tree_id)]
        cards.append((r, l, (x0, x1, y0, y1), rgb, fc, ld, neigh, cc.canopy_class.values, tgt, (px, py), (sx, sy), others))
    for i in range(0, len(cards), 3):
        grp = cards[i:i + 3]
        fig, axs = plt.subplots(len(grp), 3, figsize=(12.6, 4.5 * len(grp)), squeeze=False)
        for row, (r, l, ext, rgb, fc, ld, neigh, ccls, tgt, p, s, others) in enumerate(grp):
            x0, x1, y0, y1 = ext
            for j, (ax, img) in enumerate(zip(axs[row], [rgb, fc, None])):
                if j < 2:
                    ax.imshow(img, extent=(x0, x1, y0, y1))
                elif ld is not None:
                    h, c1, b = ld
                    ax.imshow(np.where(b, np.nan, h), extent=(x0, x1, y0, y1), cmap="viridis", vmin=0, vmax=max(8, np.nanpercentile(h, 99) if np.isfinite(h).any() else 8))
                    ax.imshow(np.where(b, 1.0, np.nan), extent=(x0, x1, y0, y1), cmap="Greys", vmin=0, vmax=2, alpha=0.8)
                    ax.contour(np.flipud(c1.astype(float)), levels=[0.5], extent=(x0, x1, y0, y1), colors="magenta", linewidths=0.8, origin="lower")
                ax.set_facecolor("black")
                for g, k in zip(neigh, ccls):
                    if k == "tree":
                        draw_geoms(ax, [g], ext, color="yellow", lw=0.6)
                    else:
                        draw_geoms(ax, [g], ext, color="white", lw=0.5, ls=":")
                if tgt is not None:
                    draw_geoms(ax, [tgt], ext, color="cyan" if l.crown_source == "v5" else "magenta", lw=2.2)
                ax.scatter(others.x, others.y, s=10, c="deepskyblue", edgecolors="white", linewidths=0.3, zorder=4)
                ax.scatter([p[0]], [p[1]], s=55, c="red", edgecolors="white", linewidths=1.2, zorder=5)
                if abs(s[0] - p[0]) + abs(s[1] - p[1]) > 0.1:
                    ax.annotate("", xy=s, xytext=p, arrowprops=dict(arrowstyle="->", color="orange", lw=1.5))
                    ax.scatter([s[0]], [s[1]], s=40, facecolors="none", edgecolors="orange", linewidths=1.5, zorder=5)
                ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_xticks([]); ax.set_yticks([])
            sp = f"{l.species_common or ''} / {l.species_latin or ''}".strip(" /")
            axs[row, 0].set_title(f"{r.card}  {r.src_group}  {sp[:48]}", fontsize=9, loc="left")
            axs[row, 1].set_title(f"NIR false colour   {2 * (x1 - x0) / 2:.0f} m wide", fontsize=9, loc="left")
            axs[row, 2].set_title("non-ground height (mag = unclassified only, grey = building)", fontsize=8, loc="left")
        fig.tight_layout()
        fig.savefig(CARDS / f"sheet_{grp[0][0].card}_{grp[-1][0].card}.png", dpi=80)
        plt.close(fig)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd"); ap.add_argument("--ids", nargs="*")
    ap.add_argument("--links"); ap.add_argument("--sample"); ap.add_argument("--cards")
    a = ap.parse_args()
    {"sample": sample, "sample2": sample2, "sample3": sample3, "sample4": sample4}.get(a.cmd, lambda: render(a.ids, a.links, a.sample, a.cards))()
