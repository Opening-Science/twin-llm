/**
 * WHAT: Zod schema for OAuth token responses.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { z } from 'zod';

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string().optional(),
  token_type: z.string()
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;
