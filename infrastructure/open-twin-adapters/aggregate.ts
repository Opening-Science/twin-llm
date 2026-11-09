import { aggregate, type AggregateResult } from "@open-twin/aggregate";
import type { Bundle } from "fhir/r4";

import { mergePersonPatients } from "./person-subject";

/**
 * One person's Oura, WHOOP and Google Health bundles as one bundle, overlaps
 * reconciled by `@open-twin/aggregate`: every source Observation is kept, and
 * a derived one is added only where published evidence prefers a source
 * (`reliabilityFor` in fhir-core), never on the order of the sources. Aggregate
 * refuses Observations under more than one subject; every builder names the
 * person's shared subject (person-subject.ts), and the person's Patient is
 * carried once, with each connector's identifier.
 *
 * Nothing on screen reads this yet. The screens combine the sources only as
 * summary keys, by the fixed order in `VITAL_ANATOMY` (Oura, then WHOOP, then
 * Google Health; the first source with data wins and sources are never mixed).
 * Aggregate takes no caller order, and at the pinned open-twin it finds no
 * overlap between these connectors: sleep duration, steps and Oura's heart
 * rates sit in Observation components, which it does not read.
 */
export const aggregateWearableBundles = (
  input: Readonly<{
    oura: Bundle | null;
    whoop: Bundle | null;
    googleHealth?: Bundle | null;
    subjectKey: string;
    timestamp: string;
  }>,
): AggregateResult => {
  const sources = [
    ...(input.oura ? [{ connector: "oura", bundle: input.oura }] : []),
    ...(input.whoop ? [{ connector: "whoop", bundle: input.whoop }] : []),
    ...(input.googleHealth
      ? [{ connector: "google-health", bundle: input.googleHealth }]
      : []),
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
