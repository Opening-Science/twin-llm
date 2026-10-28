/**
 * Agents (#218): named presets over the models and skills TwinLLM already has.
 * An agent is a name, one descriptive role line, an optional skill and the
 * models it would rather run on. It adds no tool, source or permission: its
 * skill goes through the same gate as a `/skill` the person types.
 *
 * Pure, so the picker and the chat route share it. The catalog rows are
 * built in `model-catalog.ts` (`withAgents`).
 */

import type { LlmProvider } from "./data-mode-policy";
import { requestsGenomeTools } from "./genome-thread-policy";
import { permitSkillRequest, type TurnSkill } from "./skill-gate";

export type Agent = Readonly<{
  id: string;
  name: string;
  /** One plain sentence on what the agent looks at. Descriptive, no advice. */
  role: string;
  /** The skill a turn runs under when the prompt names none, or null. */
  skill: string | null;
  /** Catalog ids to run on, best first; the first one offered wins. */
  modelPreference: readonly string[];
}>;

/** Agent rows in the catalog have ids like `agent:gp`. */
export const AGENT_ID_PREFIX = "agent:";

const LOCAL_PREFERENCE: readonly string[] = Object.freeze(["qwen3:8b", "qwen3:4b"]);

export const AGENTS: readonly Agent[] = Object.freeze([
  {
    id: "gp",
    name: "General Practitioner",
    role: "Looks at the whole record and says when a question is better asked of one of the specialist agents.",
    skill: null,
    modelPreference: LOCAL_PREFERENCE,
  },
  {
    id: "diet",
    name: "Diet specialist",
    role: "Describes body weight, BMI, glucose, HbA1c and blood lipids against the person's own earlier values, without meal plans, diets or doses.",
    skill: "nutrition",
    modelPreference: LOCAL_PREFERENCE,
  },
  {
    id: "anatomy",
    name: "Anatomy specialist",
    role: "Explains where organs and body systems sit and which of them the Anchor biomarkers relate to, as reference anatomy rather than the person's own body.",
    skill: "anatomy",
    modelPreference: LOCAL_PREFERENCE,
  },
  {
    id: "sleep",
    name: "Sleep",
    role: "Describes sleep against the person's own recent nights.",
    skill: "sleep",
    modelPreference: LOCAL_PREFERENCE,
  },
  {
    id: "trainer",
    name: "Trainer",
    role: "Describes recovery, heart rate variability and training load against the person's previous four weeks.",
    skill: "trainer",
    modelPreference: LOCAL_PREFERENCE,
  },
  {
    id: "genetics",
    name: "Genetics",
    role: "Describes the genome report the person released, one variant at a time.",
    skill: "genome",
    modelPreference: LOCAL_PREFERENCE,
  },
]);

/**
 * Auto (#219): not an agent of its own but a row that picks one of the agents
 * above for each turn (`agent-router.ts`). It never runs as itself, so it is
 * kept out of `AGENTS` and has no skill.
 */
export const AUTO_AGENT = Object.freeze({
  id: "auto",
  name: "Auto",
  role: "Picks one of the agents for each question from keyword and LOINC rules, the General Practitioner when none match.",
});

export const agentModelId = (agent: Pick<Agent, "id">): string =>
  `${AGENT_ID_PREFIX}${agent.id}`;

export const isAgentModelId = (modelId: string): boolean =>
  modelId.startsWith(AGENT_ID_PREFIX);

/** The agent behind an `agent:<id>` model id, or null. */
export const findAgent = (modelId: string): Agent | null =>
  isAgentModelId(modelId)
    ? (AGENTS.find((agent) => agentModelId(agent) === modelId) ?? null)
    : null;

export type AgentOffer = Readonly<{
  /** The active chat provider (`LLM_PROVIDER`). */
  provider: LlmProvider;
  /** True when the chat model runs on this machine (`chatModelIsLocal`). */
  chatIsLocal: boolean;
  /** The skills the server offers (`runnableSkills`). */
  skills: readonly Pick<TurnSkill, "name" | "providers" | "sources" | "tools">[];
}>;

/**
 * Whether the agent may be offered at all: an agent without a skill always,
 * one with a skill only when that skill could run here. That is the skill
 * gate's provider rule (`permitSkillRequest`, before any wearable context is
 * known) and, for a skill that asks for genome tools, a local chat model
 * (`genome-thread-policy.ts`). An agent that could not run is left out
 * instead of being refused on every turn.
 */
export const agentIsOffered = (agent: Agent, offer: AgentOffer): boolean => {
  if (agent.skill === null) return true;
  const skill = offer.skills.find(({ name }) => name === agent.skill);
  if (skill === undefined) return false;
  const permit = permitSkillRequest(skill, {
    provider: offer.provider,
    hasWearableContext: false,
  });
  return permit.ok && (!requestsGenomeTools(skill.tools) || offer.chatIsLocal);
};
