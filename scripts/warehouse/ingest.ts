/**
 * Host CLI: load synthetic Synthea FHIR bundles into the warehouse.
 *
 * Usage (from repo root):
 *   bun run warehouse:ingest .synthea/fhir                          # cohort synthea-v4-seed42
 *   bun run warehouse:ingest <dir> --cohort open-twin-synthea-trimmed-3
 *
 * Every *.json in <dir> must parse, and every FHIR Bundle must carry
 * Synthea's Patient identifier; otherwise nothing is written. A bundle that
 * fails during ingest is reported as rejected and the run continues. The cohort must be in
 * SYNTHETIC_COHORTS, and must match the cohort id in the generator's
 * manifest.json (in <dir> or its parent) when there is one. Re-running is safe: known bundles are skipped by sha256.
 * Prints file names and counts only.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  isAllowedCohort,
  SYNTHEA_1M_COHORTS,
  SYNTHETIC_COHORTS,
} from "../../packages/query-tools/scope";
import type { IngestReport } from "../../packages/warehouse/ingest-report";
import { isFhirBundle, isSyntheaBundle } from "../../packages/warehouse/synthea-marker";

export const DEFAULT_COHORT = "synthea-v4-seed42";
/** Pinned in scripts/synthea/generate-local.sh. */
export const PINNED_SYNTHEA_VERSION = "v4.0.0";

export type IngestIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

/** A file's JSON, or why there is none. */
export type JsonRead =
  | Readonly<{ kind: "json"; value: unknown }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "missing" }>;

/** Short, fixed reason for a bundle whose ingest threw; never the raw error. */
export const INGEST_FAILED_REASON = "ingest-failed";

export type CohortSummary = Readonly<{
  subjects: number;
  conditions: number;
  medicationRequests: number;
  byLoinc: ReadonlyArray<Readonly<{ loinc: string; display: string; n: number }>>;
}>;

export type WarehouseIngestDeps = Readonly<{
  /** Absolute paths of *.json files in dir, or null when dir does not exist. */
  listJson: (dir: string) => Promise<readonly string[] | null>;
  readJson: (path: string) => Promise<JsonRead>;
  ingest: (
    bundle: unknown,
    options: { readonly cohortId: string; readonly syntheaVersion: string },
  ) => Promise<IngestReport>;
  cohortSummary: (cohortId: string) => Promise<CohortSummary>;
}>;

/** The allowlist for a message: the 1M batches as one range, not 100 ids. */
const allowedCohortsText = (): string => {
  const batches: readonly string[] = SYNTHEA_1M_COHORTS;
  const named = SYNTHETIC_COHORTS.filter((id) => !batches.includes(id));
  return [...named, `${batches[0]} … ${batches[batches.length - 1]}`].join(", ");
};

const parseArgs = (
  argv: readonly string[],
): Readonly<{ dir: string | undefined; cohort: string }> => {
  let dir: string | undefined;
  let cohort = DEFAULT_COHORT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--cohort") {
      cohort = argv[i + 1] ?? "";
      i += 1;
    } else if (!dir) dir = arg;
  }
  return { dir, cohort };
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
  const { dir, cohort } = parseArgs(argv);
  if (!dir) {
    io.stderr.write("Usage: bun run warehouse:ingest <dir> [--cohort <id>]\n");
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

  // First pass: every bundle must be Synthea output before anything is written.
  const bundles: string[] = [];
  const refused: string[] = [];
  for (const file of files) {
    const read = await deps.readJson(file);
    if (read.kind !== "json") {
      refused.push(`${basename(file)} (invalid JSON)`);
      continue;
    }
    if (!isFhirBundle(read.value)) continue;
    if (isSyntheaBundle(read.value)) bundles.push(file);
    else refused.push(`${basename(file)} (not Synthea)`);
  }
  if (refused.length > 0) {
    io.stderr.write(`Refused, nothing written: ${refused.join(", ")}\n`);
    return 1;
  }
  if (bundles.length === 0) {
    io.stderr.write(`No FHIR bundles in ${dir}\n`);
    return 1;
  }

  if (manifest.cohortId === null) {
    io.stderr.write(
      `Warning: no manifest.json with a cohort id in ${dir} or its parent; ingesting as ${cohort}.\n`,
    );
  }
  const { syntheaVersion } = manifest;
  io.stdout.write(
    `Ingesting ${bundles.length} bundles into cohort ${cohort} (Synthea ${syntheaVersion})\n`,
  );

  let inserted = 0;
  let skipped = 0;
  let rejected = 0;
  for (const file of bundles) {
    const name = basename(file);
    let report: IngestReport;
    try {
      const read = await deps.readJson(file);
      if (read.kind !== "json") throw new Error("bundle changed during the run");
      report = await deps.ingest(read.value, { cohortId: cohort, syntheaVersion });
    } catch {
      report = {
        inserted: 0,
        skipped: 0,
        unresolved: [],
        nonNumeric: 0,
        conditions: 0,
        medicationRequests: 0,
        alreadyIngested: false,
        rejected: { reason: INGEST_FAILED_REASON },
      };
    }
    if (report.rejected) {
      rejected += 1;
      io.stdout.write(`${name}: rejected (${report.rejected.reason})\n`);
    } else if (report.alreadyIngested) {
      skipped += 1;
      io.stdout.write(`${name}: already ingested (${report.skipped} rows)\n`);
    } else {
      inserted += 1;
      io.stdout.write(
        `${name}: inserted ${report.inserted} rows (${report.nonNumeric} non-numeric), ${report.conditions} conditions, ${report.medicationRequests} medication requests\n`,
      );
    }
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

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { ingestBundle } = await import("../../packages/warehouse/ingest-bundle");
  const { database } = await import("../../infrastructure/database");
  const code = await runWarehouseIngest(process.argv.slice(2), process, {
    listJson: async (dir) => {
      try {
        const names = await readdir(resolve(dir));
        return names
          .filter((name) => name.endsWith(".json"))
          .sort()
          .map((name) => join(resolve(dir), name));
      } catch {
        return null;
      }
    },
    readJson: async (path) => {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch {
        return { kind: "missing" };
      }
      try {
        return { kind: "json", value: JSON.parse(text) as unknown };
      } catch {
        return { kind: "invalid" };
      }
    },
    ingest: ingestBundle,
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
