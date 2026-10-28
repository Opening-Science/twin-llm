import { describe, expect, test } from "bun:test";

import {
  AGENTS,
  agentIsOffered,
  agentModelId,
  AUTO_AGENT,
  findAgent,
  isAgentModelId,
} from "./agents";

describe("AGENTS", () => {
  test("the six agents, in picker order, with their skills", () => {
    expect(AGENTS.map(({ id, name, skill }) => ({ id, name, skill }))).toEqual([
      { id: "gp", name: "General Practitioner", skill: null },
      { id: "diet", name: "Diet specialist", skill: "nutrition" },
      { id: "anatomy", name: "Anatomy specialist", skill: "anatomy" },
      { id: "sleep", name: "Sleep", skill: "sleep" },
      { id: "trainer", name: "Trainer", skill: "trainer" },
      { id: "genetics", name: "Genetics", skill: "genome" },
    ]);
  });

  test("each role is one sentence, Auto's too", () => {
    [...AGENTS, AUTO_AGENT].forEach(({ role }) => {
      expect(role.endsWith(".")).toBe(true);
      expect(role.split(". ")).toHaveLength(1);
    });
  });

  test("Auto is not an agent of its own and has the row id agent:auto", () => {
    expect(AGENTS.map(({ id }) => id)).not.toContain(AUTO_AGENT.id);
    expect(agentModelId(AUTO_AGENT)).toBe("agent:auto");
    expect(findAgent("agent:auto")).toBeNull();
  });
});

describe("agent model ids", () => {
  test("an agent's row id is agent:<id>", () => {
    expect(AGENTS.map(agentModelId)).toEqual([
      "agent:gp",
      "agent:diet",
      "agent:anatomy",
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

  test("the Diet and Anatomy specialists are offered where their skills run", () => {
    const withNew = [
      ...SKILLS,
      skill("nutrition", ["latest_by_loinc"]),
      skill("anatomy", ["knowledge_search"]),
    ];
    expect(offered({ provider: "ollama", chatIsLocal: true, skills: withNew })).toEqual([
      "gp",
      "diet",
      "anatomy",
      "sleep",
      "trainer",
      "genetics",
    ]);
    expect(
      offered({ provider: "exoscale", chatIsLocal: false, skills: withNew }),
    ).toEqual(["gp"]);
  });

  test("a skill the server does not offer leaves its agent out", () => {
    expect(offered({ provider: "ollama", chatIsLocal: true, skills: [] })).toEqual([
      "gp",
    ]);
  });
});
