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
  test("Genetics only with a local chat model; the others always", () => {
    expect(AGENTS.map((agent) => agentIsOffered(agent, { chatIsLocal: false }))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(AGENTS.map((agent) => agentIsOffered(agent, { chatIsLocal: true }))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});
