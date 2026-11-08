import { DISPLAY_LOCALE, roundTo } from "@/infrastructure/format-measure";

/**
 * The one sentence at the top of a wearables card: what the chart under it shows.
 *
 * Templates T1 to T6 of the design board's insight copy rules: second person,
 * one sentence, a full stop and no exclamation mark, the fact before the
 * comparison, units spelled out. TwinLLM describes and never judges, praises or
 * advises, so the board's warm closes ("Nice work.") are left out on purpose.
 *
 * A missing value gives `null`, never a sentence about 0. Pure, so client cards
 * and tests share it; the locale is a parameter for the tests, and the app
 * passes nothing and gets `en-GB` like every other number it shows.
 */

/** The metrics a card can describe so far. */
export type InsightMetric =
  | "steps"
  | "sleepDuration"
  | "restingHeartRate"
  | "heartRate"
  | "hrv"
  | "readiness"
  | "recovery"
  | "sleepScore"
  | "activityScore"
  | "sleepPerformance"
  | "sleepingHeartRate"
  | "timeInBed"
  | "bedtime";

/** Stored metric stems (as in `infrastructure/format-measure.ts`) and the insight metric they read as. */
export const INSIGHT_METRIC_BY_STEM: Readonly<Record<string, InsightMetric>> = {
  "activity.steps": "steps",
  "google.steps": "steps",
  "sleep.duration": "sleepDuration",
  "google.daily-resting-heart-rate": "restingHeartRate",
  "whoop.recovery.rhr": "restingHeartRate",
  "google.heart-rate": "heartRate",
  "sleep.hrv": "hrv",
  "whoop.recovery.hrv": "hrv",
  "google.daily-heart-rate-variability": "hrv",
  "readiness.score": "readiness",
  "whoop.recovery.score": "recovery",
  "sleep.score": "sleepScore",
  "activity.score": "activityScore",
  "whoop.sleep.performance": "sleepPerformance",
  "sleep.hr": "sleepingHeartRate",
  "whoop.sleep.in_bed_min": "timeInBed",
};

type Value = number | null | undefined;

/** T1: today against the person's usual value. `tolerance` is a share of usual (0.05 is 5%). */
export type TodayData = Readonly<{
  template: "today";
  today: Value;
  usual: Value;
  tolerance?: number;
}>;

/**
 * T1 for a whole day: the latest finished day's total against the usual
 * daily total. For a dashboard that holds one value per day, where "by this
 * time of day" would compare a finished day with nothing.
 */
export type DayData = Readonly<{
  template: "day";
  day: Value;
  usual: Value;
  tolerance?: number;
}>;

/** T2: the average over the last 7 days. Sleep is in minutes. */
export type WeeklyData = Readonly<{ template: "weekly"; average: Value }>;

/** T3: this month's average against last month's. */
export type MonthlyData = Readonly<{
  template: "monthly";
  thisMonth: Value;
  lastMonth: Value;
  tolerance?: number;
}>;

/** T4: days in the last 4 weeks at or over a threshold. */
export type StreakDaysData = Readonly<{
  template: "streak";
  per: "days";
  threshold: number;
  count: Value;
}>;

/** T4: nights out of the last `total` at or over a threshold (minutes for sleep). */
export type StreakNightsData = Readonly<{
  template: "streak";
  per: "nights";
  threshold: number;
  count: Value;
  total: number;
}>;

export type SessionNoun = "walk" | "run" | "ride" | "swim" | "workout";

type RangeContext = Readonly<{ during: "session"; session: SessionNoun }> | "sleep";

/** T5: lowest and highest value during one session or one night. */
export type RangeData<C extends RangeContext = RangeContext> = Readonly<{
  template: "range";
  context: C;
  min: Value;
  max: Value;
}>;

/** T6: last night's bedtime against the usual one, both in minutes after midnight. */
export type TargetData = Readonly<{
  template: "target";
  actual: Value;
  usual: Value;
  windowMinutes: number;
}>;

/** Which templates each metric takes; anything else does not compile. */
export type InsightDataFor = {
  steps: TodayData | DayData | WeeklyData | MonthlyData | StreakDaysData;
  sleepDuration: TodayData | WeeklyData | MonthlyData | StreakNightsData;
  restingHeartRate: TodayData | WeeklyData | MonthlyData;
  heartRate: WeeklyData | MonthlyData | RangeData;
  hrv: TodayData | WeeklyData | MonthlyData | RangeData<"sleep">;
  readiness: TodayData | WeeklyData | MonthlyData;
  recovery: TodayData | WeeklyData | MonthlyData;
  sleepScore: TodayData | WeeklyData | MonthlyData;
  activityScore: TodayData | WeeklyData | MonthlyData;
  sleepPerformance: TodayData | WeeklyData | MonthlyData;
  sleepingHeartRate: TodayData | WeeklyData | MonthlyData;
  timeInBed: TodayData | WeeklyData | MonthlyData;
  bedtime: TargetData;
};

type AnyData = InsightDataFor[InsightMetric];

export const DEFAULT_TOLERANCE = 0.05;

const MINUTES_PER_DAY = 24 * 60;

const present = (value: Value): value is number =>
  typeof value === "number" && Number.isFinite(value);

const formatNumber = (value: number, decimals: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(roundTo(value, decimals));

/** "1 beat per minute", "54 beats per minute", "7,860 steps". */
const counted = (
  value: number,
  decimals: number,
  [one, many]: readonly [string, string],
  locale: string,
): string => {
  const text = formatNumber(value, decimals, locale);
  return `${text} ${roundTo(value, decimals) === 1 ? one : many}`;
};

/** Minutes as "7 hr 24 min", "7 hr" or "45 min". */
export const formatDuration = (
  minutes: number,
  locale: string = DISPLAY_LOCALE,
): string => {
  const total = roundTo(Math.abs(minutes), 0);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  const hr = `${formatNumber(hours, 0, locale)} hr`;
  return rest === 0 ? hr : `${hr} ${rest} min`;
};

/** A threshold in words: "7 hours", "1 hour", or "7 hr 30 min" when it is not whole. */
const durationThreshold = (minutes: number, locale: string): string => {
  const total = roundTo(Math.abs(minutes), 0);
  return total % 60 === 0
    ? counted(total / 60, 0, ["hour", "hours"], locale)
    : formatDuration(total, locale);
};

type Band = "below" | "about" | "above";

/** Inclusive: a value exactly on the tolerance edge is still "about". */
const band = (value: number, reference: number, tolerance: number): Band => {
  const allowed = Math.abs(reference) * Math.max(0, tolerance);
  const gap = value - reference;
  // Absorbs floating error, so 105 against 100 at 5% stays on the edge.
  if (Math.abs(gap) <= allowed + 1e-9) return "about";
  return gap < 0 ? "below" : "above";
};

type Level = Readonly<{
  /** "Your resting heart rate", the subject of the sentence. */
  noun: string;
  /** The value with its unit spelled out. */
  value: (value: number, locale: string) => string;
}>;

const UNITS = {
  bpm: ["beat per minute", "beats per minute"],
  ms: ["millisecond", "milliseconds"],
  percent: ["percent", "percent"],
  percentagePoints: ["percentage point", "percentage points"],
  points: ["point", "points"],
  steps: ["step", "steps"],
} as const;

const rate =
  (unit: readonly [string, string]) =>
  (value: number, locale: string): string =>
    counted(value, 0, unit, locale);

const score = (value: number, locale: string): string => formatNumber(value, 0, locale);

const LEVELS: Readonly<Record<Exclude<InsightMetric, "bedtime">, Level>> = {
  steps: { noun: "daily step count", value: rate(UNITS.steps) },
  sleepDuration: { noun: "nightly sleep", value: (v, l) => formatDuration(v, l) },
  restingHeartRate: { noun: "resting heart rate", value: rate(UNITS.bpm) },
  heartRate: { noun: "heart rate", value: rate(UNITS.bpm) },
  hrv: { noun: "heart rate variability", value: rate(UNITS.ms) },
  readiness: { noun: "readiness score", value: score },
  recovery: { noun: "recovery score", value: score },
  sleepScore: { noun: "sleep score", value: score },
  activityScore: { noun: "activity score", value: score },
  sleepPerformance: { noun: "sleep performance", value: rate(UNITS.percent) },
  sleepingHeartRate: { noun: "heart rate during sleep", value: rate(UNITS.bpm) },
  timeInBed: { noun: "time in bed", value: (v, l) => formatDuration(v, l) },
};

/** Measures of one night: their today sentence says "last night", not "today". */
const NIGHTLY: ReadonlySet<InsightMetric> = new Set<InsightMetric>([
  "sleepScore",
  "sleepPerformance",
  "sleepingHeartRate",
  "timeInBed",
]);

const SCORES: ReadonlySet<InsightMetric> = new Set<InsightMetric>([
  "readiness",
  "recovery",
  "sleepScore",
  "activityScore",
]);

/** A month-to-month change, stated with its size: scores move in points. */
const deltaText = (metric: InsightMetric, delta: number, locale: string): string => {
  if (SCORES.has(metric)) return counted(delta, 0, UNITS.points, locale);
  if (metric === "sleepPerformance") {
    return counted(delta, 0, UNITS.percentagePoints, locale);
  }
  if (metric === "timeInBed") return formatDuration(delta, locale);
  if (metric === "hrv") return counted(delta, 0, UNITS.ms, locale);
  return counted(delta, 0, UNITS.bpm, locale);
};

const todayInsight = (metric: InsightMetric, data: TodayData, locale: string) => {
  if (!present(data.today) || !present(data.usual)) return null;
  if (metric === "bedtime" || metric === "heartRate") return null;
  const where = band(data.today, data.usual, data.tolerance ?? DEFAULT_TOLERANCE);
  if (metric === "steps") {
    if (where === "below")
      return "You've taken fewer steps than usual by this time of day.";
    if (where === "about")
      return "You're taking about as many steps as you usually do by now.";
    return "You've taken more steps than usual by this time of day.";
  }
  const level = LEVELS[metric];
  if (metric === "sleepDuration") {
    const compared = {
      below: "less than usual",
      about: "about your usual",
      above: "more than usual",
    };
    return `You slept ${level.value(data.today, locale)} last night, ${compared[where]}.`;
  }
  const compared = {
    below: "below your usual",
    about: "about your usual",
    above: "above your usual",
  };
  if (NIGHTLY.has(metric)) {
    return `Your ${level.noun} last night was ${level.value(data.today, locale)}, ${compared[where]}.`;
  }
  return `Your ${level.noun} today is ${level.value(data.today, locale)}, ${compared[where]}.`;
};

const dayInsight = (metric: InsightMetric, data: DayData, locale: string) => {
  if (!present(data.day) || !present(data.usual) || metric !== "steps") return null;
  const where = band(data.day, data.usual, data.tolerance ?? DEFAULT_TOLERANCE);
  const compared = {
    below: "fewer than usual",
    about: "about your usual",
    above: "more than usual",
  };
  return `You took ${LEVELS.steps.value(data.day, locale)} on your last full day, ${compared[where]}.`;
};

const weeklyInsight = (metric: InsightMetric, data: WeeklyData, locale: string) => {
  if (!present(data.average) || metric === "bedtime") return null;
  if (metric === "steps") {
    return `You averaged ${LEVELS.steps.value(data.average, locale)} a day over the last 7 days.`;
  }
  if (metric === "sleepDuration") {
    return `You slept for an average of ${formatDuration(data.average, locale)} a night in the last 7 days.`;
  }
  const level = LEVELS[metric];
  return `Your ${level.noun} averaged ${level.value(data.average, locale)} over the last 7 days.`;
};

const monthlyInsight = (metric: InsightMetric, data: MonthlyData, locale: string) => {
  if (!present(data.thisMonth) || !present(data.lastMonth) || metric === "bedtime") {
    return null;
  }
  const level = LEVELS[metric];
  const same = `Your ${level.noun} this month is about the same as last month.`;
  if (metric === "steps" || metric === "sleepDuration") {
    // No number in the sentence, so a small change inside the band reads as the same.
    const where = band(
      data.thisMonth,
      data.lastMonth,
      data.tolerance ?? DEFAULT_TOLERANCE,
    );
    if (where === "about") return same;
    const doing = metric === "steps" ? "taking" : "sleeping";
    const more =
      metric === "steps"
        ? `${where === "above" ? "more" : "fewer"} steps`
        : where === "above"
          ? "more"
          : "less";
    return `On average, you're ${doing} ${more} this month than last month.`;
  }
  // The sentence states the change, so only a change that rounds to nothing is "the same".
  const delta = roundTo(data.thisMonth - data.lastMonth, 0);
  if (delta === 0) return same;
  const direction =
    metric === "timeInBed"
      ? delta < 0
        ? "shorter"
        : "longer"
      : delta < 0
        ? "lower"
        : "higher";
  return `Your ${level.noun} this month is ${deltaText(metric, Math.abs(delta), locale)} ${direction} than last month.`;
};

const streakInsight = (
  metric: InsightMetric,
  data: StreakDaysData | StreakNightsData,
  locale: string,
) => {
  if (!present(data.count)) return null;
  const count = roundTo(Math.max(0, data.count), 0);
  if (data.per === "days" && metric === "steps") {
    const days =
      count === 0
        ? "no days"
        : count === 1
          ? "1 day"
          : `${formatNumber(count, 0, locale)} different days`;
    return `In the last 4 weeks, you've taken ${formatNumber(data.threshold, 0, locale)} steps or more on ${days}.`;
  }
  if (data.per === "nights" && metric === "sleepDuration") {
    const total = formatNumber(data.total, 0, locale);
    return `You slept ${durationThreshold(data.threshold, locale)} or more on ${formatNumber(count, 0, locale)} of the last ${total} nights.`;
  }
  return null;
};

const rangeInsight = (metric: InsightMetric, data: RangeData, locale: string) => {
  if (!present(data.min) || !present(data.max)) return null;
  if (metric !== "heartRate" && metric !== "hrv") return null;
  const level = LEVELS[metric];
  const low = formatNumber(Math.min(data.min, data.max), 0, locale);
  const high = level.value(Math.max(data.min, data.max), locale);
  if (data.context === "sleep") {
    return `Your ${level.noun} ranged from ${low} to ${high} while you were asleep.`;
  }
  return `During your last ${data.context.session}, your ${level.noun} was ${low} to ${high}.`;
};

/** Minutes from usual to actual, the short way round midnight: 23:50 to 00:20 is +30. */
const clockGap = (actual: number, usual: number): number => {
  const gap = (((actual - usual) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return gap > MINUTES_PER_DAY / 2 ? gap - MINUTES_PER_DAY : gap;
};

const targetInsight = (metric: InsightMetric, data: TargetData, locale: string) => {
  if (!present(data.actual) || !present(data.usual) || metric !== "bedtime") return null;
  const gap = roundTo(clockGap(data.actual, data.usual), 0);
  const window = Math.max(0, data.windowMinutes);
  if (Math.abs(gap) <= window) {
    return `You went to bed within ${counted(window, 0, ["minute", "minutes"], locale)} of your usual time.`;
  }
  const minutes = counted(Math.abs(gap), 0, ["minute", "minutes"], locale);
  return `Your bedtime was ${minutes} ${gap > 0 ? "later" : "earlier"} than usual last night.`;
};

/** The insight sentence for one card, or `null` when a value it needs is missing. */
export const insight = <M extends InsightMetric>(
  metric: M,
  data: InsightDataFor[M],
  locale: string = DISPLAY_LOCALE,
): string | null => {
  const input: AnyData = data;
  switch (input.template) {
    case "day":
      return dayInsight(metric, input, locale);
    case "today":
      return todayInsight(metric, input, locale);
    case "weekly":
      return weeklyInsight(metric, input, locale);
    case "monthly":
      return monthlyInsight(metric, input, locale);
    case "streak":
      return streakInsight(metric, input, locale);
    case "range":
      return rangeInsight(metric, input, locale);
    case "target":
      return targetInsight(metric, input, locale);
  }
};
