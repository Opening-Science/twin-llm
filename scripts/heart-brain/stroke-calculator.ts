/**
 * Synthea v4.0.0's stroke risk, ported line by line from the pinned jar
 * (`synthea-with-dependencies.jar`, SHA-256 ed43c20a...e6ecc1). Pure.
 *
 * Sources, read with `javap -c -l` from the jar's classes (line numbers are
 * the class files' own `LineNumberTable`, so they point into `Framingham.java`
 * as compiled):
 *
 * - `org.mitre.synthea.modules.calculators.Framingham`
 *   - tables: `stroke_rate_20_39` line 437, `stroke_rate_40_59` 438,
 *     `ten_year_stroke_risk` 440, `age_stroke` 449, `untreated_sys_bp_stroke`
 *     454, `treated_sys_bp_stroke` 459, `diabetes_stroke` 479,
 *     `chd_stroke_points` 480, `atrial_fibrillation_stroke_points` 481. The
 *     values below were read from the loaded class by reflection.
 *   - `getIndexForValueInRangelist`, lines 465 to 476.
 *   - `stroke10Year(person, time, perTimestep)`, lines 491 to 556.
 * - `org.mitre.synthea.modules.CardiovascularDiseaseModule.calculateStrokeRisk`,
 *   lines 142 to 146: every time step it stores
 *   `stroke_risk = Utilities.convertRiskToTimestep(stroke10Year(...), TEN_YEARS_IN_MS)`.
 * - `org.mitre.synthea.helpers.Utilities.convertRiskToTimestep`, lines 216
 *   to 230: `1 - (1 - risk) ^ (generate.timestep / period)`, with
 *   `generate.timestep = 604800000` (7 days, `synthea.properties`) and the
 *   period 315360000000 ms (3650 days).
 * - `modules/stroke.json`, state `Chance_of_Stroke`: a 1-month delay (30
 *   days, `Utilities.convertTime`), then a stroke with probability
 *   `stroke_risk`. So the chance per 30-day check is the 7-day conversion of
 *   the 10-year risk; the module runs once (first stroke only).
 *
 * What the calculator reads, in order: systolic BP (none: -1), sex, age in
 * whole years (under 20: -1; 20 to 39 and 40 to 54: a fixed rate by sex;
 * from 55: points), then from 55 `smoker` (+3), `left_ventricular_hypertrophy`
 * (+5), age points, BP points (treated table when `blood_pressure_controlled`),
 * `diabetes` (+2 men, +3 women), `coronary_heart_disease` (+4 men, +2 women)
 * and AF (`atrial_fibrillation` present: +4 men, +6 women). Points past the
 * end of the table take its last value. No v4.0.0 module sets
 * `left_ventricular_hypertrophy` or `coronary_heart_disease` (`planted.ts`),
 * so callers pass false for both.
 */

export type StrokeSex = "M" | "F";

export type StrokeInputs = Readonly<{
  sex: StrokeSex;
  /** Whole years, as `Person.ageInYears`. */
  ageYears: number;
  /** Systolic BP in mmHg; null when none is known (the calculator returns -1). */
  systolic: number | null;
  /** The `blood_pressure_controlled` attribute: picks the treated BP table. */
  bpTreated: boolean;
  smoker: boolean;
  diabetes: boolean;
  atrialFibrillation: boolean;
  coronaryHeartDisease: boolean;
  leftVentricularHypertrophy: boolean;
}>;

/** Index 0 is male, 1 female (`genderIndex`, line 500). */
const sexIndex = (sex: StrokeSex): 0 | 1 => (sex === "M" ? 0 : 1);

export const STROKE_RATE_20_39 = [0.002, 0.007] as const;
export const STROKE_RATE_40_54 = [0.019, 0.022] as const;

export const TEN_YEAR_STROKE_RISK: readonly (readonly number[])[] = [
  [
    0.0, 0.03, 0.03, 0.04, 0.04, 0.05, 0.05, 0.06, 0.07, 0.08, 0.1, 0.11, 0.13, 0.15,
    0.17, 0.2, 0.22, 0.26, 0.29, 0.33, 0.37, 0.42, 0.47, 0.52, 0.57, 0.63, 0.68, 0.74,
    0.79, 0.84, 0.88,
  ],
  [
    0.0, 0.01, 0.01, 0.02, 0.02, 0.02, 0.03, 0.04, 0.04, 0.05, 0.06, 0.08, 0.09, 0.11,
    0.13, 0.16, 0.19, 0.23, 0.27, 0.32, 0.37, 0.43, 0.5, 0.57, 0.64, 0.71, 0.78, 0.84,
  ],
];

export const AGE_STROKE: readonly (readonly number[])[] = [
  [54, 57, 60, 63, 66, 69, 73, 76, 79, 82, 85],
  [54, 57, 60, 63, 65, 68, 71, 74, 77, 79, 82],
];

export const UNTREATED_SYS_BP_STROKE: readonly (readonly number[])[] = [
  [0, 106, 116, 126, 136, 146, 156, 166, 176, 185, 196],
  [0, 95, 107, 119, 131, 144, 156, 168, 181, 193, 205],
];

export const TREATED_SYS_BP_STROKE: readonly (readonly number[])[] = [
  [0, 106, 113, 118, 124, 130, 136, 143, 151, 162, 177],
  [0, 95, 107, 114, 120, 126, 132, 140, 149, 161, 205],
];

export const DIABETES_STROKE = [2, 3] as const;
export const CHD_STROKE_POINTS = [4, 2] as const;
export const ATRIAL_FIBRILLATION_STROKE_POINTS = [4, 6] as const;

/** `generate.timestep` over `TEN_YEARS_IN_MS`: 7 days in 3650. */
export const TIMESTEP_SHARE_OF_TEN_YEARS = 604_800_000 / 315_360_000_000;
/** `stroke.json` checks once per `1 month`, which Synthea counts as 30 days. */
export const DAYS_PER_STROKE_CHECK = 30;

/**
 * `getIndexForValueInRangelist`: the first i with data[i] <= value <=
 * data[i + 1], else the last index when value >= the last entry, else an
 * error. Both ends are inclusive, so a value equal to a boundary takes the
 * lower index.
 */
export const indexInRangeList = (value: number, data: readonly number[]): number => {
  for (let i = 0; i < data.length - 1; i += 1) {
    if ((data[i] as number) <= value && value <= (data[i + 1] as number)) return i;
  }
  if (value >= (data[data.length - 1] as number)) return data.length - 1;
  throw new Error(`value ${value} is below the first entry ${data[0]}`);
};

/** Stroke points from 55 (lines 513 to 540), before the table lookup. */
export const strokePoints = (input: StrokeInputs): number => {
  const sex = sexIndex(input.sex);
  // Double.intValue truncates towards zero (line 523).
  const bp = Math.trunc(input.systolic ?? 0);
  const bpTable = input.bpTreated ? TREATED_SYS_BP_STROKE : UNTREATED_SYS_BP_STROKE;
  return (
    (input.smoker ? 3 : 0) +
    (input.leftVentricularHypertrophy ? 5 : 0) +
    indexInRangeList(input.ageYears, AGE_STROKE[sex] as readonly number[]) +
    indexInRangeList(bp, bpTable[sex] as readonly number[]) +
    (input.diabetes ? DIABETES_STROKE[sex] : 0) +
    (input.coronaryHeartDisease ? CHD_STROKE_POINTS[sex] : 0) +
    (input.atrialFibrillation ? ATRIAL_FIBRILLATION_STROKE_POINTS[sex] : 0)
  );
};

/**
 * `stroke10Year(person, time, false)`: the 10-year stroke risk, or -1 when
 * the calculator has no BP or the person is under 20.
 */
export const strokeTenYearRisk = (input: StrokeInputs): number => {
  if (input.systolic === null) return -1;
  const sex = sexIndex(input.sex);
  if (input.ageYears < 20) return -1;
  if (input.ageYears < 40) return STROKE_RATE_20_39[sex];
  if (input.ageYears < 55) return STROKE_RATE_40_54[sex];
  const table = TEN_YEAR_STROKE_RISK[sex] as readonly number[];
  const points = strokePoints(input);
  return table[Math.min(points, table.length - 1)] as number;
};

/** `Utilities.convertRiskToTimestep(risk, TEN_YEARS_IN_MS)` with a 7-day step. */
export const riskPerTimestep = (tenYearRisk: number): number =>
  1 - (1 - tenYearRisk) ** TIMESTEP_SHARE_OF_TEN_YEARS;

/**
 * The chance of a stroke at one monthly check of `stroke.json`. A -1 from
 * the calculator gives a small negative `stroke_risk`, which never picks the
 * stroke transition, so it counts as 0.
 */
export const strokeChancePerCheck = (input: StrokeInputs): number =>
  Math.max(0, riskPerTimestep(strokeTenYearRisk(input)));

/** The same as a daily hazard: one check every 30 days. */
export const strokeHazardPerDay = (input: StrokeInputs): number =>
  strokeChancePerCheck(input) / DAYS_PER_STROKE_CHECK;
