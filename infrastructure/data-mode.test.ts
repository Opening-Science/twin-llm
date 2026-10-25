import { describe, expect, test } from "bun:test";

import {
  assertProviderAllowedForDataMode,
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_ERROR,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
} from "./data-mode-policy";

describe("DATA_MODE provider guard", () => {
  test("blocks openrouter when DATA_MODE=personal", () => {
    expect(() => assertProviderAllowedForDataMode("personal", "openrouter")).toThrow(
      PROVIDER_NOT_PERMITTED_ERROR,
    );
  });

  test("allows infomaniak when DATA_MODE=personal", () => {
    expect(() =>
      assertProviderAllowedForDataMode("personal", "infomaniak"),
    ).not.toThrow();
  });

  test("allows ollama when DATA_MODE=personal", () => {
    expect(() => assertProviderAllowedForDataMode("personal", "ollama")).not.toThrow();
  });

  test("allows openrouter when DATA_MODE=synthetic", () => {
    expect(() =>
      assertProviderAllowedForDataMode("synthetic", "openrouter"),
    ).not.toThrow();
  });
});

describe("permitProviderForRequest", () => {
  test("synthetic, no narrative, openrouter is allowed", () => {
    expect(
      permitProviderForRequest({
        mode: "synthetic",
        provider: "openrouter",
        hasWearableNarrative: false,
      }),
    ).toEqual({ ok: true });
  });

  test("synthetic, narrative, openrouter is denied", () => {
    expect(
      permitProviderForRequest({
        mode: "synthetic",
        provider: "openrouter",
        hasWearableNarrative: true,
      }),
    ).toEqual({
      ok: false,
      code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
      error: PROVIDER_NOT_PERMITTED_ERROR,
    });
  });

  test("personal, no narrative, openrouter is denied", () => {
    expect(
      permitProviderForRequest({
        mode: "personal",
        provider: "openrouter",
        hasWearableNarrative: false,
      }),
    ).toEqual({
      ok: false,
      code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
      error: PROVIDER_NOT_PERMITTED_ERROR,
    });
  });

  test("personal, narrative, openrouter is denied", () => {
    expect(
      permitProviderForRequest({
        mode: "personal",
        provider: "openrouter",
        hasWearableNarrative: true,
      }),
    ).toEqual({
      ok: false,
      code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
      error: PROVIDER_NOT_PERMITTED_ERROR,
    });
  });

  test("personal, narrative, infomaniak is allowed", () => {
    expect(
      permitProviderForRequest({
        mode: "personal",
        provider: "infomaniak",
        hasWearableNarrative: true,
      }),
    ).toEqual({ ok: true });
  });

  test("personal, narrative, ollama is allowed", () => {
    expect(
      permitProviderForRequest({
        mode: "personal",
        provider: "ollama",
        hasWearableNarrative: true,
      }),
    ).toEqual({ ok: true });
  });

  test("deny payload names the rule, not the data", () => {
    const denied = permitProviderForRequest({
      mode: "personal",
      provider: "openrouter",
      hasWearableNarrative: true,
    });
    expect(JSON.stringify(denied)).not.toMatch(/Oura|Whoop|recovery|score|narrative/i);
  });
});

describe("remote-gpu is synthetic data only", () => {
  const DENIED = {
    ok: false,
    code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
    error: PROVIDER_NOT_PERMITTED_ERROR,
  };

  test("synthetic, no narrative, remote-gpu is allowed", () => {
    expect(
      permitProviderForRequest({
        mode: "synthetic",
        provider: "remote-gpu",
        hasWearableNarrative: false,
      }),
    ).toEqual({ ok: true });
  });

  test("synthetic, narrative, remote-gpu is denied", () => {
    expect(
      permitProviderForRequest({
        mode: "synthetic",
        provider: "remote-gpu",
        hasWearableNarrative: true,
      }),
    ).toEqual(DENIED);
  });

  test("personal, no narrative, remote-gpu is denied", () => {
    expect(
      permitProviderForRequest({
        mode: "personal",
        provider: "remote-gpu",
        hasWearableNarrative: false,
      }),
    ).toEqual(DENIED);
  });

  test("personal, narrative, remote-gpu is denied", () => {
    expect(
      permitProviderForRequest({
        mode: "personal",
        provider: "remote-gpu",
        hasWearableNarrative: true,
      }),
    ).toEqual(DENIED);
  });

  test("the guard throws for personal and passes for synthetic", () => {
    expect(() => assertProviderAllowedForDataMode("personal", "remote-gpu")).toThrow(
      PROVIDER_NOT_PERMITTED_ERROR,
    );
    expect(() =>
      assertProviderAllowedForDataMode("synthetic", "remote-gpu"),
    ).not.toThrow();
  });

  test("the error names both synthetic-only providers and points at exoscale or ollama", () => {
    expect(PROVIDER_NOT_PERMITTED_ERROR).toBe(
      "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE: OpenRouter and the remote GPU are for synthetic data only. They are not permitted when DATA_MODE is personal or the request includes wearable context. Use exoscale or ollama.",
    );
  });
});

/** Our own Exoscale instance may see personal wearable context, like Ollama. */
describe("exoscale is allowed for personal data", () => {
  test.each([
    ["synthetic", false],
    ["synthetic", true],
    ["personal", false],
    ["personal", true],
  ] as const)("%s, narrative %p, exoscale is allowed", (mode, hasWearableNarrative) => {
    expect(
      permitProviderForRequest({ mode, provider: "exoscale", hasWearableNarrative }),
    ).toEqual({ ok: true });
  });

  test("the guard passes in both modes", () => {
    expect(() => assertProviderAllowedForDataMode("personal", "exoscale")).not.toThrow();
    expect(() => assertProviderAllowedForDataMode("synthetic", "exoscale")).not.toThrow();
  });
});
