import { describe, expect, test } from "bun:test";

import {
  assertProviderAllowedForDataMode,
  type DataMode,
  type ExoscalePersonalData,
  type LlmProvider,
  PERSONAL_DATA_SENT_AUDIT_TOOL,
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_ERROR,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  sendsPersonalDataToHostedModel,
} from "./data-mode-policy";

const DENIED = {
  ok: false,
  code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  error: PROVIDER_NOT_PERMITTED_ERROR,
} as const;

const ALLOWED = { ok: true } as const;

type Row = readonly [
  mode: DataMode,
  hasWearableNarrative: boolean,
  provider: LlmProvider,
  setting: ExoscalePersonalData,
  expected: typeof ALLOWED | typeof DENIED,
  audited: boolean,
];

/**
 * Every mode × wearable context × provider × EXOSCALE_PERSONAL_DATA. A
 * request is personal when DATA_MODE=personal or it has wearable context.
 */
const MATRIX: readonly Row[] = [
  // Synthetic, no wearable context: every provider, either setting.
  ["synthetic", false, "ollama", "off", ALLOWED, false],
  ["synthetic", false, "ollama", "consented-pilot", ALLOWED, false],
  ["synthetic", false, "exoscale", "off", ALLOWED, false],
  ["synthetic", false, "exoscale", "consented-pilot", ALLOWED, false],
  ["synthetic", false, "openrouter", "off", ALLOWED, false],
  ["synthetic", false, "openrouter", "consented-pilot", ALLOWED, false],
  ["synthetic", false, "remote-gpu", "off", ALLOWED, false],
  ["synthetic", false, "remote-gpu", "consented-pilot", ALLOWED, false],
  ["synthetic", false, "infomaniak", "off", ALLOWED, false],
  ["synthetic", false, "infomaniak", "consented-pilot", ALLOWED, false],
  // Synthetic with wearable context: a personal request.
  ["synthetic", true, "ollama", "off", ALLOWED, false],
  ["synthetic", true, "ollama", "consented-pilot", ALLOWED, false],
  ["synthetic", true, "exoscale", "off", DENIED, false],
  ["synthetic", true, "exoscale", "consented-pilot", ALLOWED, true],
  ["synthetic", true, "openrouter", "off", DENIED, false],
  ["synthetic", true, "openrouter", "consented-pilot", DENIED, false],
  ["synthetic", true, "remote-gpu", "off", DENIED, false],
  ["synthetic", true, "remote-gpu", "consented-pilot", DENIED, false],
  ["synthetic", true, "infomaniak", "off", DENIED, false],
  ["synthetic", true, "infomaniak", "consented-pilot", DENIED, false],
  // Personal, no wearable context.
  ["personal", false, "ollama", "off", ALLOWED, false],
  ["personal", false, "ollama", "consented-pilot", ALLOWED, false],
  ["personal", false, "exoscale", "off", DENIED, false],
  ["personal", false, "exoscale", "consented-pilot", ALLOWED, true],
  ["personal", false, "openrouter", "off", DENIED, false],
  ["personal", false, "openrouter", "consented-pilot", DENIED, false],
  ["personal", false, "remote-gpu", "off", DENIED, false],
  ["personal", false, "remote-gpu", "consented-pilot", DENIED, false],
  ["personal", false, "infomaniak", "off", DENIED, false],
  ["personal", false, "infomaniak", "consented-pilot", DENIED, false],
  // Personal with wearable context.
  ["personal", true, "ollama", "off", ALLOWED, false],
  ["personal", true, "ollama", "consented-pilot", ALLOWED, false],
  ["personal", true, "exoscale", "off", DENIED, false],
  ["personal", true, "exoscale", "consented-pilot", ALLOWED, true],
  ["personal", true, "openrouter", "off", DENIED, false],
  ["personal", true, "openrouter", "consented-pilot", DENIED, false],
  ["personal", true, "remote-gpu", "off", DENIED, false],
  ["personal", true, "remote-gpu", "consented-pilot", DENIED, false],
  ["personal", true, "infomaniak", "off", DENIED, false],
  ["personal", true, "infomaniak", "consented-pilot", DENIED, false],
];

describe("permitProviderForRequest matrix", () => {
  test.each(MATRIX)(
    "%s, wearable context %p, %s, EXOSCALE_PERSONAL_DATA=%s",
    (mode, hasWearableNarrative, provider, exoscalePersonalData, expected, audited) => {
      const request = { mode, provider, hasWearableNarrative, exoscalePersonalData };
      expect(permitProviderForRequest(request)).toEqual(expected);
      expect(sendsPersonalDataToHostedModel(request)).toBe(audited);
    },
  );

  test("the matrix covers all 40 combinations once", () => {
    expect(new Set(MATRIX.map((row) => row.slice(0, 4).join("|"))).size).toBe(40);
  });
});

describe("assertProviderAllowedForDataMode", () => {
  test.each([
    ["personal", "openrouter", "consented-pilot", true],
    ["personal", "remote-gpu", "consented-pilot", true],
    ["personal", "exoscale", "off", true],
    ["personal", "exoscale", "consented-pilot", false],
    ["personal", "ollama", "off", false],
    ["personal", "infomaniak", "consented-pilot", true],
    ["synthetic", "openrouter", "off", false],
    ["synthetic", "remote-gpu", "off", false],
    ["synthetic", "exoscale", "off", false],
    ["synthetic", "infomaniak", "off", false],
  ] as const)("%s, %s, %s throws: %p", (mode, provider, setting, throws) => {
    const run = () => assertProviderAllowedForDataMode(mode, provider, setting);
    if (throws) {
      expect(run).toThrow(PROVIDER_NOT_PERMITTED_ERROR);
    } else {
      expect(run).not.toThrow();
    }
  });
});

describe("refusal wording", () => {
  test("names the rule and both ways forward, never Exoscale alone", () => {
    expect(PROVIDER_NOT_PERMITTED_ERROR).toBe(
      "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE: This model provider may not receive personal data or wearable context. Use local Ollama, or Exoscale with EXOSCALE_PERSONAL_DATA=consented-pilot for a consented pilot.",
    );
    expect(PROVIDER_NOT_PERMITTED_ERROR).not.toContain("Use exoscale");
  });

  test("the deny payload names the rule, not the data", () => {
    const denied = permitProviderForRequest({
      mode: "personal",
      provider: "exoscale",
      hasWearableNarrative: true,
      exoscalePersonalData: "off",
    });
    expect(JSON.stringify(denied)).not.toMatch(/Oura|Whoop|recovery|score|narrative/i);
  });

  test("the audit tool name", () => {
    expect(PERSONAL_DATA_SENT_AUDIT_TOOL).toBe("provider.personal_data_sent");
  });
});
