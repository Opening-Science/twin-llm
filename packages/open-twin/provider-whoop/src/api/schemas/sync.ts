/**
 * WHAT: Zod schema for the combined WHOOP sync payload (recovery, cycles, sleep).
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { z } from 'zod';
import { WhoopCycleListSchema } from './cycle';
import { WhoopRecoveryListSchema } from './recovery';
import { WhoopSleepListSchema } from './sleep';

export const WhoopSyncPayloadSchema = z.object({
  recovery: WhoopRecoveryListSchema,
  cycles: WhoopCycleListSchema,
  sleep: WhoopSleepListSchema
});

export type WhoopSyncPayload = z.infer<typeof WhoopSyncPayloadSchema>;

export const WhoopCollectionSchema = <T extends z.ZodType>(recordSchema: T) =>
  z.object({
    records: z.array(recordSchema),
    next_token: z.string().nullable().optional()
  });
