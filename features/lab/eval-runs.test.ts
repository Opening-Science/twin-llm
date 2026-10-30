import { describe, expect, test } from "bun:test";

import {
  parseReportScores,
  parseRunMeta,
  parseScoreCell,
  runsCsv,
  runsTable,
  scoresCsv,
  scoreTable,
  selectionText,
  sortRuns,
  summariseRun,
} from "./eval-runs";

const META = JSON.stringify({
  schema_version: "twin-llm.eval.meta.v1",
  run_id: "2026-10-21-qwen3-s5",
  mock: false,
  replay: false,
  date: "2026-10-21",
  git_sha: "abc",
  cohort_id: "synthea-v4-seed42",
  models: [{ provider: "ollama", model_id: "qwen3:4b", host: "127.0.0.1:11434" }],
  selection: { items: null, scenario: "S5", latency_set: false },
  counts: { items: 12, lines: 12, answered: 11, errors: 1, cache_hits: 0 },
});

/** The shape `renderReport` writes, trimmed to two criteria and two scenarios. */
const REPORT = [
  "# Eval report 2026-10-21-qwen3-s5",
  "",
  "## Overview",
  "",
  "| Model | Lines |",
  "| --- | --- |",
  "| ollama:qwen3:4b | 12 |",
  "",
  "## Scores: ollama:qwen3:4b",
  "",
  "Passes over scored answers (pass + fail), with the Wilson 95 % interval.",
  "",
  "| Criterion | S1 | S5 | All |",
  "| --- | --- | --- | --- |",
  "| correctness | — | 3/4 (30–95 %) | 3/4 (30–95 %) |",
  "| privacy | — | 4/4 (51–100 %) | 4/4 (51–100 %) |",
  "",
  "### Not scored automatically: ollama:qwen3:4b",
  "",
  "| Criterion | Human | Human share | n/a | Error |",
  "| --- | --- | --- | --- | --- |",
  "| correctness | 1 | 20 % | 0 | 0 |",
  "",
].join("\n");

describe("parseScoreCell", () => {
  test("reads the report's cell and nothing else", () => {
    expect(parseScoreCell("3/4 (30–95 %)")).toEqual({
      passes: 3,
      n: 4,
      lowPct: 30,
      highPct: 95,
    });
    expect(parseScoreCell("—")).toBeNull();
    expect(parseScoreCell("3/4")).toBeNull();
  });
});

describe("parseRunMeta", () => {
  test("keeps the fields the page uses", () => {
    expect(parseRunMeta(META)?.selection?.scenario).toBe("S5");
    expect(parseRunMeta(META)?.models?.[0]?.model_id).toBe("qwen3:4b");
  });

  test("null for text that is not JSON or the wrong shape", () => {
    expect(parseRunMeta("{")).toBeNull();
    expect(parseRunMeta('{"models": 3}')).toBeNull();
  });
});

describe("parseReportScores", () => {
  test("one table per model, scenario columns and All", () => {
    expect(parseReportScores(REPORT)).toEqual([
      {
        model: "ollama:qwen3:4b",
        columns: ["S1", "S5", "All"],
        rows: [
          {
            criterion: "correctness",
            cells: [
              null,
              { passes: 3, n: 4, lowPct: 30, highPct: 95 },
              { passes: 3, n: 4, lowPct: 30, highPct: 95 },
            ],
          },
          {
            criterion: "privacy",
            cells: [
              null,
              { passes: 4, n: 4, lowPct: 51, highPct: 100 },
              { passes: 4, n: 4, lowPct: 51, highPct: 100 },
            ],
          },
        ],
      },
    ]);
  });

  test("a report without score tables gives none", () => {
    expect(parseReportScores("# Eval report x\n\nNothing here.")).toEqual([]);
  });
});

describe("tables and CSV", () => {
  const run = summariseRun("2026-10-21-qwen3-s5", META, REPORT);
  const bare = summariseRun("2026-10-01-old", null, null);

  test("sortRuns puts the newest date first and runs without a date last", () => {
    expect(sortRuns([bare, run]).map((each) => each.id)).toEqual([
      "2026-10-21-qwen3-s5",
      "2026-10-01-old",
    ]);
  });

  test("selectionText names what the run asked for", () => {
    expect(selectionText(run.meta)).toBe("Scenario S5");
    expect(selectionText(null)).toBe("—");
    expect(
      selectionText({ selection: { items: null, scenario: null, latency_set: true } }),
    ).toBe("Latency set");
    expect(selectionText({ selection: { items: ["Q-S1-01", "Q-S1-02"] } })).toBe(
      "2 chosen items",
    );
  });

  test("runsTable says what is missing", () => {
    expect(runsTable([run, bare]).rows).toEqual([
      [
        "2026-10-21-qwen3-s5",
        "21 Oct 2026",
        "Run",
        "ollama:qwen3:4b",
        "Scenario S5",
        "12",
        "1",
        "Yes",
      ],
      ["2026-10-01-old", "—", "No readable meta.json", "—", "—", "—", "—", "Not written"],
    ]);
  });

  test("scoreTable shows passes, scored answers and the interval", () => {
    const table = scoreTable(run.scores![0]!);
    expect(table.columns).toEqual(["Criterion", "S1", "S5", "All"]);
    expect(table.rows[0]).toEqual(["correctness", "—", "3/4 · 30–95 %", "3/4 · 30–95 %"]);
  });

  test("runsCsv and scoresCsv leave missing values empty", () => {
    expect(runsCsv([bare])).toBe(
      "run_id,date,kind,models,selection,lines,errors,report\r\n2026-10-01-old,,,,,,,false\r\n",
    );
    const lines = scoresCsv([run]).split("\r\n");
    expect(lines[0]).toBe(
      "run_id,model,criterion,scenario,passes,n,pass_rate,wilson95_low_pct,wilson95_high_pct",
    );
    expect(lines[1]).toBe("2026-10-21-qwen3-s5,ollama:qwen3:4b,correctness,S1,,,,,");
    expect(lines[2]).toBe(
      "2026-10-21-qwen3-s5,ollama:qwen3:4b,correctness,S5,3,4,0.75,30,95",
    );
    expect(lines.length).toBe(8);
  });
});
