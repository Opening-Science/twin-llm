/**
 * Host CLI: heart and brain relations in the 1M Synthea batches.
 *
 *   bun run heart-brain                              # batch 001, a few minutes
 *   bun run heart-brain -- --batches 001-005 --jobs 5 --out research-out/heart-brain
 *
 * Read-only on the archives: each `batch-NNN.tar.zst` is streamed through
 * `zstd -dc` and read bundle by bundle, never unpacked. One small facts line
 * per person goes to `<out>/people/batch-NNN.jsonl` (kept, so a re-run only
 * analyses), and the run writes `<out>/summary.json` and `<out>/report.md`.
 * Batches are extracted in parallel child processes (`--jobs`). Synthetic data
 * only; prints counts, never a person.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./args";
import { toPerson } from "./cohort";
import { metaFile, peopleFile, readPeople } from "./people-files";
import { type BundleFacts, bundleFacts } from "./person-facts";
import { type BatchRun, buildSummary, renderReport, type Summary } from "./report";
import { runStudy } from "./study";
import { tarEntries } from "./tar-entries";

type Manifest = Readonly<{
  syntheaVersion?: string;
  jarSha256?: string;
  seed?: number;
  clinicianSeed?: number;
  endDate?: string;
}>;

type BatchMeta = BatchRun & Readonly<{ codesSeen: Summary["codesSeen"] }>;

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** `20260101` as `2026-01-01`. */
const isoDay = (compact: string | undefined): string | null =>
  compact !== undefined && /^\d{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
    : null;

/** A counter that sums tallies; its map is the one piece of state it owns. */
const tallyCounter = () => {
  const counts = new Map<string, number>();
  return {
    add: (from: Readonly<Record<string, number>>) => {
      for (const [key, count] of Object.entries(from)) {
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
    },
    value: (): Record<string, number> => Object.fromEntries(counts),
  };
};

/** The exit code of a child process (1 when it was killed by a signal). */
/**
 * The exit code of a child process (1 when a signal ended it). Listens for
 * both "exit" and "close" and checks whether it already ended, so a missed
 * event cannot leave the promise pending: a pending promise with nothing else
 * to wait for lets the runtime quit early with code 0.
 */
const exitCode = (child: ReturnType<typeof spawn>): Promise<number> =>
  new Promise((done, fail) => {
    if (child.exitCode !== null) done(child.exitCode);
    child.on("error", fail);
    child.on("exit", (code) => done(code ?? 1));
    child.on("close", (code) => done(code ?? 1));
  });

/** Streams one archive into its people file; runs in a child process. */
const extractOne = async (
  batch: string,
  archives: string,
  out: string,
): Promise<void> => {
  const archive = join(archives, `batch-${batch}.tar.zst`);
  const manifest = JSON.parse(
    await readFile(join(archives, `batch-${batch}.manifest.json`), "utf8"),
  ) as Manifest;
  const started = Date.now();
  const target = peopleFile(out, batch);
  const writer = createWriteStream(`${target}.partial`);
  const decoder = new TextDecoder();
  const cerebrovascular = tallyCounter();
  const anticoagulants = tallyCounter();
  let bundles = 0;
  let people = 0;
  let skipped = 0;

  const child = spawn("zstd", ["-dc", archive], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = exitCode(child);
  for await (const entry of tarEntries(child.stdout)) {
    if (!entry.name.endsWith(".json")) continue;
    bundles += 1;
    let facts: BundleFacts | null = null;
    try {
      facts = bundleFacts(JSON.parse(decoder.decode(entry.bytes)), batch);
    } catch {
      facts = null;
    }
    if (facts === null) {
      skipped += 1;
    } else {
      people += 1;
      writer.write(`${JSON.stringify(facts.person)}\n`);
      cerebrovascular.add(facts.cerebrovascular);
      anticoagulants.add(facts.anticoagulants);
    }
    if (bundles % 1000 === 0) {
      process.stdout.write(
        `batch ${batch}: ${bundles} bundles, ${Math.round((Date.now() - started) / 1000)} s\n`,
      );
    }
  }
  const code = await exited;
  if (code !== 0) throw new Error(`zstd stopped with exit code ${code} on ${archive}`);
  await new Promise<void>((done, fail) => {
    writer.on("error", fail);
    writer.end(done);
  });
  await rename(`${target}.partial`, target);

  const meta: BatchMeta = {
    batch,
    seed: manifest.seed ?? null,
    clinicianSeed: manifest.clinicianSeed ?? null,
    syntheaVersion: manifest.syntheaVersion ?? null,
    jarSha256: manifest.jarSha256 ?? null,
    endDate: isoDay(manifest.endDate),
    bundles,
    people,
    skipped,
    seconds: Math.round((Date.now() - started) / 1000),
    codesSeen: {
      cerebrovascular: cerebrovascular.value(),
      anticoagulants: anticoagulants.value(),
    },
  };
  await writeFile(metaFile(out, batch), `${JSON.stringify(meta, null, 2)}\n`);
  process.stdout.write(`batch ${batch}: done, ${people} people in ${meta.seconds} s\n`);
};

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
  if (!(await exists(metaFile(out, batch)))) {
    throw new Error(`batch ${batch} ended without writing its people file`);
  }
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
  await mkdir(join(out, "people"), { recursive: true });

  if (extractIndex !== -1) {
    await extractOne(argv[extractIndex + 1] ?? "", archives, out);
    return 0;
  }

  for (const batch of parsed.batches) {
    if (!(await exists(join(archives, `batch-${batch}.tar.zst`)))) {
      process.stderr.write(`No archive for batch ${batch} in ${archives}.\n`);
      return 2;
    }
  }
  const todo = [];
  for (const batch of parsed.batches) {
    if (parsed.fresh || !(await exists(metaFile(out, batch)))) todo.push(batch);
  }
  process.stdout.write(
    `${parsed.batches.length} batches, ${todo.length} to extract with ${parsed.jobs} jobs\n`,
  );
  await pool(todo, parsed.jobs, (batch) => extractInChild(batch, archives, out));

  const metas: BatchMeta[] = [];
  const people = [];
  const cerebrovascular = tallyCounter();
  const anticoagulants = tallyCounter();
  for (const batch of parsed.batches) {
    const meta = JSON.parse(await readFile(metaFile(out, batch), "utf8")) as BatchMeta;
    metas.push(meta);
    cerebrovascular.add(meta.codesSeen.cerebrovascular);
    anticoagulants.add(meta.codesSeen.anticoagulants);
    const end = meta.endDate ?? "2026-01-01";
    for (const facts of await readPeople(out, batch)) {
      people.push(toPerson(facts, end, parsed.historyYears));
    }
  }
  process.stdout.write(`analysing ${people.length} people\n`);

  const options = {
    seed: parsed.seed,
    historyYears: parsed.historyYears,
    controlsPerExposed: parsed.controlsPerExposed,
    permutations: parsed.permutations,
  };
  const study = runStudy(people, options);
  const summary = buildSummary(
    options,
    metas.map(({ codesSeen: _codes, ...run }) => run),
    { cerebrovascular: cerebrovascular.value(), anticoagulants: anticoagulants.value() },
    study,
    new Date().toISOString(),
  );
  await writeFile(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(out, "report.md"), renderReport(summary));
  const afStroke = study.rules.find((rule) => rule.id === "af-stroke");
  process.stdout.write(
    `AF ${study.counts.af}, stroke ${study.counts.stroke}; AF then stroke rate ratio ${afStroke?.ratio?.ratio.toFixed(2) ?? "n/a"}\n`,
  );
  process.stdout.write(
    `wrote ${join(out, "summary.json")} and ${join(out, "report.md")}\n`,
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
