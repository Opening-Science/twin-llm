/**
 * One ingest process's share of a folder: read each file once, and ingest it
 * when it is a FHIR Bundle. `warehouse:ingest` splits a folder into shards
 * and runs one process per shard (`spawn-shards.ts`); with one shard it runs
 * here, in its own process. Every file gives exactly one outcome.
 *
 * A file is parsed once: the parse that finds it is a bundle is the one that
 * is ingested. `ingestBundle` refuses a bundle without Synthea's Patient
 * identifier itself (`not-synthea`), so no second pass is needed to check.
 */
import { basename } from "node:path";

import { emptyReport, type IngestReport } from "../../packages/warehouse/ingest-report";
import { isFhirBundle } from "../../packages/warehouse/synthea-marker";

/** A file's JSON, or why there is none. */
export type JsonRead =
  | Readonly<{ kind: "json"; value: unknown }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "missing" }>;

/** Short, fixed reason for a bundle whose ingest threw; never the raw error. */
export const INGEST_FAILED_REASON = "ingest-failed";
/** A *.json file whose text does not parse. */
export const INVALID_JSON_REASON = "invalid-json";

export type IngestJob = Readonly<{ cohortId: string; syntheaVersion: string }>;

/** What happened to one file. `path` is the file as listed. */
export type FileOutcome =
  | Readonly<{ path: string; kind: "report"; report: IngestReport }>
  | Readonly<{ path: string; kind: "not-bundle" }>;

export type ShardPorts = Readonly<{
  readJson: (path: string) => Promise<JsonRead>;
  ingest: (bundle: unknown, job: IngestJob) => Promise<IngestReport>;
}>;

const rejected = (reason: string): IngestReport => emptyReport({ rejected: { reason } });

/**
 * Ingests one file. A throw is tried once more: two processes that meet on
 * the same subject or the same bundle hash make one of them fail on a unique
 * key, and the retry then finds the row the other wrote. `ingestBundle` writes
 * in one transaction, so a failed attempt left nothing behind.
 */
export const ingestFile = async (
  path: string,
  job: IngestJob,
  ports: ShardPorts,
): Promise<FileOutcome> => {
  const read = await ports.readJson(path);
  if (read.kind === "invalid") {
    return { path, kind: "report", report: rejected(INVALID_JSON_REASON) };
  }
  if (read.kind === "missing") {
    return { path, kind: "report", report: rejected(INGEST_FAILED_REASON) };
  }
  if (!isFhirBundle(read.value)) return { path, kind: "not-bundle" };
  const attempt = () => ports.ingest(read.value, job);
  const report = await attempt()
    .catch(attempt)
    .catch(() => rejected(INGEST_FAILED_REASON));
  return { path, kind: "report", report };
};

/** Runs a shard's files one after another and reports each as it finishes. */
export const ingestShard = async (
  files: readonly string[],
  job: IngestJob,
  ports: ShardPorts,
  onOutcome: (outcome: FileOutcome) => void,
): Promise<void> => {
  for (const path of files) {
    onOutcome(await ingestFile(path, job, ports));
  }
};

/**
 * Deals the files out to `count` shards in turn, so each gets a similar mix of
 * large and small records. Never more shards than files.
 */
export const splitShards = (
  files: readonly string[],
  count: number,
): readonly (readonly string[])[] => {
  const shards = Math.max(1, Math.min(count, files.length));
  return Array.from({ length: shards }, (_, shard) =>
    files.filter((_, index) => index % shards === shard),
  );
};

/** Outcomes for the files a shard never reported, e.g. when its process died. */
export const missingOutcomes = (
  files: readonly string[],
  reported: ReadonlySet<string>,
): readonly FileOutcome[] =>
  files
    .filter((path) => !reported.has(path))
    .map((path) => ({ path, kind: "report", report: rejected(INGEST_FAILED_REASON) }));

/** The per-file line of `warehouse:ingest`; run-batches reads the rejected form. */
export const outcomeLine = (outcome: FileOutcome): string | null => {
  if (outcome.kind === "not-bundle") return null;
  const name = basename(outcome.path);
  const { report } = outcome;
  if (report.rejected) return `${name}: rejected (${report.rejected.reason})`;
  if (report.alreadyIngested) return `${name}: already ingested (${report.skipped} rows)`;
  return `${name}: inserted ${report.inserted} rows (${report.nonNumeric} non-numeric), ${report.conditions} conditions, ${report.medicationRequests} medication requests`;
};
