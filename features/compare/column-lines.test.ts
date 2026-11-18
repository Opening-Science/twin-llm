import { describe, expect, test } from "bun:test";

import { AUTO_MODEL_ID, type CatalogModel } from "@/infrastructure/model-catalog";

import {
  answerEffortLine,
  autoLine,
  badgeLetter,
  cardBadge,
  fineTuneId,
  stepStateOf,
  traceStateOf,
} from "./column-lines";

const agentRow = (id: string, name: string, base: string): CatalogModel => ({
  id: `agent:${id}`,
  name,
  provider: "TwinLLM",
  providerId: "twinllm",
  contextTokens: 8192,
  agent: {
    id,
    name,
    role: "synthetic",
    skill: null,
    baseModelId: base.toLowerCase(),
    baseModelName: base,
  },
});

const CATALOG: readonly CatalogModel[] = [
  { ...agentRow("auto", "Auto", "Qwen3 4B"), id: AUTO_MODEL_ID },
  agentRow("diet", "Diet specialist", "Gemma 3"),
];

describe("the column header (SPEC 4)", () => {
  test("the badge is the first letter of the display name", () => {
    expect(badgeLetter("qwen3 4B")).toBe("Q");
    expect(badgeLetter("Auto → Diet specialist")).toBe("A");
  });

  test("the raw id shows only for a fine-tune", () => {
    expect(fineTuneId("twinllm-qwen3-4b-v1h:latest")).toBe("twinllm-qwen3-4b-v1h:latest");
    expect(fineTuneId("qwen3:4b")).toBeNull();
    expect(fineTuneId("agent:diet")).toBeNull();
  });

  test("the Auto line names the specialist, Auto's own model and the topic", () => {
    const line = autoLine(
      { modelId: AUTO_MODEL_ID, modelName: "Auto → Diet specialist" },
      "How did my BMI change?",
      CATALOG,
    );
    expect(line).toContain("Auto chose Diet specialist on Qwen3 4B");
  });

  test("the model is left out when the catalog no longer offers the specialist", () => {
    const line = autoLine(
      { modelId: AUTO_MODEL_ID, modelName: "Auto → Diet specialist" },
      "How did my BMI change?",
      [],
    );
    expect(line).toStartWith("Auto chose Diet specialist:");
  });

  test("no Auto line for any other answer", () => {
    expect(
      autoLine({ modelId: "agent:diet", modelName: "Diet specialist" }, "x", CATALOG),
    ).toBeNull();
  });

  test("the effort line shows only away from Balanced", () => {
    expect(answerEffortLine(null)).toBeNull();
    expect(
      answerEffortLine({
        effort: { level: "balanced", thinking: "off", max_steps: 8, review: false },
      }),
    ).toBeNull();
    expect(
      answerEffortLine({
        effort: { level: "ultra", thinking: "on", max_steps: 12, review: true },
      }),
    ).toBe("Ultra effort: thinking on, up to 12 model calls, numbers checked.");
  });
});

describe("steps and badges (SPEC 5.3)", () => {
  test("a gate refusal is refused; a call that found nothing is no data and counts as used", () => {
    expect(stepStateOf({ state: "refused", didNotRun: true })).toBe("refused");
    expect(stepStateOf({ state: "refused" })).toBe("skipped");
    expect(stepStateOf({ state: "running" })).toBe("current");
    expect(stepStateOf({ state: "error" })).toBe("failed");
    expect(stepStateOf({ state: "done" })).toBe("done");
  });

  test("badges in words, with their tones", () => {
    expect(cardBadge({ state: "running" })).toEqual({
      label: "Running",
      tone: "neutral",
    });
    expect(cardBadge({ state: "done" })).toEqual({ label: "Done", tone: "ok" });
    expect(cardBadge({ state: "refused" })).toEqual({ label: "No data", tone: "off" });
    expect(cardBadge({ state: "refused", didNotRun: true })).toEqual({
      label: "Refused",
      tone: "off",
    });
    expect(cardBadge({ state: "error" })).toEqual({ label: "Failed", tone: "warn" });
  });

  test("the trace works while streaming or reviewing, then settles", () => {
    expect(traceStateOf({ status: "STREAMING" })).toBe("working");
    expect(traceStateOf({ status: "COMPLETE", reviewing: true })).toBe("working");
    expect(traceStateOf({ status: "COMPLETE" })).toBe("done");
    expect(traceStateOf({ status: "FAILED" })).toBe("failed");
  });
});
