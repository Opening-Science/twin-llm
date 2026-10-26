"""Per-scenario counts from one eval run.

Reads ``evaluation/runs/<run-id>/results.jsonl`` from the harness
(``scripts/evaluation/eval-results.ts``, schema ``twin-llm.eval.results.v2``)
and prints, per model and scenario, how many lines ran, were answered, errored
or were skipped. The counting rules are the ones in
``scripts/evaluation/score/score-run.ts``: a line is answered when it has no
error, is not skipped and carries a response document.

Pass and fail per criterion are not in results.jsonl; ``bun run eval:report``
scores them. Like that command, this refuses a run a fake model answered.

    uv run analysis/eval_report.py ../evaluation/runs/<run-id>/results.jsonl
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

RESULTS_SCHEMA_VERSION = "twin-llm.eval.results.v2"
COLUMNS = ["model", "scenario", "lines", "answered", "errors", "skipped"]


class ResultsError(ValueError):
    """A results file this script will not count."""


def read_results(path: Path) -> list[dict]:
    lines = []
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        line = json.loads(raw)
        if line.get("schema_version") != RESULTS_SCHEMA_VERSION:
            raise ResultsError(
                f"line {number} is {line.get('schema_version')!r}, not {RESULTS_SCHEMA_VERSION}"
            )
        if line.get("mock"):
            raise ResultsError(f"line {number} came from a fake model; it is not a result")
        lines.append(line)
    return lines


def count(lines: list[dict]) -> pd.DataFrame:
    rows = [
        {
            "model": f"{line['provider']}:{line['model_id']}",
            "scenario": line["scenario"],
            "lines": 1,
            "answered": int(
                line["error"] is None
                and line["skipped"] is None
                and line["document"] is not None
            ),
            "errors": int(line["error"] is not None),
            "skipped": int(line["skipped"] is not None),
        }
        for line in lines
    ]
    frame = pd.DataFrame(rows, columns=COLUMNS)
    return frame.groupby(["model", "scenario"], as_index=False, sort=True).sum()


def render(frame: pd.DataFrame) -> str:
    header = f"| {' | '.join(COLUMNS)} |"
    rule = f"| {' | '.join('---' for _ in COLUMNS)} |"
    body = [f"| {' | '.join(str(row[c]) for c in COLUMNS)} |" for _, row in frame.iterrows()]
    return "\n".join([header, rule, *body])


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write("usage: eval_report.py <results.jsonl>\n")
        return 1
    try:
        print(render(count(read_results(Path(argv[0])))))
    except ResultsError as error:
        sys.stderr.write(f"{error}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
