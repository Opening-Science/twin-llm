/**
 * Host CLI: the within-person timing study (#262) over people files that
 * `bun run heart-brain` already wrote.
 *
 *   bun run heart-brain -- --batches 001-100 --jobs 6     # extract first
 *   bun run heart-brain:timing -- --batches 001-100
 *
 * Reads `<out>/people/batch-NNN.jsonl` (never the archives) and writes
 * `<out>/timing.json`. Prints counts only.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseArgs } from "./args";
import { toPerson } from "./cohort";
import { metaFile, readPeople } from "./people-files";
import { runTiming } from "./timing";

const main = async (argv: readonly string[]): Promise<number> => {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n`);
    return parsed.startsWith("Usage") ? 0 : 2;
  }
  const out = resolve(parsed.out);
  const people = [];
  for (const batch of parsed.batches) {
    let endDate = "2026-01-01";
    try {
      const meta = JSON.parse(await readFile(metaFile(out, batch), "utf8")) as {
        endDate?: string | null;
      };
      endDate = meta.endDate ?? endDate;
    } catch {
      process.stderr.write(
        `Batch ${batch} has no people file in ${out}; run heart-brain first.\n`,
      );
      return 2;
    }
    for (const facts of await readPeople(out, batch)) {
      people.push(toPerson(facts, endDate, parsed.historyYears));
    }
  }
  process.stdout.write(`timing study over ${people.length} people\n`);
  const started = Date.now();
  const study = runTiming(people, {
    seed: parsed.seed,
    permutations: parsed.permutations,
  });
  const target = join(out, "timing.json");
  await writeFile(
    target,
    `${JSON.stringify({ batches: parsed.batches, historyYears: parsed.historyYears, ...study }, null, 2)}\n`,
  );
  for (const arm of study.arms) {
    const within = arm.withinPerson.after;
    process.stdout.write(
      `from age ${arm.minAgeYears}: within-person age-adjusted ${within.ageAdjusted?.ratio.toFixed(2) ?? "n/a"}, shuffled ${arm.shuffled.withinAgeAdjusted?.mean.toFixed(2) ?? "n/a"}; SCCS ${arm.sccsOverall.windows[0]?.ratio?.ratio.toFixed(2) ?? "n/a"}, shuffled ${arm.shuffled.sccsOverall?.mean.toFixed(2) ?? "n/a"}\n`,
    );
  }
  process.stdout.write(
    `wrote ${target} in ${Math.round((Date.now() - started) / 1000)} s\n`,
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
