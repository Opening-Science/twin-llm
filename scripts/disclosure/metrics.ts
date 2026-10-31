/**
 * Membership-inference attacks and their metrics (#301). Pure: randomness
 * only through the `Random` passed in.
 *
 * Every attack turns the per-token log-probabilities of the trained tokens
 * (assistant turns) into one score per conversation, higher meaning "more
 * likely a member". The target is the fine-tune; the reference is the base
 * model on the same tokens.
 */
import { type Random } from "@/infrastructure/seeded-random";
import { binomialCdf } from "../heart-brain/poisson";
import {
  auroc,
  clusterBootstrap,
  rocPoints,
  type Estimate,
} from "../rhythm-bench/statistics";
import { wilson95 } from "../evaluation/score/stats";

export type TokenScores = Readonly<{
  /** Natural-log probability of each trained token. */
  lp: readonly number[];
  /** Whether the token contains a digit (values, dates, ids). */
  digit: readonly boolean[];
  /** zlib-compressed size in bytes of the trained text. */
  zlibBytes: number;
}>;

export const ATTACKS = [
  "loss",
  "reference",
  "minK20",
  "zlib",
  "referenceDigits",
] as const;

export type Attack = (typeof ATTACKS)[number];

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/** Mean of the lowest `share` of the values (at least one). */
export const minKMean = (values: readonly number[], share: number): number | null => {
  if (values.length === 0) return null;
  const count = Math.max(1, Math.ceil(values.length * share));
  return mean([...values].sort((a, b) => a - b).slice(0, count));
};

/**
 * One attack score. Loss (Yeom et al. 2018): mean log-probability. Reference
 * (Carlini et al. 2022, offline): target minus base mean log-probability.
 * Min-K% (Shi et al. 2024) with K = 20. zlib (Carlini et al. 2021): summed
 * log-probability over the compressed size. Reference on digits: the
 * reference attack on digit tokens only. Null when there are no tokens.
 */
export const attackScore = (
  attack: Attack,
  target: TokenScores,
  reference: TokenScores,
): number | null => {
  if (target.lp.length !== reference.lp.length)
    throw new Error("target and reference scored different tokens");
  const t = target.lp;
  switch (attack) {
    case "loss":
      return mean(t);
    case "reference": {
      const a = mean(t);
      const b = mean(reference.lp);
      return a === null || b === null ? null : a - b;
    }
    case "minK20":
      return minKMean(t, 0.2);
    case "zlib":
      return t.length === 0 || target.zlibBytes <= 0
        ? null
        : t.reduce((a, b) => a + b, 0) / target.zlibBytes;
    case "referenceDigits":
      return mean(
        t.flatMap((value, i) => (target.digit[i] ? [value - reference.lp[i]] : [])),
      );
  }
};

export type Interval = Readonly<{ low: number; high: number }>;

/** Exact (Clopper-Pearson) interval for k successes in n trials. */
export const clopperPearson = (k: number, n: number, level = 0.95): Interval => {
  const alpha = (1 - level) / 2;
  /** The p where a function decreasing in p crosses target, by bisection. */
  const solve = (decreasing: (p: number) => number, target: number): number => {
    let lo = 0;
    let hi = 1;
    for (let step = 0; step < 100; step += 1) {
      const mid = (lo + hi) / 2;
      if (decreasing(mid) > target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // Lower: P(X >= k) = alpha, that is P(X <= k - 1) = 1 - alpha. Upper: P(X <= k) = alpha.
  const low = k === 0 ? 0 : solve((p) => binomialCdf(k - 1, n, p), 1 - alpha);
  const high = k === n ? 1 : solve((p) => binomialCdf(k, n, p), alpha);
  return { low, high };
};

export type Rate = Readonly<{ k: number; n: number; value: number; ci95: Interval }>;

/**
 * True-positive rate at the largest threshold whose false-positive rate is at
 * most `fpr`, with its Clopper-Pearson interval.
 */
export const tprAtFpr = (
  positives: readonly number[],
  negatives: readonly number[],
  fpr: number,
): Rate | null => {
  if (positives.length === 0 || negatives.length === 0) return null;
  const points = rocPoints(positives, negatives).filter((p) => p.fpr <= fpr + 1e-12);
  const best = Math.max(...points.map((p) => p.tpr));
  const k = Math.round(best * positives.length);
  return {
    k,
    n: positives.length,
    value: k / positives.length,
    ci95: clopperPearson(k, positives.length),
  };
};

export type ScoredRow = Readonly<{ subject: string; member: boolean; score: number }>;

export type AttackResult = Readonly<{
  members: number;
  nonMembers: number;
  auroc: Estimate;
  tprAt1: Rate | null;
}>;

const aurocOf = (rows: readonly ScoredRow[]): number | null =>
  auroc(
    rows.filter((r) => r.member).map((r) => r.score),
    rows.filter((r) => !r.member).map((r) => r.score),
  );

/** AUROC with a bootstrap over subjects, and TPR at 1% FPR. */
export const evaluateAttack = (
  rows: readonly ScoredRow[],
  resamples: number,
  random: Random,
): AttackResult => {
  const clusters = new Map<string, ScoredRow[]>();
  for (const row of rows)
    clusters.set(row.subject, [...(clusters.get(row.subject) ?? []), row]);
  const ordered = [...clusters.keys()].sort().map((key) => clusters.get(key) ?? []);
  return {
    members: rows.filter((r) => r.member).length,
    nonMembers: rows.filter((r) => !r.member).length,
    auroc: clusterBootstrap(ordered, aurocOf, resamples, random),
    tprAt1: tprAtFpr(
      rows.filter((r) => r.member).map((r) => r.score),
      rows.filter((r) => !r.member).map((r) => r.score),
      0.01,
    ),
  };
};

export type MatchRow = Readonly<{ member: boolean; match: boolean }>;

export type MatchComparison = Readonly<{
  member: Rate | null;
  nonMember: Rate | null;
  difference: number | null;
  /** Two-sided permutation p-value for the difference in match rate. */
  permutationP: number | null;
}>;

const rateOf = (rows: readonly MatchRow[]): Rate | null => {
  if (rows.length === 0) return null;
  const k = rows.filter((r) => r.match).length;
  const ci = wilson95(k, rows.length) ?? { low: 0, high: 1 };
  return { k, n: rows.length, value: k / rows.length, ci95: ci };
};

const differenceOf = (rows: readonly MatchRow[]): number | null => {
  const a = rateOf(rows.filter((r) => r.member));
  const b = rateOf(rows.filter((r) => !r.member));
  return a && b ? a.value - b.value : null;
};

/** Exact-match rates of members and non-members, and a label-shuffle test. */
export const compareMatches = (
  rows: readonly MatchRow[],
  permutations: number,
  random: Random,
): MatchComparison => {
  const difference = differenceOf(rows);
  if (difference === null || permutations === 0)
    return {
      member: rateOf(rows.filter((r) => r.member)),
      nonMember: rateOf(rows.filter((r) => !r.member)),
      difference,
      permutationP: null,
    };
  const labels = rows.map((r) => r.member);
  let extreme = 0;
  for (let b = 0; b < permutations; b += 1) {
    const order = [...labels];
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const drawn = differenceOf(
      rows.map((r, i) => ({ member: order[i], match: r.match })),
    );
    if (drawn !== null && Math.abs(drawn) >= Math.abs(difference) - 1e-12) extreme += 1;
  }
  return {
    member: rateOf(rows.filter((r) => r.member)),
    nonMember: rateOf(rows.filter((r) => !r.member)),
    difference,
    permutationP: (extreme + 1) / (permutations + 1),
  };
};
