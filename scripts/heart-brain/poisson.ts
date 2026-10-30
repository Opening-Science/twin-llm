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
