/**
 * RR intervals in atrial fibrillation as independent draws: "irregularly
 * irregular", with no memory from one beat to the next. A log-normal keeps
 * every interval positive and has the requested mean and coefficient of
 * variation. Intervals shorter than the floor (the AV node cannot conduct that
 * fast) are drawn again. A statistical stand-in, not a model of AV conduction.
 */
import { normal, type Random } from "@/infrastructure/seeded-random";

/** Shortest RR interval in AF, ms (assumption; see docs/rhythm-sim.md). */
export const AF_MIN_RR_MS = 250;
/** Longest RR interval in AF, ms (assumption). */
export const AF_MAX_RR_MS = 2000;

const MAX_REDRAWS = 20;

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
