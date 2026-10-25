import { afterEach, describe, expect, test } from "bun:test";

import { browserAnalyticsConfig, isClerkEnabled } from "./public-env";

const KEYS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_LOCAL_MVP",
  "NEXT_PUBLIC_AUTH_DISABLED",
] as const;

const snapshot = (): Record<(typeof KEYS)[number], string | undefined> => {
  const out = {} as Record<(typeof KEYS)[number], string | undefined>;
  for (const key of KEYS) {
    out[key] = process.env[key];
  }
  return out;
};

const restore = (prev: Record<(typeof KEYS)[number], string | undefined>) => {
  for (const key of KEYS) {
    const value = prev[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const clearClerkEnv = () => {
  for (const key of KEYS) {
    delete process.env[key];
  }
};

describe("isClerkEnabled", () => {
  const prev = snapshot();

  afterEach(() => {
    restore(prev);
  });

  test("false when publishable key is absent", () => {
    clearClerkEnv();
    expect(isClerkEnabled()).toBe(false);
  });

  test("true when publishable key is present and MVP flags unset", () => {
    clearClerkEnv();
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    expect(isClerkEnabled()).toBe(true);
  });

  test("false when NEXT_PUBLIC_LOCAL_MVP=true even with a key", () => {
    clearClerkEnv();
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.NEXT_PUBLIC_LOCAL_MVP = "true";
    expect(isClerkEnabled()).toBe(false);
  });

  test("false when NEXT_PUBLIC_AUTH_DISABLED=true even with a key", () => {
    clearClerkEnv();
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.NEXT_PUBLIC_AUTH_DISABLED = "true";
    expect(isClerkEnabled()).toBe(false);
  });
});

describe("browserAnalyticsConfig", () => {
  test("is off without the explicit browser opt-in", () => {
    expect(browserAnalyticsConfig({ posthogKey: "phc_x" })).toBeNull();
    expect(
      browserAnalyticsConfig({ posthogKey: "phc_x", posthogBrowser: "1" }),
    ).toBeNull();
    expect(browserAnalyticsConfig({ posthogBrowser: "true" })).toBeNull();
  });

  test("defaults to the EU host when opted in", () => {
    expect(
      browserAnalyticsConfig({ posthogKey: "phc_x", posthogBrowser: "true" }),
    ).toEqual({
      key: "phc_x",
      host: "https://eu.i.posthog.com",
    });
  });

  test("keeps a configured host", () => {
    expect(
      browserAnalyticsConfig({
        posthogKey: "phc_x",
        posthogBrowser: "true",
        posthogHost: "https://ph.example.org",
      })?.host,
    ).toBe("https://ph.example.org");
  });
});
