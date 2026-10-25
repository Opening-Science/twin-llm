import { describe, expect, test } from "bun:test";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import { checkTurnRequest } from "./turn-rules";

const catalog: CatalogModel[] = [
  {
    id: "qwen3:8b",
    name: "qwen3:8b",
    provider: "Ollama",
    providerId: "ollama",
    contextTokens: 40_960,
  },
  {
    id: "medgemma:4b",
    name: "MedGemma 4B",
    provider: "Ollama",
    providerId: "ollama",
    contextTokens: 8_192,
  },
];

describe("checkTurnRequest", () => {
  test("trims the prompt, drops duplicate ids and names models from the catalog", () => {
    expect(
      checkTurnRequest(
        {
          prompt: "  Synthetic: sleep and resting heart rate?  ",
          modelIds: ["medgemma:4b", "medgemma:4b", "qwen3:8b"],
        },
        catalog,
        "ollama",
      ),
    ).toEqual({
      ok: true,
      plan: {
        prompt: "Synthetic: sleep and resting heart rate?",
        title: "Synthetic: sleep and resting heart rate?",
        models: [
          { id: "medgemma:4b", name: "MedGemma 4B" },
          { id: "qwen3:8b", name: "qwen3:8b" },
        ],
      },
    });
  });

  test("the title is the first 80 characters of the prompt", () => {
    const prompt = "x".repeat(81);
    const check = checkTurnRequest({ prompt, modelIds: ["qwen3:8b"] }, catalog, "ollama");
    expect(check.ok && check.plan.title).toBe("x".repeat(80));
  });

  test("refuses in order: empty prompt, model count, catalog, unknown model", () => {
    expect(checkTurnRequest({ prompt: "  ", modelIds: [] }, null, "ollama")).toEqual({
      ok: false,
      error: "Write a prompt before sending.",
    });
    expect(checkTurnRequest({ prompt: "q", modelIds: [] }, null, "ollama")).toEqual({
      ok: false,
      error: "Pick between one and three models.",
    });
    expect(
      checkTurnRequest(
        { prompt: "q", modelIds: ["a", "b", "c", "d"] },
        catalog,
        "ollama",
      ),
    ).toEqual({ ok: false, error: "Pick between one and three models." });
    expect(
      checkTurnRequest({ prompt: "q", modelIds: ["qwen3:8b"] }, null, "ollama"),
    ).toEqual({
      ok: false,
      error: "We can't reach the model list right now. Try again in a moment.",
    });
    expect(
      checkTurnRequest({ prompt: "q", modelIds: ["gone"] }, catalog, "ollama"),
    ).toEqual({
      ok: false,
      error: "One of those models isn't available for the active provider. Pick another.",
    });
    expect(
      checkTurnRequest({ prompt: "q", modelIds: ["gone"] }, catalog, "openrouter"),
    ).toEqual({
      ok: false,
      error: "One of those models isn't on the free list any more. Pick another.",
    });
  });
});
