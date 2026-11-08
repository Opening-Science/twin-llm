/**
 * Where the feet stand, side to side, and how far to turn a leg to move them.
 *
 * The atlas fit (`fit.ts`) scales and places a donor atlas but never bends
 * it, and the donors' feet stand closer together (BodyParts3D) or a little
 * further apart than the ANNY demo bodies'. So the demo body is posed
 * instead: each hip turns until its ankle stands over the atlas's ankle
 * (`DEMO_STANCE`, per atlas). Everything
 * here is plain geometry in the scan frame (metres, +Z up, +X the subject's
 * left), so it is tested without rendering.
 */
import { type DemoBodyId } from "./demo-bodies";
import { type AtlasId } from "./manifest";

export type Point3 = Readonly<{ x: number; y: number; z: number }>;

/** Side-to-side position (x) of each ankle, or null when nothing was found on that side. */
export type AnkleCentres = Readonly<{ left: number | null; right: number | null }>;

/**
 * The ankle slab as fractions of body height above the floor: above the sole
 * and the arch, below the calf. Every atlas and body is cut at the same
 * fraction, so a narrow and a wide stance are compared at the same level.
 */
export const ANKLE_BAND: readonly [number, number] = [0.04, 0.07];

/**
 * The mean x of the points in the ankle slab, per side of `midX`: the centre
 * of each ankle seen from the front, whatever the points are (skin, vessels).
 */
export const ankleCentres = (
  points: Iterable<Point3>,
  frame: Readonly<{ floorZ: number; height: number; midX: number }>,
  band: readonly [number, number] = ANKLE_BAND,
): AnkleCentres => {
  const low = frame.floorZ + band[0] * frame.height;
  const high = frame.floorZ + band[1] * frame.height;
  const sum = { left: 0, right: 0 };
  const count = { left: 0, right: 0 };
  for (const point of points) {
    if (point.z < low || point.z > high) continue;
    const side = point.x >= frame.midX ? "left" : "right";
    sum[side] += point.x;
    count[side] += 1;
  }
  return {
    left: count.left > 0 ? sum.left / count.left : null,
    right: count.right > 0 ? sum.right / count.right : null,
  };
};

/** Left ankle to right ankle, side to side; null when either is missing. */
export const ankleSpread = (ankles: AnkleCentres): number | null =>
  ankles.left === null || ankles.right === null ? null : ankles.left - ankles.right;

/**
 * How far each body ankle stands outside (positive) or inside (negative) the
 * atlas ankle on its side, in metres.
 */
export const ankleOffsets = (
  body: AnkleCentres,
  atlas: AnkleCentres,
): Readonly<{ left: number | null; right: number | null }> => ({
  left: body.left === null || atlas.left === null ? null : body.left - atlas.left,
  right: body.right === null || atlas.right === null ? null : atlas.right - body.right,
});

/**
 * The inward turn (radians, front view) that brings a leg hanging from `hip`
 * to `ankle` over `targetX`, keeping its length in the frontal plane. Positive
 * moves the ankle toward the midline, for either leg; `midX` says which side
 * the leg is on. Null when the target is out of reach.
 */
export const adductionToReach = (
  hip: Readonly<{ x: number; z: number }>,
  ankle: Readonly<{ x: number; z: number }>,
  targetX: number,
  midX: number,
): number | null => {
  const length = Math.hypot(ankle.x - hip.x, ankle.z - hip.z);
  if (!(length > 0)) return null;
  const outward = Math.sign(hip.x - midX) || 1;
  const now = (outward * (ankle.x - hip.x)) / length;
  const wanted = (outward * (targetX - hip.x)) / length;
  if (Math.abs(wanted) > 1) return null;
  return Math.asin(now) - Math.asin(wanted);
};

export type DemoStance = Readonly<{
  /** Each hip turned inward, degrees, front view; the ankle turns back so the sole stays flat. */
  hipAdductionDeg: number;
}>;

/**
 * The stance each rigged demo body is posed to, per atlas, from
 * `adductionToReach` on the pinned files: ANNY's own ankles are 44.5 cm
 * (male) and 35.0 cm (female) apart; BodyParts3D's about 15 cm, HRA's 30 to
 * 43 cm. A negative angle turns the legs outward. The measurement is in
 * docs/anatomy.md.
 */
export const DEMO_STANCE: Readonly<
  Record<DemoBodyId, Readonly<Record<AtlasId, DemoStance>>>
> = {
  "anny-adult-m": {
    bodyparts3d: { hipAdductionDeg: 9.1 },
    "hra-f": { hipAdductionDeg: 3.6 },
    "hra-m": { hipAdductionDeg: 0.3 },
  },
  "anny-adult-f": {
    bodyparts3d: { hipAdductionDeg: 7.1 },
    "hra-f": { hipAdductionDeg: 1.6 },
    "hra-m": { hipAdductionDeg: -1.8 },
  },
};
