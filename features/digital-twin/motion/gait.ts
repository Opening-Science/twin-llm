/**
 * Procedural motion clips: pure functions of time that give joint rotations in
 * a body frame, with no motion-capture data (so no mocap licence applies). The
 * walk is a generic adult walk built from smooth curves shaped like textbook
 * sagittal gait kinematics (hip, knee, ankle, arm swing, pelvis rotation and
 * list); the idle clip is a slow breath with a little postural sway. Neither
 * is anyone's measured gait or breathing.
 *
 * Body frame, per joint, carried by the parent joint as it moves:
 * - pitch: about the subject's right-to-left axis; positive swings a limb that
 *   hangs down forward (hip flexion, arm forward, elbow flexion, ankle
 *   dorsiflexion) and tilts an upright segment (the spine) back.
 * - roll: about the back-to-front axis; positive lifts the subject's left side.
 * - yaw: about the vertical axis; positive turns the subject's front to their left.
 * Angles are radians. `rig-map.ts` turns them into bone rotations.
 */

export const JOINT_IDS = [
  "pelvis",
  "spineLower",
  "spineUpper",
  "clavicleL",
  "clavicleR",
  "upperArmL",
  "upperArmR",
  "lowerArmL",
  "lowerArmR",
  "upperLegL",
  "upperLegR",
  "lowerLegL",
  "lowerLegR",
  "footL",
  "footR",
] as const;

export type JointId = (typeof JOINT_IDS)[number];

export type JointRotation = Readonly<{ pitch: number; roll: number; yaw: number }>;

export type BodyPose = Readonly<{
  joints: Readonly<Record<JointId, JointRotation>>;
  /** Pelvis shift toward the subject's left, in metres (weight over the stance leg). */
  pelvisShift: number;
}>;

export type MotionClip = "walk" | "idle" | "dance";

export type WalkParams = Readonly<{
  /** Steps per minute; two steps make one gait cycle. */
  cadence: number;
  /** Stride length in metres (one full cycle); scales the sagittal angles. */
  stride: number;
}>;

export type IdleParams = Readonly<{ breathsPerMinute: number }>;

/** A typical adult's comfortable walk: about 105 steps a minute, 1.3 m strides. */
export const DEFAULT_WALK: WalkParams = { cadence: 105, stride: 1.3 };
export const DEFAULT_IDLE: IdleParams = { breathsPerMinute: 12 };

/** The stride the angle curves are drawn for; other strides scale them. */
const REFERENCE_STRIDE = 1.3;
const STRIDE_SCALE: readonly [number, number] = [0.3, 1.4];

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
const ZERO: JointRotation = { pitch: 0, roll: 0, yaw: 0 };

const frac = (value: number): number => value - Math.floor(value);
const clamp = (value: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(hi, Math.max(lo, value));

const rotation = (pitch = 0, roll = 0, yaw = 0): JointRotation => ({
  pitch: pitch * DEG,
  roll: roll * DEG,
  yaw: yaw * DEG,
});

/** Seconds per gait cycle at a cadence in steps per minute. */
export const gaitPeriod = (cadence: number): number => 120 / cadence;

/** Where in the left leg's gait cycle time `t` falls: 0 is left heel strike, 0.5 right heel strike. */
export const gaitPhase = (t: number, cadence: number): number =>
  frac(t / gaitPeriod(cadence));

/**
 * A raised-cosine bump on the cycle: 1 at `centre`, falling smoothly to 0 at
 * `halfWidth` either side, measured round the cycle so it wraps at 1.
 */
export const bump = (phase: number, centre: number, halfWidth: number): number => {
  const raw = Math.abs(frac(phase) - centre);
  const distance = Math.min(raw, 1 - raw);
  return distance >= halfWidth
    ? 0
    : 0.5 * (1 + Math.cos((Math.PI * distance) / halfWidth));
};

/** How far below level the sole may point in the walk, degrees (toe down is negative). */
export const FOOT_PITCH_FLOOR = -35;
/** The ankle's range in the walk, degrees: plantar flexion negative. */
export const ANKLE_RANGE: readonly [number, number] = [-12, 20];

/**
 * The ankle angle that keeps the sole from pointing down past
 * `FOOT_PITCH_FLOOR` when the thigh is at `hip` and the knee bent by `knee`
 * (the sole's pitch is hip − knee + ankle), within `ANKLE_RANGE`. Without it
 * the push-off and the swing's bent knee pitch the trailing foot toe-down by
 * more than 50°, which walking in place shows as a foot stabbing the floor.
 */
export const shapeAnkle = (hip: number, knee: number, ankle: number): number =>
  clamp(Math.max(ankle, FOOT_PITCH_FLOOR - (hip - knee)), ANKLE_RANGE);

/** Sagittal angles in degrees for one leg and the arm on the same side, at that leg's phase. */
export const limbAngles = (
  phase: number,
): Readonly<{
  hip: number;
  knee: number;
  ankle: number;
  shoulder: number;
  elbow: number;
}> => {
  const swing = Math.cos(TAU * phase);
  // Flexed about 28° at heel strike, extended about 12° before toe off.
  const hip = 8 + 20 * swing;
  // A small loading flexion early in stance, about 58° in mid swing.
  const knee = 18 * bump(phase, 0.15, 0.15) + 58 * bump(phase, 0.72, 0.25);
  return {
    hip,
    knee,
    // Plantar flexion after heel strike, dorsiflexion late in stance, a short push
    // off at toe off; then shaped so the foot never points further down than
    // FOOT_PITCH_FLOOR, and kept within the ankle's range.
    ankle: shapeAnkle(
      hip,
      knee,
      -6 * bump(phase, 0.06, 0.08) +
        10 * bump(phase, 0.42, 0.18) -
        10 * bump(phase, 0.6, 0.08),
    ),
    // The arm swings opposite its own leg.
    shoulder: -16 * swing,
    // The elbow bends more as the arm comes forward.
    elbow: 12 + 5 * (1 - swing),
  };
};

/** The walk at time `t` seconds, walking in place. */
export const walkPose = (t: number, params: WalkParams = DEFAULT_WALK): BodyPose => {
  const phase = gaitPhase(t, params.cadence);
  const s = clamp(params.stride / REFERENCE_STRIDE, STRIDE_SCALE);
  const left = limbAngles(phase);
  const right = limbAngles(phase + 0.5);
  const cycle = Math.cos(TAU * phase);
  const stance = Math.sin(TAU * phase);
  return {
    joints: {
      // The pelvis turns its forward leg's side forward and drops on the swing side.
      pelvis: rotation(0, 4 * s * stance, -4 * s * cycle),
      // The trunk leans a little forward and turns against the pelvis.
      spineLower: rotation(-2, -3 * s * stance, 2 * s * cycle),
      spineUpper: rotation(0, 0, 4 * s * cycle),
      clavicleL: ZERO,
      clavicleR: ZERO,
      upperArmL: rotation(s * left.shoulder, 3),
      upperArmR: rotation(s * right.shoulder, -3),
      lowerArmL: rotation(s * left.elbow),
      lowerArmR: rotation(s * right.elbow),
      upperLegL: rotation(s * left.hip),
      upperLegR: rotation(s * right.hip),
      lowerLegL: rotation(-s * left.knee),
      lowerLegR: rotation(-s * right.knee),
      footL: rotation(s * left.ankle),
      footR: rotation(s * right.ankle),
    },
    pelvisShift: 0.02 * s * stance,
  };
};

/** Standing at time `t` seconds: a slow breath and a little sway. */
export const idlePose = (t: number, params: IdleParams = DEFAULT_IDLE): BodyPose => {
  const breath = Math.sin((TAU * t * params.breathsPerMinute) / 60);
  const lift = 0.5 * (1 + breath);
  const sway = Math.sin(TAU * 0.07 * t);
  const turn = Math.sin(TAU * 0.05 * t + 1);
  return {
    joints: {
      pelvis: rotation(0, 0.6 * sway, 0.8 * turn),
      spineLower: rotation(0, -0.4 * sway, 0),
      // Breathing in straightens the chest a little and lifts the shoulders.
      spineUpper: rotation(0.8 * breath, 0, 0),
      clavicleL: rotation(0, 1.2 * lift, 0),
      clavicleR: rotation(0, -1.2 * lift, 0),
      upperArmL: ZERO,
      upperArmR: ZERO,
      lowerArmL: ZERO,
      lowerArmR: ZERO,
      upperLegL: ZERO,
      upperLegR: ZERO,
      lowerLegL: ZERO,
      lowerLegR: ZERO,
      footL: ZERO,
      footR: ZERO,
    },
    pelvisShift: 0.006 * sway,
  };
};

/** Every angle and the shift times `weight`: 0 is the rest pose, 1 the clip. */
export const weighPose = (pose: BodyPose, weight: number): BodyPose => ({
  joints: Object.fromEntries(
    JOINT_IDS.map((id) => {
      const joint = pose.joints[id];
      return [
        id,
        {
          pitch: joint.pitch * weight,
          roll: joint.roll * weight,
          yaw: joint.yaw * weight,
        },
      ];
    }),
  ) as Record<JointId, JointRotation>,
  pelvisShift: pose.pelvisShift * weight,
});

/** Seconds to blend a clip in or out, so starting and stopping never jumps. */
export const BLEND_SECONDS = 0.4;

/** The next blend weight, moving toward `target` (0 or 1) at a constant rate. */
export const stepWeight = (
  weight: number,
  target: number,
  deltaSeconds: number,
): number => {
  const step = Math.max(0, deltaSeconds) / BLEND_SECONDS;
  return target > weight
    ? Math.min(target, weight + step)
    : Math.max(target, weight - step);
};
