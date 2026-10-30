import { describe, expect, test } from "bun:test";

import { AGENTS } from "../../infrastructure/agents";
import { type CatalogModel, withAgents } from "../../infrastructure/model-catalog";
import type { TurnSkill } from "../../infrastructure/skill-gate";

import {
  agentRulesSha256,
  isAgentProblem,
  normalizeAgentSpec,
  resolveEvalAgent,
  rosterSha256,
} from "./eval-agent";

const BRAIN: TurnSkill = {
  name: "brain",
  description: "Stroke, cognition and autonomic records.",
  tools: ["conditions_timeline", "knowledge_search"],
  sources: ["cohort-records", "opentwin-knowledge"],
  providers: ["ollama"],
  views: [],
  instructions: "Describe the records; never say what condition a person has.",
};

const MODELS: CatalogModel[] = [
  {
    id: "llama3:8b",
    name: "Llama",
    provider: "Ollama",
    providerId: "ollama",
    contextTokens: 8192,
  },
  {
    id: "qwen3:4b",
    name: "Qwen3 4B",
    provider: "Ollama",
    providerId: "ollama",
    contextTokens: 32_768,
  },
];

const catalog = withAgents(MODELS, {
  provider: "ollama",
  chatIsLocal: true,
  skills: [BRAIN],
});
const findSkill = (name: string) => (name === BRAIN.name ? BRAIN : null);

describe("normalizeAgentSpec", () => {
  test("puts agent:<id> on the configured provider and leaves models alone", () => {
    expect(
      normalizeAgentSpec({ provider: "agent", modelId: "gp" }, "remote-gpu"),
    ).toEqual({
      provider: "remote-gpu",
      modelId: "agent:gp",
    });
    expect(
      normalizeAgentSpec({ provider: "ollama", modelId: "agent:gp" }, "ollama"),
    ).toEqual({
      provider: "ollama",
      modelId: "agent:gp",
    });
    expect(
      normalizeAgentSpec({ provider: "ollama", modelId: "qwen3:8b" }, "ollama"),
    ).toEqual({
      provider: "ollama",
      modelId: "qwen3:8b",
    });
  });
});

describe("resolveEvalAgent", () => {
  test("takes the base model from the agent's preference, as the catalog does", () => {
    const resolved = resolveEvalAgent("agent:brain", catalog, findSkill);
    if (isAgentProblem(resolved)) throw new Error(resolved.message);
    expect(resolved.agent).toMatchObject({
      id: "brain",
      name: "Brain (research)",
      skill: "brain",
      baseModelId: "qwen3:4b",
    });
    expect(resolved.skill).toBe(BRAIN);
    expect(resolved.rulesSha256).toBe(agentRulesSha256("agent:brain", BRAIN));
    expect(resolved.rosterSha256).toBe(rosterSha256());
  });

  test("the General agent has no skill", () => {
    const resolved = resolveEvalAgent("agent:gp", catalog, () => null);
    expect(isAgentProblem(resolved) ? null : resolved.skill).toBeNull();
  });

  test("an agent whose skill is not offered here has no catalog row", () => {
    expect(resolveEvalAgent("agent:sleep", catalog, findSkill)).toEqual({
      code: "AGENT_NOT_OFFERED",
      message: "the chat catalog does not offer agent:sleep with this provider",
    });
  });
});

describe("rules and roster versions", () => {
  test("change with the skill's instructions and with the roster", () => {
    const edited = { ...BRAIN, instructions: `${BRAIN.instructions} Shorter.` };
    expect(agentRulesSha256("agent:brain", edited)).not.toBe(
      agentRulesSha256("agent:brain", BRAIN),
    );
    expect(agentRulesSha256("agent:gp", null)).not.toBe(
      agentRulesSha256("agent:brain", null),
    );
    expect(rosterSha256()).toMatch(/^[0-9a-f]{64}$/);
    expect(AGENTS.length).toBeGreaterThan(0);
  });
});
