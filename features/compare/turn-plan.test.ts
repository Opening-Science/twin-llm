import { describe, expect, test } from "bun:test";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import {
  EMPTY_PROMPT_SENTENCE,
  MODEL_COUNT_SENTENCE,
  NO_CATALOG_SENTENCE,
  NOT_FREE_SENTENCE,
  NOT_OFFERED_SENTENCE,
  planTurn,
} from "./turn-plan";

const model = (id: string, name: string, providerId = "ollama"): CatalogModel => ({
  id,
  name,
  provider: providerId,
  providerId,
  contextTokens: 32_000,
});

const CATALOG: readonly CatalogModel[] = [
  model("qwen3:4b", "Qwen3 4B"),
  model("llama3.2:3b", "Llama 3.2 3B", "meta"),
];

describe("the turn plan (SERVER-SPEC 3.1)", () => {
  test("first failure wins, in order", () => {
    expect(planTurn({ prompt: "  ", modelIds: [] }, null, "ollama")).toEqual({
      ok: false,
      error: EMPTY_PROMPT_SENTENCE,
    });
    expect(planTurn({ prompt: "Sleep?", modelIds: [] }, null, "ollama")).toEqual({
      ok: false,
      error: MODEL_COUNT_SENTENCE,
    });
    expect(
      planTurn({ prompt: "Sleep?", modelIds: ["a", "b", "c", "d"] }, null, "ollama"),
    ).toEqual({ ok: false, error: MODEL_COUNT_SENTENCE });
    expect(
      planTurn({ prompt: "Sleep?", modelIds: ["qwen3:4b"] }, null, "ollama"),
    ).toEqual({ ok: false, error: NO_CATALOG_SENTENCE });
    expect(
      planTurn({ prompt: "Sleep?", modelIds: ["gone"] }, CATALOG, "openrouter"),
    ).toEqual({ ok: false, error: NOT_FREE_SENTENCE });
    expect(planTurn({ prompt: "Sleep?", modelIds: ["gone"] }, CATALOG, "ollama")).toEqual(
      {
        ok: false,
        error: NOT_OFFERED_SENTENCE,
      },
    );
  });

  test("duplicates count once; four copies of one id are one model", () => {
    const result = planTurn(
      { prompt: "Sleep?", modelIds: ["qwen3:4b", "qwen3:4b", "qwen3:4b", "qwen3:4b"] },
      CATALOG,
      "ollama",
    );
    expect(result.ok && result.plan.models).toEqual([
      { id: "qwen3:4b", name: "Qwen3 4B" },
    ]);
  });

  test("names come from the catalog, in request order; the prompt is trimmed", () => {
    const result = planTurn(
      { prompt: "  How did I sleep?  ", modelIds: ["llama3.2:3b", "qwen3:4b"] },
      CATALOG,
      "ollama",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.prompt).toBe("How did I sleep?");
    expect(result.plan.models.map((each) => each.name)).toEqual([
      "Llama 3.2 3B",
      "Qwen3 4B",
    ]);
    expect(result.plan.skill).toBeNull();
  });

  test("a label is kept only when it differs from the prompt", () => {
    const same = planTurn(
      { prompt: "Sleep?", modelIds: ["qwen3:4b"], label: " Sleep? " },
      CATALOG,
      "ollama",
    );
    expect(same.ok && same.plan.label).toBeNull();
    const short = planTurn(
      {
        prompt:
          "For synthetic subject 29bbf012, using LOINC 8867-4, how has their heart rate changed?",
        modelIds: ["qwen3:4b"],
        label: "How has their heart rate changed?",
      },
      CATALOG,
      "ollama",
    );
    expect(short.ok && short.plan.label).toBe("How has their heart rate changed?");
  });

  test("a skill turn's title reads the skill; titles stop at 80 characters", () => {
    const skill = planTurn(
      { prompt: "last week", modelIds: ["qwen3:4b"], skill: "sleep" },
      CATALOG,
      "ollama",
    );
    expect(skill.ok && skill.plan.title.startsWith("/sleep")).toBe(true);
    const long = planTurn(
      { prompt: "word ".repeat(40), modelIds: ["qwen3:4b"] },
      CATALOG,
      "ollama",
    );
    expect(long.ok && long.plan.title.length).toBeLessThanOrEqual(80);
  });
});
