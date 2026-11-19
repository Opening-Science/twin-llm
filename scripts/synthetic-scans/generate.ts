/**
 * Host CLI: one synthetic BodyLoop scan for every living subject of a
 * generated Synthea cohort that has a visit with both height and weight,
 * written as FHIR bundles next to the cohort.
 *
 *   bun run scans:generate -- --in .synthea/synthea-v4-seed4242/fhir
 *   bun run warehouse:ingest .synthea/synthea-v4-seed4242/scans --cohort synthea-v4-seed4242
 *
 * The Observations are mapped by @open-twin/provider-vitronic, so the
 * warehouse holds scan measures in the same FHIR shape a real scan sync
 * produces. It reads only Synthea bundles (it refuses anything else), never a
 * scan of a person, and refuses the evaluation cohort, or a cohort no
 * manifest names, unless `--allow-eval-cohort`. Prints counts only.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { EVALUATION_COHORT_IDS } from "../synthea/cohort-presets";
import { syntheaPatientOf } from "../synthetic-wearables/bundle";

import { SCAN_GENERATOR_ID, SCAN_GENERATOR_VERSION, syntheticScanBundle } from "./bundle";
import { syntheticScanOf } from "./scan";

export type ScansIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type ScansDeps = Readonly<{
  /** Absolute paths of *.json files in dir, or null when dir does not exist. */
  listJson: (dir: string) => Promise<readonly string[] | null>;
  /** Parsed JSON, or null when the file is missing or does not parse. */
  readJson: (path: string) => Promise<unknown>;
  writeJson: (path: string, value: unknown) => Promise<void>;
}>;

export type ScansArgs = Readonly<{
  input: string;
  output: string;
  allowEvalCohort: boolean;
}>;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

/** The parsed flags, or a plain message saying what is wrong. */
export const parseScansArgs = (argv: readonly string[]): ScansArgs | string => {
  const input = flag(argv, "--in");
  if (!input) return "Usage: bun run scans:generate -- --in <synthea fhir dir>";
  return {
    input,
    output: flag(argv, "--out") ?? join(dirname(input), "scans"),
    allowEvalCohort: argv.includes("--allow-eval-cohort"),
  };
};

const cohortIdOf = (manifest: unknown): string | null => {
  if (typeof manifest !== "object" || manifest === null) return null;
  const cohortId = Reflect.get(manifest, "cohortId");
  if (typeof cohortId === "string") return cohortId;
  const seed = Reflect.get(manifest, "seed");
  return typeof seed === "number" && Number.isInteger(seed)
    ? `synthea-v4-seed${seed}`
    : null;
};

export const runGenerateScans = async (
  argv: readonly string[],
  io: ScansIo,
  deps: ScansDeps,
): Promise<number> => {
  const args = parseScansArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  const files = await deps.listJson(args.input);
  if (files === null) {
    io.stderr.write(`No such directory: ${args.input}\n`);
    return 1;
  }
  const cohortId = cohortIdOf(
    await deps.readJson(join(dirname(args.input), "manifest.json")),
  );
  if (cohortId === null && !args.allowEvalCohort) {
    io.stderr.write(
      `Refused: no manifest.json next to ${args.input} names the cohort, so it could be the evaluation cohort. Its scans belong only in throwaway databases; pass --allow-eval-cohort for those.\n`,
    );
    return 1;
  }
  if (
    cohortId !== null &&
    EVALUATION_COHORT_IDS.includes(cohortId) &&
    !args.allowEvalCohort
  ) {
    io.stderr.write(
      `Refused: ${cohortId} is the evaluation cohort. Its scans belong only in throwaway databases; pass --allow-eval-cohort for those.\n`,
    );
    return 1;
  }

  let subjects = 0;
  let deceased = 0;
  let unmeasured = 0;
  let skipped = 0;
  for (const file of files) {
    const bundle = await deps.readJson(file);
    const patient = syntheaPatientOf(bundle);
    if (patient === null) {
      // Synthea also writes hospital and practitioner files; they have no Patient.
      skipped += 1;
      continue;
    }
    if (patient.deceased) {
      deceased += 1;
      continue;
    }
    const scan = syntheticScanOf(bundle);
    if (scan === null) {
      unmeasured += 1;
      continue;
    }
    await deps.writeJson(
      join(args.output, `${patient.id}.scan.json`),
      syntheticScanBundle(patient, scan),
    );
    subjects += 1;
  }
  if (subjects === 0) {
    io.stderr.write(
      `No living Synthea subject in ${args.input} has a visit with height and weight\n`,
    );
    return 1;
  }
  await deps.writeJson(join(args.output, "manifest.json"), {
    generator: SCAN_GENERATOR_ID,
    generatorVersion: SCAN_GENERATOR_VERSION,
    ...(cohortId === null ? {} : { cohortId }),
    subjects,
  });
  io.stdout.write(
    [
      `Synthetic scans written to ${args.output} (${SCAN_GENERATOR_ID} v${SCAN_GENERATOR_VERSION})`,
      `Scans: ${subjects}, no height and weight: ${unmeasured}, deceased left out: ${deceased}, other files: ${skipped}`,
      "",
    ].join("\n"),
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runGenerateScans(process.argv.slice(2), process, {
    listJson: async (dir) => {
      try {
        const names = await readdir(resolve(dir));
        return names
          .filter((name) => name.endsWith(".json") && name !== "manifest.json")
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
    writeJson: async (path, value) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
    },
  });
  process.exit(code);
}
