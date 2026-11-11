/**
 * Explode view: every structure moves outward from the body's centre along its
 * own direction, so neighbouring bones come apart without changing shape.
 *
 * - centre: the middle of the structures' extent (of their centres, per axis),
 *   so a heavy pelvis does not pull it down to the lumbar spine.
 * - direction: from that centre to the structure's centre, unit length. A
 *   structure within 1 cm of it takes the mean of the others' directions
 *   instead; when that mean is shorter than 0.1 (left and right cancel), it
 *   moves forward (+Z).
 * - distance: 0.8 of its distance from the centre, plus 2 cm. Moving in
 *   proportion keeps the order: neighbouring vertebrae, which point almost the
 *   same way, still come apart, and left and right move alike.
 *
 * open-anatomy's draft explode contract moves every structure by its bounding
 * radius plus 2 cm instead; on the Stage 1 trunk that moved T1 to T11 up by
 * one and the same 7 cm, so they never separated. A file that carries its own
 * `extras.explode` still wins. At slider value t the offset is
 * t × distance × direction. Pure numbers only, in the file's own frame
 * (metres, +Y up, +Z forward, +X the body's left).
 */
export type Vec3 = readonly [number, number, number];

export type ExplodeVector = Readonly<{ direction: Vec3; distance: number }>;

export type ExplodeInput = Readonly<{
  centre: Vec3;
  /** What the file says, when it says it; it wins over the rule. */
  given: ExplodeVector | null;
}>;

/** A centre this close to the body centre has no direction of its own. */
export const AT_CENTRE_M = 0.01;
/** A mean direction shorter than this has cancelled out. */
export const MIN_MEAN_LENGTH = 0.1;
/** How far a structure moves at t = 1, as a share of its distance from the centre. */
export const SPREAD = 0.8;
/** Added to every distance, so structures at the centre clear each other too. */
export const CLEARANCE_M = 0.02;
export const FORWARD: Vec3 = [0, 0, 1];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

/** The middle of the centres' extent on each axis. */
export const bodyCentre = (parts: readonly ExplodeInput[]): Vec3 => {
  if (parts.length === 0) return [0, 0, 0];
  const axis = (i: 0 | 1 | 2): number => {
    const values = parts.map((part) => part.centre[i]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  };
  return [axis(0), axis(1), axis(2)];
};

/** One vector per input, in the same order. */
export const explodeVectors = (
  parts: readonly ExplodeInput[],
): readonly ExplodeVector[] => {
  const centre = bodyCentre(parts);
  const away = parts.map((part) => sub(part.centre, centre));
  const own = away.map((v): Vec3 | null => {
    const len = length(v);
    return len < AT_CENTRE_M ? null : scale(v, 1 / len);
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
        distance: SPREAD * length(away[index]!) + CLEARANCE_M,
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
