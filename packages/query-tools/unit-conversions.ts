/**
 * The one table of exact unit conversions. `convert_unit` converts with it,
 * the number matcher (`infrastructure/number-sources.ts`) uses it to see
 * "7.0 mmol/L" as the same reading as 126 mg/dL, and through the matcher the
 * hallucination scorer does too. Pure, with no `server-only`, so the client,
 * the server and the scripts share it.
 *
 * Every pair is written out in both directions, each with its own formula,
 * so an inverse is computed as the formula states it (× 18.016), never as a
 * reciprocal of a rounded factor. A pair that is not in the table is refused,
 * never guessed.
 *
 * Sources for the factors:
 * - Glucose: molar mass of C6H12O6, 180.16 g/mol (IUPAC standard atomic
 *   weights); mmol/L = mg/dL × 10 ÷ 180.16 = mg/dL ÷ 18.016.
 * - Creatinine: the conventional SI factor 88.42 µmol/L per mg/dL, i.e.
 *   10 000 ÷ 113.1 with creatinine's molar mass (113.12 g/mol) rounded to
 *   113.1, as clinical SI conversion tables list it.
 * - HbA1c: the IFCC–NGSP master equation (Hoelzel et al., Clin Chem
 *   2004;50:166–174; IFCC/NGSP consensus), mmol/mol = (% − 2.15) × 10.929.
 * - Cholesterol (total, LDL, HDL): molar mass 386.65 g/mol;
 *   mmol/L = mg/dL ÷ 38.67.
 * - Triglycerides: as triolein, molar mass 885.7 g/mol;
 *   mmol/L = mg/dL ÷ 88.57.
 * - Body temperature: exact by definition, °F = °C × 9/5 + 32.
 *
 * Rounding is half away from zero on the decimal value (`roundTo`, the rule
 * the display uses), to the decimals the target unit is usually reported in.
 */
import { roundTo } from "@/infrastructure/format-measure";

export const CONVERSION_ANALYTES = [
  "glucose",
  "creatinine",
  "hba1c",
  "total_cholesterol",
  "ldl_cholesterol",
  "hdl_cholesterol",
  "triglycerides",
  "body_temperature",
] as const;

export type ConversionAnalyte = (typeof CONVERSION_ANALYTES)[number];

/** UCUM codes, as the query tools return `unit_ucum`. */
export const CONVERSION_UNITS = [
  "mg/dL",
  "mmol/L",
  "umol/L",
  "%",
  "mmol/mol",
  "Cel",
  "[degF]",
] as const;

export type ConversionUnit = (typeof CONVERSION_UNITS)[number];

/**
 * LOINC codes each analyte is stored under in the warehouse. Null: the unit
 * alone decides (a temperature in Cel is one under any code).
 */
export const ANALYTE_CODES: Readonly<
  Record<ConversionAnalyte, readonly string[] | null>
> = {
  glucose: ["2339-0", "2345-7"],
  creatinine: ["2160-0", "38483-4"],
  hba1c: ["4548-4", "17856-6"],
  total_cholesterol: ["2093-3"],
  ldl_cholesterol: ["18262-6", "13457-7", "2089-1"],
  hdl_cholesterol: ["2085-9"],
  triglycerides: ["2571-8"],
  body_temperature: null,
};

export type ConversionRule = Readonly<{
  analyte: ConversionAnalyte;
  from: ConversionUnit;
  to: ConversionUnit;
  convert: (value: number) => number;
  /** The formula as the tool states it. */
  formula: string;
  /** Fraction digits of the reported value, rounded half away from zero. */
  decimals: number;
}>;

const ratio = (
  analyte: ConversionAnalyte,
  mass: ConversionUnit,
  molar: ConversionUnit,
  factor: number,
  massDecimals: number,
  molarDecimals: number,
): readonly ConversionRule[] => [
  {
    analyte,
    from: mass,
    to: molar,
    convert: (value) => value / factor,
    formula: `${molar} = ${mass} ÷ ${factor}`,
    decimals: molarDecimals,
  },
  {
    analyte,
    from: molar,
    to: mass,
    convert: (value) => value * factor,
    formula: `${mass} = ${molar} × ${factor}`,
    decimals: massDecimals,
  },
];

const lipid = (analyte: ConversionAnalyte, factor: number): readonly ConversionRule[] =>
  ratio(analyte, "mg/dL", "mmol/L", factor, 0, 2);

export const CONVERSION_TABLE: readonly ConversionRule[] = [
  ...ratio("glucose", "mg/dL", "mmol/L", 18.016, 0, 1),
  {
    analyte: "creatinine",
    from: "mg/dL",
    to: "umol/L",
    convert: (value) => value * 88.42,
    formula: "umol/L = mg/dL × 88.42",
    decimals: 0,
  },
  {
    analyte: "creatinine",
    from: "umol/L",
    to: "mg/dL",
    convert: (value) => value / 88.42,
    formula: "mg/dL = umol/L ÷ 88.42",
    decimals: 2,
  },
  {
    analyte: "hba1c",
    from: "%",
    to: "mmol/mol",
    convert: (value) => (value - 2.15) * 10.929,
    formula: "mmol/mol = (% − 2.15) × 10.929",
    decimals: 0,
  },
  {
    analyte: "hba1c",
    from: "mmol/mol",
    to: "%",
    convert: (value) => value / 10.929 + 2.15,
    formula: "% = mmol/mol ÷ 10.929 + 2.15",
    decimals: 1,
  },
  ...lipid("total_cholesterol", 38.67),
  ...lipid("ldl_cholesterol", 38.67),
  ...lipid("hdl_cholesterol", 38.67),
  ...lipid("triglycerides", 88.57),
  {
    analyte: "body_temperature",
    from: "Cel",
    to: "[degF]",
    convert: (value) => (value * 9) / 5 + 32,
    formula: "[degF] = Cel × 9/5 + 32",
    decimals: 1,
  },
  {
    analyte: "body_temperature",
    from: "[degF]",
    to: "Cel",
    convert: (value) => ((value - 32) * 5) / 9,
    formula: "Cel = ([degF] − 32) × 5/9",
    decimals: 1,
  },
];

export const findConversion = (
  analyte: ConversionAnalyte,
  from: ConversionUnit,
  to: ConversionUnit,
): ConversionRule | null =>
  CONVERSION_TABLE.find(
    (rule) => rule.analyte === analyte && rule.from === from && rule.to === to,
  ) ?? null;

export const roundingRule = (decimals: number): string =>
  `half away from zero to ${decimals} decimal${decimals === 1 ? "" : "s"}`;

export type Converted = Readonly<{
  /** Rounded by the rule's `decimals`. */
  value: number;
  /** Before rounding. */
  unrounded: number;
  formula: string;
  rounding: string;
}>;

/** Pure: one table rule applied to one value. */
export const applyConversion = (rule: ConversionRule, value: number): Converted => {
  const unrounded = rule.convert(value);
  return {
    value: roundTo(unrounded, rule.decimals),
    unrounded,
    formula: rule.formula,
    rounding: roundingRule(rule.decimals),
  };
};

/** Pairs the table holds for an analyte, as "from → to", for a refusal's reason. */
export const supportedPairs = (analyte: ConversionAnalyte): readonly string[] =>
  CONVERSION_TABLE.filter((rule) => rule.analyte === analyte).map(
    (rule) => `${rule.from} → ${rule.to}`,
  );

export const isConversionUnit = (value: unknown): value is ConversionUnit =>
  typeof value === "string" && (CONVERSION_UNITS as readonly string[]).includes(value);
