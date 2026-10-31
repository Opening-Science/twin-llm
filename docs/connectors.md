# Wearable connectors

Three OAuth connectors feed wearable context into the twin: Oura, Whoop and Google Health. BodyLoop is a fourth connector that uses a per-user API token rather than OAuth. Each section uses the same six headings. Env vars are listed by name only; values live in `.env.local` and never in the repo, docs, logs or PR text.

Shared behaviour:

- **Sync window:** `resolveSyncDateWindow` (`features/wearables/sync-window.ts`) takes an optional `startDate` / `endDate` (`YYYY-MM-DD`). The default is the last 14 days inclusive and the maximum is 90 days. Whoop's timestamp API gets UTC day bounds from `syncWindowToUtcTimestamps` (`T00:00:00.000Z` to `T23:59:59.999Z`).
- **Token encryption:** access and refresh tokens are stored AES-256-GCM encrypted (`features/<connector>/token-crypto.ts`). Each connector has its own key, `*_TOKEN_ENCRYPTION_KEY`, which is 64 hex characters (32 bytes).
- **Server-side only:** snapshot `summary` and `fhirBundle` are read on the server. Chat injects only the summary narrative and citation keys.
- **Audited syncs (#223):** every sync, from `POST /api/<provider>/sync` or the first sync after a callback, writes one `personal.read.sync-<provider>` audit row (`sync-oura`, `sync-whoop`, `sync-google-health`) with the number of metrics written, never a value (`features/wearables/audited-sync.ts`). In personal mode the Connectors page writes `personal.read.connectors-page` per view. See `docs/query-layer.md` Audit.
- **Every OAuth exit returns to Connectors (2026-10-21):** authorize and callback never answer with JSON. They redirect to `/connectors?<oura|whoop|google-health>=<outcome>`, where the outcome is `connected`, `denied`, `error`, `expired` (state missing or mismatched), `signin` or `unconfigured`. `/connectors` forwards to `/customize/connectors` with the query intact, so registered redirect URIs did not change. The card shows one plain sentence and, for `denied`, `error` and `expired`, a "Try again" link. An `expired` exit still happens before any token exchange and logs only `hasState` and `hasCookie`.
- **Open TwinLLM at `http://localhost:3000`:** every proxy returns to `localhost`. To a browser `127.0.0.1` is a different host, so the state cookie set there never reaches the callback and the return ends as `expired`. The page shows a hint when it is opened on a loopback IP.
- **Setup on the page:** each card's Setup disclosure lists the env names it needs with set / missing, the redirect URI to register and the commands below. It is built from names and booleans only (`features/connectors/connector-setup.ts`). In development a name that is present but blank or starts with `#` reads "looks empty, check .env.local".

## Oura

### OAuth flow

- `GET /api/oura/authorize` (`app/api/oura/authorize/route.ts`) resolves the actor, creates the user row lazily, generates an 8-character host state (`createOuraOAuthState` in `features/oura/oauth-cookie.ts`), and sets it in the `oura_oauth_state` cookie (`httpOnly`, `sameSite: "lax"`, `maxAge` 600 s, `path: "/"`, `secure` unless the redirect URI contains `localhost`). It then redirects to the Oura authorization URL. `@open-twin/provider-oura` `getAuthorizationUrl` accepts optional `state`; the host adapter (`infrastructure/open-twin-adapters/oura-authorize.ts`) still appends it.
- `GET /api/oura/callback` (`app/api/oura/callback/route.ts`) reads `code` and `state`, deletes the cookie immediately, and compares `state` to the cookie. Missing or mismatched state redirects to `/connectors?oura=expired` **before** any token exchange. A provider `error` or missing `code` redirects to `/connectors?oura=denied`. On match it exchanges `code`, persists encrypted tokens, runs an initial sync (a failure there is logged and swallowed), and redirects to `/connectors?oura=connected`.
- Scopes requested (`OURA_OAUTH_SCOPES` in `features/oura/connection.ts`): `email`, `personal`, `daily`, `workout`, `spo2`. Oura names no scope of their own for `daily_stress` and `vO2_max`. An account linked before `workout` and `spo2` were added has to be unlinked and linked again before those collections return data.
- Sync (`syncOuraForUser`) fetches eight v2 collections in one pass (`OURA_SYNC_TYPES`): `personal_info`, `sleep`, `daily_readiness`, `daily_activity`, `workout`, `daily_spo2`, `daily_stress`, `vO2_max`. A collection that fails or is empty is reported in the provider's issues and the others are still stored. The FHIR bundle is built from the same responses as the summary (`buildOuraFhirBundle`, `infrastructure/open-twin-adapters/oura-bundle.ts`).

### Local proxy

`bun run oura:proxy` (`scripts/oura-oauth-proxy.mjs`) listens on `http://localhost:8787/callback` and 302s, with the query string intact, to `http://localhost:3000/api/oura/callback`. Overrides: `OURA_PROXY_HOST`, `OURA_PROXY_PORT`, `OURA_PROXY_FORWARD`.

### Env var names

`OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI`, `OURA_TOKEN_ENCRYPTION_KEY` (`infrastructure/env.ts`).

### What is stored

- `oura_oauth_state` cookie (10 minutes): the CSRF nonce only. Not written to the database.
- `OuraConnection` (`oura_connections`): encrypted tokens, access-token expiry, optional subject key, `lastSyncAt`.
- `OuraSnapshot` (`oura_snapshots`): window, `summary` (metrics + narrative), optional `fhirBundle` from `@open-twin/provider-oura`. Summary keys by collection: `personal.*`, `sleep.*`, `readiness.*`, `activity.*`, `workout.{duration,calories,distance}.<activity>.<day>`, `spo2.{average,breathing_disturbance_index}.<day>`, `stress.{summary,high,recovery_high}.<day>` and `vo2max.value.<day>`. Durations are whole minutes; a field Oura leaves out produces no metric. In the bundle a workout is an `oura|workout` Observation with LOINC `41981-2` calories (`kcal`) and `oura|workout-distance` (`m`) components, a SpO2 night an `oura|spo2-daily-summary` with LOINC `59408-5` (`%`) and `oura|breathing-disturbance-index` (`/h`), a stress day an `oura|daily-stress` with the day summary as its value and `oura|stress-high` / `oura|recovery-high` (`min`), and a VO2max reading LOINC `94122-9` (`mL/kg/min`). Wearable snapshots never write the warehouse tables.

### What is encrypted

`accessTokenEnc` and `refreshTokenEnc`, with `OURA_TOKEN_ENCRYPTION_KEY`.

### What is never logged

Tokens, authorization codes, the state value, cookie values, response bodies and wearable values. A state mismatch logs `hasState` and `hasCookie` only. Authorize, callback and sync failures log the error name only (`[oura] authorize failed`, `[oura] OAuth callback failed`, `[oura] initial sync failed after connect`).

## Whoop

### OAuth flow

- `GET /api/whoop/authorize` (`app/api/whoop/authorize/route.ts`) requires an `https://` or `whoop://` redirect URI. It creates an 8-character state with `createWhoopOAuthState` from `@open-twin/provider-whoop` and sets it in the `whoop_oauth_state` cookie (`httpOnly`, `sameSite: "lax"`, `maxAge` 600 s, `secure` unless the redirect URI contains `localhost`). It then redirects to Whoop.
- `GET /api/whoop/callback` (`app/api/whoop/callback/route.ts`) compares the `state` query parameter with the cookie and deletes the cookie. A provider `error` or missing `code` redirects to `/connectors?whoop=denied`; a missing or mismatched state redirects to `/connectors?whoop=expired` before any token exchange. Otherwise it exchanges the code, persists encrypted tokens and runs an initial sync (a failure there is logged and swallowed).
- Scopes requested: the provider default `WHOOP_SCOPES` (`read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:profile`, `offline`). `read:workout` was already in that list, so adding workout sync needs no reconnect.
- `POST /api/whoop/sync` fetches recovery, cycles and sleep through `getWhoopData`, and workouts (`GET /v2/activity/workout`) through the host's `fetchWhoopWorkouts` (`infrastructure/open-twin-adapters/whoop-workout.ts`), both via `fetchWhoopWindow` in `infrastructure/open-twin-adapters/whoop.ts`. It returns `{ ok, metricCount, window }` or a constant 502 `{ error: "Could not sync Whoop data. Reconnect and try again." }`. A sync where some collections fail and others succeed stores what succeeded; the sync fails only when every collection errors and nothing was fetched.
- `GET /api/whoop/status` and `POST /api/whoop/disconnect` report and remove the connection.

### Local proxy

Whoop only accepts `https://` redirects. `bun run whoop:proxy` (`scripts/whoop-oauth-proxy.mjs`) serves TLS on `https://localhost:8788/api/whoop/callback` and 302s, with the query string intact, to `http://localhost:3000/api/whoop/callback`. It reads the key and cert from the gitignored `certificates/` directory. Overrides: `WHOOP_PROXY_HOST`, `WHOOP_PROXY_PORT`, `WHOOP_PROXY_FORWARD`, `WHOOP_PROXY_KEY`, `WHOOP_PROXY_CERT`.

Certificate, once per machine: create `certificates/localhost.pem` and `certificates/localhost-key.pem`, for example with `mkcert -cert-file certificates/localhost.pem -key-file certificates/localhost-key.pem localhost`. Open `https://localhost:8788/api/whoop/callback` once in the browser and accept the certificate before linking.

### Env var names

`WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`, `WHOOP_TOKEN_ENCRYPTION_KEY` (`infrastructure/env.ts`).

### What is stored

- `WhoopConnection` (`whoop_connections`): encrypted tokens, access-token expiry, `lastSyncAt`.
- `WhoopSnapshot` (`whoop_snapshots`): window, `summary` (metrics with `whoop.*` citation keys + narrative), and optional `fhirBundle` from `buildWhoopBundleFromPayload` (`@open-twin/provider-whoop`, subject key = internal user id). Rows written before the `whoop_snapshot_fhir_bundle` migration have `fhirBundle = null`. If the bundle build throws, the snapshot is still written with `fhirBundle = null`. Workout keys are `whoop.workout.{duration,strain,avg_hr,max_hr,kilojoules,distance,hr_zone_0..hr_zone_5}.<sport>.<day>`; a second workout of the same sport on one day gets `<sport>_2`. Durations and zone times are whole minutes, energy stays in kJ as Whoop sends it, and an unscored workout or a field Whoop leaves out produces no metric. In the bundle a scored workout is a `whoop|workout` Observation (sport as `code.text`, `effectivePeriod`, `dataAbsentReason` `not-applicable`) with components `whoop|workout-strain` (`{score}`), `whoop|workout-average-heart-rate` and `whoop|workout-max-heart-rate` (`/min`), LOINC `41981-2` calories (`kcal`, converted from kJ at 4.184), `whoop|workout-distance` (`m`) and `whoop|workout-hr-zone-0` to `-5` (`ms`).

### What is encrypted

`accessTokenEnc` and `refreshTokenEnc`, with `WHOOP_TOKEN_ENCRYPTION_KEY`.

### What is never logged

Tokens, authorization codes, the state value, cookie values, response bodies and wearable values.

- A rejected callback logs only booleans (`hasOauthError`, `hasCode`; `hasState`, `hasCookie` on a state mismatch).
- A failed sync logs the joined `ConnectorError` fields: connector, message, and `[category METHOD /path HTTP status]`.
- A skipped FHIR bundle logs the error name only.

## Google Health

### OAuth flow

- `GET /api/google-health/authorize` (`app/api/google-health/authorize/route.ts`) creates a state value and sets it in the `google_health_oauth_state` cookie (`httpOnly`, `sameSite: "lax"`, `maxAge` 600 s, `secure` only when the redirect is https and not localhost). It then redirects to Google.
- `GET /api/google-health/callback` compares state with the cookie and deletes the cookie. A missing or mismatched state redirects to `/connectors?google-health=expired` before any token exchange. It then exchanges the code, persists encrypted tokens and runs an initial sync (a failure there is logged and swallowed), and redirects to `/connectors?google-health=…`.

### Local proxy

None. The redirect is `http://localhost:3000/api/google-health/callback` directly.

### Env var names

`GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET`, `GOOGLE_HEALTH_REDIRECT_URI`, `GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY` (`infrastructure/env.ts`).

### What is stored

- `GoogleHealthConnection` (`google_health_connections`): encrypted tokens, access-token expiry, optional subject key, `lastSyncAt`.
- `GoogleHealthSnapshot` (`google_health_snapshots`): window, `summary`, optional `fhirBundle`.

### What is encrypted

`accessTokenEnc` and `refreshTokenEnc`, with `GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY`.

### What is never logged

Tokens, authorization codes, the state value, cookie values, response bodies and wearable values. A rejected callback logs only booleans and the provider `error` parameter. Known exception: authorize logs the configured redirect URI (`app/api/google-health/authorize/route.ts:49`). This is a configuration value, not a secret; removing it is a known follow-up.

## BodyLoop (Vitronic)

Host HTTP with a per-user API token. FHIR mapping lives in
`@open-twin/provider-vitronic` (`buildBundleFromVitronicResponse`) but TwinLLM
does **not persist** that bundle. BodyLoop `properties` and measure lists are
SI (m / rad for lists). TwinLLM stores API payloads as received and converts
lists to cm/deg only for display and chat. See [vitronic.md](./vitronic.md).

### OAuth flow

None. There is no password grant and no `/api/v2/authentification/token` call in
the app. An operator mints a per-user API token with
`bun scripts/vitronic/mint-token.ts` (password never stored by the app).
`POST /api/vitronic/connect` stores the token encrypted and pins the scanner TLS
certificate. Live sync sends `Authorization: Bearer` on allowlisted GET paths
only. Viatars are matched by integer `proband_id`, not `key_external`.

### Local proxy

None. File ingest (`POST /api/vitronic/sync` with measurements JSON + optional
`glbBase64`) is the path that does not need scanner network access.

### Env var names

`VITRONIC_TOKEN_ENCRYPTION_KEY`, optional `VITRONIC_DATA_DIR` (`infrastructure/env.ts`).
Mint CLI: `BODYLOOP_BASE_URL`, `BODYLOOP_USERNAME`, `BODYLOOP_PASSWORD`.
Live test: `RUN_LIVE`, `VITRONIC_BASE_URL`, `VITRONIC_API_TOKEN`, `VITRONIC_PROBAND_ID`.

### What is stored

- `VitronicConnection` (`vitronic_connections`): encrypted API token, encrypted upload secret, `baseUrl`, `probandId`, `tlsFingerprintSha256`, optional `apiTokenName`, `lastSyncAt`.
- `VitronicSnapshot` (`vitronic_snapshots`): `summary` (numeric keys with units), `markers` / `measures` (viewer only), `presetName`, `fhirBundle` null, `glbSha256`, `viatarId`.
- Disk: `data/vitronic/<userId>/<sha256>.glb` (gitignored); in personal mode `<sha256>.glb.enc`, encrypted with the person's key (#141).

### What is encrypted

`apiTokenEnc` and `uploadSecretEnc`, with `VITRONIC_TOKEN_ENCRYPTION_KEY`.

### What is never logged

API tokens, upload secrets, Proband demographics (never requested), mesh vertices, measurement bodies. Sync failures log the error name only.
