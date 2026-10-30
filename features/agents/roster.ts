import {
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_TOPICS,
  ROUTE_TOPICS,
  agentIdOfAutoColumn,
  routeAgent,
} from "@/infrastructure/agent-router";
import { type Agent, AGENTS, AUTO_AGENT, findAgent } from "@/infrastructure/agents";
import { EMPTY_VALUE, formatNumber } from "@/infrastructure/format-measure";
import { type CatalogModel } from "@/infrastructure/model-catalog";
import { skillSourceLabel, type TurnSkill } from "@/infrastructure/skill-gate";
import {
  literatureSourcesForAgent,
  SPECIALTIES,
  specialtyForAgent,
} from "@/packages/literature/specialties";

/**
 * The roster page (#221): every agent with what it looks at, what it runs
 * on, what it may read and call, which questions Auto sends it, how it did
 * and how often it answered. Pure: the page loads the catalog, the skills,
 * the answer counts, the literature counts and the evaluation runs, and
 * hands them here.
 *
 * Nothing here is new about an agent. Each line is read from the code that
 * already runs the turn (`agents.ts`, `agent-router.ts`, the skill, the
 * literature mapping), so the page cannot say something the chat does not do.
 */

/**
 * What each agent does not do, in one plain line. Taken from its skill's own
 * rules (skills/<name>/SKILL.md) and the General agent's place in the
 * router; the roster test checks every agent has one.
 */
export const DOES_NOT: Readonly<Record<string, string>> = {
  gp: "Does not name a condition anyone has, give a dose, or say what to take, start or stop.",
  diet: "Does not write meal plans or diets, give doses, or call a value good or bad.",
  anatomy:
    "Does not read the person's own values or records, or say whether an organ is healthy.",
  sleep: "Does not name a sleep disorder, give advice, or suggest a sleep aid or dose.",
  trainer: "Does not write training plans or say what to do, such as when to rest.",
  genetics:
    "Does not give a dose or say to start, stop or change a medicine; it runs on a local model only.",
  rhythm:
    "Does not say what rhythm or condition a person has, or call a recording normal or abnormal.",
  brain: "Does not say what condition a person has, or grade a cognition score.",
};

export const AUTO_DOES_NOT =
  "Does not answer on its own and does not call a model to choose; the agent it picks answers.";

// --- answers in your threads ------------------------------------------------

/** One group of `model_responses` rows of the viewer's threads. */
export type UsageRow = Readonly<{
  modelId: string;
  modelName: string;
  answers: number;
  costUsd: number;
  /** ISO timestamp of the newest answer in the group. */
  lastAt: string | null;
}>;

export type AgentUsage = Readonly<{
  answers: number;
  /** Of `answers`, those Auto picked this agent for. Always 0 for Auto itself. */
  viaAuto: number;
  costUsd: number;
  lastAt: string | null;
}>;

export const NO_USAGE: AgentUsage = Object.freeze({
  answers: 0,
  viaAuto: 0,
  costUsd: 0,
  lastAt: null,
});

const later = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a.localeCompare(b) >= 0 ? a : b;

const addUsage = (usage: AgentUsage, row: UsageRow, viaAuto: boolean): AgentUsage => ({
  answers: usage.answers + row.answers,
  viaAuto: usage.viaAuto + (viaAuto ? row.answers : 0),
  costUsd: usage.costUsd + row.costUsd,
  lastAt: later(usage.lastAt, row.lastAt),
});

/**
 * Answers per agent id, with `auto` for the Auto rows. An Auto answer counts
 * for Auto and for the agent its column names ("Auto → Sleep"), since that
 * agent is the one that answered. Rows of plain models are left out.
 */
export const usageByAgent = (
  rows: readonly UsageRow[],
): ReadonlyMap<string, AgentUsage> =>
  rows.reduce<ReadonlyMap<string, AgentUsage>>((totals, row) => {
    const bump = (id: string, viaAuto: boolean): ReadonlyMap<string, AgentUsage> =>
      new Map([...totals, [id, addUsage(totals.get(id) ?? NO_USAGE, row, viaAuto)]]);
    if (row.modelId === `agent:${AUTO_AGENT.id}`) {
      const picked = agentIdOfAutoColumn(row.modelName);
      const withAuto = bump(AUTO_AGENT.id, false);
      return picked === null
        ? withAuto
        : new Map([
            ...withAuto,
            [picked, addUsage(withAuto.get(picked) ?? NO_USAGE, row, true)],
          ]);
    }
    const agent = findAgent(row.modelId);
    return agent === null ? totals : bump(agent.id, false);
  }, new Map());

// --- Auto's routing, measured on the router fixtures ------------------------

/** One prompt of `evaluation/agent-router*.json`. */
export type RouterItem = Readonly<{ id?: string; prompt: string; expected: string }>;

export const HAND_WRITTEN = "Hand-written";

/** `S3` for `Q-S3-04`; the hand-written fixture has no ids. */
export const scenarioOf = (item: Pick<RouterItem, "id">): string =>
  /^Q-(S\d+)-/.exec(item.id ?? "")?.[1] ?? HAND_WRITTEN;

export type RoutingCell = Readonly<{
  scenario: string;
  /** Prompts labelled for this agent. */
  labelled: number;
  /** Of those, the ones Auto sent to it. */
  routed: number;
  /** Prompts labelled for another agent that Auto sent here. */
  strays: number;
}>;

const ALL_AGENT_IDS = AGENTS.map(({ id }) => id);

const byScenario = (a: RoutingCell, b: RoutingCell): number =>
  a.scenario === HAND_WRITTEN
    ? 1
    : b.scenario === HAND_WRITTEN
      ? -1
      : a.scenario.localeCompare(b.scenario, "en", { numeric: true });

/**
 * How Auto routes the fixture prompts for one agent, per scenario, with every
 * agent offered (as on local Ollama). Scenarios where the agent has neither a
 * labelled prompt nor a stray are left out.
 */
export const routingFor = (
  agentId: string,
  items: readonly RouterItem[],
): readonly RoutingCell[] => {
  const cells = items.reduce<ReadonlyMap<string, RoutingCell>>((acc, item) => {
    const routedHere = routeAgent(item.prompt, ALL_AGENT_IDS).agentId === agentId;
    const labelledHere = item.expected === agentId;
    if (!routedHere && !labelledHere) return acc;
    const scenario = scenarioOf(item);
    const cell = acc.get(scenario) ?? { scenario, labelled: 0, routed: 0, strays: 0 };
    return new Map([
      ...acc,
      [
        scenario,
        {
          scenario,
          labelled: cell.labelled + (labelledHere ? 1 : 0),
          routed: cell.routed + (labelledHere && routedHere ? 1 : 0),
          strays: cell.strays + (!labelledHere && routedHere ? 1 : 0),
        },
      ],
    ]);
  }, new Map());
  return [...cells.values()].sort(byScenario);
};

export const routingTotal = (cells: readonly RoutingCell[]): RoutingCell =>
  cells.reduce(
    (sum, cell) => ({
      scenario: "All",
      labelled: sum.labelled + cell.labelled,
      routed: sum.routed + cell.routed,
      strays: sum.strays + cell.strays,
    }),
    { scenario: "All", labelled: 0, routed: 0, strays: 0 },
  );

/** Prompts Auto routes as labelled, out of all, for one fixture. */
export const routerAccuracy = (
  items: readonly RouterItem[],
): Readonly<{ right: number; total: number }> => ({
  right: items.filter(
    (item) => routeAgent(item.prompt, ALL_AGENT_IDS).agentId === item.expected,
  ).length,
  total: items.length,
});

/** "26 of 29", or a dash when nothing is labelled. */
export const routedText = (cell: RoutingCell): string =>
  cell.labelled === 0
    ? EMPTY_VALUE
    : `${formatNumber(cell.routed, 0)} of ${formatNumber(cell.labelled, 0)}`;

// --- base-model evaluation runs ---------------------------------------------

/** The parts of a Lab evaluation run (`features/lab/eval-runs.ts`) the roster reads. */
export type RunScoreCell = Readonly<{
  passes: number;
  n: number;
  lowPct: number;
  highPct: number;
}>;

export type ScoredRun = Readonly<{
  id: string;
  meta: Readonly<{
    date?: string;
    mock?: boolean;
    models?: ReadonlyArray<Readonly<{ provider: string; model_id: string }>>;
  }> | null;
  scores: ReadonlyArray<
    Readonly<{
      model: string;
      columns: readonly string[];
      rows: ReadonlyArray<
        Readonly<{ criterion: string; cells: readonly (RunScoreCell | null)[] }>
      >;
    }>
  > | null;
}>;

export type BaseModelScores = Readonly<{
  runId: string;
  date: string | null;
  /** As the report heads it, e.g. `ollama:qwen3:8b`. */
  model: string;
  columns: readonly string[];
  rows: ReadonlyArray<
    Readonly<{ criterion: string; cells: readonly (RunScoreCell | null)[] }>
  >;
}>;

/** The table without scenario columns that have no scored cell in any row. */
export const withoutEmptyColumns = (table: BaseModelScores): BaseModelScores => {
  const keep = table.columns.map((_, index) =>
    table.rows.some((row) => (row.cells[index] ?? null) !== null),
  );
  return {
    ...table,
    columns: table.columns.filter((_, index) => keep[index]),
    rows: table.rows.map((row) => ({
      ...row,
      cells: row.cells.filter((_, index) => keep[index]),
    })),
  };
};

/**
 * The score tables of runs made on this base model, in the order given
 * (newest first from the Lab loader), at most `limit`. Mock runs are harness
 * tests and are left out. The harness calls the base model, not the agent,
 * so these are the model's scores without the agent's skill or literature.
 * Scenario columns no row scored are dropped.
 */
export const baseModelScores = (
  runs: readonly ScoredRun[],
  baseModelId: string,
  limit = 3,
): readonly BaseModelScores[] =>
  runs
    .filter((run) => run.meta?.mock !== true)
    .flatMap((run) => {
      const names = (run.meta?.models ?? [])
        .filter((model) => model.model_id === baseModelId)
        .map((model) => `${model.provider}:${model.model_id}`);
      const table = (run.scores ?? []).find((scores) => names.includes(scores.model));
      return table === undefined
        ? []
        : [
            withoutEmptyColumns({
              runId: run.id,
              date: run.meta?.date ?? null,
              model: table.model,
              columns: table.columns,
              rows: table.rows,
            }),
          ];
    })
    .slice(0, limit);

/** "21/29 · 54–85 %", or a dash when nothing was scored. */
export const scoreText = (cell: RunScoreCell | null): string =>
  cell === null
    ? EMPTY_VALUE
    : `${formatNumber(cell.passes, 0)}/${formatNumber(cell.n, 0)} · ${formatNumber(cell.lowPct, 0)}–${formatNumber(cell.highPct, 0)} %`;

// --- literature ---------------------------------------------------------------

export type AgentLiterature = Readonly<{
  /** Specialty labels, e.g. ["Cardiology"]; every one for the General agent. */
  specialties: readonly string[];
  /** Articles in the local index across those sources; null when unknown. */
  articles: number | null;
}>;

/**
 * The literature an agent's `knowledge_search` reads and how many articles of
 * it are in the local index. `counts` maps `literature:<specialty>` to its
 * documents; null when the database could not be read.
 */
export const literatureFor = (
  agentId: string,
  counts: ReadonlyMap<string, number> | null,
): AgentLiterature => {
  const sources = literatureSourcesForAgent(agentId);
  const specialties =
    agentId === DEFAULT_AGENT_ID
      ? Object.values(SPECIALTIES).map(({ label }) => label)
      : [specialtyForAgent(agentId)].flatMap((id) =>
          id === null ? [] : [SPECIALTIES[id].label],
        );
  return {
    specialties,
    articles:
      counts === null
        ? null
        : sources.reduce((sum, source) => sum + (counts.get(source) ?? 0), 0),
  };
};

// --- one roster entry ---------------------------------------------------------

export type RosterSkill = Readonly<{
  name: string;
  tools: readonly string[];
  /** Readable source names. */
  sources: readonly string[];
  localOnly: boolean;
}>;

export type RosterEntry = Readonly<{
  id: string;
  name: string;
  role: string;
  doesNot: string;
  /** Offered in the chat's picker with the active provider. */
  offered: boolean;
  /** The model it runs on here; null when it is not offered. */
  baseModel: Readonly<{ id: string; name: string }> | null;
  /** The ids it would run on, best first. */
  modelPreference: readonly string[];
  /** The skill's name, or null for the General agent. */
  skillName: string | null;
  /** The skill as this server offers it; null when it has none or the server lacks it. */
  skill: RosterSkill | null;
  literature: AgentLiterature;
  /** What Auto sends it: "the question is about …". */
  topics: readonly string[];
  usage: AgentUsage;
  routing: readonly RoutingCell[];
}>;

export type RosterInput = Readonly<{
  /** The chat catalog with agents (`fetchChatCatalog`); null when none could be read. */
  catalog: readonly CatalogModel[] | null;
  skills: readonly TurnSkill[];
  usage: ReadonlyMap<string, AgentUsage>;
  literatureCounts: ReadonlyMap<string, number> | null;
  routerItems: readonly RouterItem[];
}>;

const NO_MATCH_TOPIC = "anything no specialist agent here matches";

/** The topics Auto sends this agent, in the router's own words. */
export const topicsFor = (agentId: string): readonly string[] =>
  agentId === DEFAULT_AGENT_ID
    ? [...DEFAULT_AGENT_TOPICS.map(({ topic }) => topic), NO_MATCH_TOPIC]
    : (ROUTE_TOPICS[agentId] ?? []).map(({ topic }) => topic);

const rosterSkill = (skill: TurnSkill): RosterSkill => ({
  name: skill.name,
  tools: skill.tools,
  sources: skill.sources.map(skillSourceLabel),
  localOnly: skill.providers.length === 1 && skill.providers[0] === "ollama",
});

export const rosterEntry = (agent: Agent, input: RosterInput): RosterEntry => {
  const row = (input.catalog ?? []).find((model) => model.agent?.id === agent.id);
  const skill = input.skills.find(({ name }) => name === agent.skill);
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    doesNot: DOES_NOT[agent.id] ?? EMPTY_VALUE,
    offered: row?.agent !== undefined,
    baseModel:
      row?.agent === undefined
        ? null
        : { id: row.agent.baseModelId, name: row.agent.baseModelName },
    modelPreference: agent.modelPreference,
    skillName: agent.skill,
    skill: skill === undefined ? null : rosterSkill(skill),
    literature: literatureFor(agent.id, input.literatureCounts),
    topics: topicsFor(agent.id),
    usage: input.usage.get(agent.id) ?? NO_USAGE,
    routing: routingFor(agent.id, input.routerItems),
  };
};

export const rosterEntries = (input: RosterInput): readonly RosterEntry[] =>
  AGENTS.map((agent) => rosterEntry(agent, input));

/** "12 answers, 4 through Auto"; "No answers yet". */
export const answersText = (usage: AgentUsage): string => {
  if (usage.answers === 0) return "No answers yet";
  const answers = `${formatNumber(usage.answers, 0)} ${usage.answers === 1 ? "answer" : "answers"}`;
  return usage.viaAuto === 0
    ? answers
    : `${answers}, ${formatNumber(usage.viaAuto, 0)} through Auto`;
};

/** "24 articles", "1 article", or a dash when the count is unknown. */
export const articlesText = (articles: number | null): string =>
  articles === null
    ? EMPTY_VALUE
    : `${formatNumber(articles, 0)} ${articles === 1 ? "article" : "articles"}`;

/** "126 of 130 (96.9%)"; "0 of 0" when there is nothing to share. */
export const shareText = (right: number, total: number): string =>
  total === 0
    ? "0 of 0"
    : `${formatNumber(right, 0)} of ${formatNumber(total, 0)} (${formatNumber((right / total) * 100, 1)}%)`;

/** Why the answer counts are missing, or null when they are there. */
export const usageNote = (signedIn: boolean, usageRead: boolean): string | null =>
  !signedIn
    ? "Sign in to see how often each agent answered in your threads."
    : !usageRead
      ? "Answer counts could not be read just now."
      : null;

/** "1 tool", "7 tools". */
export const toolsText = (count: number): string =>
  `${formatNumber(count, 0)} ${count === 1 ? "tool" : "tools"}`;
