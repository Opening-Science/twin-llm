/**
 * Explode view: every structure moves outward from the body's centre along its
 * own direction, so neighbouring bones come apart without changing shape. The
 * rule is open-anatomy's explode contract (docs/explode-view.md there), so a
 * file that already carries `extras.explode` and one that does not move alike:
 *
 * - direction: from the body centre (the centres of all structures, weighted by
 *   volume) to the structure's centre, unit length. A structure within 1 cm of
 *   the body centre takes the mean of the others' directions instead; when that
 *   mean is shorter than 0.1 (left and right cancel), it moves forward (+Z).
 * - distance: the structure's bounding radius plus 2 cm, so neighbours clear.
 *
 * At slider value t the offset is t × distance × direction. Pure numbers only,
 * in the file's own frame (metres, +Y up, +Z forward, +X the body's left).
 */
export type Vec3 = readonly [number, number, number];

export type ExplodeVector = Readonly<{ direction: Vec3; distance: number }>;

export type ExplodeInput = Readonly<{
  centre: Vec3;
  /** Bounding radius in metres. */
  radius: number;
  /** Volume or another positive weight for the body centre. */
  weight: number;
  /** What the file says, when it says it; it wins over the rule. */
  given: ExplodeVector | null;
}>;

/** A centre this close to the body centre has no direction of its own. */
export const AT_CENTRE_M = 0.01;
/** A mean direction shorter than this has cancelled out. */
export const MIN_MEAN_LENGTH = 0.1;
/** Clearance added to the bounding radius. */
export const CLEARANCE_M = 0.02;
export const FORWARD: Vec3 = [0, 0, 1];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

/** Volume-weighted centre; an unweighted mean when no weight is positive. */
export const bodyCentre = (parts: readonly ExplodeInput[]): Vec3 => {
  if (parts.length === 0) return [0, 0, 0];
  const weights = parts.map((part) =>
    Number.isFinite(part.weight) && part.weight > 0 ? part.weight : 0,
  );
  const total = weights.reduce((sum, w) => sum + w, 0);
  const share =
    total > 0 ? weights.map((w) => w / total) : parts.map(() => 1 / parts.length);
  return parts.reduce<Vec3>(
    (sum, part, index) => [
      sum[0] + part.centre[0] * share[index]!,
      sum[1] + part.centre[1] * share[index]!,
      sum[2] + part.centre[2] * share[index]!,
    ],
    [0, 0, 0],
  );
};

/** One vector per input, in the same order. */
export const explodeVectors = (
  parts: readonly ExplodeInput[],
): readonly ExplodeVector[] => {
  const centre = bodyCentre(parts);
  const own = parts.map((part): Vec3 | null => {
    const away = sub(part.centre, centre);
    const len = length(away);
    return len < AT_CENTRE_M ? null : scale(away, 1 / len);
  });
  const known = own.filter((dir): dir is Vec3 => dir !== null);
  const sum = known.reduce<Vec3>(
    (acc, dir) => [acc[0] + dir[0], acc[1] + dir[1], acc[2] + dir[2]],
    [0, 0, 0],
  );
  const mean = known.length > 0 ? scale(sum, 1 / known.length) : ([0, 0, 0] as Vec3);
  const meanLength = length(mean);
  const fallback = meanLength < MIN_MEAN_LENGTH ? FORWARD : scale(mean, 1 / meanLength);
  return parts.map(
    (part, index): ExplodeVector =>
      part.given ?? {
        direction: own[index] ?? fallback,
        distance: Math.max(0, part.radius) + CLEARANCE_M,
      },
  );
};

/** The offset at slider value t, clamped to 0..1. */
export const explodeOffset = (vector: ExplodeVector, t: number): Vec3 => {
  const amount = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return scale(vector.direction, amount * vector.distance);
};

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => typeof n === "number" && Number.isFinite(n));

/** `extras.explode` from a file, or null when it is missing or malformed. */
export const parseExplode = (value: unknown): ExplodeVector | null => {
  if (!value || typeof value !== "object") return null;
  const { direction, distance } = value as { direction?: unknown; distance?: unknown };
  if (!isVec3(direction) || typeof distance !== "number" || !(distance >= 0)) return null;
  const len = length(direction);
  if (len < 1e-6 || !Number.isFinite(distance)) return null;
  return { direction: scale(direction, 1 / len), distance };
};

/**
 * Enclosed volume of a closed triangle mesh (signed tetrahedra from the
 * origin), in cubic metres. `index` null means consecutive vertex triples.
 */
export const meshVolume = (
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
): number => {
  const count = index ? index.length : positions.length / 3;
  let sum = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const a = (index ? index[i]! : i) * 3;
    const b = (index ? index[i + 1]! : i + 1) * 3;
    const c = (index ? index[i + 2]! : i + 2) * 3;
    const [ax, ay, az] = [positions[a]!, positions[a + 1]!, positions[a + 2]!];
    const [bx, by, bz] = [positions[b]!, positions[b + 1]!, positions[b + 2]!];
    const [cx, cy, cz] = [positions[c]!, positions[c + 1]!, positions[c + 2]!];
    sum += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(sum / 6);
};
