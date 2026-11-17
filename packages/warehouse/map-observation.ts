import { SYSTEMS } from "@open-twin/fhir-core";

const UCUM = "http://unitsofmeasure.org";
const LOINC = "http://loinc.org";

/** Glucose in blood: the code Google Health sends every glucose reading under. */
const BLOOD_GLUCOSE_LOINC = "2339-0";
/** Glucose in interstitial fluid: a continuous glucose monitor's sensor reading. */
export const SENSOR_GLUCOSE_LOINC = "99504-3";
const SENSOR_GLUCOSE_DISPLAY = "Glucose [Mass/volume] in Interstitial fluid";
/** Google Health's specimen for a continuous glucose monitor's reading. */
export const INTERSTITIAL_FLUID = "INTERSTITIAL_FLUID";

export const WAREHOUSE_SOURCE = "synthea" as const;

export type NumericRow = {
  readonly loinc: string;
  readonly display: string;
  readonly value: number;
  readonly unitUcum: string;
  readonly effectiveAt: Date;
  readonly fhirId: string;
};

export type NonNumericRow = {
  readonly loinc: string;
  readonly display: string;
  readonly valueType: string;
  readonly rawValue: unknown;
  readonly fhirId: string;
};

type Coding = {
  readonly system?: string;
  readonly code?: string;
  readonly display?: string;
};

type Quantity = {
  readonly value?: unknown;
  readonly system?: string;
  readonly code?: string;
  readonly unit?: string;
};

type FhirComponent = {
  readonly code?: { readonly coding?: readonly Coding[] };
  readonly valueQuantity?: Quantity;
  readonly valueString?: unknown;
};

type FhirObservation = {
  readonly id?: string;
  readonly resourceType?: string;
  readonly code?: { readonly coding?: readonly Coding[] };
  readonly valueQuantity?: Quantity;
  readonly valueString?: unknown;
  readonly valueBoolean?: unknown;
  readonly valueCodeableConcept?: unknown;
  readonly valueInteger?: unknown;
  readonly effectiveDateTime?: string;
  readonly component?: readonly FhirComponent[];
};

export type MappedObservation =
  | { readonly kind: "numeric"; readonly row: NumericRow }
  | { readonly kind: "nonNumeric"; readonly row: NonNumericRow }
  | { readonly kind: "missingUnit"; readonly fhirId: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const codingOf = (coded: {
  readonly code?: { readonly coding?: readonly Coding[] };
}): Coding => {
  const coding = coded.code?.coding ?? [];
  return coding.find((item) => item.system === LOINC) ?? coding[0] ?? {};
};

/** Google Health's `specimen` component, when the reading has one. */
const specimenOf = (observation: FhirObservation): unknown =>
  observation.component?.find((component) =>
    component.code?.coding?.some(
      (item) => item.system === SYSTEMS.GOOGLE_HEALTH && item.code === "specimen",
    ),
  )?.valueString;

/**
 * The code and display a reading is stored under. Google Health codes every
 * glucose reading 2339-0 (in blood) and says in a `specimen` component where
 * it was read. A reading from interstitial fluid is a continuous monitor's,
 * so it is stored as sensor glucose (99504-3), never as blood glucose.
 */
const storedCode = (
  observation: FhirObservation,
  loinc: string,
  display: string,
): Readonly<{ loinc: string; display: string }> =>
  loinc === BLOOD_GLUCOSE_LOINC && specimenOf(observation) === INTERSTITIAL_FLUID
    ? { loinc: SENSOR_GLUCOSE_LOINC, display: SENSOR_GLUCOSE_DISPLAY }
    : { loinc, display };

export const mapObservation = (resource: unknown): MappedObservation | undefined => {
  if (!isObject(resource) || resource.resourceType !== "Observation") return undefined;
  const observation = resource as FhirObservation;
  const fhirId = typeof observation.id === "string" ? observation.id : "";
  if (!fhirId) return undefined;

  const coding = codingOf(observation);
  const { loinc, display } = storedCode(
    observation,
    typeof coding.code === "string" ? coding.code : "",
    typeof coding.display === "string" ? coding.display : "",
  );
  const quantity = observation.valueQuantity;

  if (quantity && typeof quantity.value === "number") {
    const hasUcum =
      quantity.system === UCUM &&
      typeof quantity.code === "string" &&
      quantity.code.length > 0;
    if (!hasUcum) return { kind: "missingUnit", fhirId };
    if (typeof observation.effectiveDateTime !== "string") {
      return {
        kind: "nonNumeric",
        row: {
          loinc,
          display,
          valueType: "Quantity",
          rawValue: quantity,
          fhirId,
        },
      };
    }
    return {
      kind: "numeric",
      row: {
        loinc,
        display,
        value: quantity.value,
        unitUcum: quantity.code,
        effectiveAt: new Date(observation.effectiveDateTime),
        fhirId,
      },
    };
  }

  const valueType =
    observation.valueString !== undefined
      ? "string"
      : observation.valueBoolean !== undefined
        ? "boolean"
        : observation.valueCodeableConcept !== undefined
          ? "CodeableConcept"
          : observation.valueInteger !== undefined
            ? "integer"
            : observation.component !== undefined
              ? "components"
              : "unknown";

  return {
    kind: "nonNumeric",
    row: {
      loinc,
      display,
      valueType,
      rawValue: {
        valueString: observation.valueString,
        valueBoolean: observation.valueBoolean,
        valueCodeableConcept: observation.valueCodeableConcept,
        valueInteger: observation.valueInteger,
        valueQuantity: observation.valueQuantity,
        component: observation.component,
      },
      fhirId,
    },
  };
};

/**
 * One row per Observation, plus one numeric row per component that carries a
 * LOINC code and a Quantity (blood pressure panels keep systolic and diastolic
 * there). Component rows use `<id>#<component loinc>` as fhirId and the
 * parent's effectiveDateTime. A LOINC that repeats within one panel gets
 * `/<n>` from its second occurrence on (`<id>#8480-6/2`), in source order, so
 * fhirIds stay unique and stable across re-runs.
 */
export const mapObservations = (resource: unknown): MappedObservation[] => {
  const parent = mapObservation(resource);
  if (!parent) return [];
  const observation = resource as FhirObservation;
  const seen = new Map<string, number>();
  const components = (observation.component ?? []).flatMap((component) => {
    const coding = codingOf(component);
    if (
      !component.valueQuantity ||
      coding.system !== LOINC ||
      typeof coding.code !== "string" ||
      !coding.code
    ) {
      return [];
    }
    const occurrence = (seen.get(coding.code) ?? 0) + 1;
    seen.set(coding.code, occurrence);
    const suffix = occurrence === 1 ? coding.code : `${coding.code}/${occurrence}`;
    const mapped = mapObservation({
      resourceType: "Observation",
      id: `${observation.id}#${suffix}`,
      code: component.code,
      valueQuantity: component.valueQuantity,
      effectiveDateTime: observation.effectiveDateTime,
    });
    return mapped ? [mapped] : [];
  });
  return [...components, parent];
};
