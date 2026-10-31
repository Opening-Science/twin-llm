/**
 * Host CLI step for `bun run heart-brain:oracle`: streams one batch archive
 * read-only and writes one line per person with the facts of
 * `person-facts.ts` and the oracle inputs of `oracle-facts.ts` to
 * `<out>/oracle/batch-NNN.jsonl`. Run in a child process per batch by
 * `oracle-run.ts`. Synthetic data only; prints counts, never a person.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { oracleFacts, type OraclePerson } from "./oracle-facts";
import { bundleFacts } from "./person-facts";
import { tarEntries } from "./tar-entries";

export const oracleFile = (out: string, batch: string): string =>
  join(out, "oracle", `batch-${batch}.jsonl`);

export const oracleMetaFile = (out: string, batch: string): string =>
  join(out, "oracle", `batch-${batch}.meta.json`);

export type OracleBatchMeta = Readonly<{
  batch: string;
  bundles: number;
  people: number;
  skipped: number;
  seconds: number;
}>;

/** Exit code of a child process (1 when a signal ended it). */
export const exitCode = (child: ReturnType<typeof spawn>): Promise<number> =>
  new Promise((done, fail) => {
    if (child.exitCode !== null) done(child.exitCode);
    child.on("error", fail);
    child.on("exit", (code) => done(code ?? 1));
    child.on("close", (code) => done(code ?? 1));
  });

export const extractOracleBatch = async (
  batch: string,
  archives: string,
  out: string,
): Promise<OracleBatchMeta> => {
  await mkdir(join(out, "oracle"), { recursive: true });
  const archive = join(archives, `batch-${batch}.tar.zst`);
  const started = Date.now();
  const target = oracleFile(out, batch);
  const writer = createWriteStream(`${target}.partial`);
  const decoder = new TextDecoder();
  let bundles = 0;
  let people = 0;
  let skipped = 0;

  const child = spawn("zstd", ["-dc", archive], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = exitCode(child);
  for await (const entry of tarEntries(child.stdout)) {
    if (!entry.name.endsWith(".json")) continue;
    bundles += 1;
    let line: OraclePerson | null = null;
    try {
      const bundle: unknown = JSON.parse(decoder.decode(entry.bytes));
      const facts = bundleFacts(bundle, batch);
      const entries =
        typeof bundle === "object" &&
        bundle !== null &&
        Array.isArray((bundle as { entry?: unknown }).entry)
          ? ((bundle as { entry: unknown[] }).entry as readonly unknown[])
          : [];
      line = facts === null ? null : { ...facts.person, oracle: oracleFacts(entries) };
    } catch {
      line = null;
    }
    if (line === null) {
      skipped += 1;
    } else {
      people += 1;
      writer.write(`${JSON.stringify(line)}\n`);
    }
    if (bundles % 2000 === 0) {
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
  const meta: OracleBatchMeta = {
    batch,
    bundles,
    people,
    skipped,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  await writeFile(oracleMetaFile(out, batch), `${JSON.stringify(meta, null, 2)}\n`);
  process.stdout.write(`batch ${batch}: done, ${people} people in ${meta.seconds} s\n`);
  return meta;
};
