import { describe, expect, test } from "bun:test";

import {
  AUTO_MODEL_ID,
  type CatalogModel,
  catalogAgentOf,
  findCatalogRow,
  modelCanThink,
  pairedModelId,
  pairedModelName,
  parsePairedModelId,
  turnAgentOf,
  turnModelName,
  withAgents,
} from "./model-catalog";

/**
 * Manual mode (#366): a specialist paired with a model the person picked, as
 * a row id the catalog does not list. Synthetic catalog rows only.
 */

const SKILLS = [
  { name: "sleep", providers: ["ollama"], sources: [], tools: ["sleep_summary"] },
] as const;
const LOCAL = { provider: "ollama", chatIsLocal: true, skills: SKILLS } as const;

const ollama = (id: string, thinking = false): CatalogModel => ({
  id,
  name: id,
  provider: "Ollama",
  providerId: "ollama",
  contextTokens: 16_384,
  ...(thinking ? { thinking: true } : {}),
});

const CATALOG = withAgents([ollama("qwen3:4b", true), ollama("llama3.2")], LOCAL);

describe("paired ids", () => {
  test("round-trip, with a model id that has its own colons", () => {
    expect(pairedModelId("sleep", "qwen3:4b")).toBe("agent:sleep@qwen3:4b");
    expect(parsePairedModelId("agent:sleep@qwen3:4b")).toEqual({
      agentId: "sleep",
      modelId: "qwen3:4b",
    });
  });

  test("anything else is not a pair", () => {
    expect(
      ["agent:sleep", "qwen3:4b", "agent:@qwen3:4b", "agent:sleep@", "x@y"].map(
        parsePairedModelId,
      ),
    ).toEqual([null, null, null, null, null]);
  });
});

describe("findCatalogRow", () => {
  test("a listed row is returned as it is", () => {
    expect(findCatalogRow("llama3.2", CATALOG)).toEqual(ollama("llama3.2"));
  });

  test("a specialist on another model gets that model's provider, window and name", () => {
    const row = findCatalogRow("agent:sleep@llama3.2", CATALOG);
    expect(row).toEqual({
      ...ollama("llama3.2"),
      id: "agent:sleep@llama3.2",
      name: pairedModelName("Sleep", "llama3.2"),
      agent: {
        id: "sleep",
        name: "Sleep",
        role: "Describes sleep against the person's own recent nights.",
        skill: "sleep",
        baseModelId: "llama3.2",
        baseModelName: "llama3.2",
      },
    });
    expect(row?.name).toBe("Sleep · llama3.2");
  });

  test("a pair is offered only when both halves are; Auto and agents are no base", () => {
    expect(
      [
        "agent:sleep@qwen3:14b",
        "agent:trainer@qwen3:4b",
        "agent:auto@qwen3:4b",
        "agent:sleep@agent:gp",
      ].map((id) => findCatalogRow(id, CATALOG)),
    ).toEqual([null, null, null, null]);
  });
});

describe("a paired row through the turn helpers", () => {
  test("the turn runs as the specialist on the picked model", () => {
    expect(catalogAgentOf("agent:gp@llama3.2", CATALOG)?.baseModelId).toBe("llama3.2");
    expect(turnAgentOf("agent:gp@llama3.2", CATALOG, "How did I sleep?")?.id).toBe("gp");
  });

  test("its column is named after both", () => {
    expect(
      turnModelName({ id: "agent:gp@llama3.2", name: "ignored" }, CATALOG, "Hello"),
    ).toBe("General · llama3.2");
    expect(
      turnModelName({ id: AUTO_MODEL_ID, name: "Auto" }, CATALOG, "How did I sleep?"),
    ).toBe("Auto → Sleep");
  });
});

describe("modelCanThink", () => {
  test("only a model Ollama lists with the thinking capability", () => {
    expect(
      ["qwen3:4b", "llama3.2", "agent:gp", "missing"].map((id) =>
        modelCanThink(id, CATALOG),
      ),
    ).toEqual([true, false, true, false]);
  });
});
