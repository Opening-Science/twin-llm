# @open-twin/provider-whoop

WHOOP Developer API v2 to FHIR R4. Recovery, cycle (strain), and sleep metrics for a requested time window.

> **Note:** This package does not run the browser OAuth redirect. Your application must send the user to WHOOP, receive the authorization code, and pass it to `TokenHandler`.

## Installation

```bash
pnpm add @open-twin/provider-whoop
```

Register an app in the [WHOOP Developer Dashboard](https://developer.whoop.com/). WHOOP requires OAuth `state` to be **exactly 8 characters** — use `createWhoopOAuthState()`.

## Usage

```ts
import {
  TokenHandler,
  createWhoopOAuthState,
  getWhoopAuthorizationUrl,
  getWhoopData,
  getFhirBundleFromWhoopData,
  type WhoopAppConfig
} from '@open-twin/provider-whoop';

const config: WhoopAppConfig = {
  clientId: '…',
  clientSecret: '…',
  redirectUri: 'https://your.app/callback'
};

const state = createWhoopOAuthState();
const authorizeUrl = getWhoopAuthorizationUrl(config, state);
// redirect the user to authorizeUrl, then:

const tokenHandler = new TokenHandler(config, authorizationCode);
await tokenHandler.authenticate();

// Persist the pair and its absolute expiry yourself (D8) — in memory only.
const stored = tokenHandler.getTokens();

// Restore on a later process: skip authenticate; pass both so expiry is not recomputed.
// tokenHandler.setTokens(stored.tokens, stored.expiresAt)
// Passing only tokens treats expires_in as seconds from now; use it for fresh tokens, not restores.

// Returns the access token. If token is expired, refreshes and returns it.
await tokenHandler.getAccessToken();

// After a refresh, getTokens() returns the rotated pair and new expiresAt for re-persist.

const window = { start: '2026-06-01T00:00:00.000Z', end: '2026-06-30T23:59:59.000Z' };

const { data, issues } = await getWhoopData(window, tokenHandler, { subjectKey: 'wearer-stable-id' });

const { bundle } = await getFhirBundleFromWhoopData(window, tokenHandler, {
  subjectKey: 'wearer-stable-id',
  timestamp: '2026-07-26T10:00:00Z'
});
```

`getWhoopData` is the supported package entry; hosts must not import `src/utils/fetchWhoopData`.

Tokens are held in memory only; persist the pair and its absolute expiry in your app.
`expiresAt` is an absolute timestamp in epoch milliseconds.

## Scope

v1 mappers: recovery (score, HRV, resting HR, SpO₂), cycle strain and average HR, sleep (performance, efficiency, time in bed). Workouts are not mapped yet.

## License

MIT
