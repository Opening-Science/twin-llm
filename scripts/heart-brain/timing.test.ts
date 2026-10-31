import { describe, expect, test } from "bun:test";

import { person } from "../../packages/query-tools/event-rates/fixtures.test-helpers";
import { permutationShare, runTiming, specFor } from "./timing";

describe("permutationShare", () => {
  test("counts shuffles at or above the observed value, plus one", () => {
    expect(permutationShare(2, [1, 2, 3, null])).toBeCloseTo(3 / 4, 12);
    expect(permutationShare(5, [1, 2, 3])).toBeCloseTo(1 / 4, 12);
    expect(permutationShare(null, [1])).toBeNull();
    expect(permutationShare(1, [null])).toBeNull();
  });
});

describe("specFor", () => {
  test("AF against stroke with 5-year age bands", () => {
    expect(specFor(55, [0, 2])).toEqual({
      exposure: "af",
      outcome: "stroke",
      minAgeYears: 55,
      afterWindowsYears: [0, 2],
      ageBandYears: 5,
    });
  });
});

describe("runTiming", () => {
  test("gives an arm from all ages and one from 55, with the shuffles counted", () => {
    const people = [
      ...Array.from({ length: 6 }, (_, i) =>
        person(`b${i}`, {
          birth: "1950-01-01",
          observedFrom: "2016-01-01",
          onset: { af: "2021-01-01", stroke: "2018-06-01" },
        }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        person(`a${i}`, {
          birth: "1950-01-01",
          observedFrom: "2016-01-01",
          onset: { af: "2021-01-01", stroke: "2023-06-01" },
        }),
      ),
      person("x", { observedFrom: "2016-01-01" }),
    ];
    const study = runTiming(people, { seed: 1, permutations: 5 });
    expect(study.arms.map((arm) => arm.minAgeYears)).toEqual([0, 55]);
    const [all] = study.arms;
    expect(all?.withinPerson.people).toBe(18);
    expect(all?.sccsOverall.cases).toBe(18);
    expect(all?.sccsWindows.windows.map((w) => w.window)).toEqual([
      "0-2 y",
      "2-5 y",
      "5+ y",
    ]);
    expect(all?.shuffled.withinCrude?.runs).toBeGreaterThan(0);
    expect(runTiming(people, { seed: 1, permutations: 5 })).toEqual(study);
  });
});
