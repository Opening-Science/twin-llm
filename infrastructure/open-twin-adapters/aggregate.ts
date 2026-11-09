import { aggregate, type AggregateResult } from "@open-twin/aggregate";
import type { Bundle } from "fhir/r4";

import { mergePersonPatients } from "./person-subject";

/**
 * One person's Oura and WHOOP bundles as one bundle, overlaps reconciled by
 * `@open-twin/aggregate`: every source Observation is kept, and a derived one
 * is added only where published evidence prefers a source. Aggregate refuses
 * Observations under more than one subject; both builders name the person's
 * shared subject (person-subject.ts), and the person's Patient is carried once,
 * with each connector's identifier.
 *
 * Nothing on screen reads this yet. The app combines Oura and WHOOP only as
 * summary keys (`latestVitals`, first source in a fixed order). The stored
 * bundles are read back only by the wearables detail route, one source at a
 * time.
 */
export const aggregateWearableBundles = (
  input: Readonly<{
    oura: Bundle | null;
    whoop: Bundle | null;
    subjectKey: string;
    timestamp: string;
  }>,
): AggregateResult => {
  const sources = [
    ...(input.oura ? [{ connector: "oura", bundle: input.oura }] : []),
    ...(input.whoop ? [{ connector: "whoop", bundle: input.whoop }] : []),
  ];
  const bundles = mergePersonPatients(sources.map((source) => source.bundle));
  return aggregate({
    sources: sources.map((source, index) => ({
      connector: source.connector,
      bundle: bundles[index] ?? source.bundle,
    })),
    subjectKey: input.subjectKey,
    timestamp: input.timestamp,
  });
};
