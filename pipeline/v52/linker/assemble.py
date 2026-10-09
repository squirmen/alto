"""Gather the per-tile evidence into four tables the matcher reads: query point evidence, existing-crown
candidates, the crowns they name, and record-seeded crowns.

Kept separate from the matcher so the slow point-cloud pass runs once and every model, ablation
and hold-out fold reads the same frozen evidence. Usage: assemble.py [tiles_dir] [prefix]
"""
import glob, json, sys
from pathlib import Path
import pandas as pd
from common import WORK

T = Path(sys.argv[1]) if len(sys.argv) > 1 else WORK / "tiles"
pre = sys.argv[2] if len(sys.argv) > 2 else ""


DONE = {Path(f).name[:-5] for f in glob.glob(str(T / "*.done"))}


def read(pat):
    out = []
    for f in sorted(glob.glob(str(T / pat))):
        if Path(f).name.split(".")[0] not in DONE:      # a tile still being written
            continue
        d = pd.read_parquet(f)
        if "mode" in d:                       # first-pass tiles keyed by tree_id + mode; keep the raw rows
            d = d[d["mode"] == "raw"].drop(columns=["mode"])
        if "qid" not in d:
            d["qid"] = d["tree_id"]
        out.append(d)
    return pd.concat(out, ignore_index=True)


feat = read("*.feat.parquet"); cand = read("*.cand.parquet"); new = read("*.new.parquet")
crowns = pd.concat([pd.read_parquet(f) for f in sorted(glob.glob(str(T / "*.crowns.parquet"))) if Path(f).name.split(".")[0] in DONE],
                   ignore_index=True)
crowns = crowns.drop_duplicates("seg_key").reset_index(drop=True)
cand = cand.drop(columns=[c for c in ["tree_id"] if c in cand]).drop_duplicates(["qid", "seg_key"])
feat.to_parquet(WORK / f"{pre}feat.parquet", index=False); cand.to_parquet(WORK / f"{pre}cand.parquet", index=False)
new.to_parquet(WORK / f"{pre}newcrowns.parquet", index=False); crowns.to_parquet(WORK / f"{pre}crowns.parquet", index=False)
print(json.dumps({"feat": len(feat), "cand": len(cand), "crowns": len(crowns), "new": len(new)}))
