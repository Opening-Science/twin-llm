import { describe, expect, test } from "bun:test";

import {
  autoLineOf,
  columnRawId,
  effortLineOf,
  specialistModelIn,
} from "./answer-header";

describe("answer column lines", () => {
  test("a fine-tune shows its raw id; any other model none", () => {
    expect(columnRawId("twinllm-qwen3-4b-pilot")).toBe("twinllm-qwen3-4b-pilot");
    expect(columnRawId("qwen3:8b")).toBeNull();
    expect(columnRawId("agent:gp")).toBeNull();
  });

  test("only an Auto answer says what it chose", () => {
    expect(
      autoLineOf(
        { modelId: "agent:auto", modelName: "Auto → Diet specialist" },
        "What is my BMI?",
      ),
    ).toBe("Auto chose Diet specialist: the question is about BMI.");
    expect(
      autoLineOf(
        { modelId: "agent:diet", modelName: "Diet specialist" },
        "What is my BMI?",
      ),
    ).toBeNull();
  });
});

describe("modes and effort lines (#366)", () => {
  const CATALOG = [
    {
      id: "agent:diet",
      agent: {
        id: "diet",
        name: "Diet specialist",
        role: "Describes body weight.",
        skill: "nutrition",
        baseModelId: "qwen3:4b",
        baseModelName: "Qwen3 4B",
      },
    },
    { id: "qwen3:4b" },
  ];

  test("the Auto line names the model the catalog runs the specialist on", () => {
    expect(
      autoLineOf(
        { modelId: "agent:auto", modelName: "Auto → Diet specialist" },
        "What is my BMI?",
        specialistModelIn(CATALOG),
      ),
    ).toBe("Auto chose Diet specialist on Qwen3 4B: the question is about BMI.");
    expect(specialistModelIn(null)("diet")).toBeNull();
    expect(specialistModelIn(CATALOG)("sleep")).toBeNull();
  });

  test("an answer names its effort unless it ran at Balanced or before effort", () => {
    expect(
      effortLineOf({
        effort: { level: "ultra", thinking: "on", max_steps: 12, review: true },
      }),
    ).toBe("Ultra effort: thinking on, up to 12 model calls, numbers checked.");
    expect(
      effortLineOf({
        effort: { level: "balanced", thinking: "off", max_steps: 8, review: false },
      }),
    ).toBeNull();
    expect(effortLineOf({})).toBeNull();
    expect(effortLineOf(null)).toBeNull();
  });
});
