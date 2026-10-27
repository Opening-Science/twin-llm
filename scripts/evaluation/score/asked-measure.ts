/**
 * Which measure a question asks about, and which tool results hold it.
 *
 * Hallucination uses this to catch an answer that reports a measure with the
 * value of another code: asked for skin temperature, a model reads systolic
 * blood pressure (`8480-6`) and calls its value the skin temperature. Pure.
 *
 * - The asked codes are the LOINC codes in the item's `expect.values` and its
 *   answer-key entries (`args.loinc`), any code written in the question, and
 *   the codes of the measure names the question uses (`MEASURE_NAMES`). A
 *   wearable metric (readiness, recovery, skin temperature, …) has no code: a
 *   warehouse code never stands for it.
 * - A tool result's numbers belong to a code when they sit in an object with a
 *   `loinc` field (a row, a trend). In a result with no such object they
 *   belong to the codes in the call's input (`summary_stats` returns no code).
 *   Other numbers are neutral: those beside coded objects (`coverage`'s
 *   `days_in_window`), those of a refusal (its limits), and those of a call
 *   that names no code (`subject_window`, `list_subjects`, guideline search).
 * - The asked years come from ISO dates and from years after "in", "from",
 *   "between", "over", "to", "and", "with", "during", "through" or "for", or in
 *   a range ("2004–2008"). "Under the 2019 guideline" names no window. A call's
 *   years are those of every ISO date in its input and output.
 * - A value of an asked code may also be narrated in a common other unit
 *   (`CONVERSIONS`), so "176 lb" is the same reading as 80 kg.
 */
import type { ToolResultLine } from "../eval-results";
import type { KeyEntry, Question } from "../question-set";

import { withConversions } from "../../../infrastructure/number-sources";

import { blankOut, LOINC_PATTERN, UUID_PATTERN } from "./numbers";

export { CONVERSIONS } from "../../../infrastructure/number-sources";

export type MeasureName = Readonly<{
  measure: string;
  pattern: RegExp;
  /** Empty for a wearable metric: no warehouse code holds it. */
  codes: readonly string[];
}>;

const BLOOD_PRESSURE = ["8480-6", "8462-4", "85354-9"] as const;

/**
 * Measure names a question may use. Systolic and diastolic share their codes:
 * one reading gives both, so naming the other half is not another measure.
 */
export const MEASURE_NAMES: readonly MeasureName[] = [
  {
    measure: "HbA1c",
    pattern: /\bhba1c\b|\ba1c\b|glycated ha?emoglobin/i,
    codes: ["4548-4", "17856-6"],
  },
  { measure: "systolic blood pressure", pattern: /\bsystolic\b/i, codes: BLOOD_PRESSURE },
  {
    measure: "diastolic blood pressure",
    pattern: /\bdiastolic\b/i,
    codes: BLOOD_PRESSURE,
  },
  {
    measure: "blood pressure",
    pattern: /(?<!systolic |diastolic )\bblood pressure\b/i,
    codes: BLOOD_PRESSURE,
  },
  {
    measure: "heart rate",
    pattern: /\b(?:resting )?heart rate\b(?! variability)/i,
    codes: ["8867-4", "40443-4"],
  },
  { measure: "body weight", pattern: /\bweight\b/i, codes: ["29463-7"] },
  { measure: "BMI", pattern: /\bbmi\b|body mass index/i, codes: ["39156-5"] },
  { measure: "glucose", pattern: /\bglucose\b/i, codes: ["2339-0", "2345-7"] },
  {
    measure: "LDL cholesterol",
    pattern: /\bldl\b/i,
    codes: ["18262-6", "13457-7", "2089-1"],
  },
  { measure: "HDL cholesterol", pattern: /\bhdl\b/i, codes: ["2085-9"] },
  {
    measure: "total cholesterol",
    pattern: /(?<!ldl |hdl )\bcholesterol\b/i,
    codes: ["2093-3"],
  },
  { measure: "triglycerides", pattern: /\btriglycerides?\b/i, codes: ["2571-8"] },
  { measure: "TSH", pattern: /\btsh\b|thyroid.stimulating/i, codes: ["3016-3"] },
  {
    measure: "eGFR",
    pattern: /\begfr\b|glomerular filtration/i,
    codes: ["33914-3", "62238-1", "48642-3", "48643-1", "98979-8"],
  },
  { measure: "creatinine", pattern: /\bcreatinine\b/i, codes: ["38483-4", "2160-0"] },
  {
    measure: "red cell distribution width",
    pattern: /red (?:blood )?cell distribution width|\brdw\b/i,
    codes: ["788-0", "21000-5"],
  },
  {
    measure: "oxygen saturation",
    pattern: /oxygen saturation|\bspo2\b/i,
    codes: ["59408-5", "2708-6"],
  },
  {
    measure: "body temperature",
    pattern: /(?<!skin )\b(?:body )?temperature\b/i,
    codes: ["8310-5"],
  },
  { measure: "skin temperature", pattern: /skin.temperature/i, codes: [] },
  { measure: "readiness", pattern: /\breadiness\b/i, codes: [] },
  { measure: "recovery score", pattern: /\brecovery\b/i, codes: [] },
  { measure: "strain", pattern: /\bstrain\b/i, codes: [] },
  {
    measure: "heart rate variability",
    pattern: /heart rate variability|\bhrv\b/i,
    codes: [],
  },
  { measure: "sleep score", pattern: /\bsleep\b/i, codes: [] },
];

export type YearSpan = Readonly<{ from: number; to: number }>;

export type AskedMeasure = Readonly<{
  /** For the reason line: "eGFR (33914-3)", "skin temperature (no LOINC code)". */
  label: string;
  codes: ReadonlySet<string>;
  years: YearSpan | null;
}>;

const loincsOf = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string");
  return [];
};

const argsLoinc = (args: unknown): readonly string[] =>
  typeof args === "object" && args !== null ? loincsOf(Reflect.get(args, "loinc")) : [];

const YEAR = String.raw`(?:19|20)\d{2}`;
const ISO_DATE = new RegExp(String.raw`\b(${YEAR})-\d{2}-\d{2}`, "g");
const WINDOW_YEAR = new RegExp(
  String.raw`\b(?:in|from|between|over|to|and|with|during|through|for)\s+(${YEAR})\b(?!-)`,
  "gi",
);
const YEAR_RANGE = new RegExp(String.raw`\b(${YEAR})\s*[–—-]\s*(${YEAR})\b`, "g");

const spanOf = (years: readonly number[]): YearSpan | null =>
  years.length === 0 ? null : { from: Math.min(...years), to: Math.max(...years) };

/** The years a question asks about, or null when it names no window. */
export const askedYears = (question: string): YearSpan | null => {
  const text = blankOut(question, UUID_PATTERN);
  return spanOf([
    ...[...text.matchAll(ISO_DATE)].map((m) => Number(m[1])),
    ...[...text.matchAll(WINDOW_YEAR)].map((m) => Number(m[1])),
    ...[...text.matchAll(YEAR_RANGE)].flatMap((m) => [Number(m[1]), Number(m[2])]),
  ]);
};

/** The years of every ISO date a tool call's input or output holds. */
export const callYears = (result: ToolResultLine): YearSpan | null =>
  spanOf(
    [...JSON.stringify([result.input, result.output]).matchAll(ISO_DATE)].map((m) =>
      Number(m[1]),
    ),
  );

/** The measure the question asks about, or null when it names none. */
export const askedMeasure = (
  item: Question,
  keyEntries: readonly KeyEntry[],
): AskedMeasure | null => {
  const named = MEASURE_NAMES.filter((name) => name.pattern.test(item.question));
  const written = [...blankOut(item.question, UUID_PATTERN).matchAll(LOINC_PATTERN)].map(
    (m) => m[0],
  );
  const specified = [
    ...(item.expect.values ?? []).flatMap((spec) => argsLoinc(spec.args)),
    ...keyEntries.flatMap((entry) => argsLoinc(entry.args)),
    ...written,
  ];
  const codes = new Set([...specified, ...named.flatMap((name) => name.codes)]);
  if (named.length === 0 && codes.size === 0) return null;
  const keyed = [...new Set(specified)];
  const names = named.map((name) => name.measure);
  const label =
    names.length === 0
      ? keyed.join(", ")
      : keyed.length > 0
        ? `${names.join(", ")} (${keyed.join(", ")})`
        : codes.size > 0
          ? `${names.join(", ")} (${[...codes].join(", ")})`
          : `${names.join(", ")} (no LOINC code)`;
  return { label, codes, years: askedYears(item.question) };
};

/** Numbers of one tool result that belong to one set of codes; empty codes is neutral. */
export type CodedNumbers = Readonly<{
  codes: readonly string[];
  /** The `display` name the result gave, when it gave one. */
  display: string | null;
  numbers: readonly number[];
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const holdsCode = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(holdsCode);
  if (!isRecord(value)) return false;
  return typeof value.loinc === "string" || Object.values(value).some(holdsCode);
};

const stringField = (record: Readonly<Record<string, unknown>>, key: string) => {
  const value = record[key];
  return typeof value === "string" ? value : null;
};

const coded = (
  value: unknown,
  codes: readonly string[],
  unit: string | null,
): readonly CodedNumbers[] => {
  if (Array.isArray(value)) return value.flatMap((inner) => coded(inner, codes, unit));
  if (isRecord(value)) {
    const own = stringField(value, "loinc");
    const ownUnit = stringField(value, "unit_ucum") ?? stringField(value, "unit") ?? unit;
    if (own !== null) {
      return [
        {
          codes: [own],
          display: stringField(value, "display"),
          numbers: withConversions(value, [own], ownUnit),
        },
      ];
    }
    if (holdsCode(value)) {
      return Object.entries(value).flatMap(([key, inner]) =>
        holdsCode(inner)
          ? coded(inner, codes, ownUnit)
          : coded({ [key]: inner }, [], ownUnit),
      );
    }
    return [
      {
        codes,
        display: null,
        numbers: withConversions(value, codes, ownUnit),
      },
    ];
  }
  return [{ codes, display: null, numbers: withConversions(value, codes, unit) }];
};

/** A tool call as hallucination sees it: which codes it read, and its numbers by code. */
export type MeasureCall = Readonly<{
  tool: string;
  codes: readonly string[];
  parts: readonly CodedNumbers[];
  years: YearSpan | null;
  /** The call returned at least one reading: a row, or a count `n` above 0. A refusal returns none. */
  returnedReadings: boolean;
}>;

const holdsReadings = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(holdsReadings);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, inner]) =>
      (key === "rows" && Array.isArray(inner) && inner.length > 0) ||
      (key === "n" && typeof inner === "number" && inner > 0) ||
      holdsReadings(inner),
  );
};

export const measureCall = (result: ToolResultLine): MeasureCall => {
  const inputCodes = argsLoinc(result.input);
  // A refusal (`{ code: "ROW_CAP_EXCEEDED", … }`) states limits, not readings.
  const refused = isRecord(result.output) && typeof result.output.code === "string";
  const parts = coded(result.output, refused ? [] : inputCodes, null);
  return {
    tool: result.tool,
    codes: [...new Set([...inputCodes, ...parts.flatMap((part) => part.codes)])],
    parts,
    years: callYears(result),
    returnedReadings: !refused && holdsReadings(result.output),
  };
};

export const readsAsked = (codes: readonly string[], asked: AskedMeasure): boolean =>
  codes.some((code) => asked.codes.has(code));

export const overlaps = (a: YearSpan, b: YearSpan): boolean =>
  a.from <= b.to && b.from <= a.to;

/** "8480-6 (Systolic Blood Pressure)" for each code, named as a tool result named it. */
export const describeCodes = (
  codes: readonly string[],
  parts: readonly CodedNumbers[],
): string =>
  [...new Set(codes)]
    .map((code) => {
      const display =
        parts.find((part) => part.codes.includes(code) && part.display !== null)
          ?.display ?? null;
      return display === null ? code : `${code} (${display})`;
    })
    .join(", ");
