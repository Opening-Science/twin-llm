import { describe, expect, test } from "bun:test";

import { measureKindFor } from "@/infrastructure/format-measure";
import { systemForGroup } from "@/packages/anatomy/hra-groups";

import { VITAL_ANATOMY, VITAL_IDS, vitalForStem } from "./vitals";

/** Stored but not yet known to format-measure (no label, no kind). */
const NOT_IN_FORMAT_MEASURE = new Set(["google.daily-respiratory-rate"]);

describe("vitals table", () => {
  test("every vital has a row and nothing else does", () => {
    expect(Object.keys(VITAL_ANATOMY).sort()).toEqual([...VITAL_IDS].sort());
  });

  test("systems as decided", () => {
    expect(
      Object.fromEntries(VITAL_IDS.map((id) => [id, VITAL_ANATOMY[id].system])),
    ).toEqual({
      heartRate: "cardiovascular",
      rhr: "cardiovascular",
      hrv: "nervous",
      spo2: "respiratory",
      respiration: "respiratory",
      sleep: "nervous",
      strain: "cardiovascular",
      steps: "musculoskeletal",
    });
    expect(VITAL_ANATOMY.hrv.hraGroups).toEqual(["brain"]);
    expect(VITAL_ANATOMY.hrv.secondaryHraGroups).toEqual(["heart"]);
  });

  test("every HRA key is one hra-groups.ts classifies", () => {
    const unknown = VITAL_IDS.flatMap((id) => [
      ...VITAL_ANATOMY[id].hraGroups,
      ...VITAL_ANATOMY[id].secondaryHraGroups,
    ]).filter((key) => systemForGroup(key) === null);
    expect(unknown).toEqual([]);
  });

  test("every source is a stored stem with the kind its vital expects", () => {
    const kinds = Object.fromEntries(
      VITAL_IDS.flatMap((id) =>
        VITAL_ANATOMY[id].sources
          .filter((stem) => !NOT_IN_FORMAT_MEASURE.has(stem))
          .map((stem) => [stem, measureKindFor(stem)]),
      ),
    );
    expect(kinds).toEqual({
      "sleep.hr": "heartRate",
      "whoop.cycle.avg_hr": "heartRate",
      "google.heart-rate": "heartRate",
      "whoop.recovery.rhr": "heartRate",
      "google.daily-resting-heart-rate": "heartRate",
      "sleep.hrv": "hrv",
      "whoop.recovery.hrv": "hrv",
      "google.daily-heart-rate-variability": "hrv",
      "whoop.recovery.spo2": "spo2",
      "google.oxygen-saturation": "spo2",
      "google.daily-oxygen-saturation": "spo2",
      "sleep.score": "score",
      "sleep.duration": "sleepMinutes",
      "sleep.efficiency": "percent",
      "whoop.sleep.performance": "percent",
      "whoop.sleep.efficiency": "percent",
      "whoop.sleep.consistency": "percent",
      "whoop.sleep.in_bed_min": "sleepMinutes",
      "whoop.cycle.strain": "strain",
      "activity.steps": "steps",
      "google.steps": "steps",
    });
  });

  test("a stem feeds at most one vital", () => {
    const stems = VITAL_IDS.flatMap((id) => VITAL_ANATOMY[id].sources);
    expect(new Set(stems).size).toBe(stems.length);
  });

  test("vitalForStem", () => {
    expect(vitalForStem("whoop.recovery.hrv")).toBe("hrv");
    expect(vitalForStem("google.daily-respiratory-rate")).toBe("respiration");
    expect(vitalForStem("readiness.score")).toBeNull();
  });
});
