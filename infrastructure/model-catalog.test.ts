import { describe, expect, test } from "bun:test";

import {
  type CatalogModel,
  defaultModelSelection,
  formatContextWindow,
  formatModelWindow,
  parseFreeModels,
} from "./model-catalog";

const row = (
  id: string,
  name: string,
  context_length: number,
  price = "0",
): Record<string, unknown> => ({
  id,
  name,
  context_length,
  pricing: { prompt: price, completion: price },
});

describe("parseFreeModels", () => {
  test("keeps only free models, splits vendor from name, widest window first", () => {
    const models = parseFreeModels({
      data: [
        row("acme/small:free", "Acme: Small (free)", 32_000),
        row("acme/paid", "Acme: Paid", 1_000_000, "0.0001"),
        row("acme/tricky:free", "Acme: Tricky (free)", 64_000, "0.0001"),
        row("bolt/big:free", "Big Model (free)", 262_144),
        { id: "broken" },
      ],
    });
    expect(models).toEqual([
      {
        id: "bolt/big:free",
        providerId: "bolt",
        contextTokens: 262_144,
        name: "Big Model",
        provider: "bolt",
      },
      {
        id: "acme/small:free",
        providerId: "acme",
        contextTokens: 32_000,
        name: "Small",
        provider: "Acme",
      },
    ]);
  });

  test("returns null for a malformed envelope", () => {
    expect(parseFreeModels({ models: [] })).toBeNull();
    expect(parseFreeModels(null)).toBeNull();
  });
});

const model = (id: string, providerId: string): CatalogModel => ({
  id,
  name: id,
  provider: providerId,
  providerId,
  contextTokens: 1,
});

describe("defaultModelSelection", () => {
  test("takes one model per vendor first", () => {
    const list = [model("a1", "a"), model("a2", "a"), model("b1", "b"), model("c1", "c")];
    expect(defaultModelSelection(list)).toEqual(["a1", "b1", "c1"]);
  });

  test("tops up from the remainder when vendors run out", () => {
    const list = [model("a1", "a"), model("a2", "a"), model("a3", "a"), model("b1", "b")];
    expect(defaultModelSelection(list)).toEqual(["a1", "b1", "a2"]);
  });
});

describe("formatContextWindow", () => {
  test("uses decimal K and M", () => {
    expect(formatContextWindow(262_144)).toBe("262K");
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(1_048_576)).toBe("1M");
    expect(formatContextWindow(2_500_000)).toBe("2.5M");
  });
});

describe("formatModelWindow", () => {
  test("says unknown instead of the placeholder window", () => {
    expect(formatModelWindow({ contextTokens: 128_000, contextUnknown: true })).toBe(
      "unknown",
    );
    expect(formatModelWindow({ contextTokens: 128_000 })).toBe("128K");
  });
});
