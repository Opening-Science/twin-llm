import { Vector3 } from "three";

import { SIDES, type Joints, type PerSide, type SegmentId } from "../segments";

/**
 * A figure made of tubes, for tests: every size is chosen, so what the fit
 * measures can be checked against what was built. No person, scan or atlas
 * was used. Frame: metres, +Y up, +Z front, +X the figure's left, the hips'
 * midpoint at the origin.
 */
export type FigureShape = Readonly<{
  /** The hips' midpoint to the neck. */
  trunk: number;
  hipSpan: number;
  shoulderSpan: number;
  thigh: number;
  shin: number;
  foot: number;
  upperArm: number;
  forearm: number;
  hand: number;
  radius: Readonly<{ thigh: number; shin: number; upperArm: number; forearm: number }>;
  /** Half width and half depth of each trunk slab. */
  pelvis: Pair;
  abdomen: Pair;
  chest: Pair;
  neck: Pair;
  /** How far the abdomen's centre stands in front of the hips' line. */
  belly: number;
  head: Readonly<{ halfWidth: number; halfDepth: number; top: number }>;
  /** Degrees each arm and leg is held out from straight down. */
  armOut: number;
  legOut: number;
}>;
type Pair = readonly [number, number];

/** About a 1.75 m adult standing with arms and legs a little apart. */
export const AVERAGE_FIGURE: FigureShape = {
  trunk: 0.66,
  hipSpan: 0.18,
  shoulderSpan: 0.36,
  thigh: 0.43,
  shin: 0.4,
  foot: 0.2,
  upperArm: 0.29,
  forearm: 0.25,
  hand: 0.18,
  radius: { thigh: 0.075, shin: 0.05, upperArm: 0.045, forearm: 0.038 },
  pelvis: [0.17, 0.11],
  abdomen: [0.15, 0.1],
  chest: [0.16, 0.11],
  neck: [0.055, 0.06],
  belly: 0,
  head: { halfWidth: 0.075, halfDepth: 0.095, top: 0.2 },
  armOut: 25,
  legOut: 8,
};

/** A shorter, heavier figure: wide trunk, a belly, thick short limbs, arms further out. */
export const HEAVY_FIGURE: FigureShape = {
  trunk: 0.6,
  hipSpan: 0.22,
  shoulderSpan: 0.4,
  thigh: 0.38,
  shin: 0.36,
  foot: 0.21,
  upperArm: 0.27,
  forearm: 0.23,
  hand: 0.17,
  radius: { thigh: 0.1, shin: 0.06, upperArm: 0.06, forearm: 0.045 },
  pelvis: [0.21, 0.15],
  abdomen: [0.2, 0.17],
  chest: [0.19, 0.14],
  neck: [0.07, 0.075],
  belly: 0.05,
  head: { halfWidth: 0.08, halfDepth: 0.1, top: 0.21 },
  armOut: 35,
  legOut: 12,
};

export type Tube = Readonly<{
  segment: SegmentId;
  /** Rings of skin points from the tube's near end to its far end, each ring the same size. */
  rings: readonly (readonly Vector3[])[];
}>;

export type Figure = Readonly<{
  joints: Joints;
  toe: PerSide<Vector3>;
  finger: PerSide<Vector3>;
  tubes: readonly Tube[];
}>;

const RING = 24;
const STATIONS = 13;

/** Where the shoulders sit on the trunk line, and the slabs' ends, as in `segments.ts`. */
const SHOULDER_AT = 0.72;
const SPANS: Readonly<Record<"pelvis" | "abdomen" | "chest" | "neck", Pair>> = {
  pelvis: [-0.15, 0.15],
  abdomen: [0.15, 0.42],
  chest: [0.42, 0.8],
  neck: [0.8, 1],
};

/** Rings along a line; `size(s)` gives the half width and depth at share `s` of the way. */
const tube = (
  from: Vector3,
  to: Vector3,
  side: Vector3,
  size: (share: number) => Pair,
): Vector3[][] => {
  const axis = to.clone().sub(from).normalize();
  const left = side.clone().addScaledVector(axis, -side.dot(axis)).normalize();
  const front = new Vector3().crossVectors(left, axis);
  return Array.from({ length: STATIONS }, (_, station) => {
    const share = station / (STATIONS - 1);
    const [halfWidth, halfDepth] = size(share);
    const centre = from.clone().lerp(to, share);
    return Array.from({ length: RING }, (_unused, k) => {
      const angle = (2 * Math.PI * k) / RING;
      return centre
        .clone()
        .addScaledVector(left, halfWidth * Math.cos(angle))
        .addScaledVector(front, halfDepth * Math.sin(angle));
    });
  });
};

export const syntheticFigure = (shape: FigureShape): Figure => {
  const X = new Vector3(1, 0, 0);
  const Z = new Vector3(0, 0, 1);
  const up = (t: number, forward = 0): Vector3 =>
    new Vector3(0, t * shape.trunk, forward);
  const sided = <T>(pick: (sign: 1 | -1) => T): PerSide<T> =>
    Object.fromEntries(
      SIDES.map((side) => [side, pick(side === "L" ? 1 : -1)]),
    ) as PerSide<T>;
  const down = (degrees: number, sign: number): Vector3 => {
    const angle = (degrees * Math.PI) / 180;
    return new Vector3(sign * Math.sin(angle), -Math.cos(angle), 0);
  };
  const hip = sided((sign) => new Vector3((sign * shape.hipSpan) / 2, 0, 0));
  const shoulder = sided(
    (sign) => new Vector3((sign * shape.shoulderSpan) / 2, SHOULDER_AT * shape.trunk, 0),
  );
  const chain = (start: PerSide<Vector3>, degrees: number, length: number) =>
    sided((sign) =>
      start[sign === 1 ? "L" : "R"].clone().addScaledVector(down(degrees, sign), length),
    );
  const knee = chain(hip, shape.legOut, shape.thigh);
  const ankle = chain(knee, shape.legOut, shape.shin);
  const elbow = chain(shoulder, shape.armOut, shape.upperArm);
  const wrist = chain(elbow, shape.armOut, shape.forearm);
  const finger = chain(wrist, shape.armOut, shape.hand);
  const toe = sided((sign) =>
    ankle[sign === 1 ? "L" : "R"]
      .clone()
      .add(new Vector3(0, -0.3 * shape.foot, 0.954 * shape.foot)),
  );

  const even = (radius: number) => (): Pair => [radius, radius];
  /** Narrows to a point at the far end, so the tip is exactly where it was put. */
  const pointed =
    (radius: number) =>
    (share: number): Pair => [radius * (1 - share), radius * (1 - share)];
  const slab = (id: keyof typeof SPANS, forward: number): Tube => ({
    segment: id,
    rings: tube(up(SPANS[id][0], forward), up(SPANS[id][1], forward), X, () => shape[id]),
  });
  const neck = up(1);
  const crown = neck.clone().add(new Vector3(0, shape.head.top, 0));
  const head: Tube = {
    segment: "head",
    // Widest at mid height, a point at the crown.
    rings: tube(neck, crown, X, (share) => {
      const wide = Math.sqrt(Math.max(0, 1 - (2 * Math.max(share, 0.5) - 1) ** 2));
      return [shape.head.halfWidth * wide, shape.head.halfDepth * wide];
    }),
  };
  const limbs = SIDES.flatMap((side): Tube[] => [
    {
      segment: `thigh${side}`,
      rings: tube(hip[side], knee[side], X, even(shape.radius.thigh)),
    },
    {
      segment: `shin${side}`,
      rings: tube(knee[side], ankle[side], X, even(shape.radius.shin)),
    },
    { segment: `foot${side}`, rings: tube(ankle[side], toe[side], X, pointed(0.04)) },
    {
      segment: `upperArm${side}`,
      rings: tube(shoulder[side], elbow[side], Z, even(shape.radius.upperArm)),
    },
    {
      segment: `forearm${side}`,
      rings: tube(elbow[side], wrist[side], Z, even(shape.radius.forearm)),
    },
    { segment: `hand${side}`, rings: tube(wrist[side], finger[side], Z, pointed(0.035)) },
  ]);
  return {
    joints: { hip, knee, ankle, shoulder, elbow, wrist, neck },
    toe,
    finger,
    tubes: [
      slab("pelvis", 0),
      slab("abdomen", shape.belly),
      slab("chest", 0),
      slab("neck", 0),
      head,
      ...limbs,
    ],
  };
};
