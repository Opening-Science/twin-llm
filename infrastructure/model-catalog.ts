import { z } from "zod";

import { agentIdOfAutoColumn, autoColumnName, routeAgent } from "./agent-router";
import {
  AGENT_ID_PREFIX,
  type AgentOffer,
  AGENTS,
  agentIsOffered,
  agentModelId,
  AUTO_AGENT,
} from "./agents";
import { roundTo } from "./format-measure";
import { displayModelName } from "./model-names";

/**
 * Catalog rows and the pure rules about them: parsing each provider's model
 * list, ordering, default picks and display formatting.
 *
 * No I/O lives here, so the browser-side picker and the server-rendered
 * models page share these rules without importing a `server-only` module.
 * The fetching half is `fetch-model-catalog.ts`.
 */

export type CatalogModel = {
  /** The id `POST /api/chat` expects, exactly as the provider lists it. */
  readonly id: string;
  /** Display name, without vendor prefix or "(free)" tag. */
  readonly name: string;
  /** Vendor as it names itself, for display. */
  readonly provider: string;
  /** Stable vendor key, used for grouping. */
  readonly providerId: string;
  readonly contextTokens: number;
  /**
   * Present when the provider reported no context window and `contextTokens`
   * is only a placeholder. Such rows sort after measured ones, in list order.
   */
  readonly contextUnknown?: true;
  /** Set on an agent's row (`withAgents`): who it is and the model it runs on. */
  readonly agent?: CatalogAgent;
  /**
   * Set when Ollama lists the `thinking` capability for the model, so effort
   * may switch `think` on (#366). Absent for every other provider.
   */
  readonly thinking?: true;
};

/** An agent as the catalog offers it, with its base model already chosen. */
export type CatalogAgent = Readonly<{
  /** `gp`, not the row id `agent:gp`. */
  id: string;
  name: string;
  role: string;
  skill: string | null;
  baseModelId: string;
  baseModelName: string;
  /** Set when Auto picked this agent for the turn (#219). */
  via?: "auto";
}>;

/** Upper and lower bounds on how many models one prompt goes to. */
export const MAX_SELECTED_MODELS = 3;
export const MIN_SELECTED_MODELS = 1;

/** Shown when a provider reports no window. A stand-in, never a measurement. */
const UNKNOWN_WINDOW = 128_000;

const windowOf = (
  reported: number | undefined,
): Pick<CatalogModel, "contextTokens" | "contextUnknown"> =>
  reported === undefined
    ? { contextTokens: UNKNOWN_WINDOW, contextUnknown: true }
    : { contextTokens: reported };

// --- ordering -----------------------------------------------------------------

/** Widest window first; name breaks ties so equal windows never reshuffle. */
const widestFirst = (left: CatalogModel, right: CatalogModel): number => {
  const byWindow = right.contextTokens - left.contextTokens;
  return byWindow !== 0 ? byWindow : left.name.localeCompare(right.name);
};

/**
 * Measured windows first (widest first), then placeholder rows in the order
 * the server returned them; `Array.prototype.sort` is stable.
 */
const measuredThenListed = (left: CatalogModel, right: CatalogModel): number => {
  const leftUnknown = left.contextUnknown === true;
  const rightUnknown = right.contextUnknown === true;
  if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
  return leftUnknown ? 0 : widestFirst(left, right);
};

// --- parsing --------------------------------------------------------------------

/**
 * Validates the envelope, then each row on its own: a row that does not
 * match is skipped instead of failing the whole list, and unknown fields are
 * ignored so a provider adding one never empties the catalog.
 */
const validRows = <Row>(
  payload: unknown,
  listKey: "data" | "models",
  row: z.ZodType<Row>,
): Row[] | null => {
  const envelope = z.object({ [listKey]: z.array(z.unknown()) }).safeParse(payload);
  if (!envelope.success) return null;
  const items = envelope.data[listKey] ?? [];
  return items.flatMap((item) => {
    const parsed = row.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
};

const idOnly = z.object({ id: z.string().min(1) });

/** Infomaniak's OpenAI-style `GET /models`. No windows are reported. */
export const parseInfomaniakModels = (
  payload: unknown,
): readonly CatalogModel[] | null => {
  const rows = validRows(payload, "data", idOnly);
  if (rows === null || rows.length === 0) return null;
  return rows
    .map(({ id }): CatalogModel => ({
      id,
      name: displayModelName(id),
      provider: "Infomaniak",
      providerId: "infomaniak",
      ...windowOf(undefined),
    }))
    .sort(measuredThenListed);
};

const ollamaTag = z.object({
  name: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  details: z
    .object({ context_length: z.number().int().positive().optional() })
    .optional(),
});

/**
 * Embedding models cannot chat. Newer Ollama versions list capabilities;
 * for older ones the name is the only hint.
 */
const canChat = ({ name, capabilities }: z.infer<typeof ollamaTag>): boolean =>
  capabilities === undefined ? !/embed/i.test(name) : capabilities.includes("completion");

/**
 * Ollama `GET /api/tags`. The tag stays in the id (`qwen3:8b`) because Ollama
 * resolves a bare name only to `:latest`; that one suffix is dropped.
 *
 * `runWindow` is the context the chat asks Ollama for (`OLLAMA_NUM_CTX`). A
 * model runs with that, not with the maximum its tag reports (qwen3:4b says
 * 262K and runs at 16K here), so the smaller of the two is shown.
 */
export const parseOllamaTags = (
  payload: unknown,
  runWindow?: number,
): readonly CatalogModel[] | null => {
  const tags = validRows(payload, "models", ollamaTag);
  if (tags === null) return null;
  return tags
    .filter(canChat)
    .map((tag): CatalogModel => {
      const id = tag.name.endsWith(":latest")
        ? tag.name.slice(0, -":latest".length)
        : tag.name;
      return {
        id,
        name: displayModelName(id),
        provider: "Ollama",
        providerId: "ollama",
        ...(tag.capabilities?.includes("thinking") === true ? { thinking: true } : {}),
        ...windowOf(
          runWindow === undefined
            ? tag.details?.context_length
            : Math.min(tag.details?.context_length ?? runWindow, runWindow),
        ),
      };
    })
    .sort(measuredThenListed);
};

/** Display label for a vLLM server reached through an SSH tunnel. */
export const REMOTE_GPU_PROVIDER_LABEL = "Remote GPU (SSH tunnel)";

/** Display label for our own vLLM servers on Exoscale. */
export const EXOSCALE_PROVIDER_LABEL = "Exoscale (Switzerland)";

/** Providers whose models come from vLLM `/v1/models`. */
export type VllmProviderId = "exoscale" | "remote-gpu";

/** Which vLLM deployment a row belongs to. */
export type VllmSource = Readonly<{ provider: string; providerId: VllmProviderId }>;

export const REMOTE_GPU_SOURCE: VllmSource = Object.freeze({
  providerId: "remote-gpu",
  provider: REMOTE_GPU_PROVIDER_LABEL,
});

export const EXOSCALE_SOURCE: VllmSource = Object.freeze({
  providerId: "exoscale",
  provider: EXOSCALE_PROVIDER_LABEL,
});

const vllmModel = idOnly.extend({
  max_model_len: z.number().int().positive().optional(),
});

/**
 * vLLM `GET /v1/models`. The id is the served model name; `max_model_len` is
 * the window the server was started with, which may be below the model's own.
 */
export const parseVllmModels = (
  payload: unknown,
  source: VllmSource = REMOTE_GPU_SOURCE,
): readonly CatalogModel[] | null =>
  validRows(payload, "data", vllmModel)
    ?.map((row): CatalogModel => ({
      id: row.id,
      name: displayModelName(row.id),
      ...source,
      ...windowOf(row.max_model_len),
    }))
    .sort(measuredThenListed) ?? null;

const openRouterModel = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  context_length: z.number().int().positive(),
  pricing: z.object({ prompt: z.string(), completion: z.string() }),
});

/**
 * OpenRouter names look like "Vendor: Model (free)". Without a vendor prefix,
 * the id's namespace is used as-is rather than inventing a vendor name.
 */
const displayParts = (
  label: string,
  namespace: string,
): Pick<CatalogModel, "name" | "provider"> => {
  const bare = label.replace(/\s*\(free\)\s*$/i, "").trim();
  const [vendor, ...rest] = bare.split(": ");
  return rest.length === 0
    ? { name: bare, provider: namespace }
    : { name: rest.join(": ").trim(), provider: (vendor ?? namespace).trim() };
};

/**
 * OpenRouter `GET /models`, reduced to models that cost nothing. Both signals
 * must agree: a `:free` id and a zero price for prompt and completion. The chat
 * route refuses anything not on this list, so this filter is what keeps a
 * crafted request from running a paid model.
 */
export const parseFreeModels = (payload: unknown): readonly CatalogModel[] | null =>
  validRows(payload, "data", openRouterModel)
    ?.filter(
      ({ id, pricing }) =>
        id.endsWith(":free") &&
        Number(pricing.prompt) === 0 &&
        Number(pricing.completion) === 0,
    )
    .map((model): CatalogModel => {
      const namespace = model.id.split("/", 1)[0] ?? model.id;
      return {
        id: model.id,
        providerId: namespace,
        contextTokens: model.context_length,
        ...displayParts(model.name, namespace),
      };
    })
    .sort(widestFirst) ?? null;

// --- agents -------------------------------------------------------------------

/**
 * The model an agent runs on: the first of its preferences the catalog
 * offers, else the catalog's first model. Agent rows are never a base.
 */
export const agentBaseModel = (
  modelPreference: readonly string[],
  catalog: readonly CatalogModel[],
): CatalogModel | null => {
  const models = catalog.filter((model) => model.agent === undefined);
  const preferred = modelPreference.flatMap((id) =>
    models.filter((model) => model.id === id),
  );
  return preferred[0] ?? models[0] ?? null;
};

/**
 * The catalog with the agents in front (#218). Each agent row copies its base
 * model's provider and window and takes the agent's id and name, so the
 * picker, the 1-to-3 rule and the answer columns treat it like any model.
 * An agent with no model to run on, or one `agentIsOffered` leaves out, gets
 * no row. Rows already marked as agents are replaced, never doubled.
 */
export const withAgents = (
  catalog: readonly CatalogModel[],
  offer: AgentOffer,
): readonly CatalogModel[] => {
  const models = catalog.filter((model) => model.agent === undefined);
  const agents = AGENTS.filter((agent) => agentIsOffered(agent, offer)).flatMap(
    (agent): CatalogModel[] => {
      const base = agentBaseModel(agent.modelPreference, models);
      return base === null
        ? []
        : [
            {
              ...base,
              id: agentModelId(agent),
              name: agent.name,
              agent: {
                id: agent.id,
                name: agent.name,
                role: agent.role,
                skill: agent.skill,
                baseModelId: base.id,
                baseModelName: base.name,
              },
            },
          ];
    },
  );
  const [first] = agents;
  const auto: CatalogModel[] =
    first?.agent === undefined
      ? []
      : [
          {
            ...first,
            id: agentModelId(AUTO_AGENT),
            name: AUTO_AGENT.name,
            agent: { ...first.agent, ...AUTO_AGENT, skill: null },
          },
        ];
  return [...auto, ...agents, ...models];
};

export const AUTO_MODEL_ID = agentModelId(AUTO_AGENT);

type AgentRow = Readonly<{ id: string; name?: string; agent?: CatalogAgent }>;

/**
 * Manual mode (#366) runs a chosen specialist on a chosen model: the row id
 * `agent:<specialist>@<model id>`, such as `agent:diet@qwen3:4b`. Such a row
 * is not listed in the catalog; `findCatalogRow` builds it from the
 * specialist's row and the model's row, so a pair is offered exactly when
 * both are. Auto cannot be paired.
 */
const PAIR_SEPARATOR = "@";

export const pairedModelId = (agentId: string, modelId: string): string =>
  `${AGENT_ID_PREFIX}${agentId}${PAIR_SEPARATOR}${modelId}`;

/** The specialist and model a paired id names, or null for any other id. */
export const parsePairedModelId = (
  id: string,
): Readonly<{ agentId: string; modelId: string }> | null => {
  if (!id.startsWith(AGENT_ID_PREFIX)) return null;
  const rest = id.slice(AGENT_ID_PREFIX.length);
  const at = rest.indexOf(PAIR_SEPARATOR);
  if (at <= 0 || at === rest.length - 1) return null;
  return { agentId: rest.slice(0, at), modelId: rest.slice(at + 1) };
};

/** A paired row's name: "Diet specialist · Qwen3 4B". */
export const pairedModelName = (agentName: string, modelName: string): string =>
  `${agentName} · ${modelName}`;

/**
 * The catalog row for an id: a listed row, or a specialist paired with a
 * model when the catalog offers both. Null when the id is not offered.
 */
export const findCatalogRow = <Row extends AgentRow>(
  id: string,
  catalog: readonly Row[],
): Row | null => {
  const listed = catalog.find((row) => row.id === id);
  if (listed !== undefined) return listed;
  const pair = parsePairedModelId(id);
  if (pair === null) return null;
  const specialist = catalog.find(
    (row) =>
      row.id === `${AGENT_ID_PREFIX}${pair.agentId}` &&
      row.id !== AUTO_MODEL_ID &&
      row.agent !== undefined,
  );
  const base = catalog.find((row) => row.id === pair.modelId && row.agent === undefined);
  if (specialist?.agent === undefined || base === undefined) return null;
  return {
    ...base,
    id,
    name: pairedModelName(specialist.agent.name, base.name ?? base.id),
    agent: {
      ...specialist.agent,
      baseModelId: base.id,
      baseModelName: base.name ?? base.id,
    },
  };
};

/** Whether the model a turn calls lists the `thinking` capability. */
export const modelCanThink = (
  modelId: string,
  catalog: readonly Readonly<{ id: string; thinking?: true }>[],
): boolean => catalog.find((row) => row.id === modelId)?.thinking === true;

/**
 * The agent Auto runs as for one question (#219): the one the router picks
 * among the agents this catalog offers, marked `via: "auto"`. A stored column
 * name ("Auto → Sleep") wins when that agent is still offered, so a retry runs
 * as the agent the header names.
 */
export const autoAgentFor = (
  prompt: string,
  catalog: readonly AgentRow[],
  columnName: string | null = null,
): CatalogAgent | null => {
  const offered = catalog.flatMap((row) =>
    row.agent === undefined || row.id === AUTO_MODEL_ID ? [] : [row.agent],
  );
  const stored = columnName === null ? null : agentIdOfAutoColumn(columnName);
  const chosen =
    offered.find(({ id }) => id === stored) ??
    offered.find(
      ({ id }) =>
        id ===
        routeAgent(
          prompt,
          offered.map((agent) => agent.id),
        ).agentId,
    ) ??
    offered[0];
  return chosen === undefined ? null : { ...chosen, via: "auto" };
};

/**
 * The agent a turn runs as: Auto's pick for an `agent:auto` row, the row's
 * own agent for any other agent row, null for a plain model.
 */
export const turnAgentOf = (
  modelId: string,
  catalog: readonly AgentRow[],
  prompt: string,
  columnName: string | null = null,
): CatalogAgent | null =>
  modelId === AUTO_MODEL_ID
    ? autoAgentFor(prompt, catalog, columnName)
    : catalogAgentOf(modelId, catalog);

/**
 * The name a turn stores for a picked row: "Auto → Diet specialist" for Auto,
 * else the row's own name.
 */
export const turnModelName = (
  model: Readonly<{ id: string; name: string }>,
  catalog: readonly AgentRow[],
  prompt: string,
): string => {
  if (model.id !== AUTO_MODEL_ID)
    return findCatalogRow(model.id, catalog)?.name ?? model.name;
  const agent = autoAgentFor(prompt, catalog);
  return agent === null ? model.name : autoColumnName(agent.name);
};

/** The agent a catalog row stands for, or null for a plain model. */
export const catalogAgentOf = (
  modelId: string,
  catalog: readonly AgentRow[],
): CatalogAgent | null => findCatalogRow(modelId, catalog)?.agent ?? null;

// --- selection and display ------------------------------------------------------

/**
 * The agents a new chat starts with, in this order, when the catalog offers
 * them: on a local provider all three, on a hosted one only the General
 * agent.
 */
export const DEFAULT_AGENT_IDS: readonly string[] = Object.freeze([
  "agent:gp",
  "agent:diet",
  "agent:anatomy",
]);

/**
 * The rows a new prompt starts with: the default agents the catalog offers
 * (`DEFAULT_AGENT_IDS`), then models. For the models, walk the (already
 * ordered) list and take the first model of each vendor, so the comparison
 * spans vendors instead of three variants of one; top up from the rest when
 * there are fewer vendors than slots. A catalog without agents (the models
 * page, the starter questions) gets models only, as before.
 */
export const defaultModelSelection = (
  catalog: readonly CatalogModel[],
): readonly string[] => {
  const agents = DEFAULT_AGENT_IDS.filter((id) => catalog.some((row) => row.id === id));
  return [...agents, ...defaultPlainModels(catalog)].slice(0, MAX_SELECTED_MODELS);
};

const defaultPlainModels = (catalog: readonly CatalogModel[]): readonly string[] => {
  const seenVendors = new Set<string>();
  const models = catalog.filter((model) => model.agent === undefined);
  const [firsts, others] = models.reduce<[CatalogModel[], CatalogModel[]]>(
    ([leading, trailing], model) => {
      const isFirst = !seenVendors.has(model.providerId);
      seenVendors.add(model.providerId);
      return isFirst ? [[...leading, model], trailing] : [leading, [...trailing, model]];
    },
    [[], []],
  );
  return [...firsts, ...others].slice(0, MAX_SELECTED_MODELS).map(({ id }) => id);
};

/**
 * "262K", "1M": decimal thousands and millions, because 1,000,000 / 1024
 * would print the largest window as "977K".
 */
export const formatContextWindow = (tokens: number): string => {
  const millions = tokens >= 1_000_000;
  const scaled = millions ? roundTo(tokens / 1_000_000, 1) : roundTo(tokens / 1_000, 0);
  return `${String(scaled)}${millions ? "M" : "K"}`;
};

/** A model's window as shown to people: "unknown" when the provider sent none. */
export const formatModelWindow = (
  model: Pick<CatalogModel, "contextTokens" | "contextUnknown">,
): string =>
  model.contextUnknown ? "unknown" : formatContextWindow(model.contextTokens);
