#!/usr/bin/env python3
"""WS2 — Cross-time individual-tree stitching (see docs/research_programme.md).

Builds genuine per-tree trajectories across 2013 / 2016 / 2024:

  1. DETECT trees independently per epoch by variable-window local-maxima on each CHM.
     The 2024 pass is greenness-masked (GLI) so the *current* catalogue is clean trees,
     not rooftops. History is detected CHM-only so trees later removed are NOT pre-
     suppressed (critical for not hiding removals).
  2. STITCH identities between consecutive epochs by component-wise optimal
     one-to-one assignment, gated by a growth-rate prior.
  3. ASSEMBLE trajectories (union-find) and classify FATE, validated by 2024 CHM + GLI:
       persistent · established · removed_to_open (HIGH-confidence: canopy -> bare ground,
       immune to the building confound) · candidate_conversion (tall-but-non-green in 2024
       = likely tree->building / development; FLAGGED + building-polluted, needs historic
       imagery).
  4. LINK 2024 apexes to canonical `trees` via `tree_lidar_pilot.x_2193/y_2193`.

Tiled + vectorised so `--full` runs the whole pilot. Outputs `tree_trajectory_pilot`
(SQLite), `tree_trajectory_pilot.geojson` (clean change signal for the web map), and
docs/validation/ws2_trajectories_v1.md. Pure stdlib + numpy + scipy + rasterio. No GPU.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds
from scipy.ndimage import gaussian_filter, maximum_filter, uniform_filter
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
INTERIM = ROOT / "data" / "interim"
DB = ROOT / "data" / "processed" / "akl_trees.sqlite"
OUT_DIR = ROOT / "docs" / "validation"
GEOJSON_OUT = ROOT / "data" / "processed" / "tree_trajectory_pilot.geojson"

import sys  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pilot_config import active_pilot_name  # noqa: E402

# Pilot-aware interim paths (mirrors build_historic_chm_from_lds.py) so the
# same trajectory build runs for the isthmus or the wider metro extent.
_PILOT_NAME = active_pilot_name()
_PILOT_SLUG = "waitemata_lidar_pilot" if _PILOT_NAME == "waitemata_v1" else f"{_PILOT_NAME}_lidar"

CUR_CHM = INTERIM / _PILOT_SLUG / "chm.vrt"
HIST = INTERIM / f"historic_chm_{_PILOT_NAME}"
GREENNESS = INTERIM / f"greenness_{_PILOT_NAME}" / "greenness.vrt"
EPOCH_CHM = {2013: HIST / "chm_2013.tif", 2016: HIST / "chm_2016.tif", 2024: CUR_CHM}
YEARS = [2013, 2016, 2024]

MIN_HEIGHT_M = 5.0
GROUND_MAX_M = 3.0
SMOOTH_SIGMA_PX = 1.0
GLI_THRESHOLD = 0.06
GLI_WINDOW_PX = 5
MATCH_RADIUS_M = 4.0
MAX_GROWTH_M_YR = 1.5
MAX_DECLINE_M_YR = 2.5
GROWTH_PENALTY_W = 2.0
LINK_CANON_M = 5.0
TILE_M = 1000.0
HALO_M = 32.0

TO_4326 = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def disk(radius: int) -> np.ndarray:
    y, x = np.ogrid[-radius:radius + 1, -radius:radius + 1]
    return (x * x + y * y) <= radius * radius


def suppression_radius_m(h: float) -> float:
    return float(np.clip(2.5 + h * 0.25, 3.0, 12.0))


def detect_apexes(chm_path: Path, bbox, greenness_path: Path | None) -> tuple:
    """Tiled variable-window local-maxima detection. Returns (x, y, h) arrays in EPSG:2193."""
    x0, y0, x1, y1 = bbox
    xs_all, ys_all, hs_all = [], [], []
    gsrc = rasterio.open(greenness_path) if greenness_path else None
    with rasterio.open(chm_path) as src:
        nd = src.nodata
        tx = x0
        while tx < x1:
            ty = y0
            while ty < y1:
                ix1, iy1 = min(tx + TILE_M, x1), min(ty + TILE_M, y1)
                wb = (tx - HALO_M, ty - HALO_M, ix1 + HALO_M, iy1 + HALO_M)
                win = from_bounds(*wb, transform=src.transform)
                chm = src.read(1, window=win, boundless=True,
                               fill_value=(nd if nd is not None else 0.0)).astype("float32")
                tr = src.window_transform(win)
                covered = np.isfinite(chm)
                if nd is not None:
                    covered &= chm != nd
                work = np.where(covered & (chm > 0), chm, 0.0)
                if gsrc is not None:  # greenness mask (clean current catalogue)
                    g = gsrc.read(1, window=from_bounds(*wb, transform=gsrc.transform),
                                  boundless=True, fill_value=-1.0, out_shape=work.shape).astype("float32")
                    gnd = gsrc.nodata
                    if gnd is not None:
                        g[g == gnd] = -1.0
                    work[uniform_filter(np.nan_to_num(g, nan=-1.0), GLI_WINDOW_PX) < GLI_THRESHOLD] = 0.0
                work = gaussian_filter(work, SMOOTH_SIGMA_PX)
                mx = maximum_filter(work, footprint=disk(3))
                cand = np.argwhere((work == mx) & (work >= MIN_HEIGHT_M))
                if len(cand):
                    hh = work[cand[:, 0], cand[:, 1]]
                    order = np.argsort(-hh)
                    rows, cols, hh = cand[order, 0], cand[order, 1], hh[order]
                    px, py = rasterio.transform.xy(tr, rows, cols)
                    px, py = np.asarray(px), np.asarray(py)
                    suppressed = np.zeros(len(px), bool)
                    ktree = cKDTree(np.column_stack([px, py]))
                    for i in range(len(px)):
                        if suppressed[i]:
                            continue
                        for j in ktree.query_ball_point([px[i], py[i]], suppression_radius_m(hh[i])):
                            if j > i:
                                suppressed[j] = True
                    inner = (px >= tx) & (px < ix1) & (py >= ty) & (py < iy1) & (~suppressed)
                    xs_all.append(px[inner])
                    ys_all.append(py[inner])
                    hs_all.append(hh[inner])
                ty += TILE_M
            tx += TILE_M
    if gsrc:
        gsrc.close()
    if not xs_all:
        return np.array([]), np.array([]), np.array([])
    return np.concatenate(xs_all), np.concatenate(ys_all), np.concatenate(hs_all)


def sample(path: Path, xs: np.ndarray, ys: np.ndarray, bbox) -> np.ndarray:
    """Sample a raster at points by reading the bbox window once and indexing (fast at scale)."""
    if len(xs) == 0:
        return np.array([])
    with rasterio.open(path) as src:
        nd = src.nodata
        win = from_bounds(*bbox, transform=src.transform)
        arr = src.read(1, window=win, boundless=True,
                       fill_value=(nd if nd is not None else np.nan)).astype("float32")
        tr = src.window_transform(win)
    rows, cols = rasterio.transform.rowcol(tr, xs, ys)
    rows, cols = np.asarray(rows), np.asarray(cols)
    h, w = arr.shape
    out = np.full(len(xs), np.nan, "float32")
    ok = (rows >= 0) & (rows < h) & (cols >= 0) & (cols < w)
    out[ok] = arr[rows[ok], cols[ok]]
    if nd is not None:
        out[out == nd] = np.nan
    return out


def optimal_one_to_one(edges: list[tuple[float, int, int]]) -> list[tuple[int, int]]:
    """Return maximum-cardinality, minimum-cost links for sparse bipartite edges.

    Candidate graphs are decomposed into independent connected components before
    the Hungarian assignment, avoiding a metro-scale dense cost matrix. Invalid
    cells receive a cost larger than every valid edge; filtered assignments then
    yield maximum cardinality first and minimum total candidate cost second.
    """
    if not edges:
        return []

    parent: dict[tuple[str, int], tuple[str, int]] = {}

    def find(node: tuple[str, int]) -> tuple[str, int]:
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(left: tuple[str, int], right: tuple[str, int]) -> None:
        root_left = find(left)
        root_right = find(right)
        if root_left != root_right:
            parent[root_left] = root_right

    for _, ia, ib in edges:
        union(("a", ia), ("b", ib))

    components: dict[tuple[str, int], list[tuple[float, int, int]]] = defaultdict(list)
    for edge in edges:
        _, ia, ib = edge
        components[find(("a", ia))].append(edge)

    links: list[tuple[int, int]] = []
    for component_edges in components.values():
        a_ids = sorted({ia for _, ia, _ in component_edges})
        b_ids = sorted({ib for _, _, ib in component_edges})
        a_pos = {value: index for index, value in enumerate(a_ids)}
        b_pos = {value: index for index, value in enumerate(b_ids)}
        valid_max = max(cost for cost, _, _ in component_edges)
        invalid_cost = max(1.0, valid_max + 1.0) * (len(a_ids) + len(b_ids) + 1)
        costs = np.full((len(a_ids), len(b_ids)), invalid_cost, dtype="float64")
        for cost, ia, ib in component_edges:
            row, col = a_pos[ia], b_pos[ib]
            costs[row, col] = min(costs[row, col], cost)
        rows, cols = linear_sum_assignment(costs)
        for row, col in zip(rows, cols):
            if costs[row, col] < invalid_cost:
                links.append((a_ids[row], b_ids[col]))
    return sorted(links)


def stitch(a: tuple, b: tuple, years: float) -> list[tuple[int, int]]:
    ax, ay, ah = a
    bx, by, bh = b
    if len(ax) == 0 or len(bx) == 0:
        return []
    ta = cKDTree(np.column_stack([ax, ay]))
    pairs = []
    for ib in range(len(bx)):
        for ia in ta.query_ball_point([bx[ib], by[ib]], MATCH_RADIUS_M):
            dist = float(np.hypot(bx[ib] - ax[ia], by[ib] - ay[ia]))
            growth = (bh[ib] - ah[ia]) / years
            viol = max(0.0, growth - MAX_GROWTH_M_YR) + max(0.0, -growth - MAX_DECLINE_M_YR)
            if viol <= 1.0:
                pairs.append((dist + GROWTH_PENALTY_W * viol, ia, ib))
    return optimal_one_to_one(pairs)


def link_canonical(bx, by, bbox) -> dict:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute("SELECT l.tree_id, l.x_2193, l.y_2193 FROM tree_lidar_pilot l "
                       "JOIN trees t ON t.tree_id = l.tree_id "
                       "WHERE l.x_2193 BETWEEN ? AND ? AND l.y_2193 BETWEEN ? AND ?",
                       (bbox[0], bbox[2], bbox[1], bbox[3])).fetchall()
    con.close()
    if not rows or len(bx) == 0:
        return {}
    tids = [r[0] for r in rows]
    tree = cKDTree(np.array([[r[1], r[2]] for r in rows], float))
    edges = []
    for ib in range(len(bx)):
        for ia in tree.query_ball_point([bx[ib], by[ib]], LINK_CANON_M):
            distance = float(np.hypot(bx[ib] - rows[ia][1], by[ib] - rows[ia][2]))
            edges.append((distance, ia, ib))
    return {ib: tids[ia] for ia, ib in optimal_one_to_one(edges)}


def stable_trajectory_id(observations: dict[int, tuple[float, float, float]],
                         canonical_tree_id: str | None = None) -> str:
    """Create a deterministic ID from the canonical tree or epoch observations."""
    if canonical_tree_id:
        token = f"canonical:{canonical_tree_id}"
    else:
        token = "|".join(
            f"{year}:{values[0]:.2f}:{values[1]:.2f}"
            for year, values in sorted(observations.items())
        )
    return f"traj_{hashlib.sha256(token.encode('utf-8')).hexdigest()[:20]}"


MAP_FATES = {"removed_to_open", "established_since_2013", "established_since_2016"}


def classify_fates(p: dict[int, np.ndarray], hc: dict[int, np.ndarray],
                   gli: np.ndarray) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Classify trajectory fate without treating missing history as persistence.

    Historic CHMs cover less area than the current metro CHM. A current apex with
    no valid 2013 or 2016 pixel is outside the evidence domain, not a persistent
    tree. Keeping this logic separate makes the coverage rule testable.
    """
    def flags(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        covered = np.isfinite(values)
        return covered, covered & (values >= MIN_HEIGHT_M), covered & (values < GROUND_MAX_M)

    cov13, can13, grd13 = flags(hc[2013])
    cov16, can16, grd16 = flags(hc[2016])
    cov24, can24, grd24 = flags(hc[2024])
    green24 = np.isfinite(gli) & (gli >= GLI_THRESHOLD)
    prior = can16 | can13
    historic_coverage = cov13 | cov16

    fate = np.full(len(gli), "indeterminate", dtype=object)
    outside_history = p[2024] & ~historic_coverage
    est13 = p[2024] & cov13 & grd13 & ~can16
    est16 = p[2024] & cov16 & grd16 & ~est13
    persistent_current = p[2024] & prior & ~est13 & ~est16
    not_detected_2024 = ~p[2024]
    rem_open = not_detected_2024 & cov24 & grd24 & prior
    cand_conv = (
        not_detected_2024 & cov24 & can24 & ~green24 & prior & ~rem_open
    )
    persistent_recovered = (
        not_detected_2024 & cov24 & can24 & green24 & prior & ~rem_open & ~cand_conv
    )

    fate[outside_history] = "outside_historic_coverage"
    fate[persistent_current | persistent_recovered] = "persistent"
    fate[est13] = "established_since_2013"
    fate[est16] = "established_since_2016"
    fate[rem_open] = "removed_to_open"
    fate[cand_conv] = "candidate_conversion"
    masks = {
        "historic_coverage": historic_coverage,
        "prior_canopy": prior,
        "outside_historic_coverage": outside_history,
    }
    return fate, masks


def removal_confidence(present13, present16, h16, implausible) -> str:
    """Heuristic confidence that a removed_to_open record is a real lost tree, not detection
    noise. A tree seen in TWO prior epochs and tall is hard to explain as noise."""
    s = 0
    if present13 and present16:
        s += 2
    elif present13 or present16:
        s += 1
    if h16 is not None:
        s += 2 if h16 >= 12 else (1 if h16 >= 8 else 0)
    if not implausible:
        s += 1
    return "high" if s >= 4 else ("medium" if s >= 2 else "low")


def write_geojson_from_rows(rows) -> int:
    """Build the clean change-signal GeoJSON (removals + establishments) with confidence +
    species (where the trajectory links to a canonical inventory tree)."""
    tids = list({r[1] for r in rows if r[1]})
    sp = {}
    if tids:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        # Chunk the lookup: SQLite caps host parameters (SQLITE_MAX_VARIABLE_NUMBER),
        # and at metro scale tids is hundreds of thousands long for one IN (...).
        for i in range(0, len(tids), 900):
            chunk = tids[i:i + 900]
            sp.update(con.execute(
                "SELECT tree_id, species_common FROM trees WHERE tree_id IN (%s)" % ",".join("?" * len(chunk)),
                chunk).fetchall())
        con.close()
    feats = []
    for r in rows:
        fate = r[14]
        if fate not in MAP_FATES:
            continue
        conf = removal_confidence(r[6], r[7], r[10], r[15]) if fate == "removed_to_open" else "n/a"
        feats.append({"type": "Feature",
                      "geometry": {"type": "Point", "coordinates": [round(r[2], 6), round(r[3], 6)]},
                      "properties": {"fate": fate, "confidence": conf, "h_2013": r[9],
                                     "h_2016": r[10], "h_2024": r[11], "tree_id": r[1],
                                     "species": sp.get(r[1])}})
    GEOJSON_OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    return len(feats)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size-km", type=float, default=3.0)
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--export-only", action="store_true",
                    help="skip detection; re-export the GeoJSON from the existing table")
    args = ap.parse_args()

    if args.export_only:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        rows = con.execute("SELECT * FROM tree_trajectory_pilot").fetchall()
        con.close()
        n = write_geojson_from_rows(rows)
        print(f"export-only: wrote {n:,} change feats → {GEOJSON_OUT.name}")
        return

    with rasterio.open(CUR_CHM) as src:
        b = src.bounds
    if args.full:
        bbox = (b.left, b.bottom, b.right, b.top)
    else:
        cx, cy = (b.left + b.right) / 2, (b.bottom + b.top) / 2
        half = args.size_km * 1000 / 2
        bbox = (cx - half, cy - half, cx + half, cy + half)
    print(f"Window (EPSG:2193): {tuple(round(v) for v in bbox)}  ({'FULL' if args.full else f'{args.size_km} km'})")

    ep = {}
    for yr in YEARS:
        ep[yr] = detect_apexes(EPOCH_CHM[yr], bbox, GREENNESS if yr == 2024 else None)
        print(f"  {yr}: {len(ep[yr][0]):,} apexes")

    links = {}
    for ya, yb in zip(YEARS, YEARS[1:]):
        links[(ya, yb)] = stitch(ep[ya], ep[yb], yb - ya)
        print(f"  stitch {ya}->{yb}: {len(links[(ya, yb)]):,} matches")

    parent: dict = {}
    def find(n):
        parent.setdefault(n, n)
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n
    for yr in YEARS:
        for i in range(len(ep[yr][0])):
            parent.setdefault((yr, i), (yr, i))
    for (ya, yb), lk in links.items():
        for ia, ib in lk:
            parent[find((ya, ia))] = find((yb, ib))

    traj = defaultdict(dict)
    for yr in YEARS:
        x, y, h = ep[yr]
        for i in range(len(x)):
            traj[find((yr, i))][yr] = (float(x[i]), float(y[i]), float(h[i]))

    canon = link_canonical(*ep[2024][:2], bbox)
    canon_root = {find((2024, ib)): tid for ib, tid in canon.items()}

    # ---- assemble arrays + vectorised classification ----
    roots = list(traj.keys())
    K = len(roots)
    rx = np.empty(K)
    ry = np.empty(K)
    p = {yr: np.zeros(K, bool) for yr in YEARS}
    hh = {yr: np.full(K, np.nan) for yr in YEARS}
    canon_arr = []
    for k, root in enumerate(roots):
        obs = traj[root]
        last = max(obs)
        rx[k], ry[k] = obs[last][0], obs[last][1]
        for yr in obs:
            p[yr][k] = True
            hh[yr][k] = obs[yr][2]
        canon_arr.append(canon_root.get(root))

    hc = {yr: sample(EPOCH_CHM[yr], rx, ry, bbox) for yr in YEARS}
    gli = sample(GREENNESS, rx, ry, bbox)

    g1 = np.where(p[2013] & p[2016], (hh[2016] - hh[2013]) / 3.0, np.nan)
    g2 = np.where(p[2016] & p[2024], (hh[2024] - hh[2016]) / 8.0, np.nan)
    fate, _fate_masks = classify_fates(p, hc, gli)

    impl = np.zeros(K, bool)
    for gg in (g1, g2):
        m = np.isfinite(gg)
        impl[m] |= (gg[m] > MAX_GROWTH_M_YR) | (gg[m] < -MAX_DECLINE_M_YR)

    lon, lat = TO_4326.transform(rx, ry)
    def nn(v):
        return None if (v is None or not np.isfinite(v)) else float(v)
    ts = utc_now()

    rows_out = []
    for k in range(K):
        trajectory_id = stable_trajectory_id(traj[roots[k]], canon_arr[k])
        rows_out.append((trajectory_id, canon_arr[k], float(lon[k]), float(lat[k]),
                         float(rx[k]), float(ry[k]), int(p[2013][k]), int(p[2016][k]), int(p[2024][k]),
                         nn(hh[2013][k]), nn(hh[2016][k]), nn(hh[2024][k]),
                         nn(g1[k]), nn(g2[k]), fate[k], int(impl[k]), ts,
                         int(_fate_masks["historic_coverage"][k])))

    trajectory_ids = [row[0] for row in rows_out]
    if len(set(trajectory_ids)) != len(trajectory_ids):
        raise RuntimeError("deterministic trajectory ID collision; refusing to replace the table")

    con = sqlite3.connect(DB)
    try:
        con.execute("BEGIN IMMEDIATE")
        con.execute("DROP TABLE IF EXISTS tree_trajectory_pilot_next")
        con.execute("""CREATE TABLE tree_trajectory_pilot_next (
            trajectory_id TEXT PRIMARY KEY, canonical_tree_id TEXT, lon REAL, lat REAL,
            x_2193 REAL, y_2193 REAL, present_2013 INTEGER, present_2016 INTEGER, present_2024 INTEGER,
            h_2013 REAL, h_2016 REAL, h_2024 REAL, growth_2013_2016 REAL, growth_2016_2024 REAL,
            fate TEXT, implausible INTEGER, created_at_utc TEXT,
            historic_coverage INTEGER NOT NULL)""")
        con.executemany(
            "INSERT INTO tree_trajectory_pilot_next VALUES (%s)" % ",".join("?" * 18),
            rows_out,
        )
        con.execute("DROP TABLE IF EXISTS tree_trajectory_pilot")
        con.execute("ALTER TABLE tree_trajectory_pilot_next RENAME TO tree_trajectory_pilot")
        con.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_trajectory_canonical_unique "
            "ON tree_trajectory_pilot(canonical_tree_id) WHERE canonical_tree_id IS NOT NULL"
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_trajectory_fate ON tree_trajectory_pilot(fate)"
        )
        con.execute("""CREATE TABLE IF NOT EXISTS analysis_run_metadata (
            run_id TEXT PRIMARY KEY, product TEXT NOT NULL, method_id TEXT NOT NULL,
            parameters_json TEXT NOT NULL, row_count INTEGER NOT NULL,
            created_at_utc TEXT NOT NULL)""")
        run_id = f"tree_trajectory:{ts}"
        parameters = {
            "assignment": "component_hungarian_max_cardinality_min_cost",
            "years": YEARS,
            "match_radius_m": MATCH_RADIUS_M,
            "canonical_link_radius_m": LINK_CANON_M,
            "growth_penalty_weight": GROWTH_PENALTY_W,
            "full_extent": args.full,
            "bbox_epsg2193": list(map(float, bbox)),
        }
        con.execute(
            "INSERT OR REPLACE INTO analysis_run_metadata VALUES (?,?,?,?,?,?)",
            (run_id, "tree_trajectory_pilot", "trajectory_component_hungarian_v3",
             json.dumps(parameters, sort_keys=True), K, ts),
        )
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    nfeat = write_geojson_from_rows(rows_out)

    fate_counts = Counter(fate.tolist())
    gall = np.concatenate([g1[np.isfinite(g1)], g2[np.isfinite(g2)]])
    if gall.size == 0:
        gall = np.array([0.0])
    n = K
    linked = sum(1 for c in canon_arr if c)
    removed = fate_counts.get("removed_to_open", 0)
    lines = [
        "# WS2 — Cross-time tree trajectories (v2: greenness-masked + fate-validated)", "",
        f"_Generated {ts}. Window: {'FULL pilot' if args.full else f'central {args.size_km} km'}. "
        f"Epochs 2013/2016/2024; 2024 greenness-masked, history CHM-only._", "",
        "## Per-epoch detection", "", "| Epoch | apexes |", "|---|--:|",
        *[f"| {yr} | {len(ep[yr][0]):,} |" for yr in YEARS], "",
        f"**{n:,} trajectories** ({linked:,} linked to canonical trees).", "",
        "## Fate", "", "| Fate | n | share |", "|---|--:|--:|",
        *[f"| {kk} | {vv:,} | {vv/n:.1%} |" for kk, vv in fate_counts.most_common()], "",
        "## Headline", "",
        f"**`removed_to_open` = {removed:,} trees ({removed/n:.1%})** — canopy that became bare "
        f"ground (HIGH confidence; immune to the building confound). `candidate_conversion` "
        f"({fate_counts.get('candidate_conversion',0):,}) = tall-but-non-green in 2024 = likely "
        f"tree→building (development) BUT building-polluted (history is CHM-only); needs historic "
        f"imagery to separate real conversions from pre-existing structures. Not a tree-loss estimate.", "",
        "## Growth (stitched intervals, m/yr)", "",
        f"n={gall.size:,}  median **{np.median(gall):+.2f}**  p5 {np.percentile(gall,5):+.2f}  "
        f"p95 {np.percentile(gall,95):+.2f}", "",
        "---", "",
        "**Novel signal** the old `tree_change_pilot` cannot produce: identity-tracked individual-tree "
        "loss/gain across 3 epochs, with removals. Map layer = `removed_to_open` + `established_*` only "
        "(the clean signals). Current trees outside valid historic raster coverage are explicitly "
        "labelled `outside_historic_coverage`. Matching uses exact one-to-one assignment within "
        "independent candidate components and canonical links are unique. **Caveats:** min height "
        "5 m; one global growth prior; validate `removed_to_open` against "
        "independent aerial imagery before headline publication.",
    ]
    (OUT_DIR / "ws2_trajectories_v1.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\n== {n:,} trajectories ({linked:,} canon-linked) ==")
    for kk, vv in fate_counts.most_common():
        print(f"  {kk:<24} {vv:,}  ({vv/n:.1%})")
    print(f"growth m/yr: median {np.median(gall):+.2f}  p5 {np.percentile(gall,5):+.2f}  p95 {np.percentile(gall,95):+.2f}")
    print(f"\nReport -> ws2_trajectories_v1.md | table tree_trajectory_pilot | {GEOJSON_OUT.name} ({nfeat:,} change feats)")


if __name__ == "__main__":
    main()
