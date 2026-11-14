# @open-twin/fhir-core

The shared FHIR contract every connector in this repository builds on. Everything a
connector must **not** decide for itself is decided once, here: subject linkage,
resource ids, code-system URIs, units, categories, provenance and error hygiene.

The decisions themselves — and the defects that forced them — are recorded in
[`DECISIONS.md`](../../DECISIONS.md) at the repository root. Read that before adding
or changing a mapper. This README covers what the package exports and the rules the
exports enforce.

## Modules

| module              | what it settles                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `systems.ts`        | Canonical system URIs (`SYSTEMS.*`), profiles, categories. A code system URI you do not control is not a code system.                      |
| `units.ts`          | The UCUM table (`UCUM.*`, `LOINC_UNITS`). `Quantity.unit` carries **UCUM's own name** for `Quantity.code`, so the two halves cannot drift. |
| `identity.ts`       | One subject convention (D1), deterministic ids (D2), `minimalPatient` to answer a minted reference.                                        |
| `observation.ts`    | `createObservation`, and `numericComponent` — which **requires** a unit and falls back to `dataAbsentReason`.                              |
| `bundle.ts`         | `buildBundle`: lowercase `urn:uuid:` fullUrls, connector provenance tag, `collection` or `transaction` form.                               |
| `provenance.ts`     | `Device`, the `METHOD` vocabulary, `derivedObservation` for values computed from other Observations.                                       |
| `reliability.ts`    | Graded validation evidence per **(source, measure)** pair, with citations. Read by `@open-twin/aggregate`.                                 |
| `referenceRange.ts` | Anchor-layer intervals on the Observation, each carrying its source.                                                                       |
| `errors.ts`         | `ConnectorError` — status, operation and code. **Never a response body**: these are health payloads and errors end up in logs.             |

## Usage

The shape every connector follows (taken from a bundle this repository actually
emits and validates — see `@open-twin/aggregate`'s verification example):

```ts
import {
  buildBundle,
  createObservation,
  minimalPatient,
  quantity,
  SYSTEMS,
  subjectReference,
  UCUM
} from '@open-twin/fhir-core';

// D1: the caller may supply a subject. When it does not, mint a deterministic one
// and emit the matching Patient in the same bundle.
const subject = subjectReference({ connector: 'my-connector', subjectKey: userId });
const patient = minimalPatient({
  connector: 'my-connector',
  subjectKey: userId,
  identifierSystem: 'http://opentwin.ch/fhir/sid/open-twin'
});

const heartRate = createObservation({
  id: recordId, // D2: uuidv5(connector | vendor user id | vendor record id | measure)
  code: { system: SYSTEMS.LOINC, code: '8867-4' },
  subject,
  effectiveDateTime: '2026-06-20T07:00:00+02:00',
  valueQuantity: quantity(62, UCUM.PER_MINUTE)
});

const bundle = buildBundle({
  connector: { connector: 'my-connector', version: '0.1.0' },
  resources: [patient, heartRate],
  // Supplied by the caller, not read from the clock, so the bundle is reproducible.
  timestamp: '2026-06-20T08:00:00Z',
  bundleKey: `my-connector|${userId}|sync`
});
```

## The rules the helpers enforce

- **Missing data is not zero.** `numericComponent` requires a unit and emits
  `dataAbsentReason` when the value is absent, instead of a fabricated `0`.
- **Units name themselves.** `quantity()` takes a `UcumUnit` from the shared table,
  so a mapper cannot pair a code with somebody else's display name.
- **Ids are addresses.** Deterministic UUIDs make a re-sync an upsert instead of a
  duplicate, and make deletion implementable.
- **Errors carry no payload.** `ConnectorError` holds status, operation and code.
  If you find yourself interpolating a response body into a message, stop.

## Verification

This package is covered by the same gates as every other:
`pnpm verify` (terminology + UCUM allowlists, both fail closed) and the HL7
validator job in CI. See the repository README for the full verification story.
