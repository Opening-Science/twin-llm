import { describe, expect, test } from "bun:test";

import { recordingConfigFor } from "@/packages/query-tools/rhythm-recording";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import { REGULAR_PATTERN } from "./heart-cycle";
import { HEART_RECORDING, HEART_RECORDING_SEC, heartRhythmOf } from "./heart-rhythm";

const SYNTHETIC = {
  kind: "simulated",
  subjectRef: "syn-heart-test",
  day: "2025-03-01",
  afOnDay: false,
} as const;

describe("heartRhythmOf", () => {
  test("measured data beats regularly", () => {
    expect(heartRhythmOf({ kind: "measured" })).toEqual({
      pattern: REGULAR_PATTERN,
      timing: "regular",
    });
  });

  test("a synthetic person plays the rhythm tool's recording for that day", () => {
    const rhythm = heartRhythmOf(SYNTHETIC);
    const recording = simulateRecording(
      recordingConfigFor({
        subjectRef: SYNTHETIC.subjectRef,
        recording: HEART_RECORDING,
        durationSec: HEART_RECORDING_SEC,
        date: SYNTHETIC.day,
        afConditionActive: false,
      }),
    );
    expect(rhythm.timing).toBe("sinus");
    expect(rhythm.pattern.start).toBe(0);
    expect(rhythm.pattern.rr.length).toBe(recording.rrMs.length);
    expect(rhythm.pattern.rr[0]).toBe(
      recording.rrMs[0]! / (60_000 / recording.config.meanHr),
    );
    expect(rhythm.pattern.labels.includes("af")).toBe(false);
    // The same person and day give the same beats on every visit.
    expect(heartRhythmOf(SYNTHETIC)).toEqual(rhythm);
  });

  test("AF in the record that day gives paroxysmal AF, starting on its first AF beat", () => {
    const rhythm = heartRhythmOf({ ...SYNTHETIC, afOnDay: true });
    expect(rhythm.timing).toBe("paroxysmal_af");
    expect(rhythm.pattern.labels[rhythm.pattern.start]).toBe("af");
    expect(rhythm.pattern.labels.slice(0, rhythm.pattern.start).includes("af")).toBe(
      false,
    );
  });
});
