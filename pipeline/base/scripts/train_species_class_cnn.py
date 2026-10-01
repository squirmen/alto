#!/usr/bin/env python3
"""Stage 3 CNN growth-form classifier.

Fine-tunes a small ResNet18 (ImageNet pre-trained) on 64×64 aerial RGB
chips cropped around each labelled tree, then predicts one of four growth forms for
every LiDAR-inferred tree. Replaces Stage 1 / Stage 3-lite predictions in
the SQLite `tree_species_class_predictions` table.

This does not identify species. Softmax maxima are model scores, not calibrated
probabilities. Spatial out-of-fold predictions are stored separately for audit.

Uses Apple Silicon MPS when available, falls back to CPU. Training is a
short fine-tune (≤ 8 epochs) — the small per-class signal in aerial RGB
caps the achievable accuracy, but it should beat the colour-statistics
shortcut (Stage 3-lite, balanced accuracy 0.416).
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
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from sklearn.metrics import balanced_accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import GroupKFold
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms


ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
TILE_DIR = ROOT / "data" / "raw" / "esri_world_imagery" / "tiles_z18"
SQLITE_PATH = PROCESSED_ROOT / "akl_trees.sqlite"
DEFAULT_MODEL_OUTPUT = ROOT / "outputs" / "models" / "growth_form_resnet18_aerial_rgb_v1.pt"
MODEL_ID = "growth_form_resnet18_aerial_rgb_v2_abstaining"

TILE_ZOOM = 18
TILE_SIZE = 256
PATCH_RADIUS_M = 12.0  # 24 m × 24 m chip — broader than Stage 3-lite for CNN context
IMAGE_SIZE = 64  # CNN input resolution

CLASSES = ["evergreen_broadleaf", "deciduous_broadleaf", "conifer", "palm_other"]
CLASS_TO_INDEX = {cls: i for i, cls in enumerate(CLASSES)}

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
    # Specific palm genera (Latin names). Listing the genus explicitly
    # avoids the trap of matching "palm" inside "palmatum" (Japanese
    # Maple / Acer palmatum is *not* a palm).
    "phoenix",       # date palms, Phoenix canariensis (Canary Island), P. reclinata
    "cordyline",     # cabbage tree / Ti kouka (Cordyline australis)
    "rhopalostylis", # nikau (NZ native palm)
    "washingtonia",  # fan palm, Mexican fan palm
    "trachycarpus",  # windmill palm
    "howea",         # kentia palm
    "butia",         # jelly / wine palm
    "areca",         # areca palm
    "cycas",         # cycad
    "livistona",     # cabbage palm (Australian)
    # Common-name fragments that are safe substrings.
    "nikau", "ti kouka", "cabbage tree", "cycad",
)


_PALM_WORD_RE = None


def _has_palm_keyword(text: str) -> bool:
    """True if the text contains a palm genus or the standalone word 'palm'.

    Using a word-boundary regex for 'palm' so we don't false-match
    Acer ``palmatum`` (Japanese Maple, a deciduous broadleaf) or other
    Latin epithets that contain ``palm`` as a substring.
    """
    global _PALM_WORD_RE
    if not text:
        return False
    if any(keyword in text for keyword in PALM_KEYWORDS):
        return True
    import re
    if _PALM_WORD_RE is None:
        _PALM_WORD_RE = re.compile(r"\bpalm\b")
    return bool(_PALM_WORD_RE.search(text))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def species_class_from_name(common: str | None, latin: str | None) -> str:
    text = " ".join(filter(None, [common or "", latin or ""])).lower()
    if not text.strip():
        return "evergreen_broadleaf"
    if _has_palm_keyword(text):
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
            origin_x = dx * TILE_SIZE + px - radius_px
            origin_y = dy * TILE_SIZE + py - radius_px
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


def load_rows() -> pd.DataFrame:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        df = pd.read_sql_query(
            """
            SELECT
                t.tree_id, t.source_primary,
                t.species_common, t.species_latin, t.species_confidence,
                t.lon, t.lat, t.approx_x_m, t.approx_y_m,
                c.crown_area_m2
            FROM trees t
            LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
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
    # Predict for every machine-detected tree with no council species: the
    # LiDAR-inferred set plus the promoted point-cloud candidates (missed
    # trees + low-canopy) which would otherwise stay 'Unknown'.
    df["is_inferred"] = df["source_primary"].isin(
        ("lidar_inferred_canopy", "pointcloud_missed_promoted", "low_canopy_promoted"))
    return df


def extract_all_patches(df: pd.DataFrame, label: str) -> tuple[np.ndarray, list[int]]:
    """Returns (N, IMAGE_SIZE, IMAGE_SIZE, 3) uint8 stack + list of original
    indices (some rows may be dropped if no tile available)."""
    print(f"Extracting {len(df):,} patches for {label}...")
    tile_cache: dict[tuple[int, int], np.ndarray | None] = {}
    cache_limit = 768
    patches: list[np.ndarray] = []
    keep_indices: list[int] = []
    for i, row in enumerate(df.itertuples(index=False), start=1):
        patch = crop_patch(row.lon, row.lat, PATCH_RADIUS_M, tile_cache)
        if patch is None:
            continue
        if patch.shape[0] != IMAGE_SIZE or patch.shape[1] != IMAGE_SIZE:
            patch_img = Image.fromarray(patch).resize((IMAGE_SIZE, IMAGE_SIZE), Image.BILINEAR)
            patch = np.array(patch_img)
        patches.append(patch)
        keep_indices.append(i - 1)
        if len(tile_cache) > cache_limit:
            keys = list(tile_cache.keys())[: cache_limit // 2]
            for k in keys:
                tile_cache.pop(k, None)
        if i % 5000 == 0 or i == len(df):
            print(f"  {i:,}/{len(df):,}")
    if not patches:
        return np.empty((0, IMAGE_SIZE, IMAGE_SIZE, 3), dtype="uint8"), []
    return np.stack(patches), keep_indices


class PatchDataset(Dataset):
    def __init__(self, patches: np.ndarray, labels: np.ndarray | None, augment: bool):
        self.patches = patches
        self.labels = labels
        self.augment = augment
        self.norm = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])

    def __len__(self) -> int:
        return len(self.patches)

    def __getitem__(self, index: int):
        patch = self.patches[index].astype("float32") / 255.0
        if self.augment:
            # Random flip + 90 degree rotations.
            if np.random.rand() < 0.5:
                patch = patch[:, ::-1, :].copy()
            if np.random.rand() < 0.5:
                patch = patch[::-1, :, :].copy()
            k = np.random.randint(0, 4)
            if k:
                patch = np.rot90(patch, k=k, axes=(0, 1)).copy()
        tensor = torch.from_numpy(patch).permute(2, 0, 1)  # CHW
        tensor = self.norm(tensor)
        if self.labels is None:
            return tensor
        return tensor, int(self.labels[index])


def build_model(num_classes: int) -> nn.Module:
    model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
    in_features = model.fc.in_features
    model.fc = nn.Linear(in_features, num_classes)
    return model


def class_weights_from_labels(labels: np.ndarray, num_classes: int,
                              palm_boost: float = 1.0, weight_power: float = 0.5) -> torch.Tensor:
    counts = np.bincount(labels, minlength=num_classes).astype("float64")
    # SOFTENED reweighting. Full inverse-frequency (weight_power=1) on a
    # near-chance classifier collapses it: the model minimises the heavily
    # weighted loss by over-predicting the up-weighted (rare) classes with high
    # confidence (observed at metro scale: raw output 65% conifer / 17% palm).
    # weight_power=0.5 nudges toward balance without claiming probability calibration.
    inverse = (1.0 / np.maximum(counts, 1)) ** weight_power
    weights = inverse / inverse.mean()  # normalise to mean 1 (stable loss scale)
    if palm_boost != 1.0 and "palm_other" in CLASSES:
        weights[CLASSES.index("palm_other")] *= palm_boost
    return torch.tensor(weights, dtype=torch.float32)


def train_one_epoch(model: nn.Module, loader: DataLoader, criterion: nn.Module, optimizer, device) -> float:
    model.train()
    running = 0.0
    seen = 0
    for batch in loader:
        x, y = batch
        x = x.to(device, non_blocking=True)
        y = y.to(device, non_blocking=True)
        optimizer.zero_grad()
        logits = model(x)
        loss = criterion(logits, y)
        loss.backward()
        optimizer.step()
        running += float(loss.detach().cpu()) * x.size(0)
        seen += x.size(0)
    return running / max(seen, 1)


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    preds: list[int] = []
    truths: list[int] = []
    for batch in loader:
        x, y = batch
        x = x.to(device)
        logits = model(x)
        preds.extend(logits.argmax(dim=1).cpu().tolist())
        truths.extend(y.cpu().tolist())
    return np.array(truths), np.array(preds)


@torch.no_grad()
def predict_proba(model: nn.Module, loader: DataLoader, device) -> np.ndarray:
    model.eval()
    out: list[np.ndarray] = []
    for batch in loader:
        if isinstance(batch, (list, tuple)):
            x = batch[0]
        else:
            x = batch
        x = x.to(device)
        logits = model(x)
        proba = F.softmax(logits, dim=1)
        out.append(proba.cpu().numpy())
    return np.concatenate(out, axis=0)


def abstaining_predictions(
    probabilities: np.ndarray, threshold: float
) -> tuple[list[str], list[str], np.ndarray, np.ndarray]:
    """Return publish labels, raw growth forms, scores and abstention flags."""
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("abstention threshold must be between 0 and 1")
    top_idx = np.argmax(probabilities, axis=1)
    scores = probabilities[np.arange(len(top_idx)), top_idx]
    raw = [CLASSES[index] for index in top_idx]
    abstained = scores < threshold
    published = ["unknown" if flag else label for label, flag in zip(raw, abstained)]
    return published, raw, scores, abstained


def spatial_split(df: pd.DataFrame, n_splits: int) -> list[tuple[np.ndarray, np.ndarray]]:
    gx = np.floor(df["approx_x_m"].fillna(0) / 1000.0).astype("int64")
    gy = np.floor(df["approx_y_m"].fillna(0) / 1000.0).astype("int64")
    groups = (gx * 1_000_003 + gy).to_numpy()
    indices = np.arange(len(df))
    gkf = GroupKFold(n_splits=n_splits)
    return list(gkf.split(indices, df["species_class"], groups=groups))


def persist_predictions(predictions: pd.DataFrame, model_id: str) -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_species_class_predictions")
        cols = [
            "tree_id TEXT PRIMARY KEY",
            "predicted_species_class TEXT",
            "species_class_confidence REAL",
            "raw_predicted_growth_form TEXT NOT NULL",
            "is_abstained INTEGER NOT NULL",
            "score_semantics TEXT NOT NULL",
            "release_eligible INTEGER NOT NULL",
        ]
        for cls in CLASSES:
            cols.append(f"proba_{cls} REAL")
        cols.append("model_id TEXT")
        cols.append("created_at_utc TEXT")
        conn.execute(f"CREATE TABLE tree_species_class_predictions ({', '.join(cols)})")
        created = utc_now()
        rows = []
        for _, row in predictions.iterrows():
            payload = [
                row["tree_id"],
                row["predicted_species_class"],
                float(row["species_class_confidence"]),
                row["raw_predicted_growth_form"],
                int(row["is_abstained"]),
                "uncalibrated_softmax_max",
                0,
            ]
            for cls in CLASSES:
                payload.append(float(row.get(f"proba_{cls}", 0.0)))
            payload.extend([model_id, created])
            rows.append(payload)
        placeholders = ",".join("?" for _ in range(7 + len(CLASSES) + 2))
        conn.executemany(
            f"INSERT INTO tree_species_class_predictions VALUES ({placeholders})",
            rows,
        )
        conn.execute("CREATE INDEX idx_tree_species_class_pred ON tree_species_class_predictions(predicted_species_class)")
        conn.commit()
    finally:
        conn.close()


def persist_oof_predictions(labelled: pd.DataFrame, truth: np.ndarray, predicted: np.ndarray,
                            fold_ids: np.ndarray, model_id: str) -> None:
    """Persist exactly-once spatial out-of-fold predictions for validation."""
    if len(labelled) != len(truth) or np.any(predicted < 0) or np.any(fold_ids < 1):
        raise ValueError("incomplete out-of-fold predictions")
    created = utc_now()
    rows = [
        (
            labelled.iloc[i]["tree_id"],
            CLASSES[int(truth[i])],
            CLASSES[int(predicted[i])],
            int(fold_ids[i]),
            model_id,
            created,
        )
        for i in range(len(labelled))
    ]
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_growth_form_oof_predictions")
        conn.execute(
            """
            CREATE TABLE tree_growth_form_oof_predictions (
                tree_id TEXT PRIMARY KEY,
                true_growth_form TEXT NOT NULL,
                predicted_growth_form TEXT NOT NULL,
                spatial_fold INTEGER NOT NULL,
                model_id TEXT NOT NULL,
                created_at_utc TEXT NOT NULL
            )
            """
        )
        conn.executemany(
            "INSERT INTO tree_growth_form_oof_predictions VALUES (?,?,?,?,?,?)", rows
        )
        conn.commit()
    finally:
        conn.close()


def write_report(cv_results: dict[str, Any], distribution_inferred: dict[str, int], distribution_labelled: dict[str, int], model_meta: dict[str, Any]) -> None:
    report = cv_results["classification_report"]
    matrix = cv_results["confusion_matrix"]
    labels = cv_results["labels"]
    lines = [
        "# Species-Class Model (Stage 3 CNN)",
        "",
        f"Generated at: {utc_now()}",
        "",
        "## What This Adds",
        "",
        "Fine-tunes a small ResNet18 (ImageNet-pretrained) on 24 m × 24 m aerial RGB chips around each labelled tree, then predicts species class for every LiDAR-inferred tree. The CNN sees texture, leaf colour, crown shape, and shadow patterns directly — signal Stage 1 (structure only) and Stage 3-lite (mean / std colour statistics) can only approximate.",
        "",
        "## Model",
        "",
        f"- Backbone: torchvision ResNet18 ImageNet weights, final fc replaced for {len(CLASSES)} classes.",
        f"- Input: {IMAGE_SIZE}×{IMAGE_SIZE} RGB, ImageNet normalisation, random flip + rotation augmentation.",
        f"- Patch radius: {PATCH_RADIUS_M:.0f} m at Esri z=18 imagery.",
        f"- Optimiser: Adam(lr={model_meta['learning_rate']:.0e}), batch size {model_meta['batch_size']}, {model_meta['epochs']} epochs.",
        "- Class-weighted cross-entropy (counter-balances broadleaf majority).",
        f"- Device: {model_meta['device']}.",
        f"- Spatial cross-validation: GroupKFold({model_meta['n_splits']}) on 1 km cells.",
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
        "| Class | Labelled | Predicted (inferred) |",
        "| --- | ---: | ---: |",
    ])
    for cls in CLASSES:
        lines.append(f"| {cls} | {distribution_labelled.get(cls, 0):,} | {distribution_inferred.get(cls, 0):,} |")
    lines.extend([
        "",
        "## Outputs",
        "",
        "- `data/processed/akl_trees.sqlite`, table `tree_species_class_predictions` (overwritten with Stage 3 CNN output)",
        "- `docs/species_class_model_stage3_cnn.md` (this file)",
    ])
    (DOCS_ROOT / "species_class_model_stage3_cnn.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--palm-boost", type=float, default=1.5)
    parser.add_argument("--weight-power", type=float, default=0.5,
                        help="exponent on inverse-frequency class weights; "
                             "1.0=full inverse (collapses weak models), 0.5=sqrt, 0=uniform")
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--n-splits", type=int, default=4)
    parser.add_argument("--device", default=None)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--model-output", type=Path, default=DEFAULT_MODEL_OUTPUT)
    parser.add_argument("--abstain-threshold", type=float, default=0.80,
                        help="scores below this remain unknown; score is not calibrated probability")
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    if args.device:
        device = torch.device(args.device)
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    print(f"Using device: {device}")

    print("Loading rows...")
    df = load_rows()
    print(f"  total: {len(df):,}")
    df_labelled = df[df["is_labelled"] & df["crown_area_m2"].notna()].reset_index(drop=True)
    df_inferred = df[df["is_inferred"] & df["crown_area_m2"].notna()].reset_index(drop=True)
    print(f"  labelled with crowns: {len(df_labelled):,}")
    print(f"  inferred with crowns: {len(df_inferred):,}")

    patches_l, keep_l = extract_all_patches(df_labelled, "labelled")
    df_labelled = df_labelled.iloc[keep_l].reset_index(drop=True)
    labels_l = np.array([CLASS_TO_INDEX[c] for c in df_labelled["species_class"]], dtype="int64")
    patches_i, keep_i = extract_all_patches(df_inferred, "inferred")
    df_inferred = df_inferred.iloc[keep_i].reset_index(drop=True)

    splits = spatial_split(df_labelled, n_splits=args.n_splits)

    all_truths: list[int] = []
    all_preds: list[int] = []
    oof_pred_idx = np.full(len(labels_l), -1, dtype="int64")
    oof_fold = np.full(len(labels_l), -1, dtype="int64")
    fold_scores: list[dict[str, float]] = []
    for fold, (train_idx, test_idx) in enumerate(splits, start=1):
        print(f"=== Fold {fold}/{len(splits)} === (train {len(train_idx):,} / test {len(test_idx):,})")
        train_ds = PatchDataset(patches_l[train_idx], labels_l[train_idx], augment=True)
        test_ds = PatchDataset(patches_l[test_idx], labels_l[test_idx], augment=False)
        train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
        test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)
        model = build_model(num_classes=len(CLASSES)).to(device)
        class_weights = class_weights_from_labels(labels_l[train_idx], len(CLASSES), args.palm_boost, args.weight_power).to(device)
        criterion = nn.CrossEntropyLoss(weight=class_weights)
        optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
        for epoch in range(1, args.epochs + 1):
            avg_loss = train_one_epoch(model, train_loader, criterion, optimizer, device)
            print(f"  epoch {epoch}/{args.epochs} loss {avg_loss:.4f}")
        y_true, y_pred = evaluate(model, test_loader, device)
        score = balanced_accuracy_score(y_true, y_pred)
        print(f"  fold {fold} balanced acc {score:.3f}")
        fold_scores.append({"fold": fold, "balanced_accuracy": float(score), "n_test": int(len(test_idx))})
        oof_pred_idx[test_idx] = y_pred
        oof_fold[test_idx] = fold
        all_truths.extend(y_true.tolist())
        all_preds.extend(y_pred.tolist())

    overall = balanced_accuracy_score(all_truths, all_preds)
    report = classification_report(
        [CLASSES[i] for i in all_truths],
        [CLASSES[i] for i in all_preds],
        labels=CLASSES, zero_division=0, output_dict=True,
    )
    matrix = confusion_matrix(all_truths, all_preds, labels=list(range(len(CLASSES))))
    cv_results = {
        "overall_balanced_accuracy": float(overall),
        "fold_scores": fold_scores,
        "classification_report": report,
        "confusion_matrix": matrix.tolist(),
        "labels": CLASSES,
    }
    persist_oof_predictions(df_labelled, labels_l, oof_pred_idx, oof_fold, MODEL_ID)
    print(f"Overall balanced accuracy across folds: {overall:.3f}")

    print("Training final model on all labelled rows...")
    full_ds = PatchDataset(patches_l, labels_l, augment=True)
    full_loader = DataLoader(full_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    final_model = build_model(num_classes=len(CLASSES)).to(device)
    class_weights = class_weights_from_labels(labels_l, len(CLASSES), args.palm_boost, args.weight_power).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.Adam(final_model.parameters(), lr=args.lr)
    # Keep the lowest-loss epoch: Adam can spike the loss in late epochs and
    # leave the *last* epoch in a degenerate state (observed at metro scale:
    # predictions collapsed to ~2 classes). Predict from the best checkpoint.
    best_loss, best_state, best_epoch = float("inf"), None, 0
    for epoch in range(1, args.epochs + 1):
        avg_loss = train_one_epoch(final_model, full_loader, criterion, optimizer, device)
        print(f"  epoch {epoch}/{args.epochs} loss {avg_loss:.4f}")
        if avg_loss < best_loss:
            best_loss, best_epoch = avg_loss, epoch
            best_state = {k: v.detach().cpu().clone() for k, v in final_model.state_dict().items()}
    if best_state is not None:
        final_model.load_state_dict(best_state)
        print(f"  using best checkpoint: epoch {best_epoch} (loss {best_loss:.4f})")

    print(f"Predicting species class for {len(df_inferred):,} inferred trees...")
    pred_ds = PatchDataset(patches_i, None, augment=False)
    pred_loader = DataLoader(pred_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)
    proba = predict_proba(final_model, pred_loader, device)
    predicted, raw_predicted, confidences, abstained = abstaining_predictions(
        proba, args.abstain_threshold
    )
    predictions = df_inferred[["tree_id"]].copy()
    predictions["predicted_species_class"] = predicted
    predictions["species_class_confidence"] = confidences
    predictions["raw_predicted_growth_form"] = raw_predicted
    predictions["is_abstained"] = abstained.astype(int)
    for i, cls in enumerate(CLASSES):
        predictions[f"proba_{cls}"] = proba[:, i]

    distribution_labelled = pd.Series(df_labelled["species_class"]).value_counts().to_dict()
    distribution_inferred = pd.Series(predicted).value_counts().to_dict()

    model_meta = {
        "model_id": MODEL_ID,
        "n_labelled": int(len(df_labelled)),
        "n_inferred": int(len(df_inferred)),
        "balanced_accuracy_cv": cv_results["overall_balanced_accuracy"],
        "device": str(device),
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.lr,
        "n_splits": args.n_splits,
        "patch_radius_m": PATCH_RADIUS_M,
        "image_size_px": IMAGE_SIZE,
        "seed": args.seed,
        "score_semantics": "uncalibrated_softmax_model_score",
        "target_semantics": "four_class_growth_form_not_species",
        "abstain_threshold": args.abstain_threshold,
        "release_eligible": False,
    }
    args.model_output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": {k: v.detach().cpu() for k, v in final_model.state_dict().items()},
            "classes": CLASSES,
            "model_meta": model_meta,
        },
        args.model_output,
    )
    print(f"Saved reproducible model checkpoint: {args.model_output}")
    persist_predictions(predictions, model_meta["model_id"])
    write_report(cv_results, distribution_inferred, distribution_labelled, model_meta)
    print(json.dumps({
        "model_meta": model_meta,
        "predicted_distribution": distribution_inferred,
        "labelled_distribution": distribution_labelled,
    }, indent=2, default=str))


if __name__ == "__main__":
    main()
