/**
 * Host CLI: the expected AF-to-stroke effect from Synthea's own stroke
 * calculator, against what the designs of #250 and #262 recover (#294).
 *
 *   bun run heart-brain:oracle -- --batches 001-060 --jobs 6
 *
 * Streams each archive read-only once (child processes, `--jobs`) into
 * `<out>/oracle/batch-NNN.jsonl` (person facts plus dated systolic BP,
 * smoking status and wellness visits), kept so a re-run only analyses. Then
 * computes the recovered and the expected rate ratios on the same people and
 * writes `<out>/oracle.json`. Synthetic data only; prints counts, never a person.
 */
import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./args";
import {
  exitCode,
  extractOracleBatch,
  type OracleBatchMeta,
  oracleFile,
  oracleMetaFile,
} from "./oracle-extract";
import { type OraclePerson } from "./oracle-facts";
import { runOracleStudy } from "./oracle-study";

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Runs `work` over items with at most `limit` at once. */
const pool = async <T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> => {
  const queue = [...items];
  const lanes = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item);
    }
  });
  await Promise.all(lanes);
};

const extractInChild = async (batch: string, archives: string, out: string) => {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "--extract-one",
      batch,
      "--archives",
      archives,
      "--out",
      out,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  const code = await exitCode(child);
  if (code !== 0) throw new Error(`batch ${batch} failed (exit code ${code})`);
};

const main = async (argv: readonly string[]): Promise<number> => {
  const extractIndex = argv.indexOf("--extract-one");
  const parsed = parseArgs(
    extractIndex === -1
      ? argv
      : argv.filter((_, i) => i !== extractIndex && i !== extractIndex + 1),
  );
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n`);
    return parsed.startsWith("Usage") ? 0 : 2;
  }
  const archives = resolve(parsed.archives);
  const out = resolve(parsed.out);
  if (extractIndex !== -1) {
    await extractOracleBatch(argv[extractIndex + 1] ?? "", archives, out);
    return 0;
  }

  const todo = [];
  for (const batch of parsed.batches) {
    if (parsed.fresh || !(await exists(oracleMetaFile(out, batch)))) {
      if (!(await exists(join(archives, `batch-${batch}.tar.zst`)))) {
        process.stderr.write(`No archive for batch ${batch} in ${archives}.\n`);
        return 2;
      }
      todo.push(batch);
    }
  }
  process.stdout.write(
    `${parsed.batches.length} batches, ${todo.length} to extract with ${parsed.jobs} jobs\n`,
  );
  const started = Date.now();
  await pool(todo, parsed.jobs, (batch) => extractInChild(batch, archives, out));
  const extractionSeconds = Math.round((Date.now() - started) / 1000);

  const metas: OracleBatchMeta[] = [];
  const people: OraclePerson[] = [];
  for (const batch of parsed.batches) {
    metas.push(
      JSON.parse(await readFile(oracleMetaFile(out, batch), "utf8")) as OracleBatchMeta,
    );
    const text = await readFile(oracleFile(out, batch), "utf8");
    for (const line of text.split("\n")) {
      if (line.length > 0) people.push(JSON.parse(line) as OraclePerson);
    }
  }
  process.stdout.write(`analysing ${people.length} people\n`);
  const analysisStarted = Date.now();
  const study = runOracleStudy(people, {
    endDay: "2026-01-01",
    historyYears: parsed.historyYears,
    seed: parsed.seed,
    controlsPerExposed: parsed.controlsPerExposed,
    afFactor: parsed.afFactor,
  });
  const target = join(out, "oracle.json");
  await writeFile(
    target,
    `${JSON.stringify(
      {
        batches: parsed.batches,
        bundles: metas.reduce((t, m) => t + m.bundles, 0),
        people: metas.reduce((t, m) => t + m.people, 0),
        skipped: metas.reduce((t, m) => t + m.skipped, 0),
        extractionSeconds: todo.length === 0 ? null : extractionSeconds,
        batchSeconds: metas.reduce((t, m) => t + m.seconds, 0),
        ...study,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `wrote ${target}; analysis ${Math.round((Date.now() - analysisStarted) / 1000)} s\n`,
  );
  return 0;
};

if ((import.meta as { main?: boolean }).main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
