import type {
  Category,
  ChartRange,
  DaySample,
  HeroValue,
  Range,
  RadarAxis,
  SleepStage,
  StageSpan,
} from "@/infrastructure/charts/kit";
import {
  formatClock,
  formatDate,
  formatMeasure,
  formatNumber,
  type MeasureKind,
} from "@/infrastructure/format-measure";

import { DASHBOARD_TRENDS, type TrendSpec } from "./dashboard-cards";
import { type WearableSource } from "./dashboard-headings";
import type { ChartPoint } from "./interactive-chart";
import { formatDuration, insight, type InsightMetric } from "./insight";
import { EVENING_MINUTES } from "./local-clock";
import { pointsByPrefix, scoreBand, type Metric } from "./metric-utils";
import type {
  BedtimeNight,
  NightDetail,
  StepsDetail,
  WearableDetail,
} from "./wearable-detail";

/**
 * The wearables dashboard as chart-kit cards, in three sections: the latest
 * day against the person's usual, the last 7 days and this month against the
 * last. Pure, so every number, sentence and readout is tested per source; the
 * screen only draws what comes back.
 *
 * The snapshots hold one value per day, so "usual" is the mean of the 7 days
 * with a reading before the latest one. A card whose series has no reading
 * in view is left out. A card with a reading but too little history for its
 * sentence is drawn in the kit's empty state, with a sentence saying what
 * appears and when. A section with no card at all gets one such card.
 */

/** Days with a reading before the latest one that make a usual value. */
const USUAL_DAYS = 7;
/** A usual, weekly or monthly mean needs at least this many readings. */
const MIN_READINGS = 3;
/** Resting heart rate moves little from day to day, so "about usual" is narrower (#512). */
const HEART_TOLERANCE = 0.03;
/** Nights a consistency chart shows. */
const NIGHTS = 14;
/** Weeks a range chart shows. */
const RANGE_WEEKS = 8;

type Series = Readonly<{
  metric: InsightMetric;
  prefix: string;
  label: string;
  category: Category;
  kind: MeasureKind;
  tolerance?: number;
}>;

/** Writes a value of a series; steps get their unit in words. */
/**
 * Writes a value of a series. Durations read "7 hr 4 min", as in the insight
 * sentences and the kit, not format-measure's shorter "7 h 4 min".
 */
const show = (kind: MeasureKind, value: number | null): string => {
  if (kind === "steps") return `${formatNumber(value, 0)} steps`;
  if (kind === "sleepMinutes" && value !== null && Number.isFinite(value)) {
    return formatDuration(value);
  }
  return formatMeasure(kind, value);
};

/**
 * A hero number with its unit beside it, as the kit draws units. A duration
 * puts its hours in the number and its minutes beside them ("7 hr" and
 * "49 min"), so it reads "7 hr 49 min" and fits on one line in a pair.
 */
const hero = (label: string, kind: MeasureKind, value: number | null): HeroValue => {
  if (kind === "steps") return { label, value: formatNumber(value, 0), unit: "steps" };
  const text = show(kind, value);
  if (kind !== "sleepMinutes") return { label, value: text };
  const hours = text.indexOf(" hr ");
  return hours < 0
    ? { label, value: text }
    : { label, value: text.slice(0, hours + 3), unit: text.slice(hours + 4) };
};

/* --- dates ----------------------------------------------------------------- */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const utc = (day: string): Date => new Date(`${day}T00:00:00Z`);
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number): string => {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
};
/** The Monday of the week holding `day`. */
const weekStart = (day: string): string =>
  addDays(day, -((utc(day).getUTCDay() + 6) % 7));
const monthOf = (day: string): string => day.slice(0, 7);
const previousMonth = (month: string): string => {
  const date = utc(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return isoDay(date).slice(0, 7);
};
const monthName = (month: string): string => MONTHS[Number(month.slice(5, 7)) - 1]!;
/** "Tue 4 Nov" */
const dayName = (day: string): string =>
  `${WEEKDAYS[utc(day).getUTCDay()]} ${formatDate(day, "short")}`;

/* --- means ----------------------------------------------------------------- */

const mean = (points: readonly ChartPoint[]): number | null =>
  points.length < MIN_READINGS
    ? null
    : points.reduce((sum, p) => sum + p.value, 0) / points.length;

const between = (points: readonly ChartPoint[], from: string, to: string) =>
  points.filter((p) => p.date >= from && p.date <= to);

type Reading = Readonly<{ latest: ChartPoint; usual: number | null }>;

/** The latest reading and the mean of the readings before it. */
const reading = (points: readonly ChartPoint[]): Reading | null => {
  const latest = points.at(-1);
  if (!latest) return null;
  return { latest, usual: mean(points.slice(-1 - USUAL_DAYS, -1)) };
};

const lastDays = (points: readonly ChartPoint[], end: string, days: number) =>
  between(points, addDays(end, 1 - days), end);

const monthMeans = (points: readonly ChartPoint[], end: string) => {
  const month = monthOf(end);
  const last = previousMonth(month);
  return {
    month,
    last,
    thisMonth: mean(points.filter((p) => monthOf(p.date) === month)),
    lastMonth: mean(points.filter((p) => monthOf(p.date) === last)),
  };
};

/* --- the series each source has ---------------------------------------------- */

const fromTrend = (
  trend: TrendSpec | null,
  metric: InsightMetric,
  category: Category,
  kind: MeasureKind,
  label: string,
  tolerance?: number,
): Series | null =>
  trend ? { metric, prefix: trend.prefix, label, category, kind, tolerance } : null;

type SourceSeries = Readonly<{
  scores: readonly Series[];
  heart: Series | null;
  hrv: Series | null;
  sleep: Series | null;
  steps: Series | null;
  /** Parts of one radar, each on its own scale; the HRV part leads the sentence. */
  radar: Readonly<{ label: string; parts: readonly Series[] }>;
}>;

const score = (
  metric: InsightMetric,
  prefix: string,
  label: string,
  category: Category,
): Series => ({ metric, prefix, label, category, kind: "score" });

export const SOURCE_SERIES = ((): Readonly<Record<WearableSource, SourceSeries>> => {
  const oura = DASHBOARD_TRENDS.oura;
  const whoop = DASHBOARD_TRENDS.whoop;
  const google = DASHBOARD_TRENDS["google-health"];
  const ouraHeart = fromTrend(
    oura.heart,
    "sleepingHeartRate",
    "heart",
    "heartRate",
    "Heart: During sleep",
    HEART_TOLERANCE,
  );
  const ouraHrv = fromTrend(oura.hrv, "hrv", "hrv", "hrv", "HRV");
  const ouraSleep = fromTrend(
    oura.sleep,
    "sleepDuration",
    "sleep",
    "sleepMinutes",
    "Sleep: Duration",
  );
  const whoopHeart = fromTrend(
    whoop.heart,
    "restingHeartRate",
    "heart",
    "heartRate",
    "Heart: Resting",
    HEART_TOLERANCE,
  );
  const whoopHrv = fromTrend(whoop.hrv, "hrv", "hrv", "hrv", "HRV");
  const googleHeart = fromTrend(
    google.heart,
    "restingHeartRate",
    "heart",
    "heartRate",
    "Heart: Resting",
    HEART_TOLERANCE,
  );
  const googleHrv = fromTrend(google.hrv, "hrv", "hrv", "hrv", "HRV");
  const googleSteps = fromTrend(
    google.steps,
    "steps",
    "steps",
    "steps",
    "Activity: Steps",
  );
  // Radar parts that are not cards of their own; their metric only names them.
  const part = (prefix: string, label: string, kind: MeasureKind, category: Category) =>
    ({ metric: "hrv", prefix, label, kind, category }) as const satisfies Series;
  const present = (list: readonly (Series | null)[]): Series[] =>
    list.filter((s): s is Series => s !== null);
  return {
    oura: {
      scores: [
        score("readiness", "readiness.score.", "Readiness", "readiness"),
        score("sleepScore", "sleep.score.", "Sleep: Score", "sleep"),
        score("activityScore", "activity.score.", "Activity: Score", "activity"),
      ],
      heart: ouraHeart,
      hrv: ouraHrv,
      sleep: ouraSleep,
      steps: fromTrend(oura.steps, "steps", "steps", "steps", "Activity: Steps"),
      radar: {
        label: "Night: Against usual",
        parts: present([
          ouraHrv,
          ouraHeart,
          ouraSleep,
          part("sleep.efficiency.", "Efficiency", "percent", "sleep"),
        ]),
      },
    },
    whoop: {
      scores: [
        score("recovery", "whoop.recovery.score.", "Recovery", "recovery"),
        score(
          "sleepPerformance",
          "whoop.sleep.performance.",
          "Sleep: Performance",
          "sleep",
        ),
      ],
      heart: whoopHeart,
      hrv: whoopHrv,
      sleep: fromTrend(
        whoop.sleep,
        "timeInBed",
        "sleep",
        "sleepMinutes",
        "Sleep: Time in bed",
      ),
      steps: null,
      radar: {
        label: "Recovery: Against usual",
        parts: present([
          whoopHrv,
          whoopHeart,
          part("whoop.recovery.spo2.", "SpO2", "spo2", "recovery"),
          part("whoop.sleep.performance.", "Sleep", "percent", "sleep"),
        ]),
      },
    },
    "google-health": {
      scores: [],
      heart: googleHeart,
      hrv: googleHrv,
      sleep: null,
      steps: googleSteps,
      radar: {
        label: "Day: Against usual",
        parts: present([
          googleHrv,
          googleHeart,
          googleSteps,
          part("google.active-minutes.", "Active minutes", "sleepMinutes", "activity"),
          part("google.daily-oxygen-saturation.", "SpO2", "spo2", "vitals"),
        ]),
      },
    },
  };
})();

/* --- the cards -------------------------------------------------------------- */

type CardBase = Readonly<{
  id: string;
  label: string;
  category: Category;
  sentence: string;
  /**
   * `empty` draws the chart's outline under a sentence saying what comes and
   * when; `loading` draws its shape while the detail route answers.
   */
  state: "default" | "empty" | "loading";
}>;

export type KitCard =
  | (CardBase &
      Readonly<{
        chart: "ring";
        /** The day the score is for. */
        title: string;
        band: string;
        value: number;
        readout: string;
      }>)
  | (CardBase & Readonly<{ chart: "pair"; today: HeroValue; reference: HeroValue }>)
  | (CardBase &
      Readonly<{
        chart: "consistency";
        values: readonly (number | null)[];
        readouts: readonly (string | null)[];
        target: number | null;
        reference: HeroValue;
        last: HeroValue;
        axis: readonly [string, string];
      }>)
  | (CardBase &
      Readonly<{
        chart: "weekly";
        values: readonly (number | null)[];
        readouts: readonly (string | null)[];
        average: number | null;
        caption: string;
        hero: string;
        unit?: string;
      }>)
  | (CardBase &
      Readonly<{
        chart: "month";
        current: Readonly<{ month: string; value: number | null; display: string }>;
        previous: Readonly<{ month: string; value: number | null; display: string }>;
      }>)
  | (CardBase &
      Readonly<{
        chart: "range";
        buckets: readonly (Range | null)[];
        axis: readonly [string, string];
      }>)
  | (CardBase &
      Readonly<{
        chart: "cumulative";
        today: readonly DaySample[];
        average: readonly DaySample[];
        /** Where the day stops, 0 to 1: the viewer's time for today, 1 for a past day. */
        now: number;
        axis: readonly [string, string, string];
      }>)
  | (CardBase &
      Readonly<{
        chart: "hypnogram";
        spans: readonly StageSpan[];
        labels: Readonly<Partial<Record<SleepStage, string>>>;
        axis: readonly [string, string] | undefined;
      }>)
  | (CardBase &
      Readonly<{
        chart: "radar";
        /** One view per range; the card's switch picks one. A range with too little data is null. */
        views: Readonly<
          Record<
            ChartRange,
            Readonly<{ sentence: string; axes: readonly RadarAxis[] }> | null
          >
        >;
      }>);

export type KitSection = Readonly<{
  id: "daily" | "weekly" | "monthly";
  title: string;
  /** The days the section reads, e.g. "7 Nov 2026". */
  eyebrow: string;
  cards: readonly KitCard[];
}>;

/** A sentence from `insight`, cast to the metric's data: each series only builds templates its metric takes. */
const say = (
  metric: InsightMetric,
  data:
    | Readonly<{
        template: "today";
        today: number;
        usual: number | null;
        tolerance?: number;
      }>
    | Readonly<{
        template: "day";
        day: number | null;
        usual: number | null;
        tolerance?: number;
      }>
    | Readonly<{ template: "weekly"; average: number | null }>
    | Readonly<{
        template: "monthly";
        thisMonth: number | null;
        lastMonth: number | null;
      }>
    | Readonly<{
        template: "target";
        actual: number | null;
        usual: number | null;
        windowMinutes: number;
      }>,
): string | null =>
  (insight as (m: InsightMetric, d: typeof data) => string | null)(metric, data);

const UNTIL_USUAL = `once ${MIN_READINGS} earlier days with a reading are in view`;

const todayCard = (series: Series, points: readonly ChartPoint[]): KitCard | null => {
  const now = reading(points);
  if (!now) return null;
  // Steps are daily totals here, so they are compared as a whole day, not by the hour.
  const sentence = say(
    series.metric,
    series.metric === "steps"
      ? { template: "day", day: now.latest.value, usual: now.usual }
      : {
          template: "today",
          today: now.latest.value,
          usual: now.usual,
          tolerance: series.tolerance,
        },
  );
  return {
    id: `daily:${series.prefix}`,
    chart: "pair",
    label: series.label,
    category: series.category,
    sentence:
      sentence ?? `Your latest reading is compared with your usual one ${UNTIL_USUAL}.`,
    state: sentence ? "default" : "empty",
    today: hero(formatDate(now.latest.date), series.kind, now.latest.value),
    reference: hero("Usual (7 days)", series.kind, now.usual),
  };
};

const ringCard = (series: Series, points: readonly ChartPoint[]): KitCard | null => {
  const now = reading(points);
  if (!now) return null;
  const sentence = say(series.metric, {
    template: "today",
    today: now.latest.value,
    usual: now.usual,
  });
  const value = Math.min(100, Math.max(0, now.latest.value));
  return {
    id: `ring:${series.prefix}`,
    chart: "ring",
    label: series.label,
    category: series.category,
    sentence: sentence ?? `This score is compared with your usual one ${UNTIL_USUAL}.`,
    state: sentence ? "default" : "empty",
    title: formatDate(now.latest.date),
    band: scoreBand(now.latest.value),
    value,
    readout: `${formatDate(now.latest.date)} · ${formatNumber(now.latest.value, 0)} of 100`,
  };
};

const consistencyCard = (
  series: Series,
  points: readonly ChartPoint[],
): KitCard | null => {
  const now = reading(points);
  if (!now) return null;
  const nights = Array.from({ length: NIGHTS }, (_, i) =>
    addDays(now.latest.date, i + 1 - NIGHTS),
  );
  const byDay = new Map(points.map((p) => [p.date, p.value]));
  const values = nights.map((day) => byDay.get(day) ?? null);
  const sentence = say(series.metric, {
    template: "today",
    today: now.latest.value,
    usual: now.usual,
  });
  return {
    id: `nights:${series.prefix}`,
    chart: "consistency",
    label: series.label,
    category: series.category,
    sentence: sentence ?? `Last night is compared with your usual night ${UNTIL_USUAL}.`,
    state: sentence ? "default" : "empty",
    values,
    readouts: nights.map((day, i) =>
      values[i] === null ? null : `${dayName(day)} · ${show(series.kind, values[i]!)}`,
    ),
    target: now.usual,
    reference: hero("Usual (7 nights)", series.kind, now.usual),
    last: hero("Last night", series.kind, now.latest.value),
    axis: [formatDate(nights[0], "short"), formatDate(now.latest.date, "short")],
  };
};

const weeklyCard = (series: Series, points: readonly ChartPoint[]): KitCard | null => {
  const latest = points.at(-1);
  if (!latest) return null;
  const average = mean(lastDays(points, latest.date, 7));
  const sentence = say(series.metric, { template: "weekly", average });
  // Bars run Monday to Sunday of the latest reading's week, as the kit labels them.
  const monday = weekStart(latest.date);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byDay = new Map(points.map((p) => [p.date, p.value]));
  const values = week.map((day) =>
    day <= latest.date ? (byDay.get(day) ?? null) : null,
  );
  return {
    id: `weekly:${series.prefix}`,
    chart: "weekly",
    label: series.label,
    category: series.category,
    sentence:
      sentence ??
      `Your 7-day average appears here once ${MIN_READINGS} of the last 7 days have a reading.`,
    state: sentence ? "default" : "empty",
    values,
    readouts: week.map((day, i) =>
      values[i] === null ? null : `${dayName(day)} · ${show(series.kind, values[i]!)}`,
    ),
    average,
    caption: "7-day average",
    hero: hero("", series.kind, average).value,
    unit: hero("", series.kind, average).unit,
  };
};

const monthCard = (series: Series, points: readonly ChartPoint[]): KitCard | null => {
  const latest = points.at(-1);
  if (!latest) return null;
  const m = monthMeans(points, latest.date);
  const sentence = say(series.metric, {
    template: "monthly",
    thisMonth: m.thisMonth,
    lastMonth: m.lastMonth,
  });
  return {
    id: `month:${series.prefix}`,
    chart: "month",
    label: series.label,
    category: series.category,
    sentence:
      sentence ??
      `This month is compared with ${monthName(m.last)} once each has ${MIN_READINGS} days with a reading in view.`,
    state: sentence ? "default" : "empty",
    current: {
      month: monthName(m.month),
      value: m.thisMonth,
      display: show(series.kind, m.thisMonth),
    },
    previous: {
      month: monthName(m.last),
      value: m.lastMonth,
      display: show(series.kind, m.lastMonth),
    },
  };
};

/** The heart card of the monthly section: each week's lowest to highest daily value. */
const weekRangeCard = (series: Series, points: readonly ChartPoint[]): KitCard | null => {
  const latest = points.at(-1);
  if (!latest) return null;
  const last = weekStart(latest.date);
  // Up to 8 weeks, starting no earlier than the week of the first reading in view.
  const first = weekStart(points[0]!.date);
  const weeks = Array.from({ length: RANGE_WEEKS }, (_, i) =>
    addDays(last, (i + 1 - RANGE_WEEKS) * 7),
  ).filter((monday) => monday >= first);
  const buckets = weeks.map((monday): Range | null => {
    const values = between(points, monday, addDays(monday, 6)).map((p) => p.value);
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return {
      min,
      max,
      readout: `Week of ${formatDate(monday, "short")} · ${formatNumber(min, 0)} to ${show(series.kind, max)}`,
    };
  });
  const m = monthMeans(points, latest.date);
  const sentence = say(series.metric, {
    template: "monthly",
    thisMonth: m.thisMonth,
    lastMonth: m.lastMonth,
  });
  return {
    id: `weeks:${series.prefix}`,
    chart: "range",
    label: `${series.label}, by week`,
    category: series.category,
    sentence:
      sentence ??
      `This month is compared with ${monthName(m.last)} once each has ${MIN_READINGS} days with a reading in view.`,
    state: sentence && buckets.filter(Boolean).length >= 2 ? "default" : "empty",
    buckets,
    axis: [
      `Week of ${formatDate(weeks[0], "short")}`,
      `Week of ${formatDate(last, "short")}`,
    ],
  };
};

/** One radar view: each part's value against its reference, on 0 to the part's highest reading. */
const radarView = (
  parts: readonly Readonly<{ series: Series; points: readonly ChartPoint[] }>[],
  pick: (
    points: readonly ChartPoint[],
  ) => Readonly<{ value: number | null; reference: number | null }>,
  sentence: string | null,
  referenceWord: string,
) => {
  const axes = parts.map(({ series, points }): RadarAxis => {
    const { value, reference } = pick(points);
    const max = Math.max(...points.map((p) => p.value)) * 1.05;
    return {
      label: series.label.replace(/^[^:]+: /, ""),
      value,
      reference,
      display: show(series.kind, value),
      max,
      readout: `${series.label} · ${show(series.kind, value)} · ${referenceWord} ${show(series.kind, reference)}`,
    };
  });
  const complete = axes.filter((a) => a.value !== null && a.reference != null).length;
  return sentence && complete >= 3 ? { sentence, axes } : null;
};

const radarCard = (
  radar: SourceSeries["radar"],
  points: (series: Series) => readonly ChartPoint[],
): KitCard | null => {
  const parts = radar.parts
    .map((series) => ({ series, points: points(series) }))
    .filter((p) => p.points.length > 0);
  if (parts.length < 3) return null;
  const lead = parts[0]!;
  const end = parts
    .map((p) => p.points.at(-1)!.date)
    .sort()
    .at(-1)!;
  const day = radarView(
    parts,
    (ps) => {
      const now = reading(ps);
      return now && now.latest.date === end
        ? { value: now.latest.value, reference: now.usual }
        : { value: null, reference: null };
    },
    (() => {
      const now = reading(lead.points);
      return now
        ? say(lead.series.metric, {
            template: "today",
            today: now.latest.value,
            usual: now.usual,
            tolerance: lead.series.tolerance,
          })
        : null;
    })(),
    "usual",
  );
  const week = radarView(
    parts,
    (ps) => ({
      value: mean(lastDays(ps, end, 7)),
      reference: mean(between(ps, addDays(end, -34), addDays(end, -7))),
    }),
    say(lead.series.metric, {
      template: "weekly",
      average: mean(lastDays(lead.points, end, 7)),
    }),
    "4 weeks before",
  );
  const month = radarView(
    parts,
    (ps) => {
      const m = monthMeans(ps, end);
      return { value: m.thisMonth, reference: m.lastMonth };
    },
    (() => {
      const m = monthMeans(lead.points, end);
      return say(lead.series.metric, {
        template: "monthly",
        thisMonth: m.thisMonth,
        lastMonth: m.lastMonth,
      });
    })(),
    monthName(previousMonth(monthOf(end))),
  );
  if (!day && !week && !month) return null;
  return {
    id: `radar:${radar.label}`,
    chart: "radar",
    label: radar.label,
    category: lead.series.category,
    sentence: (day ?? week ?? month)!.sentence,
    state: "default",
    views: { day, week, month },
  };
};

/* --- the detail route's cards ------------------------------------------------ */

/** Minutes either side of the usual bedtime that read as "within". */
const BEDTIME_WINDOW = 30;
/** Earlier days a usual day of steps needs (as the route counts them). */
const USUAL_STEP_DAYS = 7;
const DAY_AXIS = ["00:00", "12:00", "24:00"] as const;
const STAGE_WORD: Readonly<Record<SleepStage, string>> = {
  awake: "Awake",
  rem: "REM",
  core: "Light",
  deep: "Deep",
};
/**
 * Which sources can ever send steps by the hour and stage segments. A card a
 * source can never fill is left out; an empty state means "none yet".
 */
const SENDS_HOURLY_STEPS: ReadonlySet<WearableSource> = new Set(["google-health"]);
const SENDS_STAGES: ReadonlySet<WearableSource> = new Set(["oura", "google-health"]);
/** Oura and Google Health both call it light sleep. */
const STAGE_LABELS = { core: "Light" } as const;

/** A time of the night from minutes after 6 PM. */
const nightClock = (minutes: number): string => formatClock(minutes + EVENING_MINUTES);

const loading = <C extends KitCard["chart"]>(chart: C) =>
  ({ sentence: "", state: "loading", chart }) as const;

/** A running total's value at `at` (0 to 1), read along the line between its samples. */
const valueAt = (samples: readonly DaySample[], at: number): number => {
  const after = samples.findIndex((s) => s.at >= at);
  if (after < 0) return samples.at(-1)?.value ?? 0;
  if (after === 0) return samples[0]!.value;
  const a = samples[after - 1]!;
  const b = samples[after]!;
  return a.value + ((at - a.at) / (b.at - a.at)) * (b.value - a.value);
};

/** Midnight at 0, then each hour's running total at its end. */
const daySamples = (hourly: readonly number[], readouts: boolean): DaySample[] => [
  { at: 0, value: 0 },
  ...hourly.map((value, h) => ({
    at: (h + 1) / 24,
    value,
    readout: readouts
      ? `By ${h === 23 ? "24:00" : formatClock((h + 1) * 60)} · ${show("steps", value)}`
      : undefined,
  })),
];

/** C05: the latest day's steps by the hour against the usual day; today stops at now. */
const cumulativeCard = (
  source: WearableSource,
  steps: StepsDetail | "loading",
  today: string,
  nowMinutes: number,
): KitCard | null => {
  const base = {
    id: "day:steps",
    label: "Activity: Steps by the hour",
    category: "steps",
    axis: DAY_AXIS,
  } as const;
  const empty = (sentence: string): KitCard => ({
    ...base,
    chart: "cumulative",
    sentence,
    state: "empty",
    today: [],
    average: [],
    now: 0,
  });
  // A source that never sends hourly steps gets no card, not even while loading.
  if (!SENDS_HOURLY_STEPS.has(source) || steps === "loading") {
    return SENDS_HOURLY_STEPS.has(source)
      ? { ...base, ...loading("cumulative"), today: [], average: [], now: 0 }
      : null;
  }
  if (steps.status === "not-provided") return null;
  if (steps.status === "missing") {
    return empty("Your day by the hour appears here once a sync brings in hourly steps.");
  }
  const isToday = steps.day === today;
  const now = isToday ? Math.min(1, Math.max(0, nowMinutes / 1440)) : 1;
  const hours = daySamples(steps.hourly, true);
  const current = steps.hourly[Math.min(23, Math.floor(now * 24))] ?? 0;
  const todaySamples = isToday
    ? [
        ...hours.filter((s) => s.at < now),
        { at: now, value: current, readout: `Now · ${show("steps", current)}` },
      ]
    : hours;
  const average = steps.usual ? daySamples(steps.usual, false) : [];
  const sentence = !steps.usual
    ? null
    : isToday
      ? say("steps", {
          template: "today",
          today: current,
          usual: valueAt(average, now),
        })
      : say("steps", {
          template: "day",
          day: steps.hourly.at(-1) ?? null,
          usual: steps.usual.at(-1) ?? null,
        });
  return {
    ...base,
    chart: "cumulative",
    sentence:
      sentence ??
      `Your day is compared with your usual day once ${USUAL_STEP_DAYS} earlier days with hourly steps are in view.`,
    state: sentence ? "default" : "empty",
    today: todaySamples,
    average,
    now,
  };
};

/** The mean of up to 7 nights' values before the last, or null with fewer than 3. */
const usualNight = (
  nights: readonly BedtimeNight[],
  value: (night: BedtimeNight) => number | null,
): number | null => {
  const before = nights
    .slice(-1 - USUAL_DAYS, -1)
    .map(value)
    .filter((v): v is number => v !== null);
  return before.length < MIN_READINGS
    ? null
    : before.reduce((sum, v) => sum + v, 0) / before.length;
};

/** C09: last night's stages; a source that never sends them (WHOOP) gets no card. */
const hypnogramCard = (
  source: WearableSource,
  night: NightDetail | "loading",
  nights: WearableDetail["nights"] | "loading",
): KitCard | null => {
  const base = {
    id: "night:stages",
    label: "Sleep: Stages",
    category: "sleep",
    labels: STAGE_LABELS,
    axis: undefined,
  } as const;
  const empty = (sentence: string): KitCard => ({
    ...base,
    chart: "hypnogram",
    sentence,
    state: "empty",
    spans: [],
  });
  if (!SENDS_STAGES.has(source)) return null;
  if (night === "loading") return { ...base, ...loading("hypnogram"), spans: [] };
  if (night.status === "not-provided" || night.status === "totals-only") return null;
  if (night.status === "missing") {
    return empty(
      "Last night's sleep stages appear here once a sync brings in a night with stages.",
    );
  }
  const first = night.segments[0]!;
  const last = night.segments.at(-1)!;
  const list = nights !== "loading" && nights.status === "ok" ? nights.nights : [];
  const tonight = list.at(-1);
  const asleep =
    tonight?.day === night.day && tonight.asleep !== null
      ? tonight.asleep
      : night.segments
          .filter((s) => s.stage !== "awake")
          .reduce((sum, s) => sum + s.end - s.start, 0);
  const sentence = say("sleepDuration", {
    template: "today",
    today: asleep,
    usual: usualNight(list, (n) => n.asleep),
  });
  return {
    ...base,
    chart: "hypnogram",
    label: `Sleep: Stages, ${formatDate(night.day, "short")}`,
    sentence:
      sentence ??
      `Your sleep stages last night, from ${nightClock(first.start)} to ${nightClock(last.end)}.`,
    state: "default",
    spans: night.segments.map((s) => ({
      stage: s.stage,
      start: s.start,
      end: s.end,
      readout: `${STAGE_WORD[s.stage]} · ${nightClock(s.start)} to ${nightClock(s.end)} · ${formatDuration(s.end - s.start)}`,
    })),
    axis: [nightClock(first.start), nightClock(last.end)],
  };
};

/** "Night of Mon 3 Nov": a night named by its evening, as people say it. */
const nightName = (day: string): string => `Night of ${dayName(addDays(day, -1))}`;

/** C13 for bedtimes: 14 nights against the usual bedtime of the 7 before the last. */
const bedtimeCard = (nights: WearableDetail["nights"] | "loading"): KitCard | null => {
  const base = {
    id: "nights:bedtime",
    label: "Sleep: Bedtime",
    category: "sleep",
  } as const;
  const shape = {
    values: [],
    readouts: [],
    target: null,
    reference: { label: "Usual (7 nights)", value: "–" },
    last: { label: "Last night", value: "–" },
    axis: ["", ""],
  } as const;
  if (nights === "loading") return { ...base, ...loading("consistency"), ...shape };
  if (nights.status === "missing") {
    return {
      ...base,
      ...shape,
      chart: "consistency",
      sentence: "Your bedtimes appear here once a sync brings in nights with a bedtime.",
      state: "empty",
    };
  }
  const list = nights.nights;
  const latest = list.at(-1)!;
  const usual = usualNight(list, (n) => n.bedtime);
  const clock = (m: number | null) => (m === null ? null : (m + EVENING_MINUTES) % 1440);
  const sentence = say("bedtime", {
    template: "target",
    actual: clock(latest.bedtime),
    usual: clock(usual),
    windowMinutes: BEDTIME_WINDOW,
  });
  return {
    ...base,
    chart: "consistency",
    sentence:
      sentence ??
      `Last night's bedtime is compared with your usual one once ${MIN_READINGS} earlier nights with a bedtime are in view.`,
    state: sentence ? "default" : "empty",
    values: list.map((n) => n.bedtime),
    readouts: list.map((n) =>
      n.bedtime === null ? null : `${nightName(n.day)} · ${nightClock(n.bedtime)}`,
    ),
    target: usual,
    reference: {
      label: "Usual (7 nights)",
      value: usual === null ? "–" : nightClock(usual),
    },
    last: {
      label: "Last night",
      value: latest.bedtime === null ? "–" : nightClock(latest.bedtime),
    },
    axis: [
      formatDate(addDays(list[0]!.day, -1), "short"),
      formatDate(addDays(latest.day, -1), "short"),
    ],
  };
};

const present = (cards: readonly (KitCard | null)[]): KitCard[] =>
  cards.filter((card): card is KitCard => card !== null);

export type KitDashboardInput = Readonly<{
  source: WearableSource;
  metrics: readonly Metric[];
  /** The viewer's calendar day: a step count for today is not finished yet. */
  today: string;
  /**
   * Hourly steps, stages and bedtimes from the detail route; "loading" while
   * it answers. Left out (or null when it could not answer), the cards that
   * need it are left out too.
   */
  detail?: WearableDetail | "loading" | null;
  /** The viewer's time, minutes after midnight: where today's steps stop. */
  nowMinutes?: number;
}>;

export const kitSections = ({
  source,
  metrics,
  today,
  detail = null,
  nowMinutes = 0,
}: KitDashboardInput): readonly KitSection[] => {
  const spec = SOURCE_SERIES[source];
  const points = (series: Series): readonly ChartPoint[] => {
    const all = pointsByPrefix(metrics, series.prefix);
    // Today's steps are a running total; the day it is compared with is a whole one.
    return series.metric === "steps" ? all.filter((p) => p.date < today) : all;
  };
  const end = [spec.heart, spec.hrv, spec.sleep, spec.steps, ...spec.scores]
    .flatMap((s) => (s ? points(s).map((p) => p.date) : []))
    .sort()
    .at(-1);
  const each = (
    list: readonly (Series | null)[],
    card: (series: Series, points: readonly ChartPoint[]) => KitCard | null,
  ) => present(list.map((series) => (series ? card(series, points(series)) : null)));

  const part = <K extends keyof WearableDetail>(key: K) =>
    detail === "loading" ? "loading" : (detail?.[key] ?? null);
  const steps = part("steps");
  const night = part("night");
  const nights = part("nights");

  const daily = [
    ...each(spec.scores, ringCard),
    ...each([spec.sleep], consistencyCard),
    ...present([
      night ? hypnogramCard(source, night, nights ?? "loading") : null,
      steps ? cumulativeCard(source, steps, today, nowMinutes) : null,
    ]),
    ...each([spec.steps, spec.heart, spec.hrv], todayCard),
    ...present([radarCard(spec.radar, points)]),
  ];
  const weekly = [
    ...each([spec.steps, spec.sleep, spec.hrv, spec.heart], weeklyCard),
    ...present([nights ? bedtimeCard(nights) : null]),
  ];
  const monthly = [
    ...each([spec.steps, spec.sleep, spec.hrv], monthCard),
    ...each([spec.heart], weekRangeCard),
    ...each(spec.scores.slice(0, 1), monthCard),
  ];

  const eyebrow = end ? formatDate(end) : "No reading in view";
  const thisMonth = end ? monthName(monthOf(end)) : "This month";
  const lastMonth = end ? monthName(previousMonth(monthOf(end))) : "Last month";
  return [
    {
      id: "daily",
      title: "Daily",
      eyebrow,
      cards: daily.length
        ? daily
        : [
            emptySection(
              "daily",
              "Your latest day appears here once a sync brings in a day with readings.",
            ),
          ],
    },
    {
      id: "weekly",
      title: "Weekly",
      eyebrow: end
        ? `${formatDate(addDays(end, -6), "short")} to ${formatDate(end, "short")}`
        : "Last 7 days",
      cards: weekly.length
        ? weekly
        : [
            emptySection(
              "weekly",
              "Your 7-day averages appear here once the last 7 days have readings.",
            ),
          ],
    },
    {
      id: "monthly",
      title: "Monthly",
      eyebrow: `${thisMonth} against ${lastMonth}`,
      cards: monthly.length
        ? monthly
        : [
            emptySection(
              "monthly",
              "This month is compared with last month once the timeline reaches into both.",
            ),
          ],
    },
  ];
};

const emptySection = (id: KitSection["id"], sentence: string): KitCard => ({
  id: `empty:${id}`,
  chart: "month",
  label: "No readings yet",
  category: "vitals",
  sentence,
  state: "empty",
  current: { month: "This month", value: null, display: "–" },
  previous: { month: "Last month", value: null, display: "–" },
});
