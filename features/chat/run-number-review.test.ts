import { describe, expect, test } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import { NUMBER_REVIEWER, REVIEW_SYSTEM } from "@/infrastructure/number-review";

import { runNumberReview } from "./run-number-review";

/**
 * The Ultra number check (#366) with a fake model: what it is sent and how
 * its reply and its failure become the review. Synthetic values only.
 */

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const replying = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    }),
  });

const RESULTS = [
  {
    toolName: "observations",
    input: { loinc: "29463-7" },
    output: { rows: [{ loinc: "29463-7", value: 80, unit_ucum: "kg" }] },
  },
];

const ANSWER = "Weight was 80 kg, later 95.5 kg.";

describe("runNumberReview", () => {
  test("sends the reviewer's instructions and the answer, and reads its verdicts", async () => {
    const model = replying("1. supported\n2. unsupported: no row holds 95.5");
    const review = await runNumberReview(model, ANSWER, RESULTS);
    expect(review).toEqual({
      reviewer: NUMBER_REVIEWER.name,
      status: "done",
      items: [
        { text: "80", verdict: "supported", note: null, matched: true },
        {
          text: "95.5",
          verdict: "unsupported",
          note: "no row holds 95.5",
          matched: false,
        },
      ],
      skipped: 0,
    });
    const call = model.doGenerateCalls[0];
    expect(call?.prompt[0]).toEqual({ role: "system", content: REVIEW_SYSTEM });
    expect(call?.tools).toBeUndefined();
  });

  test("an answer without numbers asks no model", async () => {
    const model = replying("1. supported");
    const review = await runNumberReview(model, "No readings in that window.", RESULTS);
    expect(review).toEqual({
      reviewer: NUMBER_REVIEWER.name,
      status: "done",
      items: [],
      skipped: 0,
    });
    expect(model.doGenerateCalls.length).toBe(0);
  });

  test("a failed call is a failed review, never a failed answer", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("synthetic outage");
      },
    });
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const review = await runNumberReview(model, ANSWER, RESULTS);
      expect(review.status).toBe("failed");
      expect(review.items.map((item) => item.verdict)).toEqual([
        "unchecked",
        "unchecked",
      ]);
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([["[chat] number check failed", "Error"]]);
  });
});
