/**
 * The atlas heart's two-phase deformation (#53). Neither HRA heart nor
 * BodyParts3D has a mesh per chamber (one `#VHFHeart…` / `#VHMHeart` mesh;
 * BodyParts3D merges the heart into the whole cardiovascular system), so the
 * HRA heart is split by position instead: vertices towards the base (up,
 * right and back, where the atria sit) form the atrial region, vertices
 * towards the apex the ventricular one, with a soft blend between. Each region
 * contracts towards its own centre. Approximate regions, not chambers: true
 * chambers need an atlas with a mesh per chamber. Pure; the typed arrays it
 * writes are its own.
 */

export type Vec3 = readonly [number, number, number];

/**
 * Base-to-apex direction in the atlas frame (+X the subject's left, +Y up,
 * +Z front): the apex points left, down and forward. Illustrative, from the
 * textbook orientation, not measured on the atlas.
 */
export const HEART_AXIS: Vec3 = normalise([0.55, -0.5, 0.65]);

/** Along the axis from base (0) to apex (1): the atrial region fades out between these. */
export const ATRIAL_FADE: readonly [number, number] = [0.3, 0.5];

/** Largest pull of a vertex towards its region's centre (illustrative). */
export const CONTRACTION = { atria: 0.08, ventricles: 0.1 } as const;

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Per vertex, how much it belongs to the atrial region (0..1); the rest is
 * ventricular. `points` are xyz triples in the atlas frame.
 */
export const atrialWeights = (
  points: ArrayLike<number>,
  axis: Vec3 = HEART_AXIS,
): Float32Array => {
  const count = Math.floor(points.length / 3);
  const along = Float32Array.from({ length: count }, (_, index) => {
    const i = index * 3;
    return points[i]! * axis[0] + points[i + 1]! * axis[1] + points[i + 2]! * axis[2];
  });
  const low = along.reduce((min, value) => Math.min(min, value), Infinity);
  const high = along.reduce((max, value) => Math.max(max, value), -Infinity);
  const span = high - low;
  return along.map((value) =>
    span > 0 ? 1 - smoothstep(ATRIAL_FADE[0], ATRIAL_FADE[1], (value - low) / span) : 0,
  );
};

export type RegionCentres = Readonly<{ atria: Vec3; ventricles: Vec3 }>;

/** Weighted centre of each region, in the same frame as `rest`. */
export const regionCentres = (
  rest: ArrayLike<number>,
  weights: ArrayLike<number>,
): RegionCentres => {
  // [x, y, z, mass] for the atria, then the ventricles.
  const sums = new Float64Array(8);
  for (let index = 0; index < weights.length; index += 1) {
    const w = weights[index]!;
    const i = index * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      sums[axis] += w * rest[i + axis]!;
      sums[4 + axis] += (1 - w) * rest[i + axis]!;
    }
    sums[3] += w;
    sums[7] += 1 - w;
  }
  const centre = (offset: number): Vec3 => {
    const mass = sums[offset + 3]!;
    return mass > 0
      ? [sums[offset]! / mass, sums[offset + 1]! / mass, sums[offset + 2]! / mass]
      : [0, 0, 0];
  };
  return { atria: centre(0), ventricles: centre(4) };
};

export type HeartDeformer = Readonly<{
  /** The deformed positions; the same array every call. */
  positions: Float32Array;
  /** Writes the positions for this much contraction (0..1 each) and returns them. */
  apply: (atria: number, ventricles: number) => Float32Array;
}>;

/**
 * A deformer over `rest` (xyz in the mesh's own frame). Each vertex moves
 * towards its region's centre by the region's contraction times its weight;
 * zero contraction gives `rest` back exactly.
 */
export const createHeartDeformer = (
  rest: Float32Array,
  weights: Float32Array,
  centres: RegionCentres,
): HeartDeformer => {
  const positions = new Float32Array(rest);
  const [ax, ay, az] = centres.atria;
  const [vx, vy, vz] = centres.ventricles;
  const apply = (atria: number, ventricles: number): Float32Array => {
    const a = atria * CONTRACTION.atria;
    const v = ventricles * CONTRACTION.ventricles;
    for (let index = 0; index < weights.length; index += 1) {
      const w = weights[index]!;
      const ka = a * w;
      const kv = v * (1 - w);
      const i = index * 3;
      const x = rest[i]!;
      const y = rest[i + 1]!;
      const z = rest[i + 2]!;
      positions[i] = x + (ax - x) * ka + (vx - x) * kv;
      positions[i + 1] = y + (ay - y) * ka + (vy - y) * kv;
      positions[i + 2] = z + (az - z) * ka + (vz - z) * kv;
    }
    return positions;
  };
  return { positions, apply };
};
