import { type BeatLabel } from "@/packages/rhythm-sim/ectopic-beats";

/**
 * The heart chambers' beat as functions of a beat clock, so the timing is
 * testable without a renderer or a real clock (#53). Beat times are ventricular
 * beats, as in packages/rhythm-sim: the atria contract an AV delay before each
 * one, the ventricles at it. Every duration and amplitude here is illustrative,
 * picked to read well on screen, not measured: the viewer says so while it beats.
 */

/** Atrial onset to ventricular onset, seconds (illustrative; textbook PR is 120–200 ms). */
export const AV_DELAY_S = 0.16;
/** Atrial contraction at a 1 s beat interval, seconds (illustrative). */
export const ATRIAL_S = 0.11;
/** Ventricular contraction and relaxation at a 1 s beat interval, seconds (illustrative). */
export const VENTRICULAR_S = 0.32;
/** Share of the ventricular curve spent contracting; the rest relaxes. */
export const VENTRICULAR_PEAK = 0.4;
/** In atrial fibrillation the atria quiver instead of contracting: this share of a contraction, at this rate. */
export const AF_QUIVER = 0.2;
export const AF_QUIVER_HZ = 6;
/** Time constant with which the beat rate follows a new heart rate, seconds. */
export const RATE_EASE_S = 1.5;
/** A frame longer than this (a hidden tab) advances the clock by this much only. */
export const MAX_STEP_S = 0.25;

/**
 * The beat intervals to play, looped. `rr` is relative to the sinus interval
 * (1 = one beat at the heart rate shown), so the shown rate sets the speed and
 * the pattern sets the variation. `labels[i]` is the beat that starts interval i.
 */
export type BeatPattern = Readonly<{
  rr: readonly number[];
  labels: readonly BeatLabel[];
  /** Interval to start on, e.g. the first beat of an AF episode. */
  start: number;
}>;

/** Personal data: wearables give a rate, not beat times, so the beats are regular. */
export const REGULAR_PATTERN: BeatPattern = { rr: [1], labels: ["sinus"], start: 0 };

/**
 * A pattern from a simulated recording's intervals. rhythm-sim labels the beat
 * that ends each interval; here a label belongs to the beat that starts it.
 * Starts on the first AF beat when there is one, so AF shows without waiting.
 */
export const patternFromRecording = (
  rrMs: readonly number[],
  labels: readonly BeatLabel[],
  sinusRrMs: number,
): BeatPattern => {
  if (rrMs.length === 0 || !(sinusRrMs > 0)) return REGULAR_PATTERN;
  const first: BeatLabel = labels[0] === "af" ? "af" : "sinus";
  const starts = rrMs.map((_, index) => (index === 0 ? first : labels[index - 1]!));
  const af = starts.indexOf("af");
  return {
    rr: rrMs.map((rr) => rr / sinusRrMs),
    labels: starts,
    start: af < 0 ? 0 : af,
  };
};

export type BeatClock = Readonly<{
  /** Interval being played, counted from the pattern's start; wraps by modulo. */
  index: number;
  /** Seconds since this interval's ventricular beat. */
  elapsed: number;
  /** The rate being played now, easing towards the shown heart rate. */
  bpm: number;
  /** Seconds since the clock started, for the AF quiver. */
  time: number;
}>;

export const startClock = (bpm: number, pattern: BeatPattern): BeatClock => ({
  index: pattern.start,
  elapsed: 0,
  bpm,
  time: 0,
});

const at = <T>(items: readonly T[], index: number): T =>
  items[((index % items.length) + items.length) % items.length]!;

/** Seconds from interval `index`'s beat to the next one, at `bpm`. */
export const intervalSec = (pattern: BeatPattern, index: number, bpm: number): number =>
  (at(pattern.rr, index) * 60) / bpm;

/**
 * The clock `dt` seconds later. The rate eases towards `targetBpm`, so a new
 * heart rate speeds or slows the cycle smoothly instead of jumping.
 */
export const advanceClock = (
  clock: BeatClock,
  dtSec: number,
  targetBpm: number,
  pattern: BeatPattern,
): BeatClock => {
  const dt = Math.min(MAX_STEP_S, Math.max(0, dtSec));
  const bpm = clock.bpm + (targetBpm - clock.bpm) * (1 - Math.exp(-dt / RATE_EASE_S));
  const step = (index: number, elapsed: number): BeatClock => {
    const interval = intervalSec(pattern, index, bpm);
    return elapsed >= interval
      ? step(index + 1, elapsed - interval)
      : { index, elapsed, bpm, time: clock.time + dt };
  };
  return step(clock.index, clock.elapsed + dt);
};

/**
 * 0 → 1 → 0 over `x` in [0, 1], peaking at `peak`, with zero slope at both
 * ends and at the peak; 0 outside.
 */
export const contractionCurve = (x: number, peak = 0.5): number => {
  if (!(x > 0 && x < 1)) return 0;
  return x < peak
    ? Math.sin((Math.PI / 2) * (x / peak)) ** 2
    : Math.cos((Math.PI / 2) * ((x - peak) / (1 - peak))) ** 2;
};

/** Contractions shorten at faster rates, about with the square root of the interval. */
const durationScale = (intervalS: number): number =>
  Math.min(1.2, Math.max(0.5, Math.sqrt(intervalS)));

export type ChamberContraction = Readonly<{
  /** 0 (at rest) .. 1 (fully contracted, illustrative amplitude). */
  atria: number;
  ventricles: number;
}>;

/**
 * How contracted the atria and ventricles are at this clock. Ventricles follow
 * the current beat. Atria contract `AV_DELAY_S` before the next beat, unless
 * that beat is ventricular ectopy (no atrial beat leads it) or AF, where the
 * atria only quiver.
 */
export const chamberContraction = (
  clock: BeatClock,
  pattern: BeatPattern,
): ChamberContraction => {
  const interval = intervalSec(pattern, clock.index, clock.bpm);
  const scale = durationScale(interval);
  const ventricles = contractionCurve(
    clock.elapsed / (VENTRICULAR_S * scale),
    VENTRICULAR_PEAK,
  );
  const next = at(pattern.labels, clock.index + 1);
  const now = at(pattern.labels, clock.index);
  const atrialStart = interval - AV_DELAY_S;
  const atria =
    now === "af" || next === "af"
      ? AF_QUIVER * (0.5 + 0.5 * Math.sin(2 * Math.PI * AF_QUIVER_HZ * clock.time))
      : next === "pvc"
        ? 0
        : contractionCurve((clock.elapsed - atrialStart) / (ATRIAL_S * scale));
  return { atria, ventricles };
};

/** What the atria are doing now, for the line beside the view. */
export const rhythmNow = (clock: BeatClock, pattern: BeatPattern): "af" | "sinus" =>
  at(pattern.labels, clock.index) === "af" ? "af" : "sinus";
