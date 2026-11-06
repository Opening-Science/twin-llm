import { aggregate, type AggregateResult } from "@open-twin/aggregate";
import type { Bundle } from "fhir/r4";

/**
 * One subject's Oura and WHOOP bundles as one bundle, overlaps reconciled by
 * `@open-twin/aggregate`: every source Observation is kept, and a derived one
 * is added only where published evidence prefers a source.
 *
 * Nothing on screen reads this yet. The app combines Oura and WHOOP only as
 * summary keys (`latestVitals`, first source in a fixed order), and the stored
 * bundles are never read back. Each connector also mints its own subject from
 * the same key, so today's bundles are refused until both are built with one
 * shared `subject` (aggregate's precondition).
 */
export const aggregateWearableBundles = (
  input: Readonly<{
    oura: Bundle | null;
    whoop: Bundle | null;
    subjectKey: string;
    timestamp: string;
  }>,
): AggregateResult =>
  aggregate({
    sources: [
      ...(input.oura ? [{ connector: "oura", bundle: input.oura }] : []),
      ...(input.whoop ? [{ connector: "whoop", bundle: input.whoop }] : []),
    ],
    subjectKey: input.subjectKey,
    timestamp: input.timestamp,
  });
