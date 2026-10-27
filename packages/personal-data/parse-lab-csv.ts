import { isValidUcum } from "@open-twin/fhir-r4";

import { detectDelimiter, parseDelimited } from "./delimited";
import { EFFECTIVE_TIME_REASONS, parseEffectiveTime } from "./effective-time";
import { lookupLabCode, normaliseTestName } from "./lab-test-names";
import { MAX_ROWS } from "./limits";
import { isLoincCode } from "./loinc-code";
import type { ObservationDraft, ParsedImport, Unmapped } from "./types";

/**
 * Lab results as CSV (or TSV): a header with `date`, `test`, `value` and
 * `unit`, and optionally `loinc` and `note`, in any order and case. One row is
 * one number.
 *
 * - The value must be a plain number (`5.4`, `-1`, `1e3`). `<0.5`, `positive`
 *   or an empty cell is reported, not stored: missing is not zero, and a
 *   bound is not a value.
 * - The unit is stored as written and never converted. A row without a unit
 *   is reported.
 * - A `loinc` cell is used when it is a well-formed code (check digit
 *   included); a malformed one reports the row. Without it, the test name is
 *   looked up in the explicit table (`lab-test-names.ts`); a name not there
 *   is stored with no code.
 */

export const LAB_CSV_COLUMNS = ["date", "test", "value", "unit"] as const;
const OPTIONAL_COLUMNS = ["loinc", "note"] as const;
const LOINC_SYSTEM = "http://loinc.org";

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

type ColumnIndex = Readonly<Record<(typeof LAB_CSV_COLUMNS)[number], number>> &
  Readonly<Partial<Record<(typeof OPTIONAL_COLUMNS)[number], number>>>;

const columnIndex = (header: readonly string[]): ColumnIndex | readonly string[] => {
  const names = header.map((cell) => cell.trim().toLowerCase());
  const find = (name: string) => names.indexOf(name);
  const missing = LAB_CSV_COLUMNS.filter((name) => find(name) === -1);
  if (missing.length > 0) return missing;
  const optional = Object.fromEntries(
    OPTIONAL_COLUMNS.flatMap((name) => (find(name) === -1 ? [] : [[name, find(name)]])),
  );
  return {
    date: find("date"),
    test: find("test"),
    value: find("value"),
    unit: find("unit"),
    ...optional,
  };
};

type RowOutcome =
  | Readonly<{ ok: true; draft: ObservationDraft; unitMismatch: boolean }>
  | Readonly<{ ok: false; unmapped: Unmapped }>;

const readRow = (
  row: readonly string[],
  columns: ColumnIndex,
  width: number,
  rowNumber: number,
): RowOutcome => {
  const where = `row ${rowNumber}`;
  const fail = (code: string, reason: string): RowOutcome => ({
    ok: false,
    unmapped: { where, code, reason },
  });
  if (row.length !== width) {
    return fail("field-count", `has ${row.length} fields; the header has ${width}`);
  }
  const cell = (index: number | undefined) =>
    index === undefined ? "" : (row[index] ?? "").trim();

  const test = cell(columns.test);
  if (test === "") return fail("no-test", "has no test name");
  const rawValue = cell(columns.value);
  if (rawValue === "") return fail("no-value", "has no value");
  if (!NUMBER.test(rawValue)) {
    return fail("not-a-number", "has a value that is not a plain number");
  }
  const unit = cell(columns.unit);
  if (unit === "") return fail("no-unit", "has no unit");
  const time = parseEffectiveTime(cell(columns.date));
  if (!time.ok) return fail(`date-${time.reason}`, EFFECTIVE_TIME_REASONS[time.reason]);

  const givenLoinc = cell(columns.loinc);
  if (givenLoinc !== "" && !isLoincCode(givenLoinc)) {
    return fail("bad-loinc", "has a LOINC code that is not well formed");
  }
  const match = givenLoinc === "" ? lookupLabCode(test, unit) : null;
  const code =
    givenLoinc !== "" ? givenLoinc : match?.kind === "coded" ? match.loinc : null;
  const note = cell(columns.note);

  return {
    ok: true,
    unitMismatch: match?.kind === "unit-mismatch",
    draft: {
      codeSystem: code === null ? null : LOINC_SYSTEM,
      code,
      display: test,
      value: Number(rawValue),
      unit,
      unitUcum: isValidUcum(unit),
      effectiveAt: time.time.at,
      effectivePrecision: time.time.precision,
      sourceRef: where,
      note: note === "" ? null : note,
    },
  };
};

export const parseLabCsv = (text: string): ParsedImport => {
  const parsed = parseDelimited(text, detectDelimiter(text));
  if (!parsed.ok) {
    return {
      ok: false,
      refusal: {
        code: "unclosed-quote",
        message: `A quoted field that starts on line ${parsed.line} is never closed.`,
      },
    };
  }
  const [header, ...rows] = parsed.rows;
  if (header === undefined || rows.length === 0) {
    return {
      ok: false,
      refusal: { code: "empty", message: "The file has no rows under its header." },
    };
  }
  const columns = columnIndex(header);
  if (Array.isArray(columns)) {
    return {
      ok: false,
      refusal: {
        code: "missing-columns",
        message: `The header needs the columns date, test, value and unit; missing: ${columns.join(", ")}.`,
      },
    };
  }
  if (rows.length > MAX_ROWS) {
    return {
      ok: false,
      refusal: {
        code: "too-many-rows",
        message: `The file has ${rows.length} rows; the limit is ${MAX_ROWS}.`,
      },
    };
  }
  const outcomes = rows.map((row, index) =>
    readRow(row, columns as ColumnIndex, header.length, index + 2),
  );
  const observations = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.draft] : []));
  const unmapped = outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.unmapped]));
  const uncoded = new Set(
    observations
      .filter((row) => row.code === null)
      .map((row) => normaliseTestName(row.display)),
  );
  const mismatched = outcomes.filter(
    (outcome) => outcome.ok && outcome.unitMismatch,
  ).length;
  const notes = [
    ...(uncoded.size > 0
      ? [
          `${uncoded.size} test name${uncoded.size === 1 ? " is" : "s are"} not in the LOINC name table; those rows keep their name with no code.`,
        ]
      : []),
    ...(mismatched > 0
      ? [
          `${mismatched} row${mismatched === 1 ? " has" : "s have"} a known test name in a unit that does not fit its LOINC code, so no code was given.`,
        ]
      : []),
  ];
  return { ok: true, kind: "lab-csv", observations, unmapped, notes };
};
