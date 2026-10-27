import { describe, expect, test } from "bun:test";

import { parseServerEnv } from "./env";

const BASE = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LOCAL_ONLY: "true",
  DATA_MODE: "synthetic",
  LLM_PROVIDER: "ollama",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
} as const;

const parseError = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parseServerEnv to throw");
};

describe("OLLAMA_NUM_CTX", () => {
  test("defaults to 16384, also when blank", () => {
    expect(parseServerEnv(BASE).OLLAMA_NUM_CTX).toBe(16_384);
    expect(parseServerEnv({ ...BASE, OLLAMA_NUM_CTX: "" }).OLLAMA_NUM_CTX).toBe(16_384);
  });

  test("takes a larger whole number", () => {
    expect(parseServerEnv({ ...BASE, OLLAMA_NUM_CTX: "32768" }).OLLAMA_NUM_CTX).toBe(
      32_768,
    );
  });

  test("refuses Ollama's 4096 default and fractions", () => {
    expect(parseError({ ...BASE, OLLAMA_NUM_CTX: "4096" })).toContain(
      "  - OLLAMA_NUM_CTX: OLLAMA_NUM_CTX must be at least 8192",
    );
    expect(parseError({ ...BASE, OLLAMA_NUM_CTX: "16384.5" })).toContain(
      "  - OLLAMA_NUM_CTX: OLLAMA_NUM_CTX must be a whole number of tokens",
    );
  });
});
