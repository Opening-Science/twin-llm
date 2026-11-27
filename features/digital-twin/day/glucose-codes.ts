/** LOINC codes the day replay treats as glucose. */
export const SENSOR_GLUCOSE_LOINC = "99504-3";
/** Glucose in blood, and in serum or plasma. */
export const BLOOD_GLUCOSE_LOINC = "2339-0";
export const BLOOD_GLUCOSE_LOINCS: readonly string[] = [BLOOD_GLUCOSE_LOINC, "2345-7"];
export const GLUCOSE_LOINCS: readonly string[] = [
  SENSOR_GLUCOSE_LOINC,
  ...BLOOD_GLUCOSE_LOINCS,
];
