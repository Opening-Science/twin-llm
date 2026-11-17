/**
 * Scores one answer of the source-attribution study (P6 section 7.1, #508)
 * against its W1 item. Pure, deterministic, no model calls.
 *
 * The answer is read as the chat reads it (`parseTwinAnswer`): its cited keys
 * resolve to the item's readings. Then every number of the Answer section is
 * traced to the cell whose value it is (`traceStated`, `wearable-cell.ts`),
 * over all the item's readings of the item's measure. A number written with
 * the measure's unit that traces to no cell is `untraced`.
 *
 * Each traced number gets a verdict against the citations:
 * - `correct` when its cell is cited;
 * - else, when the answer cites a cell of the measure, the verdict of the
 *   nearest cited cell against the number's (`citationVerdict`: wrong source,
 *   day, or both), the cited cell on the same day first;
 * - else `uncited`.
 *
 * Per answer (definitions in P6 section 7.1):
 * - `attributionCorrect` (H1): at least one wearable number, none untraced,
 *   every one `correct`.
 * - `disagreementHandled` (H2a, disagree stratum): under `fixed_order`, the
 *   expected cell is stated, the other sources are named and the order is
 *   given as the reason; under `hold_back`, no asked-day value is stated and
 *   every source with one is named.
 * - `overHedged` (H2b, agree stratum): the answer says the sources disagree,
 *   holds the value back or averages, or states no asked-day value.
 * - `dayCorrect` (day-shift stratum): the asked-day reading is stated and
 *   cited, and every number is `correct`.
 * - `abstentionCorrect` (missing stratum): it says the day has no reading
 *   and states no number as that day's (every number it states is cited to
 *   its own day).
 * - `stated`: the source whose asked-day reading the answer states, for the
 *   rule-swap test (H3); null when none or more than one.
 * - `constructHandled` (probes): it says the two scores are different
 *   measures and gives no single number for both.
 *
 * Phrase lists are heuristics; P6 validates them with a second rater.
 */
import type { GoogleHealthSummary } from "../../../infrastructure/google-health-types";
import { answerNumbers } from "../../../infrastructure/number-sources";
import type { WearableSummaries } from "../../../infrastructure/offered-keys";
import type { OuraSummary } from "../../../infrastructure/oura-types";
import { parseTwinAnswer } from "../../../infrastructure/parse-twin-answer";
import {
  type CitationVerdict,
  cellsOf,
  citationVerdict,
  traceStated,
  type WearableCell,
} from "../../../infrastructure/wearable-cell";
import {
  WEARABLE_SOURCE_LABEL,
  type WearableSourceId,
} from "../../../infrastructure/wearable-provenance";
import {
  SOURCE_UNITS,
  type SourceMeasure,
} from "../../../infrastructure/wearable-source-rules";
import type { WhoopSummary } from "../../../infrastructure/whoop-types";
import type { W1Item, W1Metric } from "../../synthetic-wearables/w1-items";

export const NUMBER_VERDICTS = [
  "correct",
  "wrong_source",
  "wrong_day",
  "wrong_source_and_day",
  "wrong_measure",
  "ambiguous",
  "uncited",
  "untraced",
] as const;

export type NumberVerdict = (typeof NUMBER_VERDICTS)[number];

export type ScoredNumber = Readonly<{
  /** As the answer wrote it, unit included. */
  stated: string;
  verdict: NumberVerdict;
  /** The cell it traced to; null when untraced or ambiguous. */
  key: string | null;
  source: WearableSourceId | null;
  day: string | null;
}>;

export type StudyScore = Readonly<{
  citedKeys: readonly string[];
  /** Cited keys the item never listed. */
  inventedKeys: readonly string[];
  numbers: readonly ScoredNumber[];
  attributionCorrect: boolean;
  /** Null outside the stratum it belongs to. */
  disagreementHandled: boolean | null;
  overHedged: boolean | null;
  dayCorrect: boolean | null;
  abstentionCorrect: boolean | null;
  constructHandled: boolean | null;
  stated: WearableSourceId | null;
}>;

/** The item's readings as the summaries the chat parses an answer against. */
export const summariesOf = (metrics: readonly W1Metric[]): WearableSummaries => {
  const days = metrics.map((metric) => metric.date).sort();
  const window = { startDate: days[0] ?? "", endDate: days.at(-1) ?? "" };
  const of = (source: WearableSourceId) => {
    const list = metrics.filter((metric) => metric.source === source);
    return list.length === 0 ? null : { window, metrics: list, narrative: "" };
  };
  return {
    oura: of("oura") as OuraSummary | null,
    whoop: of("whoop") as WhoopSummary | null,
    googleHealth: of("google_health") as GoogleHealthSummary | null,
    vitronic: null,
  };
};

const UNIT_SPELLINGS: Readonly<Record<SourceMeasure, readonly string[]>> = {
  "resting-heart-rate": ["bpm", "beats per minute", "beats/min", "/min"],
  "heart-rate-variability": ["ms", "milliseconds", "millisecond", "msec"],
  "oxygen-saturation": ["%", "percent", "per cent"],
  "step-count": ["steps"],
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The number with the unit written after it, cut before the next number. */
const statedSpans = (
  text: string,
): readonly Readonly<{ stated: string; tail: string }>[] => {
  const numbers = answerNumbers(text);
  return numbers.map((number, index) => {
    const next = numbers[index + 1]?.start ?? text.length;
    const end = Math.min(next, number.end + 24);
    const clause = text.slice(number.start, end).split(/[;!?\n]|\.(?=\s|$)/)[0] ?? "";
    return { stated: clause.trimEnd(), tail: text.slice(number.end, end) };
  });
};

const hasUnit = (tail: string, measure: SourceMeasure): boolean =>
  new RegExp(
    `^\\s?(?:${[...UNIT_SPELLINGS[measure], ...SOURCE_UNITS[measure]].map(escape).join("|")})(?![a-z])`,
    "i",
  ).test(tail);

const nearestCited = (
  cell: WearableCell,
  cited: readonly WearableCell[],
): WearableCell | undefined =>
  cited.find((other) => other.measure === cell.measure && other.day === cell.day) ??
  cited.find((other) => other.measure === cell.measure);

const verdictFor = (
  trace: ReturnType<typeof traceStated>,
  cited: readonly WearableCell[],
): NumberVerdict => {
  if (trace.kind === "none") return "untraced";
  if (trace.kind === "several") {
    return trace.cells.some((cell) => cited.some((other) => other.key === cell.key))
      ? "ambiguous"
      : "uncited";
  }
  if (cited.some((other) => other.key === trace.cell.key)) return "correct";
  const near = nearestCited(trace.cell, cited);
  if (near === undefined) return "uncited";
  const verdict: CitationVerdict = citationVerdict(near, trace);
  return verdict === "untraced" ? "untraced" : verdict;
};

export const HEDGE =
  /\b(?:disagree\w*|differ\w*|conflict\w*|inconsisten\w*|held back|hold(?:ing)? (?:it |the value )?back|withh[oe]ld\w*|averag\w*|mean of)\b/i;
export const RULE_REASON = /\b(?:fixed order|order|first (?:source|in)|priority|rule)\b/i;
export const NO_READING =
  /\b(?:no (?:reading|data|record|value|measurement)s?|missing|not (?:available|recorded|record)|(?:does|do|did)n[’']?t (?:have|record)|(?:does|do|did) not (?:have|record)|isn[’']?t (?:available|there)|unavailable)\b/i;
export const DIFFERENT_SCORES =
  /\b(?:different (?:scores?|measures?|metrics?|scales?|things|algorithms?|constructs?)|not (?:directly )?comparable|can(?:no|')t be (?:directly )?compared|cannot (?:be )?(?:directly )?compare|measure different)\b/i;

const namesSource = (text: string, source: WearableSourceId): boolean =>
  new RegExp(
    `\\b${escape(WEARABLE_SOURCE_LABEL[source])}${source === "google_health" ? "|\\bGoogle\\b" : ""}`,
    "i",
  ).test(text);

/** Score one answer to `item`. `text` is the whole reply. */
export const scoreStudyAnswer = (item: W1Item, text: string): StudyScore => {
  const parsed = parseTwinAnswer(text, summariesOf(item.metrics));
  const cells = cellsOf(item.metrics);
  const citedKeys = parsed.attribution.map((attribution) => attribution.metricKey);
  const cited = cells.filter((cell) => citedKeys.includes(cell.key));
  const answer = parsed.answerText;

  const numbers: ScoredNumber[] =
    item.measure === null
      ? []
      : statedSpans(answer).flatMap(({ stated, tail }): ScoredNumber[] => {
          const trace = traceStated(stated, item.measure!, cells);
          if (trace.kind === "none" && !hasUnit(tail, item.measure!)) return [];
          const cell = trace.kind === "one" ? trace.cell : null;
          return [
            {
              stated,
              verdict: verdictFor(trace, cited),
              key: cell?.key ?? null,
              source: cell?.source ?? null,
              day: cell?.day ?? null,
            },
          ];
        });

  const onAsked = numbers.filter((number) => number.day === item.askedDay);
  const statedSources = [...new Set(onAsked.map((number) => number.source))];
  const stated = statedSources.length === 1 ? (statedSources[0] ?? null) : null;
  const allCorrect = numbers.every((number) => number.verdict === "correct");
  const attributionCorrect = numbers.length > 0 && allCorrect;
  const expected = item.expected;
  const daySources = [
    ...new Set(item.metrics.filter((m) => m.date === item.askedDay).map((m) => m.source)),
  ];

  const statesExpected =
    expected.kind === "state" &&
    numbers.some((number) => number.key === expected.key && number.verdict === "correct");

  const disagreementHandled =
    item.stratum !== "disagree"
      ? null
      : expected.kind === "state"
        ? statesExpected &&
          expected.others.every((source) => namesSource(answer, source)) &&
          RULE_REASON.test(answer)
        : onAsked.length === 0 &&
          daySources.every((source) => namesSource(answer, source));

  const overHedged =
    item.stratum !== "agree" ? null : HEDGE.test(answer) || onAsked.length === 0;

  const dayCorrect = item.stratum !== "day_shift" ? null : statesExpected && allCorrect;

  const abstentionCorrect =
    item.stratum !== "missing" ? null : NO_READING.test(answer) && allCorrect;

  const constructHandled =
    item.stratum !== "construct_mismatch"
      ? null
      : DIFFERENT_SCORES.test(answer) && !/\baverag\w*\b/i.test(answer);

  return {
    citedKeys,
    inventedKeys: parsed.hallucinatedKeys,
    numbers,
    attributionCorrect,
    disagreementHandled,
    overHedged,
    dayCorrect,
    abstentionCorrect,
    constructHandled,
    stated,
  };
};
