import type { BoundaryFeature } from "./boundaries";
import { type Box, ringsBox } from "./map-shapes";
import { equalEarth, type XY } from "./projection";

/**
 * Where a map of some places should look: the whole world, or a box around
 * the places. Pure, so tests pin the choice for real cases (a country and
 * its neighbours, Pacific islands across the antimeridian, Malta alone).
 *
 * A country's far-off parts do not count: France's overseas regions or
 * Hawaii would otherwise stretch a map of Western Europe or North America
 * to the whole world. A ring counts when it lies near the country's
 * largest ring, or is a sizeable piece of land not too far from it.
 * Every ring is still drawn; only the view ignores the far ones.
 */

export type MapView =
  | Readonly<{ kind: "world"; lon0: 0 }>
  | Readonly<{ kind: "fit"; lon0: number; box: Box }>;

const WORLD: MapView = { kind: "world", lon0: 0 };

/** A ring this close (km) to the largest ring's box always counts. */
const NEAR_KM = 700;
/** Farther than NEAR_KM, a ring counts if it is this big and this close. */
const SIZEABLE_SHARE = 0.05;
const FAR_KM = 5000;
/** The narrowest view, in degrees of longitude at the equator; Malta alone shows Sicily. */
const MIN_SPAN_DEG = 12;
/** Space around the places, as a share of the view's larger side. */
const MARGIN_SHARE = 0.06;
/** A view that would cover this much of the world (by area) is the world. */
const WORLD_SHARE = 0.5;
/** Places spread over more longitude than this are drawn on the world map. */
const MAX_LON_SPAN = 180;

const EARTH_KM = 6371;
const DEG = Math.PI / 180;

type Ring = readonly XY[];
type LonLatBox = Readonly<{ west: number; east: number; south: number; north: number }>;

const ringBox = (ring: Ring): LonLatBox =>
  ring.reduce<LonLatBox>(
    (box, [lon, lat]) => ({
      west: Math.min(box.west, lon),
      east: Math.max(box.east, lon),
      south: Math.min(box.south, lat),
      north: Math.max(box.north, lat),
    }),
    { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity },
  );

/** Spherical area in km², near enough to compare rings of one country. */
const ringArea = (ring: Ring): number =>
  Math.abs(
    ring.reduce((sum, [lon, lat], index) => {
      const [nextLon, nextLat] = ring[(index + 1) % ring.length];
      return (
        sum + (nextLon - lon) * DEG * (Math.sin(nextLat * DEG) + Math.sin(lat * DEG))
      );
    }, 0) / 2,
  ) *
  EARTH_KM *
  EARTH_KM;

/** Degrees from `lon` to the nearest edge of `west..east`, around the globe; 0 inside. */
const lonGap = (lon: number, west: number, east: number): number => {
  if (lon >= west && lon <= east) return 0;
  const around = (from: number, to: number) => (((to - from) % 360) + 360) % 360;
  return Math.min(around(east, lon), around(lon, west));
};

/** Haversine distance in km from a point to the nearest point of a box. */
export const kmToBox = ([lon, lat]: XY, box: LonLatBox): number => {
  const nearLat = Math.min(box.north, Math.max(box.south, lat));
  const dLon = lonGap(lon, box.west, box.east) * DEG;
  const dLat = (lat - nearLat) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat * DEG) * Math.cos(nearLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const centreOf = (box: LonLatBox): XY => [
  (box.west + box.east) / 2,
  (box.south + box.north) / 2,
];

/** The rings of one feature that count for the view. */
export const coreRings = (feature: BoundaryFeature): readonly Ring[] => {
  const rings = feature.geometry.coordinates.map((polygon) => polygon[0] ?? []);
  const sized = rings
    .filter((ring) => ring.length > 0)
    .map((ring) => ({ ring, area: ringArea(ring), box: ringBox(ring) }));
  const main = sized.reduce<(typeof sized)[number] | undefined>(
    (best, entry) => (best === undefined || entry.area > best.area ? entry : best),
    undefined,
  );
  if (main === undefined) return [];
  return sized
    .filter((entry) => {
      if (entry === main) return true;
      const km = kmToBox(centreOf(entry.box), main.box);
      return km <= NEAR_KM || (km <= FAR_KM && entry.area >= SIZEABLE_SHARE * main.area);
    })
    .map((entry) => entry.ring);
};

/**
 * The narrowest run of longitude that holds every ring, around the globe:
 * the complement of the widest gap between them. Pacific places come out
 * as one run across 180 instead of the whole world.
 */
export const longitudeRun = (
  rings: readonly Ring[],
): Readonly<{ west: number; span: number }> | null => {
  const spans = rings
    .map(ringBox)
    .filter((box) => Number.isFinite(box.west))
    .map((box) => ({ west: box.west, east: box.east }));
  if (spans.length === 0) return null;
  if (spans.some((span) => span.east - span.west >= 180))
    return { west: -180, span: 360 };
  const sorted = [...spans].sort((a, b) => a.west - b.west);
  const merged = sorted.reduce<{ west: number; east: number }[]>((acc, span) => {
    const last = acc.at(-1);
    return last !== undefined && span.west <= last.east
      ? [...acc.slice(0, -1), { west: last.west, east: Math.max(last.east, span.east) }]
      : [...acc, span];
  }, []);
  // The gap after each run, the last one wrapping round to the first.
  const gaps = merged.map((run, index) => {
    const next = merged[(index + 1) % merged.length];
    const gap =
      index === merged.length - 1 ? next.west + 360 - run.east : next.west - run.east;
    return { after: run.east, gap };
  });
  const widest = gaps.reduce((best, entry) => (entry.gap > best.gap ? entry : best));
  if (widest.gap <= 0) return { west: -180, span: 360 };
  const west = widest.after + widest.gap;
  return { west: west > 180 ? west - 360 : west, span: 360 - widest.gap };
};

const wrap180 = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/** The world's own projected box, for comparing a view's size with it. */
const worldBox = (): Box => {
  const [maxX] = equalEarth(Math.PI, 0);
  const [, maxY] = equalEarth(0, Math.PI / 2);
  return { minX: -maxX, minY: -maxY, maxX, maxY };
};

const area = (box: Box): number => (box.maxX - box.minX) * (box.maxY - box.minY);

/** Grow a box about its centre to at least `min` on each side. */
const atLeast = (box: Box, min: number): Box => {
  const grow = (lo: number, hi: number): readonly [number, number] => {
    const extra = Math.max(0, min - (hi - lo)) / 2;
    return [lo - extra, hi + extra];
  };
  const [minX, maxX] = grow(box.minX, box.maxX);
  const [minY, maxY] = grow(box.minY, box.maxY);
  return { minX, minY, maxX, maxY };
};

const withMargin = (box: Box, share: number): Box => {
  const margin = share * Math.max(box.maxX - box.minX, box.maxY - box.minY);
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
  };
};

/**
 * The view for a map of `places`: a box around their core rings with a
 * margin, centred on their own longitude, or the world when they are
 * spread wide, cover most of it or are none at all.
 */
export const fitView = (places: readonly BoundaryFeature[]): MapView => {
  const rings = places.flatMap(coreRings);
  const run = longitudeRun(rings);
  if (run === null || run.span > MAX_LON_SPAN) return WORLD;
  const lon0 = wrap180(run.west + run.span / 2);
  const box = ringsBox(rings, lon0);
  if (box === null) return WORLD;
  const minSpan = equalEarth(MIN_SPAN_DEG * DEG, 0)[0];
  const view = withMargin(atLeast(box, minSpan), MARGIN_SHARE);
  return area(view) >= WORLD_SHARE * area(worldBox())
    ? WORLD
    : { kind: "fit", lon0, box: view };
};
