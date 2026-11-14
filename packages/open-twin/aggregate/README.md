# @open-twin/aggregate

Takes bundles from several connectors for **one subject** and returns one bundle,
with overlaps reconciled. This is the layer that answers "Oura and Google Health
both reported last night's sleep — which number do we stand behind?"

Two rules hold it together, and both are about not destroying evidence:

1. **Every source Observation survives.** A reconciliation is an added assertion,
   not a replacement, so changing the selection policy later is a re-run over data
   already held — not a re-fetch from a vendor who may no longer serve the window.
2. **Where the evidence gives no basis to prefer a source, none is preferred.**
   The output then says several sources disagreed, and no more. That is the truth.

## What a reconciliation is

When more than one connector reports the same **measure** on the same **day**, the
aggregator consults `reliabilityFor` in `@open-twin/fhir-core` — graded validation
evidence per _(source, measure)_ pair, with citations — and either:

- emits a **derived Observation** carrying `derivedFrom` pointing at _every_ source
  it considered (not only the winner) and `method` stating the policy in prose, or
- **abstains**, recording why. The abstentions are the substance:
  - _energy expenditure_ abstains outright — published MAPE above 30% for every
    brand tested, so naming a winner would present a confidence nobody has earned;
  - _equally graded sources_ abstain rather than break a tie on array order;
  - _several same-day readings from the preferred source_ abstain because the
    reliability evidence ranks connectors, not readings within one connector;
  - _a single reporting source_ is not a disagreement, so nothing is asserted.

A selection nobody can audit is indistinguishable from a guess, which is why the
policy prose and the citation ride inside the bundle.

The integrator must verify that grouped measurements are comparable. The current
measure/day grouping does not establish matching units, measurement windows or
measurement equivalence. Source selection is experimental; see the
[intended-use guidance](../../docs/INTENDED-USE.md).

## Usage

```ts
import { aggregate } from '@open-twin/aggregate';

const { bundle, reconciliations } = aggregate({
  sources: [
    { bundle: ouraBundle }, // connector read from meta.tag when present
    { connector: 'google-health', bundle: googleBundle }
  ],
  subjectKey: 'user-42',
  timestamp: '2026-06-21T08:00:00Z' // supplied, so the result is reproducible
});

for (const r of reconciliations) {
  // { measure, day, sources, selected?, policy } — one line per overlap,
  // including the overlaps where nothing was selected and why.
}
```

## Preconditions: one subject and canonical source ids

Each connector mints its own `urn:uuid:` subject from its own key unless the
integrator supplies a common one (decision D1). Left alone, nothing would match and
the aggregator would report no overlap — a wrong answer that looks like a clean one.
So `aggregate` **throws** when its sources carry more than one subject reference:
supply the same `subject` to every connector for the same person before aggregating.

Every Observation participating in a derived result must also carry a lowercase
UUID `id`. Connector bundles built with `buildBundle` already satisfy this. A foreign
id-less bundle must be normalised first; aggregation refuses it rather than emitting
an unresolved `urn:uuid:undefined` provenance reference.

## Where the grades come from

`reliability.ts` in `@open-twin/fhir-core` records what the validation literature
says, per source and measure — not a preference order. That distinction does real
work: sleep _duration_ selects google-health over Oura, because Oura's `good` grade
is for sleep–wake _detection_ and it has no published total-sleep-time finding at
all. Extending the table is a citation, not an opinion.

## Verification

`src/verification/exampleBundle.ts` emits a two-source bundle — one reconciled
measure, one abstention — that runs through the HL7 validator in CI like every
other emitted bundle (`pnpm emit-bundles out/`).
