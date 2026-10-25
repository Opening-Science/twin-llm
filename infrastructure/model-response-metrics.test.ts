import { describe, expect, test } from "bun:test";

import { createResponseTimer } from "./model-response-metrics";

const steppingClock = (times: readonly number[]) => {
  const queue = [...times];
  return () => queue.shift() ?? Number.NaN;
};

describe("createResponseTimer", () => {
  test("measures first token and whole-call speed", () => {
    // start, first token, read; the second mark does not read the clock
    const timer = createResponseTimer("m", steppingClock([1000, 1250.4, 3000]));
    timer.markFirstToken();
    timer.markFirstToken();
    const metrics = timer.read({ inputTokens: 10, outputTokens: 50, totalTokens: 60 });
    expect(metrics).toEqual({
      modelId: "m",
      timeToFirstTokenMs: 250,
      tokensPerSecond: 25,
      inputTokens: 10,
      outputTokens: 50,
      totalTokens: 60,
      costUsd: 0,
    });
  });

  test("reports nulls when nothing was measured", () => {
    const timer = createResponseTimer("m", steppingClock([0, 0]));
    expect(
      timer.read({
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      }),
    ).toEqual({
      modelId: "m",
      timeToFirstTokenMs: null,
      tokensPerSecond: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: 0,
    });
  });

  test("rounds speed to two decimals", () => {
    const timer = createResponseTimer("m", steppingClock([0, 3000]));
    expect(
      timer.read({ inputTokens: 1, outputTokens: 10, totalTokens: 11 }).tokensPerSecond,
    ).toBe(3.33);
  });
});
