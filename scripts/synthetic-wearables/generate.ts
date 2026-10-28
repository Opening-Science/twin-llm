/**
 * Host CLI: synthetic wearable series for every living subject of a generated
 * Synthea cohort, written as FHIR bundles next to the cohort.
 *
 *   bun run wearables:generate -- --in .synthea/synthea-v4-seed4242/fhir
 *   bun run wearables:generate -- --in <dir> --out <dir> --seed 4242 --end 2026-10-01 --days 90
 *   bun run warehouse:ingest .synthea/synthea-v4-seed4242/wearables --cohort synthea-v4-seed4242
 *
 * It refuses the evaluation cohort unless `--allow-eval-cohort`: the
 * answer-key and eval databases load its series (docs/evaluation/question-set.md),
 * the dev database never does.
 *
 * The seed defaults to the cohort's own (from manifest.json next to <in>), so a
 * cohort and its series are rebuilt from one number. Reads only Synthea
 * bundles (it refuses anything else), never personal wearable data. Prints
 * counts only.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  GENERATOR_ID,
  syntheaPatientOf,
  WEARABLE_GENERATOR_VERSION,
  wearableBundle,
} from "./bundle";
import { EVALUATION_COHORT_IDS } from "../synthea/cohort-presets";

import { DEFAULT_DAYS, DEFAULT_END_DAY, generateSeries } from "./series";
import { generateWorkouts } from "./workouts";

export type WearablesIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type WearablesDeps = Readonly<{
  /** Absolute paths of *.json files in dir, or null when dir does not exist. */
  listJson: (dir: string) => Promise<readonly string[] | null>;
  /** Parsed JSON, or null when the file is missing or does not parse. */
  readJson: (path: string) => Promise<unknown>;
  writeJson: (path: string, value: unknown) => Promise<void>;
}>;

export type WearablesArgs = Readonly<{
  input: string;
  output: string;
  seed: number | null;
  endDay: string;
  days: number;
  /** The evaluation cohort's series, for the answer-key and eval databases only. */
  allowEvalCohort: boolean;
}>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

/** The parsed flags, or a plain message saying what is wrong. */
export const parseWearablesArgs = (argv: readonly string[]): WearablesArgs | string => {
  const input = flag(argv, "--in");
  if (!input) return "Usage: bun run wearables:generate -- --in <synthea fhir dir>";
  const seedText = flag(argv, "--seed");
  const seed = seedText === undefined ? null : Number(seedText);
  if (seed !== null && !(Number.isInteger(seed) && seed >= 0)) {
    return "--seed must be a whole number.";
  }
  const endDay = flag(argv, "--end") ?? DEFAULT_END_DAY;
  if (!ISO_DAY.test(endDay) || Number.isNaN(Date.parse(`${endDay}T00:00:00Z`))) {
    return "--end must be a date like 2026-10-01.";
  }
  const days = Number(flag(argv, "--days") ?? DEFAULT_DAYS);
  if (!(Number.isInteger(days) && days >= 1 && days <= 730)) {
    return "--days must be a whole number from 1 to 730.";
  }
  return {
    input,
    output: flag(argv, "--out") ?? join(dirname(input), "wearables"),
    seed,
    endDay,
    days,
    allowEvalCohort: argv.includes("--allow-eval-cohort"),
  };
};

type CohortManifest = Readonly<{
  seed: number | null;
  syntheaVersion: string | null;
  cohortId: string | null;
}>;

/** An older manifest has no cohortId; its seed still names the cohort. */
const manifestOf = (value: unknown): CohortManifest => {
  if (typeof value !== "object" || value === null) {
    return { seed: null, syntheaVersion: null, cohortId: null };
  }
  const seedValue = Reflect.get(value, "seed");
  const version = Reflect.get(value, "syntheaVersion");
  const cohortValue = Reflect.get(value, "cohortId");
  const seed =
    typeof seedValue === "number" && Number.isInteger(seedValue) ? seedValue : null;
  return {
    seed,
    syntheaVersion: typeof version === "string" ? version : null,
    cohortId:
      typeof cohortValue === "string"
        ? cohortValue
        : seed === null
          ? null
          : `synthea-v4-seed${seed}`,
  };
};

export const runGenerateWearables = async (
  argv: readonly string[],
  io: WearablesIo,
  deps: WearablesDeps,
): Promise<number> => {
  const args = parseWearablesArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  const files = await deps.listJson(args.input);
  if (files === null) {
    io.stderr.write(`No such directory: ${args.input}\n`);
    return 1;
  }
  const cohort = manifestOf(
    await deps.readJson(join(dirname(args.input), "manifest.json")),
  );
  if (
    cohort.cohortId !== null &&
    EVALUATION_COHORT_IDS.includes(cohort.cohortId) &&
    !args.allowEvalCohort
  ) {
    io.stderr.write(
      `Refused: ${cohort.cohortId} is the evaluation cohort. Its series belong only in the throwaway answer-key and eval databases (docs/evaluation/question-set.md); pass --allow-eval-cohort for those.\n`,
    );
    return 1;
  }
  const seed = args.seed ?? cohort.seed;
  if (seed === null) {
    io.stderr.write("No seed: pass --seed or keep manifest.json next to the fhir dir.\n");
    return 1;
  }

  let subjects = 0;
  let deceased = 0;
  let skipped = 0;
  let readings = 0;
  for (const file of files) {
    const patient = syntheaPatientOf(await deps.readJson(file));
    if (patient === null) {
      // Synthea also writes hospital and practitioner files; they have no Patient.
      skipped += 1;
      continue;
    }
    if (patient.deceased) {
      deceased += 1;
      continue;
    }
    const options = {
      seed,
      subjectRef: patient.id,
      endDay: args.endDay,
      days: args.days,
    };
    const daily = generateSeries(options);
    const series = [...daily, ...generateWorkouts(options, daily)];
    await deps.writeJson(
      join(args.output, `${patient.id}.wearables.json`),
      wearableBundle(patient, series),
    );
    subjects += 1;
    readings += series.length;
  }
  if (subjects === 0) {
    io.stderr.write(`No living Synthea subjects in ${args.input}\n`);
    return 1;
  }
  await deps.writeJson(join(args.output, "manifest.json"), {
    generator: GENERATOR_ID,
    generatorVersion: WEARABLE_GENERATOR_VERSION,
    ...(cohort.cohortId === null ? {} : { cohortId: cohort.cohortId }),
    seed,
    endDay: args.endDay,
    days: args.days,
    subjects,
    readings,
    ...(cohort.syntheaVersion === null ? {} : { syntheaVersion: cohort.syntheaVersion }),
  });
  io.stdout.write(
    [
      `Synthetic wearables written to ${args.output} (${GENERATOR_ID} v${WEARABLE_GENERATOR_VERSION}, seed ${seed})`,
      `Subjects: ${subjects}, deceased left out: ${deceased}, other files: ${skipped}`,
      `Readings: ${readings} over ${args.days} days ending ${args.endDay}`,
      "",
    ].join("\n"),
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runGenerateWearables(process.argv.slice(2), process, {
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
    writeJson: async (path, value) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value));
    },
  });
  process.exit(code);
}
