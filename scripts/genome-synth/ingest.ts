/**
 * Host CLI: synthetic rsid-genotypes reports for every subject of a Synthea
 * cohort, one JSON line per subject.
 *
 *   bun run genome:ingest -- --in .synthea/synthea-v4-seed4242/fhir
 *   bun run genome:ingest -- --in .synthea/fhir --cohort synthea-v4-seed42 --out <file>
 *
 * Each line is what the Ark returns for an approved app run (`{ report }`,
 * packages/ark-adapter) plus the subject and app it belongs to, so a reader
 * can treat it as a released report. The genome bridge's database table is
 * not on main yet; until it is, this writes `data/genome-synth/<cohort>.reports.jsonl`
 * (gitignored) and touches no database. Reads only Synthea bundles (the
 * Patient id is the subject_ref), refuses cohorts outside the synthetic
 * allowlist, writes `.partial` first and renames when done. Prints counts only.
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

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

export type IngestArgs = Readonly<{
  input: string;
  cohortId: string | null;
  out: string | null;
}>;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

export const parseIngestArgs = (argv: readonly string[]): IngestArgs | string => {
  const input = flag(argv, "--in");
  if (!input) {
    return "Usage: bun run genome:ingest -- --in <synthea fhir dir> [--cohort <id>] [--out <file>]";
  }
  return {
    input,
    cohortId: flag(argv, "--cohort") ?? null,
    out: flag(argv, "--out") ?? null,
  };
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
}>;

export const runIngest = async (
  argv: readonly string[],
  io: Readonly<{
    stdout: { write: (s: string) => void };
    stderr: { write: (s: string) => void };
  }>,
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
  const lines: string[] = [];
  let other = 0;
  for (const file of files) {
    const patient = syntheaPatientOf(await deps.readJson(file));
    if (patient === null) {
      // Synthea also writes hospital and practitioner files; they have no Patient.
      other += 1;
      continue;
    }
    lines.push(JSON.stringify(releasedReport(patient.id, cohortId, catalog)));
  }
  if (lines.length === 0) {
    io.stderr.write(`No Synthea subjects in ${args.input}\n`);
    return 1;
  }
  const out = args.out ?? `data/genome-synth/${cohortId}.reports.jsonl`;
  await deps.writeText(`${out}.partial`, `${[...lines].sort().join("\n")}\n`);
  await deps.rename(`${out}.partial`, out);
  io.stdout.write(
    [
      `Synthetic genome reports (${CATALOG_VERSION}) written to ${out}`,
      `Cohort ${cohortId}: ${lines.length} subjects, other files: ${other}`,
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
  });
  process.exit(code);
}
