/**
 * The warehouse's `loinc` column also holds codes that are not LOINC: a
 * synthetic scan's BodyLoop property paths (`body.height`) and the synthetic
 * wearables' own codes (`af-burden`, `spo2-min`). The Data page names a code
 * LOINC only when it has LOINC's shape: digits, a hyphen and a check digit.
 */
const LOINC_SHAPE = /^\d{1,8}-\d$/;

export const isLoincCode = (code: string): boolean => LOINC_SHAPE.test(code);

/** "LOINC" for a LOINC code, "Code" for anything else. */
export const codeKind = (code: string): "LOINC" | "Code" =>
  isLoincCode(code) ? "LOINC" : "Code";
