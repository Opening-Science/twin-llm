/**
 * Scores a whole run: every answered line on every criterion, the
 * consistency of each repeated item, the counts the report prints, and the
 * latency figures. Pure; the CLI reads the files.
 *
 * Counting rules (docs/evaluation/harness.md):
 * - A `MISSING_ENV` line is skipped: counted in the overview only.
 * - A line with an `error` counts as `error` on every criterion the item
 *   lists, never as a pass, fail, human or n/a.
 * - A criterion the item does not list is `na`.
 * - Consistency counts once per item and model; an item with an errored
 *   repeat counts as `error` there.
 * - Latency is not pass/fail: p50, p90 and p95, cache hits and errors left out.
 */
import type { ResultLine } from "../eval-results";
import {
  CRITERIA,
  type Criterion,
  type KeyEntry,
  LATENCY_SET_TAG,
  type Question,
  SCENARIOS,
  type Scenario,
} from "../question-set";

import { scoreClinicalCaution } from "./clinical-caution";
import { scoreConsistency } from "./consistency";
import { scoreCorrectness } from "./correctness";
import { scoreHallucination } from "./hallucination";
import { scorePrivacy } from "./privacy";
import { scoreQuerySafety } from "./query-safety";
import { scoreReadability } from "./readability";
import { percentile } from "./stats";
import { applies, isAnswered, type Score, type Scorer, type ScoreResult } from "./types";

export type ScoredCriterion = Exclude<Criterion, "latency">;

export const SCORED_CRITERIA = CRITERIA.filter(
  (criterion): criterion is ScoredCriterion => criterion !== "latency",
);

/** Scored per line; consistency is scored per item below. */
const LINE_SCORERS: Readonly<Record<Exclude<ScoredCriterion, "consistency">, Scorer>> = {
  correctness: scoreCorrectness,
  hallucination: scoreHallucination,
  privacy: scorePrivacy,
  "query safety": scoreQuerySafety,
  "clinical caution": scoreClinicalCaution,
  readability: scoreReadability,
};

export type Outcome = Score | "error";

export type Tally = Readonly<Record<Outcome, number>>;

const EMPTY_TALLY: Tally = { pass: 0, fail: 0, human: 0, na: 0, error: 0 };

export type ModelKey = Readonly<{ provider: string; modelId: string }>;

export const modelName = (model: ModelKey): string =>
  `${model.provider}:${model.modelId}`;

/** One answered line with what each criterion said about it, for the review sheet. */
export type ScoredLine = Readonly<{
  line: ResultLine;
  item: Question;
  scores: Readonly<Record<ScoredCriterion, ScoreResult>>;
}>;

export type LatencyFigures = Readonly<{
  n: number;
  ttft: Readonly<{ p50: number | null; p90: number | null; p95: number | null }>;
  total: Readonly<{ p50: number | null; p90: number | null; p95: number | null }>;
}>;

export type ModelScores = Readonly<{
  model: ModelKey;
  lines: number;
  answered: number;
  errors: number;
  skipped: number;
  cacheHits: number;
  /** criterion → scenario → tally. */
  tallies: Readonly<Record<ScoredCriterion, Readonly<Record<Scenario, Tally>>>>;
  latency: Readonly<{ latencySet: LatencyFigures; overall: LatencyFigures }>;
  scored: readonly ScoredLine[];
}>;

export type RunInput = Readonly<{
  models: readonly ModelKey[];
  items: readonly Question[];
  entries: Readonly<Record<string, readonly KeyEntry[]>>;
  lines: readonly ResultLine[];
}>;

const add = (tally: Tally, outcome: Outcome): Tally => ({
  ...tally,
  [outcome]: tally[outcome] + 1,
});

type Event = Readonly<{
  criterion: ScoredCriterion;
  scenario: Scenario;
  outcome: Outcome;
}>;

const tallyEvents = (
  events: readonly Event[],
): Record<ScoredCriterion, Record<Scenario, Tally>> =>
  events.reduce(
    (acc, event) => ({
      ...acc,
      [event.criterion]: {
        ...acc[event.criterion],
        [event.scenario]: add(acc[event.criterion][event.scenario], event.outcome),
      },
    }),
    Object.fromEntries(
      SCORED_CRITERIA.map((criterion) => [
        criterion,
        Object.fromEntries(SCENARIOS.map((scenario) => [scenario, EMPTY_TALLY])),
      ]),
    ) as Record<ScoredCriterion, Record<Scenario, Tally>>,
  );

const figures = (lines: readonly ResultLine[]): LatencyFigures => {
  const timed = lines.filter((line) => isAnswered(line) && !line.cache_hit);
  const ttft = timed.flatMap((line) => (line.ttft_ms === null ? [] : [line.ttft_ms]));
  const total = timed.flatMap((line) => (line.total_ms === null ? [] : [line.total_ms]));
  const at = (values: readonly number[]) => ({
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
  });
  return { n: timed.length, ttft: at(ttft), total: at(total) };
};

const scoreModel = (input: RunInput, model: ModelKey): ModelScores => {
  const byItem = new Map(input.items.map((item) => [item.id, item]));
  const mine = input.lines.filter(
    (line) =>
      line.provider === model.provider &&
      line.model_id === model.modelId &&
      byItem.has(line.item_id),
  );
  const counted = mine.filter((line) => line.skipped === null);
  const repeatsOf = (itemId: string) => counted.filter((line) => line.item_id === itemId);

  const scored: ScoredLine[] = counted.flatMap((line) => {
    const item = byItem.get(line.item_id);
    if (!item || !isAnswered(line)) return [];
    const input_ = {
      item,
      keyEntries: input.entries[item.id] ?? [],
      line,
      repeats: repeatsOf(item.id),
    };
    const perLine = Object.fromEntries(
      Object.entries(LINE_SCORERS).map(([criterion, scorer]) => [
        criterion,
        scorer(input_),
      ]),
    ) as Record<Exclude<ScoredCriterion, "consistency">, ScoreResult>;
    return [
      { line, item, scores: { ...perLine, consistency: scoreConsistency(input_) } },
    ];
  });

  const lineEvents: Event[] = counted.flatMap((line) => {
    const item = byItem.get(line.item_id);
    if (!item) return [];
    const done = scored.find((entry) => entry.line === line);
    return SCORED_CRITERIA.filter((criterion) => criterion !== "consistency").map(
      (criterion) => ({
        criterion,
        scenario: item.scenario,
        outcome: done
          ? done.scores[criterion].score
          : applies(item, criterion)
            ? ("error" as const)
            : ("na" as const),
      }),
    );
  });

  const consistencyEvents: Event[] = [
    ...new Set(counted.map((line) => line.item_id)),
  ].flatMap((itemId) => {
    const item = byItem.get(itemId);
    if (!item) return [];
    const repeats = repeatsOf(itemId);
    const first = scored.find((entry) => entry.item.id === itemId);
    const outcome: Outcome =
      !applies(item, "consistency") || item.repeat < 2
        ? "na"
        : repeats.some((line) => !isAnswered(line))
          ? "error"
          : (first?.scores.consistency.score ?? "error");
    return [{ criterion: "consistency" as const, scenario: item.scenario, outcome }];
  });

  const latencySetIds = new Set(
    input.items
      .filter((item) => item.tags?.includes(LATENCY_SET_TAG))
      .map((item) => item.id),
  );
  return {
    model,
    lines: mine.length,
    answered: counted.filter(isAnswered).length,
    errors: counted.filter((line) => line.error !== null).length,
    skipped: mine.length - counted.length,
    cacheHits: counted.filter((line) => line.cache_hit).length,
    tallies: tallyEvents([...lineEvents, ...consistencyEvents]),
    latency: {
      latencySet: figures(counted.filter((line) => latencySetIds.has(line.item_id))),
      overall: figures(counted),
    },
    scored,
  };
};

export const scoreRun = (input: RunInput): ModelScores[] =>
  input.models.map((model) => scoreModel(input, model));

export const sumTallies = (tallies: readonly Tally[]): Tally =>
  tallies.reduce(
    (acc, tally) => ({
      pass: acc.pass + tally.pass,
      fail: acc.fail + tally.fail,
      human: acc.human + tally.human,
      na: acc.na + tally.na,
      error: acc.error + tally.error,
    }),
    EMPTY_TALLY,
  );
