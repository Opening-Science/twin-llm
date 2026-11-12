/**
 * `bun run eval:rater-sheet -- --rater <pseudonym> <sheet.csv> <run-id> [<run-id> …]` (#304).
 *
 * Reads a filled rater sheet (`rater-sheet.csv` from `eval:report`, or the
 * sheets of several runs pooled into one file) and each run's
 * `rater-sheet-key.json`, and writes the rater's ratings as
 * `evaluation/runs/<run-id>/ratings/<pseudonym>.json`, the files the Lab view
 * writes and `eval:agreement` reads. Create-only: a rater who already has a
 * ratings file in a run (from the view, or an earlier import) is refused, so
 * nothing is overwritten. Any bad row stops the import before anything is
 * written. Reads no env and no database.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isPseudonym } from "../../features/lab/rater-rubric";
import { RATINGS_DIR, renderRatingFile } from "../../features/lab/rating-file";

import { parseRaterSheetKey, ratingsFromSheet } from "./rater-sheet";
import { RUNS_DIR } from "./run-report";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const USAGE =
  "Usage: bun run eval:rater-sheet -- --rater <pseudonym> <sheet.csv> <run-id> [<run-id> …]\n";

const main = async (argv: readonly string[]): Promise<number> => {
  const args = argv.filter((arg) => arg !== "--");
  const flag = args.indexOf("--rater");
  const rater = flag === -1 ? undefined : args[flag + 1];
  const [sheetPath, ...runIds] = args.filter(
    (_, index) => index !== flag && index !== flag + 1,
  );
  if (
    rater === undefined ||
    !isPseudonym(rater) ||
    sheetPath === undefined ||
    runIds.length === 0 ||
    runIds.some((id) => !RUN_ID.test(id))
  ) {
    process.stderr.write(USAGE);
    return 2;
  }
  const keys = await Promise.all(
    runIds.map(async (runId) => {
      const path = join(RUNS_DIR, runId, "rater-sheet-key.json");
      const key = parseRaterSheetKey(
        await readFile(path, "utf8").catch(() => null),
        runId,
      );
      if (key === null)
        throw new Error(`${path} is missing or does not parse; run eval:report first`);
      return key;
    }),
  );
  const result = ratingsFromSheet(
    await readFile(sheetPath, "utf8"),
    keys,
    rater,
    new Date().toISOString(),
  );
  if (result.problems.length > 0) {
    process.stderr.write(`${result.problems.join("\n")}\nNothing was written.\n`);
    return 1;
  }
  const pathOf = (runId: string) => join(RUNS_DIR, runId, RATINGS_DIR, `${rater}.json`);
  const existing = (
    await Promise.all(
      result.files.map(async (file) =>
        (await access(pathOf(file.run_id)).then(
          () => true,
          () => false,
        ))
          ? [pathOf(file.run_id)]
          : [],
      ),
    )
  ).flat();
  if (existing.length > 0) {
    process.stderr.write(
      `${existing.join(", ")} already exist; use another pseudonym or move them. Nothing was written.\n`,
    );
    return 1;
  }
  for (const file of result.files) {
    const path = pathOf(file.run_id);
    await mkdir(join(RUNS_DIR, file.run_id, RATINGS_DIR), { recursive: true });
    await writeFile(path, renderRatingFile(file), { flag: "wx" });
    process.stdout.write(
      `Wrote ${path} (${file.ratings.length} ratings, ${file.rubric})\n`,
    );
  }
  process.stdout.write(`${result.blank} rows left blank were not rated.\n`);
  return 0;
};

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
