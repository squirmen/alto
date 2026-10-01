#!/usr/bin/env python3
"""Stage 1 species-class classifier (non-image baseline).

Trains a gradient-boosted classifier that predicts the i-Tree-Eco-style
species *class* (evergreen broadleaf / deciduous broadleaf / conifer /
palm) for every LiDAR-inferred tree, using only structural and contextual
features already in the database. The classifier is evaluated with spatial
cross-validation so trees in the same 1 km grid cell never appear in both
train and test folds.

Outputs:
- `data/processed/akl_trees.sqlite`, table `tree_species_class_predictions`
- `docs/species_class_model.md` (accuracy, confusion matrix, feature
  importance, class distribution before/after)

After this script runs, ``build_tree_valuation.py`` will read the predicted
class (where available) so the carbon allometry, rainfall interception,
and PM2.5 LAI assumptions actually respond to species rather than
defaulting to evergreen broadleaf.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import balanced_accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import GroupKFold


ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"

# Keyword lists mirror build_tree_valuation.species_class so ground-truth
# labels align with the downstream valuation classes.
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

CLASSES = ["evergreen_broadleaf", "deciduous_broadleaf", "conifer", "palm_other"]


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


def load_dataset() -> pd.DataFrame:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        df = pd.read_sql_query(
            """
            SELECT
                t.tree_id,
                t.source_primary,
                t.species_common,
                t.species_latin,
                t.species_confidence,
                t.lon, t.lat,
                t.approx_x_m, t.approx_y_m,
                c.crown_area_m2,
                c.crown_diameter_m,
                c.crown_mean_chm_m,
                c.crown_max_chm_m,
                ctx.fraction_paved_surfaces,
                ctx.fraction_buildings,
                ctx.fraction_trees,
                ctx.air_temp_mean_c
            FROM trees t
            LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
            LEFT JOIN tree_context_pilot ctx ON ctx.tree_id = t.tree_id
            """,
            conn,
        )
    finally:
        conn.close()
    return df


def add_labels(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["species_class"] = [
        species_class_from_name(common, latin)
        for common, latin in zip(df["species_common"], df["species_latin"])
    ]
    label_confidences = {
        "source_species",
        "source_genus",
        "source_taxon",
        "source_kauri_observation",
        "source_notable_name",
    }
    df["is_labelled"] = df["species_confidence"].isin(label_confidences)
    df["is_inferred"] = df["source_primary"] == "lidar_inferred_canopy"
    return df


FEATURE_COLS = [
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


def feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    X = df[FEATURE_COLS].copy()
    # HistGradientBoostingClassifier handles NaN natively, so we just ensure
    # numeric dtype.
    for col in FEATURE_COLS:
        X[col] = pd.to_numeric(X[col], errors="coerce")
    return X


def spatial_groups(df: pd.DataFrame, cell_size_m: float = 1000.0) -> np.ndarray:
    gx = np.floor(df["approx_x_m"].fillna(0) / cell_size_m).astype("int64")
    gy = np.floor(df["approx_y_m"].fillna(0) / cell_size_m).astype("int64")
    # Stable integer hash of grid cell to use as a group id.
    return (gx * 1_000_003 + gy).to_numpy()


def cross_validate(
    X: pd.DataFrame,
    y: pd.Series,
    groups: np.ndarray,
    n_splits: int = 5,
) -> dict[str, Any]:
    skf = GroupKFold(n_splits=n_splits)
    all_y_true: list[str] = []
    all_y_pred: list[str] = []
    fold_scores = []
    for fold, (train_idx, test_idx) in enumerate(skf.split(X, y, groups=groups), start=1):
        model = HistGradientBoostingClassifier(
            max_depth=8,
            learning_rate=0.07,
            max_iter=350,
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
        "n_test_total": len(all_y_true),
    }


def train_final(X: pd.DataFrame, y: pd.Series) -> HistGradientBoostingClassifier:
    model = HistGradientBoostingClassifier(
        max_depth=8,
        learning_rate=0.07,
        max_iter=400,
        l2_regularization=0.5,
        random_state=7,
    )
    model.fit(X, y)
    return model


def predict_inferred(
    model: HistGradientBoostingClassifier,
    df_inferred: pd.DataFrame,
) -> pd.DataFrame:
    X = feature_matrix(df_inferred)
    proba = model.predict_proba(X)
    classes = list(model.classes_)
    top_idx = np.argmax(proba, axis=1)
    confidences = proba[np.arange(len(top_idx)), top_idx]
    predicted = [classes[i] for i in top_idx]
    out = df_inferred[["tree_id"]].copy()
    out["predicted_species_class"] = predicted
    out["species_class_confidence"] = confidences
    for index, cls in enumerate(classes):
        out[f"proba_{cls}"] = proba[:, index]
    return out


def persist_predictions(predictions: pd.DataFrame, model_meta: dict[str, Any]) -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_species_class_predictions")
        cols = ["tree_id TEXT PRIMARY KEY", "predicted_species_class TEXT", "species_class_confidence REAL"]
        for cls in CLASSES:
            cols.append(f"proba_{cls} REAL")
        cols.append("model_id TEXT")
        cols.append("created_at_utc TEXT")
        conn.execute(f"CREATE TABLE tree_species_class_predictions ({', '.join(cols)})")
        model_id = model_meta["model_id"]
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
        conn.execute(
            "CREATE INDEX idx_tree_species_class_pred ON tree_species_class_predictions(predicted_species_class)"
        )
        conn.commit()
    finally:
        conn.close()


def feature_importance(model: HistGradientBoostingClassifier, X: pd.DataFrame, y: pd.Series) -> list[tuple[str, float]]:
    sample_size = min(20_000, len(X))
    sample_idx = np.random.RandomState(11).choice(len(X), sample_size, replace=False)
    Xs = X.iloc[sample_idx]
    ys = y.iloc[sample_idx]
    result = permutation_importance(model, Xs, ys, n_repeats=3, random_state=11, n_jobs=-1)
    pairs = list(zip(FEATURE_COLS, result.importances_mean.tolist()))
    return sorted(pairs, key=lambda kv: kv[1], reverse=True)


def write_report(
    cv_results: dict[str, Any],
    importances: list[tuple[str, float]],
    distribution_inferred: dict[str, int],
    distribution_labelled: dict[str, int],
    model_meta: dict[str, Any],
) -> None:
    report = cv_results["classification_report"]
    matrix = cv_results["confusion_matrix"]
    labels = cv_results["labels"]
    lines = [
        "# Species-Class Model (Stage 1)",
        "",
        f"Generated at: {utc_now()}",
        "",
        "## What This Adds",
        "",
        "A gradient-boosted classifier that predicts the i-Tree-Eco-style species *class* (evergreen broadleaf / deciduous broadleaf / conifer / palm) for every LiDAR-inferred tree, using only structural and contextual features. It runs before the valuation step so the species-driven assumptions (carbon allometry, rainfall interception, leaf-area-based PM2.5 removal) actually respond to species rather than defaulting to evergreen broadleaf.",
        "",
        "## Model",
        "",
        "- Algorithm: `sklearn.ensemble.HistGradientBoostingClassifier`",
        f"- Features used: {', '.join(f'`{c}`' for c in FEATURE_COLS)}.",
        f"- Labels: {', '.join(f'`{c}`' for c in CLASSES)} (derived from council-supplied common/Latin names).",
        f"- Training rows (labelled): {model_meta['n_labelled']:,}.",
        "- Spatial cross-validation: GroupKFold(5) on 1 km cells.",
        "",
        "## Spatial Cross-Validation Quality",
        "",
        f"- Overall balanced accuracy (held-out): {cv_results['overall_balanced_accuracy']:.3f}",
        "- Per-fold balanced accuracy: " + ", ".join(f"{s['balanced_accuracy']:.3f}" for s in cv_results["fold_scores"]),
        "",
        "### Per-class quality (precision / recall / F1 / support)",
        "",
        "| Class | Precision | Recall | F1 | Support |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for cls in labels:
        cls_report = report.get(cls, {})
        precision = cls_report.get("precision", 0.0)
        recall = cls_report.get("recall", 0.0)
        f1 = cls_report.get("f1-score", 0.0)
        support = int(cls_report.get("support", 0))
        lines.append(f"| {cls} | {precision:.2f} | {recall:.2f} | {f1:.2f} | {support:,} |")
    lines.extend([
        "",
        "### Confusion matrix (rows = truth, cols = predicted)",
        "",
        "| | " + " | ".join(labels) + " |",
        "| --- |" + " --- |" * len(labels),
    ])
    for index, row in enumerate(matrix):
        cells = " | ".join(f"{value:,}" for value in row)
        lines.append(f"| **{labels[index]}** | {cells} |")
    lines.extend([
        "",
        "## Feature Importance (permutation)",
        "",
        "| Feature | Importance |",
        "| --- | ---: |",
    ])
    for name, score in importances:
        lines.append(f"| {name} | {score:.4f} |")
    lines.extend([
        "",
        "## Class Distribution",
        "",
        "| Class | Labelled (council) | Predicted (inferred) |",
        "| --- | ---: | ---: |",
    ])
    for cls in CLASSES:
        lines.append(
            f"| {cls} | {distribution_labelled.get(cls, 0):,} | {distribution_inferred.get(cls, 0):,} |"
        )
    lines.extend([
        "",
        "## Limitations & Next Steps",
        "",
        "- Labels are derived by keyword matching on the council-supplied species name. Mis-spelled or generic entries inherit the same `evergreen_broadleaf` default the rule-based labeller falls back to, so the supervisory signal for that class is conservative.",
        "- Features are non-visual: this model cannot see leaf shape, bark, or seasonal change. It distinguishes classes via crown structure and location.",
        "- Confidence is reported per tree. Trees with low confidence should be flagged in the web map for manual or higher-stage ML review.",
        "- Stage 2 (DeepForest crown detection on aerial imagery) and Stage 3 (CNN species classifier on RGB crops) remain the path to fine-species accuracy.",
        "",
        "## Outputs",
        "",
        "- `data/processed/akl_trees.sqlite`, table `tree_species_class_predictions`",
        "- `docs/species_class_model.md` (this file)",
    ])
    (DOCS_ROOT / "species_class_model.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-splits", type=int, default=5)
    args = parser.parse_args()

    print("Loading dataset...")
    df_raw = load_dataset()
    df = add_labels(df_raw)
    print(f"  total rows: {len(df):,}")
    df_labelled = df[df["is_labelled"] & df["crown_area_m2"].notna()].copy()
    df_inferred = df[df["is_inferred"]].copy()
    print(f"  labelled rows with features: {len(df_labelled):,}")
    print(f"  inferred rows: {len(df_inferred):,}")

    X = feature_matrix(df_labelled)
    y = df_labelled["species_class"]
    groups = spatial_groups(df_labelled)

    print("Running spatial cross-validation (GroupKFold)...")
    cv_results = cross_validate(X, y, groups, n_splits=args.n_splits)
    print(f"Overall balanced accuracy: {cv_results['overall_balanced_accuracy']:.3f}")

    print("Training final model on all labelled rows...")
    model = train_final(X, y)
    importances = feature_importance(model, X, y)
    print("Feature importance (top 5):", importances[:5])

    print(f"Predicting species class for {len(df_inferred):,} inferred trees...")
    predictions = predict_inferred(model, df_inferred)

    distribution_labelled = y.value_counts().to_dict()
    distribution_inferred = predictions["predicted_species_class"].value_counts().to_dict()

    model_meta = {
        "model_id": "stage1_histgb_species_class_v1",
        "n_labelled": int(len(df_labelled)),
        "n_inferred": int(len(df_inferred)),
        "balanced_accuracy_cv": cv_results["overall_balanced_accuracy"],
    }
    persist_predictions(predictions, model_meta)
    write_report(cv_results, importances, distribution_inferred, distribution_labelled, model_meta)

    summary = {
        "model_meta": model_meta,
        "predicted_distribution": distribution_inferred,
        "labelled_distribution": distribution_labelled,
        "top_features": importances[:5],
    }
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
