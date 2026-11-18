/**
 * Host CLI for the attribution study's second rater (P6 section 7.1, #508).
 *
 *   bun run attribution:rater -- --records <records.jsonl> --items <items.json> [--n 150] [--seed 6508] [--out <dir>]
 *   bun run attribution:rater -- --agreement --sheet <filled.csv> --key <key.json> --records <records.jsonl>
 *
 * The first writes `sheet.csv` and `rubric.md` (blind, for the rater) and `key.json` (the
 * salt and the way back; keep it from the rater) to --out, by default beside
 * the records. The second prints Cohen's kappa between the rater and the
 * scorer per outcome and writes it to `agreement.md` beside the sheet.
 * Synthetic items only; no database.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { W1Item } from "../../synthetic-wearables/w1-items";
import {
  DEFAULT_SAMPLE,
  type OutcomeAgreement,
  raterAgreement,
  type RaterKey,
  raterSample,
  raterSheet,
  readFilledSheet,
  rubricMarkdown,
  STUDY_RATER_VERSION,
} from "./rater";
import type { StudyRecord } from "./run";

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const readRecords = (text: string): readonly StudyRecord[] =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as StudyRecord);

const fixed = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined ? "–" : value.toFixed(digits);

export const agreementMarkdown = (rows: readonly OutcomeAgreement[]): string =>
  [
    "# Attribution study: rater and scorer agreement",
    "",
    "Cohen's kappa per outcome over the rows the rater coded; prevalence is the scorer's share of y.",
    "",
    "| Outcome | Rows | Prevalence | Observed | Kappa | 95% interval |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.column} | ${row.n} | ${fixed(row.prevalence)} | ${fixed(row.kappa?.observed)} | ${fixed(row.kappa?.kappa)} | ${row.kappa?.low === null || row.kappa?.low === undefined ? "–" : `[${fixed(row.kappa.low)}, ${fixed(row.kappa.high)}]`} |`,
    ),
    "",
  ].join("\n");

export type RaterIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

const fail = (io: RaterIo, message: string): number => {
  io.stderr.write(`${message}\n`);
  return 1;
};

export const runRater = async (
  argv: readonly string[],
  io: RaterIo,
  salt: () => string = () => randomBytes(16).toString("hex"),
): Promise<number> => {
  const recordsPath = flag(argv, "--records");
  if (recordsPath === undefined)
    return fail(io, "--records <records.jsonl> is required.");
  const records = readRecords(await readFile(resolve(recordsPath), "utf8"));

  if (argv.includes("--agreement")) {
    const sheetPath = flag(argv, "--sheet");
    const keyPath = flag(argv, "--key");
    if (sheetPath === undefined || keyPath === undefined) {
      return fail(io, "--agreement needs --sheet <filled.csv> and --key <key.json>.");
    }
    const key = JSON.parse(await readFile(resolve(keyPath), "utf8")) as RaterKey;
    if (key.version !== STUDY_RATER_VERSION)
      return fail(io, "--key is not a study rater key.");
    const filled = readFilledSheet(await readFile(resolve(sheetPath), "utf8"));
    if (filled.problems.length > 0) return fail(io, filled.problems.join("\n"));
    const text = agreementMarkdown(raterAgreement(filled, key, records));
    await writeFile(join(dirname(resolve(sheetPath)), "agreement.md"), text);
    io.stdout.write(text);
    return 0;
  }

  const itemsPath = flag(argv, "--items");
  if (itemsPath === undefined) return fail(io, "--items <items.json> is required.");
  const file = JSON.parse(await readFile(resolve(itemsPath), "utf8")) as {
    testData?: unknown;
    items?: readonly W1Item[];
  };
  if (file.testData !== true || !Array.isArray(file.items)) {
    return fail(io, "--items must be a W1 items file written by attribution:w1.");
  }
  const n = Number(flag(argv, "--n") ?? DEFAULT_SAMPLE);
  const seed = Number(flag(argv, "--seed") ?? 6508);
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(seed) || seed < 0) {
    return fail(io, "--n and --seed must be whole numbers.");
  }
  const sample = raterSample(records, n, seed);
  const sheet = raterSheet(
    sample,
    new Map(file.items.map((item) => [item.id, item])),
    salt(),
  );
  const out = resolve(
    flag(argv, "--out") ?? join(dirname(resolve(recordsPath)), "rater"),
  );
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "sheet.csv"), sheet.csv);
  await writeFile(join(out, "key.json"), `${JSON.stringify(sheet.key, null, 2)}\n`);
  await writeFile(join(out, "rubric.md"), rubricMarkdown());
  io.stdout.write(
    `Rater sheet of ${sample.length} answers written to ${out} (sheet.csv and rubric.md for the rater; keep key.json apart)\n`,
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) process.exit(await runRater(process.argv.slice(2), process));
