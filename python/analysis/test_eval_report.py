"""The fixture mirrors ``scripts/evaluation/score/fixtures.ts`` (``line()``):
the same field names and defaults, with the response document cut to a
placeholder because only its presence is read. Synthetic, as there."""

import json
from pathlib import Path

import pytest

from eval_report import ResultsError, count, read_results, render

SUBJECT_A = "aaaaaaaa-1111-2222-3333-444444444444"


def line(**fields) -> dict:
    base = {
        "schema_version": "twin-llm.eval.results.v2",
        "item_id": "Q-S1-01",
        "scenario": "S1",
        "repeat": 1,
        "provider": "ollama",
        "model_id": "qwen3:4b",
        "mock": False,
        "cache_hit": False,
        "model_calls": 2,
        "skipped": None,
        "error": None,
        "ttft_ms": 1000,
        "total_ms": 4000,
        "tokens": {"input": 100, "output": 50, "total": 150},
        "text": "## Answer\nThe trend is flat.",
        "answer_text": "The trend is flat.",
        "document": {"schema_version": "twin-llm.response-document.v1.1"},
        "audit": [
            {
                "tool": "trend",
                "args_sha256": "a" * 64,
                "row_count": 10,
                "refusal": None,
                "subject_ref": SUBJECT_A,
            }
        ],
        "tool_results": [{"tool": "trend", "input": {}, "output": {}}],
    }
    return {**base, **fields}


FIXTURE = [
    line(),
    line(item_id="Q-S1-02", repeat=1),
    line(item_id="Q-S1-02", repeat=2, error="TIMEOUT", document=None, text=None),
    line(item_id="Q-S4-01", scenario="S4", skipped="MISSING_ENV", document=None, text=None),
    line(item_id="Q-S5-01", scenario="S5"),
    line(
        item_id="Q-S5-01",
        scenario="S5",
        model_id="qwen3:8b",
        error="MODEL_FAILED",
        document=None,
    ),
]


def write(path: Path, lines: list[dict]) -> Path:
    file = path / "results.jsonl"
    file.write_text("".join(json.dumps(entry) + "\n" for entry in lines), encoding="utf-8")
    return file


def test_counts_per_model_and_scenario(tmp_path: Path) -> None:
    frame = count(read_results(write(tmp_path, FIXTURE)))
    assert frame.to_dict("records") == [
        {"model": "ollama:qwen3:4b", "scenario": "S1", "lines": 3, "answered": 2, "errors": 1, "skipped": 0},
        {"model": "ollama:qwen3:4b", "scenario": "S4", "lines": 1, "answered": 0, "errors": 0, "skipped": 1},
        {"model": "ollama:qwen3:4b", "scenario": "S5", "lines": 1, "answered": 1, "errors": 0, "skipped": 0},
        {"model": "ollama:qwen3:8b", "scenario": "S5", "lines": 1, "answered": 0, "errors": 1, "skipped": 0},
    ]


def test_renders_a_table(tmp_path: Path) -> None:
    assert render(count(read_results(write(tmp_path, FIXTURE)))) == "\n".join(
        [
            "| model | scenario | lines | answered | errors | skipped |",
            "| --- | --- | --- | --- | --- | --- |",
            "| ollama:qwen3:4b | S1 | 3 | 2 | 1 | 0 |",
            "| ollama:qwen3:4b | S4 | 1 | 0 | 0 | 1 |",
            "| ollama:qwen3:4b | S5 | 1 | 1 | 0 | 0 |",
            "| ollama:qwen3:8b | S5 | 1 | 0 | 1 | 0 |",
        ]
    )


def test_refuses_a_mock_line(tmp_path: Path) -> None:
    with pytest.raises(ResultsError, match="line 2 came from a fake model"):
        read_results(write(tmp_path, [line(), line(mock=True)]))


def test_refuses_results_v1(tmp_path: Path) -> None:
    with pytest.raises(ResultsError, match="line 1 is 'twin-llm.eval.results.v1'"):
        read_results(write(tmp_path, [line(schema_version="twin-llm.eval.results.v1")]))
