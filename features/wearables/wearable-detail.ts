import type { Bundle, Observation } from "fhir/r4";

import { type WearableSource } from "./dashboard-headings";
import {
  addDays,
  localClock,
  minutesAfterEvening,
  nightOf,
  type LocalClock,
} from "./local-clock";

/**
 * The three dashboard charts that need more than one value a day, worked out
 * on the server from the FHIR bundle a sync stored: steps through the latest
 * day by the hour against the usual day, last night's sleep stages, and 14
 * bedtimes. Pure; the detail route reads the bundle and sends only this.
 *
 * What goes out is the least the charts need: whole step counts per hour,
 * stage blocks and bedtimes as whole minutes after 6 PM, and day names the
 * summary already holds. No timestamp, offset, record or vendor id, and no
 * value the charts do not draw.
 *
 * Which source has what (the bundles open-twin builds):
 * - Oura: sleep periods with a 5-minute hypnogram and bedtimes; steps only as
 *   daily totals, so no hourly steps.
 * - WHOOP: sleep starts (bedtimes) and time in bed; stages only as totals,
 *   and not kept, so no hypnogram; no steps.
 * - Google Health: step intervals, sleep sessions with their stage segments.
 */

export type StageName = "awake" | "rem" | "core" | "deep";

/** One block of the night, in minutes after 6 PM on the evening before `day`. */
export type StageSegment = Readonly<{ stage: StageName; start: number; end: number }>;

/** `not-provided`: the source never sends this. `missing`: it could, but nothing is in the window. */
export type StepsDetail =
  | Readonly<{
      status: "ok";
      day: string;
      /** Steps through the end of each hour, midnight to midnight: 24 running totals. */
      hourly: readonly number[];
      /** The mean of the same running totals over the earlier days, or null with fewer than 7. */
      usual: readonly number[] | null;
      /** Earlier days with hourly steps, up to 14. */
      usualDays: number;
    }>
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "not-provided" }>;

/** `totals-only`: the source sends how long each stage lasted, never when. */
export type NightDetail =
  | Readonly<{ status: "ok"; day: string; segments: readonly StageSegment[] }>
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "not-provided" }>
  | Readonly<{ status: "totals-only" }>;

export type BedtimeNight = Readonly<{
  day: string;
  /** Minutes after 6 PM on the evening before `day`; null for a night with no sleep. */
  bedtime: number | null;
  /** Minutes asleep, where the source says. */
  asleep: number | null;
}>;

export type NightsDetail =
  | Readonly<{ status: "ok"; nights: readonly BedtimeNight[] }>
  | Readonly<{ status: "missing" }>;

export type WearableDetail = Readonly<{
  steps: StepsDetail;
  night: NightDetail;
  nights: NightsDetail;
}>;

export type DetailOptions = Readonly<{
  source: WearableSource;
  /** The dashboard's window, YYYY-MM-DD, both ends included. */
  startDate: string;
  endDate: string;
  /** For timestamps written in UTC (WHOOP): the viewer's IANA zone. */
  timeZone: string;
}>;

export const HOURS = 24;
/** Nights the bedtime chart shows. */
export const BEDTIME_NIGHTS = 14;
/** Earlier days a usual day needs, and the most it uses. */
export const USUAL_DAYS_MIN = 7;
export const USUAL_DAYS_MAX = 14;

const LOINC = "http://loinc.org";
const OURA = "http://opentwin.ch/fhir/CodeSystem/oura";
const WHOOP = "http://opentwin.ch/fhir/CodeSystem/whoop";
const GOOGLE = "http://opentwin.ch/fhir/CodeSystem/google-health";
const OURA_PHASES = "http://opentwin.ch/fhir/StructureDefinition/oura-sleep-phase-5-min";

const STEPS_CODE = "55423-8";
const SLEEP_DURATION_CODE = "93832-4";
const TIME_IN_BED_CODE = "103213-5";

/** Oura's hypnogram: one character per 5 minutes from bedtime. */
const OURA_PHASE: Readonly<Record<string, StageName>> = {
  "1": "deep",
  "2": "core",
  "3": "rem",
  "4": "awake",
};
const OURA_PHASE_MS = 5 * 60_000;

/** Google's stage types. Classic sleep (ASLEEP, RESTLESS) has no stages and is left out. */
const GOOGLE_STAGE: Readonly<Record<string, StageName>> = {
  AWAKE: "awake",
  REM: "rem",
  LIGHT: "core",
  DEEP: "deep",
};

/* --- reading the bundle ---------------------------------------------------- */

const observations = (bundle: Bundle | null): readonly Observation[] =>
  (bundle?.entry ?? []).flatMap((entry) => {
    const resource = entry.resource;
    return resource?.resourceType === "Observation" ? [resource as Observation] : [];
  });

const coded = (
  concept: Observation["code"] | undefined,
  system: string,
  codes: readonly string[],
): boolean =>
  (concept?.coding ?? []).some(
    (c) => c.system === system && c.code !== undefined && codes.includes(c.code),
  );

const componentValue = (observation: Observation, code: string): number | null => {
  const value = (observation.component ?? []).find((c) => coded(c.code, LOINC, [code]))
    ?.valueQuantity?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const quantity = (observation: Observation): number | null => {
  const value = observation.valueQuantity?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** A stage block as two moments, before it is placed on the night. */
type RawStage = Readonly<{ stage: StageName; startMs: number; endMs: number }>;

type SleepPeriod = Readonly<{
  start: LocalClock;
  /** Length in minutes, to pick the main sleep of a night. */
  length: number;
  asleep: number | null;
  stages: readonly RawStage[];
}>;

const epoch = (iso: string | undefined): number | null => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Runs of one character become one block each. */
export const ouraStages = (phases: string, startMs: number): readonly RawStage[] =>
  [...phases].reduce<RawStage[]>((blocks, char, i) => {
    const stage = OURA_PHASE[char];
    if (!stage) return blocks;
    const startAt = startMs + i * OURA_PHASE_MS;
    const last = blocks.at(-1);
    if (last && last.stage === stage && last.endMs === startAt) {
      return [...blocks.slice(0, -1), { ...last, endMs: startAt + OURA_PHASE_MS }];
    }
    return [...blocks, { stage, startMs: startAt, endMs: startAt + OURA_PHASE_MS }];
  }, []);

const ouraPeriods = (all: readonly Observation[], timeZone: string): SleepPeriod[] =>
  all.flatMap((o) => {
    if (!coded(o.code, OURA, ["sleep-score"]) || o.code.text === "rest") return [];
    const start = localClock(o.effectivePeriod?.start, timeZone);
    const endMs = epoch(o.effectivePeriod?.end);
    if (!start || endMs === null || endMs <= start.epochMs) return [];
    const phases = o.extension?.find((e) => e.url === OURA_PHASES)?.valueString ?? "";
    return [
      {
        start,
        length: (endMs - start.epochMs) / 60_000,
        asleep: componentValue(o, SLEEP_DURATION_CODE),
        stages: ouraStages(phases, start.epochMs),
      },
    ];
  });

/** WHOOP writes a few Observations per sleep, all at its start; one period per start. */
const whoopPeriods = (all: readonly Observation[], timeZone: string): SleepPeriod[] => {
  const byStart = all.reduce<Map<string, Observation[]>>((map, o) => {
    const isSleep =
      coded(o.code, WHOOP, ["sleep-performance", "sleep-efficiency"]) ||
      coded(o.code, LOINC, [TIME_IN_BED_CODE]);
    if (!isSleep || !o.effectiveDateTime) return map;
    return new Map(map).set(o.effectiveDateTime, [
      ...(map.get(o.effectiveDateTime) ?? []),
      o,
    ]);
  }, new Map());
  return [...byStart].flatMap(([iso, group]) => {
    const start = localClock(iso, timeZone);
    if (!start) return [];
    const inBed = group.find((o) => coded(o.code, LOINC, [TIME_IN_BED_CODE]));
    return [{ start, length: (inBed && quantity(inBed)) ?? 0, asleep: null, stages: [] }];
  });
};

const googlePeriods = (all: readonly Observation[], timeZone: string): SleepPeriod[] => {
  const stages = all.flatMap((o): RawStage[] => {
    if (!coded(o.code, GOOGLE, ["sleep-stage"])) return [];
    const type = o.valueCodeableConcept?.coding?.[0]?.code ?? "";
    const stage = GOOGLE_STAGE[type];
    const startMs = epoch(o.effectivePeriod?.start);
    const endMs = epoch(o.effectivePeriod?.end);
    if (!stage || startMs === null || endMs === null || endMs <= startMs) return [];
    return [{ stage, startMs, endMs }];
  });
  return all.flatMap((o) => {
    if (!coded(o.code, GOOGLE, ["sleep"])) return [];
    const start = localClock(o.effectivePeriod?.start, timeZone);
    const endMs = epoch(o.effectivePeriod?.end);
    if (!start || endMs === null || endMs <= start.epochMs) return [];
    return [
      {
        start,
        length: (endMs - start.epochMs) / 60_000,
        asleep: componentValue(o, SLEEP_DURATION_CODE),
        stages: stages.filter((s) => s.startMs >= start.epochMs && s.endMs <= endMs),
      },
    ];
  });
};

const PERIODS: Readonly<
  Record<
    WearableSource,
    (all: readonly Observation[], timeZone: string) => readonly SleepPeriod[]
  >
> = { oura: ouraPeriods, whoop: whoopPeriods, "google-health": googlePeriods };

/* --- steps ----------------------------------------------------------------- */

type StepSample = Readonly<{ clock: LocalClock; count: number }>;

const googleSteps = (all: readonly Observation[], timeZone: string): StepSample[] =>
  all.flatMap((o) => {
    if (!coded(o.code, LOINC, [STEPS_CODE])) return [];
    const count = quantity(o);
    const clock = localClock(o.effectivePeriod?.start ?? o.effectiveDateTime, timeZone);
    return count === null || count < 0 || !clock ? [] : [{ clock, count }];
  });

/**
 * Steps per local hour, by the hour each sample starts in, per day. On the
 * night the clocks go back, the repeated hour holds both; on the night they
 * go forward, the skipped hour stays at 0.
 */
export const hourBuckets = (
  samples: readonly StepSample[],
): ReadonlyMap<string, readonly number[]> =>
  samples.reduce<Map<string, number[]>>((days, { clock, count }) => {
    const hours = [...(days.get(clock.date) ?? Array<number>(HOURS).fill(0))];
    const hour = Math.min(HOURS - 1, Math.floor(clock.minutes / 60));
    hours[hour] = hours[hour]! + count;
    return new Map(days).set(clock.date, hours);
  }, new Map());

/** Running totals: the steps through the end of each hour. */
export const cumulative = (hours: readonly number[]): number[] =>
  hours.reduce<number[]>((sums, n) => [...sums, (sums.at(-1) ?? 0) + n], []);

/** The mean of several running-total days, hour by hour, in whole steps. */
export const meanCurve = (days: readonly (readonly number[])[]): number[] | null =>
  days.length === 0
    ? null
    : Array.from({ length: HOURS }, (_, h) =>
        Math.round(days.reduce((sum, day) => sum + (day[h] ?? 0), 0) / days.length),
      );

const inWindow = (day: string, options: DetailOptions): boolean =>
  day >= options.startDate && day <= options.endDate;

export const stepsDetail = (
  samples: readonly StepSample[],
  options: DetailOptions,
): StepsDetail => {
  const buckets = hourBuckets(samples);
  const days = [...buckets.keys()].filter((d) => inWindow(d, options)).sort();
  const day = days.at(-1);
  if (!day) return { status: "missing" };
  const earlier = days.slice(0, -1).slice(-USUAL_DAYS_MAX);
  const curves = earlier.map((d) => cumulative(buckets.get(d)!));
  return {
    status: "ok",
    day,
    hourly: cumulative(buckets.get(day)!).map((n) => Math.round(n)),
    usual: curves.length >= USUAL_DAYS_MIN ? meanCurve(curves) : null,
    usualDays: earlier.length,
  };
};

/* --- nights ---------------------------------------------------------------- */

/** The main sleep of each night: the longest period that starts in it. */
export const mainSleeps = (
  periods: readonly SleepPeriod[],
): ReadonlyMap<string, SleepPeriod> =>
  [...periods]
    .sort((a, b) => a.start.epochMs - b.start.epochMs)
    .reduce<Map<string, SleepPeriod>>((nights, period) => {
      const night = nightOf(period.start);
      const kept = nights.get(night);
      return kept && kept.length >= period.length
        ? nights
        : new Map(nights).set(night, period);
    }, new Map());

/** Blocks in time order, placed after 6 PM on the night's evening, in whole minutes. */
export const placeStages = (period: SleepPeriod): StageSegment[] => {
  const bedtime = minutesAfterEvening(period.start.minutes);
  const at = (ms: number) => Math.round(bedtime + (ms - period.start.epochMs) / 60_000);
  return [...period.stages]
    .sort((a, b) => a.startMs - b.startMs)
    .map((s) => ({ stage: s.stage, start: at(s.startMs), end: at(s.endMs) }))
    .filter((s) => s.end > s.start);
};

const nightDetail = (
  source: WearableSource,
  latest: Readonly<{ day: string; period: SleepPeriod }> | null,
): NightDetail => {
  if (!latest) return { status: "missing" };
  if (source === "whoop") return { status: "totals-only" };
  const segments = placeStages(latest.period);
  return segments.length === 0
    ? { status: "missing" }
    : { status: "ok", day: latest.day, segments };
};

const nightsDetail = (
  nights: ReadonlyMap<string, SleepPeriod>,
  last: string | undefined,
): NightsDetail => {
  if (!last) return { status: "missing" };
  return {
    status: "ok",
    nights: Array.from({ length: BEDTIME_NIGHTS }, (_, i) => {
      const day = addDays(last, i + 1 - BEDTIME_NIGHTS);
      const period = nights.get(day);
      return {
        day,
        bedtime: period ? minutesAfterEvening(period.start.minutes) : null,
        asleep: period?.asleep == null ? null : Math.round(period.asleep),
      };
    }),
  };
};

/** The three charts' data from one stored bundle, for one source and window. */
export const wearableDetail = (
  bundle: Bundle | null,
  options: DetailOptions,
): WearableDetail => {
  const all = observations(bundle);
  const nights = new Map(
    [...mainSleeps(PERIODS[options.source](all, options.timeZone))].filter(([day]) =>
      inWindow(day, options),
    ),
  );
  const last = [...nights.keys()].sort().at(-1);
  return {
    steps:
      options.source === "google-health"
        ? stepsDetail(googleSteps(all, options.timeZone), options)
        : { status: "not-provided" },
    night: nightDetail(
      options.source,
      last ? { day: last, period: nights.get(last)! } : null,
    ),
    nights: nightsDetail(nights, last),
  };
};

/** How many of the three charts have data: the personal-read row's count. */
export const detailRowCount = (detail: WearableDetail): number =>
  [detail.steps.status, detail.night.status, detail.nights.status].filter(
    (status) => status === "ok",
  ).length;
