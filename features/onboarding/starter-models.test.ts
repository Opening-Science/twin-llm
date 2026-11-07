import { describe, expect, test } from "bun:test";

import { type CatalogModel, withAgents } from "@/infrastructure/model-catalog";

import { starterModels } from "./starter-models";

const ollama = (id: string): CatalogModel => ({
  id,
  name: id,
  provider: "Ollama",
  providerId: "ollama",
  contextTokens: 16_384,
});

const CATALOG = withAgents([ollama("qwen3:8b"), ollama("llama3.2")], {
  provider: "ollama",
  chatIsLocal: true,
  skills: ["nutrition", "anatomy", "sleep", "trainer", "rhythm", "brain"].map((name) => ({
    name,
    providers: ["ollama" as const],
    sources: [],
    tools: [],
  })),
});

describe("starterModels (#493)", () => {
  test("the sleep question starts with General and Sleep", () => {
    expect(
      starterModels(CATALOG, "How does resting heart rate change during sleep?").map(
        ({ id }) => id,
      ),
    ).toEqual(["agent:gp", "agent:sleep", "agent:trainer"]);
  });

  test("a question no specialist matches keeps the usual defaults", () => {
    expect(starterModels(CATALOG, "What is in my record?").map(({ id }) => id)).toEqual([
      "agent:gp",
      "agent:diet",
      "agent:anatomy",
    ]);
  });

  test("each row carries the catalog's name; a catalog without agents gets models", () => {
    expect(
      starterModels([ollama("qwen3:8b"), ollama("llama3.2")], "How did I sleep?"),
    ).toEqual([
      { id: "qwen3:8b", name: "qwen3:8b" },
      { id: "llama3.2", name: "llama3.2" },
    ]);
  });
});
