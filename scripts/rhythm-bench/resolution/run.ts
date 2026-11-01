/**
 * Host CLI for the resolution study (#290): how much AF signal survives from
 * beats to 30 s, 5 min, hourly and daily summaries.
 *
 *   bun run rhythm-bench:resolution -- --out .rhythm-bench/resolution-2026-10 \
 *     --afdb ../physionet-afdb/files --ltafdb ../physionet-ltafdb/files
 *
 * Simulates whole days with packages/rhythm-sim (read only), reads the
 * databases from the given directories (never copied into the repository)
 * and writes summary.json and report.md to --out. All I/O is here.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DATABASES, type DatabaseId } from "../databases";
import { readDatabase } from "../read-database";
import { NOISE_LEVELS } from "../sim-grid";
import { parseArgs } from "./args";
import { recordIntervals } from "./real";
import { type DatabaseNote, markdownReport, type ResolutionSummary } from "./report";
import {
  dailyEffects,
  dayAurocs,
  DEFAULT_BURDENS,
  hourAurocs,
  type HourRow,
  hourRows,
  simulateRows,
  STUDY_VERSION,
  type StudyOptions,
} from "./study";

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

const databaseHours = async (
  id: DatabaseId,
  dir: string,
): Promise<{ note: DatabaseNote; rows: HourRow[] }> => {
  const database = await readDatabase(id, dir);
  const rows = database.records.flatMap((record) =>
    hourRows(record.record, recordIntervals(record), "none"),
  );
  return {
    note: {
      id,
      name: DATABASES[id].name,
      records: database.records.length,
      hours: rows.length,
      sha256SumsFile: database.sha256SumsFile,
    },
    rows,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const options: StudyOptions = {
    subjects: args.subjects,
    baselineDays: 3,
    sinusDays: 4,
    burdens: DEFAULT_BURDENS,
    noise: NOISE_LEVELS.filter((level) => level.id !== "heavy"),
    resamples: args.resamples,
    bootstrapSeed: args.bootstrapSeed,
  };
  const simulated = simulateRows(options, (done, total) => {
    if (done % 20 === 0 || done === total)
      process.stdout.write(`simulated ${done}/${total} days\n`);
  });
  const databases = [];
  for (const [id, dir] of [
    ["afdb", args.afdb],
    ["ltafdb", args.ltafdb],
  ] as const) {
    if (dir !== null) databases.push(await databaseHours(id, dir));
  }
  const noiseIds = options.noise.map((level) => level.id);
  const summary: ResolutionSummary = {
    title: "AF signal from beats to daily summaries (#290)",
    note: "Simulated days from packages/rhythm-sim and open annotated databases; methods on recordings, not people. Research use only, not medical advice.",
    version: STUDY_VERSION,
    gitSha: gitSha(),
    options: { ...options, noise: noiseIds },
    counts: {
      days: simulated.days.length / options.noise.length,
      simulatedHours: simulated.hours.length / options.noise.length,
    },
    databases: databases.map((each) => each.note),
    dayAurocs: dayAurocs(simulated.days, options),
    hourAurocs: [
      ...hourAurocs("sim", simulated.hours, noiseIds, options),
      ...databases.flatMap((each) =>
        hourAurocs(each.note.id, each.rows, ["none"], options),
      ),
    ],
    dailyEffects: dailyEffects(simulated.days, options),
  };
  const generatedAt = new Date().toISOString();
  await mkdir(args.out, { recursive: true });
  await writeFile(
    join(args.out, "summary.json"),
    `${JSON.stringify({ generatedAt, ...summary }, null, 2)}\n`,
  );
  await writeFile(join(args.out, "report.md"), markdownReport(summary, generatedAt));
  process.stdout.write(
    `resolution study: ${summary.counts.days} days, ${databases.length} databases in ${((Date.now() - started) / 1000).toFixed(0)} s, written to ${args.out}\n`,
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
