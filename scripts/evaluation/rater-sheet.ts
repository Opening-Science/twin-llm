/**
 * The blinded rater sheet (#304): the lines of one run of a rated set (hb or
 * v1h) as a spreadsheet two raters can fill in apart, without the Lab view,
 * and the way back from a filled sheet to ratings files that
 * `eval:agreement` reads. Pure; `run-report.ts` writes the sheet and
 * `rater-sheet-run.ts` imports it.
 *
 * Blind as the Lab view is (`features/lab/rater-lines.ts`): a row carries the
 * question, the reference, the item's note and the reply, and an opaque
 * `sheet_id` (HMAC-SHA256 of run, item and repeat under a random salt kept
 * in `rater-sheet-key.json`). No run, model, item id, scenario or automatic
 * score. For v1h the rows are the protocol's review sample (`reviewSample`,
 * #413), so the sheet and the view rate the same lines. Rows are in an order
 * fixed by the salt; ids are random hex, so sheets of several runs pooled and
 * sorted by `sheet_id` interleave the models.
 */
import { z } from "zod";

import {
  raterLines,
  type RaterKeyEntry,
  type RunLine,
  SALT_PATTERN,
  seededOrder,
} from "../../features/lab/rater-lines";
import { noReferenceText } from "../../features/lab/rated-set-copy";
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
    item_id: z.string().min(1),
    repeat: z.number().int().positive(),
  })
  .strict();

export const raterSheetKeySchema = z
  .object({
    schema_version: z.literal(RATER_SHEET_VERSION),
    run_id: z.string().min(1),
    set: z.enum(["hb", "v1h"]),
    rubric: z.string().min(1),
    sample: z.string().min(1),
    note: z.string(),
    salt: z.string().regex(SALT_PATTERN),
    lines: z.array(keyLineSchema),
  })
  .strict();

export type RaterSheetKey = z.infer<typeof raterSheetKeySchema>;

/** The key file, or null when it is missing, does not parse or names another run. */
export const parseRaterSheetKey = (
  text: string | null,
  runId: string,
): RaterSheetKey | null => {
  if (text === null) return null;
  try {
    const parsed = raterSheetKeySchema.safeParse(JSON.parse(text));
    return parsed.success && parsed.data.run_id === runId ? parsed.data : null;
  } catch {
    return null;
  }
};

export type RaterSheetInput = Readonly<{
  set: RatedSet;
  runId: string;
  items: readonly Question[];
  entries: Readonly<Record<string, readonly RaterKeyEntry[]>>;
  lines: readonly RunLine[];
  salt: string;
}>;

const orderSeed = (runId: string): string => `${RATER_SHEET_VERSION}:${runId}`;

/** The sheet (CSV) and its key (JSON), both ending in a newline. */
export const renderRaterSheet = ({
  set,
  runId,
  items,
  entries,
  lines,
  salt,
}: RaterSheetInput): Readonly<{ csv: string; key: string; rows: number }> => {
  const all = raterLines(
    [{ runId, lines }],
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
  const ordered = seededOrder(linesInScope(set, all, "sample"), orderSeed(runId), salt);
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
    run_id: runId,
    set,
    rubric: rubricOf(set).version,
    sample: set === "v1h" ? REVIEW_SAMPLE_VERSION : "every answered line",
    note: "Keep this file away from raters: its salt and lines map every sheet_id back to the run.",
    salt,
    lines: ordered.map((line) => ({
      sheet_id: line.token,
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
 * Ratings files from a filled sheet (one run's, or several pooled) and the
 * keys of its runs. A row whose `sheet_id` no key holds, a level that is not
 * a whole number from 1 to 5, a comment over 2,000 characters or a line rated
 * twice is a problem; blank levels are left unrated.
 */
export const ratingsFromSheet = (
  text: string,
  keys: readonly RaterSheetKey[],
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
  const lineOf = new Map(
    keys.flatMap((key) =>
      key.lines.map((line) => [line.sheet_id, { key, line }] as const),
    ),
  );
  const problems: string[] = [];
  const seen = new Set<string>();
  let blank = 0;
  const files = new Map<string, RatingFile>(
    keys.map((key) => [
      key.run_id,
      emptyRatingFile(key.run_id, rater, orderSeed(key.run_id), now, key.rubric),
    ]),
  );
  for (const [index, row] of body.entries()) {
    if (row.every((cell) => cell.trim() === "")) continue;
    const id = (row[0] ?? "").trim();
    const found = lineOf.get(id);
    if (found === undefined) {
      problems.push(`row ${index + 2}: sheet_id ${id || "(empty)"} is in no key given`);
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
    const file = files.get(found.key.run_id);
    if (file === undefined) continue;
    files.set(
      found.key.run_id,
      withRating(
        file,
        { itemId: found.line.item_id, repeat: found.line.repeat },
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
