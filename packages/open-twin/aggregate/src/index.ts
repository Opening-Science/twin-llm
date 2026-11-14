/**
 * WHAT: Package public barrel: re-exports the supported API surface.
 * NOT:  Must not contain mapping or clinical logic; implementation lives in sibling modules.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
export type { AggregateOptions, AggregateResult, Reconciliation, SourceBundle } from './aggregate';
export { AGGREGATOR, aggregate } from './aggregate';
export { effectiveDay, type Measure, measureOf, occasionKey } from './measure';
export { type Candidate, type Selection, selectSource } from './select';
