import type { SpeechLanguage } from "./contract";

/**
 * Numbers and units as a voice should say them (#616). A speech engine reads
 * "58 bpm" letter by letter and "118/76" as a fraction, so after a number a
 * unit becomes words, a range becomes "to" ("bis"), a blood pressure becomes
 * "over" ("zu"), and German gets a decimal comma (not in a date or clock
 * time). Only a unit right after a number is touched, so words in the text
 * stay as they are. Pure.
 */

type Words = Readonly<{ en: string; de: string }>;

/** `one` is the singular, for exactly 1, where it differs. */
type Unit = Readonly<{ pattern: string; many: Words; one?: Words }>;

/** Longest first, so "mmol/L" is matched before "mm" could be. */
const UNITS: readonly Unit[] = [
  {
    pattern: "mmol\\/[lL]",
    many: { en: "millimoles per litre", de: "Millimol pro Liter" },
    one: { en: "millimole per litre", de: "Millimol pro Liter" },
  },
  {
    pattern: "mg\\/d[lL]",
    many: { en: "milligrams per decilitre", de: "Milligramm pro Deziliter" },
    one: { en: "milligram per decilitre", de: "Milligramm pro Deziliter" },
  },
  {
    pattern: "mmHg",
    many: { en: "millimetres of mercury", de: "Millimeter Quecksilbersäule" },
    one: { en: "millimetre of mercury", de: "Millimeter Quecksilbersäule" },
  },
  {
    pattern: "kcal",
    many: { en: "kilocalories", de: "Kilokalorien" },
    one: { en: "kilocalorie", de: "Kilokalorie" },
  },
  {
    pattern: "bpm",
    many: { en: "beats per minute", de: "Schläge pro Minute" },
    one: { en: "beat per minute", de: "Schlag pro Minute" },
  },
  {
    pattern: "°C",
    many: { en: "degrees Celsius", de: "Grad Celsius" },
    one: { en: "degree Celsius", de: "Grad Celsius" },
  },
  {
    pattern: "kg",
    many: { en: "kilograms", de: "Kilogramm" },
    one: { en: "kilogram", de: "Kilogramm" },
  },
  {
    pattern: "km",
    many: { en: "kilometres", de: "Kilometer" },
    one: { en: "kilometre", de: "Kilometer" },
  },
  {
    pattern: "cm",
    many: { en: "centimetres", de: "Zentimeter" },
    one: { en: "centimetre", de: "Zentimeter" },
  },
  {
    pattern: "ms",
    many: { en: "milliseconds", de: "Millisekunden" },
    one: { en: "millisecond", de: "Millisekunde" },
  },
  {
    pattern: "min",
    many: { en: "minutes", de: "Minuten" },
    one: { en: "minute", de: "Minute" },
  },
  {
    pattern: "h",
    many: { en: "hours", de: "Stunden" },
    one: { en: "hour", de: "Stunde" },
  },
  { pattern: "%", many: { en: "per cent", de: "Prozent" } },
];

const NUMBER = "\\d+(?:[.,]\\d+)?";

const withUnits = (text: string, language: SpeechLanguage): string =>
  UNITS.reduce(
    (spoken, unit) =>
      spoken.replace(
        // A unit that ends in a letter must end the word; "%" and "°C" need no boundary.
        new RegExp(
          `(${NUMBER})\\s?${unit.pattern}${/[A-Za-z]$/.test(unit.pattern) ? "(?![A-Za-z])" : ""}`,
          "g",
        ),
        (_match, number: string) =>
          `${number} ${(number === "1" ? (unit.one ?? unit.many) : unit.many)[language]}`,
      ),
    text,
  );

/** A number with dots in it: "5.4", "7.30", "18.11.2026". */
const DOTTED = /(?<![\d.,])\d+(?:\.\d+)+(?!\d)/g;
/** A clock time: "um 7.30", "7.30 Uhr", "7.30 bis 8.15 Uhr". */
const CLOCK = /^\d{1,2}\.[0-5]\d$/;
const CLOCK_BEFORE = /\b(?:um|gegen|ab)\s$/i;
const CLOCK_AFTER = /^(?:\s?(?:bis|[–-])\s?\d{1,2}\.[0-5]\d)?\s?Uhr\b/;

/**
 * German reads a decimal point as "Punkt"; the comma is what it expects. A
 * date (18.11.2026) and a clock time keep their dots.
 */
const decimalCommas = (text: string): string =>
  text.replace(DOTTED, (number: string, at: number) => {
    if (number.split(".").length > 2) return number;
    const clock =
      CLOCK.test(number) &&
      (CLOCK_BEFORE.test(text.slice(0, at)) ||
        CLOCK_AFTER.test(text.slice(at + number.length)));
    return clock ? number : number.replace(".", ",");
  });

export const spokenUnits = (text: string, language: SpeechLanguage): string => {
  const over = language === "de" ? "zu" : "over";
  const to = language === "de" ? "bis" : "to";
  const shaped = text
    // 118/76 before a pressure unit: a blood pressure.
    .replace(/\b(\d{2,3})\/(\d{2,3})(?=\s?mmHg\b)/g, `$1 ${over} $2`)
    // 58–64 or 58-64 between short numbers: a range. A date (2026-11-18) is left.
    .replace(
      /(?<![\d.,-])(\d{1,3}(?:[.,]\d+)?)\s?[–-]\s?(\d{1,3}(?:[.,]\d+)?)(?![\d-])/g,
      `$1 ${to} $2`,
    );
  const units = withUnits(shaped, language);
  return language === "de" ? decimalCommas(units) : units;
};
