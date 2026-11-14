/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';

export const AuthParamsSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.url(),
  response_type: z.literal('code'),
  scope: z.string()
});

export const TokenRequestSchema = z.object({
  client_id: z.string(),
  grant_type: z.literal('authorization_code'),
  code: z.string(),
  redirect_uri: z.url()
});

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('bearer'),
  expires_in: z.number(),
  refresh_token: z.string()
});

export type AuthParams = z.infer<typeof AuthParamsSchema>;
export type TokenRequest = z.infer<typeof TokenRequestSchema>;
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
