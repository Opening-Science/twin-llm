import { describe, expect, test } from "bun:test";

import type { ResultLine, ToolResultLine } from "../eval-results";
import type { KeyEntry } from "../question-set";

import {
  type CallContext,
  callReasons,
  classifyCall,
  codesOf,
  expectedCalls,
  givenCodes,
  isValidLoinc,
  scoreCallAccuracy,
  windowsMatch,
  windowsOf,
} from "./call-accuracy";
import {
  keyEntry,
  line,
  refusalItem,
  SUBJECT_A,
  SUBJECT_B,
  toolResult,
  TREND_KEY,
  TREND_OUTPUT,
  trendItem,
} from "./fixtures";
import { type AnsweredLine, isAnswered } from "./types";

/**
 * Results lines shaped like the October 2026 runs (#275): synthetic subjects,
 * made-up values. The key reads HbA1c `4548-4` for subject A over 2024–2025.
 */

const COHORT = new Set(["4548-4", "2339-0", "8480-6", "8302-2", "29463-7"]);

const answered = (fields: Partial<ResultLine>): AnsweredLine => {
  const result = line(fields);
  if (!isAnswered(result)) throw new Error("fixture line must be answered");
  return result;
};

const trendCall = (args: Record<string, unknown> = {}): ToolResultLine =>
  toolResult(
    "trend",
    {
      subject_ref: SUBJECT_A,
      loinc: "4548-4",
      start: "2024-01-01",
      end: "2026-01-01",
      ...args,
    },
    TREND_OUTPUT,
  );

const context = (
  entries: readonly KeyEntry[] = TREND_KEY,
  cohortCodes: ReadonlySet<string> | null = COHORT,
): CallContext => ({
  expected: expectedCalls(entries),
  given: givenCodes(trendItem(), entries),
  cohortCodes,
});

describe("LOINC check digit", () => {
  test("accepts real codes and rejects a wrong check digit", () => {
    expect(
      ["4548-4", "8480-6", "2339-0", "29463-7", "8867-4", "40443-4"].map(isValidLoinc),
    ).toEqual([true, true, true, true, true, true]);
    // Codes the 4b model asked for HbA1c in #275.
    expect(["2335-1", "72129-9", "8303-2", "99999-9"].map(isValidLoinc)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(isValidLoinc("4548")).toBe(false);
    expect(isValidLoinc("hrv-rmssd")).toBe(false);
  });
});

describe("arguments", () => {
  test("codes come as one string or a list", () => {
    expect(codesOf({ loinc: "4548-4" })).toEqual(["4548-4"]);
    expect(codesOf({ loinc: ["4548-4", 7, "8480-6"] })).toEqual(["4548-4", "8480-6"]);
    expect(codesOf({ subject_ref: SUBJECT_A })).toEqual([]);
    expect(codesOf(null)).toEqual([]);
  });

  test("windows by UTC day from every window field", () => {
    expect(
      windowsOf({
        window_a: { start: "2023-01-01", end: "2023-12-31" },
        window_b: { start: "2025-01-01T00:00:00.000Z", end: "2025-12-31T23:59:59.999Z" },
      }),
    ).toHaveLength(2);
    expect(windowsOf({ date: "2025-09-24" })).toHaveLength(1);
    expect(windowsOf({ subject_ref: SUBJECT_A })).toEqual([]);
  });

  test("a bound may be one day off; more is another window", () => {
    const key = { start: "2024-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };
    expect(windowsMatch(key, { start: "2024-01-01", end: "2025-12-31" })).toBe(true);
    expect(
      windowsMatch(key, {
        start: "2024-01-01T00:00:00.000Z",
        end: "2026-01-01T23:59:59.999Z",
      }),
    ).toBe(true);
    expect(windowsMatch(key, { start: "2024-01-01", end: "2025-09-30" })).toBe(false);
    // Nothing to compare: a call or key with no window.
    expect(windowsMatch(key, { loinc: ["4548-4"] })).toBe(true);
    expect(windowsMatch({}, { start: "1990-01-01", end: "1991-01-01" })).toBe(true);
  });

  test("every key window needs a match; an event must match too", () => {
    const key = {
      baseline: { start: "2022-01-01", end: "2024-12-31" },
      target: { start: "2025-01-01", end: "2025-12-31" },
    };
    expect(windowsMatch(key, key)).toBe(true);
    expect(
      windowsMatch(key, {
        baseline: { start: "2022-01-01", end: "2024-09-30" },
        target: { start: "2025-01-01", end: "2025-09-30" },
      }),
    ).toBe(false);
    const event = {
      event_kind: "medication",
      event_code: "860975",
      days_before: 365,
      days_after: 365,
    };
    expect(windowsMatch(event, event)).toBe(true);
    expect(windowsMatch(event, { ...event, days_before: 7, days_after: 7 })).toBe(false);
  });

  test("several entries of one call are one expected call", () => {
    expect(expectedCalls(TREND_KEY)).toHaveLength(1);
  });

  test("codes the question, the item and the key name are given", () => {
    const given = givenCodes(
      refusalItem("NO_ROWS", {
        question: `What is the latest LOINC 99999-9 reading for subject ${SUBJECT_A}?`,
      }),
      TREND_KEY,
    );
    expect([...given].sort()).toEqual(["4548-4", "99999-9"]);
  });
});

describe("classifyCall", () => {
  const classOf = (call: ToolResultLine, ctx: CallContext = context()) =>
    classifyCall(call, ctx).class;

  test("right call: the key's code, subject and window; the tool may differ", () => {
    expect(classOf(trendCall())).toBe("right call");
    expect(
      classOf(
        toolResult(
          "observations_for_subject",
          {
            subject_ref: SUBJECT_A,
            loinc: ["4548-4"],
            start: "2024-01-01",
            end: "2026-01-01",
          },
          { rows: [] },
        ),
      ),
    ).toBe("right call");
  });

  test("invented code: a bad check digit, or a code the cohort does not hold", () => {
    const bad = classifyCall(trendCall({ loinc: "2335-1" }), context());
    expect(bad.class).toBe("invented code");
    expect(bad.detail).toBe("2335-1 (not a LOINC code)");
    // 17856-6 is a valid HbA1c code the cohort has no reading of.
    const absent = classifyCall(trendCall({ loinc: "17856-6" }), context());
    expect(absent).toEqual({
      tool: "trend",
      class: "invented code",
      detail: "17856-6 (not in the cohort)",
    });
    // Without the cohort list only the check digit decides.
    expect(classOf(trendCall({ loinc: "17856-6" }), context(TREND_KEY, null))).toBe(
      "wrong code",
    );
  });

  test("invented beats right: a list with the key code and an invented one", () => {
    expect(
      classOf(
        toolResult(
          "latest_by_loinc",
          { subject_ref: SUBJECT_A, loinc: ["4548-4", "8303-2"] },
          { rows: [] },
        ),
      ),
    ).toBe("invented code");
  });

  test("wrong code: a cohort code that is not the key's", () => {
    const call = classifyCall(trendCall({ loinc: "2339-0" }), context());
    expect(call.class).toBe("wrong code");
    expect(call.detail).toBe("2339-0 where the key reads 4548-4");
  });

  test("a list with the key code and another cohort code is right", () => {
    expect(
      classOf(
        toolResult(
          "latest_by_loinc",
          { subject_ref: SUBJECT_A, loinc: ["4548-4", "2339-0"] },
          { rows: [] },
        ),
      ),
    ).toBe("right call");
  });

  test("wrong subject and wrong window", () => {
    expect(classOf(trendCall({ subject_ref: SUBJECT_B }))).toBe("wrong subject");
    const window = classifyCall(trendCall({ start: "2021-10-01" }), context());
    expect(window.class).toBe("wrong window");
    expect(window.detail).toBe(
      "2021-10-01 to 2026-01-01 where the key reads 2024-01-01 to 2026-01-01",
    );
  });

  test("subject before window: a call wrong on both is wrong subject", () => {
    expect(classOf(trendCall({ subject_ref: SUBJECT_B, start: "2021-10-01" }))).toBe(
      "wrong subject",
    );
  });

  test("extra call: a tool the key does not read", () => {
    expect(classOf(toolResult("subject_window", { subject_ref: SUBJECT_A }, {}))).toBe(
      "extra call",
    );
    expect(classOf(toolResult("guideline_search", { query: "HbA1c" }, []))).toBe(
      "extra call",
    );
  });

  test("a code-less key call matches by tool", () => {
    const timeline = [
      keyEntry({
        name: "n",
        path: "n",
        value: 4,
        tool: "conditions_timeline",
        args: { subject_ref: SUBJECT_A, start: "1990-01-01", end: "2025-12-31" },
      }),
    ];
    const ctx = context(timeline);
    expect(
      classOf(
        toolResult(
          "conditions_timeline",
          { subject_ref: SUBJECT_A, start: "1990-01-01", end: "2025-12-31" },
          {},
        ),
        ctx,
      ),
    ).toBe("right call");
    expect(
      classOf(
        toolResult(
          "conditions_timeline",
          { subject_ref: SUBJECT_A, start: "2020-01-01", end: "2024-01-01" },
          {},
        ),
        ctx,
      ),
    ).toBe("wrong window");
    // A coded call where the key reads no code is extra, not wrong code.
    expect(classOf(trendCall(), ctx)).toBe("extra call");
  });

  test("a call with no subject_ref is not compared on subject", () => {
    expect(classOf(trendCall({ subject_ref: undefined }))).toBe("right call");
  });
});

describe("scoreCallAccuracy", () => {
  const score = (toolResults: readonly ToolResultLine[], entries = TREND_KEY) =>
    scoreCallAccuracy(
      {
        item: trendItem(),
        keyEntries: entries,
        line: answered({ tool_results: [...toolResults] }),
      },
      COHORT,
    );

  test("an item with no key entries is not scored", () => {
    expect(score([trendCall()], [])).toBeNull();
  });

  test("all right allows extra calls", () => {
    const result = score([
      toolResult("subject_window", { subject_ref: SUBJECT_A }, {}),
      trendCall(),
    ]);
    expect(result?.allRight).toBe(true);
    expect(result?.noCall).toBe(false);
    expect(callReasons(result ?? { calls: [], noCall: true, allRight: false })).toEqual([
      "extra call: subject_window",
    ]);
  });

  test("one wrong call spoils the line even beside a right one", () => {
    const result = score([trendCall({ loinc: "2335-1" }), trendCall()]);
    expect(result?.allRight).toBe(false);
    expect(result?.calls.map((call) => call.class)).toEqual([
      "invented code",
      "right call",
    ]);
  });

  test("only extra calls is not all right", () => {
    expect(
      score([toolResult("subject_window", { subject_ref: SUBJECT_A }, {})])?.allRight,
    ).toBe(false);
  });

  test("no call", () => {
    const result = score([]);
    expect(result).toEqual({ calls: [], noCall: true, allRight: false });
    expect(callReasons(result ?? { calls: [], noCall: true, allRight: false })).toEqual([
      "no tool call",
    ]);
  });

  test("reasons name the model's arguments and the key's, never an output", () => {
    const result = score([trendCall({ loinc: "2339-0" })]);
    const reasons = callReasons(result ?? { calls: [], noCall: true, allRight: false });
    expect(reasons).toEqual(["wrong code: trend 2339-0 where the key reads 4548-4"]);
    expect(reasons.join(" ")).not.toContain("6.04");
  });
});
