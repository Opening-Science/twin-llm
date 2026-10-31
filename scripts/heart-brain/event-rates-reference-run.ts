/**
 * Host CLI: the scripted verdicts for the hb items (#293), from the people
 * files of `bun run heart-brain` (never the archives or the database).
 *
 *   bun run heart-brain:event-rates -- --batches 001-100 --out research-out/heart-brain
 *
 * Reads only the people with an AF onset (the AF subset's rule) and writes
 * `<out>/event-rates-reference.json`. Prints counts and ratios only.
 */
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { cohortSetupOf } from "../../packages/query-tools/event-rates/cohort-rates";

import { afSubsetIds, AF_COHORT_ID } from "./af-subset";
import { parseArgs } from "./args";
import { referenceRows } from "./event-rates-reference";
import { readPeople } from "./people-files";
import { type PersonFacts } from "./person-facts";
import { toPerson } from "./to-person";

const main = async (argv: readonly string[]): Promise<number> => {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n`);
    return 2;
  }
  const setup = cohortSetupOf(AF_COHORT_ID);
  if (setup === null) throw new Error("the AF subset has no setup");
  const out = resolve(parsed.out);
  const facts: PersonFacts[] = [];
  for (const batch of parsed.batches) {
    const people = await readPeople(out, batch);
    const keep = new Set(afSubsetIds(people));
    facts.push(...people.filter((person) => keep.has(person.id)));
  }
  const exact = facts.map((person) => toPerson(person, setup.endDay, setup.historyYears));
  const rows = referenceRows(exact, facts, setup);
  for (const row of rows) {
    const line = (name: string, rates: (typeof row)["exact"]) =>
      `${row.id} ${name}: ${rates.people} people, before ${rates.before_onset.events} in ${rates.before_onset.person_years} py, after ${rates.after_onset.events} in ${rates.after_onset.person_years} py, crude ${rates.rate_ratio?.value ?? "n/a"}, age-adjusted ${rates.age_adjusted_rate_ratio?.value ?? "n/a"} (${rates.age_adjusted_rate_ratio?.low ?? ""} to ${rates.age_adjusted_rate_ratio?.high ?? ""}), ${rates.verdict}\n`;
    process.stdout.write(line("exact", row.exact));
    process.stdout.write(line("warehouse", row.warehouse));
  }
  const target = join(out, "event-rates-reference.json");
  await writeFile(
    target,
    `${JSON.stringify({ batches: parsed.batches, people: facts.length, rows }, null, 2)}\n`,
  );
  process.stdout.write(`${facts.length} people with AF; wrote ${target}\n`);
  return 0;
};

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
