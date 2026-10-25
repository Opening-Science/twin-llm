import { describe, expect, test } from "bun:test";

import { personalDataSentEvent } from "./personal-data-audit";

const CALL = {
  actor: "user_synthetic_1",
  sessionId: "user_synthetic_1",
  modelId: "swiss-ai/Apertus-8B-Instruct-2509",
};

describe("personalDataSentEvent", () => {
  test("a personal request to Exoscale under the pilot is one event, without content", () => {
    expect(
      personalDataSentEvent(
        {
          mode: "personal",
          provider: "exoscale",
          hasWearableNarrative: false,
          exoscalePersonalData: "consented-pilot",
        },
        CALL,
      ),
    ).toEqual({
      actor: "user_synthetic_1",
      sessionId: "user_synthetic_1",
      subjectRef: null,
      tool: "provider.personal_data_sent",
      args: { provider: "exoscale", modelId: "swiss-ai/Apertus-8B-Instruct-2509" },
      result: { sent: true },
      rowCount: 0,
    });
  });

  test("synthetic data, the setting off, or a local model needs no event", () => {
    expect(
      personalDataSentEvent(
        {
          mode: "synthetic",
          provider: "exoscale",
          hasWearableNarrative: false,
          exoscalePersonalData: "consented-pilot",
        },
        CALL,
      ),
    ).toBeNull();
    expect(
      personalDataSentEvent(
        {
          mode: "personal",
          provider: "exoscale",
          hasWearableNarrative: true,
          exoscalePersonalData: "off",
        },
        CALL,
      ),
    ).toBeNull();
    expect(
      personalDataSentEvent(
        {
          mode: "personal",
          provider: "ollama",
          hasWearableNarrative: true,
          exoscalePersonalData: "consented-pilot",
        },
        CALL,
      ),
    ).toBeNull();
  });
});
