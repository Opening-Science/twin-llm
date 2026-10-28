/**
 * Auto mode (#219), version 1: picks the agent for one question from the
 * question's words alone. Every agent has a short list of topics, each a
 * keyword pattern that also matches the topic's LOINC codes. The agent with
 * the most matching topics wins; a tie goes to the agent listed first in
 * `AGENTS`; no match at all goes to the General Practitioner. No model is
 * called, so the choice is the same every time and can be read off the rules.
 *
 * Pure, so the turn's column name (`turn-rules.ts`), the chat route and the
 * line under the answer all agree. docs/agents.md lists the rules.
 */

import { AGENTS, AUTO_AGENT } from "./agents";

export type RouteTopic = Readonly<{
  /** Finishes "the question is about …". */
  topic: string;
  pattern: RegExp;
}>;

/** The agent every question falls back to. */
export const DEFAULT_AGENT_ID = "gp";

/** Topics per agent id. The General Practitioner has none: it is the default. */
export const ROUTE_TOPICS: Readonly<Record<string, readonly RouteTopic[]>> = {
  diet: [
    { topic: "body weight", pattern: /\bweigh(?:t|s|ed|ing)?\b|29463-7/ },
    { topic: "BMI", pattern: /\bbmi\b|body mass index|39156-5/ },
    { topic: "blood glucose", pattern: /\bglucose\b|blood sugar|2339-0/ },
    { topic: "HbA1c", pattern: /\bhba1c\b|\ba1c\b|glycated|4548-4/ },
    {
      topic: "blood lipids",
      pattern:
        /cholesterol|\blipids?\b|\bldl\b|\bhdl\b|triglycerides?|2093-3|18262-6|2085-9|2571-8/,
    },
    {
      topic: "food and diet",
      pattern: /\bdiet\w*|\bnutrition\w*|\bfood\b|\bmeals?\b|\bcalories?\b|\beating\b/,
    },
  ],
  anatomy: [
    { topic: "anatomy", pattern: /\banatom\w*/ },
    {
      topic: "where an organ is",
      pattern:
        /\b(?:organs?|liver|kidneys?|pancreas|spleen|gall ?bladder|thyroid|stomach|lungs?|bladder|intestines?|bowel)\b|\bheart\b(?! rate)/,
    },
    {
      topic: "a body system",
      pattern:
        /\bskelet\w*|\bmuscles?\b|\bbones?\b|\bcirculatory\b|\bdigestive\b|\bnervous system\b|\bendocrine\b|\bbody systems?\b/,
    },
  ],
  sleep: [
    {
      topic: "sleep",
      pattern:
        /\bsleep\w*|\bslept\b|\bnights?\b|\binsomnia\b|\bnaps?\b|\brem\b|\bbedtime\b|93832-4/,
    },
  ],
  trainer: [
    { topic: "recovery", pattern: /\brecover\w*|\breadiness\b/ },
    { topic: "heart rate variability", pattern: /\bhrv\b|heart rate variability/ },
    { topic: "resting heart rate", pattern: /resting heart rate|\brhr\b|40443-4/ },
    {
      topic: "training",
      pattern:
        /\btrain(?:ing)?\b|\bworkouts?\b|\bexercis\w*|\brun(?:s|ning)?\b|\bstrain\b|check-in|weekly review/,
    },
  ],
  genetics: [
    {
      topic: "the genome",
      pattern:
        /\bgenes?\b|\bgenetic\w*|\bgenome\b|\bgenotypes?\b|\bdna\b|\bvariants?\b|\bsnps?\b|\brs\d+\b/,
    },
  ],
};

export type AutoChoice = Readonly<{
  agentId: string;
  /** The first topic of the chosen agent that matched; null for the default. */
  topic: string | null;
}>;

const topicsMatched = (agentId: string, text: string): readonly string[] =>
  (ROUTE_TOPICS[agentId] ?? [])
    .filter(({ pattern }) => pattern.test(text))
    .map(({ topic }) => topic);

/**
 * The agent for one question among the agents offered here (`agent:<id>`
 * rows minus Auto). An agent that is not offered is never picked.
 */
export const routeAgent = (prompt: string, offeredIds: readonly string[]): AutoChoice => {
  const text = prompt.toLowerCase();
  const scored = AGENTS.filter(
    ({ id }) => id !== DEFAULT_AGENT_ID && offeredIds.includes(id),
  ).map(({ id }) => ({ id, topics: topicsMatched(id, text) }));
  const best = scored.reduce<(typeof scored)[number] | null>(
    (leader, candidate) =>
      candidate.topics.length > (leader?.topics.length ?? 0) ? candidate : leader,
    null,
  );
  return best === null
    ? { agentId: DEFAULT_AGENT_ID, topic: null }
    : { agentId: best.id, topic: best.topics[0] ?? null };
};

const AUTO_SEPARATOR = " → ";

/** The column header of an Auto answer: "Auto → Diet specialist". */
export const autoColumnName = (agentName: string): string =>
  `${AUTO_AGENT.name}${AUTO_SEPARATOR}${agentName}`;

/** The id of the agent an Auto column name names, or null for any other name. */
export const agentIdOfAutoColumn = (columnName: string): string | null => {
  const prefix = `${AUTO_AGENT.name}${AUTO_SEPARATOR}`;
  if (!columnName.startsWith(prefix)) return null;
  const name = columnName.slice(prefix.length);
  return AGENTS.find((agent) => agent.name === name)?.id ?? null;
};

/** The muted line under an Auto answer. */
export const autoChoiceLine = (agentName: string, topic: string | null): string =>
  topic === null
    ? `${AUTO_AGENT.name} chose ${agentName}: no specialist agent here matched the question.`
    : `${AUTO_AGENT.name} chose ${agentName}: the question is about ${topic}.`;

/**
 * The line for a stored Auto answer, from its prompt and column name. The
 * column name holds the agent that ran; the topic is found again by routing
 * the prompt among that one agent, which gives the same topic it won with.
 */
export const autoChoiceLineFor = (prompt: string, columnName: string): string | null => {
  const agentId = agentIdOfAutoColumn(columnName);
  const agent = AGENTS.find(({ id }) => id === agentId);
  if (agent === undefined) return null;
  return autoChoiceLine(agent.name, routeAgent(prompt, [agent.id]).topic);
};
