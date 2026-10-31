/**
 * Host CLI: copies every AF person's record out of the 1M batch archives
 * into one folder for `warehouse:ingest` (#293). Read-only on the archives.
 *
 *   bun run heart-brain:af-subset -- --batches 001-100 --jobs 4 --dest .synthea/synthea-v4-1m-af
 *   bun run warehouse:ingest .synthea/synthea-v4-1m-af/fhir --cohort synthea-v4-1m-af
 *
 * Needs the people files of `bun run heart-brain` (`--out`) to pick the ids.
 * Each archive is streamed through `zstd -dc | tar -x` with one name pattern
 * per id, so only the chosen records are written. Writes `manifest.json`
 * with the cohort id, the rule and the ids' sha256. Prints counts only.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { AF_CODE, AF_COHORT_ID, afSubsetIds, entryPattern } from "./af-subset";
import { parseArgs } from "./args";
import { readPeople } from "./people-files";

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const run = (command: string, cwd: string): Promise<number> =>
  new Promise((done, fail) => {
    const child = spawn("bash", ["-c", command], { cwd, stdio: "inherit" });
    child.on("error", fail);
    child.on("close", (code) => done(code ?? 1));
  });

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

const main = async (argv: readonly string[]): Promise<number> => {
  const dest = flag(argv, "--dest");
  const parsed = parseArgs(
    argv.filter((arg, i) => arg !== "--dest" && argv[i - 1] !== "--dest"),
  );
  if (typeof parsed === "string" || dest === undefined) {
    process.stderr.write(
      `${typeof parsed === "string" ? parsed : "--dest is required"}\n`,
    );
    return 2;
  }
  const out = resolve(parsed.out);
  const archives = resolve(parsed.archives);
  const target = resolve(dest);
  const lists = join(target, "lists");
  await mkdir(join(target, "fhir"), { recursive: true });
  await mkdir(lists, { recursive: true });

  const chosen: string[] = [];
  for (const batch of parsed.batches) {
    const ids = afSubsetIds(await readPeople(out, batch));
    chosen.push(...ids);
    await writeFile(
      join(lists, `batch-${batch}.txt`),
      `${ids.map(entryPattern).join("\n")}\n`,
    );
  }
  process.stdout.write(
    `${chosen.length} people with AF in ${parsed.batches.length} batches\n`,
  );

  await pool(parsed.batches, parsed.jobs, async (batch) => {
    const archive = join(archives, `batch-${batch}.tar.zst`);
    const code = await run(
      `zstd -dc '${archive}' | tar -x --wildcards -f - -T '${join(lists, `batch-${batch}.txt`)}' --strip-components=0`,
      target,
    );
    if (code !== 0) throw new Error(`batch ${batch} failed (exit code ${code})`);
    process.stdout.write(`batch ${batch}: done\n`);
  });

  const written = (await readdir(join(target, "fhir"))).filter((name) =>
    name.endsWith(".json"),
  );
  const manifest = {
    cohortId: AF_COHORT_ID,
    syntheaVersion: "v4.0.0",
    rule: `every person with a ${AF_CODE} (atrial fibrillation) onset in the batches read`,
    batches: parsed.batches,
    endDate: "20260101",
    people: chosen.length,
    files: written.length,
    idsSha256: createHash("sha256")
      .update(chosen.slice().sort().join("\n"))
      .digest("hex"),
  };
  await writeFile(
    join(target, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${written.length} files in ${join(target, "fhir")}\n`);
  return written.length === chosen.length ? 0 : 1;
};

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
