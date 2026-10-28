/**
 * Host CLI: load synthetic Synthea FHIR bundles into the warehouse.
 *
 * Usage (from repo root):
 *   bun run warehouse:ingest .synthea/fhir                          # cohort synthea-v4-seed42
 *   bun run warehouse:ingest <dir> --cohort open-twin-synthea-trimmed-3
 *   bun run warehouse:ingest <dir> --cohort <id> --workers 4
 *
 * The folder's *.json files are split across --workers ingest processes
 * (default: CPU cores - 1), and each file is read and parsed once. A FHIR
 * Bundle whose Patient lacks Synthea's identifier is rejected (`not-synthea`)
 * and nothing of it is written; so is a file that does not parse
 * (`invalid-json`) and a bundle whose ingest fails (`ingest-failed`). Other
 * files are still ingested, the rejected ones are listed, and the exit code is
 * 1. The cohort must be in SYNTHETIC_COHORTS, and must match the cohort id in
 * the generator's manifest.json (in <dir> or its parent) when there is one.
 * Re-running is safe: known bundles are skipped by sha256. Prints file names
 * and counts only.
 */
import { dirname, join } from "node:path";

import {
  isAllowedCohort,
  SYNTHEA_1M_COHORTS,
  SYNTHETIC_COHORTS,
} from "../../packages/query-tools/scope";

import {
  type FileOutcome,
  type IngestJob,
  type JsonRead,
  outcomeLine,
  splitShards,
} from "./ingest-shard";

export { INGEST_FAILED_REASON, INVALID_JSON_REASON, type JsonRead } from "./ingest-shard";

export const DEFAULT_COHORT = "synthea-v4-seed42";
/** Pinned in scripts/synthea/generate-local.sh. */
export const PINNED_SYNTHEA_VERSION = "v4.0.0";

export type IngestIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type CohortSummary = Readonly<{
  subjects: number;
  conditions: number;
  medicationRequests: number;
  byLoinc: ReadonlyArray<Readonly<{ loinc: string; display: string; n: number }>>;
}>;

export type WarehouseIngestDeps = Readonly<{
  /** Absolute paths of *.json files in dir, or null when dir does not exist. */
  listJson: (dir: string) => Promise<readonly string[] | null>;
  /** Used for the manifest; the bundles are read by the shards. */
  readJson: (path: string) => Promise<JsonRead>;
  /**
   * Ingests each shard in its own process, all at once, and calls `onOutcome`
   * exactly once per file as it finishes.
   */
  runShards: (
    shards: readonly (readonly string[])[],
    job: IngestJob,
    onOutcome: (outcome: FileOutcome) => void,
  ) => Promise<void>;
  /** --workers when not given: CPU cores - 1, at least 1. */
  defaultWorkers: number;
  cohortSummary: (cohortId: string) => Promise<CohortSummary>;
}>;

export const USAGE =
  "Usage: bun run warehouse:ingest <dir> [--cohort <id>] [--workers <n>]";

/** The allowlist for a message: the 1M batches as one range, not 100 ids. */
const allowedCohortsText = (): string => {
  const batches: readonly string[] = SYNTHEA_1M_COHORTS;
  const named = SYNTHETIC_COHORTS.filter((id) => !batches.includes(id));
  return [...named, `${batches[0]} … ${batches[batches.length - 1]}`].join(", ");
};

type IngestArgs = Readonly<{
  dir: string | undefined;
  cohort: string;
  /** null when --workers is not given; NaN when it is not a whole number. */
  workers: number | null;
}>;

const parseArgs = (argv: readonly string[]): IngestArgs => {
  let dir: string | undefined;
  let cohort = DEFAULT_COHORT;
  let workers: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--cohort") {
      cohort = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--workers") {
      const text = argv[i + 1] ?? "";
      workers = /^[1-9]\d*$/.test(text) ? Number(text) : Number.NaN;
      i += 1;
    } else if (!dir) dir = arg;
  }
  return { dir, cohort, workers };
};

type DirManifest = Readonly<{ syntheaVersion: string; cohortId: string | null }>;

/**
 * The generator's manifest.json in `dir` or its parent: the Synthea version
 * (else the pinned one) and the cohort id it was generated as (else null).
 */
const manifestFrom = async (
  dir: string,
  deps: WarehouseIngestDeps,
): Promise<DirManifest> => {
  let syntheaVersion: string | null = null;
  let cohortId: string | null = null;
  for (const candidate of [
    join(dir, "manifest.json"),
    join(dirname(dir), "manifest.json"),
  ]) {
    const read = await deps.readJson(candidate);
    const manifest = read.kind === "json" ? read.value : undefined;
    if (typeof manifest !== "object" || manifest === null) continue;
    const version = Reflect.get(manifest, "syntheaVersion");
    const cohort = Reflect.get(manifest, "cohortId");
    syntheaVersion ??= typeof version === "string" ? version : null;
    cohortId ??= typeof cohort === "string" ? cohort : null;
  }
  return { syntheaVersion: syntheaVersion ?? PINNED_SYNTHEA_VERSION, cohortId };
};

export const runWarehouseIngest = async (
  argv: readonly string[],
  io: IngestIo,
  deps: WarehouseIngestDeps,
): Promise<number> => {
  const { dir, cohort, workers } = parseArgs(argv);
  if (!dir || Number.isNaN(workers)) {
    io.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (!isAllowedCohort(cohort)) {
    io.stderr.write(
      `Cohort "${cohort}" is not allowed. Use one of: ${allowedCohortsText()}.\n`,
    );
    return 1;
  }

  const files = await deps.listJson(dir);
  if (files === null) {
    io.stderr.write(`No such directory: ${dir}\n`);
    return 1;
  }

  const manifest = await manifestFrom(dir, deps);
  if (manifest.cohortId !== null && manifest.cohortId !== cohort) {
    io.stderr.write(
      `Refused, nothing written: ${dir} was generated as cohort ${manifest.cohortId} (manifest.json), not ${cohort}.\n`,
    );
    return 1;
  }

  if (files.length === 0) {
    io.stderr.write(`No FHIR bundles in ${dir}\n`);
    return 1;
  }

  if (manifest.cohortId === null) {
    io.stderr.write(
      `Warning: no manifest.json with a cohort id in ${dir} or its parent; ingesting as ${cohort}.\n`,
    );
  }
  const { syntheaVersion } = manifest;
  const shards = splitShards(files, workers ?? deps.defaultWorkers);
  io.stdout.write(
    `Ingesting ${files.length} files into cohort ${cohort} (Synthea ${syntheaVersion}) with ${shards.length} ${shards.length === 1 ? "process" : "processes"}\n`,
  );

  let inserted = 0;
  let skipped = 0;
  let rejected = 0;
  await deps.runShards(shards, { cohortId: cohort, syntheaVersion }, (outcome) => {
    const line = outcomeLine(outcome);
    if (line === null || outcome.kind !== "report") return;
    if (outcome.report.rejected) rejected += 1;
    else if (outcome.report.alreadyIngested) skipped += 1;
    else inserted += 1;
    io.stdout.write(`${line}\n`);
  });

  if (inserted + skipped + rejected === 0) {
    io.stderr.write(`No FHIR bundles in ${dir}\n`);
    return 1;
  }
  io.stdout.write(
    `\nBundles: ${inserted} inserted, ${skipped} already ingested, ${rejected} rejected\n`,
  );
  const summary = await deps.cohortSummary(cohort);
  io.stdout.write(`Cohort ${cohort}: ${summary.subjects} subjects\n`);
  io.stdout.write(
    `Conditions: ${summary.conditions}, medication requests: ${summary.medicationRequests}\n`,
  );
  io.stdout.write("Numeric observations per LOINC:\n");
  for (const row of summary.byLoinc) {
    io.stdout.write(`  ${row.loinc}\t${row.n}\t${row.display}\n`);
  }
  return rejected > 0 ? 1 : 0;
};

/** One process per core, leaving one for Postgres and the rest of the machine. */
export const defaultWorkerCount = (cores: number): number => Math.max(1, cores - 1);

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { availableParallelism } = await import("node:os");
  const { database } = await import("../../infrastructure/database");
  const { listJsonFiles, readJsonFile } = await import("./read-json");
  const { spawnShards } = await import("./spawn-shards");
  const code = await runWarehouseIngest(process.argv.slice(2), process, {
    listJson: listJsonFiles,
    readJson: readJsonFile,
    runShards: spawnShards,
    defaultWorkers: defaultWorkerCount(availableParallelism()),
    cohortSummary: async (cohortId) => {
      const db = database();
      const [subjects, conditions, medicationRequests, groups] = await Promise.all([
        db.subject.count({ where: { cohortId } }),
        db.condition.count({ where: { subject: { cohortId } } }),
        db.medicationRequest.count({ where: { subject: { cohortId } } }),
        db.observation.groupBy({
          by: ["loinc", "display"],
          where: { subject: { cohortId } },
          _count: { _all: true },
          orderBy: { loinc: "asc" },
        }),
      ]);
      return {
        subjects,
        conditions,
        medicationRequests,
        byLoinc: groups.map((group) => ({
          loinc: group.loinc,
          display: group.display,
          n: group._count._all,
        })),
      };
    },
  });
  await database().$disconnect();
  process.exit(code);
}
