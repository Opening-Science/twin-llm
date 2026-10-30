/**
 * Which 1M-cohort records go into the AF evaluation cohort (#293). Pure.
 *
 * The rule: every person whose record has an atrial fibrillation onset, in
 * every batch read, nobody else. That is all the within-person design needs
 * when AF is the exposure (it only follows people with AF), so rates on this
 * cohort equal rates on the full batches for that design. It is not a sample
 * of the population: a between-person comparison would find no unexposed
 * people, and `cohort_event_rates` refuses one on this cohort.
 */
import { CONDITION_CODES } from "../../packages/query-tools/event-rates/codes";
import { AF_SUBSET_COHORT } from "../../packages/query-tools/event-rates/cohort-rates";

import { type PersonFacts } from "./person-facts";

export const AF_COHORT_ID = AF_SUBSET_COHORT;

/** The SNOMED code the rule selects on, as `codes.ts` lists it. */
export const AF_CODE = CONDITION_CODES.af[0]?.code ?? "";

/** The ids of people with an AF onset, sorted, without repeats. */
export const afSubsetIds = (people: readonly PersonFacts[]): readonly string[] =>
  [
    ...new Set(
      people
        .filter((person) => person.onsets.af !== undefined)
        .map((person) => person.id),
    ),
  ].sort();

/** The archive entry of a person: Synthea names files `<Given>_<Family>_<id>.json`. */
export const entryPattern = (id: string): string => `fhir/*_${id}.json`;
