/**
 * WHAT: Cross-source reconciliation / measure keys / source selection for overlapping Observations.
 * NOT:  Must not fetch vendor data or invent scores for openXR HealthTwinData.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d3; DECISIONS.md#d4
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { SYSTEMS } from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';

/**
 * Which validated measure an Observation is an instance of.
 *
 * `reliability.ts` grades a (source, measure) pair, and its central finding is that
 * accuracy is per-measure and not per-device: every consumer wearable separates sleep
 * from wake well and stages sleep badly. To act on that at all, something has to say
 * which measure a given Observation is — and a LOINC code alone does not, because two
 * codes can name the same measured thing and one code can be reached by two connectors
 * that are not equally good at it.
 *
 * The mapping is deliberately narrow. An Observation whose code is absent here is
 * simply not reconciled: it is carried through untouched, which is the honest outcome
 * for a measure nobody has published validation evidence about.
 */

/** The measure vocabulary used by `reliabilityFor`. */
export type Measure =
  | 'total-sleep-time'
  | 'sleep-staging'
  | 'sleep-wake-detection'
  | 'step-count'
  | 'energy-expenditure'
  | 'oxygen-saturation'
  | 'resting-heart-rate'
  | 'heart-rate-variability'
  | 'vo2max';

/**
 * LOINC code to measure. Each entry is a claim that the code names that measured
 * thing, and only codes the connectors actually emit appear.
 */
const BY_LOINC: Readonly<Record<string, Measure>> = {
  '93832-4': 'total-sleep-time', // Sleep duration
  '103213-5': 'total-sleep-time', // Duration in bed — same measure, different boundary
  '93829-0': 'sleep-staging', // REM sleep duration
  '93830-8': 'sleep-staging', // Light sleep duration
  '93831-6': 'sleep-staging', // Deep sleep duration
  '41950-7': 'step-count', // Number of steps in 24 hour Measured
  '55423-8': 'step-count', // Number of steps
  '41979-6': 'energy-expenditure', // Calories burned in 24 hour Calculated
  '41981-2': 'energy-expenditure', // Calories burned
  '59408-5': 'oxygen-saturation', // SpO2 by pulse oximetry
  '40443-4': 'resting-heart-rate', // Heart rate --resting
  '103222-6': 'resting-heart-rate', // Resting heart rate during sleep
  '94122-9': 'vo2max' // Oxygen consumption --peak during exercise
};

/**
 * Vendor-local codes that name a measure the reliability table covers. Kept apart from
 * the LOINC map because a local code is only meaningful inside its own system: two
 * connectors can both publish `hrv` and mean different things.
 */
const BY_LOCAL: Readonly<Record<string, Measure>> = {
  [`${SYSTEMS.GOOGLE_HEALTH}|heart-rate-variability`]: 'heart-rate-variability',
  [`${SYSTEMS.OURA}|hrv-balance`]: 'heart-rate-variability'
};

export function measureOf(observation: Observation): Measure | undefined {
  for (const coding of observation.code?.coding ?? []) {
    if (!coding.code) continue;
    if (coding.system === SYSTEMS.LOINC) {
      const measure = BY_LOINC[coding.code];
      if (measure) return measure;
    }
    const local = BY_LOCAL[`${coding.system}|${coding.code}`];
    if (local) return local;
  }
  return undefined;
}

/**
 * The day an Observation is about, as the calendar date of its effective time.
 *
 * Two connectors describing the same night do not agree to the second — one reports
 * the moment the sync completed, another the start of the sleep period — so matching
 * on an exact instant would find no overlap at all and silently reconcile nothing.
 * The day is the granularity the vendors themselves summarise at.
 *
 * Returns undefined when there is no effective time. Such an Observation is not
 * reconciled: without a time there is nothing to say it describes the same occasion as
 * anything else, and grouping it by measure alone would merge a year of readings.
 */
export function effectiveDay(observation: Observation): string | undefined {
  const instant = observation.effectiveDateTime ?? observation.effectivePeriod?.start;
  if (typeof instant !== 'string' || instant.length < 10) return undefined;
  return instant.slice(0, 10);
}

/** Identifies the occasion two Observations would have to share to be reconcilable. */
export function occasionKey(observation: Observation): string | undefined {
  const measure = measureOf(observation);
  const day = effectiveDay(observation);
  return measure && day ? `${measure}|${day}` : undefined;
}
