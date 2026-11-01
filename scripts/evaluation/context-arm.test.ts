import { describe, expect, test } from "bun:test";

import {
  buildContextBlock,
  cacheArm,
  callText,
  cell,
  contextCalls,
  countRows,
  EVAL_ARMS,
  isContextArm,
  isEvalArm,
  keepRows,
  keyedRefusalOutput,
  NO_CALLS_TEXT,
  parseArm,
  readNothing,
  type RecordedArm,
} from "./context-arm";
import { keyEntry, SUBJECT_A, TREND_OUTPUT } from "./score/fixtures";

/** Synthetic rows only; the subject ref and values are made up. */
const MEDICATIONS = {
  subject_ref: SUBJECT_A,
  n: 4,
  medications: [
    {
      code: "1",
      display: "Drug one 10 MG",
      authored_at: "2021-01-01",
      status: "completed",
    },
    { code: "2", display: "Drug two", authored_at: "2021-02-01", status: "active" },
    { code: "3", display: "Drug three", authored_at: "2021-03-01", status: "completed" },
    { code: "4", display: "Drug four", authored_at: "2021-04-01", status: "completed" },
  ],
};

describe("isEvalArm", () => {
  test("knows the four arms; `context` is only an alias", () => {
    expect(
      ["tools", "context-oracle", "context-fair", "context", "code", "python"].map(
        isEvalArm,
      ),
    ).toEqual([true, true, true, false, true, false]);
  });
});

describe("parseArm and cacheArm (#320)", () => {
  test("`context` still names the oracle arm", () => {
    expect(
      ["context", "context-oracle", "context-fair", "tools", "x"].map(parseArm),
    ).toEqual(["context-oracle", "context-oracle", "context-fair", "tools", null]);
  });

  test("the oracle arm keeps its #302 cache name, so identical calls are reused", () => {
    expect(EVAL_ARMS.map(cacheArm)).toEqual(["tools", "context", "context-fair", "code"]);
  });

  test("isContextArm: every arm but tools, the old name included", () => {
    expect(
      [undefined, "tools", "context", "context-oracle", "context-fair", "code"].map(
        (arm) => isContextArm(arm as RecordedArm | undefined),
      ),
    ).toEqual([false, false, true, true, true, true]);
  });
});

describe("contextCalls", () => {
  test("one call per distinct tool and args, in key order", () => {
    const calls = contextCalls([
      keyEntry({ name: "n", path: "n", value: 10 }),
      keyEntry({ name: "slope", path: "slope_per_day", value: 0.1 }),
      keyEntry({ name: "c", path: "codes.0.n", value: 3, tool: "coverage" }),
    ]);
    expect(calls.map((call) => [call.tool, call.keyedRefusal])).toEqual([
      ["trend", null],
      ["coverage", null],
    ]);
  });

  test("a personal-mode entry carries the key's refusal and is not run", () => {
    const [call] = contextCalls([
      keyEntry({
        name: "code",
        path: "code",
        value: "NO_RHYTHM_DATA",
        refusal: "NO_RHYTHM_DATA",
        mode: "personal",
      }),
    ]);
    expect(call?.keyedRefusal).toBe("NO_RHYTHM_DATA");
    expect(keyedRefusalOutput("NO_RHYTHM_DATA").code).toBe("NO_RHYTHM_DATA");
  });
});

describe("rows", () => {
  test("countRows counts objects in lists at any depth, keepRows cuts each list", () => {
    expect(countRows(TREND_OUTPUT)).toBe(0);
    expect(countRows(MEDICATIONS)).toBe(4);
    expect(countRows({ a: [{ b: [{ c: 1 }, { c: 2 }] }] })).toBe(3);
    const cut = keepRows(MEDICATIONS, 2) as typeof MEDICATIONS;
    expect(cut.medications.map((row) => row.code)).toEqual(["1", "2"]);
    expect(cut.n).toBe(4);
  });

  test("readNothing: n of 0 or an empty list", () => {
    expect(readNothing({ n: 0, mean: null })).toBe(true);
    expect(readNothing({ rows: [] })).toBe(true);
    expect(readNothing(TREND_OUTPUT)).toBe(false);
  });
});

describe("callText", () => {
  test("cells keep numbers whole and quote text with spaces", () => {
    expect([cell(0.0012), cell("4548-4"), cell("Drug two"), cell(null)]).toEqual([
      "0.0012",
      "4548-4",
      '"Drug two"',
      "null",
    ]);
  });

  test("a summary as key=value pairs, rows as a table", () => {
    const text = callText(
      0,
      {
        tool: "medications_timeline",
        input: { subject_ref: SUBJECT_A },
        output: MEDICATIONS,
      },
      4,
    );
    expect(text.split("\n")).toEqual([
      `[1] medications_timeline(subject_ref=${SUBJECT_A})`,
      `subject_ref=${SUBJECT_A} n=4`,
      "medications:",
      "code | display | authored_at | status",
      '1 | "Drug one 10 MG" | 2021-01-01 | completed',
      '2 | "Drug two" | 2021-02-01 | active',
      '3 | "Drug three" | 2021-03-01 | completed',
      '4 | "Drug four" | 2021-04-01 | completed',
    ]);
  });

  test("a refusal and an empty read say so", () => {
    expect(
      callText(
        1,
        { tool: "summary_stats", input: {}, output: { code: "NO_ROWS", error: "none" } },
        0,
      ),
    ).toContain("refused: NO_ROWS");
    expect(
      callText(0, { tool: "trend", input: {}, output: { ...TREND_OUTPUT, n: 0 } }, 0),
    ).toContain("\nno rows\n");
  });
});

describe("buildContextBlock", () => {
  test("no calls: the no-rows text, delimited", () => {
    const block = buildContextBlock([], 6000);
    expect(block.text).toBe(`<data>\n${NO_CALLS_TEXT}\n</data>`);
    expect(block.stats).toMatchObject({ calls: 0, rows_total: 0, truncated: false });
  });

  test("fits: every row, nothing cut", () => {
    const block = buildContextBlock(
      [{ tool: "medications_timeline", input: {}, output: MEDICATIONS }],
      6000,
    );
    expect(block.stats).toMatchObject({
      rows_total: 4,
      rows_pasted: 4,
      truncated: false,
    });
    expect(block.pasted[0]?.output).toEqual(MEDICATIONS);
  });

  test("over the cap: the most rows that fit, the cut said and recorded", () => {
    const calls = [{ tool: "medications_timeline", input: {}, output: MEDICATIONS }];
    const full = buildContextBlock(calls, 6000).stats.tokens;
    const block = buildContextBlock(calls, full - 20);
    const kept = block.stats.rows_pasted;
    expect(block.stats.truncated).toBe(true);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(4);
    expect(block.stats.tokens).toBeLessThanOrEqual(full - 20);
    expect(block.text).toContain(`(rows cut to fit the prompt: ${kept} of 4 shown)`);
    // What is scored as the model's source is what it saw, from the top.
    expect(
      (block.pasted[0]?.output as typeof MEDICATIONS).medications.map((row) => row.code),
    ).toEqual(["1", "2", "3"].slice(0, kept));
  });

  test("a cap below the summary itself keeps no rows and reports going over", () => {
    const block = buildContextBlock(
      [{ tool: "medications_timeline", input: {}, output: MEDICATIONS }],
      5,
    );
    expect(block.stats.rows_pasted).toBe(0);
    expect(block.stats.tokens).toBeGreaterThan(block.stats.cap_tokens);
  });
});
