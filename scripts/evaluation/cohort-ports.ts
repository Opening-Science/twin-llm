/**
 * Query tool ports over the pinned cohort's patient files, held in memory, so
 * an answer key can be built by the same closed tools without a database
 * (`bun run eval:answer-key:s7`, docs/evaluation/question-set.md, "S7").
 *
 * Each bundle goes through the warehouse's own mapping (`normaliseBundle`,
 * `mapObservations`, `mapConditions`, `mapMedicationRequests`, as
 * `ingestBundle` does), and each port answers with the filter and order of its
 * Prisma query in `packages/query-tools/ports.ts`. Two differences, both
 * documented: a row's id is its FHIR id (the database makes a cuid), which
 * only matters for a tie at one instant, and the synthetic wearable series is
 * not loaded (it starts on 2026-07-04, after every window the S7 items read).
 * Audit rows are kept in memory. Pure apart from `loadCohortBundles`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { normaliseBundle } from "@open-twin/fhir-r4";

import {
  mapConditions,
  mapMedicationRequests,
} from "../../packages/warehouse/map-clinical";
import { mapObservations } from "../../packages/warehouse/map-observation";
import { subjectFactsFrom } from "../../packages/warehouse/subject-facts";
import { isSyntheaBundle } from "../../packages/warehouse/synthea-marker";
import type { AppendInput } from "../../packages/audit/append";
import { distinctRows, type LearningRow } from "../../infrastructure/learning-consent";
import type {
  ClinicalQuery,
  ConditionRecord,
  MedicationRequestRecord,
  ObservationRecord,
  ObservationSpan,
  QueryToolPorts,
  SubjectScopeRow,
} from "../../packages/query-tools/ports";

export type CohortSubject = Readonly<{
  subjectRef: string;
  scope: SubjectScopeRow;
  observations: readonly ObservationRecord[];
  conditions: readonly ConditionRecord[];
  medicationRequests: readonly MedicationRequestRecord[];
}>;

const patientIdOf = (bundle: unknown): string | null => {
  const entries: unknown = Reflect.get(Object(bundle), "entry");
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    const resource: unknown = Reflect.get(Object(entry), "resource");
    if (
      Reflect.get(Object(resource), "resourceType") === "Patient" &&
      typeof Reflect.get(Object(resource), "id") === "string"
    ) {
      return Reflect.get(Object(resource), "id") as string;
    }
  }
  return null;
};

/** One Synthea bundle as the warehouse stores it; null when ingest would reject it. */
/**
 * What a folder of patient files is, for the learning-consent gate (#145): a
 * bundle is a synthetic subject of the cohort only when it is a Synthea bundle.
 */
export const syntheaBundleRows = (
  bundles: readonly unknown[],
  cohortId: string,
): readonly LearningRow[] =>
  distinctRows(
    bundles.map((bundle) => ({
      kind: "subject",
      cohortId,
      isSynthetic: isSyntheaBundle(bundle),
    })),
  );

export const cohortSubjectFrom = (
  bundle: unknown,
  cohortId: string,
  syntheaVersion: string,
): CohortSubject | null => {
  if (!isSyntheaBundle(bundle)) return null;
  const subjectRef = patientIdOf(bundle);
  if (subjectRef === null) return null;
  const normalised = normaliseBundle(bundle, {
    connector: { connector: "synthea", version: syntheaVersion },
    subjectKey: subjectRef,
    bundleKey: subjectRef,
    timestamp: "1970-01-01T00:00:00.000Z",
    type: "collection",
    unresolvedUrnPolicy: "preserve",
  });
  if (!normalised.bundle) return null;
  const entries = normalised.bundle.entry ?? [];
  const mapped = entries.flatMap((entry) => mapObservations(entry.resource));
  if (mapped.some((item) => item.kind === "missingUnit")) return null;
  const observations = mapped.flatMap((item) =>
    item.kind === "numeric"
      ? [
          {
            id: item.row.fhirId,
            loinc: item.row.loinc,
            display: item.row.display,
            value: item.row.value,
            unitUcum: item.row.unitUcum,
            effectiveAt: item.row.effectiveAt,
          },
        ]
      : [],
  );
  const conditions = mapConditions(entries).map((row) => ({
    id: row.fhirId,
    codeSystem: row.codeSystem,
    code: row.code,
    display: row.display,
    onsetAt: row.onsetAt,
    abatementAt: row.abatementAt,
    clinicalStatus: row.clinicalStatus,
    verificationStatus: row.verificationStatus,
  }));
  const medicationRequests = mapMedicationRequests(entries).map((row) => ({
    id: row.fhirId,
    codeSystem: row.codeSystem,
    code: row.code,
    display: row.display,
    authoredAt: row.authoredAt,
    status: row.status,
    intent: row.intent,
    dosageText: row.dosageText,
  }));
  return {
    subjectRef,
    scope: { isSynthetic: true, cohortId, ...subjectFactsFrom(bundle) },
    observations,
    conditions,
    medicationRequests,
  };
};

const time = (value: Date | null): number =>
  value === null ? Number.NaN : value.getTime();

const byKeys =
  <T>(...keys: ReadonlyArray<(row: T) => number | string>) =>
  (a: T, b: T): number => {
    for (const key of keys) {
      const left = key(a);
      const right = key(b);
      if (left < right) return -1;
      if (left > right) return 1;
    }
    return 0;
  };

/** Prisma orders nulls last in ascending order (Postgres default). */
const nullsLast = (value: Date | null): number =>
  value === null ? Number.POSITIVE_INFINITY : value.getTime();

const matchesFilters = (
  row: Readonly<{ code: string }>,
  status: string | null,
  query: ClinicalQuery,
): boolean =>
  (query.status === undefined || status === query.status) &&
  (query.code === undefined || row.code === query.code);

export type MemoryPorts = QueryToolPorts & Readonly<{ audit: readonly AppendInput[] }>;

/** The ports of `defaultQueryToolPorts`, answered from the subjects in memory. */
export const memoryPorts = (subjects: readonly CohortSubject[]): MemoryPorts => {
  const bySubject = new Map(subjects.map((subject) => [subject.subjectRef, subject]));
  const audit: AppendInput[] = [];
  const findConditions = async (query: ClinicalQuery) =>
    (bySubject.get(query.subjectRef)?.conditions ?? [])
      .filter(
        (row) =>
          row.onsetAt !== null &&
          time(row.onsetAt) <= query.end.getTime() &&
          (row.abatementAt === null || time(row.abatementAt) >= query.start.getTime()) &&
          matchesFilters(row, row.clinicalStatus, query),
      )
      .sort(
        byKeys<ConditionRecord>(
          (row) => nullsLast(row.onsetAt),
          (row) => row.code,
          (row) => row.id,
        ),
      )
      .slice(0, query.take);
  const findMedicationRequests = async (query: ClinicalQuery) =>
    (bySubject.get(query.subjectRef)?.medicationRequests ?? [])
      .filter(
        (row) =>
          row.authoredAt !== null &&
          time(row.authoredAt) >= query.start.getTime() &&
          time(row.authoredAt) <= query.end.getTime() &&
          matchesFilters(row, row.status, query),
      )
      .sort(
        byKeys<MedicationRequestRecord>(
          (row) => nullsLast(row.authoredAt),
          (row) => row.code,
          (row) => row.id,
        ),
      )
      .slice(0, query.take);
  const findObservationSpan = async (
    subjectRef: string,
  ): Promise<ObservationSpan | null> => {
    const times = (bySubject.get(subjectRef)?.observations ?? []).map((row) =>
      row.effectiveAt.getTime(),
    );
    return times.length === 0
      ? null
      : { first: new Date(Math.min(...times)), last: new Date(Math.max(...times)) };
  };
  return {
    audit,
    findSubject: async (subjectRef) => bySubject.get(subjectRef)?.scope ?? null,
    findObservations: async (query) =>
      (bySubject.get(query.subjectRef)?.observations ?? [])
        .filter(
          (row) =>
            query.loinc.includes(row.loinc) &&
            row.effectiveAt.getTime() >= query.start.getTime() &&
            row.effectiveAt.getTime() <= query.end.getTime(),
        )
        .sort(byKeys<ObservationRecord>((row) => row.effectiveAt.getTime()))
        .slice(0, query.take),
    findCohortObservations: async (query) =>
      subjects
        .filter(
          (subject) =>
            subject.scope.cohortId === query.cohortId && subject.scope.isSynthetic,
        )
        .flatMap((subject) =>
          subject.observations
            .filter(
              (row) =>
                row.loinc === query.loinc &&
                row.effectiveAt.getTime() >= query.start.getTime() &&
                row.effectiveAt.getTime() <= query.end.getTime(),
            )
            .map((row) => ({ ...row, subjectRef: subject.subjectRef })),
        )
        .sort(
          byKeys(
            (row) => row.effectiveAt.getTime(),
            (row) => row.id ?? "",
          ),
        )
        .slice(0, query.take),
    findConditions,
    findMedicationRequests,
    findObservationSpan,
    appendAudit: async (input) => {
      audit.push(input);
    },
  };
};

/** Every `*.json` bundle in a folder, in name order. */
export const loadCohortBundles = async (dir: string): Promise<unknown[]> => {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    names.map(
      async (name) => JSON.parse(await readFile(join(dir, name), "utf8")) as unknown,
    ),
  );
};
