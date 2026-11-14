# @open-twin/fhir-r4

Generic FHIR R4 ingest and conformance for open-twin.

Accepts external FHIR R4 bundles, reports selected structural and unit issues,
and normalises addressing and provenance. Its registered HL7 validator example
checks one normalisation output; it does not prove conformance for every input.
See [intended use](../../docs/INTENDED-USE.md) before handling participant data.

```ts
import { normaliseBundle, validateFhir } from '@open-twin/fhir-r4';

const report = validateFhir(payload);
if (!report.ok) return report.outcome; // a FHIR OperationOutcome

const { bundle, outcome } = normaliseBundle(payload, {
  connector: { connector: 'my-host', version: '1.4.0' },
  subjectKey: 'sending-system-patient-key',
  subject: { reference: 'Patient/12345' }, // omit for the D1 urn:uuid fallback
  timestamp: new Date().toISOString(),
  bundleKey: 'ingest-2026-07-26'
});
```

## What it does

### 1. Validation — `validateFhir(input, { units? })`

Accepts unknown input and reports selected structural errors as
`{ ok, issues, outcome }`, with a FHIR `OperationOutcome`. Integrators must bound
input size and depth and handle exceptions from malformed or excessive input.

| rule                                                                                                                  | what it catches                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ot-not-an-object`, `ot-missing-resource-type`, `ot-unknown-resource-type`                                            | it is not a resource, or claims a type R4 does not define                    |
| `ot-missing-required-element`                                                                                         | a top-level element the base R4 definition declares `min: 1`                 |
| `ot-invalid-id`                                                                                                       | `Resource.id` outside `[A-Za-z0-9\-\.]{1,64}`                                |
| `ot-invalid-bundle-type`                                                                                              | `Bundle.type` outside its required binding                                   |
| `ot-entry-not-an-object`, `ot-entry-empty`                                                                            | an entry that cannot be read; an entry with no resource, request or response |
| `ot-fullurl-missing`, `ot-fullurl-relative`                                                                           | an entry nothing can reference                                               |
| `ot-fullurl-uuid`, `ot-fullurl-oid`                                                                                   | a `urn:uuid:` that is not a lowercase RFC 4122 UUID; a malformed `urn:oid:`  |
| `ot-fullurl-id-mismatch`                                                                                              | a RESTful fullUrl addressing a different resource than it carries            |
| `bdl-7`, `bdl-8`                                                                                                      | duplicate fullUrl; version-specific fullUrl                                  |
| `obs-6`                                                                                                               | `dataAbsentReason` beside a `value[x]`                                       |
| `ot-choice-type`                                                                                                      | two spellings of `value[x]` at once                                          |
| `ot-component-data-absent-reason`                                                                                     | the same contradiction on a component (warning — see below)                  |
| `ot-reference-malformed`, `ot-reference-unresolved-urn`, `ot-reference-unresolved-contained`, `ot-reference-external` | reference resolution inside the bundle                                       |
| `ot-reference-conditional`                                                                                            | a `Type?query` search URI, which R4 permits in a transaction and only there  |
| `ot-quantity-no-code`, `ot-quantity-no-system`, `ot-ucum-invalid`                                                     | UCUM                                                                         |
| `ot-unit-policy`, `ot-unit-dimension`                                                                                 | decision D4, one unit per LOINC concept                                      |

The required-element table is generated from `hl7.fhir.r4.core#4.0.1` by
`tools/generate-spec-tables.mjs`, so it says what the specification says rather than
what somebody remembered. It is deliberately limited to top-level elements.

Every rule above is listed as a value in `FHIR_ISSUE_RULES`, and
`src/tests/rules.unit.test.ts` fails if any of them has no input in the suite that
produces it. A rule that has never fired and never will is not distinguishable from a
working one by reading the code.

### 2. Normalisation — `normaliseBundle(input, options)`

Four things change, and nothing else:

- **D1** every `subject` is repointed at one integrator-supplied reference. Without one,
  the deterministic `urn:uuid:` fallback applies and a minimal Patient is added so the
  bundle still resolves internally.
- **D2** every resource gets a deterministic UUID id from `deterministicId`, every
  entry a matching `urn:uuid:` fullUrl, and every intra-bundle reference is repointed
  to match. Re-normalising the same input is byte-identical.
- **D3** every resource carries the connector provenance tag, merged into whatever
  `meta` the sender supplied rather than replacing it.
- `text` narrative is removed. See the assumptions below.

No value, no code, no unit and no timestamp is touched. A body height that arrives as
66.899999999999991 `[in_i]` leaves as 66.899999999999991 `[in_i]` with an
`ot-unit-policy` issue attached — the normaliser reports the disagreement and refuses
to resolve it, because a normaliser that quietly corrects a unit is indistinguishable,
downstream, from one that quietly corrupts one.

Normalisation refuses outright — returning `bundle: undefined` — on anything it
cannot repair without guessing: `obs-6`, a missing required element, an unknown
resource type, a duplicate fullUrl, an invalid UCUM code, a `urn:uuid:` reference
that resolves to nothing, or `ot-reference-ambiguous` (an unbased relative reference
that matches resources on more than one server). The addressing defects it exists to
repair (`ot-fullurl-*`, `bdl-8`) do not stop it, and neither do the unit findings,
which are carried through to the integrator attached to a bundle that still states them.

An integrator may explicitly set `unresolvedUrnPolicy: 'preserve'` for a deliberately
trimmed collection Bundle whose omitted targets are known. The unresolved reference is
left byte-for-byte unchanged and `ot-reference-unresolved-urn` remains in `issues` and
the `OperationOutcome`; preservation never means the target resolved. The default is
`reject`.

### 3. UCUM and unit checking

Every `Quantity` under `http://unitsofmeasure.org` is parsed against the real UCUM
grammar with `@lhncbc/ucum-lhc`. Where `Observation.code` carries a LOINC code that
`LOINC_UNITS` covers, the unit is compared with the one decision D4 binds that code
to, and a disagreement is separated into two kinds:

- **`ot-unit-policy`** — commensurable, so the value is on the wrong scale. Sleep
  duration in `s` under LOINC 93832-4 is a factor of sixty in a number that looks
  entirely reasonable either way. This is the class of defect that shipped.
- **`ot-unit-dimension`** — not commensurable, so it is a mapping error.

This is the runtime counterpart to `verify/check-units.mjs`. That gate reads
open-twin's own source and can only see unit codes written as string literals; it
cannot see a unit that arrived in somebody else's bundle. Under the flags CI uses
(`-tx n/a`), neither can the HL7 validator — see below.

## What it does NOT do

- **StructureDefinition-driven profile validation.** That is the HL7 validator's job.
  A bad reimplementation would be worse than none, because it would be believed.
- **Terminology server lookups.** Nothing here checks that a LOINC or SNOMED code
  exists, that a display matches, or that a code is in a value set. `LOINC_UNITS` is
  a unit policy, not a terminology service.
- **FHIR search**, or anything else server-shaped. The package is a pure function
  library, per D8.
- **Nested cardinality, slicing, or invariants beyond `obs-6`, `bdl-7` and `bdl-8`.**
  The three implemented are the ones open-twin has actually broken.
- **Repairing anything other than addressing.** It will not change a unit, a code, a
  value, a status or a time to make a bundle pass.
- **R5, STU3 or DSTU2.** R4 only.

## Agreement with the HL7 validator

The oracle for this package is the HL7 reference validator, not its own opinion of
itself. `tools/hl7-oracle.ts` runs the real validator over every fixture and records
the result in `src/tests/oracle/oracle-verdicts.json`; `src/tests/oracle.unit.test.ts`
asserts the comparison. Of the sixteen fixtures, ten the validator errors on and this
package errors on too. Six it passes and this package does not, and all six are worth
stating plainly. The recording keeps errors only, since that is what the comparison
turns on; the warning-level quotes below come from a second run of the same fixtures
with `-level` left at its default:

| fixture                                    | what the validator says                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ucum-bare-steps`                          | `Warning - Unable to validate code 'steps' in system 'http://unitsofmeasure.org' because the validator is running without terminology services`. Under `-tx n/a` it **cannot check UCUM at all**. |
| `unit-policy-height-in-inches`             | No error. `[in_i]` is in the required binding of the HL7 `bodyheight` profile — see below.                                                                                                        |
| `unit-policy-seconds-under-a-minutes-code` | No error. `s` is valid UCUM and no R4 profile fixes a unit for LOINC 93832-4.                                                                                                                     |
| `unit-dimension-mismatch`                  | No error, for the same reason.                                                                                                                                                                    |
| `quantity-without-a-system`                | No error. `Quantity.system` is 0..1 in R4.                                                                                                                                                        |
| `dangling-urn-reference`                   | `Warning - URN reference is not locally contained within the bundle` — below the error level CI gates on.                                                                                         |

They are not one thing, and lumping them together would hide the only one that
matters:

- **Three are open-twin policy against conformant FHIR** — the two `ot-unit-policy`
  rows and `ot-unit-dimension`. The validator is right that the resources are valid
  R4. These are errors here, and they carry `code: 'business-rule'` in the
  OperationOutcome, so a consumer who wants a pure FHIR conformance report can filter
  them out by code.
- **Two are warnings** — `quantity-without-a-system` and `dangling-urn-reference` —
  so they never make `ok` false. The second matches the validator's own severity
  exactly; it blocks `normaliseBundle` rather than the conformance report, because
  normalisation rewrites every reference and cannot rewrite one that points nowhere.
- **One is not a disagreement at all.** `steps` is not a UCUM code and
  `ucum-bare-steps` is genuinely invalid. The validator was simply not in a position
  to check.

The inches row deserves one more sentence, because the run does not prove what it
looks like it proves. The validator also said
`Warning - Unable to validate code '[in_i]' ... because the validator is running
without terminology services` on that fixture, so its silence is not a verdict on the
unit either. The claim that `[in_i]` is conformant there rests on reading the profile,
not on the run: `bodyheight` binds `Observation.value[x].code` with strength
`required` to `http://hl7.org/fhir/ValueSet/ucum-bodylength|4.0.1`, and that value set
enumerates exactly `cm` and `[in_i]`. Both were checked against
`hl7.org/fhir/R4/bodyheight.profile.json` and
`hl7.org/fhir/R4/valueset-ucum-bodylength.json`.

Where the two ever disagree about FHIR itself, the validator wins, and the oracle
test is what makes that discoverable rather than a matter of opinion.

Two consequences follow from the first row and they should not be lost:

1. "It passed the HL7 validator" says nothing whatsoever about the units in a bundle
   unless a terminology server was attached. The static gate cannot see foreign data
   and the validator was not asked. That gap is the reason this package checks units
   at runtime.
2. `ot-component-data-absent-reason` is a **warning**, not `obs-6`. R4 states obs-6 on
   `Observation` only and declares no equivalent constraint on
   `Observation.component` — checked in `hl7.org/fhir/R4/observation.profile.json`,
   whose only constraints on `Observation.component` are `ele-1` and `ext-1`. So the
   validator does not flag it, and reporting it as obs-6 would be inventing a rule and
   attributing it to HL7. The contradiction is real, so it is not silent either.

### The bundle registered for CI

`fhirR4IngestBundle()` is registered in `verify/bundles.manifest.ts` as
`fhir-r4-ingest`. It is `HL7_VITALS_BUNDLE` put through `normaliseBundle` with no
integrator-supplied subject, so D1's fallback applies. The input is hostile in the way
real input is: every subject is `Patient/example`, no Patient is in the bundle at all,
and all three entries declare `meta.profile: vitalsigns`, so the validator enforces
the vital-signs profiles on the output.

```
node verify/build-conformance.mjs && pnpm -r build && npx tsx verify/emit-bundles.ts /tmp/fr4-out
java -jar validator_cli.jar /tmp/fr4-out/*.json -version 4.0.1 \
  -ig verify/conformance/generated -tx n/a -best-practice ignore \
  -jurisdiction uv -output-style compact -level errors
```

Last run: `fhir-r4-ingest.json` → `Information - All OK`. Zero errors.

Run without `-level errors` it also reports six warnings, and every one of them is
the same abstention rather than a finding. Five read `Unable to validate code '/min'
| '%' | 'cm' in system 'http://unitsofmeasure.org' because the validator is running
without terminology services`; the sixth reads `Unable to validate code without using
server because: Resolved system http://unitsofmeasure.org (v3.0.1), but the
definition doesn't include any codes`. Six warnings, six units the validator did not
check — which is the reason this package parses UCUM itself rather than trusting a
green validator run. The `meta.tag` lines are `Information`, because
`verify/conformance/generated/CodeSystem-connector.json` declares the code system
without enumerating its codes.

## Privacy and integration

Messages are fixed strings, but FHIRPath locations are built from input object
keys, so a report can echo a key from the input. Integrators must protect reports
as potentially sensitive; use synthetic examples in public issues and restrict
log access and retention.

The integrator must supply a bundle for one verified source patient and establish
its relationship to the destination subject before normalisation. Apply input
size/depth limits at the application boundary. These functions are not a full
FHIR profile validator or an anonymisation service. See the
[intended-use guidance](../../docs/INTENDED-USE.md).

The recorded oracle file does quote the fixtures. Those are synthetic bundles written
for this repository, plus HL7's published examples.

## The samples

Three sample inputs, all fetched from `hl7.org/fhir/R4/` and embedded verbatim:

- `HL7_VITALS_BUNDLE` — `observation-example-heart-rate`,
  `observation-example-satO2` and `observation-example-body-length`, in a collection
  Bundle this package wraps around them. Normalised, this is the bundle registered in
  `verify/bundles.manifest.ts`.
- `HL7_BODY_HEIGHT_BUNDLE` — `observation-example-body-height`: `[in_i]` at the value
  HL7 published, which HL7 spells `66.899999999999991` and the TypeScript source
  spells `66.89999999999999`. Those are the same IEEE 754 double, and neither is
  `66.9`.
- `HL7_LIPIDS_BUNDLE` — `diagnosticreport-example-lipids`, which is already a Bundle
  and is used unwrapped. A DiagnosticReport with four Observations, RESTful fullUrls,
  a `Patient/pat2` that is not in the bundle, an Organization that is not either, and
  a narrative naming the patient and their medical record number in free text.

`HL7_LIPIDS_BUNDLE` is deliberately _not_ registered for the validator: its
`Identifier.system` is `http://acme.com/lab/reports`, which the validator rejects with
`Example URLs are not allowed in this context`. Normalisation does not repair that,
because rewriting an identifier system to please a validator is the silent corruption
this package exists to refuse. The verdict is recorded under `normalised-hl7-lipids`
so the reason stays on the record.

## Assumptions that could not be verified

1. **The HL7 examples are redistributable.** They are fetched from the FHIR R4
   specification, which HL7 publishes under CC0, and they are embedded here as source.
   Nobody with a licensing remit has confirmed that reading applies to the example
   instances specifically.
2. **Dropping the narrative is the right default.** `text` renders the resource as it
   was before its id, fullUrl and subject changed, and it routinely names the original
   subject in free text — the lipids example names a patient and an MRN. Keeping it
   would leave a bundle whose human-readable rendering contradicts its structured
   data; dropping it removes content the sender authored. The choice is unconditional
   and reported as `ot-normalised-narrative-dropped`; nobody with a clinical or
   records-management remit has reviewed it.
3. **A Patient with nothing but an id is acceptable.** D1's fallback needs something in
   the bundle carrying the `urn:uuid:` every subject points at. The synthesised Patient
   asserts no demographics because the connector knows none. Whether a receiver finds
   that useful or merely confusing is untested against a real server.
4. **`meta.versionId` and `meta.lastUpdated` are carried through unchanged** even
   though the resource id has been reassigned. They are true statements about the
   sending system's record. A receiver treating `versionId` as belonging to the new id
   would be misled, and nobody has checked whether any receiver does.
5. **Only the first LOINC coding the policy covers is checked.** An Observation
   carrying two LOINC codes that `LOINC_UNITS` binds to _different_ units is not
   reported as a conflict. No such pair exists in `LOINC_UNITS` today; if one is added,
   this becomes wrong quietly.
6. **The required-element table is R4 base only**, and nothing in CI checks that the
   checked-in file still matches the package it came from. It was regenerated by hand
   against `hl7.fhir.r4.core#4.0.1` while this package was finished and came back
   byte-identical — 146 resource types, 113 required-element rows — so it is correct
   today and unguarded tomorrow.
7. **`ot-reference-external` is information, not a warning.** A relative reference that
   does not resolve inside the bundle is assumed to be resolvable by the receiver. That
   is true for a `collection` bundle sent to a server that already holds the patient,
   and false for one archived to a file. The package cannot tell which is happening.
8. **`Reference.reference` is found structurally**, by walking for objects with a
   string `reference` element and no `resourceType`. No FHIRPath engine is involved,
   and no StructureDefinition says which elements are References. A non-FHIR object
   that happens to have a `reference` string would be treated as one.
9. **The recorded oracle can go stale.** It is a snapshot of one validator build on one
   day. Nothing detects that a newer validator would say something different until
   somebody re-runs it, and the test that compares against it would then pass on an
   out-of-date answer.
10. **`urn:` references are only checked against `entry.fullUrl`.** A `urn:oid:` or
    `urn:ietf:rfc:3986` reference that a receiver could resolve by other means is
    reported as unresolved. No case of this has been seen in real input.

## Development

```
pnpm --filter @open-twin/fhir-r4 test
pnpm --filter @open-twin/fhir-r4 build

# regenerate the R4 spec tables (needs the FHIR package cache)
node packages/fhir-r4/tools/generate-spec-tables.mjs

# re-record the HL7 validator oracle, then format: the tool writes plain
# JSON.stringify output and biome formats JSON, so `biome ci` fails on whitespace
# alone until `pnpm format` has run.
node verify/build-conformance.mjs
OT_HL7_VALIDATOR_JAR=/path/to/validator_cli.jar pnpm --filter @open-twin/fhir-r4 oracle
pnpm format
```
