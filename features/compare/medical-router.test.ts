import { describe, expect, test } from "bun:test";

import { HAND_WRITTEN_ITEMS, QUESTION_ITEMS } from "@/features/agents/router-fixtures";
import { routeAgent } from "@/infrastructure/agent-router";
import { AGENTS } from "@/infrastructure/agents";
import type { CatalogModel } from "@/infrastructure/model-catalog";

import { type ModeContext, medicalDefaults } from "./chat-modes";

/**
 * Medical's default specialists measured on the router fixtures (#610): for
 * each labelled question, does Medical's default list hold the agent the
 * question should go to? Every agent offered, as on local Ollama. Committed
 * fixtures only; no person's data.
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
  ["hand-written prompts", HAND_WRITTEN_ITEMS],
  ["scored questions", QUESTION_ITEMS],
])("Medical's defaults on the %s", (_name, items) => {
  const covered = items.filter(({ prompt, expected }) =>
    medicalDefaults(CONTEXT, prompt).includes(`agent:${expected}`),
  );
  const routed = items.filter(
    ({ prompt, expected }) => routeAgent(prompt, AGENT_IDS).agentId === expected,
  );

  test("hold the expected specialist for every item, Auto's alone on fewer or as many", () => {
    expect(items.length).toBeGreaterThan(0);
    expect(covered.map(({ prompt }) => prompt)).toEqual(
      items.map(({ prompt }) => prompt),
    );
    expect(routed.length).toBeLessThanOrEqual(covered.length);
  });

  test("always hold Auto's pick, at most three specialists", () => {
    items.forEach(({ prompt }) => {
      const rows = medicalDefaults(CONTEXT, prompt);
      expect(rows.length).toBeLessThanOrEqual(3);
      expect(rows).toContain(`agent:${routeAgent(prompt, AGENT_IDS).agentId}`);
    });
  });
});
