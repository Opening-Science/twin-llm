import { describe, expect, test } from "bun:test";

import {
  conditionEffects,
  NO_EFFECTS,
  type SubjectCondition,
  syntheaConditionsOf,
} from "./conditions";
import { windowDays } from "./series";

const KEY = "4242:subject-0001";
const ONSET = "2026-08-15";

const of = (kind: SubjectCondition["kind"], abatement: string | null = null) => [
  { kind, onset: ONSET, abatement },
];

const conditionEntry = (code: string, onset: string, abatement?: string) => ({
  resource: {
    resourceType: "Condition",
    code: { coding: [{ system: "http://snomed.info/sct", code, display: "x" }] },
    onsetDateTime: onset,
    ...(abatement === undefined ? {} : { abatementDateTime: abatement }),
  },
});

describe("syntheaConditionsOf", () => {
  test("reads the conditions with an effect, their onset and abatement days", () => {
    const bundle = {
      resourceType: "Bundle",
      entry: [
        { resource: { resourceType: "Patient", id: "p" } },
        conditionEntry("49436004", "2019-03-04T10:22:33+00:00"),
        conditionEntry("59621000", "2010-01-01T00:00:00+00:00"),
        conditionEntry("230690007", "2020-05-01T08:00:00Z", "2020-05-09T08:00:00Z"),
        conditionEntry("84114007", "2021-01-01T00:00:00Z"),
        conditionEntry("73430006", "2022-02-02T00:00:00Z"),
        { resource: { resourceType: "Condition", code: { coding: [] } } },
      ],
    };
    expect(syntheaConditionsOf(bundle)).toEqual([
      { kind: "atrial_fibrillation", onset: "2019-03-04", abatement: null },
      { kind: "stroke", onset: "2020-05-01", abatement: "2020-05-09" },
      { kind: "heart_failure", onset: "2021-01-01", abatement: null },
      { kind: "sleep_apnea", onset: "2022-02-02", abatement: null },
    ]);
  });

  test("gives nothing for a bundle without conditions or a bad value", () => {
    expect(syntheaConditionsOf({ resourceType: "Bundle", entry: [] })).toEqual([]);
    expect(syntheaConditionsOf(null)).toEqual([]);
    expect(
      syntheaConditionsOf({ entry: [conditionEntry("49436004", "not a date")] }),
    ).toEqual([]);
  });
});

describe("conditionEffects", () => {
  test("no condition has no effect", () => {
    expect(conditionEffects([], "2026-09-01", KEY)).toEqual(NO_EFFECTS);
  });

  test("every effect starts on the onset day, not before", () => {
    for (const kind of [
      "atrial_fibrillation",
      "heart_failure",
      "stroke",
      "sleep_apnea",
    ] as const) {
      expect(conditionEffects(of(kind), "2026-08-14", KEY)).toEqual(NO_EFFECTS);
      expect(conditionEffects(of(kind), ONSET, KEY)).not.toEqual(NO_EFFECTS);
    }
  });

  test("heart failure raises resting HR and lowers RMSSD and steps by the stated ranges", () => {
    const effects = conditionEffects(of("heart_failure"), "2026-09-01", KEY);
    expect(effects.restingHrDelta).toBeGreaterThanOrEqual(5);
    expect(effects.restingHrDelta).toBeLessThan(10);
    expect(effects.hrvFactor).toBeGreaterThanOrEqual(0.7);
    expect(effects.hrvFactor).toBeLessThan(0.8);
    expect(effects.stepsFactor).toBeGreaterThanOrEqual(0.6);
    expect(effects.stepsFactor).toBeLessThan(0.7);
    // The same subject keeps the same effect from day to day.
    expect(conditionEffects(of("heart_failure"), "2026-09-20", KEY)).toEqual(effects);
  });

  test("an abated condition stops on its abatement day, a stroke does not", () => {
    expect(
      conditionEffects(of("heart_failure", "2026-09-01"), "2026-09-01", KEY),
    ).toEqual(NO_EFFECTS);
    expect(
      conditionEffects(of("stroke", "2026-08-20"), "2026-09-01", KEY).stepsFactor,
    ).toBeLessThan(1);
  });

  test("a stroke drops steps sharply, then recovers in part over about 90 days", () => {
    const factor = (day: string) => conditionEffects(of("stroke"), day, KEY).stepsFactor;
    expect(factor(ONSET)).toBeCloseTo(0.4, 5);
    expect(factor("2026-09-14")).toBeGreaterThan(factor(ONSET));
    expect(factor("2026-11-13")).toBeGreaterThan(0.75);
    expect(factor("2026-11-13")).toBeLessThan(0.8);
    expect(conditionEffects(of("stroke"), ONSET, KEY).sleepScoreDelta).toBeCloseTo(
      -12,
      5,
    );
  });

  test("sleep apnea gives nightly SpO2 dips and a slightly higher breathing rate", () => {
    const days = windowDays("2026-10-01", 40).map((day) =>
      conditionEffects(of("sleep_apnea"), day, KEY),
    );
    for (const effects of days) {
      expect(effects.spo2?.mean).toBeGreaterThanOrEqual(92.5);
      expect(effects.spo2?.mean).toBeLessThanOrEqual(95);
      expect(effects.spo2?.min).toBeGreaterThanOrEqual(80);
      expect(effects.spo2?.min).toBeLessThanOrEqual(88);
      expect(effects.respirationDelta).toBeGreaterThanOrEqual(0.5);
      expect(effects.respirationDelta).toBeLessThan(1);
    }
  });

  test("atrial fibrillation has episodes with faster rate, inflated RMSSD and notifications", () => {
    const days = windowDays("2026-12-31", 120)
      .filter((day) => day >= ONSET)
      .map((day) => conditionEffects(of("atrial_fibrillation"), day, KEY));
    const episodes = days.filter((effects) => (effects.afBurden ?? 0) > 0);
    const quiet = days.filter((effects) => effects.afBurden === 0);
    expect(episodes.length).toBeGreaterThan(5);
    expect(quiet.length).toBeGreaterThan(episodes.length);
    for (const effects of episodes) {
      expect(effects.heartRateDelta).toBeGreaterThanOrEqual(10);
      expect(effects.heartRateDelta).toBeLessThan(20);
      expect(effects.irregularHrvFactor).toBeCloseTo(1 + 2 * (effects.afBurden ?? 0), 5);
    }
    for (const effects of quiet) {
      expect(effects).toEqual({
        ...NO_EFFECTS,
        afBurden: 0,
        irregularRhythmNotifications: 0,
      });
    }
    expect(
      episodes.some((effects) => (effects.irregularRhythmNotifications ?? 0) > 0),
    ).toBe(true);
  });

  test("conditions add up, and the key makes them a subject's own", () => {
    const both = [...of("heart_failure"), ...of("stroke")];
    const day = "2026-09-01";
    const effects = conditionEffects(both, day, KEY);
    expect(effects.stepsFactor).toBeCloseTo(
      conditionEffects(of("heart_failure"), day, KEY).stepsFactor *
        conditionEffects(of("stroke"), day, KEY).stepsFactor,
      10,
    );
    expect(conditionEffects(both, day, KEY)).toEqual(effects);
    expect(conditionEffects(both, day, "other")).not.toEqual(effects);
  });
});
