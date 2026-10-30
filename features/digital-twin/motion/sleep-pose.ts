import { type BodyPose, type JointRotation } from "./gait";

/**
 * Lying asleep on the back, computed. No lying clip exists, so the whole rig
 * turns at the pelvis to lie supine (pitched back 90°, then turned 90° so it
 * lies across the view rather than toward it), with a resting pose: arms by
 * the sides, the legs sloping a little down to the heels with soft knees,
 * feet relaxed. The chest rises and
 * falls at `breathsPerMinute`; without a rate it lies still. Angles use the
 * body frame of `gait.ts`.
 */

export type SleepParams = Readonly<{ breathsPerMinute: number | null }>;

/**
 * Metres the body is raised once lying, so the back rests on the floor
 * rather than in it: walking in place puts the lowest ankle where it stood,
 * and the buttocks sit further behind the hip joint than the heel behind
 * the ankle. Set on the rigged male demo body: hip, chest and head joints
 * end up 9 to 13 cm above the floor, the ankles 6 cm.
 */
export const SLEEP_LIFT_M = 0.03;

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
const rotation = (pitch = 0, roll = 0, yaw = 0): JointRotation => ({
  pitch: pitch * DEG,
  roll: roll * DEG,
  yaw: yaw * DEG,
});

/** The breath, −1 (out) to 1 (in), at time `t`; 0 throughout without a rate. */
export const sleepBreath = (t: number, breathsPerMinute: number | null): number =>
  breathsPerMinute === null ? 0 : Math.sin((TAU * t * breathsPerMinute) / 60);

/** Lying on the back at time `t` seconds. */
export const sleepPose = (t: number, params: SleepParams): BodyPose => {
  const breath = sleepBreath(t, params.breathsPerMinute);
  const lift = 0.5 * (1 + breath);
  return {
    joints: {
      pelvis: rotation(90, 0, 90),
      spineLower: rotation(0.4 * breath),
      // Breathing in lifts the chest and lets the shoulders rise a little.
      spineUpper: rotation(1.6 * breath),
      clavicleL: rotation(0, 1.5 * lift, 0),
      clavicleR: rotation(0, -1.5 * lift, 0),
      upperArmL: rotation(-4, 8),
      upperArmR: rotation(-4, -8),
      // The bind pose hangs the forearms 15° in front; lying, that would lift the hands.
      lowerArmL: rotation(-14),
      lowerArmR: rotation(-14),
      // The legs slope a little down to the heels, knees soft.
      upperLegL: rotation(-2, 3),
      upperLegR: rotation(-2, -3),
      lowerLegL: rotation(-4),
      lowerLegR: rotation(-4),
      footL: rotation(-20),
      footR: rotation(-20),
      // Turned a little toward the subject's right, as on a pillow.
      head: rotation(6, 0, -8),
    },
    pelvisShift: 0,
    pelvisLift: SLEEP_LIFT_M,
  };
};
