import { Euler, Quaternion } from "three";
import { z } from "zod";

import { type BodyPose, JOINT_IDS, type JointId, type JointRotation } from "./gait";

/**
 * Keyframe clips: joint rotations sampled from a recording, as written by
 * `python/motion/video_to_clip.py` (pose estimation on a video, on this
 * machine). Unlike the computed clips in `gait.ts` and `dance.ts` they are
 * data, so a clip is parsed and checked here before it plays.
 *
 * Each frame holds, per joint, a quaternion (x, y, z, w) in the body frame of
 * `gait.ts` (x left, y up, z forward): the joint's rotation relative to its
 * parent, on top of the bind pose. Between frames the player slerps; at the end
 * it loops, crossfading the last `crossfadeS` seconds into the first so the
 * seam does not jump. The pose comes out as the same pitch / roll / yaw angles
 * the other clips use, so `weighPose` and `applyPose` treat it like any clip.
 *
 * A clip may also say, per frame, which feet are planted (`contacts`, absent
 * in older clips). The pose then carries a contact weight per foot that ramps
 * over `CONTACT_RAMP_S` round each change, and `foot-contact.ts` holds a
 * planted foot on the floor.
 */

export const KEYFRAME_CLIP_FORMAT = "twinllm.motion-clip";
/** A clip larger than this is refused before parsing (an hour at 30 fps is ~30 MB). */
export const KEYFRAME_CLIP_MAX_BYTES = 32 * 1024 * 1024;
/** Seconds over which a foot's contact weight rises or falls. */
export const CONTACT_RAMP_S = 0.1;

const finite = z.number().finite();

export const keyframeClipSchema = z
  .object({
    format: z.literal(KEYFRAME_CLIP_FORMAT),
    version: z.literal(1),
    name: z.string().min(1).max(80),
    fps: z.number().positive().max(240),
    frameCount: z.number().int().min(2),
    loop: z.object({ crossfadeS: z.number().min(0).max(5) }),
    joints: z.array(z.enum(JOINT_IDS)).min(1),
    frames: z.array(z.array(finite)),
    pelvisShift: z.array(finite),
    contacts: z
      .object({
        footL: z.array(z.union([z.literal(0), z.literal(1)])),
        footR: z.array(z.union([z.literal(0), z.literal(1)])),
      })
      .optional(),
    source: z.record(z.string(), z.unknown()),
    licence: z.string().min(1),
    generator: z.record(z.string(), z.unknown()),
  })
  .superRefine((clip, ctx) => {
    if (new Set(clip.joints).size !== clip.joints.length) {
      ctx.addIssue({ code: "custom", message: "A joint is listed twice." });
    }
    if (clip.frames.length !== clip.frameCount) {
      ctx.addIssue({ code: "custom", message: "frames does not match frameCount." });
    }
    if (clip.pelvisShift.length !== clip.frameCount) {
      ctx.addIssue({ code: "custom", message: "pelvisShift does not match frameCount." });
    }
    if (
      clip.contacts &&
      (clip.contacts.footL.length !== clip.frameCount ||
        clip.contacts.footR.length !== clip.frameCount)
    ) {
      ctx.addIssue({ code: "custom", message: "contacts does not match frameCount." });
    }
    const width = clip.joints.length * 4;
    if (clip.frames.some((row) => row.length !== width)) {
      ctx.addIssue({
        code: "custom",
        message: "A frame has the wrong number of values.",
      });
    }
  });

export type KeyframeClipFile = z.infer<typeof keyframeClipSchema>;

/** A parsed clip, ready to sample: one quaternion track per joint it moves. */
export type KeyframeClip = Readonly<{
  name: string;
  fps: number;
  frameCount: number;
  crossfadeS: number;
  /** Per joint, the frames' quaternions; joints the clip leaves out stay at rest. */
  tracks: ReadonlyMap<JointId, readonly Quaternion[]>;
  pelvisShift: readonly number[];
  /** Per foot, 1 for each frame it is planted; null for a clip without contacts. */
  contacts: Readonly<{ footL: readonly number[]; footR: readonly number[] }> | null;
  licence: string;
}>;

/** The clip, or null when the value is not a valid clip (the reason goes to `onError`). */
export const parseKeyframeClip = (
  value: unknown,
  onError: (message: string) => void = () => {},
): KeyframeClip | null => {
  const parsed = keyframeClipSchema.safeParse(value);
  if (!parsed.success) {
    onError(parsed.error.issues.map((issue) => issue.message).join("; "));
    return null;
  }
  const file = parsed.data;
  const tracks = new Map<JointId, readonly Quaternion[]>(
    file.joints.map((joint, j) => [
      joint,
      file.frames.map((row) =>
        new Quaternion(
          row[j * 4] ?? 0,
          row[j * 4 + 1] ?? 0,
          row[j * 4 + 2] ?? 0,
          row[j * 4 + 3] ?? 1,
        ).normalize(),
      ),
    ]),
  );
  return {
    name: file.name,
    fps: file.fps,
    frameCount: file.frameCount,
    crossfadeS: file.loop.crossfadeS,
    tracks,
    pelvisShift: file.pelvisShift,
    contacts: file.contacts ?? null,
    licence: file.licence,
  };
};

/** Seconds from the first frame to the last. */
export const clipSpan = (clip: KeyframeClip): number => (clip.frameCount - 1) / clip.fps;

/** The crossfade actually used: at most half the clip. */
export const loopCrossfade = (clip: KeyframeClip): number =>
  Math.min(clip.crossfadeS, clipSpan(clip) / 2);

/** Seconds per loop: the span less the crossfade, which overlaps the start. */
export const loopPeriod = (clip: KeyframeClip): number =>
  clipSpan(clip) - loopCrossfade(clip);

const smoothstep = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

type Contact = Readonly<{ footL: number; footR: number; onsetL: number; onsetR: number }>;

type Sample = Readonly<{
  quats: ReadonlyMap<JointId, Quaternion>;
  shift: number;
  contact: Contact | null;
}>;

/**
 * How planted a foot is at `s` seconds: the share of the `CONTACT_RAMP_S`
 * window round `s` its frames are in contact (each frame covering the time
 * nearest to it), so a change ramps linearly across the window.
 */
export const contactWeight = (
  flags: readonly number[],
  fps: number,
  s: number,
): number => {
  const steps = 10;
  const inContact = Array.from({ length: steps }, (_, k) => {
    const at = s + CONTACT_RAMP_S * ((k + 0.5) / steps - 0.5);
    const frame = Math.min(flags.length - 1, Math.max(0, Math.round(at * fps)));
    return flags[frame] ?? 0;
  });
  return inContact.reduce((sum, flag) => sum + flag, 0) / steps;
};

/**
 * When the contact a foot is in (or ramping into or out of) at `s` began, in
 * seconds from the clip's first frame; -1 when there is none. A new value
 * means a new footfall, which lands somewhere new.
 */
export const contactOnset = (
  flags: readonly number[],
  fps: number,
  s: number,
): number => {
  const frameAt = (at: number) =>
    Math.min(flags.length - 1, Math.max(0, Math.round(at * fps)));
  const ahead = frameAt(s + CONTACT_RAMP_S / 2);
  const behind = frameAt(s - CONTACT_RAMP_S / 2);
  const start = [frameAt(s), ahead, behind].find((frame) => flags[frame] === 1);
  if (start === undefined) return -1;
  let first = start;
  while (first > 0 && flags[first - 1] === 1) first -= 1;
  return first / fps;
};

/** The clip at `s` seconds from its first frame, held at the ends (no loop). */
const sampleAt = (clip: KeyframeClip, s: number): Sample => {
  const position = Math.min(Math.max(s * clip.fps, 0), clip.frameCount - 1);
  const i = Math.floor(position);
  const j = Math.min(i + 1, clip.frameCount - 1);
  const u = position - i;
  const quats = new Map<JointId, Quaternion>();
  for (const [joint, track] of clip.tracks) {
    const a = track[i];
    const b = track[j];
    if (a && b) quats.set(joint, a.clone().slerp(b, u));
  }
  const shiftA = clip.pelvisShift[i] ?? 0;
  const shiftB = clip.pelvisShift[j] ?? 0;
  const contact = clip.contacts
    ? {
        footL: contactWeight(clip.contacts.footL, clip.fps, s),
        footR: contactWeight(clip.contacts.footR, clip.fps, s),
        onsetL: contactOnset(clip.contacts.footL, clip.fps, s),
        onsetR: contactOnset(clip.contacts.footR, clip.fps, s),
      }
    : null;
  return { quats, shift: shiftA + (shiftB - shiftA) * u, contact };
};

const blendSamples = (a: Sample, b: Sample, u: number): Sample => {
  const quats = new Map<JointId, Quaternion>();
  for (const [joint, qa] of a.quats) {
    const qb = b.quats.get(joint);
    quats.set(joint, qb ? qa.clone().slerp(qb, u) : qa);
  }
  const contact =
    a.contact && b.contact
      ? {
          footL: a.contact.footL + (b.contact.footL - a.contact.footL) * u,
          footR: a.contact.footR + (b.contact.footR - a.contact.footR) * u,
          // The seam is one footfall when both sides of it are planted.
          onsetL: u < 0.5 ? a.contact.onsetL : b.contact.onsetL,
          onsetR: u < 0.5 ? a.contact.onsetR : b.contact.onsetR,
        }
      : a.contact;
  return { quats, shift: a.shift + (b.shift - a.shift) * u, contact };
};

const euler = new Euler();

/**
 * A body-frame quaternion as the clips' angles. `applyPose` builds
 * Ry(yaw) · Rz(roll) · Rx(−pitch), three.js's "YZX" order, so this is its inverse.
 */
export const quaternionToRotation = (q: Quaternion): JointRotation => {
  euler.setFromQuaternion(q, "YZX");
  return { pitch: -euler.x + 0, roll: euler.z + 0, yaw: euler.y + 0 };
};

const REST: JointRotation = { pitch: 0, roll: 0, yaw: 0 };

/** Where in the clip time `t` (seconds since it started) falls, looping. */
export const loopTime = (clip: KeyframeClip, t: number): number => {
  const period = loopPeriod(clip);
  if (period <= 0) return 0;
  return t - period * Math.floor(t / period);
};

/**
 * The clip at `t` seconds since it started. Over the first `crossfade`
 * seconds of every loop after the first, the tail of the clip fades into its
 * start, so the seam is continuous.
 */
export const keyframePose = (clip: KeyframeClip, t: number): BodyPose => {
  const s = loopTime(clip, t);
  const fade = loopCrossfade(clip);
  const head = sampleAt(clip, s);
  const sample =
    fade > 0 && s < fade && t >= loopPeriod(clip)
      ? blendSamples(sampleAt(clip, loopPeriod(clip) + s), head, smoothstep(s / fade))
      : head;
  return {
    joints: Object.fromEntries(
      JOINT_IDS.map((id) => {
        const q = sample.quats.get(id);
        return [id, q ? quaternionToRotation(q) : REST];
      }),
    ) as Record<JointId, JointRotation>,
    pelvisShift: sample.shift,
    ...(sample.contact ? { footContact: sample.contact } : {}),
  };
};
