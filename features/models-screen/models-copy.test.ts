import { describe, expect, test } from "bun:test";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import {
  costSentence,
  defaultsSentence,
  modelsOrder,
  orderLead,
  summaryParts,
  tableCaption,
  widestWindow,
  windowShare,
} from "./models-copy";

const model = (
  id: string,
  providerId: string,
  contextTokens: number,
  unknown = false,
): CatalogModel => ({
  id,
  name: id,
  provider: providerId,
  providerId,
  contextTokens,
  ...(unknown ? { contextUnknown: true as const } : {}),
});

const QWEN = model("qwen3:8b", "qwen", 40_960);
const LLAMA = model("llama3.2", "meta", 128_000);
const QWEN_SMALL = model("qwen3:4b", "qwen", 32_768);
const MYSTERY = model("mystery", "acme", 4_096, true);

describe("order", () => {
  test("follows whether rows report a window", () => {
    expect(modelsOrder([LLAMA, QWEN])).toBe("window");
    expect(modelsOrder([LLAMA, MYSTERY])).toBe("window-then-unknown");
    expect(modelsOrder([MYSTERY])).toBe("provider");
  });

  test("the lead and the caption say the same order", () => {
    expect(orderLead("window")).toBe(
      "Every model the active provider can reach, largest context window first.",
    );
    expect(tableCaption("provider")).toBe(
      "Models available in TwinLLM, in the order the provider lists them.",
    );
  });
});

describe("costSentence", () => {
  test("by provider; none for Infomaniak", () => {
    expect(costSentence("ollama")).toBe("Every call to a listed model is free.");
    expect(costSentence("openrouter")).toBe("Every call to a listed model is free.");
    expect(costSentence("remote-gpu")).toBe(
      "Calls carry no charge of their own, but the GPU pod is billed by the hour while it runs.",
    );
    expect(costSentence("exoscale")).toBe(
      "Calls carry no charge of their own, but the Exoscale GPU instance is billed by the hour while it runs.",
    );
    expect(costSentence("infomaniak")).toBeNull();
  });
});

describe("defaultsSentence", () => {
  const models = [LLAMA, QWEN, QWEN_SMALL, MYSTERY];

  test("counts the actual picks", () => {
    expect(defaultsSentence(models, [])).toBeNull();
    expect(defaultsSentence(models, ["llama3.2"])).toBe(
      "The model marked default opens a new round.",
    );
    expect(defaultsSentence(models, ["llama3.2", "qwen3:8b"])).toBe(
      "The two marked default are the widest window from each of two vendors.",
    );
    expect(defaultsSentence(models, ["qwen3:8b", "qwen3:4b"])).toBe(
      "The two marked default are the first two on the list.",
    );
    expect(defaultsSentence(models, ["llama3.2", "qwen3:8b", "qwen3:4b"])).toBe(
      "The three marked default are the top model from each of two vendors, then the next on the list.",
    );
  });
});

describe("summary and bars", () => {
  test("the widest window ignores rows that report none", () => {
    expect(widestWindow([QWEN, MYSTERY, LLAMA])).toBe(128_000);
    expect(widestWindow([MYSTERY])).toBeNull();
  });

  test("summary parts: count, widest window, cost when known", () => {
    expect(summaryParts([LLAMA, QWEN], "ollama")).toEqual([
      "2 models",
      "128K widest window",
      "$0.0000 each",
    ]);
    expect(summaryParts([MYSTERY], "exoscale")).toEqual(["1 model"]);
  });

  test("a bar is the window as a share of the widest", () => {
    expect(windowShare(64_000, 128_000)).toBe(50);
    expect(windowShare(40_960, 128_000)).toBe(32);
    expect(windowShare(1, null)).toBe(0);
  });
});
