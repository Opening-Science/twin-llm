import { describe, expect, test } from "bun:test";

import {
  advanceClock,
  AF_QUIVER,
  AV_DELAY_S,
  type BeatPattern,
  chamberContraction,
  contractionCurve,
  intervalSec,
  MAX_STEP_S,
  patternFromRecording,
  REGULAR_PATTERN,
  rhythmNow,
  startClock,
} from "./heart-cycle";

const at = (elapsed: number, bpm = 60, index = 0, time = elapsed) => ({
  index,
  elapsed,
  bpm,
  time,
});

describe("contractionCurve", () => {
  test("rises to 1 at the peak and back to 0, nothing outside", () => {
    expect(contractionCurve(0)).toBe(0);
    expect(contractionCurve(0.5)).toBe(1);
    expect(contractionCurve(0.25)).toBeCloseTo(0.5, 12);
    expect(contractionCurve(0.4, 0.4)).toBe(1);
    expect(contractionCurve(0.7, 0.4)).toBeCloseTo(0.5, 12);
    expect(contractionCurve(1)).toBe(0);
    expect(contractionCurve(-0.1)).toBe(0);
    expect(contractionCurve(1.3)).toBe(0);
  });
});

describe("patternFromRecording", () => {
  test("intervals relative to the sinus interval; a label moves to the beat that starts its interval", () => {
    expect(
      patternFromRecording([1000, 800, 1200], ["sinus", "pvc", "sinus"], 1000),
    ).toEqual({ rr: [1, 0.8, 1.2], labels: ["sinus", "sinus", "pvc"], start: 0 });
  });

  test("starts on the first AF beat", () => {
    expect(
      patternFromRecording([1000, 1000, 600, 700], ["sinus", "af", "af", "sinus"], 1000),
    ).toEqual({ rr: [1, 1, 0.6, 0.7], labels: ["sinus", "sinus", "af", "af"], start: 2 });
  });

  test("an empty recording plays regular beats", () => {
    expect(patternFromRecording([], [], 1000)).toBe(REGULAR_PATTERN);
    expect(patternFromRecording([1000], ["sinus"], 0)).toBe(REGULAR_PATTERN);
  });
});

describe("advanceClock", () => {
  test("a new beat starts every interval at a steady rate", () => {
    const clock = advanceClock(
      startClock(60, REGULAR_PATTERN),
      0.25,
      60,
      REGULAR_PATTERN,
    );
    expect(clock).toEqual({ index: 0, elapsed: 0.25, bpm: 60, time: 0.25 });
    const later = [0.25, 0.25, 0.25].reduce(
      (now, dt) => advanceClock(now, dt, 60, REGULAR_PATTERN),
      clock,
    );
    expect(later.index).toBe(1);
    expect(later.elapsed).toBeCloseTo(0, 12);
  });

  test("a hidden tab's long gap advances by one capped step", () => {
    const clock = advanceClock(startClock(60, REGULAR_PATTERN), 30, 60, REGULAR_PATTERN);
    expect(clock.elapsed).toBe(MAX_STEP_S);
    expect(clock.time).toBe(MAX_STEP_S);
  });

  test("a new rate is reached smoothly, not at once", () => {
    const steps = Array.from({ length: 600 }, () => 1 / 60);
    const trace = steps.reduce<readonly number[]>(
      (rates, dt, step) => {
        const clock = { index: 0, elapsed: 0, bpm: rates.at(-1)!, time: step * dt };
        return [...rates, advanceClock(clock, dt, 120, REGULAR_PATTERN).bpm];
      },
      [60],
    );
    // One frame moves the rate by about 0.7 bpm, then it keeps climbing towards 120.
    expect(trace[1]).toBeCloseTo(60 + 60 * (1 - Math.exp(-1 / 90)), 10);
    expect(trace.every((bpm, i) => i === 0 || bpm > trace[i - 1]!)).toBe(true);
    expect(trace[90]).toBeCloseTo(120 - 60 * Math.exp(-1), 6);
    expect(trace.at(-1)).toBeGreaterThan(119.9);
  });

  test("the pattern's relative intervals set when each beat comes", () => {
    const pattern: BeatPattern = { rr: [1, 0.5], labels: ["sinus", "sinus"], start: 0 };
    expect(intervalSec(pattern, 0, 60)).toBe(1);
    expect(intervalSec(pattern, 1, 60)).toBe(0.5);
    expect(intervalSec(pattern, 3, 120)).toBe(0.25);
    const clock = advanceClock(at(0.9), 0.2, 60, pattern);
    expect(clock.index).toBe(1);
    expect(clock.elapsed).toBeCloseTo(0.1, 12);
  });
});

describe("chamberContraction", () => {
  test("in sinus rhythm the atria contract, then the ventricles one AV delay later", () => {
    // At 60 bpm the atria start at 1 − 0.16 = 0.84 s and peak 0.055 s later.
    expect(chamberContraction(at(0.8), REGULAR_PATTERN)).toEqual({
      atria: 0,
      ventricles: 0,
    });
    expect(chamberContraction(at(0.895), REGULAR_PATTERN)).toEqual({
      atria: 1,
      ventricles: 0,
    });
    // The ventricles start at the beat and peak at 40 % of 0.32 s.
    expect(chamberContraction(at(0), REGULAR_PATTERN)).toEqual({
      atria: 0,
      ventricles: 0,
    });
    expect(chamberContraction(at(0.128), REGULAR_PATTERN)).toEqual({
      atria: 0,
      ventricles: 1,
    });
    expect(chamberContraction(at(0.5), REGULAR_PATTERN)).toEqual({
      atria: 0,
      ventricles: 0,
    });
    expect(AV_DELAY_S).toBe(0.16);
  });

  test("at a faster rate the contractions are shorter", () => {
    // 120 bpm: a 0.5 s interval, durations × √0.5.
    const peak = 0.4 * 0.32 * Math.SQRT1_2;
    expect(chamberContraction(at(peak, 120), REGULAR_PATTERN).ventricles).toBeCloseTo(
      1,
      12,
    );
    expect(
      chamberContraction(at(0.5 * 0.32 * Math.SQRT1_2 + 0.15, 120), REGULAR_PATTERN),
    ).toEqual({ atria: 0, ventricles: 0 });
  });

  test("no atrial beat before a ventricular premature beat", () => {
    const pattern: BeatPattern = { rr: [1, 1], labels: ["sinus", "pvc"], start: 0 };
    expect(chamberContraction(at(0.895), pattern).atria).toBe(0);
    expect(chamberContraction(at(0.895, 60, 1), pattern).atria).toBe(1);
  });

  test("in AF the atria quiver at a fraction of a contraction and never beat", () => {
    const pattern: BeatPattern = { rr: [0.8], labels: ["af"], start: 0 };
    const peaks = Array.from({ length: 200 }, (_, step) => {
      const t = step / 200;
      return chamberContraction(at(t * 0.8, 60, 0, t), pattern).atria;
    });
    expect(Math.max(...peaks)).toBeLessThanOrEqual(AF_QUIVER);
    expect(Math.max(...peaks)).toBeGreaterThan(AF_QUIVER * 0.99);
    expect(
      chamberContraction(at(0.4 * 0.32 * Math.sqrt(0.8)), pattern).ventricles,
    ).toBeCloseTo(1, 12);
    expect(rhythmNow(at(0), pattern)).toBe("af");
    expect(rhythmNow(at(0), REGULAR_PATTERN)).toBe("sinus");
  });
});
