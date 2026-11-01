/**
 * Auto mode (#219), version 3 (#253): picks the agent for one question from the
 * question's words alone. A question that asks for a medicine or dose decision goes
 * to the General agent first, since no specialist gives doses or says
 * what to start or stop. Otherwise every specialist has a short list of
 * topics, each a keyword pattern that also matches the topic's LOINC codes.
 * The agent with the most matching topics wins; a tie goes to the agent listed
 * first in `AGENTS`; no match at all goes to the General agent. No
 * model is called, so the choice is the same every time and can be read off
 * the rules.
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

/**
 * Topics that send a question to the General agent before any
 * specialist is scored: the specialists describe, and never give a dose or
 * say what to take, start, stop or change.
 */
export const DEFAULT_AGENT_TOPICS: readonly RouteTopic[] = [
  {
    topic: "a medicine or dose decision",
    pattern:
      /\b(?:doses?|dosing)\b|\bhow many (?:milligrams|units)\b|\bshould\b[^.?!]*\b(?:take|start|stop|change|replace|inject|double|see a doctor|go to (?:the )?hospital)\b/,
  },
  // Version 3 (#253): only the General agent searches the guideline library.
  { topic: "the guideline library", pattern: /\bguidelines?\b/ },
];

/** Topics per specialist id. The General agent is the default. */
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
        /\b(?:organs?|liver|kidneys?|pancreas|spleen|gall ?bladder|thyroid|stomach|lungs?|bladder|intestines?|bowel)\b(?! (?:disease|failure|cancer))|\bheart\b(?! rate| disease| failure| rhythm| beat)/,
    },
    {
      topic: "a body system",
      pattern:
        /\bskelet\w*|\bmuscles?\b|\bbones?\b|\bcirculatory\b|\bdigestive\b|(?<!autonomic )\bnervous system\b|\bendocrine\b|\bbody systems?\b/,
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
        /\btrain(?:ing)?\b|\bworkouts?\b|\bexercis\w*|\ba run\b|\bruns\b|\brunning\b|\bjog\w*|\bswim\w*|\bcycling\b|\bbik(?:e|ing)\b|\browing\b|\bsports?\b|\bstrain\b|check-in|weekly review/,
    },
  ],
  genetics: [
    {
      topic: "the genome",
      pattern:
        /\bgenes?\b|\bgenetic\w*|\bgenome\b|\bgenotypes?\b|\bdna\b|\bvariants?\b|\bsnps?\b|\brs\d+\b/,
    },
  ],
  // Version 3 (#253). HRV alone ties with Trainer, which is listed first and keeps it.
  rhythm: [
    {
      topic: "atrial fibrillation",
      pattern: /atrial fibrillation|\ba-?fib\b|\baf\b/,
    },
    {
      topic: "heart rhythm",
      pattern:
        /\barrhythmi\w*|(?<!circadian )\brhythms?\b|\bpalpitations?\b|\bectopic\b|\bheart ?beats?\b|\b(?:tachy|brady)cardi\w*/,
    },
    { topic: "RR intervals", pattern: /\br-?r intervals?\b|\brr\b|\binter-?beat\b/ },
    {
      topic: "heart rate variability",
      pattern: /\bhrv\b|heart rate variability|80404-7/,
    },
  ],
  brain: [
    {
      topic: "stroke",
      pattern: /\bstrokes?\b|cerebrovascular|\btia\b|transient isch(?:a)?emic/,
    },
    {
      topic: "cognition and memory",
      pattern: /\bcognit\w*|\bdementia\b|\balzheimer\w*|\bmemory\b|\bmmse\b|72106-8/,
    },
    {
      topic: "the autonomic nervous system",
      pattern: /\bautonomic\b|heart.brain|brain.heart/,
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
  const decision = DEFAULT_AGENT_TOPICS.find(({ pattern }) => pattern.test(text));
  if (decision !== undefined) return { agentId: DEFAULT_AGENT_ID, topic: decision.topic };
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

/**
 * The muted line under an Auto answer: which agent, on which model when that
 * is known (#366), and why.
 */
export const autoChoiceLine = (
  agentName: string,
  topic: string | null,
  modelName: string | null = null,
): string => {
  const ran = modelName === null ? agentName : `${agentName} on ${modelName}`;
  return topic === null
    ? `${AUTO_AGENT.name} chose ${ran}: no specialist agent here matched the question.`
    : `${AUTO_AGENT.name} chose ${ran}: the question is about ${topic}.`;
};

/**
 * The line for a stored Auto answer, from its prompt and column name. The
 * column name holds the agent that ran; the topic is found again by routing
 * the prompt among that one agent, which gives the same topic it won with.
 */
export const autoChoiceLineFor = (
  prompt: string,
  columnName: string,
  modelNameOf: (agentId: string) => string | null = () => null,
): string | null => {
  const agentId = agentIdOfAutoColumn(columnName);
  const agent = AGENTS.find(({ id }) => id === agentId);
  if (agent === undefined) return null;
  return autoChoiceLine(
    agent.name,
    routeAgent(prompt, [agent.id]).topic,
    modelNameOf(agent.id),
  );
};
