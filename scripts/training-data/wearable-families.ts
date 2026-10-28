/**
 * Wearable tool families (#210, sleep and trainer tracks): `sleep_summary`,
 * `hrv_trend`, `resting_hr_trend` and `training_load` on a synthetic
 * subject's synthetic series (`scripts/synthetic-wearables`), and their
 * refusals: WINDOW_TOO_SHORT for a window of a few days, NO_ROWS for a window
 * before the series. Every number in an answer is one the real tool returned
 * (its maths is `packages/query-tools/wearable-analytics.ts`), formatted.
 * Pure apart from `run`.
 */
import { formatNumber } from "../../infrastructure/format-measure";
import { isToolRefusal } from "../../packages/query-tools/refusals";
import { pick, type Random } from "../synthetic-wearables/random";

import {
  asked,
  dayEnd,
  dayStart,
  type Draft,
  type Family,
  type FamilyContext,
  field,
  num,
  sections,
  shiftDay,
  span,
  str,
  SYNTHETIC_NOTE,
  type ToolName,
  type Window,
} from "./family-kit";
import { formatChange, formatCount, formatDay, formatValue } from "./format";
import { type Asked, type Bank, askDay, askFrom } from "./questions";

/** Placeholders: {ref} {start} {end} {label}. */
export const WEARABLE_BANK = {
  sleepSummary: {
    formal: [
      "How did subject {ref} sleep between {start} and {end}?",
      "Summarise the nights of subject {ref} from {start} to {end}.",
    ],
    casual: [
      "how's {ref} been sleeping, {start} to {end}?",
      "{ref}'s sleep {start} – {end}?",
    ],
    terse: [
      "sleep summary {ref} {start} – {end}",
      "nights, subject {ref}, {start} to {end}",
    ],
    non_native: [
      "How was the sleep of subject {ref} from {start} until {end}?",
      "Please tell me the sleeping of subject {ref} between {start} and {end}.",
    ],
  },
  wearableTrend: {
    formal: [
      "Which way did {label} move for subject {ref} from {start} to {end}?",
      "How does the last week of {label} for subject {ref} compare with the four weeks before, up to {end}?",
    ],
    casual: [
      "is {ref}'s {label} going up or down, {start} to {end}?",
      "{label} for {ref} lately? {start} through {end}",
    ],
    terse: [
      "{label} trend {ref} {start} – {end}",
      "{label}, subject {ref}, {start} to {end}",
    ],
    non_native: [
      "How is changing the {label} of subject {ref} between {start} and {end}?",
      "Please say the direction of {label} for subject {ref} from {start} until {end}.",
    ],
  },
  trainingLoad: {
    formal: [
      "How much did subject {ref} train between {start} and {end}?",
      "Report the workouts of subject {ref} from {start} to {end}.",
    ],
    casual: [
      "how much has {ref} been working out, {start} to {end}?",
      "{ref}'s training load {start} – {end}?",
    ],
    terse: [
      "training load {ref} {start} – {end}",
      "workouts, subject {ref}, {start} to {end}",
    ],
    non_native: [
      "How many training did subject {ref} make between {start} and {end}?",
      "Please show the workouts of subject {ref} from {start} until {end}.",
    ],
  },
} as const satisfies Readonly<Record<string, Bank>>;

type TrendTool = "hrv_trend" | "resting_hr_trend";

const TREND_LABELS: Readonly<
  Record<TrendTool, Readonly<{ label: string; decimals: number }>>
> = {
  hrv_trend: { label: "HRV (RMSSD)", decimals: 1 },
  resting_hr_trend: { label: "resting heart rate", decimals: 1 },
};

/** The last `n` days of the series, ending on its last day. */
export const lastDays = (anchorDay: string, n: number): Window => ({
  start: dayStart(shiftDay(anchorDay, -(n - 1))),
  end: dayEnd(anchorDay),
});

/** A whole month in the year before the series, which holds no synthetic reading. */
export const monthBefore = (random: Random, anchorDay: string): Window => {
  const year = Number(anchorDay.slice(0, 4)) - 1;
  const month = 1 + Math.floor(random() * 12);
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: dayStart(`${year}-${mm}-01`), end: dayEnd(`${year}-${mm}-${last}`) };
};

const askWindow = (
  context: FamilyContext,
  slot: keyof typeof WEARABLE_BANK,
  window: Window,
  label = "",
): Asked =>
  askFrom(WEARABLE_BANK, context.random, slot, {
    ref: context.subjectRef,
    label,
    start: askDay(context.random, window.start),
    end: askDay(context.random, window.end),
  });

const sourceOf = (result: unknown): unknown => {
  const sources = field(result, "sources");
  return Array.isArray(sources) ? (sources[0] as unknown) : undefined;
};

/** The answer for a wearable tool's refusal, or null when the result is not one. */
const wearableRefusal = (
  result: unknown,
  tool: ToolName,
  label: string,
  subjectRef: string,
  window: Window,
): Pick<Draft, "reply" | "outcome"> | null => {
  if (!isToolRefusal(result)) return null;
  const asked = `I called \`${tool}\` for subject ${subjectRef}, source all, from ${span(window)}.`;
  if (result.code === "NO_ROWS") {
    return {
      outcome: "no_rows",
      reply: sections(
        `${asked} The tool refused with NO_ROWS: the synthetic series has no ${label} reading in that window.`,
        `There is no ${label} data for subject ${subjectRef} from ${span(window)}, so there is nothing to summarise. I will not fill the gap from other days.`,
        `No rows is not the same as a value of zero. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  if (result.code === "WINDOW_TOO_SHORT") {
    const counts = field(result, "counts");
    const n = Array.isArray(counts) ? (num(counts[0], "n") ?? 0) : 0;
    const minimum = num(result, "minimum") ?? 7;
    return {
      outcome: "WINDOW_TOO_SHORT",
      reply: sections(
        `${asked} The tool refused with WINDOW_TOO_SHORT: it found ${formatCount(n)} daily ${n === 1 ? "reading" : "readings"}, and a trend needs at least ${formatCount(minimum)}.`,
        `${formatCount(n)} ${n === 1 ? "day is" : "days are"} too few to say which way ${label} moved for subject ${subjectRef}. A window of a few weeks would work.`,
        `With so few readings any direction would be a guess. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  return {
    outcome: result.code === "MIXED_UNITS" ? "MIXED_UNITS" : "SUBJECT_SCOPE_VIOLATION",
    reply: sections(
      `${asked} The tool refused with ${result.code}.`,
      `I cannot report ${label} for subject ${subjectRef} from ${span(window)}: the tool refused the read, and I will not guess a value.`,
      `Nothing was computed. ${SYNTHETIC_NOTE}`,
    ),
  };
};

/** `sleep_summary` over a window; `before` asks about a month before the series (NO_ROWS). */
export const sleepSummaryDraft = async (
  context: FamilyContext,
  family: Family,
  before: boolean,
): Promise<Draft | null> => {
  if (!before && !context.hasWearables) return null;
  const window = before
    ? monthBefore(context.random, context.anchorDay)
    : lastDays(context.anchorDay, pick(context.random, [7, 14, 28, 30] as const));
  const question = askWindow(context, "sleepSummary", window);
  const args = { subject_ref: context.subjectRef, source: "all", ...window };
  const result = await context.run("sleep_summary", args);
  const base = {
    family,
    ...asked(question),
    measureLoinc: "93832-4",
    subjectRef: context.subjectRef,
    calls: [{ name: "sleep_summary", args, result }],
  } as const;
  const refused = wearableRefusal(
    result,
    "sleep_summary",
    "sleep",
    context.subjectRef,
    window,
  );
  if (refused) return { ...base, ...refused };
  const source = sourceOf(result);
  const nights = num(source, "nights") ?? 0;
  const duration = num(source, "mean_duration_min");
  const score = num(source, "mean_score");
  const scoreName = str(source, "score_name") ?? "sleep score";
  const scoreUnit = str(source, "score_unit");
  return {
    ...base,
    outcome: "answered",
    reply: sections(
      `I called \`sleep_summary\` for subject ${context.subjectRef}, source all, from ${span(window)}. It returned ${formatCount(nights)} ${nights === 1 ? "night" : "nights"} from the synthetic series, with the mean duration and the mean ${scoreName}.`,
      `Subject ${context.subjectRef} has ${formatCount(nights)} recorded ${nights === 1 ? "night" : "nights"} from ${span(window)}. Mean sleep duration was ${formatValue(duration, "min", 0)}, and the mean ${scoreName} was ${formatValue(score, scoreUnit, 0)}.`,
      `Averages hide night-to-night swings, and nights without a reading are left out, not counted as zero. The score is the generator's own synthetic score, not a vendor's. ${SYNTHETIC_NOTE}`,
    ),
  };
};

/** `hrv_trend` or `resting_hr_trend`; `days` decides the window, `before` puts it before the series. */
export const wearableTrendDraft = async (
  context: FamilyContext,
  family: Family,
  tool: TrendTool,
  window: Window,
): Promise<Draft> => {
  const { label, decimals } = TREND_LABELS[tool];
  const question = askWindow(context, "wearableTrend", window, label);
  const args = { subject_ref: context.subjectRef, source: "all", ...window };
  const result = await context.run(tool, args);
  const base = {
    family,
    ...asked(question),
    measureLoinc: tool === "resting_hr_trend" ? "40443-4" : null,
    subjectRef: context.subjectRef,
    calls: [{ name: tool, args, result }],
  } as const;
  const refused = wearableRefusal(result, tool, label, context.subjectRef, window);
  if (refused) return { ...base, ...refused };
  const source = sourceOf(result);
  const n = num(source, "n") ?? 0;
  const unit = str(source, "unit");
  const perWeek = num(source, "slope_per_week");
  const recent = field(source, "recent");
  const baseline = field(source, "baseline");
  const z = num(source, "robust_z");
  const direction =
    perWeek === null ? null : perWeek > 0 ? "upward" : perWeek < 0 ? "downward" : "flat";
  const slopeText =
    perWeek === null
      ? `there are too few readings in the window for a slope`
      : `the fitted slope is ${formatChange(perWeek, unit, decimals)} per week (${direction})`;
  const compared = `The median of the 7 days to ${formatDay(str(recent, "end"))} was ${formatValue(num(recent, "median"), unit, decimals)}, against ${formatValue(num(baseline, "median"), unit, decimals)} in the 28 days before${z === null ? "" : ` (robust z ${formatNumber(z, 2)})`}.`;
  return {
    ...base,
    outcome: "answered",
    reply: sections(
      `I called \`${tool}\` for subject ${context.subjectRef}, source all, from ${span(window)}. It read ${formatCount(n)} daily ${n === 1 ? "reading" : "readings"} from the synthetic series, fitted a least-squares line and compared the last 7 days with the 28 before them.`,
      `Over ${formatCount(n)} daily readings of ${label} for subject ${context.subjectRef}, ${slopeText}. ${compared}`,
      `A slope and a z score describe direction and distance from the subject's own recent level only; they say nothing about health or cause. ${SYNTHETIC_NOTE}`,
    ),
  };
};

/** `training_load` per day or week over a window. */
export const trainingLoadDraft = async (
  context: FamilyContext,
  family: Family,
  window: Window,
): Promise<Draft> => {
  const aggregation = context.random() < 0.5 ? "week" : "day";
  const question = askWindow(context, "trainingLoad", window);
  const args = { subject_ref: context.subjectRef, source: "all", ...window, aggregation };
  const result = await context.run("training_load", args);
  const base = {
    family,
    ...asked(question),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [{ name: "training_load", args, result }],
  } as const;
  const refused = wearableRefusal(
    result,
    "training_load",
    "workout",
    context.subjectRef,
    window,
  );
  if (refused) return { ...base, ...refused };
  const source = sourceOf(result);
  const sessions = num(source, "sessions") ?? 0;
  const minutes = num(source, "minutes") ?? 0;
  const load = field(source, "recent_load");
  const recent = field(load, "recent");
  const previous = field(load, "previous");
  const ratio = num(load, "ratio");
  const periods = field(result, "periods");
  const bySport = new Map<string, number>();
  for (const row of Array.isArray(periods) ? (periods as unknown[]) : []) {
    const sport = str(row, "sport_group") ?? "other";
    bySport.set(sport, (bySport.get(sport) ?? 0) + (num(row, "minutes") ?? 0));
  }
  const sports = [...bySport.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([sport, total]) => `${sport} ${formatValue(total, "min", 0)}`)
    .join(", ");
  const ratioText =
    ratio === null
      ? "There is no ratio, because the four weeks before have no workout minutes."
      : `Recent load compared with the previous four weeks: ${formatNumber(ratio, 2)}.`;
  return {
    ...base,
    outcome: "answered",
    reply: sections(
      `I called \`training_load\` for subject ${context.subjectRef}, source all, from ${span(window)}, one row per ${aggregation}. It returned the synthetic series' workouts and the minutes in the 7 days to ${formatDay(str(recent, "end"))} against the 28 days before.`,
      `Subject ${context.subjectRef} has ${formatCount(sessions)} ${sessions === 1 ? "workout" : "workouts"} from ${span(window)}, ${formatValue(minutes, "min", 0)} in all (${sports}). In the 7 days to ${formatDay(str(recent, "end"))}: ${formatValue(num(recent, "minutes"), "min", 0)}; in the 28 days before: ${formatValue(num(previous, "minutes"), "min", 0)}. ${ratioText}`,
      `These are minutes of synthetic workouts. They describe how much was recorded, not fitness, and they are no training advice. ${SYNTHETIC_NOTE}`,
    ),
  };
};

const TREND_DAYS = [28, 42, 60, 90] as const;
const LOAD_DAYS = [28, 42, 56] as const;

export const hrvTrend = (context: FamilyContext): Promise<Draft | null> =>
  context.hasWearables
    ? wearableTrendDraft(
        context,
        "hrv_trend",
        "hrv_trend",
        lastDays(context.anchorDay, pick(context.random, TREND_DAYS)),
      )
    : Promise.resolve(null);

export const restingHrTrend = (context: FamilyContext): Promise<Draft | null> =>
  context.hasWearables
    ? wearableTrendDraft(
        context,
        "resting_hr_trend",
        "resting_hr_trend",
        lastDays(context.anchorDay, pick(context.random, TREND_DAYS)),
      )
    : Promise.resolve(null);

export const trainingLoad = (context: FamilyContext): Promise<Draft | null> =>
  context.hasWearables
    ? trainingLoadDraft(
        context,
        "training_load",
        lastDays(context.anchorDay, pick(context.random, LOAD_DAYS)),
      )
    : Promise.resolve(null);

/** A trend over the last 3 to 5 days: too few readings, WINDOW_TOO_SHORT. */
export const wearableTooShort = (context: FamilyContext): Promise<Draft | null> => {
  if (!context.hasWearables) return Promise.resolve(null);
  const tool = pick(context.random, ["hrv_trend", "resting_hr_trend"] as const);
  const days = 3 + Math.floor(context.random() * 3);
  return wearableTrendDraft(
    context,
    "wearable_too_short",
    tool,
    lastDays(context.anchorDay, days),
  );
};

/** A month before the series: NO_ROWS from a trend or the training load. */
export const wearableNoRows = (context: FamilyContext): Promise<Draft> => {
  const tool = pick(context.random, [
    "hrv_trend",
    "resting_hr_trend",
    "training_load",
  ] as const);
  const window = monthBefore(context.random, context.anchorDay);
  return tool === "training_load"
    ? trainingLoadDraft(context, "wearable_no_rows", window)
    : wearableTrendDraft(context, "wearable_no_rows", tool, window);
};

export const sleepSummary = (context: FamilyContext): Promise<Draft | null> =>
  sleepSummaryDraft(context, "sleep_summary", false);

export const sleepNoRows = (context: FamilyContext): Promise<Draft | null> =>
  sleepSummaryDraft(context, "sleep_no_rows", true);
