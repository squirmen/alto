"""Detect register runs and estimate their shifts on the real data, anchored by every link v5.1 keeps.

Written once per crown set; the simulator draws its row shifts from what is accepted here and the
production matcher applies these shifts to the unlinked members.
"""
import json
import numpy as np, pandas as pd
import runs
from common import WORK

R = pd.read_parquet(WORK / "records.parquet"); C = pd.read_parquet(WORK / "cand.parquet"); K = pd.read_parquet(WORK / "crowns.parquet")
rr, mem = runs.detect(R)
mem = mem[mem.qid.isin(C.qid)]
lk = R[R.link_seg.notna() & R.link_seg.isin(K.seg_key)]
anchors = dict(zip(lk.tree_id, lk.link_seg))
sh = runs.align(rr, mem, C, K, anchors)
sh = sh.merge(rr[["run_id", "linearity", "perp_rms_m", "spacing_med_m", "spacing_cv"]], on="run_id", how="left")
# a segment whose members are all linked already needs nothing; report on segments with unlinked members
unl = set(R[R.unlinked].tree_id)
sh["n_unlinked"] = sh.run_id.map(mem.assign(u=mem.qid.isin(unl)).groupby("run_id").u.sum()).fillna(0).astype(int)
sh.to_parquet(WORK / "run_shifts_real.parquet", index=False); mem.to_parquet(WORK / "run_members_real.parquet", index=False)
a = sh[sh.accepted]
print(json.dumps({"segments": len(sh), "members": len(mem), "segments_with_unlinked": int((sh.n_unlinked > 0).sum()),
                  "accepted": len(a), "accepted_with_unlinked": int((a.n_unlinked > 0).sum()),
                  "unlinked_members_in_accepted": int(a.n_unlinked.sum()),
                  "shift_m_quantiles": a.shift_m.quantile([.1, .25, .5, .75, .9]).round(2).tolist() if len(a) else []}, indent=1))
