import { describe, expect, test } from "bun:test";

import { applyLocalOnlyDefaults, parseServerEnv } from "./env";

const LOCAL_BASE = {
  LOCAL_ONLY: "true",
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  DATA_MODE: "personal",
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

describe("LOCAL_ONLY env", () => {
  test("defaults the provider to ollama and parses a loopback config", () => {
    const env = parseServerEnv({
      ...LOCAL_BASE,
      OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    expect(env.LOCAL_ONLY).toBe(true);
    expect(env.LLM_PROVIDER).toBe("ollama");
    expect(env.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434/v1");
  });

  test("an empty LLM_PROVIDER also becomes ollama", () => {
    expect(applyLocalOnlyDefaults({ LOCAL_ONLY: "true", LLM_PROVIDER: " " })).toEqual({
      LOCAL_ONLY: "true",
      LLM_PROVIDER: "ollama",
    });
  });

  test("leaves a named provider untouched", () => {
    const source = { LOCAL_ONLY: "false", LLM_PROVIDER: "infomaniak" };
    expect(applyLocalOnlyDefaults(source)).toBe(source);
  });

  test("with LOCAL_ONLY off, no provider means exoscale, never infomaniak", () => {
    expect(applyLocalOnlyDefaults({ LOCAL_ONLY: "false" })).toEqual({
      LOCAL_ONLY: "false",
      LLM_PROVIDER: "exoscale",
    });
    expect(applyLocalOnlyDefaults({})).toEqual({ LLM_PROVIDER: "exoscale" });
    expect(
      parseServerEnv({
        ...LOCAL_BASE,
        LOCAL_ONLY: "false",
        EXOSCALE_BASE_URLS: "https://gpu1.example.invalid/v1",
        EXOSCALE_PERSONAL_DATA: "consented-pilot",
      }).LLM_PROVIDER,
    ).toBe("exoscale");
  });

  test("with LOCAL_ONLY off and no Exoscale URL, startup fails naming the env", () => {
    expect(parseError({ ...LOCAL_BASE, LOCAL_ONLY: "false" })).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS is required when LLM_PROVIDER=exoscale, the default with LOCAL_ONLY=false (comma list of vLLM URLs ending in /v1, one per GPU). For a model on this machine set LOCAL_ONLY=true",
    );
  });

  test("rejects exoscale, even through a tunnel on loopback", () => {
    expect(
      parseError({
        ...LOCAL_BASE,
        LLM_PROVIDER: "exoscale",
        EXOSCALE_BASE_URLS: "http://127.0.0.1:9000/v1",
      }),
    ).toContain(
      "LLM_PROVIDER: LOCAL_ONLY=true needs LLM_PROVIDER=ollama; exoscale runs the model on our Exoscale instance, not on this machine. Set LOCAL_ONLY=false",
    );
  });

  test("rejects a cloud model provider", () => {
    expect(parseError({ ...LOCAL_BASE, LLM_PROVIDER: "infomaniak" })).toContain(
      "LLM_PROVIDER: LOCAL_ONLY=true needs LLM_PROVIDER=ollama; cloud model providers are off",
    );
  });

  test("rejects an Ollama URL off this machine", () => {
    expect(
      parseError({ ...LOCAL_BASE, OLLAMA_BASE_URL: "http://192.168.1.20:11434/v1" }),
    ).toContain(
      "OLLAMA_BASE_URL: LOCAL_ONLY=true needs OLLAMA_BASE_URL on this machine (localhost, 127.0.0.1 or [::1])",
    );
  });

  test("rejects a remote GBD server", () => {
    expect(
      parseError({ ...LOCAL_BASE, GBD_MCP_URL: "https://gbd.example.invalid/mcp" }),
    ).toContain(
      "GBD_MCP_URL: LOCAL_ONLY=true turns off the remote GBD server; unset GBD_MCP_URL",
    );
  });

  test.each([
    ["NEXT_PUBLIC_POSTHOG_KEY", "phc_synthetic"],
    ["ARCJET_KEY", "ajkey_synthetic"],
    ["CLERK_SECRET_KEY", "sk_test_synthetic"],
    ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_synthetic"],
  ])("rejects %s", (key, value) => {
    expect(parseError({ ...LOCAL_BASE, [key]: value })).toContain(
      `${key}: LOCAL_ONLY=true turns off cloud analytics and auth; unset ${key}`,
    );
  });

  test("needs the light auth mode", () => {
    expect(
      parseError({ ...LOCAL_BASE, LOCAL_MVP: "false", AUTH_DISABLED: "false" }),
    ).toContain("LOCAL_ONLY: LOCAL_ONLY=true needs LOCAL_MVP=true or AUTH_DISABLED=true");
  });
});
