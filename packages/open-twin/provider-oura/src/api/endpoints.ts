/**
 * WHAT: HTTP path constants for the vendor API.
 * NOT:  Must not embed secrets or response parsing.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
export function getOuraApiUserCollectionBaseUrl(): string {
  return 'https://api.ouraring.com/v2/usercollection';
}

export function getOuraApiSandboxUserCollectionBaseUrl(): string {
  return 'https://api.ouraring.com/v2/sandbox/usercollection';
}

export function getOuraOauthTokenUrl(): string {
  return 'https://api.ouraring.com/oauth/token';
}
