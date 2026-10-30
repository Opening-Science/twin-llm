/**
 * The atrial fibrillation tables: CHA2DS2-VASc at onset, stroke incidence
 * after onset by score group and by anticoagulation, time from onset to
 * stroke, the order of stroke and AF, and sleep apnea co-occurrence. Pure.
 */
import { median } from "../../packages/query-tools/stats";

import { cha2ds2Vasc, SCORE_GROUPS, type ScoreGroup, scoreGroup } from "./cha2ds2-vasc";
import { type Topic } from "./codes";
import { ageYears, observedStart, type Person } from "./cohort";
import { DAYS_PER_YEAR, type Rate, rateOf, type RateRatio, rateRatio } from "./poisson";

const before = (person: Person, topic: Topic, day: number): boolean => {
  const at = person.onset[topic];
  return at !== undefined && at <= day;
};

/** CHA2DS2-VASc on the day of AF onset, or null without AF. */
export const scoreAtAfOnset = (person: Person): number | null => {
  const day = person.onset.af;
  if (day === undefined) return null;
  return cha2ds2Vasc({
    ageYears: ageYears(person, day),
    female: person.sex === "F",
    heartFailure: before(person, "heartFailure", day),
    hypertension: before(person, "hypertension", day),
    diabetes: before(person, "diabetes", day),
    strokeOrTia: before(person, "stroke", day),
    vascularDisease: before(person, "vascular", day),
  });
};

/** AF people followed after onset: no stroke on or before onset, onset before the end. */
export const atRiskAfterAf = (people: readonly Person[]): readonly Person[] =>
  people.filter((person) => {
    const day = person.onset.af;
    return day !== undefined && day < person.end && !before(person, "stroke", day);
  });

type Interval = Readonly<{ from: number; days: number; event: boolean }>;

/**
 * AF onset (or the start of the complete window, if later) to the first
 * stroke, death or end of follow-up. A stroke between onset and the window
 * leaves the person out of the window's person-time.
 */
const afterAf = (person: Person): Interval => {
  const from = observedStart(person, person.onset.af ?? person.end);
  const stroke = person.onset.stroke;
  if (from >= person.end || (stroke !== undefined && stroke <= from)) {
    return { from, days: 0, event: false };
  }
  return stroke !== undefined && stroke <= person.end
    ? { from, days: stroke - from, event: true }
    : { from, days: person.end - from, event: false };
};

const rateFrom = (rows: readonly Readonly<{ days: number; event: boolean }>[]): Rate =>
  rateOf(
    rows.filter((row) => row.event).length,
    rows.reduce((total, row) => total + row.days, 0) / DAYS_PER_YEAR,
  );

export type ScoreRow = Readonly<{ group: ScoreGroup; people: number; rate: Rate }>;

export const strokeByScore = (people: readonly Person[]): readonly ScoreRow[] => {
  const atRisk = atRiskAfterAf(people);
  return SCORE_GROUPS.map((group) => {
    const members = atRisk.filter(
      (person) => scoreGroup(scoreAtAfOnset(person) ?? 0) === group,
    );
    return { group, people: members.length, rate: rateFrom(members.map(afterAf)) };
  });
};

export const scoreDistribution = (
  people: readonly Person[],
): Readonly<Record<string, number>> =>
  people.reduce<Record<string, number>>((counts, person) => {
    const score = scoreAtAfOnset(person);
    return score === null ? counts : { ...counts, [score]: (counts[score] ?? 0) + 1 };
  }, {});

export type AnticoagulationTable = Readonly<{
  /** AF people with an oral anticoagulant order on or after AF onset. */
  everTreated: number;
  atRisk: number;
  /** Days from AF onset to the first order, among those treated. */
  medianDaysToFirstOrder: number | null;
  without: Rate;
  with: Rate;
  ratio: RateRatio;
}>;

/**
 * Person-time after AF onset split at the first oral anticoagulant order:
 * before it counts as untreated, from it on as treated. An order before AF
 * onset counts as treated from onset.
 */
export const strokeByAnticoagulation = (
  people: readonly Person[],
): AnticoagulationTable => {
  const atRisk = atRiskAfterAf(people);
  const split = atRisk.map((person) => {
    const { from: start, days, event } = afterAf(person);
    const stop = start + days;
    const order = person.anticoagulant;
    const switchAt = order === null ? stop : Math.min(Math.max(order, start), stop);
    // A stroke on the day of the first order counts as untreated.
    const eventTreated = event && switchAt < stop;
    return {
      untreated: { days: switchAt - start, event: event && !eventTreated },
      treated: { days: stop - switchAt, event: eventTreated },
    };
  });
  const treatedDelays = atRisk.flatMap((person) => {
    const start = person.onset.af;
    return person.anticoagulant !== null &&
      start !== undefined &&
      person.anticoagulant >= start
      ? [person.anticoagulant - start]
      : [];
  });
  const without = rateFrom(split.map((row) => row.untreated));
  const treated = rateFrom(split.map((row) => row.treated));
  return {
    everTreated: people.filter(
      (person) =>
        person.onset.af !== undefined &&
        person.anticoagulant !== null &&
        person.anticoagulant >= person.onset.af,
    ).length,
    atRisk: atRisk.length,
    medianDaysToFirstOrder: median(treatedDelays),
    without,
    with: treated,
    ratio: rateRatio(treated, without),
  };
};

export type TimeToStroke = Readonly<{
  strokes: number;
  medianDays: number | null;
  quartileDays: Readonly<{ low: number; high: number }> | null;
  /** Counts by years from AF onset: under 1, 1 to 5, 5 to 10, 10 and more. */
  byYears: Readonly<Record<"<1" | "1-5" | "5-10" | "10+", number>>;
}>;

/** Linear-interpolated quantile of sorted values (type 7). */
export const quantile = (sorted: readonly number[], q: number): number | null => {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const a = sorted[low] ?? 0;
  const b = sorted[high] ?? a;
  return a + (b - a) * (position - low);
};

export const timeToStroke = (people: readonly Person[]): TimeToStroke => {
  const days = atRiskAfterAf(people)
    .flatMap((person) => {
      const row = afterAf(person);
      return row.event ? [row.from + row.days - (person.onset.af ?? row.from)] : [];
    })
    .sort((a, b) => a - b);
  const low = quantile(days, 0.25);
  const high = quantile(days, 0.75);
  const years = (row: number) => row / DAYS_PER_YEAR;
  return {
    strokes: days.length,
    medianDays: median(days),
    quartileDays: low === null || high === null ? null : { low, high },
    byYears: {
      "<1": days.filter((row) => years(row) < 1).length,
      "1-5": days.filter((row) => years(row) >= 1 && years(row) < 5).length,
      "5-10": days.filter((row) => years(row) >= 5 && years(row) < 10).length,
      "10+": days.filter((row) => years(row) >= 10).length,
    },
  };
};

export type Order = Readonly<{
  both: number;
  strokeFirst: number;
  sameDay: number;
  afFirst: number;
}>;

/**
 * Among people with both AF and stroke recorded: which came first. With
 * `windowOnly`, only people whose two onsets both fall in the complete window,
 * where an earlier stroke cannot have been left out of the export.
 */
export const strokeAfOrder = (people: readonly Person[], windowOnly = false): Order =>
  people.reduce<Order>(
    (counts, person) => {
      const af = person.onset.af;
      const stroke = person.onset.stroke;
      if (af === undefined || stroke === undefined) return counts;
      if (windowOnly && Math.min(af, stroke) < person.observedFrom) return counts;
      return {
        both: counts.both + 1,
        strokeFirst: counts.strokeFirst + (stroke < af ? 1 : 0),
        sameDay: counts.sameDay + (stroke === af ? 1 : 0),
        afFirst: counts.afFirst + (stroke > af ? 1 : 0),
      };
    },
    { both: 0, strokeFirst: 0, sameDay: 0, afFirst: 0 },
  );

export type TwoByTwo = Readonly<{
  both: number;
  onlyA: number;
  onlyB: number;
  neither: number;
}>;

export type CoOccurrence = Readonly<{
  table: TwoByTwo;
  crudeOddsRatio: number | null;
  /** Mantel-Haenszel odds ratio over sex by age-band strata. */
  adjustedOddsRatio: number | null;
}>;

const AGE_BANDS = [0, 45, 65, 80] as const;

const stratumOf = (person: Person): string => {
  const age = ageYears(person, person.end);
  const band = AGE_BANDS.filter((edge) => age >= edge).length;
  return `${person.sex ?? "?"}:${band}`;
};

const tableOf = (people: readonly Person[], a: Topic, b: Topic): TwoByTwo =>
  people.reduce<TwoByTwo>(
    (table, person) => {
      const hasA = person.onset[a] !== undefined;
      const hasB = person.onset[b] !== undefined;
      return {
        both: table.both + (hasA && hasB ? 1 : 0),
        onlyA: table.onlyA + (hasA && !hasB ? 1 : 0),
        onlyB: table.onlyB + (!hasA && hasB ? 1 : 0),
        neither: table.neither + (!hasA && !hasB ? 1 : 0),
      };
    },
    { both: 0, onlyA: 0, onlyB: 0, neither: 0 },
  );

const oddsRatio = (t: TwoByTwo): number | null =>
  t.onlyA === 0 || t.onlyB === 0 ? null : (t.both * t.neither) / (t.onlyA * t.onlyB);

/** Mantel-Haenszel: sum(a d / n) / sum(b c / n) over strata. */
export const mantelHaenszel = (strata: readonly TwoByTwo[]): number | null => {
  const sums = strata.reduce(
    (total, t) => {
      const n = t.both + t.onlyA + t.onlyB + t.neither;
      if (n === 0) return total;
      return {
        top: total.top + (t.both * t.neither) / n,
        bottom: total.bottom + (t.onlyA * t.onlyB) / n,
      };
    },
    { top: 0, bottom: 0 },
  );
  return sums.bottom === 0 ? null : sums.top / sums.bottom;
};

/** Ever-recorded A and B in the same person, crude and within sex and age band. */
export const coOccurrence = (
  people: readonly Person[],
  a: Topic,
  b: Topic,
): CoOccurrence => {
  const groups = new Map<string, Person[]>();
  for (const person of people) {
    const key = stratumOf(person);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [person]);
    else group.push(person);
  }
  const table = tableOf(people, a, b);
  return {
    table,
    crudeOddsRatio: oddsRatio(table),
    adjustedOddsRatio: mantelHaenszel(
      [...groups.values()].map((group) => tableOf(group, a, b)),
    ),
  };
};
