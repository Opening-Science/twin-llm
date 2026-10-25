import { describe, expect, test } from "bun:test";

import { analyticsEnv, DEFAULT_POSTHOG_HOST, parseServerEnv } from "./env";

const AUTH_OFF = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LLM_PROVIDER: "ollama",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
} as const;

const AUTH_ON = {
  LLM_PROVIDER: "ollama",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
  OPENROUTER_API_KEY: "sk-synthetic",
  CLERK_SECRET_KEY: "sk_test_synthetic",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic",
  ARCJET_KEY: "ajkey_synthetic",
} as const;

const failureOf = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
};

describe("auth off outside development", () => {
  test("is refused under NODE_ENV=production", () => {
    expect(failureOf({ ...AUTH_OFF, NODE_ENV: "production" })).toContain(
      "AUTH_DISABLED: LOCAL_MVP/AUTH_DISABLED is refused when NODE_ENV=production",
    );
    expect(
      failureOf({ LOCAL_MVP: "true", ...AUTH_ON, NODE_ENV: "production" }),
    ).toContain("ALLOW_AUTH_DISABLED_IN_PRODUCTION");
  });

  test("boots in production only with the explicit override", () => {
    const env = parseServerEnv({
      ...AUTH_OFF,
      NODE_ENV: "production",
      ALLOW_AUTH_DISABLED_IN_PRODUCTION: "true",
    });
    expect(env.AUTH_DISABLED).toBe(true);
    expect(
      failureOf({
        ...AUTH_OFF,
        NODE_ENV: "production",
        ALLOW_AUTH_DISABLED_IN_PRODUCTION: "false",
      }),
    ).not.toBe("");
  });

  test("development and test runs are unaffected", () => {
    expect(failureOf({ ...AUTH_OFF, NODE_ENV: "development" })).toBe("");
    expect(failureOf({ ...AUTH_OFF, NODE_ENV: "test" })).toBe("");
  });

  test("auth on in production needs no override", () => {
    expect(failureOf({ ...AUTH_ON, NODE_ENV: "production" })).toBe("");
  });
});

describe("PostHog settings", () => {
  test("are optional when auth is on", () => {
    const env = parseServerEnv({ ...AUTH_ON });
    expect(env.NEXT_PUBLIC_POSTHOG_KEY).toBeUndefined();
    expect(analyticsEnv(env)).toBeNull();
  });

  test("default to the EU host when only a key is set", () => {
    const env = parseServerEnv({ ...AUTH_ON, NEXT_PUBLIC_POSTHOG_KEY: "phc_synthetic" });
    expect(analyticsEnv(env)).toEqual({
      key: "phc_synthetic",
      host: DEFAULT_POSTHOG_HOST,
    });
    expect(DEFAULT_POSTHOG_HOST).toBe("https://eu.i.posthog.com");
  });

  test("keep an explicitly configured host", () => {
    const env = parseServerEnv({
      ...AUTH_ON,
      NEXT_PUBLIC_POSTHOG_KEY: "phc_synthetic",
      NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.example.org",
    });
    expect(analyticsEnv(env)?.host).toBe("https://posthog.example.org");
  });

  test("the other auth-on keys stay required", () => {
    const message = failureOf({
      LLM_PROVIDER: "ollama",
      DATABASE_URL: AUTH_ON.DATABASE_URL,
    });
    [
      "OPENROUTER_API_KEY",
      "CLERK_SECRET_KEY",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "ARCJET_KEY",
    ].forEach((key) =>
      expect(message).toContain(`${key} is required unless LOCAL_MVP/AUTH_DISABLED`),
    );
    expect(message).not.toContain("POSTHOG");
  });
});
