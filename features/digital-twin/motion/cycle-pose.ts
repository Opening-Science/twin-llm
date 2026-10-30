import { type BodyPose, type JointRotation } from "./gait";

/**
 * Pedalling in place, computed: a pure function of time, with no
 * motion-capture data and no bike drawn. The feet follow a crank circle
 * below and in front of the hips (a seated road position), the leg angles
 * come from two-bone geometry on a typical adult leg, the trunk leans
 * forward with the hands reaching for bars that are not there. Angles use
 * the body frame of `gait.ts`.
 *
 * `rpm` is crank revolutions a minute; one revolution moves both legs once,
 * so a cycle at 80 rpm lasts 0.75 s.
 */

export type CycleParams = Readonly<{ rpm: number }>;

/** A relaxed road cadence. */
export const DEFAULT_CYCLE: CycleParams = { rpm: 80 };

/** Typical adult thigh and shin, metres (hip to knee, knee to ankle). */
export const CYCLE_THIGH_M = 0.44;
export const CYCLE_SHIN_M = 0.44;
/** The crank centre from the hip joint, metres: forward and down. */
export const CRANK_CENTRE: Readonly<{ forward: number; down: number }> = {
  forward: 0.18,
  down: 0.66,
};
export const CRANK_RADIUS_M = 0.17;

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
const ZERO: JointRotation = { pitch: 0, roll: 0, yaw: 0 };

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value));

const rotation = (pitch = 0, roll = 0, yaw = 0): JointRotation => ({
  pitch: pitch * DEG,
  roll: roll * DEG,
  yaw: yaw * DEG,
});

/** Seconds per crank revolution. */
export const cyclePeriod = (rpm: number): number => 60 / rpm;

/** The pedal's place from the hip at crank angle `angle` (radians, 0 at the top, forward next). */
export const pedalPoint = (angle: number): Readonly<{ forward: number; up: number }> => ({
  forward: CRANK_CENTRE.forward + CRANK_RADIUS_M * Math.sin(angle),
  up: -CRANK_CENTRE.down + CRANK_RADIUS_M * Math.cos(angle),
});

/**
 * Hip flexion and knee flexion in degrees that put the ankle on the pedal, by
 * the law of cosines with the knee bending forward. Out of reach, the leg is
 * straight toward the pedal.
 */
export const legToPedal = (angle: number): Readonly<{ hip: number; knee: number }> => {
  const pedal = pedalPoint(angle);
  const reach = Math.hypot(pedal.forward, pedal.up);
  const span = clamp(
    reach,
    Math.abs(CYCLE_THIGH_M - CYCLE_SHIN_M) + 1e-6,
    CYCLE_THIGH_M + CYCLE_SHIN_M,
  );
  const inner = Math.acos(
    clamp(
      (CYCLE_THIGH_M ** 2 + CYCLE_SHIN_M ** 2 - span ** 2) /
        (2 * CYCLE_THIGH_M * CYCLE_SHIN_M),
      -1,
      1,
    ),
  );
  const offset = Math.acos(
    clamp(
      (CYCLE_THIGH_M ** 2 + span ** 2 - CYCLE_SHIN_M ** 2) / (2 * CYCLE_THIGH_M * span),
      -1,
      1,
    ),
  );
  // 0 is straight down, forward positive.
  const toward = Math.atan2(pedal.forward, -pedal.up);
  return { hip: (toward + offset) / DEG, knee: (Math.PI - inner) / DEG };
};

/**
 * How far the body is raised so the hips stay level: walking in place keeps
 * the lowest foot on the floor, and the lower pedal is lowest at the bottom of
 * the stroke, so between strokes the body would sink by up to the crank
 * radius.
 */
export const cycleLift = (angle: number): number =>
  CRANK_RADIUS_M * (1 - Math.abs(Math.cos(angle)));

/** Pedalling at time `t` seconds. */
export const cyclePose = (t: number, params: CycleParams = DEFAULT_CYCLE): BodyPose => {
  const angle = (TAU * t) / cyclePeriod(params.rpm);
  const left = legToPedal(angle);
  const right = legToPedal(angle + Math.PI);
  // The sole stays a little toe down through the stroke: its pitch is hip − knee + ankle.
  const ankle = (leg: Readonly<{ hip: number; knee: number }>): number =>
    clamp(-10 - (leg.hip - leg.knee), -30, 20);
  const rock = Math.sin(angle);
  return {
    joints: {
      pelvis: rotation(0, 1.5 * rock, 0),
      // About 40° of forward lean, the head lifted to look ahead.
      spineLower: rotation(-28, -1 * rock, 0),
      spineUpper: rotation(-12, 0, 0),
      clavicleL: ZERO,
      clavicleR: ZERO,
      upperArmL: rotation(62, 8),
      upperArmR: rotation(62, -8),
      lowerArmL: rotation(18),
      lowerArmR: rotation(18),
      upperLegL: rotation(left.hip, 0),
      upperLegR: rotation(right.hip, 0),
      lowerLegL: rotation(-left.knee),
      lowerLegR: rotation(-right.knee),
      footL: rotation(ankle(left)),
      footR: rotation(ankle(right)),
      head: rotation(30),
    },
    pelvisShift: 0,
    pelvisLift: cycleLift(angle),
  };
};
