/**
 * The supplementary S7 cohort `synthea-v4-s7` (#277): a small, pinned
 * synthetic cohort with several people whose record has atrial fibrillation,
 * some of them with a stroke and some with Alzheimer's disease, and a few
 * without atrial fibrillation, so the S7b items do not rest on one subject
 * (docs/evaluation/question-set.md, "S7b").
 *
 * Three runs of the pinned Synthea JAR, one per arm, each with its own seed and
 * a keep module (`scripts/synthea/keep/`) that tells Synthea which generated
 * people to keep: Synthea generates people until `population` of them pass.
 * Every run uses the same settings as `generate-local.sh` (Java in UTC, one
 * generator thread, reference and end date 20260101, the same exporter
 * properties) and the same narrowed module list. The patient files of the
 * three runs together are the cohort.
 *
 *   bun run synthea:s7                            # generate → .synthea/synthea-v4-s7/
 *   bun run synthea:s7 -- pack --out-dir <dir>    # tar.zst + the committed manifest
 *   bun run synthea:s7 -- load --archive <file>   # check and unpack a release archive
 *   bun run synthea:s7 -- verify                  # check .synthea/synthea-v4-s7/fhir
 *
 * The cohort files are never committed; `evaluation/cohorts/synthea-v4-s7.manifest.json`
 * holds the recipe, every file's sha256, the `contentSha256` and the archive's
 * sha256. Everything above `main` is pure.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  SYNTHEA_JAR_DEFAULT_PATH,
  SYNTHEA_JAR_SHA256,
  SYNTHEA_VERSION,
} from "../../infrastructure/local-artefacts";
import { contentSha256FromDigests } from "./cohort-checksum";
import { S7_COHORT_ID } from "./cohort-presets";

/** Where `generate` writes and `load` unpacks (gitignored with the rest of `.synthea/`). */
export const S7_COHORT_DIR = ".synthea/synthea-v4-s7";

/** The committed record of the cohort. */
export const S7_MANIFEST_PATH = "evaluation/cohorts/synthea-v4-s7.manifest.json";

export const S7_ARCHIVE_NAME = "supplementary-cohort-synthea-v4-s7-20260101.tar.zst";

/**
 * Check-ups, allergies and medication review (as the generator page's
 * narrowed runs), the three heart-brain modules, and the heart modules whose
 * conditions S7 asks about. Synthea's Java cardiovascular module, which sets
 * the atrial fibrillation and stroke risks, always runs.
 */
export const S7_MODULES = [
  "wellness_encounters",
  "allergies",
  "med_rec",
  "atrial_fibrillation",
  "stroke",
  "dementia",
  "hypertension",
  "stable_ischemic_heart_disease",
  "myocardial_infarction",
  "congestive_heart_failure",
] as const;

export type S7Arm = Readonly<{
  name: string;
  /** File in `scripts/synthea/keep/`. */
  keep: string;
  seed: number;
  clinicianSeed: number;
  /** People Synthea keeps in this run. */
  population: number;
}>;

/** One Synthea run per arm. No seed is shared with another cohort. */
export const S7_ARMS: readonly S7Arm[] = [
  { name: "af", keep: "s7-af.json", seed: 2770, clinicianSeed: 2771, population: 10 },
  {
    name: "af-stroke",
    keep: "s7-af-stroke.json",
    seed: 2772,
    clinicianSeed: 2773,
    population: 3,
  },
  {
    name: "sinus",
    keep: "s7-sinus.json",
    seed: 2774,
    clinicianSeed: 2775,
    population: 4,
  },
];

export const S7_RECIPE = {
  cohortId: S7_COHORT_ID,
  syntheaVersion: SYNTHEA_VERSION,
  jarSha256: SYNTHEA_JAR_SHA256,
  state: "Massachusetts",
  age: "65-90",
  referenceDate: "20260101",
  endDate: "20260101",
  timezone: "UTC",
  threadPoolSize: 1,
  modules: S7_MODULES,
} as const;

/** The same properties `generate-local.sh` writes, so `configSha256` matches the eval cohort's. */
export const S7_PROPERTIES = [
  "exporter.baseDirectory = ./",
  "exporter.use_uuid_filenames = false",
  "exporter.fhir.export = true",
  "exporter.fhir.bulk_data = false",
  "exporter.hospital.fhir.export = false",
  "exporter.practitioner.fhir.export = false",
  "exporter.ccda.export = false",
  "exporter.csv.export = false",
  "exporter.text.export = false",
  "exporter.json.export = false",
  "exporter.bytesize.export = false",
  "exporter.clinical_note.export = false",
  `generate.thread_pool_size = ${S7_RECIPE.threadPoolSize}`,
  "",
].join("\n");

export type ArmPaths = Readonly<{
  jar: string;
  properties: string;
  keepModule: string;
}>;

/** The Java arguments for one arm, as `generate-local.sh` builds them plus `-k` and `-m`. */
export const armJavaArgs = (arm: S7Arm, paths: ArmPaths): readonly string[] => [
  `-Duser.timezone=${S7_RECIPE.timezone}`,
  "-jar",
  paths.jar,
  "-c",
  paths.properties,
  "-s",
  String(arm.seed),
  "-cs",
  String(arm.clinicianSeed),
  "-p",
  String(arm.population),
  "-r",
  S7_RECIPE.referenceDate,
  "-e",
  S7_RECIPE.endDate,
  "-a",
  S7_RECIPE.age,
  "-k",
  paths.keepModule,
  "-m",
  S7_MODULES.join(":"),
  S7_RECIPE.state,
];

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const fileSchema = z
  .object({ name: z.string(), arm: z.string(), bytes: z.number().int(), sha256 })
  .strict();

export type ManifestFile = z.infer<typeof fileSchema>;

export const s7ManifestSchema = z
  .object({
    schema: z.literal("twin-llm.synthea.supplementary-cohort.v1"),
    cohortId: z.literal(S7_COHORT_ID),
    syntheaVersion: z.string(),
    jarSha256: sha256,
    state: z.string(),
    age: z.string(),
    referenceDate: z.string().regex(/^\d{8}$/),
    endDate: z.string().regex(/^\d{8}$/),
    timezone: z.string(),
    threadPoolSize: z.number().int(),
    modules: z.array(z.string()),
    configSha256: sha256,
    javaVersion: z.string(),
    arms: z.array(
      z
        .object({
          name: z.string(),
          keep: z.string(),
          keepSha256: sha256,
          seed: z.number().int(),
          clinicianSeed: z.number().int(),
          population: z.number().int(),
          patientFileCount: z.number().int(),
        })
        .strict(),
    ),
    patientFileCount: z.number().int(),
    contentSha256: sha256,
    files: z.array(fileSchema),
    archive: z
      .object({ name: z.string(), bytes: z.number().int(), sha256 })
      .strict()
      .optional(),
  })
  .strict();

export type S7Manifest = z.infer<typeof s7ManifestSchema>;

export type ManifestInput = Readonly<{
  configSha256: string;
  javaVersion: string;
  keepSha256: Readonly<Record<string, string>>;
  files: readonly ManifestFile[];
}>;

/** The manifest of a generated cohort, files in name order. */
export const buildS7Manifest = (input: ManifestInput): S7Manifest => {
  const files = [...input.files].sort((a, b) => (a.name < b.name ? -1 : 1));
  return s7ManifestSchema.parse({
    schema: "twin-llm.synthea.supplementary-cohort.v1",
    ...S7_RECIPE,
    modules: [...S7_RECIPE.modules],
    configSha256: input.configSha256,
    javaVersion: input.javaVersion,
    arms: S7_ARMS.map((arm) => ({
      ...arm,
      keepSha256: input.keepSha256[arm.keep] ?? "",
      patientFileCount: files.filter((file) => file.arm === arm.name).length,
    })),
    patientFileCount: files.length,
    contentSha256: contentSha256FromDigests(files),
    files,
  });
};

export type FileDigest = Readonly<{ name: string; sha256: string }>;

/** What differs between a folder's patient files and the manifest; empty when they match. */
export const manifestProblems = (
  manifest: S7Manifest,
  actual: readonly FileDigest[],
): readonly string[] => {
  const expected = new Map(manifest.files.map((file) => [file.name, file.sha256]));
  const seen = new Map(actual.map((file) => [file.name, file.sha256]));
  const missing = [...expected.keys()]
    .filter((name) => !seen.has(name))
    .map((name) => `missing ${name}`);
  const extra = [...seen.keys()]
    .filter((name) => !expected.has(name))
    .map((name) => `not in the manifest: ${name}`);
  const changed = [...expected.entries()]
    .filter(([name, hash]) => seen.has(name) && seen.get(name) !== hash)
    .map(([name]) => `sha256 differs: ${name}`);
  const content = contentSha256FromDigests(actual);
  const total =
    content === manifest.contentSha256
      ? []
      : [`contentSha256 ${content} is not ${manifest.contentSha256}`];
  return [...missing, ...extra, ...changed, ...total];
};

/** The Java runtime version from `java -XshowSettings:properties -version` output. */
export const javaRuntimeVersion = (output: string): string =>
  /java\.runtime\.version = (\S+)/.exec(output)?.[1] ?? "unknown";

// ---------------------------------------------------------------------------
// I/O

const hashFile = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const jsonFiles = async (dir: string): Promise<string[]> =>
  (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();

const digestsOf = async (dir: string): Promise<FileDigest[]> => {
  const digests: FileDigest[] = [];
  for (const name of await jsonFiles(dir)) {
    digests.push({ name, sha256: await hashFile(join(dir, name)) });
  }
  return digests;
};

class CohortError extends Error {}

const javaVersion = (): string => {
  const result = spawnSync("java", ["-XshowSettings:properties", "-version"], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new CohortError("Java 21+ is required (java not on PATH)");
  return javaRuntimeVersion(`${result.stdout}${result.stderr}`);
};

const generate = async (root: string): Promise<void> => {
  const jar = resolve(root, SYNTHEA_JAR_DEFAULT_PATH);
  const jarSha = await hashFile(jar).catch(() => {
    throw new CohortError(
      `no Synthea JAR at ${SYNTHEA_JAR_DEFAULT_PATH}; run bun run synthea:generate once`,
    );
  });
  if (jarSha !== SYNTHEA_JAR_SHA256) {
    throw new CohortError(`JAR checksum ${jarSha} is not ${SYNTHEA_JAR_SHA256}`);
  }
  const java = javaVersion();
  const out = resolve(root, S7_COHORT_DIR);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "fhir"), { recursive: true });
  const files: ManifestFile[] = [];
  const keepSha256: Record<string, string> = {};
  for (const arm of S7_ARMS) {
    const runDir = join(out, "runs", arm.name);
    await mkdir(runDir, { recursive: true });
    const properties = join(runDir, "synthea.properties");
    await writeFile(properties, S7_PROPERTIES);
    const keepModule = resolve(root, "scripts/synthea/keep", arm.keep);
    keepSha256[arm.keep] = await hashFile(keepModule);
    process.stdout.write(
      `synthea: ${S7_COHORT_ID} arm ${arm.name}: seed ${arm.seed}, ${arm.population} people\n`,
    );
    const run = spawnSync(
      "java",
      [...armJavaArgs(arm, { jar, properties, keepModule })],
      {
        cwd: runDir,
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    if (run.status !== 0) throw new CohortError(`Synthea failed for arm ${arm.name}`);
    for (const name of await jsonFiles(join(runDir, "fhir"))) {
      const target = join(out, "fhir", name);
      if (files.some((file) => file.name === name)) {
        throw new CohortError(`two arms wrote ${name}`);
      }
      await copyFile(join(runDir, "fhir", name), target);
      files.push({
        name,
        arm: arm.name,
        bytes: (await stat(target)).size,
        sha256: await hashFile(target),
      });
    }
  }
  const manifest = buildS7Manifest({
    configSha256: createHash("sha256").update(S7_PROPERTIES).digest("hex"),
    javaVersion: java,
    keepSha256,
    files,
  });
  await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `synthea: ${manifest.patientFileCount} patient files, contentSha256 ${manifest.contentSha256}\n`,
  );
};

const readManifest = async (path: string): Promise<S7Manifest> =>
  s7ManifestSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);

const formatJson = async (value: unknown, path: string): Promise<string> => {
  const prettier = await import("prettier");
  const options = await prettier.resolveConfig(path);
  return prettier.format(JSON.stringify(value), { ...options, parser: "json" });
};

/** Pack `fhir/` reproducibly (sorted, mtime 0, owner 0) and write the committed manifest. */
const pack = async (root: string, outDir: string): Promise<void> => {
  const dir = resolve(root, S7_COHORT_DIR);
  const manifest = await readManifest(join(dir, "manifest.json"));
  const problems = manifestProblems(manifest, await digestsOf(join(dir, "fhir")));
  if (problems.length > 0) throw new CohortError(problems.join("; "));
  await mkdir(outDir, { recursive: true });
  const archive = join(resolve(outDir), S7_ARCHIVE_NAME);
  const tar = spawnSync(
    "sh",
    [
      "-c",
      'tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$1" -cf - fhir | zstd -19 -q -f -o "$2"',
      "sh",
      dir,
      archive,
    ],
    { stdio: "inherit" },
  );
  if (tar.status !== 0) throw new CohortError("tar or zstd failed");
  const packed = {
    ...manifest,
    archive: {
      name: S7_ARCHIVE_NAME,
      bytes: (await stat(archive)).size,
      sha256: await hashFile(archive),
    },
  };
  const target = resolve(root, S7_MANIFEST_PATH);
  await mkdir(resolve(root, "evaluation/cohorts"), { recursive: true });
  await writeFile(target, await formatJson(packed, target));
  process.stdout.write(`${packed.archive.sha256}  ${S7_ARCHIVE_NAME}\n`);
};

/** Check an archive against the committed manifest, unpack it and check every file. */
const load = async (root: string, archive: string): Promise<void> => {
  const manifest = await readManifest(resolve(root, S7_MANIFEST_PATH));
  if (manifest.archive === undefined)
    throw new CohortError("the manifest has no archive");
  if (basename(archive) !== manifest.archive.name) {
    throw new CohortError(`expected ${manifest.archive.name}`);
  }
  const archiveSha = await hashFile(archive);
  if (archiveSha !== manifest.archive.sha256) {
    throw new CohortError(
      `archive sha256 ${archiveSha} is not ${manifest.archive.sha256}`,
    );
  }
  const dir = resolve(root, S7_COHORT_DIR);
  await rm(join(dir, "fhir"), { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const untar = spawnSync(
    "sh",
    ["-c", 'zstd -dc "$1" | tar -xf - -C "$2"', "sh", archive, dir],
    { stdio: "inherit" },
  );
  if (untar.status !== 0) throw new CohortError("zstd or tar failed");
  await verify(root);
  const { archive: _archive, ...generated } = manifest;
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(generated, null, 2)}\n`);
};

const verify = async (root: string): Promise<void> => {
  const manifest = await readManifest(resolve(root, S7_MANIFEST_PATH));
  const problems = manifestProblems(
    manifest,
    await digestsOf(resolve(root, S7_COHORT_DIR, "fhir")),
  );
  if (problems.length > 0) throw new CohortError(problems.join("; "));
  process.stdout.write(
    `synthea: ${S7_COHORT_ID} ok, ${manifest.patientFileCount} files, contentSha256 ${manifest.contentSha256}\n`,
  );
};

const flag = (argv: readonly string[], name: string): string | null => {
  const index = argv.indexOf(name);
  return index === -1 ? null : (argv[index + 1] ?? null);
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const argv = process.argv.slice(2).filter((arg) => arg !== "--");
  const command = argv[0] ?? "generate";
  try {
    if (command === "generate") await generate(root);
    else if (command === "pack") await pack(root, flag(argv, "--out-dir") ?? ".");
    else if (command === "load") {
      const archive = flag(argv, "--archive");
      if (archive === null) throw new CohortError("load needs --archive <file>");
      await load(root, resolve(archive));
    } else if (command === "verify") await verify(root);
    else
      throw new CohortError(`unknown command ${command} (generate, pack, load, verify)`);
  } catch (error) {
    process.stderr.write(
      `synthea: ${error instanceof CohortError ? error.message : "failed"}\n`,
    );
    process.exit(1);
  }
}
