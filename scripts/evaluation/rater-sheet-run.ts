/**
 * The pooled rater sheet and its import (#304).
 *
 *   bun run eval:rater-sheet -- --runs <run-id>,<run-id>[,…] [--out <dir>]
 *   bun run eval:rater-sheet -- --rater <pseudonym> --key <key.json> <sheet.csv>
 *
 * Pool: reads each run's `meta.json` and `results.jsonl` and the questions
 * and key of their set (hb or v1h, the same for every run, one model per
 * run), and writes one sheet across all of them, `rater-sheet.csv`, with
 * `rater-sheet-key.json` (each opaque id → run, model, item and repeat), in
 * `--out` or `evaluation/rater-sheets/<pool>/` (gitignored). Rows of every run
 * and model are in one salted order, so a rater cannot tell models apart by
 * sheet. Writing the same pool again keeps the key's salt, so a sheet being
 * filled keeps its ids. Each run goes through the learning-consent gate
 * (#145) as `eval:report` does.
 *
 * Import: matches a filled sheet (a pooled one, or a run's own from
 * `eval:report`) to its key and writes the rater's ratings as
 * `evaluation/runs/<run-id>/ratings/<pseudonym>.json`, one per run, the files
 * the Lab view writes and `eval:agreement` reads. Any bad row, or a ratings
 * file the rater already has in one of the runs, stops it before anything is
 * written. Reads no env and no database.
 */
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isPseudonym, ratedSetOf, type RatedSet } from "../../features/lab/rater-rubric";
import { RATINGS_DIR, renderRatingFile } from "../../features/lab/rating-file";
import {
  type LearningGateDeps,
  noConsentStore,
  requireLearningConsent,
} from "../../infrastructure/learning-consent";

import { questionsSha256 } from "./build-answer-key";
import { metaSchema, QUESTION_SETS, resultLineSchema } from "./eval-results";
import { answerKeySchema, questionSetSchema } from "./question-set";
import {
  parseRaterSheetKey,
  ratingsFromSheet,
  renderRaterSheet,
  type SheetRun,
} from "./rater-sheet";
import { reportRows, RUNS_DIR } from "./run-report";

export const POOLS_DIR = "evaluation/rater-sheets";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const USAGE = [
  "Usage: bun run eval:rater-sheet -- --runs <run-id>,<run-id>[,…] [--out <dir>]",
  "       bun run eval:rater-sheet -- --rater <pseudonym> --key <key.json> <sheet.csv>",
  "",
].join("\n");

export type RaterSheetDeps = Readonly<{
  readText: (path: string) => Promise<string>;
  /** Writes the file, making its folder first. */
  writeText: (path: string, text: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  learning: LearningGateDeps;
  newSalt: () => string;
  now: () => string;
}>;

export type RaterSheetIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

class SheetError extends Error {}

const flag = (args: readonly string[], name: string): string | null => {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
};

/** The folder of a pool: `evaluation/rater-sheets/pool-<12 hex of the sorted run ids>`. */
export const poolDir = (runIds: readonly string[]): string =>
  join(
    POOLS_DIR,
    `pool-${createHash("sha256")
      .update([...runIds].sort().join("\n"))
      .digest("hex")
      .slice(0, 12)}`,
  );

type LoadedRun = Readonly<{ set: RatedSet; run: SheetRun }>;

const loadRun = async (deps: RaterSheetDeps, runId: string): Promise<LoadedRun> => {
  const dir = join(RUNS_DIR, runId);
  const meta = metaSchema.parse(
    JSON.parse(await deps.readText(join(dir, "meta.json"))) as unknown,
  );
  const permit = await requireLearningConsent(
    "evaluation",
    reportRows(meta),
    deps.learning,
  );
  if (!permit.ok) throw new SheetError(`${runId}: ${permit.message}`);
  if (meta.mock) throw new SheetError(`${runId}: a fake model answered this run`);
  const set = ratedSetOf(meta.question_set ?? "v1");
  if (set === null) {
    throw new SheetError(`${runId}: set ${meta.question_set ?? "v1"} has no rubric`);
  }
  const [model] = meta.models;
  if (model === undefined || meta.models.length !== 1) {
    throw new SheetError(
      `${runId}: ratings are keyed by item and repeat, so a pooled run needs one model`,
    );
  }
  const lines = (await deps.readText(join(dir, "results.jsonl")))
    .split("\n")
    .filter((row) => row.trim() !== "")
    .map((row) => resultLineSchema.parse(JSON.parse(row) as unknown));
  if (lines.some((line) => line.mock)) {
    throw new SheetError(`${runId}: a line came from a fake model`);
  }
  return {
    set,
    run: { runId, model: `${model.provider}:${model.model_id}`, lines },
  };
};

const pool = async (
  args: readonly string[],
  io: RaterSheetIo,
  deps: RaterSheetDeps,
): Promise<number> => {
  const runIds = [
    ...new Set(
      (flag(args, "--runs") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (runIds.length === 0 || runIds.some((id) => !RUN_ID.test(id))) {
    io.stderr.write(USAGE);
    return 2;
  }
  const loaded = await Promise.all(runIds.map((id) => loadRun(deps, id)));
  const sets = [...new Set(loaded.map((each) => each.set))];
  const [set] = sets;
  if (set === undefined || sets.length !== 1) {
    throw new SheetError(
      `the runs are of more than one set (${sets.join(", ")}); pool one set`,
    );
  }
  const files = QUESTION_SETS[set];
  const questionsRaw = JSON.parse(await deps.readText(files.questions)) as unknown;
  const questions = questionSetSchema.parse(questionsRaw);
  const key = answerKeySchema.parse(
    JSON.parse(await deps.readText(files.key)) as unknown,
  );
  const sha = questionsSha256(questionsRaw);
  if (sha !== key.questions_sha256) {
    throw new SheetError("the questions and the answer key do not share one sha256");
  }
  for (const runId of runIds) {
    const meta = metaSchema.parse(
      JSON.parse(await deps.readText(join(RUNS_DIR, runId, "meta.json"))) as unknown,
    );
    if (meta.questions_sha256 !== sha) {
      throw new SheetError(`${runId}: ran other questions than the set's current file`);
    }
  }
  const out = flag(args, "--out") ?? poolDir(runIds);
  const keyPath = join(out, "rater-sheet-key.json");
  const earlier = (await deps.exists(keyPath))
    ? parseRaterSheetKey(await deps.readText(keyPath), runIds)
    : null;
  const sheet = renderRaterSheet({
    set,
    runs: loaded.map((each) => each.run),
    items: questions.items,
    entries: key.entries,
    salt: earlier?.salt ?? deps.newSalt(),
  });
  await deps.writeText(join(out, "rater-sheet.csv"), sheet.csv);
  await deps.writeText(keyPath, sheet.key);
  io.stdout.write(
    `Wrote ${out}/rater-sheet.csv (${sheet.rows} lines from ${runIds.length} runs, ${set}) and rater-sheet-key.json; give raters the sheet only\n`,
  );
  return 0;
};

const importSheet = async (
  args: readonly string[],
  io: RaterSheetIo,
  deps: RaterSheetDeps,
): Promise<number> => {
  const rater = flag(args, "--rater");
  const keyPath = flag(args, "--key");
  const rest = args.filter(
    (arg, index) =>
      !["--rater", "--key"].includes(arg) &&
      !["--rater", "--key"].includes(args[index - 1] ?? ""),
  );
  const [sheetPath] = rest;
  if (
    rater === null ||
    !isPseudonym(rater) ||
    keyPath === null ||
    sheetPath === undefined ||
    rest.length !== 1
  ) {
    io.stderr.write(USAGE);
    return 2;
  }
  const key = parseRaterSheetKey(await deps.readText(keyPath).catch(() => null));
  if (key === null)
    throw new SheetError(`${keyPath} is missing or is not a rater sheet key`);
  const result = ratingsFromSheet(await deps.readText(sheetPath), key, rater, deps.now());
  if (result.problems.length > 0) {
    io.stderr.write(`${result.problems.join("\n")}\nNothing was written.\n`);
    return 1;
  }
  const pathOf = (runId: string) => join(RUNS_DIR, runId, RATINGS_DIR, `${rater}.json`);
  const existing: string[] = [];
  for (const file of result.files) {
    if (await deps.exists(pathOf(file.run_id))) existing.push(pathOf(file.run_id));
  }
  if (existing.length > 0) {
    io.stderr.write(
      `${existing.join(", ")} already exist; use another pseudonym or move them. Nothing was written.\n`,
    );
    return 1;
  }
  for (const file of result.files) {
    await deps.writeText(pathOf(file.run_id), renderRatingFile(file));
    io.stdout.write(
      `Wrote ${pathOf(file.run_id)} (${file.ratings.length} ratings, ${file.rubric})\n`,
    );
  }
  io.stdout.write(`${result.blank} rows left blank were not rated.\n`);
  return 0;
};

export const runRaterSheet = async (
  argv: readonly string[],
  io: RaterSheetIo,
  deps: RaterSheetDeps,
): Promise<number> => {
  const args = argv.filter((arg) => arg !== "--");
  try {
    if (args.includes("--runs")) return await pool(args, io, deps);
    if (args.includes("--rater")) return await importSheet(args, io, deps);
    io.stderr.write(USAGE);
    return 2;
  } catch (error) {
    io.stderr.write(
      error instanceof SheetError
        ? `${error.message}; nothing was written\n`
        : `A run or sheet file did not parse (${error instanceof Error ? error.name : "unknown"}); nothing was written\n`,
    );
    return 1;
  }
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runRaterSheet(process.argv.slice(2), process, {
    readText: (path) => readFile(path, "utf8"),
    writeText: async (path, text) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    },
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    learning: noConsentStore(),
    newSalt: () => randomBytes(32).toString("hex"),
    now: () => new Date().toISOString(),
  });
  process.exit(code);
}
