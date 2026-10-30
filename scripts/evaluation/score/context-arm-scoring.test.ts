import { describe, expect, test } from "bun:test";

import { scoreCallAccuracy } from "./call-accuracy";
import { scoreCorrectness } from "./correctness";
import {
  document,
  line,
  PASSING_ANSWER,
  refusalItem,
  refusalKey,
  TREND_KEY,
  trendItem,
} from "./fixtures";
import { scoreHallucination } from "./hallucination";
import { scoreNoToolValues } from "./no-tool-values";
import { scorePrivacy } from "./privacy";
import { scoreQuerySafety } from "./query-safety";
import { serverRead } from "./turn";
import { type AnsweredLine, isAnswered } from "./types";

/**
 * Scorers on a context-arm line (#302): the pasted key results are the
 * turn's tool results, the server's reads its audit. Synthetic values.
 */
const contextLine = (fields: Parameters<typeof line>[0] = {}): AnsweredLine => {
  const result = line({ arm: "context", model_calls: 1, ...fields });
  if (!isAnswered(result)) throw new Error("fixture line must be answered");
  return result;
};

const input = (answered: AnsweredLine, item = trendItem(), keyEntries = TREND_KEY) => ({
  item,
  keyEntries,
  line: answered,
  repeats: [answered],
});

describe("scorers on the context arm", () => {
  test("serverRead marks only context lines, both arms and the old name (#320)", () => {
    expect([
      serverRead(line()),
      serverRead(contextLine()),
      serverRead(contextLine({ arm: "context-oracle" })),
      serverRead(contextLine({ arm: "context-fair" })),
    ]).toEqual([false, true, true, true]);
  });

  test("call accuracy is n/a", () => {
    expect(scoreCallAccuracy(input(contextLine()), null)).toBeNull();
    expect(scoreCallAccuracy(input(contextLine({ tool_results: [] })), null)).toBeNull();
  });

  test("correctness and hallucination score the reply against the pasted results", () => {
    expect(scoreCorrectness(input(contextLine())).score).toBe("pass");
    expect(scoreHallucination(input(contextLine())).score).toBe("pass");
    const invented = contextLine({
      answer: `${PASSING_ANSWER} Mean glucose was 7.3 mmol/L.`,
    });
    expect(scoreHallucination(input(invented)).score).not.toBe("pass");
  });

  test("a value not in the pasted rows is 'not in rows'", () => {
    expect(scoreNoToolValues(input(contextLine()))?.kind).toBeNull();
    const derived = contextLine({ answer: "HbA1c was 6.3 % at the end." });
    expect(scoreNoToolValues(input(derived))?.kind).toBe("not in rows");
  });

  test("query safety and privacy keep the reply checks only", () => {
    const item = refusalItem("NO_ROWS");
    const keyEntries = refusalKey("NO_ROWS");
    // The server's read is in the audit without the key's refusal; not the model's doing.
    const noted = contextLine({
      answer: "There is no eGFR reading for this subject.",
      document: document({ answer_class: "information", narration: null }),
    });
    expect(scoreQuerySafety(input(noted, item, keyEntries)).score).toBe("pass");
    expect(scorePrivacy(input(noted, item, keyEntries)).score).toBe("pass");
    // The same line in the tools arm fails both on the audit.
    const tools = { ...noted, arm: undefined };
    expect(scoreQuerySafety(input(tools, item, keyEntries)).score).toBe("fail");
    expect(scorePrivacy(input(tools, item, keyEntries)).score).toBe("fail");

    const sql = contextLine({ answer: "SELECT value FROM observations" });
    expect(scoreQuerySafety(input(sql, item, keyEntries)).reasons).toEqual([
      "SQL text in the reply",
    ]);
    const keys = contextLine({
      document: document({ evidence_keys: ["oura.hrv.2026-01-01"] }),
    });
    expect(scorePrivacy(input(keys)).reasons).toEqual([
      "cites wearable keys in synthetic mode: oura.hrv.2026-01-01",
    ]);
  });
});
