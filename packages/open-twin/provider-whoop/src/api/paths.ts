/**
 * WHAT: HTTP base URL and path constants for the WHOOP developer API.
 * NOT:  Must not embed secrets or response parsing.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2';

export const WHOOP_PATHS = {
  recovery: '/recovery',
  cycle: '/cycle',
  sleep: '/activity/sleep'
} as const;
