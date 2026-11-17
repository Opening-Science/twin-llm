/**
 * The registered contrasts of the source-attribution study (P6 section 5 of
 * the pre-registration, #508), as far as they need no model fitting. Pure
 * and seeded: the same records and seed give the same numbers.
 *
 * Part A, from study records:
 * - H1: risk difference in attribution correct, C1 − C0, over items whose
 *   right answer states a number; the registered fallback test when the
 *   mixed model does not converge.
 * - H2a: risk difference in disagreement handled, C2 − C1, disagree stratum.
 * - H2b: risk difference in over-hedging, C2 − C1, agree stratum;
 *   non-inferior when the upper bound of the two-sided 95% interval is below
 *   10 points.
 * - H3: share of rule-swap failures among citation-correct C1 answers; the
 *   one-sided 95% lower bound against 5%.
 * Every interval is a percentile interval from a cluster bootstrap over
 * synthetic persons (2,000 resamples by default). A bootstrap p-value (twice
 * the smaller tail at zero, or the share at or below the threshold for H3)
 * feeds Holm over {H1, H2a, H3}.
 *
 * Part B, from per-participant counts: d′ and criterion c with the
 * log-linear correction (add 0.5 to hit and false-alarm counts, 1 to trial
 * counts), and Welch's t-test for the between-arm contrasts.
 *
 * The mixed-effects models are not here; they run on the same records.
 */
import { randomFor } from "../../../infrastructure/seeded-random";
import type { Condition } from "./contexts";
import type { StudyRecord } from "./run";
import type { StudyScore } from "./score";

export const DEFAULT_RESAMPLES = 2000;
export const DEFAULT_ANALYSIS_SEED = 6508;

export type Estimate = Readonly<{
  estimate: number | null;
  low: number | null;
  high: number | null;
  /** Bootstrap p-value; null when there is nothing to test. */
  p: number | null;
  /** Persons in the analysis. */
  clusters: number;
}>;

type Outcome = keyof Pick<
  StudyScore,
  "attributionCorrect" | "disagreementHandled" | "overHedged"
>;

const quantile = (sorted: readonly number[], q: number): number | null => {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  const low = sorted[below]!;
  return low + (sorted[above]! - low) * (position - below);
};

/**
 * Resamples clusters with replacement and recomputes `statistic` on the
 * pooled members; resamples where it is null are dropped.
 */
export const clusterBootstrap = <T>(
  clusters: readonly (readonly T[])[],
  statistic: (sample: readonly T[]) => number | null,
  resamples: number,
  seed: number,
): readonly number[] => {
  const random = randomFor(seed, "cluster-bootstrap");
  const out: number[] = [];
  for (let draw = 0; draw < resamples; draw += 1) {
    const sample: T[] = [];
    for (let index = 0; index < clusters.length; index += 1) {
      sample.push(...clusters[Math.floor(random() * clusters.length)]!);
    }
    const value = statistic(sample);
    if (value !== null) out.push(value);
  }
  return out.sort((a, b) => a - b);
};

const byPerson = (
  records: readonly StudyRecord[],
): readonly (readonly StudyRecord[])[] => {
  const groups = new Map<string, StudyRecord[]>();
  for (const record of records) {
    groups.set(record.personId, [...(groups.get(record.personId) ?? []), record]);
  }
  return [...groups.values()];
};

const rate = (records: readonly StudyRecord[], outcome: Outcome): number | null =>
  records.length === 0
    ? null
    : records.filter((record) => record.score?.[outcome] === true).length /
      records.length;

/** Rate under `b` minus rate under `a`; null when either is empty. */
const difference =
  (outcome: Outcome, a: Condition, b: Condition) =>
  (records: readonly StudyRecord[]): number | null => {
    const first = rate(
      records.filter((record) => record.condition === a),
      outcome,
    );
    const second = rate(
      records.filter((record) => record.condition === b),
      outcome,
    );
    return first === null || second === null ? null : second - first;
  };

const twoSidedP = (draws: readonly number[]): number | null => {
  if (draws.length === 0) return null;
  const below = draws.filter((value) => value <= 0).length / draws.length;
  const above = draws.filter((value) => value >= 0).length / draws.length;
  return Math.min(1, 2 * Math.min(below, above));
};

export type AnalysisOptions = Readonly<{ resamples: number; seed: number }>;

export const ANALYSIS_DEFAULTS: AnalysisOptions = {
  resamples: DEFAULT_RESAMPLES,
  seed: DEFAULT_ANALYSIS_SEED,
};

/** A risk difference between two conditions with its 95% interval and p. */
export const riskDifference = (
  records: readonly StudyRecord[],
  outcome: Outcome,
  a: Condition,
  b: Condition,
  options: AnalysisOptions = ANALYSIS_DEFAULTS,
): Estimate => {
  const statistic = difference(outcome, a, b);
  const clusters = byPerson(records);
  const draws = clusterBootstrap(clusters, statistic, options.resamples, options.seed);
  return {
    estimate: statistic(records),
    low: quantile(draws, 0.025),
    high: quantile(draws, 0.975),
    p: twoSidedP(draws),
    clusters: clusters.length,
  };
};

const pairKey = (record: StudyRecord): string =>
  `${record.model}|${record.baseItemId}|${record.repeat}`;

/** Rule-swap answers paired with a citation-correct C1 base answer, with whether each failed. */
export const ruleSwapPairs = (
  records: readonly StudyRecord[],
): readonly Readonly<{ record: StudyRecord; failed: boolean }>[] => {
  const base = new Set(
    records
      .filter(
        (record) =>
          record.variant === "base" &&
          record.condition === "C1" &&
          record.score?.attributionCorrect === true,
      )
      .map(pairKey),
  );
  return records
    .filter((record) => record.variant === "rule_swap" && base.has(pairKey(record)))
    .map((record) => ({
      record,
      failed:
        record.score === null ||
        record.score.stated !==
          (record.expected.kind === "state" ? record.expected.source : null),
    }));
};

/** H3: the failure share, its one-sided 95% lower bound and the share of draws at or below 5%. */
export const ruleSwapFailure = (
  records: readonly StudyRecord[],
  options: AnalysisOptions = ANALYSIS_DEFAULTS,
  threshold = 0.05,
): Estimate => {
  const pairs = ruleSwapPairs(records);
  const share = (sample: readonly (typeof pairs)[number][]) =>
    sample.length === 0
      ? null
      : sample.filter((pair) => pair.failed).length / sample.length;
  const groups = new Map<string, (typeof pairs)[number][]>();
  for (const pair of pairs) {
    groups.set(pair.record.personId, [...(groups.get(pair.record.personId) ?? []), pair]);
  }
  const draws = clusterBootstrap(
    [...groups.values()],
    share,
    options.resamples,
    options.seed,
  );
  return {
    estimate: share(pairs),
    low: quantile(draws, 0.05),
    high: null,
    p:
      draws.length === 0
        ? null
        : draws.filter((value) => value <= threshold).length / draws.length,
    clusters: groups.size,
  };
};

export type HolmResult = Readonly<{ adjusted: number; reject: boolean }>;

/** Holm's step-down adjustment at family-wise `alpha`; nulls are left out. */
export const holm = (
  pValues: Readonly<Record<string, number | null>>,
  alpha = 0.05,
): Readonly<Record<string, HolmResult>> => {
  const entries = Object.entries(pValues)
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .sort((a, b) => a[1] - b[1]);
  const out: Record<string, HolmResult> = {};
  let running = 0;
  let stopped = false;
  entries.forEach(([name, p], index) => {
    const factor = entries.length - index;
    running = Math.max(running, Math.min(1, p * factor));
    stopped = stopped || p > alpha / factor;
    out[name] = { adjusted: running, reject: !stopped };
  });
  return out;
};

export type PartA = Readonly<{
  h1: Estimate;
  h2a: Estimate;
  h2b: Estimate & Readonly<{ nonInferior: boolean | null }>;
  h3: Estimate;
  holm: Readonly<Record<string, HolmResult>>;
}>;

/** Every Part A contrast from base records (and rule-swap variants for H3). */
export const partA = (
  records: readonly StudyRecord[],
  options: AnalysisOptions = ANALYSIS_DEFAULTS,
  margin = 0.1,
): PartA => {
  const base = records.filter((record) => record.variant === "base");
  const h1 = riskDifference(
    base.filter((record) => record.expected.kind === "state"),
    "attributionCorrect",
    "C0",
    "C1",
    options,
  );
  const h2a = riskDifference(
    base.filter((record) => record.stratum === "disagree"),
    "disagreementHandled",
    "C1",
    "C2",
    options,
  );
  const hedging = riskDifference(
    base.filter((record) => record.stratum === "agree"),
    "overHedged",
    "C1",
    "C2",
    options,
  );
  const h3 = ruleSwapFailure(records, options);
  return {
    h1,
    h2a,
    h2b: {
      ...hedging,
      nonInferior: hedging.high === null ? null : hedging.high < margin,
    },
    h3,
    holm: holm({ H1: h1.p, H2a: h2a.p, H3: h3.p }),
  };
};

const points = (value: number | null): string =>
  value === null ? "–" : `${(value * 100).toFixed(1)}`;

const pText = (value: number | null): string =>
  value === null ? "–" : value < 0.001 ? "< 0.001" : value.toFixed(3);

/** The Part A contrasts as a Markdown section for the study report. */
export const contrastsMarkdown = (result: PartA): readonly string[] => {
  // Supported only when Holm rejects and the effect is in the predicted
  // direction (pre-registration, inference criteria).
  const decision = (name: string, estimate: number | null) => {
    const holmed = result.holm[name];
    const supported = holmed?.reject === true && estimate !== null && estimate > 0;
    return holmed === undefined
      ? "–"
      : `${pText(holmed.adjusted)} (${supported ? "supported" : "not supported"})`;
  };
  return [
    "## Registered contrasts (bootstrap)",
    "",
    "Risk differences in points with 95% percentile intervals from a cluster bootstrap over persons; all models pooled. This is the registered fallback when the mixed model does not converge; on fakes or a development set it says nothing about the hypotheses.",
    "",
    "| Hypothesis | Estimate | Interval | Bootstrap p | Holm-adjusted |",
    "| --- | --- | --- | --- | --- |",
    `| H1: attribution correct, C1 − C0 | ${points(result.h1.estimate)} | [${points(result.h1.low)}, ${points(result.h1.high)}] | ${pText(result.h1.p)} | ${decision("H1", result.h1.estimate)} |`,
    `| H2a: disagreement handled, C2 − C1 | ${points(result.h2a.estimate)} | [${points(result.h2a.low)}, ${points(result.h2a.high)}] | ${pText(result.h2a.p)} | ${decision("H2a", result.h2a.estimate)} |`,
    `| H2b: over-hedging, C2 − C1 (non-inferior below 10) | ${points(result.h2b.estimate)} | [${points(result.h2b.low)}, ${points(result.h2b.high)}] | – | ${result.h2b.nonInferior === null ? "–" : result.h2b.nonInferior ? "non-inferior" : "not shown"} |`,
    `| H3: rule-swap failure share (lower bound against 5) | ${points(result.h3.estimate)} | ≥ ${points(result.h3.low)} | ${pText(result.h3.p)} | ${decision("H3", result.h3.estimate)} |`,
  ];
};

/** Inverse of the standard normal CDF (Acklam's rational approximation). */
export const probit = (p: number): number => {
  if (p <= 0 || p >= 1) throw new RangeError("probit needs 0 < p < 1");
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416,
  ];
  const low = 0.02425;
  const tail = (q: number) =>
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < low) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - low) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
};

export type DetectionCounts = Readonly<{
  /** Mis-attributed answers flagged. */
  hits: number;
  /** Mis-attributed answers shown. */
  signal: number;
  /** Correct answers flagged. */
  falseAlarms: number;
  /** Correct answers shown. */
  noise: number;
}>;

/** d′ and c with the log-linear correction (pre-registration section 4). */
export const detection = (
  counts: DetectionCounts,
): Readonly<{ dPrime: number; criterion: number }> => {
  const hitRate = (counts.hits + 0.5) / (counts.signal + 1);
  const falseAlarmRate = (counts.falseAlarms + 0.5) / (counts.noise + 1);
  const zH = probit(hitRate);
  const zF = probit(falseAlarmRate);
  return { dPrime: zH - zF, criterion: -(zH + zF) / 2 };
};

/** ln Γ(x), Lanczos. */
const logGamma = (x: number): number => {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let series = 1.000000000190015;
  for (const coefficient of g) series += coefficient / ++y;
  return -tmp + Math.log((2.5066282746310005 * series) / x);
};

/** The regularised incomplete beta I_x(a, b), by Lentz's continued fraction. */
export const incompleteBeta = (x: number, a: number, b: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    for (const numerator of [
      (m * (b - m) * x) / ((a + m2 - 1) * (a + m2)),
      (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1)),
    ]) {
      d = 1 + numerator * d;
      d = 1 / (Math.abs(d) < tiny ? tiny : d);
      c = 1 + numerator / c;
      c = Math.abs(c) < tiny ? tiny : c;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-12) break;
  }
  return (front * h) / a;
};

/** Two-sided p of Student's t with `df` degrees of freedom. */
export const tTwoSidedP = (t: number, df: number): number =>
  incompleteBeta(df / (df + t * t), df / 2, 0.5);

export type Welch = Readonly<{ t: number; df: number; p: number; difference: number }>;

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const variance = (values: readonly number[]) => {
  const centre = mean(values);
  return (
    values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1)
  );
};

/** Welch's two-sample t-test, two-sided, mean of `b` minus mean of `a`. */
export const welch = (a: readonly number[], b: readonly number[]): Welch => {
  if (a.length < 2 || b.length < 2)
    throw new RangeError("Welch needs two values per group");
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  const difference = mean(b) - mean(a);
  const t = difference / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { t, df, p: tTwoSidedP(t, df), difference };
};
