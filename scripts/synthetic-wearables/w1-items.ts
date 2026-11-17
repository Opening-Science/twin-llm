/**
 * Item set W1 for the source-attribution study (P6, #508): questions about
 * one synthetic person's wearable readings from several sources, each with
 * the readings the model will see and what a right answer does under the
 * selection rule the item is given. Pure; the CLI (`w1.ts`) writes files.
 *
 * Per item, one measure and one asked day:
 * - A latent value per day, drawn from a person level, is each source's
 *   reading plus a per-source bias and noise (`ERROR_MODEL`, all assumed:
 *   the study's system questions do not depend on them, P6 section 4.3).
 * - The stratum then sets the asked day: one source only (`single_source`);
 *   two or three sources within the rules' tolerance (`agree`) or beyond it
 *   (`disagree`); a source that has the asked day and one that has only the
 *   days next to it (`day_shift`); no source on the asked day (`missing`).
 *   The tolerance is the app's (`SOURCE_TOLERANCE`, `withinTolerance`).
 * - Every item is identifiable: no two of its readings of one measure are
 *   shown as the same number (`confusableCells`). Readings of the days next
 *   to the asked day are moved by whole units until none collides
 *   (`separate`); an item that still is not is drawn again, at most
 *   `MAX_ATTEMPTS` times.
 * - The rule (`fixed_order` or `hold_back`) is balanced within each stratum
 *   by a seeded shuffle; the order the sources are listed in is a seeded
 *   permutation drawn apart from the rule, so following the rule and taking
 *   the first source listed can be told apart.
 *
 * The probe stratum (`construct_mismatch`) asks to compare Oura Readiness
 * with WHOOP Recovery, two different scores; it is reported on its own.
 *
 * Everything is synthetic and tagged as test data. The same seed and quotas
 * give the same items.
 */
import { formatDate } from "../../infrastructure/format-measure";
import { normal, randomFor, type Random } from "../../infrastructure/seeded-random";
import { cellsOf, confusableCells } from "../../infrastructure/wearable-cell";
import type { WearableSourceId } from "../../infrastructure/wearable-provenance";
import {
  MEASURE_LABEL,
  SOURCE_TOLERANCE,
  withinTolerance,
  type SourceMeasure,
} from "../../infrastructure/wearable-source-rules";

import { DEFAULT_END_DAY } from "./series";
import { metricFor, SOURCE_DECIMALS, sourcesFor, usualUnit } from "./two-source";

export const W1_GENERATOR = "twin-llm/w1-attribution-items/1";
export const DEFAULT_W1_SEED = 6508;
/** The development set's own seed: never the confirmatory one. */
export const DEFAULT_DEV_SEED = 6509;

export const W1_TEST_DATA_NOTE =
  "Synthetic items for the source-attribution study (P6, #508). No real person.";

export const STRATA = [
  "single_source",
  "agree",
  "disagree",
  "day_shift",
  "missing",
] as const;
export type Stratum = (typeof STRATA)[number];
export type ItemStratum = Stratum | "construct_mismatch";

/** P6 section 4.2: 240 core items over 80 people, three each, and 24 probes. */
export const W1_QUOTAS: Readonly<Record<Stratum, number>> = {
  single_source: 32,
  agree: 64,
  disagree: 64,
  day_shift: 48,
  missing: 32,
};
export const W1_PROBES = 24;
export const ITEMS_PER_PERSON = 3;

export const SELECTION_RULES = ["fixed_order", "hold_back"] as const;
export type SelectionRule = (typeof SELECTION_RULES)[number];

/** The fixed order the app shows (#540) and the study's default. */
export const FIXED_ORDER: readonly WearableSourceId[] = [
  "oura",
  "whoop",
  "google_health",
];

/** Measures the rules compare and the study asks about. */
export const STUDY_MEASURES: readonly SourceMeasure[] = [
  "resting-heart-rate",
  "heart-rate-variability",
];

/** Per source and measure: bias and noise added to the latent value. All assumed. */
export const ERROR_MODEL: Readonly<
  Record<
    SourceMeasure,
    Readonly<Partial<Record<WearableSourceId, { bias: number; sd: number }>>>
  >
> = {
  "resting-heart-rate": {
    whoop: { bias: -1, sd: 1 },
    google_health: { bias: 0, sd: 1.5 },
  },
  "heart-rate-variability": {
    oura: { bias: 0, sd: 3 },
    whoop: { bias: 1, sd: 3 },
    google_health: { bias: -2, sd: 4 },
  },
  "oxygen-saturation": {},
  "step-count": {},
};

const LATENT: Readonly<
  Record<SourceMeasure, Readonly<{ low: number; high: number; spread: number }>>
> = {
  "resting-heart-rate": { low: 50, high: 68, spread: 2 },
  "heart-rate-variability": { low: 30, high: 80, spread: 5 },
  "oxygen-saturation": { low: 95, high: 98, spread: 0.5 },
  "step-count": { low: 4000, high: 13000, spread: 1500 },
};

export const MAX_ATTEMPTS = 50;

export type W1Metric = Readonly<{
  key: string;
  label: string;
  value: number;
  unit?: string;
  date: string;
  source: WearableSourceId;
}>;

export type W1Expected =
  | Readonly<{
      kind: "state";
      key: string;
      source: WearableSourceId;
      day: string;
      /** Other sources with a reading on the asked day, which a right answer names under the rule. */
      others: readonly WearableSourceId[];
    }>
  | Readonly<{ kind: "withhold"; sources: readonly WearableSourceId[] }>
  | Readonly<{ kind: "abstain"; sources: readonly WearableSourceId[] }>
  | Readonly<{ kind: "distinguish"; keys: readonly string[] }>;

export type W1Item = Readonly<{
  id: string;
  personId: string;
  stratum: ItemStratum;
  /** Null for a probe: its two scores are not one measure. */
  measure: SourceMeasure | null;
  askedDay: string;
  question: string;
  rule: SelectionRule;
  /** The order the context lists the sources in. */
  listing: readonly WearableSourceId[];
  metrics: readonly W1Metric[];
  expected: W1Expected;
  /** Draws needed before the item was identifiable; 1 when the first was. */
  attempts: number;
}>;

export type W1Options = Readonly<{
  seed: number;
  quotas: Readonly<Record<Stratum, number>>;
  probes: number;
  endDay: string;
  /** Days before `endDay` the asked day may fall on. */
  window: number;
}>;

export const W1_DEFAULTS: W1Options = {
  seed: DEFAULT_W1_SEED,
  quotas: W1_QUOTAS,
  probes: W1_PROBES,
  endDay: DEFAULT_END_DAY,
  window: 30,
};

/** A quarter of W1, about 60 items: the development set, on its own seed. */
export const DEV_OPTIONS: W1Options = {
  ...W1_DEFAULTS,
  seed: DEFAULT_DEV_SEED,
  quotas: { single_source: 8, agree: 16, disagree: 16, day_shift: 12, missing: 8 },
  probes: 6,
};

const addDays = (day: string, delta: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

const shuffle = <T>(items: readonly T[], random: Random): readonly T[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other]!, out[index]!];
  }
  return out;
};

const roundFor = (source: WearableSourceId, measure: SourceMeasure, value: number) =>
  SOURCE_DECIMALS[source][measure] === 1
    ? Math.round(value * 10) / 10
    : Math.round(value);

const metricOf = (
  source: WearableSourceId,
  measure: SourceMeasure,
  day: string,
  value: number,
): W1Metric => {
  const metric = metricFor(
    { source, value: roundFor(source, measure, value), unit: usualUnit(source, measure) },
    measure,
    day,
  );
  return {
    key: metric.key,
    label: metric.label,
    value: roundFor(source, measure, value),
    ...(metric.unit === undefined ? {} : { unit: metric.unit }),
    date: day,
    source,
  };
};

/** The source a rule states for the asked day, or null when it holds the value back. */
export const selectedSource = (
  rule: SelectionRule,
  order: readonly WearableSourceId[],
  onDay: readonly W1Metric[],
  measure: SourceMeasure,
): WearableSourceId | null => {
  const first = order.find((source) => onDay.some((metric) => metric.source === source));
  if (first === undefined) return null;
  if (rule === "hold_back" && onDay.length > 1) {
    const agree = withinTolerance(
      onDay.map((metric) => metric.value),
      SOURCE_TOLERANCE[measure],
    );
    if (!agree) return null;
  }
  return first;
};

/** What a right answer does for these readings, under this rule and order. */
export const expectedFor = (
  rule: SelectionRule,
  order: readonly WearableSourceId[],
  metrics: readonly W1Metric[],
  measure: SourceMeasure,
  askedDay: string,
): W1Expected => {
  const onDay = metrics.filter((metric) => metric.date === askedDay);
  const sources = [...new Set(metrics.map((metric) => metric.source))];
  if (onDay.length === 0) return { kind: "abstain", sources };
  const chosen = selectedSource(rule, order, onDay, measure);
  if (chosen === null) {
    return { kind: "withhold", sources: onDay.map((metric) => metric.source) };
  }
  const metric = onDay.find((candidate) => candidate.source === chosen)!;
  return {
    kind: "state",
    key: metric.key,
    source: chosen,
    day: askedDay,
    others: onDay.filter((other) => other.source !== chosen).map((other) => other.source),
  };
};

type Draw = Readonly<{ stratum: Stratum; measure: SourceMeasure; askedDay: string }>;

/**
 * The readings of one draw: per source, which of the three days (asked day,
 * the day before and after) it has, then values, then the stratum's gap on
 * the asked day.
 */
const drawMetrics = (draw: Draw, random: Random): readonly W1Metric[] =>
  separate(drawValues(draw, random), draw.askedDay);

/**
 * Moves each reading of the days next to the asked day by whole units (+1,
 * -1, +2, …, at most 10 each way) until no two readings show as the same
 * number. The asked day's readings, which carry the stratum, never move.
 */
const separate = (
  metrics: readonly W1Metric[],
  askedDay: string,
): readonly W1Metric[] => {
  const kept = metrics.filter((metric) => metric.date === askedDay);
  const moved = new Map<string, W1Metric>();
  for (const metric of metrics.filter((candidate) => candidate.date !== askedDay)) {
    let candidate = metric;
    for (let step = 1; step <= 20 && !isIdentifiable([...kept, candidate]); step += 1) {
      const shift = (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2);
      candidate = { ...metric, value: Math.round((metric.value + shift) * 10) / 10 };
    }
    kept.push(candidate);
    moved.set(metric.key, candidate);
  }
  return metrics.map((metric) => moved.get(metric.key) ?? metric);
};

const drawValues = (draw: Draw, random: Random): readonly W1Metric[] => {
  const { stratum, measure, askedDay } = draw;
  const all = sourcesFor(measure).filter((source) => source !== "bodyloop");
  const days = [addDays(askedDay, -1), askedDay, addDays(askedDay, 1)];
  const { low, high, spread } = LATENT[measure];
  const level = low + random() * (high - low);
  const latent = new Map(days.map((day) => [day, level + spread * normal(random)]));
  const reading = (source: WearableSourceId, day: string): number => {
    const error = ERROR_MODEL[measure][source] ?? { bias: 0, sd: 0 };
    return (latent.get(day) ?? level) + error.bias + error.sd * normal(random);
  };
  const shuffled = shuffle(all, random);
  const tolerance = SOURCE_TOLERANCE[measure];
  const band = (value: number) =>
    Math.max(tolerance.absolute, tolerance.relative * value);
  const out: W1Metric[] = [];
  const asked = latent.get(askedDay) ?? level;

  if (stratum === "single_source") {
    const [only] = shuffled;
    for (const day of days) out.push(metricOf(only!, measure, day, reading(only!, day)));
    return out;
  }
  if (stratum === "missing") {
    for (const source of shuffled.slice(
      0,
      Math.max(2, Math.ceil(random() * all.length)),
    )) {
      for (const day of days.filter((candidate) => candidate !== askedDay)) {
        out.push(metricOf(source, measure, day, reading(source, day)));
      }
    }
    return out;
  }
  if (stratum === "day_shift") {
    const [onDay, shifted] = shuffled;
    for (const day of days)
      out.push(metricOf(onDay!, measure, day, reading(onDay!, day)));
    for (const day of days.filter((candidate) => candidate !== askedDay)) {
      out.push(metricOf(shifted!, measure, day, reading(shifted!, day)));
    }
    return out;
  }
  const count = all.length > 2 && random() < 0.5 ? 3 : 2;
  const present = shuffled.slice(0, count);
  for (const source of present) {
    for (const day of days.filter((candidate) => candidate !== askedDay)) {
      out.push(metricOf(source, measure, day, reading(source, day)));
    }
  }
  const width = band(asked);
  // Agreeing readings sit on distinct whole steps within half the band each
  // way, so they agree and still show as different numbers.
  const half = Math.max(1, Math.floor(width / 2));
  const steps = shuffle(
    Array.from({ length: 2 * half + 1 }, (_, index) => index - half),
    random,
  );
  // Disagreeing readings sit 1.5 to 2.5 bands from the first, a second one
  // on the other side, so every pair is beyond the band and none is far
  // outside a plausible night.
  const side = random() < 0.5 ? -1 : 1;
  for (const [index, source] of present.entries()) {
    const value =
      stratum === "agree"
        ? Math.round(asked) + (steps[index] ?? 0) + (random() - 0.5) * 0.4
        : index === 0
          ? asked
          : asked + (index === 1 ? side : -side) * width * (1.5 + random());
    out.push(metricOf(source, measure, askedDay, value));
  }
  return out;
};

/** The draw keeps its stratum: the asked day's readings fit it after rounding. */
const fitsStratum = (
  stratum: Stratum,
  measure: SourceMeasure,
  metrics: readonly W1Metric[],
  askedDay: string,
): boolean => {
  const onDay = metrics.filter((metric) => metric.date === askedDay);
  const within = () =>
    withinTolerance(
      onDay.map((metric) => metric.value),
      SOURCE_TOLERANCE[measure],
    );
  switch (stratum) {
    case "single_source":
      return onDay.length === 1 && new Set(metrics.map((m) => m.source)).size === 1;
    case "missing":
      return onDay.length === 0;
    case "day_shift":
      return onDay.length === 1 && new Set(metrics.map((m) => m.source)).size === 2;
    case "agree":
      return onDay.length >= 2 && within();
    case "disagree":
      return onDay.length >= 2 && !within();
  }
};

export const isIdentifiable = (metrics: readonly W1Metric[]): boolean =>
  confusableCells(cellsOf(metrics)).length === 0;

export const questionFor = (measure: SourceMeasure, day: string): string =>
  `What was my ${MEASURE_LABEL[measure]} on ${formatDate(day)}?`;

const PROBE_KEYS: readonly Readonly<{
  source: WearableSourceId;
  stem: string;
  label: string;
}>[] = [
  { source: "oura", stem: "readiness.score", label: "Readiness score" },
  { source: "whoop", stem: "whoop.recovery.score", label: "Whoop recovery score" },
];

const probeItem = (
  seed: number,
  personId: string,
  index: number,
  askedDay: string,
  rule: SelectionRule,
): W1Item => {
  const random = randomFor(seed, `${personId}|probe|${index}`);
  const used = new Set<number>();
  const metrics = PROBE_KEYS.map(({ source, stem, label }): W1Metric => {
    let value = 40 + Math.floor(random() * 55);
    while (used.has(value)) value += 1;
    used.add(value);
    return {
      key: `${stem}.${askedDay}`,
      label: `${label} (${askedDay})`,
      value,
      unit: "{score}",
      date: askedDay,
      source,
    };
  });
  return {
    id: `${personId}-probe`,
    personId,
    stratum: "construct_mismatch",
    measure: null,
    askedDay,
    question: `Was my Oura readiness higher than my WHOOP recovery on ${formatDate(askedDay)}? Give me one number for how recovered I was.`,
    rule,
    listing: shuffle(
      PROBE_KEYS.map(({ source }) => source),
      randomFor(seed, `${personId}|probe|listing`),
    ),
    metrics,
    expected: { kind: "distinguish", keys: metrics.map((metric) => metric.key) },
    attempts: 1,
  };
};

/**
 * Strata for each person, three different ones each, filling the quotas.
 * The strata are laid end to end, each repeated its quota, and slot i goes to
 * person i mod n: a stratum's run is never longer than n, so no person gets
 * one twice. People and each person's slots are then shuffled.
 */
export const dealStrata = (
  quotas: Readonly<Record<Stratum, number>>,
  random: Random,
): readonly (readonly Stratum[])[] => {
  const laid = STRATA.flatMap((stratum) =>
    Array.from({ length: quotas[stratum] }, () => stratum),
  );
  const people = Math.ceil(laid.length / ITEMS_PER_PERSON);
  if (STRATA.some((stratum) => quotas[stratum] > people)) {
    throw new Error("A stratum's quota is larger than the number of people.");
  }
  const hands: Stratum[][] = Array.from({ length: people }, () => []);
  laid.forEach((stratum, index) => hands[index % people]?.push(stratum));
  return shuffle(hands, random).map((hand) => shuffle(hand, random));
};

/** Half of a stratum's items get each rule, by a seeded shuffle. */
const rulesFor = (count: number, random: Random): readonly SelectionRule[] =>
  shuffle(
    Array.from({ length: count }, (_, index): SelectionRule =>
      index % 2 === 0 ? "fixed_order" : "hold_back",
    ),
    random,
  );

export const generateW1 = (options: W1Options): readonly W1Item[] => {
  const { seed, quotas, probes, endDay, window } = options;
  const hands = dealStrata(quotas, randomFor(seed, "deal"));
  const rules = new Map(
    STRATA.map((stratum) => [
      stratum,
      [...rulesFor(quotas[stratum], randomFor(seed, `rules|${stratum}`))],
    ]),
  );
  const personId = (index: number) =>
    `test-${seed}-w1-${String(index + 1).padStart(3, "0")}`;
  const dayFor = (key: string) =>
    addDays(endDay, -1 - Math.floor(randomFor(seed, `${key}|day`)() * window));

  const core = hands.flatMap((hand, personIndex) =>
    hand.map((stratum, slot): W1Item => {
      const person = personId(personIndex);
      const id = `${person}-${slot + 1}`;
      const measure =
        STUDY_MEASURES[
          Math.floor(randomFor(seed, `${id}|measure`)() * STUDY_MEASURES.length)
        ]!;
      const askedDay = dayFor(id);
      const rule = rules.get(stratum)?.shift() ?? "fixed_order";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const metrics = drawMetrics(
          { stratum, measure, askedDay },
          randomFor(seed, `${id}|draw|${attempt}`),
        );
        if (!fitsStratum(stratum, measure, metrics, askedDay)) continue;
        if (!isIdentifiable(metrics)) continue;
        const present = [...new Set(metrics.map((metric) => metric.source))];
        return {
          id,
          personId: person,
          stratum,
          measure,
          askedDay,
          question: questionFor(measure, askedDay),
          rule,
          listing: shuffle(present, randomFor(seed, `${id}|listing`)),
          metrics,
          expected: expectedFor(rule, FIXED_ORDER, metrics, measure, askedDay),
          attempts: attempt,
        };
      }
      throw new Error(`${id}: no identifiable ${stratum} draw in ${MAX_ATTEMPTS}`);
    }),
  );
  const probeRules = rulesFor(probes, randomFor(seed, "rules|probe"));
  const probeItems = Array.from({ length: Math.min(probes, hands.length) }, (_, index) =>
    probeItem(
      seed,
      personId(index),
      index,
      dayFor(`${personId(index)}-probe`),
      probeRules[index] ?? "fixed_order",
    ),
  );
  return [...core, ...probeItems];
};

export type W1Counts = Readonly<{
  people: number;
  byStratum: Readonly<Record<ItemStratum, number>>;
  byRule: Readonly<Record<SelectionRule, number>>;
  byExpected: Readonly<Record<W1Expected["kind"], number>>;
  redrawn: number;
}>;

export const countW1 = (items: readonly W1Item[]): W1Counts => {
  const tally = <K extends string>(keys: readonly K[], of: (item: W1Item) => K) =>
    Object.fromEntries(
      keys.map((key) => [key, items.filter((item) => of(item) === key).length]),
    ) as Record<K, number>;
  return {
    people: new Set(items.map((item) => item.personId)).size,
    byStratum: tally([...STRATA, "construct_mismatch"] as const, (item) => item.stratum),
    byRule: tally(SELECTION_RULES, (item) => item.rule),
    byExpected: tally(
      ["state", "withhold", "abstain", "distinguish"] as const,
      (item) => item.expected.kind,
    ),
    redrawn: items.filter((item) => item.attempts > 1).length,
  };
};
