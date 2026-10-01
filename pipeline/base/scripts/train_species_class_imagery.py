#!/usr/bin/env python3
"""Stage 3-lite: species-class classifier that uses aerial imagery features.

A full Stage 3 CNN needs PyTorch and a GPU to train at full quality. This
script is the substantially lighter alternative: it crops a 16 m × 16 m patch
around each labelled tree from the cached Esri World Imagery (already on disk
under ``data/raw/esri_world_imagery/tiles_z18``), summarises the patch with a
small set of colour / vegetation indices (mean & std R, G, B; HSV stats;
Green Leaf Index; Excess Green), concatenates those with the Stage 1
structural features, and trains a gradient-boosted classifier. Apply the
trained model to every LiDAR-inferred tree.

This is not a substitute for a real CNN — but it is a meaningful
improvement on the structure-only Stage 1 model because broadleaf /
conifer / palm classes have distinct colour signatures in summer aerial
imagery.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from PIL import Image
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import balanced_accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import GroupKFold


ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
TILE_DIR = ROOT / "data" / "raw" / "esri_world_imagery" / "tiles_z18"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"

TILE_ZOOM = 18
TILE_SIZE = 256
PATCH_RADIUS_M = 8.0  # 16 m × 16 m patch ≈ typical broadleaf canopy

CLASSES = ["evergreen_broadleaf", "deciduous_broadleaf", "conifer", "palm_other"]

CONIFER_KEYWORDS = (
    "pine", "fir", "spruce", "cedar", "podocarp", "rimu", "totara", "matai",
    "miro", "kahikatea", "kauri", "yew", "cypress", "macrocarpa", "redwood",
    "araucaria", "wellingtonia", "sequoia",
)
DECIDUOUS_KEYWORDS = (
    "oak", "plane", "maple", "elm", "ash", "beech", "birch", "willow",
    "poplar", "liquidambar", "magnolia", "ginkgo", "cherry", "apple", "pear",
    "robinia", "alder", "tulip", "walnut", "horse chestnut", "rowan",
    "hawthorn",
)
PALM_KEYWORDS = (
    "palm", "phoenix", "nikau", "cabbage tree", "ti kouka", "cordyline",
    "cycad",
)

STRUCTURE_FEATURES = [
    "crown_area_m2",
    "crown_diameter_m",
    "crown_mean_chm_m",
    "crown_max_chm_m",
    "fraction_paved_surfaces",
    "fraction_buildings",
    "fraction_trees",
    "air_temp_mean_c",
    "approx_x_m",
    "approx_y_m",
]

IMAGE_FEATURES = [
    "img_mean_r", "img_mean_g", "img_mean_b",
    "img_std_r", "img_std_g", "img_std_b",
    "img_mean_h", "img_mean_s", "img_mean_v",
    "img_std_h", "img_std_s", "img_std_v",
    "img_gli_mean", "img_gli_std",
    "img_exg_mean", "img_exg_std",
    "img_r_minus_b_mean",
    "img_g_dominance",
]

ALL_FEATURES = STRUCTURE_FEATURES + IMAGE_FEATURES


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def species_class_from_name(common: str | None, latin: str | None) -> str:
    text = " ".join(filter(None, [common or "", latin or ""])).lower()
    if not text.strip():
        return "evergreen_broadleaf"
    if any(keyword in text for keyword in PALM_KEYWORDS):
        return "palm_other"
    if any(keyword in text for keyword in CONIFER_KEYWORDS):
        return "conifer"
    if any(keyword in text for keyword in DECIDUOUS_KEYWORDS):
        return "deciduous_broadleaf"
    return "evergreen_broadleaf"


def lonlat_to_tile_pixel(lon: float, lat: float, zoom: int) -> tuple[int, int, int, int]:
    n = 2 ** zoom
    x_world = (lon + 180.0) / 360.0 * n
    sin_lat = math.sin(math.radians(lat))
    y_world = (1 - math.log((1 + sin_lat) / (1 - sin_lat)) / (2 * math.pi)) / 2 * n
    tx = int(x_world)
    ty = int(y_world)
    px = int((x_world - tx) * TILE_SIZE)
    py = int((y_world - ty) * TILE_SIZE)
    return tx, ty, px, py


def meters_per_pixel(lat: float, zoom: int) -> float:
    return 156543.03 * math.cos(math.radians(lat)) / (2 ** zoom)


def crop_patch(lon: float, lat: float, radius_m: float, tile_cache: dict[tuple[int, int], np.ndarray | None]) -> np.ndarray | None:
    mpp = meters_per_pixel(lat, TILE_ZOOM)
    radius_px = max(2, int(round(radius_m / mpp)))
    tx, ty, px, py = lonlat_to_tile_pixel(lon, lat, TILE_ZOOM)

    # Compose source array large enough to cover the requested neighbourhood.
    patch_size = radius_px * 2 + 1
    out = np.zeros((patch_size, patch_size, 3), dtype="uint8")

    for dy in range(-1, 2):
        for dx in range(-1, 2):
            ttx = tx + dx
            tty = ty + dy
            key = (ttx, tty)
            if key not in tile_cache:
                path = TILE_DIR / f"{TILE_ZOOM}_{ttx}_{tty}.jpg"
                if path.exists():
                    try:
                        with Image.open(path) as image:
                            tile_cache[key] = np.array(image.convert("RGB"))
                    except Exception:
                        tile_cache[key] = None
                else:
                    tile_cache[key] = None
            tile_arr = tile_cache[key]
            if tile_arr is None:
                continue
            # Place tile in the composite local frame around (px, py).
            origin_x = dx * TILE_SIZE + px - radius_px
            origin_y = dy * TILE_SIZE + py - radius_px
            for src_row in range(TILE_SIZE):
                dst_row = src_row - origin_y
                if dst_row < 0 or dst_row >= patch_size:
                    continue
                for src_col_chunk_start in (0,):
                    pass  # we'll do this vectorised below

            # Vectorised slice approach:
            # Compute src window in tile and dst window in patch.
            src_y0 = max(0, origin_y)
            src_y1 = min(TILE_SIZE, origin_y + patch_size)
            src_x0 = max(0, origin_x)
            src_x1 = min(TILE_SIZE, origin_x + patch_size)
            if src_y1 <= src_y0 or src_x1 <= src_x0:
                continue
            dst_y0 = src_y0 - origin_y
            dst_y1 = dst_y0 + (src_y1 - src_y0)
            dst_x0 = src_x0 - origin_x
            dst_x1 = dst_x0 + (src_x1 - src_x0)
            out[dst_y0:dst_y1, dst_x0:dst_x1, :] = tile_arr[src_y0:src_y1, src_x0:src_x1, :]
    if not out.any():
        return None
    return out


def hsv_from_rgb(rgb: np.ndarray) -> np.ndarray:
    """Vectorised HSV conversion. rgb is uint8 HxWx3."""
    r = rgb[..., 0].astype("float32") / 255.0
    g = rgb[..., 1].astype("float32") / 255.0
    b = rgb[..., 2].astype("float32") / 255.0
    cmax = np.maximum(np.maximum(r, g), b)
    cmin = np.minimum(np.minimum(r, g), b)
    delta = cmax - cmin + 1e-9
    h = np.zeros_like(r)
    mask = cmax == r
    h[mask] = ((g - b) / delta)[mask] % 6
    mask = cmax == g
    h[mask] = ((b - r) / delta + 2)[mask]
    mask = cmax == b
    h[mask] = ((r - g) / delta + 4)[mask]
    h = h / 6.0
    s = np.where(cmax == 0, 0, delta / (cmax + 1e-9))
    v = cmax
    return np.stack([h, s, v], axis=-1)


def patch_features(patch: np.ndarray | None) -> dict[str, float]:
    if patch is None or patch.size == 0:
        return {key: np.nan for key in IMAGE_FEATURES}
    r = patch[..., 0].astype("float32")
    g = patch[..., 1].astype("float32")
    b = patch[..., 2].astype("float32")
    valid = (r + g + b) > 9
    if not valid.any():
        return {key: np.nan for key in IMAGE_FEATURES}
    r = r[valid]
    g = g[valid]
    b = b[valid]
    hsv = hsv_from_rgb(patch)
    h = hsv[..., 0].reshape(-1)[valid.reshape(-1)]
    s = hsv[..., 1].reshape(-1)[valid.reshape(-1)]
    v = hsv[..., 2].reshape(-1)[valid.reshape(-1)]
    eps = 1e-6
    gli = (2.0 * g - r - b) / (2.0 * g + r + b + eps)
    exg = 2.0 * g - r - b
    return {
        "img_mean_r": float(r.mean()),
        "img_mean_g": float(g.mean()),
        "img_mean_b": float(b.mean()),
        "img_std_r": float(r.std()),
        "img_std_g": float(g.std()),
        "img_std_b": float(b.std()),
        "img_mean_h": float(h.mean()),
        "img_mean_s": float(s.mean()),
        "img_mean_v": float(v.mean()),
        "img_std_h": float(h.std()),
        "img_std_s": float(s.std()),
        "img_std_v": float(v.std()),
        "img_gli_mean": float(gli.mean()),
        "img_gli_std": float(gli.std()),
        "img_exg_mean": float(exg.mean()),
        "img_exg_std": float(exg.std()),
        "img_r_minus_b_mean": float((r - b).mean()),
        "img_g_dominance": float((g - (r + b) / 2).mean()),
    }


def load_dataset() -> pd.DataFrame:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        df = pd.read_sql_query(
            """
            SELECT
                t.tree_id, t.source_primary,
                t.species_common, t.species_latin, t.species_confidence,
                t.lon, t.lat, t.approx_x_m, t.approx_y_m,
                c.crown_area_m2, c.crown_diameter_m,
                c.crown_mean_chm_m, c.crown_max_chm_m,
                ctx.fraction_paved_surfaces, ctx.fraction_buildings,
                ctx.fraction_trees, ctx.air_temp_mean_c
            FROM trees t
            LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
            LEFT JOIN tree_context_pilot ctx ON ctx.tree_id = t.tree_id
            """,
            conn,
        )
    finally:
        conn.close()
    df["species_class"] = [
        species_class_from_name(common, latin)
        for common, latin in zip(df["species_common"], df["species_latin"])
    ]
    label_conf = {
        "source_species", "source_genus", "source_taxon",
        "source_kauri_observation", "source_notable_name",
    }
    df["is_labelled"] = df["species_confidence"].isin(label_conf)
    df["is_inferred"] = df["source_primary"] == "lidar_inferred_canopy"
    return df


def extract_image_features(df: pd.DataFrame, label: str) -> pd.DataFrame:
    print(f"Extracting image features for {label} rows: {len(df):,}...")
    tile_cache: dict[tuple[int, int], np.ndarray | None] = {}
    cache_limit = 256
    rows = []
    for index, row in enumerate(df.itertuples(index=False), start=1):
        feats = patch_features(crop_patch(row.lon, row.lat, PATCH_RADIUS_M, tile_cache))
        rows.append(feats)
        if len(tile_cache) > cache_limit:
            # Drop half the cache when it grows past the limit.
            keys = list(tile_cache.keys())[: cache_limit // 2]
            for k in keys:
                tile_cache.pop(k, None)
        if index % 5000 == 0 or index == len(df):
            print(f"  {index:,}/{len(df):,}")
    return pd.DataFrame(rows, index=df.index)


def feature_matrix(df: pd.DataFrame, img: pd.DataFrame) -> pd.DataFrame:
    X = df[STRUCTURE_FEATURES].copy()
    X = X.join(img)
    for col in ALL_FEATURES:
        if col in X.columns:
            X[col] = pd.to_numeric(X[col], errors="coerce")
    return X[ALL_FEATURES]


def spatial_groups(df: pd.DataFrame, cell_size_m: float = 1000.0) -> np.ndarray:
    gx = np.floor(df["approx_x_m"].fillna(0) / cell_size_m).astype("int64")
    gy = np.floor(df["approx_y_m"].fillna(0) / cell_size_m).astype("int64")
    return (gx * 1_000_003 + gy).to_numpy()


def cross_validate(X: pd.DataFrame, y: pd.Series, groups: np.ndarray, n_splits: int) -> dict[str, Any]:
    skf = GroupKFold(n_splits=n_splits)
    all_y_true: list[str] = []
    all_y_pred: list[str] = []
    fold_scores = []
    for fold, (train_idx, test_idx) in enumerate(skf.split(X, y, groups=groups), start=1):
        model = HistGradientBoostingClassifier(
            max_depth=8,
            learning_rate=0.07,
            max_iter=400,
            l2_regularization=0.5,
            random_state=42 + fold,
        )
        model.fit(X.iloc[train_idx], y.iloc[train_idx])
        pred = model.predict(X.iloc[test_idx])
        score = balanced_accuracy_score(y.iloc[test_idx], pred)
        fold_scores.append({"fold": fold, "balanced_accuracy": float(score), "n_test": int(len(test_idx))})
        all_y_true.extend(y.iloc[test_idx].tolist())
        all_y_pred.extend(pred.tolist())
        print(f"  fold {fold}: balanced acc {score:.3f} (n_test={len(test_idx):,})")
    overall = balanced_accuracy_score(all_y_true, all_y_pred)
    report = classification_report(all_y_true, all_y_pred, labels=CLASSES, zero_division=0, output_dict=True)
    matrix = confusion_matrix(all_y_true, all_y_pred, labels=CLASSES)
    return {
        "overall_balanced_accuracy": float(overall),
        "fold_scores": fold_scores,
        "classification_report": report,
        "confusion_matrix": matrix.tolist(),
        "labels": CLASSES,
    }


def train_final(X: pd.DataFrame, y: pd.Series) -> HistGradientBoostingClassifier:
    model = HistGradientBoostingClassifier(
        max_depth=8, learning_rate=0.07, max_iter=500,
        l2_regularization=0.5, random_state=7,
    )
    model.fit(X, y)
    return model


def predict_inferred(model: HistGradientBoostingClassifier, df_inferred: pd.DataFrame, X_inferred: pd.DataFrame) -> pd.DataFrame:
    proba = model.predict_proba(X_inferred)
    classes = list(model.classes_)
    top_idx = np.argmax(proba, axis=1)
    confidences = proba[np.arange(len(top_idx)), top_idx]
    predicted = [classes[i] for i in top_idx]
    out = df_inferred[["tree_id"]].copy()
    out["predicted_species_class"] = predicted
    out["species_class_confidence"] = confidences
    for i, cls in enumerate(classes):
        out[f"proba_{cls}"] = proba[:, i]
    return out


def persist_predictions(predictions: pd.DataFrame, model_id: str) -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_species_class_predictions")
        cols = [
            "tree_id TEXT PRIMARY KEY",
            "predicted_species_class TEXT",
            "species_class_confidence REAL",
        ]
        for cls in CLASSES:
            cols.append(f"proba_{cls} REAL")
        cols.append("model_id TEXT")
        cols.append("created_at_utc TEXT")
        conn.execute(f"CREATE TABLE tree_species_class_predictions ({', '.join(cols)})")
        created = utc_now()
        rows = []
        for _, row in predictions.iterrows():
            payload = [row["tree_id"], row["predicted_species_class"], float(row["species_class_confidence"])]
            for cls in CLASSES:
                payload.append(float(row.get(f"proba_{cls}", 0.0)))
            payload.extend([model_id, created])
            rows.append(payload)
        placeholders = ",".join("?" for _ in range(3 + len(CLASSES) + 2))
        conn.executemany(
            f"INSERT INTO tree_species_class_predictions VALUES ({placeholders})",
            rows,
        )
        conn.execute("CREATE INDEX idx_tree_species_class_pred ON tree_species_class_predictions(predicted_species_class)")
        conn.commit()
    finally:
        conn.close()


def write_report(cv_results: dict[str, Any], distribution_inferred: dict[str, int], distribution_labelled: dict[str, int], model_meta: dict[str, Any]) -> None:
    report = cv_results["classification_report"]
    matrix = cv_results["confusion_matrix"]
    labels = cv_results["labels"]
    lines = [
        "# Species-Class Model (Stage 3-lite: structure + aerial colour)",
        "",
        f"Generated at: {utc_now()}",
        "",
        "## What This Adds",
        "",
        "Stage 3 proper trains a CNN on RGB aerial chips. We don't have PyTorch / a GPU installed in this environment, so this script does the next-best thing: it crops a 16 m × 16 m patch from the cached Esri World Imagery around each tree, summarises it with mean/std colour and vegetation-index statistics, and trains the same gradient-boosted classifier as Stage 1 on the combined structural + colour feature set.",
        "",
        "Healthy broadleaf canopy clusters lighter/yellower in summer than conifers, and palms have a very different texture / colour signature. Even shallow colour statistics carry signal a structure-only model cannot see.",
        "",
        "## Model",
        "",
        "- Algorithm: `sklearn.ensemble.HistGradientBoostingClassifier`.",
        f"- Features: {len(STRUCTURE_FEATURES)} structural + {len(IMAGE_FEATURES)} aerial colour/vegetation indices.",
        f"- Labels: {', '.join(f'`{c}`' for c in CLASSES)}.",
        f"- Patch size: 16 m × 16 m (radius {PATCH_RADIUS_M:.0f} m at z=18 Esri imagery, ~0.6 m pixel).",
        "- Spatial cross-validation: GroupKFold(5) on 1 km cells.",
        f"- Labelled rows used: {model_meta['n_labelled']:,}.",
        f"- Inferred rows scored: {model_meta['n_inferred']:,}.",
        "",
        "## Spatial Cross-Validation Quality",
        "",
        f"- Overall balanced accuracy: {cv_results['overall_balanced_accuracy']:.3f}",
        "- Per-fold balanced accuracy: " + ", ".join(f"{s['balanced_accuracy']:.3f}" for s in cv_results["fold_scores"]),
        "",
        "### Per-class quality",
        "",
        "| Class | Precision | Recall | F1 | Support |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for cls in labels:
        cls_report = report.get(cls, {})
        lines.append(f"| {cls} | {cls_report.get('precision', 0):.2f} | {cls_report.get('recall', 0):.2f} | {cls_report.get('f1-score', 0):.2f} | {int(cls_report.get('support', 0)):,} |")
    lines.extend([
        "",
        "### Confusion matrix (rows = truth, cols = predicted)",
        "",
        "| | " + " | ".join(labels) + " |",
        "| --- |" + " --- |" * len(labels),
    ])
    for index, matrix_row in enumerate(matrix):
        cells = " | ".join(f"{value:,}" for value in matrix_row)
        lines.append(f"| **{labels[index]}** | {cells} |")
    lines.extend([
        "",
        "## Class Distribution",
        "",
        "| Class | Labelled (council) | Predicted (inferred) |",
        "| --- | ---: | ---: |",
    ])
    for cls in CLASSES:
        lines.append(f"| {cls} | {distribution_labelled.get(cls, 0):,} | {distribution_inferred.get(cls, 0):,} |")
    lines.extend([
        "",
        "## Outputs",
        "",
        "- `data/processed/akl_trees.sqlite`, table `tree_species_class_predictions` (overwritten with Stage 3-lite output)",
        "- `docs/species_class_model_stage3_lite.md` (this file)",
    ])
    (DOCS_ROOT / "species_class_model_stage3_lite.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-splits", type=int, default=5)
    args = parser.parse_args()

    print("Loading dataset...")
    df = load_dataset()
    print(f"  total rows: {len(df):,}")
    df_labelled = df[df["is_labelled"] & df["crown_area_m2"].notna()].reset_index(drop=True)
    df_inferred = df[df["is_inferred"] & df["crown_area_m2"].notna()].reset_index(drop=True)
    print(f"  labelled rows with crowns: {len(df_labelled):,}")
    print(f"  inferred rows with crowns: {len(df_inferred):,}")

    img_labelled = extract_image_features(df_labelled, "labelled")
    img_inferred = extract_image_features(df_inferred, "inferred")

    X_labelled = feature_matrix(df_labelled, img_labelled)
    X_inferred = feature_matrix(df_inferred, img_inferred)
    y_labelled = df_labelled["species_class"]
    groups = spatial_groups(df_labelled)

    print("Running spatial cross-validation...")
    cv_results = cross_validate(X_labelled, y_labelled, groups, n_splits=args.n_splits)
    print(f"Overall balanced accuracy: {cv_results['overall_balanced_accuracy']:.3f}")

    print("Training final model on all labelled rows...")
    model = train_final(X_labelled, y_labelled)

    print(f"Predicting species class for {len(df_inferred):,} inferred trees...")
    predictions = predict_inferred(model, df_inferred, X_inferred)

    distribution_labelled = y_labelled.value_counts().to_dict()
    distribution_inferred = predictions["predicted_species_class"].value_counts().to_dict()

    model_meta = {
        "model_id": "stage3_lite_histgb_structure_plus_aerial_colour_v1",
        "n_labelled": int(len(df_labelled)),
        "n_inferred": int(len(df_inferred)),
        "balanced_accuracy_cv": cv_results["overall_balanced_accuracy"],
    }
    persist_predictions(predictions, model_meta["model_id"])
    write_report(cv_results, distribution_inferred, distribution_labelled, model_meta)

    print(json.dumps({
        "model_meta": model_meta,
        "predicted_distribution": distribution_inferred,
        "labelled_distribution": distribution_labelled,
    }, indent=2, default=str))


if __name__ == "__main__":
    main()
