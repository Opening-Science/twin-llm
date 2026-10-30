import { describe, expect, test } from "bun:test";

import { mulberry32 } from "@/infrastructure/seeded-random";

import { PULSE_ARRIVAL_SEC, pulseTemplate, pulseWave } from "./pulse-wave";

describe("pulseTemplate", () => {
  test("0 before the pulse and after 0.8 s", () => {
    expect(pulseTemplate(-0.01)).toBe(0);
    expect(pulseTemplate(0.81)).toBe(0);
  });

  test("systolic peak at 0.1 s: 1 plus the diastolic wave's tail", () => {
    const diastolicTail = 0.35 * Math.exp(-(0.22 ** 2) / (2 * 0.08 ** 2));
    expect(pulseTemplate(0.1)).toBeCloseTo(1 + diastolicTail, 12);
  });
});

describe("pulseWave", () => {
  const input = {
    beatTimesMs: [0, 1000, 2000],
    rrMs: [1000, 1000],
    durationSec: 3,
    meanSinusRrMs: 1000,
    noise: 0,
    motionArtefact: false,
  } as const;

  test("25 Hz: 75 samples for 3 s, no motion", () => {
    const wave = pulseWave(input, mulberry32(1));
    expect(wave.sampleRateHz).toBe(25);
    expect(wave.values.length).toBe(75);
    expect(wave.motion).toBeNull();
  });

  test("without noise, each beat's systolic peak sits 0.3 s after it (arrival 0.2 + 0.1)", () => {
    const wave = pulseWave({ ...input, beatTimesMs: [100, 1100, 2100] }, mulberry32(1));
    // Beat at 0.1 s → peak at 0.4 s, sample 10; the next one 25 samples later.
    const peakSample = Math.round((0.1 + PULSE_ARRIVAL_SEC + 0.1) * 25);
    expect(peakSample).toBe(10);
    expect(wave.values[peakSample]).toBe(Math.round(pulseTemplate(0.1) * 1000) / 1000);
    expect(wave.values[peakSample + 25]).toBe(wave.values[peakSample]);
  });

  test("a beat after a 500 ms interval gets a pulse half as tall", () => {
    const wave = pulseWave(
      { ...input, beatTimesMs: [0, 1000, 1500], rrMs: [1000, 500] },
      mulberry32(1),
    );
    const peak = Math.round((1.5 + PULSE_ARRIVAL_SEC + 0.1) * 25);
    const lone = Math.round(0.5 * pulseTemplate(0.1) * 1000) / 1000;
    // The earlier pulse still adds its diastolic tail at that time.
    expect(wave.values[peak] > lone).toBe(true);
    expect(wave.values[peak] < wave.values[Math.round(0.3 * 25)]).toBe(true);
  });

  test("motion artefact: a 5 s span inside the recording", () => {
    const wave = pulseWave(
      { ...input, durationSec: 30, motionArtefact: true },
      mulberry32(4),
    );
    expect(wave.motion === null).toBe(false);
    const motion = wave.motion ?? { startSec: -1, endSec: -1 };
    expect(motion.endSec - motion.startSec).toBeCloseTo(5, 2);
    expect(motion.startSec >= 0 && motion.endSec <= 30).toBe(true);
  });
});
