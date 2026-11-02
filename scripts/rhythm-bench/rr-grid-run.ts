/**
 * Host CLI for the RR resolution study (#418):
 *
 *   bun run rhythm-bench:rr-grid -- --out .rhythm-bench/rr-grid-2026-11 \
 *     --afdb ../physionet-afdb/files --ltafdb ../physionet-ltafdb/files
 *
 * Simulates the benchmark grid's AF recordings without beat-detection noise
 * in both AF modes at each grid of STUDY_GRIDS_MS, reads both databases
 * from the given directories (never copied into the repository) and writes
 * summary.json and report.md to --out. All I/O is here.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { recordWindows, simulatedWindows } from "./benchmark";
import { DATABASES, type DatabaseId } from "./databases";
import { readDatabase } from "./read-database";
import {
  isFullAfWindow,
  parseRrGridArgs,
  type RealArm,
  type SimArm,
  STUDY_GRIDS_MS,
  STUDY_MODES,
  STUDY_VERSION,
  studyResult,
  studyTable,
  windowValues,
} from "./rr-grid-study";
import { FULL_GRID, NOISE_LEVELS } from "./sim-grid";

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
  const args = parseRrGridArgs(process.argv.slice(2));
  const started = Date.now();
  // Noise none only, and only conditions with AF: the seeds do not depend on
  // the other cells, so these are the benchmark's own recordings.
  const grid = {
    ...FULL_GRID,
    rhythms: FULL_GRID.rhythms.filter((rhythm) => rhythm.kind !== "sinus"),
    noise: NOISE_LEVELS.filter((noise) => noise.id === "none"),
  };
  const simArms: SimArm[] = STUDY_MODES.flatMap((mode) =>
    STUDY_GRIDS_MS.map((gridMs) => ({
      mode,
      gridMs,
      rows: simulatedWindows({
        seeds: args.seeds,
        bootstrapSeed: args.bootstrapSeed,
        resamples: 0,
        grid,
        afDependence: mode,
        rrGridMs: gridMs,
      })
        .filter(isFullAfWindow)
        .map((row) => windowValues(row, args.bootstrapSeed)),
    })),
  );
  console.log(`simulated in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const sums: Partial<Record<DatabaseId, string | null>> = {};
  const realArms: RealArm[] = [];
  for (const [database, dir] of [
    ["afdb", args.afdb],
    ["ltafdb", args.ltafdb],
  ] as const) {
    const read = await readDatabase(database, dir);
    sums[database] = read.sha256SumsFile;
    realArms.push({
      database,
      rows: read.records
        .flatMap((record) => recordWindows(record))
        .filter((row) => isFullAfWindow(row) && row.dominant === "AFIB")
        .map((row) => windowValues(row, args.bootstrapSeed)),
    });
    console.log(`read ${database} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  const result = studyResult(simArms, realArms, args.resamples, args.bootstrapSeed);
  const summary = {
    study: "rhythm-bench-rr-grid",
    issue: 418,
    version: STUDY_VERSION,
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    options: {
      seeds: args.seeds,
      resamples: args.resamples,
      bootstrapSeed: args.bootstrapSeed,
      gridsMs: STUDY_GRIDS_MS,
      modes: STUDY_MODES,
      windows:
        "full 128-interval windows that are all AF: simulated without beat-detection noise, database all-AFIB",
    },
    databases: realArms.map((arm) => ({
      id: arm.database,
      name: DATABASES[arm.database].name,
      sha256SumsFile: sums[arm.database] ?? null,
    })),
    ...result,
  };
  await mkdir(args.out, { recursive: true });
  await writeFile(
    join(args.out, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const table = `${studyTable(result, "median")}\n\n${studyTable(result, "mean")}`;
  await writeFile(
    join(args.out, "report.md"),
    `# RR resolution study (#418)\n\nMedians and means [95 % CI]. Research use only; describes recordings and methods.\n\n${table}\n`,
  );
  console.log(table);
  console.log(
    `rr-grid study in ${((Date.now() - started) / 1000).toFixed(1)} s, written to ${args.out}`,
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
