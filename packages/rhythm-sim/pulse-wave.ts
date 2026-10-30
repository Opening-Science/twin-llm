/**
 * A pulse-wave (PPG-like) proxy built from beat times: one fixed pulse shape
 * per beat (a systolic peak and a smaller diastolic wave), arriving a fixed
 * delay after the beat, scaled by the interval before it so an early beat gives
 * a smaller pulse, plus Gaussian noise and an optional motion artefact. It is
 * a shape for testing pulse-based methods, not a model of the circulation.
 * Pure.
 */
import { normal, type Random } from "@/infrastructure/seeded-random";

export const PULSE_SAMPLE_RATE_HZ = 25;
/** Delay from a beat to its pulse at the sensor, s (assumption). */
export const PULSE_ARRIVAL_SEC = 0.2;
/** How long one pulse lasts, s; the template is ~0 after this. */
const PULSE_SPAN_SEC = 0.8;
const SYSTOLIC = { at: 0.1, width: 0.05, height: 1 } as const;
const DIASTOLIC = { at: 0.32, width: 0.08, height: 0.35 } as const;
/** Pulse amplitude is clamped to this range of (preceding RR / mean sinus RR). */
const AMPLITUDE_RANGE = { low: 0.4, high: 1.3 } as const;
const MOTION_SEC = 5;
const MOTION_HZ = 1.7;
const MOTION_HEIGHT = 0.6;

const bump = (
  tau: number,
  part: Readonly<{ at: number; width: number; height: number }>,
) => part.height * Math.exp(-((tau - part.at) ** 2) / (2 * part.width ** 2));

/** The pulse shape `tau` seconds after it starts. */
export const pulseTemplate = (tau: number): number =>
  tau < 0 || tau > PULSE_SPAN_SEC ? 0 : bump(tau, SYSTOLIC) + bump(tau, DIASTOLIC);

export type PulseWaveInput = Readonly<{
  beatTimesMs: readonly number[];
  rrMs: readonly number[];
  durationSec: number;
  meanSinusRrMs: number;
  noise: number;
  motionArtefact: boolean;
}>;

export type PulseWave = Readonly<{
  sampleRateHz: number;
  /** Rounded to 3 decimals. */
  values: readonly number[];
  /** The motion artefact's span, s, or null without one. */
  motion: Readonly<{ startSec: number; endSec: number }> | null;
}>;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export const pulseWave = (input: PulseWaveInput, random: Random): PulseWave => {
  const count = Math.floor(input.durationSec * PULSE_SAMPLE_RATE_HZ);
  const pulses = input.beatTimesMs.map((timeMs, index) => {
    // The first beat has no interval before it; it gets a full-size pulse.
    const before = index === 0 ? input.meanSinusRrMs : input.rrMs[index - 1];
    const ratio = before / input.meanSinusRrMs;
    return {
      startSec: timeMs / 1000 + PULSE_ARRIVAL_SEC,
      amplitude: Math.min(AMPLITUDE_RANGE.high, Math.max(AMPLITUDE_RANGE.low, ratio)),
    };
  });
  const motionStart = input.motionArtefact
    ? random() * Math.max(0, input.durationSec - MOTION_SEC)
    : null;
  const motionPhase = 2 * Math.PI * random();
  // Each pulse adds into the samples it spans, so the cost is beats × 20, not beats × samples.
  const signal = Array.from({ length: count }, () => 0);
  for (const pulse of pulses) {
    const first = Math.max(0, Math.ceil(pulse.startSec * PULSE_SAMPLE_RATE_HZ));
    const last = Math.min(
      count - 1,
      Math.floor((pulse.startSec + PULSE_SPAN_SEC) * PULSE_SAMPLE_RATE_HZ),
    );
    for (let sample = first; sample <= last; sample += 1) {
      signal[sample] +=
        pulse.amplitude * pulseTemplate(sample / PULSE_SAMPLE_RATE_HZ - pulse.startSec);
    }
  }
  const values = signal.map((value, sample) => {
    const tSec = sample / PULSE_SAMPLE_RATE_HZ;
    const motion =
      motionStart !== null && tSec >= motionStart && tSec < motionStart + MOTION_SEC
        ? MOTION_HEIGHT * Math.sin(2 * Math.PI * MOTION_HZ * tSec + motionPhase)
        : 0;
    return round3(value + motion + input.noise * normal(random));
  });
  return {
    sampleRateHz: PULSE_SAMPLE_RATE_HZ,
    values,
    motion:
      motionStart === null
        ? null
        : { startSec: round3(motionStart), endSec: round3(motionStart + MOTION_SEC) },
  };
};
