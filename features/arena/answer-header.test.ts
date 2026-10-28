import { describe, expect, test } from "bun:test";

import { autoLineOf, columnRawId } from "./answer-header";

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
