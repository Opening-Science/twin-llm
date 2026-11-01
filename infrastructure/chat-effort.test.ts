import { describe, expect, test } from "bun:test";

import {
  applyEffort,
  DEFAULT_EFFORT,
  EFFORT_AUDIT_TOOL,
  EFFORT_LEVELS,
  effortEvent,
  effortLine,
  effortPlan,
  parseEffort,
  thinkingProviderOptions,
} from "./chat-effort";

describe("effortPlan (#366)", () => {
  test("each step changes thinking, the step limit or the number check", () => {
    expect(EFFORT_LEVELS.map(effortPlan)).toEqual([
      { level: "quick", thinking: false, maxSteps: 4, review: false },
      { level: "balanced", thinking: false, maxSteps: 8, review: false },
      { level: "thorough", thinking: true, maxSteps: 8, review: false },
      { level: "deep", thinking: true, maxSteps: 12, review: false },
      { level: "ultra", thinking: true, maxSteps: 12, review: true },
    ]);
  });

  test("Balanced is the default and is the turn as it ran before", () => {
    expect(DEFAULT_EFFORT).toBe("balanced");
    expect(effortPlan(DEFAULT_EFFORT)).toEqual({
      level: "balanced",
      thinking: false,
      maxSteps: 8,
      review: false,
    });
  });
});

describe("parseEffort", () => {
  test("keeps a known step and falls back to Balanced for anything else", () => {
    expect(["ultra", "quick", "max", 3, null, undefined].map(parseEffort)).toEqual([
      "ultra",
      "quick",
      "balanced",
      "balanced",
      "balanced",
      "balanced",
    ]);
  });
});

describe("applyEffort", () => {
  test("Ollama with a thinking model: thinking follows the plan", () => {
    expect(applyEffort("deep", { ollama: true, canThink: true })).toEqual({
      level: "deep",
      thinking: "on",
      maxSteps: 12,
      review: false,
    });
    expect(applyEffort("quick", { ollama: true, canThink: true })).toEqual({
      level: "quick",
      thinking: "off",
      maxSteps: 4,
      review: false,
    });
  });

  test("Ollama without the capability: thinking is unavailable, the rest still applies", () => {
    expect(applyEffort("ultra", { ollama: true, canThink: false })).toEqual({
      level: "ultra",
      thinking: "unavailable",
      maxSteps: 12,
      review: true,
    });
    expect(applyEffort("balanced", { ollama: true, canThink: false }).thinking).toBe(
      "off",
    );
  });

  test("another provider keeps its own default at every step", () => {
    expect(
      EFFORT_LEVELS.map(
        (level) => applyEffort(level, { ollama: false, canThink: true }).thinking,
      ),
    ).toEqual(Array.from({ length: 5 }, () => "provider-default"));
  });
});

describe("thinkingProviderOptions", () => {
  test("sends think: true only when thinking is on", () => {
    expect(thinkingProviderOptions({ thinking: "on" })).toEqual({
      ollama: { think: true },
    });
    expect(
      (["off", "unavailable", "provider-default"] as const).map((thinking) =>
        thinkingProviderOptions({ thinking }),
      ),
    ).toEqual([null, null, null]);
  });
});

describe("effortLine", () => {
  test("names the step and what thinking did", () => {
    expect(effortLine(applyEffort("ultra", { ollama: true, canThink: true }))).toBe(
      "Ultra effort: thinking on, up to 12 model calls, numbers checked.",
    );
    expect(effortLine(applyEffort("thorough", { ollama: true, canThink: false }))).toBe(
      "Thorough effort: this model has no thinking mode, up to 8 model calls.",
    );
    expect(effortLine(applyEffort("quick", { ollama: false, canThink: false }))).toBe(
      "Quick effort: thinking left to the provider, up to 4 model calls.",
    );
  });
});

describe("effortEvent", () => {
  test("records the step and what it became, with no prompt text", () => {
    expect(
      effortEvent(applyEffort("ultra", { ollama: true, canThink: true }), {
        actor: "user_synthetic_1",
        sessionId: "turn-synthetic-1",
        modelId: "qwen3:4b",
      }),
    ).toEqual({
      actor: "user_synthetic_1",
      sessionId: "turn-synthetic-1",
      subjectRef: null,
      tool: EFFORT_AUDIT_TOOL,
      args: { modelId: "qwen3:4b", effort: "ultra" },
      result: { thinking: "on", maxSteps: 12, review: true },
      rowCount: 0,
    });
  });
});
