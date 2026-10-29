import {
  SYNTHEA_CORE_MODULE_FILES,
  SYNTHEA_JAR_SHA256,
  SYNTHEA_MODULES,
  SYNTHEA_REFERENCE_DATE,
  SYNTHEA_STATES,
  SYNTHEA_VERSION,
  type SyntheaFormat,
  type SyntheaOptions,
} from "./synthea-options";

/**
 * The Java command line and the properties file for one run, built only from
 * checked options. The process is started without a shell (`spawn` with an
 * argument array), and every string placed here comes from this repository's
 * own tables: the state is looked up in `SYNTHEA_STATES` again rather than
 * copied from the request, and module names come from `SYNTHEA_MODULES`.
 *
 * Mirrors `scripts/synthea/generate-local.sh`: UTC, one generator thread, fixed
 * reference and end dates, clinician seed = seed + 1.
 */

export type SyntheaCommand = Readonly<{
  /** Arguments after the Java binary. */
  args: readonly string[];
  seed: number;
  clinicianSeed: number;
}>;

export type CommandPaths = Readonly<{
  jarPath: string;
  /** The properties file written by `buildSyntheaProperties`. */
  configPath: string;
  /** Java's File.pathSeparator on the server (`:` on Linux and macOS). */
  pathDelimiter: string;
}>;

/** JVM heap for one run; 50 people fit well inside it. */
export const SYNTHEA_JAVA_HEAP = "-Xmx1536m";

/** The seed a run uses: the one asked for, or one drawn from `random()` in [0, 1). */
export const resolveSeed = (seed: number | null, random: () => number): number =>
  seed ?? Math.floor(random() * 2_147_483_647);

/** Module file names for `-m`, core modules first; empty means every module. */
export const moduleFiles = (modules: SyntheaOptions["modules"]): readonly string[] =>
  modules.length === 0
    ? []
    : [
        ...SYNTHEA_CORE_MODULE_FILES,
        ...[...modules].sort().flatMap((key) => SYNTHEA_MODULES[key].files),
      ];

const GENDER_FLAG = { any: null, female: "F", male: "M" } as const;

export const buildSyntheaCommand = (
  options: SyntheaOptions,
  seed: number,
  paths: CommandPaths,
): SyntheaCommand => {
  const state = SYNTHEA_STATES.find((name) => name === options.state);
  if (state === undefined) throw new Error("state is not in SYNTHEA_STATES");
  const clinicianSeed = seed + 1;
  const gender = GENDER_FLAG[options.sex];
  const files = moduleFiles(options.modules);
  const args = [
    "-Duser.timezone=UTC",
    SYNTHEA_JAVA_HEAP,
    "-jar",
    paths.jarPath,
    "-c",
    paths.configPath,
    "-s",
    String(seed),
    "-cs",
    String(clinicianSeed),
    "-p",
    String(options.people),
    "-r",
    SYNTHEA_REFERENCE_DATE,
    "-e",
    SYNTHEA_REFERENCE_DATE,
    "-a",
    `${options.ageMin}-${options.ageMax}`,
    ...(gender === null ? [] : ["-g", gender]),
    ...(files.length === 0 ? [] : ["-m", files.join(paths.pathDelimiter)]),
    state,
  ];
  return { args, seed, clinicianSeed };
};

const has = (formats: readonly SyntheaFormat[], format: SyntheaFormat): boolean =>
  formats.includes(format);

/**
 * The Synthea properties for a run in its own folder: only the chosen
 * exporters, no hospital or practitioner files, one generator thread.
 */
export const buildSyntheaProperties = (formats: readonly SyntheaFormat[]): string =>
  [
    "exporter.baseDirectory = ./",
    "exporter.use_uuid_filenames = true",
    `exporter.fhir.export = ${has(formats, "fhir")}`,
    "exporter.fhir.bulk_data = false",
    "exporter.hospital.fhir.export = false",
    "exporter.practitioner.fhir.export = false",
    `exporter.csv.export = ${has(formats, "csv")}`,
    "exporter.metadata.export = false",
    "exporter.ccda.export = false",
    "exporter.text.export = false",
    "exporter.json.export = false",
    "exporter.clinical_note.export = false",
    "generate.thread_pool_size = 1",
    "",
  ].join("\n");

/** `manifest.json` in the zip: what was asked for and how Synthea was run. */
export const runManifest = (
  options: SyntheaOptions,
  command: SyntheaCommand,
  patientFiles: number,
): string =>
  `${JSON.stringify(
    {
      generator: "Synthea",
      syntheaVersion: SYNTHEA_VERSION,
      jarSha256: SYNTHEA_JAR_SHA256,
      synthetic: true,
      people: options.people,
      patientFiles,
      seed: command.seed,
      clinicianSeed: command.clinicianSeed,
      age: `${options.ageMin}-${options.ageMax}`,
      sex: options.sex,
      state: options.state,
      modules: options.modules.length === 0 ? "all" : [...options.modules].sort(),
      formats: options.formats,
      referenceDate: SYNTHEA_REFERENCE_DATE,
      endDate: SYNTHEA_REFERENCE_DATE,
      timezone: "UTC",
      threadPoolSize: 1,
    },
    null,
    2,
  )}\n`;

/** `README.txt` in the zip. */
export const RUN_README = [
  "Synthetic patient records made with Synthea.",
  "",
  "Every person in these files is invented by a simulation. No record describes",
  "a real person. For research and software testing only; not for clinical use.",
  "",
  "Synthea is (c) The MITRE Corporation, licensed under the Apache License 2.0:",
  "https://github.com/synthetichealth/synthea",
  "",
  "manifest.json lists the options, seeds and Synthea version, so the same",
  "options and seed give the same files again.",
  "",
  "Synthea writes one FHIR file per person it simulated, including people who",
  "died during the simulation, so there can be more files than people asked for.",
  "",
].join("\n");
