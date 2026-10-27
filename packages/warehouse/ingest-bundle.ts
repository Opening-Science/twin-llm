import { normaliseBundle } from "@open-twin/fhir-r4";

import { database } from "@/infrastructure/database";

import { bundleSha } from "./bundle-sha";
import { emptyReport, ingestReportSchema, type IngestReport } from "./ingest-report";
import { mapConditions, mapMedicationRequests } from "./map-clinical";
import { mapObservations, WAREHOUSE_SOURCE } from "./map-observation";
import { subjectFactsFrom } from "./subject-facts";
import { isSyntheaBundle } from "./synthea-marker";

const UNRESOLVED_RULE = "ot-reference-unresolved-urn";
const MISSING_UNIT_REASON = "ot-quantity-no-code";
const COHORT_CONFLICT_REASON = "subject-cohort-conflict";
const NOT_SYNTHEA_REASON = "not-synthea";
/** Full Synthea patients carry thousands of rows; the default 5 s is too short. */
const TRANSACTION_TIMEOUT_MS = 120_000;

export type IngestBundleOptions = {
  readonly cohortId: string;
  readonly syntheaVersion: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const patientIdFrom = (bundle: unknown): string | undefined => {
  if (!isObject(bundle) || !Array.isArray(bundle.entry)) return undefined;
  for (const entry of bundle.entry) {
    if (!isObject(entry) || !isObject(entry.resource)) continue;
    if (
      entry.resource.resourceType === "Patient" &&
      typeof entry.resource.id === "string"
    ) {
      return entry.resource.id;
    }
  }
  return undefined;
};

const presentIds = (bundle: unknown): Set<string> => {
  const ids = new Set<string>();
  if (!isObject(bundle) || !Array.isArray(bundle.entry)) return ids;
  for (const entry of bundle.entry) {
    if (!isObject(entry)) continue;
    if (typeof entry.fullUrl === "string") ids.add(entry.fullUrl);
    if (isObject(entry.resource) && typeof entry.resource.id === "string") {
      ids.add(entry.resource.id);
      ids.add(`urn:uuid:${entry.resource.id}`);
    }
  }
  return ids;
};

export const unresolvedUrnsFrom = (bundle: unknown): string[] => {
  const present = presentIds(bundle);
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isObject(node)) return;
    if (typeof node.reference === "string" && node.reference.startsWith("urn:uuid:")) {
      if (!present.has(node.reference) && !found.includes(node.reference)) {
        found.push(node.reference);
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(bundle);
  return found;
};

/** Rows already stored for a bundle: observations (as `skipped`) and the clinical records. */
const countStoredRows = async (
  sha: string,
): Promise<
  Readonly<{ skipped: number; conditions: number; medicationRequests: number }>
> => {
  const db = database();
  const [numeric, nonNumeric, conditions, medicationRequests] = await Promise.all([
    db.observation.count({ where: { bundleSha: sha } }),
    db.observationNonNumeric.count({ where: { bundleSha: sha } }),
    db.condition.count({ where: { bundleSha: sha } }),
    db.medicationRequest.count({ where: { bundleSha: sha } }),
  ]);
  return { skipped: numeric + nonNumeric, conditions, medicationRequests };
};

export const ingestBundle = async (
  bundle: unknown,
  { cohortId, syntheaVersion }: IngestBundleOptions,
): Promise<IngestReport> => {
  if (!isSyntheaBundle(bundle)) {
    return emptyReport({ rejected: { reason: NOT_SYNTHEA_REASON } });
  }

  const sha = bundleSha(bundle);
  const facts = subjectFactsFrom(bundle);
  const existing = await database().bundle.findUnique({ where: { sha } });
  if (existing) {
    // A re-run backfills the subject's facts (#4) and writes nothing else.
    const knownRef = patientIdFrom(bundle);
    if (knownRef && Object.keys(facts).length > 0) {
      await database().subject.updateMany({
        where: { subjectRef: knownRef, cohortId: existing.cohortId, isSynthetic: true },
        data: facts,
      });
    }
    return emptyReport({ ...(await countStoredRows(sha)), alreadyIngested: true });
  }

  const subjectRef = patientIdFrom(bundle);
  if (!subjectRef) {
    return emptyReport({
      unresolved: unresolvedUrnsFrom(bundle),
      rejected: { reason: "missing-subject" },
    });
  }

  const timestamp = new Date().toISOString();
  const normalised = normaliseBundle(bundle, {
    connector: { connector: "synthea", version: syntheaVersion },
    subjectKey: subjectRef,
    bundleKey: sha,
    timestamp,
    type: "collection",
    unresolvedUrnPolicy: "preserve",
  });

  if (!normalised.bundle) {
    const unresolved = normalised.issues.some((issue) => issue.rule === UNRESOLVED_RULE)
      ? unresolvedUrnsFrom(bundle)
      : [];
    const reason =
      normalised.issues.find((issue) => issue.rule === UNRESOLVED_RULE)?.rule ??
      normalised.issues.find(
        (issue) => issue.severity === "error" || issue.severity === "fatal",
      )?.rule ??
      "normalise-rejected";
    return ingestReportSchema.parse({
      inserted: 0,
      skipped: 0,
      unresolved,
      nonNumeric: 0,
      conditions: 0,
      medicationRequests: 0,
      alreadyIngested: false,
      rejected: { reason },
    });
  }

  const entries = normalised.bundle.entry ?? [];
  const mapped = entries.flatMap((entry) => mapObservations(entry.resource));

  if (mapped.some((item) => item.kind === "missingUnit")) {
    return emptyReport({
      unresolved: unresolvedUrnsFrom(bundle),
      rejected: { reason: MISSING_UNIT_REASON },
    });
  }

  const numeric = mapped
    .filter((item) => item.kind === "numeric")
    .map((item) => item.row);
  const nonNumeric = mapped
    .filter((item) => item.kind === "nonNumeric")
    .map((item) => item.row);
  const conditions = mapConditions(entries);
  const medicationRequests = mapMedicationRequests(entries);

  const outcome = await database().$transaction(
    async (tx) => {
      // Checked inside the transaction so a concurrent ingest cannot move the subject.
      const known = await tx.subject.findUnique({ where: { subjectRef } });
      if (known && known.cohortId !== cohortId) return "cohort-conflict" as const;
      await tx.subject.upsert({
        where: { subjectRef },
        create: { subjectRef, isSynthetic: true, cohortId, ...facts },
        update: facts,
      });
      await tx.bundle.create({
        data: { sha, cohortId, syntheaVersion },
      });
      await tx.observation.createMany({
        data: numeric.map((row) => ({
          subjectRef,
          loinc: row.loinc,
          display: row.display,
          value: row.value,
          unitUcum: row.unitUcum,
          effectiveAt: row.effectiveAt,
          source: WAREHOUSE_SOURCE,
          fhirId: row.fhirId,
          bundleSha: sha,
        })),
      });
      await tx.observationNonNumeric.createMany({
        data: nonNumeric.map((row) => ({
          subjectRef,
          loinc: row.loinc,
          display: row.display,
          valueType: row.valueType,
          rawValue: row.rawValue as object,
          source: WAREHOUSE_SOURCE,
          fhirId: row.fhirId,
          bundleSha: sha,
        })),
      });
      await tx.condition.createMany({
        data: conditions.map((row) => ({
          ...row,
          subjectRef,
          source: WAREHOUSE_SOURCE,
          bundleSha: sha,
        })),
      });
      await tx.medicationRequest.createMany({
        data: medicationRequests.map((row) => ({
          ...row,
          dosageText: [...row.dosageText],
          reasonRefs: [...row.reasonRefs],
          subjectRef,
          source: WAREHOUSE_SOURCE,
          bundleSha: sha,
        })),
      });
      return "written" as const;
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );

  if (outcome === "cohort-conflict") {
    return emptyReport({ rejected: { reason: COHORT_CONFLICT_REASON } });
  }

  return ingestReportSchema.parse({
    inserted: numeric.length + nonNumeric.length,
    skipped: 0,
    unresolved: unresolvedUrnsFrom(bundle),
    nonNumeric: nonNumeric.length,
    conditions: conditions.length,
    medicationRequests: medicationRequests.length,
    alreadyIngested: false,
  });
};
