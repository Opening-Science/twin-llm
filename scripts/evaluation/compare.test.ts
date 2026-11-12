import { describe, expect, test } from "bun:test";

import { noConsentStore } from "../../infrastructure/learning-consent";

import {
  compareRuns,
  exactMcNemarP,
  holm,
  renderComparison,
  runOutcomes,
  type RunOutcomes,
  type UnitOutcome,
  unitKey,
} from "./compare";
import { questionsSha256 } from "./build-answer-key";
import { runCompare } from "./compare-run";
import type { ResultLine, RunMeta } from "./eval-results";
import { SCORED_CRITERIA, type ScoredCriterion, scoreRun } from "./score/score-run";
import { document, line, PASSING_ANSWER, TREND_KEY, trendItem } from "./score/fixtures";

/** Outcomes with the same units on every criterion; consistency gets them too, for brevity. */
const outcomes = (units: Readonly<Record<string, UnitOutcome>>): RunOutcomes =>
  new Map(
    SCORED_CRITERIA.map((criterion) => [criterion, new Map(Object.entries(units))]),
  );

const row = (rows: ReturnType<typeof compareRuns>, criterion: ScoredCriterion) => {
  const found = rows.find((each) => each.criterion === criterion);
  if (!found) throw new Error(`no row for ${criterion}`);
  return found;
};

describe("exactMcNemarP", () => {
  test("7 against 1 discordant gives 18/256 exactly", () => {
    expect(exactMcNemarP(7, 1)).toBe(18 / 256);
    expect(exactMcNemarP(7, 1)).toBe(0.0703125);
    expect(exactMcNemarP(1, 7)).toBe(0.0703125);
  });

  test("no discordant pair, or an even split, gives 1", () => {
    expect(exactMcNemarP(0, 0)).toBe(1);
    expect(exactMcNemarP(4, 4)).toBe(1);
    expect(exactMcNemarP(3, 2)).toBe(1);
  });

  test("small tails match the binomial by hand", () => {
    // 2 · (1/2)^5 = 1/16
    expect(exactMcNemarP(5, 0)).toBe(1 / 16);
    // 2 · (1 + 10 + 45) / 1024
    expect(exactMcNemarP(8, 2)).toBe(112 / 1024);
  });

  test("large n stays a probability and agrees across the two sums", () => {
    const direct = exactMcNemarP(520, 480);
    const logSpace = exactMcNemarP(530, 480);
    expect(direct).toBeGreaterThan(0);
    expect(direct).toBeLessThanOrEqual(1);
    expect(logSpace).toBeGreaterThan(0);
    expect(logSpace).toBeLessThan(direct);
    expect(exactMcNemarP(600, 600)).toBe(1);
  });

  test("refuses a count that is not a whole number", () => {
    expect(() => exactMcNemarP(-1, 2)).toThrow(RangeError);
    expect(() => exactMcNemarP(1.5, 2)).toThrow(RangeError);
  });
});

describe("holm", () => {
  test("steps down and keeps the order given", () => {
    // Sorted 0.01, 0.02, 0.04 → 3·0.01, 2·0.02, 1·0.04, kept monotone.
    const adjusted = holm([0.04, 0.01, 0.02]);
    expect(adjusted[0]).toBeCloseTo(0.04, 12);
    expect(adjusted[1]).toBeCloseTo(0.03, 12);
    expect(adjusted[2]).toBeCloseTo(0.04, 12);
  });

  test("caps at 1 and leaves null out of the count", () => {
    expect(holm([0.5, null, 0.6])).toEqual([1, null, 1]);
    const adjusted = holm([null, 0.01]);
    expect(adjusted[0]).toBeNull();
    expect(adjusted[1]).toBeCloseTo(0.01, 12);
  });
});

describe("compareRuns", () => {
  test("counts the four cells and tests the discordant ones", () => {
    const a = outcomes({
      ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`aonly-${i}`, "pass"])),
      "bonly-0": "fail",
      "both-0": "pass",
      "neither-0": "fail",
    });
    const b = outcomes({
      ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`aonly-${i}`, "fail"])),
      "bonly-0": "pass",
      "both-0": "pass",
      "neither-0": "fail",
    });
    const correctness = row(compareRuns(a, b), "correctness");
    expect(correctness).toMatchObject({
      pairs: 10,
      bothPass: 1,
      aOnly: 7,
      bOnly: 1,
      bothFail: 1,
      p: 0.0703125,
    });
  });

  test("leaves out and counts units in one run, skipped, error, human and n/a", () => {
    const a = outcomes({
      kept: "pass",
      onlyA: "pass",
      skipped: "skipped",
      errored: "pass",
      human: "human",
      na: "na",
      humanAndError: "human",
    });
    const b = outcomes({
      kept: "fail",
      onlyB: "fail",
      skipped: "pass",
      errored: "error",
      human: "pass",
      na: "na",
      humanAndError: "error",
    });
    const correctness = row(compareRuns(a, b), "correctness");
    expect(correctness.pairs).toBe(1);
    expect(correctness.excluded).toEqual({
      unpaired: 2,
      skipped: 1,
      error: 2,
      human: 1,
      na: 1,
    });
  });

  test("Holm runs across the criteria that have a pair", () => {
    const a: RunOutcomes = new Map(
      SCORED_CRITERIA.map((criterion) => [
        criterion,
        new Map<string, UnitOutcome>(
          criterion === "privacy"
            ? []
            : Array.from({ length: 6 }, (_, i) => [`u${i}`, "pass"]),
        ),
      ]),
    );
    const b: RunOutcomes = new Map(
      SCORED_CRITERIA.map((criterion) => [
        criterion,
        new Map<string, UnitOutcome>(
          criterion === "privacy"
            ? []
            : Array.from({ length: 6 }, (_, i) => [`u${i}`, "fail"]),
        ),
      ]),
    );
    const rows = compareRuns(a, b);
    expect(row(rows, "privacy").p).toBeNull();
    expect(row(rows, "privacy").pHolm).toBeNull();
    // 6 against 0: p = 2/64; six criteria tested, so Holm gives 6 · 2/64 at the smallest.
    expect(row(rows, "correctness").p).toBe(2 / 64);
    expect(row(rows, "correctness").pHolm).toBeCloseTo(12 / 64, 12);
  });

  test("renders one Markdown row per criterion", () => {
    const table = renderComparison(
      compareRuns(outcomes({ x: "pass" }), outcomes({ x: "fail" })),
    );
    expect(table.split("\n")).toHaveLength(2 + SCORED_CRITERIA.length);
    expect(table).toContain(
      "| correctness | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 1.0000 | 1.0000 | none |",
    );
  });
});

describe("runOutcomes", () => {
  const item = trendItem();
  const lines = [
    line({ repeat: 1 }),
    line({ repeat: 2, error: "TIMEOUT", text: null, answer_text: null, document: null }),
    line({
      repeat: 3,
      skipped: "MISSING_ENV",
      text: null,
      answer_text: null,
      document: null,
    }),
  ];
  const [scores] = scoreRun({
    models: [{ provider: "ollama", modelId: "qwen3:4b" }],
    items: [item],
    entries: { [item.id]: TREND_KEY },
    lines,
  });

  test("an answered line keeps its score, an error is error, a skipped line is skipped", () => {
    const result = runOutcomes({ items: [item], lines, scored: scores?.scored ?? [] });
    const correctness = result.get("correctness");
    expect(correctness?.get(unitKey(item.id, 1))).toBe("pass");
    expect(correctness?.get(unitKey(item.id, 2))).toBe("error");
    expect(correctness?.get(unitKey(item.id, 3))).toBe("skipped");
    // Consistency is per item, and the trend item does not list it.
    expect(result.get("consistency")?.get(unitKey(item.id))).toBe("na");
  });

  test("lines of items outside the set are not units", () => {
    const stray = line({ item_id: "Q-S9-99" });
    const result = runOutcomes({
      items: [item],
      lines: [...lines, stray],
      scored: scores?.scored ?? [],
    });
    expect(result.get("correctness")?.has(unitKey("Q-S9-99", 1))).toBe(false);
  });
});

describe("runCompare", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: {
        stdout: { write: (chunk: string) => void out.push(chunk) },
        stderr: { write: (chunk: string) => void err.push(chunk) },
      },
    };
  };
  const deps = (files: Readonly<Record<string, string>>) => ({
    readText: async (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    learning: noConsentStore(),
  });

  test("refuses an odd number of runs", async () => {
    const { err, io: streams } = io();
    expect(await runCompare(["--", "run-a"], streams, deps({}))).toBe(1);
    expect(err.join("")).toContain("USAGE");
  });

  test("refuses a run id that could leave the runs folder", async () => {
    const { err, io: streams } = io();
    expect(await runCompare(["../x", "run-b"], streams, deps({}))).toBe(1);
    expect(err.join("")).toContain("USAGE");
  });

  const ITEM = trendItem();
  const QUESTIONS = {
    schema_version: "twin-llm.eval.questions.v1",
    cohort_id: "synthea-v4-seed42",
    items: [ITEM],
  };
  const SHA = questionsSha256(QUESTIONS);
  const KEY = {
    schema_version: "twin-llm.eval.answer-key.v1",
    generator_version: "2",
    cohort: {
      id: "synthea-v4-seed42",
      synthea_version: "v4.0.0",
      seed: 42,
      population: 30,
      age: "40-75",
      reference_date: "20260101",
      end_date: "20260101",
      subjects: 37,
      content_sha256: "c".repeat(64),
    },
    open_twin_sha: "a".repeat(40),
    questions_sha256: SHA,
    actor: "eval-answer-key",
    generated_on: "2026-10-20",
    entries: { [ITEM.id]: TREND_KEY },
  };
  const meta = (runId: string, fields: Partial<RunMeta> = {}): RunMeta => ({
    schema_version: "twin-llm.eval.meta.v1",
    run_id: runId,
    mock: false,
    replay: true,
    date: "2026-10-30",
    git_sha: "1".repeat(40),
    questions_sha256: SHA,
    answer_key_sha256: "2".repeat(64),
    cohort_id: "synthea-v4-seed42",
    open_twin_sha: "3".repeat(40),
    provider: "ollama",
    models: [{ provider: "ollama", model_id: "qwen3:4b", host: null }],
    sampling: "none set",
    platform: "linux-x64",
    timeout_ms: 300000,
    selection: { items: null, scenario: null, latency_set: false },
    counts: {
      items: 1,
      lines: 2,
      answered: 2,
      errors: 0,
      skipped_missing_env: { items: [], lines: 0 },
      cache_hits: 0,
    },
    ...fields,
  });
  const runFiles = (
    runId: string,
    lines: readonly ResultLine[],
    fields: Partial<RunMeta> = {},
  ): Record<string, string> => ({
    [`evaluation/runs/${runId}/meta.json`]: JSON.stringify(meta(runId, fields)),
    [`evaluation/runs/${runId}/results.jsonl`]: `${lines.map((each) => JSON.stringify(each)).join("\n")}\n`,
  });
  const SET_FILES = {
    "evaluation/questions.v1.json": JSON.stringify(QUESTIONS),
    "evaluation/answer-key.v1.json": JSON.stringify(KEY),
  };
  /** The right numbers with the wrong answer class: correctness fails. */
  const FAILING = document({ answer_class: "information", narration: PASSING_ANSWER });

  test("pairs two runs line by line and prints JSON", async () => {
    const { out, io: streams } = io();
    const files = {
      ...SET_FILES,
      ...runFiles("run-a", [line({ repeat: 1 }), line({ repeat: 2 })]),
      ...runFiles("run-b", [line({ repeat: 1, document: FAILING }), line({ repeat: 2 })]),
    };
    expect(await runCompare(["run-a", "run-b", "--json"], streams, deps(files))).toBe(0);
    const [pair] = JSON.parse(out.join("")) as [
      {
        a: { run_id: string };
        criteria: { criterion: string; pairs: number; aOnly: number }[];
      },
    ];
    expect(pair.a.run_id).toBe("run-a");
    const correctness = pair.criteria.find((each) => each.criterion === "correctness");
    expect(correctness?.pairs).toBe(2);
    expect(correctness?.aOnly).toBe(1);
  });

  test("refuses a MOCK run, a run with two models and a stale questions sha256", async () => {
    const lines = [line()];
    const cases: [Record<string, string>, string][] = [
      [
        {
          ...SET_FILES,
          ...runFiles("run-a", lines, { mock: true }),
          ...runFiles("run-b", lines),
        },
        "MOCK_RUN",
      ],
      [
        {
          ...SET_FILES,
          ...runFiles("run-a", lines, {
            models: [
              { provider: "ollama", model_id: "qwen3:4b", host: null },
              { provider: "ollama", model_id: "qwen3:8b", host: null },
            ],
          }),
          ...runFiles("run-b", lines),
        },
        "ONE_MODEL",
      ],
      [
        {
          ...SET_FILES,
          ...runFiles("run-a", lines, { questions_sha256: "f".repeat(64) }),
          ...runFiles("run-b", lines),
        },
        "QUESTIONS_SHA_MISMATCH",
      ],
    ];
    for (const [files, code] of cases) {
      const { out, err, io: streams } = io();
      expect(await runCompare(["run-a", "run-b"], streams, deps(files))).toBe(1);
      expect(err.join("")).toContain(code);
      expect(out).toEqual([]);
    }
  });

  test("a missing file stops without provider text", async () => {
    const { err, io: streams } = io();
    expect(await runCompare(["run-a", "run-b"], streams, deps({}))).toBe(1);
    expect(err.join("")).toBe(
      "The comparison stopped: a run file did not parse (Error).\n",
    );
  });
});
