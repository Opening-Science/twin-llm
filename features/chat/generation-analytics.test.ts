import { describe, expect, test } from "bun:test";

import { type GenerationFacts, generationEvent } from "./generation-analytics";

const FACTS: GenerationFacts = {
  mode: "synthetic",
  distinctId: "user_synthetic",
  provider: "ollama",
  modelId: "qwen3:8b",
  turnId: "turn_1",
  metrics: {
    modelId: "qwen3:8b",
    timeToFirstTokenMs: 1500,
    tokensPerSecond: 12.5,
    inputTokens: 300,
    outputTokens: 120,
    totalTokens: 420,
    costUsd: 0,
  },
  attributionCount: 2,
  hallucinatedKeyCount: 0,
  contextSources: { oura: false, whoop: true, googleHealth: false, vitronic: false },
};

describe("generationEvent", () => {
  test("is never built in personal mode", () => {
    expect(generationEvent({ ...FACTS, mode: "personal" })).toBeNull();
  });

  test("carries metrics, privacy mode on, and no prompt or answer", () => {
    const event = generationEvent(FACTS);
    expect(event).not.toBeNull();
    expect(event?.privacyMode).toBe(true);
    expect(event?.input).toBeNull();
    expect(event?.output).toBeNull();
    expect(event?.latency).toBe(1.5);
    expect(event?.usage).toEqual({ inputTokens: 300, outputTokens: 120 });
    expect(event?.properties).toEqual({
      turnId: "turn_1",
      attributionCount: 2,
      hallucinatedKeyCount: 0,
      hasOuraContext: false,
      hasWhoopContext: true,
      hasGoogleHealthContext: false,
      hasVitronicContext: false,
    });
  });

  test("leaves latency out when no token arrived", () => {
    const metrics = { ...FACTS.metrics, timeToFirstTokenMs: null };
    expect(generationEvent({ ...FACTS, metrics })?.latency).toBeUndefined();
  });
});
