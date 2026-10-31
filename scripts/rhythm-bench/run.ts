/**
 * Host CLI for the rhythm benchmark (#249):
 *
 *   bun run rhythm-bench -- --out .rhythm-bench/run --afdb ../physionet-afdb/files
 *   bun run rhythm-bench -- --out .rhythm-bench/quick --seeds 3 --quick
 *   bun run rhythm-bench -- --out .rhythm-bench/noise --afdb ../physionet-afdb/files --real-noise
 *   bun run rhythm-bench -- --out .rhythm-bench/lt --ltafdb ../physionet-ltafdb/files --real-noise
 *   bun run rhythm-bench -- --out .rhythm-bench/dep --afdb ../physionet-afdb/files --af-dependence short_range
 *
 * Reads the MIT-BIH Atrial Fibrillation Database or the Long-Term AF Database
 * from the given directory (never copied into the repository), runs `runBenchmark` and writes
 * result.json, report.md and figure-ready CSVs to --out. All I/O is here.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseArgs } from "./args";
import { type AfdbRecordInput, runBenchmark } from "./benchmark";
import {
  type BeatAnnotator,
  DATABASES,
  type DatabaseId,
  type DatabaseSpec,
  pickBeats,
} from "./databases";
import { beatSamples, parseMitAnnotations, rhythmChanges } from "./mit-annotations";
import {
  distributionCsv,
  markdownReport,
  realWindowsCsv,
  realNoiseCsv,
  realNoiseWindowsCsv,
  rocCsv,
  simWindowsCsv,
} from "./report";
import { AF_RATES, FULL_GRID, NOISE_LEVELS, RHYTHM_CONDITIONS } from "./sim-grid";
import { parseWfdbHeader } from "./wfdb-header";

const QUICK_GRID = {
  durations: [60, 300],
  rhythms: RHYTHM_CONDITIONS.filter((each) =>
    ["sinus+ectopy-2/1", "paroxysmal-30%", "persistent"].includes(each.id),
  ),
  afRates: [AF_RATES[1]],
  noise: NOISE_LEVELS.filter((each) => each.id !== "light"),
};

const annotationsIn = async (path: string) =>
  existsSync(path) ? parseMitAnnotations(new Uint8Array(await readFile(path))) : null;

/**
 * One record: header, reference rhythm and beats from the database's beat
 * source. Only beat samples and rhythm changes are kept; the signal files are
 * never opened, so a 24 h record costs its annotation files, not its signal.
 */
const readRecord = async (
  spec: DatabaseSpec,
  dir: string,
  record: string,
): Promise<AfdbRecordInput> => {
  const header = parseWfdbHeader(await readFile(join(dir, `${record}.hea`), "utf8"));
  const reference = await annotationsIn(join(dir, `${record}.atr`));
  if (reference === null) throw new Error(`${record}.atr is missing in ${dir}`);
  const parsed: Partial<Record<BeatAnnotator, number[]>> = {};
  for (const source of spec.beatSources) {
    const annotations =
      source === "atr"
        ? reference
        : await annotationsIn(join(dir, `${record}.${source}`));
    if (annotations !== null) parsed[source] = beatSamples(annotations);
  }
  const picked = pickBeats(spec.beatSources, parsed);
  if (picked === null) throw new Error(`no beat annotations for ${record} in ${dir}`);
  return {
    record,
    beatAnnotator: picked.source,
    samplingHz: header.samplingHz,
    hasSignalFile: existsSync(join(dir, `${record}.dat`)),
    beats: picked.beats,
    rhythmChanges: rhythmChanges(reference),
  };
};

/** Every record in RECORDS, read one after another to keep memory to one record's files. */
const readDatabase = async (id: DatabaseId, dir: string) => {
  const spec = DATABASES[id];
  const names = (await readFile(join(dir, "RECORDS"), "utf8"))
    .split(/\s+/)
    .filter((name) => name.length > 0);
  const records: AfdbRecordInput[] = [];
  for (const name of names) records.push(await readRecord(spec, dir, name));
  const sums = join(dir, "SHA256SUMS.txt");
  return {
    database: id,
    records,
    sha256SumsFile: existsSync(sums)
      ? createHash("sha256")
          .update(await readFile(sums))
          .digest("hex")
      : null,
  };
};

const gitSha = (): string => {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim();
    return dirty.length > 0 ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const afdb =
    args.database === null
      ? null
      : await readDatabase(args.database.id, args.database.dir);
  const data = runBenchmark({
    options: {
      seeds: args.seeds,
      bootstrapSeed: args.bootstrapSeed,
      resamples: args.resamples,
      grid: args.quick ? QUICK_GRID : FULL_GRID,
      realNoise: args.realNoise,
      // Only named when not the default, so independent runs keep their run id.
      ...(args.afDependence === "independent" ? {} : { afDependence: args.afDependence }),
    },
    gitSha: gitSha(),
    afdb,
  });
  const generatedAt = new Date().toISOString();
  await mkdir(args.out, { recursive: true });
  await writeFile(
    join(args.out, "result.json"),
    `${JSON.stringify({ generatedAt, ...data.result }, null, 2)}\n`,
  );
  await writeFile(join(args.out, "report.md"), markdownReport(data.result, generatedAt));
  await writeFile(join(args.out, "windows-sim.csv"), simWindowsCsv(data));
  await writeFile(join(args.out, "windows-real.csv"), realWindowsCsv(data));
  await writeFile(join(args.out, "roc.csv"), rocCsv(data));
  await writeFile(join(args.out, "distributions.csv"), distributionCsv(data));
  if (data.result.realNoise !== null) {
    await writeFile(join(args.out, "real-noise.csv"), realNoiseCsv(data.result));
    await writeFile(join(args.out, "windows-real-noise.csv"), realNoiseWindowsCsv(data));
  }
  console.log(
    `rhythm-bench ${data.result.runId}: ${data.simRows.length} simulated and ${data.realRows.length} database windows in ${((Date.now() - started) / 1000).toFixed(1)} s, written to ${args.out}`,
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
