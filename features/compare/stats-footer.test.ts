import { describe, expect, test } from "bun:test";

import { statFigures } from "./stats-footer";

describe("the stats footer (SPEC 5.7)", () => {
  test("figures are grouped in the display locale", () => {
    expect(
      statFigures({
        modelId: "qwen3:4b",
        timeToFirstTokenMs: 7503,
        tokensPerSecond: 45.24,
        inputTokens: 19_000,
        outputTokens: 589,
        totalTokens: 19_589,
        costUsd: 0,
      }).map((figure) => [figure.label, figure.value]),
    ).toEqual([
      ["first token", "7,503 ms"],
      ["speed", "45.2 tok/s"],
      ["tokens", "19,589"],
      ["cost", "$0.0000"],
    ]);
  });

  test("an unmeasured figure is pending, never zero", () => {
    const figures = statFigures({
      modelId: "qwen3:4b",
      timeToFirstTokenMs: null,
      tokensPerSecond: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: 0,
    });
    expect(figures.slice(0, 3).map((figure) => figure.value)).toEqual([null, null, null]);
  });
});
