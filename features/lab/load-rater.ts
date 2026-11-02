import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
import { type RatedSet, rubricOf } from "./rater-rubric";
import { newRaterSet, parseRaterSet, raterSetFile, renderRaterSet } from "./rater-set";

/**
 * The I/O half of the second-rater view (#351). Reads the runs of one rated
 * set (hb or v1h, #304) under `evaluation/runs/` (each run's meta.json and
 * results.jsonl), that set's committed questions and key, and the rater's
 * own ratings files; writes one
 * ratings file per run beside it, and one rater set per rater holding the
 * salt of the answer ids (#355). Only files inside the repository are
 * touched, and nothing is sent anywhere; the salt stays on the server. report.md, review.csv and
 * review-key.json are never opened, so no score or model name can reach the
 * rater through here.
 */

/** The committed questions and key of each rated set, as in `QUESTION_SETS`. */
const SET_FILES: Readonly<
  Record<RatedSet, Readonly<{ questions: string; key: string }>>
> = {
  hb: {
    questions: "evaluation/questions.hb.v1.json",
    key: "evaluation/answer-key.hb.v1.json",
  },
  v1h: {
    questions: "evaluation/questions.v1h.v1.json",
    key: "evaluation/answer-key.v1h.v1.json",
  },
};
const MAX_FILE_BYTES = 5_000_000;
const MAX_RUNS = 100;
const RUN_ID = /^[\w.:+-]{1,128}$/;

/** The order seed of a rater: fixed by the set's rubric version and the pseudonym. */
export const orderSeedOf = (rater: string, set: RatedSet = "hb"): string =>
  `${rubricOf(set).version}:${rater}`;

/** 32 random bytes from the operating system, as hex. */
export const newSalt = (): string => randomBytes(32).toString("hex");

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
      .object({
        id: z.string(),
        question: z.string(),
        scenario: z.string().optional(),
        human: z.string().optional(),
        expect: z.object({ answer_class: z.string().optional() }).loose().optional(),
      })
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

const setRuns = async (root: string, set: RatedSet): Promise<RunLines[]> => {
  const dir = join(/* turbopackIgnore: true */ root, EVAL_RUNS_DIR);
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
        parseJson(
          await readSmall(join(/* turbopackIgnore: true */ dir, runId, "meta.json")),
        ),
      );
      if (!meta.success || meta.data.question_set !== set || meta.data.mock === true) {
        return null;
      }
      const results = await readSmall(
        join(/* turbopackIgnore: true */ dir, runId, "results.jsonl"),
      );
      return results === null ? null : { runId, lines: parseLines(results) };
    }),
  );
  return runs.filter((run): run is RunLines => run !== null);
};

const ratingPath = (root: string, runId: string, rater: string): string =>
  join(
    /* turbopackIgnore: true */ root,
    EVAL_RUNS_DIR,
    runId,
    RATINGS_DIR,
    `${rater}.json`,
  );

const readRatingFile = async (
  root: string,
  runId: string,
  rater: string,
): Promise<RatingFile | null> => {
  const text = await readSmall(ratingPath(root, runId, rater));
  return text === null ? null : parseRatingFile(text);
};

const raterSetPath = (root: string, set: RatedSet, rater: string): string =>
  join(/* turbopackIgnore: true */ root, raterSetFile(set, rater));

const errorCode = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;

/**
 * The rater's salt for one set (#355). Read from the set's rater set file
 * (`raterSetFile`: `evaluation/rater-sets/<rater>.json` for hb);
 * when there is none yet the set starts here: with `persist` a new random
 * salt is written (create-only, so two first loads at once agree on one),
 * without it (a view that cannot save) a throwaway salt is used and nothing
 * is written. A set file that does not parse is an error rather than
 * replaced, because replacing it would lose the mapping of the ids.
 */
export const loadRaterSalt = async (
  set: RatedSet,
  rater: string,
  persist: boolean,
  root = process.cwd(),
  now = (): string => new Date().toISOString(),
): Promise<string> => {
  const path = raterSetPath(root, set, rater);
  const read = async (): Promise<string | null> => {
    const text = await readSmall(path);
    if (text === null) return null;
    const set = parseRaterSet(text);
    if (set === null || set.rater !== rater) {
      throw new Error("The rater set file does not parse; it was left as it is.");
    }
    return set.salt;
  };
  const found = await read();
  if (found !== null) return found;
  const salt = newSalt();
  if (!persist) return salt;
  await mkdir(dirname(path), { recursive: true });
  try {
    const raterSet = newRaterSet(rater, salt, now(), rubricOf(set).version);
    await writeFile(path, renderRaterSet(raterSet), {
      encoding: "utf8",
      flag: "wx",
    });
    return salt;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    const other = await read();
    if (other === null) throw error;
    return other;
  }
};

export type RaterData =
  | Readonly<{ kind: "ready"; runs: number; lines: readonly RaterLine[] }>
  | Readonly<{ kind: "no-runs" }>
  | Readonly<{ kind: "no-questions" }>;

/** Every answered line of the set on this machine, with tokens under `salt`, unordered and not yet blinded. */
export const loadRaterLines = async (
  set: RatedSet,
  salt: string,
  root = process.cwd(),
): Promise<RaterData> => {
  const files = SET_FILES[set];
  const items = itemsSchema.safeParse(
    parseJson(await readSmall(join(/* turbopackIgnore: true */ root, files.questions))),
  );
  const key = keySchema.safeParse(
    parseJson(await readSmall(join(/* turbopackIgnore: true */ root, files.key))),
  );
  if (!items.success || !key.success) return { kind: "no-questions" };
  const runs = await setRuns(root, set);
  const raterItems = items.data.items.map((item) => ({
    id: item.id,
    question: item.question,
    human: item.human,
    answerClass: item.expect?.answer_class,
    scenario: item.scenario,
  }));
  const lines = raterLines(runs, raterItems, key.data.entries, salt);
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
  set: RatedSet,
  lines: readonly RaterLine[],
  rater: string,
  salt: string,
  root = process.cwd(),
): Promise<BlindLine[]> => {
  const runIds = [...new Set(lines.map((line) => line.runId))];
  return blindLines(
    lines,
    orderSeedOf(rater, set),
    salt,
    await ratingsOf(root, runIds, rater),
  );
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
  set: RatedSet,
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
      emptyRatingFile(
        line.runId,
        rater,
        orderSeedOf(rater, set),
        now,
        rubricOf(set).version,
      );
    const next = withRating(
      current,
      { itemId: line.itemId, repeat: line.repeat },
      level,
      comment,
      now,
    );
    await mkdir(
      join(/* turbopackIgnore: true */ root, EVAL_RUNS_DIR, line.runId, RATINGS_DIR),
      { recursive: true },
    );
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
