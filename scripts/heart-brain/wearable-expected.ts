/**
 * What the recovered RMSSD and steps ratios should be once the generator's
 * floors are counted (#294). Pure.
 *
 * Generator v3 (`scripts/synthetic-wearables/series.ts`, `dayReadings`) makes
 * a worn day's value as
 *
 * - RMSSD: `clamp(hrv * (episode ? 0.72 : 1) * hrvFactor + 6 Z, 10, 150)`,
 *   then times `irregularHrvFactor` (at least 1, so that step adds no clamp);
 * - steps: `clamp(steps * (weekend ? 0.85 : 1) * stepsFactor + 1800 Z, 500, 30000)`,
 *
 * with Z standard normal. The noise is added after the condition's factor
 * and does not shrink with it, and the floor (10 ms, 500 steps) cuts the low
 * tail. Heart failure scales the mean down to 70 to 80% (RMSSD) and 60 to
 * 70% (steps), which pushes more days onto the floor after onset than before,
 * so the mean after is raised more than the mean before and the ratio sits
 * above the planted factor. `planted` in `wearable-recovery.ts` is the
 * factor itself; `expectedRatio` here is the ratio of the expected worn-day
 * means with the clamp, which is what an unbiased estimate of the recovered
 * ratio should be compared with.
 */
import {
  conditionEffects,
  type SubjectCondition,
} from "../synthetic-wearables/conditions";
import { inGenericEpisode } from "../synthetic-wearables/episodes";
import { subjectProfile } from "../synthetic-wearables/series";

/** Abramowitz and Stegun 7.1.26: erf to about 1.5e-7. */
const erf = (x: number): number => {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-x * x));
};

export const normalCdf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));

const normalPdf = (z: number): number => Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);

/** E[clamp(mean + sd Z, low, high)] for Z standard normal. */
export const clampedNormalMean = (
  mean: number,
  sd: number,
  low: number,
  high: number,
): number => {
  if (sd <= 0) return Math.min(high, Math.max(low, mean));
  const a = (low - mean) / sd;
  const b = (high - mean) / sd;
  const below = normalCdf(a);
  const above = 1 - normalCdf(b);
  return (
    low * below +
    high * above +
    mean * (1 - below - above) +
    sd * (normalPdf(a) - normalPdf(b))
  );
};

export type ExpectedMetric = "hrv_rmssd" | "steps";

const isWeekend = (day: string): boolean => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
};

/** `${seed}:${subjectRef}`, as the generator keys a subject. */
const parseKey = (key: string): Readonly<{ seed: number; subjectRef: string }> => {
  const colon = key.indexOf(":");
  return { seed: Number(key.slice(0, colon)), subjectRef: key.slice(colon + 1) };
};

/**
 * The expected value of a metric on one day, with the generator's clamp
 * (`floors: true`) or without it.
 */
export const expectedDayValue = (
  metric: ExpectedMetric,
  key: string,
  conditions: readonly SubjectCondition[],
  day: string,
  floors = true,
): number => {
  const { seed, subjectRef } = parseKey(key);
  const profile = subjectProfile(seed, subjectRef);
  const effects = conditionEffects(conditions, day, key);
  if (metric === "steps") {
    const mean = profile.steps * (isWeekend(day) ? 0.85 : 1) * effects.stepsFactor;
    return floors ? clampedNormalMean(mean, 1800, 500, 30000) : mean;
  }
  const mean = profile.hrv * (inGenericEpisode(key, day) ? 0.72 : 1) * effects.hrvFactor;
  return (
    effects.irregularHrvFactor * (floors ? clampedNormalMean(mean, 6, 10, 150) : mean)
  );
};

/** Mean of the expected day values after over the mean before, on the given (worn) days. */
export const expectedRatio = (
  metric: ExpectedMetric,
  key: string,
  conditions: readonly SubjectCondition[],
  beforeDays: readonly string[],
  afterDays: readonly string[],
  floors = true,
): number | null => {
  const mean = (days: readonly string[]) =>
    days.length === 0
      ? null
      : days.reduce(
          (t, day) => t + expectedDayValue(metric, key, conditions, day, floors),
          0,
        ) / days.length;
  const before = mean(beforeDays);
  const after = mean(afterDays);
  return before === null || after === null || before === 0 ? null : after / before;
};
