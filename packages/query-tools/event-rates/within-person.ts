/**
 * Within-person timing: the same people's stroke rate before and after their
 * AF onset. Pure.
 *
 * Each person with an AF onset is followed from the later of the complete
 * window (`observedFrom`) and an optional minimum age, to their first stroke
 * or the end of follow-up. That time is cut at the AF onset, at fixed offsets
 * after it (0 to 2 years, 2 to 5, 5 and more by default) and at 5-year age
 * bands. A stroke on or before the first counted day takes the person out (it
 * is not a new event); a stroke on the AF onset day counts before it, as in
 * `matched.ts`. Time runs as (from, to] in days, so a stroke on day d falls in
 * the piece that ends on d.
 *
 * Because the people are the same on both sides, anything fixed about a
 * person (sex, BMI, the BP that pushes both calculators) cancels. Age does
 * not: time after onset is older time, so the age-adjusted (Mantel-Haenszel)
 * ratio is the one to read.
 */
import { type Topic } from "./codes";
import { observedStart, type Person } from "./cohort";
import {
  DAYS_PER_YEAR,
  exactRateRatio,
  mantelHaenszelRateRatio,
  type Rate,
  rateOf,
  type RateRatio,
} from "./poisson";

export type TimingSpec = Readonly<{
  exposure: Topic;
  outcome: Topic;
  /** Counted time starts at this age (0: from birth). */
  minAgeYears: number;
  /** Offsets in years after onset where a new window starts; must begin with 0. */
  afterWindowsYears: readonly number[];
  /** Width of the age bands used for adjustment. */
  ageBandYears: number;
}>;

export const DEFAULT_AFTER_WINDOWS = [0, 2, 5] as const;
export const AGE_BAND_YEARS = 5;

export const BEFORE = "before";

/** "0-2 y", "2-5 y", "5+ y" for [0, 2, 5]. */
export const windowLabels = (afterWindowsYears: readonly number[]): string[] =>
  afterWindowsYears.map((from, index) => {
    const to = afterWindowsYears[index + 1];
    return to === undefined ? `${from}+ y` : `${from}-${to} y`;
  });

export type Piece = Readonly<{
  /** `before` or one of `windowLabels`. */
  window: string;
  /** Age band index: floor(age at the piece's start / band width). */
  ageBand: number;
  /** Day numbers: the piece runs over (from, to]. */
  from: number;
  to: number;
  days: number;
  event: boolean;
}>;

const yearsToDays = (years: number): number => Math.floor(years * DAYS_PER_YEAR);

/**
 * One person's counted time in pieces, or null when they have no exposure
 * onset, no counted time, or the outcome before counted time starts.
 *
 * `cohort` (the default) stops at the outcome. `case-series` keeps only
 * people with the outcome inside counted time and follows them to the end,
 * as a self-controlled case series does; the piece holding the outcome day
 * is the event piece.
 */
export const personPieces = (
  person: Person,
  spec: TimingSpec,
  mode: "cohort" | "case-series" = "cohort",
): Piece[] | null => {
  const onset = person.onset[spec.exposure];
  if (onset === undefined) return null;
  const start = observedStart(person, person.birth + yearsToDays(spec.minAgeYears));
  const outcome = person.onset[spec.outcome];
  if (outcome !== undefined && outcome <= start) return null;
  const event = outcome !== undefined && outcome <= person.end;
  if (mode === "case-series" && !event) return null;
  const stop = event && mode === "cohort" ? outcome : person.end;
  if (stop <= start) return null;

  const labels = windowLabels(spec.afterWindowsYears);
  const offsets = spec.afterWindowsYears.map((years) => onset + yearsToDays(years));
  const bandDays = spec.ageBandYears * DAYS_PER_YEAR;
  const bandCuts: number[] = [];
  for (
    let band = Math.floor((start - person.birth) / bandDays) + 1;
    person.birth + Math.ceil(band * bandDays) < stop;
    band += 1
  ) {
    bandCuts.push(person.birth + Math.ceil(band * bandDays));
  }
  const cuts = [
    ...new Set(
      [start, stop, ...offsets, ...bandCuts].filter((d) => d >= start && d <= stop),
    ),
  ].sort((a, b) => a - b);

  return cuts.slice(0, -1).map((from, index) => {
    const to = cuts[index + 1] as number;
    const after = offsets.filter((offset) => from >= offset).length;
    return {
      window: after === 0 ? BEFORE : (labels[after - 1] as string),
      ageBand: Math.floor((from - person.birth) / bandDays),
      from,
      to,
      days: to - from,
      event: event && from < (outcome as number) && (outcome as number) <= to,
    };
  });
};

export type Cell = Readonly<{
  window: string;
  ageBand: number;
  events: number;
  personYears: number;
}>;

export type TimingTable = Readonly<{
  /** People with any counted time. */
  people: number;
  /** People with the outcome before counted time began. */
  outcomeBefore: number;
  cells: readonly Cell[];
}>;

/** Sums every person's pieces by window and age band. */
export const timingTable = (people: readonly Person[], spec: TimingSpec): TimingTable => {
  const sums = new Map<
    string,
    { window: string; ageBand: number; events: number; days: number }
  >();
  let included = 0;
  let outcomeBefore = 0;
  for (const person of people) {
    if (person.onset[spec.exposure] === undefined) continue;
    const pieces = personPieces(person, spec);
    if (pieces === null) {
      const start = observedStart(person, person.birth + yearsToDays(spec.minAgeYears));
      const outcome = person.onset[spec.outcome];
      if (outcome !== undefined && outcome <= start) outcomeBefore += 1;
      continue;
    }
    included += 1;
    for (const piece of pieces) {
      const key = `${piece.window}|${piece.ageBand}`;
      const sum = sums.get(key) ?? {
        window: piece.window,
        ageBand: piece.ageBand,
        events: 0,
        days: 0,
      };
      sum.events += piece.event ? 1 : 0;
      sum.days += piece.days;
      sums.set(key, sum);
    }
  }
  return {
    people: included,
    outcomeBefore,
    cells: [...sums.values()]
      .map((sum) => ({
        window: sum.window,
        ageBand: sum.ageBand,
        events: sum.events,
        personYears: sum.days / DAYS_PER_YEAR,
      }))
      .sort((a, b) => a.window.localeCompare(b.window) || a.ageBand - b.ageBand),
  };
};

export type WindowRow = Readonly<{
  window: string;
  rate: Rate;
  /** Against before: crude, exact interval. */
  crude: RateRatio;
  /** Against before: Mantel-Haenszel over age bands. */
  ageAdjusted: RateRatio;
}>;

export type TimingResult = Readonly<{
  people: number;
  outcomeBefore: number;
  before: Rate;
  /** Every after window together, then each one. */
  after: WindowRow;
  windows: readonly WindowRow[];
}>;

const rateOfCells = (cells: readonly Cell[]): Rate =>
  rateOf(
    cells.reduce((total, cell) => total + cell.events, 0),
    cells.reduce((total, cell) => total + cell.personYears, 0),
  );

const byBand = (
  cells: readonly Cell[],
): Map<number, { events: number; years: number }> => {
  const bands = new Map<number, { events: number; years: number }>();
  for (const cell of cells) {
    const band = bands.get(cell.ageBand) ?? { events: 0, years: 0 };
    band.events += cell.events;
    band.years += cell.personYears;
    bands.set(cell.ageBand, band);
  }
  return bands;
};

const compare = (
  window: string,
  after: readonly Cell[],
  before: readonly Cell[],
): WindowRow => {
  const rate = rateOfCells(after);
  const beforeBands = byBand(before);
  const strata = [...byBand(after)].map(([band, a]) => {
    const b = beforeBands.get(band) ?? { events: 0, years: 0 };
    return { aEvents: a.events, aYears: a.years, bEvents: b.events, bYears: b.years };
  });
  return {
    window,
    rate,
    crude: exactRateRatio(rate, rateOfCells(before)),
    ageAdjusted: mantelHaenszelRateRatio(strata),
  };
};

/** Before against after, overall and per window, crude and age-adjusted. */
export const timingResult = (table: TimingTable, spec: TimingSpec): TimingResult => {
  const before = table.cells.filter((cell) => cell.window === BEFORE);
  const after = table.cells.filter((cell) => cell.window !== BEFORE);
  return {
    people: table.people,
    outcomeBefore: table.outcomeBefore,
    before: rateOfCells(before),
    after: compare("after", after, before),
    windows: windowLabels(spec.afterWindowsYears).map((label) =>
      compare(
        label,
        table.cells.filter((cell) => cell.window === label),
        before,
      ),
    ),
  };
};
