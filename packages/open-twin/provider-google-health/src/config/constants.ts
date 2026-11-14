/**
 * WHAT: Connector configuration constants and construction helpers.
 * NOT:  Must not hard-code clinical codes for Observations; mappers + allowlists own codes.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
export const SUPPORTED_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.location.readonly',
  'https://www.googleapis.com/auth/googlehealth.profile.readonly',
  'https://www.googleapis.com/auth/googlehealth.settings.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly'
  // `as const` is load-bearing: without it the inferred type is `string[]`, so
  // `SupportedScope` resolves to `string` and `config.scopes` accepts any arbitrary
  // string with no compile-time check at all.
] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];
