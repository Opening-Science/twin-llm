import { describe, expect, test } from "bun:test";

import { validateFhir } from "@open-twin/fhir-r4";

import {
  intervalIndexAtSamples,
  RHYTHM_SIM_SYSTEM,
  recordingObservation,
} from "./recording-observation";
import { simulateRecording } from "./simulate-recording";

const recording = simulateRecording({
  seed: 3,
  durationSec: 30,
  rhythm: "paroxysmal_af",
  pvcCount: 1,
});
const observation = recordingObservation(recording, {
  subjectReference: "Patient/synthetic-1",
  start: "2026-01-01T08:00:00Z",
  id: "rhythm-1",
});

const numbers = (data: string | undefined): number[] =>
  (data ?? "").split(" ").map((value) => Number(value));

describe("intervalIndexAtSamples", () => {
  test("beats at 0, 300, 700, 1000 ms; samples every 250 ms → intervals 0, 0, 1, 2", () => {
    expect(intervalIndexAtSamples([0, 300, 700, 1000], 250)).toEqual([0, 0, 1, 2]);
  });
});

describe("recordingObservation", () => {
  test("validates as FHIR R4 with only the external-reference note", () => {
    const result = validateFhir(observation);
    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.rule)).toEqual(["ot-reference-external"]);
  });

  test("the RR tachogram is the value: 4 Hz, ms, one dimension", () => {
    expect(observation.code.coding?.[0]).toEqual({
      system: RHYTHM_SIM_SYSTEM,
      code: "rr-tachogram",
      display: "RR interval tachogram, simulated",
    });
    const value = observation.valueSampledData;
    expect(value?.period).toBe(250);
    expect(value?.dimensions).toBe(1);
    expect(value?.origin).toEqual({
      value: 0,
      unit: "ms",
      system: "http://unitsofmeasure.org",
      code: "ms",
    });
    const data = numbers(value?.data);
    expect(data.length).toBe(Math.ceil((recording.beatTimesMs.at(-1) ?? 0) / 250));
    expect(data[0]).toBe(recording.rrMs[0]);
  });

  test("mean heart rate is LOINC 8867-4 in /min, to one decimal", () => {
    expect(observation.component?.[0]).toEqual({
      code: {
        coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
      },
      valueQuantity: {
        value: Math.round(recording.meanHr * 10) / 10,
        unit: "per minute",
        system: "http://unitsofmeasure.org",
        code: "/min",
      },
    });
  });

  test("the pulse-wave proxy is 25 Hz (period 40 ms) with factor 0.001", () => {
    const pulse = observation.component?.[1];
    expect(pulse?.code.coding?.[0]?.code).toBe("pulse-wave-proxy");
    expect(pulse?.valueSampledData?.period).toBe(40);
    expect(pulse?.valueSampledData?.factor).toBe(0.001);
    expect(numbers(pulse?.valueSampledData?.data).length).toBe(750);
  });

  test("ground truth is labelled simulator metadata and holds 0, 1 and 3", () => {
    const truth = observation.component?.[2];
    expect(truth?.code.coding?.[0]?.code).toBe("ground-truth-label");
    expect(truth?.code.coding?.[0]?.display).toContain(
      "simulator metadata, not a finding",
    );
    expect([...new Set(numbers(truth?.valueSampledData?.data))].sort()).toEqual([
      0, 1, 3,
    ]);
  });

  test("tagged as test data from the rhythm simulator, over the recording's 30 s", () => {
    expect(observation.meta?.tag?.map((tag) => tag.code)).toEqual([
      "HTEST",
      "twinllm-rhythm-sim",
    ]);
    expect(observation.effectivePeriod).toEqual({
      start: "2026-01-01T08:00:00.000Z",
      end: "2026-01-01T08:00:30.000Z",
    });
    expect(observation.id).toBe("rhythm-1");
  });
});
