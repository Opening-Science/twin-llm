/**
 * What the stroke oracle needs from one Synthea bundle beyond `person-facts.ts`:
 * the dated systolic BP readings, the dated smoking status and the days of
 * wellness visits. Pure. Reads observations with the warehouse's own mapper,
 * so a BP panel's systolic component is found the way the app finds it.
 *
 * Why wellness visits: `atrial_fibrillation.json` sets the AF attribute (and
 * so the calculator's AF points) the month AF starts, but writes the AF
 * condition at the next wellness visit (`ConditionOnset` with
 * `target_encounter: "Next Wellness Visit"`; `State$Encounter.diagnosePastConditions`
 * dates it with the encounter time). The recorded AF onset is that visit, and
 * the true start lies after the visit before it.
 */
import { mapObservations } from "../../packages/warehouse/map-observation";

import { type PersonFacts } from "./person-facts";

/** LOINC: systolic BP (a component of the 85354-9 panel in Synthea). */
export const SYSTOLIC_LOINC = "8480-6";
/** LOINC: tobacco smoking status. */
export const SMOKING_LOINC = "72166-2";
/** SNOMED encounter types Synthea uses for wellness visits (adult and child). */
export const WELLNESS_TYPES: readonly string[] = ["162673000", "410620009"];

/** `[YYYY-MM-DD, value]`, oldest first. */
export type Dated<T> = readonly [string, T];

export type OracleFacts = Readonly<{
  systolic: readonly Dated<number>[];
  smoker: readonly Dated<boolean>[];
  wellness: readonly string[];
}>;

export type OraclePerson = PersonFacts & Readonly<{ oracle: OracleFacts }>;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dayOf = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null;

const codings = (concept: unknown): Json[] =>
  isObject(concept) && Array.isArray(concept.coding)
    ? concept.coding.filter(isObject)
    : [];

/**
 * Whether a smoking status display means a current smoker (Synthea's
 * `smoker` attribute is true): "Smokes tobacco daily", "Current every day
 * smoker" and the like; never, ex- and former smokers are not.
 */
export const isCurrentSmoker = (display: string): boolean =>
  /smok/i.test(display) && !/never|ex-|former|non-?smoker/i.test(display);

const byDay = <T>(rows: readonly Dated<T>[]): Dated<T>[] =>
  [...rows].sort((a, b) => a[0].localeCompare(b[0]));

export const oracleFacts = (entries: readonly unknown[]): OracleFacts => {
  const resources = entries
    .map((entry) => (isObject(entry) ? entry.resource : undefined))
    .filter(isObject);

  const systolic = resources.flatMap((resource): Dated<number>[] =>
    resource.resourceType !== "Observation"
      ? []
      : mapObservations(resource).flatMap((mapped): Dated<number>[] =>
          mapped.kind === "numeric" && mapped.row.loinc === SYSTOLIC_LOINC
            ? [[mapped.row.effectiveAt.toISOString().slice(0, 10), mapped.row.value]]
            : [],
        ),
  );

  const smoker = resources.flatMap((resource): Dated<boolean>[] => {
    if (resource.resourceType !== "Observation") return [];
    const isSmoking = codings(resource.code).some(
      (coding) => coding.code === SMOKING_LOINC,
    );
    const day = dayOf(resource.effectiveDateTime);
    const display = codings(resource.valueCodeableConcept)
      .map((coding) => coding.display)
      .find((value): value is string => typeof value === "string");
    return isSmoking && day !== null && display !== undefined
      ? [[day, isCurrentSmoker(display)]]
      : [];
  });

  const wellness = resources
    .filter(
      (resource) =>
        resource.resourceType === "Encounter" &&
        Array.isArray(resource.type) &&
        resource.type.some((type) =>
          codings(type).some((coding) => WELLNESS_TYPES.includes(String(coding.code))),
        ),
    )
    .map((resource) => dayOf(isObject(resource.period) ? resource.period.start : null))
    .filter((day): day is string => day !== null);

  return {
    systolic: byDay(systolic),
    smoker: byDay(smoker),
    wellness: [...new Set(wellness)].sort(),
  };
};
