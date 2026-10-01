#!/usr/bin/env python3
"""Seal the upload bundle: hash every file, and record whether it may be deployed.

upload_v5.py refuses to stage a bundle whose release-checks.json does not say 'passed',
and re-checks every SHA-256 on the server before activation. Both files are produced
here from the verification artefacts rather than written by hand, so a bundle can only
claim readiness that the checks actually granted.
"""
from pathlib import Path
import hashlib, json, datetime, sys

W = Path("/data/alto/working/alto_v5_20260922")
S = W / "deploy/alto_v5_upload_20260923"
SELF = "bundle-manifest.json"   # cannot contain its own hash; everything else is listed

def sha(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(8 << 20), b""):
            h.update(b)
    return h.hexdigest()

suites = {}
for name in ("static_checks", "database_checks"):
    f = W / "verification" / f"{name}.json"
    suites[name] = json.loads(f.read_text())["status"] if f.exists() else "missing"

status = "passed" if all(v == "passed" for v in suites.values()) else "failed"
(S / "release-checks.json").write_text(json.dumps(
    {"status": status, "suites": suites,
     "sealed_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
     "note": "Status is taken from the verification suites; it is not asserted here."},
    indent=1) + "\n")

files, total = [], 0
for p in sorted(S.rglob("*")):
    if not p.is_file() or p.is_symlink():
        continue
    rel = p.relative_to(S).as_posix()
    if rel == SELF:
        continue
    n = p.stat().st_size
    files.append({"path": rel, "bytes": n, "sha256": sha(p)})
    total += n
    if len(files) % 1000 == 0:
        print(f"  hashed {len(files):,} files", flush=True)

(S / "bundle-manifest.json").write_text(json.dumps(
    {"version": "20260923-v5", "files": files, "file_count": len(files),
     "tree_records": json.loads((S / "data/tree_details/schema.json").read_text())["records"],
     "total_bytes": total,
     "sealed_utc": datetime.datetime.now(datetime.timezone.utc).isoformat()},
    indent=1) + "\n")

print(f"\n{len(files):,} files, {total/1e9:.1f} GB")
print("suites:", suites)
print("release status:", status)
if status != "passed":
    sys.exit(1)
