/**
 * The whole analysis over a set of people, as one plain object the report
 * and the summary JSON are written from. Pure: the seed fixes every random
 * draw, so the same batches and seed give the same numbers.
 */
import { randomFor } from "../synthetic-wearables/random";

import {
  type AnticoagulationTable,
  type CoOccurrence,
  coOccurrence,
  type Order,
  type ScoreRow,
  scoreDistribution,
  strokeAfOrder,
  strokeByAnticoagulation,
  strokeByScore,
  type TimeToStroke,
  timeToStroke,
} from "./af-tables";
import { type Topic, TOPICS } from "../../packages/query-tools/event-rates/codes";
import { ageYears, type Person } from "../../packages/query-tools/event-rates/cohort";
import {
  type MatchedResult,
  matchedIncidence,
} from "../../packages/query-tools/event-rates/matched";
import { shuffleAfOnsets, type Spread, spreadOf } from "./permutation";
import { type Agreement, agreementOf, type Planted, PLANTED_RULES } from "./planted";
import {
  type Recovered,
  recoveredOf,
} from "../../packages/query-tools/event-rates/verdict";
import { type RateRatio } from "../../packages/query-tools/event-rates/poisson";

export type StudyOptions = Readonly<{
  seed: number;
  /** Synthea's `exporter.years_of_history`; outcomes count only inside it. 0: whole record. */
  historyYears: number;
  controlsPerExposed: number;
  permutations: number;
}>;

export type RuleRow = Readonly<{
  id: string;
  label: string;
  planted: Planted;
  source: string;
  result: MatchedResult | null;
  ratio: RateRatio;
  recovered: Recovered;
  agreement: Agreement;
}>;

export type Study = Readonly<{
  people: number;
  deceased: number;
  female: number;
  counts: Readonly<Record<Topic, number>>;
  anticoagulated: number;
  scores: Readonly<Record<string, number>>;
  strokeByScore: readonly ScoreRow[];
  anticoagulation: AnticoagulationTable;
  timeToStroke: TimeToStroke;
  order: Order;
  /** The same, only where both onsets fall in the complete window. */
  orderInWindow: Order;
  sleepApneaAf: CoOccurrence;
  rules: readonly RuleRow[];
  shuffled: Readonly<{
    observedAfFirstShare: number | null;
    afFirstShare: Spread | null;
    observedRatio: number | null;
    ratio: Spread | null;
  }>;
}>;

const afFirstShare = (order: Order): number | null =>
  order.both === 0 ? null : order.afFirst / order.both;

export const runStudy = (people: readonly Person[], options: StudyOptions): Study => {
  const random = (key: string) => randomFor(options.seed, key);
  const matched = (exposure: Topic, outcome: Topic, key: string, minAge?: number) =>
    matchedIncidence(
      people,
      {
        exposure,
        outcome,
        controlsPerExposed: options.controlsPerExposed,
        ...(minAge === undefined
          ? {}
          : {
              keepExposed: (person: Person) =>
                ageYears(person, person.onset[exposure] ?? person.end) >= minAge,
            }),
      },
      random(key),
    );

  const rules: RuleRow[] = PLANTED_RULES.map((rule) => {
    const result = matched(rule.exposure, rule.outcome, `rule:${rule.id}`, rule.minAge);
    const recovered = recoveredOf(result.ratio);
    return {
      id: rule.id,
      label: rule.label,
      planted: rule.planted,
      source: rule.source,
      result,
      ratio: result.ratio,
      recovered,
      agreement: agreementOf(rule.planted, recovered),
    };
  });

  const anticoagulation = strokeByAnticoagulation(people);
  const anticoagulationRecovered = recoveredOf(anticoagulation.ratio);
  const anticoagulationRow: RuleRow = {
    id: "anticoagulant-stroke",
    label: "Oral anticoagulant after AF, then stroke",
    planted: "none",
    source: "no calculator reads a medication",
    result: null,
    ratio: anticoagulation.ratio,
    recovered: anticoagulationRecovered,
    agreement: agreementOf("none", anticoagulationRecovered),
  };

  const order = strokeAfOrder(people);
  const observedRatio =
    rules.find((rule) => rule.id === "af-stroke")?.ratio?.ratio ?? null;
  const shuffledRuns = Array.from({ length: options.permutations }, (_, run) => {
    const shuffled = shuffleAfOnsets(people, random(`shuffle:${run}`));
    const ratio = matchedIncidence(
      shuffled,
      {
        exposure: "af",
        outcome: "stroke",
        controlsPerExposed: options.controlsPerExposed,
      },
      random(`shuffle-match:${run}`),
    ).ratio;
    return { share: afFirstShare(strokeAfOrder(shuffled)), ratio: ratio?.ratio ?? null };
  });

  return {
    people: people.length,
    deceased: people.filter((person) => person.died).length,
    female: people.filter((person) => person.sex === "F").length,
    counts: TOPICS.reduce<Record<string, number>>(
      (counts, topic) => ({
        ...counts,
        [topic]: people.filter((person) => person.onset[topic] !== undefined).length,
      }),
      {},
    ) as Record<Topic, number>,
    anticoagulated: people.filter((person) => person.anticoagulant !== null).length,
    scores: scoreDistribution(people),
    strokeByScore: strokeByScore(people),
    anticoagulation,
    timeToStroke: timeToStroke(people),
    order,
    orderInWindow: strokeAfOrder(people, true),
    sleepApneaAf: coOccurrence(people, "sleepApnea", "af"),
    rules: [...rules, anticoagulationRow],
    shuffled: {
      observedAfFirstShare: afFirstShare(order),
      afFirstShare: spreadOf(shuffledRuns.map((run) => run.share)),
      observedRatio,
      ratio: spreadOf(shuffledRuns.map((run) => run.ratio)),
    },
  };
};
