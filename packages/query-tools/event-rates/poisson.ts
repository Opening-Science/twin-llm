/**
 * Rates with exact Poisson confidence intervals (Garwood 1936), and a rate
 * ratio with a log-scale Wald interval. Pure. An interval with nothing to
 * compute from is null, never 0.
 */

/** P(X <= k) for X ~ Poisson(mu), summed in log space so large k stays finite. */
export const poissonCdf = (k: number, mu: number): number => {
  if (k < 0) return 0;
  if (mu === 0) return 1;
  let logTerm = -mu;
  let total = Math.exp(logTerm);
  for (let i = 1; i <= k; i += 1) {
    logTerm += Math.log(mu) - Math.log(i);
    total += Math.exp(logTerm);
  }
  return Math.min(1, total);
};

/** The mu in [low, high] where `decreasing(mu)` crosses target, by bisection. */
const solve = (
  decreasing: (mu: number) => number,
  target: number,
  high: number,
): number => {
  let lo = 0;
  let hi = high;
  for (let step = 0; step < 200; step += 1) {
    const mid = (lo + hi) / 2;
    if (decreasing(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

export type Interval = Readonly<{ low: number; high: number }>;

/** Exact two-sided interval for a Poisson count k (95% by default). */
export const poissonExactCi = (k: number, level = 0.95): Interval => {
  const alpha = (1 - level) / 2;
  const top = k + 20 + 20 * Math.sqrt(k + 1);
  const high = solve((mu) => poissonCdf(k, mu), alpha, top);
  const low = k === 0 ? 0 : solve((mu) => poissonCdf(k - 1, mu), 1 - alpha, top);
  return { low, high };
};

export type Rate = Readonly<{
  events: number;
  personYears: number;
  /** Events per 100 person-years; null with no person-time. */
  per100: number | null;
  ci: Interval | null;
}>;

export const DAYS_PER_YEAR = 365.25;

export const rateOf = (events: number, personYears: number): Rate => {
  if (personYears <= 0) return { events, personYears, per100: null, ci: null };
  const ci = poissonExactCi(events);
  return {
    events,
    personYears,
    per100: (100 * events) / personYears,
    ci: { low: (100 * ci.low) / personYears, high: (100 * ci.high) / personYears },
  };
};

export type RateRatio = Readonly<{ ratio: number; ci: Interval }> | null;

/** a/b with a 95% Wald interval on the log scale; null when either side has no events. */
export const rateRatio = (a: Rate, b: Rate): RateRatio => {
  if (a.events === 0 || b.events === 0 || a.per100 === null || b.per100 === null) {
    return null;
  }
  const ratio = a.per100 / b.per100;
  const se = Math.sqrt(1 / a.events + 1 / b.events);
  return {
    ratio,
    ci: { low: ratio * Math.exp(-1.959964 * se), high: ratio * Math.exp(1.959964 * se) },
  };
};

/** P(X <= k) for X ~ Binomial(n, p), each term built from the one before in log space. */
export const binomialCdf = (k: number, n: number, p: number): number => {
  if (k < 0) return 0;
  if (k >= n || p <= 0) return 1;
  if (p >= 1) return 0;
  const logOdds = Math.log(p) - Math.log(1 - p);
  let logTerm = n * Math.log(1 - p);
  let total = Math.exp(logTerm);
  for (let i = 1; i <= k; i += 1) {
    logTerm += Math.log(n - i + 1) - Math.log(i) + logOdds;
    total += Math.exp(logTerm);
  }
  return Math.min(1, total);
};

/** The p in [0, 1] where `decreasing(p)` crosses target, by bisection. */
const solveShare = (decreasing: (p: number) => number, target: number): number => {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 100; step += 1) {
    const mid = (lo + hi) / 2;
    if (decreasing(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/**
 * a/b with an exact 95% interval: given a + b events, a is binomial with
 * share p = RR Ta / (RR Ta + Tb), so the Clopper-Pearson interval for p
 * gives one for the rate ratio. A ratio of 0 (no events in a) has a lower
 * limit of 0; null when b has no events or either side has no person-time.
 */
export const exactRateRatio = (a: Rate, b: Rate, level = 0.95): RateRatio => {
  if (b.events === 0 || a.personYears <= 0 || b.personYears <= 0) return null;
  const alpha = (1 - level) / 2;
  const n = a.events + b.events;
  const k = a.events;
  const toRatio = (p: number) => (p / (1 - p)) * (b.personYears / a.personYears);
  const pLow = k === 0 ? 0 : solveShare((p) => binomialCdf(k - 1, n, p), 1 - alpha);
  const pHigh = solveShare((p) => binomialCdf(k, n, p), alpha);
  return {
    ratio: (k / b.events) * (b.personYears / a.personYears),
    ci: { low: toRatio(pLow), high: toRatio(pHigh) },
  };
};

/** One stratum of a rate comparison: events and person-years on each side. */
export type Stratum = Readonly<{
  aEvents: number;
  aYears: number;
  bEvents: number;
  bYears: number;
}>;

/**
 * Mantel-Haenszel rate ratio over strata (a against b) with the
 * Greenland-Robins (1985) variance of its log. Strata with no person-time on
 * one side add nothing. Null when either weighted sum is 0.
 */
export const mantelHaenszelRateRatio = (strata: readonly Stratum[]): RateRatio => {
  let r = 0;
  let s = 0;
  let v = 0;
  for (const row of strata) {
    const total = row.aYears + row.bYears;
    if (row.aYears <= 0 || row.bYears <= 0) continue;
    r += (row.aEvents * row.bYears) / total;
    s += (row.bEvents * row.aYears) / total;
    v += (row.aYears * row.bYears * (row.aEvents + row.bEvents)) / (total * total);
  }
  if (r === 0 || s === 0) return null;
  const ratio = r / s;
  const se = Math.sqrt(v / (r * s));
  return {
    ratio,
    ci: { low: ratio * Math.exp(-1.959964 * se), high: ratio * Math.exp(1.959964 * se) },
  };
};
