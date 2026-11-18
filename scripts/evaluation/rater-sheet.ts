/**
 * The blinded rater sheet (#304): the lines of one or more runs of a rated
 * set (hb or v1h) as a spreadsheet two raters can fill in apart, without the
 * Lab view, and the way back from a filled sheet to the ratings files
 * `eval:agreement` reads. Pure; `run-report.ts` writes a one-run sheet and
 * `rater-sheet-run.ts` pools runs and imports filled sheets.
 *
 * Blind as the Lab view is (`features/lab/rater-lines.ts`): a row carries the
 * question, the reference, the item's note and the reply, and an opaque
 * `sheet_id` (HMAC-SHA256 of run, item and repeat under a random salt kept
 * in the key). No run, model, item id, scenario or automatic score. For v1h
 * the rows are the protocol's review sample of each run (`reviewSample`,
 * #413), so the sheet and the view rate the same lines. The rows of every
 * run are pooled and put in one order fixed by the salt, so models are
 * interleaved; a pool of one run is the single-run sheet.
 */
import { z } from "zod";

import { noReferenceText } from "../../features/lab/rated-set-copy";
import {
  raterLines,
  type RaterKeyEntry,
  type RunLine,
  SALT_PATTERN,
  seededOrder,
} from "../../features/lab/rater-lines";
import { isRubricLevel, type RatedSet, rubricOf } from "../../features/lab/rater-rubric";
import { linesInScope, REVIEW_SAMPLE_VERSION } from "../../features/lab/rater-sample";
import {
  emptyRatingFile,
  type RatingFile,
  withRating,
} from "../../features/lab/rating-file";

import { type Question } from "./question-set";
import { csvCell } from "./report";

export const RATER_SHEET_VERSION = "twin-llm.eval.rater-sheet.v1";

export const RATER_SHEET_COLUMNS = [
  "sheet_id",
  "question",
  "reference",
  "note",
  "answer",
  "level_1_5",
  "comment",
] as const;

const LEVEL_COLUMN = RATER_SHEET_COLUMNS.indexOf("level_1_5");
const COMMENT_COLUMN = RATER_SHEET_COLUMNS.indexOf("comment");
const MAX_COMMENT = 2000;

const keyLineSchema = z
  .object({
    sheet_id: z.string().regex(/^[0-9a-f]{16}$/),
    run_id: z.string().min(1),
    model: z.string().min(1),
    item_id: z.string().min(1),
    repeat: z.number().int().positive(),
  })
  .strict();

export const raterSheetKeySchema = z
  .object({
    schema_version: z.literal(RATER_SHEET_VERSION),
    set: z.enum(["hb", "v1h"]),
    rubric: z.string().min(1),
    sample: z.string().min(1),
    note: z.string(),
    salt: z.string().regex(SALT_PATTERN),
    runs: z.array(
      z.object({ run_id: z.string().min(1), model: z.string().min(1) }).strict(),
    ),
    lines: z.array(keyLineSchema),
  })
  .strict();

export type RaterSheetKey = z.infer<typeof raterSheetKeySchema>;

/**
 * The key file, or null when it is missing or does not parse. With `runIds`,
 * also null unless the key pools exactly those runs (in any order).
 */
export const parseRaterSheetKey = (
  text: string | null,
  runIds?: readonly string[],
): RaterSheetKey | null => {
  if (text === null) return null;
  try {
    const parsed = raterSheetKeySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const same =
      runIds === undefined ||
      [...parsed.data.runs.map((run) => run.run_id)].sort().join("\n") ===
        [...runIds].sort().join("\n");
    return same ? parsed.data : null;
  } catch {
    return null;
  }
};

/** One run of the pool: its id, the one model that answered, and its lines. */
export type SheetRun = Readonly<{
  runId: string;
  model: string;
  lines: readonly RunLine[];
}>;

export type RaterSheetInput = Readonly<{
  set: RatedSet;
  runs: readonly SheetRun[];
  items: readonly Question[];
  entries: Readonly<Record<string, readonly RaterKeyEntry[]>>;
  salt: string;
}>;

const orderSeed = (runIds: readonly string[]): string =>
  `${RATER_SHEET_VERSION}:${[...runIds].sort().join(",")}`;

/** The sheet (CSV) and its key (JSON), both ending in a newline. */
export const renderRaterSheet = ({
  set,
  runs,
  items,
  entries,
  salt,
}: RaterSheetInput): Readonly<{ csv: string; key: string; rows: number }> => {
  const all = raterLines(
    runs.map((run) => ({ runId: run.runId, lines: run.lines })),
    items.map((item) => ({
      id: item.id,
      question: item.question,
      human: item.human,
      answerClass: item.expect.answer_class,
      scenario: item.scenario,
    })),
    entries,
    salt,
  );
  const modelOf = new Map(runs.map((run) => [run.runId, run.model]));
  const ordered = seededOrder(
    linesInScope(set, all, "sample"),
    orderSeed(runs.map((run) => run.runId)),
    salt,
  );
  const rows = ordered.map((line) =>
    [
      line.token,
      line.question,
      line.reference.length > 0
        ? line.reference.join("; ")
        : (noReferenceText(set, line.referenceKind) ?? ""),
      line.note ?? "",
      line.answer,
      "",
      "",
    ]
      .map(csvCell)
      .join(","),
  );
  const key: RaterSheetKey = {
    schema_version: RATER_SHEET_VERSION,
    set,
    rubric: rubricOf(set).version,
    sample: set === "v1h" ? REVIEW_SAMPLE_VERSION : "every answered line",
    note: "Keep this file away from raters: its salt and lines map every sheet_id back to its run and model.",
    salt,
    runs: runs.map((run) => ({ run_id: run.runId, model: run.model })),
    lines: ordered.map((line) => ({
      sheet_id: line.token,
      run_id: line.runId,
      model: modelOf.get(line.runId) ?? "",
      item_id: line.itemId,
      repeat: line.repeat,
    })),
  };
  return {
    csv: `${[RATER_SHEET_COLUMNS.join(","), ...rows].join("\n")}\n`,
    key: `${JSON.stringify(key, null, 2)}\n`,
    rows: rows.length,
  };
};

/** RFC 4180 rows: quoted cells may hold commas, quotes and line breaks; CRLF is read as LF. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      rows.push([...row, cell]);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  return rows;
};

/** A cell as written, with the `'` that `csvCell` puts before a formula start taken off. */
const plain = (cell: string): string =>
  /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;

export type SheetImport = Readonly<{
  /** One ratings file per run with at least one rated row. */
  files: readonly RatingFile[];
  /** Rows left blank: not rated. */
  blank: number;
  /** Problems that stop the import; nothing is written when there are any. */
  problems: readonly string[];
}>;

/**
 * Ratings files, one per run, from a filled sheet and its key. A row whose
 * `sheet_id` the key does not hold, a level that is not a whole number from
 * 1 to 5, a comment over 2,000 characters or a line rated twice is a
 * problem; blank levels are left unrated.
 */
export const ratingsFromSheet = (
  text: string,
  key: RaterSheetKey,
  rater: string,
  now: string,
): SheetImport => {
  const [header, ...body] = parseCsv(text);
  if (header === undefined || header.join(",") !== RATER_SHEET_COLUMNS.join(",")) {
    return {
      files: [],
      blank: 0,
      problems: [`the header is not ${RATER_SHEET_COLUMNS.join(",")}`],
    };
  }
  const lineOf = new Map(key.lines.map((line) => [line.sheet_id, line]));
  const seed = orderSeed(key.runs.map((run) => run.run_id));
  const problems: string[] = [];
  const seen = new Set<string>();
  let blank = 0;
  const files = new Map<string, RatingFile>(
    key.runs.map((run) => [
      run.run_id,
      emptyRatingFile(run.run_id, rater, seed, now, key.rubric),
    ]),
  );
  for (const [index, row] of body.entries()) {
    if (row.every((cell) => cell.trim() === "")) continue;
    const id = (row[0] ?? "").trim();
    const line = lineOf.get(id);
    if (line === undefined) {
      problems.push(`row ${index + 2}: sheet_id ${id || "(empty)"} is not in the key`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`row ${index + 2}: sheet_id ${id} appears twice`);
      continue;
    }
    seen.add(id);
    const levelText = (row[LEVEL_COLUMN] ?? "").trim();
    const comment = plain(row[COMMENT_COLUMN] ?? "").trim();
    if (levelText === "") {
      blank += 1;
      continue;
    }
    const level = Number(levelText);
    if (!/^\d$/.test(levelText) || !isRubricLevel(level)) {
      problems.push(
        `row ${index + 2}: level "${levelText}" is not a whole number from 1 to 5`,
      );
      continue;
    }
    if (comment.length > MAX_COMMENT) {
      problems.push(`row ${index + 2}: the comment is over ${MAX_COMMENT} characters`);
      continue;
    }
    const file = files.get(line.run_id);
    if (file === undefined) {
      problems.push(`row ${index + 2}: run ${line.run_id} is not among the key's runs`);
      continue;
    }
    files.set(
      line.run_id,
      withRating(
        file,
        { itemId: line.item_id, repeat: line.repeat },
        level,
        comment,
        now,
      ),
    );
  }
  return {
    files:
      problems.length > 0
        ? []
        : [...files.values()].filter((file) => file.ratings.length > 0),
    blank,
    problems,
  };
};
