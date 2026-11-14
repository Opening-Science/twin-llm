/**
 * WHAT: Connector configuration types.
 * NOT:  Must not hard-code clinical codes for Observations; mappers + allowlists own codes.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import type { WhoopScope } from '../api/client';

export interface WhoopAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: WhoopScope[];
}
