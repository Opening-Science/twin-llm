import { describe, expect, test } from "bun:test";
import { Euler, Quaternion, Vector3 } from "three";

import {
  beatAt,
  COUNTS_PER_MOVE,
  DANCE_LIMITS,
  DANCE_MOVES,
  danceAtBeat,
  danceDegreesAtBeat,
  danceMoveAt,
  dancePose,
  DEFAULT_TEMPO,
  HIP_HALF_WIDTH,
  moveDegreesAtBeat,
  PHRASE_BEATS,
  retimeElapsed,
  TOE_AHEAD_OF_ANKLE,
  TOE_BELOW_ANKLE,
} from "./dance";
import { type BodyPose, JOINT_IDS, type JointId } from "./gait";

const DEG = Math.PI / 180;
const round = (value: number, digits = 6): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/** Beats across one whole phrase and a little past its loop, finely sampled. */
const samples = (step: number): readonly number[] =>
  Array.from({ length: Math.round((PHRASE_BEATS + 2) / step) }, (_, i) => i * step - 1);

const AXES = ["pitch", "roll", "yaw"] as const;

const largestChange = (a: BodyPose, b: BodyPose): number =>
  Math.max(
    ...JOINT_IDS.flatMap((id) =>
      AXES.map((axis) => Math.abs(a.joints[id][axis] - b.joints[id][axis]) / DEG),
    ),
  );

describe("dance timing", () => {
  test("the beat follows the tempo, clamped to 80–140 beats a minute", () => {
    expect(DEFAULT_TEMPO).toBe(110);
    expect(round(beatAt((60 / 110) * 8))).toBe(8);
    expect(beatAt(3, 120)).toBe(6);
    expect(beatAt(3, 200)).toBe(7);
    expect(beatAt(3, 40)).toBe(4);
  });

  test("a tempo change keeps the beat reached", () => {
    const elapsed = 4;
    const later = retimeElapsed(elapsed, 90, 128);
    expect(round(beatAt(later, 128))).toBe(round(beatAt(elapsed, 90)));
    expect(round(later)).toBe(2.8125);
  });

  test("the phrase is five 8-count moves and loops", () => {
    expect(DANCE_MOVES.map((move) => move.id)).toEqual([
      "step-touch",
      "sway-raise",
      "hip-roll",
      "twist-point",
      "bounce-clap",
    ]);
    expect(COUNTS_PER_MOVE).toBe(8);
    expect(PHRASE_BEATS).toBe(40);
    expect(danceMoveAt(0)).toEqual({ index: 0, count: 0 });
    expect(danceMoveAt(8)).toEqual({ index: 1, count: 0 });
    expect(danceMoveAt(39.5)).toEqual({ index: 4, count: 7 });
    expect(danceMoveAt(43)).toEqual({ index: 0, count: 3 });
  });
});

describe("dancePose", () => {
  test("is deterministic and repeats every phrase", () => {
    expect(dancePose(7.3, 128)).toEqual(dancePose(7.3, 128));
    for (const beat of [0.4, 9.1, 23.75, 37.2]) {
      const a = danceAtBeat(beat);
      const b = danceAtBeat(beat + 3 * PHRASE_BEATS);
      for (const id of JOINT_IDS) {
        for (const axis of AXES) {
          expect(round(b.joints[id][axis], 9)).toBe(round(a.joints[id][axis], 9));
        }
      }
    }
  });

  test("a faster tempo reaches the same beat sooner", () => {
    expect(dancePose(4, 90)).toEqual(dancePose(3, 120));
  });

  test("the moves are distinct: each differs from every other by more than 20° somewhere", () => {
    const beats = Array.from({ length: 16 }, (_, i) => i / 2);
    for (let a = 0; a < DANCE_MOVES.length; a += 1) {
      for (let b = a + 1; b < DANCE_MOVES.length; b += 1) {
        const difference = Math.max(
          ...beats.flatMap((beat) => {
            const one = moveDegreesAtBeat(a, beat).degrees;
            const two = moveDegreesAtBeat(b, beat).degrees;
            return JOINT_IDS.flatMap((id) =>
              [0, 1, 2].map((axis) =>
                Math.abs((one[id][axis] ?? 0) - (two[id][axis] ?? 0)),
              ),
            );
          }),
        );
        expect(difference).toBeGreaterThan(20);
      }
    }
  });

  test("move boundaries do not pop: without the crossfade they would jump", () => {
    const boundaries = DANCE_MOVES.map((_, i) => i * COUNTS_PER_MOVE);
    const rawJumps = boundaries.map((beat, i) => {
      const before = moveDegreesAtBeat(i - 1, beat).degrees;
      const after = moveDegreesAtBeat(i, beat).degrees;
      return Math.max(
        ...JOINT_IDS.flatMap((id) =>
          [0, 1, 2].map((axis) =>
            Math.abs((before[id][axis] ?? 0) - (after[id][axis] ?? 0)),
          ),
        ),
      );
    });
    expect(Math.min(...rawJumps)).toBeGreaterThan(15);
    for (const beat of boundaries) {
      expect(
        largestChange(danceAtBeat(beat - 1e-4), danceAtBeat(beat + 1e-4)),
      ).toBeLessThan(0.05);
    }
  });

  test("every angle changes smoothly through the whole phrase and its loop", () => {
    const step = 0.01;
    const beats = samples(step);
    const worst = Math.max(
      ...beats.slice(1).map((beat, i) => {
        const prev = beats[i] ?? beat;
        return largestChange(danceAtBeat(prev), danceAtBeat(beat));
      }),
    );
    // About 2.5° per hundredth of a beat at most, i.e. no step anywhere.
    expect(worst).toBeLessThan(2.5);
    const shifts = beats.map((beat) => danceAtBeat(beat).pelvisShift);
    const worstShift = Math.max(
      ...shifts.slice(1).map((shift, i) => Math.abs(shift - (shifts[i] ?? shift))),
    );
    expect(worstShift).toBeLessThan(0.002);
  });

  test("stays inside the joint limits, the right side mirroring the left", () => {
    const right = new Set<JointId>([
      "clavicleR",
      "upperArmR",
      "lowerArmR",
      "upperLegR",
      "lowerLegR",
      "footR",
    ]);
    const extremes = new Map<string, number>();
    for (const beat of samples(0.05)) {
      const { degrees } = danceDegreesAtBeat(beat);
      for (const id of JOINT_IDS) {
        AXES.forEach((axis, i) => {
          const raw = degrees[id][i] ?? 0;
          const value = right.has(id) && axis !== "pitch" ? -raw : raw;
          const [lo, hi] = DANCE_LIMITS[id][axis];
          expect(value).toBeGreaterThanOrEqual(lo);
          expect(value).toBeLessThanOrEqual(hi);
          const key = `${id}.${axis}`;
          extremes.set(key, Math.max(extremes.get(key) ?? 0, Math.abs(value)));
        });
      }
    }
    // The arms really rise overhead and turn in to clap, the knees bounce and the trunk twists.
    expect(Math.round(extremes.get("upperArmL.roll") ?? 0)).toBe(140);
    expect(Math.round(extremes.get("upperArmR.yaw") ?? 0)).toBe(50);
    expect(Math.round(extremes.get("lowerLegL.pitch") ?? 0)).toBe(36);
    expect(Math.round(extremes.get("spineLower.yaw") ?? 0)).toBe(14);
  });
});

/**
 * A rough leg in the body frame (x left, y up, z forward), composed the way
 * `applyPose` composes the clip rotations: each joint's rotation follows its
 * parent's. Returns each foot's ankle and toe in metres.
 */
const THIGH = 0.45;
const SHANK = 0.43;
const TOE = new Vector3(0, -TOE_BELOW_ANKLE, TOE_AHEAD_OF_ANKLE);

const quat = (pose: BodyPose, id: JointId): Quaternion => {
  const { pitch, roll, yaw } = pose.joints[id];
  return new Quaternion().setFromEuler(new Euler(-pitch, yaw, roll, "YZX"));
};

const feet = (pose: BodyPose) => {
  const pelvis = quat(pose, "pelvis");
  const shift = new Vector3(pose.pelvisShift, 0, 0);
  return (["L", "R"] as const).map((side) => {
    const hip = new Vector3(side === "L" ? HIP_HALF_WIDTH : -HIP_HALF_WIDTH, 0, 0)
      .applyQuaternion(pelvis)
      .add(shift);
    const thigh = pelvis.clone().multiply(quat(pose, `upperLeg${side}`));
    const shank = thigh.clone().multiply(quat(pose, `lowerLeg${side}`));
    const foot = shank.clone().multiply(quat(pose, `foot${side}`));
    const knee = hip.clone().add(new Vector3(0, -THIGH, 0).applyQuaternion(thigh));
    const ankle = knee.add(new Vector3(0, -SHANK, 0).applyQuaternion(shank));
    const toe = ankle.clone().add(TOE.clone().applyQuaternion(foot));
    return { ankle, toe };
  });
};

describe("feet stay on the floor", () => {
  const rest = feet(danceAtBeat(0)).map(() => ({
    ankle: new Vector3(0, -THIGH - SHANK, 0),
    toe: new Vector3(0, -THIGH - SHANK, 0).add(TOE),
  }));

  test("one foot is always flat on the floor and in place; the other never lifts far", () => {
    let worstLift = 0;
    for (const beat of samples(0.05)) {
      const both = feet(danceAtBeat(beat));
      // applyPose lifts the pelvis until the lowest ankle or toe is on the floor.
      const floor = Math.min(...both.flatMap(({ ankle, toe }) => [ankle.y, toe.y]));
      const planted = both.filter(
        ({ ankle, toe }, i) =>
          Math.abs(ankle.y - floor - ((rest[i]?.ankle.y ?? 0) - (rest[i]?.toe.y ?? 0))) <
            0.012 && Math.abs(toe.y - floor) < 0.012,
      );
      expect(planted.length).toBeGreaterThanOrEqual(1);
      for (const [i, { ankle }] of both.entries()) {
        const restX = i === 0 ? HIP_HALF_WIDTH : -HIP_HALF_WIDTH;
        // Neither foot slides sideways with the hip sway.
        expect(Math.abs(ankle.x - restX)).toBeLessThan(0.03);
        worstLift = Math.max(worstLift, Math.min(ankle.y, both[i]?.toe.y ?? 0) - floor);
      }
    }
    expect(worstLift).toBeLessThan(0.1);
  });
});
