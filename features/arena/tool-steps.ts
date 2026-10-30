import { metricLabel } from "@/infrastructure/format-measure";
import type { StepState, TraceState } from "@/infrastructure/ui-kit/step-trace-model";

import type { AnswerStatus } from "./conversation";
import type { ToolCard, ToolCardState } from "./tool-cards";

/**
 * An answer's tool calls as steps of a step trace: what each call is doing,
 * in plain words with its measure and window ("Reading resting heart rate,
 * 4 Jul 2026 – 1 Oct 2026"). A refused call reads "No data: <code>"; the
 * card under it keeps the fixed sentence for the code. Built from the same
 * cards a saved answer stores, so a reload says the same thing.
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

/** One measure gets its label; a list stays as the model wrote it. */
const measureName = (card: ToolCard): string | null => {
  const measure = arg(card, "Measure");
  if (measure === null) return null;
  return measure.includes(",") ? measure : metricLabel(measure);
};

export const toolStepLabel = (card: ToolCard): string => {
  if (card.state === "refused") return `No data: ${card.refusalCode ?? "REFUSED"}`;
  const phrase = PHRASES[card.tool];
  const what = phrase ? phrase(measureName(card)) : card.title;
  const window = arg(card, "Window");
  return window === null ? what : `${what}, ${window}`;
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
