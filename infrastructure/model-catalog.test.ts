import { describe, expect, test } from "bun:test";

import {
  agentBaseModel,
  type CatalogModel,
  catalogAgentOf,
  defaultModelSelection,
  formatContextWindow,
  formatModelWindow,
  parseFreeModels,
  withAgents,
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

describe("agents in the catalog (#218)", () => {
  const ollama = (id: string, contextTokens = 16_384): CatalogModel => ({
    id,
    name: id,
    provider: "Ollama",
    providerId: "ollama",
    contextTokens,
  });

  test("agentBaseModel takes the first preference offered, else the first model", () => {
    const catalog = [ollama("llama3.2"), ollama("qwen3:4b"), ollama("qwen3:8b")];
    expect(agentBaseModel(["qwen3:8b", "qwen3:4b"], catalog)?.id).toBe("qwen3:8b");
    expect(agentBaseModel(["qwen3:14b", "qwen3:4b"], catalog)?.id).toBe("qwen3:4b");
    expect(agentBaseModel(["qwen3:14b"], catalog)?.id).toBe("llama3.2");
    expect(agentBaseModel(["qwen3:8b"], [])).toBeNull();
  });

  test("withAgents puts the agents first, with their base model's provider and window", () => {
    const catalog = [ollama("llama3.2", 128_000), ollama("qwen3:4b")];
    const rows = withAgents(catalog, { chatIsLocal: true });
    expect(
      rows.map(({ id, name, providerId, contextTokens }) => ({
        id,
        name,
        providerId,
        contextTokens,
      })),
    ).toEqual([
      {
        id: "agent:gp",
        name: "General Practitioner",
        providerId: "ollama",
        contextTokens: 16_384,
      },
      { id: "agent:sleep", name: "Sleep", providerId: "ollama", contextTokens: 16_384 },
      {
        id: "agent:trainer",
        name: "Trainer",
        providerId: "ollama",
        contextTokens: 16_384,
      },
      {
        id: "agent:genetics",
        name: "Genetics",
        providerId: "ollama",
        contextTokens: 16_384,
      },
      { id: "llama3.2", name: "llama3.2", providerId: "ollama", contextTokens: 128_000 },
      { id: "qwen3:4b", name: "qwen3:4b", providerId: "ollama", contextTokens: 16_384 },
    ]);
    expect(rows[1]?.agent).toEqual({
      id: "sleep",
      name: "Sleep",
      role: "Describes sleep against the person's own recent nights.",
      skill: "sleep",
      baseModelId: "qwen3:4b",
      baseModelName: "qwen3:4b",
    });
  });

  test("a hosted catalog gets no Genetics, and an agent copies an unknown window as unknown", () => {
    const hosted: CatalogModel = {
      id: "swiss-ai/Apertus-8B-Instruct-2509",
      name: "swiss-ai/Apertus-8B-Instruct-2509",
      provider: "Exoscale (Switzerland)",
      providerId: "exoscale",
      contextTokens: 128_000,
      contextUnknown: true,
    };
    const rows = withAgents([hosted], { chatIsLocal: false });
    expect(rows.map(({ id }) => id)).toEqual([
      "agent:gp",
      "agent:sleep",
      "agent:trainer",
      "swiss-ai/Apertus-8B-Instruct-2509",
    ]);
    expect(rows[0]?.contextUnknown).toBe(true);
    expect(rows[0]?.agent?.baseModelId).toBe("swiss-ai/Apertus-8B-Instruct-2509");
  });

  test("no model, no agents", () => {
    expect(withAgents([], { chatIsLocal: true })).toEqual([]);
  });

  test("applying it twice gives the same rows", () => {
    const once = withAgents([ollama("qwen3:8b")], { chatIsLocal: true });
    expect(withAgents(once, { chatIsLocal: true })).toEqual(once);
  });

  test("catalogAgentOf finds an agent row and gives null for a plain model", () => {
    const rows = withAgents([ollama("qwen3:8b")], { chatIsLocal: false });
    expect(catalogAgentOf("agent:gp", rows)?.baseModelId).toBe("qwen3:8b");
    expect(catalogAgentOf("qwen3:8b", rows)).toBeNull();
    expect(catalogAgentOf("agent:genetics", rows)).toBeNull();
  });

  test("defaultModelSelection never picks an agent", () => {
    const rows = withAgents([ollama("qwen3:8b"), ollama("llama3.2")], {
      chatIsLocal: true,
    });
    expect(defaultModelSelection(rows)).toEqual(["qwen3:8b", "llama3.2"]);
  });
});
