/**
 * Finds the numbers a model wrote and decides whether one stands for a value.
 *
 * Shared by the evaluation scorers (`scripts/evaluation/score/`) and the answer
 * column's number links (`number-sources.ts`), so a number the app shows as
 * sourced is one the scorer counts as sourced. Pure. The rules are written out
 * in docs/evaluation/harness.md:
 *
 * - Numbers are read with `,` or `'` thousands separators ("1'234") and `.`
 *   decimals; a decimal comma ("1,5") is not parsed. A minus counts only after
 *   a space or bracket, so `2024-01-01` reads as 2024, 1, 1 on both sides of a
 *   comparison. Subject refs (UUIDs) and LOINC codes (`8867-4`) are removed
 *   first, so a code the model cites is never read as a stated value.
 * - A narrated number matches a source when the source rounded to the narrated
 *   number's decimals equals it, or within 1 %. The rounding only counts when
 *   the narrated number has at least the value's display decimals
 *   (`displayDecimals`), so "2" never stands for 1.62.
 */
import { MEASURES, measureKindFor, roundTo } from "./format-measure";

export type NarratedNumber = Readonly<{
  value: number;
  decimals: number;
  /** The number as written, minus and grouping included. */
  text: string;
  /** Where the number starts in the text. */
  start: number;
  /** Where the number ends in the text, for the unit that should follow it. */
  end: number;
  /** -1 for a minus or a falling word before it, 1 for a rising word, null when unsaid. */
  sign: 1 | -1 | null;
}>;

export const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** A LOINC code: 3 to 5 digits, a hyphen and one check digit (`4548-4`), also at a sentence end. */
export const LOINC_PATTERN = /(?<![\w.-])\d{3,5}-\d(?![\w-]|\.\d)/g;

const NUMBER_PATTERN =
  /(?<![\w.])(?:(?<=^|[\s(=:~≈<>±])-)?(?:\d{1,3}(?:[,'’]\d{3})+|\d+)(?:\.\d+)?(?!\d)/g;

/** Words that give an unsigned number a direction, looked for just before it. */
const RISING =
  /\b(?:rose|rise|rising|risen|increased?|increasing|up|higher|gained|grew|climbed)\b/g;
const FALLING =
  /\b(?:fell|fall|falling|fallen|decreased?|decreasing|down|lower|dropped|declined|lost)\b/g;
const DIRECTION_WINDOW = 25;

const lastIndex = (text: string, pattern: RegExp): number =>
  Math.max(-1, ...[...text.matchAll(pattern)].map((match) => match.index ?? -1));

const directionBefore = (text: string, start: number): 1 | -1 | null => {
  const before = text.slice(Math.max(0, start - DIRECTION_WINDOW), start).toLowerCase();
  const up = lastIndex(before, RISING);
  const down = lastIndex(before, FALLING);
  if (up === -1 && down === -1) return null;
  return up > down ? 1 : -1;
};

/** The integers 0 to 10 may appear in any answer (counts, list items); no decimals. */
export const ALLOWED_CONSTANTS: readonly number[] = Array.from(
  { length: 11 },
  (_, i) => i,
);

/** Whether a narrated number is one of `ALLOWED_CONSTANTS`, written without decimals. */
export const isAllowedConstant = (narrated: NarratedNumber): boolean =>
  narrated.decimals === 0 && ALLOWED_CONSTANTS.includes(narrated.value);

export const DAYS_PER_YEAR = [365, 365.25] as const;

export const blankOut = (text: string, pattern: RegExp): string =>
  text.replace(pattern, (match) => " ".repeat(match.length));

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;

/**
 * Dates and years in a reply: `2024-01-01` (with any time), `3 Mar 2026`,
 * `March 3, 2026`, and a lone year 1900 to 2099. Values are checked, not the
 * dates a reply mentions.
 */
export const DATE_PATTERN = new RegExp(
  [
    String.raw`\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?`,
    String.raw`\b\d{1,2}\s+${MONTH}\s+\d{4}\b`,
    String.raw`\b${MONTH}\s+\d{1,2},?\s+\d{4}\b`,
    String.raw`(?<![\d.])\b(?:19|20)\d{2}\b(?!\.\d)`,
  ].join("|"),
  "gi",
);

/** The text with every date blanked out, positions kept. */
export const withoutDates = (text: string): string => blankOut(text, DATE_PATTERN);

export const narratedNumbers = (text: string): NarratedNumber[] => {
  const cleaned = blankOut(
    blankOut(text.replace(/−/g, "-"), UUID_PATTERN),
    LOINC_PATTERN,
  );
  return [...cleaned.matchAll(NUMBER_PATTERN)].map((match) => {
    const raw = match[0].replace(/[,'’]/g, "");
    const fraction = raw.split(".")[1];
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const value = Number(raw);
    return {
      value,
      decimals: fraction?.length ?? 0,
      text: text.slice(start, end),
      start,
      end,
      sign: value < 0 ? -1 : directionBefore(cleaned, start),
    };
  });
};

/** Every number a value holds: numbers, and numbers written inside strings. */
export const numbersIn = (value: unknown): number[] => {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value === "string") return narratedNumbers(value).map((n) => n.value);
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) =>
      key === "slope_per_day" && typeof inner === "number"
        ? [inner, ...DAYS_PER_YEAR.map((days) => inner * days)]
        : numbersIn(inner),
    );
  }
  return [];
};

const sameSize = (a: number, b: number): boolean => Math.abs(a) === Math.abs(b);

/**
 * The fewest decimals a narrated number needs before rounding may stand for a
 * value: 0 for an integer, the app's display precision for a unit it formats
 * (`kg` 1, `bpm` 0), otherwise 1.
 */
export const displayDecimals = (target: number, unit: string | null): number => {
  if (Number.isInteger(target)) return 0;
  const kind = unit === null ? null : measureKindFor("", unit);
  return kind === null ? 1 : MEASURES[kind].decimals;
};

export const roundsTo = (
  narrated: NarratedNumber,
  target: number,
  unit: string | null = null,
): boolean =>
  narrated.decimals >= displayDecimals(target, unit) &&
  sameSize(roundTo(target, narrated.decimals), narrated.value);

/** The sizes differ by at most `rel` of the target's size. */
export const withinRelative = (
  narrated: NarratedNumber,
  target: number,
  rel: number,
): boolean => {
  const goal = Math.abs(target);
  return Math.abs(Math.abs(narrated.value) - goal) <= rel * goal;
};

/** Hallucination's "small tolerance": rounding, or within 1 % of a source. */
export const SOURCE_REL_TOLERANCE = 0.01;

export const supportedBy = (
  narrated: NarratedNumber,
  sources: readonly number[],
): boolean =>
  sources.some(
    (source) =>
      roundsTo(narrated, source) ||
      withinRelative(narrated, source, SOURCE_REL_TOLERANCE),
  );
