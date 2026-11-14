/**
 * WHAT: UCUM helpers and the shared LOINC→unit policy table.
 * NOT:  Must not accept a Quantity without a unit at the shared builder; mappers must not diverge per connector.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: UCUM grammar via @lhncbc/ucum-lhc (verify/check-units.mjs); LOINC example units constrained by vital-signs profiles.
 */
import type { Quantity } from 'fhir/r4';
import { SYSTEMS } from './systems';

/**
 * Decision D4: one unit per concept, across all three connectors.
 *
 * Before this table the same concept was emitted with different units by different
 * connectors — LOINC 93832-4 as unitless seconds by Oura and as `min` by
 * Google Health; body height as `m` by Oura, `mm` by Google and a local code by
 * VITRONIC. Merging two bundles for one person produced contradictory numbers under
 * an identical code, which is precisely the cross-connector comparability this
 * project exists to provide.
 *
 * `unit` is the human-readable string; `code` is the machine-readable UCUM symbol.
 * They must describe the same quantity. `unit: 'MET-min'` with `code: 'min'`
 * type-checks, validates structurally, and is wrong.
 */

/**
 * UCUM annotations, per UCUM §6: material inside curly braces is an annotation.
 * §6■4 — an annotation with no leading symbol implies the unity `1`. §6■2 — a
 * conformant parser *discards* annotations, so `{steps}` and `{beats}` compare
 * equal. The annotation is a label for humans; `Observation.code` carries the
 * meaning. That asymmetry is why a wrong LOINC code is unrecoverable and a wrong
 * annotation is merely untidy.
 *
 * A bare `steps` is not a UCUM symbol at all and any server validating UCUM
 * rejects the resource.
 */
/**
 * `unit` is UCUM's own name for the code, not a name of our choosing.
 *
 * Reviewed 2026-07-26. The rule replaces a judgement with a lookup: `Quantity.unit`
 * carries the name the UCUM specification gives the code in `Quantity.code`, so the
 * human-readable and machine-readable halves cannot drift apart. `check-units.mjs`
 * verifies this mechanically against @lhncbc/ucum-lhc, which is why the table no
 * longer needs a per-pair allowlist.
 *
 * Three kinds of entry cannot follow the rule, and the gate carries each as a named
 * exception rather than a blanket waiver:
 *
 *   - `%` has no name in UCUM at all, and `1` names itself.
 *   - `deg` is published as "degree - plane angle", a disambiguation against degrees
 *     of temperature rather than a unit name.
 *   - an annotation names itself, so `{steps}` would give the unit "{steps}". The
 *     annotation text is already the human-readable form, so the braces come off.
 *
 * Ten entries were deleted in the same review because nothing emitted them. Two of
 * those were live traps: the FHIR vital-signs profiles *fix* heart rate and
 * respiratory rate to `/min`, so `{beats}/min` and `{breaths}/min` would have failed
 * validation for anyone who reached for the more descriptive-looking constant.
 */
export const UCUM = {
  // time
  MINUTE: { unit: 'minute', code: 'min' },
  YEAR: { unit: 'year', code: 'a' },
  MILLISECOND: { unit: 'millisecond', code: 'ms' },

  // length / area
  METRE: { unit: 'meter', code: 'm' },
  CENTIMETRE: { unit: 'centimeter', code: 'cm' },
  SQUARE_METRE: { unit: 'square meter', code: 'm2' },

  // mass
  KILOGRAM: { unit: 'kilogram', code: 'kg' },
  GRAM: { unit: 'gram', code: 'g' },

  // temperature. UCUM §21/§22: `Cel` is a *special unit* on an interval scale and
  // cannot take part in algebraic operations. An absolute body temperature is
  // `Cel`; a temperature *difference* is `K`. The two are numerically equal as
  // intervals, so no value conversion is needed — only the code changes.
  // "degree Kelvin" is UCUM's published name for `K`. It is archaic — SI dropped
  // the degree in 1967 — but the rule is to carry UCUM's name, not a better one.
  CELSIUS: { unit: 'degree Celsius', code: 'Cel' },
  KELVIN: { unit: 'degree Kelvin', code: 'K' },

  // plane angle. UCUM Table 2 makes `rad` the base unit; Table 5 derives
  // `deg` = [pi].rad/360, so 1 rad = 180/pi ~ 57.2957795 deg.
  DEGREE: { unit: 'degree', code: 'deg' },

  // rates
  PER_MINUTE: { unit: 'per minute', code: '/min' },
  METRE_PER_SECOND: { unit: 'meter per second', code: 'm/s' },
  ML_PER_KG_PER_MIN: { unit: 'milliliter per kilogram per minute', code: 'mL/kg/min' },

  // concentration
  MG_PER_DL: { unit: 'milligram per deciliter', code: 'mg/dL' },
  MICROGRAM_PER_LITRE: { unit: 'microgram per liter', code: 'ug/L' },
  MMOL_PER_L: { unit: 'millimole per liter', code: 'mmol/L' },
  // Anchor laboratory units. `unit` strings are UCUM's own published names
  // (including the library's "millliiter" spelling for ng/mL) — check-units.mjs
  // requires Quantity.unit === UCUM name for Quantity.code.
  NG_PER_ML: { unit: 'nanogram per millliiter', code: 'ng/mL' },
  PMOL_PER_L: { unit: 'picomole per liter', code: 'pmol/L' },
  ENZYME_UNIT_PER_L: { unit: 'enzyme unit per liter', code: 'U/L' },
  TEN_9_PER_L: { unit: 'billion per liter', code: '10*9/L' },
  UG_PER_G: { unit: 'microgram per gram', code: 'ug/g' },
  NMOL_PER_MMOL: { unit: 'nanomole per millimole', code: 'nmol/mmol' },
  MIU_PER_L: { unit: 'milli international unit per liter', code: 'm[IU]/L' },

  // energy
  KILOCALORIE: { unit: 'kilocalorie', code: 'kcal' },

  // dimensionless. `%` is a real UCUM atom (Table 3, = 10*-2), so the number sent
  // is the percentage: 95% is `95`, never `0.95`. Do not write `{percent}`.
  PERCENT: { unit: '%', code: '%' },
  UNITY: { unit: '1', code: '1' },

  // annotations
  STEPS: { unit: 'steps', code: '{steps}' },
  STEPS_PER_DAY: { unit: 'steps per day', code: '{steps}/d' },
  SCORE: { unit: 'score', code: '{score}' },
  COUNT: { unit: 'count', code: '{count}' },
  /**
   * MET is a physiological ratio (3.5 mL/kg/min of oxygen uptake), not a UCUM unit
   * atom, so MET-minutes has no UCUM code. `{MET-min}` is a valid annotation
   * denoting the unity with a label. It must never be `min`: a conformant receiver
   * discards the annotation, and with code `min` reads 300 MET-minutes as 300
   * minutes of activity.
   */
  MET_MINUTES: { unit: 'MET-min', code: '{MET-min}' },
  MET: { unit: 'MET', code: '{MET}' }
} as const;

export type UcumUnit = (typeof UCUM)[keyof typeof UCUM];

/** Build a UCUM-system Quantity. Returns undefined for absent or non-finite values. */
export function quantity(value: number | null | undefined, unit: UcumUnit): Quantity | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }
  return { value, unit: unit.unit, system: SYSTEMS.UCUM, code: unit.code };
}

/**
 * The unit every connector must use for a given LOINC code.
 *
 * Where the FHIR R4 vital-signs profiles *fix* a code (heart rate and respiratory
 * rate to `/min`, oxygen saturation to `%`) the profile wins over LOINC's example
 * unit — `{beats}/min` and `{steps}` are absent from `ucum-vitals-common`, so a
 * vital-signs Observation carrying them is a conformance failure.
 */
export const LOINC_UNITS: Readonly<Record<string, UcumUnit>> = {
  // Sleep durations. LOINC example units are `min` (REM/deep/latency) and `h`
  // (total sleep duration); `min` is used throughout for internal consistency and
  // to match what provider-google-health already emits for 93832-4.
  '93832-4': UCUM.MINUTE, // Sleep duration
  '93831-6': UCUM.MINUTE, // Deep sleep duration
  '93830-8': UCUM.MINUTE, // Light sleep duration
  '93829-0': UCUM.MINUTE, // REM sleep duration
  '103212-7': UCUM.MINUTE, // Duration of falling asleep
  // 103213-5 "Duration in bed" is a genuine LOINC modelling anomaly: the component
  // says duration, the property is NRat and the example unit is `/h`. Those cannot
  // both be right, and `/h` is dimensionally meaningless for a duration. `min` is
  // emitted pending a term-change request to Regenstrief. See DECISIONS.md.
  '103213-5': UCUM.MINUTE,

  // Vital signs — unit fixed by the R4 profile, not merely bound.
  '8867-4': UCUM.PER_MINUTE, // Heart rate
  '40443-4': UCUM.PER_MINUTE, // Heart rate --resting
  '103222-6': UCUM.PER_MINUTE, // Heart rate.minimum
  '8873-2': UCUM.PER_MINUTE, // Heart rate 24 hour maximum
  '9279-1': UCUM.PER_MINUTE, // Breaths (respiratory rate)
  '59408-5': UCUM.PERCENT, // Oxygen saturation by pulse oximetry
  '8310-5': UCUM.CELSIUS, // Body temperature (absolute only)
  // ucum-bodylength is a *required* binding to exactly {cm, [in_i]}. `mm` and `m`
  // are both invalid under the profile even though LOINC lists `m` as an example.
  '8302-2': UCUM.CENTIMETRE, // Body height
  '29463-7': UCUM.KILOGRAM, // Body weight

  // Activity and fitness.
  '55423-8': UCUM.STEPS, // Number of steps, unspecified time (interval + effectivePeriod)
  '41950-7': UCUM.STEPS_PER_DAY, // Number of steps in 24 hour — the 24H time axis
  //                                requires the per-day denominator
  '41981-2': UCUM.KILOCALORIE, // Calories burned (point in time — a single activity)
  '55411-3': UCUM.MINUTE, // Exercise duration
  '94122-9': UCUM.ML_PER_KG_PER_MIN, // VO2/body weight, peak during exercise
  '41982-0': UCUM.PERCENT, // Percentage of body fat
  // Pulse wave velocity. LOINC's example unit is cm/s; m/s is commensurable and is
  // what the vendor sends, so the value is not rescaled.
  '77196-4': UCUM.METRE_PER_SECOND,

  // Glucose is chosen by `glucoseCodeFor`, which derives the code from the unit
  // rather than the reverse. Both entries exist so the gate can check either.
  '2339-0': UCUM.MG_PER_DL,
  '15074-8': UCUM.MMOL_PER_L,

  // Anchor laboratory biomarkers (provider-anchor). One unit per LOINC (D4).
  '2276-4': UCUM.NG_PER_ML, // Ferritin [Mass/volume] — Anchor unit_ucum ng/mL
  '2000-8': UCUM.MMOL_PER_L, // Calcium [Moles/volume]
  '1742-6': UCUM.ENZYME_UNIT_PER_L, // Alanine aminotransferase [Enzymatic activity/volume]
  '4548-4': UCUM.PERCENT, // Hemoglobin A1c/Hemoglobin.total in Blood (mass fraction as %)
  '6690-2': UCUM.TEN_9_PER_L, // Leukocytes [#/volume]
  '38445-3': UCUM.UG_PER_G, // Calprotectin [Mass/mass] in Stool
  '25095-1': UCUM.NMOL_PER_MMOL, // Deoxypyridinoline/Creatinine [Molar ratio]
  '14715-7': UCUM.PMOL_PER_L, // Estradiol [Moles/volume]
  '3016-3': UCUM.MIU_PER_L // Thyrotropin [Units/volume]
};

/**
 * Codes whose LOINC time axis is 24H and which therefore must not be applied to a
 * single activity. 41979-6 "Calories burned in 24 hour" is correct for a genuine
 * daily total with unit `kcal/(24.h)`; for one workout the code is 41981-2.
 */
export const DAILY_TOTAL_ONLY = new Set(['41979-6', '41950-7']);

/**
 * Glucose: the unit selects the code, not the other way round.
 *
 * LOINC 2339-0 is *mass* concentration (MCnc, mg/dL). 15074-8 is *substance*
 * concentration (SCnc, mmol/L). Both carry UNITSREQUIRED = Y, and consumer health
 * platforms report glucose in either — so a connector that hardcodes one code and
 * passes the vendor's unit through will eventually publish mmol/L under a mass
 * concentration code. That is the same property mismatch that put a weight-indexed
 * VO2max under absolute-VO2 LOINC 60842-2, and it is invisible in the output:
 * a plausible number under a code that means something else.
 */
export const GLUCOSE_CODES = {
  MASS: { code: '2339-0', display: 'Glucose [Mass/volume] in Blood', unit: UCUM.MG_PER_DL },
  SUBSTANCE: { code: '15074-8', display: 'Glucose [Moles/volume] in Blood', unit: UCUM.MMOL_PER_L }
} as const;

/** Returns undefined for a unit neither code covers, rather than guessing one. */
export function glucoseCodeFor(unit: UcumUnit): (typeof GLUCOSE_CODES)[keyof typeof GLUCOSE_CODES] | undefined {
  if (unit.code === UCUM.MG_PER_DL.code) return GLUCOSE_CODES.MASS;
  if (unit.code === UCUM.MMOL_PER_L.code) return GLUCOSE_CODES.SUBSTANCE;
  return undefined;
}
