import type { SpeechLanguage } from "./contract";

/**
 * Numbers and units as a voice should say them (#616). A speech engine reads
 * "58 bpm" letter by letter and "118/76" as a fraction, so after a number a
 * unit becomes words, a range becomes "to" ("bis"), a blood pressure becomes
 * "over" ("zu"), and German gets a decimal comma. Only a unit right after a
 * number is touched, so words in the text stay as they are. Pure.
 */

type Unit = Readonly<{ pattern: string; en: string; de: string }>;

/** Longest first, so "mmol/L" is matched before "mm" could be. */
const UNITS: readonly Unit[] = [
  { pattern: "mmol\\/[lL]", en: "millimoles per litre", de: "Millimol pro Liter" },
  {
    pattern: "mg\\/d[lL]",
    en: "milligrams per decilitre",
    de: "Milligramm pro Deziliter",
  },
  { pattern: "mmHg", en: "millimetres of mercury", de: "Millimeter Quecksilbersäule" },
  { pattern: "kcal", en: "kilocalories", de: "Kilokalorien" },
  { pattern: "bpm", en: "beats per minute", de: "Schläge pro Minute" },
  { pattern: "°C", en: "degrees Celsius", de: "Grad Celsius" },
  { pattern: "kg", en: "kilograms", de: "Kilogramm" },
  { pattern: "km", en: "kilometres", de: "Kilometer" },
  { pattern: "cm", en: "centimetres", de: "Zentimeter" },
  { pattern: "ms", en: "milliseconds", de: "Millisekunden" },
  { pattern: "min", en: "minutes", de: "Minuten" },
  { pattern: "h", en: "hours", de: "Stunden" },
  { pattern: "%", en: "per cent", de: "Prozent" },
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
        `$1 ${unit[language]}`,
      ),
    text,
  );

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
  // German reads a decimal point as "Punkt"; the comma is what it expects.
  return language === "de" ? units.replace(/(\d)\.(\d)/g, "$1,$2") : units;
};
