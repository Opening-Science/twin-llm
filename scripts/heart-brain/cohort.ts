/**
 * Person facts as day numbers, so the analyses compare integers instead of
 * date strings. Pure. A living person is followed to their batch's end date
 * (administrative censoring); a deceased one to the day of death.
 *
 * Synthea's FHIR export keeps only the last `exporter.years_of_history` years
 * (10 by default, which the 1M recipe keeps): a condition that ended before
 * that, such as a stroke, and older medication orders are left out, while
 * conditions still active (AF, hypertension, diabetes) keep their first
 * onset. So outcomes are only counted from `observedFrom`, the first day of
 * that complete window.
 */
import { MS_PER_DAY } from "../../packages/query-tools/stats";

import { type Topic, TOPICS } from "./codes";
import { type PersonFacts } from "./person-facts";
import { DAYS_PER_YEAR } from "./poisson";

export type Person = Readonly<{
  id: string;
  batch: string;
  sex: "F" | "M" | null;
  birth: number;
  /** Last day of follow-up: death, or the batch end date. */
  end: number;
  /** First day of the exported history window; outcomes count from here. */
  observedFrom: number;
  died: boolean;
  onset: Readonly<Partial<Record<Topic, number>>>;
  anticoagulant: number | null;
}>;

/** Days since 1970-01-01 for a YYYY-MM-DD day. */
export const dayNumber = (day: string): number =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY);

export const ageYears = (person: Pick<Person, "birth">, day: number): number =>
  (day - person.birth) / DAYS_PER_YEAR;

export const birthYear = (person: Pick<Person, "birth">): number =>
  new Date(person.birth * MS_PER_DAY).getUTCFullYear();

/** The day `years` calendar years before `day` (YYYY-MM-DD); 0 years means no window. */
export const historyStart = (endDay: string, years: number): number =>
  years === 0
    ? Number.NEGATIVE_INFINITY
    : dayNumber(
        `${String(Number(endDay.slice(0, 4)) - years).padStart(4, "0")}${endDay.slice(4)}`,
      );

/** The later of `day` and the start of the person's complete window. */
export const observedStart = (
  person: Pick<Person, "observedFrom">,
  day: number,
): number => Math.max(day, person.observedFrom);

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

/** The same person with one topic's onset replaced (or removed with null). */
export const withOnset = (person: Person, topic: Topic, day: number | null): Person => {
  const { [topic]: _dropped, ...rest } = person.onset;
  return { ...person, onset: day === null ? rest : { ...rest, [topic]: day } };
};
