import { describe, expect, test } from "bun:test";

import { ncbiEnv, parseServerEnv } from "./env";

const BASE = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LLM_PROVIDER: "ollama",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
} as const;

const failureOf = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
};

describe("ncbiEnv (#6)", () => {
  test("names the app and sends no address by default", () => {
    expect(ncbiEnv(parseServerEnv(BASE))).toEqual({ tool: "twinllm", email: null });
  });

  test("reads the operator's tool name and contact address", () => {
    expect(
      ncbiEnv(
        parseServerEnv({ ...BASE, NCBI_TOOL: "lab-twin", NCBI_EMAIL: "ops@example.org" }),
      ),
    ).toEqual({ tool: "lab-twin", email: "ops@example.org" });
  });

  test("refuses a tool name with spaces and an address that is not one", () => {
    expect(failureOf({ ...BASE, NCBI_TOOL: "twin llm" })).toContain(
      "NCBI_TOOL must be one word",
    );
    expect(failureOf({ ...BASE, NCBI_EMAIL: "nobody" })).toContain(
      "NCBI_EMAIL must be an email address",
    );
  });
});
