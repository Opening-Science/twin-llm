import { describe, expect, test } from "bun:test";

import { CHAT_RESPONSE_DOCUMENT, chatResponseMetadata } from "./response-document";

describe("CHAT_RESPONSE_DOCUMENT", () => {
  test("carries the research-only flags", () => {
    expect(CHAT_RESPONSE_DOCUMENT).toEqual({
      intended_use: "research_hypothesis_generation_n_of_1",
      not_for_diagnostic_use: true,
    });
  });

  test("merges onto metrics without dropping measured values", () => {
    const metrics = {
      modelId: "synthetic-model",
      timeToFirstTokenMs: 12,
      tokensPerSecond: 3,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0,
    };
    expect(chatResponseMetadata(metrics)).toEqual({
      ...metrics,
      intended_use: "research_hypothesis_generation_n_of_1",
      not_for_diagnostic_use: true,
    });
  });
});
