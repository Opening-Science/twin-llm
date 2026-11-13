/**
 * Host CLI: synthetic Oura, WHOOP and Google Health daily summaries for
 * synthetic people, with the source rules' answer planted in them (#508).
 *
 *   bun run wearables:two-source
 *   bun run wearables:two-source -- --seed 508 --people 10 --days 30 --end 2026-10-01 --out <dir>
 *   bun run wearables:two-source -- --shares agree=4,no_day=0
 *
 * Every measure and day the source rules compare (`wearable-source-rules.ts`)
 * gets one planted case: the sources agree within the tolerance; they disagree
 * beyond it and published validation names a winner; they disagree and nothing
 * decides (no grade, tied grades, a unit that cannot be compared, no day); or
 * only one source recorded it. The tolerances come from `SOURCE_TOLERANCE` and
 * the grades from the evidence judge the app uses, so the plants follow the
 * rules on main rather than a copy of their numbers. Which cases each measure
 * can carry is worked out by asking the judge and the rules, pair by pair; a
 * case they cannot produce for a measure is never planted for it.
 *
 * The case shares are a config (`DEFAULT_CASE_SHARES`, `--shares`) and are
 * written to the manifest; the seed places the cases and draws the values.
 * The same seed and shares write the same bytes. Everything written is tagged
 * as test data. It reads no person's data and writes files only: it has no
 * path to any database. Prints counts only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  GoogleHealthMetric,
  GoogleHealthSummary,
} from "@/infrastructure/google-health-types";
import { judgeByEvidence } from "@/infrastructure/open-twin-adapters/aggregate";
import type { OuraMetric, OuraSummary } from "@/infrastructure/oura-types";
import { normal, randomFor, type Random } from "@/infrastructure/seeded-random";
import {
  sourceOfMetricKey,
  WEARABLE_SOURCE_IDS,
  type WearableSourceId,
} from "@/infrastructure/wearable-provenance";
import {
  appliedTolerance,
  COMPARABLE_STEMS,
  decideSources,
  SOURCE_MEASURES,
  SOURCE_RULES_VERSION,
  SOURCE_TOLERANCE,
  SOURCE_UNITS,
  withinTolerance,
  type EvidenceJudge,
  type HoldReason,
  type SourceDecisionKind,
  type SourceMeasure,
} from "@/infrastructure/wearable-source-rules";
import type { WhoopMetric, WhoopSummary } from "@/infrastructure/whoop-types";

import { DEFAULT_END_DAY } from "./series";

export const TWO_SOURCE_GENERATOR = "twin-llm/two-source-wearables/1";
export const DEFAULT_TWO_SOURCE_SEED = 508;
export const DEFAULT_PEOPLE = 10;
export const DEFAULT_TWO_SOURCE_DAYS = 30;
export const DEFAULT_OUT_ROOT = ".synthetic-wearables";

const TEST_DATA_NOTE =
  "Synthetic test data for the source-rules study (#508). No real person. Never ingest into a database.";

/** The cases planted, in the order they are counted. */
export const PLANTED_CASES = [
  "agree",
  "evidence",
  "no_evidence",
  "evidence_tie",
  "no_dependable_source",
  "units_differ",
  "no_day",
  "only_source",
] as const;

export type PlantedCase = (typeof PLANTED_CASES)[number];

export const PLANTED_GROUPS = [
  "agree",
  "disagree_with_winner",
  "no_decision",
  "one_source_missing",
] as const;

export type PlantedGroup = (typeof PLANTED_GROUPS)[number];

export const CASE_GROUP: Readonly<Record<PlantedCase, PlantedGroup>> = {
  agree: "agree",
  evidence: "disagree_with_winner",
  no_evidence: "no_decision",
  evidence_tie: "no_decision",
  no_dependable_source: "no_decision",
  units_differ: "no_decision",
  no_day: "no_decision",
  only_source: "one_source_missing",
};

export type CaseShares = Readonly<Record<PlantedCase, number>>;

/**
 * Relative weights of the cases within each measure. A measure shares its
 * person-days among the cases it can carry, in these proportions (largest
 * remainder, ties to the earlier case). `no_day` is capped at one per person
 * and measure, because the rules pool every dateless reading of a measure
 * into one decision; what the cap takes goes back to the other cases.
 */
export const DEFAULT_CASE_SHARES: CaseShares = {
  agree: 3,
  evidence: 3,
  no_evidence: 2,
  evidence_tie: 2,
  no_dependable_source: 2,
  units_differ: 2,
  no_day: 1,
  only_source: 2,
};

/**
 * A unit each measure is sometimes exported in that the rules do not accept
 * for it, and the factor from the accepted unit: HRV in seconds, a heart rate
 * in hertz, oxygen saturation as a fraction. Step counts have none.
 */
export const FOREIGN_UNITS: Readonly<
  Partial<Record<SourceMeasure, Readonly<{ unit: string; factor: number }>>>
> = {
  "heart-rate-variability": { unit: "s", factor: 1 / 1000 },
  "resting-heart-rate": { unit: "Hz", factor: 1 / 60 },
  "oxygen-saturation": { unit: "1", factor: 1 / 100 },
};

/**
 * Decimal places each source's summary stores, as its summary code writes
 * them: WHOOP rounds HRV and SpO2 to one place (`features/whoop/summary.ts`);
 * Oura's API and Google Health's daily values are whole numbers.
 */
export const SOURCE_DECIMALS: Readonly<
  Record<WearableSourceId, Readonly<Partial<Record<SourceMeasure, 0 | 1>>>>
> = {
  oura: { "heart-rate-variability": 0, "step-count": 0 },
  whoop: {
    "heart-rate-variability": 1,
    "resting-heart-rate": 0,
    "oxygen-saturation": 1,
  },
  google_health: {
    "heart-rate-variability": 0,
    "resting-heart-rate": 0,
    "oxygen-saturation": 0,
    "step-count": 0,
  },
  bodyloop: {},
};

/** What the rules must decide for a planted measure and day. */
export type PlantedExpectation = Readonly<{
  kind: SourceDecisionKind;
  reason: HoldReason | null;
  /** The source whose reading is used, where the rules name one (`evidence`, `only_source`). */
  used: WearableSourceId | null;
}>;

export type PlantedLabel = Readonly<{
  personId: string;
  /** Null for `no_day`: the readings carry no day, as WHOOP's do when it has none. */
  day: string | null;
  measure: SourceMeasure;
  case: PlantedCase;
  group: PlantedGroup;
  sources: readonly WearableSourceId[];
  keys: readonly string[];
  expected: PlantedExpectation;
}>;

export type SyntheticPerson = Readonly<{
  personId: string;
  oura: OuraSummary;
  whoop: WhoopSummary;
  googleHealth: GoogleHealthSummary;
  planted: readonly PlantedLabel[];
}>;

export type TwoSourceOptions = Readonly<{
  seed: number;
  people: number;
  days: number;
  endDay: string;
  shares: CaseShares;
}>;

export type CaseCounts = Readonly<{
  byCase: Readonly<Record<PlantedCase, number>>;
  byGroup: Readonly<Record<PlantedGroup, number>>;
  byMeasure: Readonly<
    Record<SourceMeasure, Readonly<Partial<Record<PlantedCase, number>>>>
  >;
}>;

export type TwoSourceOutput = Readonly<{
  options: TwoSourceOptions;
  people: readonly SyntheticPerson[];
  counts: CaseCounts;
}>;

type Sources = readonly WearableSourceId[];

/** The sources that record a measure, in the app's source order, from the rules' stem table. */
const sourcesFor = (measure: SourceMeasure): Sources =>
  WEARABLE_SOURCE_IDS.filter((source) =>
    Object.entries(COMPARABLE_STEMS).some(
      ([stem, stemMeasure]) =>
        stemMeasure === measure && sourceOfMetricKey(stem) === source,
    ),
  );

const stemFor = (source: WearableSourceId, measure: SourceMeasure): string => {
  const stem = Object.entries(COMPARABLE_STEMS).find(
    ([key, stemMeasure]) => stemMeasure === measure && sourceOfMetricKey(key) === source,
  )?.[0];
  if (stem === undefined) throw new Error(`No ${source} stem for ${measure}`);
  return stem;
};

/**
 * The stored key, as each source's summary writes it: Oura's sleep keys name
 * the main sleep, and a reading without a day ends in "unknown", as WHOOP's does.
 */
const keyFor = (
  source: WearableSourceId,
  measure: SourceMeasure,
  day: string | null,
): string => {
  const stem = stemFor(source, measure);
  const suffix = day ?? "unknown";
  return source === "oura" && stem.startsWith("sleep.")
    ? `${stem}.long_sleep.${suffix}`
    : `${stem}.${suffix}`;
};

const LABELS: Readonly<Record<string, string>> = {
  "sleep.hrv": "Average HRV during sleep",
  "activity.steps": "Steps",
  "whoop.recovery.hrv": "Whoop HRV RMSSD",
  "whoop.recovery.rhr": "Whoop resting HR",
  "whoop.recovery.spo2": "Whoop SpO2",
  "google.daily-heart-rate-variability": "Daily heart rate variability",
  "google.daily-resting-heart-rate": "Daily resting heart rate",
  "google.daily-oxygen-saturation": "Daily oxygen saturation",
  "google.steps": "Steps",
};

type Reading = Readonly<{ source: WearableSourceId; value: number; unit: string | null }>;

type Metric = OuraMetric & WhoopMetric & GoogleHealthMetric;

const usualUnit = (source: WearableSourceId, measure: SourceMeasure): string | null =>
  // Oura's daily activity carries steps without a unit.
  source === "oura" && measure === "step-count"
    ? null
    : (SOURCE_UNITS[measure][0] ?? null);

const metricFor = (
  reading: Reading,
  measure: SourceMeasure,
  day: string | null,
): Metric => {
  const stem = stemFor(reading.source, measure);
  return {
    key: keyFor(reading.source, measure, day),
    label: `${LABELS[stem] ?? stem} (${day ?? "day unknown"})`,
    value: reading.value,
    ...(day === null ? {} : { date: day }),
    ...(reading.unit === null ? {} : { unit: reading.unit }),
  };
};

const pairsOf = (sources: Sources): readonly Sources[] =>
  sources.flatMap((first, index) =>
    sources.slice(index + 1).map((second): Sources => [first, second]),
  );

/** Whether the rules hold back two dateless readings from these sources as `no_day`. */
const heldWithoutDay = (
  pair: Sources,
  measure: SourceMeasure,
  judge: EvidenceJudge,
): boolean => {
  const metrics = pair.map((source) => ({
    ...metricFor({ source, value: 1, unit: usualUnit(source, measure) }, measure, null),
    source,
  }));
  const [decision, ...rest] = decideSources(metrics, judge);
  return (
    rest.length === 0 && decision?.kind === "held_back" && decision.reason === "no_day"
  );
};

type CasePlan = ReadonlyMap<PlantedCase, readonly Sources[]>;

/**
 * For each measure, the cases that can be planted and the sources each can be
 * planted with. The evidence cases come from the judge and the dateless case
 * from the rules themselves, pair by pair.
 */
export const casePlans = (
  judge: EvidenceJudge,
): Readonly<Record<SourceMeasure, CasePlan>> => {
  const plan = (measure: SourceMeasure): CasePlan => {
    const sources = sourcesFor(measure);
    const found = new Map<PlantedCase, Sources[]>();
    const add = (kind: PlantedCase, value: Sources) =>
      found.set(kind, [...(found.get(kind) ?? []), value]);
    for (const pair of pairsOf(sources)) {
      add("agree", pair);
      const verdict = judge(pair, measure);
      add(verdict.kind === "selected" ? "evidence" : verdict.reason, pair);
      if (FOREIGN_UNITS[measure] !== undefined) add("units_differ", pair);
      if (heldWithoutDay(pair, measure, judge)) add("no_day", pair);
    }
    for (const source of sources) add("only_source", [source]);
    return new Map(
      PLANTED_CASES.flatMap((kind) => {
        const value = found.get(kind);
        return value === undefined ? [] : [[kind, value] as const];
      }),
    );
  };
  return Object.fromEntries(
    SOURCE_MEASURES.map((measure) => [measure, plan(measure)]),
  ) as Record<SourceMeasure, CasePlan>;
};

/** Whole quotas in proportion to the weights; the largest remainders, then the earlier case, take the rest. */
const apportion = (
  cases: readonly PlantedCase[],
  shares: CaseShares,
  slots: number,
): Map<PlantedCase, number> => {
  const total = cases.reduce((sum, kind) => sum + shares[kind], 0);
  if (total <= 0) return new Map();
  const exact = cases.map((kind) => (slots * shares[kind]) / total);
  const quotas = exact.map(Math.floor);
  const left = slots - quotas.reduce((sum, quota) => sum + quota, 0);
  const order = cases
    .map((_, index) => index)
    .sort((a, b) => exact[b]! - quotas[b]! - (exact[a]! - quotas[a]!) || a - b);
  for (const index of order.slice(0, left)) quotas[index] = quotas[index]! + 1;
  return new Map(cases.map((kind, index) => [kind, quotas[index]!]));
};

/** Each measure's quota per case, after the `no_day` cap. */
export const caseQuotas = (
  plan: CasePlan,
  shares: CaseShares,
  people: number,
  days: number,
): ReadonlyMap<PlantedCase, number> => {
  const cases = [...plan.keys()].filter((kind) => shares[kind] > 0);
  const slots = people * days;
  const first = apportion(cases, shares, slots);
  const dateless = Math.min(first.get("no_day") ?? 0, people);
  if (dateless === (first.get("no_day") ?? 0)) return first;
  const rest = apportion(
    cases.filter((kind) => kind !== "no_day"),
    shares,
    slots - dateless,
  );
  return new Map(
    cases.map((kind) => [kind, kind === "no_day" ? dateless : (rest.get(kind) ?? 0)]),
  );
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const daysEnding = (endDay: string, count: number): readonly string[] => {
  const end = Date.parse(`${endDay}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(end - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
};

const shuffled = <T>(items: readonly T[], random: Random): readonly T[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
};

/**
 * The case for every person-day slot of one measure (person-major). Each
 * dateless case goes to a different person, on a random day; the other cases
 * are shuffled over the remaining slots.
 */
const allocation = (
  quotas: ReadonlyMap<PlantedCase, number>,
  people: number,
  days: number,
  random: Random,
): readonly PlantedCase[] => {
  const slots: (PlantedCase | null)[] = Array.from({ length: people * days }, () => null);
  const dateless = quotas.get("no_day") ?? 0;
  const chosen = shuffled(
    Array.from({ length: people }, (_, index) => index),
    random,
  ).slice(0, dateless);
  for (const person of chosen) {
    slots[person * days + Math.floor(random() * days)] = "no_day";
  }
  const rest = shuffled(
    [...quotas].flatMap(([kind, count]) =>
      kind === "no_day" ? [] : Array.from({ length: count }, () => kind),
    ),
    random,
  );
  let next = 0;
  return slots.map((slot) => {
    if (slot !== null) return slot;
    const kind = rest[next];
    next += 1;
    if (kind === undefined) throw new Error("Quotas do not fill the slots");
    return kind;
  });
};

const between = (random: Random, low: number, high: number): number =>
  low + Math.floor(random() * (high - low + 1));

/** A synthetic person's usual level and day-to-day spread; plausible, not fitted to anyone. */
const BASELINE: Readonly<
  Record<
    SourceMeasure,
    Readonly<{ low: number; high: number; spread: number; min: number; max: number }>
  >
> = {
  "heart-rate-variability": { low: 30, high: 80, spread: 6, min: 15, max: 140 },
  "resting-heart-rate": { low: 50, high: 68, spread: 3, min: 40, max: 90 },
  "oxygen-saturation": { low: 95, high: 98, spread: 0.8, min: 92, max: 100 },
  "step-count": { low: 4000, high: 13000, spread: 2000, min: 800, max: 30000 },
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** A source's grid in tenths: 1 for one decimal place, 10 for whole numbers. */
const gridOf = (source: WearableSourceId, measure: SourceMeasure): number =>
  SOURCE_DECIMALS[source][measure] === 1 ? 1 : 10;

const onGrid = (tenths: number, grid: number, direction: "up" | "down"): number =>
  (direction === "up" ? Math.ceil(tenths / grid) : Math.floor(tenths / grid)) * grid;

/**
 * Whether two values sit where the plant wants them: on the wanted side of
 * the rule, and at least a tenth from the bound unless both are whole numbers
 * (two whole numbers may sit on it exactly; a decimal there would leave the
 * answer to floating point).
 */
const placed = (
  values: readonly [number, number],
  measure: SourceMeasure,
  agree: boolean,
): boolean => {
  const tolerance = SOURCE_TOLERANCE[measure];
  if (withinTolerance(values, tolerance) !== agree) return false;
  if (values.every(Number.isInteger)) return true;
  const high = Math.max(...values);
  const gap = Math.abs(high - Math.min(...values) - appliedTolerance(tolerance, high));
  return gap >= 0.1 - 1e-9;
};

/**
 * The lower reading for a high reading `high` (in tenths), on the low
 * source's grid: inside the tolerance for agreement, beyond it otherwise. A
 * quarter of the time it is the nearest such value to the bound.
 */
const lowerTenths = (
  high: number,
  lowGrid: number,
  measure: SourceMeasure,
  agree: boolean,
  random: Random,
): number => {
  const bound = appliedTolerance(SOURCE_TOLERANCE[measure], high / 10) * 10;
  const atEdge = random() < 0.25;
  const spare = Math.floor(bound);
  let low = agree
    ? onGrid(high - (atEdge ? spare : between(random, 0, spare)), lowGrid, "up")
    : onGrid(
        high - Math.ceil(bound) - (atEdge ? 0 : between(random, 0, spare)),
        lowGrid,
        "down",
      );
  // Step toward the side the plant wants until the rule and the margin agree.
  for (let tries = 0; tries < 64; tries += 1) {
    if (placed([high / 10, low / 10], measure, agree)) return low;
    low += agree ? lowGrid : -lowGrid;
  }
  throw new Error(`Could not place a ${agree ? "close" : "distant"} ${measure} reading`);
};

/** The readings for one planted case, checked against the rules before they are kept. */
const plantReadings = (
  kind: PlantedCase,
  sources: Sources,
  measure: SourceMeasure,
  base: number,
  random: Random,
): readonly Reading[] => {
  const [first, second] = sources;
  if (first === undefined) throw new Error("A planted case needs a source");
  const reading = (source: WearableSourceId, tenths: number): Reading => ({
    source,
    value: tenths / 10,
    unit: usualUnit(source, measure),
  });
  const swap = random() < 0.5;
  const [upper, lower] = swap ? [second, first] : [first, second];
  if (kind === "only_source" || upper === undefined || lower === undefined) {
    if (kind !== "only_source") throw new Error(`${kind} needs two sources`);
    return [reading(first, onGrid(base * 10, gridOf(first, measure), "down"))];
  }
  const { max } = BASELINE[measure];
  // A source that stores tenths gets a tenths digit of its own.
  const tenth = gridOf(upper, measure) === 1 ? Math.floor(random() * 10) : 0;
  const high = Math.min(base * 10 + tenth, max * 10);
  const agree = kind === "agree" || kind === "units_differ" || kind === "no_day";
  const low = lowerTenths(high, gridOf(lower, measure), measure, agree, random);
  const readings = [reading(upper, high), reading(lower, low)].sort(
    (a, b) => sources.indexOf(a.source) - sources.indexOf(b.source),
  );
  if (kind !== "units_differ") return readings;
  const foreign = FOREIGN_UNITS[measure];
  if (foreign === undefined) throw new Error(`No foreign unit for ${measure}`);
  const index = random() < 0.5 ? 0 : 1;
  return readings.map((item, at) =>
    at === index
      ? {
          ...item,
          value: Math.round(item.value * foreign.factor * 10_000) / 10_000,
          unit: foreign.unit,
        }
      : item,
  );
};

const expectationFor = (
  kind: PlantedCase,
  sources: Sources,
  measure: SourceMeasure,
  judge: EvidenceJudge,
): PlantedExpectation => {
  switch (kind) {
    case "agree":
      return { kind: "agree", reason: null, used: null };
    case "only_source":
      return { kind: "only_source", reason: null, used: sources[0] ?? null };
    case "evidence": {
      const verdict = judge(sources, measure);
      if (verdict.kind !== "selected") throw new Error("The judge named no winner");
      return { kind: "evidence", reason: null, used: verdict.winner };
    }
    case "no_evidence":
    case "evidence_tie":
    case "no_dependable_source":
    case "units_differ":
    case "no_day":
      return { kind: "held_back", reason: kind, used: null };
  }
};

/**
 * Readings the rules never compare, so a reader of the files meets the same
 * neighbours a real summary has: Oura's sleeping heart rate is not WHOOP's
 * resting heart rate, and a recovery score is no one else's measure.
 */
const decoys = (
  personId: string,
  day: string,
  seed: number,
): Readonly<Record<"oura" | "whoop", readonly Metric[]>> => {
  const random = randomFor(seed, `${personId}|${day}|decoys`);
  return {
    oura: [
      {
        key: `sleep.hr.long_sleep.${day}`,
        label: `Average heart rate during sleep (${day})`,
        value: between(random, 48, 66),
        date: day,
        unit: "bpm",
      },
    ],
    whoop: [
      {
        key: `whoop.recovery.score.${day}`,
        label: `Whoop recovery score (${day})`,
        value: between(random, 20, 95),
        date: day,
      },
    ],
  };
};

const byDayThenKey = (a: Metric, b: Metric): number =>
  (b.date ?? "").localeCompare(a.date ?? "") || a.key.localeCompare(b.key);

const narrative = (
  source: string,
  seed: number,
  personId: string,
  count: number,
): string => `${TEST_DATA_NOTE} ${source}, seed ${seed}, ${personId}: ${count} readings.`;

const emptyCounts = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

export const generateTwoSource = (
  options: TwoSourceOptions,
  judge: EvidenceJudge,
): TwoSourceOutput => {
  const { seed, people, days: dayCount, endDay, shares } = options;
  const plans = casePlans(judge);
  const days = daysEnding(endDay, dayCount);
  const ids = Array.from(
    { length: people },
    (_, index) => `test-${seed}-person-${String(index + 1).padStart(2, "0")}`,
  );
  const quotas = Object.fromEntries(
    SOURCE_MEASURES.map((measure) => [
      measure,
      caseQuotas(plans[measure], shares, people, dayCount),
    ]),
  ) as Record<SourceMeasure, ReadonlyMap<PlantedCase, number>>;
  const assigned = Object.fromEntries(
    SOURCE_MEASURES.map((measure) => [
      measure,
      allocation(
        quotas[measure],
        people,
        dayCount,
        randomFor(seed, `allocate|${measure}`),
      ),
    ]),
  ) as Record<SourceMeasure, readonly PlantedCase[]>;

  const byCase = emptyCounts(PLANTED_CASES);
  const byGroup = emptyCounts(PLANTED_GROUPS);
  const byMeasure = Object.fromEntries(
    SOURCE_MEASURES.map((measure) => [
      measure,
      Object.fromEntries([...plans[measure].keys()].map((kind) => [kind, 0])),
    ]),
  ) as Record<SourceMeasure, Partial<Record<PlantedCase, number>>>;

  const persons = ids.map((personId, personIndex): SyntheticPerson => {
    const levels = Object.fromEntries(
      SOURCE_MEASURES.map((measure) => {
        const { low, high } = BASELINE[measure];
        return [
          measure,
          low + randomFor(seed, `${personId}|level|${measure}`)() * (high - low),
        ];
      }),
    ) as Record<SourceMeasure, number>;
    const metrics: Record<"oura" | "whoop" | "google_health", Metric[]> = {
      oura: [],
      whoop: [],
      google_health: [],
    };
    const planted: PlantedLabel[] = [];
    for (const [dayIndex, day] of days.entries()) {
      const decoy = decoys(personId, day, seed);
      metrics.oura.push(...decoy.oura);
      metrics.whoop.push(...decoy.whoop);
      for (const measure of SOURCE_MEASURES) {
        const kind = assigned[measure][personIndex * dayCount + dayIndex];
        const choices = kind === undefined ? undefined : plans[measure].get(kind);
        if (kind === undefined || choices === undefined || choices.length === 0) {
          throw new Error(`No plan for ${measure}`);
        }
        const random = randomFor(seed, `${personId}|${day}|${measure}`);
        const sources = choices[Math.floor(random() * choices.length)]!;
        const { spread, min, max } = BASELINE[measure];
        const base = Math.round(
          clamp(levels[measure] + spread * normal(random), min, max),
        );
        const readings = plantReadings(kind, sources, measure, base, random);
        const recordedDay = kind === "no_day" ? null : day;
        const written = readings.map((reading) =>
          metricFor(reading, measure, recordedDay),
        );
        for (const [index, reading] of readings.entries()) {
          if (reading.source === "bodyloop")
            throw new Error("BodyLoop records no wearable measure");
          metrics[reading.source].push(written[index]!);
        }
        planted.push({
          personId,
          day: recordedDay,
          measure,
          case: kind,
          group: CASE_GROUP[kind],
          sources,
          keys: written.map((metric) => metric.key),
          expected: expectationFor(kind, sources, measure, judge),
        });
        byCase[kind] += 1;
        byGroup[CASE_GROUP[kind]] += 1;
        byMeasure[measure][kind] = (byMeasure[measure][kind] ?? 0) + 1;
      }
    }
    const window = { startDate: days[0] ?? endDay, endDate: endDay };
    const summary = (source: string, list: Metric[]) => {
      const sorted = [...list].sort(byDayThenKey);
      return {
        window,
        metrics: sorted,
        narrative: narrative(source, seed, personId, sorted.length),
      };
    };
    return {
      personId,
      oura: summary("Oura", metrics.oura),
      whoop: summary("WHOOP", metrics.whoop),
      googleHealth: summary("Google Health", metrics.google_health),
      planted,
    };
  });
  return { options, people: persons, counts: { byCase, byGroup, byMeasure } };
};

/** The files to write, by path under the output folder, as the exact text written. */
export const renderTwoSource = (output: TwoSourceOutput): ReadonlyMap<string, string> => {
  const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const { seed, people, days, endDay, shares } = output.options;
  const header = {
    testData: true,
    note: TEST_DATA_NOTE,
    generator: TWO_SOURCE_GENERATOR,
    rulesVersion: SOURCE_RULES_VERSION,
    seed,
  };
  const files = new Map<string, string>();
  files.set(
    "manifest.json",
    text({ ...header, people, days, endDay, shares, counts: output.counts }),
  );
  for (const person of output.people) {
    files.set(
      `people/${person.personId}.json`,
      text({
        ...header,
        personId: person.personId,
        oura: person.oura,
        whoop: person.whoop,
        googleHealth: person.googleHealth,
      }),
    );
    files.set(
      `planted/${person.personId}.json`,
      text({ ...header, personId: person.personId, planted: person.planted }),
    );
  }
  return files;
};

export type TwoSourceArgs = TwoSourceOptions & Readonly<{ output: string }>;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const wholeNumber = (
  text: string | undefined,
  fallback: number,
  low: number,
  high: number,
): number | null => {
  const value = Number(text ?? fallback);
  return Number.isInteger(value) && value >= low && value <= high ? value : null;
};

const isPlantedCase = (value: string): value is PlantedCase =>
  (PLANTED_CASES as readonly string[]).includes(value);

/** `agree=4,no_day=0` over the defaults, or a message. */
export const parseShares = (text: string | undefined): CaseShares | string => {
  if (text === undefined) return DEFAULT_CASE_SHARES;
  const shares: Record<PlantedCase, number> = { ...DEFAULT_CASE_SHARES };
  for (const part of text.split(",")) {
    const [name = "", weight = ""] = part.split("=");
    const value = Number(weight);
    if (!isPlantedCase(name) || weight === "" || !Number.isFinite(value) || value < 0) {
      return `--shares takes case=weight pairs, weights 0 or more, cases from: ${PLANTED_CASES.join(", ")}.`;
    }
    shares[name] = value;
  }
  return shares;
};

/** The parsed flags, or a plain message saying what is wrong. */
export const parseTwoSourceArgs = (argv: readonly string[]): TwoSourceArgs | string => {
  const seed = wholeNumber(flag(argv, "--seed"), DEFAULT_TWO_SOURCE_SEED, 0, 2 ** 32 - 1);
  if (seed === null) return "--seed must be a whole number.";
  const people = wholeNumber(flag(argv, "--people"), DEFAULT_PEOPLE, 1, 1000);
  if (people === null) return "--people must be a whole number from 1 to 1000.";
  const days = wholeNumber(flag(argv, "--days"), DEFAULT_TWO_SOURCE_DAYS, 1, 730);
  if (days === null) return "--days must be a whole number from 1 to 730.";
  const endDay = flag(argv, "--end") ?? DEFAULT_END_DAY;
  if (!ISO_DAY.test(endDay) || Number.isNaN(Date.parse(`${endDay}T00:00:00Z`))) {
    return "--end must be a date like 2026-10-01.";
  }
  const shares = parseShares(flag(argv, "--shares"));
  if (typeof shares === "string") return shares;
  const plans = casePlans(judgeByEvidence);
  const empty = SOURCE_MEASURES.filter((measure) =>
    [...plans[measure].keys()].every((kind) => shares[kind] <= 0),
  );
  if (empty.length > 0) {
    return `--shares leaves no case for ${empty.join(", ")}.`;
  }
  return {
    seed,
    people,
    days,
    endDay,
    shares,
    output: flag(argv, "--out") ?? join(DEFAULT_OUT_ROOT, `two-source-seed${seed}`),
  };
};

export type TwoSourceIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export const runTwoSource = async (
  argv: readonly string[],
  io: TwoSourceIo,
  writeText: (path: string, text: string) => Promise<void>,
  judge: EvidenceJudge = judgeByEvidence,
): Promise<number> => {
  const args = parseTwoSourceArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  const { output: folder, ...options } = args;
  const output = generateTwoSource(options, judge);
  const files = renderTwoSource(output);
  for (const [path, text] of files) await writeText(join(folder, path), text);
  io.stdout.write(
    [
      `Synthetic test data written to ${folder} (${TWO_SOURCE_GENERATOR}, ${SOURCE_RULES_VERSION}, seed ${args.seed})`,
      `People: ${args.people}, days: ${args.days} ending ${args.endDay}, files: ${files.size}`,
      `Planted: ${PLANTED_CASES.map((kind) => `${kind} ${output.counts.byCase[kind]}`).join(", ")}`,
      "",
    ].join("\n"),
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runTwoSource(process.argv.slice(2), process, async (path, text) => {
    const target = resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  });
  process.exit(code);
}
