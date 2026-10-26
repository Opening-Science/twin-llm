/**
 * A typical cardiac cycle as pure functions of the cycle phase and the beat
 * interval, so the schematic heart is testable without a clock. It is a
 * textbook sequence, not a model of anyone's heart: the atria contract, then
 * the ventricles, then everything relaxes and fills.
 *
 * Timing. A cycle starts at atrial systole. At 60 bpm atrial systole is 15% of
 * the cycle and ventricular systole the next 35%. Both shorten with the square
 * root of the interval (Bazett's scaling), so at a faster rate systole takes
 * less time but a larger share of the cycle, and diastole shrinks most, as in
 * a real heart. Systole never takes more than 90% of the cycle.
 *
 * Valves. The AV valves (tricuspid, mitral) are open in diastole and atrial
 * systole and shut for the whole of ventricular systole. The semilunar valves
 * (pulmonary, aortic) open after isovolumic contraction and shut at the end
 * of ventricular systole. The AV valves open again after isovolumic relaxation.
 */

/** Shares of a 1 s cycle (60 bpm). */
export const ATRIAL_SHARE_AT_60 = 0.15;
export const VENTRICULAR_SHARE_AT_60 = 0.35;
/** Systole (atrial + ventricular) never takes more of the cycle than this. */
export const MAX_SYSTOLE_SHARE = 0.9;
/** Isovolumic contraction, as a share of ventricular systole. */
export const ISOVOLUMIC_CONTRACTION = 0.15;
/** Isovolumic relaxation, as a share of diastole. */
export const ISOVOLUMIC_RELAXATION = 0.12;
/** Fraction of the cycle a valve takes to swing fully open or shut. */
const SWING = 0.025;

export type CardiacTiming = Readonly<{
  /** Beat interval, seconds. */
  interval: number;
  /** End of atrial systole, as a cycle share (it starts at 0). */
  atrialEnd: number;
  /** End of ventricular systole, as a cycle share (it starts at `atrialEnd`). */
  ventricularEnd: number;
}>;

/** When each phase starts and ends for one beat of `interval` seconds. */
export const cardiacTiming = (interval: number): CardiacTiming => {
  const scale = Math.sqrt(interval);
  const atrial = (ATRIAL_SHARE_AT_60 * scale) / interval;
  const ventricular = (VENTRICULAR_SHARE_AT_60 * scale) / interval;
  const fit = Math.min(1, MAX_SYSTOLE_SHARE / (atrial + ventricular));
  return {
    interval,
    atrialEnd: atrial * fit,
    ventricularEnd: (atrial + ventricular) * fit,
  };
};

export type CardiacPhase = "atrialSystole" | "ventricularSystole" | "diastole";

/** 0 (relaxed) .. 1 (fully contracted) for the chambers; 0 (shut) .. 1 (open) for the valves. */
export type CardiacState = Readonly<{
  phase: CardiacPhase;
  atria: number;
  ventricles: number;
  /** Tricuspid and mitral. */
  av: number;
  /** Pulmonary and aortic. */
  semilunar: number;
}>;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
/** 0 → 1 → 0 over [0, 1], smooth at both ends. */
const hump = (x: number): number => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x) ** 2);

/** Open between `from` and `to` (cycle shares), swinging over `SWING` at each edge. */
const openBetween = (p: number, from: number, to: number): number =>
  Math.min(smooth((p - from) / SWING), smooth((to - p) / SWING));

/** `p` is the share of the cycle, 0..1, wrapped. */
export const cardiacStateAt = (p: number, timing: CardiacTiming): CardiacState => {
  const phase01 = ((p % 1) + 1) % 1;
  const { atrialEnd: a, ventricularEnd: v } = timing;
  const ejectStart = a + ISOVOLUMIC_CONTRACTION * (v - a);
  const avOpens = v + ISOVOLUMIC_RELAXATION * (1 - v);

  const atria = phase01 < a ? hump(phase01 / a) : 0;
  // Ventricles squeeze through systole, hold briefly, then relax in early diastole.
  const ventricles =
    phase01 < a
      ? 0
      : phase01 < v
        ? smooth((phase01 - a) / ((v - a) * 0.8))
        : 1 - smooth((phase01 - v) / (0.3 * (1 - v)));

  // The AV valves stay open across the cycle's wrap (diastole into atrial systole).
  const av = Math.max(
    openBetween(phase01, avOpens, 1 + SWING),
    openBetween(phase01, -SWING, a),
  );
  const semilunar = openBetween(phase01, ejectStart, v);

  return {
    phase:
      phase01 < a ? "atrialSystole" : phase01 < v ? "ventricularSystole" : "diastole",
    atria,
    ventricles,
    av,
    semilunar,
  };
};

/**
 * A number in [-1, 1] for beat `index`, the same every time (a hash, not a
 * random draw), so a replay and a test see the same intervals.
 */
export const beatJitter = (index: number): number => {
  const x = Math.sin(index * 12.9898 + 78.233) * 43_758.5453;
  return 2 * (x - Math.floor(x)) - 1;
};

/** Beat-to-beat change never exceeds this share of the mean interval. */
export const MAX_JITTER_SHARE = 0.2;

/**
 * The interval of beat `index`, seconds, at `bpm`. With a measured HRV
 * (RMSSD, ms) the intervals vary so that successive differences have about
 * that root mean square: independent uniform intervals of half-width
 * √1.5 × RMSSD do. Without HRV every beat is the same length; nothing is
 * made up.
 */
export const beatInterval = (
  index: number,
  bpm: number,
  rmssdMs: number | null,
): number => {
  const mean = 60 / bpm;
  if (rmssdMs === null || !(rmssdMs > 0)) return mean;
  const half = Math.min(Math.sqrt(1.5) * (rmssdMs / 1000), MAX_JITTER_SHARE * mean);
  return mean + half * beatJitter(index);
};

export type BeatClock = Readonly<{ beat: number; phase: number }>;

export const BEAT_CLOCK_START: BeatClock = { beat: 0, phase: 0 };

/**
 * Moves the clock on by `dt` seconds. The phase advances at the current
 * beat's own rate, so a change of `bpm` speeds the cycle up from where it is
 * instead of jumping. A long `dt` (a tab back from the background) runs at
 * most one beat on.
 */
export const advanceBeat = (
  clock: BeatClock,
  dt: number,
  bpm: number,
  rmssdMs: number | null,
): BeatClock => {
  const step = Math.max(0, dt) / beatInterval(clock.beat, bpm, rmssdMs);
  const phase = clock.phase + Math.min(step, 1);
  return phase >= 1
    ? { beat: clock.beat + 1, phase: phase - Math.floor(phase) }
    : { beat: clock.beat, phase };
};
