/**
 * Agreement between a second rater and the automatic scorer, or between two
 * raters (#351). Pure; `agreement-run.ts` reads the files.
 *
 * Cohen's kappa (Cohen 1960, "A coefficient of agreement for nominal
 * scales", Educational and Psychological Measurement 20:37-46): observed
 * agreement p_o, chance agreement p_e from the two raters' margins, and
 * kappa = (p_o - p_e) / (1 - p_e). Unweighted: a 5 against a 4 is as much a
 * disagreement as a 5 against a 1.
 *
 * The 95 % interval is kappa ± 1.96·se with the large-sample standard error
 * of Fleiss, Cohen and Everitt (1969, "Large sample standard errors of kappa
 * and weighted kappa", Psychological Bulletin 72:323-327), cut to [-1, 1].
 * It is an approximation; with about 30 lines it is wide, and the doc says
 * so (`docs/evaluation/second-rater.md`).
 *
 * When every line falls in one category for both, p_e is 1 and kappa is not
 * defined: the result says so with `kappa: null` and keeps p_o. When only
 * one side used a single category, kappa is 0 and the standard error
 * formula gives 0, which is not a real certainty: the interval is null.
 *
 * Beside kappa (#304): Krippendorff's alpha (ordinal on the five levels,
 * nominal on pass or fail), and a percentile bootstrap 95 % interval over
 * lines for both, with a fixed seed so the interval is the same on every run.
 */
import { lineToken } from "../../features/lab/rater-lines";
import {
  isAcceptable,
  type RatedSet,
  ratedSetOfRubric,
} from "../../features/lab/rater-rubric";
import { type Score } from "./score/types";

const Z_95 = 1.959963984540054;

export type Kappa = Readonly<{
  n: number;
  observed: number;
  expected: number;
  /** Null when p_e is 1 (one category only). */
  kappa: number | null;
  se: number | null;
  low: number | null;
  high: number | null;
}>;

/** Kappa of paired labels (first rater, second rater); null when there are no pairs. */
export const cohenKappa = (
  pairs: readonly (readonly [string, string])[],
): Kappa | null => {
  const n = pairs.length;
  if (n === 0) return null;
  const categories = [...new Set(pairs.flat())];
  const cell = (a: string, b: string) =>
    pairs.filter((pair) => pair[0] === a && pair[1] === b).length / n;
  const row = (a: string) => pairs.filter((pair) => pair[0] === a).length / n;
  const column = (b: string) => pairs.filter((pair) => pair[1] === b).length / n;
  const observed = categories.reduce((sum, c) => sum + cell(c, c), 0);
  const expected = categories.reduce((sum, c) => sum + row(c) * column(c), 0);
  if (expected >= 1 - 1e-12) {
    return { n, observed, expected: 1, kappa: null, se: null, low: null, high: null };
  }
  const kappa = (observed - expected) / (1 - expected);
  const oneSided = [0, 1].some(
    (side) => new Set(pairs.map((pair) => pair[side as 0 | 1])).size === 1,
  );
  if (oneSided) {
    return { n, observed, expected, kappa, se: null, low: null, high: null };
  }
  const diagonal = categories.reduce(
    (sum, c) => sum + cell(c, c) * (1 - (row(c) + column(c)) * (1 - kappa)) ** 2,
    0,
  );
  const offDiagonal =
    (1 - kappa) ** 2 *
    categories.reduce(
      (sum, a) =>
        sum +
        categories.reduce(
          (inner, b) =>
            a === b ? inner : inner + cell(a, b) * (column(a) + row(b)) ** 2,
          0,
        ),
      0,
    );
  const variance =
    (diagonal + offDiagonal - (kappa - expected * (1 - kappa)) ** 2) /
    (n * (1 - expected) ** 2);
  const se = Math.sqrt(Math.max(0, variance));
  return {
    n,
    observed,
    expected,
    kappa,
    se,
    low: Math.max(-1, kappa - Z_95 * se),
    high: Math.min(1, kappa + Z_95 * se),
  };
};

/** Pairs from a square table of counts: row = first rater, column = second. */
export const pairsFromTable = (
  table: readonly (readonly number[])[],
): [string, string][] =>
  table.flatMap((row, i) =>
    row.flatMap((count, j) =>
      Array.from({ length: count }, (): [string, string] => [String(i), String(j)]),
    ),
  );

export type ScorerOutcome = "pass" | "fail";

/** One run as the comparison needs it, every map keyed by `item_id#repeat`. */
export type RunAgreementInput = Readonly<{
  runId: string;
  /** The automatic scorer's pass or fail; lines it scored n/a or human are left out. */
  scorer: ReadonlyMap<string, ScorerOutcome>;
  /** Pseudonym → that rater's level per line. */
  raters: ReadonlyMap<string, ReadonlyMap<string, number>>;
}>;

export type AlphaMetric = "nominal" | "ordinal" | "interval";

export type Alpha = Readonly<{
  /** Units with at least two values, the ones alpha uses. */
  units: number;
  /** Pairable values in those units (n in Krippendorff's notation). */
  values: number;
  observed: number;
  expected: number;
  /** Null when the expected disagreement is 0 (one value only). */
  alpha: number | null;
}>;

/**
 * Krippendorff's alpha (Krippendorff 2011, "Computing Krippendorff's
 * Alpha-Reliability", Annenberg School for Communication, Departmental
 * Papers 43), from the coincidence matrix: each unit's values, one per
 * coder, null where a coder gave none. Units with fewer than two values are
 * not pairable and are left out. Any number of coders; missing values allowed.
 *
 * alpha = 1 - D_o / D_e, with D_o = sum o_ck d(c,k) / n and
 * D_e = sum n_c n_k d(c,k) / (n (n - 1)). The difference function d is
 * nominal (0 or 1), interval ((c - k)^2), or ordinal: the squared sum of
 * the marginal counts n_g from c to k, less half of n_c and n_k.
 */
export const krippendorffAlpha = (
  units: readonly (readonly (number | null)[])[],
  metric: AlphaMetric,
): Alpha | null => {
  const pairable = units
    .map((unit) => unit.filter((value): value is number => value !== null))
    .filter((unit) => unit.length >= 2);
  if (pairable.length === 0) return null;
  const categories = [...new Set(pairable.flat())].sort((a, b) => a - b);
  const index = new Map(categories.map((value, i) => [value, i]));
  const size = categories.length;
  const coincidence = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (const unit of pairable) {
    const weight = 1 / (unit.length - 1);
    unit.forEach((first, i) =>
      unit.forEach((second, j) => {
        if (i === j) return;
        const row = coincidence[index.get(first) ?? 0];
        const column = index.get(second) ?? 0;
        if (row !== undefined) row[column] = (row[column] ?? 0) + weight;
      }),
    );
  }
  const marginal = coincidence.map((row) => row.reduce((sum, value) => sum + value, 0));
  const n = marginal.reduce((sum, value) => sum + value, 0);
  const at = (values: readonly number[], i: number): number => values[i] ?? 0;
  const difference = (c: number, k: number): number => {
    if (c === k) return 0;
    if (metric === "nominal") return 1;
    if (metric === "interval") return (at(categories, c) - at(categories, k)) ** 2;
    const [low, high] = c < k ? [c, k] : [k, c];
    let between = 0;
    for (let g = low; g <= high; g += 1) between += at(marginal, g);
    return (between - (at(marginal, c) + at(marginal, k)) / 2) ** 2;
  };
  let observedSum = 0;
  let expectedSum = 0;
  for (let c = 0; c < size; c += 1) {
    for (let k = 0; k < size; k += 1) {
      const d = difference(c, k);
      observedSum += at(coincidence[c] ?? [], k) * d;
      expectedSum += at(marginal, c) * at(marginal, k) * d;
    }
  }
  const observed = observedSum / n;
  const expected = n > 1 ? expectedSum / (n * (n - 1)) : 0;
  return {
    units: pairable.length,
    values: n,
    observed,
    expected,
    alpha: expected > 1e-12 ? 1 - observed / expected : null,
  };
};

/** Mulberry32: a small seeded generator, so a bootstrap is the same on every machine. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const BOOTSTRAP_RESAMPLES = 2000;
export const BOOTSTRAP_SEED = 304;

export type BootstrapInterval = Readonly<{
  low: number;
  high: number;
  resamples: number;
  /** Resamples where the statistic was defined; the interval rests on these. */
  used: number;
}>;

/** The q-quantile of sorted values, interpolated between neighbours (Hyndman and Fan type 7). */
const quantile = (sorted: readonly number[], q: number): number => {
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const low = sorted[below] ?? Number.NaN;
  const high = sorted[Math.min(below + 1, sorted.length - 1)] ?? low;
  return low + (high - low) * (position - below);
};

/**
 * Percentile bootstrap 95 % interval of a statistic over units (Efron and
 * Tibshirani 1993, ch. 13): resample the units with replacement, as many as
 * there are, recompute, and take the 2.5th and 97.5th percentiles. Resamples
 * where the statistic is not defined (every line in one category, say) are
 * dropped and counted. Null when there are no units or no resample is defined.
 */
export const bootstrapInterval = <T>(
  units: readonly T[],
  statistic: (sample: readonly T[]) => number | null,
  resamples: number = BOOTSTRAP_RESAMPLES,
  seed: number = BOOTSTRAP_SEED,
): BootstrapInterval | null => {
  if (units.length === 0) return null;
  const random = seededRandom(seed);
  const values: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    const sample = Array.from(
      { length: units.length },
      () => units[Math.floor(random() * units.length)] as T,
    );
    const value = statistic(sample);
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return {
    low: quantile(values, 0.025),
    high: quantile(values, 0.975),
    resamples,
    used: values.length,
  };
};

/** Alpha of paired labels: numbers for ordinal or interval, any text for nominal. */
const alphaOfPairs = (
  pairs: readonly (readonly [string, string])[],
  metric: AlphaMetric,
): Alpha | null => {
  const codes = new Map([...new Set(pairs.flat())].sort().map((label, i) => [label, i]));
  const value = (label: string): number =>
    metric === "nominal" ? (codes.get(label) ?? 0) : Number(label);
  return krippendorffAlpha(
    pairs.map((pair) => [value(pair[0]), value(pair[1])]),
    metric,
  );
};

export type AgreementRow = Readonly<{
  comparison: string;
  result: Kappa | null;
  /** Percentile bootstrap interval of kappa over lines. */
  kappaBootstrap: BootstrapInterval | null;
  metric: AlphaMetric;
  alpha: Alpha | null;
  /** Percentile bootstrap interval of alpha over lines. */
  alphaBootstrap: BootstrapInterval | null;
}>;

/** Every statistic of one comparison on its paired labels. */
export const agreementRow = (
  comparison: string,
  pairs: readonly (readonly [string, string])[],
  metric: AlphaMetric,
): AgreementRow => ({
  comparison,
  result: cohenKappa(pairs),
  kappaBootstrap: bootstrapInterval(pairs, (sample) => cohenKappa(sample)?.kappa ?? null),
  metric,
  alpha: alphaOfPairs(pairs, metric),
  alphaBootstrap: bootstrapInterval(
    pairs,
    (sample) => alphaOfPairs(sample, metric)?.alpha ?? null,
  ),
});

const acceptable = (level: number): string => (isAcceptable(level) ? "pass" : "fail");

/** Pairs over lines both sides have, pooled over runs. */
const pooled = <A, B>(
  runs: readonly RunAgreementInput[],
  left: (run: RunAgreementInput) => ReadonlyMap<string, A> | undefined,
  right: (run: RunAgreementInput) => ReadonlyMap<string, B> | undefined,
  label: (a: A, b: B) => readonly [string, string],
): [string, string][] =>
  runs.flatMap((run) => {
    const a = left(run);
    const b = right(run);
    if (a === undefined || b === undefined) return [];
    return [...a.entries()].flatMap(([key, value]) => {
      const other = b.get(key);
      return other === undefined ? [] : [[...label(value, other)] as [string, string]];
    });
  });

/**
 * Each rater against the scorer (a level of 4 or 5 counts as a pass), and
 * each pair of raters on the five levels and on acceptable or not.
 */
export const agreementRows = (runs: readonly RunAgreementInput[]): AgreementRow[] => {
  const raters = [...new Set(runs.flatMap((run) => [...run.raters.keys()]))].sort();
  const againstScorer = raters.map((rater) =>
    agreementRow(
      `${rater} vs scorer (correctness; 4–5 = pass)`,
      pooled(
        runs,
        (run) => run.raters.get(rater),
        (run) => run.scorer,
        (level: number, outcome: ScorerOutcome) => [acceptable(level), outcome],
      ),
      "nominal",
    ),
  );
  const pairsOfRaters = raters.flatMap((first, index) =>
    raters.slice(index + 1).flatMap((second) => {
      const both = (label: (a: number, b: number) => readonly [string, string]) =>
        pooled(
          runs,
          (run) => run.raters.get(first),
          (run) => run.raters.get(second),
          label,
        );
      return [
        agreementRow(
          `${first} vs ${second} (five levels)`,
          both((a, b) => [String(a), String(b)]),
          "ordinal",
        ),
        agreementRow(
          `${first} vs ${second} (4–5 vs 1–3)`,
          both((a, b) => [acceptable(a), acceptable(b)]),
          "nominal",
        ),
      ];
    }),
  );
  return [...againstScorer, ...pairsOfRaters];
};

export type AnswerIdRow = Readonly<{
  rater: string;
  id: string;
  runId: string;
  itemId: string;
  repeat: number;
}>;

/**
 * The answer ids one rater's page used for these lines of one run (#355),
 * recomputed from the rater's salt, so an id a rater quotes can be traced to
 * its run. Sorted by id.
 */
export const answerIdRows = (
  rater: string,
  salt: string,
  runId: string,
  lines: readonly Readonly<{ item_id: string; repeat: number }>[],
): AnswerIdRow[] =>
  lines
    .map((line) => ({
      rater,
      id: lineToken(salt, runId, line.item_id, line.repeat),
      runId,
      itemId: line.item_id,
      repeat: line.repeat,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

/**
 * The runs grouped by question set (#304), sets in the order they first
 * appear and runs in the order given, so agreement is never pooled across
 * sets whose rubrics differ.
 */
export const groupBySet = <T extends Readonly<{ set: string }>>(
  runs: readonly T[],
): [string, T[]][] =>
  [...new Set(runs.map((run) => run.set))].map((set) => [
    set,
    runs.filter((run) => run.set === set),
  ]);

/**
 * The rated set a ratings file belongs in a run of `set`: the set itself when
 * the file's rubric is that set's rubric, otherwise null (the file is left
 * out: its levels mean something else, or the set is not rated at all).
 */
export const ratedSetForFile = (set: string, rubric: string): RatedSet | null => {
  const rated = ratedSetOfRubric(rubric);
  return rated !== null && rated === set ? rated : null;
};

/** The correctness outcome of a line, or `unscored` for an answered line the scorer did not score. */
export type LineOutcome = Score | "unscored";

/** A line of the v1h review sample (#413), as the agreement script lists it. */
export type SampledLine = Readonly<{
  runId: string;
  itemId: string;
  repeat: number;
  scenario: string;
  outcome: LineOutcome;
}>;

/**
 * The run's comparison limited to the lines in `keys` (`item_id#repeat`):
 * the scorer's outcomes and every rater's levels outside them are dropped.
 */
export const restrictToLines = (
  run: RunAgreementInput,
  keys: ReadonlySet<string>,
): RunAgreementInput => {
  const keep = <V>(map: ReadonlyMap<string, V>): ReadonlyMap<string, V> =>
    new Map([...map].filter(([key]) => keys.has(key)));
  return {
    runId: run.runId,
    scorer: keep(run.scorer),
    raters: new Map([...run.raters].map(([rater, levels]) => [rater, keep(levels)])),
  };
};

export type StratumRow = Readonly<{
  scenario: string;
  counts: Readonly<Record<LineOutcome, number>>;
  total: number;
}>;

/** The outcome columns of `strataRows`, in the order the script prints them. */
export const STRATUM_OUTCOMES: readonly LineOutcome[] = [
  "pass",
  "fail",
  "human",
  "na",
  "unscored",
];

/** Sampled lines per scenario and correctness outcome, scenarios in sorted order. */
export const strataRows = (lines: readonly SampledLine[]): StratumRow[] =>
  [...new Set(lines.map((line) => line.scenario))].sort().map((scenario) => {
    const of = lines.filter((line) => line.scenario === scenario);
    const count = (outcome: LineOutcome): number =>
      of.filter((line) => line.outcome === outcome).length;
    return {
      scenario,
      counts: {
        pass: count("pass"),
        fail: count("fail"),
        human: count("human"),
        na: count("na"),
        unscored: count("unscored"),
      },
      total: of.length,
    };
  });
