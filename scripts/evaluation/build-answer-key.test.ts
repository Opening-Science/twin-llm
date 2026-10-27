import { describe, expect, test } from "bun:test";

import { ROW_CAP_EXCEEDED, mixedUnits } from "../../packages/query-tools/refusals";
import { SUBJECT_SCOPE_VIOLATION } from "../../packages/query-tools/scope";
import {
  type AnswerKeyPorts,
  buildAnswerKey,
  type BuildDeps,
  questionsSha256,
  rowCountOf,
  runBuildAnswerKey,
  subjectCount,
  summarise,
  unitNear,
  valueAt,
  windowsOf,
} from "./build-answer-key";
import type { KeyedTool } from "./question-set";

const SUBJECT = "synthetic-subject-1";
const W = { start: "2024-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };

const item = (id: string, values: unknown[] | undefined) => ({
  id,
  scenario: "S1",
  criteria: ["correctness"],
  question: "How did HbA1c change for this subject?",
  subject_ref: SUBJECT,
  context: { data_mode: "synthetic", corpora: ["warehouse"] },
  expect: {
    answer_class: "analytics",
    sufficient_data: true,
    abstained: false,
    uncertainty: { level: "low", reasons: [] },
    next_step: "none",
    interpretation_kind: "narration",
    tools: { must_call: ["trend"], must_not_call: [] },
    ...(values ? { values } : {}),
    must_not: ["a number that no tool returned"],
  },
  repeat: 1,
  human: "Plain words.",
});

const trendArgs = { subject_ref: SUBJECT, loinc: "4548-4", ...W };

const questions = {
  schema_version: "twin-llm.eval.questions.v1",
  cohort_id: "synthea-v4-seed42",
  items: [
    item("Q-S1-01", [
      {
        name: "slope_per_day",
        tool: "trend",
        args: trendArgs,
        path: "slope_per_day",
        unit: "%/d",
        tolerance: { rel: 0.05 },
      },
      {
        name: "n",
        tool: "trend",
        args: trendArgs,
        path: "n",
        unit: null,
        tolerance: { exact: true },
      },
    ]),
    item("Q-S1-02", undefined),
    item("Q-S1-03", [
      {
        name: "refusal",
        tool: "latest_by_loinc",
        args: { subject_ref: "not-in-cohort-001", loinc: ["8867-4"] },
        path: "code",
        unit: null,
        tolerance: { exact: true },
      },
      {
        name: "value",
        tool: "latest_by_loinc",
        args: { subject_ref: SUBJECT, loinc: ["59408-5"] },
        path: "rows.0.value",
        unit: null,
        tolerance: { exact: true },
      },
    ]),
  ],
};

const trendResult = {
  loinc: "4548-4",
  unit: "%",
  n: 4,
  first_at: "2024-02-01T00:00:00.000Z",
  last_at: "2025-11-01T00:00:00.000Z",
  slope_per_day: 0.0012,
  slope_unit: "%/d",
  fitted_first: 5.5,
  fitted_last: 6.3,
};

type Call = Readonly<{ tool: KeyedTool; args: unknown }>;

const fakePorts = (
  answer: (tool: KeyedTool, args: unknown) => unknown,
): AnswerKeyPorts & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    runTool: async (tool, args) => {
      calls.push({ tool, args });
      return answer(tool, args);
    },
    countSubjects: async () => 33,
    cohortSha256: async () => "c".repeat(64),
    openTwinSha: () => "a9e126c952c91e19e064a962dda7d815a43564e5",
    today: () => "2026-10-20",
  };
};

const defaultAnswer = (tool: KeyedTool, args: unknown): unknown => {
  if (tool === "trend") return trendResult;
  const ref = Reflect.get(args as object, "subject_ref");
  if (ref === "not-in-cohort-001") return SUBJECT_SCOPE_VIOLATION;
  return { rows: [] };
};

describe("buildAnswerKey", () => {
  test("keys every value through the tools and records the metadata", async () => {
    const ports = fakePorts(defaultAnswer);
    const key = await buildAnswerKey(questions, ports);

    // The two trend values share one call; the two latest_by_loinc calls differ.
    expect(ports.calls.map((call) => call.tool)).toEqual([
      "trend",
      "latest_by_loinc",
      "latest_by_loinc",
    ]);
    expect(key.cohort).toEqual({
      id: "synthea-v4-seed42",
      synthea_version: "v4.0.0",
      seed: 42,
      population: 30,
      age: "40-75",
      reference_date: "20260101",
      end_date: "20260101",
      subjects: 33,
      content_sha256: "c".repeat(64),
    });
    expect(key.generator_version).toBe("2");
    expect(key.actor).toBe("eval-answer-key");
    expect(key.generated_on).toBe("2026-10-20");
    expect(key.open_twin_sha).toBe("a9e126c952c91e19e064a962dda7d815a43564e5");
    expect(key.questions_sha256).toBe(questionsSha256(questions));
    expect(Object.keys(key.entries)).toEqual(["Q-S1-01", "Q-S1-03"]);
    expect(key.entries["Q-S1-01"]).toEqual([
      {
        name: "slope_per_day",
        tool: "trend",
        args: trendArgs,
        path: "slope_per_day",
        value: 0.0012,
        unit: "%/d",
        n: 4,
        windows: [W],
        refusal: null,
      },
      {
        name: "n",
        tool: "trend",
        args: trendArgs,
        path: "n",
        value: 4,
        unit: null,
        n: 4,
        windows: [W],
        refusal: null,
      },
    ]);
    expect(key.entries["Q-S1-03"]).toEqual([
      {
        name: "refusal",
        tool: "latest_by_loinc",
        args: { subject_ref: "not-in-cohort-001", loinc: ["8867-4"] },
        path: "code",
        value: "SUBJECT_SCOPE_VIOLATION",
        unit: null,
        n: 0,
        windows: [],
        refusal: "SUBJECT_SCOPE_VIOLATION",
      },
      {
        name: "value",
        tool: "latest_by_loinc",
        args: { subject_ref: SUBJECT, loinc: ["59408-5"] },
        path: "rows.0.value",
        value: null,
        unit: null,
        n: 0,
        windows: [],
        refusal: null,
      },
    ]);
    expect(summarise(key)).toEqual({
      itemsKeyed: 2,
      values: 4,
      refusals: 1,
      nullValues: 1,
    });
  });

  test("a refusal on a number path keys null with the code", async () => {
    const key = await buildAnswerKey(
      questions,
      fakePorts((tool, args) =>
        tool === "trend"
          ? mixedUnits("4548-4", ["%", "mmol/mol"])
          : defaultAnswer(tool, args),
      ),
    );
    expect(key.entries["Q-S1-01"]?.[0]).toMatchObject({
      value: null,
      unit: null,
      n: 0,
      refusal: "MIXED_UNITS",
    });
  });

  test("refuses a unit that differs from the item's", async () => {
    const ports = fakePorts((tool, args) =>
      tool === "trend"
        ? { ...trendResult, unit: "mmol/mol", slope_unit: "mmol/mol/d" }
        : defaultAnswer(tool, args),
    );
    await expect(buildAnswerKey(questions, ports)).rejects.toThrow(
      "Q-S1-01 slope_per_day: unit is not %/d",
    );
  });

  const withValue = (spec: Readonly<Record<string, unknown>>) => ({
    ...questions,
    items: [
      item("Q-S1-01", [
        {
          name: "v",
          tool: "trend",
          args: trendArgs,
          unit: null,
          tolerance: { exact: true },
          ...spec,
        },
      ]),
    ],
  });

  test("a misspelt path throws instead of keying null", async () => {
    await expect(
      buildAnswerKey(withValue({ path: "slope_per_dya" }), fakePorts(defaultAnswer)),
    ).rejects.toThrow("Q-S1-01 v: no slope_per_dya in the result");
    await expect(
      buildAnswerKey(withValue({ path: "baseline.median" }), fakePorts(defaultAnswer)),
    ).rejects.toThrow("Q-S1-01 v: no baseline.median in the result");
  });

  test("path code on a call that did not refuse throws", async () => {
    await expect(
      buildAnswerKey(withValue({ path: "code" }), fakePorts(defaultAnswer)),
    ).rejects.toThrow("Q-S1-01 v: trend did not refuse");
  });

  test("a null the tool returned still keys as null, with its unit", async () => {
    const ports = fakePorts((tool, args) =>
      tool === "trend"
        ? {
            ...trendResult,
            n: 1,
            slope_per_day: null,
            fitted_first: null,
            fitted_last: null,
          }
        : defaultAnswer(tool, args),
    );
    const key = await buildAnswerKey(
      withValue({ path: "slope_per_day", unit: "%/d", tolerance: { rel: 0.05 } }),
      ports,
    );
    expect(key.entries["Q-S1-01"]?.[0]).toMatchObject({
      value: null,
      unit: "%/d",
      n: 1,
      refusal: null,
    });
  });

  test("a tool that throws names the item, never the raw error", async () => {
    const ports = fakePorts(() => {
      throw new Error("connection refused at 127.0.0.1:5434 password=secret");
    });
    await expect(buildAnswerKey(questions, ports)).rejects.toThrow(
      "Q-S1-01 slope_per_day: trend failed",
    );
  });
});

describe("helpers", () => {
  test("rowCountOf matches each tool's audit row count", () => {
    expect(rowCountOf("trend", trendResult)).toBe(4);
    expect(
      rowCountOf("summary_stats", { n: 7, min: 1, max: 2, mean: 1.5, unit: "kg" }),
    ).toBe(7);
    expect(
      rowCountOf("baseline_deviation", { baseline: { n: 5 }, target: { n: 2 } }),
    ).toBe(7);
    expect(
      rowCountOf("compare_windows", { window_a: { n: 3 }, window_b: { n: 4 } }),
    ).toBe(7);
    expect(rowCountOf("values_around_event", { before: { n: 2 }, after: { n: 3 } })).toBe(
      5,
    );
    expect(rowCountOf("coverage", { codes: [{ n: 2 }, { n: 9 }] })).toBe(11);
    expect(rowCountOf("latest_by_loinc", { rows: [{}, {}] })).toBe(2);
    expect(rowCountOf("trend", ROW_CAP_EXCEEDED)).toBe(0);
  });

  test("unitNear finds the closest unit", () => {
    const coverage = { codes: [{ unit: "mm[Hg]", n: 2 }] };
    expect(unitNear(coverage, "codes.0.n")).toBe("mm[Hg]");
    expect(unitNear({ rows: [{ unit_ucum: "%", value: 6 }] }, "rows.0.value")).toBe("%");
    expect(unitNear({ unit: "kg", baseline: { median: 80 } }, "baseline.median")).toBe(
      "kg",
    );
    expect(unitNear({ rows: [] }, "rows.0.value")).toBeNull();
    expect(unitNear(trendResult, "slope_per_day")).toBe("%/d");
    expect(unitNear(trendResult, "fitted_last")).toBe("%");
  });

  test("valueAt keeps a real null and rejects a missing path", () => {
    expect(valueAt(trendResult, "slope_per_day")).toBe(0.0012);
    expect(valueAt({ robust_z: null }, "robust_z")).toBeNull();
    expect(valueAt({ rows: [] }, "rows.0.value")).toBeNull();
    expect(valueAt({ codes: [] }, "codes.0.n")).toBeNull();
    expect(() => valueAt({ rows: [{ value: 6 }] }, "rows.1.value")).toThrow(
      "no rows.1.value in the result",
    );
    expect(() => valueAt({ window_a: [] }, "window_a.0.n")).toThrow(
      "no window_a.0.n in the result",
    );
    expect(() => valueAt({ unit: "%" }, "unit")).toThrow("no number at unit");
  });

  test("subjectCount throws on a refused cohort", () => {
    expect(subjectCount({ subjects: [{}, {}, {}] })).toBe(3);
    expect(() => subjectCount(SUBJECT_SCOPE_VIOLATION)).toThrow(
      "list_subjects refused synthea-v4-seed42",
    );
  });

  test("windowsOf lists the windows in argument order", () => {
    const a = { start: "2022-01-01T00:00:00Z", end: "2024-12-31T23:59:59Z" };
    const b = { start: "2025-01-01T00:00:00Z", end: "2025-12-31T23:59:59Z" };
    expect(windowsOf(trendArgs)).toEqual([W]);
    expect(
      windowsOf({ subject_ref: SUBJECT, loinc: "1-1", baseline: a, target: b }),
    ).toEqual([a, b]);
    expect(windowsOf({ subject_ref: SUBJECT, loinc: ["1-1"] })).toEqual([]);
  });

  test("questionsSha256 ignores formatting", () => {
    const text = JSON.stringify(questions);
    const pretty = JSON.stringify(questions, null, 4);
    expect(questionsSha256(JSON.parse(text))).toBe(questionsSha256(JSON.parse(pretty)));
    expect(questionsSha256(questions)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runBuildAnswerKey", () => {
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

  const deps = (
    overrides: Partial<BuildDeps> = {},
  ): BuildDeps & { written: string[] } => {
    const written: string[] = [];
    return {
      written,
      dataMode: () => "synthetic",
      readText: async () => JSON.stringify(questions),
      writeKey: async (path) => void written.push(path),
      ports: () => fakePorts(defaultAnswer),
      ...overrides,
    };
  };

  test("writes the key and prints counts only", async () => {
    const run = io();
    const d = deps();
    expect(await runBuildAnswerKey([], run.io, d)).toBe(0);
    expect(d.written).toEqual(["evaluation/answer-key.v1.json"]);
    expect(run.out.join("")).toBe(
      [
        "Answer key written to evaluation/answer-key.v1.json",
        "Cohort synthea-v4-seed42: 33 subjects (Synthea v4.0.0, seed 42, dates 20260101–20260101)",
        `Patient files checksum ${"c".repeat(64)}`,
        "Items keyed: 2, values: 4, refusals: 1, null values: 1",
        "open-twin a9e126c952c91e19e064a962dda7d815a43564e5, generated 2026-10-20",
        "",
      ].join("\n"),
    );
    expect(run.err).toEqual([]);
  });

  test("refuses to run outside synthetic mode", async () => {
    const run = io();
    const d = deps({ dataMode: () => "personal" });
    expect(await runBuildAnswerKey([], run.io, d)).toBe(1);
    expect(run.err).toEqual(["eval:answer-key runs only with DATA_MODE=synthetic.\n"]);
    expect(d.written).toEqual([]);
  });

  test("honours --questions and --out", async () => {
    const run = io();
    const read: string[] = [];
    const d = deps({
      readText: async (path) => {
        read.push(path);
        return JSON.stringify(questions);
      },
    });
    expect(
      await runBuildAnswerKey(["--questions", "q.json", "--out", "k.json"], run.io, d),
    ).toBe(0);
    expect(read).toEqual(["q.json"]);
    expect(d.written).toEqual(["k.json"]);
  });

  test("an invalid question file writes nothing", async () => {
    const run = io();
    const d = deps({ readText: async () => JSON.stringify({ items: [] }) });
    expect(await runBuildAnswerKey([], run.io, d)).toBe(1);
    expect(run.err).toEqual([
      "Answer key not written: the questions or a tool result did not validate.\n",
    ]);
    expect(d.written).toEqual([]);
  });
});
