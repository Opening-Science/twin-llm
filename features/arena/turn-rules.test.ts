import { describe, expect, test } from "bun:test";

import { type CatalogModel, withAgents } from "@/infrastructure/model-catalog";

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
        skill: null,
        label: null,
        models: [
          { id: "medgemma:4b", name: "MedGemma 4B" },
          { id: "qwen3:8b", name: "qwen3:8b" },
        ],
      },
    });
  });

  test("an Auto row is stored under the agent it picks for the prompt", () => {
    const rows = withAgents(catalog, {
      provider: "ollama",
      chatIsLocal: true,
      skills: [
        { name: "nutrition", providers: ["ollama"], sources: [], tools: [] },
        { name: "sleep", providers: ["ollama"], sources: [], tools: [] },
      ],
    });
    const check = checkTurnRequest(
      { prompt: "How has my body weight changed?", modelIds: ["agent:auto", "qwen3:8b"] },
      rows,
      "ollama",
    );
    expect(check.ok && check.plan.models).toEqual([
      { id: "agent:auto", name: "Auto → Diet specialist" },
      { id: "qwen3:8b", name: "qwen3:8b" },
    ]);
  });

  test("the title is the first 80 characters of the prompt", () => {
    const prompt = "x".repeat(81);
    const check = checkTurnRequest({ prompt, modelIds: ["qwen3:8b"] }, catalog, "ollama");
    expect(check.ok && check.plan.title).toBe("x".repeat(80));
  });

  test("a skill the person sent with names the title and is kept for the turn (#479)", () => {
    const check = checkTurnRequest(
      { prompt: "last 30 nights", modelIds: ["qwen3:8b"], skill: "sleep" },
      catalog,
      "ollama",
    );
    expect(check.ok && check.plan.title).toBe("/sleep last 30 nights");
    expect(check.ok && check.plan.skill).toBe("sleep");
  });

  test("a starter's short text is kept for the bubble; the prompt is sent and names the title (#506)", () => {
    const grounded =
      "For synthetic subject 4f083ce3-f12b-bb4b-7353-e17f0cd55b0a, using LOINC 4548-4, what was their latest HbA1c?";
    const check = checkTurnRequest(
      {
        prompt: grounded,
        modelIds: ["qwen3:8b"],
        label: " What was their latest HbA1c? ",
      },
      catalog,
      "ollama",
    );
    expect(check.ok && check.plan.prompt).toBe(grounded);
    expect(check.ok && check.plan.label).toBe("What was their latest HbA1c?");
    expect(check.ok && check.plan.title).toBe(
      "What was their latest HbA1c? · subject 4f083c",
    );
  });

  test("a label that is empty or the prompt itself is not kept (#506)", () => {
    const same = checkTurnRequest(
      { prompt: "How did I sleep?", modelIds: ["qwen3:8b"], label: "How did I sleep?" },
      catalog,
      "ollama",
    );
    expect(same.ok && same.plan.label).toBeNull();
    const blank = checkTurnRequest(
      { prompt: "How did I sleep?", modelIds: ["qwen3:8b"], label: "  " },
      catalog,
      "ollama",
    );
    expect(blank.ok && blank.plan.label).toBeNull();
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
