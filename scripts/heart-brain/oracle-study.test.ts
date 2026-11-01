import { describe, expect, test } from "bun:test";

import { toPerson } from "./to-person";
import { type OraclePerson } from "./oracle-facts";
import {
  observedOverExpected,
  overExpected,
  runOracleStudy,
  scenariosFor,
  withinInterval,
} from "./oracle-study";
import { specFor } from "./timing";
import {
  timingResult,
  timingTable,
} from "../../packages/query-tools/event-rates/within-person";

const visits = Array.from({ length: 10 }, (_, i) => `${2016 + i}-01-01`);

/** A man born in 1940 with a BP of 140 from 2016 and a wellness visit every New Year. */
const man = (
  id: string,
  onsets: Readonly<{ af?: string; stroke?: string }> = {},
): OraclePerson => ({
  id,
  batch: "001",
  sex: "M",
  birth: "1940-01-01",
  death: null,
  onsets,
  anticoagulantStart: null,
  oracle: { systolic: [["2016-01-01", 140]], smoker: [], wellness: visits },
});

const cohort: OraclePerson[] = [
  ...Array.from({ length: 20 }, (_, i) =>
    man(`af${i}`, {
      af: "2021-07-01",
      ...(i < 3 ? { stroke: "2018-06-01" } : i < 12 ? { stroke: "2023-06-01" } : {}),
    }),
  ),
  ...Array.from({ length: 80 }, (_, i) =>
    man(`no${i}`, i < 10 ? { stroke: "2022-03-01" } : {}),
  ),
];

const options = {
  endDay: "2026-01-01",
  historyYears: 10,
  seed: 250,
  controlsPerExposed: 4,
  afFactor: 1,
};

describe("helpers", () => {
  test("observed over expected with an exact interval", () => {
    const row = observedOverExpected(10, 5);
    expect(row.ratio).toBe(2);
    expect(row.ci?.low).toBeLessThan(2);
    expect(row.ci?.high).toBeGreaterThan(2);
    expect(observedOverExpected(3, 0).ratio).toBeNull();
  });

  test("a recovered ratio over the expected one, and whether it covers it", () => {
    const recovered = { ratio: 3, ci: { low: 2, high: 4.5 } };
    expect(overExpected(recovered, 2)).toEqual({
      ratio: 1.5,
      ci: { low: 1, high: 2.25 },
    });
    expect(withinInterval(recovered, 2.5)).toBe(true);
    expect(withinInterval(recovered, 1.9)).toBe(false);
    expect(withinInterval(null, 2)).toBeNull();
  });
});

describe("runOracleStudy", () => {
  const study = runOracleStudy(cohort, options);
  const row = (id: string) => study.comparisons.find((c) => c.id === id);

  test("the within-person recovered ratio is the one #262's code gives", () => {
    const people = cohort.map((p) => toPerson(p, "2026-01-01", 10));
    const spec = specFor(0, [0, 2, 5]);
    const reference = timingResult(timingTable(people, spec), spec).after.ageAdjusted;
    expect(row("within-after")?.recovered).toEqual(reference);
  });

  test("with identical men, AF switched off leaves no difference between the sides", () => {
    // Exposed and controls share age, BP and calendar time, so the design's
    // estimate with no AF effect is close to 1, and the planted ratio is the
    // calculator's AF step for a man of about 80 with 140 mmHg.
    const between = row("af-stroke");
    expect(between?.noAfEffect).toBeCloseTo(1, 1);
    expect(between?.planted).toBeGreaterThan(1.5);
    expect(between?.expected).toBeCloseTo(between?.planted ?? 0, 1);
  });

  test("before AF is recorded some time already has AF on (the lagged onset)", () => {
    // AF recorded on 2021-07-01; the time between visits before it is partly AF.
    expect(study.afOnShareBefore).toBeGreaterThan(0);
    expect(study.afOnShareBefore).toBeLessThan(0.5);
    const within = row("within-after");
    expect(within?.expected).toBeLessThan(within?.planted ?? 0);
    expect(within?.expectedRecordedOnsets).toBeGreaterThan(within?.expected ?? 0);
  });

  test("every comparison is reported, with checks on both sides where they apply", () => {
    expect(study.comparisons.map((c) => c.id)).toEqual([
      "af-stroke",
      "af-stroke-55",
      "within-after",
      "within-crude",
      "within-0-2y",
      "within-2-5y",
      "within-5+y",
      "within-55-after",
      "within-55-crude",
      "sccs",
      "sccs-55",
    ]);
    expect(row("af-stroke")?.checks.map((c) => c.side)).toEqual([
      "AF (exposed)",
      "matched controls",
    ]);
    expect(study.subjects).toBe(100);
    expect(study.withoutBp).toBe(0);
  });
});

describe("the AF hazard factor (#295 rule change)", () => {
  test("every scenario carries the factor", () => {
    const scenarios = scenariosFor(2);
    expect(Object.values(scenarios).map((o) => o.afFactor)).toEqual([2, 2, 2, 2, 2]);
    expect(scenarios.off.af).toBe("off");
    expect(scenarios.on.af).toBe("on");
  });

  test("doubling the AF hazard doubles the planted ratio and leaves no-AF alone", () => {
    const base = runOracleStudy(cohort, options);
    const doubled = runOracleStudy(cohort, { ...options, afFactor: 2 });
    const pick = (study: typeof base, id: string) =>
      study.comparisons.find((c) => c.id === id);
    expect(pick(doubled, "af-stroke")?.planted).toBeCloseTo(
      2 * (pick(base, "af-stroke")?.planted ?? 0),
      6,
    );
    expect(pick(doubled, "af-stroke")?.noAfEffect).toBeCloseTo(
      pick(base, "af-stroke")?.noAfEffect ?? 0,
      6,
    );
    // Within person the factor also applies to the lagged AF time before the
    // recorded onset, so the expected ratio rises by less than the factor.
    const within = pick(base, "within-after")?.expected ?? 0;
    expect(pick(doubled, "within-after")?.expected).toBeGreaterThan(1.3 * within);
    expect(pick(doubled, "within-after")?.expected).toBeLessThan(2 * within);
    expect(pick(doubled, "within-after")?.recovered).toEqual(
      pick(base, "within-after")?.recovered ?? null,
    );
  });
});
