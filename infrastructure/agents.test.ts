import { describe, expect, test } from "bun:test";

import {
  AGENTS,
  agentIsOffered,
  agentModelId,
  findAgent,
  isAgentModelId,
} from "./agents";

describe("AGENTS", () => {
  test("the four agents, in picker order, with their skills", () => {
    expect(AGENTS.map(({ id, name, skill }) => ({ id, name, skill }))).toEqual([
      { id: "gp", name: "General Practitioner", skill: null },
      { id: "sleep", name: "Sleep", skill: "sleep" },
      { id: "trainer", name: "Trainer", skill: "trainer" },
      { id: "genetics", name: "Genetics", skill: "genome" },
    ]);
  });

  test("each role is one sentence", () => {
    expect(
      AGENTS.map(({ role }) => role.endsWith(".") && role.split(". ").length === 1),
    ).toEqual([true, true, true, true]);
  });
});

describe("agent model ids", () => {
  test("an agent's row id is agent:<id>", () => {
    expect(AGENTS.map(agentModelId)).toEqual([
      "agent:gp",
      "agent:sleep",
      "agent:trainer",
      "agent:genetics",
    ]);
  });

  test("only the prefix marks an agent id", () => {
    expect(["agent:gp", "agent:", "qwen3:8b", "gp"].map(isAgentModelId)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  test("findAgent knows the four and nothing else", () => {
    expect(findAgent("agent:trainer")?.name).toBe("Trainer");
    expect(findAgent("agent:oncology")).toBeNull();
    expect(findAgent("gp")).toBeNull();
    expect(findAgent("qwen3:8b")).toBeNull();
  });
});

describe("agentIsOffered", () => {
  const skill = (name: string, tools: readonly string[]) => ({
    name,
    providers: ["ollama"] as const,
    sources: ["wearable-context"],
    tools,
  });
  const SKILLS = [
    skill("sleep", ["sleep_summary"]),
    skill("trainer", ["hrv_trend"]),
    skill("genome", ["genome_report", "dna_ask"]),
  ];
  const offered = (offer: Parameters<typeof agentIsOffered>[1]) =>
    AGENTS.filter((agent) => agentIsOffered(agent, offer)).map(({ id }) => id);

  test("local Ollama: all four", () => {
    expect(offered({ provider: "ollama", chatIsLocal: true, skills: SKILLS })).toEqual([
      "gp",
      "sleep",
      "trainer",
      "genetics",
    ]);
  });

  test("Ollama on another machine: the genome skill needs a local model", () => {
    expect(offered({ provider: "ollama", chatIsLocal: false, skills: SKILLS })).toEqual([
      "gp",
      "sleep",
      "trainer",
    ]);
  });

  test("a hosted provider the skills do not list: only the General Practitioner", () => {
    expect(offered({ provider: "exoscale", chatIsLocal: false, skills: SKILLS })).toEqual(
      ["gp"],
    );
    expect(
      offered({ provider: "openrouter", chatIsLocal: false, skills: SKILLS }),
    ).toEqual(["gp"]);
  });

  test("a skill that lists the hosted provider makes its agent offered there", () => {
    const sleepOnExoscale = {
      ...skill("sleep", ["sleep_summary"]),
      providers: ["ollama", "exoscale"] as const,
    };
    expect(
      offered({ provider: "exoscale", chatIsLocal: false, skills: [sleepOnExoscale] }),
    ).toEqual(["gp", "sleep"]);
  });

  test("a skill the server does not offer leaves its agent out", () => {
    expect(offered({ provider: "ollama", chatIsLocal: true, skills: [] })).toEqual([
      "gp",
    ]);
  });
});
