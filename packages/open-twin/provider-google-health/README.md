# Open Twin Google Health Provider

Maps the **Google Health API v4** (`health.googleapis.com/v4`) into HL7 FHIR R4 bundles.

## Read this before you integrate

**This package does not talk to Health Connect.** Three different things share
confusingly similar names, and only one of them is what this code calls:

|                          | What it is                                                                                    | Reachable from Node.js? |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------- |
| **Health Connect**       | An on-device Android API (`androidx.health.connect`). No cloud REST surface.                  | **No**                  |
| **Google Fit REST API**  | `www.googleapis.com/fitness/v1`. Sign-ups closed 1 May 2024; supported until the end of 2026. | Yes, but not used here  |
| **Google Health API v4** | `health.googleapis.com/v4`. **This is what this package calls.**                              | Yes                     |

Google describes the Google Health API as **the next generation of the Fitbit Web
API**, covering data from Fitbit, Pixel Watch and third-party devices and apps. Its own
error catalogue makes the lineage explicit:

> `ACCOUNT_NOT_LINKED` · 400 · The Google account is not linked to a Fitbit account.

Four consequences that should inform a product decision _before_ you integrate:

1. **A user with only on-device Health Connect data and no linked Fitbit account gets
   nothing from this connector.** The data source is the Fitbit/Google-account cloud
   graph, not the phone.
2. **The Fitbit Web API this succeeds is turned down in September 2026, and there is no
   OAuth token transfer.** Existing Fitbit Web API tokens do not carry over; every user
   has to re-authorise against the Google Health API.
3. **Part of the surface is behind a private preview.** The error catalogue includes
   `API_PRIVATE_PREVIEW_ACCESS_DENIED` (403). Confirm your project's entitlement before
   investing in an integration.
4. **There is no sandbox or synthetic-data environment.** Every test against this API is
   a mock; the package's own suite is built from recorded response shapes.

The package directory keeps its name for continuity with published releases. The name is
about the Google Health API, not about Health Connect.

## What it does

- **Token exchange** — fetches an `access_token` from an initial authorisation code.
- **Data retrieval** — lists data points per type, **following `nextPageToken`** so a
  window wider than one page is not silently truncated.
- **FHIR R4 mapping** — 36 mappers across the four record categories (daily, sample,
  interval, session), emitting a `collection` (or `transaction`) Bundle.

Terminology, units, identifiers, subject linkage and the error taxonomy all come from
`@open-twin/fhir-core`. See `DECISIONS.md` at the repository root for the ten
cross-connector decisions this package implements, and why.

> **Note:** this package does not handle the initial OAuth2 consent screen. That must be
> managed by your client application.

## Installation

```
npm install @open-twin/provider-google-health
```

## Usage

```ts
import {
  GoogleHealthClient,
  getGoogleHealthAuthUrl,
  initializeGoogleHealthClient,
  getDataTypes,
  getFhirBundleFromGoogleHealthData
} from '@open-twin/provider-google-health';

const client = new GoogleHealthClient({
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  redirectUri: 'YOUR_REDIRECT_URI'
});

// 1. Send the user to the authorisation URL.
const url = getGoogleHealthAuthUrl(client);

// 2. Exchange the returned code for tokens. Persist them yourself — this package
//    keeps them in memory only.
const credentials = await initializeGoogleHealthClient(client, code);

// 3. Raw data, plus an OperationOutcome describing any type that failed.
const { responses, issues } = await getDataTypes({
  client,
  types: ['heart-rate', 'steps', 'sleep'],
  start_date: '2026-07-01T00:00:00Z',
  end_date: '2026-07-08T00:00:00Z',
  timeZone: 'Europe/Zurich'
});

// 4. A FHIR R4 bundle.
const {
  bundle,
  issues: bundleIssues,
  unmapped
} = await getFhirBundleFromGoogleHealthData({
  client,
  types: ['heart-rate', 'steps', 'sleep'],
  start_date: '2026-07-01T00:00:00Z',
  end_date: '2026-07-08T00:00:00Z',
  timeZone: 'Europe/Zurich',
  // The vendor's own user id. Never an email address or any other PII: it seeds the
  // deterministic resource ids and the urn:uuid subject reference.
  subjectKey: healthUserId,
  // Optional. Supply it when you know who the patient is and no Patient is invented.
  subject: { reference: 'Patient/123' }
});
```

### `timeZone`

Civil-date filters (daily summaries, and session types other than sleep and ECG) are
derived from the subject's local date, never from a UTC instant. Pass the wearer's IANA
zone; it defaults to `UTC`. Without it, a wearer at UTC+13 loses the current local day
from every daily query.

### Partial failure

`getDataTypes` and `getFhirBundleFromGoogleHealthData` do not throw when one data type
fails — they return the types that succeeded plus an `OperationOutcome` in `issues`, so
"rate-limited" is distinguishable from "no data in this window". They do throw for
problems that make the whole call meaningless: an unauthenticated client, an invalid
date, or an unknown time zone. No thrown error ever carries a response body.

### `unmapped`

A non-empty `unmapped` array means a data type this package _declares_ it can request
arrived and was dropped — a defect in this package, reported rather than swallowed. Keys
belonging to data types the package never declares are ignored silently.

## Known gaps

- `total-calories` and `calories-in-heart-rate-zone` are **not** supported. They are not
  `DataPoint` members: they exist only on the rollup endpoints (`dataPoints:rollUp` /
  `dataPoints:dailyRollUp`) and need a separate code path.
- `food` and `foodMeasurementUnit` are real `DataPoint` members with no mapper yet.
- Several measures carry codes from this project's own code system rather than LOINC or
  SNOMED, marked in the source with `TODO(clinical-review):`. They cover heart-rate
  variability, skin-temperature derivations, session mean heart rate and the ECG. Each
  names what needs sign-off. A local code is recoverable; a wrong standard code silently
  corrupts a clinical exchange.

## Disclaimer

This project is an independent, community-driven and unofficial integration for Google
Health services. It is not affiliated with, endorsed by, sponsored by or otherwise
associated with Fitbit LLC, Google LLC or Alphabet Inc.

## Trademarks

- "Fitbit" and "Google" are trademarks of Google LLC.
- All product names, logos and brands are the property of their respective owners.
- The use of these names, trademarks and brands does not imply endorsement, sponsorship
  or affiliation.

## License

MIT
