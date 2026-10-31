/**
 * The scripted verdicts the `cohort_event_rates` items are compared with
 * (#293). Pure. Two versions of the same people:
 *
 * - `exact`: the study's own people (`toPerson`), with full birth and death
 *   dates from the archives;
 * - `warehouse`: the same facts cut to what the warehouse stores (birth year,
 *   death year, first onsets) and rebuilt the way the tool does
 *   (`warehousePeople`), so the cost of storing years only can be measured.
 *
 * Both run the within-person design of `cohort-rates.ts` on the relations of
 * the hb question set.
 */
import {
  CONDITION_CODES,
  type Topic,
} from "../../packages/query-tools/event-rates/codes";
import { type Person } from "../../packages/query-tools/event-rates/cohort";
import {
  type CohortConditionRow,
  type CohortSetup,
  type CohortSubjectRow,
  warehousePeople,
  withinRates,
  type WithinRates,
} from "../../packages/query-tools/event-rates/cohort-rates";

import { type PersonFacts } from "./person-facts";

export type ReferenceRelation = Readonly<{
  id: string;
  exposure: Topic;
  outcome: Topic;
  minAge: number;
}>;

/** The relations the hb items ask about; AF is the exposure, as the AF subset allows. */
export const REFERENCE_RELATIONS: readonly ReferenceRelation[] = [
  { id: "af-stroke", exposure: "af", outcome: "stroke", minAge: 0 },
  { id: "af-stroke-55", exposure: "af", outcome: "stroke", minAge: 55 },
  { id: "af-stroke-65", exposure: "af", outcome: "stroke", minAge: 65 },
  { id: "af-dementia", exposure: "af", outcome: "dementia", minAge: 0 },
  { id: "af-dementia-65", exposure: "af", outcome: "dementia", minAge: 65 },
  { id: "af-sleep-apnea", exposure: "af", outcome: "sleepApnea", minAge: 0 },
];

/** A people-file line as the warehouse would store it: years, sex and first onsets. */
export const warehouseRowsOf = (
  facts: readonly PersonFacts[],
): Readonly<{ subjects: CohortSubjectRow[]; conditions: CohortConditionRow[] }> => ({
  subjects: facts.map((person) => ({
    subjectRef: person.id,
    sex: person.sex === "F" ? "female" : person.sex === "M" ? "male" : null,
    birthYear: Number(person.birth.slice(0, 4)),
    deathYear: person.death === null ? null : Number(person.death.slice(0, 4)),
  })),
  conditions: facts.flatMap((person) =>
    Object.entries(person.onsets).flatMap(([topic, day]) => {
      const code = CONDITION_CODES[topic as Topic][0]?.code;
      return code === undefined || day === undefined
        ? []
        : [{ subjectRef: person.id, code, onsetAt: new Date(`${day}T00:00:00.000Z`) }];
    }),
  ),
});

export type ReferenceRow = Readonly<{
  id: string;
  exact: WithinRates;
  warehouse: WithinRates;
}>;

export const referenceRows = (
  exactPeople: readonly Person[],
  facts: readonly PersonFacts[],
  setup: CohortSetup,
): readonly ReferenceRow[] => {
  const rows = warehouseRowsOf(facts);
  const { people } = warehousePeople(rows.subjects, rows.conditions, setup);
  return REFERENCE_RELATIONS.map((relation) => {
    const spec = {
      exposure: relation.exposure,
      outcome: relation.outcome,
      minAge: relation.minAge,
    };
    return {
      id: relation.id,
      exact: withinRates(exactPeople, spec),
      warehouse: withinRates(people, spec),
    };
  });
};
