#!/usr/bin/env python3
"""Remove LiDAR-inferred trees that didn't make it into the crown set.

When the crown segmentation rejects a candidate (because of the shape
filter, building/water mask, height threshold, etc.) we still have the
inferred tree point sitting in ``trees`` and ``tree_lidar_pilot``. It
shows on the map as a lonely dot with no crown polygon, even though the
pipeline already decided it isn't a real tree. This script deletes those
orphans so the map stays clean.

Council records (`tree_register_points`, `notable_trees_overlay`,
`ruru_obskauri_tiaki_public`) are never deleted — only inferred orphans.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SQLITE_PATH = ROOT / "data" / "processed" / "akl_trees.sqlite"
INFERRED_SOURCE = "lidar_inferred_canopy"


def main() -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        before = conn.execute(
            f"SELECT COUNT(*) FROM trees WHERE source_primary = '{INFERRED_SOURCE}'"
        ).fetchone()[0]

        with_crowns = conn.execute(
            f"""
            SELECT COUNT(*) FROM trees t
            JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
            WHERE t.source_primary = '{INFERRED_SOURCE}'
            """
        ).fetchone()[0]

        # Delete inferred trees without crown polygons, plus their LiDAR
        # samples and any ML predictions. tree_species_class_predictions
        # may not exist yet (normalize-public-inventory rebuilds the DB),
        # so we skip it gracefully when absent.
        existing_tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for table in ("tree_lidar_pilot", "tree_species_class_predictions"):
            if table not in existing_tables:
                continue
            conn.execute(
                f"""
                DELETE FROM {table}
                WHERE tree_id IN (
                    SELECT t.tree_id FROM trees t
                    LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
                    WHERE t.source_primary = '{INFERRED_SOURCE}'
                      AND c.tree_id IS NULL
                )
                """
            )
        conn.execute(
            f"""
            DELETE FROM trees
            WHERE tree_id IN (
                SELECT t.tree_id FROM trees t
                LEFT JOIN tree_crown_pilot c ON c.tree_id = t.tree_id
                WHERE t.source_primary = '{INFERRED_SOURCE}'
                  AND c.tree_id IS NULL
            )
            """
        )
        conn.commit()

        after = conn.execute(
            f"SELECT COUNT(*) FROM trees WHERE source_primary = '{INFERRED_SOURCE}'"
        ).fetchone()[0]
        print(f"Inferred trees before: {before:,}")
        print(f"Inferred trees with crowns: {with_crowns:,}")
        print(f"Inferred trees after cleanup: {after:,}")
        print(f"Orphans deleted: {before - after:,}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
