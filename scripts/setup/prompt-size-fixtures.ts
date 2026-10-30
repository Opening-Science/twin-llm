/**
 * Made-up wearable summaries at the largest size the chat prompt carries, for
 * measuring it: every source linked, 80 metrics each (the narrative's line
 * cap), so the narrative lists 80 lines and the key list its 40-key cap.
 * Shaped like the summary builders' output; no real data.
 */
import type { WearableSummaries } from "../../infrastructure/offered-keys";
import {
  NOTE_LIMITS,
  type TwinNote,
  twinNotesBlock,
} from "../../infrastructure/twin-notes";
import { UI_CONTEXT_MAX_VIEWS, type UiContext } from "../../infrastructure/ui-context";

const DAYS = Array.from(
  { length: 8 },
  (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`,
);

type Family = Readonly<{ key: string; label: string; value: number; unit?: string }>;

type Metric = Readonly<{
  key: string;
  label: string;
  value: number;
  date: string;
  unit?: string;
}>;

const metricsOf = (families: readonly Family[]): readonly Metric[] =>
  families.flatMap((family) =>
    DAYS.map((day) => ({
      key: `${family.key}.${day}`,
      label: `${family.label} (${day})`,
      value: family.value,
      date: day,
      ...(family.unit === undefined ? {} : { unit: family.unit }),
    })),
  );

const narrativeOf = (header: readonly string[], metrics: readonly Metric[]): string =>
  [
    ...header,
    ...metrics
      .slice(0, 80)
      .map((m) => `- [${m.key}] ${m.label}: ${m.value}${m.unit ? ` ${m.unit}` : ""}`),
  ].join("\n");

const window = { startDate: DAYS[0] ?? "", endDate: DAYS.at(-1) ?? "" };
const cite = "Cite metrics by their [key] when they inform your answer.";

const OURA = metricsOf([
  { key: "sleep.score", label: "Sleep score", value: 82 },
  { key: "sleep.duration", label: "Sleep duration", value: 452, unit: "min" },
  { key: "sleep.hr", label: "Lowest sleeping heart rate", value: 51, unit: "bpm" },
  { key: "sleep.hrv", label: "Average sleeping HRV", value: 48, unit: "ms" },
  { key: "readiness.score", label: "Readiness score", value: 77 },
  {
    key: "readiness.temperature_deviation",
    label: "Temperature deviation",
    value: 0.1,
    unit: "deg",
  },
  { key: "activity.steps", label: "Steps", value: 8421 },
  { key: "activity.active_calories", label: "Active calories", value: 512, unit: "kcal" },
  { key: "spo2.average", label: "Average SpO2", value: 96.8, unit: "%" },
  { key: "vo2max.value", label: "VO2 max", value: 41, unit: "mL/kg/min" },
]);

const WHOOP = metricsOf([
  { key: "whoop.recovery.score", label: "Recovery score", value: 64, unit: "%" },
  { key: "whoop.recovery.rhr", label: "Resting heart rate", value: 54, unit: "bpm" },
  { key: "whoop.recovery.hrv_rmssd", label: "HRV (RMSSD)", value: 52.3, unit: "ms" },
  { key: "whoop.sleep.in_bed_min", label: "Time in bed", value: 471, unit: "min" },
  { key: "whoop.sleep.performance", label: "Sleep performance", value: 88, unit: "%" },
  {
    key: "whoop.sleep.respiratory_rate",
    label: "Respiratory rate",
    value: 15.2,
    unit: "rpm",
  },
  { key: "whoop.cycle.strain", label: "Day strain", value: 11.4 },
  { key: "whoop.cycle.kilojoules", label: "Energy", value: 9120, unit: "kJ" },
  { key: "whoop.workout.strain", label: "Workout strain", value: 9.8 },
  { key: "whoop.workout.zone_2_min", label: "Time in HR zone 2", value: 31, unit: "min" },
]);

const GOOGLE = metricsOf([
  { key: "google.steps", label: "Steps", value: 9012 },
  {
    key: "google.heart-rate.resting",
    label: "Resting heart rate",
    value: 56,
    unit: "bpm",
  },
  { key: "google.heart-rate-variability", label: "HRV", value: 44, unit: "ms" },
  { key: "google.oxygen-saturation", label: "SpO2", value: 97, unit: "%" },
  { key: "google.active-minutes", label: "Active minutes", value: 46, unit: "min" },
  { key: "google.distance", label: "Distance", value: 6.4, unit: "km" },
  { key: "google.weight", label: "Weight", value: 71.2, unit: "kg" },
  { key: "google.sleep.duration", label: "Sleep duration", value: 438, unit: "min" },
  { key: "google.sleep.efficiency", label: "Sleep efficiency", value: 91, unit: "%" },
  { key: "google.calories", label: "Calories", value: 2380, unit: "kcal" },
]);

const BODYLOOP: readonly Metric[] = Array.from({ length: 80 }, (_, index) => ({
  key: `vitronic.circumference.segment_${index + 1}`,
  label: `Circumference, segment ${index + 1}`,
  value: 30 + index,
  date: DAYS[0] ?? "",
  unit: "cm",
}));

export const WORST_CASE_WEARABLES: WearableSummaries = {
  oura: {
    window,
    metrics: OURA,
    narrative: narrativeOf(
      [`Oura wearable context for ${window.startDate} to ${window.endDate}.`, cite],
      OURA,
    ),
  },
  whoop: {
    window,
    metrics: WHOOP,
    narrative: narrativeOf(
      [`Whoop wearable context for ${window.startDate} to ${window.endDate}.`, cite],
      WHOOP,
    ),
  },
  googleHealth: {
    window,
    metrics: GOOGLE,
    narrative: narrativeOf(
      [
        `Google Health (Fitbit-linked) context for ${window.startDate} to ${window.endDate}.`,
        "Interval samples (e.g. minute steps) are summed into daily totals.",
        cite,
      ],
      GOOGLE,
    ),
  },
  vitronic: { window, metrics: BODYLOOP, narrative: "BodyLoop scan." },
};

export const ONE_WEARABLE: WearableSummaries = {
  oura: WORST_CASE_WEARABLES.oura,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

export const NO_WEARABLES: WearableSummaries = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

/**
 * The longest UI context block a turn can carry (#47): every part set, every
 * listed view at its cap. Every size case carries it, so the budget holds
 * with it.
 */
export const LONGEST_UI_CONTEXT: UiContext = {
  panels: ["outputs", "twin"],
  organ: "bloodvasculature",
  chart: {
    kind: "chart.timeseries",
    measure: "a".repeat(40),
    start: "2026-01-01",
    end: "2026-03-31",
  },
  views: Array.from({ length: UI_CONTEXT_MAX_VIEWS }, (_, index) => ({
    kind: "chart.timeseries" as const,
    measure: `${index}${"b".repeat(39)}`,
  })),
  viewCount: 9999,
};

/**
 * The twin notes that make the largest block (#43): made-up notes with
 * every part at its line limit, or many short ones.
 */
const fullLines = (count: number, word: string): string[] =>
  Array.from({ length: count }, (_, index) =>
    `${index} ${word.repeat(NOTE_LIMITS.line)}`.slice(0, NOTE_LIMITS.line),
  );

const LONGEST_NOTE: TwinNote = {
  id: "note-measure",
  title: "t".repeat(NOTE_LIMITS.title),
  topics: fullLines(NOTE_LIMITS.topics, "topic "),
  measures: fullLines(NOTE_LIMITS.measures, "measure "),
  openQuestions: fullLines(NOTE_LIMITS.openQuestions, "question "),
  dataMode: "synthetic",
  permit: "synthetic",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const SHORT_NOTES: readonly TwinNote[] = Array.from({ length: 30 }, (_, index) => ({
  ...LONGEST_NOTE,
  id: `note-${index}`,
  title: `Note ${index}`,
  topics: [`Topic ${index}`],
  measures: [`${index}-0 · trend · 1 Jan 2026 – 31 Mar 2026`],
  openQuestions: [`Question ${index}`],
}));

/**
 * Many short notes fill the budget more densely than one long one; the list
 * whose full block is longer wins. Each turn keeps as many as its room allows.
 */
export const LONGEST_TWIN_NOTES: readonly TwinNote[] = [
  [LONGEST_NOTE],
  SHORT_NOTES,
].reduce((longest, notes) =>
  twinNotesBlock(notes).text.length > twinNotesBlock(longest).text.length
    ? notes
    : longest,
);
