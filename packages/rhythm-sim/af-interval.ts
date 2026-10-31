/**
 * RR intervals in atrial fibrillation, in two modes (docs/rhythm-sim.md).
 *
 * - `independent`: independent draws, "irregularly irregular" with no memory
 *   from one beat to the next.
 * - `short_range` (#297): ln RR follows a stationary Gaussian AR(1) process, so
 *   each interval leans a little towards the one before it. The lag-1
 *   coefficient is fitted to a summary statistic of the MIT-BIH AF Database
 *   (`AF_SHORT_RANGE_PHI`).
 *
 * In both a log-normal keeps every interval positive and has the requested
 * mean and coefficient of variation (the AR(1) keeps the marginal standard
 * normal). Intervals outside the floor and ceiling are drawn again. A
 * statistical model, not a model of AV conduction.
 */
import { normal, type Random } from "@/infrastructure/seeded-random";

/** Shortest RR interval in AF, ms (assumption; see docs/rhythm-sim.md). */
export const AF_MIN_RR_MS = 250;
/** Longest RR interval in AF, ms (assumption). */
export const AF_MAX_RR_MS = 2000;

const MAX_REDRAWS = 20;

export const AF_DEPENDENCES = ["independent", "short_range"] as const;
export type AfDependence = (typeof AF_DEPENDENCES)[number];

/**
 * Lag-1 coefficient of the AR(1) on ln RR in `short_range` mode, fitted to
 * one summary statistic of the MIT-BIH AF Database: the sample lag-1
 * autocorrelation of ln RR in 128-interval windows that are all AFIB, 0.043
 * as the median over its 23 records of each record's median and 0.054 pooled
 * over its 3845 windows (the rhythm benchmark reports both, `lagSummary`).
 * The sample statistic of a short window is biased low (about −0.008 for
 * independent values), so φ sits a little above the target: by simulation
 * (20,000 windows, CV 0.2), φ = 0.055 gives a median of 0.046, between the
 * two. One coefficient for every rate and spread is a stated choice.
 */
export const AF_SHORT_RANGE_PHI = 0.055;

export type LogNormal = Readonly<{ mu: number; sigma: number }>;

/** Log-normal parameters for a mean and a coefficient of variation. */
export const logNormalFor = (meanMs: number, cv: number): LogNormal => {
  const sigma2 = Math.log(1 + cv ** 2);
  return { mu: Math.log(meanMs) - sigma2 / 2, sigma: Math.sqrt(sigma2) };
};

/** One AF interval, ms, within [AF_MIN_RR_MS, AF_MAX_RR_MS]. */
export const afInterval = (random: Random, shape: LogNormal): number => {
  const draw = (attempt: number): number => {
    const value = Math.exp(shape.mu + shape.sigma * normal(random));
    if (value >= AF_MIN_RR_MS && value <= AF_MAX_RR_MS) return value;
    return attempt >= MAX_REDRAWS
      ? Math.min(AF_MAX_RR_MS, Math.max(AF_MIN_RR_MS, value))
      : draw(attempt + 1);
  };
  return draw(1);
};

/** One `short_range` interval and the AR(1) state (a standard normal) it came from. */
export type AfStep = Readonly<{ rrMs: number; state: number }>;

/**
 * The next AF interval of the AR(1) on ln RR: state = φ · previous +
 * √(1 − φ²) · ε, interval = exp(μ + σ · state). With no previous state (the
 * first AF beat of an episode) the state is a fresh standard normal, so the
 * process starts stationary. Out-of-range intervals redraw ε and are clamped
 * after `MAX_REDRAWS`, as in `afInterval`.
 */
export const afIntervalAfter = (
  random: Random,
  shape: LogNormal,
  phi: number,
  previous: number | null,
): AfStep => {
  const draw = (attempt: number): AfStep => {
    const state =
      previous === null
        ? normal(random)
        : phi * previous + Math.sqrt(1 - phi ** 2) * normal(random);
    const value = Math.exp(shape.mu + shape.sigma * state);
    if (value >= AF_MIN_RR_MS && value <= AF_MAX_RR_MS) return { rrMs: value, state };
    return attempt >= MAX_REDRAWS
      ? { rrMs: Math.min(AF_MAX_RR_MS, Math.max(AF_MIN_RR_MS, value)), state }
      : draw(attempt + 1);
  };
  return draw(1);
};

/** Sample autocorrelation of a series at `lag` (the usual biased estimator); null when undefined. */
export const autocorrelation = (
  values: readonly number[],
  lag: number,
): number | null => {
  if (lag < 1 || values.length <= lag) return null;
  if (values.every((value) => value === values[0])) return null;
  const centre = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - centre) ** 2, 0);
  const covariance = values
    .slice(lag)
    .reduce((total, value, i) => total + (value - centre) * (values[i] - centre), 0);
  return covariance / variance;
};
