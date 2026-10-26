import { describe, expect, test } from "bun:test";
import { Euler, Quaternion } from "three";

import fixture from "./fixtures/synthetic-clip.json";
import { JOINT_IDS, type JointRotation } from "./gait";
import {
  clipSpan,
  contactOnset,
  contactWeight,
  keyframePose,
  loopCrossfade,
  loopPeriod,
  loopTime,
  parseKeyframeClip,
  quaternionToRotation,
  type KeyframeClip,
} from "./keyframe-clip";

/**
 * The fixture is made by `python/motion/synthetic.py` from synthetic
 * landmarks (a hip sway with bending arms and knees), through the same
 * pipeline as a video; no footage is involved.
 */
const clip = parseKeyframeClip(fixture) as KeyframeClip;
const DEG = 180 / Math.PI;
const round = (value: number, digits = 6): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/** The quaternion `applyPose` builds from a joint's angles. */
const rebuild = (rotation: JointRotation): Quaternion =>
  new Quaternion().setFromEuler(
    new Euler(-rotation.pitch, rotation.yaw, rotation.roll, "YZX"),
  );

const frameQuaternion = (frame: number, joint: string): Quaternion => {
  const j = fixture.joints.indexOf(joint);
  const row = fixture.frames[frame] ?? [];
  return new Quaternion(
    row[j * 4] ?? 0,
    row[j * 4 + 1] ?? 0,
    row[j * 4 + 2] ?? 0,
    row[j * 4 + 3] ?? 1,
  ).normalize();
};

describe("parseKeyframeClip", () => {
  test("reads the synthetic fixture: 12 frames at 12 fps, every joint a track", () => {
    expect(clip.name).toBe("Synthetic sway");
    expect(clip.fps).toBe(12);
    expect(clip.frameCount).toBe(12);
    expect([...clip.tracks.keys()]).toEqual([...JOINT_IDS]);
    expect(clip.pelvisShift.length).toBe(12);
  });

  test("refuses files that are not clips, and says why", () => {
    const reasons: string[] = [];
    const reject = (value: unknown) =>
      parseKeyframeClip(value, (message) => void reasons.push(message));
    expect(reject({ ...fixture, format: "other" })).toBeNull();
    expect(reject({ ...fixture, frameCount: 13 })).toBeNull();
    expect(
      reject({ ...fixture, frames: fixture.frames.map((row) => row.slice(1)) }),
    ).toBeNull();
    expect(
      reject({ ...fixture, joints: ["tail", ...fixture.joints.slice(1)] }),
    ).toBeNull();
    expect(reject({ ...fixture, pelvisShift: [0] })).toBeNull();
    expect(reject("not json")).toBeNull();
    expect(reasons.length).toBe(6);
    expect(reasons[1]).toBe(
      "frames does not match frameCount.; pelvisShift does not match frameCount.; contacts does not match frameCount.",
    );
    expect(reasons[2]).toBe("A frame has the wrong number of values.");
  });
});

describe("keyframePose", () => {
  test("at each frame's time, the angles rebuild that frame's quaternion", () => {
    for (let frame = 0; frame < 5; frame += 1) {
      const pose = keyframePose(clip, frame / clip.fps);
      for (const joint of JOINT_IDS) {
        const angle = rebuild(pose.joints[joint]).angleTo(frameQuaternion(frame, joint));
        expect(round(angle, 5)).toBe(0);
      }
      expect(pose.pelvisShift).toBe(fixture.pelvisShift[frame] ?? NaN);
    }
  });

  test("the first frame's left arm is forward 40° (the synthetic sway's value)", () => {
    const arm = keyframePose(clip, 0).joints.upperArmL;
    expect(round(arm.pitch * DEG, 1)).toBe(40);
    expect(round(arm.roll * DEG, 1)).toBe(0);
  });

  test("between frames it slerps: half way is equally far from both", () => {
    const pose = keyframePose(clip, 2.5 / clip.fps);
    const q = rebuild(pose.joints.lowerLegL);
    expect(round(q.angleTo(frameQuaternion(2, "lowerLegL")), 5)).toBe(
      round(q.angleTo(frameQuaternion(3, "lowerLegL")), 5),
    );
    expect(pose.pelvisShift).toBe(
      0.5 * ((fixture.pelvisShift[2] ?? NaN) + (fixture.pelvisShift[3] ?? NaN)),
    );
  });

  test("loops after the span less the crossfade, with no jump at the seam", () => {
    // 11 frames apart at 12 fps; the 0.5 s crossfade is capped to half of that.
    expect(round(clipSpan(clip))).toBe(0.916667);
    expect(round(loopCrossfade(clip))).toBe(0.458333);
    expect(round(loopPeriod(clip))).toBe(0.458333);
    expect(round(loopTime(clip, 1.2))).toBe(round(1.2 - 2 * loopPeriod(clip)));
    const period = loopPeriod(clip);
    const before = keyframePose(clip, period - 1e-6);
    const after = keyframePose(clip, period + 1e-6);
    for (const joint of JOINT_IDS) {
      expect(
        round(rebuild(before.joints[joint]).angleTo(rebuild(after.joints[joint])), 4),
      ).toBe(0);
    }
    // Once the crossfade is over, the second loop is the first one again.
    const again = keyframePose(clip, period + loopCrossfade(clip) + 0.01);
    const first = keyframePose(clip, loopCrossfade(clip) + 0.01);
    expect(round(again.joints.upperArmR.pitch)).toBe(round(first.joints.upperArmR.pitch));
  });

  test("joints the clip leaves out stay at rest", () => {
    const armsOnly = parseKeyframeClip({
      ...fixture,
      joints: ["upperArmL"],
      frames: fixture.frames.map((_, i) => [
        ...frameQuaternion(i, "upperArmL").toArray(),
      ]),
    }) as KeyframeClip;
    const pose = keyframePose(armsOnly, 0);
    expect(pose.joints.upperLegL).toEqual({ pitch: 0, roll: 0, yaw: 0 });
    expect(round(pose.joints.upperArmL.pitch * DEG, 1)).toBe(40);
  });

  test("quaternionToRotation inverts the angles applyPose builds", () => {
    const rotation = { pitch: 0.3, roll: -0.2, yaw: 0.5 };
    const back = quaternionToRotation(rebuild(rotation));
    expect([round(back.pitch), round(back.roll), round(back.yaw)]).toEqual([
      0.3, -0.2, 0.5,
    ]);
  });
});

describe("foot contacts", () => {
  test("the fixture's contacts come through: left planted from frame 8, right 2 to 5", () => {
    expect(clip.contacts?.footL).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
    expect(clip.contacts?.footR).toEqual([0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
  });

  test("a contact ramps in and out over 0.1 s round each change", () => {
    // At 10 fps frame k covers [k − 0.5, k + 0.5) / 10 s; contact from frame 3.
    const flags = [0, 0, 0, 1, 1, 1, 0, 0];
    expect(contactWeight(flags, 10, 0.1)).toBe(0);
    expect(contactWeight(flags, 10, 0.25)).toBe(0.5);
    expect(contactWeight(flags, 10, 0.4)).toBe(1);
    expect(contactWeight(flags, 10, 0.55)).toBe(0.5);
    expect(contactWeight(flags, 10, 0.7)).toBe(0);
  });

  test("each footfall is named by when it began", () => {
    const flags = [1, 1, 0, 0, 1, 1, 1, 0];
    expect(contactOnset(flags, 10, 0.1)).toBe(0);
    expect(contactOnset(flags, 10, 0.25)).toBe(-1);
    expect(contactOnset(flags, 10, 0.36)).toBe(0.4);
    expect(contactOnset(flags, 10, 0.6)).toBe(0.4);
  });

  test("the pose carries the weights and onsets; a clip without contacts carries none", () => {
    const pose = keyframePose(clip, 3 / 12);
    expect(pose.footContact).toEqual({ footL: 0, footR: 1, onsetL: -1, onsetR: 2 / 12 });
    const { contacts: _contacts, ...older } = fixture;
    const plain = parseKeyframeClip(older) as KeyframeClip;
    expect(plain.contacts).toBeNull();
    expect(keyframePose(plain, 3 / 12).footContact).toBeUndefined();
  });

  test("contacts of the wrong length or with other values are refused", () => {
    const reasons: string[] = [];
    const reject = (contacts: unknown) =>
      parseKeyframeClip(
        { ...fixture, contacts },
        (message) => void reasons.push(message),
      );
    expect(reject({ footL: [1], footR: fixture.contacts.footR })).toBeNull();
    expect(reject({ footL: fixture.contacts.footL.map(() => 2), footR: [] })).toBeNull();
    expect(reasons[0]).toBe("contacts does not match frameCount.");
  });
});
