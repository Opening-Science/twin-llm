import { metricLabel } from "@/infrastructure/format-measure";
import {
  type NumberReview,
  NUMBER_REVIEWER,
  reviewItemLine,
  reviewStepLabel,
} from "@/infrastructure/number-review";
import type { StepState, TraceState } from "@/infrastructure/ui-kit/step-trace-model";

import type { AnswerStatus } from "./conversation";
import { RANGE_DASH, type ToolCard, type ToolCardState } from "./tool-cards";

/**
 * An answer's tool calls as steps of a step trace: what each call is doing,
 * in plain words with its measure and window ("Drawing heart rate (8867-4),
 * 1 Jan 2024 to 31 Dec 2025"). A LOINC code is named by the data itself: the
 * display a call's output gave it (`measureNameOf`), shared by every call of
 * the answer that asked for the same code, with the code in brackets; with no
 * name known the code stands alone. A wearable key gets its metric label. A
 * refused call reads "No data: <code>"; the card under it keeps the fixed
 * sentence for the code. Built from the same cards a saved answer stores, so a
 * reload says the same thing.
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

/** `heart rate (8867-4)`; the code alone when no call named it; a key's label. */
const measureText = (code: string, names: ReadonlyMap<string, string>): string => {
  if (code.includes(",")) return code;
  const name = names.get(code);
  if (LOINC.test(code)) {
    return name === undefined || name === code ? code : `${sentenceCase(name)} (${code})`;
  }
  return name ?? metricLabel(code);
};

export const toolStepLabel = (
  card: ToolCard,
  names: ReadonlyMap<string, string> = measureNames([card]),
): string => {
  if (card.state === "refused") return `No data: ${card.refusalCode ?? "REFUSED"}`;
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

const STEP_STATES: Readonly<Record<ToolCardState, StepState>> = {
  running: "current",
  done: "done",
  refused: "skipped",
  error: "failed",
};

export const toolStepState = (card: ToolCard): StepState => STEP_STATES[card.state];

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
