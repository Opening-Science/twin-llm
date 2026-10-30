import { describe, expect, test } from "bun:test";

import { AUTO_AGENT } from "./agents";
import {
  agentBaseModel,
  type CatalogAgent,
  type CatalogModel,
  catalogAgentOf,
  defaultModelSelection,
  formatContextWindow,
  formatModelWindow,
  parseFreeModels,
  turnAgentOf,
  turnModelName,
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
  const SKILLS = [
    { name: "sleep", providers: ["ollama"], sources: [], tools: ["sleep_summary"] },
    { name: "trainer", providers: ["ollama"], sources: [], tools: ["hrv_trend"] },
    { name: "genome", providers: ["ollama"], sources: [], tools: ["dna_ask"] },
  ] as const;
  const LOCAL = { provider: "ollama", chatIsLocal: true, skills: SKILLS } as const;
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
    const rows = withAgents(catalog, LOCAL);
    expect(
      rows.map(({ id, name, providerId, contextTokens }) => ({
        id,
        name,
        providerId,
        contextTokens,
      })),
    ).toEqual([
      { id: "agent:auto", name: "Auto", providerId: "ollama", contextTokens: 16_384 },
      {
        id: "agent:gp",
        name: "General",
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
    expect(rows[2]?.agent).toEqual({
      id: "sleep",
      name: "Sleep",
      role: "Describes sleep against the person's own recent nights.",
      skill: "sleep",
      baseModelId: "qwen3:4b",
      baseModelName: "qwen3:4b",
    });
  });

  test("a hosted catalog gets only the agents whose skill runs there; a window stays unknown", () => {
    const hosted: CatalogModel = {
      id: "swiss-ai/Apertus-8B-Instruct-2509",
      name: "swiss-ai/Apertus-8B-Instruct-2509",
      provider: "Exoscale (Switzerland)",
      providerId: "exoscale",
      contextTokens: 128_000,
      contextUnknown: true,
    };
    const rows = withAgents([hosted], {
      provider: "exoscale",
      chatIsLocal: false,
      skills: SKILLS,
    });
    expect(rows.map(({ id }) => id)).toEqual([
      "agent:auto",
      "agent:gp",
      "swiss-ai/Apertus-8B-Instruct-2509",
    ]);
    expect(rows[0]?.contextUnknown).toBe(true);
    expect(rows[0]?.agent?.baseModelId).toBe("swiss-ai/Apertus-8B-Instruct-2509");
  });

  test("no model, no agents", () => {
    expect(withAgents([], LOCAL)).toEqual([]);
  });

  test("applying it twice gives the same rows", () => {
    const once = withAgents([ollama("qwen3:8b")], LOCAL);
    expect(withAgents(once, LOCAL)).toEqual(once);
  });

  test("catalogAgentOf finds an agent row and gives null for a plain model", () => {
    const rows = withAgents([ollama("qwen3:8b")], { ...LOCAL, chatIsLocal: false });
    expect(catalogAgentOf("agent:gp", rows)?.baseModelId).toBe("qwen3:8b");
    expect(catalogAgentOf("qwen3:8b", rows)).toBeNull();
    expect(catalogAgentOf("agent:genetics", rows)).toBeNull();
  });

  test("Auto heads the agents, runs on the General agent's base and has no skill", () => {
    const rows = withAgents([ollama("qwen3:8b")], LOCAL);
    expect(rows[0]?.agent).toEqual({
      id: "auto",
      name: "Auto",
      role: AUTO_AGENT.role,
      skill: null,
      baseModelId: "qwen3:8b",
      baseModelName: "qwen3:8b",
    });
  });

  test("turnAgentOf: Auto runs as the agent the router picks, marked via auto", () => {
    const rows = withAgents([ollama("qwen3:8b")], LOCAL);
    expect(turnAgentOf("agent:auto", rows, "How did I sleep last night?")).toEqual({
      ...catalogAgentOf("agent:sleep", rows),
      via: "auto",
    } as CatalogAgent);
    expect(turnAgentOf("agent:auto", rows, "Summarise my record.")?.id).toBe("gp");
    expect(turnAgentOf("agent:trainer", rows, "How did I sleep?")?.id).toBe("trainer");
    expect(turnAgentOf("qwen3:8b", rows, "How did I sleep?")).toBeNull();
  });

  test("turnAgentOf: a stored column name wins while its agent is offered", () => {
    const rows = withAgents([ollama("qwen3:8b")], LOCAL);
    expect(
      turnAgentOf("agent:auto", rows, "How did I sleep?", "Auto → Trainer")?.id,
    ).toBe("trainer");
    expect(
      turnAgentOf("agent:auto", rows, "How did I sleep?", "Auto → Diet specialist")?.id,
    ).toBe("sleep");
  });

  test("Auto never picks an agent the catalog does not offer", () => {
    const hosted = withAgents([ollama("qwen3:8b")], { ...LOCAL, provider: "exoscale" });
    expect(turnAgentOf("agent:auto", hosted, "How did I sleep?")?.id).toBe("gp");
  });

  test("turnModelName names Auto after its pick and leaves other rows alone", () => {
    const rows = withAgents([ollama("qwen3:8b")], LOCAL);
    expect(turnModelName({ id: "agent:auto", name: "Auto" }, rows, "My HRV?")).toBe(
      "Auto → Trainer",
    );
    expect(turnModelName({ id: "agent:auto", name: "Auto" }, [], "My HRV?")).toBe("Auto");
    expect(turnModelName({ id: "qwen3:8b", name: "qwen3:8b" }, rows, "My HRV?")).toBe(
      "qwen3:8b",
    );
  });

  test("defaultModelSelection: General, Diet and Anatomy where all three are offered", () => {
    const skills = [
      ...SKILLS,
      { name: "nutrition", providers: ["ollama"], sources: [], tools: [] },
      { name: "anatomy", providers: ["ollama"], sources: [], tools: [] },
    ];
    const rows = withAgents([ollama("qwen3:8b"), ollama("llama3.2")], {
      ...LOCAL,
      skills,
    });
    expect(defaultModelSelection(rows)).toEqual([
      "agent:gp",
      "agent:diet",
      "agent:anatomy",
    ]);
  });

  test("defaultModelSelection: an offered default agent first, then the usual models", () => {
    const local = withAgents([ollama("qwen3:8b"), ollama("llama3.2")], LOCAL);
    expect(defaultModelSelection(local)).toEqual(["agent:gp", "qwen3:8b", "llama3.2"]);
    const hosted = withAgents([ollama("qwen3:8b"), ollama("llama3.2")], {
      ...LOCAL,
      provider: "exoscale",
    });
    expect(defaultModelSelection(hosted)).toEqual(["agent:gp", "qwen3:8b", "llama3.2"]);
  });

  test("defaultModelSelection: a catalog without agents gets models only", () => {
    expect(defaultModelSelection([ollama("qwen3:8b"), ollama("llama3.2")])).toEqual([
      "qwen3:8b",
      "llama3.2",
    ]);
  });
});
