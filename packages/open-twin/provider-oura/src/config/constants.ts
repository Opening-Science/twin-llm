/**
 * WHAT: Connector configuration constants and construction helpers.
 * NOT:  Must not hard-code clinical codes for Observations; mappers + allowlists own codes.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
const SUPPORTED_SCOPES = [
  'daily_activity',
  'heartrate',
  'sleep',
  'daily_spo2',
  'personal_info',
  'workout',
  'daily_cardiovascular_age',
  'vO2_max',
  'daily_readiness',
  'daily_resilience',
  'daily_stress',
  'rest_mode_period',
  'ring_configuration',
  'session'
] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

export { SUPPORTED_SCOPES };
