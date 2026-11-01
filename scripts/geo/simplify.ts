import type { Ring } from "./shapefile";

/**
 * Geometry steps of the boundary build, on longitude and latitude in
 * degrees. Douglas-Peucker (Douglas and Peucker 1973) drops points closer
 * than a tolerance to the line they sit on; rings that end up smaller than a
 * minimum area are dropped, except the largest ring of each feature, so a
 * small island state still has a shape. Pure.
 */

type Point = readonly [number, number];

const segmentDistance = (point: Point, a: Point, b: Point): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
        );
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
};

/** Indices to keep between `first` and `last` (exclusive), by Douglas-Peucker. */
const keptBetween = (
  points: readonly Point[],
  first: number,
  last: number,
  tolerance: number,
): number[] => {
  if (last - first < 2) return [];
  const { index, distance } = points.slice(first + 1, last).reduce(
    (best, point, offset) => {
      const d = segmentDistance(point, points[first], points[last]);
      return d > best.distance ? { index: first + 1 + offset, distance: d } : best;
    },
    { index: -1, distance: -1 },
  );
  if (distance <= tolerance) return [];
  return [
    ...keptBetween(points, first, index, tolerance),
    index,
    ...keptBetween(points, index, last, tolerance),
  ];
};

/**
 * A closed ring (first point repeated last) with points within `tolerance`
 * degrees of the simplified line removed. The ring stays closed; a ring
 * that collapses below four points comes back unchanged so the caller can
 * judge it by area.
 */
export const simplifyRing = (ring: Ring, tolerance: number): Ring => {
  if (ring.length <= 4) return ring;
  // Split at the point farthest from the start, so a closed ring has two ends.
  const far = ring.reduce(
    (best, point, index) =>
      Math.hypot(point[0] - ring[0][0], point[1] - ring[0][1]) > best.distance
        ? { index, distance: Math.hypot(point[0] - ring[0][0], point[1] - ring[0][1]) }
        : best,
    { index: 0, distance: -1 },
  ).index;
  const last = ring.length - 1;
  const kept = [
    0,
    ...keptBetween(ring, 0, far, tolerance),
    far,
    ...keptBetween(ring, far, last, tolerance),
    last,
  ];
  const simplified = kept.map((index) => ring[index]);
  return simplified.length < 4 ? ring : simplified;
};

/** Signed area by the shoelace formula, in square degrees; negative is clockwise. */
export const signedArea = (ring: Ring): number =>
  ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;

/** Rounds every coordinate to `decimals` and drops repeated points. */
export const roundRing = (ring: Ring, decimals: number): Ring => {
  const factor = 10 ** decimals;
  const rounded = ring.map(
    (point) =>
      [
        Math.round(point[0] * factor) / factor,
        Math.round(point[1] * factor) / factor,
      ] as const,
  );
  return rounded.filter(
    (point, index) =>
      index === 0 ||
      point[0] !== rounded[index - 1][0] ||
      point[1] !== rounded[index - 1][1],
  );
};

/** Ray casting: true when `point` lies inside `ring`. */
export const insideRing = (point: Point, ring: Ring): boolean =>
  ring.reduce((inside, a, index) => {
    const b = ring[(index + 1) % ring.length];
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    return crosses ? !inside : inside;
  }, false);

/**
 * Shapefile rings as GeoJSON polygons: a clockwise ring starts a polygon
 * and a counter-clockwise ring is a hole of the outer ring that contains
 * it. GeoJSON (RFC 7946) winds outer rings counter-clockwise, so both are
 * reversed.
 */
export const nestRings = (rings: readonly Ring[]): Ring[][] => {
  const outers = rings.filter((ring) => signedArea(ring) <= 0);
  const holes = rings.filter((ring) => signedArea(ring) > 0);
  return outers.map((outer) => [
    [...outer].reverse(),
    ...holes
      .filter((hole) => insideRing(hole[0], outer))
      .map((hole) => [...hole].reverse()),
  ]);
};

export type SimplifyOptions = Readonly<{
  /** Douglas-Peucker tolerance, degrees. */
  tolerance: number;
  /** Rings smaller than this many square degrees are dropped (not the largest). */
  minArea: number;
  decimals: number;
}>;

/** One feature's rings, simplified, rounded and with slivers removed. */
export const simplifyFeature = (
  rings: readonly Ring[],
  options: SimplifyOptions,
): Ring[] => {
  const simplified = rings.map((ring) =>
    roundRing(simplifyRing(ring, options.tolerance), options.decimals),
  );
  const largest = simplified.reduce(
    (best, ring, index) =>
      Math.abs(signedArea(ring)) > best.area
        ? { index, area: Math.abs(signedArea(ring)) }
        : best,
    { index: -1, area: -1 },
  ).index;
  return simplified.filter(
    (ring, index) =>
      ring.length >= 4 &&
      (index === largest || Math.abs(signedArea(ring)) >= options.minArea),
  );
};
