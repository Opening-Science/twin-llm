import "server-only";

import { randomFor } from "@/infrastructure/seeded-random";
import type { z } from "zod";

import { CONDITION_CODES, type Topic, topicOf } from "./event-rates/codes";
import {
  betweenRates,
  type BetweenRates,
  cohortSetupOf,
  MATCH_SEED,
  topicCodes,
  warehousePeople,
  withinRates,
  type WithinRates,
} from "./event-rates/cohort-rates";
import {
  defaultQueryToolPorts,
  findCohortConditionsInDatabase,
  findCohortSubjectsInDatabase,
  findLoadedCohortsInDatabase,
  type QueryToolPorts,
} from "./ports";
import {
  COHORT_RECORD_CAP,
  cohortNotSupported,
  cohortRecordCapExceeded,
  designNotSupported,
  type ToolRefusal,
} from "./refusals";
import { type cohortEventRatesInput } from "./schemas";
import {
  type CohortOutOfScope,
  cohortInScope,
  cohortOutOfScope,
  SYNTHETIC_COHORTS,
  type SessionScope,
} from "./scope";
import { audited } from "./tool-core";

/**
 * `cohort_event_rates` (#293): one outcome's rate around one exposure in a
 * loaded synthetic cohort, with the heart-brain study's designs
 * (`event-rates/`). Counts only: no subject_ref, date or value of a person
 * leaves the tool. Two capped reads (the cohort's subjects, the dated
 * conditions of the two codes' topics); no $queryRaw. Synthetic mode only.
 */

type CohortEventRatesInput = z.infer<typeof cohortEventRatesInput>;

export type ConditionUsed = Readonly<{ code: string; display: string; codes: string[] }>;

export type CohortEventRatesResult = Readonly<{
  cohort_id: string;
  exposure: ConditionUsed;
  outcome: ConditionUsed;
  min_age: number;
  follow_up: Readonly<{ from: string; to: string }>;
  subjects_read: number;
  subjects_without_birth_year: number;
  conditions_read: number;
  /** Subjects plus condition records read; the audit row_count. */
  rows_read: number;
  note: string;
}> &
  (WithinRates | BetweenRates);

const NOTE =
  "Rates in this loaded synthetic Synthea cohort only, made by the generator's rules; not about people in general and not a cause. Ages use 2 July of the stored birth year and follow-up of a person who died ends mid death year, because the warehouse stores years only.";

const conditionUsed = (code: string, topic: Topic): ConditionUsed => ({
  code,
  display: CONDITION_CODES[topic].find((entry) => entry.code === code)?.display ?? topic,
  codes: topicCodes(topic),
});

const loadedSupported = async (ports: QueryToolPorts): Promise<string[]> => {
  const supported = SYNTHETIC_COHORTS.filter((id) => cohortSetupOf(id) !== null);
  const loaded = await (ports.findLoadedCohorts ?? findLoadedCohortsInDatabase)(
    supported,
  );
  return [...loaded];
};

export const runCohortEventRates = (
  scope: SessionScope,
  input: CohortEventRatesInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<CohortEventRatesResult | ToolRefusal | CohortOutOfScope> =>
  audited<CohortEventRatesResult | ToolRefusal | CohortOutOfScope>(
    scope,
    "cohort_event_rates",
    input,
    null,
    async () => {
      if (scope.mode !== "synthetic") return cohortOutOfScope(scope, []);
      if (!cohortInScope(scope, input.cohort_id)) {
        return cohortOutOfScope(scope, await loadedSupported(ports));
      }
      const setup = cohortSetupOf(input.cohort_id);
      if (setup === null) {
        return cohortNotSupported(input.cohort_id, await loadedSupported(ports));
      }
      const exposure = topicOf(input.exposure_code);
      const outcome = topicOf(input.outcome_code);
      if (exposure === null || outcome === null) {
        throw new Error("a code from the closed list has no topic");
      }
      if (
        setup.selectedOn !== null &&
        (input.design !== "within" || exposure !== setup.selectedOn)
      ) {
        return designNotSupported(
          input.cohort_id,
          CONDITION_CODES[setup.selectedOn][0]?.code ?? setup.selectedOn,
        );
      }

      const take = COHORT_RECORD_CAP + 1;
      const subjects = await (ports.findCohortSubjects ?? findCohortSubjectsInDatabase)({
        cohortId: input.cohort_id,
        take,
      });
      if (subjects.length > COHORT_RECORD_CAP) return cohortRecordCapExceeded("subject");
      const conditions = await (
        ports.findCohortConditions ?? findCohortConditionsInDatabase
      )({
        cohortId: input.cohort_id,
        codes: [...topicCodes(exposure), ...topicCodes(outcome)],
        take,
      });
      if (conditions.length > COHORT_RECORD_CAP) {
        return cohortRecordCapExceeded("condition");
      }

      const { people, withoutBirthYear } = warehousePeople(subjects, conditions, setup);
      const minAge = input.min_age ?? 0;
      const spec = { exposure, outcome, minAge };
      const rates =
        input.design === "within"
          ? withinRates(people, spec)
          : betweenRates(
              people,
              spec,
              randomFor(
                MATCH_SEED,
                `cohort_event_rates:${exposure}:${outcome}:${minAge}`,
              ),
            );
      return {
        cohort_id: input.cohort_id,
        exposure: conditionUsed(input.exposure_code, exposure),
        outcome: conditionUsed(input.outcome_code, outcome),
        min_age: minAge,
        follow_up: {
          from: `${String(Number(setup.endDay.slice(0, 4)) - setup.historyYears)}${setup.endDay.slice(4)}`,
          to: setup.endDay,
        },
        subjects_read: subjects.length,
        subjects_without_birth_year: withoutBirthYear,
        conditions_read: conditions.length,
        rows_read: subjects.length + conditions.length,
        ...rates,
        note: NOTE,
      };
    },
    (result) => ("rows_read" in result ? result.rows_read : 0),
    ports,
  );
