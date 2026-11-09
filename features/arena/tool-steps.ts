import { metricLabel } from "@/infrastructure/format-measure";
import {
  type NumberReview,
  NUMBER_REVIEWER,
  reviewItemLine,
  reviewStepLabel,
} from "@/infrastructure/number-review";
import type { StepState, TraceState } from "@/infrastructure/ui-kit/step-trace-model";

import type { AnswerStatus } from "./conversation";
import { catalogueMeasureName } from "./measure-names";
import { RANGE_DASH, type ToolCard, type ToolOutcome, toolOutcome } from "./tool-cards";
import { GENERIC_CODE_SENTENCE } from "./tool-code-sentences";

/**
 * An answer's tool calls as steps of a step trace: what each call is doing,
 * in plain words with its measure and window ("Drawing heart rate, 1 Jan 2024
 * to 31 Dec 2025"). A LOINC code is named in words, never shown as a number:
 * first by the data itself, the display a call's output gave it
 * (`measureNameOf`), shared by every call of the answer that asked for the
 * same code; then by the app's own tables (`measure-names.ts`); a code
 * neither names reads "this measure" (#537). A wearable key gets its metric
 * label. A refused call reads its code's plain sentence ("No readings in this
 * range" for `NO_ROWS`, `tool-code-sentences.ts`); its badge says whether it
 * ran and found nothing (No data) or a gate turned it away first (Refused,
 * not counted as a tool used). Codes show only in the card's fold-out. Built
 * from the same cards a saved answer stores, so a reload says the same thing.
 */

type Phrase = (measure: string | null) => string;

/** `before measure after`, or the fallback when the call named no measure. */
const of =
  (before: string, fallback: string, after = ""): Phrase =>
  (measure) =>
    measure === null ? fallback : `${before} ${measure}${after}`;

const PHRASES: Readonly<Record<string, Phrase>> = {
  list_subjects: () => "Listing cohort subjects",
  subject_window: () => "Checking a subject's date range",
  observations_for_subject: of("Reading", "Reading observations"),
  latest_by_loinc: of("Reading the latest", "Reading the latest values"),
  summary_stats: of("Summarising", "Summarising a measure"),
  trend: of("Fitting a trend of", "Fitting a trend"),
  baseline_deviation: of("Comparing", "Comparing with a baseline", " with a baseline"),
  coverage: of("Checking coverage of", "Checking data coverage"),
  compare_windows: of("Comparing two windows of", "Comparing two windows"),
  range_position: of(
    "Placing",
    "Placing a value against its published range",
    " against its published range",
  ),
  convert_unit: () => "Converting a unit",
  cohort_position: of(
    "Placing",
    "Placing a value among the synthetic cohort",
    " among the synthetic cohort",
  ),
  conditions_timeline: () => "Listing recorded conditions",
  medications_timeline: () => "Listing recorded medication requests",
  values_around_event: of(
    "Comparing",
    "Comparing values before and after an event",
    " before and after an event",
  ),
  show_view: of("Drawing", "Drawing a view"),
  list_views: () => "Listing this thread's views",
  open_view: () => "Reopening a view",
  sleep_summary: () => "Reading sleep per night",
  hrv_trend: () => "Reading HRV",
  resting_hr_trend: () => "Reading resting heart rate",
  training_load: () => "Reading workout minutes",
  cross_source_compare: of(
    "Comparing",
    "Comparing two wearables",
    " across two wearables",
  ),
  rhythm_irregularity: () => "Reading a simulated heart rhythm recording",
};

const arg = (card: ToolCard, label: string): string | null =>
  card.args.find((item) => item.label === label)?.value ?? null;

const LOINC = /^\d{1,7}-\d$/;

/** Code to display name, from every call of the answer whose output named it. */
export const measureNames = (cards: readonly ToolCard[]): ReadonlyMap<string, string> =>
  new Map(
    cards.flatMap((card) => {
      const code = arg(card, "Measure");
      return code !== null && card.measureName !== undefined
        ? [[code, card.measureName] as const]
        : [];
    }),
  );

/** `Heart rate` reads `heart rate` mid-sentence; `HbA1c` and `LDL` stay as they are. */
const sentenceCase = (name: string): string =>
  /^[A-Z][a-z]*(\s|$)/.test(name)
    ? `${name.charAt(0).toLowerCase()}${name.slice(1)}`
    : name;

/** What a step says for a code nobody named, and for a list none of whose codes is named. */
export const UNKNOWN_MEASURE = "this measure";
const UNKNOWN_MEASURES = "these measures";

/** One code or key in words: `heart rate`, `HbA1c`, a key's label; null when unknown. */
const nameOf = (code: string, names: ReadonlyMap<string, string>): string | null => {
  if (!LOINC.test(code)) return names.get(code) ?? metricLabel(code);
  const name = names.get(code) ?? catalogueMeasureName(code);
  return name === null || name === undefined || name === code || LOINC.test(name)
    ? null
    : sentenceCase(name);
};

const others = (count: number): string =>
  count === 1 ? "one other measure" : `${String(count)} other measures`;

const joined = (parts: readonly string[]): string =>
  parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;

/**
 * The asked measure in words, never its code: one name, or a list of names
 * with the unnamed ones counted (`heart rate and one other measure`); null
 * when none of its codes is named.
 */
export const namedMeasure = (
  measure: string,
  names: ReadonlyMap<string, string> = new Map(),
): string | null => {
  const codes = measure
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  const named = codes.flatMap((code) => nameOf(code, names) ?? []);
  const unnamed = codes.length - named.length;
  if (named.length === 0) return null;
  return joined(unnamed === 0 ? named : [...named, others(unnamed)]);
};

/** `namedMeasure`, or "this measure" ("these measures") when nothing names it. */
const measureText = (measure: string, names: ReadonlyMap<string, string>): string =>
  namedMeasure(measure, names) ??
  (measure.includes(",") ? UNKNOWN_MEASURES : UNKNOWN_MEASURE);

export const toolStepLabel = (
  card: ToolCard,
  names: ReadonlyMap<string, string> = measureNames([card]),
): string => {
  if (card.state === "refused") return card.note ?? GENERIC_CODE_SENTENCE;
  const phrase = PHRASES[card.tool];
  const code = arg(card, "Measure");
  const what = phrase
    ? phrase(code === null ? null : measureText(code, names))
    : card.title;
  const window = arg(card, "Window")?.replace(RANGE_DASH, " to ") ?? null;
  return window === null ? what : `${what}, ${window}`;
};

/** Every card's step line, naming each code from all of the answer's calls. */
export const toolStepLabels = (cards: readonly ToolCard[]): string[] => {
  const names = measureNames(cards);
  return cards.map((card) => toolStepLabel(card, names));
};

const STEP_STATES: Readonly<Record<ToolOutcome, StepState>> = {
  running: "current",
  done: "done",
  "no-data": "skipped",
  refused: "refused",
  error: "failed",
};

/** A call refused before it ran is `refused`; one that ran and found nothing, `skipped`. */
export const toolStepState = (card: ToolCard): StepState =>
  STEP_STATES[toolOutcome(card)];

/** The trace settles when the answer does; a failed answer stops it. */
export const answerTraceState = (status: AnswerStatus): TraceState =>
  status === "STREAMING" ? "working" : status === "COMPLETE" ? "done" : "failed";

/** The Ultra number check as one more step of the trace (#366). */
export type ReviewStep = Readonly<{
  label: string;
  state: StepState;
  /** One line per number checked, then a note on numbers left out. */
  lines: readonly string[];
}>;

/** While it runs, the step in progress; once back, its count and a line per number. */
export const reviewStep = (
  reviewing: boolean,
  review: NumberReview | null | undefined,
): ReviewStep | null => {
  if (review !== null && review !== undefined) {
    return {
      label: reviewStepLabel(review),
      state: review.status === "failed" ? "failed" : "done",
      lines: [
        ...(review.refusal === undefined ? [] : [review.refusal]),
        ...review.items.map(reviewItemLine),
        ...(review.skipped > 0
          ? [`${String(review.skipped)} more numbers were not checked.`]
          : []),
        `Checked by ${NUMBER_REVIEWER.name}, a model that can be wrong.`,
      ],
    };
  }
  return reviewing
    ? {
        label: "Checking each number against the tool results",
        state: "current",
        lines: [],
      }
    : null;
};
