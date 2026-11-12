/**
 * The number finder and the cited-value check against a hand-labelled gold set
 * (#576). `fixtures/narrated-numbers.gold.jsonl` holds synthetic answer
 * snippets, each labelled with the numbers a reader would count as stated
 * values and, where the snippet names a wearable reading, what the check
 * should say about it.
 *
 * - Finder: `answerNumbers` (dates and the integers 0 to 10 left out), the
 *   matcher behind the app's number links and the unsourced-numbers metric.
 *   A gold number counts once; the integers 0 to 10 are dropped from the gold
 *   side too, since every consumer drops them.
 * - Check: `checkCitedValues` per reading, against `expect`. Precision and
 *   recall are given for `matched` (the stated number is the reading) and for
 *   `not_matched` (the check flags a wrong value).
 *
 * Known misses are listed with the reason. A fix that clears one, or a change
 * that adds one, fails this test until the list and the totals are updated,
 * and the figures in docs/evaluation/harness.md ("Limits") with them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import {
  checkCitedValues,
  VALUE_CHECK_STATUSES,
  type ValueCheckStatus,
} from "../../infrastructure/cited-value-check";
import { answerNumbers } from "../../infrastructure/number-sources";

const GOLD_PATH = join(import.meta.dir, "fixtures", "narrated-numbers.gold.jsonl");

const GoldRow = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  text: z.string().min(1),
  numbers: z.array(z.object({ value: z.number(), label: z.string().min(1) })),
  readings: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      value: z.number(),
      unit: z.string().optional(),
      expect: z.enum(VALUE_CHECK_STATUSES),
    }),
  ),
});
type GoldRow = z.infer<typeof GoldRow>;

const rows: readonly GoldRow[] = readFileSync(GOLD_PATH, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => GoldRow.parse(JSON.parse(line)));

/** Rows where the finder's numbers differ from the gold set, and why. */
const FINDER_MISSES: Readonly<Record<string, string>> = {
  "dc-01": "decimal comma is not parsed: 45,3 reads as 45 and 3",
  "dc-02": "decimal comma is not parsed",
  "dc-03": "decimal comma is not parsed",
  "dc-04": "decimal comma is not parsed",
  "dc-05": "decimal comma is not parsed",
  "dc-06": "decimal comma is not parsed",
  "dc-07": "decimal comma is not parsed",
  "dc-08": "decimal comma is not parsed",
  "dc-09": "dot thousands and decimal comma (1.234,5) read as 1.234 and 5",
  "dc-10": "decimal comma is not parsed",
  "dc-11": "decimal comma is not parsed",
  "th-03": "a space as thousands mark (10 000) reads as 10 and 0",
  "th-11": "a dot as thousands mark (8.432) reads as a decimal",
  "dt-13": "a clock time (02:15) reads as 2 and 15",
  "ng-06": "an en dash before a number marks a range, so –1,200 reads as positive",
  "mx-11": "the scale in 82/100 reads as a value",
  "mx-12": "the scale in 82 out of 100 reads as a value",
  "mx-13": "numbers written as words are not read",
};

/** Readings (`row#index`) where the check's status differs from the gold set, and why. */
const CHECK_MISSES: Readonly<Record<string, string>> = {
  "dc-09#0": "dot thousands and decimal comma (1.234,5) read as 1.234",
  "dc-10#1": "one number per mention: a label for two days takes only the first",
  "th-03#0": "a space as thousands mark: 10 000 reads as 000",
  "th-11#0": "a dot as thousands mark reads as a decimal",
  "rg-03#0": "the first number after the label is taken, here a range bound",
  "cl-01#0": "the number is in the next sentence",
  "cl-02#0": "words between a leading number and the label",
  "cl-04#0": "the number is after a semicolon",
  "cl-07#0": "the number is on the next line",
  "cl-08#0": "two labels then two numbers: the first label has none in its window",
  "cl-10#1": "a leading number counts only for the first label in its clause",
  "cl-12#0": "the number is in the next sentence",
  "cl-14#1": "readiness alone does not name Readiness score",
  "cl-15#0": "the number comes before the label, across a colon and words",
  "dt-13#0": "a clock time (02:15) is read as a value outside a duration",
  "mx-13#0": "numbers written as words are not read",
  "us-07#0": "a threshold (below 90 %) is read as the stated value",
};

type Counts = Readonly<{ tp: number; fp: number; fn: number }>;

const precision = ({ tp, fp }: Counts): number => tp / (tp + fp);
const recall = ({ tp, fn }: Counts): number => tp / (tp + fn);

const isConstant = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 10;

/** Matched, extra and missed numbers for one row, as multisets of values. */
const finderRow = (row: GoldRow): Counts => {
  const gold = row.numbers.map((number) => number.value).filter((v) => !isConstant(v));
  const found = answerNumbers(row.text).map((narrated) => narrated.value);
  const left = [...gold];
  const tp = found.filter((value) => {
    const at = left.indexOf(value);
    if (at === -1) return false;
    left.splice(at, 1);
    return true;
  }).length;
  return { tp, fp: found.length - tp, fn: left.length };
};

const sum = (counts: readonly Counts[]): Counts =>
  counts.reduce((a, b) => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn }), {
    tp: 0,
    fp: 0,
    fn: 0,
  });

type CheckedPair = Readonly<{
  id: string;
  expected: ValueCheckStatus;
  got: ValueCheckStatus | null;
}>;

const checked: readonly CheckedPair[] = rows.flatMap((row) => {
  const results = checkCitedValues(row.text, row.readings);
  return row.readings.map((reading, index) => ({
    id: `${row.id}#${index}`,
    expected: reading.expect,
    got: results[index]?.status ?? null,
  }));
});

const statusCounts = (status: ValueCheckStatus): Counts => ({
  tp: checked.filter((pair) => pair.got === status && pair.expected === status).length,
  fp: checked.filter((pair) => pair.got === status && pair.expected !== status).length,
  fn: checked.filter((pair) => pair.got !== status && pair.expected === status).length,
});

describe("gold set", () => {
  test("at least 120 rows with distinct ids", () => {
    expect(rows.length).toBeGreaterThanOrEqual(120);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  test("every listed miss names a row in the set", () => {
    const ids = new Set(rows.map((row) => row.id));
    const readingIds = new Set(checked.map((pair) => pair.id));
    expect(Object.keys(FINDER_MISSES).filter((id) => !ids.has(id))).toEqual([]);
    expect(Object.keys(CHECK_MISSES).filter((id) => !readingIds.has(id))).toEqual([]);
  });
});

describe("number finder against the gold set", () => {
  const perRow = rows.map((row) => ({ id: row.id, counts: finderRow(row) }));
  const total = sum(perRow.map((row) => row.counts));

  test("misses only the listed rows", () => {
    const missed = perRow
      .filter(({ counts }) => counts.fp > 0 || counts.fn > 0)
      .map(({ id }) => id);
    expect(missed).toEqual(Object.keys(FINDER_MISSES));
  });

  test("precision and recall", () => {
    expect(total).toEqual({ tp: 160, fp: 16, fn: 16 });
    expect(precision(total)).toBeCloseTo(0.909, 3);
    expect(recall(total)).toBeCloseTo(0.909, 3);
  });
});

describe("cited-value check against the gold set", () => {
  test("disagrees only on the listed readings", () => {
    const wrong = checked
      .filter((pair) => pair.got !== pair.expected)
      .map((pair) => pair.id);
    expect(wrong).toEqual(Object.keys(CHECK_MISSES));
  });

  test("matched: precision and recall", () => {
    const counts = statusCounts("matched");
    expect(counts).toEqual({ tp: 91, fp: 0, fn: 16 });
    expect(precision(counts)).toBeCloseTo(1, 3);
    expect(recall(counts)).toBeCloseTo(0.85, 3);
  });

  test("not_matched: precision and recall", () => {
    const counts = statusCounts("not_matched");
    expect(counts).toEqual({ tp: 14, fp: 5, fn: 0 });
    expect(precision(counts)).toBeCloseTo(0.737, 3);
    expect(recall(counts)).toBeCloseTo(1, 3);
  });
});
