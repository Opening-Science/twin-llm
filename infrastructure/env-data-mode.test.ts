import { describe, expect, test } from "bun:test";

import { parseServerEnv } from "./env";

const BASE = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
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

describe("DATA_MODE env", () => {
  test("accepts synthetic and personal", () => {
    expect(parseServerEnv({ ...BASE, DATA_MODE: "synthetic" }).DATA_MODE).toBe(
      "synthetic",
    );
    expect(parseServerEnv({ ...BASE, DATA_MODE: "personal" }).DATA_MODE).toBe("personal");
  });

  test("defaults to personal when unset or empty", () => {
    expect(parseServerEnv({ ...BASE }).DATA_MODE).toBe("personal");
    expect(parseServerEnv({ ...BASE, DATA_MODE: "" }).DATA_MODE).toBe("personal");
  });

  test("the removed alias demo fails startup", () => {
    expect(parseError({ ...BASE, DATA_MODE: "demo" })).toContain(
      "  - DATA_MODE: DATA_MODE must be synthetic or personal",
    );
  });

  test("the removed alias real fails startup", () => {
    expect(parseError({ ...BASE, DATA_MODE: "real" })).toContain(
      "  - DATA_MODE: DATA_MODE must be synthetic or personal",
    );
  });
});
