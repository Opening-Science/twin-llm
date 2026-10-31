import { describe, expect, test } from "bun:test";

import { MS_PER_DAY } from "../../packages/query-tools/stats";

import { dayNumber } from "../../packages/query-tools/event-rates/cohort";
import {
  addSums,
  afTiming,
  ALL_TRUE,
  bpPointsAt,
  chanceAt,
  chanceFromPoints,
  dayOfMs,
  emptySums,
  enteredTimes,
  latestOn,
  type MonitorCheck,
  monitorChecks,
  NONE_TRUE,
  personExcess,
  pointsForRisk,
  pointsWithoutBp,
  recordBpPoints,
  recordInputsOn,
  trueChance,
} from "./excess";
import { person } from "../../packages/query-tools/event-rates/fixtures.test-helpers";
import { expectedStrokes, type OracleSubject, oracleSubject } from "./oracle";
import {
  type StrokeInputs,
  strokeChancePerCheck,
  strokeTenYearRisk,
} from "./stroke-calculator";
import { specFor } from "./timing";

const d = dayNumber;
const msOf = (day: string) => d(day) * MS_PER_DAY + 3_600_000;

const man70: StrokeInputs = {
  sex: "M",
  ageYears: 70,
  systolic: 140,
  bpTreated: false,
  smoker: false,
  diabetes: false,
  atrialFibrillation: true,
  coronaryHeartDisease: false,
  leftVentricularHypertrophy: false,
};

/** A monitor check that matches the calculator on `inputs`. */
const checkFor = (at: number, inputs: StrokeInputs): MonitorCheck => {
  const risk = strokeTenYearRisk(inputs);
  return {
    at,
    tenYear: risk < 0 ? null : risk,
    bpControlled: inputs.bpTreated,
    diabetes: inputs.diabetes,
    af: inputs.atrialFibrillation,
    smoker: inputs.smoker,
    hypertension: false,
  };
};

const wake = (at: number, risk: string, flags: Record<string, 0 | 1>) => [
  { state_name: "Tick", entered: at - 1 },
  { state_name: "Risk", entered: at, exited: at },
  { state_name: `R_${risk}`, entered: at, exited: at },
  ...Object.entries(flags).flatMap(([name, value]) => [
    { state_name: `${name}_check`, entered: at, exited: at },
    { state_name: `${name}_${value}`, entered: at, exited: at },
  ]),
];

describe("monitorChecks", () => {
  test("reads each wake's risk bin and flags, oldest first", () => {
    const flags = { bpc: 1, dm: 0, af: 1, smk: 0, htn: 1 } as const;
    const history = [
      ...wake(2000, "0.15", flags),
      ...wake(1000, "neg", { ...flags, af: 0 }),
    ];
    expect(monitorChecks(history)).toEqual([
      {
        at: 1000,
        tenYear: null,
        bpControlled: true,
        diabetes: false,
        af: false,
        smoker: false,
        hypertension: true,
      },
      {
        at: 2000,
        tenYear: 0.15,
        bpControlled: true,
        diabetes: false,
        af: true,
        smoker: false,
        hypertension: true,
      },
    ]);
  });

  test("drops a wake that misses a flag, and ignores other states", () => {
    const partial = wake(1000, "0.1", { bpc: 0, dm: 0, af: 0, smk: 0 });
    expect(monitorChecks([...partial, "junk", { state_name: 3 }])).toEqual([]);
  });

  test("enteredTimes lists a state's entries oldest first", () => {
    const history = [
      { state_name: "Stroke", entered: 30 },
      { state_name: "Chance_of_Stroke", entered: 10 },
      { state_name: "Stroke", entered: 20 },
    ];
    expect(enteredTimes(history, "Stroke")).toEqual([20, 30]);
  });
});

describe("points", () => {
  test("a repeated table value gives every total; the last value is capped", () => {
    expect(pointsForRisk("M", 0.03)).toEqual({ totals: [1, 2], capped: false });
    expect(pointsForRisk("M", 0.88)).toEqual({ totals: [30], capped: true });
    expect(pointsForRisk("F", 0.002)).toEqual({ totals: [], capped: false });
  });

  test("points without BP add smoking, age, diabetes and AF by sex", () => {
    // Man of 70: age points 5 (69 to 73); AF +4, diabetes +2, smoker +3.
    expect(pointsWithoutBp("M", 70, { smoker: true, diabetes: true, af: true })).toBe(14);
    // Woman of 70: age points 5 (68 to 71); AF +6, diabetes +3.
    expect(pointsWithoutBp("F", 70, { smoker: false, diabetes: true, af: true })).toBe(
      14,
    );
  });

  test("BP points come back from the risk, with the table Synthea used", () => {
    const untreated = bpPointsAt("M", 70, checkFor(0, man70));
    expect(untreated).toEqual({
      points: recordBpPoints("M", 140, false),
      ambiguous: false,
    });
    const treated = bpPointsAt("M", 70, checkFor(0, { ...man70, bpTreated: true }));
    expect(treated).toEqual({ points: recordBpPoints("M", 140, true), ambiguous: false });
    expect(recordBpPoints("M", 140, true)).toBeGreaterThan(
      recordBpPoints("M", 140, false),
    );
  });

  test("no BP points under 55 or without a risk; ambiguous on a repeated value", () => {
    expect(bpPointsAt("M", 50, checkFor(0, { ...man70, ageYears: 50 }))).toBeNull();
    expect(bpPointsAt("M", 70, { ...checkFor(0, man70), tenYear: null })).toBeNull();
    // Man of 55, nothing else: 0 age points, so 0.03 fits BP points 1 and 2.
    const low = { ...checkFor(0, man70), af: false, tenYear: 0.03 };
    expect(bpPointsAt("M", 55, low)).toEqual({ points: 1, ambiguous: true });
  });

  test("chanceFromPoints is the calculator's chance for the same total", () => {
    const total = pointsWithoutBp("M", 70, { smoker: false, diabetes: false, af: true });
    expect(chanceFromPoints("M", total + recordBpPoints("M", 140, false))).toBeCloseTo(
      strokeChancePerCheck(man70),
      15,
    );
    expect(chanceFromPoints("M", 99)).toBe(chanceFromPoints("M", 30));
  });
});

/** A man born 1950-01-01, BP 140 from 2016, wellness visits each New Year. */
const subject = (
  onsets: Readonly<{ af?: string; diabetes?: string }> = {},
  systolic: [string, number][] = [["2016-01-01", 140]],
): OracleSubject =>
  oracleSubject(
    {
      systolic,
      smoker: [],
      wellness: ["2018-01-01", "2019-01-01", "2020-01-01", "2021-01-01"],
    },
    { sex: "M", birth: "1950-01-01", onsets },
  );

describe("record inputs", () => {
  test("latestOn takes the latest value at or before the day, else the first", () => {
    const rows = [
      [10, "a"],
      [20, "b"],
    ] as const;
    expect(latestOn(rows, 5)).toBe("a");
    expect(latestOn(rows, 20)).toBe("b");
    expect(latestOn([], 20)).toBeNull();
  });

  test("record inputs hold the oracle's age, BP and started shares", () => {
    const inputs = recordInputsOn(subject({ af: "2020-01-01" }), d("2019-07-02"));
    expect(inputs.ageYears).toBe(69);
    expect(inputs.systolic).toBe(140);
    expect(inputs.smoker).toBe(false);
    expect(inputs.afShare).toBeCloseTo(182 / 365, 12);
    expect(inputs.diabetesShare).toBe(0);
  });

  test("with record inputs only, a check's chance is 30 days of the oracle", () => {
    const s = subject({ af: "2020-01-01" });
    const day = d("2019-07-02");
    const check = checkFor(msOf("2019-07-02"), man70);
    expect(chanceAt("M", recordInputsOn(s, day), check, NONE_TRUE)).toBeCloseTo(
      30 * expectedStrokes(s, day - 1, day),
      15,
    );
  });

  test("with every input from Synthea, a check's chance is the one it drew with", () => {
    // Record says no AF yet and BP 120; Synthea has AF on and BP 140 controlled.
    const s = subject({}, [["2016-01-01", 120]]);
    const truth = { ...man70, ageYears: 69, bpTreated: true };
    const check = checkFor(msOf("2019-07-02"), truth);
    const record = recordInputsOn(s, d("2019-07-02"));
    expect(chanceAt("M", record, check, ALL_TRUE)).toBeCloseTo(trueChance(check), 15);
    expect(chanceAt("M", record, check, ALL_TRUE)).toBeGreaterThan(
      chanceAt("M", record, check, NONE_TRUE),
    );
  });

  test("the table alone reads the recorded BP with the treated table when controlled", () => {
    const s = subject();
    const record = recordInputsOn(s, d("2019-07-02"));
    const controlled = checkFor(msOf("2019-07-02"), {
      ...man70,
      ageYears: 69,
      bpTreated: true,
    });
    const tableOnly = { ...NONE_TRUE, bpTable: true };
    expect(chanceAt("M", record, controlled, tableOnly)).toBeCloseTo(
      strokeChancePerCheck({
        ...man70,
        ageYears: 69,
        atrialFibrillation: false,
        bpTreated: true,
      }),
      15,
    );
    expect(
      chanceAt("M", record, { ...controlled, bpControlled: false }, tableOnly),
    ).toBeCloseTo(chanceAt("M", record, controlled, NONE_TRUE), 15);
  });

  test("trueChance is 0 when the calculator gave -1", () => {
    expect(trueChance({ ...checkFor(0, man70), tenYear: null })).toBe(0);
  });
});

describe("afTiming", () => {
  const visits = [d("2019-01-01"), d("2020-01-01")];
  test("in the oracle's window, before it, or after the recorded day", () => {
    expect(afTiming(d("2019-06-01"), d("2020-01-01"), visits)).toBe("in window");
    expect(afTiming(d("2020-01-01"), d("2020-01-01"), visits)).toBe("in window");
    expect(afTiming(d("2018-06-01"), d("2020-01-01"), visits)).toBe(
      "before previous visit",
    );
    expect(afTiming(d("2020-02-01"), d("2020-01-01"), visits)).toBe(
      "after recorded onset",
    );
  });
});

describe("personExcess", () => {
  test("splits checks at the recorded AF onset and sums both sides", () => {
    const p = person("p", {
      birth: "1950-01-01",
      onset: { af: "2020-01-01", stroke: "2021-01-31" },
      observedFrom: "2016-01-01",
    });
    const s = subject({ af: "2020-01-01" });
    const before = checkFor(msOf("2019-07-02"), { ...man70, ageYears: 69 });
    const after = checkFor(msOf("2021-01-31"), { ...man70, ageYears: 71 });
    const late = checkFor(msOf("2021-03-02"), { ...man70, ageYears: 71 });
    const sides = personExcess(p, s, [before, after, late], specFor(0, [0]));
    expect(sides).not.toBeNull();
    expect(sides?.before.checks).toBe(1);
    expect(sides?.after.checks).toBe(1);
    expect(sides?.after.observed).toBe(1);
    expect(sides?.after.truth).toBeCloseTo(trueChance(after), 15);
    expect(sides?.after.variants.allTrue).toBeCloseTo(trueChance(after), 15);
    expect(sides?.after.oracle).toBeCloseTo(
      expectedStrokes(s, d("2020-01-01"), d("2021-01-31")),
      12,
    );
    expect(sides?.after.afDisagree).toBe(0);
    expect(sides?.before.afDisagree).toBe(1);
  });

  test("no AF onset: no counted time", () => {
    expect(personExcess(person("q"), subject(), [], specFor(0, [0]))).toBeNull();
  });

  test("addSums adds field by field", () => {
    const one = { ...emptySums(), observed: 1, truth: 0.5 };
    const two = addSums(one, one);
    expect(two.observed).toBe(2);
    expect(two.truth).toBe(1);
    expect(two.variants.record).toBe(0);
  });

  test("dayOfMs is the UTC day", () => {
    expect(dayOfMs(msOf("2020-02-29"))).toBe(d("2020-02-29"));
  });
});
