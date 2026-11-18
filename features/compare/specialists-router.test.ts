import { describe, expect, test } from "bun:test";

import { HAND_WRITTEN_ITEMS, QUESTION_ITEMS } from "@/features/agents/router-fixtures";
import { routeAgent } from "@/infrastructure/agent-router";
import { AGENTS } from "@/infrastructure/agents";
import type { CatalogModel } from "@/infrastructure/model-catalog";

import { type ModeContext, specialistDefaults } from "./chat-modes";

/**
 * The Specialists mode's default measured on the router fixtures (#610):
 * one specialist, the one Auto would pick, so it is right exactly as often
 * as Auto. Every agent offered, as on local Ollama. Committed fixtures
 * only; no person's data.
 */

const BASE: CatalogModel = {
  id: "qwen3:8b",
  name: "Qwen3 8B",
  provider: "Ollama",
  providerId: "ollama",
  contextTokens: 32_000,
};

const CONTEXT: ModeContext = {
  catalog: [
    ...AGENTS.map((agent): CatalogModel => ({
      ...BASE,
      id: `agent:${agent.id}`,
      name: agent.name,
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        skill: agent.skill,
        baseModelId: BASE.id,
        baseModelName: BASE.name,
      },
    })),
    BASE,
  ],
  incognito: false,
  localModelIds: [],
};

const AGENT_IDS = AGENTS.map(({ id }) => id);

describe.each([
  ["hand-written prompts", HAND_WRITTEN_ITEMS, 36],
  ["scored questions", QUESTION_ITEMS, 126],
])("the Specialists default on the %s", (_name, items, right) => {
  test("is one specialist, Auto's pick, for every item", () => {
    expect(items.length).toBeGreaterThan(0);
    items.forEach(({ prompt }) => {
      expect(specialistDefaults(CONTEXT, prompt)).toEqual([
        `agent:${routeAgent(prompt, AGENT_IDS).agentId}`,
      ]);
    });
  });

  test("names the labelled agent as often as Auto does", () => {
    const covered = items.filter(({ prompt, expected }) =>
      specialistDefaults(CONTEXT, prompt).includes(`agent:${expected}`),
    );
    expect(covered.length).toBe(right);
  });
});
