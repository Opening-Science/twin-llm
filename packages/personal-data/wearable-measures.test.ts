import { describe, expect, test } from "bun:test";

import { isValidUcum } from "@open-twin/fhir-r4";

import { isLoincCode } from "./loinc-code";
import { sleepNights } from "./sleep-nights";
import {
  createUnmappedTally,
  MEASURES,
  measureObservation,
  wholeMinutes,
} from "./wearable-measures";

describe("MEASURES", () => {
  test("every code is a well-formed LOINC and every unit is UCUM", () => {
    const measures = Object.values(MEASURES);
    expect(
      measures.filter((measure) => measure.code !== null && !isLoincCode(measure.code)),
    ).toEqual([]);
    expect(measures.filter((measure) => !isValidUcum(measure.unit))).toEqual([]);
  });

  test("the codes asked for in #178", () => {
    expect(
      [
        MEASURES.heartRate,
        MEASURES.restingHeartRate,
        MEASURES.hrvSdnn,
        MEASURES.steps,
        MEASURES.bodyMass,
        MEASURES.bodyMassIndex,
        MEASURES.oxygenSaturation,
        MEASURES.respiratoryRate,
        MEASURES.sleepDuration,
      ].map((measure) => `${measure.code} ${measure.unit}`),
    ).toEqual([
      "8867-4 /min",
      "40443-4 /min",
      "80404-7 ms",
      "55423-8 {steps}",
      "29463-7 kg",
      "39156-5 kg/m2",
      "59408-5 %",
      "9279-1 /min",
      "93832-4 min",
    ]);
  });
});

describe("measureObservation", () => {
  test("builds a draft in the measure's unit", () => {
    const at = new Date("2026-09-01T00:00:00Z");
    expect(
      measureObservation(MEASURES.hrvRmssd, 41, { at, precision: "day" }, "row 2", "n"),
    ).toEqual({
      codeSystem: null,
      code: null,
      display: "Heart rate variability (RMSSD)",
      value: 41,
      unit: "ms",
      unitUcum: true,
      effectiveAt: at,
      effectivePrecision: "day",
      sourceRef: "row 2",
      note: "n",
    });
  });
});

describe("createUnmappedTally", () => {
  test("counts each where, code and reason once", () => {
    const tally = createUnmappedTally();
    tally.add("A", "x", "is x");
    tally.add("B", "x", "is x");
    tally.add("A", "x", "is x");
    tally.add("A", "y", "is y");
    expect(tally.list()).toEqual([
      { where: "A", code: "x", reason: "is x", count: 2 },
      { where: "B", code: "x", reason: "is x", count: 1 },
      { where: "A", code: "y", reason: "is y", count: 1 },
    ]);
  });
});

describe("wholeMinutes", () => {
  test("rounds seconds to whole minutes", () => {
    expect(wholeMinutes(25_200)).toBe(420);
    expect(wholeMinutes(25_229)).toBe(420);
    expect(wholeMinutes(25_230)).toBe(421);
  });
});

describe("sleepNights", () => {
  const ms = (iso: string) => Date.parse(iso);

  test("sums per wake day and counts overlapping minutes once", () => {
    expect(
      sleepNights([
        {
          night: "2026-09-02",
          startMs: ms("2026-09-01T23:00:00+02:00"),
          endMs: ms("2026-09-02T03:00:00+02:00"),
        },
        // A second device recording 02:00 to 06:30 overlaps one hour.
        {
          night: "2026-09-02",
          startMs: ms("2026-09-02T02:00:00+02:00"),
          endMs: ms("2026-09-02T06:30:00+02:00"),
        },
        {
          night: "2026-09-01",
          startMs: ms("2026-09-01T01:00:00+02:00"),
          endMs: ms("2026-09-01T01:30:00+02:00"),
        },
        // Empty or backwards intervals count for nothing.
        { night: "2026-09-03", startMs: 10, endMs: 5 },
      ]),
    ).toEqual([
      { night: "2026-09-01", minutes: 30 },
      { night: "2026-09-02", minutes: 450 },
    ]);
  });
});
