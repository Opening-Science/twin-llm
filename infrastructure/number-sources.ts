/**
 * Which tool call, and which row of it, each number in an answer came from.
 *
 * One matcher for the answer column and the hallucination scorer: the column
 * links a sourced number to its tool card and leaves the rest plain, and the
 * scorer counts the rest. Pure, so the server runs it on a saved answer's
 * stored tool parts and the browser on the parts it streamed.
 *
 * - Numbers are found by `narratedNumbers` with dates left out. The integers 0
 *   to 10 written without decimals are neither sourced nor unsourced: they are
 *   counts and list items, and linking them would mostly be noise.
 * - A number is sourced by a call when one of the call's output numbers stands
 *   for it (`supportedBy`: rounding or within 1 %). A reading's value also
 *   counts in a common other unit (`CONVERSIONS`), so "176 lb" is sourced by
 *   a row of 80 kg.
 * - A call's rows are its output's list (`rows`, `subjects`, `codes`, a chart's
 *   points, or the output itself when it is a list). Numbers outside a list
 *   (`n`, a mean) source the call with no row.
 * - A source names the call, the row's position and the field; never the value
 *   it read. The number's own text is the only value it carries.
 */
import {
  isAllowedConstant,
  type NarratedNumber,
  narratedNumbers,
  numbersIn,
  supportedBy,
  withoutDates,
} from "./narrated-numbers";

import { ANALYTE_CODES, CONVERSION_TABLE } from "@/packages/query-tools/unit-conversions";

type Conversion = Readonly<{
  units: readonly string[];
  /** Null: any code in that unit. */
  codes: readonly string[] | null;
  convert: (value: number) => number;
}>;

/** Body measures the conversion table (`convert_unit`) does not cover. */
const BODY_CONVERSIONS: readonly Conversion[] = [
  { units: ["kg"], codes: null, convert: (kg) => kg * 2.20462 },
  { units: ["mm[Hg]"], codes: null, convert: (mmHg) => mmHg * 0.133322 },
];

/**
 * Other units a reading is commonly narrated in: the body measures above, and
 * every pair of the exact table `convert_unit` converts with
 * (`packages/query-tools/unit-conversions.ts`), so the tool, this matcher and
 * the hallucination scorer share one set of factors.
 */
export const CONVERSIONS: readonly Conversion[] = [
  ...BODY_CONVERSIONS,
  ...CONVERSION_TABLE.map((rule) => ({
    units: [rule.from],
    codes: ANALYTE_CODES[rule.analyte],
    convert: rule.convert,
  })),
];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null => {
  const value = record[key];
  return typeof value === "string" ? value : null;
};

/** Fields that hold a reading's value; only these are converted. */
const VALUE_KEYS: ReadonlySet<string> = new Set([
  "value",
  "mean",
  "median",
  "min",
  "max",
  "fitted_first",
  "fitted_last",
]);

const readingValues = (value: unknown): readonly number[] => {
  if (Array.isArray(value)) return value.flatMap(readingValues);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    VALUE_KEYS.has(key) && typeof inner === "number" ? [inner] : readingValues(inner),
  );
};

/** Every number of `value`, and its reading values in the other units `CONVERSIONS` lists. */
export const withConversions = (
  value: unknown,
  codes: readonly string[],
  unit: string | null,
): readonly number[] => {
  const apply = CONVERSIONS.filter(
    (conversion) =>
      unit !== null &&
      conversion.units.includes(unit) &&
      (conversion.codes === null ||
        codes.some((code) => conversion.codes?.includes(code))),
  );
  const readings = readingValues(value);
  return [
    ...numbersIn(value),
    ...apply.flatMap((conversion) => readings.map((n) => conversion.convert(n))),
  ];
};

/** A tool call as the matcher needs it: its id and what it was given and returned. */
export type NumberSourcePart = Readonly<{
  toolCallId: string;
  input?: unknown;
  output?: unknown;
}>;

/** One number of the answer and one call (and row) that holds it. */
export type NumberSource = Readonly<{
  /** The number as the answer wrote it. */
  text: string;
  start: number;
  end: number;
  toolCallId: string;
  /** Position in the call's list, from 0; absent for a number outside a list. */
  rowIndex?: number;
  /** The field that holds it (`value`, `mean`, `n`); absent for a bare number. */
  field?: string;
}>;

/** Rows listed per number and call; a common value can sit in hundreds. */
export const MAX_ROWS_PER_CALL = 5;

const ROW_KEYS = ["rows", "subjects", "codes", "points", "views"] as const;

const loincsOf = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string");
  return [];
};

const inputCodes = (input: unknown): readonly string[] =>
  isRecord(input) ? loincsOf(input.loinc) : [];

const unitName = (record: Readonly<Record<string, unknown>>): string | null =>
  stringField(record, "unit_ucum") ?? stringField(record, "unit");

type Field = Readonly<{ field: string | undefined; numbers: readonly number[] }>;

type Slice = Readonly<{ rowIndex: number | undefined; fields: readonly Field[] }>;

/** The value with every date in its strings blanked out. */
const withoutDatesIn = (value: unknown): unknown => {
  if (typeof value === "string") return withoutDates(value);
  if (Array.isArray(value)) return value.map(withoutDatesIn);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, withoutDatesIn(inner)]),
    );
  return value;
};

/** A row or the rest of an output, split into fields with their numbers. */
const toSlice = (
  value: unknown,
  rowIndex: number | undefined,
  codes: readonly string[],
  unit: string | null,
): Slice => {
  if (!isRecord(value)) {
    return {
      rowIndex,
      fields: [
        {
          field: undefined,
          numbers: withConversions(withoutDatesIn(value), codes, unit),
        },
      ],
    };
  }
  const own = stringField(value, "loinc");
  const ownCodes = own === null ? codes : [own];
  const ownUnit = unitName(value) ?? unit;
  return {
    rowIndex,
    fields: Object.entries(value).map(([key, inner]) => ({
      field: key,
      numbers: withConversions({ [key]: withoutDatesIn(inner) }, ownCodes, ownUnit),
    })),
  };
};

/** The list in an output that holds its rows, and the rest of it. */
const splitRows = (
  output: unknown,
): Readonly<{ rows: readonly unknown[]; rest: unknown }> => {
  if (Array.isArray(output)) return { rows: output, rest: null };
  if (!isRecord(output)) return { rows: [], rest: output };
  const spec = isRecord(output.spec) ? output.spec : null;
  const specRows =
    spec === null ? undefined : [spec.points, spec.rows].find(Array.isArray);
  if (spec !== null && specRows !== undefined) {
    const { spec: _spec, ...others } = output;
    return { rows: specRows, rest: others };
  }
  const key = ROW_KEYS.find((name) => Array.isArray(output[name]));
  if (key === undefined) return { rows: [], rest: output };
  const { [key]: rows, ...rest } = output;
  return { rows: Array.isArray(rows) ? rows : [], rest };
};

const slicesOf = (part: NumberSourcePart): readonly Slice[] => {
  if (part.output === undefined) return [];
  const codes = inputCodes(part.input);
  const unit = isRecord(part.output) ? unitName(part.output) : null;
  const { rows, rest } = splitRows(part.output);
  return [
    ...rows.map((row, index) => toSlice(row, index, codes, unit)),
    toSlice(rest, undefined, codes, unit),
  ];
};

/** The answer's numbers that are values: dates and the constants 0 to 10 left out. */
export const answerNumbers = (text: string): readonly NarratedNumber[] =>
  narratedNumbers(withoutDates(text)).filter((narrated) => !isAllowedConstant(narrated));

const sourcesOf = (
  narrated: NarratedNumber,
  calls: readonly Readonly<{ toolCallId: string; slices: readonly Slice[] }>[],
): readonly NumberSource[] =>
  calls.flatMap((call) =>
    call.slices
      .flatMap((slice) => {
        const hit = slice.fields.find((field) => supportedBy(narrated, field.numbers));
        return hit === undefined
          ? []
          : [
              {
                text: narrated.text,
                start: narrated.start,
                end: narrated.end,
                toolCallId: call.toolCallId,
                ...(slice.rowIndex === undefined ? {} : { rowIndex: slice.rowIndex }),
                ...(hit.field === undefined ? {} : { field: hit.field }),
              },
            ];
      })
      .slice(0, MAX_ROWS_PER_CALL),
  );

/** Every sourced number of `text`, in text order, then call order, then row order. */
export const numberSources = (
  text: string,
  parts: readonly NumberSourcePart[],
): NumberSource[] => {
  const calls = parts.map((part) => ({
    toolCallId: part.toolCallId,
    slices: slicesOf(part),
  }));
  return answerNumbers(text).flatMap((narrated) => [...sourcesOf(narrated, calls)]);
};

/**
 * The numbers of `text` that no tool call holds and `given` (the question's
 * own numbers) does not either: the ones the answer column shows plain.
 */
export const unsourcedNumbers = (
  text: string,
  parts: readonly NumberSourcePart[],
  given: readonly number[] = [],
): readonly NarratedNumber[] => {
  const sourced = new Set(numberSources(text, parts).map((source) => source.start));
  return answerNumbers(text).filter(
    (narrated) => !sourced.has(narrated.start) && !supportedBy(narrated, given),
  );
};
