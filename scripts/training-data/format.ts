/**
 * How the training answers write numbers, units and dates. Numbers go through
 * `infrastructure/format-measure.ts` (en-GB, half away from zero), so a
 * training answer reads like a TwinLLM answer. Pure.
 */
import { formatDate, formatNumber, roundTo } from "../../infrastructure/format-measure";

export type MeasureSource = "wearable" | "clinical";

export type Measure = Readonly<{
  loinc: string;
  label: string;
  decimals: number;
  source: MeasureSource;
}>;

/** Codes from scripts/synthetic-wearables (UTC daily series). */
export const WEARABLE_MEASURES: readonly [Measure, ...Measure[]] = [
  { loinc: "8867-4", label: "heart rate", decimals: 0, source: "wearable" },
  { loinc: "40443-4", label: "resting heart rate", decimals: 0, source: "wearable" },
  { loinc: "93832-4", label: "sleep duration", decimals: 0, source: "wearable" },
  { loinc: "41950-7", label: "daily step count", decimals: 0, source: "wearable" },
  { loinc: "9279-1", label: "respiratory rate", decimals: 1, source: "wearable" },
];

/** Synthea clinic codes; the only pool for a subject without a wearable series. */
export const CLINICAL_MEASURES: readonly [Measure, ...Measure[]] = [
  { loinc: "29463-7", label: "body weight", decimals: 1, source: "clinical" },
  { loinc: "4548-4", label: "HbA1c", decimals: 1, source: "clinical" },
  { loinc: "8480-6", label: "systolic blood pressure", decimals: 0, source: "clinical" },
  { loinc: "2093-3", label: "total cholesterol", decimals: 0, source: "clinical" },
  { loinc: "39156-5", label: "BMI", decimals: 1, source: "clinical" },
];

/** Every code the data families ask about, wearable first. */
export const MEASURES: readonly [Measure, ...Measure[]] = [
  ...WEARABLE_MEASURES,
  ...CLINICAL_MEASURES,
];

/**
 * Codes Synthea is not expected to write, for the "no rows" family. If a
 * subject does have rows, the answer reports them like any latest value. The
 * evaluation's own probes (TSH, SpO2, 99999-9) are left out on purpose.
 */
export const ABSENT_MEASURES: readonly [Measure, ...Measure[]] = [
  { loinc: "2276-4", label: "ferritin", decimals: 0, source: "clinical" },
  { loinc: "2143-6", label: "cortisol", decimals: 1, source: "clinical" },
];

/**
 * Codes Synthea v4 writes in more than one unit, seen in the seed-42 cohort.
 * eGFR and RDW are the evaluation's mixed-unit probes, so they are left out.
 */
export const MIXED_UNIT_MEASURES: readonly [Measure, ...Measure[]] = [
  { loinc: "5811-5", label: "urine specific gravity", decimals: 3, source: "clinical" },
  { loinc: "5803-2", label: "urine pH", decimals: 1, source: "clinical" },
  {
    loinc: "89579-7",
    label: "high-sensitivity troponin I",
    decimals: 0,
    source: "clinical",
  },
];

/** UCUM codes as a reader sees them; anything else is printed as UCUM. */
const UNIT_TEXT: Readonly<Record<string, string>> = {
  "{steps}/d": "steps/day",
  "{score}": "points",
  "mm[Hg]": "mmHg",
  "kg/m2": "kg/m²",
  "/min": "/min",
};

export const unitText = (ucum: string | null): string =>
  ucum === null ? "" : (UNIT_TEXT[ucum] ?? ucum);

/** A value with its unit: `62 /min`, `5.4%`, `8,813 steps/day`. */
export const formatValue = (
  value: number | null,
  ucum: string | null,
  decimals: number,
): string => {
  const number = formatNumber(value, decimals);
  const unit = unitText(ucum);
  if (unit === "" || value === null || !Number.isFinite(value)) return number;
  return unit === "%" ? `${number}%` : `${number} ${unit}`;
};

/** Enough decimals for two significant digits of a change below 1, at most six. */
export const changeDecimals = (value: number, base: number): number => {
  if (Math.abs(value) >= 1 || value === 0 || !Number.isFinite(value)) return base;
  const needed = Math.ceil(-Math.log10(Math.abs(value))) + 1;
  return Math.min(6, Math.max(base, needed));
};

/** A signed change: `+1.2 kg`, `-0.0035 %`. Zero has no sign. */
export const formatChange = (
  value: number | null,
  ucum: string | null,
  base: number,
): string => {
  if (value === null) return formatValue(null, ucum, base);
  const decimals = changeDecimals(value, base);
  const text = formatValue(value, ucum, decimals);
  return roundTo(value, decimals) > 0 ? `+${text}` : text;
};

/** `16 Oct 2026` from an ISO instant or day. */
export const formatDay = (iso: string | null): string =>
  formatDate(iso === null ? null : iso.slice(0, 10));

export const formatCount = (value: number): string => formatNumber(value, 0);

/** A coverage ratio as a percent; one decimal under 10%, so a few days never read as 0%. */
export const formatShare = (ratio: number): string =>
  `${formatNumber(ratio * 100, ratio > 0 && ratio < 0.1 ? 1 : 0)}%`;
