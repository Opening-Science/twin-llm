/**
 * Agents (#218): named presets over the models and skills TwinLLM already has.
 * An agent is a name, one descriptive role line, an optional skill and the
 * models it would rather run on. It adds no tool, source or permission: its
 * skill goes through the same gate as a `/skill` the person types.
 *
 * Pure, so the picker and the chat route share it. The catalog rows are
 * built in `model-catalog.ts` (`withAgents`).
 */

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

/** The skill that only runs on a local chat model (`genome-thread-policy.ts`). */
const GENOME_SKILL = "genome";

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
  /** True when the chat model runs on this machine (`chatModelIsLocal`). */
  chatIsLocal: boolean;
}>;

/**
 * Whether the agent may be offered at all. Genetics runs the genome skill,
 * which a thread may only use on a local chat model, so it is left out
 * everywhere else instead of being refused on every turn.
 */
export const agentIsOffered = (agent: Agent, offer: AgentOffer): boolean =>
  agent.skill !== GENOME_SKILL || offer.chatIsLocal;
