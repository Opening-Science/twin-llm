import { type BodyPose, JOINT_IDS, type JointId, type JointRotation } from "./gait";

/**
 * A computed dance loop: pure functions of time and tempo, in the joint
 * vocabulary and body frame of `gait.ts`, with no motion-capture data. A phrase
 * is five 8-count moves, each a smooth periodic function of the beat, joined by
 * a one-beat crossfade either side of every boundary (and round the loop), so
 * no angle jumps.
 *
 * Every move is described by a few dance parameters (weight shift, hip roll and
 * twist, knee bends, arms, head bob); `compose` turns them into joint angles and
 * keeps the feet where they stood: the legs lean against the pelvis shift and
 * roll, counter-turn its twist, and the free leg's knee softens enough that
 * the lowered hip does not push its foot through the floor. `applyPose` then
 * lifts the pelvis so the lowest foot touches the floor, as for the walk.
 *
 * There is no neck joint in the vocabulary, so the head bob is a nod of the
 * upper spine, which carries the head.
 */

/** Beats per minute; the toolbar offers 90, 110 and 128. */
export const DEFAULT_TEMPO = 110;
export const TEMPO_RANGE: readonly [number, number] = [80, 140];
export const DANCE_TEMPOS: readonly number[] = [90, 110, 128];

export const COUNTS_PER_MOVE = 8;
/** Beats of crossfade either side of a move boundary. */
export const CROSSFADE_BEATS = 1;

/** Approximate leg geometry (metres) the foot-keeping compensation uses. */
export const LEG_LENGTH = 0.88;
export const HIP_HALF_WIDTH = 0.09;
/** Where the toe sits from the ankle at rest, metres down and forward. */
export const TOE_BELOW_ANKLE = 0.06;
export const TOE_AHEAD_OF_ANKLE = 0.14;

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

const clamp = (value: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(hi, Math.max(lo, value));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const mod = (value: number, n: number): number => value - n * Math.floor(value / n);
/** 0 to 1 with zero slope and curvature at both ends. */
const smootherstep = (u: number): number => {
  const x = clamp(u, [0, 1]);
  return x * x * x * (x * (6 * x - 15) + 10);
};
/** A smooth max: like `Math.max`, rounded over about `soft` either side of the corner. */
const softMax = (a: number, b: number, soft = 2): number =>
  0.5 * (a + b + Math.sqrt((a - b) ** 2 + soft * soft));

/** A sine that dwells near ±1: weight that settles on a foot before moving on. */
const squareish = (x: number): number => (Math.sin(x) + Math.sin(3 * x) / 6) / (5 / 6);
/** 1 on every beat, 0 half way between: the bounce and the nod. */
const onBeat = (beat: number): number => 0.5 * (1 + Math.cos(TAU * beat));

export const clampTempo = (tempo: number): number => clamp(tempo, TEMPO_RANGE);

/** The beat (counted from 0) at `t` seconds. */
export const beatAt = (t: number, tempo: number = DEFAULT_TEMPO): number =>
  (t * clampTempo(tempo)) / 60;

/**
 * Seconds already played at `fromTempo`, re-expressed at `toTempo` so the beat
 * carries on from where it was when the tempo changes.
 */
export const retimeElapsed = (elapsed: number, fromTempo: number, toTempo: number) =>
  (elapsed * clampTempo(fromTempo)) / clampTempo(toTempo);

/** An arm, in degrees: roll is outward for either arm (the right arm's is mirrored). */
type Arm = Readonly<{ pitch: number; out: number; yaw?: number; elbow: number }>;
type Triple = readonly [pitch: number, roll: number, yaw: number];

/** One instant of a move, in dance terms. Degrees and metres; + is the subject's left. */
export type MoveFrame = Readonly<{
  /** Pelvis shift toward the left, m. */
  shift: number;
  pelvis: Triple;
  spineLower: Triple;
  spineUpper: Triple;
  /** Shoulder shrug, degrees up, per side. */
  shrugL: number;
  shrugR: number;
  armL: Arm;
  armR: Arm;
  /** Knee bend per leg, degrees, with the sole kept flat. */
  bendL: number;
  bendR: number;
  /** Extra plantar flexion of a pointed or touching foot, degrees down. */
  pointL?: number;
  pointR?: number;
}>;

export type DanceMove = Readonly<{
  id: string;
  label: string;
  frame: (beat: number) => MoveFrame;
}>;

const half = (beat: number): number => (Math.PI * beat) / 2;
/** How much the left (w = +1) or right (w = −1) side is the free one. */
const freeL = (w: number): number => ((1 - clamp(w, [-1, 1])) / 2) ** 2;
const freeR = (w: number): number => ((1 + clamp(w, [-1, 1])) / 2) ** 2;

const armBetween = (a: Arm, b: Arm, u: number): Arm => ({
  pitch: lerp(a.pitch, b.pitch, u),
  out: lerp(a.out, b.out, u),
  yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, u),
  elbow: lerp(a.elbow, b.elbow, u),
});

/** Count 1 step left, 2 touch, 3 step right, 4 touch; both arms swing toward the step. */
const stepTouch: DanceMove = {
  id: "step-touch",
  label: "Step-touch with arm swing",
  frame: (beat) => {
    const w = squareish(half(beat));
    const bob = onBeat(beat);
    return {
      shift: 0.05 * w,
      pelvis: [0, 4 * w, 3 * w],
      spineLower: [-1, -3 * w, -2 * w],
      spineUpper: [-3 * bob, -1 * w, -3 * w],
      shrugL: 2 * bob,
      shrugR: 2 * bob,
      armL: { pitch: 22 + 10 * w, out: 14 + 16 * w, elbow: 35 + 15 * bob },
      armR: { pitch: 22 - 10 * w, out: 14 - 16 * w, elbow: 35 + 15 * bob },
      bendL: 6 + 8 * bob + 16 * freeL(w),
      bendR: 6 + 8 * bob + 16 * freeR(w),
      pointL: 10 * freeL(w),
      pointR: 10 * freeR(w),
    };
  },
};

/** Two counts swaying each way, the arm away from the sway rising overhead. */
const swayRaise: DanceMove = {
  id: "sway-raise",
  label: "Side sway with alternating arm raise",
  frame: (beat) => {
    const w = Math.sin(half(beat));
    const raiseL = ((1 - w) / 2) ** 2;
    const raiseR = ((1 + w) / 2) ** 2;
    const bob = onBeat(beat);
    return {
      shift: 0.06 * w,
      pelvis: [0, 6 * w, 0],
      spineLower: [0, -9 * w, 0],
      spineUpper: [-2 * bob, -4 * w, 0],
      shrugL: 10 * raiseL,
      shrugR: 10 * raiseR,
      armL: { pitch: 10 + 10 * raiseL, out: 12 + 128 * raiseL, elbow: 25 - 12 * raiseL },
      armR: { pitch: 10 + 10 * raiseR, out: 12 + 128 * raiseR, elbow: 25 - 12 * raiseR },
      bendL: 6 + 5 * bob,
      bendR: 6 + 5 * bob,
    };
  },
};

/** The hips trace a circle every four counts; the chest stays over the feet. */
const hipRoll: DanceMove = {
  id: "hip-roll",
  label: "Hip roll",
  frame: (beat) => {
    const side = Math.sin(half(beat));
    const tilt = Math.cos(half(beat));
    const bob = onBeat(beat);
    return {
      shift: 0.05 * side,
      pelvis: [7 * tilt, 5 * side, 0],
      spineLower: [-7 * tilt, -7 * side, 0],
      spineUpper: [-2 * bob, -2 * side, 0],
      shrugL: 0,
      shrugR: 0,
      // Arms loose and a little forward, swinging with the hips.
      armL: { pitch: 15 + 5 * tilt, out: 18 + 8 * side, elbow: 45 },
      armR: { pitch: 15 + 5 * tilt, out: 18 - 8 * side, elbow: 45 },
      bendL: 12 + 4 * bob,
      bendR: 12 + 4 * bob,
    };
  },
};

/** Forearm across the chest (the upper arm turned in), and an arm pointing up and out. */
const CHEST_ARM: Arm = { pitch: 25, out: 10, yaw: -50, elbow: 95 };
const POINT_ARM: Arm = { pitch: 25, out: 130, elbow: 5 };

/** Count 1 twist left and point up left, count 3 twist right and point up right. */
const twistPoint: DanceMove = {
  id: "twist-point",
  label: "Twist and point",
  frame: (beat) => {
    const w = squareish(half(beat));
    const bob = onBeat(beat);
    return {
      shift: 0.035 * w,
      pelvis: [0, 3 * w, -5 * w],
      spineLower: [0, -2 * w, 13 * w],
      spineUpper: [-3 * bob, 0, 11 * w],
      shrugL: 6 * freeR(w),
      shrugR: 6 * freeL(w),
      armL: armBetween(CHEST_ARM, POINT_ARM, freeR(w)),
      armR: armBetween(CHEST_ARM, POINT_ARM, freeL(w)),
      bendL: 8 + 6 * bob + 10 * freeL(w),
      bendR: 8 + 6 * bob + 10 * freeR(w),
      pointL: 12 * freeL(w),
      pointR: 12 * freeR(w),
    };
  },
};

/** Hands apart at chest height, and together in front of it. */
const OPEN_ARM: Arm = { pitch: 25, out: 40, elbow: 62 };
const CLAP_ARM: Arm = { pitch: 30, out: 2, yaw: -20, elbow: 62 };

/** A knee bounce on every count and a clap on 2, 4, 6 and 8. */
const bounceClap: DanceMove = {
  id: "bounce-clap",
  label: "Bounce with claps",
  frame: (beat) => {
    const bob = onBeat(beat);
    const clap = (0.5 * (1 - Math.cos(Math.PI * beat))) ** 2;
    const sway = Math.sin(half(beat));
    return {
      shift: 0.02 * sway,
      pelvis: [0, 2 * sway, 0],
      spineLower: [-2 * bob, -2 * sway, 0],
      spineUpper: [-5 * bob, 0, 0],
      shrugL: 4 * bob,
      shrugR: 4 * bob,
      armL: armBetween(OPEN_ARM, CLAP_ARM, clap),
      armR: armBetween(OPEN_ARM, CLAP_ARM, clap),
      bendL: 6 + 18 * bob,
      bendR: 6 + 18 * bob,
    };
  },
};

/** The phrase, in order; it loops back to the first move. */
export const DANCE_MOVES: readonly DanceMove[] = [
  stepTouch,
  swayRaise,
  hipRoll,
  twistPoint,
  bounceClap,
];

export const PHRASE_BEATS = COUNTS_PER_MOVE * DANCE_MOVES.length;

/** Rest limits per joint, degrees, as [min, max] for pitch, roll and yaw (left side; the right mirrors roll and yaw). */
export const DANCE_LIMITS: Readonly<
  Record<JointId, Readonly<Record<keyof JointRotation, readonly [number, number]>>>
> = (() => {
  const trunk = { pitch: [-15, 15], roll: [-12, 12], yaw: [-25, 25] } as const;
  const clavicle = { pitch: [-5, 5], roll: [-15, 15], yaw: [-5, 5] } as const;
  const upperArm = { pitch: [-45, 150], roll: [-30, 150], yaw: [-60, 40] } as const;
  const lowerArm = { pitch: [0, 135], roll: [-5, 5], yaw: [-5, 5] } as const;
  const upperLeg = { pitch: [-20, 60], roll: [-20, 20], yaw: [-25, 25] } as const;
  const lowerLeg = { pitch: [-70, 0], roll: [-5, 5], yaw: [-5, 5] } as const;
  const foot = { pitch: [-35, 25], roll: [-15, 15], yaw: [-5, 5] } as const;
  return {
    pelvis: { pitch: [-10, 10], roll: [-10, 10], yaw: [-20, 20] },
    spineLower: trunk,
    spineUpper: trunk,
    clavicleL: clavicle,
    clavicleR: clavicle,
    upperArmL: upperArm,
    upperArmR: upperArm,
    lowerArmL: lowerArm,
    lowerArmR: lowerArm,
    upperLegL: upperLeg,
    upperLegR: upperLeg,
    lowerLegL: lowerLeg,
    lowerLegR: lowerLeg,
    footL: foot,
    footR: foot,
  };
})();

type Degrees = Record<JointId, Triple>;

/** How far a foot's lowest point (its toe) sits below the ankle when pointed `point` degrees down. */
const toeDrop = (point: number): number =>
  TOE_BELOW_ANKLE * Math.cos(point * DEG) + TOE_AHEAD_OF_ANKLE * Math.sin(point * DEG);

/**
 * The knee bend that brings a foot's lowest point up to the other foot's: the
 * other leg is bent `otherBend` and its hip is `hipBelow` metres higher, and
 * the feet are pointed `point` and `otherPoint` degrees down. With the sole
 * flat a bend b shortens the leg to LEG_LENGTH · cos(b / 2). Continuous, and
 * no more than the other leg's bend when this foot is already the higher one.
 */
export const kneeToClear = (
  otherBend: number,
  hipBelow: number,
  point: number,
  otherPoint: number,
): number => {
  const deficit = hipBelow + toeDrop(point) - toeDrop(otherPoint);
  const cosine = Math.cos((otherBend / 2) * DEG) - deficit / LEG_LENGTH;
  return (2 * Math.acos(clamp(cosine, [-1, 1]))) / DEG;
};

/**
 * Joint angles in degrees for one frame. The legs keep the feet planted: the
 * thighs lean against the pelvis shift and roll and counter-turn its twist;
 * the knees bend with the hip and ankle sharing the bend so the soles stay
 * flat; a leg whose hip the roll lowers, or whose foot points, bends at least
 * enough that its foot does not reach below the other one.
 */
export const compose = (frame: MoveFrame): Degrees => {
  const [pelvisPitch, pelvisRoll, pelvisYaw] = frame.pelvis;
  const lean = Math.asin(clamp(frame.shift / LEG_LENGTH, [-1, 1])) / DEG;
  // How far the pelvis roll lowers the right hip below the left.
  const rightBelow = 2 * HIP_HALF_WIDTH * Math.sin(pelvisRoll * DEG);
  const pointL = frame.pointL ?? 0;
  const pointR = frame.pointR ?? 0;
  const bendL = softMax(
    frame.bendL,
    kneeToClear(frame.bendR, -rightBelow, pointL, pointR),
  );
  const bendR = softMax(
    frame.bendR,
    kneeToClear(frame.bendL, rightBelow, pointR, pointL),
  );
  const leg = (bend: number, point: number): readonly Triple[] => {
    const hip = bend / 2 - pelvisPitch;
    return [
      [hip, -lean - pelvisRoll, -pelvisYaw],
      [-bend, 0, 0],
      // Sole flat: hip + knee + ankle + pelvis pitch = 0, then any point.
      [bend / 2 - point, lean, 0],
    ];
  };
  const [upperLegL, lowerLegL, footL] = leg(bendL, pointL);
  const [upperLegR, lowerLegR, footR] = leg(bendR, pointR);
  const armL = frame.armL;
  const armR = frame.armR;
  return {
    pelvis: [pelvisPitch, pelvisRoll, pelvisYaw],
    spineLower: frame.spineLower,
    spineUpper: frame.spineUpper,
    clavicleL: [0, frame.shrugL, 0],
    clavicleR: [0, -frame.shrugR, 0],
    upperArmL: [armL.pitch, armL.out, armL.yaw ?? 0],
    upperArmR: [armR.pitch, -armR.out, -(armR.yaw ?? 0)],
    lowerArmL: [armL.elbow, 0, 0],
    lowerArmR: [armR.elbow, 0, 0],
    upperLegL: upperLegL ?? [0, 0, 0],
    upperLegR: upperLegR ?? [0, 0, 0],
    lowerLegL: lowerLegL ?? [0, 0, 0],
    lowerLegR: lowerLegR ?? [0, 0, 0],
    footL: footL ?? [0, 0, 0],
    footR: footR ?? [0, 0, 0],
  };
};

type Frame = Readonly<{ degrees: Degrees; shift: number }>;

const moveFrame = (index: number, beat: number): Frame => {
  const move = DANCE_MOVES[mod(index, DANCE_MOVES.length)] ?? stepTouch;
  const frame = move.frame(beat);
  return { degrees: compose(frame), shift: frame.shift };
};

const blend = (a: Frame, b: Frame, u: number): Frame => ({
  degrees: Object.fromEntries(
    JOINT_IDS.map((id) => [
      id,
      [0, 1, 2].map((axis) =>
        lerp(a.degrees[id][axis] ?? 0, b.degrees[id][axis] ?? 0, u),
      ),
    ]),
  ) as unknown as Degrees,
  shift: lerp(a.shift, b.shift, u),
});

/** Which move plays at a beat: its index in `DANCE_MOVES` and the count within it (0–7). */
export const danceMoveAt = (beat: number): Readonly<{ index: number; count: number }> => {
  const inPhrase = mod(beat, PHRASE_BEATS);
  return {
    index: Math.floor(inPhrase / COUNTS_PER_MOVE),
    count: Math.floor(mod(inPhrase, COUNTS_PER_MOVE)),
  };
};

/** Joint angles in degrees at a beat, crossfading across move boundaries. */
export const danceDegreesAtBeat = (beat: number): Frame => {
  const inPhrase = mod(beat, PHRASE_BEATS);
  const boundary = Math.round(inPhrase / COUNTS_PER_MOVE);
  const offset = inPhrase - boundary * COUNTS_PER_MOVE;
  if (Math.abs(offset) < CROSSFADE_BEATS) {
    const u = smootherstep((offset + CROSSFADE_BEATS) / (2 * CROSSFADE_BEATS));
    // Moves are periodic in the beat, so each can run a beat past its own 8 counts.
    return blend(moveFrame(boundary - 1, inPhrase), moveFrame(boundary, inPhrase), u);
  }
  return moveFrame(Math.floor(inPhrase / COUNTS_PER_MOVE), inPhrase);
};

/** The pose of one move alone at a beat, without any crossfade (for tests and tuning). */
export const moveDegreesAtBeat = (index: number, beat: number): Frame =>
  moveFrame(index, beat);

const toPose = ({ degrees, shift }: Frame): BodyPose => ({
  joints: Object.fromEntries(
    JOINT_IDS.map((id) => {
      const [pitch = 0, roll = 0, yaw = 0] = degrees[id];
      return [id, { pitch: pitch * DEG, roll: roll * DEG, yaw: yaw * DEG }];
    }),
  ) as Record<JointId, JointRotation>,
  pelvisShift: shift,
});

/** The dance at a beat. */
export const danceAtBeat = (beat: number): BodyPose => toPose(danceDegreesAtBeat(beat));

/** The dance at `t` seconds and `tempo` beats a minute (clamped to 80–140). */
export const dancePose = (t: number, tempo: number = DEFAULT_TEMPO): BodyPose =>
  danceAtBeat(beatAt(t, tempo));
