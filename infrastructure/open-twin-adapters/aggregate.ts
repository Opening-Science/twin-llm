import { aggregate, type AggregateResult, selectSource } from "@open-twin/aggregate";
import { reliabilityFor } from "@open-twin/fhir-core";
import type { Bundle } from "fhir/r4";

import type { WearableSourceId } from "@/infrastructure/wearable-provenance";
import type {
  EvidenceGrade,
  EvidenceJudge,
  EvidenceVerdict,
} from "@/infrastructure/wearable-source-rules";

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

/**
 * The wearable source rules' evidence step (#464), read from open-twin: the
 * graded validation table (`reliabilityFor` in fhir-core) and its selection
 * policy (`selectSource` in aggregate). TwinLLM adds no grade of its own and
 * never breaks a tie on the order of the sources.
 *
 * open-twin abstains in three cases, kept apart because they say different
 * things: no grade for any source, a `poor` grade (no source is dependable)
 * and a tie.
 */
const CONNECTOR: Readonly<Record<WearableSourceId, string>> = {
  oura: "oura",
  whoop: "whoop",
  google_health: "google-health",
  bodyloop: "vitronic",
};

const gradeFor = (source: WearableSourceId, measure: string): EvidenceGrade =>
  reliabilityFor(CONNECTOR[source], measure)[0]?.grade ?? "unknown";

const citationFor = (source: WearableSourceId, measure: string): string =>
  reliabilityFor(CONNECTOR[source], measure)[0]?.citation ?? "";

export const judgeByEvidence: EvidenceJudge = (sources, measure): EvidenceVerdict => {
  const grades: Partial<Record<WearableSourceId, EvidenceGrade>> = {};
  for (const source of sources) grades[source] = gradeFor(source, measure);
  const selection = selectSource(
    sources.map((source) => ({ connector: CONNECTOR[source], source })),
    measure,
  );
  if (selection.kind === "selected") {
    const winner = selection.winner.source;
    return { kind: "selected", winner, grades, citation: citationFor(winner, measure) };
  }
  const values = Object.values(grades);
  const reason = values.includes("poor")
    ? "no_dependable_source"
    : values.every((grade) => grade === "unknown")
      ? "no_evidence"
      : "evidence_tie";
  return { kind: "abstained", reason, grades };
};
