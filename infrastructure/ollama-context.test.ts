import { describe, expect, test } from "bun:test";

import {
  estimateTokens,
  JSON_CHARS_PER_TOKEN,
  ollamaApiRoot,
  promptBudgetTokens,
} from "./ollama-context";

describe("ollama context", () => {
  test("the native API root comes from the OpenAI-compatible base URL", () => {
    expect(ollamaApiRoot("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/api");
    expect(ollamaApiRoot("http://127.0.0.1:11434/v1/")).toBe(
      "http://127.0.0.1:11434/api",
    );
    expect(ollamaApiRoot("http://[::1]:11434")).toBe("http://[::1]:11434/api");
  });

  test("every digit is a token; other characters go by the ratio", () => {
    expect(estimateTokens("sleep.hr.2026-09-07")).toBe(8 + 5);
    expect(estimateTokens('{"type":"object"}', JSON_CHARS_PER_TOKEN)).toBe(5);
    expect(estimateTokens("")).toBe(0);
  });

  test("the default context leaves 12288 tokens for prompt and tools", () => {
    expect(promptBudgetTokens(16_384)).toBe(12_288);
  });
});
