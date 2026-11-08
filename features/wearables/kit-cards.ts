import type {
  Category,
  ChartRange,
  HeroValue,
  Range,
  RadarAxis,
} from "@/infrastructure/charts/kit";
import {
  formatDate,
  formatMeasure,
  formatNumber,
  type MeasureKind,
} from "@/infrastructure/format-measure";

import { DASHBOARD_TRENDS, type TrendSpec } from "./dashboard-cards";
import { type WearableSource } from "./dashboard-headings";
import type { ChartPoint } from "./interactive-chart";
import { formatDuration, insight, type InsightMetric } from "./insight";
import { pointsByPrefix, scoreBand, type Metric } from "./metric-utils";

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
  /** `empty` draws the chart's outline under a sentence saying what comes and when. */
  state: "default" | "empty";
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
        day: number;
        usual: number | null;
        tolerance?: number;
      }>
    | Readonly<{ template: "weekly"; average: number | null }>
    | Readonly<{
        template: "monthly";
        thisMonth: number | null;
        lastMonth: number | null;
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

const present = (cards: readonly (KitCard | null)[]): KitCard[] =>
  cards.filter((card): card is KitCard => card !== null);

export type KitDashboardInput = Readonly<{
  source: WearableSource;
  metrics: readonly Metric[];
  /** The viewer's calendar day: a step count for today is not finished yet. */
  today: string;
}>;

export const kitSections = ({
  source,
  metrics,
  today,
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

  const daily = [
    ...each(spec.scores, ringCard),
    ...each([spec.sleep], consistencyCard),
    ...each([spec.steps, spec.heart, spec.hrv], todayCard),
    ...present([radarCard(spec.radar, points)]),
  ];
  const weekly = each([spec.steps, spec.sleep, spec.hrv, spec.heart], weeklyCard);
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
