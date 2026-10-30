/**
 * Exposed against age- and sex-matched unexposed people, in the style of a
 * matched cohort with risk-set sampling. Pure apart from the seeded random
 * source passed in.
 *
 * An exposed person enters on their exposure onset if they are still followed
 * and have not had the outcome. Each gets up to `controlsPerExposed` controls
 * of the same sex, born within a year, who on that day are alive, followed,
 * not yet exposed and free of the outcome. A control is followed until the
 * outcome, the end of follow-up or their own exposure onset, whichever comes
 * first. Controls are drawn with replacement across exposed people. Person-time
 * and outcomes count only inside the complete window (`cohort.ts`), the same
 * calendar days for an exposed person and their controls.
 */
import { type Random } from "../synthetic-wearables/random";

import { type Topic } from "./codes";
import { birthYear, observedStart, type Person } from "./cohort";
import { DAYS_PER_YEAR, type Rate, rateOf, type RateRatio, rateRatio } from "./poisson";

export type MatchedResult = Readonly<{
  exposed: Rate;
  controls: Rate;
  ratio: RateRatio;
  exposedPeople: number;
  controlPeople: number;
  /** Exposed people for whom fewer controls than asked were found. */
  shortOfControls: number;
}>;

export type MatchedSpec = Readonly<{
  exposure: Topic;
  outcome: Topic;
  controlsPerExposed: number;
  /** Only exposed people this keeps; all of them when left out. */
  keepExposed?: (person: Person, index: number) => boolean;
}>;

type Follow = Readonly<{ days: number; event: boolean }>;

const NOTHING: Follow = { days: 0, event: false };

/**
 * From `start` (or the start of the complete window, if later) to the outcome
 * or `stop`, whichever is first. Someone whose outcome falls before the window
 * opens is no longer at risk in it and adds nothing.
 */
const follow = (person: Person, outcome: Topic, start: number, stop: number): Follow => {
  const from = observedStart(person, start);
  const at = person.onset[outcome];
  if (from >= stop || (at !== undefined && at <= from)) return NOTHING;
  return at !== undefined && at <= stop
    ? { days: at - from, event: true }
    : { days: stop - from, event: false };
};

const bucketKey = (sex: string | null, year: number): string => `${sex ?? "?"}:${year}`;

const index = (people: readonly Person[]): ReadonlyMap<string, readonly Person[]> => {
  const buckets = new Map<string, Person[]>();
  for (const person of people) {
    const key = bucketKey(person.sex, birthYear(person));
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [person]);
    else bucket.push(person);
  }
  return buckets;
};

const isEligibleControl = (
  candidate: Person,
  spec: MatchedSpec,
  exposedId: string,
  day: number,
): boolean => {
  const exposure = candidate.onset[spec.exposure];
  const outcome = candidate.onset[spec.outcome];
  return (
    candidate.id !== exposedId &&
    candidate.birth <= day &&
    candidate.end > day &&
    (exposure === undefined || exposure > day) &&
    (outcome === undefined || outcome > day)
  );
};

const TRIES_PER_CONTROL = 200;

export const matchedIncidence = (
  people: readonly Person[],
  spec: MatchedSpec,
  random: Random,
): MatchedResult => {
  const buckets = index(people);
  const exposedFollow: Follow[] = [];
  const controlFollow: Follow[] = [];
  let shortOfControls = 0;

  people.forEach((person, position) => {
    const day = person.onset[spec.exposure];
    if (day === undefined || day >= person.end) return;
    const outcome = person.onset[spec.outcome];
    if (outcome !== undefined && outcome <= day) return;
    if (spec.keepExposed !== undefined && !spec.keepExposed(person, position)) return;
    exposedFollow.push(follow(person, spec.outcome, day, person.end));

    const year = birthYear(person);
    const pool = [year - 1, year, year + 1].flatMap(
      (y) => buckets.get(bucketKey(person.sex, y)) ?? [],
    );
    let found = 0;
    for (
      let tries = 0;
      found < spec.controlsPerExposed &&
      tries < TRIES_PER_CONTROL * spec.controlsPerExposed;
      tries += 1
    ) {
      const candidate = pool[Math.floor(random() * pool.length)];
      if (
        candidate === undefined ||
        !isEligibleControl(candidate, spec, person.id, day)
      ) {
        continue;
      }
      const ownExposure = candidate.onset[spec.exposure];
      const stop =
        ownExposure === undefined ? candidate.end : Math.min(candidate.end, ownExposure);
      controlFollow.push(follow(candidate, spec.outcome, day, stop));
      found += 1;
    }
    if (found < spec.controlsPerExposed) shortOfControls += 1;
  });

  const rate = (rows: readonly Follow[]): Rate =>
    rateOf(
      rows.filter((row) => row.event).length,
      rows.reduce((total, row) => total + row.days, 0) / DAYS_PER_YEAR,
    );
  const exposed = rate(exposedFollow);
  const controls = rate(controlFollow);
  return {
    exposed,
    controls,
    ratio: rateRatio(exposed, controls),
    exposedPeople: exposedFollow.length,
    controlPeople: controlFollow.length,
    shortOfControls,
  };
};
