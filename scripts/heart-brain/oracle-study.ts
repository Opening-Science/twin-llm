/**
 * Recovered against expected (#294): the AF-to-stroke comparisons of #250
 * (between-person, matched) and #262 (within-person cohort and case series),
 * each run as before on the observed strokes, and again on the strokes
 * Synthea's calculator expects on exactly the same person-time (`oracle.ts`).
 * Pure apart from the seeded random the matched design draws controls with.
 *
 * For each comparison:
 * - **expected**: the design's estimate with every stroke count replaced by
 *   the expected count (AF as recorded, lagged onsets). This is what the
 *   design should give if the calculator is the only thing at work.
 * - **planted**: the calculator's own AF effect on the exposed person-time:
 *   expected strokes with AF on over the same time with AF off.
 * - **no AF effect**: the design's estimate with AF switched off everywhere,
 *   what age, BP, smoking and diabetes alone give (the design's own bias).
 * - **within tolerance**: the expected value lies inside the recovered 95%
 *   interval. `recoveredOverExpected` puts both on one scale.
 * - **observed over expected** strokes on each side, with an exact Poisson
 *   interval, checks the oracle's level and not only the ratio.
 */
import { randomFor } from "../synthetic-wearables/random";

import { ageYears, type Person } from "../../packages/query-tools/event-rates/cohort";
import { toPerson } from "./to-person";
import {
  type Follow,
  matchedFollowUp,
} from "../../packages/query-tools/event-rates/matched";
import {
  expectedAfDays,
  expectedStrokes,
  MAIN,
  type OracleOptions,
  type OracleSubject,
  oracleSubject,
} from "./oracle";
import { type OraclePerson } from "./oracle-facts";
import {
  DAYS_PER_YEAR,
  exactRateRatio,
  type Interval,
  mantelHaenszelRateRatio,
  poissonExactCi,
  rateOf,
  type RateRatio,
  rateRatio,
} from "../../packages/query-tools/event-rates/poisson";
import { selfControlledCaseSeries } from "./sccs";
import { specFor } from "./timing";
import {
  BEFORE,
  personPieces,
  type Piece,
  type TimingSpec,
  windowLabels,
} from "../../packages/query-tools/event-rates/within-person";

export type OracleStudyOptions = Readonly<{
  endDay: string;
  historyYears: number;
  seed: number;
  controlsPerExposed: number;
}>;

export type ObservedOverExpected = Readonly<{
  observed: number;
  expected: number;
  ratio: number | null;
  ci: Interval | null;
}>;

export type Comparison = Readonly<{
  id: string;
  label: string;
  recovered: RateRatio;
  expected: number | null;
  planted: number | null;
  noAfEffect: number | null;
  /** Sensitivity: AF and diabetes start on the recorded day. */
  expectedRecordedOnsets: number | null;
  /** Sensitivity: the treated BP table from the recorded hypertension onset. */
  expectedTreatedBp: number | null;
  withinTolerance: boolean | null;
  recoveredOverExpected: RateRatio;
  checks: readonly (ObservedOverExpected & Readonly<{ side: string }>)[];
}>;

export type OracleStudy = Readonly<{
  options: OracleStudyOptions;
  subjects: number;
  withoutBp: number;
  /** Share of the before-onset person-time (within-person, all ages) with AF already on. */
  afOnShareBefore: number | null;
  comparisons: readonly Comparison[];
}>;

/** Observed against expected counts, exact Poisson interval on the observed side. */
export const observedOverExpected = (
  observed: number,
  expected: number,
): ObservedOverExpected => {
  if (expected <= 0) return { observed, expected, ratio: null, ci: null };
  const ci = poissonExactCi(observed);
  return {
    observed,
    expected,
    ratio: observed / expected,
    ci: { low: ci.low / expected, high: ci.high / expected },
  };
};

/** The recovered ratio and interval divided by the expected value. */
export const overExpected = (recovered: RateRatio, expected: number | null): RateRatio =>
  recovered === null || expected === null || expected <= 0
    ? null
    : {
        ratio: recovered.ratio / expected,
        ci: { low: recovered.ci.low / expected, high: recovered.ci.high / expected },
      };

/** Whether the expected value lies inside the recovered 95% interval. */
export const withinInterval = (
  recovered: RateRatio,
  expected: number | null,
): boolean | null =>
  recovered === null || expected === null
    ? null
    : expected >= recovered.ci.low && expected <= recovered.ci.high;

const OFF: OracleOptions = { ...MAIN, af: "off" };
const ON: OracleOptions = { ...MAIN, af: "on" };
const RECORDED: OracleOptions = { ...MAIN, onsets: "recorded" };
const TREATED: OracleOptions = { ...MAIN, bpTreated: "from hypertension onset" };

// ---- Within-person cohort ---------------------------------------------------

type Cell = { before: boolean; ageBand: number; events: number; years: number };

type Weighted = Readonly<{ piece: Piece; events: number }>;

const cellsOf = (rows: readonly Weighted[]): Cell[] => {
  const cells = new Map<string, Cell>();
  for (const { piece, events } of rows) {
    const before = piece.window === BEFORE;
    const key = `${before}|${piece.ageBand}`;
    const cell = cells.get(key) ?? {
      before,
      ageBand: piece.ageBand,
      events: 0,
      years: 0,
    };
    cell.events += events;
    cell.years += piece.days / DAYS_PER_YEAR;
    cells.set(key, cell);
  }
  return [...cells.values()];
};

const sumOf = (cells: readonly Cell[], before: boolean, key: "events" | "years") =>
  cells.filter((c) => c.before === before).reduce((t, c) => t + c[key], 0);

/** Mantel-Haenszel over age bands, after against before. */
const ageAdjusted = (cells: readonly Cell[]): RateRatio => {
  const bands = [...new Set(cells.map((c) => c.ageBand))];
  return mantelHaenszelRateRatio(
    bands.map((band) => {
      const side = (before: boolean) =>
        cells.find((c) => c.ageBand === band && c.before === before);
      return {
        aEvents: side(false)?.events ?? 0,
        aYears: side(false)?.years ?? 0,
        bEvents: side(true)?.events ?? 0,
        bYears: side(true)?.years ?? 0,
      };
    }),
  );
};

const crudeOf = (cells: readonly Cell[]): number | null => {
  const before = sumOf(cells, true, "events") / sumOf(cells, true, "years");
  const after = sumOf(cells, false, "events") / sumOf(cells, false, "years");
  return before > 0 && Number.isFinite(after) ? after / before : null;
};

const withinPerson = (
  people: readonly Person[],
  subjects: ReadonlyMap<string, OracleSubject>,
  spec: TimingSpec,
  idPrefix: string,
  labelPrefix: string,
): Comparison[] => {
  const pieces = people.flatMap((person) => {
    const subject = subjects.get(person.id);
    const rows = personPieces(person, spec);
    return subject === undefined || rows === null
      ? []
      : rows.map((piece) => ({ subject, piece }));
  });
  const expectedUnder = (options: OracleOptions, afterOnly = false) =>
    pieces.map(({ subject, piece }) =>
      afterOnly && piece.window === BEFORE
        ? 0
        : expectedStrokes(subject, piece.from, piece.to, options),
    );
  const scenarios = {
    observed: pieces.map(({ piece }) => (piece.event ? 1 : 0)),
    expected: expectedUnder(MAIN),
    noAfEffect: expectedUnder(OFF),
    recordedOnsets: expectedUnder(RECORDED),
    treatedBp: expectedUnder(TREATED),
    afterOn: expectedUnder(ON, true),
    afterOff: expectedUnder(OFF, true),
  };

  const labels = windowLabels(spec.afterWindowsYears);
  const windows: readonly (string | null)[] = [
    null,
    ...(labels.length > 1 ? labels : []),
  ];

  return windows.flatMap((window): Comparison[] => {
    const take = (piece: Piece) =>
      window === null || piece.window === BEFORE || piece.window === window;
    const cells = (values: readonly number[]) =>
      cellsOf(
        pieces.flatMap(({ piece }, i) =>
          take(piece) ? [{ piece, events: values[i] as number }] : [],
        ),
      );
    const observed = cells(scenarios.observed);
    const expectedCells = cells(scenarios.expected);
    const recovered = ageAdjusted(observed);
    const adjusted = (values: readonly number[]) =>
      ageAdjusted(cells(values))?.ratio ?? null;
    const expected = adjusted(scenarios.expected);
    const off = sumOf(cells(scenarios.afterOff), false, "events");
    const name = window ?? "all after";
    const id = `${idPrefix}-${window === null ? "after" : window.replace(/ /g, "")}`;
    const ageAdjustedRow: Comparison = {
      id,
      label: `${labelPrefix}, ${name}, age-adjusted`,
      recovered,
      expected,
      planted: off > 0 ? sumOf(cells(scenarios.afterOn), false, "events") / off : null,
      noAfEffect: adjusted(scenarios.noAfEffect),
      expectedRecordedOnsets: adjusted(scenarios.recordedOnsets),
      expectedTreatedBp: adjusted(scenarios.treatedBp),
      withinTolerance: withinInterval(recovered, expected),
      recoveredOverExpected: overExpected(recovered, expected),
      checks: [true, false].map((before) => ({
        side: before ? "before onset" : "after onset",
        ...observedOverExpected(
          sumOf(observed, before, "events"),
          sumOf(expectedCells, before, "events"),
        ),
      })),
    };
    if (window !== null) return [ageAdjustedRow];
    const recoveredCrude = exactRateRatio(
      rateOf(sumOf(observed, false, "events"), sumOf(observed, false, "years")),
      rateOf(sumOf(observed, true, "events"), sumOf(observed, true, "years")),
    );
    const crudeExpected = crudeOf(expectedCells);
    return [
      ageAdjustedRow,
      {
        id: `${idPrefix}-crude`,
        label: `${labelPrefix}, all after, crude`,
        recovered: recoveredCrude,
        expected: crudeExpected,
        planted: ageAdjustedRow.planted,
        noAfEffect: crudeOf(cells(scenarios.noAfEffect)),
        expectedRecordedOnsets: crudeOf(cells(scenarios.recordedOnsets)),
        expectedTreatedBp: crudeOf(cells(scenarios.treatedBp)),
        withinTolerance: withinInterval(recoveredCrude, crudeExpected),
        recoveredOverExpected: overExpected(recoveredCrude, crudeExpected),
        checks: [],
      },
    ];
  });
};

// ---- Self-controlled case series --------------------------------------------

const caseSeries = (
  people: readonly Person[],
  subjects: ReadonlyMap<string, OracleSubject>,
  spec: TimingSpec,
  id: string,
  label: string,
): Comparison => {
  const known = people.filter((person) => subjects.has(person.id));
  const fit = (options: OracleOptions | null): RateRatio =>
    selfControlledCaseSeries(
      known,
      spec,
      options === null
        ? undefined
        : (person, pieces) =>
            pieces.map((piece) =>
              expectedStrokes(
                subjects.get(person.id) as OracleSubject,
                piece.from,
                piece.to,
                options,
              ),
            ),
    ).windows[0]?.ratio ?? null;
  const recovered = fit(null);
  const expected = fit(MAIN)?.ratio ?? null;
  return {
    id,
    label,
    recovered,
    expected,
    planted: null,
    noAfEffect: fit(OFF)?.ratio ?? null,
    expectedRecordedOnsets: fit(RECORDED)?.ratio ?? null,
    expectedTreatedBp: fit(TREATED)?.ratio ?? null,
    withinTolerance: withinInterval(recovered, expected),
    recoveredOverExpected: overExpected(recovered, expected),
    checks: [],
  };
};

// ---- Between-person matched cohort ------------------------------------------

const matched = (
  people: readonly Person[],
  subjects: ReadonlyMap<string, OracleSubject>,
  options: OracleStudyOptions,
  rule: Readonly<{ id: string; label: string; minAge?: number }>,
): Comparison => {
  const minAge = rule.minAge;
  const { exposed, controls } = matchedFollowUp(
    people,
    {
      exposure: "af",
      outcome: "stroke",
      controlsPerExposed: options.controlsPerExposed,
      ...(minAge === undefined
        ? {}
        : {
            keepExposed: (person: Person) =>
              ageYears(person, person.onset.af ?? person.end) >= minAge,
          }),
    },
    randomFor(options.seed, `rule:${rule.id}`),
  );
  const years = (rows: readonly Follow[]) =>
    rows.reduce((t, row) => t + row.days, 0) / DAYS_PER_YEAR;
  const events = (rows: readonly Follow[]) => rows.filter((row) => row.event).length;
  const expectedOf = (rows: readonly Follow[], scenario: OracleOptions) =>
    rows.reduce((t, row) => {
      const subject = subjects.get(row.person.id);
      return subject === undefined
        ? t
        : t + expectedStrokes(subject, row.from, row.to, scenario);
    }, 0);
  const recovered = rateRatio(
    rateOf(events(exposed), years(exposed)),
    rateOf(events(controls), years(controls)),
  );
  const ratioOf = (scenario: OracleOptions) => {
    const control = expectedOf(controls, scenario) / years(controls);
    return control > 0 ? expectedOf(exposed, scenario) / years(exposed) / control : null;
  };
  const expectedExposed = expectedOf(exposed, MAIN);
  const expectedControls = expectedOf(controls, MAIN);
  const expected =
    expectedControls > 0
      ? expectedExposed / years(exposed) / (expectedControls / years(controls))
      : null;
  const exposedOff = expectedOf(exposed, OFF);
  return {
    id: rule.id,
    label: rule.label,
    recovered,
    expected,
    planted: exposedOff > 0 ? expectedOf(exposed, ON) / exposedOff : null,
    noAfEffect: ratioOf(OFF),
    expectedRecordedOnsets: ratioOf(RECORDED),
    expectedTreatedBp: ratioOf(TREATED),
    withinTolerance: withinInterval(recovered, expected),
    recoveredOverExpected: overExpected(recovered, expected),
    checks: [
      { side: "AF (exposed)", ...observedOverExpected(events(exposed), expectedExposed) },
      {
        side: "matched controls",
        ...observedOverExpected(events(controls), expectedControls),
      },
    ],
  };
};

// ---- The study --------------------------------------------------------------

export const runOracleStudy = (
  rows: readonly OraclePerson[],
  options: OracleStudyOptions,
): OracleStudy => {
  const people = rows.map((row) => toPerson(row, options.endDay, options.historyYears));
  const subjects = new Map<string, OracleSubject>(
    rows.flatMap((row) =>
      row.sex === null
        ? []
        : [[row.id, oracleSubject(row.oracle, { ...row, sex: row.sex })] as const],
    ),
  );

  const overall = specFor(0, [0]);
  const before = people.flatMap((person) => {
    const subject = subjects.get(person.id);
    const pieces = personPieces(person, overall);
    return subject === undefined || pieces === null
      ? []
      : pieces
          .filter((piece) => piece.window === BEFORE)
          .map((piece) => ({ subject, piece }));
  });
  const beforeDays = before.reduce((t, { piece }) => t + piece.days, 0);
  const afOnDays = before.reduce(
    (t, { subject, piece }) => t + expectedAfDays(subject, piece.from, piece.to),
    0,
  );

  return {
    options,
    subjects: subjects.size,
    withoutBp: rows.filter((row) => row.oracle.systolic.length === 0).length,
    afOnShareBefore: beforeDays > 0 ? afOnDays / beforeDays : null,
    comparisons: [
      matched(people, subjects, options, { id: "af-stroke", label: "AF then stroke" }),
      matched(people, subjects, options, {
        id: "af-stroke-55",
        label: "AF from age 55 then stroke",
        minAge: 55,
      }),
      ...withinPerson(
        people,
        subjects,
        specFor(0, [0, 2, 5]),
        "within",
        "Within-person, all ages",
      ),
      ...withinPerson(
        people,
        subjects,
        specFor(55, [0]),
        "within-55",
        "Within-person, from 55",
      ),
      caseSeries(people, subjects, specFor(0, [0]), "sccs", "Case series, all ages"),
      caseSeries(people, subjects, specFor(55, [0]), "sccs-55", "Case series, from 55"),
    ],
  };
};
