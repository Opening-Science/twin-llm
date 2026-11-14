/**
 * WHAT: Zod schema for a WHOOP cycle (strain day) payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { z } from 'zod';

const CycleScoreSchema = z.object({
  strain: z.number().optional(),
  kilojoule: z.number().optional(),
  average_heart_rate: z.number().optional(),
  max_heart_rate: z.number().optional()
});

export const WhoopCycleSchema = z.object({
  id: z.coerce.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  score_state: z.string().optional(),
  score: CycleScoreSchema.optional()
});

export const WhoopCycleListSchema = z.array(WhoopCycleSchema);

export type WhoopCycle = z.infer<typeof WhoopCycleSchema>;
