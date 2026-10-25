/**
 * Finds numbers in an answer and decides whether one matches a value.
 *
 * `infrastructure/format-measure.ts` only formats, so the reading side lives
 * here, beside the scorers that use it, and uses its `roundTo` so a number the
 * model rounded the way the app would is accepted. The rules are written out in
 * docs/evaluation/harness.md:
 *
 * - Numbers are read with `,` or `'` thousands separators ("1'234") and `.`
 *   decimals; a decimal comma ("1,5") is not parsed. A minus counts only after
 *   a space or bracket, so `2024-01-01` reads as 2024, 1, 1 on both sides of a
 *   comparison. Subject refs (UUIDs) and LOINC codes (`8867-4`) are removed
 *   first, so a code the model cites is never read as a stated value.
 * - A narrated number matches a value when it is within the item's tolerance,
 *   or when the value rounded to the narrated number's decimals equals it. The
 *   rounding only counts when the narrated number has at least the value's
 *   display decimals (`displayDecimals`), so "2" never stands for 1.62.
 * - The size is compared first; the sign is checked apart (`signDiffers`): an
 *   explicit minus, or a "rose"/"fell" word just before the number.
 * - A `slope_per_day` also matches at ×365 and ×365.25, since a per-year
 *   slope is allowed.
 */
import {
  MEASURES,
  measureKindFor,
  roundTo,
} from "../../../infrastructure/format-measure";

import type { ValueSpec } from "../question-set";

export type NarratedNumber = Readonly<{
  value: number;
  decimals: number;
  /** Where the number ends in the text, for the unit that should follow it. */
  end: number;
  /** -1 for a minus or a falling word before it, 1 for a rising word, null when unsaid. */
  sign: 1 | -1 | null;
}>;

export const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** A LOINC code: 3 to 5 digits, a hyphen and one check digit (`4548-4`). */
export const LOINC_PATTERN = /(?<![\w.-])\d{3,5}-\d(?![\w.-])/g;

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

export const DAYS_PER_YEAR = [365, 365.25] as const;

const blankOut = (text: string, pattern: RegExp): string =>
  text.replace(pattern, (match) => " ".repeat(match.length));

export const narratedNumbers = (text: string): NarratedNumber[] => {
  const cleaned = blankOut(
    blankOut(text.replace(/−/g, "-"), UUID_PATTERN),
    LOINC_PATTERN,
  );
  return [...cleaned.matchAll(NUMBER_PATTERN)].map((match) => {
    const raw = match[0].replace(/[,'’]/g, "");
    const fraction = raw.split(".")[1];
    const start = match.index ?? 0;
    const value = Number(raw);
    return {
      value,
      decimals: fraction?.length ?? 0,
      end: start + match[0].length,
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

/** The narrated sign, when one is said, is the opposite of the value's. */
export const signDiffers = (narrated: NarratedNumber, target: number): boolean =>
  narrated.sign !== null && target !== 0 && narrated.sign !== Math.sign(target);

export const withinTolerance = (
  narrated: NarratedNumber,
  target: number,
  tolerance: ValueSpec["tolerance"],
): boolean => {
  const size = Math.abs(narrated.value);
  const goal = Math.abs(target);
  if ("exact" in tolerance) return size === goal;
  if ("abs" in tolerance) return Math.abs(size - goal) <= tolerance.abs;
  return Math.abs(size - goal) <= tolerance.rel * goal;
};

/** The forms a keyed value may be narrated in: as returned, or per year for a daily slope. */
export const targetsFor = (path: string, value: number): readonly number[] =>
  path.endsWith("slope_per_day")
    ? [value, ...DAYS_PER_YEAR.map((days) => value * days)]
    : [value];

/** Hallucination's "small tolerance": rounding, or within 1 % of a source. */
export const SOURCE_REL_TOLERANCE = 0.01;

export const supportedBy = (
  narrated: NarratedNumber,
  sources: readonly number[],
): boolean =>
  sources.some(
    (source) =>
      roundsTo(narrated, source) ||
      withinTolerance(narrated, source, { rel: SOURCE_REL_TOLERANCE }),
  );

const RATE_SUFFIXES = {
  day: ["/d", "/day", "perday", "aday", "daily"],
  year: [
    "/y",
    "/yr",
    "/year",
    "peryear",
    "ayear",
    "eachyear",
    "perannum",
    "annually",
    "yearly",
  ],
} as const;

const UNIT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "%": ["%", "percent"],
  kg: ["kg", "kilogram"],
  "mg/dL": ["mg/dl"],
  "mm[Hg]": ["mmhg", "mm[hg]"],
  "/min": ["/min", "bpm", "perminute", "beats/min", "breaths/min"],
};

/** How far after a number its unit may start, in characters of the original text. */
export const UNIT_WINDOW = 12;
/** A rate needs room for "percentage points per year". */
export const RATE_WINDOW = 32;

/**
 * Whether the unit follows the number: the base unit (`%`, `mm[Hg]`, …) and,
 * for a daily slope, a per-day or per-year suffix matching how it was narrated.
 */
export const unitFollows = (
  text: string,
  narrated: NarratedNumber,
  unit: string,
  perYear: boolean,
): boolean => {
  const isRate = unit.endsWith("/d");
  const base = isRate ? unit.slice(0, -2) : unit;
  const window = text
    .slice(narrated.end, narrated.end + (isRate ? RATE_WINDOW : UNIT_WINDOW))
    .toLowerCase()
    .replace(/\s+/g, "");
  const aliases = UNIT_ALIASES[base] ?? [base.toLowerCase()];
  const hasBase = aliases.some((alias) => window.includes(alias));
  if (!isRate) return hasBase;
  const suffixes = perYear ? RATE_SUFFIXES.year : RATE_SUFFIXES.day;
  return hasBase && suffixes.some((suffix) => window.includes(suffix));
};
