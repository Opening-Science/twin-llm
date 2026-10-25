import { describe, expect, test } from "bun:test";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import { catalogOrder, defaultsCopy } from "./defaults-copy";

// Synthetic catalog rows, not a live provider list.
const model = (id: string, providerId: string, contextTokens: number): CatalogModel => ({
  id,
  name: id,
  provider: providerId,
  providerId,
  contextTokens,
});

const ollama = [
  model("qwen3:30b", "ollama", 262_144),
  model("qwen3:8b", "ollama", 40960),
];

describe("defaultsCopy", () => {
  test("counts the marked picks, not the maximum", () => {
    expect(defaultsCopy(ollama, ["qwen3:30b", "qwen3:8b"])).toBe(
      "The 2 marked default open a new round: the first 2 on the list.",
    );
  });

  test("names vendors only when every pick has its own", () => {
    const mixed = [
      model("a", "nvidia", 1_000_000),
      model("b", "qwen", 262_144),
      model("c", "meta", 131_072),
    ];
    expect(defaultsCopy(mixed, ["a", "b", "c"])).toBe(
      "The 3 marked default open a new round: the widest window from each of 3 different vendors.",
    );
  });

  test("two vendors for three picks says so", () => {
    const two = [
      model("a", "nvidia", 1_000_000),
      model("b", "nvidia", 262_144),
      model("c", "qwen", 131_072),
    ];
    expect(defaultsCopy(two, ["a", "c", "b"])).toBe(
      "The 3 marked default open a new round: the top model from each of 2 vendors, then the next on the list.",
    );
  });

  test("one pick and no picks", () => {
    expect(defaultsCopy(ollama, ["qwen3:8b"])).toBe(
      "The model marked default opens a new round.",
    );
    expect(defaultsCopy(ollama, [])).toBe("");
  });
});

describe("catalogOrder", () => {
  const unknown = {
    ...model("llama3.2", "ollama", 128_000),
    contextUnknown: true as const,
  };

  test("claims window order only as far as windows were reported", () => {
    expect(catalogOrder(ollama)).toBe("window");
    expect(catalogOrder([...ollama, unknown])).toBe("mixed");
    expect(catalogOrder([unknown])).toBe("server");
    expect(catalogOrder([])).toBe("server");
  });
});
