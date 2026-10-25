import { describe, expect, test } from "bun:test";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import { chosenModels, missingCount, toggleLimit, toggleModel } from "./model-selection";

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
