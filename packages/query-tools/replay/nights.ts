import { MAD_SCALE } from "../stats";
import { seriesOf, type SeriesSelector } from "./at-time";
import { type Baseline, evidenceRef, personalBaseline } from "./baseline";
import { type AvailableReading, isAvailable, type Origin } from "./items";
import { dayBefore, localDayBounds, minutesBetween } from "./local-time";
import { type ReplayDay, type ReplayKey } from "./replay-day";
import { decide, type StatusResult, type StatusRule } from "./status-rules";

/**
 * One summary per night for the ten-night comparison (#866). Pure, free of
 * I/O. Every number belongs to the selected person and date: a date with no
 * data says so and shows nothing, never another night's values.
 *
 * Measured values are the device's own (nightly resting heart rate and HRV).
 * Derived values (deltas, peaks, lows, totals, coverage, bands) name what they
 * were computed from. Reference bands and deltas appear only with a personal
 * baseline (`baseline.ts`).
 */

/** At least this share of a day's quarter-hours with a value counts as complete. */
export const COMPLETE_COVERAGE = 0.9;

/** A night this far or more above the resting baseline counts as elevated (demo only). */
export const ELEVATED_NIGHT_PER_MIN = 5;

export const ELEVATED_NIGHTS: StatusRule = {
  id: "resting_heart_rate_elevated_nights",
  text: `A night with resting heart rate ${ELEVATED_NIGHT_PER_MIN} /min or more above the personal baseline is notable; the second such night in a row, or later ones, is worth a look; otherwise usual.`,
  basis: "demo_only",
};

export type Unavailable = Readonly<{ state: "unavailable"; text: string }>;

export type MeasuredValue = Readonly<{
  state: "available";
  value: number;
  unit: "/min" | "ms";
  provenance: "measured";
  source: string;
  at: string;
  reading_id: string;
}>;

export type DerivedValue = Readonly<{
  state: "available";
  value: number;
  unit: string;
  provenance: "derived";
  rule: string;
  evidence: readonly string[];
  /** The time of the reading it came from, for a peak or a low. */
  at: string | null;
}>;

export type ReferenceBand = Readonly<{
  state: "available";
  low: number;
  high: number;
  unit: "/min" | "ms";
  provenance: "derived";
  rule: string;
}>;

export type NightSummary = Readonly<{
  subject_ref: string;
  day: string;
  time_zone: string;
  origin: Origin;
  availability: "complete" | "partial" | "none";
  /** Says what is there and what is not. */
  availability_text: string;
  /** Share of the day's quarter-hours with a value, 0 to 1; null when the stream has none at all. */
  coverage: Readonly<{
    heart_rate: number | null;
    glucose: number | null;
    steps: number | null;
  }>;
  resting_heart_rate: MeasuredValue | Unavailable;
  hrv: MeasuredValue | Unavailable;
  baselines: Readonly<{ resting_heart_rate: Baseline; hrv: Baseline }>;
  bands: Readonly<{
    resting_heart_rate: ReferenceBand | Unavailable;
    hrv: ReferenceBand | Unavailable;
  }>;
  resting_delta: DerivedValue | Unavailable;
  steps: (DerivedValue & Readonly<{ complete: boolean }>) | Unavailable;
  /** Minutes of each recorded activity. */
  activity_minutes:
    | Readonly<{
        state: "available";
        walk: number;
        run: number;
        evidence: readonly string[];
      }>
    | Unavailable;
  peak_heart_rate: DerivedValue | Unavailable;
  /** The night before waking, for the day's heart-rate strip. */
  night: Readonly<{ from: string; to: string }> | null;
  lowest_night_heart_rate: DerivedValue | Unavailable;
  status: StatusResult;
  /** One observational sentence: what the numbers show, never a cause. */
  sentence: string;
  sources: readonly string[];
}>;

const unavailable = (text: string): Unavailable => ({ state: "unavailable", text });

const round = (value: number, places: number): number =>
  Math.round(value * 10 ** places) / 10 ** places;

const nightly = (
  day: ReplayDay,
  stream: "resting_heart_rate" | "hrv_rmssd",
): MeasuredValue | Unavailable => {
  const reading = seriesOf(day, { stream })
    .filter(isAvailable)
    .find((one) => one.provenance === "measured");
  if (reading === undefined) {
    return unavailable(
      stream === "hrv_rmssd"
        ? "No HRV recorded this night."
        : "No resting heart rate recorded this night.",
    );
  }
  return {
    state: "available",
    value: reading.value,
    unit: stream === "hrv_rmssd" ? "ms" : "/min",
    provenance: "measured",
    source: reading.source.name,
    at: reading.at,
    reading_id: reading.id,
  };
};

const BAND_RULE = `The baseline median ± ${MAD_SCALE} × MAD of the person's nights in the 28 days before (demo only).`;

const bandOf = (baseline: Baseline): ReferenceBand | Unavailable =>
  baseline.state !== "available"
    ? unavailable(`No reference band: ${baseline.text}`)
    : {
        state: "available",
        low: round(baseline.median - MAD_SCALE * baseline.mad, 1),
        high: round(baseline.median + MAD_SCALE * baseline.mad, 1),
        unit: baseline.unit,
        provenance: "derived",
        rule: BAND_RULE,
      };

/** Share of the day's quarter-hours that hold at least one available reading. */
const coverageOf = (day: ReplayDay, selector: SeriesSelector): number | null => {
  const series = seriesOf(day, selector);
  if (series.length === 0) return null;
  const bounds = localDayBounds(day.day, day.time_zone);
  const slots = new Set(
    series
      .filter(isAvailable)
      .map((reading) =>
        Math.floor(minutesBetween(bounds.start, new Date(reading.at)) / 15),
      ),
  );
  return round(slots.size / (bounds.hours * 4), 2);
};

const sensorOrBlood = (day: ReplayDay): SeriesSelector =>
  seriesOf(day, { stream: "glucose", specimen: "sensor" }).length > 0
    ? { stream: "glucose", specimen: "sensor" }
    : { stream: "glucose", specimen: "blood" };

const availabilityOf = (
  day: ReplayDay,
  coverage: NightSummary["coverage"],
): Pick<NightSummary, "availability" | "availability_text"> => {
  if (day.readings.length === 0 && day.events.length === 0) {
    return {
      availability: "none",
      availability_text: "Nothing was recorded on this day.",
    };
  }
  const parts = (
    [
      ["heart rate", coverage.heart_rate],
      ["steps", coverage.steps],
      ["glucose", coverage.glucose],
    ] as const
  ).flatMap(([name, share]) =>
    share === null
      ? [`no ${name} recorded`]
      : share < COMPLETE_COVERAGE
        ? [`${name} covers ${Math.round(share * 100)}% of the day`]
        : [],
  );
  return parts.length === 0
    ? {
        availability: "complete",
        availability_text: `Heart rate, steps and glucose cover at least ${COMPLETE_COVERAGE * 100}% of the day.`,
      }
    : {
        availability: "partial",
        availability_text: `Partial: ${parts.join("; ")}.`,
      };
};

const extreme = (
  readings: readonly AvailableReading[],
  kind: "highest" | "lowest",
  rule: string,
): DerivedValue | null => {
  const chosen = readings.reduce<AvailableReading | null>(
    (best, reading) =>
      best === null ||
      (kind === "highest" ? reading.value > best.value : reading.value < best.value)
        ? reading
        : best,
    null,
  );
  return chosen === null
    ? null
    : {
        state: "available",
        value: chosen.value,
        unit: "/min",
        provenance: "derived",
        rule,
        evidence: [chosen.id],
        at: chosen.at,
      };
};

const elevated = (
  resting: MeasuredValue | Unavailable,
  baseline: Baseline,
): boolean | null =>
  resting.state !== "available" || baseline.state !== "available"
    ? null
    : resting.value - baseline.median >= ELEVATED_NIGHT_PER_MIN;

type DayContext = Readonly<{
  day: ReplayDay;
  resting: MeasuredValue | Unavailable;
  baseline: Baseline;
  elevated: boolean | null;
}>;

const statusOf = (now: DayContext, before: DayContext | null): StatusResult => {
  const { resting, baseline } = now;
  if (resting.state !== "available") {
    return decide(now.day.origin, ELEVATED_NIGHTS, {
      status: "insufficient_data",
      evidence: [],
      reason: resting.text,
    });
  }
  if (baseline.state !== "available") {
    return decide(now.day.origin, ELEVATED_NIGHTS, {
      status: "insufficient_data",
      evidence: [evidenceRef({ day: now.day.day, id: resting.reading_id })],
      reason: `No personal baseline: ${baseline.text}`,
    });
  }
  const delta = resting.value - baseline.median;
  const evidence = [
    evidenceRef({ day: now.day.day, id: resting.reading_id }),
    ...baseline.evidence,
  ];
  if (now.elevated !== true) {
    return decide(now.day.origin, ELEVATED_NIGHTS, {
      status: "usual",
      evidence,
      reason: `${delta >= 0 ? "+" : ""}${delta} /min against the baseline.`,
    });
  }
  const repeated = before?.elevated === true;
  return decide(now.day.origin, ELEVATED_NIGHTS, {
    status: repeated ? "worth_a_look" : "notable",
    evidence:
      repeated && before !== null && before.resting.state === "available"
        ? [
            ...evidence,
            evidenceRef({ day: before.day.day, id: before.resting.reading_id }),
          ]
        : evidence,
    reason: repeated
      ? `+${delta} /min against the baseline, the second night or more in a row.`
      : `+${delta} /min against the baseline, a single night.`,
  });
};

const sentenceOf = (
  resting: MeasuredValue | Unavailable,
  baseline: Baseline,
  status: StatusResult,
): string => {
  if (resting.state !== "available") return resting.text;
  if (baseline.state !== "available") {
    return `Resting heart rate ${resting.value} /min. Not enough nights yet for a personal baseline.`;
  }
  const delta = resting.value - baseline.median;
  const compared =
    delta === 0
      ? `level with the personal baseline of ${baseline.median} /min`
      : `${Math.abs(delta)} /min ${delta > 0 ? "above" : "below"} the personal baseline of ${baseline.median} /min`;
  const repeated =
    status.status === "worth_a_look" ? " The second raised night or more in a row." : "";
  return `Resting heart rate ${resting.value} /min, ${compared}.${repeated}`;
};

const contextOf = (history: readonly ReplayDay[], day: ReplayDay): DayContext => {
  const resting = nightly(day, "resting_heart_rate");
  const baseline = personalBaseline(history, day, "resting_heart_rate");
  return { day, resting, baseline, elevated: elevated(resting, baseline) };
};

/** One night's summary; `before` is the previous calendar day of the same person, if any. */
const summaryOf = (
  history: readonly ReplayDay[],
  now: DayContext,
  before: DayContext | null,
): NightSummary => {
  const { day, resting, baseline } = now;
  const hrvBaseline = personalBaseline(history, day, "hrv_rmssd");
  const coverage = {
    heart_rate: coverageOf(day, { stream: "heart_rate" }),
    glucose: coverageOf(day, sensorOrBlood(day)),
    steps: coverageOf(day, { stream: "steps" }),
  };
  const heart = seriesOf(day, { stream: "heart_rate" }).filter(isAvailable);
  const steps = seriesOf(day, { stream: "steps" }).filter(isAvailable);
  const activities = day.events.filter((event) => event.kind === "activity");
  const bounds = localDayBounds(day.day, day.time_zone);
  const sleep = day.events.find(
    (event) =>
      event.kind === "sleep" &&
      Date.parse(event.to) > bounds.start.getTime() &&
      Date.parse(event.to) <= bounds.start.getTime() + 12 * 3_600_000,
  );
  const inNight =
    sleep === undefined
      ? []
      : heart.filter(
          (reading) =>
            Date.parse(reading.at) >=
              Math.max(bounds.start.getTime(), Date.parse(sleep.from)) &&
            Date.parse(reading.at) < Date.parse(sleep.to),
        );
  const minutesOf = (activity: "walk" | "run"): number =>
    activities
      .filter((event) => event.activity === activity)
      .reduce(
        (sum, event) => sum + minutesBetween(new Date(event.from), new Date(event.to)),
        0,
      );
  const status = statusOf(now, before);
  return {
    subject_ref: day.subject_ref,
    day: day.day,
    time_zone: day.time_zone,
    origin: day.origin,
    ...availabilityOf(day, coverage),
    coverage,
    resting_heart_rate: resting,
    hrv: nightly(day, "hrv_rmssd"),
    baselines: { resting_heart_rate: baseline, hrv: hrvBaseline },
    bands: { resting_heart_rate: bandOf(baseline), hrv: bandOf(hrvBaseline) },
    resting_delta:
      resting.state !== "available"
        ? resting
        : baseline.state !== "available"
          ? unavailable(`No delta: ${baseline.text}`)
          : {
              state: "available",
              value: resting.value - baseline.median,
              unit: "/min",
              provenance: "derived",
              rule: "This night's resting heart rate less the personal baseline median.",
              evidence: [
                evidenceRef({ day: day.day, id: resting.reading_id }),
                ...baseline.evidence,
              ],
              at: null,
            },
    steps:
      steps.length === 0
        ? unavailable("No steps recorded on this day.")
        : {
            state: "available",
            value: steps.reduce((sum, reading) => sum + reading.value, 0),
            unit: "steps",
            provenance: "derived",
            rule: "The sum of the steps recorded on this day.",
            evidence: steps.map((reading) => reading.id),
            at: null,
            complete: (coverage.steps ?? 0) >= COMPLETE_COVERAGE,
          },
    activity_minutes:
      activities.length === 0 && steps.length === 0
        ? unavailable("No activity recorded on this day.")
        : {
            state: "available",
            walk: minutesOf("walk"),
            run: minutesOf("run"),
            evidence: activities.map((event) => event.id),
          },
    peak_heart_rate:
      extreme(heart, "highest", "The highest heart rate recorded on this day.") ??
      unavailable("No heart rate recorded on this day."),
    night:
      sleep === undefined
        ? null
        : {
            from: new Date(
              Math.max(bounds.start.getTime(), Date.parse(sleep.from)),
            ).toISOString(),
            to: sleep.to,
          },
    lowest_night_heart_rate:
      extreme(
        inNight,
        "lowest",
        "The lowest heart rate recorded in the night before waking.",
      ) ??
      unavailable(
        sleep === undefined
          ? "No sleep recorded for this night."
          : "No heart rate recorded in the night.",
      ),
    status,
    sentence: sentenceOf(resting, baseline, status),
    sources: [
      ...new Set([...day.readings, ...day.events].map((item) => item.source.name)),
    ].sort(),
  };
};

const emptyDay = (
  key: ReplayKey & Readonly<{ origin: Origin }>,
  notice: string | null,
): ReplayDay => ({
  subject_ref: key.subject_ref,
  day: key.day,
  time_zone: key.time_zone,
  origin: key.origin,
  notice,
  readings: [],
  events: [],
  narrations: [],
});

/**
 * A summary for each date, in the order given, from one person's days of one
 * origin. A date with no day in `history` is summarised as nothing recorded.
 */
export const nightSummaries = (
  history: readonly ReplayDay[],
  person: Readonly<{ subject_ref: string; time_zone: string; origin: Origin }>,
  dates: readonly string[],
): readonly NightSummary[] => {
  const own = history.filter(
    (day) => day.subject_ref === person.subject_ref && day.origin === person.origin,
  );
  const notice = own[0]?.notice ?? null;
  const dayOf = (date: string): ReplayDay =>
    own.find((day) => day.day === date) ?? emptyDay({ ...person, day: date }, notice);
  return dates.map((date) => {
    const now = contextOf(own, dayOf(date));
    const before = contextOf(own, dayOf(dayBefore(date)));
    return summaryOf(own, now, before);
  });
};
