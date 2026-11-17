/**
 * One synthetic BodyLoop scan per Synthea subject, from the subject's own
 * record: the latest visit that measured both body height and body weight
 * becomes the scan, at that visit's time. Height is written in metres and
 * weight in kilograms, as the BodyLoop API gives them; BMI is copied from the
 * same visit when Synthea recorded one, never computed. Nothing is invented
 * beyond the unit change. Pure.
 */
const LOINC = "http://loinc.org";
const BODY_HEIGHT = "8302-2";
const BODY_WEIGHT = "29463-7";
const BMI = "39156-5";

/** A BodyLoop `properties` row, in the API's shape. */
export type ScanPropertyRow = Readonly<{
  property_path: "body.height" | "body.mass" | "body.bmi";
  value: number;
}>;

export type SyntheticScan = Readonly<{
  /** The visit's time, as Synthea wrote it (always with an offset). */
  effectiveDateTime: string;
  properties: readonly ScanPropertyRow[];
}>;

type Reading = Readonly<{ code: string; at: string; value: number; unit: string }>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readingOf = (resource: unknown): Reading | null => {
  if (!isObject(resource) || resource.resourceType !== "Observation") return null;
  const code = isObject(resource.code) ? resource.code : undefined;
  const coding = Array.isArray(code?.coding) ? code.coding.filter(isObject) : [];
  const loinc = coding.find((item) => item.system === LOINC)?.code;
  const quantity = isObject(resource.valueQuantity) ? resource.valueQuantity : undefined;
  const at = resource.effectiveDateTime;
  if (
    typeof loinc !== "string" ||
    typeof at !== "string" ||
    typeof quantity?.value !== "number" ||
    !Number.isFinite(quantity.value) ||
    typeof quantity.code !== "string"
  ) {
    return null;
  }
  return { code: loinc, at, value: quantity.value, unit: quantity.code };
};

const readingsOf = (bundle: unknown): Reading[] =>
  isObject(bundle) && Array.isArray(bundle.entry)
    ? bundle.entry
        .map((entry: unknown) => (isObject(entry) ? readingOf(entry.resource) : null))
        .filter((reading): reading is Reading => reading !== null)
    : [];

/** Six decimals: a centimetre reading in metres, without float noise. */
const metres = (centimetres: number): number => Math.round(centimetres * 1e4) / 1e6;

/** The scan, or null when no visit has both a height in cm and a weight in kg. */
export const syntheticScanOf = (bundle: unknown): SyntheticScan | null => {
  const readings = readingsOf(bundle);
  const at = (code: string, unit: string, time: string) =>
    readings.find((r) => r.code === code && r.unit === unit && r.at === time);
  const visits = [
    ...new Set(
      readings.filter((r) => r.code === BODY_HEIGHT && r.unit === "cm").map((r) => r.at),
    ),
  ]
    .filter((time) => at(BODY_WEIGHT, "kg", time) !== undefined)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  const time = visits[0];
  if (time === undefined) return null;
  const height = at(BODY_HEIGHT, "cm", time)!;
  const weight = at(BODY_WEIGHT, "kg", time)!;
  const bmi = at(BMI, "kg/m2", time);
  return {
    effectiveDateTime: time,
    properties: [
      { property_path: "body.height", value: metres(height.value) },
      { property_path: "body.mass", value: weight.value },
      ...(bmi ? [{ property_path: "body.bmi" as const, value: bmi.value }] : []),
    ],
  };
};
