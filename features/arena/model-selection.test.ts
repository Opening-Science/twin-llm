import { describe, expect, test } from "bun:test";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import {
  chosenModels,
  incognitoHint,
  AUTO_SUBLINE,
  menuGroups,
  menuSubline,
  missingCount,
  offeredModels,
  toggleLimit,
  toggleModel,
} from "./model-selection";

const model = (id: string): CatalogModel => ({
  id,
  name: id,
  provider: "Ollama",
  providerId: "ollama",
  contextTokens: 8_192,
});

const catalog = ["a", "b", "c", "d"].map(model);

describe("model selection", () => {
  test("keeps catalog order and ignores ids the catalog lost", () => {
    expect(chosenModels(catalog, ["c", "gone", "a"]).map((m) => m.id)).toEqual([
      "a",
      "c",
    ]);
    expect(missingCount(catalog, ["c", "gone", "older"])).toBe(2);
    expect(missingCount(null, ["c"])).toBe(0);
  });

  test("adds and removes within one to three", () => {
    expect(toggleModel(catalog, ["a"], "b")).toEqual(["a", "b"]);
    expect(toggleModel(catalog, ["a", "b"], "a")).toEqual(["b"]);
    expect(toggleModel(catalog, ["a"], "a")).toEqual(["a"]);
    expect(toggleModel(catalog, ["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
    expect(toggleModel(catalog, ["gone", "a"], "b")).toEqual(["a", "b"]);
  });

  test("names the limit that blocks a switch", () => {
    expect(toggleLimit(true, 1)).toBe("floor");
    expect(toggleLimit(false, 3)).toBe("cap");
    expect(toggleLimit(true, 2)).toBeNull();
    expect(toggleLimit(false, 2)).toBeNull();
  });
});

describe("models offered in an incognito chat", () => {
  test("only local models are offered; a normal chat offers the whole catalog", () => {
    expect(offeredModels(catalog, true, ["b", "d"]).map((m) => m.id)).toEqual(["b", "d"]);
    expect(offeredModels(catalog, false, []).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("the hint says when no local model is offered", () => {
    expect(incognitoHint(0)).toBe(
      "No model on this machine is offered, so an incognito chat has nowhere to go. Turn incognito off to use the others.",
    );
    expect(incognitoHint(2)).toBe(
      "Local models only. Nothing in this chat is saved; a reload or a new chat discards it.",
    );
  });
});

describe("menuGroups", () => {
  const agent = (id: string, name: string): CatalogModel => ({
    ...model("qwen3:8b"),
    id: `agent:${id}`,
    name,
    agent: {
      id,
      name,
      role: "Describes sleep.",
      skill: null,
      baseModelId: "qwen3:8b",
      baseModelName: "qwen3:8b",
    },
  });

  test("agents first under their heading, then models", () => {
    const catalog = [model("qwen3:8b"), agent("gp", "General"), model("x")];
    expect(
      menuGroups(catalog).map(({ label, models }) => [label, models.map(({ id }) => id)]),
    ).toEqual([
      ["Agents", ["agent:gp"]],
      ["Models", ["qwen3:8b", "x"]],
    ]);
  });

  test("an empty section is left out", () => {
    expect(menuGroups([model("x")]).map(({ label }) => label)).toEqual(["Models"]);
    expect(menuGroups([])).toEqual([]);
  });
});

describe("menuSubline", () => {
  const agent = {
    id: "gp",
    name: "General",
    role: "",
    skill: null,
    baseModelId: "twinllm-qwen3-4b-pilot",
    baseModelName: "TwinLLM 4B (pilot)",
  };

  test("Auto, an agent, a fine-tune and a plain model", () => {
    expect(menuSubline({ id: "agent:auto", provider: "Ollama", agent })).toBe(
      AUTO_SUBLINE,
    );
    expect(menuSubline({ id: "agent:gp", provider: "Ollama", agent })).toBe(
      "TwinLLM 4B (pilot)",
    );
    expect(menuSubline({ id: "twinllm-qwen3-4b-base", provider: "Ollama" })).toBe(
      "twinllm-qwen3-4b-base",
    );
    expect(menuSubline({ id: "qwen3:8b", provider: "Ollama" })).toBe("Ollama");
  });
});
