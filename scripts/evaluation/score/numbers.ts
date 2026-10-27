/**
 * The scorers' side of reading numbers: tolerance, units and signs.
 *
 * Finding numbers and deciding whether one stands for a source live in
 * `infrastructure/narrated-numbers.ts`, shared with the answer column's number
 * links, and are re-exported here so the scorers keep one import. The rules are
 * written out in docs/evaluation/harness.md:
 *
 * - A narrated number matches a value when it is within the item's tolerance,
 *   or when the value rounded to the narrated number's decimals equals it
 *   (`roundsTo`, with the display-decimals rule).
 * - The size is compared first; the sign is checked apart (`signDiffers`): an
 *   explicit minus, or a "rose"/"fell" word just before the number.
 * - A `slope_per_day` also matches at ×365 and ×365.25, since a per-year
 *   slope is allowed.
 */
import {
  DAYS_PER_YEAR,
  type NarratedNumber,
} from "../../../infrastructure/narrated-numbers";

import type { ValueSpec } from "../question-set";

export {
  ALLOWED_CONSTANTS,
  blankOut,
  DATE_PATTERN,
  DAYS_PER_YEAR,
  displayDecimals,
  isAllowedConstant,
  LOINC_PATTERN,
  type NarratedNumber,
  narratedNumbers,
  numbersIn,
  roundsTo,
  SOURCE_REL_TOLERANCE,
  supportedBy,
  UUID_PATTERN,
  withoutDates,
} from "../../../infrastructure/narrated-numbers";

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
