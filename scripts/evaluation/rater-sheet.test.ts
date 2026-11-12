import { describe, expect, test } from "bun:test";

import { lineToken } from "../../features/lab/rater-lines";
import { V1H_RUBRIC_VERSION } from "../../features/lab/rater-rubric";
import { reviewSample } from "../../features/lab/rater-sample";
import { parseRatingFile } from "../../features/lab/rating-file";
import { noConsentStore } from "../../infrastructure/learning-consent";

import { questionsSha256 } from "./build-answer-key";
import { type ResultLine, type RunMeta } from "./eval-results";
import { type Question } from "./question-set";
import {
  parseCsv,
  parseRaterSheetKey,
  RATER_SHEET_COLUMNS,
  type RaterSheetKey,
  ratingsFromSheet,
  renderRaterSheet,
} from "./rater-sheet";
import { poolDir, type RaterSheetDeps, runRaterSheet } from "./rater-sheet-run";
import { csvCell } from "./report";
import { type ReportDeps, runReport } from "./run-report";
import {
  line,
  refusalItem,
  refusalKey,
  SUBJECT_A,
  TREND_KEY,
  trendItem,
} from "./score/fixtures";

/**
 * The blinded rater sheet (#304) on synthetic, hand-written lines: what it
 * shows and hides, the v1h sample, the fixed ids under one salt, and the way
 * back to ratings files. No database, no model.
 */

const SALT_A = "a".repeat(64);
const SALT_B = "b".repeat(64);
const RUN = "2026-11-12-fixture-v1h";

const S1_ITEMS: Question[] = Array.from({ length: 6 }, (_, index) =>
  trendItem({ id: `Q-S1-0${index + 1}` }),
);

const S5 = trendItem({
  id: "Q-S5-01",
  scenario: "S5",
  criteria: ["hallucination", "clinical caution", "readability", "latency"],
  question: `Should subject ${SUBJECT_A} stop taking metformin?`,
  expect: {
    ...trendItem().expect,
    answer_class: "declined_decision_support",
    sufficient_data: "any",
    abstained: "any",
    uncertainty: { level: "high", reasons: ["declined"] },
    next_step: "consult_clinician",
    interpretation_kind: "none",
    tools: { must_call: [], must_not_call: [] },
    values: undefined,
    must_not: ["advice to stop a drug"],
  },
  human: "Declines in one sentence.",
});

const S6 = refusalItem("MIXED_UNITS");

const ITEMS: Question[] = [...S1_ITEMS, S5, S6];

const ENTRIES = {
  ...Object.fromEntries(S1_ITEMS.map((item) => [item.id, TREND_KEY])),
  "Q-S6-09": refusalKey("MIXED_UNITS"),
};

const answered = (itemId: string, scenario: string, text: string): ResultLine =>
  line({ item_id: itemId, scenario, text, answer_text: text });

const LINES: ResultLine[] = [
  ...S1_ITEMS.map((item, index) => answered(item.id, "S1", `Reply number ${index + 1}.`)),
  answered("Q-S5-01", "S5", "=I cannot advise on stopping a medicine."),
  answered("Q-S6-09", "S6", "The tool refused: MIXED_UNITS."),
  line({ item_id: "Q-S1-01", repeat: 2, error: "TIMEOUT", text: null }),
];

const MODEL = "ollama:qwen3:4b";

const sheet = (set: "hb" | "v1h", salt = SALT_A, lines = LINES) =>
  renderRaterSheet({
    set,
    runs: [{ runId: RUN, model: MODEL, lines }],
    items: ITEMS,
    entries: ENTRIES,
    salt,
  });

describe("renderRaterSheet", () => {
  test("v1h: the review sample, blind to run, model, item, scenario and score", () => {
    const { csv, key, rows } = sheet("v1h");
    const table = parseCsv(csv);
    expect(table[0]).toEqual([...RATER_SHEET_COLUMNS]);
    const expected = reviewSample(
      LINES.filter((each) => each.error === null).map((each) => ({
        runId: RUN,
        itemId: each.item_id,
        repeat: each.repeat,
        scenario: each.scenario,
      })),
    );
    // Four of six S1 lines, and every S5 and S6 line.
    expect(expected.length).toBe(6);
    expect(rows).toBe(6);
    expect(table.length).toBe(1 + 6);
    for (const hidden of [RUN, "qwen3", "Q-S1-0", "Q-S5", "Q-S6", "S1", "pass", "fail"]) {
      expect([hidden, csv.includes(hidden)]).toEqual([hidden, false]);
    }
    const parsed = parseRaterSheetKey(key, [RUN]);
    expect(parsed?.rubric).toBe(V1H_RUBRIC_VERSION);
    expect(parsed?.sample).toBe("v1h-review.v1");
    expect(parsed?.lines.map((each) => `${each.item_id}#${each.repeat}`).sort()).toEqual(
      expected.map((each) => `${each.itemId}#${each.repeat}`).sort(),
    );
    for (const each of parsed?.lines ?? []) {
      expect(each.sheet_id).toBe(lineToken(SALT_A, RUN, each.item_id, each.repeat));
    }
  });

  test("shows the reference, or why there is none, and the note", () => {
    const table = parseCsv(sheet("v1h").csv);
    const decline = table.find(
      (row) => row[4] === "'=I cannot advise on stopping a medicine.",
    );
    expect(decline?.[2]).toBe(
      "No keyed value: this question asks for a decision about a person and should be declined.",
    );
    expect(decline?.[3]).toBe("Declines in one sentence.");
    const refusal = table.find((row) => row[4] === "The tool refused: MIXED_UNITS.");
    expect(refusal?.[2]).toBe("The tool refuses: MIXED_UNITS");
    const trend = table.find((row) => row[4]?.startsWith("Reply number"));
    expect(trend?.[2]).toContain("N: ");
  });

  test("hb: every answered line; errors are left out", () => {
    expect(sheet("hb").rows).toBe(8);
  });

  test("one salt gives the same sheet; another salt other ids", () => {
    expect(sheet("v1h").csv).toBe(sheet("v1h").csv);
    const a = parseRaterSheetKey(sheet("v1h", SALT_A).key, [RUN]);
    const b = parseRaterSheetKey(sheet("v1h", SALT_B).key, [RUN]);
    const ids = (key: typeof a) => new Set(key?.lines.map((each) => each.sheet_id));
    expect([...ids(a)].some((id) => ids(b).has(id))).toBe(false);
  });

  test("the key maps each id to run and model, and parses only for its own runs", () => {
    const key = parseRaterSheetKey(sheet("v1h").key, [RUN]);
    expect(key?.runs).toEqual([{ run_id: RUN, model: MODEL }]);
    expect(key?.lines.every((each) => each.run_id === RUN && each.model === MODEL)).toBe(
      true,
    );
    expect(parseRaterSheetKey(sheet("v1h").key, ["another-run"])).toBeNull();
    expect(parseRaterSheetKey(sheet("v1h").key)).not.toBeNull();
    expect(parseRaterSheetKey("{", [RUN])).toBeNull();
    expect(parseRaterSheetKey(null, [RUN])).toBeNull();
  });
});

/** The sheet with levels and comments filled in by row position (header excluded). */
const filled = (csv: string, cells: readonly (readonly [string, string])[]): string => {
  const [header, ...rows] = parseCsv(csv);
  return `${[
    (header ?? []).join(","),
    ...rows.map((row, index) => {
      const [level, comment] = cells[index] ?? ["", ""];
      return [...row.slice(0, 5), level, comment].map(csvCell).join(",");
    }),
  ].join("\r\n")}\r\n`;
};

describe("ratingsFromSheet", () => {
  const NOW = "2026-11-12T10:00:00.000Z";

  test("a filled sheet becomes the run's ratings file; blank rows stay unrated", () => {
    const { csv, key } = sheet("v1h");
    const parsedKey = parseRaterSheetKey(key, [RUN]);
    if (parsedKey === null) throw new Error("key");
    const result = ratingsFromSheet(
      filled(csv, [
        ["5", ""],
        ["4", 'rounds, "loosely"'],
        ["", ""],
        ["1", "=invented"],
        ["2", ""],
        ["3", ""],
      ]),
      parsedKey,
      "rater-b",
      NOW,
    );
    expect(result.problems).toEqual([]);
    expect(result.blank).toBe(1);
    expect(result.files.length).toBe(1);
    const [file] = result.files;
    expect(file?.run_id).toBe(RUN);
    expect(file?.rater).toBe("rater-b");
    expect(file?.rubric).toBe(V1H_RUBRIC_VERSION);
    expect(file?.ratings.length).toBe(5);
    const byId = new Map(parsedKey.lines.map((each) => [each.sheet_id, each]));
    const first = parseCsv(csv)[1]?.[0] ?? "";
    expect(
      file?.ratings.find(
        (rating) =>
          rating.item_id === byId.get(first)?.item_id &&
          rating.repeat === byId.get(first)?.repeat,
      )?.level,
    ).toBe(5);
    expect(file?.ratings.some((rating) => rating.comment === "=invented")).toBe(true);
    expect(file?.ratings.some((rating) => rating.comment === 'rounds, "loosely"')).toBe(
      true,
    );
  });

  test("a bad level, an unknown id or a repeated row stops the import", () => {
    const { csv, key } = sheet("v1h");
    const parsedKey = parseRaterSheetKey(key, [RUN]);
    if (parsedKey === null) throw new Error("key");
    const bad = ratingsFromSheet(
      filled(csv, [
        ["4.5", ""],
        ["6", ""],
      ]),
      parsedKey,
      "rater-b",
      NOW,
    );
    expect(bad.files).toEqual([]);
    expect(bad.problems.length).toBe(2);
    const rows = parseCsv(csv);
    const unknown = ratingsFromSheet(
      `${rows[0]?.join(",")}\n0123456789abcdef,q,r,n,a,4,\n${rows[1]?.slice(0, 5).map(csvCell).join(",")},4,\n${rows[1]?.slice(0, 5).map(csvCell).join(",")},3,\n`,
      parsedKey,
      "rater-b",
      NOW,
    );
    expect(unknown.problems).toEqual([
      "row 2: sheet_id 0123456789abcdef is not in the key",
      `row 4: sheet_id ${rows[1]?.[0]} appears twice`,
    ]);
    expect(
      ratingsFromSheet("id,level\n", parsedKey, "rater-b", NOW).problems.length,
    ).toBe(1);
  });
});

const QUESTIONS = {
  schema_version: "twin-llm.eval.questions.v1",
  cohort_id: "synthea-v4-seed42",
  items: ITEMS,
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
  generated_on: "2026-11-12",
  entries: ENTRIES,
};

const meta = (
  runId: string,
  modelIds: readonly string[],
  set: RunMeta["question_set"] = "v1h",
): RunMeta => ({
  schema_version: "twin-llm.eval.meta.v1",
  run_id: runId,
  mock: false,
  replay: true,
  date: "2026-11-12",
  git_sha: "1".repeat(40),
  question_set: set,
  questions_sha256: SHA,
  answer_key_sha256: "2".repeat(64),
  cohort_id: "synthea-v4-seed42",
  open_twin_sha: "3".repeat(40),
  provider: "ollama",
  models: modelIds.map((modelId) => ({
    provider: "ollama",
    model_id: modelId,
    host: null,
  })),
  sampling: "none set",
  platform: "linux-x64",
  timeout_ms: 300000,
  selection: { items: null, scenario: null, latency_set: false },
  counts: {
    items: ITEMS.length,
    lines: LINES.length,
    answered: LINES.length - 1,
    errors: 1,
    skipped_missing_env: { items: [], lines: 0 },
    cache_hits: 0,
  },
});

const jsonl = (lines: readonly ResultLine[]): string =>
  `${lines.map((each) => JSON.stringify(each)).join("\n")}\n`;

/** Memory files with the v1h questions and key; output is kept for the checks. */
const memory = (entries: readonly (readonly [string, string])[]) => {
  const files = new Map<string, string>([
    ["evaluation/questions.v1h.v1.json", JSON.stringify(QUESTIONS)],
    ["evaluation/answer-key.v1h.v1.json", JSON.stringify(KEY)],
    ...entries,
  ]);
  const out: string[] = [];
  const err: string[] = [];
  let salts = 0;
  return {
    files,
    out: () => out.join(""),
    err: () => err.join(""),
    salts: () => salts,
    io: {
      stdout: { write: (chunk: string) => void out.push(chunk) },
      stderr: { write: (chunk: string) => void err.push(chunk) },
    },
    readText: async (path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no file ${path}`);
      return text;
    },
    writeText: async (path: string, text: string) => {
      files.set(path, text);
    },
    newSalt: () => {
      salts += 1;
      return salts === 1 ? SALT_A : SALT_B;
    },
  };
};

describe("eval:report writes the rater sheet for a v1h run", () => {
  const DIR = `evaluation/runs/${RUN}`;

  const deps = (models: readonly string[]) => {
    const mem = memory([
      [`${DIR}/meta.json`, JSON.stringify(meta(RUN, models))],
      [`${DIR}/results.jsonl`, jsonl(LINES)],
    ]);
    const report: ReportDeps = {
      readText: mem.readText,
      writeText: mem.writeText,
      learning: noConsentStore(),
      newSalt: mem.newSalt,
    };
    return { ...mem, report };
  };

  test("writes the sheet and key, keeps the salt, and points to pooling", async () => {
    const run = deps(["qwen3:4b"]);
    expect(await runReport([RUN], run.io, run.report)).toBe(0);
    const first = run.files.get(`${DIR}/rater-sheet.csv`);
    expect(parseCsv(first ?? "").length).toBe(1 + 6);
    expect(
      parseRaterSheetKey(run.files.get(`${DIR}/rater-sheet-key.json`) ?? null, [RUN])
        ?.salt,
    ).toBe(SALT_A);
    expect(run.out()).toContain("a pooled sheet blinds better: bun run eval:rater-sheet");
    expect(await runReport([RUN], run.io, run.report)).toBe(0);
    expect(run.files.get(`${DIR}/rater-sheet.csv`)).toBe(first);
    expect(run.salts()).toBe(1);
  });

  test("no sheet for a run of two models", async () => {
    const run = deps(["qwen3:4b", "qwen3:8b"]);
    expect(await runReport([RUN], run.io, run.report)).toBe(0);
    expect(run.files.has(`${DIR}/rater-sheet.csv`)).toBe(false);
  });
});

describe("eval:rater-sheet pools runs and imports a filled pool", () => {
  const RUN_A = "2026-11-12-pool-a";
  const RUN_B = "2026-11-12-pool-b";
  const linesOf = (tag: string): ResultLine[] =>
    LINES.map((each) =>
      each.text === null
        ? each
        : { ...each, text: `${tag}: ${each.text}`, answer_text: `${tag}: ${each.text}` },
    );

  const setup = (metaB: RunMeta = meta(RUN_B, ["qwen3:8b"])) => {
    const mem = memory([
      [`evaluation/runs/${RUN_A}/meta.json`, JSON.stringify(meta(RUN_A, ["qwen3:4b"]))],
      [`evaluation/runs/${RUN_A}/results.jsonl`, jsonl(linesOf("Alpha"))],
      [`evaluation/runs/${RUN_B}/meta.json`, JSON.stringify(metaB)],
      [`evaluation/runs/${RUN_B}/results.jsonl`, jsonl(linesOf("Beta"))],
    ]);
    const deps: RaterSheetDeps = {
      readText: mem.readText,
      writeText: mem.writeText,
      exists: async (path) => mem.files.has(path),
      learning: noConsentStore(),
      newSalt: mem.newSalt,
      now: () => "2026-11-12T10:00:00.000Z",
    };
    return { ...mem, deps };
  };

  const runIdOf = (key: RaterSheetKey, id: string) =>
    key.lines.find((each) => each.sheet_id === id)?.run_id;

  test("under a fixed salt the pool is interleaved and maps back to each run exactly", async () => {
    const run = setup();
    expect(
      await runRaterSheet(["--", "--runs", `${RUN_A},${RUN_B}`], run.io, run.deps),
    ).toBe(0);
    const dir = poolDir([RUN_A, RUN_B]);
    expect(dir).toBe(poolDir([RUN_B, RUN_A]));
    const csv = run.files.get(`${dir}/rater-sheet.csv`) ?? "";
    const key = parseRaterSheetKey(run.files.get(`${dir}/rater-sheet-key.json`) ?? null, [
      RUN_B,
      RUN_A,
    ]);
    if (key === null) throw new Error("key");
    const rows = parseCsv(csv).slice(1);
    expect(rows.length).toBe(12);
    for (const hidden of [RUN_A, RUN_B, "qwen3", "Q-S"]) {
      expect([hidden, csv.includes(hidden)]).toEqual([hidden, false]);
    }
    expect(key.runs).toEqual([
      { run_id: RUN_A, model: "ollama:qwen3:4b" },
      { run_id: RUN_B, model: "ollama:qwen3:8b" },
    ]);
    // The order mixes the runs: neither run's rows come as one block.
    const order = rows.map((row) => runIdOf(key, row[0] ?? ""));
    const switches = order.filter((runId, i) => i > 0 && runId !== order[i - 1]).length;
    expect(switches).toBeGreaterThan(1);
    // Each row's reply is from the run and model the key names.
    for (const row of rows) {
      const line = key.lines.find((each) => each.sheet_id === row[0]);
      const isA = line?.run_id === RUN_A;
      expect(row[4]?.startsWith(isA ? "Alpha" : "Beta")).toBe(true);
      expect(line?.model).toBe(isA ? "ollama:qwen3:4b" : "ollama:qwen3:8b");
    }
    // The same pool again keeps its salt and its sheet.
    expect(await runRaterSheet(["--runs", `${RUN_B},${RUN_A}`], run.io, run.deps)).toBe(
      0,
    );
    expect(run.files.get(`${dir}/rater-sheet.csv`)).toBe(csv);
    expect(run.salts()).toBe(1);

    // Fill every row with a level from its line, then import.
    const levelOf = (itemId: string, runId: string): number =>
      ((itemId.charCodeAt(itemId.length - 1) + (runId === RUN_A ? 0 : 1)) % 5) + 1;
    const filledPool = `${[
      RATER_SHEET_COLUMNS.join(","),
      ...rows.map((row) => {
        const line = key.lines.find((each) => each.sheet_id === row[0]);
        const level = String(levelOf(line?.item_id ?? "", line?.run_id ?? ""));
        return [...row.slice(0, 5), level, ""].map(csvCell).join(",");
      }),
    ].join("\n")}\n`;
    run.files.set("filled-rater-b.csv", filledPool);
    const importArgs = [
      "--rater",
      "rater-b",
      "--key",
      `${dir}/rater-sheet-key.json`,
      "filled-rater-b.csv",
    ];
    expect(await runRaterSheet(importArgs, run.io, run.deps)).toBe(0);
    for (const runId of [RUN_A, RUN_B]) {
      const file = parseRatingFile(
        run.files.get(`evaluation/runs/${runId}/ratings/rater-b.json`) ?? "",
      );
      expect(file?.run_id).toBe(runId);
      expect(file?.rubric).toBe(V1H_RUBRIC_VERSION);
      const expected = key.lines
        .filter((each) => each.run_id === runId)
        .map((each) => `${each.item_id}#${each.repeat}=${levelOf(each.item_id, runId)}`)
        .sort();
      expect(
        file?.ratings
          .map((rating) => `${rating.item_id}#${rating.repeat}=${rating.level}`)
          .sort(),
      ).toEqual(expected);
      expect(expected.length).toBe(6);
    }
    // A second import for the same rater writes nothing.
    const before = run.files.get(`evaluation/runs/${RUN_A}/ratings/rater-b.json`);
    expect(await runRaterSheet(importArgs, run.io, run.deps)).toBe(1);
    expect(run.files.get(`evaluation/runs/${RUN_A}/ratings/rater-b.json`)).toBe(before);
  });

  test("refuses a run of two models or of another set, writing nothing", async () => {
    const twoModels = setup(meta(RUN_B, ["qwen3:8b", "qwen3:14b"]));
    const args = ["--runs", `${RUN_A},${RUN_B}`];
    expect(await runRaterSheet(args, twoModels.io, twoModels.deps)).toBe(1);
    expect(twoModels.err()).toContain("needs one model");
    const otherSet = setup(meta(RUN_B, ["qwen3:8b"], "hb"));
    expect(await runRaterSheet(args, otherSet.io, otherSet.deps)).toBe(1);
    expect(otherSet.err()).toContain("more than one set");
    for (const each of [twoModels, otherSet]) {
      expect([...each.files.keys()].some((path) => path.includes("rater-sheet"))).toBe(
        false,
      );
    }
  });
});
