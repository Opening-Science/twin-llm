import { aggregate, type AggregateResult } from "@open-twin/aggregate";
import type { Bundle } from "fhir/r4";

import type { WearableSourceId } from "@/infrastructure/wearable-provenance";
import type {
  EvidenceGrade,
  EvidenceJudge,
  EvidenceVerdict,
} from "@/infrastructure/wearable-source-rules";

import { mergePersonPatients } from "./person-subject";
import { reliabilityFor, selectSource } from "./source-reliability";

/**
 * One person's Oura, WHOOP and Google Health bundles as one bundle, by
 * `@open-twin/aggregate`: every source Observation is kept. Reconciliation is
 * opt-in upstream since #297 and is not enabled here, so no derived
 * Observation is added and no source is preferred. Aggregate refuses Observations under more than one subject; every builder names the
 * person's shared subject (person-subject.ts), and the person's Patient is
 * carried once, with each connector's identifier.
 *
 * Nothing on screen reads this bundle yet. The screens resolve overlapping
 * summary keys with the wearable source rules (#464, `judgeByEvidence` below,
 * docs/wearable-sources.md).
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
 * The wearable source rules' evidence step (#464): the graded validation
 * table (`reliabilityFor`) and its selection policy (`selectSource`), kept in
 * `source-reliability.ts` as copied from open-twin@2fd26911 after upstream
 * removed them (#300). TwinLLM adds no grade of its own and
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
