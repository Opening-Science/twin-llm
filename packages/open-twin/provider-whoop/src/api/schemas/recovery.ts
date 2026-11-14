/**
 * WHAT: Zod schema for a WHOOP recovery payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { z } from 'zod';

const RecoveryScoreSchema = z.object({
  recovery_score: z.number().optional(),
  resting_heart_rate: z.number().optional(),
  hrv_rmssd_milli: z.number().optional(),
  spo2_percentage: z.number().optional(),
  skin_temp_celsius: z.number().optional()
});

export const WhoopRecoverySchema = z.object({
  cycle_id: z.coerce.string().optional(),
  sleep_id: z.string().optional(),
  score_state: z.string().optional(),
  created_at: z.string().optional(),
  score: RecoveryScoreSchema.optional()
});

export const WhoopRecoveryListSchema = z.array(WhoopRecoverySchema);

export type WhoopRecovery = z.infer<typeof WhoopRecoverySchema>;
