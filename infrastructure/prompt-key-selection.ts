/**
 * Picks which of a source's metrics the Twin prompt lists when there are more
 * than the per-source budget.
 *
 * Summary builders emit metrics grouped by kind (sleep, then readiness, ...,
 * workouts last), so a plain first-N cut dropped whole kinds over a long window.
 * Instead every metric gets a category and a family (its key without the date):
 *
 * 1. the latest metric of each family, round-robin across categories;
 * 2. then the remaining metrics, newest first, round-robin across categories.
 *
 * Within a category, ties on date keep the summary's own order. The picked
 * metrics come back in that original order, so the result depends only on the
 * input list.
 */

export const PROMPT_KEY_CATEGORIES = [
  "sleep",
  "recovery",
  "heart",
  "activity",
  "workouts",
  "other",
] as const;

export type PromptKeyCategory = (typeof PROMPT_KEY_CATEGORIES)[number];

const SOURCE_PREFIXES = new Set(["oura", "whoop", "google"]);
const DATE_SEGMENT = /^\d{4}-\d{2}-\d{2}$/;

const CATEGORY_RULES: readonly Readonly<{
  category: PromptKeyCategory;
  pattern: RegExp;
}>[] = [
  { category: "workouts", pattern: /workout|exercise/ },
  { category: "sleep", pattern: /sleep/ },
  { category: "recovery", pattern: /readiness|recovery|stress/ },
  {
    category: "heart",
    pattern: /heart|hrv|(^|[._])hr(\.|$)|rhr|spo2|oxygen|vo2max|respiratory/,
  },
  { category: "activity", pattern: /activity|steps|cycle|active|distance|calories/ },
];

/** The key without a trailing `YYYY-MM-DD` segment. */
export const keyFamily = (key: string): string => {
  const parts = key.split(".");
  return parts.length > 1 && DATE_SEGMENT.test(parts[parts.length - 1] ?? "")
    ? parts.slice(0, -1).join(".")
    : key;
};

/** BodyLoop body measures are all `other`; their path words are not activity. */
export const keyCategory = (key: string): PromptKeyCategory => {
  const family = keyFamily(key).toLowerCase();
  const [first, ...rest] = family.split(".");
  if (first === "vitronic") return "other";
  const body =
    first !== undefined && SOURCE_PREFIXES.has(first) ? rest.join(".") : family;
  return CATEGORY_RULES.find((rule) => rule.pattern.test(body))?.category ?? "other";
};

type Candidate = Readonly<{
  index: number;
  family: string;
  date: string;
  category: PromptKeyCategory;
}>;

const dateOf = (metric: Readonly<{ key: string; date?: string }>): string => {
  if (metric.date) return metric.date;
  const last = metric.key.split(".").at(-1) ?? "";
  return DATE_SEGMENT.test(last) ? last : "";
};

/** Newest first; undated last; equal dates keep the summary's order. */
const newestFirst = (a: Candidate, b: Candidate): number =>
  b.date.localeCompare(a.date) || a.index - b.index;

/** Takes one from each non-empty queue in turn until `budget` is spent. */
const roundRobin = (
  queues: readonly (readonly Candidate[])[],
  budget: number,
): readonly Candidate[] => {
  const longest = Math.max(0, ...queues.map((queue) => queue.length));
  return Array.from({ length: longest }, (_, round) =>
    queues.flatMap((queue) => (round < queue.length ? [queue[round]!] : [])),
  )
    .flat()
    .slice(0, Math.max(0, budget));
};

const byCategory = (
  candidates: readonly Candidate[],
): readonly (readonly Candidate[])[] =>
  PROMPT_KEY_CATEGORIES.map((category) =>
    candidates.filter((candidate) => candidate.category === category).sort(newestFirst),
  );

export const selectPromptMetrics = <M extends Readonly<{ key: string; date?: string }>>(
  metrics: readonly M[],
  budget: number,
): readonly M[] => {
  if (metrics.length <= budget) return metrics;

  const candidates: readonly Candidate[] = metrics.map((metric, index) => ({
    index,
    family: keyFamily(metric.key),
    date: dateOf(metric),
    category: keyCategory(metric.key),
  }));

  const latestByFamily = candidates.reduce((latest, candidate) => {
    const current = latest.get(candidate.family);
    return current && newestFirst(current, candidate) <= 0
      ? latest
      : new Map(latest).set(candidate.family, candidate);
  }, new Map<string, Candidate>());
  const latest = [...latestByFamily.values()];
  const latestIndexes = new Set(latest.map((candidate) => candidate.index));

  const first = roundRobin(byCategory(latest), budget);
  const rest = roundRobin(
    byCategory(candidates.filter((candidate) => !latestIndexes.has(candidate.index))),
    budget - first.length,
  );

  const picked = new Set([...first, ...rest].map((candidate) => candidate.index));
  return metrics.filter((_, index) => picked.has(index));
};
