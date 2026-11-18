/**
 * The attribution study's blinded second-rater sheet and its agreement with
 * the scorer (P6 section 7.1, #508). Pure; `rater-run.ts` writes and reads
 * the files.
 *
 * Sample: base answers with text, stratified by stratum in proportion to
 * the records (at least one per stratum present), seeded. The order of rows
 * is shuffled by the same seed, so models and conditions are interleaved.
 *
 * Blind: a row carries the question, the readings the model was given with
 * their source and day, the selection rule, the keys the answer cited and
 * the answer. No model, condition, item id, expected answer or automatic
 * score. Each row has an opaque `sheet_id` (HMAC-SHA256 of model, item,
 * condition and repeat under a salt kept in the key file). The rule is shown
 * for every row, also C0 rows whose prompt had none, so the condition does
 * not show.
 *
 * The rater fills `y` or `n` for each outcome the row's stratum has, and may
 * leave any blank. Agreement with the scorer is Cohen's kappa per outcome
 * over the rows both rated, with the scorer's share of `y` as prevalence.
 */
import { createHmac } from "node:crypto";

import { csvCell } from "../../../infrastructure/csv";
import { formatDate, formatMetricValue } from "../../../infrastructure/format-measure";
import { WEARABLE_SOURCE_LABEL } from "../../../infrastructure/wearable-provenance";
import { randomFor } from "../../../infrastructure/seeded-random";
import { type Kappa, cohenKappa } from "../agreement";
import { parseCsv } from "../rater-sheet";
import type { W1Item } from "../../synthetic-wearables/w1-items";
import { FIXED_ORDER } from "../../synthetic-wearables/w1-items";
import { ruleText } from "./contexts";
import type { StudyRecord } from "./run";
import type { StudyScore } from "./score";

export const STUDY_RATER_VERSION = "twin-llm.attribution-study.rater-sheet.v1";
export const DEFAULT_SAMPLE = 150;

/** The outcomes a rater codes, in sheet order, with the stratum each applies to. */
export const RATED_OUTCOMES = [
  { column: "attribution_correct", field: "attributionCorrect", stratum: null },
  { column: "disagreement_handled", field: "disagreementHandled", stratum: "disagree" },
  { column: "over_hedged", field: "overHedged", stratum: "agree" },
  { column: "day_correct", field: "dayCorrect", stratum: "day_shift" },
  { column: "abstention_correct", field: "abstentionCorrect", stratum: "missing" },
  {
    column: "construct_handled",
    field: "constructHandled",
    stratum: "construct_mismatch",
  },
] as const satisfies readonly Readonly<{
  column: string;
  field: keyof StudyScore;
  stratum: W1Item["stratum"] | null;
}>[];

export type RatedColumn = (typeof RATED_OUTCOMES)[number]["column"];

export const SHEET_COLUMNS = [
  "sheet_id",
  "question",
  "readings",
  "rule",
  "cited",
  "answer",
  "outcomes_to_code",
  ...RATED_OUTCOMES.map((outcome) => outcome.column),
  "comment",
] as const;

/** The item a record answered, as the sheet needs it. */
export type SheetItem = Pick<W1Item, "id" | "question" | "metrics" | "rule" | "measure">;

export type KeyEntry = Readonly<{
  sheetId: string;
  model: string;
  itemId: string;
  condition: StudyRecord["condition"];
  repeat: number;
}>;

export type RaterKey = Readonly<{
  version: string;
  salt: string;
  entries: readonly KeyEntry[];
}>;

const shuffle = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other]!, out[index]!];
  }
  return out;
};

/** Up to `n` base answers, stratified by stratum in proportion, seeded. */
export const raterSample = (
  records: readonly StudyRecord[],
  n: number,
  seed: number,
): readonly StudyRecord[] => {
  const eligible = records.filter(
    (record) =>
      record.variant === "base" && record.answer !== null && record.score !== null,
  );
  const strata = [...new Set(eligible.map((record) => record.stratum))].sort();
  const random = randomFor(seed, "rater-sample");
  const picked = strata.flatMap((stratum) => {
    const members = eligible.filter((record) => record.stratum === stratum);
    const quota = Math.max(1, Math.round((n * members.length) / eligible.length));
    return shuffle(members, random).slice(0, quota);
  });
  return shuffle(picked, random).slice(0, n);
};

export const sheetId = (salt: string, record: StudyRecord): string =>
  createHmac("sha256", salt)
    .update(`${record.model}|${record.itemId}|${record.condition}|${record.repeat}`)
    .digest("hex")
    .slice(0, 16);

const readingsText = (item: SheetItem): string =>
  [...item.metrics]
    .sort((a, b) => a.source.localeCompare(b.source) || b.date.localeCompare(a.date))
    .map(
      (metric) =>
        `${WEARABLE_SOURCE_LABEL[metric.source]}, ${formatDate(metric.date)}: ${formatMetricValue(metric)} [${metric.key}]`,
    )
    .join("\n");

const answerSection = (answer: string): string =>
  answer
    .split(/^##\s*Answer\s*$/im)[1]
    ?.split(/^##\s/m)[0]
    ?.trim() ?? answer.trim();

const outcomesFor = (stratum: W1Item["stratum"], expectsNumber: boolean): string =>
  RATED_OUTCOMES.filter((outcome) =>
    outcome.stratum === null ? expectsNumber : outcome.stratum === stratum,
  )
    .map((outcome) => outcome.column)
    .join(", ");

export type RaterSheet = Readonly<{ csv: string; key: RaterKey }>;

/** The sheet and its key; `items` must hold every sampled record's item. */
export const raterSheet = (
  sample: readonly StudyRecord[],
  items: ReadonlyMap<string, SheetItem>,
  salt: string,
): RaterSheet => {
  const rows = sample.map((record) => {
    const item = items.get(record.itemId);
    if (item === undefined) throw new Error(`No item ${record.itemId} for the sheet`);
    return [
      sheetId(salt, record),
      item.question,
      readingsText(item),
      ruleText(item.rule, FIXED_ORDER, item.measure),
      (record.score?.citedKeys ?? []).join("\n"),
      answerSection(record.answer ?? ""),
      outcomesFor(record.stratum, record.expected.kind === "state"),
      ...RATED_OUTCOMES.map(() => ""),
      "",
    ];
  });
  const csv =
    [SHEET_COLUMNS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n";
  return {
    csv,
    key: {
      version: STUDY_RATER_VERSION,
      salt,
      entries: sample.map((record) => ({
        sheetId: sheetId(salt, record),
        model: record.model,
        itemId: record.itemId,
        condition: record.condition,
        repeat: record.repeat,
      })),
    },
  };
};

export type FilledRow = Readonly<{
  sheetId: string;
  codes: Readonly<Partial<Record<RatedColumn, boolean>>>;
}>;

export type FilledSheet = Readonly<{
  rows: readonly FilledRow[];
  problems: readonly string[];
}>;

const CODE: Readonly<Record<string, boolean>> = {
  y: true,
  yes: true,
  n: false,
  no: false,
};

/** The rater's codes; a code that is not y, n or blank, or an unknown header, is a problem. */
export const readFilledSheet = (text: string): FilledSheet => {
  const [header, ...body] = parseCsv(text);
  if (header === undefined || header.join(",") !== SHEET_COLUMNS.join(",")) {
    return { rows: [], problems: ["The header is not the study's rater sheet header."] };
  }
  const problems: string[] = [];
  const rows = body
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells): FilledRow => {
      const id = cells[0] ?? "";
      const codes: Partial<Record<RatedColumn, boolean>> = {};
      for (const outcome of RATED_OUTCOMES) {
        const raw = (cells[SHEET_COLUMNS.indexOf(outcome.column)] ?? "")
          .trim()
          .toLowerCase();
        if (raw === "") continue;
        const code = CODE[raw];
        if (code === undefined)
          problems.push(`${id}: ${outcome.column} is "${raw}", not y or n.`);
        else codes[outcome.column] = code;
      }
      return { sheetId: id, codes };
    });
  return { rows, problems };
};

export type OutcomeAgreement = Readonly<{
  column: RatedColumn;
  /** Rows the rater coded and the scorer scored. */
  n: number;
  /** The scorer's share of `y` over those rows. */
  prevalence: number | null;
  kappa: Kappa | null;
}>;

/** Cohen's kappa between rater and scorer, per outcome. */
export const raterAgreement = (
  filled: FilledSheet,
  key: RaterKey,
  records: readonly StudyRecord[],
): readonly OutcomeAgreement[] => {
  const recordOf = new Map(
    records
      .filter((record) => record.variant === "base")
      .map((record) => [
        `${record.model}|${record.itemId}|${record.condition}|${record.repeat}`,
        record,
      ]),
  );
  const entryOf = new Map(key.entries.map((entry) => [entry.sheetId, entry]));
  return RATED_OUTCOMES.map((outcome) => {
    const pairs = filled.rows.flatMap((row): (readonly [string, string])[] => {
      const rater = row.codes[outcome.column];
      const entry = entryOf.get(row.sheetId);
      if (rater === undefined || entry === undefined) return [];
      const scorer = recordOf.get(
        `${entry.model}|${entry.itemId}|${entry.condition}|${entry.repeat}`,
      )?.score?.[outcome.field];
      return typeof scorer === "boolean"
        ? [[scorer ? "y" : "n", rater ? "y" : "n"] as const]
        : [];
    });
    return {
      column: outcome.column,
      n: pairs.length,
      prevalence:
        pairs.length === 0
          ? null
          : pairs.filter((pair) => pair[0] === "y").length / pairs.length,
      kappa: cohenKappa(pairs),
    };
  });
};
