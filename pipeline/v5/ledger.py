#!/usr/bin/env python3
"""The trial record. Every iteration reads all of it before proposing anything.

The point is not an audit log. It is the working memory of the search: an attempt
that fails for a reason nobody records will be tried again, and a gain that came from
a mistake in the scorer will be built upon. So each entry carries the reasoning and
the lesson, not only the numbers, and `context()` renders the whole history in the
form the next iteration should read before it decides what to do.
"""
from __future__ import annotations

import fcntl
import json
import os
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path

LAB = Path("/data/alto/working/seg_lab")
import os
LEDGER = Path(os.environ.get("SEG_LEDGER", str(LAB / "ledger.jsonl")))
FINDINGS = LAB / "findings.jsonl"


def _write(path: Path, rec: dict) -> dict:
    rec.setdefault("ts", time.strftime("%Y-%m-%dT%H:%M:%S"))
    rec.setdefault("pid", os.getpid())
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as fh:                      # lock so parallel workers interleave safely
        fcntl.flock(fh, fcntl.LOCK_EX)
        fh.write(json.dumps(rec, default=lambda o: asdict(o) if is_dataclass(o) else str(o)) + "\n")
        fh.flush()
        fcntl.flock(fh, fcntl.LOCK_UN)
    return rec


def log_attempt(*, iteration: int, name: str, params, metrics: dict,
                parent: str | None, rationale: str, lesson: str,
                sites: list[str], notes: dict | None = None) -> dict:
    return _write(LEDGER, {
        "kind": "attempt", "iteration": iteration, "name": name,
        "params": asdict(params) if is_dataclass(params) else params,
        "metrics": metrics, "parent": parent,
        "rationale": rationale, "lesson": lesson,
        "n_sites": len(sites), "notes": notes or {}})


def log_finding(*, iteration: int, title: str, detail: str, evidence: dict | None = None,
                changes_method: bool = False) -> dict:
    """A fact about the problem or the data, as opposed to a score."""
    return _write(FINDINGS, {"kind": "finding", "iteration": iteration, "title": title,
                             "detail": detail, "evidence": evidence or {},
                             "changes_method": changes_method})


def _read(path: Path) -> list[dict]:
    """Tolerant read: parallel workers append, so a line may be mid-write."""
    if not path.exists():
        return []
    out = []
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def attempts() -> list[dict]:
    """This round's attempts. Scores are only comparable within a round, because the
    scorer itself is a thing the work corrects."""
    return _read(LEDGER)


def archived_rounds() -> dict[str, list[dict]]:
    """Earlier rounds, kept so nothing is lost when a round restarts."""
    return {f.stem: _read(f) for f in sorted((LAB / "rounds").glob("ledger_round*.jsonl"))}


def findings() -> list[dict]:
    return _read(FINDINGS)


def best(metric: str = "objective") -> dict | None:
    rows = [a for a in attempts() if a.get("metrics", {}).get(metric) is not None]
    return max(rows, key=lambda a: a["metrics"][metric]) if rows else None


def next_iteration() -> int:
    a = attempts()
    return (max((x["iteration"] for x in a), default=0) + 1) if a else 1


def context(max_attempts: int = 400) -> str:
    """The whole record, rendered for the next iteration to read before deciding."""
    fs, ats = findings(), attempts()
    arch = archived_rounds()
    out = ["# Trial record", "",
           f"{len(ats)} attempts this round, {len(fs)} findings carried across all rounds.", ""]
    for name, rows in arch.items():
        if not rows:
            continue
        b = max(rows, key=lambda a: a["metrics"].get("objective", -1))
        out += [f"Earlier round `{name}`: {len(rows)} attempts, best objective "
                f"{b['metrics'].get('objective')} with {json.dumps(b['params'])}. "
                f"Scored under the scorer of that round; see rounds/*.md for what it settled.", ""]

    if fs:
        out += ["## Findings about the data and method", ""]
        for f in fs:
            flag = "  [CHANGES METHOD]" if f.get("changes_method") else ""
            out.append(f"- (iter {f['iteration']}) **{f['title']}**{flag}: {f['detail']}")
            if f.get("evidence"):
                out.append(f"    evidence: {json.dumps(f['evidence'])}")
        out.append("")

    if ats:
        b = best()
        if b:
            out += ["## Best so far", "",
                    f"`{b['name']}` (iter {b['iteration']}) objective={b['metrics'].get('objective')}",
                    f"  recall={b['metrics'].get('recall')} median_iou={b['metrics'].get('median_iou')} "
                    f"det_per_label={b['metrics'].get('det_per_label')}",
                    f"  params: {json.dumps(b['params'])}", ""]
        out += ["## Every attempt, in order", ""]
        for a in ats[-max_attempts:]:
            m = a.get("metrics", {})
            out.append(
                f"- iter {a['iteration']} `{a['name']}` obj={m.get('objective')} "
                f"rec={m.get('recall')} iou={m.get('median_iou')} dpl={m.get('det_per_label')} "
                f"| from: {a.get('parent') or 'scratch'}")
            out.append(f"    tried because: {a['rationale']}")
            out.append(f"    learned: {a['lesson']}")
        out.append("")
    return "\n".join(out)


if __name__ == "__main__":
    print(context())
