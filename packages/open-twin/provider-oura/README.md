# Open Twin Oura Provider

A provider for connecting Oura devices and APIs to the Open Twin ecosystem. This package retrieves user and device data from Oura and transforms it into an open, standardized format for interoperable processing and further analysis.

## Features

- **Token Exchange:** Fetches the `access_token` using an initial user authorization code.
- **Token Refresh:** Automatically refreshes the `access_token` using a `refresh_token`.
- **Data Retrieval:** Fetches granular Oura health and device data for a specific user.
- **FHIR Standardization:** Converts raw Oura data formats into the HL7 FHIR standard for medical/health interoperability.

> **Note:** This package does not handle the initial OAuth2 user authentication where permissions are explicitly granted in the providers website. That must be managed by your client application.

---

## Installation

Install the package via npm:

```bash
npm install @open-twin/provider-oura
```

### Setup & Prerequisites

1. Head over to the [Oura Developer Portal](https://developer.ouraring.com/applications) and create a new application.
2. Once registered, Oura will provide you with a `CLIENT_ID` and a `CLIENT_SECRET` (and `CLIENT_URI`).

---

## Usage

⚠️ Important: This package only maintains the access and refresh tokens in memory at runtime. You must capture the generated tokens and store them in a secure, persistent location.

### `getAuthorizationUrl(config, state?)`

Builds the Oura authorize URL. Pass an optional OAuth `state` for CSRF protection; it is included only when non-empty.

```ts
import { getAuthorizationUrl, type OuraRingAppConfig } from '@open-twin/provider-oura';

const config: OuraRingAppConfig = {
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  redirectUri: 'YOUR_REDIRECT_URI'
};

const authorizeUrl = getAuthorizationUrl(config, 'optional-csrf-state');
// redirect the user to authorizeUrl, then pass the returned code to TokenHandler
```

### `TokenHandler(config, authorizationToken)`

A helper class which handles the runtime storage and automatic refreshing of the tokens

#### Parameters

- **`config`** (`OuraRingAppConfig`): The interface which holds the Oura application details

```ts
interface OuraRingAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: SupportedScope[];
}
```

- **`authorizationToken`** (`string`): The code that has been returned after the user's initial authorization process

#### Example

```ts
const ouraRingAppConfig: OuraRingAppConfig = {
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  redirectUri: 'YOUR_REDIRECT_URI'
};

const authorizationToken = 'USER_AUTH_TOKEN';

const tokenHandler = new TokenHandler(ouraRingAppConfig, options.auth_code);

// Initial token exchange
await tokenHandler.authenticate();

// Persist the pair and its absolute expiry yourself (D8) — in memory only.
const stored = tokenHandler.getTokens();

// Restore on a later process: skip authenticate; pass both so expiry is not recomputed.
// tokenHandler.setTokens(stored.tokens, stored.expiresAt)
// Passing only tokens treats expires_in as seconds from now; use it for fresh tokens, not restores.

// Returns the access token. If token is expired, refreshes and returns it.
await tokenHandler.getAccessToken();

// After a refresh, getTokens() returns the rotated pair and new expiresAt for re-persist.
```

---

### `getOuraData(request, tokenHandler, options?)`

Retrieves the Oura data types named in the request, parsed against the schema for
the type that was **requested** — not guessed from the response shape.

#### Parameters

- **`request`** (`RequestParams`): validated before any network call. `start_date`
  and `end_date` are `YYYY-MM-DD`.

```ts
interface RequestParams {
  types: SupportedScope[];
  start_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
  next_token?: string | null;
  fields?: string[];
  latest?: boolean | null; // heartrate only; ignored elsewhere
}
```

- **`tokenHandler`** (`TokenHandler`)
- **`options`** (`OuraRequestOptions`, optional): `sandbox`, `subject`,
  `subjectKey`, `timestamp`, `maxAttempts`, `sleep`.

#### Return value

```ts
interface OuraDataResult {
  data: OuraTypedData[]; // successes, tagged with their type, in request order
  issues?: OperationOutcome; // types that failed or came back empty
}
```

A type that fails does not discard its siblings: it appears in `issues` as an
`OperationOutcome.issue`. A type that returns no data appears there too, as
`severity: information`, so "requested and empty" is distinguishable from "never
requested".

#### Example

```ts
import { getOuraData } from '@open-twin/provider-oura';

const { data, issues } = await getOuraData(
  { types: ['heartrate', 'sleep', 'workout'], start_date: '2026-07-01', end_date: '2026-07-02' },
  tokenHandler
);

for (const item of data) {
  if (item.type === 'sleep') console.log(item.data.data.length, 'sleep records');
}
if (issues) console.warn(JSON.stringify(issues, null, 2));
```

---

### `getFhirBundleFromOuraData(request, tokenHandler, options?)`

As above, and maps the result into one flat FHIR `collection` Bundle.

#### Subject

The connector does not know who the wearer is, so it will not guess. Supply one of:

- `options.subject` — a `Reference` you control, used verbatim;
- `options.subjectKey` — Oura's user id or another stable key, from which a
  deterministic `urn:uuid:` subject and a matching `Patient` are derived;
- `personal_info` in `request.types` — the subject key is then Oura's own user id.

With none of the three the call rejects rather than emitting `Patient/example`.

#### Return value

```ts
interface OuraBundleResult {
  bundle: Bundle;
  issues?: OperationOutcome;
}
```

Every entry carries a `urn:uuid:` `fullUrl` matching its resource id, and both are
deterministic: re-syncing the same window produces the same ids rather than
duplicates.

#### Example

```ts
import { getFhirBundleFromOuraData } from '@open-twin/provider-oura';

const { bundle, issues } = await getFhirBundleFromOuraData(
  { types: ['personal_info', 'sleep', 'heartrate'], start_date: '2026-07-01', end_date: '2026-07-02' },
  tokenHandler
);
```

---

### `getSandboxOuraData(request, tokenHandler, options?)`

As `getOuraData`, against Oura's sandbox. Note the sandbox has no `personal_info`
route, so requesting that type yields a `not-found` issue rather than data.

---

## Oura to FHIR mappings

Units follow `LOINC_UNITS` in `@open-twin/fhir-core`, so the same concept carries
the same unit in every connector. **Oura reports durations in seconds; they are
converted to minutes**, not relabelled.

Codes marked _Oura_ are `http://opentwin.ch/fhir/CodeSystem/oura`. Each exists
because no standard concept was found for the measure, and each is marked
`TODO(clinical-review)` in the source.

### Sleep

| Oura field                      | FHIR                                   | Code                                     | Unit      |
| :------------------------------ | :------------------------------------- | :--------------------------------------- | :-------- |
| `id`                            | `Observation.identifier`               |                                          |           |
| `bedtime_start` / `bedtime_end` | `Observation.effectivePeriod`          |                                          |           |
| `score`                         | `Observation.valueQuantity`            | Oura `sleep-score`                       | `{score}` |
| `type`                          | `Observation.code.text`                |                                          |           |
| `total_sleep_duration`          | component                              | 93832-4                                  | `min`     |
| `rem_sleep_duration`            | component                              | 93829-0                                  | `min`     |
| `deep_sleep_duration`           | component                              | 93831-6                                  | `min`     |
| `light_sleep_duration`          | component                              | 93830-8                                  | `min`     |
| `latency`                       | component                              | 103212-7                                 | `min`     |
| `time_in_bed`                   | component                              | 103213-5                                 | `min`     |
| `awake_time`                    | component                              | Oura `awake-time`                        | `min`     |
| `efficiency`                    | component                              | Oura `sleep-efficiency-percentage`       | `%`       |
| `lowest_heart_rate`             | component                              | 103222-6                                 | `/min`    |
| `average_heart_rate`            | component                              | 8867-4 + Oura `sleep-average-heart-rate` | `/min`    |
| `average_breath`                | component                              | 9279-1 + Oura `sleep-average-breath`     | `/min`    |
| `average_hrv`                   | component                              | Oura `sleep-average-hrv`                 | `ms`      |
| `restless_periods`              | component                              | Oura `restless-periods`                  | `{count}` |
| `temperature_deviation`         | component                              | Oura `temperature-deviation`             | `K`       |
| `sleep_algorithm_version`       | `Observation.method`                   |                                          |           |
| `sleep_analysis_reason`         | `Observation.note`                     |                                          |           |
| `ring_id`, `day`, phase strings | `Observation.extension` (one url each) |                                          |           |

### Daily activity

| Oura field        | FHIR                            | Code                   | Unit                   |
| :---------------- | :------------------------------ | :--------------------- | :--------------------- |
| `score`           | `Observation.valueQuantity`     | Oura `activity-score`  | `{score}`              |
| `timestamp`       | `Observation.effectiveDateTime` |                        | local offset preserved |
| `steps`           | component                       | 41950-7                | `{steps}/d`            |
| `total_calories`  | component                       | 41979-6                | `kcal/(24.h)`          |
| `active_calories` | component                       | Oura `active-calories` | `kcal`                 |
| `*_met_minutes`   | component                       | Oura                   | `{MET-min}`            |
| `*_time`          | component                       | Oura                   | `min`                  |
| contributors      | component                       | Oura                   | `{score}`              |

### Personal

| Oura field       | FHIR                                         | Code                  | Unit                         |
| :--------------- | :------------------------------------------- | :-------------------- | :--------------------------- |
| `id`             | `Patient.id` (uuid) and `Patient.identifier` |                       |                              |
| `biological_sex` | `Patient.gender`                             | administrative-gender |                              |
| `age`            | `Patient.extension` (`oura-personal-age`)    |                       |                              |
| `weight`         | Observation `valueQuantity`                  | 29463-7               | `kg`                         |
| `height`         | Observation `valueQuantity`                  | 8302-2                | `cm` (converted from metres) |
| `email`          | **not emitted**                              |                       |                              |

### Workout

| Oura field                            | FHIR                                   | Code                    | Unit   |
| :------------------------------------ | :------------------------------------- | :---------------------- | :----- |
| `activity`                            | `Observation.code.text`                |                         |        |
| `calories`                            | component                              | 41981-2                 | `kcal` |
| `distance`                            | component                              | Oura `workout-distance` | `m`    |
| `source`, `intensity`, `day`, `label` | `Observation.extension` (one url each) |                         |        |

### Other types

`daily_readiness`, `daily_stress`, `daily_resilience`, `daily_spo2`,
`daily_cardiovascular_age`, `vO2_max`, `session`, `rest_mode_period` and
`ring_configuration` follow the same conventions. Two are worth calling out:

- `vO2_max` uses **94122-9** (weight-indexed VO2, `mL/kg/min`), matching
  `provider-google-health`.
- `ring_configuration` emits a `Device` resource as well as the Observation, and
  the Observation's `device` reference resolves to it by `fullUrl`.

## Disclaimer

This project is an independent and unofficial integration for Oura services and devices. It is not affiliated with, endorsed by, sponsored by, or otherwise associated with Oura LLC or Oura Health Oy.

“Oura” is a trademark of Oura Health Oy. All product names, logos, and brands are property of their respective owners.

## Trademarks

“Oura” is a trademark of Oura Health Oy.

Use of these names does not imply endorsement or affiliation.

## License

MIT
