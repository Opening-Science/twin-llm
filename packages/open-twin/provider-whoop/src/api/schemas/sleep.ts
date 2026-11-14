/**
 * WHAT: Zod schema for a WHOOP sleep payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { z } from 'zod';

const SleepStageSummarySchema = z.object({
  total_in_bed_time_milli: z.number().optional(),
  total_awake_time_milli: z.number().optional(),
  total_light_sleep_time_milli: z.number().optional(),
  total_slow_wave_sleep_time_milli: z.number().optional(),
  total_rem_sleep_time_milli: z.number().optional(),
  disturbance_count: z.number().optional()
});

const SleepScoreSchema = z.object({
  respiratory_rate: z.number().optional(),
  sleep_performance_percentage: z.number().optional(),
  sleep_consistency_percentage: z.number().optional(),
  sleep_efficiency_percentage: z.number().optional(),
  stage_summary: SleepStageSummarySchema.optional()
});

export const WhoopSleepSchema = z.object({
  id: z.string().optional(),
  cycle_id: z.number().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  nap: z.boolean().optional(),
  score_state: z.string().optional(),
  score: SleepScoreSchema.optional()
});

export const WhoopSleepListSchema = z.array(WhoopSleepSchema);

export type WhoopSleep = z.infer<typeof WhoopSleepSchema>;
