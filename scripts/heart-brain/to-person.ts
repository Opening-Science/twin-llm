/**
 * A person's facts from a people file (`person-facts.ts`) as day numbers
 * (`packages/query-tools/event-rates/cohort.ts`). Pure.
 */
import {
  dayNumber,
  historyStart,
  type Person,
} from "../../packages/query-tools/event-rates/cohort";
import { type Topic, TOPICS } from "../../packages/query-tools/event-rates/codes";

import { type PersonFacts } from "./person-facts";

export const toPerson = (
  facts: PersonFacts,
  endDay: string,
  historyYears: number,
): Person => {
  const batchEnd = dayNumber(endDay);
  const death = facts.death === null ? null : dayNumber(facts.death);
  const onset = TOPICS.reduce<Partial<Record<Topic, number>>>((found, topic) => {
    const day = facts.onsets[topic];
    return day === undefined ? found : { ...found, [topic]: dayNumber(day) };
  }, {});
  return {
    id: facts.id,
    batch: facts.batch,
    sex: facts.sex,
    birth: dayNumber(facts.birth),
    end: death === null ? batchEnd : Math.min(death, batchEnd),
    observedFrom: historyStart(endDay, historyYears),
    died: death !== null,
    onset,
    anticoagulant:
      facts.anticoagulantStart === null ? null : dayNumber(facts.anticoagulantStart),
  };
};
