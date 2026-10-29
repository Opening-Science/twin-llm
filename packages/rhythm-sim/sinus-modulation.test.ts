import { describe, expect, test } from "bun:test";

import { mulberry32 } from "@/infrastructure/seeded-random";

import {
  modulationAt,
  modulationComponents,
  modulationSpectrum,
  SPECTRUM_STEP_HZ,
} from "./sinus-modulation";

const PARAMS = { lfHz: 0.1, hfHz: 0.25, peakWidthHz: 0.01, lfHfRatio: 0.5 } as const;

describe("modulationSpectrum", () => {
  test("integrates to 1 over 0–0.5 Hz", () => {
    const total = Array.from({ length: 250 }, (_, i) =>
      modulationSpectrum(PARAMS, (i + 1) * SPECTRUM_STEP_HZ),
    ).reduce((sum, value) => sum + value * SPECTRUM_STEP_HZ, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  test("peak heights at LF and HF are in the LF/HF ratio 0.5", () => {
    expect(
      modulationSpectrum(PARAMS, 0.1) / modulationSpectrum(PARAMS, 0.25),
    ).toBeCloseTo(0.5, 6);
  });
});

describe("modulationComponents", () => {
  const components = modulationComponents(PARAMS, 40, mulberry32(1));

  test("250 sinusoids from 0.002 to 0.5 Hz", () => {
    expect(components.length).toBe(250);
    expect(components[0].frequencyHz).toBe(0.002);
    expect(components.at(-1)?.frequencyHz).toBe(0.5);
  });

  test("their variance (Σ amplitude² / 2) is the requested SD squared, 1600", () => {
    const variance = components.reduce((sum, part) => sum + part.amplitude ** 2 / 2, 0);
    expect(variance).toBeCloseTo(1600, 6);
  });

  test("LF power over HF power is 0.5", () => {
    const power = (from: number, to: number) =>
      components
        .filter((part) => part.frequencyHz >= from && part.frequencyHz <= to)
        .reduce((sum, part) => sum + part.amplitude ** 2 / 2, 0);
    expect(power(0.04, 0.15) / power(0.15, 0.4)).toBeCloseTo(0.5, 3);
  });

  test("an SD of 0 gives a flat modulation", () => {
    expect(modulationAt(modulationComponents(PARAMS, 0, mulberry32(1)), 12.3)).toBe(0);
  });

  test("modulationAt sums the sinusoids: one of amplitude 2 at 0.25 Hz, phase 0, at 1 s → 2", () => {
    expect(modulationAt([{ frequencyHz: 0.25, amplitude: 2, phase: 0 }], 1)).toBeCloseTo(
      2,
      12,
    );
  });
});
