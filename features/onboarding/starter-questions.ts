import { isGenomeIdsBlocked } from "@/infrastructure/disclosure-ledger";
import { GENOME_IDS_BLOCKED_SENTENCE } from "@/infrastructure/free-text-check";
import { splitThinking } from "@/infrastructure/think-block";
import { type DataChoiceId, type RoleId, ROLES } from "./onboarding-steps";

/**
 * Three first questions for the last onboarding step.
 *
 * The configured model writes them from the person's role, data choice,
 * linked sources and own words. A model is slow on a laptop and may be down,
 * so a call that fails, times out or returns fewer than three usable lines is
 * topped up from fixed starters per role. The person never sees why: the real
 * error goes to the server log as an error name only. The one exception is a
 * request blocked for the person's own genome identifiers (#356, #414): the
 * fixed starters come with the fixed refusal sentence as `notice`.
 *
 * The model call is injected, so every path here is tested with fakes.
 */

export const STARTER_COUNT = 3;
export const STARTER_TIMEOUT_MS = 40_000;
const MAX_STARTER_LENGTH = 160;
const MIN_STARTER_LENGTH = 12;

const OWN_DATA_STARTERS = [
  "How has my sleep duration changed over the last two weeks?",
  "Is my HRV this week above or below my own recent baseline?",
  "Which of my linked metrics have gaps in the last month?",
] as const;

const COHORT_STARTERS = [
  "Which subjects in the synthetic cohort have the most heart-rate observations?",
  "How does resting heart rate trend for one synthetic subject over their records?",
  "What can the cohort tools compute, and what can they not?",
] as const;

const ROLE_STARTERS: Readonly<Record<RoleId, readonly string[]>> = {
  researcher: COHORT_STARTERS,
  "clinician-researcher": [
    "Which guideline passages describe how blood pressure is measured?",
    "For one synthetic subject, how far is the latest blood pressure from their own baseline?",
    "What do the OpenTwin notes say about the limits of wearable HRV?",
  ],
  "self-tracker": OWN_DATA_STARTERS,
  student: [
    "What does HRV measure, and in which unit?",
    "How are wearable metrics coded with LOINC and UCUM here?",
    "What is the difference between a population estimate and a personal measurement?",
  ],
};

const DATA_STARTERS: Readonly<Record<DataChoiceId, readonly string[]>> = {
  demo: COHORT_STARTERS,
  own: OWN_DATA_STARTERS,
};

export type StarterContext = Readonly<{
  roles: readonly RoleId[];
  dataChoice: DataChoiceId | null;
  interest: string;
  /** Display names of linked sources, e.g. "Oura Ring". */
  connected: readonly string[];
}>;

/** Takes one from each list in turn, so two roles both show up in three slots. */
const roundRobin = (lists: readonly (readonly string[])[]): readonly string[] => {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  return Array.from({ length: longest }, (_, index) =>
    lists.flatMap((list) => (index < list.length ? [list[index]] : [])),
  ).flat();
};

/**
 * Fixed starters: the data choice and each picked role in turn, without
 * repeats, then the learning ones as filler. Nothing picked reads as the demo
 * cohort.
 */
export const fallbackStarters = (
  context: Pick<StarterContext, "roles" | "dataChoice">,
): readonly string[] => {
  const picked = roundRobin([
    DATA_STARTERS[context.dataChoice ?? "demo"],
    ...context.roles.map((role) => ROLE_STARTERS[role]),
  ]);
  return [...new Set([...picked, ...ROLE_STARTERS.student])].slice(0, STARTER_COUNT);
};

const roleLabel = (role: RoleId): string =>
  ROLES.find((item) => item.id === role)?.label ?? role;

export const STARTER_SYSTEM_PROMPT = [
  "You suggest first questions for TwinLLM, a research tool that reads linked wearable summaries, a synthetic Synthea cohort, published guideline passages and its own notes on metrics.",
  `Write exactly ${String(STARTER_COUNT)} short questions this person could ask first, one per line, each ending with a question mark.`,
  "No numbering, no quotes, no other text.",
  "Ask about patterns, trends, baselines, data coverage, units or what a metric measures.",
  "Never ask for a verdict on anyone's health, and never about medicines or doses.",
].join("\n");

export const buildStarterPrompt = (context: StarterContext): string =>
  [
    `Roles: ${context.roles.length > 0 ? context.roles.map(roleLabel).join(", ") : "not given"}`,
    `Data: ${
      context.dataChoice === "own"
        ? "their own linked data"
        : "the synthetic demo cohort (no real person)"
    }`,
    `Linked sources: ${context.connected.length > 0 ? context.connected.join(", ") : "none yet"}`,
    `What they want to explore: ${context.interest.trim() || "not given"}`,
  ].join("\n");

/**
 * Copy the claim lint would refuse, plus medicines and doses. A model line
 * that matches is dropped, never shown.
 */
const CLAIM_STEMS =
  /\b(diagnos|treat|prescri|cure\b|medical advice|risk of|you have|your condition|symptom|medication|medicine|dose|dosage)/i;

/** Model text to at most three clean questions. Reasoning blocks are ignored. */
export const parseStarterQuestions = (text: string): readonly string[] => {
  const visible = splitThinking(text).text;
  const lines = visible
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\*\*/g, "")
        .trim()
        .replace(/^(?:[-*•]|\d+[.)])\s*/, "")
        .replace(/^["'“‘]+|["'”’]+$/g, "")
        .trim(),
    )
    .filter(
      (line) =>
        line.endsWith("?") &&
        line.length >= MIN_STARTER_LENGTH &&
        line.length <= MAX_STARTER_LENGTH &&
        !CLAIM_STEMS.test(line),
    );
  return [...new Set(lines)].slice(0, STARTER_COUNT);
};

export type StarterSource = "model" | "fallback";

export type StarterResult = Readonly<{
  questions: readonly string[];
  source: StarterSource;
  /** The fixed refusal when the request was blocked for genome identifiers. */
  notice?: string;
}>;

/** `typed` is what the person wrote themselves: their interest, when given (#414). */
export type StarterGenerate = (
  input: Readonly<{
    system: string;
    prompt: string;
    abortSignal: AbortSignal;
    typed: readonly string[];
  }>,
) => Promise<string>;

/** The person's own words in the starter prompt: the interest, when they wrote one. */
export const starterTyped = (
  context: Pick<StarterContext, "interest">,
): readonly string[] => (context.interest.trim() === "" ? [] : [context.interest.trim()]);

export type StarterDeps = Readonly<{
  generate: StarterGenerate;
  timeoutMs: number;
  logError: (message: string, errorName: string) => void;
}>;

const TIMEOUT = Symbol("timeout");

/** Model starters topped up to three from the fixed ones, or the fixed ones alone. */
export const generateStarterQuestions = async (
  context: StarterContext,
  deps: StarterDeps,
): Promise<StarterResult> => {
  const fixed = fallbackStarters(context);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), deps.timeoutMs);
  });

  try {
    const outcome = await Promise.race([
      deps.generate({
        system: STARTER_SYSTEM_PROMPT,
        prompt: buildStarterPrompt(context),
        abortSignal: controller.signal,
        typed: starterTyped(context),
      }),
      timeout,
    ]);
    if (outcome === TIMEOUT) {
      controller.abort();
      deps.logError("[onboarding] starter questions timed out", "TimeoutError");
      return { questions: fixed, source: "fallback" };
    }
    const fromModel = parseStarterQuestions(outcome);
    if (fromModel.length === 0) {
      deps.logError("[onboarding] starter questions were unusable", "EmptyResult");
      return { questions: fixed, source: "fallback" };
    }
    const toppedUp = [...new Set([...fromModel, ...fixed])].slice(0, STARTER_COUNT);
    return { questions: toppedUp, source: "model" };
  } catch (error) {
    const blocked = isGenomeIdsBlocked(error);
    deps.logError(
      blocked
        ? "[onboarding] starter questions blocked: genome identifiers"
        : "[onboarding] starter questions failed",
      error instanceof Error ? error.name : "unknown",
    );
    return blocked
      ? { questions: fixed, source: "fallback", notice: GENOME_IDS_BLOCKED_SENTENCE }
      : { questions: fixed, source: "fallback" };
  } finally {
    clearTimeout(timer);
  }
};
