/**
 * WHAT: Connector configuration constants and construction helpers.
 * NOT:  Must not hard-code clinical codes for Observations; mappers + allowlists own codes.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import type { SupportedScope } from './constants';

export interface OuraRingAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: SupportedScope[];
}
