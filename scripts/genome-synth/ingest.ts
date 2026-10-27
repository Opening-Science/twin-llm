/**
 * Host CLI: synthetic rsid-genotypes reports for every subject of a Synthea
 * cohort.
 *
 *   bun run genome:ingest -- --in .synthea/synthea-v4-seed4242/fhir
 *   bun run genome:ingest -- --in .synthea/fhir --cohort synthea-v4-seed42 --out <file>
 *   bun run genome:ingest:db -- --in .synthea/synthea-v4-seed4242/fhir
 *
 * By default it writes one JSON line per subject to
 * `data/genome-synth/<cohort>.reports.jsonl` (gitignored) and touches no
 * database. Each line is what the Ark returns for an approved app run
 * (`{ report }`, packages/ark-adapter) plus the subject and app it belongs to.
 *
 * With `--to-db` (`genome:ingest:db` reads `.env.training`) it writes each
 * report to the genome_reports table through `replaceSyntheticGenomeReport`:
 * flagged synthetic, tied to the warehouse subject and never to a user. It
 * then needs DATA_MODE=synthetic, and the subject must already be in the
 * warehouse as a synthetic member of this cohort; any other subject is
 * refused, so no person's report can be written this way.
 *
 * Reads only Synthea bundles (the Patient id is the subject_ref), refuses
 * cohorts outside the synthetic allowlist, and prints counts only.
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import {
  parseRsidGenotypesReport,
  type RsidGenotypeRow,
} from "../../packages/ark-adapter/rsid-genotypes";
import { isAllowedCohort } from "../../packages/query-tools/scope";
import { syntheaPatientOf } from "../synthetic-wearables/bundle";

import { ARK_APP, ARK_APP_VERSION, reportFor } from "./ark-report";
import type { Variant } from "./catalog";
import { callsFor, CATALOG_VERSION } from "./genotypes";

export type ReleasedReport = Readonly<{
  subject_ref: string;
  cohort_id: string;
  app: string;
  app_version: string;
  catalog_version: string;
  report: string;
  report_sha256: string;
  synthetic: true;
}>;

export const releasedReport = (
  subjectRef: string,
  cohortId: string,
  catalog: readonly Variant[],
): ReleasedReport => {
  const report = reportFor(callsFor(subjectRef, catalog), catalog);
  return {
    subject_ref: subjectRef,
    cohort_id: cohortId,
    app: ARK_APP,
    app_version: ARK_APP_VERSION,
    catalog_version: CATALOG_VERSION,
    report,
    report_sha256: createHash("sha256").update(report).digest("hex"),
    synthetic: true,
  };
};

/** The build a synthetic VCF names (`##reference=GRCh38`), stored as the Ark's build. */
export const SYNTHETIC_ARK_BUILD = "GRCh38";

/** What the genome_reports table gets for one synthetic subject. */
export type SyntheticRow = Readonly<{
  subjectRef: string;
  cohortId: string;
  arkBuild: string;
  rows: readonly RsidGenotypeRow[];
  report: string;
}>;

/** The stored form of a report, parsed by the same parser a device report goes through. */
export const syntheticRow = (released: ReleasedReport): SyntheticRow => {
  const parsed = parseRsidGenotypesReport(released.report);
  if (!parsed.ok) throw new Error(`synthetic report does not parse: ${parsed.issue}`);
  return {
    subjectRef: released.subject_ref,
    cohortId: released.cohort_id,
    arkBuild: SYNTHETIC_ARK_BUILD,
    rows: parsed.rows,
    report: released.report,
  };
};

export type SaveOutcome = "saved" | "no_subject" | "not_synthetic";

export type IngestArgs = Readonly<{
  input: string;
  cohortId: string | null;
  out: string | null;
  toDb: boolean;
}>;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

export const parseIngestArgs = (argv: readonly string[]): IngestArgs | string => {
  const input = flag(argv, "--in");
  if (!input) {
    return "Usage: bun run genome:ingest -- --in <synthea fhir dir> [--cohort <id>] [--out <file> | --to-db]";
  }
  const toDb = argv.includes("--to-db");
  const out = flag(argv, "--out") ?? null;
  if (toDb && out !== null) return "--out and --to-db do not go together.";
  return { input, cohortId: flag(argv, "--cohort") ?? null, out, toDb };
};

/** The cohort id a manifest names, or null; an older manifest has only a seed. */
const cohortOfManifest = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) return null;
  const cohortId = Reflect.get(value, "cohortId");
  if (typeof cohortId === "string") return cohortId;
  const seed = Reflect.get(value, "seed");
  return typeof seed === "number" && Number.isInteger(seed)
    ? `synthea-v4-seed${seed}`
    : null;
};

export type IngestDeps = Readonly<{
  catalog: () => Promise<readonly Variant[]>;
  /** Absolute paths of *.json files in dir, sorted, or null when dir does not exist. */
  listJson: (dir: string) => Promise<readonly string[] | null>;
  /** Parsed JSON, or null when the file is missing or does not parse. */
  readJson: (path: string) => Promise<unknown>;
  writeText: (path: string, text: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  /** For --to-db only: the app's DATA_MODE. */
  dataMode?: () => string;
  /** For --to-db only: write one report to genome_reports. */
  save?: (row: SyntheticRow) => Promise<SaveOutcome>;
}>;

type Io = Readonly<{
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}>;

const toDatabase = async (
  reports: readonly ReleasedReport[],
  cohortId: string,
  io: Io,
  deps: IngestDeps,
): Promise<number> => {
  if (deps.save === undefined || deps.dataMode === undefined) {
    io.stderr.write("--to-db needs a database.\n");
    return 1;
  }
  if (deps.dataMode() !== "synthetic") {
    io.stderr.write("genome:ingest --to-db runs only with DATA_MODE=synthetic.\n");
    return 1;
  }
  const outcomes: Record<SaveOutcome, number> = {
    saved: 0,
    no_subject: 0,
    not_synthetic: 0,
  };
  for (const report of reports) {
    outcomes[await deps.save(syntheticRow(report))] += 1;
  }
  io.stdout.write(
    [
      `Synthetic genome reports (${CATALOG_VERSION}) written to genome_reports`,
      `Cohort ${cohortId}: ${outcomes.saved} saved, ${outcomes.no_subject} not in the warehouse, ${outcomes.not_synthetic} refused (not a synthetic subject of this cohort)`,
      "",
    ].join("\n"),
  );
  return outcomes.not_synthetic > 0 ? 1 : 0;
};

export const runIngest = async (
  argv: readonly string[],
  io: Io,
  deps: IngestDeps,
): Promise<number> => {
  const args = parseIngestArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  const files = await deps.listJson(args.input);
  if (files === null) {
    io.stderr.write(`No such directory: ${args.input}\n`);
    return 1;
  }
  const cohortId =
    args.cohortId ??
    cohortOfManifest(await deps.readJson(join(dirname(args.input), "manifest.json")));
  if (cohortId === null) {
    io.stderr.write(
      "No cohort: pass --cohort or keep manifest.json next to the fhir dir.\n",
    );
    return 1;
  }
  if (!isAllowedCohort(cohortId)) {
    io.stderr.write(`Cohort "${cohortId}" is not an allowed synthetic cohort.\n`);
    return 1;
  }
  const catalog = await deps.catalog();
  const reports: ReleasedReport[] = [];
  let other = 0;
  for (const file of files) {
    const patient = syntheaPatientOf(await deps.readJson(file));
    if (patient === null) {
      // Synthea also writes hospital and practitioner files; they have no Patient.
      other += 1;
      continue;
    }
    reports.push(releasedReport(patient.id, cohortId, catalog));
  }
  if (reports.length === 0) {
    io.stderr.write(`No Synthea subjects in ${args.input}\n`);
    return 1;
  }
  const sorted = [...reports].sort((a, b) =>
    a.subject_ref < b.subject_ref ? -1 : a.subject_ref > b.subject_ref ? 1 : 0,
  );
  if (args.toDb) return toDatabase(sorted, cohortId, io, deps);
  const out = args.out ?? `data/genome-synth/${cohortId}.reports.jsonl`;
  await deps.writeText(
    `${out}.partial`,
    `${sorted.map((report) => JSON.stringify(report)).join("\n")}\n`,
  );
  await deps.rename(`${out}.partial`, out);
  io.stdout.write(
    [
      `Synthetic genome reports (${CATALOG_VERSION}) written to ${out}`,
      `Cohort ${cohortId}: ${reports.length} subjects, other files: ${other}`,
      "",
    ].join("\n"),
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { mkdir, readdir, readFile, rename, writeFile } =
    await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { readCatalog } = await import("./read-catalog");
  const toDb = process.argv.includes("--to-db");
  // The database modules are loaded only for --to-db, so the default needs no env.
  const db = toDb
    ? {
        env: await import("../../infrastructure/env"),
        store: await import("../../infrastructure/genome-report-store"),
        database: (await import("../../infrastructure/database")).database,
      }
    : null;
  const code = await runIngest(process.argv.slice(2), process, {
    catalog: () => readCatalog(),
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
      try {
        return JSON.parse(await readFile(path, "utf8")) as unknown;
      } catch {
        return null;
      }
    },
    writeText: async (path, text) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    },
    rename: (from, to) => rename(from, to),
    ...(db === null
      ? {}
      : {
          dataMode: () => db.env.serverEnv().DATA_MODE,
          save: (row: SyntheticRow) =>
            db.store.replaceSyntheticGenomeReport(
              row,
              (cohort) => cohort === row.cohortId && isAllowedCohort(cohort),
            ),
        }),
  });
  if (db !== null) await db.database().$disconnect();
  process.exit(code);
}
