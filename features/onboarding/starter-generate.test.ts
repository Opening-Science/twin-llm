import { describe, expect, test } from "bun:test";

import { createStarterGenerate } from "./starter-generate";

const call = { system: "sys", prompt: "p", abortSignal: new AbortController().signal };

describe("createStarterGenerate", () => {
  test("passes hasLinkedData to the provider policy and uses the first model", async () => {
    const resolved: string[] = [];
    const generate = createStarterGenerate({
      loadModelIds: async () => ["qwen3:8b", "gemma3:4b"],
      resolveModel: (modelId, { hasWearableNarrative }) => {
        resolved.push(`${modelId} ${String(hasWearableNarrative)}`);
        return modelId;
      },
      generateText: async ({ model, system, prompt, maxRetries }) => ({
        text: `${model}|${system}|${prompt}|${String(maxRetries)}`,
      }),
    });
    expect(await generate(true)(call)).toBe("qwen3:8b|sys|p|0");
    expect(await generate(false)(call)).toBe("qwen3:8b|sys|p|0");
    expect(resolved).toEqual(["qwen3:8b true", "qwen3:8b false"]);
  });

  test("no catalog is an error, which the starter step turns into fixed starters", async () => {
    const generate = createStarterGenerate({
      loadModelIds: async () => null,
      resolveModel: () => "never",
      generateText: async () => ({ text: "never" }),
    });
    await expect(generate(false)(call)).rejects.toThrow("No model in the active catalog");
  });
});
