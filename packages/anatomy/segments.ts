import { Matrix4, Vector3 } from "three";

/**
 * A figure cut into seventeen segments, and the maths that fits one figure's
 * segments onto another's.
 *
 * The atlas and the body are each described by the same joints (`Joints`) and
 * the same outline of their skin (`SkinMeasure`). The joints say where each
 * segment begins and ends; the skin says where its centre line runs and how
 * wide and deep it is. So a segment sits in the middle of the skin whatever
 * the skeleton's joints are like, and a joint only has to be at the right
 * height along the limb. `buildSegments` makes a box per segment,
 * `fitMatrices` the affine map that lays each atlas box on the body's, and
 * `skinWeights` says which one or two segments each atlas vertex follows.
 *
 * Everything is plain geometry in whatever frame the joints are given in, so
 * the atlas (+Y up) and a scan (+Z up) need no special case.
 */
export const SIDES = ["L", "R"] as const;
export type Side = (typeof SIDES)[number];
export type PerSide<T> = Readonly<Record<Side, T>>;

/** Joint centres. The neck is where the head turns on it. */
export type Joints = Readonly<{
  hip: PerSide<Vector3>;
  knee: PerSide<Vector3>;
  ankle: PerSide<Vector3>;
  shoulder: PerSide<Vector3>;
  elbow: PerSide<Vector3>;
  wrist: PerSide<Vector3>;
  neck: Vector3;
}>;

const SLAB_IDS = ["pelvis", "abdomen", "chest", "neck"] as const;
const LIMB_IDS = ["thigh", "shin", "foot", "upperArm", "forearm", "hand"] as const;

type SlabId = (typeof SLAB_IDS)[number];
type LimbId = (typeof LIMB_IDS)[number];
export type SegmentId = SlabId | "head" | `${LimbId}${Side}`;

export const SEGMENT_IDS: readonly SegmentId[] = [
  ...SLAB_IDS,
  "head",
  ...SIDES.flatMap((side) => LIMB_IDS.map((limb) => `${limb}${side}` as const)),
];

export type Segment = Readonly<{
  /** The centre of the segment's near end. */
  origin: Vector3;
  /** Unit vectors: along the segment, across it, and front to back (left × axis). */
  axis: Vector3;
  left: Vector3;
  front: Vector3;
  length: number;
  halfWidth: number;
  halfDepth: number;
}>;

export type Segments = Readonly<Record<SegmentId, Segment>>;

type Pair = readonly [number, number];

/**
 * A segment's outline seen along it: where the skin's centre lies from the
 * joint line (across, front to back) at the segment's near and far ends, and
 * the outline's half sizes.
 */
export type Section = Readonly<{
  near: Pair;
  far: Pair;
  halfWidth: number;
  halfDepth: number;
}>;

/** What the skin adds to the joints. Lengths in the joints' unit. */
export type SkinMeasure = Readonly<{
  section: Readonly<Record<SegmentId, Section>>;
  /** The crown's height above the neck. */
  top: number;
  toe: PerSide<Vector3>;
  finger: PerSide<Vector3>;
  /** The way each palm faces: a unit vector across the hand. */
  palm: PerSide<Vector3>;
}>;

/**
 * The trunk slabs as shares of the line from the hips' midpoint to the neck:
 * where each slab runs, and the part of it whose outline is measured. The
 * chest is measured below the armpits, so the shoulders do not widen it.
 */
const SLABS: Readonly<Record<SlabId, Readonly<{ span: Pair; girth: Pair }>>> = {
  pelvis: { span: [-0.15, 0.15], girth: [-0.05, 0.15] },
  abdomen: { span: [0.15, 0.42], girth: [0.15, 0.42] },
  chest: { span: [0.42, 0.8], girth: [0.42, 0.6] },
  neck: { span: [0.8, 1], girth: [0.84, 0.93] },
};
/**
 * The head runs from the crown down past the neck joint by this share of the
 * crown's height, so the jaw in front of the neck belongs to it. The skull
 * is measured above jaw and neck; a foot or hand over its middle half.
 */
const JAW = 0.3;
const SKULL: Pair = [0.54, 1];
const MID: Pair = [0.25, 0.75];
/**
 * A long limb is measured near each end: its centre line runs through the
 * two centres, and its girth is the far end's, where the bones lie closest
 * under the skin (knee, ankle, elbow, wrist).
 */
const ENDS: readonly [Pair, Pair] = [
  [0.05, 0.35],
  [0.65, 0.95],
];
/** Outlines run between these percentiles, so a stray vertex does not set them. */
const OUTLINE: Pair = [0.02, 0.98];
/** How much "forward" counts against "toward the midline" when a palm's facing is signed. */
const PALM_FORWARD = 0.3;

/** Half width and depth as shares of the trunk line, used until the skin has been measured. */
const NOMINAL: Readonly<Record<SlabId | "head" | LimbId, Pair>> = {
  pelvis: [0.22, 0.15],
  abdomen: [0.22, 0.15],
  chest: [0.22, 0.15],
  neck: [0.08, 0.08],
  head: [0.11, 0.135],
  thigh: [0.11, 0.11],
  shin: [0.07, 0.07],
  foot: [0.06, 0.05],
  upperArm: [0.062, 0.062],
  forearm: [0.052, 0.052],
  hand: [0.05, 0.05],
};
/** Until measured: the crown's height, a foot's length and a hand's, as shares of the trunk line. */
const NOMINAL_END = { top: 0.3, foot: 0.27, hand: 0.25 } as const;

export type TrunkFrame = Readonly<{
  hips: Vector3;
  axis: Vector3;
  left: Vector3;
  front: Vector3;
  length: number;
}>;

/** `v` without its part along the unit vector `axis`, normalised. */
const across = (v: Vector3, axis: Vector3): Vector3 =>
  v.clone().addScaledVector(axis, -v.dot(axis)).normalize();

/** Up from the hips to the neck, left from the right hip to the left, front their cross product. */
export const trunkFrame = (joints: Joints): TrunkFrame => {
  const hips = joints.hip.L.clone().add(joints.hip.R).multiplyScalar(0.5);
  const line = joints.neck.clone().sub(hips);
  const axis = line.clone().normalize();
  const left = across(joints.hip.L.clone().sub(joints.hip.R), axis);
  return {
    hips,
    axis,
    left,
    front: new Vector3().crossVectors(left, axis),
    length: line.length(),
  };
};

/** A segment's line and directions, before its outline is known. */
type Line = Pick<Segment, "origin" | "axis" | "left" | "front" | "length">;

const lineBetween = (from: Vector3, to: Vector3, side: Vector3): Line => {
  const along = to.clone().sub(from);
  const axis = along.clone().normalize();
  const left = across(side, axis);
  return {
    origin: from.clone(),
    axis,
    left,
    front: new Vector3().crossVectors(left, axis),
    length: along.length(),
  };
};

const limbOf = (id: SegmentId): LimbId | null =>
  LIMB_IDS.find((limb) => id.startsWith(limb)) ?? null;

const sideOf = (id: SegmentId): Side => (id.endsWith("L") ? "L" : "R");

type Ends = Readonly<{
  top: number;
  toe: PerSide<Vector3>;
  finger: PerSide<Vector3>;
  palm: PerSide<Vector3> | null;
}>;

/**
 * Each segment's line between its joints. A trunk slab and the head keep the
 * trunk's directions. A limb's "left" is the trunk's left for a leg and the
 * trunk's front for an arm, each taken across the limb: the direction a leg
 * swung forward or an arm raised sideways keeps, so the atlas's limb and the
 * body's are turned onto each other without a twist. A hand's "left" is the
 * way its palm faces, once that is known.
 */
const jointLines = (
  joints: Joints,
  ends: Ends | null,
): Readonly<Record<SegmentId, Line>> => {
  const trunk = trunkFrame(joints);
  const unit = trunk.length;
  const up = (t: number): Vector3 =>
    trunk.hips.clone().addScaledVector(trunk.axis, t * unit);
  const limbs = SIDES.flatMap((side) => {
    const toe =
      ends?.toe[side] ??
      joints.ankle[side]
        .clone()
        .addScaledVector(trunk.front, 0.93 * NOMINAL_END.foot * unit)
        .addScaledVector(trunk.axis, -0.37 * NOMINAL_END.foot * unit);
    const forearm = joints.wrist[side].clone().sub(joints.elbow[side]).normalize();
    const finger =
      ends?.finger[side] ??
      joints.wrist[side].clone().addScaledVector(forearm, NOMINAL_END.hand * unit);
    const { hip, knee, ankle, shoulder, elbow, wrist } = joints;
    return [
      [`thigh${side}`, lineBetween(hip[side], knee[side], trunk.left)],
      [`shin${side}`, lineBetween(knee[side], ankle[side], trunk.left)],
      [`foot${side}`, lineBetween(ankle[side], toe, trunk.left)],
      [`upperArm${side}`, lineBetween(shoulder[side], elbow[side], trunk.front)],
      [`forearm${side}`, lineBetween(elbow[side], wrist[side], trunk.front)],
      [
        `hand${side}`,
        lineBetween(wrist[side], finger, ends?.palm?.[side] ?? trunk.front),
      ],
    ] as const;
  });
  const slab = (from: number, to: number): Line =>
    lineBetween(up(from), up(to), trunk.left);
  const crown = (ends?.top ?? NOMINAL_END.top * unit) / unit;
  return {
    ...(Object.fromEntries(SLAB_IDS.map((id) => [id, slab(...SLABS[id].span)])) as Record<
      SlabId,
      Line
    >),
    head: slab(1 - JAW * crown, 1 + crown),
    ...Object.fromEntries(limbs),
  } as Record<SegmentId, Line>;
};

/**
 * The seventeen segments of a figure: each joint line moved onto the skin's
 * centre line and given the outline's half sizes. Without `skin` the sizes
 * are nominal shares of the trunk line: good enough to tell which segment a
 * skin point belongs to, which is what measuring the skin needs first.
 */
export const buildSegments = (joints: Joints, skin: SkinMeasure | null): Segments => {
  const unit = trunkFrame(joints).length;
  const hipSpan = joints.hip.L.distanceTo(joints.hip.R);
  return Object.fromEntries(
    Object.entries(jointLines(joints, skin)).map(([key, joint]) => {
      const id = key as SegmentId;
      const section = skin?.section[id];
      if (!section) {
        const [width, depth] = NOMINAL[limbOf(id) ?? (id as SlabId | "head")];
        return [id, { ...joint, halfWidth: width * unit, halfDepth: depth * unit }];
      }
      // The pelvis keeps the hips' line across and is as wide as the hip
      // joints stand apart, so the thigh bones meet it.
      const pelvis = id === "pelvis";
      const end = (start: Vector3, [x, y]: Pair): Vector3 =>
        start
          .clone()
          .addScaledVector(joint.left, pelvis ? 0 : x)
          .addScaledVector(joint.front, y);
      const far = joint.origin.clone().addScaledVector(joint.axis, joint.length);
      return [
        id,
        {
          ...lineBetween(
            end(joint.origin, section.near),
            end(far, section.far),
            joint.left,
          ),
          halfWidth: pelvis ? 0.8 * hipSpan : section.halfWidth,
          halfDepth: section.halfDepth,
        },
      ];
    }),
  ) as Segments;
};

/** Numbers per segment in the packed form the per-vertex loops read. */
const PACK = 15;

const pack = (segments: Segments): Float64Array =>
  Float64Array.from(
    SEGMENT_IDS.flatMap((id) => {
      const s = segments[id];
      return [
        ...s.origin.toArray(),
        ...s.axis.toArray(),
        ...s.left.toArray(),
        ...s.front.toArray(),
        s.length,
        1 / s.halfWidth,
        1 / s.halfDepth,
      ];
    }),
  );

/**
 * How far a point is from segment `index`, squared, in units of the
 * segment's own half width and depth: 0 on its line, 1 on its surface. Past
 * either end the distance to the end counts too.
 */
const distance2 = (
  packed: Float64Array,
  index: number,
  x: number,
  y: number,
  z: number,
): number => {
  const o = index * PACK;
  const dx = x - packed[o]!;
  const dy = y - packed[o + 1]!;
  const dz = z - packed[o + 2]!;
  const along = dx * packed[o + 3]! + dy * packed[o + 4]! + dz * packed[o + 5]!;
  const side =
    (dx * packed[o + 6]! + dy * packed[o + 7]! + dz * packed[o + 8]!) * packed[o + 13]!;
  const depth =
    (dx * packed[o + 9]! + dy * packed[o + 10]! + dz * packed[o + 11]!) * packed[o + 14]!;
  const length = packed[o + 12]!;
  const past =
    (along < 0 ? -along : along > length ? along - length : 0) *
    Math.max(packed[o + 13]!, packed[o + 14]!);
  return side * side + depth * depth + past * past;
};

const COUNT = SEGMENT_IDS.length;

/** The index in `SEGMENT_IDS` of the segment each point (x, y, z triples) is nearest to. */
export const labelPoints = (points: Float32Array, segments: Segments): Uint8Array => {
  const packed = pack(segments);
  return Uint8Array.from({ length: points.length / 3 }, (_, i) => {
    let best = 0;
    let least = Infinity;
    for (let s = 0; s < COUNT; s += 1) {
      const d = distance2(
        packed,
        s,
        points[3 * i]!,
        points[3 * i + 1]!,
        points[3 * i + 2]!,
      );
      if (d < least) {
        least = d;
        best = s;
      }
    }
    return best;
  });
};

/** How quickly a vertex passes from one segment to the next, in segment radii. */
const BLEND = 0.1;

/**
 * Skin weights for points (x, y, z triples): the two nearest segments, the
 * nearer one stronger, as three.js wants them (four slots per vertex, bytes
 * that sum to 255). A vertex on a segment's line follows that segment alone;
 * one at a joint's surface follows both halves.
 */
export const skinWeights = (
  points: Float32Array,
  segments: Segments,
): Readonly<{ index: Uint8Array; weight: Uint8Array }> => {
  const packed = pack(segments);
  const count = points.length / 3;
  const index = new Uint8Array(4 * count);
  const weight = new Uint8Array(4 * count);
  for (let i = 0; i < count; i += 1) {
    let first = 0;
    let second = 0;
    let least = Infinity;
    let next = Infinity;
    for (let s = 0; s < COUNT; s += 1) {
      const d = distance2(
        packed,
        s,
        points[3 * i]!,
        points[3 * i + 1]!,
        points[3 * i + 2]!,
      );
      if (d < least) {
        next = least;
        second = first;
        least = d;
        first = s;
      } else if (d < next) {
        next = d;
        second = s;
      }
    }
    const share = Math.round(
      255 / (1 + Math.exp((Math.sqrt(next) - Math.sqrt(least)) / BLEND)),
    );
    index[4 * i] = first;
    index[4 * i + 1] = second;
    weight[4 * i] = 255 - share;
    weight[4 * i + 1] = share;
  }
  return { index, weight };
};

/** The outline of some points seen along a segment: its centre and half sizes. */
type Outline = Readonly<{ centre: Pair; half: Pair }>;

const outlineOf = (xs: readonly number[], ys: readonly number[]): Outline | null => {
  if (xs.length < 8) return null;
  const span = (values: readonly number[]): Pair => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (share: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
    return [at(OUTLINE[0]), at(OUTLINE[1])];
  };
  const x = span(xs);
  const y = span(ys);
  return {
    centre: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2],
    half: [(x[1] - x[0]) / 2, (y[1] - y[0]) / 2],
  };
};

/** The parts of a segment's length whose outline is measured, as shares of it. */
const measuredParts = (id: SegmentId): readonly Pair[] => {
  if (id === "head") return [SKULL];
  const limb = limbOf(id);
  if (limb === null) return [SLABS[id as SlabId].girth];
  return limb === "foot" || limb === "hand" ? [MID] : ENDS;
};

const isArm = (id: SegmentId): boolean => /^(upperArm|forearm|hand)/.test(id);

/**
 * Measures a figure's skin against its joints. `points` are skin vertices
 * (x, y, z triples) and `labels` the segment each belongs to, as an index
 * into `SEGMENT_IDS`. A trunk slab's outline is taken from every point at
 * its height that is not an arm's; a limb's and the head's from their own
 * points. Null when a part has too few points to measure.
 */
export const measureSkin = (
  points: Float32Array,
  labels: Uint8Array,
  joints: Joints,
): SkinMeasure | null => {
  const trunk = trunkFrame(joints);
  const p = new Vector3();
  const d = new Vector3();
  const each = (visit: (id: SegmentId) => void): void => {
    for (let i = 0; i < labels.length; i += 1) {
      p.fromArray(points, 3 * i);
      visit(SEGMENT_IDS[labels[i]!]!);
    }
  };

  // First the ends that only the skin knows: the crown, the toes, the fingertips.
  const tips = new Map<SegmentId, Readonly<{ point: Vector3; reach: number }>>();
  let top = 0;
  each((id) => {
    if (id === "head") top = Math.max(top, d.copy(p).sub(joints.neck).dot(trunk.axis));
    const limb = limbOf(id);
    if (limb !== "foot" && limb !== "hand") return;
    const from = limb === "foot" ? joints.ankle[sideOf(id)] : joints.wrist[sideOf(id)];
    const reach = p.distanceTo(from);
    if (reach > (tips.get(id)?.reach ?? 0)) tips.set(id, { point: p.clone(), reach });
  });
  const tip = (limb: "foot" | "hand"): PerSide<Vector3> | null => {
    const left = tips.get(`${limb}L`);
    const right = tips.get(`${limb}R`);
    return left && right ? { L: left.point, R: right.point } : null;
  };
  const toe = tip("foot");
  const finger = tip("hand");
  if (!toe || !finger || top <= 0) return null;

  // Then the way each palm faces: across the hand, the direction it is thinnest in.
  const unturned = jointLines(joints, { top, toe, finger, palm: null });
  const spread = { L: [0, 0, 0, 0, 0, 0], R: [0, 0, 0, 0, 0, 0] };
  each((id) => {
    if (limbOf(id) !== "hand") return;
    const hand = unturned[id];
    d.copy(p).sub(hand.origin);
    const x = d.dot(hand.left);
    const y = d.dot(hand.front);
    const sums = spread[sideOf(id)];
    [1, x, y, x * x, y * y, x * y].forEach((value, i) => {
      sums[i]! += value;
    });
  });
  const palmOf = (side: Side): Vector3 => {
    const [, x, y, xx, yy, xy] = spread[side].map((sum) => sum / spread[side][0]!) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const hand = unturned[`hand${side}`];
    // The wide direction of the points' spread across the hand; the thin one is a quarter turn on.
    const wide = Math.atan2(2 * (xy - x * y), xx - x * x - (yy - y * y)) / 2;
    const normal = hand.left
      .clone()
      .multiplyScalar(-Math.sin(wide))
      .addScaledVector(hand.front, Math.cos(wide));
    // A palm faces the body's midline, or forward when it faces neither side.
    const facing = across(
      trunk.hips.clone().sub(hand.origin),
      trunk.axis,
    ).addScaledVector(trunk.front, PALM_FORWARD);
    return normal.dot(facing) < 0 ? normal.negate() : normal;
  };
  const palm = { L: palmOf("L"), R: palmOf("R") };

  // Last each segment's outline, in its own directions.
  const joint = jointLines(joints, { top, toe, finger, palm });
  const seen = new Map(
    SEGMENT_IDS.map((id) => [
      id,
      measuredParts(id).map(() => [[], []] as [number[], number[]]),
    ]),
  );
  const note = (id: SegmentId): void => {
    const { origin, axis, left, front, length } = joint[id];
    d.copy(p).sub(origin);
    // A slab's girth is given along the trunk line, not along the slab.
    const slab = limbOf(id) === null && id !== "head";
    const along = slab
      ? d.dot(axis) / trunk.length + SLABS[id as SlabId].span[0]
      : d.dot(axis) / length;
    measuredParts(id).forEach(([from, to], part) => {
      if (along < from || along > to) return;
      const [xs, ys] = seen.get(id)![part]!;
      xs.push(d.dot(left));
      ys.push(d.dot(front));
    });
  };
  each((id) => {
    if (limbOf(id) !== null || id === "head") note(id);
    if (!isArm(id) && id !== "head") SLAB_IDS.forEach(note);
  });
  const sections = SEGMENT_IDS.map((id): Section | null => {
    const outlines = seen.get(id)!.map(([xs, ys]) => outlineOf(xs, ys));
    // A part with too little skin (the top of a thigh, say) borrows the other's.
    const far = outlines.at(-1) ?? outlines[0];
    const near = outlines[0] ?? far;
    if (!near || !far) return null;
    return {
      near: near.centre,
      far: far.centre,
      halfWidth: far.half[0],
      halfDepth: far.half[1],
    };
  });
  if (sections.some((entry) => entry === null)) return null;
  return {
    section: Object.fromEntries(
      SEGMENT_IDS.map((id, i) => [id, sections[i]]),
    ) as SkinMeasure["section"],
    top,
    toe,
    finger,
    palm,
  };
};

/**
 * A figure's segments from its joints and its skin alone, for a figure whose
 * limbs stand clear of each other (an atlas): each skin point belongs to the
 * segment it is nearest to. The first pass uses nominal sizes, the second
 * the sizes the first measured. Null when the skin cannot be measured.
 */
export const segmentsFromSkin = (
  points: Float32Array,
  joints: Joints,
): Segments | null => {
  const first = measureSkin(
    points,
    labelPoints(points, buildSegments(joints, null)),
    joints,
  );
  if (!first) return null;
  const skin = measureSkin(
    points,
    labelPoints(points, buildSegments(joints, first)),
    joints,
  );
  return skin && buildSegments(joints, skin);
};

/** A segment may be stretched or thickened this much at most; past it the fit is refused. */
export const FIT_SCALE_BAND: Pair = [0.4, 2.5];

const basis = (segment: Segment): Matrix4 =>
  new Matrix4().makeBasis(segment.left, segment.axis, segment.front);

const translation = (v: Vector3, sign: 1 | -1): Matrix4 =>
  new Matrix4().makeTranslation(sign * v.x, sign * v.y, sign * v.z);

export type SegmentFit = Readonly<{
  /** Per segment, in `SEGMENT_IDS` order: atlas coordinates to body coordinates. */
  matrices: readonly Matrix4[];
  /** False when a segment would be scaled outside `FIT_SCALE_BAND`. */
  ok: boolean;
}>;

/**
 * The map that lays each atlas segment on the body's: its centre line onto
 * the body's centre line, its directions onto the body's, stretched to the
 * body's length and scaled to its width and depth. A hand scales evenly with
 * its length, so curled fingers do not flatten its bones. The head hangs
 * from the crown and scales along by the mean of across and depth, so a
 * different neck length does not stretch the skull.
 */
export const fitMatrices = (
  atlas: Segments,
  body: Segments,
  /** Segments that hold no atlas anatomy (HRA's arms) are not held to the band. */
  holds: (index: number) => boolean = () => true,
): SegmentFit => {
  const scales: number[] = [];
  const matrices = SEGMENT_IDS.map((id, index) => {
    const a = atlas[id];
    const b = body[id];
    const head = id === "head";
    const wide = b.halfWidth / a.halfWidth;
    const deep = b.halfDepth / a.halfDepth;
    const along = head ? (wide + deep) / 2 : b.length / a.length;
    const scale =
      limbOf(id) === "hand"
        ? new Vector3(along, along, along)
        : new Vector3(wide, along, deep);
    if (holds(index)) scales.push(scale.x, scale.y, scale.z);
    const anchor = (segment: Segment): Vector3 =>
      head
        ? segment.origin.clone().addScaledVector(segment.axis, segment.length)
        : segment.origin;
    return translation(anchor(b), 1)
      .multiply(basis(b))
      .multiply(new Matrix4().makeScale(scale.x, scale.y, scale.z))
      .multiply(basis(a).transpose())
      .multiply(translation(anchor(a), -1));
  });
  const ok = scales.every(
    (value) => value >= FIT_SCALE_BAND[0] && value <= FIT_SCALE_BAND[1],
  );
  return { matrices, ok };
};
