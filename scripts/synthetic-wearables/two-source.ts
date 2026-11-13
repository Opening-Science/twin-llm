/**
 * Host CLI: synthetic Oura, WHOOP and Google Health daily summaries for
 * synthetic people, with the source rules' answer planted in them (#508).
 *
 *   bun run wearables:two-source
 *   bun run wearables:two-source -- --seed 508 --people 10 --days 30 --end 2026-10-01 --out <dir>
 *
 * Every measure and day the source rules compare (`wearable-source-rules.ts`)
 * gets one planted case: the sources agree within the tolerance; they disagree
 * beyond it and published validation names a winner; they disagree and nothing
 * decides (no grade, tied grades, a unit that cannot be compared); or only one
 * source recorded it. The tolerances come from `SOURCE_TOLERANCE` and the
 * grades from the evidence judge the app uses, so the plants follow the rules
 * on main rather than a copy of their numbers. A case the judge cannot produce
 * for a measure (WHOOP and Google Health have no grade between them for HRV,
 * so no winner is possible there) is never planted for it.
 *
 * Counts are fixed by the quotas below; the seed places the cases and draws
 * the values. The same seed writes the same bytes. Everything written is
 * tagged as test data. It reads no person's data and writes files only: it
 * has no path to any database. Prints counts only.
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
  only_source: "one_source_missing",
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

/** What the rules must decide for a planted measure and day. */
export type PlantedExpectation = Readonly<{
  kind: SourceDecisionKind;
  reason: HoldReason | null;
  /** The source whose reading is used, where the rules name one (`evidence`, `only_source`). */
  used: WearableSourceId | null;
}>;

export type PlantedLabel = Readonly<{
  personId: string;
  day: string;
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

/** The stored key, as each source's summary writes it; Oura's sleep keys name the main sleep. */
const keyFor = (
  source: WearableSourceId,
  measure: SourceMeasure,
  day: string,
): string => {
  const stem = stemFor(source, measure);
  return source === "oura" && stem.startsWith("sleep.")
    ? `${stem}.long_sleep.${day}`
    : `${stem}.${day}`;
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

const pairsOf = (sources: Sources): readonly Sources[] =>
  sources.flatMap((first, index) =>
    sources.slice(index + 1).map((second): Sources => [first, second]),
  );

type CasePlan = ReadonlyMap<PlantedCase, readonly Sources[]>;

/**
 * For each measure, the cases that can be planted and the sources each can be
 * planted with. The evidence cases come from the judge itself, pair by pair.
 */
export const casePlans = (
  judge: EvidenceJudge,
): Readonly<Record<SourceMeasure, CasePlan>> => {
  const plan = (measure: SourceMeasure): CasePlan => {
    const sources = sourcesFor(measure);
    const pairs = pairsOf(sources);
    const found = new Map<PlantedCase, Sources[]>();
    const add = (kind: PlantedCase, value: Sources) =>
      found.set(kind, [...(found.get(kind) ?? []), value]);
    for (const pair of pairs) {
      add("agree", pair);
      const verdict = judge(pair, measure);
      add(verdict.kind === "selected" ? "evidence" : verdict.reason, pair);
      if (FOREIGN_UNITS[measure] !== undefined) add("units_differ", pair);
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

/** Even quotas over the slots; the first cases in count order take any remainder. */
const allocation = (
  cases: readonly PlantedCase[],
  slots: number,
  random: Random,
): readonly PlantedCase[] => {
  const share = Math.floor(slots / cases.length);
  const extra = slots - share * cases.length;
  return shuffled(
    cases.flatMap((kind, index) =>
      Array.from({ length: share + (index < extra ? 1 : 0) }, () => kind),
    ),
    random,
  );
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

type Reading = Readonly<{ source: WearableSourceId; value: number; unit: string | null }>;

const usualUnit = (source: WearableSourceId, measure: SourceMeasure): string | null =>
  // Oura's daily activity carries steps without a unit.
  source === "oura" && measure === "step-count"
    ? null
    : (SOURCE_UNITS[measure][0] ?? null);

/** The readings for one planted case, checked against the rules before they are kept. */
const plantReadings = (
  kind: PlantedCase,
  sources: Sources,
  measure: SourceMeasure,
  base: number,
  random: Random,
): readonly Reading[] => {
  const tolerance = SOURCE_TOLERANCE[measure];
  const { max } = BASELINE[measure];
  const [first, second] = sources;
  if (first === undefined) throw new Error("A planted case needs a source");
  if (kind === "only_source")
    return [{ source: first, value: base, unit: usualUnit(first, measure) }];
  if (second === undefined) throw new Error(`${kind} needs two sources`);
  const room = Math.floor(appliedTolerance(tolerance, base));
  const swap = random() < 0.5;
  let other: number;
  if (kind === "agree" || kind === "units_differ") {
    const delta = between(random, -room, room);
    other = base + delta > max ? base - Math.abs(delta) : base + delta;
    if (!withinTolerance([base, other], tolerance)) {
      throw new Error(`Planted agreement is outside the ${measure} tolerance`);
    }
  } else {
    other = base - (room + 1 + between(random, 0, room));
    if (withinTolerance([base, other], tolerance)) {
      throw new Error(`Planted disagreement is inside the ${measure} tolerance`);
    }
  }
  const [a, b] = swap ? [other, base] : [base, other];
  const readings: Reading[] = [
    { source: first, value: a, unit: usualUnit(first, measure) },
    { source: second, value: b, unit: usualUnit(second, measure) },
  ];
  if (kind !== "units_differ") return readings;
  const foreign = FOREIGN_UNITS[measure];
  if (foreign === undefined) throw new Error(`No foreign unit for ${measure}`);
  const index = random() < 0.5 ? 0 : 1;
  const target = readings[index]!;
  readings[index] = {
    ...target,
    value: Math.round(target.value * foreign.factor * 1000) / 1000,
    unit: foreign.unit,
  };
  return readings;
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
    case "units_differ":
      return { kind: "held_back", reason: "units_differ", used: null };
    case "evidence": {
      const verdict = judge(sources, measure);
      if (verdict.kind !== "selected") throw new Error("The judge named no winner");
      return { kind: "evidence", reason: null, used: verdict.winner };
    }
    case "no_evidence":
    case "evidence_tie":
    case "no_dependable_source":
      return { kind: "held_back", reason: kind, used: null };
  }
};

type Metric = OuraMetric & WhoopMetric & GoogleHealthMetric;

const metricFor = (reading: Reading, measure: SourceMeasure, day: string): Metric => {
  const key = keyFor(reading.source, measure, day);
  const stem = stemFor(reading.source, measure);
  return {
    key,
    label: `${LABELS[stem] ?? stem} (${day})`,
    value: reading.value,
    date: day,
    ...(reading.unit === null ? {} : { unit: reading.unit }),
  };
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
  const { seed, people, days: dayCount, endDay } = options;
  const plans = casePlans(judge);
  const days = daysEnding(endDay, dayCount);
  const ids = Array.from(
    { length: people },
    (_, index) => `test-${seed}-person-${String(index + 1).padStart(2, "0")}`,
  );
  const slots = people * dayCount;
  const assigned = Object.fromEntries(
    SOURCE_MEASURES.map((measure) => [
      measure,
      allocation(
        [...plans[measure].keys()],
        slots,
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
        const written = readings.map((reading) => metricFor(reading, measure, day));
        for (const [index, reading] of readings.entries()) {
          const metric = written[index]!;
          if (reading.source === "bodyloop")
            throw new Error("BodyLoop records no wearable measure");
          metrics[reading.source].push(metric);
        }
        planted.push({
          personId,
          day,
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
  const { seed, people, days, endDay } = output.options;
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
    text({ ...header, people, days, endDay, counts: output.counts }),
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
  return {
    seed,
    people,
    days,
    endDay,
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
  const output = generateTwoSource(args, judge);
  const files = renderTwoSource(output);
  for (const [path, text] of files) await writeText(join(args.output, path), text);
  io.stdout.write(
    [
      `Synthetic test data written to ${args.output} (${TWO_SOURCE_GENERATOR}, ${SOURCE_RULES_VERSION}, seed ${args.seed})`,
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
