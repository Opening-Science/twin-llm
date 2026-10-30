/**
 * Agent runs in the eval harness (#279): `--models agent:<id>` runs a turn as
 * the chat route runs it for that agent. The agent comes from the same chat
 * catalog (`withAgents`, so its base model follows `modelPreference` and only
 * offered agents are listed) and the same resolver (`turnAgentOf`); its skill,
 * role line and specialty literature are applied by the shared turn code
 * (`createTurnTools`, `runTwinTurn`). Pure: the catalog and the skill lookup
 * are passed in.
 */
import {
  AGENT_ID_PREFIX,
  AGENTS,
  AUTO_AGENT,
  agentModelId,
  findAgent,
} from "../../infrastructure/agents";
import { type CatalogAgent, turnAgentOf } from "../../infrastructure/model-catalog";
import type { TurnSkill } from "../../infrastructure/skill-gate";
import { sha256Hex, toCanonicalJson } from "../../packages/audit/hash";

export type CatalogRow = Readonly<{ id: string; agent?: CatalogAgent }>;

/** An agent as one eval run applies it. */
export type EvalAgent = Readonly<{
  agent: CatalogAgent;
  /** The agent's skill as the server offers it, or null for the General agent. */
  skill: TurnSkill | null;
  /** sha256 of the agent's row and its skill (instructions, tools, sources, providers, views). */
  rulesSha256: string;
  /** sha256 of the whole roster in `agents.ts`. */
  rosterSha256: string;
}>;

export type AgentProblem = Readonly<{ code: string; message: string }>;

const AGENT_PROVIDER = AGENT_ID_PREFIX.slice(0, -1);

/**
 * `agent:rhythm` parses as provider `agent`; it runs on the configured
 * provider, under the catalog id `agent:rhythm`. Any other spec is unchanged.
 */
export const normalizeAgentSpec = <
  T extends Readonly<{ provider: string; modelId: string }>,
>(
  spec: T,
  llmProvider: string,
): T =>
  spec.provider === AGENT_PROVIDER
    ? { ...spec, provider: llmProvider, modelId: `${AGENT_ID_PREFIX}${spec.modelId}` }
    : spec;

export const rosterSha256 = (): string => sha256Hex(toCanonicalJson(AGENTS));

/** The version of what an agent run applies: its roster row and its skill. */
export const agentRulesSha256 = (modelId: string, skill: TurnSkill | null): string =>
  sha256Hex(toCanonicalJson({ agent: findAgent(modelId), skill }));

/**
 * The agent behind an `agent:<id>` model id, resolved against the chat
 * catalog the way `/api/chat` does, or the reason it cannot run. Auto picks
 * an agent per question, so a run of it would mix agents; it is refused.
 */
export const resolveEvalAgent = (
  modelId: string,
  catalog: readonly CatalogRow[],
  findSkill: (name: string) => TurnSkill | null,
): EvalAgent | AgentProblem => {
  if (modelId === agentModelId(AUTO_AGENT)) {
    return {
      code: "USAGE",
      message: `${modelId} picks an agent for each question; run the agents one by one`,
    };
  }
  if (findAgent(modelId) === null) {
    return { code: "UNKNOWN_AGENT", message: `${modelId} is not an agent in agents.ts` };
  }
  const agent = catalog.some((row) => row.id === modelId)
    ? turnAgentOf(modelId, catalog, "")
    : null;
  if (agent === null) {
    return {
      code: "AGENT_NOT_OFFERED",
      message: `the chat catalog does not offer ${modelId} with this provider`,
    };
  }
  const skill = agent.skill === null ? null : findSkill(agent.skill);
  if (agent.skill !== null && skill === null) {
    return {
      code: "AGENT_NOT_OFFERED",
      message: `${modelId}'s skill /${agent.skill} is not one the server offers`,
    };
  }
  return {
    agent,
    skill,
    rulesSha256: agentRulesSha256(modelId, skill),
    rosterSha256: rosterSha256(),
  };
};

export const isAgentProblem = (value: EvalAgent | AgentProblem): value is AgentProblem =>
  "code" in value;
