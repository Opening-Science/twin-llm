/**
 * How a rate ratio's 95% interval reads against 1. Pure. Shared by the
 * heart-brain study (`scripts/heart-brain/planted.ts`) and the
 * `cohort_event_rates` tool, so both say the same thing about one interval.
 */
import { type RateRatio } from "./poisson";

export type Recovered = "raised" | "lowered" | "no clear difference" | "too few events";

export const recoveredOf = (ratio: RateRatio): Recovered => {
  if (ratio === null) return "too few events";
  if (ratio.ci.low > 1) return "raised";
  if (ratio.ci.high < 1) return "lowered";
  return "no clear difference";
};
