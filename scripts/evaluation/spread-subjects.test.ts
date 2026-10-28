import { describe, expect, test } from "bun:test";

import { type QuestionSet, questionSetSchema } from "./question-set";
import {
  applyMoves,
  type Inventory,
  type InventoryRow,
  readsOf,
  runSpreadSubjects,
  type SpreadDeps,
  spreadSubjects,
} from "./spread-subjects";

const W = { start: "2024-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };
const Y2025 = { start: "2025-01-01T00:00:00Z", end: "2025-12-31T23:59:59Z" };

type ItemOptions = Readonly<{
  subject?: string;
  loinc?: string;
  window?: Readonly<{ start: string; end: string }>;
  keyed?: boolean;
  tool?: "summary_stats" | "trend";
  tags?: string[];
}>;

const item = (id: string, options: ItemOptions) => {
  const {
    subject,
    loinc = "4548-4",
    window = W,
    keyed = true,
    tags,
    tool = "summary_stats",
  } = options;
  const args = { subject_ref: subject ?? "aaa", loinc, ...window };
  return {
    id,
    scenario: id.slice(2, 4),
    criteria: ["correctness"],
    question:
      subject === undefined
        ? "How did HbA1c change for the first subject (lowest subject_ref)?"
        : `How did HbA1c change for subject ${subject}?`,
    ...(subject === undefined ? {} : { subject_ref: subject }),
    context: { data_mode: "synthetic", corpora: ["warehouse"] },
    expect: {
      answer_class: "analytics",
      sufficient_data: true,
      abstained: false,
      uncertainty: { level: "low", reasons: [] },
      next_step: "none",
      interpretation_kind: "narration",
      tools: { must_call: [tool], must_not_call: [] },
      ...(keyed
        ? {
            values: [
              {
                name: "n",
                tool,
                args: subject === undefined ? { ...args, subject_ref: "aaa" } : args,
                path: "n",
                unit: null,
                tolerance: { exact: true },
              },
            ],
          }
        : {}),
      must_not: ["a number that no tool returned"],
    },
    repeat: 1,
    ...(tags ? { tags } : {}),
    human: `Plain words about ${subject ?? "the first subject"}.`,
  };
};

const questions = (items: unknown[]): unknown => ({
  schema_version: "twin-llm.eval.questions.v1",
  cohort_id: "synthea-v4-seed42",
  items,
});

const parse = (raw: unknown): QuestionSet => questionSetSchema.parse(raw);

const rows = (
  subject: string,
  loinc: string,
  ats: readonly string[],
  unit = "%",
): InventoryRow[] => ats.map((at) => ({ subject_ref: subject, loinc, unit, at }));

const TWO_HBA1C = ["2024-03-01T00:00:00Z", "2025-03-01T00:00:00Z"];

/** aaa…eee all have two HbA1c readings in 2024–25; fff has one in 1990 only. */
const inventory: Inventory = {
  subjects: ["aaa", "bbb", "ccc", "ddd", "eee", "fff"],
  rows: [
    ...["aaa", "bbb", "ccc", "ddd", "eee"].flatMap((s) => rows(s, "4548-4", TWO_HBA1C)),
    ...rows("fff", "4548-4", ["1990-05-01T00:00:00Z"]),
  ],
};

describe("spreadSubjects", () => {
  test("moves items off a subject over the cap, fewest first, ties to the lowest ref", () => {
    const set = parse(
      questions([
        item("Q-S1-01", { subject: "ccc" }),
        item("Q-S1-02", { subject: "ccc" }),
        item("Q-S1-03", { subject: "ccc" }),
        item("Q-S1-04", { subject: "ccc" }),
        item("Q-S1-05", { subject: "bbb" }),
      ]),
    );
    const spread = spreadSubjects(set, inventory);
    expect(spread.moves).toEqual([
      { id: "Q-S1-01", from: "ccc", to: "aaa", reason: "over the cap", fromCount: 4 },
      { id: "Q-S1-03", from: "ccc", to: "ddd", reason: "over the cap", fromCount: 4 },
      { id: "Q-S1-04", from: "ccc", to: "eee", reason: "over the cap", fromCount: 4 },
    ]);
    expect([...spread.before]).toEqual([
      ["ccc", 4],
      ["bbb", 1],
    ]);
    expect(Math.max(...spread.after.values())).toBe(1);
    expect(spread.overCap).toEqual([]);
  });

  test("keeps an item whose subject fits and is within the cap", () => {
    const set = parse(questions([item("Q-S1-01", { subject: "eee" })]));
    expect(spreadSubjects(set, inventory).moves).toEqual([]);
  });

  test("replaces a subject that left the cohort or lacks the data", () => {
    const set = parse(
      questions([
        item("Q-S1-01", { subject: "gone" }),
        item("Q-S1-02", { subject: "fff" }),
      ]),
    );
    expect(spreadSubjects(set, inventory).moves).toEqual([
      { id: "Q-S1-01", from: "gone", to: "aaa", reason: "left the cohort", fromCount: 1 },
      {
        id: "Q-S1-02",
        from: "fff",
        to: "bbb",
        reason: "lacks what the item needs",
        fromCount: 1,
      },
    ]);
  });

  test("an item that names no subject is never moved but counts for its own", () => {
    const set = parse(
      questions([
        item("Q-S1-01", { subject: "aaa" }),
        item("Q-S1-10", {}),
        item("Q-S1-11", { subject: "gone" }),
      ]),
    );
    const spread = spreadSubjects(set, inventory);
    expect(spread.moves.map((move) => [move.id, move.to])).toEqual([["Q-S1-11", "bbb"]]);
    expect(spread.after.get("aaa")).toBe(2);
  });

  test("records an item that only a subject at the cap can take", () => {
    const set = parse(
      questions(
        ["01", "02", "03", "04"].map((n) =>
          item(`Q-S1-${n}`, { subject: "aaa", window: Y2025 }),
        ),
      ),
    );
    const only: Inventory = {
      subjects: ["aaa", "bbb"],
      rows: rows("aaa", "4548-4", ["2025-02-01T00:00:00Z", "2025-06-01T00:00:00Z"]),
    };
    const spread = spreadSubjects(set, only);
    expect(spread.moves).toEqual([]);
    expect(spread.overCap).toEqual([{ id: "Q-S1-04", subject: "aaa" }]);
  });

  test("leaves out-of-cohort probes alone", () => {
    const set = parse(
      questions([
        item("Q-S6-03", { subject: "not-in-cohort-001", tags: ["out-of-cohort-probe"] }),
      ]),
    );
    const spread = spreadSubjects(set, inventory);
    expect(spread.moves).toEqual([]);
    expect(spread.before.size).toBe(0);
  });

  test("probes need their own outcome: one reading, none, mixed units", () => {
    const year = { start: "1990-01-01T00:00:00Z", end: "1990-12-31T23:59:59Z" };
    const mixed: Inventory = {
      subjects: ["aaa", "bbb", "ccc", "ddd"],
      rows: [
        ...rows("aaa", "4548-4", ["1990-05-01T00:00:00Z", "1990-07-01T00:00:00Z"]),
        ...rows("bbb", "4548-4", ["1990-05-01T00:00:00Z"]),
        ...rows("ccc", "4548-4", ["1990-05-01T00:00:00Z"]),
        ...rows("ccc", "4548-4", ["1990-08-01T00:00:00Z"], "mmol/mol"),
      ],
    };
    const set = parse(
      questions([
        item("Q-S1-09", { subject: "aaa", window: year }),
        item("Q-S6-02", { subject: "aaa", window: year }),
        item("Q-S6-09", { subject: "aaa", window: year }),
      ]),
    );
    expect(spreadSubjects(set, mixed).moves.map((move) => [move.id, move.to])).toEqual([
      ["Q-S1-09", "bbb"],
      ["Q-S6-02", "ddd"],
      ["Q-S6-09", "ccc"],
    ]);
  });

  test("a trend item needs three readings at least two days apart", () => {
    const set = parse(questions([item("Q-S1-01", { subject: "aaa", tool: "trend" })]));
    const three: Inventory = {
      subjects: ["aaa", "bbb", "ccc"],
      rows: [
        ...rows("aaa", "4548-4", TWO_HBA1C),
        ...rows("bbb", "4548-4", [
          "2024-03-01T00:00:00Z",
          "2024-03-01T12:00:00Z",
          "2024-03-02T00:00:00Z",
        ]),
        ...rows("ccc", "4548-4", [...TWO_HBA1C, "2025-09-01T00:00:00Z"]),
      ],
    };
    expect(spreadSubjects(set, three).moves.map((move) => move.to)).toEqual(["ccc"]);
  });

  test("an unkeyed item needs a reading of the measure it names", () => {
    const set = parse(questions([item("Q-S5-07", { subject: "aaa", keyed: false })]));
    const withHeartRate: Inventory = {
      subjects: ["aaa", "bbb"],
      rows: rows("bbb", "8867-4", ["2020-01-01T00:00:00Z"], "/min"),
    };
    expect(spreadSubjects(set, withHeartRate).moves.map((move) => move.to)).toEqual([
      "bbb",
    ]);
  });

  test("a wearable item needs a synthetic series, and a trend 7 readings in its window", () => {
    const sept = (days: number): string[] =>
      Array.from(
        { length: days },
        (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}T07:00:00Z`,
      );
    const wearable = (id: string, source: string) => {
      const base = item(id, { subject: "aaa" });
      const args = { subject_ref: "aaa", source, start: "2026-09-01", end: "2026-09-10" };
      return {
        ...base,
        expect: {
          ...base.expect,
          tools: { must_call: [], must_not_call: [] },
          values: [
            {
              name: "refusal",
              tool: "hrv_trend",
              args,
              path: "code",
              unit: null,
              tolerance: { exact: true },
            },
          ],
        },
      };
    };
    // aaa has no series; bbb has 8 days; ccc 3; ddd has its series in October only.
    const series: Inventory = {
      subjects: ["aaa", "bbb", "ccc", "ddd"],
      rows: [
        ...rows("bbb", "hrv-rmssd", sept(8), "ms"),
        ...rows("ccc", "hrv-rmssd", sept(3), "ms"),
        ...rows("ddd", "hrv-rmssd", ["2026-10-02T07:00:00Z"], "ms"),
      ],
    };
    const set = parse(
      questions([
        wearable("Q-S1-28", "all"),
        wearable("Q-S6-24", "oura"),
        wearable("Q-S6-25", "all"),
        wearable("Q-S6-26", "all"),
      ]),
    );
    expect(spreadSubjects(set, series).moves.map((move) => [move.id, move.to])).toEqual([
      // A trend: 7 readings in the window.
      ["Q-S1-28", "bbb"],
      // A vendor source reads nothing; any subject with a series, fewest items first.
      ["Q-S6-24", "ccc"],
      // WINDOW_TOO_SHORT: 1 to 6 readings.
      ["Q-S6-25", "ccc"],
      // NO_ROWS: a series, but none in the window.
      ["Q-S6-26", "ddd"],
    ]);
  });

  test("a values_around_event item stays where it was put, within the cap", () => {
    // The event date is not in the inventory, so the subject is picked by hand.
    const aroundEvent = (id: string, subject: string) => {
      const base = item(id, { subject });
      const args = {
        subject_ref: subject,
        loinc: "4548-4",
        event_kind: "medication",
        event_code: "860975",
        days_before: 365,
        days_after: 365,
      };
      return {
        ...base,
        expect: {
          ...base.expect,
          values: [
            {
              name: "before_n",
              tool: "values_around_event",
              args,
              path: "before.n",
              unit: null,
              tolerance: { exact: true },
            },
          ],
        },
      };
    };
    // fff has no HbA1c in 2024–25, which a windowed read would need.
    const set = parse(questions([aroundEvent("Q-S1-34", "fff")]));
    expect((set.items[0]?.expect.values ?? []).flatMap(readsOf)).toEqual([]);
    expect(spreadSubjects(set, inventory).moves).toEqual([]);
    const four = parse(
      questions(["34", "35", "36", "37"].map((n) => aroundEvent(`Q-S1-${n}`, "fff"))),
    );
    expect(spreadSubjects(four, inventory).moves.map((move) => move.reason)).toEqual([
      "over the cap",
      "over the cap",
      "over the cap",
      "over the cap",
    ]);
  });

  test("throws when no subject fits", () => {
    const set = parse(questions([item("Q-S1-01", { subject: "fff" })]));
    expect(() => spreadSubjects(set, { subjects: ["fff"], rows: [] })).toThrow(
      "no subject in the cohort fits Q-S1-01",
    );
  });

  test("a second run moves nothing", () => {
    const raw = questions(
      ["01", "02", "03", "04", "05"].map((n) => item(`Q-S1-${n}`, { subject: "ccc" })),
    );
    const once = applyMoves(raw, spreadSubjects(parse(raw), inventory).moves);
    expect(spreadSubjects(parse(once), inventory).moves).toEqual([]);
  });
});

describe("applyMoves", () => {
  test("rewrites the ref in the question, subject_ref, call args and notes", () => {
    const raw = questions([item("Q-S1-01", { subject: "ccc" })]);
    const moved = parse(
      applyMoves(raw, [
        { id: "Q-S1-01", from: "ccc", to: "ddd", reason: "over the cap", fromCount: 4 },
      ]),
    ).items[0];
    expect(moved?.subject_ref).toBe("ddd");
    expect(moved?.question).toBe("How did HbA1c change for subject ddd?");
    expect(moved?.human).toBe("Plain words about ddd.");
    expect(moved?.expect.values?.[0]?.args.subject_ref).toBe("ddd");
  });
});

describe("runSpreadSubjects", () => {
  const raw = questions(
    ["01", "02", "03", "04"].map((n) => item(`Q-S1-${n}`, { subject: "ccc" })),
  );
  const deps = (written: unknown[], mode = "synthetic"): SpreadDeps => ({
    dataMode: () => mode,
    readText: () => Promise.resolve(JSON.stringify(raw)),
    writeQuestions: (_path, value) => {
      written.push(value);
      return Promise.resolve();
    },
    inventory: () => Promise.resolve(inventory),
  });
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

  test("refuses outside synthetic mode", async () => {
    const written: unknown[] = [];
    const { io: streams, err } = io();
    expect(await runSpreadSubjects([], streams, deps(written, "real"))).toBe(1);
    expect(err).toEqual(["eval:spread-subjects runs only with DATA_MODE=synthetic.\n"]);
    expect(written).toEqual([]);
  });

  test("--dry-run prints the plan and writes nothing", async () => {
    const written: unknown[] = [];
    const { io: streams, out } = io();
    expect(await runSpreadSubjects(["--dry-run"], streams, deps(written))).toBe(0);
    expect(written).toEqual([]);
    expect(out.join("")).toContain("Before: max 4 items per subject, 1 subjects (ccc 4)");
    expect(out.join("")).toContain("After:  max 1 items per subject, 4 subjects");
  });

  test("writes the moved questions", async () => {
    const written: unknown[] = [];
    const { io: streams } = io();
    expect(await runSpreadSubjects([], streams, deps(written))).toBe(0);
    expect(parse(written[0]).items.map((entry) => entry.subject_ref)).toEqual([
      "aaa",
      "bbb",
      "ccc",
      "ddd",
    ]);
  });
});
