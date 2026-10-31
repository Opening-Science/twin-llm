import "server-only";

import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { EVAL_RUNS_DIR } from "@/infrastructure/local-artefacts";

import {
  emptyRatingFile,
  type LineRating,
  parseRatingFile,
  RATINGS_DIR,
  type RatingFile,
  ratingsByLine,
  renderRatingFile,
  withRating,
} from "./rating-file";
import {
  type BlindLine,
  blindLines,
  type RaterLine,
  raterLines,
  type RunLines,
} from "./rater-lines";
import { RUBRIC_VERSION } from "./rater-rubric";

/**
 * The I/O half of the second-rater view (#351). Reads the hb runs under
 * `evaluation/runs/` (each run's meta.json and results.jsonl), the committed
 * hb questions and key, and the rater's own ratings files; writes one
 * ratings file per run beside it. Only files inside the repository are
 * touched, and nothing is sent anywhere. report.md, review.csv and
 * review-key.json are never opened, so no score or model name can reach the
 * rater through here.
 */

const HB_QUESTIONS = "evaluation/questions.hb.v1.json";
const HB_KEY = "evaluation/answer-key.hb.v1.json";
const MAX_FILE_BYTES = 5_000_000;
const MAX_RUNS = 100;
const RUN_ID = /^[\w.:+-]{1,128}$/;

/** The order seed of a rater: fixed by the rubric version and the pseudonym. */
export const orderSeedOf = (rater: string): string => `${RUBRIC_VERSION}:${rater}`;

const readSmall = async (path: string): Promise<string | null> => {
  const found = await stat(path).catch(() => null);
  if (found === null || !found.isFile()) return null;
  if (found.size > MAX_FILE_BYTES) {
    console.error("[lab] rater input over the size cap", found.size);
    return null;
  }
  return readFile(path, "utf8").catch(() => null);
};

const metaSchema = z
  .object({ question_set: z.string().optional(), mock: z.boolean().optional() })
  .loose();

const lineSchema = z
  .object({
    item_id: z.string(),
    repeat: z.number().int(),
    error: z.string().nullable(),
    text: z.string().nullable(),
    mock: z.boolean().optional(),
  })
  .loose();

const itemsSchema = z.object({
  items: z.array(
    z
      .object({ id: z.string(), question: z.string(), human: z.string().optional() })
      .loose(),
  ),
});

const keySchema = z.object({
  entries: z.record(
    z.string(),
    z.array(
      z
        .object({
          name: z.string(),
          value: z.union([z.number(), z.string(), z.null()]),
          refusal: z.string().nullable(),
        })
        .loose(),
    ),
  ),
});

const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** A run's answered lines; a line that does not parse or came from a fake model is left out. */
const parseLines = (text: string): RunLines["lines"] =>
  text.split("\n").flatMap((row) => {
    if (row.trim() === "") return [];
    const parsed = lineSchema.safeParse(parseJson(row));
    return parsed.success && parsed.data.mock !== true ? [parsed.data] : [];
  });

const hbRuns = async (root: string): Promise<RunLines[]> => {
  const dir = join(root, EVAL_RUNS_DIR);
  const ids = await readdir(dir, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .slice(0, MAX_RUNS),
    )
    .catch(() => []);
  const runs = await Promise.all(
    ids.map(async (runId) => {
      const meta = metaSchema.safeParse(
        parseJson(await readSmall(join(dir, runId, "meta.json"))),
      );
      if (!meta.success || meta.data.question_set !== "hb" || meta.data.mock === true) {
        return null;
      }
      const results = await readSmall(join(dir, runId, "results.jsonl"));
      return results === null ? null : { runId, lines: parseLines(results) };
    }),
  );
  return runs.filter((run): run is RunLines => run !== null);
};

const ratingPath = (root: string, runId: string, rater: string): string =>
  join(root, EVAL_RUNS_DIR, runId, RATINGS_DIR, `${rater}.json`);

const readRatingFile = async (
  root: string,
  runId: string,
  rater: string,
): Promise<RatingFile | null> => {
  const text = await readSmall(ratingPath(root, runId, rater));
  return text === null ? null : parseRatingFile(text);
};

export type RaterData =
  | Readonly<{ kind: "ready"; runs: number; lines: readonly RaterLine[] }>
  | Readonly<{ kind: "no-runs" }>
  | Readonly<{ kind: "no-questions" }>;

/** Every answered hb line on this machine, unordered and not yet blinded. */
export const loadRaterLines = async (root = process.cwd()): Promise<RaterData> => {
  const items = itemsSchema.safeParse(
    parseJson(await readSmall(join(root, HB_QUESTIONS))),
  );
  const key = keySchema.safeParse(parseJson(await readSmall(join(root, HB_KEY))));
  if (!items.success || !key.success) return { kind: "no-questions" };
  const runs = await hbRuns(root);
  const lines = raterLines(runs, items.data.items, key.data.entries);
  return lines.length === 0
    ? { kind: "no-runs" }
    : { kind: "ready", runs: runs.length, lines };
};

const ratingsOf = async (
  root: string,
  runIds: readonly string[],
  rater: string,
): Promise<ReadonlyMap<string, ReadonlyMap<string, LineRating>>> =>
  new Map(
    await Promise.all(
      runIds.map(async (runId) => {
        const file = await readRatingFile(root, runId, rater);
        return [runId, file === null ? new Map() : ratingsByLine(file)] as const;
      }),
    ),
  );

/** The rater's lines in their order, with what they rated so far. */
export const loadRaterSession = async (
  lines: readonly RaterLine[],
  rater: string,
  root = process.cwd(),
): Promise<BlindLine[]> => {
  const runIds = [...new Set(lines.map((line) => line.runId))];
  return blindLines(lines, orderSeedOf(rater), await ratingsOf(root, runIds, rater));
};

/** One write at a time per file, so two quick saves cannot lose one. */
const pending = new Map<string, Promise<unknown>>();

const serialised = <T>(path: string, task: () => Promise<T>): Promise<T> => {
  const before = pending.get(path) ?? Promise.resolve();
  const next = before.catch(() => undefined).then(task);
  pending.set(path, next);
  return next;
};

/** Sets (or with null, clears) one line's rating in its run's file. */
export const saveLineRating = async (
  line: RaterLine,
  rater: string,
  level: number | null,
  comment: string,
  now: string,
  root = process.cwd(),
): Promise<void> => {
  const path = ratingPath(root, line.runId, rater);
  await serialised(path, async () => {
    const current =
      (await readRatingFile(root, line.runId, rater)) ??
      emptyRatingFile(line.runId, rater, orderSeedOf(rater), now);
    const next = withRating(
      current,
      { itemId: line.itemId, repeat: line.repeat },
      level,
      comment,
      now,
    );
    await mkdir(join(root, EVAL_RUNS_DIR, line.runId, RATINGS_DIR), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, renderRatingFile(next), "utf8");
    await rename(temporary, path);
  });
};

/** Every ratings file of this rater, one per run, as on disk. */
export const loadRatingFiles = async (
  lines: readonly RaterLine[],
  rater: string,
  root = process.cwd(),
): Promise<RatingFile[]> => {
  const runIds = [...new Set(lines.map((line) => line.runId))].sort();
  const files = await Promise.all(
    runIds.map((runId) => readRatingFile(root, runId, rater)),
  );
  return files.filter((file): file is RatingFile => file !== null);
};
