#!/usr/bin/env python3
"""Deprecated heuristic prior adjustment for Stage 3 growth-form scores.

Class-weighted training boosted minority classes for balanced learning, but
at inference the predicted class distribution shifts away from the
expected Auckland species mix (the CNN over-predicts palm and conifer).

This script historically applied a prior-ratio adjustment:
    p_calibrated(c|x) ∝ p_model(c|x) / p_model_prior(c) × p_target_prior(c)
then re-picked the argmax. That is not probability calibration: the council
inventory is a biased sample of public trees and the mean target prediction is
not the training prior required by label-shift correction. The default now
refuses to modify results. Use the explicit flag only to reproduce legacy runs;
fit temperature/vector scaling on out-of-fold predictions for real calibration.
"""

from __future__ import annotations

import json
import sqlite3
import argparse
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"

CLASSES = ["evergreen_broadleaf", "deciduous_broadleaf", "conifer", "palm_other"]
PROBA_COLS = [f"proba_{c}" for c in CLASSES]

# Mild smoothing of the labelled distribution towards uniform — the council
# inventory under-represents palms and conifers in private gardens.
LABEL_SMOOTHING = 0.10  # 10% weight on uniform prior


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_predictions() -> pd.DataFrame:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        # Gracefully no-op when the predictions table doesn't exist (e.g.,
        # after a fresh ``normalize_public_tree_inventory`` run before CNN
        # training). Caller checks for empty DataFrame.
        exists = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master "
            "WHERE type='table' AND name='tree_species_class_predictions'"
        ).fetchone()[0]
        if not exists:
            return pd.DataFrame()
        return pd.read_sql_query("SELECT * FROM tree_species_class_predictions", conn)
    finally:
        conn.close()


def labelled_prior() -> np.ndarray:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        labelled = pd.read_sql_query(
            """
            SELECT t.species_common, t.species_latin, t.species_confidence
            FROM trees t
            WHERE t.species_confidence IN (
                'source_species', 'source_genus', 'source_taxon',
                'source_kauri_observation', 'source_notable_name'
            )
            """,
            conn,
        )
    finally:
        conn.close()

    # Derive species_class the same way Stage 1/3 do.
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
    # Aligned with the keyword fix in train_species_class_cnn.py / build_tree_valuation.py.
    # "palm" as a substring matches "palmatum" (Japanese Maple) which is broadleaf,
    # so use specific palm genera + a word-boundary regex for the bare word "palm".
    PALM_KEYWORDS = (
        "phoenix", "cordyline", "rhopalostylis", "washingtonia",
        "trachycarpus", "howea", "butia", "areca", "cycas", "livistona",
        "nikau", "ti kouka", "cabbage tree", "cycad",
    )
    import re
    palm_word_re = re.compile(r"\bpalm\b")

    def klass(common: str | None, latin: str | None) -> str:
        text = " ".join(filter(None, [common or "", latin or ""])).lower()
        if not text.strip():
            return "evergreen_broadleaf"
        if any(k in text for k in PALM_KEYWORDS) or palm_word_re.search(text):
            return "palm_other"
        if any(k in text for k in CONIFER_KEYWORDS):
            return "conifer"
        if any(k in text for k in DECIDUOUS_KEYWORDS):
            return "deciduous_broadleaf"
        return "evergreen_broadleaf"

    labelled["species_class"] = [
        klass(common, latin)
        for common, latin in zip(labelled["species_common"], labelled["species_latin"])
    ]
    counts = labelled["species_class"].value_counts().reindex(CLASSES, fill_value=1).astype(float)
    raw_prior = (counts / counts.sum()).to_numpy()
    uniform = np.full(len(CLASSES), 1.0 / len(CLASSES))
    return (1 - LABEL_SMOOTHING) * raw_prior + LABEL_SMOOTHING * uniform


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--allow-legacy-prior-adjustment",
        action="store_true",
        help="reproduce the legacy heuristic; not accepted as calibrated probability",
    )
    args = parser.parse_args()
    if not args.allow_legacy_prior_adjustment:
        raise SystemExit(
            "Refusing heuristic prior adjustment. It is not probability calibration. "
            "Use out-of-fold labelled predictions to fit and evaluate a calibrator, or pass "
            "--allow-legacy-prior-adjustment only for legacy reproduction."
        )
    print("Loading CNN predictions...")
    pred = load_predictions()
    if pred.empty:
        print("  no tree_species_class_predictions table — skipping calibration.")
        print("  (Run train_species_class_cnn.py first if you want CNN-based labels.)")
        return
    proba = pred[PROBA_COLS].to_numpy().astype("float64")
    proba = np.clip(proba, 1e-8, 1.0)
    # Re-normalise just in case.
    proba = proba / proba.sum(axis=1, keepdims=True)
    model_prior = proba.mean(axis=0)
    target_prior = labelled_prior()
    print("Model prior (average predicted distribution):")
    for cls, p in zip(CLASSES, model_prior):
        print(f"  {cls}: {p:.3f}")
    print("Target prior (smoothed labelled distribution):")
    for cls, p in zip(CLASSES, target_prior):
        print(f"  {cls}: {p:.3f}")

    # Saerens correction.
    ratio = target_prior / model_prior
    corrected = proba * ratio
    corrected = corrected / corrected.sum(axis=1, keepdims=True)

    top_idx = np.argmax(corrected, axis=1)
    confidences = corrected[np.arange(len(top_idx)), top_idx]
    pred_corrected = [CLASSES[i] for i in top_idx]

    print("Calibrated predicted distribution:")
    new_dist = pd.Series(pred_corrected).value_counts().reindex(CLASSES, fill_value=0)
    for cls in CLASSES:
        print(f"  {cls}: {int(new_dist[cls]):,}")

    conn = sqlite3.connect(SQLITE_PATH)
    try:
        cursor = conn.cursor()
        created = utc_now()
        model_id_old = pred["model_id"].iloc[0] if len(pred) else "unknown"
        model_id_new = f"{model_id_old}__calibrated_saerens_smoothed"
        for tree_id, cls, conf, probs in zip(
            pred["tree_id"], pred_corrected, confidences, corrected
        ):
            cursor.execute(
                """
                UPDATE tree_species_class_predictions
                SET predicted_species_class = ?,
                    species_class_confidence = ?,
                    proba_evergreen_broadleaf = ?,
                    proba_deciduous_broadleaf = ?,
                    proba_conifer = ?,
                    proba_palm_other = ?,
                    model_id = ?,
                    created_at_utc = ?
                WHERE tree_id = ?
                """,
                (
                    cls, float(conf),
                    float(probs[0]), float(probs[1]), float(probs[2]), float(probs[3]),
                    model_id_new, created, tree_id,
                ),
            )
        conn.commit()
    finally:
        conn.close()

    summary = {
        "calibration_method": "legacy heuristic prior-ratio adjustment with 10% uniform smoothing",
        "model_prior": dict(zip(CLASSES, model_prior.tolist())),
        "target_prior": dict(zip(CLASSES, target_prior.tolist())),
        "calibrated_distribution": new_dist.to_dict(),
    }
    (DOCS_ROOT / "species_class_calibration.md").write_text(
        "# Stage 3 CNN Calibration\n\n"
        f"Generated at: {utc_now()}\n\n"
        "## Method\n\n"
        "Saerens et al. 2002 post-hoc prior correction with 10 % uniform smoothing "
        "on the labelled-distribution prior. Adjusts CNN softmax outputs so the "
        "predicted distribution matches the expected Auckland species mix instead "
        "of the class-weighted training bias.\n\n"
        "## Distributions\n\n"
        "```json\n" + json.dumps(summary, indent=2) + "\n```\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
