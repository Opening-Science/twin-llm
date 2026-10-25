import { Matrix4, type Vector3 } from "three";

/**
 * How the live twin moves, as functions of time, so the curves are testable
 * without a clock. The motion is a gentle, readable cue at the measured rate,
 * not a model of the heart or the lungs; the viewer says so while it moves.
 */

/** Peak scale change of the heart at a beat, and of the lungs at full breath. */
export const HEART_SCALE = 0.02;
export const LUNG_SCALE = 0.025;
/** Emissive added at the peak of a beat: the HRA heart, and the softer BodyParts3D system. */
export const HEART_GLOW = { hra: 0.5, bodyparts3d: 0.2 } as const;
/** BodyParts3D breathes as a glow: its respiratory mesh includes the nose and airways. */
export const BREATH_GLOW_BODYPARTS3D = 0.15;
/** The steady glow for HRV below this person's usual level. */
export const HRV_GLOW = 0.3;

const bump = (x: number, centre: number, width: number): number =>
  Math.exp(-(((x - centre) / width) ** 2));

/**
 * 0..1 through one heartbeat at `bpm`: a strong first beat and a softer
 * second one, then rest. `t` is seconds.
 */
export const pulseAt = (t: number, bpm: number): number => {
  const period = 60 / bpm;
  const phase = (((t % period) + period) % period) / period;
  return Math.min(1, bump(phase, 0.08, 0.05) + 0.45 * bump(phase, 0.28, 0.05));
};

/** 0 (out) .. 1 (in) through one breath at `perMinute`, a plain cosine. */
export const breathAt = (t: number, perMinute: number): number => {
  const period = 60 / perMinute;
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
};

/**
 * The part's own matrix with a uniform scale about `centre` (its geometry's
 * centre in local space), so an organ swells in place instead of drifting
 * towards the atlas origin.
 */
export const scaleAbout = (original: Matrix4, centre: Vector3, scale: number): Matrix4 =>
  new Matrix4()
    .copy(original)
    .multiply(new Matrix4().makeTranslation(centre.x, centre.y, centre.z))
    .multiply(new Matrix4().makeScale(scale, scale, scale))
    .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
